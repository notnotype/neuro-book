# Agent 模型执行面提案

状态：accepted

## 问题

NeuroBook 当前把 Agent Profile、Pi 模型和 Workflow Agent 调用连接在同一条 Harness 路径上。Leader 可以从 Agent Catalog 选择 `writer`、`researcher`、`adhoc` 等 Profile，并从 Agent-visible Models 清单选择 `provider/model`；Workflow 也可以通过 `wf.agents.*` 创建并调用真实 Harness Agent。

这条路径不能完整表达另外两类需求：

1. 不创建 Agent Session、不进入工具循环的 completion，例如 compaction 摘要、Session summary、记忆抽取和 Workflow 中的文本或 JSON 处理步骤；
2. 由外部 Runtime 持有 Agent Loop 的 headless 调用，例如 `claude -p`。它只支持 Claude CLI 自己的模型族，并拥有独立的工具、MCP、权限、Session、取消和副作用语义。

如果继续把三类调用压入 `provider/model` 或统一 `Execution Target`，Leader、Workflow 和系统配置会得到一个看似统一、实际容易误用的接口：Claude 模型可能被塞进 Pi 模型清单，无工具模型可能被送进要求原生工具调用的 Profile，headless 的磁盘副作用可能被误认为受 NeuroBook Harness 审批保护，Workflow 恢复时还可能重复执行外部副作用。

本提案整理三类调用的产品边界、Catalog、授权、结构化输出与 Workflow 重放语义。它不定义逐文件实现计划。

## 目标与非目标

### 目标

1. 保留三套类型化调用面：NeuroBook Harness Agent、completion、headless Agent，不建立一个压平语义的统一执行目标。
2. 让 Leader 最终选择任务使用哪类调用；用户可以通过 Profile 中的持久指导或当前会话中的临时指示教 Leader 如何选择。
3. 为三类调用分别提供可见 Catalog 或 recipe，并在各自执行边界校验模型、工具、权限、输出和副作用策略。
4. 让用户或 Agent 编写的 Workflow 能先派发 Harness 调研子代理，再调用 completion 或无外部副作用的 headless activity，并消费其文本或结构化结果。
5. 让 `session-summary`、`compaction-summary`、`memory-extract` 等系统用途由配置文件直接选择 completion 或 headless recipe，不启动 Leader 做路由。
6. 让无原生工具能力的模型可以通过提示与宿主结果适配产生严格校验的结构化输出，同时不把这种能力谎报为原生 tool calling。
7. 保留当前 Harness Agent 的 Session、Profile、工具审批、`report_result`、模型覆盖和 Workflow journal 行为。

### 非目标

- 不建立替 Leader 自动挑选“最佳模型”的中心路由器。
- 不建立统一 `Execution Target`、统一 Session 或统一工具语义。
- 不把 `smol`、`default`、`slow` 等模型角色与执行方式绑定。
- 不把 Claude CLI 模型加入现有 Pi Agent-visible Models 清单。
- 首期不实现“动作 JSON → 宿主执行工具 → 回填结果 → 再调用模型”的模拟工具循环。
- 首期不允许会写文件、执行任意 Bash 或产生其他外部写副作用的 headless recipe 进入 Workflow。
- 不设计新的 Workflow 脚本语言。
- 不在本提案中执行真实 Provider/Model、Claude CLI、发布、部署或数据库迁移。

## 当前行为与证据

### Harness Agent 与现有 Catalog

当前 Leader Profile 注入的 Agent Catalog 只列出可创建的公开 Profile；Workflow Catalog 同时注入 Agent-visible Models，并明确该模型清单是 `invoke_agent({model})` 与 `run_workflow({model})` 的唯一 allowlist。参见 [`profile-dsl.ts`](../../server/agent/profiles/profile-dsl.ts) 的 `defaultAgentCatalogText()` 与 `defaultWorkflowCatalogText()`。

`invoke_agent` 的 `model` 只作为一次 Harness invocation 的 Pi 模型覆盖，并由 `assertVisibleModel()` 校验；它不改变 Session 默认模型。参见 [`agent-collaboration-tools.ts`](../../server/agent/tools/agent-collaboration-tools.ts) 与 [`agent-visible-models.ts`](../../server/agent/harness/agent-visible-models.ts)。

