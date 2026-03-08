import { describe, it, expect, vi } from "vitest";
import { getProcessStatus, stopProcess, startProcess, restartProcess } from "../service.js";
import type { CommandExecutor, ExecResult } from "../../executor/types.js";

function mockExec(results: Record<string, ExecResult>): CommandExecutor {
  return {
    exec: vi.fn(async (cmd: string) => {
      for (const [pattern, result] of Object.entries(results)) {
        if (cmd.includes(pattern)) return result;
      }
      return { stdout: "", stderr: "", exitCode: 1 };
    }),
    async *execStream() { yield ""; },
  };
}

describe("stopProcess", () => {
  it("sends SIGKILL when force is true", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await stopProcess(exec, 12345, true);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("SIGKILL"));
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("12345"));
  });

  it("sends SIGTERM when force is false", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await stopProcess(exec, 12345, false);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("SIGTERM"));
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("12345"));
  });
});

describe("startProcess", () => {
  it("uses --profile flag for non-default config dir", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await startProcess(exec, "/home/user/.openclaw-feishu", 18789);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("--profile feishu"));
  });

  it("includes correct port in command", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await startProcess(exec, "/home/user/.openclaw", 9999);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("--port 9999"));
  });
});

describe("restartProcess", () => {
  it("stops running process then starts a new one", async () => {
    const calls: string[] = [];
    let lsofCallCount = 0;
    const execFn = vi.fn(async (cmd: string) => {
      calls.push(cmd);
      if (cmd.includes("lsof")) {
        lsofCallCount++;
        // First call: process is running; subsequent calls: process stopped
        if (lsofCallCount === 1) {
          return { stdout: "42\n", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };

    await restartProcess(exec, "/home/user/.openclaw", 18789);

    // Verify order: lsof (status check) -> kill (stop) -> lsof (poll) -> start
    const killIdx = calls.findIndex((c) => c.includes("kill"));
    const startIdx = calls.findIndex((c) => c.includes("nohup openclaw"));
    expect(killIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(killIdx);
  });

  it("skips stop when process is not running", async () => {
    const execFn = vi.fn(async (cmd: string) => {
      if (cmd.includes("lsof")) {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };

    await restartProcess(exec, "/home/user/.openclaw", 18789);

    const calls = execFn.mock.calls.map((c) => c[0] as string);
    expect(calls.some((c) => c.includes("kill"))).toBe(false);
    expect(calls.some((c) => c.includes("nohup openclaw"))).toBe(true);
  });
});

describe("getProcessStatus", () => {
  it("takes first PID from multi-line lsof output", async () => {
    const exec = mockExec({
      "lsof": { stdout: "12345\n67890\n", stderr: "", exitCode: 0 },
    });
    const status = await getProcessStatus(exec, 18789);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(12345);
  });
});
