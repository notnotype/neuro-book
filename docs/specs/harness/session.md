---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.session
owners:
  - nb-harness
---

# Harness 会话：只追加的事件日志

## 目标与非目标

`nb-harness` 的 `session` 模块给 Agent 运行时和以后的插件提供会话日志：一个会话是一份只追加的条目序列，写入后不改不删；会话的一切状态（模型该看到的上下文、是否在等待用户、当前模型与标题、本会话内的审批允许）都由条目回放得出；新写入的条目按顺序实时推给订阅者；界面按页读取历史。条目形状是 OMP 会话条目的子集，OMP 的压缩算法可以直接处理。存储经接口，附内存与 JSONL 两种实现。本模块不依赖 Agent 循环，也不调用模型。

不承诺：

- 分支与重试：条目格式带 `parentId` 以便以后支持，v1 的每个条目都接在上一个条目之后，不提供移动叶子或从旧条目分叉的操作。
- 多个写者：同一会话同一时刻只有一个句柄写入，由使用方保证；另一个进程或另一个句柄追加的条目，本句柄看不到，也不检测。
- 压缩怎样执行（何时触发、用哪种方法、调用哪个模型）：本模块只定义压缩条目与压缩后的回放规则，执行由压缩模块负责。
- 附件与大内容外置、会话删除与归档、会话列表的检索与分页、按页读取时从文件按范围读取（v1 打开会话时读入全部条目）。
- 跨进程的订阅：订阅只在打开会话的进程内有效。
- 断电或操作系统崩溃时的持久性：`append` 成功返回只表示数据已交给操作系统；断电后最后几批可能缺失，或留下不完整的末行，重开时按输出 6 处理。
- 旧原型 `nb-session` 的文件格式：不兼容，不迁移。

## 术语与参与者

- **会话头**：会话文件的第一行，记录格式版本、会话 id、创建时间与可选的父会话。
- **条目**：会话头之后的每一项，带类型、条目 id、`parentId` 与时间戳。
- **条目输入**：调用方追加时给出的条目内容，不含条目 id、`parentId` 与时间戳，由日志补上。
- **叶子**：最后一个条目；新条目的 `parentId` 是它的 id，第一个条目的 `parentId` 为 `null`。
- **序号**：条目在会话中的位置，从 1 起，与写入顺序一致；订阅与续传按序号。
- **日志句柄**：打开或新建一个会话得到的对象，持有该会话已读回与已写入的全部条目。
- **回放**：从条目序列计算派生状态的纯函数；同样的条目序列总得到同样的结果。
- **存储**：持久化会话的接口；本模块附内存存储与 JSONL 存储。
- **调用窗口**：一条助手 `message` 条目，加上它之后、下一条助手或用户 `message` 之前的全部 `toolResult` 消息。工具结果只与同一窗口里助手消息中 id 相同的工具调用配对；不同窗口里 id 相同的工具调用互不相干。
- **调用条目、交互条目**：正文里的 `invocation` 条目、`interaction` 条目分别指 `customType` 为 `harness/invocation`、`harness/interaction` 的 `custom` 条目，形状见“输入与前置条件”。
- **本段历史**：最后一个 `compaction` 条目之后的条目；没有压缩时为全部条目。
- **种子**：`customType` 为 `harness/seed` 的 `custom_message` 条目，由 Profile 的 `History` 子节点产生（见 [`harness.profile`](profile.md)），在新会话开始与每次压缩之后写入。
- **轮**：从一条用户发出的 `message` 条目（`role: "user"`，`attribution` 不是 `"agent"`，`synthetic` 不为真）开始，到下一条这样的条目之前的全部条目；第一条之前的条目算作第一轮。`custom_message` 与压缩条目不开始新的一轮。[`harness.profile`](profile.md) 对回放出的消息用同一划分。
- **未结束的调用**：最后一个 `invocation` 的最后阶段为 `start`、`resumed` 或 `waiting`；它的**范围**是该调用最后一个 `start` 或 `resumed` 条目之后的条目。

## 输入与前置条件

### 条目

