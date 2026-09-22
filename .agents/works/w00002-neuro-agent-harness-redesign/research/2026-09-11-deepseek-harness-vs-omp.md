# 运行时候选对照：DeepSeek Harness (dsh) 与 Oh My Pi (OMP)

> 材料类型：开发者点名研究（2026-09-11）。**不是** Proposal、Spec 或 Task 合同，不构成运行时选择决定。
> 用途：Issue #193 后续「Runtime 候选」阶段的输入之一。
> 本次未安装、未运行任何一方，未调用任何真实 Provider/Model。事实与推论分开；来源访问日期均为 2026-09-11。

## 结论摘要

1. 两者不是同一类东西。dsh 是 DeepSeek 官方开源的**完整 agent harness 平台**（插件化应用 + 多前端形态 + 子进程 SDK）；OMP 是 can1357 维护的**coding agent 产品**（Pi 的 fork，TUI 优先、电池全包）。
2. 两者都是 MIT、TypeScript 主体，但运行环境与集成方式完全不同：
   - **dsh**：Node `^22.19.0 || >=24.0.0`（pnpm 单仓），`0.1.5-rc` developer preview，官方明示会破坏性变更；集成方式是**插件挂进 dsh 进程**或**子进程 SDK/ACP**，没有"把内核嵌进宿主进程"的公开路径。
   - **OMP**：Bun `>=1.3.14`；`@oh-my-pi/pi-coding-agent` 已到 `18.1.17`；提供四种入口（TUI、`omp -p`、进程内 Node SDK、RPC/ACP），带 ~80k 行 Rust 原生核心。
3. `[推论]` 对 #193 的直接含义：两者都不是"宿主中立、可进程内嵌的运行内核库"。dsh 更接近整个产品平台；OMP 的 SDK 是"全包引擎嵌入"，但受 Bun 运行时约束且带大量产品语义。若要对照，应把它们放在"架构参照 / 宿主竞争者 / 可包装产品"三类角色，而不是"现成依赖"。
4. `[事实]` 本仓库当前依赖的 "pi" 是 `@earendil-works/pi-*`（pi-mono 谱系：npm 元数据 author 为 Mario Zechner、maintainer 含 badlogic，仓库 `github.com/earendil-works/pi`；本仓库固定 `0.80.6`，llmlint 为 `^0.75.4`，npm 最新 `0.85.1`）。OMP 是同一 Pi 谱系的 fork（其 README 指向 `badlogic/pi-mono` 旧地址）——这正是 Issue #193 原始需求"把 pi 的依赖换成 oh-my-pi 的依赖"的对象关系。
5. `[事实]` dsh 甚至自带上游适配器 `@deepseek-ai/dsh-llm-pi-ai`：把 pi-ai 当 LLM adapter 挂进自己的 seam。说明"pi-ai 作 LLM 层、外部 harness 作运行层"是一条已被第三方产品验证的组合方式。

## 对照表（2026-09-11 快照）

