import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import type Database from "better-sqlite3";
import type { UserStore } from "../auth/store.js";
import { createToken } from "../auth/session.js";
import { requireRole } from "../auth/middleware.js";
import { auditLog } from "../audit.js";
import type { Role } from "../auth/types.js";

const TOKEN_COOKIE = "clawctl_token";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // 7 days

export function authRoutes(userStore: UserStore, secret: string, db: Database.Database) {
  const app = new Hono();

  // Check if setup is needed (no users exist)
  app.get("/status", (c) => {
    const needsSetup = !userStore.hasAnyUser();
    return c.json({ needsSetup });
  });

  // Initial setup — create first admin account (only works when no users exist)
  app.post("/setup", async (c) => {
    if (userStore.hasAnyUser()) {
      return c.json({ error: "Setup already completed" }, 400);
    }
    const { username, password } = await c.req.json<{ username: string; password: string }>();
    if (!username || !password) {
      return c.json({ error: "Username and password required" }, 400);
    }
    if (password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }
    const user = userStore.createUser(username, password, "admin");
    const token = createToken({ userId: user.id, username: user.username, role: user.role }, secret);
    setCookie(c, TOKEN_COOKIE, token, { httpOnly: true, sameSite: "Lax", maxAge: COOKIE_MAX_AGE, path: "/" });
    c.set("user", { userId: user.id, username: user.username, role: user.role });
    auditLog(db, c, "auth.setup", `Initial admin account created: ${user.username}`);
    return c.json({ user: { id: user.id, username: user.username, role: user.role }, token });
  });

  // Login
  app.post("/login", async (c) => {
    const { username, password } = await c.req.json<{ username: string; password: string }>();
    if (!username || !password) {
      return c.json({ error: "Username and password required" }, 400);
    }
    const user = userStore.authenticate(username, password);
    if (!user) {
      c.set("user", { userId: 0, username, role: "auditor" as const });
      auditLog(db, c, "auth.login-failed", `Failed login attempt for: ${username}`);
      return c.json({ error: "Invalid credentials" }, 401);
    }
    const token = createToken({ userId: user.id, username: user.username, role: user.role }, secret);
    setCookie(c, TOKEN_COOKIE, token, { httpOnly: true, sameSite: "Lax", maxAge: COOKIE_MAX_AGE, path: "/" });
    c.set("user", { userId: user.id, username: user.username, role: user.role });
    auditLog(db, c, "auth.login", `User logged in: ${user.username} (${user.role})`);
    return c.json({ user: { id: user.id, username: user.username, role: user.role }, token });
  });

  // Logout
  app.post("/logout", (c) => {
    deleteCookie(c, TOKEN_COOKIE, { path: "/" });
    return c.json({ ok: true });
  });

  // Get current user
  app.get("/me", (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Not authenticated" }, 401);
    return c.json(user);
  });

  // --- User management (admin only) ---

  app.get("/users", requireRole("admin"), (c) => {
    return c.json(userStore.listUsers());
  });

  app.post("/users", requireRole("admin"), async (c) => {
    const { username, password, role } = await c.req.json<{ username: string; password: string; role: Role }>();
    if (!username || !password) {
      return c.json({ error: "Username and password required" }, 400);
    }
    if (password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }
    const validRoles: Role[] = ["admin", "operator", "auditor"];
    if (!validRoles.includes(role)) {
      return c.json({ error: "Invalid role" }, 400);
    }
    try {
      const user = userStore.createUser(username, password, role);
      auditLog(db, c, "user.create", `Created user: ${username} (${role})`);
      return c.json(user, 201);
    } catch (e: any) {
      if (e.message?.includes("UNIQUE")) {
        return c.json({ error: "Username already exists" }, 409);
      }
      throw e;
    }
  });

  app.put("/users/:id", requireRole("admin"), async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json<{ role?: Role; password?: string }>();
    if (body.password && body.password.length < 6) {
      return c.json({ error: "Password must be at least 6 characters" }, 400);
    }
    const changes: string[] = [];
    if (body.role) changes.push(`role→${body.role}`);
    if (body.password) changes.push("password changed");
    userStore.updateUser(id, body);
    auditLog(db, c, "user.update", `Updated user #${id}: ${changes.join(", ")}`);
    return c.json({ ok: true });
  });

  app.delete("/users/:id", requireRole("admin"), (c) => {
    const id = parseInt(c.req.param("id"));
    const currentUser = c.get("user");
    if (currentUser.userId === id) {
      return c.json({ error: "Cannot delete yourself" }, 400);
    }
    userStore.deleteUser(id);
    auditLog(db, c, "user.delete", `Deleted user #${id}`);
    return c.json({ ok: true });
  });

  return app;
}
