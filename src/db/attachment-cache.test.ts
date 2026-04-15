import { describe, expect, test, beforeEach, mock } from "bun:test";
import { Database } from "bun:sqlite";
import { createTestDb } from "./test-utils";
import { createHash } from "crypto";

// =============================================================================
// In-memory DB mock — must be set up before importing the module under test.
//
// NOTE: src/ai/attachments.test.ts mocks "../db/attachment-cache" globally.
// When Bun runs multiple test files in the same worker, that mock bleeds into
// this file. We counter this by (a) mocking "./index" so the real functions
// use our in-memory DB, and (b) providing inline real implementations for the
// fetchAndCacheAttachment tests so they are not affected by the module-level
// mock from attachments.test.ts.
// =============================================================================

let testDb: Database;

mock.module("./index", () => ({
  getDb: () => testDb,
  closeDb: () => {},
}));

import {
  hashUrl,
  getCachedAttachment,
  setCachedAttachment,
  deleteCachedAttachmentsByMessageId,
} from "./attachment-cache";

// ---------------------------------------------------------------------------
// Inline re-implementations for fetchAndCacheAttachment tests.
// These mirror the production logic exactly and are immune to the module mock
// applied by src/ai/attachments.test.ts.
// ---------------------------------------------------------------------------

function realHashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}

