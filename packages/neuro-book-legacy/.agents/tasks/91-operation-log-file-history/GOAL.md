# GOAL：nb-history —— workspace 操作日志与文件历史模块（独立 spike）

> 本文档是**自包含任务书**，面向对 NeuroBook 代码库没有任何上下文的实现者。所有需要的概念、数据模型、语义规则、验收标准都写在本文档内；实现过程中不需要也不应该去读 NeuroBook 的源码。

## 一句话目标

实现一个独立的 TypeScript 模块 `nb-history`：基于 SQLite 的 **append-only 文件操作日志 + 内容寻址快照**存储，为一个多主体（人类用户、AI 会话、平台系统、外部工具）共同编辑的文件工作区提供：单文件版本时间线、误删找回、用户审查收件箱（接受 / 还原）、会话级"未见变更"查询，以及可配置的保留策略。验收标准是本文档"验收"一节的场景测试 T1–T12 全绿 + 性能 smoke 达标 + Windows 句柄释放实测通过。

## 背景（为什么需要这个模块）

宿主产品 NeuroBook 是一个小说写作 IDE：一个 workspace 目录下有大量 markdown 正文与设定文件，**人类作者**在编辑器里改，**多个 AI agent 会话**并发地通过工具改，**平台系统**（模板同步、初始化脚本）也会写，用户还可能用**外部编辑器**直接改。当前没有任何一层记录"谁在什么时候把哪个文件从什么内容改成了什么内容"，导致四类需求无法满足：

1. 用户想审查 AI 改了哪些文件（看 diff、接受、或一键还原）；
2. AI 会话需要知道自己上次看过之后别人（用户 / 其他会话）改了什么——尤其是"用户重新打开一个老会话"时，老会话必须能补课；
3. 用户想要 JetBrains IDEA「Local History」式的单文件历史：任意版本查看 / diff / 恢复，误删的文件也能找回；
4. 将来还想把设置变更等非文件操作也记进同一份日志（本期不做，但数据信封要留位）。

**已定决策（不要重议）**：
- **不用 git**。JetBrains Local History 与 VS Code Timeline 的先例都是自建本地存储；git 只能替代快照层，操作归因、会话游标、接受位点等关系数据仍需要 SQLite，两个存储会引入一致性问题；宿主的便携版不能假设系统装有 git。
- **自建 SQLite 事件溯源存储**：一份 append-only 日志，投影出上述全部视图。
- 模块先独立开发验证（本 spike），宿主之后再集成。**本任务不涉及宿主代码**。

## 交付物

1. 独立目录 / 仓库 `nb-history`（放置位置由派发者指定；与任何宿主代码零 import 关联），bun + TypeScript 项目，包名 `@notnotype/nb-history`。
2. `src/` 模块实现 + `tests/` 场景测试（覆盖 T1–T12）+ `README.md`（API 文档、性能报告实测数字、已知限制）+ `NOTES.md`（实现中发现的契约疑点 / 问题记录）。
3. `bun test` 全绿；`tsc --noEmit` 全绿（strict 模式）。
4. `scripts/demo.ts`：一个可读的走查脚本，依次演示 时间线 → 删除找回 → 收件箱 accept / revert → 多会话 unseen，console 输出人类可读。

## 技术契约

### 存储与依赖

- SQLite，驱动用 **`@libsql/client`**（宿主同款，直连本地文件），**WAL 模式**；不引入 ORM / Prisma，手写 SQL + 轻量 repo 层。
- 依赖预算：`@libsql/client`、`diff`（文本 diff）、必要的 dev 依赖。**不引入** git / isomorphic-git / chokidar（文件监听是宿主职责，见"边界"）。
- 数据库是一个独立文件（如 `history.sqlite`），路径由调用方传入。
- 时钟必须可注入（`open()` 选项里可传 `clock: () => Date`，默认系统时钟）——保留策略与测试都依赖它。

### 数据模型

TypeScript 类型是契约主体，**用判别联合让非法状态不可表示**；repo 层在"行 → 类型"映射时对非法行抛错（防御数据库被外部改坏），写入时按变体校验字段。

