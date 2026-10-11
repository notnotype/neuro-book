---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.runtime
owners:
  - nb-harness
---

# Harness 运行时：调用、状态机、排队、审批等待、恢复与事件

## 目标与非目标

`nb-harness` 的 `runtime` 模块把其它模块装配成一个能用的 Agent：每个会话持有一个 OMP `Agent`，运行时在它外面加持久化（[`harness.session`](session.md)）、状态机与排队、Profile 装配（[`harness.profile`](profile.md)）、模型与凭据（[`harness.models`](models.md)）、工具与审批（[`harness.tools`](tools.md)）、压缩（[`harness.compaction`](compaction.md)）与类型化事件。使用方（独立运行时或插件 `nbook.agent`）只接触本模块的接口。

不承诺：

- 传输与推送（SSE、WebSocket、远程服务）：本模块只产出带序号的事件，由使用方订阅。
- 子代理、Skills、Workflow、附件、会话分支、`request_user_input`、结构化结果：第一批之外。
- 配置从哪来、凭据存哪里、工具从哪来、Profile 从哪加载：都由使用方以其它模块的接口传入。
- 提供工具本身：内置的 `read`、`edit` 见 [`harness.builtin-tools`](builtin-tools.md)，插件贡献点属于插件阶段；本模块只经 `deps.tools` 接收工具来源。
- 上下文溢出后的自动重试：溢出以 `failed` 收口并说明原因，使用方可以 `compact()` 后 `continue()`（见输出 15）。

## 术语与参与者

- **会话句柄**：`AgentSession`，一个会话在本进程内的运行时对象，持有会话日志、一个 OMP `Agent` 与状态机。
- **调用**：一次 `prompt`、`continue` 或恢复后 `resolve` 触发的 ReAct 运行，从 `invocation start`（或 `resumed`）到终态；与 [`harness.session`](session.md) 的 `harness/invocation` 条目一一对应。
- **状态**：`idle`、`running`、`waiting-user`、`aborting`（设计稿“状态与操作”的四个状态）。
- **受理**：操作在写任何条目之前的检查；受理失败返回结构化错误，不留痕迹。受理之后的失败一律写成调用的终态。
- **待处理事项**：审批（第一批只有审批）：提出写 `interaction request`，应答写 `interaction response`。
- **队列**：插话队列（`steer`，交给 OMP `Agent.steer`，在下一次模型请求时送给模型：本次请求已发出的话就是当前工具批次之后的那次）与追加队列（`followUp`，本次调用正常完成后自动开始下一次调用）。只在内存里。
- **事件**：运行时发出的带序号的类型化消息；序号在一个会话句柄内从 1 起单调递增。
- **写入时机**：哪些消息在什么时候进日志：本次输入、提醒与 Profile 状态在受理通过后立即写；助手消息与工具结果在 OMP `message_end` 时写；插话消息在 OMP 把它送给模型（`message_end`）时写。

## 输入与前置条件

