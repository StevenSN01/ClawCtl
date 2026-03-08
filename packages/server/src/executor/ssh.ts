import { Client } from "ssh2";
import type { CommandExecutor, ExecResult, ExecOptions } from "./types.js";

export interface SshConfig {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
}

function poolKey(c: SshConfig): string {
  return `${c.username}@${c.host}:${c.port}`;
}

// --- Global connection pool ---

interface PoolEntry {
  conn: Client;
  config: SshConfig;
  connectPromise: Promise<Client> | null;
}

class SshPool {
  private entries = new Map<string, PoolEntry>();

  /** Get or create a persistent connection for this host. Retries up to 2 times. */
  async acquire(config: SshConfig): Promise<Client> {
    const key = poolKey(config);
    const existing = this.entries.get(key);

    // Already connected and alive
    if (existing && !existing.connectPromise) {
      return existing.conn;
    }

    // Connection in progress — wait for it
    if (existing?.connectPromise) {
      return existing.connectPromise;
    }

    // Create new connection with retry
    let lastErr: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const promise = this.createConnection(config, key);
      this.entries.set(key, { conn: null!, config, connectPromise: promise });
      try {
        return await promise;
      } catch (err: any) {
        this.entries.delete(key);
        lastErr = err;
        // Only retry on timeout, not auth failures
        if (!err.message?.includes("timeout") && !err.message?.includes("Timed out")) throw err;
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  /** Remove a dead connection from the pool. */
  remove(config: SshConfig) {
    const key = poolKey(config);
    const entry = this.entries.get(key);
    if (entry) {
      try { entry.conn?.end(); } catch { /* ignore */ }
      this.entries.delete(key);
    }
  }

  /** Close all connections. */
  closeAll() {
    for (const entry of this.entries.values()) {
      try { entry.conn?.end(); } catch { /* ignore */ }
    }
    this.entries.clear();
  }

  private createConnection(config: SshConfig, key: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const timer = setTimeout(() => {
        conn.end();
        this.entries.delete(key);
        reject(new Error(`SSH timeout: ${config.host}`));
      }, 35_000);

      conn.on("ready", () => {
        clearTimeout(timer);
        this.entries.set(key, { conn, config, connectPromise: null });
        resolve(conn);
      });

      conn.on("error", (err) => {
        clearTimeout(timer);
        this.entries.delete(key);
        reject(err);
      });

      // Auto-cleanup when connection closes
      conn.on("close", () => { this.entries.delete(key); });
      conn.on("end", () => { this.entries.delete(key); });

      conn.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        readyTimeout: 30_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
      });
    });
  }
}

export const sshPool = new SshPool();

// --- Command execution helpers (operate on a connection, not owning it) ---

function run(conn: Client, command: string, timeout: number): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; reject(new Error("Command timeout")); }
    }, timeout);

    conn.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); if (!resolved) { resolved = true; reject(err); } return; }
      let stdout = "";
      let stderr = "";
      stream.on("data", (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      stream.on("close", (code: number) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code ?? 0 });
        }
      });
    });
  });
}

async function* runStream(conn: Client, command: string, timeout: number): AsyncIterable<string> {
  const stream = await new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Stream timeout")), timeout);
    conn.exec(command, (err, s) => {
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(s);
    });
  });

  for await (const chunk of stream) {
    yield chunk.toString();
  }
}

// --- Public executor (uses pool) ---

export class SshExec implements CommandExecutor {
  constructor(private config: SshConfig) {}

  async exec(command: string, opts?: ExecOptions): Promise<ExecResult> {
    let conn: Client;
    try {
      conn = await sshPool.acquire(this.config);
    } catch (err) {
      throw err; // Connection failed — let caller handle
    }
    try {
      return await run(conn, command, opts?.timeout || 60_000);
    } catch (err: any) {
      // If exec fails due to dead connection, drop from pool and retry once
      if (err.message?.includes("Not connected") || err.level === "client-socket") {
        sshPool.remove(this.config);
        conn = await sshPool.acquire(this.config);
        return run(conn, command, opts?.timeout || 60_000);
      }
      throw err;
    }
  }

  async *execStream(command: string, opts?: ExecOptions): AsyncIterable<string> {
    const conn = await sshPool.acquire(this.config);
    yield* runStream(conn, command, opts?.timeout || 300_000);
  }
}