Workflow 已经支持 `wf.agents.create/acquire/invoke`。参与者模型进入 activity 参数和 Session `model_change`，后续调用仍由 `HarnessAgentPort` 进入 NeuroBook Harness。参见 [`agent-extension.ts`](../../../nb-workflow/src/agent-extension.ts)、[`workflow-agent-port.ts`](../../server/agent/workflow/workflow-agent-port.ts) 与 [`workflow-demo-service.ts`](../../server/agent/workflow/workflow-demo-service.ts)。这条路径只能表示 Harness Agent，不能表示无 Session completion 或外部 headless Agent。

### Completion

当前 compaction 摘要已经使用 `tracedCompleteSimple()` 执行无工具 completion，但模型仍来自当前 Session，没有独立 recipe 或系统用途配置。参见 [`compaction.ts`](../../server/agent/harness/compaction.ts) 的 `generateCompactionSummary()`。

`nb-memory` 已声明宿主注入的 `LlmPort.chat()`，并允许调用方表达期望 JSON 输出；NeuroBook server 尚未接入该端口。参见 [`ports.ts`](../../../nb-memory/src/ports/ports.ts)。

Pi 的无工具调用只返回模型消息。当前仓库没有通用的“文本 JSON → 解析 → Schema 严格校验”completion 结果适配器。现有结构化结果来自 Harness 的 `report_result` 工具，因此不能直接套到无工具 completion。

### Headless

Leader Profile 已有 `bash` 工具。该工具在授权 Workspace 根运行命令，支持超时、取消、后台 Job、输出截断和后续消息回流，并使用 owned process 终止进程树。参见 [`file-tools.ts`](../../server/agent/tools/file-tools.ts) 的 `createBashTool()` 与 `runBash()`。因此 Leader 直接运行 `claude -p` 不需要新增专用 Agent 工具。

但是 `bash` 接收任意命令字符串。注入 Catalog 可以教 Leader 使用预设命令，却不能强制模型 allowlist、cwd、工具、MCP、权限模式或 Session 策略。只要调用者 Profile 仍拥有任意 `bash`，Headless Catalog 就是指导和选择面，不是不可绕过的安全边界。

Claude Code 官方文档将 `claude -p` 定义为非交互 Agent SDK 调用，它保留 Agent Loop、工具和上下文管理，而不是普通模型 Provider。`--tools` 限制可见的内置工具，`--allowedTools` 只控制哪些工具免确认；`--tools` 不影响 MCP 工具。`--max-turns` 限制 agentic turns，不承诺底层只有一次模型请求。参见 [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) 与 [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)。

### Workflow Activity 与重放

Workflow 内核已经为外部能力定义 `ActivityExecutor` 和版本化 `callAction/query` 接口；成功 activity 的参数指纹与结果进入 journal，journal 命中后返回原结果而不重新调用宿主。失败 activity 不进入 journal，恢复时可能重新执行。参见 [`ports.ts`](../../../nb-workflow/src/ports.ts)、[`runtime.ts`](../../../nb-workflow/src/runtime.ts) 与 [`types.ts`](../../../nb-workflow/src/types.ts)。

当前 NeuroBook Workflow 宿主只装配 Session、Agent 和只读 Workspace 端口，没有装配生产级 `ActivityExecutor`。因此 `wf.complete(...)` 和类型化 headless activity 目前都不存在；它们不能只增加脚本 API，必须先建立宿主执行、注册、授权、取消和结果持久化边界。参见 [`workflow-demo-service.ts`](../../server/agent/workflow/workflow-demo-service.ts) 的 `WorkflowRunner` 装配。

### 与旧 Task 136 的关系

[Task 136](../../.agents/tasks/136-one-shot-model-providers/README.md) 记录了早期“一次性对话模型 + `claude-cli` Pi ProviderStreams adapter”方案。其无工具模型能力声明、带工具 Profile fail-fast 和系统用途选择仍是有效问题证据；把完整 `claude -p` 压成 Pi Provider 的 D3 方案不再是目标架构，因为它会丢失 headless 的允许工具、MCP、权限、Session 和副作用语义。