```ts
type SessionHeader = {type: "session"; version: 1; id: string; createdAt: string; parentSession?: string};

type EntryBase = {id: string; parentId: string | null; timestamp: string};
type SessionEntry = EntryBase & (
    | {type: "message"; message: Message}
    | {type: "custom_message"; customType: string; content: string | (TextContent | ImageContent)[]; display: boolean; details?: JsonValue}
    | {type: "custom"; customType: string; data?: JsonValue}
    | {type: "model_change"; model: string; role?: string}
    | {type: "thinking_level_change"; thinkingLevel: string | null}
    | {type: "title_change"; title: string; source: "auto" | "user"}
    | {type: "compaction"; summary: string; firstKeptEntryId: string; tokensBefore: number; shortSummary?: string;
       details?: JsonValue; preserveData?: {[key: string]: JsonValue}; providerReplayThroughEntryId?: string}
);
// harness 保留的 custom 与 custom_message 类型
type InvocationData = {invocationId: string; phase: "start" | "waiting" | "resumed" | "end" | "error" | "aborted" | "interrupted"; detail?: JsonValue};
type InteractionData = {interactionId: string; kind: "approval" | "question"; phase: "request" | "response";
    request?: {assistantEntryId: string; toolCallId: string; toolName: string; tier?: "read" | "write" | "exec"; data?: JsonValue};
    response?: {decision: "approve" | "reject" | "answer"; scope?: "once" | "session"; decidedBy: "user" | "approver"; note?: string; data?: JsonValue}};
type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type EntryInput = DistributiveOmit<SessionEntry, "id" | "parentId" | "timestamp">;
```

| `customType` | 条目类型 | `data` 或 `details` | 含义 |
|---|---|---|---|
| `harness/invocation` | `custom` | `data: InvocationData` | 调用的生命周期 |
| `harness/interaction` | `custom` | `data: InteractionData` | 待用户处理的事项：提出与应答 |
| `harness/seed` | `custom_message` | `details: {role: "user" \| "developer"; once?: boolean}` | `History` 的种子；`role` 是种子消息的角色，`once` 为真表示只在新会话写入 |
| `harness/reminder` | `custom_message` | 无 | `Appending` 里 `Reminder` 产生的提醒，内容已用 `<system-reminder>` 包好 |
| `harness/profile-state` | `custom` | `data: {profileId: string; state: JsonValue}` | Profile 有状态节点（例如 `Reminder`）的状态快照；后写覆盖前写 |

`Message`（`UserMessage | DeveloperMessage | AssistantMessage | ToolResultMessage`）、`TextContent`、`ImageContent` 是 `@oh-my-pi/pi-ai` 的类型。OMP `AgentMessage` 中扩展自定义的消息不存为 `message` 条目，需要模型看到的自定义内容用 `custom_message`。

| 规则 | 内容 |
|---|---|
| 会话 id | 1–128 个字符，`[A-Za-z0-9._-]`；新建时不给出则由日志生成 |
| `message.message.role` | `user`、`developer`、`assistant` 或 `toolResult` |
| `customType` | `<命名空间>/<名称>`：命名空间以 `[a-z0-9]` 开头、由 `[a-z0-9.-]` 组成，名称以 `[a-z0-9]` 开头、由 `[a-z0-9._-]` 组成；命名空间 `harness` 留给本包 |
| `interaction` 条目的 `data` | `phase: "request"` 必须有 `request`、不得有 `response`；`"response"` 反之。同一 `interactionId` 至多一个 request、至多一个 response，response 在 request 之后。`request.assistantEntryId` 是含该工具调用的助手 `message` 条目的 id，与 `toolCallId` 一起确定是哪个窗口里的哪个调用 |
| 保留类型 | `harness/` 开头的 `customType` 只能是上表五种，`data` 或 `details` 必须符合上表的形状 |
| 值 | 整个条目必须能被 JSON 如实表示：没有 `undefined`、函数、`NaN`、`Infinity`、`bigint` 与循环引用；对象只含普通数据 |

### 接口