```ts
/** 操作主体：谁做了这次操作。判别联合，非法组合（如 user 却带 sessionId）不可表示。 */
export type OperationActor =
    | {kind: "user"; userId: string}          // 人类用户（编辑器保存、收件箱操作）
    | {kind: "agent"; sessionId: string}      // AI 会话（以会话为主体粒度）
    | {kind: "system"; source: string}        // 宿主平台自动写入（模板同步、初始化脚本等）；source 标识子系统
    | {kind: "external"};                     // 对账发现的未登记变更（外部编辑器、脚本），无法归因

/**
 * 文件操作（v1 全部操作类型）。各变体 hash 字段的存在性由类型锁死：
 * - create 无 before（此前文件不存在）；delete 无 after（此后不存在）；edit 前后都有。
 * - rename 只表示改名，内容不变（改名 + 改内容 = rename 与 edit 两条日志）。
 * - revert：用户在收件箱把文件还原到"已接受基线"。
 * - restore：恢复任意历史版本（含删除找回）。
 */
export type FileOperation =
    | {type: "file.create"; path: string; afterHash: string}
    | {type: "file.edit"; path: string; beforeHash: string; afterHash: string}
    | {type: "file.delete"; path: string; beforeHash: string}
    | {type: "file.rename"; fromPath: string; toPath: string; contentHash: string}
    | {
          type: "file.revert"; path: string;
          beforeHash: string | null;   // 还原动作发生前的当前内容；null = 当时文件不存在（收件箱段以 delete 结尾）
          afterHash: string | null;    // 还原到的基线内容；null = 基线是"文件不存在"（收件箱段以 create 开头），还原即删除
          revertedEntryIds: number[];  // 被撤销的日志条目 id（该文件收件箱段的全部条目）
      }
    | {
          type: "file.restore"; path: string;
          beforeHash: string | null;   // null = 恢复时文件不存在（删除找回）；非 null = 覆盖现有内容
          afterHash: string;
          sourceEntryId: number;       // 内容来源条目
      };
// 约束：revert 的 beforeHash 与 afterHash 不得同时为 null（那是 no-op，写入时拒绝）。

/** 日志条目信封。v1 只有 FileOperation；信封形态为将来 settings.* / ui.* 操作预留扩展位。 */
export type OperationLogEntry = {
    id: number;          // SQLite 自增主键，全局单调递增——所有游标 / 接受位点比较的基准
    occurredAt: string;  // ISO-8601 UTC
    actor: OperationActor;
    operation: FileOperation;
};
```

SQLite DDL 参考（列名可微调，语义不可变；建表由模块 `open()` 自动完成）：

```sql
CREATE TABLE operation_log (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    occurred_at        TEXT    NOT NULL,
    actor_kind         TEXT    NOT NULL,   -- 'user' | 'agent' | 'system' | 'external'
    actor_user_id      TEXT,               -- 仅 user 非空
    actor_session_id   TEXT,               -- 仅 agent 非空
    actor_source       TEXT,               -- 仅 system 非空
    op_type            TEXT    NOT NULL,   -- 'file.create' | 'file.edit' | 'file.delete' | 'file.rename' | 'file.revert' | 'file.restore'
    path               TEXT    NOT NULL,   -- rename 条目存 to_path
    from_path          TEXT,               -- 仅 rename 非空
    before_hash        TEXT,
    after_hash         TEXT,
    reverted_entry_ids TEXT,               -- JSON number[]；仅 revert 非空
    source_entry_id    INTEGER             -- 仅 restore 非空
);
CREATE INDEX idx_oplog_path    ON operation_log(path, id);
CREATE INDEX idx_oplog_session ON operation_log(actor_session_id, id);

CREATE TABLE file_snapshot (
    hash       TEXT    PRIMARY KEY,        -- sha256(原始字节) hex
    body       BLOB,                       -- NULL = 超限或二进制：只记账不存内容（该版本不可 diff / 恢复）
    byte_size  INTEGER NOT NULL,
    created_at TEXT    NOT NULL
);

CREATE TABLE session_cursor (
    session_id         TEXT    PRIMARY KEY,
    last_seen_entry_id INTEGER NOT NULL,
    updated_at         TEXT    NOT NULL    -- 保留策略判断"活跃游标"用
);

CREATE TABLE file_acceptance (
    user_id            TEXT    NOT NULL,
    path               TEXT    NOT NULL,
    accepted_entry_id  INTEGER NOT NULL,
    updated_at         TEXT    NOT NULL,
    PRIMARY KEY (user_id, path)
);
```

