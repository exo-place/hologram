import type { ContentFilter, SafetyCategory, SafetyThreshold } from "../logic/expr";
import { getDb } from "../db";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { anthropic } from "@ai-sdk/anthropic";
import { azure } from "@ai-sdk/azure";
import { bedrock } from "@ai-sdk/amazon-bedrock";
import { cerebras } from "@ai-sdk/cerebras";
import { cohere } from "@ai-sdk/cohere";
import { deepinfra } from "@ai-sdk/deepinfra";
import { deepseek } from "@ai-sdk/deepseek";
import { fireworks } from "@ai-sdk/fireworks";
import { google } from "@ai-sdk/google";
import { groq } from "@ai-sdk/groq";
import { huggingface } from "@ai-sdk/huggingface";
import { mistral } from "@ai-sdk/mistral";
import { openai } from "@ai-sdk/openai";
import { perplexity } from "@ai-sdk/perplexity";
import { togetherai } from "@ai-sdk/togetherai";
import { vertex } from "@ai-sdk/google-vertex";
import { xai } from "@ai-sdk/xai";

const providerMap = {
  "amazon-bedrock": bedrock,
  anthropic,
  azure,
  cerebras,
  cohere,
  deepinfra,
  deepseek,
  fireworks,
  google,
  "google-vertex": vertex,
  groq,
  huggingface,
  mistral,
  openai,
  perplexity,
  togetherai,
  xai,
};

const providerNames = new Set(Object.keys(providerMap) as (keyof typeof providerMap)[]);

function isProviderName(name: string): name is keyof typeof providerMap {
  return providerNames.has(name as keyof typeof providerMap);
}

export function parseModelSpec(modelSpec: string): {
  providerName: string;
  modelName: string;
} {
  const firstColon = modelSpec.indexOf(":");
  if (firstColon === -1) {
    throw new Error(
      `Invalid model spec: ${modelSpec}. Expected format: provider:model or host:port:model`
    );
  }
  const firstSegment = modelSpec.slice(0, firstColon);
  // Known provider: standard first-colon split
  if (isProviderName(firstSegment)) {
    const modelName = modelSpec.slice(firstColon + 1);
    if (!modelName) {
      throw new Error(
        `Invalid model spec: ${modelSpec}. Expected format: provider:model or host:port:model`
      );
    }
    return { providerName: firstSegment, modelName };
  }
  // URL-based openai-compatible: split on last colon so `http://host:port:model` works
  const lastColon = modelSpec.lastIndexOf(":");
  const modelName = modelSpec.slice(lastColon + 1);
  if (!modelName) {
    throw new Error(
      `Invalid model spec: ${modelSpec}. Expected format: provider:model or host:port:model`
    );
  }
  return { providerName: modelSpec.slice(0, lastColon), modelName };
}

function normalizeBaseUrl(providerName: string): string {
  if (providerName.startsWith("http://") || providerName.startsWith("https://")) {
    return providerName;
  }
  return `https://${providerName}`;
}

function getProvider(providerName: string) {
  if (isProviderName(providerName)) {
    return providerMap[providerName];
  }
  // Treat as openai-compatible base URL
  return createOpenAICompatible({ name: providerName, baseURL: normalizeBaseUrl(providerName) });
}

export function getLanguageModel(modelSpec: string) {
  const { providerName, modelName } = parseModelSpec(modelSpec);
  const provider = getProvider(providerName);
  if (!("languageModel" in provider)) {
    throw new Error(
      `Provider '${providerName}' does not support language models`
    );
  }
  return provider.languageModel(modelName);
}

export function getTextEmbeddingModel(modelSpec: string) {
  const { providerName, modelName } = parseModelSpec(modelSpec);
  const provider = getProvider(providerName);
  if (!("textEmbeddingModel" in provider)) {
    throw new Error(
      `Provider '${providerName}' does not support embedding models`
    );
  }
  return provider.textEmbeddingModel(modelName);
}

export const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL || "google:gemini-3-flash-preview";

/** Model used for image captioning when the primary model doesn't support vision. null = no captioning. */
export const VISION_MODEL: string | null = process.env.VISION_MODEL ?? null;

// =============================================================================
// Multimodal Capability Detection
// =============================================================================