```ts
// 公开入口 @notnotype/nb-harness/session
createSession(store: SessionStore, options?: {id?: string; parentSession?: string; now?: () => Date}): Promise<Result<SessionLog>>;
openSession(store: SessionStore, id: string, options?: {now?: () => Date}): Promise<Result<SessionLog>>;
createMemorySessionStore(): SessionStore;

interface SessionLog {
    readonly header: SessionHeader;
    readonly entries: readonly SessionEntry[];       // 按序号排列
    readonly damagedTail: {bytes: number} | null;      // 打开时发现的中断尾
    append(inputs: readonly EntryInput[]): Promise<Result<readonly SessionEntry[]>>;
    subscribe(listener: (event: {seq: number; entry: SessionEntry}) => void, options?: {afterSeq?: number; onEnd?(reason: LogEndReason): void}): {release(): void};
    repair(): Promise<Result<{droppedBytes: number}>>;
    close(): void;
}
type LogEndReason = "closed" | "broken" | "listener-error";

// 回放（纯函数）
buildModelContext(entries: readonly SessionEntry[]): Message[];
sessionStatus(entries: readonly SessionEntry[]): {phase: "idle" | "running" | "waiting"; invocationId?: string; pending: PendingInteraction[]};
sessionSettings(entries: readonly SessionEntry[]): {model?: string; role?: string; thinkingLevel?: string; title?: string; approvalGrants: {toolName: string; tier?: string}[]};
type Projection<S> = {readonly initial: S; reduce(state: S, entry: SessionEntry): S};
type PendingInteraction = {interactionId: string; kind: "approval" | "question"; request: NonNullable<InteractionData["request"]>};
defineProjection<S>(projection: Projection<S>): Projection<S>;
fold<S>(entries: readonly SessionEntry[], projection: Projection<S>): S;
planRecovery(entries: readonly SessionEntry[]): EntryInput[];

// 分页（纯函数）
readPage(session: {header: SessionHeader; entries: readonly SessionEntry[]}, options: {before?: PageCursor; maxTurns: number; maxBytes: number; fieldBudget: number}):
    Result<{entries: readonly TrimmedEntry[]; next: PageCursor | null; latestSeq: number}>;
readEntry(entries: readonly SessionEntry[], id: string): Result<{seq: number; entry: SessionEntry}>;
type PageCursor = string;          // 不透明
type TrimmedEntry = {seq: number; entry: SessionEntry; trimmed: {path: string; originalBytes: number}[]};

// 存储接口
interface SessionStore {
    create(header: SessionHeader): Promise<Result<void>>;
    open(id: string): Promise<Result<{header: SessionHeader; entries: SessionEntry[]; damagedTail: {bytes: number} | null}>>;
    append(id: string, entries: readonly SessionEntry[]): Promise<Result<void>>;
    repair(id: string): Promise<Result<{droppedBytes: number}>>;
    list(): Promise<Result<SessionSummary[]>>;
}
type SessionSummary = {id: string; createdAt: string; parentSession?: string; title?: string; updatedAt: string};
type Result<T> = {ok: true; value: T} | {ok: false; code: SessionFailure; detail: string; line?: number; index?: number};
type SessionFailure = "invalid-session-id" | "session-exists" | "session-not-found" | "corrupt-session" | "unsupported-version"
    | "invalid-entry" | "damaged-tail" | "store-failed" | "log-broken" | "log-closed" | "invalid-cursor" | "entry-not-found";

// 子入口 @notnotype/nb-harness/session/jsonl
createJsonlSessionStore(options: {root: string}): SessionStore;
```

方法都不抛出业务失败，失败以 `Result` 返回；只有调用方违反类型约束（例如传入非数组）时才可能抛出。

## 输出与可观察行为

