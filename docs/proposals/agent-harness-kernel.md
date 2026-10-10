---
schema: nbook.proposal/v1
status: draft
created: 2026-10-10
decided: null
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# Agent harness 内核：会话、模型角色、Profile、模型与凭据、配置与运行时

## 问题

NeuroBook v2 要把 Agent 做成内置插件，开发者 2026-10-03 定下以 `nb-harness` 为基础（[v2 重建](neuro-book-v2-rebuild.md)）。现有 `nb-harness` 是验证 OMP 能否当底座的原型（[w00002 t07 审查](../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t07-harness-specs-and-docs/walkthroughs/001-review-2026-10-01.md)），撑不起这个角色：

1. **一次调用的结果不可判断。** 模型报错、缺 API key、中途中止，`turn` 都正常返回空文本，日志里也没有原因。
2. **会话日志不能恢复对话。** 日志只记了纯文本，模型上下文只在内存里；用同一份日志新建 harness，模型看不到之前的对话。
3. **没有排队、审批与等待。** 运行中不能插话或追加输入；工具一律直接执行，`edit` 不经确认就能写 cwd 之外的文件。
4. **没有模型角色与配置。** 模型只能用 `provider/model` 字符串指定，API key 直接从环境变量读，没有 OAuth 订阅。
5. **Profile 只是一棵提示词树。** 没有工具声明、模型选择和设置；渲染出的消息被 harness 丢弃。
6. **形状不适合插件化。** 工具直接实现 OMP 的 `AgentTool`（带回调，不满足插件公开 API 的约束），内置文件工具直接写磁盘（违反“写项目文件经项目实例”的已定决定）。

开发者 2026-10-10 决定：先做内核，不做插件，设计时考虑插件 API；最基础的是会话、模型角色、Profile、模型适配器、配置、Agent 运行时（ReAct 循环、工具定义、工具审批），第一批就包含排队；做完这些再做内置读写工具。

## 目标与非目标

### 目标

1. `nb-harness` 成为不依赖插件系统的领域包：离开 NeuroBook 应用也能装配、运行与测试（llmlint、评测脚本是已知的第二类使用者）。
2. 每次调用（invocation）有明确的结果：完成、等待用户、中止、失败（带分类的原因），并写进会话日志。
3. 会话日志是对话的真相：进程重启后从日志重建模型上下文，继续对话或回答挂起的审批。
4. 运行中可以插话（`steer`）与追加输入（`followup`），语义沿用旧应用的黑盒合同。
5. 工具有统一的定义方式，声明形状满足插件公开 API 的约束，内置工具与将来插件贡献的工具走同一条路。
6. 工具审批采用 OMP 的能力等级与审批模式；询问期间会话进入等待，可以跨进程重启后继续应答。
7. 按模型角色取模型，遵守已接受的 [模型角色合同](model-roles-contract.md)：未绑定即报错，没有回落。
8. 模型通信直接使用 OMP `pi-ai` 支持的全部协议与 OAuth 订阅；凭据由 OMP 的凭据管理负责，存储位置由使用方给出，内核不直接读环境变量。
9. 配置有明确的 schema 与校验；内核只消费配置快照，不关心配置存在哪里。
10. 给插件留好落脚点：插件层的扩展（工具贡献、项目注入、存储、界面事件）都能落到内核的接口上，内核本身不认识插件。

### 非目标

- 不做 `nbook.agent` 插件、HTTP 或远程服务接口、界面（随后的插件阶段做）。OAuth 登录的交互界面同样留给插件阶段，内核只提供登录流程的接口。
- 第一批不做：上下文压缩、子代理、Skills、Workflow 接入、附件与图片、会话分支与重试树、请求追踪、`report_result` 结构化结果、`request_user_input`。
- 不做 headless 调用面（例如 `claude -p`）与 completion 调用面；三套调用面的划分见旧应用已接受的 [Agent 模型执行面提案](../../packages/neuro-book-legacy/docs/proposals/agent-model-execution-surfaces.md)，本稿只覆盖 harness Agent。
- 不兼容旧应用的会话文件格式与 Profile SDK；旧应用只作行为参照。
- 不做多进程同时写同一会话的互斥：单写者由使用方保证（插件阶段按 [Session Store 租约](../archived/specs/agent/session-store-lease.md) 的经验另定）。

## 当前行为与证据

