# ClawSafeMng Changelog

## 2026-03-08 (Session 5) — UI 可读性 + 卸载 + 模型选择 + OAuth 改进

### Features

- **全局文字可读性修复**: 修改 CSS 设计 token `--color-ink-3` 从 `#4a5f8a` → `#6b82ad`，一处改动修复全站 200+ 处 `text-ink-3` 文字过暗问题。
- **Upgrade/Install 图标区分**: 升级按钮使用 `ArrowUpCircle`（向上），安装使用 `Download`（向下），视觉语义更准确。
- **实例卸载 (Uninstall)**: Instance Control tab 新增卸载按钮，通过 SSE 流式执行 `pkill` 停进程 → 禁用 systemd 服务 → `npm rm -g openclaw` → 验证删除。带确认对话框。
- **模型列表两级选择**: Settings LLM 配置改为 Provider → Model 两级联动下拉。切换厂商自动切换对应模型列表，不再出现选 Anthropic 还显示 GPT 模型的问题。
- **模型列表后端缓存**: 后端新增 `GET /settings/models` 端点，10 分钟 TTL 缓存，启动 5s 后首次刷新 + 定时刷新。从 OpenAI/Anthropic API 拉取实际可用模型，与静态预设合并（API 确认的模型排前面）。
- **模型列表前端定时同步**: 前端每 10 分钟从 `/settings/models` 拉取最新模型数据，与本地预设合并后展示。页面不再只在首次加载时获取，后端刷新后前端自动跟进。
- **Settings OAuth 远程适配**: OAuth 流程从直接弹窗改为先展示授权 URL，提供「Copy URL」和「Open in Browser」两个按钮。远程部署时用户可复制 URL 到本地浏览器打开，本地部署可直接弹窗，下方保留回调 URL 手动粘贴框。

### Bug Fixes

- **Settings 模型下拉与厂商不匹配**: 之前 `fetchModels` 基于已保存配置查询，切换厂商下拉不刷新模型列表。改为静态预设 + 后端缓存的 provider-keyed map。
- **实例删除功能无意义**: 曾添加实例删除功能，但因实例通过 SSH 扫描自动发现，删除后下次扫描会重新出现。已移除该功能。

### 经验教训

1. **CSS token 是全局开关**: 当某个样式问题涉及大量引用时，优先检查是否可以通过修改 token 定义一处修复，而非逐个修改 200+ 处引用。
2. **前后端缓存 TTL 对齐**: 后端 10 分钟缓存 + 前端 10 分钟轮询，保证数据最终一致。前端不能只加载一次就不刷新。
3. **模型列表合并策略**: API 拉取的模型排在前面（已确认可用），静态预设作为补充和 fallback。去重用 Set。
4. **OAuth 弹窗 vs URL 展示**: 远程部署场景下 `window.open()` 弹窗无法使用。应始终展示可操作的 URL（复制/点击），让用户自行选择打开方式。
5. **实例 vs 主机的操作粒度**: 自动发现的实例不适合做「删除」操作（会被重新发现）。卸载/删除应在主机级别操作。

---

## 2026-03-08 (Session 4) — LLM 供应商检测 + Agent 配置增强

### Features

- **Model Combobox 分组选择**: Agent 配置中模型选择器改为「Provider 筛选 + 模型搜索」双栏设计。左侧下拉选厂商 (All/OpenAI/Anthropic/DeepSeek/Google)，右侧模型列表自动按所选厂商过滤。选"All"时按厂商分组并显示粘性 header。
- **LLM 供应商自动检测**: LLM Providers 页新增已检测供应商展示。通过 SSH 扫描远程主机的 auth-profiles.json 和进程环境变量，自动发现已配置的 API key，以只读绿色 `auto` 标签展示，让用户知道哪些供应商可用。
- **OpenAI OAuth 远程适配**: OAuth 授权流程从 `window.open()` 弹窗改为显示可见 URL，支持点击链接打开和一键复制，兼容远程部署场景 (浏览器和服务器不在同一台机器)。
- **Gateway `models.list` RPC**: 新增 `fetchModelCatalog()` 方法，可获取 Gateway 运行时完整模型目录。

### Bug Fixes

