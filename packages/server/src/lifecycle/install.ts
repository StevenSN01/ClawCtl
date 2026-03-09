import type { CommandExecutor } from "../executor/types.js";

const MIN_NODE_MAJOR = 22;

export interface NodeVersionInfo {
  installed: boolean;
  version?: string;
  sufficient: boolean;
}

export async function checkNodeVersion(exec: CommandExecutor): Promise<NodeVersionInfo> {
  const r = await exec.exec("node --version 2>/dev/null");
  if (r.exitCode !== 0 || !r.stdout.trim()) return { installed: false, sufficient: false };
  const version = r.stdout.trim().replace(/^v/, "");
  const major = parseInt(version.split(".")[0]);
  return { installed: true, version, sufficient: major >= MIN_NODE_MAJOR };
}

export interface VersionInfo {
  installed?: string;
  latest?: string;
  updateAvailable: boolean;
  distTags?: Record<string, string>;
}

export async function getVersions(exec: CommandExecutor): Promise<VersionInfo> {
  const [installedR, tagsR] = await Promise.all([
    exec.exec("openclaw --version 2>/dev/null"),
    exec.exec("npm view openclaw dist-tags --json 2>/dev/null"),
  ]);
  const installed = installedR.exitCode === 0 ? installedR.stdout.trim() : undefined;
  let distTags: Record<string, string> | undefined;
  let latest: string | undefined;
  if (tagsR.exitCode === 0 && tagsR.stdout.trim()) {
    try {
      distTags = JSON.parse(tagsR.stdout.trim());
      latest = distTags?.latest;
    } catch { /* ignore parse error */ }
  }
  return {
    installed,
    latest,
    updateAvailable: !!(installed && latest && installed !== latest),
    distTags,
  };
}

export interface InstallResult {
  success: boolean;
  output: string;
}

export async function installOpenClaw(exec: CommandExecutor, version?: string): Promise<InstallResult> {
  const pkg = version ? `openclaw@${version}` : "openclaw@latest";
  const r = await exec.exec(`npm i -g ${pkg}`, { timeout: 120_000 });
  return { success: r.exitCode === 0, output: r.stdout + r.stderr };
}

// --- Streaming multi-step install with auto Node.js setup ---

export interface InstallStep {
  step: string;
  status: "running" | "done" | "error" | "skipped";
  detail?: string;
}

type EmitFn = (event: InstallStep) => Promise<void>;

/** Run a long command via nohup so it survives SSH disconnects.
 *  Polls for completion every 3s. Returns stdout + exit code. */
async function execLong(
  exec: CommandExecutor,
  command: string,
  timeout: number = 180_000,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const id = `clawctl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const logFile = `/tmp/${id}.log`;
  const rcFile = `/tmp/${id}.rc`;

  // Start in background: run command, write exit code to rcFile when done
  await exec.exec(
    `nohup bash -c '${command.replace(/'/g, "'\\''")}; echo $? > ${rcFile}' > ${logFile} 2>&1 &`,
  );

  // Poll for completion
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 3000));
    const rcR = await exec.exec(`cat ${rcFile} 2>/dev/null`);
    if (rcR.exitCode === 0 && rcR.stdout.trim() !== "") {
      // Done — read log and cleanup
      const logR = await exec.exec(`cat ${logFile} 2>/dev/null`);
      const exitCode = parseInt(rcR.stdout.trim()) || 0;
      await exec.exec(`rm -f ${logFile} ${rcFile}`);
      return { stdout: logR.stdout, stderr: "", exitCode };
    }
  }

  // Timeout — kill and cleanup
  await exec.exec(`pkill -f '${id}' 2>/dev/null; rm -f ${logFile} ${rcFile}`);
  return { stdout: "", stderr: "Command timed out", exitCode: 124 };
}