/** Providers that support image parts in messages */
const VISION_CAPABLE_PROVIDERS = new Set([
  "anthropic",
  "google",
  "google-vertex",
  "openai",
  "azure",
  "amazon-bedrock",
  "xai",
]);

/** Providers and the document MIME types they accept as file parts */
const DOCUMENT_CAPABLE: Record<string, Set<string>> = {
  anthropic: new Set([
    "application/pdf",
    "text/plain",
    "text/html",
    "text/markdown",
    "text/csv",
  ]),
  google: new Set(["application/pdf", "text/plain"]),
  "google-vertex": new Set(["application/pdf", "text/plain"]),
};

/** Returns true if the provider supports image parts in messages */
export function supportsVision(providerName: string): boolean {
  return VISION_CAPABLE_PROVIDERS.has(providerName);
}

/**
 * Models that generate images inline as part of generateText().files.
 * These are chat/multimodal models that happen to emit image outputs alongside text.
 */
const INLINE_IMAGE_MODEL_NAMES = new Set([
  // Google (inline via generateText().files)
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-image-generation",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  // xAI grok-2-image variants appear in both chat and image model IDs — usable as language models
  "grok-2-image",
  "grok-2-image-1212",
]);

/**
 * Models that require generateImage() — they have no chat/language model API.
 * Prompt is derived from the last user message.
 */
const DEDICATED_IMAGE_MODEL_NAMES = new Set([
  // Google Imagen (via generateImage())
  "imagen-4.0-generate-001",
  "imagen-4.0-ultra-generate-001",
  "imagen-4.0-fast-generate-001",
  // Google Vertex Imagen
  "imagen-3.0-generate-001",
  "imagen-3.0-generate-002",
  "imagen-3.0-fast-generate-001",
  // xAI dedicated image generation
  "grok-imagine-image",
  "grok-imagine-image-pro",
  // OpenAI
  "dall-e-3",
  "dall-e-2",
  "gpt-image-1",
  "gpt-image-1-mini",
  "gpt-image-1.5",
  "chatgpt-image-latest",
  // Amazon Bedrock
  "amazon.nova-canvas-v1:0",
  // DeepInfra
  "stabilityai/sd3.5",
  "stabilityai/sd3.5-medium",
  "stabilityai/sdxl-turbo",
  "black-forest-labs/FLUX-1.1-pro",
  "black-forest-labs/FLUX-1-schnell",
  "black-forest-labs/FLUX-1-dev",
  "black-forest-labs/FLUX-pro",
  "black-forest-labs/FLUX.1-Kontext-dev",
  "black-forest-labs/FLUX.1-Kontext-pro",
  // Fireworks
  "accounts/fireworks/models/flux-1-dev-fp8",
  "accounts/fireworks/models/flux-1-schnell-fp8",
  "accounts/fireworks/models/flux-kontext-pro",
  "accounts/fireworks/models/flux-kontext-max",
  "accounts/fireworks/models/playground-v2-5-1024px-aesthetic",
  "accounts/fireworks/models/japanese-stable-diffusion-xl",
  "accounts/fireworks/models/playground-v2-1024px-aesthetic",
  "accounts/fireworks/models/SSD-1B",
  "accounts/fireworks/models/stable-diffusion-xl-1024-v1-0",
  // Together AI
  "stabilityai/stable-diffusion-xl-base-1.0",
  "black-forest-labs/FLUX.1-dev",
  "black-forest-labs/FLUX.1-dev-lora",
  "black-forest-labs/FLUX.1-schnell",
  "black-forest-labs/FLUX.1-canny",
  "black-forest-labs/FLUX.1-depth",
  "black-forest-labs/FLUX.1-redux",
  "black-forest-labs/FLUX.1.1-pro",
  "black-forest-labs/FLUX.1-pro",
  "black-forest-labs/FLUX.1-schnell-Free",
  "black-forest-labs/FLUX.1-kontext-pro",
  "black-forest-labs/FLUX.1-kontext-max",
  "black-forest-labs/FLUX.1-kontext-dev",
]);

const IMAGE_OUTPUT_MODEL_NAMES = new Set([...INLINE_IMAGE_MODEL_NAMES, ...DEDICATED_IMAGE_MODEL_NAMES]);