```ts
// 公开入口 @notnotype/nb-harness/runtime
createRuntime(deps: RuntimeDeps): Runtime;                 // 同步；配置、Profile、预算不合法时抛 HarnessError（输出 18）
openRuntime(options: OpenRuntimeOptions): Promise<Runtime>;   // 便捷入口：凭据可以只给 key（输出 18）
unwrap<T>(result: {ok: true; value: T} | {ok: false; code: string; detail: string; diagnostics?: Diagnostic[]}): T;   // 失败抛 HarnessError
class HarnessError extends Error {code: string; detail: string; diagnostics: readonly Diagnostic[]}

type RuntimeDeps = {
    config: ConfigStore | HarnessConfigInput;              // harness.config；每次调用开始时取 current；给配置对象时内部建存储
    profiles: ProfileCatalog | readonly Profile[]; host?: ProfileHost;   // harness.profile；给数组时内部建目录（source: "inline"）；host 缺省新建一个空主机
    models?: ModelCatalog; credentials: Credentials;       // harness.models；models 缺省按 config 建（跟着 replace 走）
    tools?: ToolSource[]; interceptor?: ToolInterceptor;   // harness.tools；tools 缺省没有工具
    approve?: (request: ApprovalPrompt) => Promise<ApprovalAnswer | null>;   // 宿主审批（输出 6）：询问用户之前先问它
    compaction?: CompactionRegistry;                       // harness.compaction；缺省只有 soft
    store?: SessionStore;                                  // harness.session；缺省内存存储（进程退出即丢）
    artifacts?: ArtifactStore;                             // harness.session 的溢出存储；缺省内存实现（进程退出即丢）
    limits?: {maxTurns?: number; toolResult?: Partial<ToolResultBudget>};   // 一次调用最多多少轮模型回复（缺省 50）；工具结果预算（缺的项按 harness.tools 的缺省；不是非负整数时 createRuntime 抛 HarnessError("invalid-limits")）
    now?: () => Date;
    model?: {stream?: StreamFn};                           // OMP Agent 的模型流传输（测试与宿主限流用）；缺省 OMP 的 streamSimple
    judge?: {stream?: StreamFn; timeoutMs?: number};       // 审批模型的传输与超时（harness.tools judgeWithModel）
};

type OpenRuntimeOptions = Omit<RuntimeDeps, "credentials"> & {credentials?: Credentials; apiKeys?: Record<string, string>; credentialsPath?: string};
type ApprovalPrompt = {sessionId: string; invocationId: string; interactionId: string; toolName: string; toolCallId: string; args: JsonValue; tier: "read" | "write" | "exec"; profile: {id: string; name: string}; signal: AbortSignal};
type ApprovalAnswer = {decision: "approve" | "reject"; scope?: "once" | "session"; note?: string};

interface Runtime {
    createSession(input: {profileId: string; id?: string; title?: string}): Promise<RuntimeResult<AgentSession>>;
    openSession(id: string): Promise<RuntimeResult<AgentSession>>;     // 打开已有会话：按需收口（输出 13）
    listSessions(): Promise<RuntimeResult<SessionSummary[]>>;
    close(): void;                                                      // 关运行时自己建的东西（openRuntime 开的凭据库）；使用方传进来的不关
}

interface AgentSession {
    readonly id: string;
    readonly log: SessionLog;                               // 只读用途：entries、subscribe、分页；不要直接 append
    readonly status: SessionStatus;
    prompt(input: UserInput, options?: PromptOptions): Promise<RuntimeResult<Invocation>>;
    continue(options?: ContinueOptions): Promise<RuntimeResult<Invocation>>;
    steer(input: UserInput): RuntimeResult<void>;
    followup(input: UserInput): RuntimeResult<void>;
    resolve(answer: InteractionAnswer): Promise<RuntimeResult<void>>;
    abort(options?: {clearQueue?: boolean}): RuntimeResult<void>;
    compact(options?: {signal?: AbortSignal}): Promise<RuntimeResult<Compacted | null>>;   // 手动压缩；没有可压的为 null
    preview(input?: UserInput, options?: PreviewOptions): Promise<RuntimeResult<Preview>>;   // 这次调用模型会收到什么（输出 17）；只读，不要凭据
    setApprovalMode(mode: ApprovalMode | undefined): void;  // 会话的临时审批模式；不写日志
    subscribe(listener: (event: RuntimeEvent) => void): {release(): void};
    close(): Promise<void>;                                 // 中止进行中的调用并等它收口、关闭日志；之后所有操作为 closed
}

type SessionStatus = {
    phase: "idle" | "running" | "waiting-user" | "aborting";
    invocationId?: string;
    pending: PendingInteraction[];                          // harness.session sessionStatus 的 pending
    queue: {steer: number; followUp: number};
    profileId?: string;                                     // 新建时给定；打开时取最近一次 invocation start 的 detail，从未调用过的会话没有
    model?: string;                                         // 当前生效的模型引用（最近一次调用选中的）
    context?: {tokens: number; source: "reported" | "estimated"; window: number; threshold: number};   // 上下文用量（输出 5）：本进程内受理过调用才有
};
type PromptOptions = {streamingBehavior?: "steer" | "followUp"; profileId?: string; model?: string; signal?: AbortSignal};   // signal 只属于这次调用：调用收口后再中止它没有效果
type ContinueOptions = {signal?: AbortSignal};
type PreviewOptions = {profileId?: string; model?: string; signal?: AbortSignal};
type Preview = {model: string; tools: string[]; system: string[]; seeds: Message[]; appended: Message[]; request: Message[]; diagnostics: Diagnostic[]};   // 输出 17；Diagnostic 是 harness.profile 的诊断
type Invocation = {invocationId: string; done: Promise<InvocationResult>; next(): Promise<InvocationStep>};
type InvocationStep = {kind: "waiting"; pending: PendingInteraction[]} | {kind: "done"; result: InvocationResult};   // 输出 6
type InvocationResult = {status: "completed" | "waiting" | "aborted" | "failed"; error?: InvocationError; entries: readonly SessionEntry[]};   // entries：本次调用写入的全部条目
type InvocationError = {kind: "model" | "limit" | "log" | "profile" | "compaction"; message: string; overflow?: boolean};
type InteractionAnswer = {interactionId: string; decision: "approve" | "reject"; scope?: "once" | "session"; note?: string};
type UserInput = {content: string | (TextContent | ImageContent)[]};   // harness.profile 的 UserInput

type RuntimeEvent = {seq: number; sessionId: string} & (
    | {type: "status"; status: SessionStatus}
    | {type: "invocation"; invocationId: string; phase: InvocationPhase; detail?: JsonValue}
    | {type: "queue"; steer: number; followUp: number}
    | {type: "stream"; invocationId: string; message: AssistantMessage}          // 流式中的助手消息快照（每次增量一条，不合并）
    | {type: "tool"; invocationId: string; toolCallId: string; toolName: string; stage: "start" | "update" | "end"; args?: JsonValue; progress?: JsonValue; isError?: boolean}
    | {type: "interaction"; invocationId: string; interactionId: string; phase: "request" | "response"; data: InteractionData}
    | {type: "entry"; logSeq: number; entry: SessionEntry}                        // 每条写入日志的条目
    | {type: "compaction"; result: {ok: true; method: string} | {ok: false; code: string; detail: string}}
);

type RuntimeFailure = "busy" | "invalid-state" | "invalid-input" | "unknown-profile" | "invalid-profile" | "model-unavailable" | "credentials-missing"
    | "capability-missing" | "tool-conflict" | "unknown-interaction" | "already-answered" | "compaction-failed" | "session-exists" | "session-not-found" | "corrupt-session" | "closed" | "log-failed";
type RuntimeResult<T> = {ok: true; value: T} | {ok: false; code: RuntimeFailure; detail: string};
```

