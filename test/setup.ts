import { mock } from "bun:test";

// Mock native modules that aren't available in the Nix test environment.
// @huggingface/transformers pulls in sharp + onnxruntime-node which require
// native libraries (libstdc++) not present in the Nix test sandbox.
mock.module("@huggingface/transformers", () => ({
  pipeline: async () => async () => ({ data: new Float32Array(384) }),
}));