| 维度 | dsh（deepseek-ai/deepseek-harness） | OMP（can1357/oh-my-pi） |
| --- | --- | --- |
| 定位 | DeepSeek 官方开源 agent harness 平台；"Everything is a Plugin" | "Coding agent with the IDE wired in"；Pi 的 fork，TUI 优先 |
| 许可 | MIT | MIT（含第三方与 vendored 代码声明） |
| 语言/运行时 | TypeScript；Node `^22.19.0 \|\| >=24.0.0`；pnpm 11.7 单仓 | TypeScript + ~80k 行 Rust（N-API addon）；Bun `>=1.3.14` |
| 版本 | 仓库 `0.1.5-rc.2`；npm 最新 `0.1.5-rc.1`；developer preview | `18.1.17`（npm；语义化大版本节奏） |
| 产品形态 | `dsh web`（浏览器 UI，127.0.0.1:3080）、headless、`--profile sdk`（JSON-RPC）、sdk-minimal、acp、Electron 桌面、Python SDK | TUI、`omp -p` 单次、Node SDK、`omp --mode rpc`、`omp acp` |
| 包拓扑 | 每个 capability 一个 npm 包（`dsh-tool-fs`、`dsh-session-persistence-jsonl`、`dsh-llm-deepseek`…，约 70 个直接依赖）；Cordis 插件树组织 | 16 个 workspace 包（pi-ai / pi-agent-core / pi-coding-agent / pi-tui / pi-natives…）+ 9 个 Rust crate |
| 扩展机制 | Cordis 插件 + 配置层（profile / bundle / `cordis.patch.yml`）；"no privileged core" | TypeScript 扩展模块 + `.omp/` 命令与 skills + 插件市场/npm |
| Session/持久化 | append-only `SessionEvent` 日志是真相源；JSONL 版本化生成（`session.vN.jsonl[.zstd]`）+ zstd + 相邻迁移链；fork/resume/replay/transcript 全部从日志派生；projection seam | `SessionManager`（内存或磁盘）；session 导出/分享/fork/resume；记忆后端 local/Hindsight/Mnemopi（SQLite） |
| Provider | `dsh-llm-deepseek`、`dsh-llm-pi-ai`、replay 与 mock server | 60+ providers、9 个模型角色路由、自定义 OpenAI 兼容、fallback 链与凭据轮换 |
| 工具面 | 工具注册表 + guarded pipeline（`tools/pre-execute`/`execute`/`post-execute` 瀑布） | 31 个内建工具（read/write/edit/ast_edit/bash/eval/lsp/debug/browser/computer…） |
| 沙箱/审批 | OS 沙箱（bubblewrap/Landlock/Seatbelt）+ sandbox/approval seam + 审批策略包 | 权限提示（含 ACP `session/request_permission`）、工具卡片预览、`--tools` 钉选 |
| 宿主集成 | 插件（进程内，但宿主是 dsh 自己的进程）/ SDK JSON-RPC 子进程 / ACP / Electron 内嵌 | 进程内 Node SDK（`createAgentSession`）/ RPC / ACP / 子进程 |
| 治理实践 | Agent Notes（格式/归档/i18n/链接门禁）+ 数十个 verify-* 与 CI gates（node-compat、Windows、publint、jscpd） | CONTRIBUTING/CHANGELOG/Bazel+Cargo+多平台 CI |
| 社区快照 | 219,414 stars / 25,957 forks / 0 open issues（issues 似乎未启用） | 30,560 stars / 3,143 forks / 2,735 open issues |
| 安全记录 | CVE-2026-82533（三方 OX 报道；官方 GitHub advisories 页当前"无已发布公告"；报道称 `0.1.2-alpha.1` 已修复） | 本次未检索到对应 CVE 报道（≠ 无漏洞） |

## 分维度详述

### dsh：平台化的"插件即产品"

- `[事实]` Cordis 是底座：插件贡献 services、typed events 与可逆 effects；模型适配器、工具注册表、session 日志、agent loop 自身都是插件。profile（web/headless/sdk/sdk-minimal/acp）+ bundle + patch 文件构成启动时的插件树；`dsh --profile web --dump-config` 可打印整棵树。（`docs/architecture.md`）
- `[事实]` 事件域三分：**session events**（durable，追加到日志并经 `session/event` 广播）、**agent events**（`agent/*` 携带 live Agent）、**capability events**（`fs/*`、`tools/*`、`telemetry/*` 等 seam 事件）。`agent/pre-step`、`agent/request`、`llm/stream`、`tools/*` 是 waterfall（监听者必须 `next()` 委派）。
- `[事实]` Session log 是唯一真相："Model-visible means logged" 是运行时不变式；模型历史由 `deriveMessages()` 从日志投影；`assistant/message` 内嵌生成它的完整 timed stream；fork/resume/telemetry/persistence 全部从 durable settlement 派生。
- `[事实]` 存档是版本化的：v0 用 `session.jsonl[.zstd]`，v1+ 用 `session.vN.jsonl[.zstd]`；读取时选择最高 canonical generation 并按相邻迁移链迁移；提交过的 generation 路径永不被改名或删除；每个迁移包只拥有一个 `vN -> vN+1` 步骤。
- `[事实]` Capability seam 三角色：Service Definition / Service Provider / Consumer；filesystem 与 subprocess 共享一个 execution world，把两者指向远端 sandbox 即整体移动 Bash、PTY、LSP，无需 fork provider。
- `[事实]` 应用入口被强约束：所有 Node 应用从 `dsh` CLI + 命名 profile 启动；`verify-application-entrypoints` 拒绝绕过 `dsh` 的入口。桌面版把同一运行时打进签名资源，用 `dsh-app://` 协议与 renderer 通信，不开本地 Web 端口。
- `[事实]` 工程化程度极高：根脚本有数十个 `verify-*`（文档链接、package 不变量、publint、类型等价、agent note 格式、mermaid、i18n 配对…）与 `run-gates.ts` 分级 CI；文档有 en/zh 双份并有配对门禁。`[推论]` 这套"设计记录 + 机械门禁"的做法，可作 #193 "按 spec 编程"的参考样本。
- `[事实]` 依赖清单印证插件化：`@deepseek-ai/dsh` 直接依赖约 70 个 `dsh-*` 包，覆盖 tools（fs/bash/pwsh/jobs/subagent/skill/workflow/ralph…）、session（`-session`、`-session-query`、`-session-projection`、`-session-persistence-jsonl`、`-session-reference`、`-session-checkpoint-policy`）、llm（`-llm-deepseek`、`-llm-pi-ai`、`-llm-replay`、`-llm-mock-server`）、sandbox（`-sandbox-local`、`-fs-sandbox`、`-pwsh-sandbox`）、compaction、hooks（`-hooks-claude-code`、`-hooks-codex`）、mcp-client 等。
- `[事实]` 运行模式（官方产品页）：Standard（全工具）、Code（模型生成代码编排多轮工具调用）、Minimal（只保留 shell + 文件编辑，用于评测模型）、Creator（在内存中检视运行时、试制 Cordis 插件）。
- `[事实]` 安全事件：OX Security 报道 CVE-2026-82533（CWE-807，CVSS 9.4）：本地 agent 控制 API 无鉴权、仅凭客户端 `Host` 头判断信任；沙箱限制文件写入但放行 loopback，于是沙箱内 agent 用一条 shell 命令把自身 session 升级为 `danger-full-access` 并关闭审批；若端口可达，还能远程控制 agent 并导出全部会话。报道称 0.1.2-alpha.1 修复，8 月 30 日复测通过。`[事实]` 官方仓库 security advisories 页当前显示"There aren't any published security advisories"。
- `[推论]` 这起事件对 #193 的直接教训不依赖 dsh：**"沙箱限制什么"与"控制面信任谁"必须分开设计**；把控制 API 暴露在本机回环上而只信 `Host` 头，会让被沙箱约束的 agent 自行提权。