Task 136 保留为历史调研记录。本提案取代其中尚未实施的长期方案；实现前必须基于本提案建立新的 planned Spec 和 Task，不能直接按旧 D3 开工。

## 采用方案

### 三套独立调用面

#### Harness Agent

Harness Agent 保持现有调用面：

- Leader：`create_agent` / `invoke_agent`；
- Workflow：`wf.agents.create/acquire/invoke`；
- Catalog：Agent Profile Catalog；
- 模型选择：现有 Pi Agent-visible Models；
- 执行合同：NeuroBook Profile、Session、ReAct 循环、工具审批、`report_result`、取消与 usage。

`writer`、`researcher`、`adhoc` 等继续是真正的 NeuroBook Agent Profile。Claude CLI recipe 和 completion recipe 不伪装成 Harness Profile。

#### Completion

Completion 新增独立调用面：

- Leader：类型化 completion 工具；
- Workflow：由版本化 activity 支撑的类型化 completion API；
- 系统：由配置选择 recipe 的 completion runner；
- Catalog：Completion Recipe Catalog；
- 执行合同：单次无工具 completion 执行，不创建 Agent Session，不进入工具循环。

这里的“单次”指一次 completion 执行合同，不限制 Provider 内部网络重试、流式请求实现或其他不可见传输细节。

Completion recipe 至少声明：

- 可寻址 recipe key 与适用场景；
- 可用模型及显式 model allowlist；
- prompt/system 指令策略；
- 文本或结构化输出合同；
- token、超时、取消与有限重试策略；
- trace/usage 投影；
- 调用者 Profile 的可见性与执行权限。

首期结构化输出只通过特殊提示生成 JSON，并由宿主解析和执行 Schema 严格校验。解析或校验失败是明确失败；不得把未校验文本当作结构化结果，也不得因此把模型能力声明改成原生 tools 支持。Provider 原生结构化输出能力不在首期合同内，后续需要时另行评估。

#### Headless Agent

Headless 采用混合方式：

- Leader：不新增专用 headless Agent 工具；向获准 Profile 注入 Headless Recipe Catalog，由 Leader 使用现有 `bash` 启动 `claude -p`；
- Workflow：通过版本化、宿主注册的类型化 headless activity 调用，不向脚本开放任意 shell；
- 系统：通过类型化 CLI runner 调用，不依赖 Agent `bash`；
- Catalog：独立 Headless Recipe Catalog；
- 模型选择：每个 recipe 自己的 Claude 模型 alias/full-id allowlist，不进入 Pi Agent-visible Models。

Headless recipe 至少分别声明：

- recipe key、用途、CLI backend 与版本/能力前置条件；
- model allowlist；
- `availableTools`，对应 `--tools`，决定内置工具是否可见；
- `preapprovedTools`，对应 `--allowedTools`，决定哪些工具免确认；
- MCP 可见性、禁用或显式配置策略；
- permission mode；
- cwd、附加目录与 Project 配置加载策略；
- Session 是临时、持久还是可恢复；
- 输出格式、可选 JSON Schema、usage 与 trace；
- token/费用预算、agentic turn 上限、墙钟超时与取消；
- 外部副作用等级与适用调用面。

`availableTools` 与 `preapprovedTools` 不能合并成一个“允许工具”字段。`--tools ""` 也不能被描述为关闭 MCP；需要隔离时必须另行声明 MCP 与 customization policy。使用订阅 OAuth 的隔离 recipe 可以选择 `--safe-mode` 并显式限制工具；不能默认使用不读取订阅 OAuth 的 `--bare`。

Leader 的 Headless Catalog 不构成硬授权，这是保留任意 `bash` 的既有后果。真正的安全根仍是调用者 Profile 是否拥有 `bash`。Workflow 和系统的类型化 runner 必须在执行边界强制 recipe，不允许调用者覆盖 execution kind、工具/权限、Session、输出或副作用合同；模型覆盖也只能来自 recipe 的 backend-specific allowlist。

### Catalog、Profile 与选择权

三套 Catalog 分别授权和校验：

