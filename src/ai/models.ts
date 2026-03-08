import type { ContentFilter, SafetyCategory, SafetyThreshold } from "../logic/expr";
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
  const matches = modelSpec.match(/^([^:]+):(.+)$/);
  if (!matches) {
    throw new Error(
      `Invalid model spec: ${modelSpec}. Expected format: provider:model`
    );
  }
  const [, providerName, modelName] = matches;
  return { providerName, modelName };
}

function getProvider(providerName: string) {
  if (!isProviderName(providerName)) {
    throw new Error(`Unknown provider: ${providerName}`);
  }
  return providerMap[providerName];
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

/** Model names known to support inline image output via generateText().files */
const IMAGE_OUTPUT_MODEL_NAMES = new Set([
  "gemini-2.5-flash-image",
  "gemini-2.0-flash-image-generation",
]);

/** Returns true if the model is known to support inline image generation output */
export function supportsImageOutput(modelName: string): boolean {
  return IMAGE_OUTPUT_MODEL_NAMES.has(modelName);
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
      const thinkingConfig = isGemini25
        ? { thinkingBudget: GEMINI_25_BUDGET_MAP[level] }
        : { thinkingLevel: level };
      return { [optionKey]: { thinkingConfig } };
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
