/**
 * LiteLLM model pricing fetcher.
 * Same data source as ccusage — fetched from GitHub, cached in memory.
 */

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

const CACHE_TTL = 3_600_000; // 1 hour

export interface ModelPricing {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_creation_input_token_cost?: number;
  cache_read_input_token_cost?: number;
  max_tokens?: number;
  max_input_tokens?: number;
  max_output_tokens?: number;
}

let cache: { data: Record<string, ModelPricing>; time: number } | null = null;

export async function fetchPricing(): Promise<Record<string, ModelPricing>> {
  if (cache && Date.now() - cache.time < CACHE_TTL) return cache.data;
  const res = await fetch(LITELLM_URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    if (cache) return cache.data; // stale cache is better than nothing
    throw new Error(`Failed to fetch pricing: ${res.status}`);
  }
  const data = (await res.json()) as Record<string, any>;
  // Extract only the fields we care about to save memory
  const slim: Record<string, ModelPricing> = {};
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === "object") {
      slim[key] = {
        input_cost_per_token: val.input_cost_per_token,
        output_cost_per_token: val.output_cost_per_token,
        cache_creation_input_token_cost: val.cache_creation_input_token_cost,
        cache_read_input_token_cost: val.cache_read_input_token_cost,
        max_tokens: val.max_tokens,
        max_input_tokens: val.max_input_tokens,
        max_output_tokens: val.max_output_tokens,
      };
    }
  }
  cache = { data: slim, time: Date.now() };
  return slim;
}

/** Try to find pricing for a model using various name patterns */
export function lookupModelPrice(
  pricing: Record<string, ModelPricing>,
  model: string,
): ModelPricing | null {
  if (!model) return null;

  // 1. Exact match
  if (pricing[model]) return pricing[model];

  // 2. Normalize: OpenClaw uses "provider/model", LiteLLM uses "provider/model" too
  //    but sometimes with different provider prefixes
  const parts = model.split("/");
  const providerPart = parts[0];
  const modelName = parts.slice(1).join("/") || model;

  // 3. Try model name alone
  if (pricing[modelName]) return pricing[modelName];

  // 4. Map OpenClaw provider prefixes to LiteLLM prefixes
  const providerMap: Record<string, string[]> = {
    "openai-codex": ["openai/", ""],
    openai: ["openai/", ""],
    anthropic: ["anthropic/", "claude-", ""],
    google: ["gemini/", "google/", ""],
    deepseek: ["deepseek/", ""],
    moonshot: ["moonshot/", ""],
    qwen: ["qwen/", ""],
    zhipu: ["zhipu/", ""],
  };

  const prefixes = providerMap[providerPart] || [`${providerPart}/`, ""];
  for (const prefix of prefixes) {
    const key = prefix + modelName;
    if (pricing[key]) return pricing[key];
  }

  // 5. Case-insensitive substring match (last resort, limited to avoid false matches)
  const lower = model.toLowerCase();
  for (const [key, val] of Object.entries(pricing)) {
    if (key.toLowerCase() === lower) return val;
  }

  return null;
}

/** Estimate cost in USD from token counts */
export function estimateCost(
  pricing: Record<string, ModelPricing>,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheRead = 0,
  cacheWrite = 0,
): number | null {
  const p = lookupModelPrice(pricing, model);
  if (!p?.input_cost_per_token || !p?.output_cost_per_token) return null;
  const cacheReadCost = p.cache_read_input_token_cost ?? p.input_cost_per_token;
  const cacheCreationCost = p.cache_creation_input_token_cost ?? p.input_cost_per_token;
  return inputTokens * p.input_cost_per_token
    + outputTokens * p.output_cost_per_token
    + cacheWrite * cacheCreationCost
    + cacheRead * cacheReadCost;
}