- **现有 nb-harness**：约 1000 行，三个包（`nb-session`、`nb-profile`、`nb-harness`）；缺陷清单见 t07 审查记录。t07 为它写的五份现状 Spec 与包文档已于 2026-10-10 删除。
- **旧应用的 Agent Runtime**（`packages/neuro-book-legacy/server/agent/`，非测试代码约 5.6 万行）是行为参照：
  - [Harness 黑盒合同](../../packages/neuro-book-legacy/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md)：`prompt`、`continue`、`steer`、`followup` 四种调用方式，`Idle`、`Running`、`WaitingUser`、`Aborting` 四种状态，操作矩阵与错误矩阵（受理错误与运行错误分开，运行错误必须写成终态生命周期）。本稿的状态机、排队与错误分类以它为底稿。
  - 工具定义（`server/agent/tools/types.ts`）：TypeBox 参数、`approvalRequired`、`mutatesWorkspace`（只读模式下自动加写审批）、`userInputRequest`；审批通过后才真实执行，拒绝时写一条拒绝结果。
  - Profile（[profile-guide](../../packages/neuro-book-legacy/assets/reference/agent/profile-guide.md)、[context](../../packages/neuro-book-legacy/assets/reference/agent/context.md)）：`defineAgentProfile` 声明 manifest、参数 schema、工具集、`context(ctx)`；`HistorySet` 是只写入一次的稳定历史前缀，`AppendingSet` 每轮追加。
- **已定的拓扑决定**（[ADR 0024](../adr/0024-multi-instance-runtime-topology.md)、[拓扑设计第 9 节](multi-instance-runtime-topology.md)）：Agent 会话在服务端实例，可同时操作多个项目；工具声明带 `scope: "project"`，项目参数由 harness 注入、经租约路由；写项目文件经项目实例。会话数据位置、打开项目前是否确认、空闲超时留给 nb-harness 设计。
- **插件公开 API 的约束**（[`runtime.plugin-api`](../specs/runtime/plugin-api.md)）：方法返回 Promise、参数与结果可结构化克隆、错误为结构化结果、处理函数接受 `signal`。
- **OMP 18.2.5 的 Agent 循环**（`@oh-my-pi/pi-agent-core`）有两层：
  - 无状态循环函数 `agentLoop(prompts, context, config)` 与 `agentLoopContinue(context, config)`：给定上下文与配置，跑完一次调用，返回事件流与新消息。排队经回调交给调用方（`getSteeringMessages`、`hasSteeringMessages`、`getFollowUpMessages`），还有 `beforeToolCall`（可拦截、改参数）、`afterToolCall`、`transformContext`、`syncContextBeforeModelCall`。
  - `Agent` 类（约 1900 行）：在内存里持有消息、系统提示、工具、模型和两个队列，提供 `prompt`、`continue`、`steer`、`followUp`、`abort`、`subscribe`、`replaceMessages`；处理忙碌判断（`AgentBusyError`）、中止与模型错误转成带 `stopReason` 的助手消息、中止后把未送达的排队消息放回队列、从未配对工具调用的末尾恢复执行。OMP 自己的会话层 `AgentSession`（`pi-coding-agent`，约 1.27 万行）就是持有一个 `Agent`、在事件里把消息写进会话文件。
- **OMP 的审批**（本机 omp 18.4.6，`pi-coding-agent/src/tools/approval.ts` 与工具包装层）：
  - 工具声明能力等级 `approval`：`read`、`write`、`exec`，或 `{tier, policy, reason, override}`，也可以是参数的函数（同一工具按参数给不同等级）；不声明按 `exec` 处理。
  - 会话的审批模式：`always-ask`（只自动放行 `read`）、`write`（放行 `read` 与 `write`）、`yolo`（全部放行）。
  - 用户可以按工具覆盖：`tools.approval.<工具>: allow | deny | prompt`。
  - 判定顺序：工具拒绝 → 用户拒绝 → `yolo` 放行（工具自带策略仍生效）→ 工具强制询问 → 工具自带策略 → 用户策略 → 按模式比较等级。
  - 询问在工具包装层里同步等待界面选择“批准”或“拒绝”；没有界面时直接拒绝；拒绝得到错误结果“Tool call denied by user”。等待状态不持久化，进程退出后靠恢复未配对的工具调用重新询问。
- **OMP 的模型与凭据**（`@oh-my-pi/pi-ai`、`@oh-my-pi/pi-catalog`）：
  - 协议：`openai-completions`、`openai-responses`、`openrouter`、`openai-codex-responses`、`azure-openai-responses`、`anthropic-messages`、`bedrock-converse-stream`、`google-generative-ai`、`google-gemini-cli`、`google-vertex`、`ollama-chat`，以及 `cursor-agent`、`gitlab-duo-agent`、`devin-agent`。
  - 模型目录：内置 69 个服务、5111 个模型；任意 `Model` 对象（协议、`baseUrl`、能力）都可以直接调用，自建服务与本地模型不需要另写代码。
  - 凭据：`AuthStorage` 管 API key 与 OAuth 令牌（多账号轮换、限额、自动刷新），存储是 `AuthCredentialStore` 接口，缺省 SQLite（`AuthStorage.create(dbPath)`，路径可指定）。
  - OAuth 订阅约 20 家：Anthropic（Claude 订阅）、OpenAI Codex（ChatGPT 订阅）、GitHub Copilot、Google Gemini CLI 与 Antigravity、Cursor、GitLab Duo、xAI、Kimi、智谱、阿里、Perplexity 等；登录流程经 `OAuthController`（打开链接、设备码、粘贴代码、本地回调）交给宿主实现。