### 配置

```ts
export type HistoryConfig = {
    maxSnapshotBytes: number;          // 默认 2 * 1024 * 1024；超限文件只记事件不存快照 body
    retentionFullDays: number;         // 默认 90；窗口内条目全量保留
    keepDailyLastAfterWindow: boolean; // 默认 true：窗口外每文件每自然日(UTC)保留末条；false = 窗口外全删（仍受保护规则约束）
};
```

默认值导出为常量；`open()` 接受 `Partial<HistoryConfig>` 覆盖。宿主集成时会把这些参数接到自己的配置系统，模块只需保证**全部参数可注入**。

### 公开 API

领域库用 class 形态。每个公开方法必须有文档注释。下面签名里的 `content` / `before` / `after` 一律是原始字节（`Uint8Array`；string 入参按 UTF-8 编码后处理）。

```ts
export class WorkspaceHistory {
    /** 打开（库文件不存在则建库建表）。workspaceRoot 是被记录文件的根目录，所有 path 相对它。 */
    static async open(options: {
        databasePath: string;
        workspaceRoot: string;
        config?: Partial<HistoryConfig>;
        clock?: () => Date;
    }): Promise<WorkspaceHistory>;

    // ── 写入面 ────────────────────────────────────────────────
    /** 模块代落盘 + 记账（写文件 → 算 hash → 存快照 → 追加日志）。按当前是否存在自动判定 create / edit。 */
    performWrite(actor: OperationActor, path: string, content: Uint8Array | string): Promise<OperationLogEntry>;
    performDelete(actor: OperationActor, path: string): Promise<OperationLogEntry>;
    performRename(actor: OperationActor, fromPath: string, toPath: string): Promise<OperationLogEntry>;
    /** 宿主已自行落盘，只补记账（宿主有自己的原子写逻辑时用）。before 为 null 表示此前文件不存在（= create）。 */
    registerWrite(actor: OperationActor, path: string, before: Uint8Array | null, after: Uint8Array): Promise<OperationLogEntry>;
    registerDelete(actor: OperationActor, path: string, before: Uint8Array): Promise<OperationLogEntry>;
    registerRename(actor: OperationActor, fromPath: string, toPath: string): Promise<OperationLogEntry>;

    // ── 还原面 ────────────────────────────────────────────────
    /** 收件箱还原：把 path 还原到该用户的"已接受基线"，落盘 + 记 file.revert。 */
    revert(userId: string, path: string): Promise<OperationLogEntry>;
    /** 恢复任意历史版本（含删除找回）：把 sourceEntryId 的内容写回 path，落盘 + 记 file.restore。 */
    restore(actor: OperationActor, path: string, sourceEntryId: number): Promise<OperationLogEntry>;

    // ── 对账面 ────────────────────────────────────────────────
    /** 宿主 watcher / 扫描回调入口：current 为 null 表示文件当前不存在。与账面末态不一致时补一条 external 事件并返回；一致则返回 null。 */
    reconcile(path: string, current: Uint8Array | null): Promise<OperationLogEntry | null>;

    // ── 查询面 ────────────────────────────────────────────────
    entry(id: number): Promise<OperationLogEntry | null>;
    timeline(path: string, options?: {followRenames?: boolean; limit?: number}): Promise<TimelineEntry[]>;
    /** 快照内容；null = body 未保留（超限 / 二进制 / 已被 GC）。 */
    snapshotBody(hash: string): Promise<Uint8Array | null>;
    /** 文本 diff 便利方法（内部用 diff 包）；任一侧 body 不可用时返回明确的"不可用"标记而非抛错。 */
    textDiff(beforeHash: string | null, afterHash: string | null): Promise<TextDiffResult>;
    /** 当前处于已删除状态、且末版内容仍可恢复的文件列表。 */
    deletedFiles(): Promise<DeletedFileInfo[]>;
    inbox(userId: string): Promise<InboxGroup[]>;
    accept(userId: string, path: string): Promise<void>;
    unseenChanges(sessionId: string): Promise<UnseenGroup[]>;
    advanceCursor(sessionId: string, entryId: number): Promise<void>;
    /** 新会话游标初始化：置于当前最大 entry id（新会话不该被全部历史淹没）。 */
    initCursor(sessionId: string): Promise<void>;

    // ── 维护面 ────────────────────────────────────────────────
    prune(): Promise<PruneReport>;
    /** 释放全部句柄。close 之后必须能在 Windows 上直接删除库文件（验收项 T12）。 */
    close(): Promise<void>;
}
```

