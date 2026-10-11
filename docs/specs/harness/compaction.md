---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.compaction
owners:
  - nb-harness
---

# Harness 压缩：方法注册、选择、执行与写入

## 目标与非目标

`nb-harness` 的 `compaction` 模块把一段会话历史压成摘要：压缩**方法**走注册，按调用方给的顺序依次尝试；成功的结果追加为一条 `compaction` 条目，并在同一批里重新写入种子；此后模型看到的上下文由 [`harness.session`](session.md) 输出 12 回放。内置方法 `soft` 用本地模型做摘要，直接包 OMP 的 `prepareCompaction` 与 `compact`，关闭远程与服务方原生压缩。另给运行时一个纯函数判断“上下文是否已超阈值”。

不承诺：

- 何时触发（手动、溢出、一轮结束超阈值）与触发时的状态机：由 `runtime` 负责，本模块只提供阈值判断与执行。
- 种子的内容：由 [`harness.profile`](profile.md) 的 `renderSeeds("after-compaction")` 产生，调用方传入；本模块只负责与压缩条目一起写入。
- `remote`（OpenAI、Anthropic 的原生压缩）、`snapcompact`、`handoff`、`shake`：第一版不做，`remote` 的推迟理由见 [Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“压缩”一节与决策记录。
- 模型的选择与凭据：调用方从 [`harness.models`](models.md) 解析好模型与 API key 传入。
- 改写已有条目（OMP 的工具输出裁剪会改写会话文件）：会话只追加。

## 术语与参与者

- **压缩方法**：一个注册进来的对象，声明 id，能判断对一段历史是否**适用**，能把历史压成**压缩结果**。
- **压缩结果**：`summary`、`firstKeptEntryId`、`tokensBefore` 与可选的 `shortSummary`、`details`、`preserveData`；形状与 OMP `compact` 的返回值和 [`harness.session`](session.md) 的 `compaction` 条目一致。
- **本段历史**：最后一个 `compaction` 条目之后的条目（[`harness.session`](session.md) 术语）；再次压缩时 OMP 从上一条压缩的 `firstKeptEntryId` 起取历史，并把上一条摘要作为“先前摘要”迭代更新。
- **方法顺序**：调用方给的方法 id 列表；来自 Profile 的注册字段 `harness/compaction`，缺省 `["soft"]`。
- **压缩设置**：`keepRecentTokens`（压缩后保留多少近期历史）、`reserveTokens`（给下一次请求与回复留的余量）、`threshold`（触发阈值）、`instructions`（给摘要模型的额外要求）；来自同一个注册字段，各有缺省值。
- **调用方**：`runtime`（内核）；插件阶段的插件只注册方法，不直接调用执行。

## 输入与前置条件

```ts
// 公开入口 @notnotype/nb-harness/compaction
createCompactionRegistry(): CompactionRegistry;                       // 预先登记内置方法 soft
softCompaction: CompactionMethod;                                     // 内置方法，可单独引用
createSoftCompaction(options?: {completeImpl?: CompleteImpl}): CompactionMethod;   // 同一方法，可替换摘要调用的传输（OMP SummaryOptions.completeImpl）；测试与宿主的并发限制用
compactSession(input: CompactInput): Promise<CompactionResult<Compacted>>;
shouldCompact(input: {entries: readonly SessionEntry[]; contextWindow: number; settings: CompactionSettings}): TriggerDecision;
resolveCompactionSettings(field: unknown): CompactionSettings;        // 注册字段的值（已按 schema 校验）→ 填好缺省值的设置
COMPACTION_FIELD: {id: "harness/compaction"; schema: TSchema};        // 交给 Profile 主机 registerField 的字段定义

interface CompactionRegistry {
    register(method: CompactionMethod): CompactionResult<{dispose(): void}>;
    get(id: string): CompactionMethod | undefined;
    list(): string[];                                                 // 注册顺序
}
type CompactionMethod = {
    id: string;                                                       // 内置用短名；插件 "<插件 id>/<名称>"
    /** 不调模型、不写入：对这段历史能不能压；不能时给一句原因。 */
    applicable(input: MethodInput): {ok: true} | {ok: false; detail: string};
    run(input: MethodInput, signal: AbortSignal): Promise<MethodResult>;
};
type MethodInput = {entries: readonly SessionEntry[]; model: Model; apiKey: string; settings: CompactionSettings};
type MethodResult = {ok: true; value: CompactionOutput} | {ok: false; detail: string};
type CompactionOutput = {summary: string; firstKeptEntryId: string; tokensBefore: number; shortSummary?: string; details?: JsonValue; preserveData?: {[key: string]: JsonValue}};

type CompactInput = {
    log: SessionLog;                                                  // harness.session 的会话句柄
    registry: CompactionRegistry;
    methods?: readonly string[];                                      // 方法顺序；缺省 settings 里的 methods
    model: Model; apiKey: string;
    settings: CompactionSettings;
    seeds?: readonly EntryInput[];                                    // 压缩后重新写入的种子（调用方已渲染好）
    signal?: AbortSignal;
};
type Compacted = {method: string; output: CompactionOutput; entries: readonly SessionEntry[]};   // entries：这次追加的条目（压缩条目在前，种子在后）

type CompactionSettings = {
    methods: string[];                                                // 缺省 ["soft"]
    keepRecentTokens: number;                                         // 正整数；缺省 20000
    reserveTokens?: number;                                           // 正整数；缺省由 OMP 决定（16384 与窗口 15% 取大）
    threshold: {tokens: number} | {percent: number};                  // tokens 正整数；percent 1–99；缺省 {percent: 80}
    instructions?: string;                                            // 给摘要模型的额外要求
};
type TriggerDecision = {compact: boolean; contextTokens: number | null; thresholdTokens: number};   // contextTokens 为 null 表示没有可用的用量

type CompactionFailure = "invalid-method" | "duplicate-method" | "unknown-method" | "nothing-to-compact" | "compaction-failed" | "cancelled" | "log-failed";
type CompactionResult<T> = {ok: true; value: T} | {ok: false; code: CompactionFailure; detail: string; attempts?: {method: string; detail: string}[]};
```

| 规则 | 内容 |
|---|---|
| 方法 id | 内置方法是 `[a-z][a-z0-9-]*`；其它是 `<插件 id>/<名称>`，两段都是 `[A-Za-z0-9._-]+`；在一个注册表内唯一 |
| 方法对象 | `applicable`、`run` 是函数；`run` 的结果满足 `MethodResult` 的形状，`firstKeptEntryId` 必须是 `entries` 里某个条目的 id |
| 注册字段 `harness/compaction` | 值是对象：`methods?: string[]`（非空字符串，不重复）、`keepRecentTokens?`、`reserveTokens?`（正整数）、`threshold?: {tokens} \| {percent}`、`instructions?: string`；未知键是问题。字段值由 Profile 主机按 `COMPACTION_FIELD.schema` 校验，本模块的 `resolveCompactionSettings` 只填缺省值 |
| `model` | OMP `Model`；`soft` 要求它有正的 `contextWindow` |
| `seeds` | 每条是 `custom_message`、`customType: "harness/seed"` 的条目输入（[`harness.session`](session.md) 的条目规则）；不是的话 `log.append` 整批拒绝，本模块按 `log-failed` 报告 |

## 输出与可观察行为

1. **注册**：`register` 按上表检查方法；不合规 → `invalid-method`；id 已存在（含内置 `soft`）→ `duplicate-method`；通过后注册表存一份冻结副本，`dispose` 后 `get` 返回 `undefined`、`list` 不再列出，同一 id 可以再注册。`createCompactionRegistry()` 返回的注册表已含 `soft`。
2. **方法顺序与选择**：`compactSession` 按 `methods`（缺省 `settings.methods`）的顺序取方法：列表里有未注册的 id → 立即返回 `unknown-method`，不尝试任何方法、不写入。对每个方法先 `applicable`，不适用的记一条尝试原因后换下一个；适用的 `run`，`run` 返回失败或抛出（异常文本作为原因）也记一条尝试原因后换下一个；第一个成功的方法胜出。全部不适用或失败：所有尝试都是“不适用”时返回 `nothing-to-compact`，否则返回 `compaction-failed`；两者的 `attempts` 按顺序列出每个方法与原因。
3. **中止**：`signal` 已中止或在某个方法 `run` 期间中止时，返回 `cancelled`，不再尝试后面的方法，不写入。中止时 OMP 的本地摘要调用不抛出而是以 `stopReason: "aborted"` 的空回复返回，所以 `soft` 以 `signal.aborted` 为准，不把空文本当成摘要。
4. **结果校验**：胜出方法的结果不满足形状、`firstKeptEntryId` 不是输入条目的 id、`summary` 为空字符串、`details` 或 `preserveData` 不能被 JSON 如实表示（或 `preserveData` 不是对象）→ 当作该方法失败（原因写明哪一项），继续换下一个方法；不会到了写日志才被条目校验拒绝。
5. **写入**：胜出后把压缩结果作为一条 `compaction` 条目，连同 `seeds` 按给定顺序，以**一次** `log.append` 追加（原子：要么都写入，要么都不写）；`append` 失败 → `log-failed`，`detail` 带会话模块的失败码与说明，不重试。成功时返回胜出方法、结果与追加的条目。追加之前日志里新增的条目（压缩期间调用方写入的）照常保留：它们在 `firstKeptEntryId` 之后、压缩条目之前，回放时仍在上下文里。
6. **压缩后的回放**：追加完成后 `buildModelContext(log.entries)` 按 [`harness.session`](session.md) 输出 12 得到：种子、摘要（一条 `attribution: "agent"` 的用户消息）、从 `firstKeptEntryId` 起的历史。再次对同一会话 `compactSession`：`soft` 从上一条压缩的 `firstKeptEntryId` 起取历史，并把上一条 `summary` 作为先前摘要交给模型迭代更新（OMP 的 `prepareCompaction` 行为）。
7. **`soft` 的适用性**：`applicable` 调用 OMP `prepareCompaction(entries 的浅副本, OMP 设置, model)`：返回 `undefined`（没有可摘要的消息、最后一条是压缩条目、`keepRecentTokens` 够大以至于全部保留）→ 不适用，原因“没有可压缩的历史”；`model.contextWindow` 不是正数 → 不适用。OMP 设置固定 `enabled: true`、`remoteEnabled: false`、`remoteStreamingV2Enabled: false`，`keepRecentTokens`、`reserveTokens` 取压缩设置。
8. **`soft` 的执行**：`run` 用同样的准备结果调用 OMP `compact(preparation, model, apiKey, settings.instructions, signal)`：OMP 用本地模型做一次（切在一轮中间时两次，并行）摘要调用与一次短摘要调用，返回 `summary`、`shortSummary`、`firstKeptEntryId`（输入条目的 id）、`tokensBefore`（最后一条助手消息报告的上下文用量）、`details`（OMP 从工具调用里提取的文件列表）。模型调用以 `stopReason: "error"` 结束时 OMP 按它的缺省重试（最多 3 次，退避从 500 ms 起翻倍，中止时停止），仍失败才抛出，`run` 把异常文本作为失败原因返回；本模块不再加重试。
9. **阈值判断**：`shouldCompact` 是纯函数。`contextTokens` 取 `entries` 里最后一条 `stopReason` 不是 `error`、`aborted` 的助手消息的用量（OMP `calculateContextTokens`：优先服务方报告的 `contextTokens`，否则 `totalTokens`，否则各项相加）；没有这样的消息 → `{compact: false, contextTokens: null}`。`thresholdTokens`：`threshold.tokens` 时取它并夹在 `[1, contextWindow - 1]`；`threshold.percent` 时为 `floor(contextWindow × percent / 100)`，再与 `contextWindow - 余量` 取小（余量按 OMP `effectiveReserveTokens`：`reserveTokens` 缺省 16384，与窗口的 15% 取大）。`contextWindow <= 0` → 不压缩。`compact` 为 `contextTokens > thresholdTokens`。
10. **设置的缺省值**：`resolveCompactionSettings(undefined)` 与 `resolveCompactionSettings({})` 都得到 `{methods: ["soft"], keepRecentTokens: 20000, threshold: {percent: 80}}`；给出的键覆盖对应缺省值；返回值深冻结。
11. **不改输入**：`compactSession` 与 `soft` 不修改传入的条目（交给 OMP 的是浅副本，OMP 不改写条目）、设置与种子。

## 状态与转换

本模块无状态：注册表只是方法的集合；一次 `compactSession` 的状态都在局部。同一会话的两次压缩不能并发（第二次会把第一次追加的压缩条目当作最后一条而不适用，或者两条压缩条目指向同一段历史）；调用方（`runtime`）保证一个会话同一时间只有一次压缩在进行。

**时序**：`compactSession` 在 `run` 返回后才 `append`；`append` 返回后才返回结果。`signal` 在 `append` 开始之后中止不再生效（写入不可撤销）。

## 副作用与数据

- 模型调用：`soft` 每次压缩两到三次调用（摘要、切在一轮中间时的轮前缀摘要、短摘要），费用归摘要模型；提示词由 OMP 生成，`instructions` 追加在后。
- 写入：只有 `compactSession` 成功时追加一批条目；没有其它 I/O，不读环境变量。
- `compaction` 条目的 `details` 与 `preserveData` 原样保存（[`harness.session`](session.md) 输出 23），v1 回放不使用。

## 失败与恢复

| 失败码 | 含义 | 调用方怎么办 |
|---|---|---|
| `invalid-method` | 注册的方法不合规则 | 修正方法定义 |
| `duplicate-method` | id 已注册 | 先 `dispose` 或换 id |
| `unknown-method` | 方法顺序里有未注册的 id | 修正 Profile 字段或注册该方法 |
| `nothing-to-compact` | 全部方法都不适用（典型：历史太短，`keepRecentTokens` 已覆盖全部） | 不算错误；运行时继续，不写任何东西 |
| `compaction-failed` | 至少一个方法尝试过但失败，没有方法成功；`attempts` 逐个列出 | 运行时记录并继续本轮（上下文仍然过长时由下一次触发再试）；手动触发时把原因告诉用户 |
| `cancelled` | 调用方中止 | 无需处理 |
| `log-failed` | 压缩成功但追加失败；`detail` 带会话失败码 | 按会话模块的失败处理（`log-broken` 时会话不可再写） |

方法失败不留下任何条目；压缩结果只在成功写入后才可观察。

## 边界与兼容

- **公开接口**：`@notnotype/nb-harness/compaction` 中“输入与前置条件”列出的符号与类型；`CompactionMethod` 是插件阶段的公开 API（插件贡献新的压缩方法）。
- **依赖**：`session` 的类型（`SessionEntry`、`EntryInput`、`SessionLog`，只 `import type`）；OMP `@oh-my-pi/pi-agent-core` 运行时（`prepareCompaction`、`compact`、`calculateContextTokens`、`effectiveReserveTokens`）；`@oh-my-pi/pi-ai`、`@oh-my-pi/pi-catalog` 只 `import type`；TypeBox。不依赖 `models`、`profile`、`tools`。
- **与 OMP 的关系**：条目直接交给 OMP 的压缩函数（[`harness.session`](session.md) 输出 23 保证形状兼容）；OMP 升级改变 `compact` 的签名或摘要行为时，`typecheck` 与本模块的合同测试先失败。
- **兼容**：`CompactionSettings` 的键是对外合同；新增键要有缺省值。

## 验收与 Smoke

1. 注册表：新建即有 `soft`；注册一个自定义方法、再注册同 id 得 `duplicate-method`；`dispose` 后可再注册；缺 `run`、id 带空格各得 `invalid-method`。
2. 顺序与回退（不联网，摘要模型用脚本化的完成函数）：会话有六轮对话，方法顺序 `["never", "flaky", "soft"]`，`never` 不适用、`flaky` 的 `run` 抛出：结果由 `soft` 产生，`attempts` 两条按序列出原因；顺序里有未注册的 id 时得 `unknown-method` 且 `log.entries` 不变；全部不适用 → `nothing-to-compact`；有失败无成功 → `compaction-failed`。
3. 写入与回放：`soft` 成功后 `log.entries` 末尾依次是一条 `compaction`（`firstKeptEntryId` 是日志里的条目 id，`summary` 是脚本化模型的回复）与两条种子；`buildModelContext` 依次为种子、摘要、从 `firstKeptEntryId` 起的历史；再次压缩时交给模型的提示词包含上一条摘要（先前摘要迭代）；`append` 被存储拒绝时返回 `log-failed` 且 `entries` 不变。
4. 中止：`run` 期间中止 → `cancelled`、不写入；模型回复 `stopReason: "error"` → 该方法失败，原因含错误文本。
5. 阈值：窗口 100000、`threshold: {percent: 80}`，最后一条助手消息用量 `contextTokens: 80001` → 压缩，`80000` → 不压缩；`threshold: {tokens: 50000}`、用量 `totalTokens: 50001` → 压缩；没有助手消息 → `contextTokens: null`、不压缩；`stopReason: "error"` 的助手消息不算。
6. 设置：`resolveCompactionSettings` 的缺省值与覆盖；`COMPACTION_FIELD.schema` 拒绝未知键、`percent: 100`、空 `methods` 项。
7. 真实模型冒烟（`*.llm.test.ts`，显式运行）：用测试配置的模型对一个六轮的小会话做一次 `soft` 压缩，`summary` 非空、`firstKeptEntryId` 落在日志里，`buildModelContext` 的第一条用户消息含摘要。

Smoke：`packages/nb-harness` 的 `bun test src/compaction`；真实模型 `bun run test:llm`（需授权）。

## 实现合同

- 公开入口：`@notnotype/nb-harness/compaction`（`createCompactionRegistry`、`softCompaction`、`createSoftCompaction`、`compactSession`、`shouldCompact`、`resolveCompactionSettings`、`COMPACTION_FIELD` 与“输入与前置条件”的类型）。
- owner：`nb-harness` 的 `compaction` 模块；对 `session` 只 `import type`；运行时依赖 `@oh-my-pi/pi-agent-core` 的压缩函数与 TypeBox，对 `@oh-my-pi/pi-ai`、`@oh-my-pi/pi-catalog` 只用类型。
- 内部不变量（都有测试锁定）：
  1. 任何失败路径都不调用 `log.append`；成功路径只调用一次。
  2. `soft` 交给 OMP 的是 `[...entries]`，设置固定关闭远程与原生压缩；OMP 的一次性重试用它的缺省（`oneshotRetry` 不传）。
  3. 脚本化的完成函数只经 OMP `SummaryOptions.completeImpl` 注入（OMP 给宿主的正式接口），产品代码里没有测试专用分支；真实模型路径由 `*.llm.test.ts` 覆盖。

## 证据

- 批准依据：[Agent harness 内核](../../proposals/agent-harness-kernel.md) 的“压缩”一节（开发者 2026-10-10 决定：压缩作为单独模块、方法走注册，第一版只做 `soft`，`remote` 推迟；压缩结果只追加；Profile 经注册字段 `harness/compaction` 声明方法顺序、阈值、保留多少与额外要求；压缩后重新写入种子）。
- 实现入口：[`packages/nb-harness/src/compaction/compaction.ts`](../../../packages/nb-harness/src/compaction/compaction.ts)
- 合同测试：[`compaction.test.ts`](../../../packages/nb-harness/src/compaction/compaction.test.ts)（真实内存存储、真实 OMP `prepareCompaction`/`compact`，摘要传输经 `completeImpl` 脚本化）
- Smoke：[`compaction.llm.test.ts`](../../../packages/nb-harness/src/compaction/compaction.llm.test.ts)（真实模型，只在 `bun run test:llm` 下运行）
