import { describe, it, expect, beforeEach, vi } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";

// --- Mock executor factory ---
vi.mock("../../executor/factory.js", () => ({
  getExecutor: vi.fn(),
  getHostExecutor: vi.fn(),
}));

// --- Mock lifecycle modules ---
vi.mock("../../lifecycle/service.js", () => ({
  getProcessStatus: vi.fn(),
  stopProcess: vi.fn(),
  startProcess: vi.fn(),
  restartProcess: vi.fn(),
}));

vi.mock("../../lifecycle/install.js", () => ({
  checkNodeVersion: vi.fn(),
  getVersions: vi.fn(),
  streamInstall: vi.fn(),
  streamUninstall: vi.fn(),
  streamChannelCreate: vi.fn(),
}));

vi.mock("../../lifecycle/agent-config.js", () => ({
  extractModels: vi.fn(),
  mergeAgentConfig: vi.fn(),
  removeAgent: vi.fn(),
}));

vi.mock("../../lifecycle/channel-config.js", () => ({
  mergeChannelAccountConfig: vi.fn(),
  deleteChannelConfig: vi.fn(),
}));

vi.mock("../../lifecycle/config.js", () => ({
  readRemoteConfig: vi.fn(),
  writeRemoteConfig: vi.fn(),
  readAuthProfiles: vi.fn(),
  writeAuthProfiles: vi.fn(),
  deleteAuthProfile: vi.fn(),
  getConfigDir: vi.fn((profile: string) =>
    profile === "default" ? "$HOME/.openclaw" : `$HOME/.openclaw-${profile}`
  ),
  profileFromInstanceId: vi.fn((id: string) => {
    const parts = id.split("-");
    return parts[parts.length - 1];
  }),
}));

vi.mock("../../lifecycle/verify.js", () => ({
  verifyProviderKey: vi.fn(),
  maskKey: vi.fn((key: string) => {
    if (key.length <= 8) return "***" + key.slice(-2);
    return key.slice(0, 4) + "..." + key.slice(-4);
  }),
}));

vi.mock("../../llm/openai-oauth.js", () => ({
  getOAuthStatus: vi.fn(() => ({ status: "idle" })),
  clearOAuthFlow: vi.fn(),
}));

vi.mock("../../pricing/litellm.js", () => ({
  fetchPricing: vi.fn(),
  estimateCost: vi.fn(),
}));

vi.mock("../../pricing/codex-quota.js", () => ({
  fetchCodexQuota: vi.fn(),
  getApiKeyFetcher: vi.fn(),
}));

import { lifecycleRoutes } from "../lifecycle.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";
import { getExecutor } from "../../executor/factory.js";
import { readRemoteConfig, readAuthProfiles, deleteAuthProfile } from "../../lifecycle/config.js";
import { verifyProviderKey, maskKey } from "../../lifecycle/verify.js";

