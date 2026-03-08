import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { get } from "../lib/api";

interface TopProcess {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  command: string;
}

interface HostMetrics {
  hostId: number;
  label: string;
  host: string;
  cpu: { loadAvg1m: number; loadAvg5m: number; cores: number; usageEstimate: number };
  memory: { used: number; total: number; percent: number };
  uptime: number;
  instances: { id: string; label: string; status: string; sessionCount: number }[];
  topProcesses?: TopProcess[];
  error?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

function progressColor(percent: number): string {
  if (percent >= 80) return "bg-danger";
  if (percent >= 60) return "bg-warn";
  return "bg-ok";
}

function statusDot(status: string) {
  const color = status === "connected" ? "bg-ok" : status === "connecting" ? "bg-warn" : "bg-danger";
  return <span className={`inline-block w-2 h-2 rounded-full ${color} mr-1.5`} />;
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-ink-2">{label}</span>
        <span className="font-medium">{percent.toFixed(1)}%</span>
      </div>
      <div className="w-full h-3 bg-s2 rounded overflow-hidden">
        <div
          className={`h-full rounded transition-all ${progressColor(percent)}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function HostCard({ m }: { m: HostMetrics }) {
  const { t } = useTranslation();

  if (m.error) {
    return (
      <div className="bg-s1 border border-edge rounded-card p-4 shadow-card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg font-semibold">{m.label}</h3>
          <span className="text-xs text-ink-3">{m.host}</span>
        </div>
        <p className="text-danger text-sm mb-3">{t("monitoring.failed")} {m.error}</p>
        <InstanceList instances={m.instances} />
      </div>
    );
  }

  return (
    <div className="bg-s1 border border-edge rounded-card p-4 shadow-card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">{m.label}</h3>
        <span className="text-xs text-ink-3">{m.host}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <ProgressBar
            percent={m.cpu.usageEstimate}
            label={`CPU (${m.cpu.cores} cores)`}
          />
          <p className="text-xs text-ink-3 mt-1">
            {t("monitoring.loadLabel")} {m.cpu.loadAvg1m.toFixed(2)} / {m.cpu.loadAvg5m.toFixed(2)}
          </p>
        </div>
        <div>
          <ProgressBar
            percent={m.memory.percent}
            label={`Memory (${formatBytes(m.memory.used)} / ${formatBytes(m.memory.total)})`}
          />
        </div>
        <div>
          <p className="text-sm text-ink-2 mb-1">{t("monitoring.uptime")}</p>
          <p className="text-2xl font-bold">{formatUptime(m.uptime)}</p>
        </div>
      </div>

      <InstanceList instances={m.instances} />
      {m.topProcesses && m.topProcesses.length > 0 && (
        <TopProcessList processes={m.topProcesses} />
      )}
    </div>
  );
}

function TopProcessList({ processes }: { processes: TopProcess[] }) {
  const { t } = useTranslation();

  return (
    <div className="border-t border-edge pt-3 mt-3">
      <p className="text-xs text-ink-3 mb-2 uppercase tracking-wide">{t("monitoring.topProcesses")}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-ink-3">
            <th className="text-left py-1 pr-2">{t("monitoring.pidHeader")}</th>
            <th className="text-left py-1 pr-2">{t("monitoring.userHeader")}</th>
            <th className="text-right py-1 pr-2">{t("monitoring.cpuHeader")}</th>
            <th className="text-right py-1 pr-2">{t("monitoring.memHeader")}</th>
            <th className="text-left py-1">{t("monitoring.commandHeader")}</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((p) => (
            <tr key={p.pid} className="hover:bg-s2/50">
              <td className="py-1 pr-2 text-ink-3">{p.pid}</td>
              <td className="py-1 pr-2 text-ink-2">{p.user}</td>
              <td className={`py-1 pr-2 text-right font-medium ${p.cpu >= 80 ? "text-danger" : p.cpu >= 50 ? "text-warn" : "text-ink"}`}>
                {p.cpu.toFixed(1)}
              </td>
              <td className={`py-1 pr-2 text-right font-medium ${p.mem >= 50 ? "text-danger" : p.mem >= 30 ? "text-warn" : "text-ink"}`}>
                {p.mem.toFixed(1)}
              </td>
              <td className="py-1 text-ink-2 truncate max-w-[200px]">{p.command}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InstanceList({ instances }: { instances: HostMetrics["instances"] }) {
  const { t } = useTranslation();

  if (instances.length === 0) {
    return <p className="text-ink-3 text-sm">{t("monitoring.noInstances")}</p>;
  }
  return (
    <div className="border-t border-edge pt-3">
      <p className="text-xs text-ink-3 mb-2 uppercase tracking-wide">{t("monitoring.instancesLabel")}</p>
      <div className="space-y-1">
        {instances.map((inst) => (
          <div key={inst.id} className="flex items-center justify-between text-sm">
            <span className="flex items-center">
              {statusDot(inst.status)}
              <span className="text-ink-2">{inst.label}</span>
            </span>
            <span className="text-ink-3">{inst.sessionCount} {t("common.sessions")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Monitoring() {
  const { t } = useTranslation();
  const [hosts, setHosts] = useState<HostMetrics[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHosts = useCallback(() => {
    get<HostMetrics[]>("/monitoring/hosts")
      .then((data) => { setHosts(data); setError(null); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchHosts();
    const timer = setInterval(fetchHosts, 30_000);
    return () => clearInterval(timer);
  }, [fetchHosts]);

  const totalSessions = hosts.reduce((s, h) => s + h.instances.reduce((a, i) => a + i.sessionCount, 0), 0);
  const totalInstances = hosts.reduce((s, h) => s + h.instances.length, 0);
  const connectedInstances = hosts.reduce((s, h) => s + h.instances.filter((i) => i.status === "connected").length, 0);

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-bold mb-6">{t("monitoring.title")}</h1>
        <div className="flex items-center justify-center py-20 text-ink-3 text-sm">
          <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" /></svg>
          {t("monitoring.loadingMetrics")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">{t("monitoring.title")}</h1>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-s1 border border-edge rounded-card p-4 shadow-card">
          <p className="text-sm text-ink-2">{t("monitoring.hosts")}</p>
          <p className="text-2xl font-bold">{hosts.length}</p>
        </div>
        <div className="bg-s1 border border-edge rounded-card p-4 shadow-card">
          <p className="text-sm text-ink-2">{t("monitoring.instances")}</p>
          <p className="text-2xl font-bold">{connectedInstances}/{totalInstances}</p>
        </div>
        <div className="bg-s1 border border-edge rounded-card p-4 shadow-card">
          <p className="text-sm text-ink-2">{t("monitoring.totalSessions")}</p>
          <p className="text-2xl font-bold">{totalSessions}</p>
        </div>
        <div className="bg-s1 border border-edge rounded-card p-4 shadow-card">
          <p className="text-sm text-ink-2">{t("monitoring.status")}</p>
          <p className="text-2xl font-bold">{error ? t("common.error") : t("common.ok")}</p>
        </div>
      </div>

      {error && (
        <p className="text-danger text-sm mb-4">{t("monitoring.failedToLoad")} {error}</p>
      )}

      {/* Per-host cards */}
      <div className="space-y-4">
        {hosts.map((h) => (
          <HostCard key={h.hostId} m={h} />
        ))}
      </div>

      {!loading && hosts.length === 0 && (
        <p className="text-ink-3 text-center py-8">{t("monitoring.noRemoteHosts")}</p>
      )}
    </div>
  );
}
