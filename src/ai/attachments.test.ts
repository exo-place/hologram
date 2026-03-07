/**
 * Tests for attachment marker resolution (HATT protocol) and the attach() template function.
 */
import { describe, expect, test } from "bun:test";
import { renderStructuredTemplate, MARKER_HATT_PREFIX, MARKER_SUFFIX } from "./template";
import { resolveAttachmentMarkers } from "./attachments";
import type { StructuredMessage, ContentPart } from "./context";

// =============================================================================
// attach() marker emission via renderStructuredTemplate
// =============================================================================

describe("attach(): marker emission", () => {
  test("emits HATT marker with nonce, url, and mimeType", () => {
    const result = renderStructuredTemplate(
      `{% call send_as("user") %}{{ attach("https://example.com/photo.png", "image/png") }}{% endcall %}`,
      {},
    );
    const { nonce } = result;
    expect(nonce).toHaveLength(64); // 32 bytes hex
    const msg = result.messages[0];
    expect(msg.content).toContain(`${MARKER_HATT_PREFIX}${nonce}|https://example.com/photo.png|image/png${MARKER_SUFFIX}`);
  });

  test("nonce is returned in ParsedTemplateOutput", () => {
    const result = renderStructuredTemplate("Hello", {});
    expect(typeof result.nonce).toBe("string");
    expect(result.nonce).toHaveLength(64);
  });

  test("each render has a unique nonce", () => {
    const r1 = renderStructuredTemplate("Hello", {});
    const r2 = renderStructuredTemplate("Hello", {});
    expect(r1.nonce).not.toBe(r2.nonce);
  });

  test("attach() with empty url emits nothing", () => {
    const result = renderStructuredTemplate(
      `{% call send_as("user") %}{{ attach("", "image/png") }}{% endcall %}`,
      {},
    );
    // Empty attach() call → empty content → message is dropped
    expect(result.messages).toHaveLength(0);
  });

  test("attach() is available in template context", () => {
    const result = renderStructuredTemplate(
      `{% call send_as("user") %}before{{ attach("https://cdn.discord.com/img.jpg", "image/jpeg") }}after{% endcall %}`,
      {},
    );
    const content = result.messages[0].content;
    const { nonce } = result;
    expect(content).toContain("before");
    expect(content).toContain(`${MARKER_HATT_PREFIX}${nonce}|https://cdn.discord.com/img.jpg|image/jpeg${MARKER_SUFFIX}`);
    expect(content).toContain("after");
  });
});

// =============================================================================
// resolveAttachmentMarkers
// =============================================================================

describe("resolveAttachmentMarkers: no markers", () => {
  test("passes through messages without HATT markers unchanged", async () => {
    const messages: StructuredMessage[] = [
      { role: "user", content: "Hello world" },
      { role: "assistant", content: "Hi there" },
    ];
    const result = await resolveAttachmentMarkers(messages, "somenonce", "anthropic", 0, "");
    expect(result).toEqual(messages);
  });
});

describe("resolveAttachmentMarkers: image parts", () => {
  test("image/* on vision-capable provider → ImagePart", async () => {
    const nonce = "a".repeat(64);
    const url = "https://cdn.discord.com/attachments/123/456/photo.png";
    const messages: StructuredMessage[] = [
      {
        role: "user",
        content: `look: ${MARKER_HATT_PREFIX}${nonce}|${url}|image/png${MARKER_SUFFIX}`,
      },
    ];
    const result = await resolveAttachmentMarkers(messages, nonce, "anthropic", 0, "");
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    const content = result[0].content;
    expect(Array.isArray(content)).toBe(true);
    const parts = content as ContentPart[];
    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({ type: "text", text: "look: " });
    expect(parts[1]).toEqual({ type: "image", image: url });
  });

  test("image/* on non-vision provider → text fallback", async () => {
    const nonce = "b".repeat(64);
    const url = "https://cdn.discord.com/attachments/123/456/photo.png";
    const messages: StructuredMessage[] = [
      {
        role: "user",
        content: `${MARKER_HATT_PREFIX}${nonce}|${url}|image/png${MARKER_SUFFIX}`,
      },
    ];
    // groq doesn't support vision
    const result = await resolveAttachmentMarkers(messages, nonce, "groq", 0, "");
    expect(result).toHaveLength(1);
    // Single text part gets unwrapped back to string
    expect(typeof result[0].content).toBe("string");
    expect(result[0].content as string).toContain("[image/png:");
  });
});

describe("resolveAttachmentMarkers: multiple markers in one message", () => {
  test("two image markers produce three parts (text between them)", async () => {
    const nonce = "c".repeat(64);
    const url1 = "https://cdn.discord.com/img1.png";
    const url2 = "https://cdn.discord.com/img2.jpg";
    const m1 = `${MARKER_HATT_PREFIX}${nonce}|${url1}|image/png${MARKER_SUFFIX}`;
    const m2 = `${MARKER_HATT_PREFIX}${nonce}|${url2}|image/jpeg${MARKER_SUFFIX}`;
    const messages: StructuredMessage[] = [
      { role: "user", content: `${m1} and ${m2}` },
    ];
    const result = await resolveAttachmentMarkers(messages, nonce, "anthropic", 0, "");
    const parts = result[0].content as ContentPart[];
    expect(parts).toHaveLength(3);
    expect(parts[0]).toEqual({ type: "image", image: url1 });
    expect(parts[1]).toEqual({ type: "text", text: " and " });
    expect(parts[2]).toEqual({ type: "image", image: url2 });
  });
});

describe("resolveAttachmentMarkers: nonce isolation", () => {
  test("markers from a different nonce are not resolved", async () => {
    const correctNonce = "d".repeat(64);
    const wrongNonce = "e".repeat(64);
    const url = "https://cdn.discord.com/photo.png";
    const staleMarker = `${MARKER_HATT_PREFIX}${wrongNonce}|${url}|image/png${MARKER_SUFFIX}`;
    const messages: StructuredMessage[] = [
      { role: "user", content: staleMarker },
    ];
    // Use correct nonce in resolver - wrong nonce markers should pass through as text
    const result = await resolveAttachmentMarkers(messages, correctNonce, "anthropic", 0, "");
    expect(result[0].content).toBe(staleMarker);
  });
});

// =============================================================================
// Capability detection (via models.ts)
// =============================================================================

describe("supportsVision / supportsDocumentType", () => {
  test("anthropic supports vision", async () => {
    const { supportsVision } = await import("./models");
    expect(supportsVision("anthropic")).toBe(true);
  });

  test("groq does not support vision", async () => {
    const { supportsVision } = await import("./models");
    expect(supportsVision("groq")).toBe(false);
  });

  test("anthropic supports pdf documents", async () => {
    const { supportsDocumentType } = await import("./models");
    expect(supportsDocumentType("anthropic", "application/pdf")).toBe(true);
  });

  test("anthropic does not support zip documents", async () => {
    const { supportsDocumentType } = await import("./models");
    expect(supportsDocumentType("anthropic", "application/zip")).toBe(false);
  });

  test("groq does not support any documents", async () => {
    const { supportsDocumentType } = await import("./models");
    expect(supportsDocumentType("groq", "application/pdf")).toBe(false);
  });
});