| 调用面 | Leader 看到的选择面 | 模型/策略门禁 |
|---|---|---|
| Harness Agent | Agent Profile Catalog + Pi Agent-visible Models | Profile 创建权限、工具权限、`assertVisibleModel()` |
| Completion | Completion Recipe Catalog | recipe 可见性、执行权限、模型 allowlist、输出合同 |
| Headless | Headless Recipe Catalog | Leader 路径由 Profile 的 `bash` 权限兜底；Workflow/系统路径强制 recipe 与模型/工具策略 |

调用者 Profile 分别参与 Catalog 可见性、选择指导和执行授权。Catalog 裁剪不是安全边界；每个类型化工具、Workflow activity 和系统 runner 仍须在实际执行处校验权限与 recipe 引用。

Leader 拥有最终选择权。系统不另建“最佳模型路由器”，只向 Leader提供经 Profile 裁剪的事实与使用说明。用户可以在 Profile 中持久记录“何时优先 researcher + `@smol`、何时使用 Claude headless”等指导，也可以在当前会话临时覆盖偏好；临时指示不能扩大 Profile 或 recipe 的执行权限。

### 系统用途配置

`session-summary`、`compaction-summary`、`memory-extract` 等用途由配置直接选择调用面和 recipe，不启动 Leader，也不复用 Leader 的 `bash`。用途名称必须按真实调用点区分，不能用含糊的 `summary` 同时指代 Session summarizer 与 compaction summary。

配置缺省时保持当前行为：例如 compaction 继续使用当前 Session 模型，Session summarizer 继续使用现有 Harness 路径。用户已经配置 recipe 后，引用缺失、失效、未授权或与用途输出合同不兼容时必须 fail closed，不静默切换到另一类调用或另一模型。

系统 headless runner 与 completion runner 必须消费各自的正式 recipe；不得创建绕过 Catalog model allowlist、工具限制或输出校验的第二条“内部快捷路径”。

### Workflow API 与重放

Workflow 保留现有 Harness Agent API，并新增两类有类型能力：

1. completion activity；
2. 无外部写副作用的 headless activity。

两类能力必须通过生产级 `ActivityExecutor` 注册为版本化 activity，并由类型化 Workflow API 包装。具体 API 名称在 Spec 中确定；脚本不能接收任意命令模板，也不能直接访问 shell。

Activity 参数必须包含足以稳定识别执行合同的 recipe、模型选择、prompt/input、输出 Schema identity 和允许的调用选项；这些参数进入 activity fingerprint。成功结果进入 journal，resume/rerun 命中时返回原结果，不重新调用模型或 CLI。

失败结果不进入成功 journal，恢复时可以重试。Provider 或 CLI 已成功、但 Workflow 尚未持久化结果时发生崩溃，恢复可能重复调用和重复计费。因此本提案不承诺 exactly-once。

首期只有可证明无外部写副作用的 headless recipe 能进入 Workflow。含 Write、Edit、任意 Bash、不可幂等网络写入或其他外部状态变更能力的 recipe 必须在 activity 发出前 fail closed。若未来要支持可写 headless，必须另行 Proposal 定义持久执行状态、unknown outcome、幂等键或人工恢复流程。

用户或 Agent 创建的 Workflow 可以组合以下步骤：

1. 用 `wf.agents.*` 派发一个或多个 Harness 调研 Agent；
2. 把调研结果交给 completion 做摘要、分类或结构化提取；
3. 可选调用无外部写副作用的 headless recipe 做复杂研究或综合；
4. 将已校验结果传给后续 Harness Agent 或 Workflow 代码。

## 备选方案和取舍

### 统一 Execution Target

把 Profile、executor、model、tool policy、output policy 和 session policy合并为统一 target，再让 Leader 或 Workflow 选择。

不采用。三类调用的 Session、工具、取消、副作用和授权合同不同；统一 target 会迫使调用方构造非法组合，或把大量运行期分支隐藏在一个宽泛接口中。

### 把 `claude-cli` 注册成 Pi Provider

把 `claude -p` 包装成 `ProviderStreams`，作为 `provider/model` 出现在 Pi 模型列表中。

