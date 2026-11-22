---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.session
owners:
  - nb-harness
---

# Harness 会话：日志、会话目录与恢复

## 目标与非目标

给 harness 内核与它的宿主一份会话日志：一个会话是会话目录里一份只追加的 JSONL，写下的事件不改不删；几条事件作为一个写入批原子写入；一个会话同时只有一个写者；超过阈值的字符串另存为按内容寻址的文件。打开会话时修复不完整的尾部、校验、照日志归约出全部状态，并结算崩溃或停服留下的半截运行。被受理的指令留下记录，重发同一个指令只生效一次，重启之后照样成立。

扩展怎样声明事件、片与归约见 [`harness/extensions.md`](extensions.md)；运行、指令与等用户的行为在 harness 运行时 Spec（待建）。

不承诺：

- 断电或操作系统崩溃之后的持久性只到“已同步到盘”为止（输出 6）；磁盘本身损坏不在范围内。
- 跨机器的互斥：锁只防同一台机器上的多个进程（输出 11）。
- 按需读取大块内容：第一版打开会话时全部读回内存。
- 检查点快照：第一版打开时从头归约；以后要加，快照只是缓存、不改日志格式。
- 旧格式（`nb-session`、内核分支的会话条目）的读取：由迁移脚本一次性转换。
- 已知限制：建会话时会话头与第一个写入批分两次写，两次之间进程被杀，留下只有会话头的日志；再建同一个 id 得 `session-exists`，打开它得到一个没有初始事件的会话。

## 术语与参与者

- **会话目录**：`<根>/<会话 id>/`。根由宿主给出。
- **事件**：日志里的一条记录；内核事件的名字是裸名，扩展事件的名字是“扩展 id/事件名”。
- **写入批**：作为整体写入的几条事件，要么都可见，要么都不可见。
- **大块内容**：超过阈值、另存在 `blobs/` 下的字符串。
- **叶子**：会话树上当前路径的末端节点；path 事件挂在它下面。
- **恢复**：打开会话时，结算上一次进程没有收口的运行。
- **句柄**：打开或新建一个会话得到的、持锁的对象。

## 输入与前置条件

### 会话目录

| 文件 | 拥有者 | 内容 |
|---|---|---|
| `session.jsonl` | 内核 | 第一行是会话头，之后每行一条事件 |
| `blobs/<sha256>` | 内核 | 大块内容，文件名是内容的 SHA-256（小写十六进制） |
| `session.lock` | 内核 | 会话锁（操作系统的独占文件锁，文件建好不删） |
| `session.owner` | 内核 | 当前持有者的进程号与取锁时刻，只供 `session-busy` 显示 |
| `index.json` | 内核 | 会话列表用的索引 |
| `session.jsonl.tail-<时刻>` | 内核 | 打开时截下的不完整尾部，只供查看 |
| 其余 | 宿主 | 内核不读、不改、不删 |

### 会话头

```ts
interface SessionHeader {
    format: 1;
    id: string;                     // 1–128 个字符，[A-Za-z0-9._-]
    createdAt: number;              // 毫秒时间戳
    profile: string;                // Profile 的 key，<来源>.<名字>
    project?: string;
    origin?: {session: string; entry: string | null};                      // fork 的来源
    caller?: {kind: "session" | "workflow"; id: string; callId: string; invocation?: string};  // 子会话的调用方；invocation 见 runtime.md 输出 87
    questions: "caller" | "user";   // 提问交给谁
    result?: {mode: "optional" | "required"; schema: JsonValue};          // 运行结果的 schema
    background?: true;              // 后台会话：列表缺省不列；fork 不继承
    owner?: {plugin: string; id: string};  // 归属：哪个插件的哪个对象常驻持有这个会话（输出 25）；fork 不继承
}
```

`owner` 与 `background` 并存，各管一件事（会话头的 `owner` 与会话目录里记锁持有者的 `session.owner` 文件无关）：

| 字段 | 谁给 | 管什么 |
|---|---|---|
| `background` | 建会话的调用方 | 会话不进缺省列表、`running()` 与活动（后台跑的任务） |
| `owner` | 宿主按调用方盖章（NeuroBook 见 [`agent/sessions.md`](../agent/sessions.md) 输出 23） | 会话归某个插件的对象（例如 bot 的主对话）：工具与扩展拿得到它，宿主据此决定列表与能不能改写历史，浏览器据此决定打开到哪里（NeuroBook 见 [`agent/conversation.md`](../agent/conversation.md) 输出 53） |

