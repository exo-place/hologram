/**
 * Dynamic model list fetching with in-memory caching.
 * Three formats: oai-compatible, anthropic-compatible, google-ai-studio.
 * Assumes provider APIs return models oldest-first → reverse for newest-first.
 */

import { debug, warn } from "../logger";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

let cachedModels: string[] | null = null;
let cacheTime = 0;

type ProviderFormat = "oai" | "anthropic" | "google";

interface ProviderDef {
  name: string;
  envVar: string;
  baseUrl: string;
  format: ProviderFormat;
}

const PROVIDERS: ProviderDef[] = [
  { name: "google",      envVar: "GOOGLE_GENERATIVE_AI_API_KEY", baseUrl: "https://generativelanguage.googleapis.com/v1beta", format: "google"    },
  { name: "anthropic",   envVar: "ANTHROPIC_API_KEY",             baseUrl: "https://api.anthropic.com/v1",                   format: "anthropic" },
  { name: "openai",      envVar: "OPENAI_API_KEY",                baseUrl: "https://api.openai.com/v1",                      format: "oai"       },
  { name: "groq",        envVar: "GROQ_API_KEY",                  baseUrl: "https://api.groq.com/openai/v1",                 format: "oai"       },
  { name: "mistral",     envVar: "MISTRAL_API_KEY",               baseUrl: "https://api.mistral.ai/v1",                      format: "oai"       },
  { name: "xai",         envVar: "XAI_API_KEY",                   baseUrl: "https://api.x.ai/v1",                            format: "oai"       },
  { name: "deepseek",    envVar: "DEEPSEEK_API_KEY",              baseUrl: "https://api.deepseek.com/v1",                    format: "oai"       },
  { name: "cerebras",    envVar: "CEREBRAS_API_KEY",              baseUrl: "https://api.cerebras.ai/v1",                     format: "oai"       },
  { name: "perplexity",  envVar: "PERPLEXITY_API_KEY",            baseUrl: "https://api.perplexity.ai",                      format: "oai"       },
  { name: "togetherai",  envVar: "TOGETHER_AI_API_KEY",           baseUrl: "https://api.together.xyz/v1",                    format: "oai"       },
  { name: "fireworks",   envVar: "FIREWORKS_API_KEY",             baseUrl: "https://api.fireworks.ai/inference/v1",          format: "oai"       },
  { name: "deepinfra",   envVar: "DEEPINFRA_API_KEY",             baseUrl: "https://api.deepinfra.com/v1/openai",            format: "oai"       },
  { name: "huggingface", envVar: "HUGGINGFACE_API_KEY",           baseUrl: "https://router.huggingface.co/v1",               format: "oai"       },
  { name: "cohere",      envVar: "COHERE_API_KEY",                baseUrl: "https://api.cohere.com/v2",                      format: "oai"       },
];

// Patterns for non-chat models to exclude
const EXCLUDE = [
  /embed/i, /whisper/i, /\btts\b/i, /dall-e/i, /moderat/i,
  /babbage/i, /curie/i, /^ada-/i, /davinci-002/i,
  /^text-/i, /search/i, /similarity/i, /-edit-/i, /rerank/i,
];

function isChat(id: string): boolean {
  return !EXCLUDE.some(p => p.test(id));
}

async function fetchOne(provider: ProviderDef, apiKey: string): Promise<string[]> {
  try {
    const url = provider.format === "google"
      ? `${provider.baseUrl}/models?key=${apiKey}&pageSize=100`
      : `${provider.baseUrl}/models`;

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (provider.format === "anthropic") {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    } else if (provider.format === "oai") {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      debug("Model list fetch failed", { provider: provider.name, status: res.status });
      return [];
    }

    const data = await res.json() as Record<string, unknown>;

    if (provider.format === "google") {
      const models = (data.models ?? []) as Array<{ name?: string; supportedGenerationMethods?: string[] }>;
      return models
        .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
        .map(m => (m.name ?? "").replace("models/", ""))
        .filter(Boolean)
        .reverse();
    }

    // OAI and Anthropic: { data: [...] } or { models: [...] } (Cohere v2)
    const items = (data.data ?? data.models ?? []) as Array<{ id?: string; name?: string }>;
    return items
      .map(m => (m.id ?? m.name ?? ""))
      .filter(id => id && isChat(id))
      .reverse();
  } catch (err) {
    warn("Model list fetch error", { provider: provider.name, err });
    return [];
  }
}

/**
 * Fetch and cache the list of available chat models across all configured providers.
 * Returns "provider:model" strings, newest-first per provider, interleaved across providers.
 */
export async function getAvailableModels(): Promise<string[]> {
  if (cachedModels && Date.now() - cacheTime < CACHE_TTL_MS) return cachedModels;

  const configured = PROVIDERS.filter(p => !!process.env[p.envVar]);
  const results = await Promise.all(
    configured.map(async p => {
      const models = await fetchOne(p, process.env[p.envVar]!);
      return models.map(m => `${p.name}:${m}`);
    }),
  );

  // Round-robin interleave so each provider gets fair representation near the top
  const lists = results.filter(r => r.length > 0);
  const interleaved: string[] = [];
  const max = Math.max(0, ...lists.map(l => l.length));
  for (let i = 0; i < max; i++) {
    for (const list of lists) {
      if (i < list.length) interleaved.push(list[i]);
    }
  }

  cachedModels = [...new Set(interleaved)];
  cacheTime = Date.now();
  debug("Model list cached", { count: cachedModels.length, providers: configured.map(p => p.name) });
  return cachedModels;
}

export function invalidateModelCache(): void {
  cachedModels = null;
  cacheTime = 0;
}