- **`models.list` 误用导致假阳性**: 初版用 `models.list` RPC 检测已配置供应商，但该 RPC 返回所有内置模型 (含 amazon-bedrock、cerebras 等数十个)，即使没有配置任何 key 也会全部列出。改为扫描 auth-profiles.json + 进程环境变量。
- **SSH 非交互式 shell 看不到环境变量**: `ssh2` 的 `conn.exec()` 不走 `.profile`/`.bashrc`，`printenv` 无法看到登录 shell 中设置的环境变量。改为读取 `/proc/<pid>/environ` (OpenClaw Gateway 进程)，并以 `bash -lc` 作为 fallback。
- **供应商检测命令 exit code 非零**: Shell 命令中 `grep -q` 未匹配时返回 exit code 1，导致整个 stdout 被忽略 (代码检查 `exitCode === 0`)。修复：命令末尾追加 `\ntrue` 强制 exit 0，并移除 exitCode 检查。

### 经验教训

1. **OpenClaw API key 存储在 auth-profiles.json，不在 config 里**: API key 存储在 `~/.openclaw/agents/<agentId>/agent/auth-profiles.json` 的 `profiles` 字段下 (如 `openai-codex:default`)，**不在** `openclaw.json` 的 `models.providers` 中，也**不是**环境变量。
2. **`models.list` RPC 是完整模型目录**: 返回所有已知厂商/模型的完整列表，**不能**用来判断哪些供应商已配置 key。
3. **Auth profile key 格式**: `<provider>[-suffix]:<alias>`，如 `openai-codex:default`。提取 provider 名需：去掉 `:<alias>` → 去掉 `-codex`/`-responses` 等后缀 → 得到 `openai`。
4. **SSH 进程环境变量检测**: 非交互式 SSH exec 看不到 `.profile` 中的变量。可靠方案是读 `/proc/<pid>/environ` (NUL 分隔)，`bash -lc` 作为 fallback。
5. **Shell 命令 exit code 陷阱**: 复合 shell 命令的 exit code 是最后一条命令的 exit code。`grep -q` 未匹配返回 1 会导致整条命令"失败"。加 `; true` 或 `|| true` 确保不影响上游逻辑。
6. **远程 OAuth 弹窗不可用**: 当 ClawCtl 部署在远端服务器时，`window.open()` 打开的弹窗无法与服务端回调通信。应显示 URL 供用户手动打开和复制。

---

## 2026-03-07 (Session 3) — 生命周期管理 + 监控 + Bug 修复

### Features

- **Monitoring 页面**: 新增主机监控仪表盘，实时展示 CPU/内存/运行时间和关联实例状态。服务端 30s 缓存 + 请求去重，避免并发 SSH 连接风暴。
- **Instance Lifecycle 管理**: Control tab 支持 Start/Stop/Restart 进程控制、版本查看、配置文件查看/编辑。
- **Stream Logs**: 实时日志流，自动检测日志源 (文件 → journalctl --user → journalctl system)，SSE 格式推送。
- **Config Snapshots**: 配置快照管理，支持创建、查看、对比 (diff)、清理。
- **Agent 配置管理**: 结构化的 Agent CRUD、全局默认值设置、安全模板应用。
- **Install/Upgrade**: 主机级别的 OpenClaw 安装/升级，含 Node.js 版本检查。
- **Host Diagnose**: 远程主机诊断 (Node 版本、OpenClaw 版本、磁盘空间)。
- **ReactFlow 拓扑图**: Dashboard 新增交互式实例拓扑图 (ReactFlow)。
- **Recharts 图表**: Usage 页面新增 token 用量折线图 (Recharts)。

### Bug Fixes

- **Config 路径 `~` 不展开**: `getConfigDir()` 使用 `~` 在 SSH 非交互式 shell 的双引号中不展开，导致 `cat "~/.openclaw/openclaw.json"` 失败。改为 `$HOME`。
- **VERSION 显示 "not found"**: `openclaw --version` 在 SSH 中不稳定。改为优先使用 WebSocket 握手返回的版本号。
- **进程状态误报 "Stopped"**: `lsof` 在远端查找本地 tunnel 端口导致误判。改为 WebSocket 连接状态作为首要信号。
- **Stream Logs 无输出**: 日志文件不存在时 `tail -f` 静默挂起。改为多源检测 + journalctl --user 支持。
- **journalctl 误报**: `-- No entries --` 被 `grep -c .` 计为有内容。加 `-q` 标志修复。
- **Configuration File 空白**: 上述 `~` → `$HOME` 修复的直接体现。config-file GET 端点增加 try-catch 和前端错误展示。
- **Monitoring 加载慢**: 每次请求重新建立 SSH 连接。增加服务端 30s 缓存 + in-flight 请求去重。

