/**
 * Maps binary names to install methods for different platforms.
 * Used as SSH fallback when Gateway RPC install fails (e.g., no brew on Linux).
 *
 * Sources: OpenClaw SKILL.md install specs + GitHub repo verification.
 * Last verified: 2026-03-10
 */

export interface BinInstallSpec {
  /** apt package name (Debian/Ubuntu) */
  apt?: string;
  /** Go module path for `go install <module>` */
  go?: string;
  /** npm package name for `npm install -g <pkg>` */
  npm?: string;
  /** Cargo crate name for `cargo install <crate>` */
  cargo?: string;
  /** pip package for `pip install <pkg>` */
  pip?: string;
  /** macOS-only — no Linux alternative */
  darwinOnly?: boolean;
  /** Why this binary can't be auto-installed (shown to user) */
  reason?: string;
}

export const INSTALL_MAP: Record<string, BinInstallSpec> = {
  // ─── Standard apt packages ───
  gh: { apt: "gh" },
  tmux: { apt: "tmux" },
  ffmpeg: { apt: "ffmpeg" },
  jq: { apt: "jq" },
  rg: { apt: "ripgrep" },
  curl: { apt: "curl" },
  git: { apt: "git" },
  python3: { apt: "python3" },

  // ─── Go-installable tools (verified Go module paths) ───
  gog: { go: "github.com/steipete/gogcli/cmd/gog@latest" },             // Google Workspace CLI
  blogwatcher: { go: "github.com/Hyaxia/blogwatcher/cmd/blogwatcher@latest" },
  eightctl: { go: "github.com/steipete/eightctl/cmd/eightctl@latest" },  // Eight Sleep
  gifgrep: { go: "github.com/steipete/gifgrep/cmd/gifgrep@latest" },
  ordercli: { go: "github.com/steipete/ordercli/cmd/ordercli@latest" },  // Foodora
  sonos: { go: "github.com/steipete/sonoscli/cmd/sonos@latest" },        // Sonos speaker
  sonoscli: { go: "github.com/steipete/sonoscli/cmd/sonos@latest" },     // alias (catalog uses sonoscli)
  blu: { go: "github.com/steipete/blucli/cmd/blu@latest" },              // BluOS speaker
  goplaces: { go: "github.com/steipete/goplaces/cmd/goplaces@latest" },  // Google Places
  sag: { go: "github.com/steipete/sag/cmd/sag@latest" },                 // ElevenLabs TTS
  songsee: { go: "github.com/steipete/songsee/cmd/songsee@latest" },     // Audio spectrogram
  camsnap: { go: "github.com/steipete/camsnap/cmd/camsnap@latest" },     // RTSP camera (needs ffmpeg)
  wacli: { go: "github.com/steipete/wacli/cmd/wacli@latest" },           // WhatsApp CLI
  grizzly: { go: "github.com/tylerwince/grizzly/cmd/grizzly@latest", darwinOnly: true }, // Bear notes
  things: { go: "github.com/ossianhempel/things3-cli/cmd/things@latest", darwinOnly: true }, // Things 3

  // ─── npm-installable tools ───
  clawhub: { npm: "clawhub" },
  mcporter: { npm: "mcporter" },                    // MCP server management
  oracle: { npm: "@steipete/oracle" },               // Prompting CLI
  xurl: { npm: "@xdevplatform/xurl" },               // X/Twitter API
  summarize: { npm: "@steipete/summarize" },          // URL/file summarizer (Node.js project)

  // ─── Cargo-installable tools ───
  himalaya: { cargo: "himalaya" },                    // Email CLI (Rust)
  spotify_player: { cargo: "spotify_player" },        // Spotify (Rust)

  // ─── pip-installable tools ───
  uv: { pip: "uv" },                                 // Python package manager
  whisper: { pip: "openai-whisper" },                 // Speech-to-text (local)
  "nano-pdf": { pip: "nano-pdf" },                    // PDF editing (Python/uv)

  // ─── Tools with no easy Linux install (with reason) ───
  op: { reason: "1Password CLI requires adding official apt repo: https://developer.1password.com/docs/cli/get-started/" },
  openhue: { reason: "openhue-cli only supports Homebrew; download Linux binary from https://github.com/openhue/openhue-cli/releases" },
  spogo: { reason: "spogo only supports Homebrew (steipete/tap); try spotify_player via cargo as alternative" },
  "obsidian-cli": { reason: "obsidian-cli only supports Homebrew (yakitrak/yakitrak/obsidian-cli)" },
  "sherpa-onnx-tts": { reason: "sherpa-onnx-tts requires downloading platform binaries from https://github.com/k2-fsa/sherpa-onnx/releases" },

  // ─── macOS-only tools ───
  memo: { darwinOnly: true },        // apple-notes
  remindctl: { darwinOnly: true },   // apple-reminders
  imsg: { darwinOnly: true },        // iMessage CLI
  peekaboo: { darwinOnly: true },    // macOS UI automation
  codexbar: { darwinOnly: true },    // model-usage tracking
};

/**
 * Look up install method for a binary on a given OS.
 * Returns the install command string, or null if not installable.
 */
export function getInstallCommand(
  bin: string,
  os: "linux" | "darwin",
  available: { apt: boolean; go: boolean; npm: boolean; cargo: boolean; pip: boolean; pipx?: boolean },
): { cmd: string; label: string } | null {
  const spec = INSTALL_MAP[bin];

  // Unknown binary — try apt on Linux as last resort
  if (!spec) {
    if (os === "linux" && available.apt) {
      return { cmd: `sudo apt-get install -y ${bin}`, label: `apt: ${bin}` };
    }
    return null;
  }

  // macOS-only tools on Linux
  if (spec.darwinOnly && os === "linux") return null;

  // Try methods in order of preference
  if (os === "linux" && spec.apt && available.apt) {
    return { cmd: `sudo apt-get update -qq && sudo apt-get install -y ${spec.apt}`, label: `apt: ${spec.apt}` };
  }
  if (spec.go && available.go) {
    return { cmd: `go install ${spec.go}`, label: `go: ${spec.go}` };
  }
  if (spec.npm && available.npm) {
    return { cmd: `npm install -g ${spec.npm}`, label: `npm: ${spec.npm}` };
  }
  if (spec.cargo && available.cargo) {
    return { cmd: `cargo install ${spec.cargo}`, label: `cargo: ${spec.cargo}` };
  }
  if (spec.pip && (available.pipx || available.pip)) {
    if (available.pipx) {
      return { cmd: `pipx install ${spec.pip}`, label: `pipx: ${spec.pip}` };
    }
    // --break-system-packages for PEP 668 (Ubuntu 24.04+)
    return { cmd: `pip3 install --break-system-packages ${spec.pip}`, label: `pip: ${spec.pip}` };
  }

  return null;
}

/** Get human-readable reason why a binary can't be auto-installed */
export function getUnsupportedReason(bin: string, os: "linux" | "darwin"): string {
  const spec = INSTALL_MAP[bin];
  if (!spec) return `Unknown binary: ${bin}`;
  if (spec.darwinOnly && os === "linux") return `${bin} is macOS-only`;
  if (spec.reason) return spec.reason;
  return `No automatic install method for ${bin} on ${os}`;
}