1. **新建**：`createSession` 写入会话头，返回没有条目的日志句柄。会话 id 不合规则为 `invalid-session-id`；已存在为 `session-exists`，不改动已有会话。
2. **追加**：`append` 给每条输入补上条目 id（会话内唯一）、`parentId`（上一条的 id，第一条为 `null`）与时间戳，经存储写入成功后才把这批条目加入 `entries` 并通知订阅者，返回补全后的条目。空批返回空数组，不写任何东西。
3. **校验**：一批里任何一条不符合“输入与前置条件”的规则，整批为 `invalid-entry`，不写入；`index` 为第一条不合规则的输入在这批里的位置（从 0 起），`detail` 说明原因。
4. **时间戳**：取自 `now`（缺省为系统时钟）；同一句柄写出的时间戳单调不减，时钟倒退时沿用上一条的时间。
5. **打开**：`openSession` 读回会话头与全部条目，`entries` 与写入时补全后的条目逐项相等（JSON 往返）。会话 id 不合规则为 `invalid-session-id`；会话不存在为 `session-not-found`。
6. **中断尾**：JSONL 文件末尾不以换行结束的部分是中断尾：`openSession` 照常返回之前的条目并在 `damagedTail` 报告字节数；有中断尾时 `append` 为 `damaged-tail`，`repair` 截掉中断尾后可以继续追加。没有中断尾时 `repair` 返回 `droppedBytes: 0`。
7. **损坏的条目**：以换行结束、却不能解析或不符合条目规则的一行，`openSession` 为 `corrupt-session`，`line` 为该行的行号（会话头为第 1 行）；不截断、不改写文件。会话头缺失或无效同样为 `corrupt-session`。
8. **版本**：会话头 `version` 不是 1 时为 `unsupported-version`，不改写文件。
9. **订阅**：`subscribe` 先按序号补发 `afterSeq` 之后已有的条目（缺省 0，即全部），再按写入顺序推送之后成功追加的条目；每个条目对同一订阅只推一次。补发在 `subscribe` 返回前同步完成，之后的推送在对应 `append` 完成之前同步完成。
    1. 监听函数抛出异常时，这个订阅立即以 `onEnd("listener-error")` 结束，不再收到后续条目；其它订阅与 `append` 的结果不受影响。
    2. 监听函数里调用 `release`：本订阅从下一个条目起不再收到推送（同一批剩下的条目也不推），不调用 `onEnd`。
    3. 监听函数里调用 `append`：新的追加排在当前追加之后执行（见“并发”），它的条目在当前这批全部推送完之后才推送。
    4. 监听函数里调用 `close`：当前这批剩下的条目不再推送，所有订阅按输出 11 结束。
    5. 在已关闭或已损坏的句柄上 `subscribe`：不补发，立即以 `onEnd("closed")` 或 `onEnd("broken")` 结束，返回的 `release` 没有效果。
    6. `release` 后不再推送，也不调用 `onEnd`。
10. **写入失败**：存储在 `append` 中失败（I/O 错误）时返回 `store-failed`，这批条目不进入 `entries`、不推送；句柄进入损坏状态：之后的 `append`、`repair` 为 `log-broken`，订阅以 `onEnd("broken")` 结束，只有 `close` 有效。恢复的唯一途径是用 `openSession` 重新打开：文件里可能已经有这批的前几条完整条目（重开后作为普通条目读回）、可能留下中断尾（按输出 6 先 `repair`），也可能整批都已写入。
11. **关闭**：`close` 后 `append`、`repair` 为 `log-closed`，订阅以 `onEnd("closed")` 结束；重复 `close` 没有效果。
12. **模型上下文**：`buildModelContext` 返回可以直接交给 OMP `Agent`（`replaceMessages`）的消息序列：其中每个工具调用都在自己的调用窗口里有工具结果，每个工具结果都配得上同一窗口里的一个工具调用。规则：
    1. 没有压缩时按序号取 `message` 与 `custom_message`。有压缩时取最后一个 `compaction` 条目，依次是：本段历史里的种子、压缩摘要（以一条用户消息出现）、从 `firstKeptEntryId` 起到该 `compaction` 条目之前的 `message` 与 `custom_message`（其中的种子不再出现）、本段历史里其余的 `message` 与 `custom_message`。`custom_message` 出现在原位置：种子的角色取 `details.role`，其它为用户消息；由 `custom_message` 得到的消息与压缩摘要都带 `attribution: "agent"`，因此不开始新的一轮；
    2. 去掉 `stopReason` 为 `error` 或 `aborted` 的助手消息，以及同一窗口里的工具结果；
    3. 去掉在自己的窗口里没有工具结果的工具调用，包括还在等待审批的调用（等待中的事项由输出 13 报告，应答并写入结果之后才出现在模型上下文中）；
    4. 被去掉工具调用的助手消息，同时去掉其中的 `redactedThinking` 块、清除 `thinking` 块的签名；去掉后没有内容的助手消息整条去掉；
    5. 去掉在自己的窗口里配不上工具调用的工具结果。
    按目标模型做的协议转换（工具 id 归一化、跨模型的思考块处理）不在本函数内，由 OMP 在每次请求时完成。