不采用为完整 headless 路径。该方案最多适合受限的 completion-like CLI transport，却不能忠实表达 Claude Code 的 Agent Loop、允许工具、MCP、权限、Session 和副作用。系统若需要 Claude completion-like 调用，也应通过 Headless/Completion recipe 的类型化 runner 表达，而不是把完整 headless 能力伪装成 Pi 模型。

### 全部使用专用 headless 工具

Leader、Workflow 和系统全部通过同一个专用 headless 工具或 runner 调用。

不采用首期方案。它可以强制 recipe 策略，但 Leader 已有具备超时、取消和后台 Job 的 `bash`，新增 Leader 工具不能提供新的基础可达能力。类型化 runner 只放在确实需要安全强制和 journal 语义的 Workflow/系统边界。

### 只提供 Headless Catalog，不实现类型化 runner

Leader 通过 `bash` 使用 Claude，Workflow 和系统不直接支持 headless。

不采用。它无法满足配置驱动的 `summary`、`compaction`、`memory-extract`，也无法让 Workflow 直接选择无副作用 headless。Catalog 不能替代服务代码和 Workflow activity 的执行入口。

### 新模型调用不进入 Workflow journal

Workflow 每次恢复都重新调用 completion/headless。

不采用。这会让结果漂移、重复计费，并破坏现有 Harness Agent activity 的重放心智。采用“成功结果 journaled、失败可重试、不承诺 exactly-once”的现有内核语义。

## 数据、接口、安全、迁移、发布与回滚影响

### 数据与持久化

本提案不要求数据库 migration。预计新增配置中的 Completion/Headless recipe 与系统用途引用，以及 Workflow journal 中新的 activity kind 和结果。具体 schema、敏感字段处理和向后兼容规则进入 planned Spec。

Recipe 不保存明文凭据。Claude CLI 登录态、API key、代理变量和 Provider 认证继续由各自既有秘密边界提供；日志、trace、activity 公共投影和错误信息不得泄漏 prompt 正文、token、OAuth 文件或环境变量。

### 接口

预计新增：

- Completion Recipe Catalog 与 Leader completion 工具；
- Headless Recipe Catalog 注入；
- completion/headless 的服务 runner；
- 生产级 Workflow `ActivityExecutor` 装配；
- 版本化 completion/headless activity 与类型化 Workflow API；
- 按系统用途选择调用面和 recipe 的配置合同。

现有 `invoke_agent`、`run_workflow({model})`、`wf.agents.*` 与 Pi Agent-visible Models 保持 Harness 语义，不扩展为 Claude/headless/completion 的通用入口。

### 安全

所有模型和 CLI 输出均为不可信输入。结构化输出必须解析并通过 Schema 校验；不得把结果直接传入 shell、文件路径、SQL、HTML 或任意工具执行。

Leader 的 headless 路径继承 `bash` 的既有权限。Catalog 只能减少误用，不能限制一个已经获准执行任意 shell 的 Profile。需要硬隔离的 Profile 不应获得 `bash`，而应只获得类型化工具；这不在首期范围内。

Workflow 与系统 runner 必须：

- 在宿主边界解析 recipe 并校验调用者/用途权限；
- 使用参数数组和 stdin 传 Prompt，不拼接可执行 shell 字符串；
- 固定或验证 cwd 与附加目录 containment；
- 限制输入、输出、token、预算、agentic turns 和墙钟时间；
- 将 AbortSignal 传到受管子进程并终止进程树；
- 校验实际加载的工具、MCP 或 CLI capability 与 recipe 一致，不满足时 fail closed；
- 不对不同执行方式做静默 fallback。

### 迁移与兼容

现有配置缺省时行为不变；现有 Agent-visible Models 仍只解析 Pi `provider/model`。新增 recipe 和系统用途配置应为增量字段，只有用户显式选择后生效。

配置中的 recipe、模型或 Profile 引用失效时明确失败。不得为了兼容保留把 Claude 模型塞进 Pi visibleModels 的 alias，也不得把旧 `claude-cli` Provider 方案作为静默备用路径。

### 发布

