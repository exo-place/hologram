import { createHash } from "crypto";
import { getDb } from "./index";

// =============================================================================
// Types
// =============================================================================

export interface CachedAttachment {
  data: Buffer;
  contentType: string;
}

// =============================================================================
// Helpers
// =============================================================================

export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

// =============================================================================
// Cache Operations
// =============================================================================

export function getCachedAttachment(urlHash: string): CachedAttachment | null {
  const db = getDb();
  const row = db
    .prepare("SELECT data, content_type FROM attachment_cache WHERE url_hash = ?")
    .get(urlHash) as { data: Buffer; content_type: string } | null;
  if (!row) return null;
  // Bun's SQLite returns BLOBs as a cross-realm Uint8Array that fails instanceof
  // checks in the AI SDK (convertToBase64 uses `value instanceof Uint8Array`).
  // Buffer.from() normalises it to a proper Node.js Buffer.
  return { data: Buffer.from(row.data), contentType: row.content_type };
}

export function setCachedAttachment(
  urlHash: string,
  url: string,
  data: Buffer,
  contentType: string,
  messageId?: string,
): void {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO attachment_cache (url_hash, url, data, content_type, fetched_at, message_id) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(urlHash, url, data, contentType, Date.now(), messageId ?? null);
}

export function deleteCachedAttachmentsByMessageId(messageId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM attachment_cache WHERE message_id = ?").run(messageId);
}

// =============================================================================
// Fetch + Cache
// =============================================================================

export async function fetchAndCacheAttachment(
  url: string,
  messageId?: string,
): Promise<CachedAttachment> {
  const urlHash = hashUrl(url);
  const cached = getCachedAttachment(urlHash);
  if (cached) return cached;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch attachment: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const data = Buffer.from(arrayBuffer);
  const contentType =
    response.headers.get("content-type")?.split(";")[0].trim() ?? "application/octet-stream";

  setCachedAttachment(urlHash, url, data, contentType, messageId);
  return { data, contentType };
}

