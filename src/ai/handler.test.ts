/**
 * Tests for GeneratedFile collection in handler.ts.
 *
 * These tests verify the file-filtering logic directly, without calling the LLM,
 * by replicating the same transform used in handleMessage().
 */
import { describe, expect, test } from "bun:test";
import type { GeneratedFile } from "./handler";

// Replicate the file-collection transform from handleMessage()
function collectFiles(
  resultFiles: Array<{ mediaType: string; uint8Array: Uint8Array }> | undefined
): GeneratedFile[] | undefined {
  const generatedFiles: GeneratedFile[] = (resultFiles ?? [])
    .filter(f => f.mediaType.startsWith("image/"))
    .map(f => ({ data: f.uint8Array, mediaType: f.mediaType }));
  return generatedFiles.length > 0 ? generatedFiles : undefined;
}

describe("GeneratedFile collection", () => {
  test("undefined result.files → ResponseResult.files is undefined", () => {
    expect(collectFiles(undefined)).toBeUndefined();
  });

  test("empty result.files → ResponseResult.files is undefined", () => {
    expect(collectFiles([])).toBeUndefined();
  });

  test("image file → ResponseResult.files has correct entry", () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const result = collectFiles([{ mediaType: "image/png", uint8Array: data }]);
    expect(result).toBeDefined();
    expect(result!).toHaveLength(1);
    expect(result![0].mediaType).toBe("image/png");
    expect(result![0].data).toBe(data);
  });

  test("non-image files (text/plain) are filtered out", () => {
    const data = new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    expect(collectFiles([{ mediaType: "text/plain", uint8Array: data }])).toBeUndefined();
  });

  test("mixed files: only image files are kept", () => {
    const imgData = new Uint8Array([0x89, 0x50]);
    const txtData = new Uint8Array([0x68, 0x69]);
    const result = collectFiles([
      { mediaType: "image/png", uint8Array: imgData },
      { mediaType: "text/plain", uint8Array: txtData },
      { mediaType: "image/jpeg", uint8Array: imgData },
    ]);
    expect(result).toBeDefined();
    expect(result!).toHaveLength(2);
    expect(result!.map(f => f.mediaType)).toEqual(["image/png", "image/jpeg"]);
  });

  test("image/jpeg file has correct mediaType", () => {
    const data = new Uint8Array([0xff, 0xd8]);
    const result = collectFiles([{ mediaType: "image/jpeg", uint8Array: data }]);
    expect(result![0].mediaType).toBe("image/jpeg");
  });
});
