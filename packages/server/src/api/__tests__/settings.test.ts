import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { settingsRoutes } from "../settings.js";
import { LlmClient } from "../../llm/client.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";

describe("Settings API routes", () => {
  let app: Hono;
  let db: Database.Database;
  let llm: LlmClient;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/settings", settingsRoutes(db, llm));
  });

  it("GET / returns empty settings initially", async () => {
    const res = await app.request("/settings");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Object.keys(data)).toHaveLength(0);
  });

  it("PUT / saves settings and GET / returns them", async () => {
    const putRes = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { provider: "openai", model: "gpt-4o", apiKey: "key" } }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/settings");
    const data = await getRes.json() as any;
    expect(data.llm.provider).toBe("openai");
  });

  it("PUT / with llm key configures LlmClient", async () => {
    expect(llm.isConfigured()).toBe(false);
    await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { provider: "openai", model: "gpt-4o", apiKey: "key" } }),
    });
    expect(llm.isConfigured()).toBe(true);
  });
});

describe("Settings API — OAuth token preservation", () => {
  let app: Hono;
  let db: Database.Database;
  let llm: LlmClient;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/settings", settingsRoutes(db, llm));
  });

  it("PUT / preserves openaiOAuth when not in request body", async () => {
    // Pre-seed DB with config containing openaiOAuth
    const existing = {
      provider: "openai",
      model: "gpt-5.1-codex",
      openaiOAuth: { accessToken: "tok_abc", refreshToken: "ref_xyz", expiresAt: Date.now() + 3600_000 },
    };
    db.prepare("INSERT INTO settings (key, value) VALUES ('llm', ?)").run(JSON.stringify(existing));

    // PUT without openaiOAuth — should be preserved since provider is still openai
    const putRes = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { provider: "openai", model: "gpt-5.2-codex" } }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/settings");
    const data = await getRes.json() as any;
    expect(data.llm.provider).toBe("openai");
    expect(data.llm.model).toBe("gpt-5.2-codex");
    expect(data.llm.openaiOAuth).toBeDefined();
    expect(data.llm.openaiOAuth.accessToken).toBe("tok_abc");
    expect(data.llm.openaiOAuth.refreshToken).toBe("ref_xyz");
  });

  it("PUT / allows explicit openaiOAuth update", async () => {
    const newOAuth = { accessToken: "tok_new", refreshToken: "ref_new", expiresAt: Date.now() + 7200_000 };
    const putRes = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { provider: "openai", model: "gpt-5.1-codex", openaiOAuth: newOAuth } }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/settings");
    const data = await getRes.json() as any;
    expect(data.llm.openaiOAuth.accessToken).toBe("tok_new");
    expect(data.llm.openaiOAuth.refreshToken).toBe("ref_new");
  });

  it("PUT / does not preserve OAuth when switching away from openai", async () => {
    // Pre-seed with openai + OAuth
    const existing = {
      provider: "openai",
      model: "gpt-5.1-codex",
      openaiOAuth: { accessToken: "tok_abc", refreshToken: "ref_xyz", expiresAt: Date.now() + 3600_000 },
    };
    db.prepare("INSERT INTO settings (key, value) VALUES ('llm', ?)").run(JSON.stringify(existing));

    // Switch to anthropic without openaiOAuth — should NOT preserve it
    const putRes = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { provider: "anthropic", model: "claude-opus-4-6", apiKey: "sk-ant-xxx" } }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/settings");
    const data = await getRes.json() as any;
    expect(data.llm.provider).toBe("anthropic");
    expect(data.llm.openaiOAuth).toBeUndefined();
  });

  it("PUT / normal save without existing config works", async () => {
    // No prior config in DB — fresh save
    const putRes = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ llm: { provider: "openai", model: "gpt-4o", apiKey: "sk-test" } }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/settings");
    const data = await getRes.json() as any;
    expect(data.llm.provider).toBe("openai");
    expect(data.llm.model).toBe("gpt-4o");
    expect(data.llm.apiKey).toBe("sk-test");
  });

  it("PUT / non-llm keys unaffected", async () => {
    const putRes = await app.request("/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: "dark" }),
    });
    expect(putRes.status).toBe(200);

    const getRes = await app.request("/settings");
    const data = await getRes.json() as any;
    expect(data.theme).toBe("dark");
  });
});

describe("Settings API — models endpoint", () => {
  let app: Hono;
  let db: Database.Database;
  let llm: LlmClient;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/settings", settingsRoutes(db, llm));
  });

  it("GET /models returns modelsByProvider with presets even when not configured", async () => {
    const res = await app.request("/settings/models");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.modelsByProvider).toBeDefined();
    expect(data.modelsByProvider.openai).toContain("gpt-5.3-codex");
    expect(data.modelsByProvider.anthropic).toContain("claude-opus-4-6");
  });

  it("GET /models returns openai presets including older models", async () => {
    llm.configure({ provider: "openai", model: "gpt-5.1-codex", apiKey: "" });

    const res = await app.request("/settings/models");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.modelsByProvider.openai.length).toBeGreaterThan(0);
    expect(data.modelsByProvider.openai).toContain("gpt-5.3-codex");
    expect(data.modelsByProvider.openai).toContain("gpt-4");
  });

  it("GET /models returns openai presets for OAuth user", async () => {
    llm.configure({
      provider: "openai",
      model: "gpt-5.1-codex",
      openaiOAuth: { accessToken: "tok_test", refreshToken: "ref_test", expiresAt: Date.now() + 3600_000 },
    });

    const res = await app.request("/settings/models");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.modelsByProvider.openai).toContain("gpt-5.1-codex");
  });

  it("GET /models returns anthropic presets", async () => {
    llm.configure({ provider: "anthropic", model: "claude-opus-4-6", apiKey: "" });

    const res = await app.request("/settings/models");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.modelsByProvider.anthropic.length).toBeGreaterThan(0);
    expect(data.modelsByProvider.anthropic).toContain("claude-opus-4-6");
  });
});

describe("Settings API — OAuth endpoints", () => {
  // These test the route wiring, not the actual OAuth flow
  // The OAuth functions are in openai-oauth.ts and tested separately
  let app: Hono;
  let db: Database.Database;
  let llm: LlmClient;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    db.exec(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, instance_id TEXT, type TEXT NOT NULL,
      status TEXT DEFAULT 'running', output TEXT DEFAULT '', operator TEXT,
      started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
    )`);
    llm = new LlmClient();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/settings", settingsRoutes(db, llm));
  });

  it("GET /oauth/openai/status returns none initially", async () => {
    const res = await app.request("/settings/oauth/openai/status");
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe("none");
  });
});