| 规则 | 内容 |
|---|---|
| `UserInput` | 字符串非空（去掉首尾空白后），或块数组非空且每块是文本或图片；图片要求选中的模型有图片能力（否则受理失败 `capability-missing`） |
| `profileId` | 必须在 `profiles` 目录里；会话第一次调用的 Profile 记在会话里（`harness/profile-state` 的 `profileId` 与 `model_change` 的 `role`），之后 `prompt` 可以换 |
| 模型 | 按 [`harness.models`](models.md) 的选择链：`options.model` → 会话的 `model_change` → Profile 的 `harness/model` 字段 → 配置缺省；选中后要能取到凭据 |
| 工具 | Profile 的 `harness/tools` 字段列出的 id 与 `deps.tools` 的交集，按 [`harness.tools`](tools.md) `visibleTools` 取定；请求了来源里没有的 id 受理照常，列在 `invocation start` 的 `detail.missingTools` 与预览的 `unknown-tool` 诊断里；同名冲突受理失败 |
| 审批模式 | [`harness.tools`](tools.md) `resolveApprovalMode({session: setApprovalMode 设的, config: config.approval.mode, profile: Profile 的 harness/approval 字段, approvalRoleBound: 配置里角色 approval 绑定了模型})` |
| 压缩设置 | Profile 的 `harness/compaction` 字段经 [`harness.compaction`](compaction.md) `resolveCompactionSettings` |
| 注册字段 | 运行时在 `createRuntime` 时把 `harness/tools`（字符串数组）、`harness/approval`（审批模式枚举）、`MODEL_FIELD`、`COMPACTION_FIELD` 注册到 `host`；已经注册过的（使用方先注册了）不算错 |

## 输出与可观察行为

1. **状态与操作矩阵**：各操作在各状态下的结果；“拒绝”是受理失败，不写任何东西：

    | 操作 | `idle` | `running` | `waiting-user` | `aborting` |
    |---|---|---|---|---|
    | `prompt` | 受理，开始新调用 | 带 `streamingBehavior` 时入对应队列（返回 `ok`，`invocationId` 为当前调用），否则 `busy` | 同 `running` | `invalid-state` |
    | `continue` | 末尾可继续时受理（输出 10） | `busy` | `invalid-state`（用 `resolve`） | `invalid-state` |
    | `steer` | `invalid-state` | 入插话队列 | 入插话队列（应答后恢复时送达） | `invalid-state` |
    | `followup` | `invalid-state` | 入追加队列 | 入追加队列 | `invalid-state` |
    | `resolve` | `invalid-state` | `invalid-state` | 受理，恢复同一调用 | `invalid-state` |
    | `abort` | 无副作用，`ok` | 中止 | 中止：待处理的审批写拒绝应答（`decidedBy: "user"`，`note: "aborted"`） | 幂等，`ok` |
    | `compact` | 受理 | `busy` | `busy` | `busy` |
    | `preview` | 受理 | 受理 | 受理 | 受理 |