### OMP：产品化的"电池全包"coding agent

- `[事实]` 谱系：Pi（Mario Zechner）的 fork；README 自述"rewritten as a coding-first surface: sessions, subagents, slash commands, extensions"。Rust 核心约 80k 行（`pi-natives`、`pi-shell`、`pi-ast`、`pi-iso`、`pi-voice`、`pi-walker`、`pi-edit`）+ vendored `brush-core` bash 与 58+ 个进程内命令实现。
- `[事实]` 四入口矩阵：交互 TUI；`omp -p` 单次；**Node SDK**（`@oh-my-pi/pi-coding-agent` 导出 `ModelRegistry`、`SessionManager`、`createAgentSession`、`discoverAuthStorage`，session 发 typed events）；RPC（`omp --mode rpc`，NDJSON；`--mode rpc-ui` 输出 `extension_ui_request` 卡片）；ACP（`omp acp`，写入经 `session/request_permission` 门禁）。
- `[事实]` npm 包元数据：`engines: { bun: ">=1.3.14" }`（未声明 node）；`main` 指向 `./src/index.ts`（直接分发 TS 源）+ `dist/types`；解包 ~49 MB、3122 文件。`[推论]` "嵌进 Node 进程"目前实际要求 Bun 运行时；宿主若是 Node 栈需要额外评估（本仓库主应用就是 Node 侧）。
- `[事实]` 产品级能力清单（README）：60+ providers / 31 工具 / 14 LSP 操作 / 28 DAP 操作；持久 Python 与 Bun eval 内核可回调 agent 工具；TTSR（时间旅行流规则）在模型跑偏时中止流、注入规则并原地重试；subagent 隔离 worktree + Agent Hub 观察与 steering；advisor 模型每轮旁听；`/collab` 通过 relay 共享实时会话；`web_search` 23 个后端 + 站点结构化提取；`/review` 输出 P0–P3 结论；hashline 编辑（内容哈希锚点，陈旧文件在污染前拒绝）；把 PR/issue 等 16 种 internal scheme 统一到 `read`/`grep` 路径下。
- `[事实]` 多包领域拆分（Issue #193 关心的"拆领域"现实样本）：`@oh-my-pi/pi-ai`（多 provider LLM 客户端）、`pi-agent-core`（agent runtime）、`pi-coding-agent`（CLI+SDK 主体）、`pi-tui`（差分渲染终端 UI）、`pi-natives`（Rust N-API）、`pi-catalog`（模型目录）、`pi-mnemopi`（SQLite 记忆）、`pi-metaharness`（benchmark 运行器）、`snapcompact`、`omptype`、`pi-utils`、`pi-wire`、`collab-web`、`browser-relay`、`stats`、`typescript-edit-benchmark`。
- `[事实]` 构建与发布：Bazel + Cargo + Bun；`bun setup`/`bun dev`；macOS/Linux/Windows（含 musl 与 Nix 说明）；发布物含原生二进制路径。`[推论]` 打包与运行约束比纯 TS 库重，宿主若只想借用其中一层（如 pi-ai），需自行处理 Bun/原生依赖边界。