async function ensureNodeJs(exec: CommandExecutor, emit: EmitFn): Promise<boolean> {
  await emit({ step: "Check Node.js", status: "running" });
  const node = await checkNodeVersion(exec);

  if (node.installed && node.sufficient) {
    await emit({ step: "Check Node.js", status: "done", detail: `v${node.version}` });
    return true;
  }

  if (node.installed && !node.sufficient) {
    await emit({ step: "Check Node.js", status: "running", detail: `v${node.version} too old (need ≥${MIN_NODE_MAJOR}), upgrading...` });
  } else {
    await emit({ step: "Check Node.js", status: "running", detail: "Not found, installing..." });
  }

  // Detect OS and package manager
  const osR = await exec.exec("cat /etc/os-release 2>/dev/null | grep ^ID= | cut -d= -f2 | tr -d '\"'");
  const osId = osR.stdout.trim().toLowerCase();

  let installCmd: string;
  if (["ubuntu", "debian"].includes(osId)) {
    // NodeSource for Debian/Ubuntu
    installCmd = [
      "apt-get update -qq",
      "apt-get install -y -qq curl ca-certificates gnupg",
      `curl -fsSL https://deb.nodesource.com/setup_${MIN_NODE_MAJOR}.x | bash -`,
      "apt-get install -y -qq nodejs",
    ].join(" && ");
  } else if (["centos", "rhel", "fedora", "rocky", "almalinux", "amzn"].includes(osId)) {
    installCmd = [
      `curl -fsSL https://rpm.nodesource.com/setup_${MIN_NODE_MAJOR}.x | bash -`,
      "yum install -y nodejs",
    ].join(" && ");
  } else if (["alpine"].includes(osId)) {
    installCmd = `apk add --no-cache nodejs npm`;
  } else {
    // Fallback: try nvm-style install
    installCmd = [
      `curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash`,
      `export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm install ${MIN_NODE_MAJOR}`,
    ].join(" && ");
  }

  await emit({ step: "Install Node.js", status: "running", detail: `OS: ${osId || "unknown"}` });

  // Try with sudo first, fall back to direct if no sudo
  const hasSudo = (await exec.exec("command -v sudo >/dev/null 2>&1 && echo yes")).stdout.trim() === "yes";
  const prefix = hasSudo ? "sudo " : "";
  const r = await execLong(exec, `${prefix}bash -c '${installCmd.replace(/'/g, "'\\''")}'`, 180_000);

  if (r.exitCode !== 0) {
    await emit({ step: "Install Node.js", status: "error", detail: (r.stderr || r.stdout).slice(0, 200) });
    return false;
  }

  // Verify
  const verify = await checkNodeVersion(exec);
  if (!verify.installed || !verify.sufficient) {
    await emit({ step: "Install Node.js", status: "error", detail: "Installed but version check failed" });
    return false;
  }

  await emit({ step: "Install Node.js", status: "done", detail: `v${verify.version}` });
  return true;
}

async function ensureNpm(exec: CommandExecutor, emit: EmitFn): Promise<boolean> {
  await emit({ step: "Check npm", status: "running" });
  const r = await exec.exec("npm --version 2>/dev/null");
  if (r.exitCode === 0 && r.stdout.trim()) {
    await emit({ step: "Check npm", status: "done", detail: `v${r.stdout.trim()}` });
    return true;
  }

  await emit({ step: "Check npm", status: "running", detail: "Not found, installing..." });
  const hasSudo = (await exec.exec("command -v sudo >/dev/null 2>&1 && echo yes")).stdout.trim() === "yes";
  const prefix = hasSudo ? "sudo " : "";
  // Try corepack or direct install
  await execLong(exec, `${prefix}corepack enable 2>/dev/null || ${prefix}apt-get install -y -qq npm 2>/dev/null || ${prefix}yum install -y npm 2>/dev/null`, 60_000);

  const verify = await exec.exec("npm --version 2>/dev/null");
  if (verify.exitCode === 0 && verify.stdout.trim()) {
    await emit({ step: "Check npm", status: "done", detail: `v${verify.stdout.trim()}` });
    return true;
  }

  await emit({ step: "Check npm", status: "error", detail: "Could not install npm" });
  return false;
}

