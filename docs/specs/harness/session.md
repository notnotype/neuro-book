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

`nb-harness` 的 `session` 模块给 Agent 运行时和以后的插件提供会话日志：一个会话是一份只追加的条目序列，写入后不改不删；会话的一切状态（模型该看到的上下文、是否在等待用户、当前模型与标题、本会话内的审批允许）都由条目回放得出；新写入的条目按顺序实时推给订阅者。存储经接口，附内存与 JSONL 两种实现。本模块不依赖 Agent 循环，也不调用模型。

不承诺：

- 分支与重试：条目格式带 `parentId` 以便以后支持，v1 的每个条目都接在上一个条目之后，不提供移动叶子或从旧条目分叉的操作。
- 多个写者：同一会话同一时刻只有一个句柄写入，由使用方保证；另一个进程或另一个句柄追加的条目，本句柄看不到，也不检测。
- 上下文压缩、附件与大内容外置、会话删除与归档、会话列表的检索与分页。
- 跨进程的订阅：订阅只在打开会话的进程内有效。
- 写入的持久性只到“写入调用成功返回”，不调用 `fsync`，断电时最后几条可能丢失。
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

## 输入与前置条件

### 条目

```ts
type SessionHeader = {type: "session"; version: 1; id: string; createdAt: string; parentSession?: string};

type EntryBase = {id: string; parentId: string | null; timestamp: string};
type SessionEntry = EntryBase & (
    | {type: "message"; message: AgentMessage}
    | {type: "custom_message"; customType: string; content: string | MessageContent[]; display: boolean}
    | {type: "invocation"; invocationId: string; phase: InvocationPhase; detail?: JsonValue}
    | {type: "interaction"; interactionId: string; toolCallId: string; kind: "approval" | "question"; phase: "request" | "response";
       request?: {toolName: string; tier?: "read" | "write" | "exec"; data?: JsonValue};
       response?: {decision: "approve" | "reject" | "answer"; scope?: "once" | "session"; decidedBy: "user" | "approver"; note?: string; data?: JsonValue}}
    | {type: "model_change"; model?: string; role?: string; thinkingLevel?: string}
    | {type: "title_change"; title: string; source: "auto" | "user"}
    | {type: "custom"; customType: string; data: JsonValue}
);
type InvocationPhase = "start" | "waiting" | "resumed" | "end" | "error" | "aborted" | "interrupted";
type EntryInput = 去掉 id、parentId、timestamp 后的 SessionEntry;
```

`AgentMessage` 与 `MessageContent` 是 OMP（`@oh-my-pi/pi-agent-core`、`@oh-my-pi/pi-ai`）的消息与内容块类型。

| 规则 | 内容 |
|---|---|
| 会话 id | 1–128 个字符，`[A-Za-z0-9._-]`；新建时不给出则由日志生成 |
| `message.message.role` | `user`、`assistant` 或 `toolResult` |
| `customType` | `<命名空间>/<名称>`：命名空间以 `[a-z0-9]` 开头、由 `[a-z0-9.-]` 组成，名称以 `[a-z0-9]` 开头、由 `[a-z0-9._-]` 组成；命名空间 `harness` 留给本包 |
| `interaction` | `phase: "request"` 必须有 `request`、不得有 `response`；`"response"` 反之。同一 `interactionId` 至多一个 request、至多一个 response，response 在 request 之后 |
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
type LogEndReason = "closed" | "broken";

// 回放（纯函数）
buildModelContext(entries: readonly SessionEntry[]): AgentMessage[];
sessionStatus(entries: readonly SessionEntry[]): {phase: "idle" | "running" | "waiting"; invocationId?: string; pending: PendingInteraction[]};
sessionSettings(entries: readonly SessionEntry[]): {model?: string; role?: string; thinkingLevel?: string; title?: string; approvalGrants: {toolName: string; tier?: string}[]};
defineProjection<S>(projection: {initial: S; reduce(state: S, entry: SessionEntry): S}): Projection<S>;
fold<S>(entries: readonly SessionEntry[], projection: Projection<S>): S;
planRecovery(entries: readonly SessionEntry[]): EntryInput[];

// 存储接口
interface SessionStore {
    create(header: SessionHeader): Promise<Result<void>>;
    open(id: string): Promise<Result<{header: SessionHeader; entries: SessionEntry[]; damagedTail: {bytes: number} | null}>>;
    append(id: string, entries: readonly SessionEntry[]): Promise<Result<void>>;
    repair(id: string): Promise<Result<{droppedBytes: number}>>;
    list(): Promise<Result<SessionSummary[]>>;
}
type SessionSummary = {id: string; createdAt: string; parentSession?: string; title?: string; updatedAt: string};
type Result<T> = {ok: true; value: T} | {ok: false; code: SessionFailure; detail: string};

