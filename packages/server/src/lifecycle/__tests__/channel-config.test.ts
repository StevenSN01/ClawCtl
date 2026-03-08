import { describe, it, expect } from "vitest";
import { mergeChannelAccountConfig } from "../channel-config.js";

describe("mergeChannelAccountConfig", () => {
  it("merges config into channel.accounts.<id>", () => {
    const config = {
      channels: {
        telegram: {
          accounts: {
            default: { enabled: true, dmPolicy: "open" },
          },
        },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "allowlist",
      allowFrom: ["user1"],
    });
    expect(result.channels.telegram.accounts.default.dmPolicy).toBe("allowlist");
    expect(result.channels.telegram.accounts.default.allowFrom).toEqual(["user1"]);
    expect(result.channels.telegram.accounts.default.enabled).toBe(true);
  });

  it("merges config at channel root when no accounts map", () => {
    const config = {
      channels: {
        telegram: { enabled: true, dmPolicy: "open" },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "allowlist",
    });
    expect(result.channels.telegram.dmPolicy).toBe("allowlist");
    expect(result.channels.telegram.enabled).toBe(true);
  });

  it("creates accounts map if accountId is not default", () => {
    const config = {
      channels: {
        telegram: { enabled: true },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "bot2", {
      dmPolicy: "disabled",
    });
    expect(result.channels.telegram.accounts.bot2.dmPolicy).toBe("disabled");
  });

  it("preserves other channels", () => {
    const config = {
      channels: {
        telegram: { accounts: { default: { dmPolicy: "open" } } },
        feishu: { accounts: { abc: { dmPolicy: "allowlist" } } },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "disabled",
    });
    expect(result.channels.feishu.accounts.abc.dmPolicy).toBe("allowlist");
  });

  it("only merges allowed fields", () => {
    const config = {
      channels: {
        telegram: { accounts: { default: { botToken: "secret123", dmPolicy: "open" } } },
      },
    };
    const result = mergeChannelAccountConfig(config, "telegram", "default", {
      dmPolicy: "allowlist",
      botToken: "hacked",
    } as any);
    expect(result.channels.telegram.accounts.default.dmPolicy).toBe("allowlist");
    expect(result.channels.telegram.accounts.default.botToken).toBe("secret123");
  });

  it("throws for unknown channel type", () => {
    const config = { channels: {} };
    expect(() =>
      mergeChannelAccountConfig(config, "nonexistent", "default", { dmPolicy: "open" })
    ).toThrow("Channel not found");
  });
});