2. **受理**：`prompt` 依次检查输入、Profile、配置快照、模型选择与能力、凭据、可见工具、`signal` 未中止；任一失败返回对应的 `RuntimeFailure` 与说明（模型选择的失败把 [`harness.models`](models.md) 的失败码写进 `detail`），`log.entries` 不变、不发事件。受理通过后返回 `{invocationId, done}`，此时 `invocation start` 已经写入。
3. **一次调用的写入顺序**：`invocation start`（`detail: {profileId, model, tools: [...], reason, missingTools?: [...]}`，`missingTools` 只在 Profile 请求了来源里没有的工具时有）→ 新会话第一次调用时 Profile 的种子（`renderSeeds("new-session")`，角色按节点）→ 本次输入（`role: "user"`，没有 `attribution`）与 Profile `Appending` 渲染出的其它消息（其中的用户消息带 `attribution: "agent"`，不算用户发出的消息）与提醒（`harness/reminder`）→ `harness/profile-state`（状态有变化时）→ 循环中 OMP 每个 `message_end` 的助手消息与工具结果（工具结果已在适配层按预算截断：[`harness.tools`](tools.md) 输出 9，全文在 `deps.artifacts` 里以本会话 id 保存，恢复执行的工具同样），按发生顺序 → 审批的 `interaction` 条目与 `invocation waiting/resumed` → 终态 `invocation end/error/aborted`。同一次调用里 `model_change` 在选中的模型与会话里记录的不同时写一条（`role` 为经角色命中时的角色）。
4. **模型看到的**：每次模型调用前，运行时先 `refresh` Profile（`model-call` 数据源）并重渲染系统提示词，再用 `renderRequest({history: 当前消息, invocationStart})` 得到消息（`history` 是从日志回放的模型上下文加上本次调用已产生的消息；`invocationStart` 是本次调用第一条消息的下标）；刷新后的内容在**当次**请求里生效。`refresh` 失败时不再请求模型，调用以 `failed`（`profile`）收口。工具列表与模型在调用开始时取定，调用中途不变（来源中途撤掉的工具按 [`harness.tools`](tools.md) 得到 `tool-unavailable`）。`Agent` 的 `convertToLlm` 保留 developer 消息。
5. **流式事件**：助手消息流式生成时每个增量发一个 `stream` 事件（消息快照）；工具开始、进度、结束发 `tool` 事件；每条写入日志的条目发 `entry` 事件（带日志序号）；状态变化发 `status`；队列变化发 `queue`。事件序号在会话句柄内从 1 起单调递增；订阅者只收到订阅之后的事件，不补发（断线补齐靠 `status` 与日志）。监听函数抛出只影响它自己（该订阅结束），不影响运行。`status.context` 给上下文用量：`window` 是最近一次受理选中的模型的 `contextWindow`（没有为 0），`tokens` 按 [`harness.compaction`](compaction.md) 输出 9 取最后一条助手消息报告的用量（`source: "reported"`）；还没有助手消息报告用量时按回放出的模型上下文用 OMP `Tokenizer` 估算（`source: "estimated"`：已知分词器家族精确计数，其它模型按字节除 4），`threshold` 是按最近一次受理的压缩设置算出的触发阈值；本进程内还没受理过调用的会话没有这一项。`status` 的 `pending` 与 `context` 按日志的条目数组缓存：没有新条目（也没有换模型或设置）时连续读取返回同一份结果，不重新回放；这份结果是冻结的（数组、事项、`context` 都是），调用方改它抛 `TypeError`。
6. **审批**：每个工具调用执行前，运行时在适配层的 `approve` 钩子里按 [`harness.tools`](tools.md) `decideApproval` 判定（`grants` 取会话里 `scope: "session"` 的应答与本次已写入的应答）：`allow` 放行；`deny` 拒绝（理由进工具结果）；`model` 调 `judgeWithModel`（模型角色 `approval`，`recent` 取当前上下文最后几条），`allow`/`deny` 照办，`escalate` 转为询问；询问先问宿主再问用户：写 `interaction request` 之后，给了 `deps.approve` 就把 `ApprovalPrompt`（会话、调用、事项 id、工具名与调用 id、参数、等级、Profile、信号）交给它——`args` 是冻结的深拷贝，回调改不了实际执行的参数；返回 `approve`/`reject` 就写 `interaction response`（`decidedBy: "host"`，`scope` 缺省 `once`，`scope: "session"` 同样进会话的放行记录）并照办，不进入等待；返回 `null` 交给用户；回调抛出按拒绝（`note` 为“审批回调出错：…”），宁可拒也不放行。回调挂起期间调用被中止：与等用户时被中止一样写 `{decision: "reject", decidedBy: "user", note: "aborted"}`（在终态条目之前），回调之后的结果丢弃，不再写条目。`ask` 询问用户：写 `interaction request`（`assistantEntryId` 为含该调用的助手条目、`toolCallId`、`toolName`、`tier`），写 `invocation waiting`（同一批里第二个询问不再写），状态变 `waiting-user`，发 `interaction` 与 `status` 事件，等待 `resolve`。同一批里多个询问可以同时待处理，任意顺序应答；全部处理完才回到 `running`（写 `invocation resumed`）。审批模型的判定（`decidedBy: "approver"`）也写成 `interaction` 的 request 与 response 两条，便于审计。
    `Invocation.next()` 给调用方一个等待点：这次调用此刻正在等待用户且有待处理事项时立即返回 `{kind: "waiting", pending}`（再调用仍返回，直到事项被应答）；否则等到它下一次进入 `waiting-user`（返回当时的事项）或结束（`{kind: "done", result}`，与 `done` 相同），先到的那个。应答全部事项后再 `next()` 就等下一个点。等待点尚未到来时多次 `next()` 共用同一次等待（返回同一个 Promise，结算为同一个结果对象），不累积订阅。
