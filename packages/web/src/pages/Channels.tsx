import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Radio, RefreshCw } from "lucide-react";
import { useInstances } from "../hooks/useInstances";
import { get } from "../lib/api";

interface ChannelRow {
  instanceId: string;
  instanceLabel: string;
  channelType: string;
  channelLabel: string;
  accountCount: number;
  runningCount: number;
  connectedCount: number;
  lastActivity: number | null;
}

function timeAgo(ts: number | null): string {
  if (!ts) return "—";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

export function Channels() {
  const { instances } = useInstances();
  const navigate = useNavigate();
  const [selectedHost, setSelectedHost] = useState("all");
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(false);

  const connectedInstances = instances.filter((i) => i.connection.status === "connected");

  const hostGroups = (() => {
    const groups = new Map<string, { hostKey: string; hostLabel: string; instances: typeof connectedInstances }>();
    for (const inst of connectedInstances) {
      const match = inst.id.match(/^ssh-(\d+)-/);
      const hostKey = match ? `ssh-${match[1]}` : "local";
      if (!groups.has(hostKey)) {
        const connLabel = inst.connection.label || "";
        const slashIdx = connLabel.indexOf("/");
        const hostLabel = hostKey === "local" ? "Local" : (slashIdx > 0 ? connLabel.slice(0, slashIdx) : hostKey);
        groups.set(hostKey, { hostKey, hostLabel, instances: [] });
      }
      groups.get(hostKey)!.instances.push(inst);
    }
    return [...groups.values()];
  })();

  const visibleInstances = selectedHost === "all"
    ? connectedInstances
    : hostGroups.find((g) => g.hostKey === selectedHost)?.instances || [];

  useEffect(() => {
    loadChannels();
  }, [visibleInstances.map((i) => i.id).join(",")]);

  async function loadChannels() {
    setLoading(true);
    const allRows: ChannelRow[] = [];
    await Promise.all(
      visibleInstances.map(async (inst) => {
        try {
          const data = await get<any>(`/lifecycle/${inst.id}/channels`);
          for (const ch of (data.channels || [])) {
            const accounts: any[] = ch.accounts || [];
            const running = accounts.filter((a) => a.running).length;
            const connected = accounts.filter((a) => a.connected).length;
            const lastActivity = Math.max(
              ...accounts.map((a) => Math.max(a.lastInboundAt || 0, a.lastOutboundAt || 0)),
              0,
            ) || null;
            allRows.push({
              instanceId: inst.id,
              instanceLabel: inst.connection.label || inst.id,
              channelType: ch.type,
              channelLabel: ch.label,
              accountCount: accounts.length,
              runningCount: running,
              connectedCount: connected,
              lastActivity,
            });
          }
        } catch { /* skip failed instances */ }
      }),
    );
    setRows(allRows);
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Channels</h1>
        <button onClick={loadChannels} disabled={loading} className="flex items-center gap-1.5 text-sm text-ink-2 hover:text-ink">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Host filter */}
      {hostGroups.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedHost("all")}
            className={`px-3 py-1 text-sm rounded ${selectedHost === "all" ? "bg-brand text-white" : "bg-s2 text-ink-2 hover:bg-s3"}`}
          >
            All
          </button>
          {hostGroups.map((g) => (
            <button
              key={g.hostKey}
              onClick={() => setSelectedHost(g.hostKey)}
              className={`px-3 py-1 text-sm rounded ${selectedHost === g.hostKey ? "bg-brand text-white" : "bg-s2 text-ink-2 hover:bg-s3"}`}
            >
              {g.hostLabel}
            </button>
          ))}
        </div>
      )}

      {/* Channel table */}
      {loading && rows.length === 0 ? (
        <div className="text-ink-3 text-sm">Loading channels...</div>
      ) : rows.length === 0 ? (
        <div className="text-ink-3 text-sm">No channels found on connected instances.</div>
      ) : (
        <div className="bg-s1 border border-edge rounded-card overflow-hidden shadow-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-ink-3 uppercase tracking-wider border-b border-edge">
                <th className="p-3">Instance</th>
                <th className="p-3">Channel</th>
                <th className="p-3">Accounts</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last Activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={`${row.instanceId}-${row.channelType}`}
                  onClick={() => navigate(`/instance/${row.instanceId}?tab=channels`)}
                  className="border-b border-edge/50 hover:bg-s2/50 cursor-pointer"
                >
                  <td className="p-3 text-ink-2">{row.instanceLabel}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <Radio size={14} className="text-ink-3" />
                      <span className="text-ink">{row.channelLabel}</span>
                      <span className="text-ink-3 text-xs">{row.channelType}</span>
                    </div>
                  </td>
                  <td className="p-3 text-ink-2">{row.accountCount}</td>
                  <td className="p-3">
                    <span className="text-ok">{row.connectedCount} connected</span>
                    {row.runningCount > row.connectedCount && (
                      <span className="text-warn ml-2">{row.runningCount - row.connectedCount} starting</span>
                    )}
                    {row.accountCount > row.runningCount && (
                      <span className="text-ink-3 ml-2">{row.accountCount - row.runningCount} stopped</span>
                    )}
                  </td>
                  <td className="p-3 text-ink-3">{timeAgo(row.lastActivity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