### 事件

```ts
interface LogRecord {
    id: string;
    seq: number;                    // 从 1 起，与写入顺序一致
    at: number;
    parent: string | null;          // path 事件的父节点；session 事件为 null
    scope: "path" | "session";
    kind: "conv" | "ext" | "ctrl";
    type: string;
    version: number;
    source: string;                 // 写它的扩展 id；内核是 "kernel"
    cause?: string;
    depth?: number;
    key?: string;                   // 幂等键
    position?: {kind: "attachment"; turn: string} | {kind: "after-step"; turn: string; step: string} | {kind: "next-turn"};
    data: JsonValue;
    batch: {id: string; n: number; of: number};
}
```

内核事件的名字与 `data` 的形状以 `@notnotype/nb-harness/kernel/contracts` 导出的 `KernelEvents` 为准。

| 规则 | 内容 |
|---|---|
| 值 | 每个字段都能被 JSON 如实表示：没有 `undefined`、函数、`NaN`、`Infinity`、`bigint`、循环引用，对象只是普通对象；键 `$blob` 留给大块内容的引用 |
| 类型名 | 内核事件是 `KernelEvents` 里的名字；扩展事件是 `<扩展 id>/<名字>`，扩展只能写以自己 id 开头的类型 |
| 作用域与种类 | `conv` 事件只在 path；`ctrl` 只由内核写；扩展只能写 `conv`、`ext` |
| 大块内容 | 任一字符串的 UTF-8 编码超过 16384 字节时，日志里写 `{"$blob": "<sha256>", "size": <字节数>}`；工具结果的图片是 base64 字符串，同样按这条外置 |

### 接口

```ts
interface LogStore {
    create(header: SessionHeader): Promise<StorageResult<LogHandle>>;
    open(id: string): Promise<StorageResult<LogHandle>>;
    append(handle: LogHandle, batch: readonly LogEvent[]): Promise<StorageResult<void>>;
    list(filter?: {project?: string; archived?: boolean}): Promise<StorageResult<readonly SessionIndexEntry[]>>;
    /** 一个会话的索引（输出 23）。 */
    entry(id: string): Promise<StorageResult<SessionIndexEntry>>;
    close(handle: LogHandle): Promise<void>;
}
type StorageResult<T> = {ok: true; value: T} | {ok: false; code: StorageError; detail?: Record<string, JsonValue>};
```

`@notnotype/nb-harness/kernel` 提供会话目录上的 JSONL 存储与内存存储两种实现；宿主经 `SessionEnv.store` 交给内核。

## 输出与可观察行为