7. **应答**：`resolve({interactionId, decision, scope, note})`：id 不在待处理列表为 `unknown-interaction`；已应答或正在应答（同一事项并发两次 `resolve`，第二次）为 `already-answered`；通过后写 `interaction response`（`decidedBy: "user"`），`approve` 放行该调用，`reject` 的工具结果为 `denied` 带 `note`；`scope: "session"` 的放行记在日志里，同会话后续同工具同等级的调用按 [`harness.tools`](tools.md) 步骤 3 放行；应答不改配置。
8. **中止**：`abort()` 让状态进入 `aborting`，中止这次调用的控制器（Profile 的 `prepare`/`refresh` 与数据源收到信号；准备阶段中止时不开始循环，直接写 `invocation aborted`），调用 OMP `Agent.abort`，等待中的审批按输出 1 写拒绝应答并以 `aborted` 结果交回；运行结束后写 `invocation aborted`，`done` 以 `{status: "aborted"}` 完成，状态回到 `idle`。`abort({clearQueue: true})`（缺省 `true`）清空两个队列；`false` 保留追加队列但不自动开始。
9. **终态与结果分类**：OMP 循环结束时看最后一条助手消息：`stopReason: "error"` → 写 `invocation error`（`detail: {message, overflow}`），`done` 为 `{status: "failed", error: {kind: "model", message, overflow}}`，`overflow` 为真表示 OMP 把错误归类为上下文溢出；`"aborted"` → 按输出 8；其它 → 写 `invocation end`，`done` 为 `{status: "completed"}`。本次调用的助手回复达到 `limits.maxTurns` 时中止循环，`done` 为 `{status: "failed", error: {kind: "limit"}}`，写 `invocation error`。存储层面的写入失败（`store-failed`、`log-broken`、`log-closed`、`damaged-tail`）时中止循环，`done` 为 `{status: "failed", error: {kind: "log"}}`，会话句柄随日志进入 `closed`（之后操作为 `closed`）；条目校验失败（`invalid-entry`）只让那一步失败，不关闭句柄。Profile 的 `prepare`/`refresh` 失败 → `{kind: "profile"}`。调用进入 `waiting-user` 并在本进程内一直未应答时 `done` 不完成；`close()` 让它以 `{status: "waiting"}` 完成。
10. **继续**：`continue()` 在 `idle` 且日志末尾“可继续”时受理：末尾（回放后）是用户消息、工具结果，或 `stopReason` 为 `error` 的助手消息（重试）；末尾是正常的助手回复时为 `invalid-state`。继续开始一次新的调用（`invocation start`，`detail.reason: "continue"`），不写新的输入。
11. **队列**：`steer` 的消息交给 OMP `Agent.steer`，在下一次模型请求时送给模型（这次请求还没发出就并进这次；已发出则在当前工具批次结束后的那次），送达时写入日志（`role: "user"`）；`followup` 的消息留在运行时，本次调用以 `completed` 结束后自动受理为新的 `prompt`（按入队顺序一条一次；受理失败则留在队列并发 `status`）。以 `error`、`aborted`、`failed` 结束时不处理追加队列。队列只在内存：进程退出即丢。
12. **一次调用的时序约束**：审批等待期间插话不打断等待（OMP 的循环停在这批工具上，插话在这批结束后送达）；`done` 在终态条目写入之后才完成；`status` 事件在 `done` 完成之前发出。
13. **打开与恢复**：恢复后执行的工具收到中止信号；`abort()` 让还在执行的恢复停下，中止之后它的结果不再写入、不再 `resumed`（输出 8 的收口照常）。`openSession` 读日志；`sessionStatus` 为 `idle` 直接返回；为 `running` 或 `waiting` 时先用 `planRecovery` 收口并写入：有待处理审批的调用恢复为 `waiting-user`（`status.pending` 列出），其它写 `interrupted` 后为 `idle`。恢复后的 `resolve`：`approve` → 运行时按本次日志里的工具调用取实现、按 [`harness.tools`](tools.md) 输出 8 的顺序执行（审批已通过），写工具结果；`reject` → 写拒绝结果；该批全部有结果后写 `invocation resumed`，重建上下文（`replaceMessages`）并 `Agent.continue()` 让模型继续，之后同普通调用。恢复期间 `maxTurns` 从头计。
14. **压缩**：`compact()` 手动触发：按 Profile 的压缩设置与最近一次调用选中的模型（没有调用过时按选择链选）调用 [`harness.compaction`](compaction.md) `compactSession`（种子用 `renderSeeds("after-compaction")`），成功返回结果并发 `compaction` 事件；选中的模型没有正的 `contextWindow` 时不调用任何方法，返回 `compaction-failed` 并说明要在配置里给出 `contextWindow`（这是配置缺项，不是“没东西可压”）；`nothing-to-compact` 返回 `null`；写入失败为 `log-failed`；其它失败为 `compaction-failed`，`detail` 带压缩模块的失败码与各方法的原因。自动触发：一次调用以 `completed` 结束后，`shouldCompact({entries, contextWindow, settings})` 为真时在 `done` 完成之前运行一次压缩（失败只发 `compaction` 事件，不影响 `done`）；这是调用的尾段：状态仍是 `running`，压缩写入的条目算在本次 `InvocationResult.entries` 里，此时 `abort()` 取消压缩（`compaction` 事件 `ok: false, code: "cancelled"`，不写任何条目）但调用的结果仍是 `completed`；追加队列在压缩之后处理。
15. **溢出**：模型错误被 OMP 归类为上下文溢出时，调用以 `failed`（`overflow: true`）结束，不自动压缩也不重试；使用方可以 `compact()` 后 `continue()`（末尾是 `error` 的助手消息，可继续）。
16. **关闭**：`close()`：有进行中的调用先按输出 8 中止并等它收口；`waiting-user` 的调用不写新条目（下次打开按输出 13 恢复），`done` 以 `{status: "waiting"}` 完成；关闭日志；所有订阅结束；之后的操作返回 `closed`。
17. **预览**：`preview(input?, options?)` 回答“此刻发起这次调用，模型会收到什么”：按输出 2 的顺序做受理检查（输入——给了才查、Profile、模型选择与能力、可见工具、审批模式、压缩设置），**不取凭据**（没配 key 也能预览），任一失败返回同样的失败码；然后 `prepare`，按 `prepare` 的结果渲染 `seeds` 与 `appended`（与输出 3 同一阶段：真跑在刷新之前就把它们写进日志），再 `refresh`（与第一次请求前一致，`model-call` 数据源也跑）并按刷新后的结果渲染 `system` 与 `request`；`prepare`/`refresh` 失败为 `invalid-profile`，`detail` 逐行列出诊断（`code path：detail`）；期间 `signal` 中止与受理前已中止一样是 `invalid-state`。返回 `model`（选中的引用）、`tools`（可见工具 id）、`system`（刷新后的系统提示词）、`seeds`（日志里还没有种子时 `renderSeeds("new-session")` 的消息，否则空；形状与写进日志再回放的一样，带 `attribution: "agent"`，`History` 的 `last` 数起来与真跑一致）、`appended`（有 `input` 时 `renderAppending` 的消息，`attribution` 同输出 3）、`request`（`renderRequest({history: 回放上下文 + seeds + appended, invocationStart: 回放长度 + seeds 长度})` 的消息）与渲染产生的 `diagnostics`（每条只出现一次：系统提示词的诊断随请求渲染一起收；Profile 请求了来源里没有的工具时每个一条 `unknown-tool` 警告，`path` 为 `fields.harness/tools[<序号>]`）。读的是调用那一刻的日志：不写条目、不发请求、不发事件、不改状态、不占用会话，任何状态下都可以调用；运行中预览看到的是到当时为止的历史。
18. **缺省与便捷入口**：`createRuntime` 对 `config`、`profiles` 按对象身份归一化（deps 是活的，换了对象下一次读取才重新归一化；缺省模型目录跟着当前的配置存储换）。判别按完整的方法集合：有 `current`、`replace`、`subscribe` 的是配置存储，其余一律按配置对象校验；数组是 Profile 列表，有 `get`、`list`、`issues` 的是目录，别的形状抛 `HarnessError("invalid-profile")`。配置对象（`HarnessConfigInput`）建配置存储，不合法抛 `HarnessError("invalid-config")`，`detail` 逐行列出全部问题；`Profile[]` 建目录（`source: "inline"`），目录 `issues` 有错误抛 `HarnessError("invalid-profile")` 并带 `diagnostics`；`store` 缺省 `createMemorySessionStore()`；预算不合法抛 `HarnessError("invalid-limits")`。这些都在 `createRuntime` 返回前抛出，不等第一次调用。`openRuntime` 在此之上处理凭据：给了 `credentials` 原样用；否则 `openCredentials({sqlitePath: credentialsPath ?? ":memory:", apiKeys})`，失败抛 `HarnessError`（码照 [`harness.models`](models.md)），装配失败时把已开的库关掉再抛；`Runtime.close()` 关这个库，使用方自己传的凭据不关（`createRuntime` 的 `close()` 不做事）。`unwrap` 对本包任一模块的 Result 适用：成功给 `value`，失败抛 `HarnessError`，`code`、`detail`（与 `diagnostics`，有的话）与 Result 里的相同（[`harness.config`](config.md) 的失败带 `problems`：`detail` 逐行为 `path：reason`）——Result 是合同，`unwrap` 只是便捷层。

