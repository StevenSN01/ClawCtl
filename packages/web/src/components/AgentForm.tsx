import { useState } from "react";
import { X, Plus, Shield } from "lucide-react";

export interface AgentFormValues {
  id: string;
  model: string;
  thinkingDefault: string;
  toolsAllow: string[];
  execSecurity: string;
  workspace: string;
  workspaceOnly: boolean;
  fsWorkspaceOnly: boolean;
}

interface AgentFormProps {
  values: AgentFormValues;
  onChange: (values: AgentFormValues) => void;
  models: string[];
  modelsByProvider: Record<string, string[]>;
  defaultModel: string;
  defaultThinking: string;
  isNew: boolean;
  onApplyTemplate: () => void;
}

const EXEC_SECURITY_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "allowlist", label: "Allowlist" },
  { value: "full", label: "Full" },
  { value: "disabled", label: "Disabled" },
];

const PROVIDER_LABELS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  google: "Google",
  other: "Other",
};

export function AgentForm({ values, onChange, modelsByProvider, defaultModel, defaultThinking, isNew, onApplyTemplate }: AgentFormProps) {
  const [toolInput, setToolInput] = useState("");
  const [modelSearch, setModelSearch] = useState("");
  const [showModelDropdown, setShowModelDropdown] = useState(false);
  const [providerFilter, setProviderFilter] = useState("");

  const set = <K extends keyof AgentFormValues>(key: K, val: AgentFormValues[K]) =>
    onChange({ ...values, [key]: val });

  const addTool = () => {
    const tool = toolInput.trim();
    if (tool && !values.toolsAllow.includes(tool)) {
      set("toolsAllow", [...values.toolsAllow, tool]);
    }
    setToolInput("");
  };

  const removeTool = (tool: string) => {
    set("toolsAllow", values.toolsAllow.filter((t) => t !== tool));
  };

  const providerKeys = Object.keys(modelsByProvider);
  const searchTerm = (modelSearch || values.model).toLowerCase();
  const filteredGroups = Object.entries(modelsByProvider)
    .filter(([provider]) => !providerFilter || provider === providerFilter)
    .map(([provider, list]) => ({
      provider,
      label: PROVIDER_LABELS[provider] || provider,
      models: list.filter((m) => m.toLowerCase().includes(searchTerm)),
    }))
    .filter((g) => g.models.length > 0);

  return (
    <div className="space-y-4">
      {/* Agent ID */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Agent ID</label>
        {isNew ? (
          <input
            value={values.id}
            onChange={(e) => set("id", e.target.value)}
            placeholder="e.g. my-agent"
            className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
        ) : (
          <div className="px-3 py-2 text-sm bg-s2/50 border border-edge rounded text-ink-2 font-mono">{values.id}</div>
        )}
      </div>

      {/* Model: provider filter + combobox */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">
          Model
          {!values.model && defaultModel && <span className="ml-1 text-ink-3">(default: {defaultModel})</span>}
        </label>
        <div className="flex gap-2">
          <select
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
            className="w-28 shrink-0 px-2 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
          >
            <option value="">All</option>
            {providerKeys.map((k) => (
              <option key={k} value={k}>{PROVIDER_LABELS[k] || k}</option>
            ))}
          </select>
          <div className="relative flex-1">
            <input
              value={modelSearch || values.model}
              onChange={(e) => { setModelSearch(e.target.value); set("model", e.target.value); setShowModelDropdown(true); }}
              onFocus={() => setShowModelDropdown(true)}
              onBlur={() => setTimeout(() => setShowModelDropdown(false), 200)}
              placeholder={defaultModel || "Select model..."}
              className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
            />
            {showModelDropdown && filteredGroups.length > 0 && (
              <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-s1 border border-edge rounded shadow-card max-h-60 overflow-auto">
                {providerFilter ? (
                  /* Single provider selected — flat list, no headers */
                  filteredGroups[0]?.models.map((m) => (
                    <button
                      key={m}
                      onMouseDown={() => { set("model", m); setModelSearch(""); setShowModelDropdown(false); }}
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-s2 text-ink"
                    >
                      {m}
                    </button>
                  ))
                ) : (
                  /* All providers — grouped with headers */
                  filteredGroups.map((g) => (
                    <div key={g.provider}>
                      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-ink-3 bg-s2/50 sticky top-0">{g.label}</div>
                      {g.models.map((m) => (
                        <button
                          key={m}
                          onMouseDown={() => { set("model", m); setModelSearch(""); setShowModelDropdown(false); }}
                          className="w-full text-left px-3 py-1.5 text-sm hover:bg-s2 text-ink"
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Thinking */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">
          Thinking Level
          {!values.thinkingDefault && defaultThinking && <span className="ml-1">(default: {defaultThinking})</span>}
        </label>
        <input
          value={values.thinkingDefault}
          onChange={(e) => set("thinkingDefault", e.target.value)}
          placeholder={defaultThinking || "e.g. on, off, 1024, budget_tokens..."}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
        />
      </div>

      {/* Tools Allow */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Allowed Tools</label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.toolsAllow.map((tool) => (
            <span key={tool} className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-cyan-dim text-cyan">
              {tool}
              <button onClick={() => removeTool(tool)} className="hover:text-danger"><X size={12} /></button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={toolInput}
            onChange={(e) => setToolInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTool(); } }}
            placeholder="Add tool name..."
            className="flex-1 px-3 py-1.5 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan"
          />
          <button onClick={addTool} className="px-2 py-1.5 text-sm rounded bg-s2 border border-edge text-ink hover:bg-s3">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Exec Security */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Exec Security</label>
        <select
          value={values.execSecurity}
          onChange={(e) => set("execSecurity", e.target.value)}
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink focus:outline-none focus:border-cyan"
        >
          {EXEC_SECURITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Workspace */}
      <div>
        <label className="block text-xs text-ink-3 mb-1">Workspace Directory</label>
        <input
          value={values.workspace}
          onChange={(e) => set("workspace", e.target.value)}
          placeholder="e.g. /home/ubuntu/proj"
          className="w-full px-3 py-2 text-sm bg-s2 border border-edge rounded text-ink placeholder:text-ink-3 focus:outline-none focus:border-cyan font-mono"
        />
      </div>

      {/* Workspace restrictions */}
      <div className="space-y-2">
        <label className="block text-xs text-ink-3">Workspace Restrictions</label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={values.fsWorkspaceOnly}
            onChange={(e) => set("fsWorkspaceOnly", e.target.checked)}
            className="rounded border-edge"
          />
          <label className="text-sm text-ink">File system — workspace only</label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={values.workspaceOnly}
            onChange={(e) => set("workspaceOnly", e.target.checked)}
            className="rounded border-edge"
          />
          <label className="text-sm text-ink">Exec/Patch — workspace only</label>
        </div>
      </div>

      {/* Apply Template button */}
      <button
        onClick={onApplyTemplate}
        className="flex items-center gap-1.5 text-sm text-brand hover:text-brand-light"
      >
        <Shield size={14} /> Apply Permission Template
      </button>
    </div>
  );
}