## 方案

### 总览

```text
            ┌──────────────── 使用方（测试、脚本、将来的 nbook.agent 插件）────────────────┐
            │  提供：配置快照、凭据存储、会话存储、工具来源、审批应答、事件接收               │
            └───────────────────────────────┬──────────────────────────────────────────────┘
                                            │ 创建
                                  ┌─────────▼─────────┐
                                  │   HarnessKernel   │  配置快照、模型与凭据（OMP）、角色解析、Profile 目录
                                  └─────────┬─────────┘
                                            │ 打开 / 新建
                                  ┌─────────▼─────────┐
                                  │   AgentSession    │  一个会话一个：状态机、调用、排队、审批等待
                                  └──┬──────┬──────┬──┘
              OMP Agent（每会话一个）◀┘      │      └──▶ 会话日志（经 SessionStore）
                                             ▼
                               工具调度（定义、审批关卡、执行、结果）
```

### 1. 配置

内核只接收一份**已合成的配置快照**（TypeBox schema 校验），以及“配置变了”的通知；配置从哪来、分几层合成，由使用方决定（独立运行时读一个 JSON 文件，插件阶段由 `nbook.settings` 提供，见 [`settings.configuration`](../specs/settings/configuration.md)）。

```ts
type HarnessConfig = {
    providers: ProviderConfig[];          // 自建或覆盖的模型服务：id、协议（OMP Api）、baseUrl、模型清单；OMP 目录里的服务可直接引用，不必列出
    models: {defaultModel: ModelRef};     // ModelRef = "providerId/modelId"
    roles: {items: RoleItem[]};           // 与模型角色合同逐字一致
    profiles: Record<ProfileId, {model?: ModelRef; settings?: JsonValue}>;
    approval: {mode?: "always-ask" | "write" | "auto" | "yolo"; tools: Record<ToolId, "allow" | "deny" | "ask">};   // mode 缺省见“工具审批”
};
```

- 配置快照在一次调用开始时取定，调用内不变；配置变化只影响之后开始的调用。
- 凭据不进配置：API key 与 OAuth 令牌在凭据存储里（见下一节）。
- 校验失败的配置不被采用，旧快照继续有效，并给出结构化的配置问题列表（字段路径、原因）。

### 2. 模型与凭据（直接使用 OMP）

不另设适配器层：模型通信直接用 OMP `pi-ai`（`streamSimple`），模型描述直接是 OMP 的 `Model`。