## 状态与转换

```text
idle ──prompt/continue 受理──▶ running ──询问用户──▶ waiting-user ──全部应答──▶ running
  ▲                              │                        │
  │                              │ abort                  │ abort（挂起的审批写拒绝）
  │                              ▼                        ▼
  └──────── 终态条目写入 ◀──── aborting ◀────────────────────┘
  ▲
  └── running：循环结束（end / error / limit）
```

- 一个会话句柄同一时间最多一次调用；`prompt` 在非 `idle` 时按输出 1 入队或拒绝。受理是异步的（取凭据、准备 Profile）：从受理开始到 `invocation start` 写入，以及手动压缩从开始到写入，会话都被**占用**，这期间第二个 `prompt`、`continue`、`compact` 得到 `busy`（受理失败或压缩结束即释放）。
- 调用的 `invocationId` 由运行时生成（会话内唯一）。
- 终态条目写入后状态才回到 `idle`，然后处理追加队列。
- `waiting-user` 跨进程存在（日志里有未应答的 request）；其它状态都是进程内的。

**时序与寿命**：

- 配置快照、Profile 的 `prepare`、模型、工具列表在受理时取定，调用内不变；`refresh` 只刷新 `model-call` 数据源。
- 事件在对应条目写入之后发出（`entry` 事件带日志序号）；`stream`、`tool` 事件在条目写入之前（它们不是条目）。
- `done` 在终态条目、自动压缩（若有）与 `status` 事件之后完成。

## 副作用与数据

- 写入会话日志（经 [`harness.session`](session.md)）；模型调用（经 OMP `Agent`，费用归选中的模型与审批模型）；不读环境变量、不碰文件系统（存储由使用方传入）。
- 内存：每个会话句柄一个 OMP `Agent`（持有当前消息副本）、两个队列、事件序号；`close` 后释放。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `busy` | 有进行中的调用；`prompt` 没有 `streamingBehavior` 或 `continue`/`compact` | 等待、排队或中止 |
| `invalid-state` | 操作在当前状态下不允许（见输出 1、10） | 按状态选择操作 |
| `invalid-input` | 输入为空或块不合法 | 修正输入 |
| `unknown-profile` / `invalid-profile` | Profile 不在目录里 / `prepare` 前的校验失败（目录 `issues`） | 修正 Profile |
| `model-unavailable` | 模型选择失败，`detail` 带 [`harness.models`](models.md) 的失败码 | 修配置或指定模型 |
| `credentials-missing` | 选中的模型取不到凭据 | 设置 API key 或登录 |
| `capability-missing` | 输入带图片但模型不支持，或 Profile 要工具但模型不支持工具 | 换模型 |
| `tool-conflict` | 可见工具同名冲突 | 修工具来源 |
| `unknown-interaction` / `already-answered` | 应答的 id 不在待处理列表 / 已应答 | 刷新状态 |
| `session-exists` / `session-not-found` / `corrupt-session` | 透传 [`harness.session`](session.md) | 同会话模块 |
| `compaction-failed` | 手动压缩时方法都失败或顺序里有未注册的方法，或选中的模型没有 `contextWindow`；`detail` 带压缩模块的失败码与原因 | 看原因；通常是摘要模型不可用或自建模型没配 `contextWindow` |
| `closed` | 句柄已关闭 | 重新 `openSession` |
| `log-failed` | 受理后第一条写入就失败（`invocation start`），没有留下调用 | 同会话模块的写入失败处理 |