export async function streamUninstall(
  exec: CommandExecutor,
  emit: EmitFn,
): Promise<boolean> {
  // Step 1: Check if openclaw is installed
  await emit({ step: "Check installation", status: "running" });
  const r = await exec.exec("openclaw --version 2>/dev/null");
  if (r.exitCode !== 0 || !r.stdout.trim()) {
    await emit({ step: "Check installation", status: "done", detail: "Not installed, nothing to do" });
    return true;
  }
  await emit({ step: "Check installation", status: "done", detail: `v${r.stdout.trim()}` });

  // Step 2: Stop running processes
  await emit({ step: "Stop processes", status: "running" });
  const pids = await exec.exec("pgrep -f 'openclaw.*--port' 2>/dev/null");
  if (pids.exitCode === 0 && pids.stdout.trim()) {
    await exec.exec("pkill -f 'openclaw.*--port' 2>/dev/null; true");
    await emit({ step: "Stop processes", status: "done", detail: "Stopped running gateway processes" });
  } else {
    await emit({ step: "Stop processes", status: "done", detail: "No running processes" });
  }

  // Step 3: Disable systemd services if any
  await emit({ step: "Disable services", status: "running" });
  const units = await exec.exec("systemctl --user list-unit-files 'openclaw-gateway*.service' --no-legend 2>/dev/null");
  if (units.exitCode === 0 && units.stdout.trim()) {
    const serviceNames = units.stdout.trim().split("\n").map(l => l.split(/\s+/)[0]).filter(Boolean);
    for (const svc of serviceNames) {
      await exec.exec(`systemctl --user stop ${svc} 2>/dev/null; systemctl --user disable ${svc} 2>/dev/null; true`);
    }
    await emit({ step: "Disable services", status: "done", detail: `Disabled ${serviceNames.length} service(s)` });
  } else {
    await emit({ step: "Disable services", status: "skipped", detail: "No systemd services found" });
  }

  // Step 4: Uninstall npm package
  await emit({ step: "Uninstall openclaw", status: "running" });
  const hasSudo = (await exec.exec("command -v sudo >/dev/null 2>&1 && echo yes")).stdout.trim() === "yes";
  const prefix = hasSudo ? "sudo " : "";
  const uninstall = await exec.exec(`${prefix}npm rm -g openclaw`, { timeout: 60_000 });
  if (uninstall.exitCode !== 0) {
    await emit({ step: "Uninstall openclaw", status: "error", detail: (uninstall.stderr || uninstall.stdout).slice(0, 200) });
    return false;
  }
  await emit({ step: "Uninstall openclaw", status: "done" });

  // Step 5: Verify
  await emit({ step: "Verify removal", status: "running" });
  const verify = await exec.exec("openclaw --version 2>/dev/null");
  if (verify.exitCode === 0 && verify.stdout.trim()) {
    await emit({ step: "Verify removal", status: "error", detail: "openclaw still found after uninstall" });
    return false;
  }
  await emit({ step: "Verify removal", status: "done", detail: "openclaw removed successfully" });
  return true;
}

export async function streamInstall(
  exec: CommandExecutor,
  emit: EmitFn,
  version?: string,
): Promise<boolean> {
  // Step 1: Node.js
  if (!(await ensureNodeJs(exec, emit))) return false;

  // Step 2: npm
  if (!(await ensureNpm(exec, emit))) return false;

  // Step 3: Check for concurrent install
  const running = await exec.exec("ps aux | grep 'npm.*[i].*openclaw' | grep -v grep 2>/dev/null");
  if (running.exitCode === 0 && running.stdout.trim()) {
    await emit({ step: "Install check", status: "error", detail: "Another install is already in progress" });
    return false;
  }

  // Step 4: Install OpenClaw (nohup — survives SSH disconnect)
  const pkg = version ? `openclaw@${version}` : "openclaw@latest";
  await emit({ step: `Install ${pkg}`, status: "running" });
  const hasSudo = (await exec.exec("command -v sudo >/dev/null 2>&1 && echo yes")).stdout.trim() === "yes";
  const sudoPrefix = hasSudo ? "sudo " : "";
  const r = await execLong(exec, `${sudoPrefix}npm i -g ${pkg}`, 300_000);
  if (r.exitCode !== 0) {
    await emit({ step: `Install ${pkg}`, status: "error", detail: (r.stderr || r.stdout).slice(0, 200) });
    return false;
  }
  await emit({ step: `Install ${pkg}`, status: "done" });

  // Step 5: Verify — check binary and fix bin link if needed
  await emit({ step: "Verify installation", status: "running" });
  let verify = await exec.exec("openclaw --version 2>/dev/null");
  if (verify.exitCode !== 0 || !verify.stdout.trim()) {
    // bin link may be missing — try to rebuild
    await emit({ step: "Verify installation", status: "running", detail: "Bin link missing, rebuilding..." });
    await exec.exec(`${sudoPrefix}npm link openclaw 2>/dev/null; ${sudoPrefix}npm rebuild -g openclaw 2>/dev/null`);
    verify = await exec.exec("openclaw --version 2>/dev/null");
  }
  if (verify.exitCode === 0 && verify.stdout.trim()) {
    await emit({ step: "Verify installation", status: "done", detail: `v${verify.stdout.trim()}` });
    return true;
  }

  await emit({ step: "Verify installation", status: "error", detail: "openclaw command not found after install" });
  return false;
}