- **模型从哪来**：`providerId/modelId` 先查配置里的 `providers`（自建服务、本地模型、覆盖 `baseUrl`），再查 OMP 内置目录。查到的都是 OMP `Model` 对象，能力（工具调用、图片输入、上下文窗口、推理档位）随对象给出；Profile 要求的能力不满足时，调用在受理阶段被拒绝。
- **凭据**：用 OMP 的 `AuthStorage`。存储位置由使用方给出：独立运行时传一个 SQLite 路径；插件阶段放在状态根，或实现 `AuthCredentialStore` 接口接到 `nbook.settings` 的密钥存储。内核不读环境变量；开发与测试由使用方显式把环境变量里的 key 写入凭据存储。
- **OAuth 订阅**：内核导出“列出可登录的服务”“登录”“登出”“查看账号与用量”，登录流程的交互（打开链接、输入设备码）由使用方实现 OMP 的 `OAuthController`；插件阶段由界面完成。
- **注意 OMP 的导入期副作用**：`pi-utils` 在导入时读取 `$HOME/.env` 与当前目录的 `.env` 并改写 `Bun.env`（[OMP 能力报告](../../packages/nb-harness/docs/omp-capabilities.md)）；凭据缺省路径也指向 OMP 自己的目录。内核必须显式传入路径，不依赖这些缺省。
- 测试可以传入脚本化的流函数代替 `streamSimple`，只用于验证装配（[测试写法](../testing/README.md#真实模型测试)）。

### 3. 模型角色

按 [模型角色合同](model-roles-contract.md) 解析，链条：

```text
本次调用显式指定的模型 → 指定的角色（未绑定即报配置错误）→ Profile 配置的模型 → Profile 声明的缺省角色 → 全局缺省模型
```

- 角色条目的描述就是给模型看的模型目录（子代理等功能使用，第一批只提供查询）。
- 解析结果连同来源（来自哪一步）写进调用的生命周期条目，方便排查“这次为什么用了这个模型”。

### 4. Profile

Profile 定义一类 Agent：身份与提示词、能用哪些工具、缺省用什么模型、有哪些设置。Profile 要有扩展性、与 harness 解耦；扩展性的设计（例如是否给渲染上下文加会话历史、插件怎样扩展 Profile）在 `session` 完成后另行讨论，本节是起点而不是定稿（开发者 2026-10-10）。保留 TSX 提示词 DSL（`nb-profile` 并入本包，以子路径 `@notnotype/nb-harness/profile` 导出），补上旧应用 Profile 的核心字段：

```ts
defineProfile({
    id: "writer",
    name: "写作助手",
    description: "……",
    model: {role: "main"},                   // 或 {model: "deepseek/deepseek-flash"}
    tools: ["read", "edit", "example.plot/list_plot"],   // 按工具 id 显式列出，可以列插件工具
    approvalMode: "write",                   // 缺省审批模式，可被会话与配置覆盖
    settingsSchema: Type.Object({...}),      // 可选；值来自配置 profiles[id].settings
    context: (ctx) => <ProfilePrompt>…</ProfilePrompt>,
});
```

- **模型可见的工具** = Profile 列出的 ∩ 工具来源此刻可用的。工具列表在每次调用开始时取定；调用中途某工具不可用（例如插件被禁用），调用它得到“工具不可用”结果，列表不变，以免破坏提示词缓存。插件主动申请进入某 Profile、用户审批，留到插件阶段。
- **上下文分区与顺序**沿用旧应用已验证的做法：`System`（系统提示）→ `HistorySet`（稳定历史前缀：会话第一次调用时写进日志，之后不重复写，以利提示词缓存）→ 会话历史 → `AppendingSet`（每轮追加、不进日志）→ 本次用户输入。
- `context(ctx)` 只读：`ctx` 给出会话信息、设置值、当前时间等；不能写日志、不能调用工具。
- 修复 t07 审查里的 DSL 问题：TSX 句内插值不再被拆行；`If` 接受真值；第一批不提供 `ToolCall`、`ToolResult` 节点。

### 5. 会话

会话是一份**只追加的事件日志**，会话的一切状态都由日志回放得出（事件溯源），条目格式参照 OMP 的会话（开发者 2026-10-10 确认）。

**文件格式**：JSONL，第一行是会话头，其后每行一个条目。

- 会话头：`{type: "session", version, id, createdAt, parentSession?}`。`parentSession` 记派生它的会话（子代理用），只作元数据。
- 每个条目都有 `{type, id, parentId, timestamp}`。`id` 在会话内唯一；`parentId` 指向前一个条目，第一个条目为 `null`。条目一旦写入就不修改、不删除，也不重写文件。
- 当前叶子就是最后一个条目，不单独保存。v1 的每个条目都接在当前叶子之后，所以是一条链；以后做分支与重试时，只需要新条目接在更早的条目后面并移动叶子，格式不用迁移。

**条目类型**（v1）：

| 条目 | 进模型上下文 | 说明 |
|---|---|---|
| `message` | 是 | 原样保存 OMP 的 `AgentMessage`：`user`、`assistant`（内容块、工具调用、停止原因、用量、错误信息）、`toolResult` |
| `custom_message` | 是 | 由 Profile 或插件注入、需要模型看到的内容，带 `customType`（带命名空间）；例如 `HistorySet` 写入的稳定历史前缀 |
| `invocation` | 否 | 调用的生命周期：`start`（方式、Profile、模型与来源）、`waiting`、`resumed`、`end`、`error`（分类与原因）、`aborted`、`interrupted` |
| `interaction` | 否 | 待用户处理的事项：提出（审批或提问、对应的工具调用）与应答（结果、作出者是用户还是审批模型、理由、作用范围） |
| `model_change` | 否 | 会话改用的模型或角色、思考档位 |
| `title_change` | 否 | 会话标题与来源（自动或用户） |
| `custom` | 否 | 带命名空间的不透明状态，给插件与内核子系统保存自己的状态；内核只保存与转交，不解释 |

**回放（投影）**：一组纯函数沿叶子到根的路径折叠条目，得到各种派生状态，互不依赖：

- **模型上下文**：取 `message` 与 `custom_message`，按 OMP 的规则去掉没有结果的工具调用（未应答的审批除外），去掉中止或出错的助手消息及其工具结果。
- **会话状态**：是否有未结束的调用、未应答的事项（据此得出 `Idle` 或 `WaitingUser`）。
- **会话设置**：当前模型与思考档位、标题、本会话内的审批允许。
- 插件与子系统可以为自己的 `custom` 类型加投影，内核不需要知道它们。

快照就是回放的结果，实时事件就是新写入的条目加上不落盘的运行事件（模型流增量、队列变化），界面断线后用快照重来、用条目序号续传。

**存储接口**：`SessionStore`：新建（写会话头）、打开（读回会话头与全部条目）、追加（一批条目原子写入）、列出。附一个 JSONL 实现：一会话一个文件，只追加，沿用现有 `nb-session` 的中断尾检测与显式修复。会话放在哪里由使用方决定。同一会话同一时刻只有一个写者，由使用方保证。

**写入时机**沿用旧合同：用户消息在模型真正看到时写；排队中的插话与追加输入不写，被取出、成为模型可见输入时才写；助手消息与工具结果在一批工具执行结束、结果配对之后写；生命周期条目在状态变化时写。

**崩溃收口**：打开会话时，末尾未配对的工具调用中，有未应答审批的恢复为等待（见“工具审批”）；其余追加一条“执行被中断，结果未知”的工具结果，不重新执行。最后一个调用停在 `start` 而没有未应答的事项时，追加 `invocation` 的 `interrupted`。收口也是追加条目，不改写旧条目。

**版本**：会话头带 `version`；读到旧版本时在内存中迁移，写入新条目前不改写旧文件。

### 6. Agent 运行时

#### 状态与操作

状态与操作沿用旧黑盒合同的矩阵，第一批包含排队：

| 操作 | `Idle` | `Running` | `WaitingUser` | `Aborting` |
|---|---|---|---|---|
| `prompt(消息, {streamingBehavior?})` | 受理，开始新调用 | 带 `streamingBehavior: "steer" \| "followUp"` 时入对应队列，否则拒绝（忙） | 同 `Running` | 拒绝 |
| `continue()` | 末尾可继续时受理（例如上次模型服务失败后重试） | 拒绝 | 拒绝（用 `resolve`） | 拒绝 |
| `steer(消息)` | 拒绝（没有运行中的调用） | 入插话队列；在下一个工具批次结束时送给模型 | 入插话队列；应答后的下一个模型请求前送达 | 拒绝 |
| `followup(消息)` | 拒绝 | 入追加队列；本次调用正常完成后自动开始下一次 | 入追加队列；本次调用恢复并完成后才处理 | 拒绝 |
| `resolve(应答)` | 拒绝 | 拒绝 | 受理，恢复同一调用 | 拒绝 |
| `abort({clearQueue?})` | 无副作用 | 中止，写 `aborted` | 中止，挂起的调用写拒绝结果 | 幂等 |

- 运行中的 `prompt` 沿用 OMP 会话层的做法：调用方用 `streamingBehavior` 指明入哪个队列，不指明就以忙碌拒绝（开发者 2026-10-10 确认）。`steer`、`followup` 两个操作是它的简写。
- 队列只在内存中：排队的消息不是会话历史，进程退出即丢失（与旧合同一致）。调用以 `error`、`aborted`、`interrupted` 结束时不自动处理追加队列；`abort` 缺省清空两个队列。
- 受理错误（参数非法、状态不允许、开始前已中止的 `signal`）直接返回结构化错误，**不写任何东西**。
- 受理之后的失败一律写成终态生命周期，调用的返回值带同样的分类与原因。
- 每个调用返回 `InvocationResult`：`{status: "completed" | "waiting" | "aborted" | "failed", error?, entries}`。
- 事件：内核发出带序号的类型化事件（调用状态、队列变化、模型流增量、工具开始与结束、审批请求、条目写入），序号在会话内单调递增，便于断线后续传。

#### ReAct 循环

每个会话持有一个 OMP `Agent` 对象，内核在它外面加持久化、状态机与审批，即 OMP 自己的会话层的做法（开发者 2026-10-10 确认）：

- 打开会话时，从日志重建消息并 `replaceMessages`；系统提示、工具、模型在每次调用开始时按配置快照与 Profile 设置。
- 插话与追加输入交给 `Agent` 的 `steer`、`followUp` 队列；中止交给 `abort`；模型错误与中止由 `Agent` 转成带 `stopReason` 与 `errorMessage` 的助手消息，内核据此写终态生命周期与返回值（不再把它们当成正常回复）。
- 在 `message_end` 事件里按写入时机把消息写进日志；日志写入失败时中止调用并以 `error`（日志写入失败）收口。
- 只用 `Agent` 的循环，不用 OMP 的审批：`pi-agent-core` 的循环本身不执行审批（工具上的 `approval` 只是声明字段，审批关卡在 `pi-coding-agent` 的工具包装层里），审批由内核自建（见下文）。
- `beforeToolCall` 只用于不需要等待的快速决定（插件阶段的参数改写、直接拒绝）。它在助手消息发出 `message_end` 之前执行，在这里等用户会让这条消息既进不了日志、也到不了界面。
- 不开启 OMP 的预测执行（`speculativeToolExecution`），以免工具在审批关卡之前开始执行。
- 轮数达到上限时以 `failed`（`limit`）结束。

#### 工具定义

```ts
defineTool({
    id: "edit",                              // 内置工具用短名；插件工具用 "<插件 id>/<名称>"
    description: "……",
    parameters: Type.Object({...}),          // TypeBox；可结构化克隆
    risk: "write",                           // read | write | exec，或 {tier, policy?: "deny" | "ask", reason?}，或参数的函数
    scope: "session",                        // "session" | "project"；project 由使用方注入项目参数（插件阶段）
    execute: async (args, ctx) => ToolOutcome,   // ctx: {signal, session, toolCallId, report(进度)}；返回可克隆的结构化结果
});
```

- `execute` 的入参与结果都可结构化克隆，错误以结构化结果返回（`{ok: false, code, message}`），满足插件公开 API 的约束；内核内部再适配成 OMP 的 `AgentTool`。
- 进度通过 `ctx.report` 发出，不把回调交给工具外部，跨进程时可以变成事件。
- 不声明 `risk` 的工具按 `exec` 处理（未声明即最严）。
- 同一会话内工具 id 必须唯一；工具来源给出重名时，该调用受理失败（`tool-conflict`），不静默覆盖。
- 工具实现在**每次调用时**经工具来源取得，不缓存；取不到时返回结构化的“工具不可用”结果，循环继续。这正是插件被禁用时的语义（平台设计 P1、P11）。

#### 工具审批

审批由内核自建，不使用 OMP 的审批层（开发者 2026-10-10 决定）。能力等级三档 `read`、`write`、`exec` 的划分借自 OMP。

**判定**：每个工具调用按下面的顺序取第一个命中的结果：

1. 工具对这组参数声明 `policy: "deny"` → 拒绝。
2. 配置里该工具为 `deny` → 拒绝。
3. 本会话已有该工具在该等级上的“本会话内允许” → 放行。
4. 工具对这组参数声明 `policy: "ask"`（安全项，例如危险命令）→ 询问用户（即使在 `auto` 下也不交给审批模型；`yolo` 下放行）。
5. 配置里该工具为 `allow` 或 `ask` → 按配置。
6. 按模式比较等级：

| 模式 | 自动放行 | 需要审批 |
|---|---|---|
| `always-ask` | `read` | `write`、`exec` |
| `write` | `read`、`write` | `exec` |
| `auto` | `read` | `write`、`exec` 先交给审批模型 |
| `yolo` | 全部 | 无 |

**缺省模式**：配置里绑定了审批模型角色 `approval` 时为 `auto`，否则为 `write`（开发者 2026-10-10 确认）。优先级：会话的临时设置 → 配置 `approval.mode` → Profile 的 `approvalMode` → 缺省。

**审批模型（`auto`）**：用模型角色 `approval` 解析出的模型做一次不带工具的调用，输入是工具名与说明、参数（截断）、等级、工具给出的理由、当前 Profile 与最近几轮对话；要求严格的结构化输出 `{decision: "allow" | "deny" | "escalate", reason}`。

- `allow` 直接执行；`deny` 把理由作为错误结果交给模型；`escalate` 转为询问用户。
- 模型调用失败、超时、输出不合格时一律 `escalate`，不会因为审批模型出问题而放行。
- 每次判定连同作出者（审批模型）和理由写进日志。

**询问用户**：审批与提问（以后的 `ask` 工具）是同一种“待用户处理的事项”，只是内容不同。

- 提出时写 `interaction` 条目，会话进入 `WaitingUser`，发出事件；使用方用 `resolve({interactionId, ...})` 应答：审批是 `{decision: "approve" | "reject", scope: "once" | "session", note?}`，提问是答案。
- `scope: "session"` 只在本会话内生效：记在日志的 `interaction` 应答里，重建时恢复，会话结束即失效，不改配置。
- 拒绝时把用户的说明作为错误结果交给模型。
- 提问只能由用户回答，不交给审批模型。

**在循环里的样子**：审批放在内核给每个工具套的执行包装里，判定发生在工具真正执行之前、助手消息已写入日志之后。对 OMP 的循环来说，需要等用户的审批就是一次耗时很长的工具执行：

- 循环停在这一批工具上；这期间的插话进入队列，在这批工具结束后送达；审批等待不被插话打断。
- `abort` 取消等待，该调用写一条“已中止”的结果。
- 同一批里有多个调用需要审批时可以同时待处理，任意顺序应答；全部处理完这批工具才结束。

**持久化与恢复**：只做审批恢复（开发者 2026-10-10 确认）。审批的提出与应答写进日志；进程重启后：

- 有提出、没有应答的审批 → 恢复为待处理事项，会话处于 `WaitingUser`，仍可应答。应答后由内核执行（或拒绝）这个调用、写入结果，再调用 `Agent.continue()` 让模型继续。
- 同一批里其它没有结果的调用 → 按会话的崩溃规则补“执行被中断，结果未知”，不重新执行，也不区分它们执行到了哪一步。
- 已批准但还没来得及执行就中断的调用，同样按中断处理；模型看到中断结果后可以自己再发起一次。

进程一直活着时，执行包装里的等待直接完成。两条路对使用方是同一个接口：`WaitingUser` 状态加 `resolve`。

### 模块划分与推进顺序

`nb-harness` 一个包，按模块以子路径导出；依赖只能从上往下：

```text
runtime   （Agent 循环、状态机、排队、审批等待与恢复）
  ├── tools    （工具定义、工具来源、审批判定与审批模型）
  ├── models   （模型解析、角色、凭据与 OAuth；直接用 OMP）
  ├── config   （配置 schema、校验、快照）
  ├── profile  （TSX 提示词 DSL、defineProfile、加载、渲染）
  └── session  （条目、存储接口与 JSONL 实现、回放）
```

- `session` 只依赖 OMP 的消息类型（`import type`），不依赖其它模块。
- `profile` 不依赖任何模块：输入是 Profile 定义加上一份只读的渲染上下文（会话回放出的历史、设置值、会话信息），输出是系统提示段落、稳定历史前缀、每轮追加的内容、工具列表、模型选择与审批模式。稳定历史前缀要不要写进会话，由 `runtime` 决定。
- 先搭包的底座（模块入口、边界测试、旧原型移到 `src/prototype/`），再做 `session`；`profile` 先讨论扩展性再做（开发者 2026-10-10 决定）；之后是 `config`、`models`、`tools`，最后做 `runtime`，然后是内置读写工具。
- 过渡期间旧原型（`nb-harness/src` 现有代码与 `nb-session`、`nb-profile` 两个包）保持不动，新模块写在新目录；`runtime` 完成时一起删除旧原型与两个包。

### 插件的落脚点

内核不认识插件；插件阶段的 `nbook.agent` 通过下面这些接口接入：

| 内核接口 | 内核缺省 | 插件阶段的实现 |
|---|---|---|
| 配置快照与变更通知 | 使用方传入 | 读 `nbook.settings` 的有效值 |
| 凭据存储（OMP `AuthCredentialStore`） | 使用方给出的 SQLite 路径 | 状态根下的路径，或接 `nbook.settings` 的密钥存储 |
| OAuth 登录交互（OMP `OAuthController`） | 使用方实现 | 界面经远程服务完成 |
| 会话存储 `SessionStore` | JSONL 实现 | 状态根下的会话目录，加租约 |
| 工具来源 `ToolSource`（列出可见工具、按次取实现） | 静态列表 | 汇总贡献点 `agent.tools`，经贡献句柄按次取实现 |
| 工具调用拦截 `ToolInterceptor`（改写参数、改写结果） | 无 | 项目级工具注入 `project` 参数、申请租约、`.at({project})`，结果附项目身份 |
| 审批应答与事件接收 | 使用方调用 `resolve`、订阅事件 | 界面经远程服务应答与订阅 |
| 文件访问 `FileAccess`（内置读写工具用） | 受根约束的本地文件 | 经 `nbook.files` 的项目文件服务 |

## 备选方案与取舍

| 取舍 | 选择 | 理由 |
|---|---|---|
| 循环底座：OMP `Agent` 类 / 无状态循环函数 / 自写 | **`Agent` 类**（开发者 2026-10-10 确认） | 第一批要做排队，`Agent` 已经实现插话与追加队列、中止时放回未送达的消息、模型错误转成带原因的助手消息、从未配对调用恢复；OMP 自己的会话层就是这样包的。无状态函数更灵活（状态全在内核手里、没有第二份内存状态要和日志对齐），但上述逻辑都要自己重写。自写要重做流式解析与工具调度，不考虑 |
| 会话存储：JSONL / SQLite | **JSONL（经接口）** | 一会话一文件、只追加、可直接审查，现有实现已有中断尾修复；需要跨会话查询时再加索引 |
| 会话结构：线性 / 分支树 | **格式按树（`id`、`parentId`），v1 只用一条链** | 参照 OMP；以后加分支与重试不用迁移格式。分支与重试树的交互另立 |
| 会话状态：直接改写的状态文件 / 只追加条目加回放 | **只追加加回放（事件溯源）** | 开发者 2026-10-10 决定；日志就是全部真相，快照可以随时重算，实时事件与持久条目是同一份东西 |
| 审批：旧应用的 `approvalRequired` / 用 OMP 的审批层 / 自建 | **自建，借用三档等级** | 开发者 2026-10-10 决定。OMP 的审批层在 `pi-coding-agent` 里，不能替用户批准、等待不持久、没有界面时直接拒绝；自建才能加审批模型与跨重启恢复。等级三档与模式表达力够用，插件作者只需声明等级 |
| 审批等待的位置：`beforeToolCall` / 工具执行包装 | **工具执行包装** | `beforeToolCall` 在 `message_end` 之前执行，等待期间助手消息进不了日志与界面；OMP 自己的审批也放在执行包装里 |
| 模型通信：自设适配器接口 / 直接用 OMP | **直接用 OMP** | OMP 已覆盖主流协议、本地模型与约 20 家 OAuth 订阅（开发者 2026-10-10 确认）；再包一层只增加维护面 |
| 工具协议：直接用 OMP `AgentTool` / 自有协议再适配 | **自有协议** | `AgentTool` 带回调、不可克隆，第三方插件工具无法满足平台约束；等级字段与 OMP 同形，适配无损 |
| 三个包 / 一个包 | **一个包，子路径导出** | 开发者 2026-10-10 同意合并 |

## 影响

- **数据**：新会话格式与现有 `nb-session` 的 JSONL 不兼容；现有包没有使用方，不需要迁移。旧应用的会话不迁移。凭据存在 OMP 的 SQLite 凭据库，路径由使用方给出。
- **接口**：`nb-harness` 的公开接口整体重写；现有 `createHarness`、`createReadTool`、`createEditTool`、SSE 导出删除（SSE 由插件阶段的远程订阅取代）。`nb-session`、`nb-profile` 两个包删除，内容并入 `nb-harness`。
- **安全**：工具未声明等级时按 `exec` 处理；缺省审批模式为 `auto`（绑定了审批模型时）或 `write`；审批模型出错时转为询问用户，不放行。内置文件工具经 `FileAccess` 受根约束，修复越过 cwd 读写的问题。凭据只在凭据存储里，不写进会话日志与事件。
- **发布与回滚**：只在 w00002 分支内，不影响新应用；回滚即丢弃分支。

## 对 Spec 的预期改动

旧原型的现状 Spec 已删除。设计获批后新建下列 Spec（先写 `planned`，实现与验证闭合后晋升）：

| capability | 内容 |
|---|---|
| `harness.config` | 配置 schema、校验与问题列表、快照与变更 |
| `harness.models` | 模型解析（配置的服务与 OMP 目录）、按角色解析（含错误）、凭据存储与 OAuth 登录接口 |
| `harness.profile` | Profile 定义、加载、上下文分区与顺序、设置、可见工具 |
| `harness.session` | 文件格式与条目类型、只追加与叶子、回放投影（模型上下文、会话状态、会话设置）、存储接口与 JSONL 实现、写入时机、崩溃收口、版本 |
| `harness.runtime` | 状态与操作矩阵（含排队）、调用结果与错误分类、事件与序号 |
| `harness.tools` | 工具定义、工具来源与调用拦截、审批判定与模式、审批模型、待用户处理的事项、持久化与恢复 |

## 待定项

无。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-03 | 开发者 | Agent 基于 `nb-harness` 实现为内置插件 |
| 2026-10-10 | 开发者 | 单独开分支与 worktree 做 nb-harness 与 Agent 插件；先做内核、不做插件，设计时考虑插件 API；最基础的是会话、模型角色、Profile、模型适配器、配置、Agent 运行时（ReAct 循环、工具定义、工具审批），之后做内置读写工具 |
| 2026-10-10 | 开发者 | 第一批就做排队（`steer`、`followup`）；工具进 Profile 按推荐（Profile 显式列出，可见 = 列出 ∩ 可用，列表在调用开始时取定）；会话存储只定接口并提供 JSONL 实现；`nb-session`、`nb-profile` 并入 `nb-harness`；模型适配直接用 OMP 提供的协议与 OAuth 订阅；审批先调研 OMP 的做法 |
| 2026-10-10 | 开发者 | 运行中的 `prompt` 直接采用 OMP 的做法（`streamingBehavior` 指明入哪个队列，否则忙碌拒绝）；要求调研 OMP 的子代理、会话与审批的可定制性，并提出 LLM 自动审批模式 |
| 2026-10-10 | 开发者 | 循环用 OMP `Agent` 类；审批不用 OMP 的审批层，自建，并且要持久化；缺省审批模式：配置了审批模型角色时为 `auto`，否则为 `write` |
| 2026-10-10 | 开发者 | 审批持久化只做审批恢复；删除原 harness 的文档与 Spec，重新建立 |
| 2026-10-10 | 开发者 | 会话条目参照 OMP：只追加的条目、事件溯源；先拆模块，先做与 Agent 循环耦合低的 `session` 与 TSX `profile` |
| 2026-10-10 | 开发者 | 旧原型移到 `src/prototype/`；Profile 要有扩展性、与 harness 解耦，第一版先不做，先把 `session` 做好；底座与 `session` 的 Spec 写完后交 omp 审查 |