13. **会话状态**：`sessionStatus` 的 `pending` 列出未结束的调用范围内有 request、没有 response 的 `interaction`（id、kind、request）；`phase` 在没有未结束的调用时为 `idle`，有未结束的调用且 `pending` 非空时为 `waiting`，有未结束的调用且 `pending` 为空时为 `running`；`invocationId` 是未结束的调用的 id。刚打开的会话处于 `running` 或 `waiting`，说明上次运行没有正常收口，调用方先用 `planRecovery` 收口。
14. **会话设置**：`sessionSettings` 中模型与角色取最后一个 `model_change`，思考档位取最后一个 `thinking_level_change`，标题取最后一个 `title_change`；`approvalGrants` 列出 `decision: "approve"`、`scope: "session"` 的应答所对应 request 的工具名与等级，按出现顺序去重。
15. **自定义回放**：`fold(entries, defineProjection({initial, reduce}))` 从 `initial` 起按序号对每个条目调用一次 `reduce`，返回最终状态；不认识的条目类型由 `reduce` 自行跳过。
16. **崩溃收口**：`planRecovery` 只计算、不写入，返回调用方应追加的条目。没有未结束的调用时返回空数组；已经以 `end`、`error`、`aborted` 或 `interrupted` 结束的调用不再处理。有未结束的调用时，只看它范围内的助手消息，对其中在自己窗口里没有工具结果的每个工具调用（按出现顺序）：
    1. 有审批 request、没有 response：不返回结果，它仍是待处理事项；
    2. 有 response 且 `decision` 为 `reject`：返回一条 `toolResult`（`isError` 为真，内容说明用户拒绝并带上 `note`）；
    3. 其余（已批准但没有结果、没有任何 interaction）：返回一条 `toolResult`（`isError` 为真，内容说明执行被中断、结果未知）。
    然后：仍有待处理事项而最后阶段不是 `waiting` 时，返回一条该调用的 `waiting`；没有待处理事项时，返回一条该调用的 `interrupted`。对追加这些条目之后的条目再次调用，返回空数组或只剩针对新状态的条目（等待中的事项保持不变）。
