const ALLOWED_FIELDS = new Set([
  "enabled",
  "dmPolicy",
  "groupPolicy",
  "allowFrom",
  "groupAllowFrom",
  "historyLimit",
  "dmHistoryLimit",
  "textChunkLimit",
  "chunkMode",
  "blockStreaming",
]);

export interface ChannelAccountConfigUpdate {
  enabled?: boolean;
  dmPolicy?: string;
  groupPolicy?: string;
  allowFrom?: (string | number)[];
  groupAllowFrom?: (string | number)[];
  historyLimit?: number;
  dmHistoryLimit?: number;
  textChunkLimit?: number;
  chunkMode?: string;
  blockStreaming?: boolean;
}

export function mergeChannelAccountConfig(
  config: any,
  channel: string,
  accountId: string,
  update: ChannelAccountConfigUpdate,
): any {
  const channels = config?.channels || {};
  const chConfig = channels[channel];
  if (!chConfig) throw new Error(`Channel not found: ${channel}`);

  const result = JSON.parse(JSON.stringify(config));
  const chResult = result.channels[channel];

  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update)) {
    if (ALLOWED_FIELDS.has(key)) filtered[key] = value;
  }

  if (chResult.accounts?.[accountId]) {
    Object.assign(chResult.accounts[accountId], filtered);
  } else if (accountId === "default" && !chResult.accounts) {
    Object.assign(chResult, filtered);
  } else {
    if (!chResult.accounts) chResult.accounts = {};
    chResult.accounts[accountId] = { ...filtered };
  }

  return result;
}
