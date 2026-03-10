import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { skillRoutes } from "../skills.js";
import { seedTemplates } from "../../skills/templates-seed.js";
import { MockInstanceManager } from "../../__tests__/helpers/mock-instance-manager.js";
import { mockAuthMiddleware } from "../../__tests__/helpers/mock-auth.js";
import { makeInstanceInfo } from "../../__tests__/helpers/fixtures.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      description TEXT NOT NULL,
      description_zh TEXT NOT NULL,
      icon TEXT DEFAULT '',
      skills TEXT NOT NULL DEFAULT '[]',
      builtin INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      instance_id TEXT,
      type TEXT NOT NULL,
      status TEXT DEFAULT 'running',
      output TEXT DEFAULT '',
      operator TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      finished_at TEXT
    );
  `);
  return db;
}

/** Parse SSE text into array of {event, data} */
function parseSSE(text: string): { event: string; data: any }[] {
  const events: { event: string; data: any }[] = [];
  for (const block of text.split("\n\n")) {
    let event = "";
    let dataStr = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) dataStr = line.slice(6);
    }
    if (event && dataStr) {
      try { events.push({ event, data: JSON.parse(dataStr) }); } catch {}
    }
  }
  return events;
}

/** Read SSE response and return the "done" event data */
async function readSSEDone(res: Response): Promise<any> {
  const text = await res.text();
  const events = parseSSE(text);
  return events.find((e) => e.event === "done")?.data;
}

describe("Skills API routes", () => {
  let app: Hono;
  let db: Database.Database;
  let manager: MockInstanceManager;

  beforeEach(() => {
    db = createTestDb();
    seedTemplates(db);
    manager = new MockInstanceManager();
    app = new Hono();
    app.use("/*", mockAuthMiddleware());
    app.route("/skills", skillRoutes(db, manager as any));
  });

  // ─── GET / (catalog) ───

  describe("GET / (catalog)", () => {
    it("returns bundled catalog, tags, and categories", async () => {
      const res = await app.request("/skills");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.bundled).toBeDefined();
      expect(Array.isArray(data.bundled)).toBe(true);
      expect(data.bundled.length).toBe(52);
      expect(Array.isArray(data.tags)).toBe(true);
      expect(data.tags.length).toBeGreaterThan(0);
      expect(Array.isArray(data.categories)).toBe(true);
      expect(data.categories).toContain("dev");
    });
  });

  // ─── GET /search ───

  describe("GET /search", () => {
    it("searches by query", async () => {
      const res = await app.request("/skills/search?q=github");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.results.length).toBeGreaterThanOrEqual(1);
      const names = data.results.map((r: any) => r.name);
      expect(names).toContain("github");
    }, 30_000);

    it("filters by tag", async () => {
      const res = await app.request("/skills/search?tag=macos");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      for (const entry of data.results) {
        expect(entry.tags).toContain("macos");
      }
    });

    it("filters by category", async () => {
      const res = await app.request("/skills/search?category=dev");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.results.length).toBeGreaterThan(0);
      for (const entry of data.results) {
        expect(entry.category).toBe("dev");
      }
    });

    it("returns empty results for no match", async () => {
      const res = await app.request("/skills/search?q=nonexistent-xyz-99999");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.results).toEqual([]);
    }, 30_000);

    it("returns all when no filters", async () => {
      const res = await app.request("/skills/search");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.results.length).toBe(52);
    });
  });

  // ─── GET /templates ───

  describe("GET /templates", () => {
    it("returns all seeded templates sorted by sort_order", async () => {
      const res = await app.request("/skills/templates");
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.templates.length).toBe(15);
      // Check ordering
      for (let i = 1; i < data.templates.length; i++) {
        expect(data.templates[i].sort_order).toBeGreaterThanOrEqual(
          data.templates[i - 1].sort_order,
        );
      }
    });

    it("returns parsed skills arrays (not raw JSON strings)", async () => {
      const res = await app.request("/skills/templates");
      const data = await res.json() as any;
      for (const tpl of data.templates) {
        expect(Array.isArray(tpl.skills)).toBe(true);
        expect(tpl.skills.length).toBeGreaterThan(0);
        expect(tpl.skills[0]).toHaveProperty("name");
      }
    });
  });

  // ─── POST /templates ───

  describe("POST /templates", () => {
    const validTemplate = {
      id: "custom-test",
      name: "Custom Test",
      name_zh: "自定义测试",
      description: "A test template",
      description_zh: "测试模板",
      icon: "star",
      skills: [{ name: "github", source: "bundled", note: "GH" }],
    };

    it("creates a custom template", async () => {
      const res = await app.request("/skills/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validTemplate),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as any;
      expect(data.id).toBe("custom-test");

      // Verify it's in DB
      const row = db.prepare("SELECT * FROM skill_templates WHERE id = ?").get("custom-test") as any;
      expect(row.name).toBe("Custom Test");
      expect(row.builtin).toBe(0);
    });

    it("returns 400 for missing required fields", async () => {
      const res = await app.request("/skills/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: "x" }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for empty skills array", async () => {
      const res = await app.request("/skills/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validTemplate, skills: [] }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate id", async () => {
      // "engineering" already exists from seed
      const res = await app.request("/skills/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...validTemplate, id: "engineering" }),
      });
      expect(res.status).toBe(409);
    });

    it("auto-assigns sort_order when not provided", async () => {
      await app.request("/skills/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validTemplate),
      });
      const row = db.prepare("SELECT sort_order FROM skill_templates WHERE id = ?").get("custom-test") as any;
      // Builtin templates have sort_order 1-15, so this should be 16
      expect(row.sort_order).toBe(16);
    });

    it("creates audit log entry", async () => {
      await app.request("/skills/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validTemplate),
      });
      const ops = db.prepare("SELECT * FROM operations WHERE type = 'skill.template.create'").all() as any[];
      expect(ops.length).toBe(1);
      expect(ops[0].output).toContain("Custom Test");
    });
  });

  // ─── PUT /templates/:id ───

  describe("PUT /templates/:id", () => {
    it("updates template fields", async () => {
      const res = await app.request("/skills/templates/engineering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Engineering v2", icon: "hammer" }),
      });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT name, icon FROM skill_templates WHERE id = ?").get("engineering") as any;
      expect(row.name).toBe("Engineering v2");
      expect(row.icon).toBe("hammer");
    });

    it("updates skills array", async () => {
      const newSkills = [{ name: "tmux", source: "bundled", note: "Terminal" }];
      const res = await app.request("/skills/templates/engineering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skills: newSkills }),
      });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT skills FROM skill_templates WHERE id = ?").get("engineering") as any;
      expect(JSON.parse(row.skills)).toEqual(newSkills);
    });

    it("returns 404 for non-existent template", async () => {
      const res = await app.request("/skills/templates/nonexistent", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "x" }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 when no fields provided", async () => {
      const res = await app.request("/skills/templates/engineering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("creates audit log entry", async () => {
      await app.request("/skills/templates/engineering", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Eng Updated" }),
      });
      const ops = db.prepare("SELECT * FROM operations WHERE type = 'skill.template.update'").all() as any[];
      expect(ops.length).toBe(1);
    });
  });

  // ─── DELETE /templates/:id ───

  describe("DELETE /templates/:id", () => {
    it("deletes a custom template", async () => {
      // Insert a custom (non-builtin) template
      db.prepare(
        "INSERT INTO skill_templates (id, name, name_zh, description, description_zh, skills, builtin) VALUES (?, ?, ?, ?, ?, ?, 0)",
      ).run("custom-del", "Del", "删除", "desc", "描述", "[]");

      const res = await app.request("/skills/templates/custom-del", { method: "DELETE" });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT id FROM skill_templates WHERE id = ?").get("custom-del");
      expect(row).toBeUndefined();
    });

    it("returns 403 for builtin template", async () => {
      const res = await app.request("/skills/templates/engineering", { method: "DELETE" });
      expect(res.status).toBe(403);
    });

    it("returns 404 for non-existent template", async () => {
      const res = await app.request("/skills/templates/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("creates audit log for successful delete", async () => {
      db.prepare(
        "INSERT INTO skill_templates (id, name, name_zh, description, description_zh, skills, builtin) VALUES (?, ?, ?, ?, ?, ?, 0)",
      ).run("custom-audit", "Audit", "审计", "desc", "描述", "[]");
      await app.request("/skills/templates/custom-audit", { method: "DELETE" });
      const ops = db.prepare("SELECT * FROM operations WHERE type = 'skill.template.delete'").all() as any[];
      expect(ops.length).toBe(1);
    });
  });

  // ─── POST /install ───

  describe("POST /install", () => {
    beforeEach(() => {
      manager.seed([
        makeInstanceInfo({ id: "inst-1" }),
      ]);
    });

    it("streams SSE events and returns success", async () => {
      const res = await app.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [{ instanceId: "inst-1", agentIds: ["agent1", "agent2"] }],
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const data = await readSSEDone(res);
      expect(data.ok).toBe(true);
      expect(data.results).toBeDefined();
      expect(data.results.length).toBe(1);
    });

    it("returns 400 for missing skills", async () => {
      const res = await app.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [],
          targets: [{ instanceId: "inst-1", agentIds: ["a1"] }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for skills without name/source", async () => {
      const res = await app.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github" }], // missing source
          targets: [{ instanceId: "inst-1", agentIds: ["a1"] }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for missing targets", async () => {
      const res = await app.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [{ instanceId: "no-such-instance", agentIds: ["a1"] }],
        }),
      });
      expect(res.status).toBe(404);
    });

    it("returns 400 for target with empty agentIds", async () => {
      const res = await app.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [{ instanceId: "inst-1", agentIds: [] }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("creates audit log entry", async () => {
      const res = await app.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [{ instanceId: "inst-1", agentIds: ["a1"] }],
        }),
      });
      // Must consume the SSE stream before checking DB
      await readSSEDone(res);
      const ops = db.prepare("SELECT * FROM operations WHERE type = 'skill.install'").all() as any[];
      expect(ops.length).toBe(1);
    });

    it("calls skills.install RPC when status reports install options", async () => {
      // Create a manager with skills.status returning install options
      const mgr2 = new MockInstanceManager();
      const rpcCalls: { method: string; params: any }[] = [];
      const info = makeInstanceInfo({ id: "inst-rpc" });
      mgr2.seed([info]);
      // Override the mock client's rpc to track calls
      const client = mgr2.getClient("inst-rpc") as any;
      client.rpc = async (method: string, params?: any) => {
        rpcCalls.push({ method, params });
        if (method === "skills.status") {
          return {
            skills: [
              { name: "github", eligible: false, install: [{ id: "brew-0", kind: "brew", label: "Install gh (brew)", bins: ["gh"] }] },
            ],
          };
        }
        if (method === "skills.install") {
          return { ok: true, message: "Installed", stdout: "done", stderr: "", code: 0 };
        }
        if (method === "config.get") {
          return { hash: "h", parsed: { agents: { list: [{ id: "a1" }] } } };
        }
        if (method === "config.patch") return { ok: true };
        return {};
      };

      const app2 = new Hono();
      app2.use("/*", mockAuthMiddleware());
      app2.route("/skills", skillRoutes(db, mgr2 as any));

      const res = await app2.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [{ instanceId: "inst-rpc", agentIds: ["a1"] }],
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const data = await readSSEDone(res);
      expect(data.ok).toBe(true);

      // Verify skills.install was called
      const installCall = rpcCalls.find((c) => c.method === "skills.install");
      expect(installCall).toBeDefined();
      expect(installCall!.params).toEqual({ name: "github", installId: "brew-0", timeoutMs: 120_000 });

      // Verify skillResults in response
      expect(data.results[0].skillResults).toBeDefined();
      expect(data.results[0].skillResults[0]).toEqual({ name: "github", installed: true });
    });

    it("deduplicates binary install for instances on same host", async () => {
      const mgr2 = new MockInstanceManager();
      const rpcCalls: { method: string; instanceId: string }[] = [];

      // Two instances on same host (same URL hostname)
      const info1 = makeInstanceInfo({ id: "inst-a", connection: { id: "inst-a", url: "ws://10.0.0.1:18789", status: "connected", label: "Instance A" } });
      const info2 = makeInstanceInfo({ id: "inst-b", connection: { id: "inst-b", url: "ws://10.0.0.1:18790", status: "connected", label: "Instance B" } });
      mgr2.seed([info1, info2]);

      // Track RPC calls per instance
      for (const id of ["inst-a", "inst-b"]) {
        const cl = mgr2.getClient(id) as any;
        cl.rpc = async (method: string, _params?: any) => {
          rpcCalls.push({ method, instanceId: id });
          if (method === "skills.status") {
            return { skills: [{ name: "github", eligible: false, install: [{ id: "brew-0", kind: "brew" }], missing: { bins: ["gh"] } }] };
          }
          if (method === "skills.install") {
            return { ok: true, message: "Installed", stdout: "", stderr: "", code: 0 };
          }
          if (method === "config.get") {
            return { hash: "h", parsed: { agents: { list: [{ id: "a1" }] } } };
          }
          if (method === "config.patch") return { ok: true };
          return {};
        };
      }

      const app2 = new Hono();
      app2.use("/*", mockAuthMiddleware());
      app2.route("/skills", skillRoutes(db, mgr2 as any));

      const res = await app2.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [
            { instanceId: "inst-a", agentIds: ["a1"] },
            { instanceId: "inst-b", agentIds: ["a1"] },
          ],
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const data = await readSSEDone(res);
      expect(data.ok).toBe(true);
      expect(data.results.length).toBe(2);

      // skills.install should only be called once (for the first instance on that host)
      const installCalls = rpcCalls.filter((c) => c.method === "skills.install");
      expect(installCalls.length).toBe(1);
      expect(installCalls[0].instanceId).toBe("inst-a");

      // Both results should show installed
      expect(data.results[0].skillResults[0].installed).toBe(true);
      expect(data.results[1].skillResults[0].installed).toBe(true);
    });

    it("skips install when skill is already eligible", async () => {
      const mgr2 = new MockInstanceManager();
      const rpcCalls: string[] = [];
      const info = makeInstanceInfo({ id: "inst-e" });
      mgr2.seed([info]);
      const cl = mgr2.getClient("inst-e") as any;
      cl.rpc = async (method: string) => {
        rpcCalls.push(method);
        if (method === "skills.status") {
          return { skills: [{ name: "github", eligible: true }] };
        }
        if (method === "config.get") {
          return { hash: "h", parsed: { agents: { list: [{ id: "a1" }] } } };
        }
        if (method === "config.patch") return { ok: true };
        return {};
      };

      const app2 = new Hono();
      app2.use("/*", mockAuthMiddleware());
      app2.route("/skills", skillRoutes(db, mgr2 as any));

      const res = await app2.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "github", source: "bundled" }],
          targets: [{ instanceId: "inst-e", agentIds: ["a1"] }],
        }),
      });
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      const data = await readSSEDone(res);
      expect(data.ok).toBe(true);
      // skills.install should NOT be called since skill is already eligible
      expect(rpcCalls).not.toContain("skills.install");
      expect(data.results[0].skillResults[0]).toEqual({ name: "github", installed: true });
    });
  });

  // ─── DELETE /uninstall ───

  describe("DELETE /uninstall", () => {
    beforeEach(() => {
      manager.seed([
        makeInstanceInfo({ id: "inst-1" }),
      ]);
    });

    it("validates and returns removed count", async () => {
      const res = await app.request("/skills/uninstall", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: ["github", "slack"],
          targets: [{ instanceId: "inst-1", agentIds: ["agent1"] }],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.ok).toBe(true);
      expect(data.results).toBeDefined();
      expect(data.results.length).toBe(1); // 1 instance target
    });

    it("returns 400 for empty skills", async () => {
      const res = await app.request("/skills/uninstall", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [],
          targets: [{ instanceId: "inst-1", agentIds: ["a1"] }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 400 for non-string skills", async () => {
      const res = await app.request("/skills/uninstall", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [123],
          targets: [{ instanceId: "inst-1", agentIds: ["a1"] }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown instance", async () => {
      const res = await app.request("/skills/uninstall", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: ["github"],
          targets: [{ instanceId: "no-such", agentIds: ["a1"] }],
        }),
      });
      expect(res.status).toBe(404);
    });

    it("creates audit log entry", async () => {
      await app.request("/skills/uninstall", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: ["github"],
          targets: [{ instanceId: "inst-1", agentIds: ["a1"] }],
        }),
      });
      const ops = db.prepare("SELECT * FROM operations WHERE type = 'skill.uninstall'").all() as any[];
      expect(ops.length).toBe(1);
    });
  });

  // ─── Permission checks ───

  describe("write permission enforcement", () => {
    it("auditor cannot create templates", async () => {
      const app2 = new Hono();
      app2.use("/*", mockAuthMiddleware({ userId: 2, username: "viewer", role: "auditor" }));
      app2.route("/skills", skillRoutes(db, manager as any));

      const res = await app2.request("/skills/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "x", name: "X", name_zh: "X", description: "d", description_zh: "d",
          skills: [{ name: "a", source: "bundled", note: "" }],
        }),
      });
      expect(res.status).toBe(403);
    });

    it("auditor can read catalog", async () => {
      const app2 = new Hono();
      app2.use("/*", mockAuthMiddleware({ userId: 2, username: "viewer", role: "auditor" }));
      app2.route("/skills", skillRoutes(db, manager as any));

      const res = await app2.request("/skills");
      expect(res.status).toBe(200);
    });

    it("auditor can read templates", async () => {
      const app2 = new Hono();
      app2.use("/*", mockAuthMiddleware({ userId: 2, username: "viewer", role: "auditor" }));
      app2.route("/skills", skillRoutes(db, manager as any));

      const res = await app2.request("/skills/templates");
      expect(res.status).toBe(200);
    });

    it("auditor cannot install skills", async () => {
      const app2 = new Hono();
      app2.use("/*", mockAuthMiddleware({ userId: 2, username: "viewer", role: "auditor" }));
      app2.route("/skills", skillRoutes(db, manager as any));

      const res = await app2.request("/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skills: [{ name: "a", source: "bundled" }],
          targets: [{ instanceId: "i", agentIds: ["a"] }],
        }),
      });
      expect(res.status).toBe(403);
    });
  });
});