受理之后的失败不是 `RuntimeFailure`，而是 `InvocationResult.error`（输出 9）。

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/runtime` 中“输入与前置条件”列出的符号与类型。
- **依赖**：本包全部其它模块（运行时依赖，经各自公开入口）；OMP `@oh-my-pi/pi-agent-core`（`Agent`）运行时，`@oh-my-pi/pi-ai` 类型与 `AIError` 归类，`@oh-my-pi/pi-catalog` 类型。
- **与 OMP 的关系**：只用 `Agent` 的循环、队列与 `abort`；不用它的审批、预测执行、`beforeToolCall`、会话层。`transformContext` 用来注入 Profile 的请求渲染；`getApiKey` 按次取凭据。
- **插件阶段**：`RuntimeDeps` 的每一项对应设计稿“插件的落脚点”表里的一行；事件由插件经远程服务推送。

## 验收与 Smoke

1. 一次完整调用（脚本化模型，不联网）：新会话 `prompt` → 日志依次为 `invocation start`、两条种子、输入、提醒、`profile-state`、助手消息（带工具调用）、工具结果、助手回复、`invocation end`；事件序号单调递增、`status` 依次 `running`→`idle`；`done` 为 `completed`，`entries` 等于这次写入的条目；第二次 `prompt` 不再写种子，`turn` 为 2。
2. 受理失败：空输入、未知 Profile、模型解析失败、无凭据、工具同名冲突、Profile 要工具但模型不支持——各返回对应失败码，日志不变、无事件。
3. 审批等待与应答（真实 OMP `Agent`、真实 JSONL 存储）：工具等级 `exec`、模式 `write` → 写 `interaction request` 与 `invocation waiting`，`status.phase` 为 `waiting-user`，`done` 未完成；`resolve({approve, scope: "session"})` → 工具执行、写 response 与 `invocation resumed`，调用完成；同一会话再次调用同工具不再询问。`reject` 时工具结果为 `denied` 带 `note`。同一批两个询问任意顺序应答。
4. 中止：等待审批时 `abort()` → 待处理的审批写拒绝应答（`note: "aborted"`）、工具结果 `aborted`、`invocation aborted`、`done` 为 `aborted`、队列清空；运行中 `abort()` 同样收口。
5. 队列：运行中 `steer` 一条 → 下一次模型请求收到它（在工具批次中入队的，日志里它在工具结果之后）；`followup` 一条 → 第一次调用 `completed` 后自动开始第二次（新的 `invocation start`），`queue` 事件先 1 后 0；以 `aborted` 结束时追加队列不处理。
6. 终态分类：模型回复 `stopReason: "error"` → `failed`/`model`，日志 `invocation error`；`maxTurns: 2` 且模型一直要求工具 → `failed`/`limit`；日志写入失败（存储注入失败）→ `failed`/`log`，句柄 `closed`。`continue()`：错误后可继续并成功；正常回复后 `invalid-state`。
7. 恢复（真实 JSONL）：等待审批时直接丢弃句柄（模拟崩溃），`openSession` → `waiting-user`、`pending` 一条；`resolve(approve)` → 工具执行、写结果、`invocation resumed`、模型继续、`completed`。另一会话在运行中崩溃（没有待处理）→ `openSession` 写 `interrupted` 结果与 `invocation interrupted`，状态 `idle`。
8. 压缩：`compact()` 在有足够历史时追加 `compaction` 与种子并发事件，无历史时返回 `null`；模型没有 `contextWindow` 时为 `compaction-failed`；阈值设置很低时一次调用 `completed` 后自动压缩，`done` 完成时日志末尾已是压缩条目与种子。
10. 缺省依赖与状态：只给 `config`、`profiles`、`credentials`、`store` 的运行时能跑完一次没有工具的调用；配置 `replace` 加一个服务后，下一次 `prompt` 指定该服务的模型能受理；`status.context` 在调用完成后给出最后一条助手消息报告的用量与阈值（`source: "reported"`）；模型以 `error` 结束、还没有可用的用量时 `tokens` 是估算值（`source: "estimated"`，大于 0）；没有新条目时连续两次读 `status` 得到同一个 `pending` 数组。
11. `next()`：等待审批时返回 `waiting` 与事项，应答后再 `next()` 返回 `done`；没有审批的调用第一次 `next()` 就是 `done`，`result` 与 `done` 相同；等待点未到时连续调用 100 次 `next()` 得到同一个结果对象。
12. 预览：新会话 `preview(input)` 得到种子、输入、系统提示词与带历史的请求消息，日志不变、无事件、状态不变；种子与系统提示词里都有 `model-call` 数据源时，预览的种子是 `prepare` 那一版、系统提示词是刷新后那一版，与随后真跑写进日志的种子、第一次请求的系统提示词各自同阶段；没有凭据也能预览；同时没有凭据又有工具来源冲突时真跑报 `credentials-missing`、预览报 `tool-conflict`（输出 2 的顺序，预览跳过凭据）；已中止的 `signal` 为 `invalid-state`；预览的 `request` 与随后真跑第一次请求的消息同形（时间戳除外）；`harness/tool` 拼错的 Profile 为 `invalid-profile` 且 `detail` 含 `unknown-field`；系统提示词里的未知节点在 `diagnostics` 里只有一条；请求了没装的工具时受理照常、`tools` 只有装了的、`diagnostics` 有一条 `unknown-tool`、随后真跑的 `invocation start` 带 `missingTools`；一次调用后再 `preview` 的 `request` 含上一轮的助手回复、`seeds` 为空。
13. 便捷入口：`openRuntime({config: 配置对象, profiles: [Profile], apiKeys})` 跑完一次调用；`unwrap` 成功给值、失败抛 `HarnessError` 且 `code`/`detail` 与 Result 相同；坏配置、重复 Profile、打不开的凭据库各在装配时抛出。宿主审批：回调批准（`scope: "session"` 后同会话不再问）、拒绝（结果 `denied` 带说明）、返回 `null` 落到 pending 等 `resolve`、抛出按拒绝；`response.decidedBy` 为 `host`；回调改参数不影响执行；回调挂起时中止，应答为用户中止且在终态之前，迟到的结果不写条目。归一化：带 `current`/`replace` 字段的配置对象按配置校验、类数组对象报 `invalid-profile`；换 `deps.config` 对象后预览能选新配置里的模型。
9. 真实模型冒烟（`*.llm.test.ts`，显式运行）：用测试配置的模型跑一次带 `read` 风格只读工具的调用，`completed`，日志里有工具调用与结果。

Smoke：`packages/nb-harness` 的 `bun test src/runtime`；真实模型 `bun run test:llm`（需授权）。

## 实现合同

- 公开入口：`@notnotype/nb-harness/runtime`（也是包根入口 `.`）：`createRuntime`、`openRuntime`、`unwrap`、`HarnessError`、`registerRuntimeFields`、`TOOLS_FIELD`、`APPROVAL_FIELD`（`harness/tools`、`harness/approval` 两个字段的定义，供使用方先于运行时注册）与“输入与前置条件”的类型。
- owner：`nb-harness` 的 `runtime` 模块；运行时依赖本包其它六个模块（经各自公开入口）与 `@oh-my-pi/pi-agent-core` 的 `Agent`，对 `@oh-my-pi/pi-ai`、`@oh-my-pi/pi-catalog` 只用类型与错误归类。
- 内部不变量（都有测试锁定）：
  1. 受理阶段不调用 `log.append`；受理通过后第一条写入是 `invocation start`。
  2. 助手消息与工具结果只在 `message_end` 写入；本次输入与插话各写一次（通过消息对象身份去重）。
  3. 终态条目写入之后才改状态、发 `status`、完成 `done`。
  4. `Agent` 的 `convertToLlm` 保留 `developer`；`speculativeToolExecution` 不开启；`beforeToolCall` 不用。
  5. 测试用 OMP `streamFn` 脚本化模型（与 tools 模块同一做法），审批模型用 `judge.stream`；真实模型路径由 `*.llm.test.ts` 覆盖。

## 证据

- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“Agent 运行时”“工具审批”“事件、推送与分页”“模块划分与推进顺序”（开发者 2026-10-10 决定：每个会话一个 OMP `Agent`，内核在外面加持久化、状态机与审批；运行中的 `prompt` 用 `streamingBehavior` 入队否则拒绝；队列只在内存；受理错误不写东西、受理后失败写终态；审批自建、等待在工具执行包装里、不开预测执行；只做审批恢复；内核不做 SSE、事件带序号、发起与完成分开；压缩触发只做手动、溢出、一轮结束超阈值）。
- 实现入口：[`packages/nb-harness/src/runtime/runtime.ts`](../../../packages/nb-harness/src/runtime/runtime.ts)
- 合同测试：[`runtime.test.tsx`](../../../packages/nb-harness/src/runtime/runtime.test.tsx)、[`approval.test.tsx`](../../../packages/nb-harness/src/runtime/approval.test.tsx)、[`recovery.test.tsx`](../../../packages/nb-harness/src/runtime/recovery.test.tsx)、[`compaction.test.tsx`](../../../packages/nb-harness/src/runtime/compaction.test.tsx)（真实 OMP `Agent`、真实 SQLite 凭据库、内存与 JSONL 存储，模型流经 OMP `streamFn` 脚本化）
- Smoke：[`runtime.llm.test.tsx`](../../../packages/nb-harness/src/runtime/runtime.llm.test.tsx)（真实模型，只在 `bun run test:llm` 下运行）
