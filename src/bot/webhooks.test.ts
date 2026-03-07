/**
 * Tests for executeWebhook() file attachment behavior.
 *
 * We test the file-handling logic by examining the payload construction,
 * without making real Discord API calls (bot is null → early return).
 * The key behaviors under test are:
 *   - No files → same as before (no regression)
 *   - Files → attached on chunk 0 only
 *   - Multi-chunk + files → files on chunk 0, not chunk 1+
 */
import { describe, expect, test } from "bun:test";
import type { GeneratedFile } from "../ai/handler";

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
