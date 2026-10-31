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
| `session.lock` | 内核 | 持有者的进程号、进程启动时刻、随机令牌与创建时刻 |
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
    caller?: {kind: "session" | "workflow"; id: string; callId: string};  // 子会话的调用方
    questions: "caller" | "user";   // 提问交给谁
    result?: {mode: "optional" | "required"; schema: JsonValue};          // 运行结果的 schema
}
```

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
| 值 | 每个字段都能被 JSON 如实表示：没有 `undefined`、函数、`NaN`、`Infinity`、`bigint`、循环引用 |
| 类型名 | 内核事件是 `KernelEvents` 里的名字；扩展事件是 `<扩展 id>/<名字>`，扩展只能写以自己 id 开头的类型 |
| 作用域与种类 | `conv` 事件只在 path；`ctrl` 只由内核写；扩展只能写 `conv`、`ext` |
| 大块内容 | 任一字符串的 UTF-8 编码超过 16384 字节时，日志里写 `{"$blob": "<sha256>", "size": <字节数>}`；图片块总是大块内容 |

### 接口

```ts
interface LogStore {
    create(header: SessionHeader): Promise<StorageResult<LogHandle>>;
    open(id: string): Promise<StorageResult<LogHandle>>;
    append(handle: LogHandle, batch: readonly LogEvent[]): Promise<StorageResult<void>>;
    list(filter?: {project?: string; archived?: boolean}): Promise<StorageResult<readonly SessionIndexEntry[]>>;
    fork(from: {session: string; leaf: string | null}, header: SessionHeader): Promise<StorageResult<LogHandle>>;
    close(handle: LogHandle): Promise<void>;
}
type StorageResult<T> = {ok: true; value: T} | {ok: false; code: StorageError; detail?: Record<string, JsonValue>};
```

`@notnotype/nb-harness/kernel` 提供会话目录上的 JSONL 存储与内存存储两种实现；宿主经 `SessionEnv.store` 交给内核。

## 输出与可观察行为

1. 新建会话在根下建会话目录，`session.jsonl` 的第一行是会话头；目录已存在时得 `session-exists`，不改动它。
2. 每条事件一行，字段如“事件”一节；`seq` 在一个会话内从 1 起严格递增，与文件里的行序一致。
3. 一个写入批里的行在文件里连续，每行带同一个 `batch.id`，`n` 从 1 到 `of`。
4. `append` 一次写入整批后同步到盘，成功返回时整批已同步；同一个句柄上的 `append` 按调用顺序写入。
5. 文件里完整的批就是已提交的批。只有文件末尾可能有不完整的批；它不算日志的一部分。
6. 打开时文件末尾有不完整的批（含不完整的最后一行）：截到最后一个完整批的末尾，截下的字节另存为 `session.jsonl.tail-<时刻>`，写诊断 `log-tail-truncated`（带截下的字节数），会话照常打开。截断后再追加的批能正常写入与重开。
7. 打开时校验整份日志，下列任一不成立得 `log-corrupt`、不改动文件：事件 id 唯一；`seq` 严格递增；path 事件的父节点在它之前出现；种类、作用域与类型名合法（“事件”一节的规则）；幂等键在同一来源内不重复；除文件末尾外每个批都完整；引用的大块内容存在，长度与哈希相符。
8. 会话头的 `format` 不认识时得 `needs-migration`，不改动文件，与 `log-corrupt` 区分。
9. 超过阈值的字符串写成 `blobs/<sha256>`，事件里只留引用；文件在引用它的批写入之前写完并同步到盘。读回事件时引用换回原字符串，调用方看不到引用。内容相同的大块内容只存一份。
10. 被脱敏的原文（`redacted`）只记 SHA-256，不写进日志，也不产生大块内容文件：会话目录里搜不到原文。
11. 会话同一时刻只能被打开一次：另一个进程或同一进程再次打开时得 `session-busy`，`detail` 带持有者的进程号与锁的创建时刻。持有者进程已不在、或进程号被别的进程复用（启动时刻不同）时，锁算陈旧，打开时回收；两个进程同时回收同一把陈旧锁，恰好一个成功，另一个得 `session-busy`。宿主可以强制解锁，写诊断 `lock-forced`。
12. 写入或同步到盘失败时：这一批的结果对调用方不确定，句柄进损坏状态，之后同一句柄上的写入都得 `log-broken`；这一批不归约、不推给订阅者。关闭损坏的句柄只释放锁，同一进程可以立即重新打开；重开以文件为准（输出 5、6）。
13. 打开会话照日志归约出全部状态，不跑反应；当前叶子是最后一条 path 事件或 `leafChanged` 指向的节点。
14. 扩展事件的版本高于扩展当前声明的版本时：事件留在日志里，归约跳过它，写诊断 `event-version-unsupported`。
15. 打开时结算上一次进程没有收口的运行，作为一个写入批写入：开始执行但没有结果的工具调用写成 `status: "unknown"`（码 `interrupted`）；等审批的调用写成 `status: "denied"`（码 `interrupted-before-approval`），对应的事项结算为 `interrupted`；让运行停下等待的提问结算为 `interrupted`；发出但没有回复的模型请求写 `modelFailed{kind: "interrupted"}`；最后写 `turnEnded`、`runEnded`，原因都是 `interrupted`。异步提问不属于运行，不结算。缓冲区里没取走的输入留着，不自动发出。
16. 宿主登记进程中断与终止的收口后，进程退出前对每个运行中的会话走输出 15 的同一套结算，原因同为 `interrupted`。
17. 被受理的指令在受理批里写一条 `commandAccepted{commandId, name, value}`，与指令立即写的事件同批。同一会话里重发同一个 `commandId`，返回第一次的 `value` 与 `replayed: true`，不再写事件；重启之后同样成立。校验失败的指令不写日志，重发时重新校验。
18. 空闲时会开始运行的指令（`send`、`start`、`compact`、带 `resend` 的 `rewind`），受理批里含 `runStarted`；`send` 另含取走这条输入的 `inputConsumed`、`turnStarted` 与 `input`。受理之后、循环开始之前进程退出时，重开按输出 15 把这次运行结算为 `interrupted`。
19. `list` 只读各会话目录的 `index.json`：项目、Profile、标题、是否归档、创建与最后活动时刻、轮数、索引对应的最后一个 `seq`。索引经临时文件改名写入；打开会话时与日志末尾比对，不一致就重建并写诊断 `index-rebuilt`。崩溃之后到下次打开之前，`list` 可能给出略旧的值。
20. `fork` 把来源会话里根到 `leaf` 的路径复制成新会话：新会话头的 `origin` 记来源会话与节点，路径上引用的大块内容一并复制（同一文件系统上用硬链接）。来源会话不受影响。
21. 内存存储与 JSONL 存储的行为相同，且每次读写都做 JSON 往返：在 JSONL 里会出错的值（`Date`、`Map`、`undefined`）在内存存储里同样出错。

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
- 句柄进损坏状态之后：等待中的运行立即以 `{reason: "error", error: {kind: "local", code: "log-broken"}}` 完成（不写日志），运行状态变为 `broken` 并推一条状态帧；之后的指令得 `log-broken`。
- `close` 返回时锁已释放；关闭之后迟到的回调与工具结果不写日志，只写诊断。
- 锁的寿命与句柄相同；进程被杀留下的锁在下一次打开时按输出 11 回收。

## 副作用与数据

- 落点：会话目录里内核拥有的文件（“会话目录”一节）。日志格式版本 1；不认识的版本不改写（输出 8）。
- 大块内容的文件不随事件删除；会话目录整体删除时一起删除。会话删除与归档的清理归宿主。
- 截下的尾部文件只供查看，内核不再读它。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `log-corrupt` | 校验不过、中间有不完整的批、大块内容缺失或不符 | 不能打开；文件原样保留，交用户或修复工具 |
| `needs-migration` | 格式版本不认识 | 先跑迁移脚本 |
| `session-busy` | 会话已被打开 | 用已打开的那个；确认持有者已不在时强制解锁 |
| `log-broken` | 这个句柄写失败过 | 关闭后重开 |
| `session-not-found` | 会话目录或日志不存在 | 检查 id |
| `session-exists` | 新建时目录已存在 | 换 id |
| `unknown-profile` | 会话头里的 Profile 解析不到 | 会话以只读打开（能查询，不受理会改变对话的指令） |

## 边界与兼容

- 公开接口：`LogStore` 与两种实现、会话头与事件的格式（`KernelEvents`）、码表 `storageErrors`，经 `@notnotype/nb-harness/kernel` 与 `/kernel/contracts` 导出。
- 格式版本 1。事件名与字段只加不改；改变已有字段的语义要升格式版本，并由迁移脚本转换旧日志。
- 扩展是受信任代码（ADR 0022）：内核拒绝写错前缀与种类的事件，但不防扩展有意写错数据。

## 验收与 Smoke

1. 写出一段日志后，对最后一批的每个字节偏移各截一份，逐份打开：截掉的量与输出 6 一致，修复后的文件能再追加并正常重开。
2. 写入与同步失败（注入会失败的文件句柄）：写失败后等待中的运行以 `log-broken` 完成；关闭成功；重开看到 `runEnded{interrupted}`。
3. 两个真实进程同时打开同一会话，一个成功、一个得 `session-busy`；两个进程同时回收同一把陈旧锁，恰好一个成功。
4. 子进程停在一个执行中的工具里时被 `kill -9`；重开后工具调用为 `unknown`、运行为 `interrupted`、缓冲区里没取走的输入还在。
5. 受理一条会开始运行的指令后重启，用同一个 `commandId` 重发：得到第一次的 `value` 与 `replayed: true`，日志里只有一条 `commandAccepted`。
6. 写入超过 16 KB 的工具结果与一条脱敏的输入：重开后事件内容与写入前一致；会话目录全文（含 `blobs/`）搜不到脱敏的原文。

Smoke：`packages/nb-harness/tests/kernel/kernel.llm.test.ts`（JSONL 存储加真实模型适配器：一轮对话、重开、再一轮；待建）。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)
