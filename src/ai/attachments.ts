import { fetchAndCacheAttachment } from "../db/attachment-cache";
import { recordEvalError } from "../db/discord";
import { warn } from "../logger";
import { supportsVision, supportsDocumentType } from "./models";
import { MARKER_HATT_PREFIX, MARKER_SUFFIX } from "./template";
import type { StructuredMessage, ContentPart, ResolvedMessage } from "./context";

// =============================================================================
// HATT Marker Parsing
// =============================================================================

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex that matches HATT markers for the given nonce.
 * Marker format: <<<HATT:{nonce}|{url}|{mimeType}>>>
 * Captures: [1] url, [2] mimeType
 */
function buildHattPattern(nonce: string): RegExp {
  return new RegExp(
    `${escapeRegExp(MARKER_HATT_PREFIX)}${escapeRegExp(nonce)}\\|([^|]+)\\|([^>]*?)${escapeRegExp(MARKER_SUFFIX)}`,
    "g",
  );
}

// =============================================================================
// Resolution
// =============================================================================

/**
 * Resolve HATT attachment markers in messages to proper content parts.
 *
 * - image/* + vision-capable provider → ImagePart (URL passed directly)
 * - supported document types → FilePart (fetched bytes, base64)
 * - everything else → text fallback + eval error notification
 *
 * Messages without HATT markers are returned unchanged as ResolvedMessage.
 */
export async function resolveAttachmentMarkers(
  messages: StructuredMessage[],
  nonce: string,
  providerName: string,
  entityId: number,
  ownerId: string,
): Promise<ResolvedMessage[]> {
  const hattSentinel = MARKER_HATT_PREFIX + nonce;
  const pattern = buildHattPattern(nonce);
  const resolved: ResolvedMessage[] = [];

  for (const msg of messages) {
    if (!msg.content.includes(hattSentinel)) {
      resolved.push(msg);
      continue;
    }

    // The AI SDK schema for assistant messages does not include ImagePart.
    // Strip HATT markers from assistant messages; the text before each marker
    // (e.g. "<:name:id>" for emojis, "[sticker: name]" for stickers) remains.
    if (msg.role === "assistant") {
      pattern.lastIndex = 0;
      resolved.push({ role: msg.role, content: msg.content.replace(pattern, "") });
      continue;
    }

    const parts: ContentPart[] = [];
    let lastIndex = 0;
    pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(msg.content)) !== null) {
      const textBefore = msg.content.slice(lastIndex, match.index);
      if (textBefore) {
        parts.push({ type: "text", text: textBefore });
      }

      const url = match[1];
      const mimeType = match[2] || "application/octet-stream";
      const part = await resolveAttachment(url, mimeType, providerName, entityId, ownerId);
      parts.push(part);

      lastIndex = match.index + match[0].length;
    }

    const remaining = msg.content.slice(lastIndex);
    if (remaining) {
      parts.push({ type: "text", text: remaining });
    }

    // Unwrap single text-only result back to string
    if (parts.length === 1 && parts[0].type === "text") {
      resolved.push({ role: msg.role, content: parts[0].text });
    } else {
      resolved.push({ role: msg.role, content: parts });
    }
  }

  return resolved;
}

// =============================================================================
// Helpers
// =============================================================================

const DISCORD_CDN_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);

function isDiscordCdnUrl(url: string): boolean {
  try {
    return DISCORD_CDN_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

// =============================================================================
// Per-Attachment Routing
// =============================================================================

async function resolveAttachment(
  url: string,
  mimeType: string,
  providerName: string,
  entityId: number,
  ownerId: string,
): Promise<ContentPart> {
  // Accept both full MIME types ("image/jpeg") and base types ("image") for routing.
  const isImage = mimeType === "image" || mimeType.startsWith("image/");

  if (isImage && supportsVision(providerName)) {
    if (isDiscordCdnUrl(url)) {
      try {
        const { data, contentType } = await fetchAndCacheAttachment(url);
        // data is Buffer from getCachedAttachment (Buffer.from'd from SQLite Uint8Array).
        // Use Buffer.from() to guarantee a real Buffer before encoding — AI SDK schema
        // rejects Buffer objects and requires a base64 string for inline image data.
        return { type: "image", image: Buffer.from(data).toString("base64"), mediaType: contentType };
      } catch (err) {
        warn("Failed to fetch image attachment", { url, mimeType, err });
        return fallbackPart(
          url,
          mimeType,
          entityId,
          ownerId,
          `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    // External image URLs (e.g. Tenor thumbnails): pass URL directly.
    // Most providers can fetch public URLs themselves.
    return { type: "image", image: url };
  }

  if (!isImage && supportsDocumentType(providerName, mimeType)) {
    try {
      const { data } = await fetchAndCacheAttachment(url);
      return { type: "file", data: data.toString("base64"), mediaType: mimeType };
    } catch (err) {
      warn("Failed to fetch document attachment", { url, mimeType, err });
      return fallbackPart(
        url,
        mimeType,
        entityId,
        ownerId,
        `Failed to fetch: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const reason = isImage
    ? `${providerName} does not support image attachments`
    : `${providerName} does not support ${mimeType} documents`;
  return fallbackPart(url, mimeType, entityId, ownerId, reason);
}

function fallbackPart(
  url: string,
  mimeType: string,
  entityId: number,
  ownerId: string,
  reason: string,
): ContentPart {
  // Deduplicated notification to entity owner/editors
  recordEvalError(
    entityId,
    ownerId,
    `Attachment fallback (${mimeType}): ${reason}`,
    mimeType,
  );

  // Include filename extracted from URL for readability
  const filename = url.split("/").pop()?.split("?")[0] ?? "attachment";
  return { type: "text", text: `[${mimeType}: ${filename}]` };
}