### 与本仓库现状的关系

- `[事实]` 本仓库依赖：根与 `packages/neuro-book` 固定 `@earendil-works/pi-agent-core@0.80.6`、`@earendil-works/pi-ai@0.80.6`；`packages/llmlint` 依赖 `@earendil-works/pi-ai@^0.75.4` 与 `@notnotype/neuro-agent-harness@workspace:*`。
- `[事实]` `@earendil-works/pi-ai` 最新为 `0.85.1`（Node `>=22.19.0`）；本仓库的 `0.80.6` 落后一个小版本段。
- `[推论]` Issue #193 的原始命题"把 pi 的依赖换成 oh-my-pi 的依赖"，落到事实层面是：**同谱系 fork 之间的替换**（`@earendil-works/pi-*` → `@oh-my-pi/*`），运行时要先从 Node 迁到 Bun；包名、导出面与运行时约束都不同，需要一次真实的接口对照（本次未做）。
- `[推论]` dsh 与本仓库不同源，但它的依赖清单显示它通过 `dsh-llm-pi-ai` 复用 pi-ai；对 NeuroBook 而言，"保留 pi-ai 作 LLM 层 + 换运行层"与"整体换成 OMP"是两条不同粒度的路线。

## 对 #193 的含义（研究推论，非决定）

1. **运行时候选阶段应把两者当作不同候选类别**：dsh ≈ 可整装/可插件扩展的完整平台（集成=插件或子进程）；OMP ≈ 可产品化替换的 coding agent（集成=SDK/RPC/ACP）。都不提供"宿主中立内核库"这一形态。
2. **可作为架构参照的具体做法**（供 Spec/设计阶段取用）：
   - dsh：日志即真相 + 版本化生成与迁移链；capability seam 三角色；事件域三分（durable / live / capability）；waterfall 扩展点与"no privileged core"；"所有应用从同一 CLI + profile 入口"的入口收敛；以及它那套设计记录 + 机械门禁的工程习惯。
   - OMP：按领域拆包（llm / agent-core / ui / natives 分层）；原生替换热点路径（grep/shell/AST）；多入口矩阵（交互/单次/进程内/RPC/ACP）；工具命名空间 + 设备分层（`xd://`）。
3. **作为宿主案例**：OMP 自身就是 001 中"CLI coding agent"宿主的成熟形态；dsh 的 headless/sdk/acp 形态对应"嵌入式宿主"的多条交付方式。两者都可用于检验 001 画像的失败成本清单是否完整。
4. **安全门禁**：任何基于 dsh 的方案，应把"版本 ≥ 0.1.2-alpha.1 + 控制面鉴权方式 + 沙箱网络命名空间"列为准入条件；任何基于 OMP 的方案，应评估 Bun 运行时约束与包体量。

## 未验证与边界

- 未安装、未运行 dsh 或 OMP；未做嵌入/子进程实验；未跑任何真实 Provider/Model；未测性能、稳定性与资源占用。
- 星标/issue 数据为 2026-09-11 快照；dsh 仓库版本（`0.1.5-rc.2`）与 npm 已发布版本（`0.1.5-rc.1`）不一致。
- CVE 细节来自第三方（OX Security）报道与公开页面；官方 advisories 页无已发布公告，建议以官方渠道复核修复范围。
- "未检索到 CVE"仅指本次检索范围，不代表 OMP 无已知漏洞。

## 来源

- dsh：`https://github.com/deepseek-ai/deepseek-harness`（含 README）；`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/package.json`；`.../docs/architecture.md`；`.../.agents/notes/README.md`；`https://registry.npmjs.org/@deepseek-ai/dsh/latest`；`https://www.deepseek.com/harness/en/`；`https://github.com/deepseek-ai/deepseek-harness/security/advisories`。
- dsh 安全：`https://www.ox.security/blog/cve-2026-82533-deepseek-harness-ai-agent-sandbox-escape/`（第三方）。
- OMP：`https://github.com/can1357/oh-my-pi`（含 README）；`https://github.com/can1357/oh-my-pi/tree/main/packages`；`https://registry.npmjs.org/@oh-my-pi/pi-coding-agent/latest`。
- 本仓库依赖：根 `package.json`、`packages/neuro-book/package.json`、`packages/llmlint/package.json`；`https://registry.npmjs.org/@earendil-works/pi-ai/latest`。