17. **列出**：`list` 返回存储中每个会话的摘要：id、创建时间、父会话、最后一个 `title_change` 的标题、最后一个条目的时间（没有条目时为创建时间）；有中断尾的会话照常列出，损坏的会话不列出。
18. **两种存储**：内存存储与 JSONL 存储对输出 1–11、17、19 的行为相同；JSONL 存储另外满足输出 6、7 中与文件有关的部分。
19. **条目不可变**：`append` 保存输入的副本，返回后再修改传入的对象不影响日志；`entries`、`append` 的返回值与推送给订阅者的条目是同一份冻结的值，修改它们会抛出 `TypeError`，不影响日志与其它订阅者。
20. **按页读取**：`readPage` 以轮为单位从新到旧取一页：不给 `before` 时取最后一页，给出时取该游标之前的一页。从游标之前最近的一轮起，按从新到旧的顺序逐轮加入，直到再加一轮会超过 `maxTurns` 轮或 `maxBytes` 字节为止；字节数按截断之后（输出 21）的条目的 JSON 以 UTF-8 计。一页至少一轮：最近的那一轮单独就超过 `maxBytes` 时，它整轮单独成页。返回的条目按序号升序，附各自的序号；`next` 是更早一页的游标，已到最早时为 `null`；`latestSeq` 是当前最后一个条目的序号，供调用方从它之后订阅。游标绑定会话 id 与位置：之后追加的条目不影响已发出的游标；游标属于另一个会话 id、格式不对或位置超出当前条目时为 `invalid-cursor`。
21. **截断大字段**：`readPage` 返回的条目里，只有下列位置的字符串在超过 `fieldBudget` 字节（UTF-8）时被截短，截短后不超过预算且不拆开一个字符：文本块的 `text`、思考块的 `thinking`、字符串形式的消息 `content`、工具调用 `arguments` 里任意深度的字符串、`custom_message` 的 `content` 与 `details`、`custom` 的 `data` 里任意深度的字符串、`compaction` 的 `summary`；图片块的 `data` 超过预算时置为空字符串。条目类型、角色、各种 id、工具名、`customType` 等其它字段一律原样。`trimmed` 列出被截字段的路径（如 `message.content[2].text`）与原始字节数。截断只作用于返回值，不改变日志。
22. **按 id 读取**：`readEntry` 返回指定 id 的完整条目与序号，没有该 id 为 `entry-not-found`。
23. **与 OMP 兼容**：条目（不含会话头）满足 OMP `@oh-my-pi/pi-agent-core` 压缩模块的 `SessionEntry` 类型；`entries` 的浅副本（`[...entries]`，OMP 的签名要求可变数组，它不改写条目）可以交给它的 `prepareCompaction`，关闭远程与原生压缩（`remoteEnabled: false`）时它产生的文本摘要按 `compaction` 条目追加后，`buildModelContext` 按输出 12 回放。v1 的回放只使用压缩条目的 `summary` 与 `firstKeptEntryId`：`preserveData`、`providerReplayThroughEntryId` 照样保存与读回，但不参与回放，所以 OMP 的远程原生压缩（摘要只是占位、真正的历史在 `preserveData` 里）在 v1 不可用。

## 状态与转换

日志句柄：

| 当前 | 事件 | 结果 |
|---|---|---|
| 可写 | `append` 成功 | 可写，条目增加 |
| 可写 | 存储写入失败 | 损坏：`append`、`repair` 为 `log-broken`，订阅以 `broken` 结束，只能 `close` |
| 有中断尾 | `append` | `damaged-tail`，不变 |
| 有中断尾 | `repair` 成功 | 可写 |
| 可写、有中断尾、损坏 | `close` | 已关闭：`append`、`repair` 为 `log-closed`，订阅以 `closed` 结束 |

**并发**：同一句柄上的 `append` 与 `repair` 按调用顺序依次执行；后一次在前一次完成后才开始，前一次失败不阻止后一次执行（损坏状态除外）。

**时序与寿命**：

- `append` 返回成功时，这批条目已经交给存储写入，并已在 `entries` 中、已推送给当时的订阅者；返回失败时三者都没有发生。
- 订阅者收到某个条目时，该条目已经写入存储。
- 同一句柄的订阅者看到的序号严格递增且没有空缺；用最后收到的序号作 `afterSeq` 重新订阅，不漏也不重。
- 句柄只在进程内有效；进程重启后用 `openSession` 重新打开，序号与重启前一致。写入失败后重开的句柄从文件实际内容编号：它的序号与旧句柄已推送过的序号一致，旧句柄没推送过、却已落盘的条目从旧订阅最后收到的序号之后接着编号，所以用最后收到的序号作 `afterSeq` 在新句柄上订阅，能补到它们。
- 回放与 `planRecovery` 不依赖句柄，可以对任意条目序列调用；对 `entries` 的同一份内容，任何时候调用结果相同。

## 副作用与数据