describe("Lifecycle API - Key Management", () => {
  let app: Hono;
  let manager: MockInstanceManager;
  let db: Database.Database;
  let mockExecutor: { exec: ReturnType<typeof vi.fn>; execStream: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT, type TEXT NOT NULL, status TEXT DEFAULT 'running',
        output TEXT DEFAULT '', operator TEXT,
        started_at TEXT DEFAULT (datetime('now')), finished_at TEXT
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS config_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        config_json TEXT NOT NULL,
        reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS provider_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        key_masked TEXT,
        status TEXT DEFAULT 'unknown',
        checked_at TEXT,
        error_message TEXT,
        email TEXT,
        account_info TEXT,
        UNIQUE(instance_id, profile_id)
      )
    `);

    manager = new MockInstanceManager();
    manager.seed([
      makeInstanceInfo({
        id: "ssh-1-main",
        connection: { id: "ssh-1-main", url: "ws://10.0.0.1:18789", status: "connected", label: "Main" },
      }),
    ]);

    mockExecutor = {
      exec: vi.fn(),
      execStream: vi.fn(),
    };
    vi.mocked(getExecutor).mockReturnValue(mockExecutor as any);

    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/lifecycle", lifecycleRoutes({} as any, manager as any, db));
  });

  // ---- GET /:id/keys ----

  describe("GET /:id/keys", () => {
    it("returns keys from auth-profiles with cached status", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({
        agents: { list: [{ id: "main" }] },
        models: { providers: { openai: { baseUrl: "https://api.openai.com/v1" } } },
      });
      vi.mocked(readAuthProfiles).mockResolvedValue({
        version: 1,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "sk-test1234",
          },
        },
      });
      vi.mocked(maskKey).mockReturnValue("sk-t...234");

      // Seed cache with a verified status
      db.prepare(`
        INSERT INTO provider_keys (instance_id, profile_id, provider, key_masked, status, checked_at, email)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("ssh-1-main", "openai:default", "openai", "sk-t...234", "valid", "2026-03-11T00:00:00", "kris@example.com");

      const res = await app.request("/lifecycle/ssh-1-main/keys");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.keys).toHaveLength(1);
      expect(data.keys[0].profileId).toBe("openai:default");
      expect(data.keys[0].provider).toBe("openai");
      expect(data.keys[0].type).toBe("api_key");
      expect(data.keys[0].keyMasked).toBe("sk-t...234");
      expect(data.keys[0].status).toBe("valid");
      expect(data.keys[0].email).toBe("kris@example.com");
    });

    it("returns unknown status when no cache entry", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({
        agents: { list: [{ id: "main" }] },
      });
      vi.mocked(readAuthProfiles).mockResolvedValue({
        version: 1,
        profiles: {
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-ant-abcd1234",
          },
        },
      });
      vi.mocked(maskKey).mockReturnValue("sk-a...234");

      const res = await app.request("/lifecycle/ssh-1-main/keys");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.keys).toHaveLength(1);
      expect(data.keys[0].status).toBe("unknown");
      expect(data.keys[0].checkedAt).toBeNull();
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/lifecycle/nonexistent/keys");
      expect(res.status).toBe(404);
      const data = await res.json() as any;
      expect(data.error).toBe("instance not found");
    });
  });

  // ---- DELETE /:id/keys/:profileId ----

  describe("DELETE /:id/keys/:profileId", () => {
    it("deletes key from auth-profiles and cache", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({
        agents: { list: [{ id: "main" }] },
      });
      vi.mocked(readAuthProfiles).mockResolvedValue({
        version: 1,
        profiles: {
          "openai:default": { type: "api_key", provider: "openai", key: "sk-test1234" },
        },
      });
      vi.mocked(deleteAuthProfile).mockResolvedValue(undefined);

      // Seed cache entry
      db.prepare(`
        INSERT INTO provider_keys (instance_id, profile_id, provider, key_masked, status)
        VALUES (?, ?, ?, ?, ?)
      `).run("ssh-1-main", "openai:default", "openai", "sk-t...234", "valid");

      const res = await app.request("/lifecycle/ssh-1-main/keys/openai%3Adefault", { method: "DELETE" });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);

      // Verify deleteAuthProfile was called
      expect(deleteAuthProfile).toHaveBeenCalledWith(
        mockExecutor,
        "$HOME/.openclaw-main",
        "main",
        "openai:default",
      );

      // Verify cache row was removed
      const cached = db.prepare(
        "SELECT * FROM provider_keys WHERE instance_id = ? AND profile_id = ?"
      ).get("ssh-1-main", "openai:default");
      expect(cached).toBeUndefined();
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/lifecycle/nonexistent/keys/openai%3Adefault", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  // ---- POST /:id/keys/:profileId/verify ----

  describe("POST /:id/keys/:profileId/verify", () => {
    it("re-verifies a key and updates cache", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({
        agents: { list: [{ id: "main" }] },
        models: { providers: { openai: { baseUrl: "https://api.openai.com/v1" } } },
      });
      vi.mocked(readAuthProfiles).mockResolvedValue({
        version: 1,
        profiles: {
          "openai:default": { type: "api_key", provider: "openai", key: "sk-test1234" },
        },
      });
      vi.mocked(verifyProviderKey).mockResolvedValue({
        status: "valid",
        email: "kris@example.com",
      });
      vi.mocked(maskKey).mockReturnValue("sk-t...234");

      const res = await app.request("/lifecycle/ssh-1-main/keys/openai%3Adefault/verify", {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.profileId).toBe("openai:default");
      expect(data.status).toBe("valid");
      expect(data.email).toBe("kris@example.com");

      // Verify cache was updated
      const cached = db.prepare(
        "SELECT * FROM provider_keys WHERE instance_id = ? AND profile_id = ?"
      ).get("ssh-1-main", "openai:default") as any;
      expect(cached).toBeDefined();
      expect(cached.status).toBe("valid");
      expect(cached.email).toBe("kris@example.com");

      // Verify verifyProviderKey was called with correct args
      expect(verifyProviderKey).toHaveBeenCalledWith(
        mockExecutor,
        "openai",
        "sk-test1234",
        "https://api.openai.com/v1",
      );
    });

    it("returns 404 when profile not found in auth-profiles", async () => {
      vi.mocked(readRemoteConfig).mockResolvedValue({
        agents: { list: [{ id: "main" }] },
      });
      vi.mocked(readAuthProfiles).mockResolvedValue({
        version: 1,
        profiles: {},
      });

      const res = await app.request("/lifecycle/ssh-1-main/keys/openai%3Adefault/verify", {
        method: "POST",
      });
      expect(res.status).toBe(404);
      const data = await res.json() as any;
      expect(data.error).toBe("Profile not found");
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/lifecycle/nonexistent/keys/openai%3Adefault/verify", {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });

  describe("PUT /:id/providers — key append", () => {
    it("appends key2 when default already exists with different key", async () => {
      vi.mocked(readAuthProfiles).mockResolvedValue({
        version: 1,
        profiles: {
          "openai:default": { type: "api_key", provider: "openai", key: "sk-existing" },
        },
      });
      vi.mocked(readRemoteConfig).mockResolvedValue({
        agents: { list: [{ id: "main" }] },
        models: { providers: {} },
      });
      vi.mocked(verifyProviderKey).mockResolvedValue({ status: "valid" });
      const { writeAuthProfiles } = await import("../../lifecycle/config.js");

      const res = await app.request("/lifecycle/ssh-1-main/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: { openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-newkey1234", models: [] } },
        }),
      });
      expect(res.status).toBe(200);

      const writeCalls = vi.mocked(writeAuthProfiles).mock.calls;
      expect(writeCalls.length).toBeGreaterThan(0);
      const lastData = writeCalls[writeCalls.length - 1][3];
      expect(lastData.profiles["openai:default"]).toBeDefined();
      expect(lastData.profiles["openai:key2"]).toBeDefined();
    });

    it("rejects duplicate key", async () => {
      vi.mocked(readAuthProfiles).mockResolvedValue({
        version: 1,
        profiles: {
          "openai:default": { type: "api_key", provider: "openai", key: "sk-samekey1234" },
        },
      });
      vi.mocked(readRemoteConfig).mockResolvedValue({
        agents: { list: [{ id: "main" }] },
        models: { providers: {} },
      });

      const res = await app.request("/lifecycle/ssh-1-main/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: { openai: { baseUrl: "https://api.openai.com/v1", apiKey: "sk-samekey1234", models: [] } },
        }),
      });
      expect(res.status).toBe(409);
    });
  });
});
