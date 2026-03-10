import { describe, it, expect } from "vitest";
import { getInstallCommand, INSTALL_MAP } from "../install-map.js";

const ALL_AVAILABLE = { apt: true, go: true, npm: true, cargo: true, pip: true };
const ONLY_APT = { apt: true, go: false, npm: false, cargo: false, pip: false };

describe("INSTALL_MAP", () => {
  it("has entries for common binaries", () => {
    expect(INSTALL_MAP.gh).toBeDefined();
    expect(INSTALL_MAP.gh.apt).toBe("gh");
    expect(INSTALL_MAP.himalaya?.cargo).toBe("himalaya");
    expect(INSTALL_MAP.xurl?.npm).toBe("@xdevplatform/xurl");
    expect(INSTALL_MAP.gifgrep?.go).toContain("github.com/");
  });
});

describe("getInstallCommand", () => {
  it("returns apt command for standard packages on Linux", () => {
    const result = getInstallCommand("gh", "linux", ALL_AVAILABLE);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("apt-get install -y gh");
    expect(result!.label).toBe("apt: gh");
  });

  it("returns apt with correct package name when it differs from binary", () => {
    const result = getInstallCommand("rg", "linux", ALL_AVAILABLE);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("apt-get install -y ripgrep");
  });

  it("returns go install for go-based tools", () => {
    const result = getInstallCommand("gifgrep", "linux", ALL_AVAILABLE);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("go install");
    expect(result!.label).toContain("go:");
  });

  it("returns npm install for npm-based tools", () => {
    const result = getInstallCommand("xurl", "linux", ALL_AVAILABLE);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("npm install -g @xdevplatform/xurl");
  });

  it("returns cargo install for cargo-based tools", () => {
    const result = getInstallCommand("himalaya", "linux", ALL_AVAILABLE);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("cargo install himalaya");
  });

  it("returns null for darwin-only tools on linux", () => {
    const result = getInstallCommand("memo", "linux", ALL_AVAILABLE);
    expect(result).toBeNull();
  });

  it("falls back to go when apt is not available", () => {
    const noApt = { apt: false, go: true, npm: false, cargo: false, pip: false };
    const result = getInstallCommand("gifgrep", "linux", noApt);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("go install");
  });

  it("falls back to apt for unknown binaries on Linux", () => {
    const result = getInstallCommand("some-unknown-bin", "linux", ONLY_APT);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("apt-get install -y some-unknown-bin");
  });

  it("returns null for brew-only tools with no alternatives", () => {
    // openhue has non-standard go.mod, no npm/cargo — brew-only
    const result = getInstallCommand("openhue", "linux", ALL_AVAILABLE);
    expect(result).toBeNull();
  });

  it("returns go install for gog on Linux", () => {
    const result = getInstallCommand("gog", "linux", ALL_AVAILABLE);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("go install github.com/steipete/gogcli/cmd/gog@latest");
  });

  it("returns npm install for summarize on Linux", () => {
    const result = getInstallCommand("summarize", "linux", ALL_AVAILABLE);
    expect(result).not.toBeNull();
    expect(result!.cmd).toContain("npm install -g @steipete/summarize");
  });

  it("returns null for unknown bins on darwin with no tools", () => {
    const noTools = { apt: false, go: false, npm: false, cargo: false, pip: false };
    const result = getInstallCommand("some-unknown-bin", "darwin", noTools);
    expect(result).toBeNull();
  });

  it("prefers apt over go on Linux when both available", () => {
    // gh has apt spec, no go spec — should use apt
    const result = getInstallCommand("gh", "linux", ALL_AVAILABLE);
    expect(result!.label).toBe("apt: gh");
  });
});
