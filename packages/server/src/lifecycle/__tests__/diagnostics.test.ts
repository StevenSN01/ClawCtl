import { describe, it, expect, vi } from "vitest";
import { checkNodeVersion, getVersions } from "../install.js";
import type { CommandExecutor } from "../../executor/types.js";
import type { ExecResult } from "../../executor/types.js";

// ---------------------------------------------------------------------------
// EnvironmentDiagnostics — pending implementation (skipped)
// ---------------------------------------------------------------------------

describe.skip("EnvironmentDiagnostics (pending implementation)", () => {
  it("runFullDiagnostic returns a structured report", () => {});
  it("testAiConnection returns success with latency when API responds with 200", () => {});
  it("testAiConnection returns failure with error message when API responds with 401", () => {});
  it("testChannelConnectivity validates a Telegram bot token via the getMe API", () => {});
  it("testChannelConnectivity validates Feishu credentials via tenant_access_token API", () => {});
  it("checkDiskSpace parses df -h output and returns available space and usage percent", () => {});
});

// ---------------------------------------------------------------------------
// Diagnostic checks via install functions — tests the actual implementation
// ---------------------------------------------------------------------------

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

describe("diagnostic checks via install functions", () => {
  it("checkNodeVersion + getVersions together provide diagnostic info", async () => {
    const exec = mockExec({
      "node --version": { stdout: "v22.5.0\n", stderr: "", exitCode: 0 },
      "openclaw --version": { stdout: "2026.3.3\n", stderr: "", exitCode: 0 },
      "npm view": { stdout: '{"latest":"2026.3.5"}\n', stderr: "", exitCode: 0 },
    });
    const node = await checkNodeVersion(exec);
    const versions = await getVersions(exec);
    expect(node.installed).toBe(true);
    expect(node.sufficient).toBe(true);
    expect(versions.installed).toBe("2026.3.3");
    expect(versions.updateAvailable).toBe(true);
  });

  it("returns not installed when both missing", async () => {
    const exec = mockExec({});
    const node = await checkNodeVersion(exec);
    const versions = await getVersions(exec);
    expect(node.installed).toBe(false);
    expect(versions.installed).toBeUndefined();
  });
});