// 子入口 @notnotype/nb-harness/session/jsonl
createJsonlSessionStore(options: {root: string}): SessionStore;
```

方法都不抛出业务失败，失败以 `Result` 返回；只有调用方违反类型约束（例如传入非数组）时才可能抛出。

## 输出与可观察行为

1. **新建**：`createSession` 写入会话头，返回没有条目的日志句柄。会话 id 已存在为 `session-exists`，不改动已有会话。
2. **追加**：`append` 给每条输入补上条目 id（会话内唯一）、`parentId`（上一条的 id，第一条为 `null`）与时间戳，经存储写入成功后才把这批条目加入 `entries` 并通知订阅者，返回补全后的条目。空批返回空数组，不写任何东西。
3. **校验**：一批里任何一条不符合“输入与前置条件”的规则，整批为 `invalid-entry`，不写入；`detail` 指出第几条与原因。
4. **时间戳**：取自 `now`（缺省为系统时钟）；同一句柄写出的时间戳单调不减，时钟倒退时沿用上一条的时间。
5. **打开**：`openSession` 读回会话头与全部条目，`entries` 与写入时补全后的条目逐项相等（JSON 往返）。
6. **中断尾**：JSONL 文件末尾不以换行结束的部分是中断尾：`openSession` 照常返回之前的条目并在 `damagedTail` 报告字节数；有中断尾时 `append` 为 `damaged-tail`，`repair` 截掉中断尾后可以继续追加。没有中断尾时 `repair` 返回 `droppedBytes: 0`。
7. **损坏的条目**：以换行结束、却不能解析或不符合条目规则的一行，`openSession` 为 `corrupt-session`，`detail` 给出行号；不截断、不改写文件。会话头缺失或无效同样为 `corrupt-session`。
8. **版本**：会话头 `version` 不是 1 时为 `unsupported-version`，不改写文件。
9. **订阅**：`subscribe` 先按序号补发 `afterSeq` 之后已有的条目（缺省 0，即全部），再按写入顺序推送之后成功追加的条目；每个条目对同一订阅只推一次。一个订阅者抛出的异常不影响其它订阅者与 `append` 的结果。`release` 后不再推送，也不调用 `onEnd`。
10. **写入失败**：存储在 `append` 中失败（I/O 错误）时返回 `store-failed`，这批条目不进入 `entries`、不推送；句柄进入损坏状态：之后的 `append` 为 `log-broken`，订阅以 `onEnd("broken")` 结束。使用方重新打开会话，以文件中实际存在的内容为准。
11. **关闭**：`close` 后 `append`、`repair` 为 `log-closed`，订阅以 `onEnd("closed")` 结束；重复 `close` 没有效果。
12. **模型上下文**：`buildModelContext` 按序号取 `message` 与 `custom_message`（后者以用户消息出现在原位置），并：
    1. 去掉 `stopReason` 为 `error` 或 `aborted` 的助手消息，以及对应其中工具调用的工具结果；
    2. 去掉没有对应工具结果的工具调用块，但仍有未应答 `interaction` 的工具调用保留；去掉后没有内容的助手消息整条去掉；
    3. 去掉找不到对应工具调用的工具结果。
13. **会话状态**：`sessionStatus` 取最后一个 `invocation` 的 `invocationId`：其最后阶段为 `start` 或 `resumed` 时为 `running`，为 `waiting` 时为 `waiting`，其余或没有调用时为 `idle`；`pending` 列出有 request、没有 response 的 `interaction`（id、工具调用 id、kind、request），任何阶段都列出。
14. **会话设置**：`sessionSettings` 中模型、角色、思考档位取最后一个 `model_change` 的对应字段，标题取最后一个 `title_change`；`approvalGrants` 列出 `decision: "approve"`、`scope: "session"` 的应答所对应 request 的工具名与等级，按出现顺序去重。
15. **自定义回放**：`fold(entries, defineProjection({initial, reduce}))` 从 `initial` 起按序号对每个条目调用一次 `reduce`，返回最终状态；不认识的条目类型由 `reduce` 自行跳过。
16. **崩溃收口**：`planRecovery` 只计算、不写入，返回调用方应追加的条目：
    1. 最后一条助手消息里，没有工具结果、也没有未应答 `interaction` 的工具调用，各返回一条 `toolResult` 消息（`isError` 为真，内容说明执行被中断、结果未知）；
    2. 最后一个调用的最后阶段为 `start` 或 `resumed`、且没有未应答的 `interaction` 时，返回一条该调用的 `interrupted`；
    3. 没有需要收口的内容时返回空数组。对追加收口条目之后的条目再次调用，返回空数组。
17. **列出**：`list` 返回存储中每个会话的摘要：id、创建时间、父会话、最后一个 `title_change` 的标题、最后一个条目的时间（没有条目时为创建时间）；有中断尾的会话照常列出，损坏的会话不列出。
18. **两种存储**：内存存储与 JSONL 存储对输出 1–11、17 的行为相同；JSONL 存储另外满足输出 6、7 中与文件有关的部分。

## 状态与转换

日志句柄：

| 当前 | 事件 | 结果 |
|---|---|---|
| 可写 | `append` 成功 | 可写，条目增加 |
| 可写 | 存储写入失败 | 损坏：`append` 为 `log-broken`，订阅以 `broken` 结束 |
| 有中断尾 | `append` | `damaged-tail`，不变 |
| 有中断尾 | `repair` 成功 | 可写 |
| 可写、有中断尾、损坏 | `close` | 已关闭：`append`、`repair` 为 `log-closed`，订阅以 `closed` 结束 |

**并发**：同一句柄上的 `append` 与 `repair` 按调用顺序依次执行；后一次在前一次完成后才开始，前一次失败不阻止后一次执行（损坏状态除外）。

**时序与寿命**：

- `append` 返回成功时，这批条目已经交给存储写入，并已在 `entries` 中、已推送给当时的订阅者；返回失败时三者都没有发生。
- 订阅者收到某个条目时，该条目已经写入存储。
- 同一句柄的订阅者看到的序号严格递增且没有空缺；用最后收到的序号作 `afterSeq` 重新订阅，不漏也不重。
- 句柄只在进程内有效；进程重启后用 `openSession` 重新打开，序号与重启前一致。
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
| `store-failed` | 存储读写出错（目录不存在、权限、磁盘满等） | 追加时句柄已损坏，重新打开会话；其它操作可重试 |
| `log-broken` | 句柄已因写入失败损坏 | 重新打开会话 |
| `log-closed` | 句柄已关闭 | 重新打开会话 |

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/session` 与 `@notnotype/nb-harness/session/jsonl` 两个入口中“接口”一节列出的符号；其余是实现细节。
- **持久化格式**：会话头与条目的形状是对外格式。新增条目类型或字段要提升版本，并让旧版本的文件仍能读取；读到更新的版本时不写入。
- **信任边界**：本模块信任调用方；`customType` 的命名空间防误用，不防恶意代码。条目内容不经过滤，使用方不把密钥写进会话。

