import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { get, put, post, del } from "../lib/api";
import { useAuth, type Role } from "../hooks/useAuth";
import { ConfirmDialog } from "../components/ConfirmDialog";

interface UserInfo {
  id: number;
  username: string;
  role: Role;
  created_at: string;
  last_login: string | null;
}

interface RemoteHost {
  id: number;
  label: string;
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "privateKey";
  last_scan_at: string | null;
  last_scan_error: string | null;
}

interface ScanResult {
  discovered: number;
  added: number;
  instances: Array<{ id: string; url: string; label: string }>;
}

function defaultModelFor(p: string): string {
  switch (p) {
    case "openai": return "gpt-5.3-codex";
    case "anthropic": return "claude-opus-4-6";
    case "azure": return "gpt-5.3-codex";
    case "ollama": return "llama3";
    default: return "";
  }
}

const MODELS_BY_PROVIDER: Record<string, string[]> = {
  openai: [
    "gpt-5.3-codex", "gpt-5.3-codex-spark",
    "gpt-5.2", "gpt-5.2-codex", "gpt-5.2-pro",
    "gpt-5.1", "gpt-5.1-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini",
    "gpt-5", "gpt-5-codex", "gpt-5-pro", "gpt-5-mini",
    "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
    "gpt-4o", "gpt-4o-mini",
    "o4-mini", "o3", "o3-pro", "o3-mini", "o1", "o1-pro",
  ],
  anthropic: [
    "claude-opus-4-6", "claude-sonnet-4-6",
    "claude-opus-4-5", "claude-sonnet-4-5",
    "claude-opus-4-1", "claude-sonnet-4-0",
    "claude-haiku-4-5",
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-20241022", "claude-3-5-haiku-latest",
  ],
  azure: [
    "gpt-5.3-codex", "gpt-5.1-codex", "gpt-4o", "gpt-4o-mini", "gpt-4",
  ],
  ollama: [
    "llama3", "llama3.1", "codellama", "mistral", "mixtral", "deepseek-coder",
  ],
};