- **内存存储**：只在进程内存中，随对象回收。
- **JSONL 存储**：每个会话一个文件 `<root>/<会话 id>.jsonl`，UTF-8，第一行是会话头，其后每行一个条目，每行以换行结束。只追加；只有 `repair` 截断文件末尾的中断尾。`root` 必须是已存在的目录，存储不创建它，也不删除会话文件。
- **格式版本**：会话头 `version: 1`。读到不认识的版本不改写文件。
- **数据归属**：会话文件归使用方；保留、备份、删除与跨进程互斥由使用方负责。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-session-id` | 会话 id 不合规则 | 换一个合规的 id |
| `session-exists` | 新建时会话已存在 | 改用 `openSession`，或换 id |
| `session-not-found` | 打开的会话不存在 | 检查 id 或存储位置 |
| `corrupt-session` | 会话头无效，或某个完整的行不能解析、不符合条目规则 | 文件需要人工处理；本模块不改写它 |
| `unsupported-version` | 会话头的版本不是 1 | 用支持该版本的程序打开 |
| `invalid-entry` | 追加的某条输入不合规则 | 修正输入；整批未写入 |
| `damaged-tail` | 有中断尾时追加 | 调用 `repair` 后重试 |
| `store-failed` | 存储读写出错（目录不存在、权限、磁盘满等） | 来自 `append` 时句柄已损坏：`close` 后用 `openSession` 重开，有中断尾先 `repair`，再按 `sessionStatus` 与 `planRecovery` 收口；来自 `createSession`、`openSession`、`repair`、`list` 时可以重试 |
| `log-broken` | 句柄已因写入失败损坏 | 同 `store-failed` 来自 `append` 时 |
| `log-closed` | 句柄已关闭 | 重新打开会话 |
| `invalid-cursor` | 分页游标不属于这个会话、格式不对或位置已不存在 | 从最后一页重新读取 |
| `entry-not-found` | 按 id 读取时没有该条目 | 检查 id |

各操作可能返回的失败码（存储接口上的同名操作相同）：

| 操作 | 失败码 |
|---|---|
| `createSession` | `invalid-session-id`、`session-exists`、`store-failed` |
| `openSession` | `invalid-session-id`、`session-not-found`、`corrupt-session`、`unsupported-version`、`store-failed` |
| `append` | `invalid-entry`、`damaged-tail`、`store-failed`、`log-broken`、`log-closed` |
| `repair` | `store-failed`、`log-broken`、`log-closed` |
| `list` | `store-failed`（单个会话损坏不算失败，按输出 17 不列出） |
| `subscribe`、`close` | 无；订阅的结束经 `onEnd` 通知 |
| `readPage` | `invalid-cursor` |
| `readEntry` | `entry-not-found` |

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/session` 与 `@notnotype/nb-harness/session/jsonl` 两个入口中“接口”一节列出的符号；其余是实现细节。
- **持久化格式**：会话头与条目的形状是对外格式，并与 OMP 会话条目保持兼容（输出 23）；OMP 升级改变条目形状时，按本条的版本规则处理。新增条目类型或字段要提升版本，并让旧版本的文件仍能读取；读到更新的版本时不写入。
- **信任边界**：本模块信任调用方；`customType` 的命名空间防误用，不防恶意代码。条目内容不经过滤，使用方不把密钥写进会话。

## 验收与 Smoke

