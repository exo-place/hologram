import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { google, createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai, createOpenAI } from "@ai-sdk/openai";

/** Default providers (use env vars) */
const providerMap = {
  anthropic,
  google,
  openai,
};

/** Factory functions for creating providers with custom API keys */
function createProviderWithKey(providerName: string, apiKey: string) {
  switch (providerName) {
    case "google":
      return createGoogleGenerativeAI({ apiKey });
    case "anthropic":
      return createAnthropic({ apiKey });
    case "openai":
      return createOpenAI({ apiKey });
    default:
      throw new Error(`No factory available for provider: ${providerName}`);
  }
}

type ProviderName = keyof typeof providerMap;

const providerNames = new Set(Object.keys(providerMap)) as Set<ProviderName>;

function isProviderName(name: string): name is ProviderName {
  return providerNames.has(name as ProviderName);
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
    throw new Error(
      `Unknown provider: ${providerName}. Available: ${[...providerNames].join(", ")}`
    );
  }
  return providerMap[providerName];
}

export function getLanguageModel(modelSpec: string, apiKey?: string) {
  const { providerName, modelName } = parseModelSpec(modelSpec);

  // If custom API key provided, create a new provider instance
  if (apiKey) {
    const provider = createProviderWithKey(providerName, apiKey);
    return provider.languageModel(modelName);
  }

  // Fall back to default provider (uses env vars)
  const provider = getProvider(providerName);
  if (!("languageModel" in provider)) {
    throw new Error(
      `Provider '${providerName}' does not support language models`
    );
  }
  return provider.languageModel(modelName);
}

export function getTextEmbeddingModel(modelSpec: string, apiKey?: string) {
  const { providerName, modelName } = parseModelSpec(modelSpec);

  // If custom API key provided, create a new provider instance
  if (apiKey) {
    const provider = createProviderWithKey(providerName, apiKey);
    if (!("textEmbeddingModel" in provider)) {
      throw new Error(
        `Provider '${providerName}' does not support embedding models`
      );
    }
    return provider.textEmbeddingModel(modelName);
  }

  // Fall back to default provider (uses env vars)
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
export function isModelAllowed(modelSpec: string): boolean {
  if (!ALLOWED_MODELS) return true;
  const { providerName } = parseModelSpec(modelSpec);
  return ALLOWED_MODELS.some(entry => {
    if (entry === modelSpec) return true;
    if (entry.endsWith(":*")) {
      return entry.slice(0, -2) === providerName;
    }
    return false;
  });
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