1. 新建会话在根下建会话目录，`session.jsonl` 的第一行是会话头；会话已存在（目录里有 `session.jsonl`）时得 `session-exists`，不改动它。目录在、日志不在（上次建到一半就失败或进程被杀）时接着建。
2. 每条事件一行，字段如“事件”一节；`seq` 在一个会话内从 1 起严格递增，与文件里的行序一致。
3. 一个写入批里的行在文件里连续，每行带同一个 `batch.id`，`n` 从 1 到 `of`。
4. `append` 一次写入整批后同步到盘，成功返回时整批已同步；同一个句柄上的 `append` 按调用顺序写入。
5. 文件里完整的批就是已提交的批。只有文件末尾可能有不完整的批；它不算日志的一部分。
6. 打开时文件末尾有不完整的批（含不完整的最后一行）：截到最后一个完整批的末尾，截下的字节另存为 `session.jsonl.tail-<时刻>`，写诊断 `log-tail-truncated`（带截下的字节数），会话照常打开。截断后再追加的批能正常写入与重开。末尾那段里有一整行不是合法 JSON、或几行不属于同一个批时，不是写到一半的批，得 `log-corrupt`。
7. 打开时校验整份日志，下列任一不成立得 `log-corrupt`、不改动文件：事件 id 唯一；`seq` 严格递增；path 事件的父节点在它之前出现；种类、作用域与类型名合法（“事件”一节的规则）；幂等键在同一来源内不重复；除文件末尾外每个批都完整；引用的大块内容存在，长度与哈希相符。
8. 会话头的 `format` 不认识时得 `needs-migration`，不改动文件，与 `log-corrupt` 区分。
9. 超过阈值的字符串写成 `blobs/<sha256>`，事件里只留引用；文件在引用它的批写入之前写完并同步到盘。读回事件时引用换回原字符串，调用方看不到引用。内容相同的大块内容只存一份。
10. 被脱敏的原文（`redacted`）只记 SHA-256，不写进日志，也不产生大块内容文件：会话目录里搜不到原文。
11. 会话同一时刻只能被打开一次：另一个进程或同一进程再次打开时得 `session-busy`，`detail` 带持有者的进程号与取锁时刻。持有者关闭会话或进程结束（含被杀）时锁随之释放，下一次打开不需要任何清理。
12. 写入或同步到盘失败时：这一批的结果对调用方不确定，句柄进损坏状态，之后同一句柄上的写入都得 `log-broken`；这一批不归约、不推给订阅者。关闭损坏的句柄只释放锁，同一进程可以立即重新打开；重开以文件为准（输出 5、6）。建会话或打开会话时写入（初始事件、打开时的 `profileChanged` 与恢复的结算）或装上扩展失败：摘下已装上的、释放锁，以 `log-broken` 交回，下次打开照常恢复。损坏之后运行状态与快照一直是 `broken`，后到的事项报告、运行阶段与收口都不改它。
13. 打开会话照日志归约出全部状态，不跑反应；当前叶子是最后一条 path 事件或 `leafChanged` 指向的节点。
14. 扩展事件的版本高于扩展当前声明的版本时：事件留在日志里，归约跳过它，写诊断 `event-version-unsupported`。
15. 打开时结算上一次进程没有收口的运行，作为一个写入批写入：开始执行但没有结果的工具调用写成 `status: "unknown"`（码 `interrupted`）；等审批的调用写成 `status: "denied"`（码 `interrupted-before-approval`），对应的事项结算为 `interrupted`；让运行停下等待的提问结算为 `interrupted`；发出但没有回复的模型请求写 `modelFailed{kind: "interrupted"}`；最后写 `turnEnded`、`runEnded`，原因都是 `interrupted`。异步提问不属于运行，不结算。缓冲区里还就绪的输入在同一批转成留着（`inputHeld{cause: {end: "interrupted"}}`，[`runtime.md`](runtime.md) 输出 104），不自动发出。Profile 解析不到、以只读打开时同样写这个批（只有内核事件，不派发反应、不装扩展）。这个批完整写进了文件、只是同步报错时，下次打开按文件归约，不再写。
16. 宿主登记进程中断与终止的收口后，进程退出前对每个运行中的会话走输出 15 的同一套结算，原因同为 `interrupted`。
17. 被受理的指令在受理批里写一条 `commandAccepted{commandId, name, value, argsHash}`，与指令立即写的事件同批；`argsHash` 是指令参数（去掉 `commandId`）按键排序后的 SHA-256。同一会话里重发同一个 `commandId`、指令与参数都相同，返回第一次的 `value` 与 `replayed: true`，不再写事件；重启之后同样成立。指令或参数不同得 `command-id-conflict`，不当成重发（早先没有 `argsHash` 的记录只比指令名）。校验失败的指令不写日志，重发时重新校验。fork 的复制批没写下时（新会话只有会话头），重发同一个 `commandId` 补写复制批。
18. 空闲时会开始运行的指令（`send`、用户的 `enqueue`、`start`、`resume`、`compact`、带 `resend` 的 `rewind`、开得起运行的异步回答），受理批里含 `runStarted`（接着跑暂停的运行时是 `runResumed`）；开新一轮的另含取走就绪的第一条的 `inputConsumed`、`turnStarted` 与 `input`。受理之后、循环开始之前进程退出时，重开按输出 15 把这次运行结算为 `interrupted`。
19. `list` 只读各会话目录的 `index.json`：项目、Profile、标题、说明（`description`，没有这一项的旧索引读作 null，不算读不懂）、是否归档、是否后台、创建与最后活动时刻、轮数、索引对应的最后一个 `seq`；可按项目、归档、后台筛。没有“是否后台”字段的旧索引按读不懂处理、打开时重建。索引经临时文件改名写入；打开会话时与日志末尾比对，不一致就重建并写诊断 `index-rebuilt`。崩溃之后到下次打开之前，`list` 可能给出略旧的值。
20. fork 把来源会话里根到所选节点的路径复制成新会话：新会话头的 `origin` 记来源会话与节点，路径上引用的大块内容一并写进新会话目录。来源会话不受影响。
21. 内存存储与 JSONL 存储的行为相同，且每次读写都做 JSON 往返：在 JSONL 里会出错的值（`Date`、`Map`、`undefined`）在内存存储里同样出错。