/** Returns true if the model produces image output (either inline or via generateImage()) */
export function supportsImageOutput(modelName: string): boolean {
  return IMAGE_OUTPUT_MODEL_NAMES.has(modelName);
}

/** Returns true if the model requires generateImage() rather than generateText() */
export function isDedicatedImageModel(modelName: string): boolean {
  return DEDICATED_IMAGE_MODEL_NAMES.has(modelName);
}

export function getImageModel(modelSpec: string) {
  const { providerName, modelName } = parseModelSpec(modelSpec);
  const provider = getProvider(providerName);
  const p = provider as unknown as { imageModel?: (id: string) => import("@ai-sdk/provider").ImageModelV3 };
  if (typeof p.imageModel !== "function") {
    throw new Error(`Provider '${providerName}' does not support image generation`);
  }
  return p.imageModel(modelName);
}

/** Returns true if the provider accepts this MIME type as a document/file part */
export function supportsDocumentType(providerName: string, mimeType: string): boolean {
  return DOCUMENT_CAPABLE[providerName]?.has(mimeType) ?? false;
}

// =============================================================================
// Model Allowlist
// =============================================================================

/** Parsed ALLOWED_MODELS entries (supports "provider:model" exact or "provider:*" wildcard) */
const ALLOWED_MODELS: string[] | null = process.env.ALLOWED_MODELS
  ? process.env.ALLOWED_MODELS.split(",").map(s => s.trim()).filter(s => s.length > 0)
  : null;

/**
 * Check if a model spec is allowed by the ALLOWED_MODELS allowlist.
 * Returns true if no allowlist is configured, or if the spec matches an entry.
 * Supports exact match ("google:gemini-2.0-flash") and provider wildcard ("google:*").
 */
export function isModelAllowed(modelSpec: string, allowList: string[] | null = ALLOWED_MODELS): boolean {
  if (!allowList) return true;
  const { providerName } = parseModelSpec(modelSpec);
  return allowList.some(entry => {
    if (entry === modelSpec) return true;
    if (entry.endsWith(":*")) {
      return entry.slice(0, -2) === providerName;
    }
    return false;
  });
}

// =============================================================================
// Thinking / Reasoning
// =============================================================================

import type { JSONObject } from "@ai-sdk/provider";
import type { ThinkingLevel } from "../logic/expr";

/** Map abstract thinking levels to OpenAI reasoning effort */
const OPENAI_REASONING_MAP: Record<ThinkingLevel, string> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

/** Map abstract thinking levels to Gemini 2.5 thinkingBudget (token count) */
const GEMINI_25_BUDGET_MAP: Record<ThinkingLevel, number> = {
  minimal: 0,
  low: 1024,
  medium: 8192,
  high: 24576,
};

/** Map abstract thinking levels to Anthropic thinking budget (token count) */
const ANTHROPIC_BUDGET_MAP: Record<ThinkingLevel, number> = {
  minimal: 0,
  low: 2048,
  medium: 10_000,
  high: 32_000,
};

/**
 * Build provider-specific `providerOptions` for thinking/reasoning.
 * Defaults to "minimal" for all providers. For Google this actively suppresses
 * built-in thinking; for Anthropic/OpenAI "minimal" means don't enable thinking
 * (which is already their default state).
 */
export function buildThinkingOptions(
  providerName: string,
  modelName: string,
  thinkingLevel: ThinkingLevel | null,
): Record<string, JSONObject> | undefined {
  const level = thinkingLevel ?? "minimal";

  switch (providerName) {
    case "google":
    case "google-vertex": {
      const optionKey = providerName === "google-vertex" ? "vertex" : "google";
      // Gemini 2.5 uses thinkingBudget (token count), Gemini 3+ uses thinkingLevel (string)
      const isGemini25 = modelName.startsWith("gemini-2.5");
      if (isGemini25) {
        return { [optionKey]: { thinkingConfig: { thinkingBudget: GEMINI_25_BUDGET_MAP[level] } } };
      }
      // gemini-3.1-pro doesn't support "minimal" — fall back to "low"
      const isGemini31Pro = modelName.startsWith("gemini-3.1") && modelName.includes("pro");
      const thinkingLevel = isGemini31Pro && level === "minimal" ? "low" : level;
      return { [optionKey]: { thinkingConfig: { thinkingLevel } } };
    }
    case "anthropic": {
      // Anthropic thinking is off by default; "minimal" = don't enable
      const budget = ANTHROPIC_BUDGET_MAP[level];
      if (budget === 0) return undefined;
      return {
        anthropic: {
          thinking: { type: "enabled", budgetTokens: budget },
        },
      };
    }
    case "openai": {
      // OpenAI reasoning is off by default; "minimal" maps to "low"
      if (level === "minimal") return undefined;
      return {
        openai: {
          reasoningEffort: OPENAI_REASONING_MAP[level],
        },
      };
    }
    default:
      return undefined;
  }
}

