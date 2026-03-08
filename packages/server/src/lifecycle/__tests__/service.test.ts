import { describe, it, expect, vi } from "vitest";
import { getProcessStatus, stopProcess, startProcess } from "../service.js";
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

describe("getProcessStatus", () => {
  it("returns running when port is in use", async () => {
    const exec = mockExec({ "lsof": { stdout: "12345\n", stderr: "", exitCode: 0 } });
    const status = await getProcessStatus(exec, 18789);
    expect(status.running).toBe(true);
    expect(status.pid).toBe(12345);
  });

  it("returns stopped when port is free", async () => {
    const exec = mockExec({ "lsof": { stdout: "", stderr: "", exitCode: 1 } });
    const status = await getProcessStatus(exec, 18789);
    expect(status.running).toBe(false);
  });
});

describe("stopProcess", () => {
  it("sends SIGTERM to pid", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await stopProcess(exec, 12345);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("12345"));
  });
});

describe("startProcess", () => {
  it("launches openclaw with correct port", async () => {
    const execFn = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }));
    const exec: CommandExecutor = { exec: execFn, async *execStream() { yield ""; } };
    await startProcess(exec, "/home/ubuntu/.openclaw", 18789);
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("18789"));
    expect(execFn).toHaveBeenCalledWith(expect.stringContaining("nohup openclaw"));
  });
});