22. 索引带调用方、来源、花费与运行：`index.json` 与 `list` 的条目另有：`caller`（会话头有时照抄，含 `callId` 与 `invocation`）；`origin`（fork 出来的会话的来源会话 id）；`spend: {cost, unpriced}`，与快照的累计花费同一口径（`assistant`、`modelEnded`、`modelFailed`，[`runtime.md`](runtime.md) 输出 70）；`runs`，最近 20 次收口的运行 `{runId, reason, endedAt}`。没有这些的旧索引读作没有、花费 0，不算读不懂；打开会话时按日志补上。
23. 按会话读索引：`entry(id)` 只读这个会话目录的 `index.json`，条目同 `list` 的；没有这个会话、索引读不懂时得 `session-not-found`（读不懂的索引要打开会话才重建），读文件出错得 `storage-failed`。给只关心少数几个会话的调用方用（子代理的进度，[`agent/subagents.md`](../agent/subagents.md) 输出 21），不用扫全部会话。
24. 输入缓冲区的事件（行为见 [`runtime.md`](runtime.md) 输出 103–110）：会话级的 `inputHeld{ids, cause, heldBy?}`、`inputReleased{ids, by, mode}` 与 `runResumed{runId, by}` 是新增的事件（`runResumed` 不进路径：接着跑之后的请求仍与原来那次是兄弟，[`runtime.md`](runtime.md) 输出 36）；`inputQueued` 加 `commandId`，空闲时排的另带 `state: "held"` 与 `cause`；`input`、`steer` 加 `commandId`；`inputConsumed` 加取走它的运行 `runId`；`inputRemoved` 加 `by`，原因是 `cancelled`、`aborted`、`replaced`（`replaced` 带 `replacedBy`），旧日志的 `user` 读作 `cancelled`；`runStarted` 加 `by`；`runEnded` 在中止时加停的人 `stoppedBy`。`cause` 是 `{end: 收口方式, code?}` 或 `{queued: "idle", code?}`（`code` 写开不起运行的码，或 `reassembly-pending`、`session-closing`、`session-closed`、`not-allowed`）；`heldBy` 与各处的 `by` 是发出者（会话或宿主；用户不写 `by`，`heldBy` 是用户时写 `{kind: "user"}`）。缓冲区条目的状态只由会话级事件归约，不读路径级事件；没有这些事件的旧日志，条目都是就绪的。读到这些事件的旧内核得 `log-corrupt`（不支持降级，见“边界与兼容”）。
25. 会话头的 `owner`：只由建会话的选项给（`{plugin, id}`，各 1–128 个字符、`[A-Za-z0-9._-]`），内核照写、不解释；建会话与读日志用同一个校验，建时不合得 `invalid-owner`、不落盘。会话头是不能改的值（含嵌套的 `caller`、`result`）：快照与 `header(id)` 交出的改不动，建会话的调用方之后改自己的参数也不影响会话。索引条目照抄。fork 出来的会话没有 `owner`，子会话也不从调用方继承。没有这一项的旧会话头读作没有归属。
26. `header(id)` 只读会话头：不取锁、不修复、不写，会话正被别的进程持有时也能读；会话不在得 `session-not-found`，第一行读不懂得 `log-corrupt`，`format` 不认识得 `needs-migration`。会话头建后不变，所以读到的就是这个会话的会话头。
27. （planned）提醒与门的事件（行为见 [`runtime.md`](runtime.md) 输出 112–118）：会话级的 `noticeQueued{id, by, key?, text, wake, commandId}`、`noticeRemoved{ids, by, reason}`、`noticeTaken{ids, runId}`、`wakeGate{open, cause}` 与路径级对话事件 `hostNotice{queued, by, text, boundary}` 是新增的事件；`steer` 加 `boundary`，`runStarted` 加 `wake`。待发的提醒与门只由这几种会话级事件归约，重开后一致；旧内核读到这些事件得 `log-corrupt`（输出 7），不支持降级。新建与 `fork` 出来的会话在建会话的那一批里写 `wakeGate{open: true, cause: "created"}`；没有门事件的旧日志读作门关着。回退之后受理了接着跑暂停的运行（`runResumed`）、在它的第一条路径事件写下之前中断的，重开时按中断恢复（输出 15、16 的恢复同样补写收口），不再当成只移动了叶子。

## 状态与转换

| 句柄状态 | 事件 | 下一状态 |
|---|---|---|
| 打开 | `append` 成功 | 打开 |
| 打开 | 写入或同步失败 | 损坏 |
| 打开、损坏 | `close` | 已关闭（锁已释放） |

