import { Hono } from "hono";
import type Database from "better-sqlite3";
import type { LlmClient } from "../llm/client.js";
import type { LlmConfig } from "../llm/types.js";
import { requireRole } from "../auth/middleware.js";
import { auditLog } from "../audit.js";
import { startOpenAIOAuth, getOAuthStatus, submitManualCode, clearOAuthFlow } from "../llm/openai-oauth.js";

export function settingsRoutes(db: Database.Database, llm: LlmClient) {
  const app = new Hono();

  // Wire up OAuth token refresh persistence
  llm.onOAuthRefresh = (oauth) => {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'llm'").get() as { value: string } | undefined;
    if (!row) return;
    try {
      const config = JSON.parse(row.value) as LlmConfig;
      config.openaiOAuth = oauth;
      db.prepare("INSERT INTO settings (key, value) VALUES ('llm', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(config));
    } catch { /* ignore */ }
  };

  app.get("/", (c) => {
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); } catch { settings[row.key] = row.value; }
    }
    return c.json(settings);
  });

  app.put("/", requireRole("admin"), async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const upsert = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");

    // For LLM config, merge with existing to preserve OAuth tokens
    if (body.llm && typeof body.llm === "object") {
      const existingRow = db.prepare("SELECT value FROM settings WHERE key = 'llm'").get() as { value: string } | undefined;
      if (existingRow) {
        try {
          const existing = JSON.parse(existingRow.value) as LlmConfig;
          const incoming = body.llm as Record<string, unknown>;
          // Preserve openaiOAuth if not explicitly provided and provider is still openai
          if (existing.openaiOAuth && !incoming.openaiOAuth && incoming.provider === "openai") {
            incoming.openaiOAuth = existing.openaiOAuth;
          }
          body.llm = incoming;
        } catch { /* ignore parse errors */ }
      }
    }

    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        upsert.run(key, JSON.stringify(value));
      }
    });
    tx();

    // Reconfigure LLM if settings changed
    if (body.llm) {
      llm.configure(body.llm as LlmConfig);
    }

    auditLog(db, c, "settings.update", `Updated settings: ${Object.keys(body).join(", ")}`);
    return c.json({ ok: true });
  });

  // --- Model lists (static presets + cached API results) ---

  const PRESET_MODELS: Record<string, string[]> = {
    openai: [
      "gpt-5.3-codex", "gpt-5.3-codex-spark",
      "gpt-5.2", "gpt-5.2-chat-latest", "gpt-5.2-codex", "gpt-5.2-pro",
      "gpt-5.1", "gpt-5.1-chat-latest", "gpt-5.1-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini",
      "gpt-5", "gpt-5-chat-latest", "gpt-5-codex", "gpt-5-pro", "gpt-5-mini", "gpt-5-nano",
      "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
      "gpt-4o", "gpt-4o-mini",
      "gpt-4", "gpt-4-turbo",
      "codex-mini-latest",
      "o4-mini", "o3", "o3-pro", "o3-mini", "o1", "o1-pro",
    ],
    anthropic: [
      "claude-opus-4-6", "claude-sonnet-4-6",
      "claude-opus-4-5", "claude-sonnet-4-5",
      "claude-opus-4-1",
      "claude-opus-4-0", "claude-sonnet-4-0",
      "claude-haiku-4-5",
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-20241022", "claude-3-5-haiku-latest",
      "claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307",
    ],
    azure: [
      "gpt-5.3-codex", "gpt-5.1-codex", "gpt-4o", "gpt-4o-mini", "gpt-4",
    ],
    ollama: [
      "llama3", "llama3.1", "codellama", "mistral", "mixtral", "deepseek-coder",
    ],
  };

  // Cache: { provider -> { models, fetchedAt } }
  const modelCache = new Map<string, { models: string[]; fetchedAt: number }>();
  const MODEL_CACHE_TTL = 600_000; // 10 minutes

  /** Fetch models from provider API, merge with presets, cache result */
  async function fetchProviderModels(provider: string, config: LlmConfig): Promise<string[]> {
    const cached = modelCache.get(provider);
    if (cached && Date.now() - cached.fetchedAt < MODEL_CACHE_TTL) return cached.models;

    const presets = PRESET_MODELS[provider] || [];
    let fetched: string[] = [];

    try {
      if (provider === "openai" || provider === "azure") {
        const apiKey = config.apiKey || "";
        if (apiKey && !config.openaiOAuth?.accessToken) {
          const { default: OpenAI } = await import("openai");
          const baseURL = provider === "azure" && config.azure
            ? `https://${config.azure.resourceName}.openai.azure.com/openai`
            : config.baseUrl;
          const client = new OpenAI({ apiKey, baseURL: baseURL || undefined });
          const list = await client.models.list();
          for await (const m of list) { fetched.push(m.id); }
        }
      } else if (provider === "anthropic") {
        const apiKey = config.apiKey || "";
        if (apiKey) {
          const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
            headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
          });
          if (res.ok) {
            const data = await res.json() as { data?: Array<{ id: string }> };
            fetched = (data.data || []).map((m) => m.id);
          }
        }
      }
    } catch { /* use presets only */ }

    // Merge: fetched first (API-confirmed), then presets not already in fetched
    const seen = new Set(fetched);
    const merged = [...fetched];
    for (const m of presets) {
      if (!seen.has(m)) merged.push(m);
    }

    modelCache.set(provider, { models: merged, fetchedAt: Date.now() });
    return merged;
  }

  // Background refresh on startup and every 10 minutes
  const refreshAllModels = async () => {
    const config = llm.getConfig();
    if (!config) return;
    // Refresh current provider
    await fetchProviderModels(config.provider, config).catch(() => {});
  };
  setTimeout(refreshAllModels, 5_000); // 5s after startup
  setInterval(refreshAllModels, MODEL_CACHE_TTL);

  app.get("/models", async (c) => {
    const config = llm.getConfig();

    // Build modelsByProvider: always include presets, merge with cached/fetched for configured provider
    const result: Record<string, string[]> = {};
    for (const [p, presets] of Object.entries(PRESET_MODELS)) {
      result[p] = presets;
    }

    // For the currently configured provider, try to get richer list
    if (config) {
      try {
        result[config.provider] = await fetchProviderModels(config.provider, config);
      } catch { /* keep presets */ }
    }

    return c.json({ modelsByProvider: result });
  });

  // --- OpenAI OAuth flow ---

  app.post("/oauth/openai/start", requireRole("admin"), async (c) => {
    try {
      const { authUrl } = await startOpenAIOAuth();
      return c.json({ authUrl });
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
    }
  });

  app.get("/oauth/openai/status", requireRole("admin"), (c) => {
    const status = getOAuthStatus();
    return c.json(status);
  });

  app.post("/oauth/openai/callback", requireRole("admin"), async (c) => {
    const { redirectUrl } = await c.req.json<{ redirectUrl: string }>();
    if (!redirectUrl) return c.json({ error: "redirectUrl required" }, 400);
    const ok = submitManualCode(redirectUrl);
    return ok ? c.json({ ok: true }) : c.json({ error: "No pending OAuth flow" }, 400);
  });

  app.post("/oauth/openai/save", requireRole("admin"), async (c) => {
    const status = getOAuthStatus();
    if (status.status !== "complete" || !status.credentials) {
      return c.json({ error: "No completed OAuth credentials" }, 400);
    }
    // Load current LLM config and add OAuth credentials
    const row = db.prepare("SELECT value FROM settings WHERE key = 'llm'").get() as { value: string } | undefined;
    const config: LlmConfig = row ? JSON.parse(row.value) : { provider: "openai", model: "gpt-5.1-codex" };
    config.provider = "openai";
    config.openaiOAuth = {
      accessToken: status.credentials.accessToken,
      refreshToken: status.credentials.refreshToken,
      expiresAt: status.credentials.expiresAt,
    };
    // Clear API key — OAuth replaces it
    delete config.apiKey;

    db.prepare("INSERT INTO settings (key, value) VALUES ('llm', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(config));
    llm.configure(config);
    clearOAuthFlow();
    auditLog(db, c, "settings.oauth", "OpenAI OAuth configured via ChatGPT login");
    return c.json({ ok: true });
  });

  return app;
}