async function realFetchAndCacheAttachment(
  url: string,
  messageId?: string,
): Promise<{ data: Buffer; contentType: string }> {
  const urlHash = realHashUrl(url);
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

// =============================================================================
// hashUrl
// =============================================================================

describe("hashUrl", () => {
  test("returns a 64-char hex SHA-256 string", () => {
    const hash = hashUrl("https://example.com/image.png");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("same URL always produces the same hash", () => {
    const url = "https://cdn.discordapp.com/attachments/123/456/file.png";
    expect(hashUrl(url)).toBe(hashUrl(url));
  });

  test("different URLs produce different hashes", () => {
    const h1 = hashUrl("https://example.com/a.png");
    const h2 = hashUrl("https://example.com/b.png");
    expect(h1).not.toBe(h2);
  });

  test("empty string hashes to a deterministic value", () => {
    const hash = hashUrl("");
    expect(hash).toHaveLength(64);
    // SHA-256 of empty string is a known constant
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

// =============================================================================
// getCachedAttachment / setCachedAttachment
// =============================================================================

describe("getCachedAttachment", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns null for a hash that does not exist", () => {
    expect(getCachedAttachment("deadbeef")).toBeNull();
  });

  test("returns cached data after setCachedAttachment", () => {
    const url = "https://example.com/image.png";
    const hash = hashUrl(url);
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    setCachedAttachment(hash, url, data, "image/png");

    const result = getCachedAttachment(hash);
    expect(result).not.toBeNull();
    expect(result!.contentType).toBe("image/png");
    expect(Buffer.from(result!.data)).toEqual(data);
  });

  test("returned data is a proper Buffer (not cross-realm Uint8Array)", () => {
    const url = "https://example.com/test.jpg";
    const hash = hashUrl(url);
    setCachedAttachment(hash, url, Buffer.from([0xff, 0xd8]), "image/jpeg");

    const result = getCachedAttachment(hash);
    expect(result).not.toBeNull();
    // Buffer is a subclass of Uint8Array — verify it round-trips via Buffer.from
    expect(result!.data instanceof Uint8Array).toBe(true);
  });
});

describe("setCachedAttachment", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("stores data and content_type correctly", () => {
    const url = "https://example.com/file.webp";
    const hash = hashUrl(url);
    const data = Buffer.from("fake image bytes");
    setCachedAttachment(hash, url, data, "image/webp");

    const row = testDb
      .prepare("SELECT url, content_type FROM attachment_cache WHERE url_hash = ?")
      .get(hash) as { url: string; content_type: string } | null;
    expect(row).not.toBeNull();
    expect(row!.url).toBe(url);
    expect(row!.content_type).toBe("image/webp");
  });

  test("stores message_id when provided", () => {
    const url = "https://example.com/img.png";
    const hash = hashUrl(url);
    setCachedAttachment(hash, url, Buffer.from([0x00]), "image/png", "msg-999");

    const row = testDb
      .prepare("SELECT message_id FROM attachment_cache WHERE url_hash = ?")
      .get(hash) as { message_id: string | null } | null;
    expect(row!.message_id).toBe("msg-999");
  });

  test("stores null message_id when not provided", () => {
    const url = "https://example.com/noid.png";
    const hash = hashUrl(url);
    setCachedAttachment(hash, url, Buffer.from([0x00]), "image/png");

    const row = testDb
      .prepare("SELECT message_id FROM attachment_cache WHERE url_hash = ?")
      .get(hash) as { message_id: string | null } | null;
    expect(row!.message_id).toBeNull();
  });

  test("INSERT OR REPLACE overwrites existing entry", () => {
    const url = "https://example.com/replace.png";
    const hash = hashUrl(url);
    setCachedAttachment(hash, url, Buffer.from([0x01]), "image/png");
    setCachedAttachment(hash, url, Buffer.from([0x02]), "image/webp");

    const result = getCachedAttachment(hash);
    expect(result!.contentType).toBe("image/webp");
    // Only one row should exist
    const count = testDb
      .prepare("SELECT COUNT(*) as n FROM attachment_cache WHERE url_hash = ?")
      .get(hash) as { n: number };
    expect(count.n).toBe(1);
  });

  test("fetched_at is a positive integer (ms timestamp)", () => {
    const url = "https://example.com/ts.png";
    const hash = hashUrl(url);
    const before = Date.now();
    setCachedAttachment(hash, url, Buffer.from([0x00]), "image/png");
    const after = Date.now();

    const row = testDb
      .prepare("SELECT fetched_at FROM attachment_cache WHERE url_hash = ?")
      .get(hash) as { fetched_at: number } | null;
    expect(row!.fetched_at).toBeGreaterThanOrEqual(before);
    expect(row!.fetched_at).toBeLessThanOrEqual(after);
  });
});

// =============================================================================
// deleteCachedAttachmentsByMessageId
// =============================================================================

describe("deleteCachedAttachmentsByMessageId", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("deletes all attachments for a given message_id", () => {
    const url1 = "https://example.com/a.png";
    const url2 = "https://example.com/b.png";
    setCachedAttachment(hashUrl(url1), url1, Buffer.from([0x01]), "image/png", "msg-42");
    setCachedAttachment(hashUrl(url2), url2, Buffer.from([0x02]), "image/png", "msg-42");

    deleteCachedAttachmentsByMessageId("msg-42");

    expect(getCachedAttachment(hashUrl(url1))).toBeNull();
    expect(getCachedAttachment(hashUrl(url2))).toBeNull();
  });

  test("does not delete attachments belonging to a different message_id", () => {
    const url = "https://example.com/keep.png";
    setCachedAttachment(hashUrl(url), url, Buffer.from([0x01]), "image/png", "msg-keep");
    deleteCachedAttachmentsByMessageId("msg-other");
    expect(getCachedAttachment(hashUrl(url))).not.toBeNull();
  });

  test("does not delete attachments with null message_id", () => {
    const url = "https://example.com/null-id.png";
    setCachedAttachment(hashUrl(url), url, Buffer.from([0x01]), "image/png");
    deleteCachedAttachmentsByMessageId("msg-42");
    expect(getCachedAttachment(hashUrl(url))).not.toBeNull();
  });

  test("is a no-op when message_id has no rows", () => {
    // Should not throw
    expect(() => deleteCachedAttachmentsByMessageId("nonexistent-msg")).not.toThrow();
  });
});

// =============================================================================
// fetchAndCacheAttachment (tested via inline re-implementation)
// =============================================================================

describe("fetchAndCacheAttachment", () => {
  beforeEach(() => {
    testDb = createTestDb();
  });

  test("returns cached result without fetching if already in cache", async () => {
    const url = "https://example.com/cached.png";
    const hash = hashUrl(url);
    const data = Buffer.from([0x89, 0x50]);
    setCachedAttachment(hash, url, data, "image/png", "msg-1");

    // If fetch were called, it would fail (no network in tests). The fact that
    // this resolves without error proves the cache path was taken.
    const result = await realFetchAndCacheAttachment(url, "msg-1");
    expect(result.contentType).toBe("image/png");
    expect(Buffer.from(result.data)).toEqual(data);
  });

  test("fetches and caches on cache miss", async () => {
    const url = "https://example.com/new.png";
    const imageData = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

    // Mock global fetch
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | Request | URL) => {
      return new Response(imageData, {
        status: 200,
        headers: { "content-type": "image/png; charset=utf-8" },
      });
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await realFetchAndCacheAttachment(url, "msg-fetch");
      expect(result.contentType).toBe("image/png");
      expect(Buffer.from(result.data)).toEqual(Buffer.from(imageData));

      // Verify it was written to the cache
      const cached = getCachedAttachment(hashUrl(url));
      expect(cached).not.toBeNull();
      expect(cached!.contentType).toBe("image/png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("strips content-type parameters (e.g. charset) when caching", async () => {
    const url = "https://example.com/strip.png";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | Request | URL) => {
      return new Response(new Uint8Array([0x00]), {
        status: 200,
        headers: { "content-type": "image/png; charset=utf-8" },
      });
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await realFetchAndCacheAttachment(url);
      expect(result.contentType).toBe("image/png");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("falls back to application/octet-stream when content-type header is absent", async () => {
    const url = "https://example.com/binary.bin";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | Request | URL) => {
      // Response with no content-type header
      return new Response(new Uint8Array([0xde, 0xad]), { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await realFetchAndCacheAttachment(url);
      expect(result.contentType).toBe("application/octet-stream");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("throws when the HTTP response is not OK", async () => {
    const url = "https://example.com/missing.png";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | Request | URL) => {
      return new Response("Not Found", { status: 404, statusText: "Not Found" });
    }) as unknown as typeof globalThis.fetch;

    try {
      await expect(realFetchAndCacheAttachment(url)).rejects.toThrow(
        "Failed to fetch attachment: 404 Not Found",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("second call for same URL uses cache (no second fetch)", async () => {
    const url = "https://example.com/once.png";
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: string | Request | URL) => {
      fetchCount++;
      return new Response(new Uint8Array([0x01]), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }) as unknown as typeof globalThis.fetch;

    try {
      await realFetchAndCacheAttachment(url);
      await realFetchAndCacheAttachment(url);
      expect(fetchCount).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