## 验收与 Smoke

1. 新建会话，追加一批 `user` 消息、一批助手消息（含两个工具调用）及两条工具结果、一条 `title_change`；关闭后用同一存储打开：条目逐项相等，序号相同，`buildModelContext` 得到三条消息，`sessionSettings` 得到该标题。
2. 订阅后追加三批，再以第二批最后一条的序号作 `afterSeq` 重新订阅：第二个订阅先补发第三批，此后两个订阅收到相同的新条目，序号无重无漏。
3. JSONL 文件末尾追加半行：打开后条目只到完整的最后一行，`damagedTail` 报告半行字节数；`append` 为 `damaged-tail`；`repair` 后追加成功，再次打开没有中断尾。
4. JSONL 文件中间一行改成无效 JSON：打开为 `corrupt-session` 并给出行号，文件字节不变。
5. 写入在中途失败（例如根目录在追加前被删除）：`append` 为 `store-failed`，`entries` 不变，订阅以 `broken` 结束，下一次 `append` 为 `log-broken`。
6. 模拟崩溃：追加 `invocation` 的 `start`、一条带三个工具调用的助手消息、其中一个调用的工具结果、另一个调用的审批 `interaction` request，然后丢弃句柄、重新打开：`sessionStatus` 为 `waiting` 且列出该审批；`planRecovery` 只为第三个调用返回一条中断结果，不返回 `interrupted`；追加这些条目后再次调用 `planRecovery` 返回空数组；`buildModelContext` 中待审批的工具调用保留。
7. 同一个场景对内存存储与 JSONL 存储各跑一遍，结果相同。

Smoke：`packages/nb-harness` 的 `bun test src/session`（JSONL 存储使用真实临时目录与文件）。

## 证据

- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“会话”“模块划分与推进顺序”两节与决策记录（开发者 2026-10-10 决定：会话条目参照 OMP、只追加、事件溯源；存储只定接口并提供 JSONL 实现；先做 `session` 模块）。