export function Settings() {
  const { t, i18n } = useTranslation();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === "admin";

  // LLM config
  const [provider, setProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-5.3-codex");
  const [baseUrl, setBaseUrl] = useState("");
  const [openaiAuth, setOpenaiAuth] = useState<"apikey" | "oauth">("apikey");
  const [hasOAuthToken, setHasOAuthToken] = useState(false);
  const [oauthExpiry, setOauthExpiry] = useState<number | null>(null);
  const [oauthStatus, setOauthStatus] = useState<"idle" | "starting" | "waiting" | "authenticating" | "complete" | "error">("idle");
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null);
  const [oauthManualUrl, setOauthManualUrl] = useState("");
  // Model list — fetched from backend + merged with presets
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
  const providerModels = (() => {
    const fetched = fetchedModels[provider] || [];
    const presets = MODELS_BY_PROVIDER[provider] || [];
    // Merge: fetched first (API-confirmed), then presets not already in fetched
    const seen = new Set(fetched);
    const merged = [...fetched];
    for (const m of presets) {
      if (!seen.has(m)) merged.push(m);
    }
    return merged;
  })();
  // Azure-specific
  const [azResource, setAzResource] = useState("");
  const [azDeployment, setAzDeployment] = useState("");
  const [azAuth, setAzAuth] = useState<"key" | "ad">("key");
  const [azTenant, setAzTenant] = useState("");
  const [azClientId, setAzClientId] = useState("");
  const [azClientSecret, setAzClientSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // User management
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("operator");

  // Remote hosts
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [showAddHost, setShowAddHost] = useState(false);
  const [hostLabel, setHostLabel] = useState("");
  const [hostAddr, setHostAddr] = useState("");
  const [hostPort, setHostPort] = useState("22");
  const [hostUser, setHostUser] = useState("ubuntu");
  const [hostAuthMethod, setHostAuthMethod] = useState<"password" | "privateKey">("password");
  const [hostCredential, setHostCredential] = useState("");
  const [scanning, setScanning] = useState<number | null>(null);
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [installing, setInstalling] = useState<number | null>(null);
  const [installMsg, setInstallMsg] = useState<string | null>(null);
  const [installStep, setInstallStep] = useState<string | null>(null);
  // Confirm dialogs
  const [confirmDeleteHost, setConfirmDeleteHost] = useState<RemoteHost | null>(null);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<UserInfo | null>(null);
  // Track which hosts have instances (instance IDs start with "ssh-{hostId}-")
  const [instanceHostIds, setInstanceHostIds] = useState<Set<number>>(new Set());

  // Digest
  const [digestType, setDigestType] = useState<"daily" | "weekly">("daily");
  const [digest, setDigest] = useState<any>(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [feishuUrl, setFeishuUrl] = useState("");
  const [tgBotToken, setTgBotToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [pushResult, setPushResult] = useState<{channel: string; success: boolean; error?: string} | null>(null);
  const [cronExpr, setCronExpr] = useState("");
  const [cronValid, setCronValid] = useState<boolean | null>(null);

  // Fetch model lists from backend, periodically refresh (matches backend 10-min TTL)
  useEffect(() => {
    const fetchModels = () => {
      get<{ modelsByProvider: Record<string, string[]> }>("/settings/models")
        .then((r) => setFetchedModels(r.modelsByProvider || {}))
        .catch(() => {});
    };
    fetchModels();
    const timer = setInterval(fetchModels, 600_000); // 10 min
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    get<Record<string, any>>("/settings").then((s) => {
      if (s.llm) {
        setProvider(s.llm.provider || "openai");
        setApiKey(s.llm.apiKey || "");
        setModel(s.llm.model || defaultModelFor(s.llm.provider));
        setBaseUrl(s.llm.baseUrl || "");
        if (s.llm.openaiOAuth?.accessToken) {
          setOpenaiAuth("oauth");
          setHasOAuthToken(true);
          setOauthExpiry(s.llm.openaiOAuth.expiresAt || null);
        }
        if (s.llm.azure) {
          setAzResource(s.llm.azure.resourceName || "");
          setAzDeployment(s.llm.azure.deploymentName || "");
          setAzAuth(s.llm.azure.auth || "key");
          setAzTenant(s.llm.azure.tenantId || "");
          setAzClientId(s.llm.azure.clientId || "");
          setAzClientSecret(s.llm.azure.clientSecret || "");
        }
      }
    }).catch(() => {});

    if (isAdmin) {
      get<UserInfo[]>("/auth/users").then(setUsers).catch(() => {});
      get<RemoteHost[]>("/hosts").then(setHosts).catch(() => {});
      // Fetch instances to detect which hosts have OpenClaw installed
      get<Array<{ id: string }>>("/instances").then((insts) => {
        const ids = new Set<number>();
        for (const inst of insts) {
          const m = inst.id.match(/^ssh-(\d+)-/);
          if (m) ids.add(parseInt(m[1]));
        }
        setInstanceHostIds(ids);
      }).catch(() => {});
    }

  }, [isAdmin]);

  const saveLlm = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const llmConfig: Record<string, unknown> = {
        provider,
        model: model || defaultModelFor(provider),
        baseUrl: baseUrl || (provider === "ollama" ? "http://localhost:11434" : undefined),
      };
      // Only send API key if not using OAuth for OpenAI
      if (provider !== "openai" || openaiAuth !== "oauth") {
        llmConfig.apiKey = apiKey || undefined;
      }
      if (provider === "azure") {
        llmConfig.azure = {
          resourceName: azResource,
          deploymentName: azDeployment,
          auth: azAuth,
          ...(azAuth === "ad" ? { tenantId: azTenant, clientId: azClientId, clientSecret: azClientSecret } : {}),
        };
      }
      await put("/settings", { llm: llmConfig });
      setMessage(t("settings.settingsSaved"));
    } catch (e: any) {
      setMessage(`${t("common.error")}: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const addUser = async () => {
    try {
      await post("/auth/users", { username: newUsername, password: newPassword, role: newRole });
      setShowAddUser(false);
      setNewUsername("");
      setNewPassword("");
      setNewRole("operator");
      get<UserInfo[]>("/auth/users").then(setUsers);
    } catch (e: any) {
      alert(e.message);
    }
  };

  const deleteUser = async (id: number) => {
    await del(`/auth/users/${id}`);
    setUsers(users.filter((u) => u.id !== id));
  };

  const changeRole = async (id: number, role: Role) => {
    await put(`/auth/users/${id}`, { role });
    setUsers(users.map((u) => u.id === id ? { ...u, role } : u));
  };

  const generateDigest = async () => {
    setDigestLoading(true);
    setDigest(null);
    try {
      const d = await post<any>("/digest/generate", { type: digestType });
      setDigest(d);
    } catch { } finally { setDigestLoading(false); }
  };

  const pushFeishu = async () => {
    if (!feishuUrl) return;
    setPushResult(null);
    try {
      const r = await post<any>("/digest/push/feishu", { type: digestType, webhookUrl: feishuUrl });
      setPushResult(r);
    } catch (e: any) { setPushResult({ channel: "feishu", success: false, error: e.message }); }
  };

  const pushTelegram = async () => {
    if (!tgBotToken || !tgChatId) return;
    setPushResult(null);
    try {
      const r = await post<any>("/digest/push/telegram", { type: digestType, botToken: tgBotToken, chatId: tgChatId });
      setPushResult(r);
    } catch (e: any) { setPushResult({ channel: "telegram", success: false, error: e.message }); }
  };

  const validateCron = async (expr: string) => {
    setCronExpr(expr);
    if (!expr.trim()) { setCronValid(null); return; }
    try {
      const r = await post<{valid: boolean}>("/digest/cron/validate", { expr });
      setCronValid(r.valid);
    } catch { setCronValid(false); }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">{t("settings.title")}</h1>

      {/* Language */}
      <div className="bg-s1 border border-edge rounded-card p-5 shadow-card mb-6">
        <h2 className="text-lg font-semibold mb-4">Language</h2>
        <div>
          <select
            value={i18n.language.startsWith("zh") ? "zh" : "en"}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </div>

      <div className="bg-s1 border border-edge rounded-card p-5 shadow-card mb-6">
        <h2 className="text-lg font-semibold mb-4">{t("settings.llmConfig")}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-ink-2 mb-1">{t("settings.providerLabel")}</label>
            <select value={provider} onChange={(e) => { setProvider(e.target.value); setModel(defaultModelFor(e.target.value)); }} disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink disabled:opacity-50">
              <option value="openai">{t("settings.openaiOption")}</option>
              <option value="anthropic">{t("settings.anthropicOption")}</option>
              <option value="azure">{t("settings.azureOption")}</option>
              <option value="ollama">{t("settings.ollamaOption")}</option>
            </select>
          </div>

          {/* Anthropic: just API key */}
          {provider === "anthropic" && (
            <div>
              <label className="block text-sm text-ink-2 mb-1">{t("settings.apiKeyLabel")}</label>
              <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
            </div>
          )}

          {/* OpenAI: API Key or OAuth */}
          {provider === "openai" && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-ink-2 mb-1">{t("settings.authenticationLabel")}</label>
                <select value={openaiAuth} onChange={(e) => setOpenaiAuth(e.target.value as "apikey" | "oauth")} disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink disabled:opacity-50">
                  <option value="apikey">{t("settings.apiKeyAuthOption")}</option>
                  <option value="oauth">{t("settings.oauthAuthOption")}</option>
                </select>
              </div>
              {openaiAuth === "apikey" && (
                <div>
                  <label className="block text-sm text-ink-2 mb-1">{t("settings.apiKeyLabel")}</label>
                  <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
              )}
              {openaiAuth === "oauth" && (
                <OpenAIOAuthSection
                  isAdmin={isAdmin}
                  hasToken={hasOAuthToken}
                  expiry={oauthExpiry}
                  status={oauthStatus}
                  error={oauthError}
                  authUrl={oauthAuthUrl}
                  manualUrl={oauthManualUrl}
                  onManualUrlChange={setOauthManualUrl}
                  onStart={async () => {
                    setOauthStatus("starting");
                    setOauthError(null);
                    setOauthAuthUrl(null);
                    try {
                      const r = await post<{ authUrl: string }>("/settings/oauth/openai/start", {});
                      setOauthAuthUrl(r.authUrl);
                      setOauthStatus("waiting");
                      // Poll for completion
                      const poll = setInterval(async () => {
                        try {
                          const s = await get<{ status: string; credentials?: any; error?: string }>("/settings/oauth/openai/status");
                          if (s.status === "complete") {
                            clearInterval(poll);
                            setOauthStatus("complete");
                            // Save credentials
                            await post("/settings/oauth/openai/save", {});
                            setHasOAuthToken(true);
                            setOauthExpiry(s.credentials?.expiresAt || null);
                            setMessage(t("settings.oauth.oauthSuccess"));
                          } else if (s.status === "error") {
                            clearInterval(poll);
                            setOauthStatus("error");
                            setOauthError(s.error || "OAuth failed");
                          }
                        } catch { /* ignore poll errors */ }
                      }, 2000);
                      // Stop polling after 2.5 minutes
                      setTimeout(() => clearInterval(poll), 150_000);
                    } catch (e: any) {
                      setOauthStatus("error");
                      setOauthError(e.message);
                    }
                  }}
                  onSubmitManual={async () => {
                    if (!oauthManualUrl.trim()) return;
                    try {
                      await post("/settings/oauth/openai/callback", { redirectUrl: oauthManualUrl });
                      setOauthManualUrl("");
                    } catch (e: any) {
                      setOauthError(e.message);
                    }
                  }}
                />
              )}
            </div>
          )}

          {/* Azure OpenAI: resource + deployment + auth */}
          {provider === "azure" && (
            <div className="space-y-3 p-3 bg-s2/50 border border-edge rounded-lg">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.azure.resourceName")}</label>
                  <input value={azResource} onChange={(e) => setAzResource(e.target.value)} disabled={!isAdmin} placeholder="my-openai" className="w-full bg-s2 border border-edge rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.azure.deploymentName")}</label>
                  <input value={azDeployment} onChange={(e) => setAzDeployment(e.target.value)} disabled={!isAdmin} placeholder="gpt-5.1-codex" className="w-full bg-s2 border border-edge rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
              </div>
              <div>
                <label className="block text-xs text-ink-2 mb-1">{t("settings.azure.authentication")}</label>
                <select value={azAuth} onChange={(e) => setAzAuth(e.target.value as "key" | "ad")} disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2 text-sm text-ink disabled:opacity-50">
                  <option value="key">{t("settings.azure.apiKeyOption")}</option>
                  <option value="ad">{t("settings.azure.azureAdOption")}</option>
                </select>
              </div>
              {azAuth === "key" && (
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.apiKeyLabel")}</label>
                  <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} type="password" disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
              )}
              {azAuth === "ad" && (
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs text-ink-2 mb-1">{t("settings.azure.tenantId")}</label>
                    <input value={azTenant} onChange={(e) => setAzTenant(e.target.value)} disabled={!isAdmin} placeholder="xxxxxxxx-..." className="w-full bg-s2 border border-edge rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-2 mb-1">{t("settings.azure.clientId")}</label>
                    <input value={azClientId} onChange={(e) => setAzClientId(e.target.value)} disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-2 mb-1">{t("settings.azure.clientSecret")}</label>
                    <input value={azClientSecret} onChange={(e) => setAzClientSecret(e.target.value)} type="password" disabled={!isAdmin} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                  </div>
                </div>
              )}
              {azResource && azDeployment && (
                <p className="text-[10px] text-ink-3 font-mono truncate">
                  {t("settings.azure.endpoint")} https://{azResource}.openai.azure.com/openai/deployments/{azDeployment}
                </p>
              )}
            </div>
          )}

          {/* Model — two-level: provider determines the model list */}
          <div>
            <label className="block text-sm text-ink-2 mb-1">{t("settings.modelLabel")}</label>
            <select
              value={providerModels.includes(model) ? model : "__custom__"}
              onChange={(e) => { if (e.target.value !== "__custom__") setModel(e.target.value); }}
              disabled={!isAdmin}
              className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink disabled:opacity-50"
            >
              {!providerModels.includes(model) && model && (
                <option value="__custom__">{model} (custom)</option>
              )}
              {providerModels.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!isAdmin}
              placeholder={t("settings.customModelPlaceholder")}
              className="w-full bg-s2 border border-edge rounded-lg px-3 py-1.5 text-xs text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50 mt-1.5"
            />
          </div>

          {/* Base URL — OpenAI compatible / Ollama only (Azure auto-builds it) */}
          {provider !== "azure" && (
            <div>
              <label className="block text-sm text-ink-2 mb-1">{t("settings.baseUrlLabel")}</label>
              <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={!isAdmin} placeholder={provider === "ollama" ? t("settings.ollamaPlaceholder") : t("settings.defaultPlaceholder")} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
            </div>
          )}
          {isAdmin && (
            <div className="flex items-center gap-3 pt-2">
              <button onClick={saveLlm} disabled={saving} className="px-4 py-2 bg-brand hover:bg-brand-light rounded-lg text-sm disabled:opacity-50">
                {saving ? t("common.saving") : t("common.save")}
              </button>
              {message && <span className={`text-sm ${message.startsWith(t("common.error")) ? "text-danger" : "text-ok"}`}>{message}</span>}
            </div>
          )}
          {!isAdmin && <p className="text-xs text-ink-3 pt-1">{t("settings.adminOnlyLlm")}</p>}
        </div>
      </div>

      {isAdmin && (
        <div className="bg-s1 border border-edge rounded-card p-5 shadow-card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{t("settings.userManagement")}</h2>
            <button onClick={() => setShowAddUser(true)} className="px-3 py-1.5 bg-brand hover:bg-brand-light rounded-lg text-sm font-medium">
              {t("settings.addUser")}
            </button>
          </div>

          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-ink-2">
                <th className="text-left py-2">{t("settings.usernameHeader")}</th>
                <th className="text-left py-2">{t("settings.roleHeader")}</th>
                <th className="text-left py-2">{t("settings.lastLoginHeader")}</th>
                <th className="text-right py-2">{t("settings.actionsHeader")}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-edge/50">
                  <td className="py-2">{u.username}</td>
                  <td className="py-2">
                    <select
                      value={u.role}
                      onChange={(e) => changeRole(u.id, e.target.value as Role)}
                      disabled={u.id === currentUser?.userId}
                      className="bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink disabled:opacity-50"
                    >
                      <option value="admin">{t("settings.adminRole")}</option>
                      <option value="operator">{t("settings.operatorRole")}</option>
                      <option value="auditor">{t("settings.auditorRole")}</option>
                    </select>
                  </td>
                  <td className="py-2 text-ink-3 text-xs">{u.last_login || t("common.never")}</td>
                  <td className="py-2 text-right">
                    {u.id !== currentUser?.userId && (
                      <button onClick={() => setConfirmDeleteUser(u)} className="text-danger hover:text-danger/80 text-xs">
                        {t("common.delete")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {showAddUser && (
            <div className="mt-4 p-3 bg-s2 rounded-card border border-edge">
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.usernameLabel")}</label>
                  <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.passwordLabel")}</label>
                  <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.roleLabel")}</label>
                  <select value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink disabled:opacity-50">
                    <option value="admin">{t("settings.adminRole")}</option>
                    <option value="operator">{t("settings.operatorRole")}</option>
                    <option value="auditor">{t("settings.auditorRole")}</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAddUser(false)} className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink">{t("common.cancel")}</button>
                <button onClick={addUser} disabled={!newUsername || !newPassword} className="px-3 py-1.5 bg-brand hover:bg-brand-light rounded-lg text-sm disabled:opacity-50">{t("common.create")}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <div className="bg-s1 border border-edge rounded-card p-5 shadow-card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">{t("settings.remoteHosts")}</h2>
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  setScanning(-1); setScanMsg(null);
                  try {
                    const results = await post<Array<{ hostId: number; label: string; discovered: number; error?: string }>>("/hosts/scan-all", {});
                    const total = results.reduce((s, r) => s + r.discovered, 0);
                    const errors = results.filter((r) => r.error);
                    setScanMsg(`Discovered ${total} instance(s)${errors.length ? `, ${errors.length} error(s)` : ""}`);
                    get<RemoteHost[]>("/hosts").then(setHosts);
                  } catch (e: any) { setScanMsg(`${t("common.error")}: ${e.message}`); }
                  finally { setScanning(null); }
                }}
                disabled={scanning !== null || hosts.length === 0}
                className="px-3 py-1.5 bg-ok hover:bg-ok/80 rounded-lg text-sm disabled:opacity-50"
              >
                {scanning === -1 ? t("settings.scanningAll") : t("settings.scanAll")}
              </button>
              <button onClick={() => setShowAddHost(true)} className="px-3 py-1.5 bg-brand hover:bg-brand-light rounded-lg text-sm font-medium">
                {t("settings.addHost")}
              </button>
            </div>
          </div>

          {scanMsg && <p className={`text-sm mb-3 ${scanMsg.includes("Error") || scanMsg.includes("No OpenClaw") ? "text-warn" : "text-ok"}`}>{scanMsg}</p>}
          {installMsg && <p className={`text-sm mb-3 ${installMsg.includes("successfully") ? "text-ok" : "text-danger"}`}>{installMsg}</p>}

          {hosts.length === 0 && !showAddHost && (
            <p className="text-sm text-ink-3">{t("settings.noHostsConfigured")}</p>
          )}

          {hosts.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-edge text-ink-2">
                  <th className="text-left py-2">{t("settings.hostLabelHeader")}</th>
                  <th className="text-left py-2">{t("settings.hostHeader")}</th>
                  <th className="text-left py-2">{t("settings.authHeader")}</th>
                  <th className="text-left py-2">{t("settings.statusHeader")}</th>
                  <th className="text-left py-2">{t("settings.lastScanHeader")}</th>
                  <th className="text-right py-2">{t("settings.actionsHeader")}</th>
                </tr>
              </thead>
              <tbody>
                {hosts.map((h) => {
                  const hasInstances = instanceHostIds.has(h.id);
                  return (
                  <tr key={h.id} className="border-b border-edge/50">
                    <td className="py-2">{h.label}</td>
                    <td className="py-2 text-ink-2">{h.username}@{h.host}:{h.port}</td>
                    <td className="py-2 text-ink-2 text-xs">{h.authMethod === "password" ? t("settings.passwordAuth") : t("settings.keyAuth")}</td>
                    <td className="py-2 text-xs">
                      {hasInstances
                        ? <span className="text-ok">{t("settings.hostRunning")}</span>
                        : h.last_scan_at
                          ? <span className="text-warn">{t("settings.hostNotInstalled")}</span>
                          : <span className="text-ink-3">{t("settings.hostUnknown")}</span>
                      }
                    </td>
                    <td className="py-2 text-xs">
                      {h.last_scan_error
                        ? <span className="text-danger" title={h.last_scan_error}>{t("common.error")}</span>
                        : h.last_scan_at
                          ? <span className="text-ink-3">{h.last_scan_at}</span>
                          : <span className="text-ink-3">{t("common.never")}</span>
                      }
                    </td>
                    <td className="py-2 text-right flex justify-end gap-2">
                      <button
                        onClick={async () => {
                          setScanning(h.id); setScanMsg(null); setInstallMsg(null);
                          try {
                            const result = await post<ScanResult>(`/hosts/${h.id}/scan`, {});
                            if (result.discovered === 0) {
                              setScanMsg(`${h.label}: No OpenClaw instances found`);
                            } else {
                              setScanMsg(`${h.label}: ${result.discovered} instance(s) found, ${result.added} added`);
                            }
                            get<RemoteHost[]>("/hosts").then(setHosts);
                            // Refresh instance mapping
                            get<Array<{ id: string }>>("/instances").then((insts) => {
                              const ids = new Set<number>();
                              for (const inst of insts) {
                                const m = inst.id.match(/^ssh-(\d+)-/);
                                if (m) ids.add(parseInt(m[1]));
                              }
                              setInstanceHostIds(ids);
                            }).catch(() => {});
                          } catch (e: any) { setScanMsg(`${h.label}: ${e.message}`); }
                          finally { setScanning(null); }
                        }}
                        disabled={scanning !== null || installing !== null}
                        className="text-ok hover:text-ok/80 text-xs disabled:opacity-50"
                      >
                        {scanning === h.id ? "..." : "Scan"}
                      </button>
                      {!hasInstances && (
                        <button
                          onClick={async () => {
                            if (installing !== null) return;
                            setInstalling(h.id); setInstallMsg(null); setScanMsg(null); setInstallStep(null);
                            let streamOk = false;
                            try {
                              const res = await fetch(`/api/lifecycle/host/${h.id}/install`, {
                                method: "POST",
                                credentials: "include",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({}),
                              });
                              if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
                              const reader = res.body.getReader();
                              const decoder = new TextDecoder();
                              let buf = "";
                              while (true) {
                                const { done, value } = await reader.read();
                                if (done) break;
                                buf += decoder.decode(value, { stream: true });
                                const lines = buf.split("\n");
                                buf = lines.pop() || "";
                                for (const line of lines) {
                                  if (!line.startsWith("data: ")) continue;
                                  try {
                                    const ev = JSON.parse(line.slice(6));
                                    if (ev.done) {
                                      streamOk = true;
                                      setInstallMsg(ev.success
                                        ? `${h.label}: OpenClaw installed successfully. Click Scan to discover instances.`
                                        : `${h.label}: Install failed`);
                                      setInstallStep(null);
                                    } else {
                                      setInstallStep(`${ev.step}: ${ev.status}${ev.detail ? ` — ${ev.detail}` : ""}`);
                                    }
                                  } catch { /* skip malformed */ }
                                }
                              }
                            } catch { /* stream disconnected */ }
                            // Fallback: if stream broke, poll install-status
                            if (!streamOk) {
                              setInstallStep(t("settings.installChecking"));
                              for (let i = 0; i < 40; i++) {
                                await new Promise((r) => setTimeout(r, 5000));
                                try {
                                  const st = await get<{ status: string; version?: string; detail?: string }>(`/lifecycle/host/${h.id}/install-status`);
                                  if (st.status === "installed") {
                                    setInstallMsg(`${h.label}: OpenClaw v${st.version} installed. Click Scan to discover instances.`);
                                    break;
                                  } else if (st.status === "installing") {
                                    setInstallStep(`${t("settings.installing")}... ${st.detail || ""}`);
                                  } else {
                                    setInstallMsg(`${h.label}: Install failed`);
                                    break;
                                  }
                                } catch { break; }
                              }
                            }
                            setInstallStep(null);
                            setInstalling(null);
                          }}
                          disabled={scanning !== null || installing !== null}
                          className="text-brand hover:text-brand-light text-xs font-medium disabled:opacity-50"
                        >
                          {installing === h.id ? (installStep || t("settings.installing")) : t("settings.installButton")}
                        </button>
                      )}
                      <button
                        onClick={() => setConfirmDeleteHost(h)}
                        className="text-danger hover:text-danger/80 text-xs"
                      >
                        {t("common.delete")}
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {showAddHost && (
            <div className="mt-4 p-3 bg-s2 rounded-card border border-edge">
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.labelLabel")}</label>
                  <input value={hostLabel} onChange={(e) => setHostLabel(e.target.value)} placeholder="Production Server" className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.hostLabel")}</label>
                  <input value={hostAddr} onChange={(e) => setHostAddr(e.target.value)} placeholder="192.168.1.100" className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.portLabel")}</label>
                  <input value={hostPort} onChange={(e) => setHostPort(e.target.value)} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
                <div>
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.usernameHostLabel")}</label>
                  <input value={hostUser} onChange={(e) => setHostUser(e.target.value)} placeholder="ubuntu" className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-ink-2 mb-1">{t("settings.authMethodLabel")}</label>
                  <select value={hostAuthMethod} onChange={(e) => setHostAuthMethod(e.target.value as "password" | "privateKey")} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink disabled:opacity-50">
                    <option value="password">{t("settings.passwordOption")}</option>
                    <option value="privateKey">{t("settings.privateKeyOption")}</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-xs text-ink-2 mb-1">{hostAuthMethod === "password" ? t("settings.passwordLabel") : t("settings.apiKeyLabel")}</label>
                  {hostAuthMethod === "password"
                    ? <input type="password" value={hostCredential} onChange={(e) => setHostCredential(e.target.value)} className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50" />
                    : <textarea value={hostCredential} onChange={(e) => setHostCredential(e.target.value)} rows={4} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" className="w-full bg-s2 border border-edge rounded-lg px-3 py-2.5 text-sm text-ink placeholder:text-ink-3 focus:border-brand transition-colors disabled:opacity-50 font-mono" />
                  }
                </div>
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowAddHost(false); setHostLabel(""); setHostAddr(""); setHostPort("22"); setHostUser("ubuntu"); setHostCredential(""); }} className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink">{t("common.cancel")}</button>
                <button
                  onClick={async () => {
                    try {
                      await post("/hosts", { label: hostLabel || hostAddr, host: hostAddr, port: parseInt(hostPort) || 22, username: hostUser, authMethod: hostAuthMethod, credential: hostCredential });
                      setShowAddHost(false); setHostLabel(""); setHostAddr(""); setHostPort("22"); setHostUser("ubuntu"); setHostCredential("");
                      get<RemoteHost[]>("/hosts").then(setHosts);
                    } catch (e: any) { alert(e.message); }
                  }}
                  disabled={!hostAddr || !hostUser || !hostCredential}
                  className="px-3 py-1.5 bg-brand hover:bg-brand-light rounded-lg text-sm disabled:opacity-50"
                >
                  {t("common.add")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Digest Configuration */}
      <div className="bg-s1 border border-edge rounded-card shadow-card mb-6">
        <h2 className="text-lg font-semibold p-4 border-b border-edge">{t("settings.digest.title")}</h2>
        <div className="p-4 space-y-4">
          {/* Generate */}
          <div className="flex items-center gap-3">
            <select
              value={digestType}
              onChange={(e) => setDigestType(e.target.value as any)}
              className="px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink"
            >
              <option value="daily">{t("settings.digest.daily")}</option>
              <option value="weekly">{t("settings.digest.weekly")}</option>
            </select>
            <button
              onClick={generateDigest}
              disabled={digestLoading}
              className="px-4 py-1.5 text-sm rounded bg-brand text-white hover:bg-brand-light disabled:opacity-40"
            >
              {digestLoading ? t("settings.digest.generating") : t("settings.digest.generateDigest")}
            </button>
          </div>

          {/* Digest result */}
          {digest && (
            <div className="bg-s2 rounded-card p-4 space-y-2">
              <h3 className="font-semibold text-ink">{digest.title}</h3>
              <p className="text-sm text-ink-2">{digest.summary}</p>
              {digest.highlights?.length > 0 && (
                <ul className="list-disc list-inside text-sm text-ink-2">
                  {digest.highlights.map((h: string, i: number) => <li key={i}>{h}</li>)}
                </ul>
              )}
              <p className="text-xs text-ink-3">{t("settings.digest.period")} {digest.period} | {t("settings.digest.generated")} {digest.generatedAt}</p>
            </div>
          )}

          {/* Push channels */}
          <div className="border-t border-edge pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-wider">{t("settings.digest.pushChannels")}</h3>

            <div className="flex items-center gap-2">
              <input
                value={feishuUrl}
                onChange={(e) => setFeishuUrl(e.target.value)}
                placeholder={t("settings.digest.feishuPlaceholder")}
                className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3"
              />
              <button onClick={pushFeishu} disabled={!feishuUrl} className="px-3 py-1.5 text-sm rounded bg-cyan/20 text-cyan hover:bg-cyan/30 disabled:opacity-40">
                {t("settings.digest.pushToFeishu")}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                value={tgBotToken}
                onChange={(e) => setTgBotToken(e.target.value)}
                placeholder={t("settings.digest.tgBotTokenPlaceholder")}
                className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3"
              />
              <input
                value={tgChatId}
                onChange={(e) => setTgChatId(e.target.value)}
                placeholder={t("settings.digest.tgChatIdPlaceholder")}
                className="w-32 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3"
              />
              <button onClick={pushTelegram} disabled={!tgBotToken || !tgChatId} className="px-3 py-1.5 text-sm rounded bg-cyan/20 text-cyan hover:bg-cyan/30 disabled:opacity-40">
                {t("settings.digest.pushToTelegram")}
              </button>
            </div>

            {pushResult && (
              <div className={`text-sm px-3 py-2 rounded ${pushResult.success ? "bg-ok-dim text-ok" : "bg-danger-dim text-danger"}`}>
                {pushResult.success ? t("settings.digest.sentTo", { channel: pushResult.channel }) : t("settings.digest.failed", { error: pushResult.error })}
              </div>
            )}
          </div>

          {/* Cron validation */}
          <div className="border-t border-edge pt-4">
            <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-wider mb-2">{t("settings.digest.schedule")}</h3>
            <div className="flex items-center gap-2">
              <input
                value={cronExpr}
                onChange={(e) => validateCron(e.target.value)}
                placeholder={t("settings.digest.cronPlaceholder")}
                className="w-64 px-3 py-1.5 text-sm font-mono bg-s2 border border-edge rounded text-ink placeholder:text-ink-3"
              />
              {cronValid !== null && (
                <span className={`text-sm ${cronValid ? "text-ok" : "text-danger"}`}>
                  {cronValid ? t("settings.digest.valid") : t("settings.digest.invalid")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-s1 border border-edge rounded-card p-5 shadow-card">
        <h2 className="text-lg font-semibold mb-2">{t("settings.about")}</h2>
        <p className="text-sm text-ink-2">{t("settings.aboutDescription")}</p>
      </div>

      {confirmDeleteHost && (
        <ConfirmDialog
          title={t("settings.deleteHost")}
          message={t("settings.deleteHostConfirm", { label: confirmDeleteHost.label, user: confirmDeleteHost.username, host: confirmDeleteHost.host })}
          onConfirm={async () => {
            await del(`/hosts/${confirmDeleteHost.id}`);
            setHosts(hosts.filter((x) => x.id !== confirmDeleteHost.id));
            setConfirmDeleteHost(null);
          }}
          onCancel={() => setConfirmDeleteHost(null)}
        />
      )}
      {confirmDeleteUser && (
        <ConfirmDialog
          title={t("settings.deleteUser")}
          message={t("settings.deleteUserConfirm", { username: confirmDeleteUser.username, role: confirmDeleteUser.role })}
          onConfirm={async () => {
            await del(`/auth/users/${confirmDeleteUser.id}`);
            setUsers(users.filter((u) => u.id !== confirmDeleteUser.id));
            setConfirmDeleteUser(null);
          }}
          onCancel={() => setConfirmDeleteUser(null)}
        />
      )}
    </div>
  );
}

function OpenAIOAuthSection({ isAdmin, hasToken, expiry, status, error, authUrl, manualUrl, onManualUrlChange, onStart, onSubmitManual }: {
  isAdmin: boolean;
  hasToken: boolean;
  expiry: number | null;
  status: string;
  error: string | null;
  authUrl: string | null;
  manualUrl: string;
  onManualUrlChange: (v: string) => void;
  onStart: () => void;
  onSubmitManual: () => void;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const isExpired = expiry ? expiry < Date.now() : false;
  const expiryText = expiry
    ? `${isExpired ? t("settings.oauth.tokenExpiredAutoRefresh") : t("settings.oauth.oauthConnected")} | ${new Date(expiry).toLocaleString()}`
    : null;

  return (
    <div className="p-3 bg-s2/50 border border-edge rounded-lg space-y-3">
      {hasToken && (
        <div className="flex items-center gap-2">
          <span className={`inline-block w-2 h-2 rounded-full ${isExpired ? "bg-warn" : "bg-ok"}`} />
          <span className="text-sm text-ink-2">
            {isExpired ? t("settings.oauth.tokenExpiredAutoRefresh") : t("settings.oauth.oauthConnected")}
          </span>
          {expiryText && <span className="text-[10px] text-ink-3 ml-auto">{expiryText}</span>}
        </div>
      )}

      {(status === "idle" || status === "error") && (
        <button
          onClick={onStart}
          disabled={!isAdmin}
          className="w-full px-4 py-2.5 bg-brand hover:bg-brand-light rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          {hasToken ? t("settings.oauth.reAuth") : t("settings.oauth.loginWithOpenai")}
        </button>
      )}

      {status === "starting" && (
        <p className="text-sm text-ink-2 animate-pulse">{t("settings.oauth.startingOauth")}</p>
      )}

      {status === "waiting" && authUrl && (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">{t("settings.oauth.openAuthUrl")}</p>

          {/* Auth URL display + actions */}
          <div className="bg-s2 border border-edge rounded-lg p-2.5">
            <p className="text-xs text-ink-3 font-mono break-all mb-2 select-all">{authUrl}</p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(authUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="flex-1 px-3 py-1.5 bg-s1 border border-edge hover:border-brand rounded-lg text-xs text-ink-2 hover:text-ink transition-colors"
              >
                {copied ? t("settings.oauth.copied") : t("settings.oauth.copyUrl")}
              </button>
              <button
                onClick={() => window.open(authUrl, "_blank", "width=600,height=700")}
                className="flex-1 px-3 py-1.5 bg-brand hover:bg-brand-light rounded-lg text-xs font-medium transition-colors"
              >
                {t("settings.oauth.openInBrowser")}
              </button>
            </div>
          </div>

          <p className="text-xs text-ink-3">{t("settings.oauth.waitingCallback")}</p>

          {/* Manual callback URL input */}
          <div className="flex gap-2">
            <input
              value={manualUrl}
              onChange={(e) => onManualUrlChange(e.target.value)}
              placeholder="http://localhost:1455/auth/callback?code=..."
              className="flex-1 bg-s2 border border-edge rounded-lg px-3 py-1.5 text-xs text-ink placeholder:text-ink-3 focus:border-brand transition-colors font-mono"
            />
            <button
              onClick={onSubmitManual}
              disabled={!manualUrl.trim()}
              className="px-3 py-1.5 bg-brand hover:bg-brand-light rounded-lg text-xs disabled:opacity-50"
            >
              {t("common.submit")}
            </button>
          </div>
        </div>
      )}

      {status === "authenticating" && (
        <p className="text-sm text-ink-2 animate-pulse">{t("settings.oauth.exchangingCode")}</p>
      )}

      {status === "complete" && (
        <p className="text-sm text-ok">{t("settings.oauth.oauthSuccess")}</p>
      )}

      {error && (
        <p className="text-sm text-danger">{error}</p>
      )}

      <p className="text-[10px] text-ink-3">
        {t("settings.oauth.oauthNote")}
      </p>
    </div>
  );
}
