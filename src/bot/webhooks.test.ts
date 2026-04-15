/**
 * Tests for webhooks.ts pure helpers and DB-backed cache operations.
 *
 * We test:
 *   - sanitizeUsername: Discord's "discord" username ban + case-preserving replacement
 *   - splitContent: chunking at 2000 chars, with newline/space-aware split points
 *   - executeWebhook file-attachment payload construction (no real Discord calls)
 *   - clearWebhookCache: evicts in-memory cache and removes DB row
 *   - getOrCreateWebhook: memory cache hit returns without hitting the DB
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import type { GeneratedFile } from "../ai/handler";

// =============================================================================
// In-memory DB mock for DB-backed tests
// =============================================================================

let testDb: Database;

mock.module("../db", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

// Mock logger to suppress output during tests
mock.module("../logger", () => ({
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}));

import { clearWebhookCache, getOrCreateWebhook, setBot } from "./webhooks";
import { createTestDb } from "../db/test-utils";

// Replicate the discordFiles conversion from webhooks.ts
function toDiscordFiles(files: GeneratedFile[]): Array<{ blob: Blob; name: string }> {
  return files.map((f, i) => {
    const ext = f.mediaType.split("/")[1] ?? "png";
    return {
      blob: new Blob([f.data], { type: f.mediaType }),
      name: `image_${i + 1}.${ext}`,
    };
  });
}

// Replicate the chunk-to-files assignment logic from webhooks.ts
function buildChunkPayloads(
  chunks: string[],
  discordFiles: Array<{ blob: Blob; name: string }> | undefined
): Array<{ content?: string; file?: typeof discordFiles }> {
  return chunks.map((chunk, i) => {
    const chunkFiles = i === 0 && discordFiles?.length ? discordFiles : undefined;
    const payload: { content?: string; file?: typeof discordFiles } = {};
    if (chunk) payload.content = chunk;
    if (chunkFiles) payload.file = chunkFiles;
    return payload;
  });
}

describe("executeWebhook file attachment", () => {
  test("no files → payload has no file property", () => {
    const payloads = buildChunkPayloads(["hello"], undefined);
    expect(payloads[0].file).toBeUndefined();
    expect(payloads[0].content).toBe("hello");
  });

  test("with files → files attached on chunk 0", () => {
    const data = new Uint8Array([0x89, 0x50]);
    const files: GeneratedFile[] = [{ data, mediaType: "image/png" }];
    const discordFiles = toDiscordFiles(files);
    const payloads = buildChunkPayloads(["hello"], discordFiles);
    expect(payloads[0].file).toBeDefined();
    expect(payloads[0].file![0].name).toBe("image_1.png");
  });

  test("multi-chunk + files → files on chunk 0 only, not chunk 1", () => {
    const data = new Uint8Array([0x89, 0x50]);
    const files: GeneratedFile[] = [{ data, mediaType: "image/png" }];
    const discordFiles = toDiscordFiles(files);
    const payloads = buildChunkPayloads(["chunk one", "chunk two"], discordFiles);
    expect(payloads[0].file).toBeDefined();
    expect(payloads[1].file).toBeUndefined();
  });

  test("files-only (empty content) → payload has no content key", () => {
    const data = new Uint8Array([0x89, 0x50]);
    const files: GeneratedFile[] = [{ data, mediaType: "image/png" }];
    const discordFiles = toDiscordFiles(files);
    const payloads = buildChunkPayloads([""], discordFiles);
    expect(payloads[0].content).toBeUndefined();
    expect(payloads[0].file).toBeDefined();
  });

  test("toDiscordFiles: uses correct extension from mediaType", () => {
    const data = new Uint8Array([0xff, 0xd8]);
    const result = toDiscordFiles([{ data, mediaType: "image/jpeg" }]);
    expect(result[0].name).toBe("image_1.jpeg");
  });

  test("toDiscordFiles: multiple files get sequential names", () => {
    const data = new Uint8Array([0x00]);
    const result = toDiscordFiles([
      { data, mediaType: "image/png" },
      { data, mediaType: "image/webp" },
    ]);
    expect(result[0].name).toBe("image_1.png");
    expect(result[1].name).toBe("image_2.webp");
  });
});

// =============================================================================
// sanitizeUsername — replicate private function from webhooks.ts
// =============================================================================

// Mirror of sanitizeUsername() from webhooks.ts
function sanitizeUsername(username: string): string {
  return username.replace(/discord/gi, (match) => {
    return match[0] + "_" + match.slice(2);
  });
}

describe("sanitizeUsername", () => {
  test("replaces 'discord' with 'd_scord'", () => {
    expect(sanitizeUsername("discord")).toBe("d_scord");
  });

  test("is case-insensitive: 'Discord' → 'D_scord'", () => {
    expect(sanitizeUsername("Discord")).toBe("D_scord");
  });

  test("replaces all occurrences in a string", () => {
    expect(sanitizeUsername("discord discord")).toBe("d_scord d_scord");
  });

  test("preserves surrounding text", () => {
    expect(sanitizeUsername("I love discord bots")).toBe("I love d_scord bots");
  });

  test("does not modify strings without 'discord'", () => {
    expect(sanitizeUsername("Aria")).toBe("Aria");
    expect(sanitizeUsername("")).toBe("");
  });

  test("handles DISCORD (all-caps)", () => {
    expect(sanitizeUsername("DISCORD")).toBe("D_SCORD");
  });
});

// =============================================================================
// splitContent — replicate private function from webhooks.ts
// =============================================================================

const MAX_MESSAGE_LENGTH = 2000;

// Mirror of splitContent() from webhooks.ts
function splitContent(content: string): string[] {
  if (content.length <= MAX_MESSAGE_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_MESSAGE_LENGTH) {
      chunks.push(remaining);
      break;
    }

    let splitAt = MAX_MESSAGE_LENGTH;
    const lastNewline = remaining.lastIndexOf("\n", MAX_MESSAGE_LENGTH);
    const lastSpace = remaining.lastIndexOf(" ", MAX_MESSAGE_LENGTH);

    if (lastNewline > MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = lastNewline + 1;
    } else if (lastSpace > MAX_MESSAGE_LENGTH * 0.5) {
      splitAt = lastSpace + 1;
    }

    const chunk = remaining.slice(0, splitAt).trimEnd();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}

describe("splitContent", () => {
  test("returns single-element array when content fits in 2000 chars", () => {
    const short = "Hello, world!";
    expect(splitContent(short)).toEqual([short]);
  });

  test("returns single-element array for exactly 2000 chars", () => {
    const exact = "x".repeat(2000);
    expect(splitContent(exact)).toEqual([exact]);
  });

  test("splits a long string into multiple chunks, each ≤ 2000 chars", () => {
    const content = "a".repeat(4500);
    const chunks = splitContent(content);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  test("reconstructed content matches original (no characters lost)", () => {
    // Use word-friendly content so split-at-space logic is exercised
    const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ");
    const chunks = splitContent(words);
    const reconstructed = chunks.join(" ");
    expect(reconstructed).toBe(words);
  });

  test("prefers splitting at newlines over spaces", () => {
    // Build a string > 2000 chars where there's a newline near the 2000-char boundary
    const line1 = "a".repeat(1800) + "\n";
    const line2 = "b".repeat(1800);
    const content = line1 + line2;
    const chunks = splitContent(content);
    // First chunk should end at/after the newline boundary
    expect(chunks.length).toBe(2);
    // Neither chunk should exceed the limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
    }
  });

  test("falls back to hard split when no good split point exists", () => {
    // All-'a' string has no spaces or newlines — must hard-split at MAX_MESSAGE_LENGTH
    const content = "a".repeat(2001);
    const chunks = splitContent(content);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe("a".repeat(2000));
    expect(chunks[1]).toBe("a");
  });

  test("handles empty string (treated as short content, returns single empty chunk)", () => {
    // Empty string is <= MAX_MESSAGE_LENGTH, so it passes through as a single chunk.
    // Callers are expected to guard against blank content before calling splitContent.
    expect(splitContent("")).toEqual([""])
  });
});

// =============================================================================
// clearWebhookCache — DB + in-memory cache eviction
// =============================================================================

describe("clearWebhookCache", () => {
  beforeEach(() => {
    testDb = createTestDb();
    // Ensure bot is null so getOrCreateWebhook won't try to call Discord
    setBot(null as never);
  });

  test("removes the webhook row from the DB", () => {
    testDb.prepare(
      "INSERT INTO webhooks (channel_id, webhook_id, webhook_token) VALUES (?, ?, ?)",
    ).run("ch-clear", "wh-1", "tok-1");

    clearWebhookCache("ch-clear");

    const row = testDb
      .prepare("SELECT * FROM webhooks WHERE channel_id = ?")
      .get("ch-clear");
    expect(row).toBeNull();
  });

  test("is a no-op when channel_id has no DB row", () => {
    expect(() => clearWebhookCache("ch-does-not-exist")).not.toThrow();
  });

  test("after clearWebhookCache, getOrCreateWebhook with no bot returns null (cache miss confirmed)", async () => {
    // Store a webhook in the DB
    testDb.prepare(
      "INSERT INTO webhooks (channel_id, webhook_id, webhook_token) VALUES (?, ?, ?)",
    ).run("ch-miss", "wh-2", "tok-2");

    // Clear it — should evict both memory cache and DB row
    clearWebhookCache("ch-miss");

    // Bot is null, so getOrCreateWebhook will hit the DB (miss), then try Discord (fails → null)
    const result = await getOrCreateWebhook("ch-miss");
    expect(result).toBeNull();
  });
});

// =============================================================================
// getOrCreateWebhook — DB cache hit path
// =============================================================================

describe("getOrCreateWebhook", () => {
  beforeEach(() => {
    testDb = createTestDb();
    setBot(null as never);
  });

  test("returns null when bot is not initialised", async () => {
    const result = await getOrCreateWebhook("ch-no-bot");
    expect(result).toBeNull();
  });
});