时序与寿命：

- `open` 返回之前已完成：取锁、修复尾部、校验、读回大块内容。之后的顺序由内核保证：按会话头解析 Profile 并装配扩展 → 归约 → 比对 Profile 哈希（不同就写 `profileChanged{reason: "code-updated"}`）→ 恢复（输出 15）→ 装上扩展（`mount`）。这些都完成之后才受理指令。
- 一个会话的写入只有一个顺序：所有写入排进同一条队列。`append` 成功返回之后，这一批才归约、才推给订阅者；订阅者收到的 `seq` 严格递增。
- 指令成功结果里的 `seq` 是受理批最后一条事件的 `seq`：订阅追到它，就读得到这条指令写下的全部事件。
- 句柄进损坏状态之后：等运行的调用按 [runtime.md](runtime.md) 输出 13 完成（不写日志），运行状态变为 `broken` 并推一条状态帧，之后不再变；之后的指令得 `log-broken`（已提交的键照样重放）。
- `close` 返回时锁已释放；关闭之后迟到的回调与工具结果不写日志，只写诊断。
- 锁的寿命与句柄相同；进程结束时由操作系统释放。

## 副作用与数据

- 落点：会话目录里内核拥有的文件（“会话目录”一节）。日志格式版本 1；不认识的版本不改写（输出 8）。
- 大块内容的文件不随事件删除；会话目录整体删除时一起删除。会话删除与归档的清理归宿主。
- 截下的尾部文件只供查看，内核不再读它。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `log-corrupt` | 校验不过、中间有不完整的批、大块内容缺失或不符 | 不能打开；文件原样保留，交用户或修复工具 |
| `needs-migration` | 格式版本不认识 | 先跑迁移脚本 |
| `session-busy` | 会话已被打开 | 用已打开的那个 |
| `log-broken` | 这个句柄写失败过 | 关闭后重开 |
| `session-not-found` | 会话目录或日志不存在 | 检查 id |
| `session-exists` | 新建时目录已存在 | 换 id |
| `invalid-owner` | 建会话的 `owner` 不合（输出 25） | 改正后再建 |
| `unknown-profile` | 会话头里的 Profile 解析不到 | 会话以只读打开（能查询，不受理会改变对话的指令） |

## 边界与兼容

- 公开接口：`LogStore` 与两种实现、会话头与事件的格式（`KernelEvents`）、码表 `storageErrors`，经 `@notnotype/nb-harness/kernel` 与 `/kernel/contracts` 导出。
- 格式版本 1。事件名与字段只加不改；改变已有字段的语义要升格式版本，并由迁移脚本转换旧日志。
- 不支持降级：旧版本读到它不认识的内核事件名（例如后来加的 `nestedToolStarted`、`nestedToolResult`，[`runtime.md`](runtime.md) 输出 96）得 `log-corrupt`，不改动文件。
- 扩展是受信任代码（ADR 0022）：内核拒绝写错前缀与种类的事件，但不防扩展有意写错数据。

## 验收与 Smoke

1. 写出一段日志后，对最后一批的每个字节偏移各截一份，逐份打开：截掉的量与输出 6 一致，修复后的文件能再追加并正常重开。
2. 写入与同步失败（注入会失败的文件句柄）：写失败后等待中的运行以 `log-broken` 完成；关闭成功；重开看到 `runEnded{interrupted}`。
3. 两个真实进程同时打开同一会话，一个成功、一个得 `session-busy`；持有者被 `kill -9` 之后，另一个进程立即能打开。
4. 子进程停在一个执行中的工具里时被 `kill -9`；重开后工具调用为 `unknown`、运行为 `interrupted`、缓冲区里没取走的输入还在。
5. 受理一条会开始运行的指令后重启，用同一个 `commandId` 重发：得到第一次的 `value` 与 `replayed: true`，日志里只有一条 `commandAccepted`。
6. 写入超过 16 KB 的工具结果与一条脱敏的输入：重开后事件内容与写入前一致；会话目录全文（含 `blobs/`）搜不到脱敏的原文。

Smoke：`packages/nb-harness/tests/kernel/kernel.llm.test.ts`（JSONL 存储加真实模型适配器：一轮对话、重开、再一轮；待建）。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)；`description` 见 [w00032 t18](../../../.agents/works/w00032-agent-integration/tasks/t18-builtin-profiles/README.md)。