查询结果类型（关键字段固定，实现可以增补字段）：

```ts
export type TimelineEntry = {
    entry: OperationLogEntry;
    pathAtThatTime: string;                            // followRenames 时该条目发生时的路径
    bodyAvailable: {before: boolean; after: boolean};  // 两侧快照 body 是否仍可取
};

export type InboxGroup = {
    path: string;                   // 现名（rename 已跟随）
    baseHash: string | null;        // diff 基准 = 接受位点后第一条条目的 before 态；null = 基准是"文件不存在"
    endHash: string | null;         // 账面末态（组内最后一条的 after 态）；null = 现已删除
    entries: OperationLogEntry[];   // 位点以来全部条目（含 user / external 条目，如实归因展示）
};

export type UnseenGroup = {
    path: string;
    baseHash: string | null;        // 该会话最后见过的状态；null = 上次见时文件不存在
    endHash: string | null;         // 组内最后一条未见条目之后的状态；null = 该条是删除
    entries: OperationLogEntry[];   // 未见条目（已排除本会话自己产生的）
    maxEntryId: number;             // 宿主注入提醒成功后 advanceCursor 用
};

export type DeletedFileInfo = {path: string; deletedAt: string; lastEntryId: number; recoverable: boolean};
export type PruneReport = {entriesDeleted: number; snapshotsDeleted: number; bytesFreed: number};
```

### 语义规则（必须逐条实现并被测试覆盖）

- **R1 路径规范**：path 一律相对 `workspaceRoot`、正斜杠分隔；拒绝绝对路径与含 `..` 的路径（抛错）。模块不做路径过滤策略——哪些文件值得记录由宿主调用侧决定。
- **R2 hash**：sha256(原始字节) hex。不做换行符 / 编码归一化——恢复必须逐字节还原，快照 body 用 BLOB 存原始字节。
- **R3 快照**：内容寻址去重（同 hash 只存一份）。body 超过 `maxSnapshotBytes`、或含 NUL 字节（二进制启发式）→ 只写 hash 行、body 置 NULL；该版本不可 diff / 不可 restore（调用时给出明确错误 / 标记）。
- **R4 append-only**：任何路径都不 UPDATE / DELETE 已有日志条目（`prune()` 是唯一例外）。视图上的合并 / 折叠只发生在查询层。
- **R5 收件箱**：对每个 path（按 rename 链归并到现名），若接受位点（`file_acceptance.accepted_entry_id`，无记录视为 0）之后存在 **actor.kind ∈ {agent, system}** 的条目，该 path 出现在 `inbox(userId)`；组内 `entries` 包含位点以来**全部**条目（user / external 的也含，如实归因），`baseHash` = 位点后第一条的 before 态。`accept(userId, path)` 把位点推进到该 path 当前最新条目 id。user / external 条目本身不触发收件箱（视为用户侧自知）。
- **R6 会话游标**：`unseenChanges(sessionId)` = `id > last_seen_entry_id` 且**排除本会话自己产生的条目**（`actor.kind === "agent" && sessionId === 本会话`）；按 path 分组（跟随 rename 链），每组 `baseHash` = 组内第一条未见条目的 before 态——数学上恰好等于"该会话最后见过的状态"。游标**只**通过 `advanceCursor` / `initCursor` 显式推进，查询不隐式推进（宿主在成功把提醒送达 AI 后才推进；中途崩溃则同批变更下次仍会浮现）。
- **R7 revert**：基线 = 接受位点条目的 after 态；若该 path 从未被接受过（位点 0），基线 = 位点后第一条的 before 态（即"用户最后知道的状态"）。执行 = 把基线内容写盘（基线为"不存在"则删除文件）+ 记 `file.revert`（`revertedEntryIds` = 组内全部条目 id）+ 接受位点推进到 revert 条目。revert 条目对其他会话是普通未见条目——这是"AI 得知用户拒绝了它的修改"的通道。
- **R8 restore**：内容源 = source 条目的 after 态（source 是 delete 条目时取其 before 态）。源快照 body 缺失（超限 / 已 GC）→ 明确抛错，绝不静默写入空内容。
- **R9 对账不重复记账**：`reconcile(path, current)` 把 current 的 hash 与账面末态比对——相等 → no-op 返回 null（这同时天然吸收宿主 watcher 对模块自身落盘的回声）；账面无记录而文件存在 → `external` create；不等 → `external` edit；账面存在而文件缺失 → `external` delete。**不做 rename 启发式检测**（外部改名表现为 delete + create，README 写明该限制）。
- **R10 崩溃一致性**：perform* 顺序 = 先写盘、紧接记账。两步之间进程崩溃 → 账面落后于磁盘 → 下次 `reconcile` 补一条 external 条目（归因丢失但历史不断链）。这是设计上接受的行为，测试须模拟（T8）。
- **R11 并发模型**：单进程单写者。模块内部用一把写互斥把所有写入面 / 还原面调用串行化；SQLite 开 WAL。多进程并发访问同一库**不支持**（README 写明）。
- **R12 保留策略（prune）**：
    1. `retentionFullDays` 窗口内（按 `occurredAt` 对比注入时钟）的条目全保留；
    2. 窗口外：`keepDailyLastAfterWindow` 为 true 时每 path 每自然日(UTC)保留最后一条，其余删除；为 false 时窗口外全删；
    3. **保护规则**（优先于稀疏化，永不删除）：(a) 任何用户接受位点之后的条目（未审查完的收件箱段）；(b) `updated_at` 在窗口内的"活跃游标"的 `last_seen_entry_id` 之后的条目；(c) 每个 path 的最新一条条目（时间线现状 / 删除找回依赖它）；
    4. 快照 GC：删除不再被任何存活条目的 before / after / contentHash 引用的 snapshot 行；
    5. prune 之后时间线必须仍可渲染：相邻保留条目之间 diff 跨度变大是预期行为，查询层不得假设"上一条的 after == 下一条的 before"的连续链。