// =============================================================================
// Content Safety Filters
// =============================================================================

const GOOGLE_CATEGORY_MAP: Record<SafetyCategory, string> = {
  sexual:     "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  hate:       "HARM_CATEGORY_HATE_SPEECH",
  harassment: "HARM_CATEGORY_HARASSMENT",
  dangerous:  "HARM_CATEGORY_DANGEROUS_CONTENT",
  civic:      "HARM_CATEGORY_CIVIC_INTEGRITY",
};

const GOOGLE_THRESHOLD_MAP: Record<SafetyThreshold, string> = {
  off:    "OFF",
  none:   "BLOCK_NONE",
  low:    "BLOCK_LOW_AND_ABOVE",
  medium: "BLOCK_MEDIUM_AND_ABOVE",
  high:   "BLOCK_ONLY_HIGH",
};

/**
 * Build provider-specific options for content safety filter overrides.
 * Returns undefined if no filters or provider doesn't support safetySettings.
 * Currently only Google and Google Vertex expose safetySettings in the AI SDK.
 */
export function buildSafetyOptions(
  providerName: string,
  filters: ContentFilter[],
): Record<string, JSONObject> | undefined {
  if (filters.length === 0) return undefined;
  switch (providerName) {
    case "google":
    case "google-vertex": {
      const key = providerName === "google-vertex" ? "vertex" : "google";
      const safetySettings = filters.map(f => ({
        category:  GOOGLE_CATEGORY_MAP[f.category],
        threshold: GOOGLE_THRESHOLD_MAP[f.threshold],
      }));
      return { [key]: { safetySettings } };
    }
    default:
      return undefined;
  }
}

// =============================================================================
// Inference Error
// =============================================================================

/** Error thrown when LLM inference fails, carrying the model spec for error reporting */
export class InferenceError extends Error {
  modelSpec: string;
  constructor(message: string, modelSpec: string, cause?: unknown) {
    super(message, { cause });
    this.name = "InferenceError";
    this.modelSpec = modelSpec;
  }
}

// =============================================================================
// Model Tool Capability Detection
// =============================================================================

/** In-memory cache of models known not to support tool calls, backed by model_no_tools table */
let noToolModelsCache: Set<string> | null = null;

function loadNoToolModels(): Set<string> {
  if (noToolModelsCache !== null) return noToolModelsCache;
  const db = getDb();
  const rows = db.prepare("SELECT model_spec FROM model_no_tools").all() as { model_spec: string }[];
  noToolModelsCache = new Set(rows.map(r => r.model_spec));
  return noToolModelsCache;
}

/** Returns false if this model has been recorded as not supporting tool calls */
export function modelSupportsTools(modelSpec: string): boolean {
  return !loadNoToolModels().has(modelSpec);
}

/**
 * Record that a model doesn't support tool calls.
 * Returns true if this is the first time (triggers notification), false if already known.
 */
export function recordNoToolModel(modelSpec: string): boolean {
  const cache = loadNoToolModels();
  if (cache.has(modelSpec)) return false;
  cache.add(modelSpec);
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO model_no_tools (model_spec) VALUES (?)").run(modelSpec);
  return true;
}

/**
 * Returns true if the error indicates the model doesn't support tool/function calling.
 * Matches error messages from Google, OpenAI, Anthropic, and other providers.
 */
export function isToolsNotSupportedError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("function calling is not enabled") ||
    msg.includes("tool use is not supported") ||
    msg.includes("tools is not supported") ||
    msg.includes("tool_use is not supported") ||
    msg.includes("function_declarations is not supported") ||
    msg.includes("does not support tool") ||
    msg.includes("does not support function")
  );
}