### 经验教训

1. **SSH 非交互式 shell**: `~` 在双引号内不展开 (`"~/.openclaw"` → 字面 `~`)，必须用 `$HOME`。
2. **systemd --user**: OpenClaw 以用户级 systemd 服务运行，需要 `journalctl --user` 和 `systemctl --user`。
3. **WebSocket 状态优先**: 对于已连接的实例，WebSocket 连接状态比 SSH lsof 更可靠。
4. **服务端缓存模式**: SSH 密集型端点应做服务端缓存 + 请求去重，避免并发 SSH 连接。

---

## 2026-03-07 (Session 2) — 数据修复 + 交互增强

### Bug Fixes

- **Config 路径修复**: `Security.tsx` 和 `Instance.tsx` 中的 channel policies / bindings 解析路径错误 (`config.channels` → `config.parsed.channels`)，导致安全页面 Channel Policies 和 Agent Bindings 表格为空。
- **Agent 配置路径修复**: per-agent 配置在 `agents.list[]` 数组中，而非 `agents.agents{}` 对象。之前代码查 `agents.agents` 导致 tools.allow / model / thinking 全部取不到。
- **Model "default" 问题**: Agent model 显示 "default" 而非具体模型名。原因是 `agents.list` RPC 返回的 model 字段为 `"default"`，需要从 config 的 `agents.defaults.model.primary` 或 per-agent `model.primary` 解析。

### Features

- **Thinking 深度列**: Agent 表格新增 Thinking 列，显示每个 agent 的思考深度 (low/high/etc)，从 config 的 `agents.defaults.thinkingDefault` 或 per-agent 覆盖解析。
- **Tools 白名单解析**: 从 `agents.list[].tools.allow` 解析每个 agent 的工具白名单，不再全部显示 "all"。bhpc agent 正确显示 `read, exec, process, feishu_doc...` 等。
- **会话消息分页**: `chat.history` RPC 支持 `limit` 参数 (1-1000, 默认 200)。前端初始加载 50 条，"Load more" 逐步加载更多 (50→200→800→1000)。
- **消息加载指示器**: 点击会话后显示 "Loading messages..." 直到消息加载完成。
- **消息正倒序**: 会话消息支持 ↑Old / ↓New 排序切换，方便快速查看最新或最早消息。
- **Sessions 排序**: Instance 详情页的 Sessions tab 新增排序切换按钮 (↓New / ↑Old)。

### 经验教训

1. **OpenClaw config 结构**: 配置通过 Gateway 的 `config.read` RPC 返回，格式为 `{ path, exists, raw, parsed: {...} }`。实际配置在 `parsed` 下。
2. **Agent 配置在 list 而非 agents**: `parsed.agents.list[]` 是 agent 数组，每个 agent 有 `id, name, workspace, tools, model` 等字段。`parsed.agents.agents` 不存在或为空。
3. **Model 解析链**: Agent model 优先级: per-agent `list[].model.primary` → `defaults.model.primary` → RPC 返回值。
4. **Thinking 解析链**: per-agent `list[].thinkingDefault` → `defaults.thinkingDefault` → per-model `defaults.models[key].params.thinking`。
5. **Tools 解析链**: RPC `agents.list` 的 `tools.allow` (通常为空) → config `agents.list[].tools.allow`。
6. **认证 cookie 名**: 登录 cookie 名为 `clawctl_token`，非 `auth_token`。

---

## 2026-03-07 (Session 1) — MVP 上线 + 5 大功能

### Features

- **Sessions 实例过滤**: 实例 > 4 个时自动切换为下拉选择，否则使用水平可滚动标签。
- **Sessions 排序 + 别名**: 正序/倒序切换按钮。会话有 displayName 时优先显示，key 作为副标题。
- **Instance 详情页**: Dashboard 实例卡片可点击进入 `/instance/:id`，含 Overview/Sessions/Config/Security 4 个 Tab。
- **工具诊断模糊匹配**: 精确 → 子串模糊匹配 + 工具目录交叉检查。
- **Security 页面增强**: Channel Policies 表 (dmPolicy/groupPolicy/allowFrom 等) + Agent Bindings 表。
- **版本修复**: 从 SSH 二进制获取版本 (`openclaw --version`) 作为主源，Gateway handshake 作为 fallback。
- **Usage 页面**: 全局汇总 + 每实例 token 用量表。
- **强制退出**: SSH tunnel `destroy()` + 3s 超时 `process.exit(1)` 防止僵尸进程。