- **R13 优雅降级**：查询面遇到快照 body 缺失一律返回"内容不可用"标记，不抛错（唯一例外是 R8 的 restore）。过老的游标（保护窗口外）调 `unseenChanges` 时必须仍能列出变更过的 path 清单，即使 diff 基准 body 已被稀疏化。

## 验收标准

### 场景测试（T1–T12，全部要有对应测试）

- **T1 基本时间线**：create → edit → edit → rename → edit → delete；时间线完整、`followRenames` 跨改名、每个版本内容可取出且逐字节一致。
- **T2 删除找回**：delete 后 `deletedFiles()` 列出该文件；`restore` 重建文件并记 `file.restore`；时间线延续不断链。
- **T3 收件箱主流程**：agent 两次 edit → `inbox` 出现一组、`baseHash` 正确；`accept` 后收件箱清空；agent 再改 → 新段出现。
- **T4 交错编辑**：同一文件 agent edit → user edit → agent edit；收件箱单组含三条、归因各自正确、`baseHash` = 第一条的 before 态。
- **T5 revert 全链**：agent create 新文件 → user `revert` → 文件被删除、`file.revert` 的 afterHash 为 null；该 agent 会话的 `unseenChanges` 能看到这条 revert（= AI 得知被拒）。
- **T6 多会话重开**：会话 S1 建立（initCursor）→ S1 写文件 A → 用户改 A → 会话 S2 建立 → S2 写文件 B。断言：`unseenChanges(S1)` = {A: 基准为用户改动前, B: 基准为 S2 改动前}，**不含 S1 自己的写入**；`unseenChanges(S2)` 为空（B 是自己写的，之前的都在 initCursor 位点前）。
- **T7 对账**：绕过模块直接改磁盘文件 → `reconcile` 补 external edit；对同一内容再次 `reconcile` → no-op（回声抑制）；直接删文件 → external delete。
- **T8 崩溃模拟**：构造"文件已写盘、账未记"状态 → `reconcile` 补 external 条目，历史不断链。
- **T9 超限 / 二进制**：超过 `maxSnapshotBytes` 的文件与含 NUL 字节的文件 → 日志条目存在、快照 body 为 NULL、`textDiff` 返回不可用标记、`restore` 该版本明确报错。
- **T10 保留策略**：用注入时钟构造跨窗口历史 → 窗口外按日稀疏；三条保护规则各自生效（未接受段不删 / 活跃游标后不删 / 每 path 末条不删）；快照 GC 后无悬空引用、存活条目引用的快照完好；稀疏化后时间线仍可渲染。
- **T11 rename 链**：A rename 为 B 后，`timeline(B, {followRenames: true})` 含 A 时期历史；收件箱与 unseen 分组归并到现名 B。
- **T12 句柄释放（Windows 关键验收）**：open → 写入 → close → **直接删除库文件成功**；两个先后启动的进程依次 open 同一库不报 SQLITE_BUSY。

