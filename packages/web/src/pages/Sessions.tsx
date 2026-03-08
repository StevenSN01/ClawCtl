import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Pencil } from "lucide-react";
import { useInstances } from "../hooks/useInstances";
import { get, post, put } from "../lib/api";

function timeAgo(ts: number | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return t("common.justNow");
  if (diff < 3600_000) return t("common.mAgo", { n: Math.floor(diff / 60_000) });
  if (diff < 86400_000) return t("common.hAgo", { n: Math.floor(diff / 3600_000) });
  return t("common.dAgo", { n: Math.floor(diff / 86400_000) });
}

/** Derive a short display label from a session key */
function sessionLabel(s: { displayName?: string; key: string }, alias?: string): string {
  return alias || s.displayName || s.key.split(":").pop() || s.key;
}

export function Sessions() {
  const { t } = useTranslation();
  const { instances } = useInstances();
  const [selectedSession, setSelectedSession] = useState<{ instanceId: string; key: string } | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [msgReverse, setMsgReverse] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [filter, setFilter] = useState("");
  const [selectedHost, setSelectedHost] = useState<string>("all");
  const [selectedInstance, setSelectedInstance] = useState<string>("all");
  const [sortAsc, setSortAsc] = useState(false);
  // alias: "instanceId|sessionKey" -> alias string
  const [aliasMap, setAliasMap] = useState<Map<string, string>>(new Map());
  const [editingAlias, setEditingAlias] = useState<string | null>(null);
  const [aliasInput, setAliasInput] = useState("");

  const fetchAliases = useCallback(async () => {
    const connected = instances.filter((i) => i.connection.status === "connected");
    const map = new Map<string, string>();
    await Promise.all(connected.map(async (inst) => {
      try {
        const sessions = await get<{ key: string; alias?: string }[]>(`/instances/${inst.id}/sessions`);
        for (const s of sessions) {
          if (s.alias) map.set(`${inst.id}|${s.key}`, s.alias);
        }
      } catch { /* ignore */ }
    }));
    setAliasMap(map);
  }, [instances]);

  useEffect(() => { fetchAliases(); }, [fetchAliases]);

  const saveAlias = async (instanceId: string, key: string, alias: string) => {
    try {
      await put(`/instances/${instanceId}/sessions/${encodeURIComponent(key)}/alias`, { alias });
      setAliasMap((prev) => {
        const next = new Map(prev);
        if (alias) next.set(`${instanceId}|${key}`, alias);
        else next.delete(`${instanceId}|${key}`);
        return next;
      });
    } catch { /* ignore */ }
    setEditingAlias(null);
  };

  const connectedInstances = instances.filter((i) => i.connection.status === "connected");

  // Group instances by host
  const hostGroups = (() => {
    const groups = new Map<string, { hostKey: string; hostLabel: string; instances: typeof connectedInstances }>();
    for (const inst of connectedInstances) {
      const match = inst.id.match(/^ssh-(\d+)-/);
      const hostKey = match ? `ssh-${match[1]}` : "local";
      if (!groups.has(hostKey)) {
        const connLabel = inst.connection.label || "";
        const slashIdx = connLabel.indexOf("/");
        const hostLabel = hostKey === "local" ? t("dashboard.local") : (slashIdx > 0 ? connLabel.slice(0, slashIdx) : hostKey);
        groups.set(hostKey, { hostKey, hostLabel, instances: [] });
      }
      groups.get(hostKey)!.instances.push(inst);
    }
    return [...groups.values()];
  })();

  const visibleInstances = selectedHost === "all"
    ? connectedInstances
    : hostGroups.find((g) => g.hostKey === selectedHost)?.instances || [];

  const allSessions = visibleInstances.flatMap((inst) =>
    inst.sessions.map((s) => ({ ...s, instanceId: inst.id, instanceLabel: inst.connection.label || inst.id }))
  );

  const filtered = allSessions
    .filter((s) => selectedInstance === "all" || s.instanceId === selectedInstance)
    .filter((s) => {
      if (!filter) return true;
      const q = filter.toLowerCase();
      const alias = aliasMap.get(`${s.instanceId}|${s.key}`) || "";
      return alias.toLowerCase().includes(q) || (s.displayName || s.key).toLowerCase().includes(q) || s.instanceLabel.toLowerCase().includes(q) || (s.channel || "").toLowerCase().includes(q);
    })
    .sort((a, b) => sortAsc ? (a.updatedAt || 0) - (b.updatedAt || 0) : (b.updatedAt || 0) - (a.updatedAt || 0));

  const [msgLimit, setMsgLimit] = useState(50);
  const [hasMore, setHasMore] = useState(false);

  const loadSession = async (instanceId: string, key: string, limit = 50) => {
    setSelectedSession({ instanceId, key });
    setSummary(null);
    setMsgLimit(limit);
    setLoadingMsgs(true);
    try {
      const msgs = await get<any[]>(`/instances/${instanceId}/sessions/${key}?limit=${limit}`);
      setMessages(msgs);
      setHasMore(msgs.length >= limit);
    } finally {
      setLoadingMsgs(false);
    }
  };

  const loadMore = () => {
    if (!selectedSession) return;
    const next = Math.min(msgLimit * 4, 1000);
    loadSession(selectedSession.instanceId, selectedSession.key, next);
  };

  const summarize = async () => {
    if (!selectedSession) return;
    setSummarizing(true);
    try {
      const r = await post<{ summary: string }>(`/instances/${selectedSession.instanceId}/sessions/${selectedSession.key}/summarize`);
      setSummary(r.summary);
    } catch (e: any) {
      setSummary(`Error: ${e.message}`);
    } finally {
      setSummarizing(false);
    }
  };

  const instanceCounts = visibleInstances.map((inst) => ({
    id: inst.id,
    label: inst.connection.label || inst.id,
    count: inst.sessions.length,
  }));

  return (
    <div className="flex gap-4 h-full">
      <div className="w-1/3 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-2xl font-bold text-ink">{t("sessions.title")}</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSortAsc(!sortAsc)}
              className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink px-1.5 py-0.5 rounded bg-s2"
              title={sortAsc ? t("sessions.oldestFirst") : t("sessions.newestFirst")}
            >
              <ArrowUpDown size={12} />
              {sortAsc ? t("common.old") : t("common.new")}
            </button>
            <span className="text-sm text-ink-3">{filtered.length}</span>
          </div>
        </div>

        {/* Host filter */}
        {hostGroups.length > 1 && (
          <div className="flex gap-1 mb-2 overflow-x-auto scrollbar-thin">
            <button
              onClick={() => { setSelectedHost("all"); setSelectedInstance("all"); }}
              className={`px-2 py-1 rounded text-xs whitespace-nowrap ${selectedHost === "all" ? "bg-s3 text-ink" : "bg-s2 text-ink-3 hover:text-ink"}`}
            >
              {t("sessions.allHosts")}
            </button>
            {hostGroups.map((g) => {
              const count = g.instances.reduce((s, i) => s + i.sessions.length, 0);
              return (
                <button
                  key={g.hostKey}
                  onClick={() => { setSelectedHost(g.hostKey); setSelectedInstance("all"); }}
                  className={`px-2 py-1 rounded text-xs whitespace-nowrap ${selectedHost === g.hostKey ? "bg-s3 text-ink" : "bg-s2 text-ink-3 hover:text-ink"}`}
                >
                  {g.hostLabel} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Instance filter */}
        {instanceCounts.length > 1 && (
          <select
            value={selectedInstance}
            onChange={(e) => setSelectedInstance(e.target.value)}
            className="mb-2 bg-s2 border border-edge rounded-lg px-3 py-1.5 text-xs text-ink"
          >
            <option value="all">{t("sessions.allInstances", { n: allSessions.length })}</option>
            {instanceCounts.map((ic) => (
              <option key={ic.id} value={ic.id}>{ic.label} ({ic.count})</option>
            ))}
          </select>
        )}

        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("sessions.filterPlaceholder")}
          className="mb-3 bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors"
        />
        <div className="flex-1 overflow-auto space-y-1">
          {filtered.map((s) => {
            const aliasKey = `${s.instanceId}|${s.key}`;
            const alias = aliasMap.get(aliasKey);
            const isEditing = editingAlias === aliasKey;
            return (
            <div
              key={`${s.instanceId}-${s.key}`}
              onClick={() => !isEditing && loadSession(s.instanceId, s.key)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors cursor-pointer ${
                selectedSession?.key === s.key && selectedSession?.instanceId === s.instanceId
                  ? "bg-s2 text-ink border-l-2 border-brand"
                  : "text-ink-2 hover:bg-s1/50"
              }`}
            >
              {isEditing ? (
                <div className="flex gap-1 items-center" onClick={(e) => e.stopPropagation()}>
                  <input
                    autoFocus
                    value={aliasInput}
                    onChange={(e) => setAliasInput(e.target.value)}
                    onBlur={() => saveAlias(s.instanceId, s.key, aliasInput.trim())}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveAlias(s.instanceId, s.key, aliasInput.trim());
                      if (e.key === "Escape") setEditingAlias(null);
                    }}
                    placeholder={t("sessions.enterAlias")}
                    className="flex-1 min-w-0 bg-s2 border border-cyan rounded px-1.5 py-0.5 text-xs text-ink focus:outline-none"
                  />
                  <span className="text-[10px] text-ink-3">{t("sessions.enterToSave")}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="truncate font-medium">
                      {sessionLabel(s, alias)}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingAlias(aliasKey); setAliasInput(alias || ""); }}
                        className="text-ink-3 hover:text-cyan transition-colors"
                        title={t("sessions.setAlias")}
                      >
                        <Pencil size={11} />
                      </button>
                      <span className="text-xs text-ink-3">{timeAgo(s.updatedAt, t)}</span>
                    </div>
                  </div>
                  {alias && (
                    <div className="text-xs text-ink-3 truncate">{s.displayName || s.key}</div>
                  )}
                </>
              )}
              <div className="text-xs text-ink-3 flex gap-2">
                <span>{s.instanceLabel}</span>
                <span>·</span>
                <span>{s.kind}</span>
                {s.channel && <><span>·</span><span>{s.channel}</span></>}
                {s.model && <><span>·</span><span>{s.model}</span></>}
              </div>
              {(s.totalTokens ?? 0) > 0 && (
                <div className="text-xs text-ink-3">{(s.totalTokens || 0).toLocaleString()} {t("common.tokens")}</div>
              )}
            </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-8 text-ink-3 text-sm">{t("sessions.noSessionsFound")}</div>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {selectedSession ? (
          <>
            <div className="flex items-center justify-between mb-4 gap-2">
              <h2 className="text-lg font-semibold truncate text-ink">{selectedSession.key}</h2>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-ink-3">{messages.length} {t("sessions.msg", { count: messages.length })}</span>
                <button
                  onClick={() => setMsgReverse(!msgReverse)}
                  className="flex items-center gap-1 text-xs text-ink-3 hover:text-ink px-1.5 py-0.5 rounded bg-s2"
                  title={msgReverse ? t("sessions.newestFirst") : t("sessions.oldestFirst")}
                >
                  <ArrowUpDown size={12} />
                  {msgReverse ? t("common.new") : t("common.old")}
                </button>
                {hasMore && (
                  <button
                    onClick={loadMore}
                    className="px-2 py-1 text-xs bg-s3 hover:bg-edge-hi rounded"
                  >
                    {t("common.loadMore")}
                  </button>
                )}
                <button
                  onClick={summarize}
                  disabled={summarizing}
                  className="px-3 py-1.5 text-sm bg-brand hover:bg-brand-light rounded disabled:opacity-50"
                >
                  {summarizing ? t("sessions.summarizing") : t("sessions.summarize")}
                </button>
              </div>
            </div>
            {summary && (
              <div className="mb-4 p-3 bg-brand-dim border border-brand/30 rounded-card text-sm shadow-card">
                {summary}
              </div>
            )}
            {loadingMsgs ? (
              <div className="flex-1 flex items-center justify-center text-ink-3">{t("sessions.loadingMessages")}</div>
            ) : (
            <div className="flex-1 overflow-auto space-y-3">
              {(msgReverse ? [...messages].reverse() : messages).map((msg, i) => (
                <div key={i} className={`p-3 rounded text-sm ${msg.role === "user" ? "bg-s2" : "bg-s1 border border-edge"}`}>
                  <span className="text-xs text-ink-3 uppercase">{msg.role}</span>
                  <p className="mt-1 whitespace-pre-wrap">{typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2)}</p>
                </div>
              ))}
            </div>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-ink-3">
            {t("sessions.selectSession")}
          </div>
        )}
      </div>
    </div>
  );
}