Claude CLI 路径依赖宿主安装、版本能力和认证。Desktop/本机环境可以使用本机订阅 OAuth；不具备 CLI 或登录态的 Docker、CI、GHCR 环境必须在执行前给出明确不可用错误，不能假装回落到另一个 Provider。

真实 Claude CLI、真实 Provider、浏览器和发布验收需要单独授权。本提案接受不等于授权执行这些外部调用。

### 回滚

实现前可通过将 Proposal 标记为 `rejected` 或 `superseded` 撤回。实现后回滚应删除新增 recipe/use-purpose 引用并恢复原有 Harness/Session 模型行为；已写入的 Workflow activity 记录仍须可读取和展示，不得因移除执行器而破坏历史 Run。

配置已显式选择新 recipe 时，回滚必须由 migration 或用户配置变更完成，不能在运行期静默回落。

## 对 Spec 的预期改动

本 Proposal 已接受，只批准创建 planned Spec 和实现 Task，不直接成为产品合同。预计至少拆分以下可独立验收的 capability；正式 capability map 与文件名在 Spec 阶段确认：

| 目标 capability | 主要合同 | 依赖 |
|---|---|---|
| Completion recipes | Catalog、Leader 工具、system runner、文本/JSON 输出、Schema 校验、模型 allowlist、取消与失败 | 当前 Pi completion 与配置模型解析 |
| Headless recipes | Catalog、Leader bash 指导、system/Workflow CLI runner、工具/MCP/权限/Session/副作用策略 | owned process、配置与 Profile 授权 |
| Workflow model activities | 生产级 ActivityExecutor、版本化 completion/headless activity、journal/replay、unknown outcome 边界 | Completion recipes、Headless recipes |
| System purpose execution | `session-summary`、`compaction-summary`、`memory-extract` 的配置选择、缺省兼容与 fail-closed | Completion recipes、Headless recipes |

各 planned behavior Spec 必须按 [`docs/specs/README.md`](../../../../docs/specs/README.md) 的九段合同写清：

- 输入：recipe key、模型覆盖 allowlist、prompt/input、Schema identity、调用者 Profile 或系统用途；
- 输出：文本、结构化数据、usage、trace 和可观察错误；
- 状态：Harness Session 与无 Session 调用的边界、Workflow journal 与恢复；
- 副作用：网络请求、子进程、配置、历史 Run 和文件/外部状态禁止项；
- 失败：无能力、无认证、无 CLI、无权限、Schema 失败、超时、取消、崩溃窗口与未知结果；
- 验收：Leader 三套调用面、Workflow 组合脚本、系统用途配置、Catalog/allowlist 隔离和 replay 行为。

Harness Agent 当前规范需要同步澄清：Pi Agent-visible Models 只服务 Harness；Completion/Headless Catalog 不通过该列表授权。现有冻结 Reference 的迁移规则保持不变，不为本提案复制第二份 Agent Runtime 正文。

## 决策记录

- 2026-08-21｜决策者：用户｜结论：最终选择权属于 Leader；系统用途由配置直接选择，不建立中心自动路由器。
- 2026-08-21｜决策者：用户｜结论：Catalog 像 Skill/Agent Catalog 一样注入，用户可通过 Profile 持久指导或当前会话临时指导 Leader；实际执行权限仍由宿主校验。
- 2026-08-21｜决策者：用户｜结论：不建立统一 Execution Target，改用 Harness Agent、completion、headless 三套独立调用面与 Catalog。
- 2026-08-21｜决策者：用户｜结论：模拟工具调用不属于首期；无工具模型首期只做文本或提示词 JSON + Schema 严格校验。
- 2026-08-21｜决策者：用户｜结论：headless 采用混合方式，Leader 使用 `bash + Headless Recipe Catalog`，Workflow/系统使用类型化 CLI runner/activity。
- 2026-08-21｜决策者：用户｜结论：Workflow 只重放无外部写副作用的新增调用；completion 和只读 headless 成功结果进入 journal，首期禁止可写 headless recipe。
- 2026-08-21｜决策者：用户｜结论：接受本提案，状态为 `accepted`；接受只授权后续 planned Spec 与 Task，不授权直接实施或真实模型调用。