1. 新建会话，追加一批 `user` 消息、一批助手消息（含两个工具调用）及两条工具结果、一条 `title_change`；关闭后用同一存储打开：条目逐项相等，序号相同，`buildModelContext` 得到三条消息，`sessionSettings` 得到该标题。
2. 订阅后追加三批，再以第二批最后一条的序号作 `afterSeq` 重新订阅：第二个订阅先补发第三批，此后两个订阅收到相同的新条目，序号无重无漏。
3. JSONL 文件末尾追加半行：打开后条目只到完整的最后一行，`damagedTail` 报告半行字节数；`append` 为 `damaged-tail`；`repair` 后追加成功，再次打开没有中断尾。
4. JSONL 文件中间一行改成无效 JSON：打开为 `corrupt-session` 并给出行号，文件字节不变。
5. 写入在中途失败（例如根目录在追加前被删除）：`append` 为 `store-failed`，`entries` 不变，订阅以 `broken` 结束，下一次 `append` 为 `log-broken`。
6. 模拟崩溃：追加 `invocation` 的 `start`、一条带四个工具调用的助手消息、第一个调用的工具结果、第二个调用的审批 request、第三个调用的审批 request 与 `reject` response、第四个调用的审批 request 与 `approve` response，然后丢弃句柄、重新打开：`sessionStatus` 为 `waiting` 且只列出第二个调用的审批；`planRecovery` 为第三个调用返回拒绝结果、为第四个调用返回中断结果、返回一条 `waiting`；追加这些条目后再次调用，不再返回结果条目；`buildModelContext` 中这条助手消息只保留第一、三、四个调用，第二个调用不出现；把它交给真实的 OMP `Agent`（`replaceMessages`）后，发往模型的请求里每个工具调用都有结果，没有 OMP 合成的结果。
7. 同一个场景对内存存储与 JSONL 存储各跑一遍，结果相同。
8. 旧调用失败后开始新调用：`start`、带一个工具调用且 `stopReason: "error"` 的助手消息、`error`、新的用户消息与新调用的 `start`：`planRecovery` 只处理新调用，不为旧调用返回结果；`buildModelContext` 不含那条出错的助手消息。
9. 两轮使用相同的工具调用 id（例如都为 `call_0`），第一轮有结果、第二轮的结果尚未写入：`buildModelContext` 只保留第一轮的调用，第二轮的调用被去掉，第一轮的结果不会配给第二轮。
10. 带签名思考块与两个工具调用、其中一个没有结果的助手消息：`buildModelContext` 去掉无结果的调用与 `redactedThinking`，清除思考签名，保留思考文本。
11. 写入失败后的恢复：JSONL 写入一批中途失败，文件留下这批的前几条完整条目与半行：原句柄 `append`、`repair` 为 `log-broken`；`openSession` 读回前缀并报告中断尾；`repair` 后按 `sessionStatus`、`planRecovery` 收口并继续追加；以旧订阅最后收到的序号在新句柄上订阅，补到已落盘的前缀。
12. 订阅的边界：在 `close` 后订阅立即结束；补发中监听函数抛错只结束该订阅；监听函数里 `append` 的条目排在当前这批之后推送；监听函数里 `close` 时其余条目不再推送。
13. 条目不可变：追加后修改传入的对象、在监听函数里修改收到的条目：日志、重开后的 `entries` 与其它订阅者收到的条目都不变，修改收到的条目抛出 `TypeError`；内存与 JSONL 两种存储结果相同。
14. 压缩后的回放：会话开头有种子 A（`once`）与种子 B、五轮对话；追加一条 `compaction`（`firstKeptEntryId` 指向第四轮开头）与重新写入的种子 B，再追加一轮：`buildModelContext` 依次为种子 B、摘要、第四到第六轮，不含种子 A 与前三轮。把同一份条目的浅副本交给 OMP 的 `prepareCompaction`（`remoteEnabled: false`）不报类型或形状错误。种子 B 的 `details.role` 为 `developer` 时回放为 `developer` 消息；种子、提醒与摘要都带 `attribution: "agent"`。
15. 分页：一个三十轮的会话，其中一轮含一个 200 KiB 的工具输出，另一轮含二十个各 15 KiB 的工具输出（截断后合计仍约 300 KiB），按每页 10 轮、256 KiB、单字段 16 KiB 读取：每页不超过 10 轮、不超过 256 KiB，只有那一轮二十个输出的页例外，它单独成页；200 KiB 的输出被截到 16 KiB 以内，`trimmed` 报告原始大小与路径，条目类型与工具调用 id 不变，`readEntry` 取回完整内容；依次用 `next` 读到 `null` 时，各页合起来恰好是全部条目且无重复；读完第一页后再追加一轮，原来的 `next` 仍读到同样的下一页；用另一个会话 id 相同条目的游标为 `invalid-cursor`。
16. 只读视图不改日志：分页截断与按 id 读取之后，`entries` 与文件内容不变。


Smoke：`packages/nb-harness` 的 `bun test src/session`（JSONL 存储使用真实临时目录与文件）。

## 证据

- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“会话”“模块划分与推进顺序”两节与决策记录（开发者 2026-10-10 决定：会话条目参照 OMP、只追加、事件溯源；存储只定接口并提供 JSONL 实现；先做 `session` 模块）。