### 性能 smoke（实测数字写进 README）

- **P1**：单次 `performWrite`（30KB 文本）含 hash + 快照 + 记账 ≤ 20ms——这是热路径，编辑器自动保存节流后仍会高频触发。
- **P2**：1 万条日志 + 3 千快照的库上，`unseenChanges` / `inbox` / `timeline` 各 ≤ 50ms。
- **P3**：同一文件 100 个版本（30KB 文本、每版小改动）的库体积报告。全文快照没有增量压缩，体积若不可接受**如实报告并提议方案**（如相邻版本 delta 存储），不要自行实现。

### 约束（实现全程不得违反）

- TypeScript strict；不用 `any` / 裸 `unknown` / `Record<string, unknown>`（确需时注释原因）；判别联合完备，repo 层"行 → 类型"映射对非法行抛错。
- 遇到本契约自相矛盾或不可实现之处：**停下记录到 NOTES.md 并在最终报告列出**，不要擅自改契约语义、不要用 hack 绕过。
- 4 空格缩进；中文注释；公开接口与每个公开方法写文档注释；optional 字段必须注释"何时为空、非空是什么含义"。

## 边界（明确的非目标）

- **不做 UI**、**不做文件监听**、**不做提醒文案与注入**——宿主集成时负责：把自己的写入路径接到 perform* / register*，把 watcher 事件喂给 `reconcile`，把 `unseenChanges` 结果转成提示注入给 AI。
- 不做 git 导出（将来可能加单向导出器，本期不做）。
- 不做多进程并发、跨 workspace 全局日志、增量 / delta 快照（只报告体积数据）。
- 不做非文件操作类型（settings / UI 状态等）——信封已留位，本期不实现。

## 已知坑（宿主实战经验，提前避雷）

- **libsql native + bun + Windows**：`close()` 之后事件循环句柄可能不释放——一次性 CLI / 测试进程末尾需要显式 `process.exit`；`close()` 实现要穷尽释放手段，并以"库文件可删"（T12）为唯一准绳，不以"没报错"为准。
- **Windows 文件锁**：测试里删库文件失败通常 = 句柄泄漏，按缺陷处理，不是环境问题。
- **BLOB vs TEXT**：快照 body 必须 BLOB 存原始字节；按字符串存会破坏逐字节还原。
- **PowerShell 中文管道**（如写 demo CLI）：需要 UTF-8 三层初始化（`chcp 65001` + `[Console]::OutputEncoding` + `$OutputEncoding`）。

## 迭代策略

按里程碑推进，每个里程碑测试绿再进下一个：
**M1** schema + repo 层（非法行拒绝）→ **M2** 写入面 + 快照（perform* / register*）→ **M3** 查询面（时间线 / diff / 删除找回）→ **M4** 收件箱 + 游标 + revert / restore → **M5** reconcile → **M6** prune + 快照 GC → **M7** 性能 smoke + Windows 句柄验收 + demo 脚本。
每个里程碑结束在 NOTES.md 记一行：做了什么、发现了什么问题、下一步。

## 受阻停止条件

若 `@libsql/client` 在 bun / Windows 上出现无法绕过的阻塞缺陷（例如穷尽手段后 T12 仍无法通过），**停止并报告**：已尝试的路径、证据（错误输出 / 复现步骤）、建议的替代驱动（如 `bun:sqlite` 或 `better-sqlite3`）及各自对"宿主也用 libsql"这一集成前提的影响。**不要擅自更换驱动**。其他任何契约级阻塞同理：报告受阻点、已收集的证据、解锁所需的输入。
