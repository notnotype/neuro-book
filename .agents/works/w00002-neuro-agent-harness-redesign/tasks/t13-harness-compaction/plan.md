# t13 实施计划：`compaction` 模块

## Context

- **为什么做**：Work 切片 5。`runtime` 在上下文超阈值或用户手动要求时要把历史压成摘要；方法的注册、选择、`soft` 对 OMP 压缩函数的包装、压缩条目与种子的写入都收在这里，`runtime` 只负责判断时机、取模型与种子、调用。
- **依据**：[`harness.compaction`](../../../../../docs/specs/harness/compaction.md)（本 Task 新写，`planned`）；[Agent harness 内核](../../../../../docs/proposals/agent-harness-kernel.md)（`accepted`）的“压缩”；[`harness.session`](../../../../../docs/specs/harness/session.md) 的压缩条目、输出 12 与 23。
- **开发者已确认的决定**：单独模块、方法走注册、`methodOrder` 依次尝试、失败换下一个（用户中止除外）；第一版只做 `soft`（OMP `prepareCompaction` 加 `compact`，`remoteEnabled: false`）；只追加；Profile 注册字段 `harness/compaction`；压缩后重新写入种子。
- **工作方式**：同前几个 Task。摘要模型用 OMP `SummaryOptions.completeImpl` 注入脚本化的完成函数（OMP 给宿主的正式接口，与 t12 用 `streamFn` 脚本化模型是同一做法），不联网；真实模型冒烟放 `compaction.llm.test.ts`，待授权运行。

## 关键设计

### 1. 类型与设置（`src/compaction/types.ts`、`settings.ts`）

- 类型照 Spec。`COMPACTION_FIELD.schema` 用 TypeBox：`methods` 是非空字符串数组（重复项由 `resolveCompactionSettings` 之外的规则查——schema 只定形状，重复在 `register`/`compactSession` 时自然表现为同一方法被尝试两次，所以 schema 加 `uniqueItems`）；`threshold` 是 `{tokens}` 与 `{percent}` 的联合，`percent` 1–99；`additionalProperties: false`。
- `resolveCompactionSettings(field)`：`undefined`/`{}` → 缺省；浅合并后 `deepFreeze`。不校验（校验归 Profile 主机）。

### 2. 注册表（`src/compaction/registry.ts`）

- `Map<id, frozen copy>`；`register` 先查 id 格式（内置 `[a-z][a-z0-9-]*` 或 `<a>/<b>`）、`applicable`/`run` 是函数；`dispose` 按存下的对象身份删除。`createCompactionRegistry()` 先注册 `softCompaction`。

### 3. `soft`（`src/compaction/soft.ts`）

- `ompSettings(settings)`：`{enabled: true, keepRecentTokens, reserveTokens?, remoteEnabled: false, remoteStreamingV2Enabled: false}`。
- `applicable`：`model.contextWindow > 0` 且 `prepareCompaction([...entries], ompSettings, model) !== undefined`。
- `run`：再 `prepareCompaction`（纯函数，便宜；`applicable` 与 `run` 之间不共享状态），然后 `compact(preparation, model, apiKey, settings.instructions, signal, {completeImpl})`。`MethodInput` 是公开合同，不放测试钩子：`createSoftCompaction(options?: {completeImpl?})` 是工厂，`softCompaction = createSoftCompaction()`；测试用 `createSoftCompaction({completeImpl})` 注册到自己的注册表。
- 返回前查 `signal.aborted`（OMP 本地摘要在中止时以空回复返回而不抛出）→ 失败原因 `aborted`，由 `compactSession` 转成 `cancelled`；`summary === ""` → 失败。

### 4. 执行（`src/compaction/run.ts`）

- `compactSession`：先解析方法顺序（未注册 → `unknown-method`）；逐个 `applicable` → `run`（`try/catch`，异常文本作为原因）；每次 `run` 之后查 `signal.aborted` → `cancelled`；胜出结果校验（形状、`firstKeptEntryId ∈ entries`、`summary` 非空）；`log.append([compactionEntry, ...seeds])`；失败码映射照 Spec。
- `attempts` 累积 `{method, detail}`；区分“不适用”与“失败”用一个布尔，决定 `nothing-to-compact` 还是 `compaction-failed`。

### 5. 阈值（`src/compaction/trigger.ts`）

- `shouldCompact`：用 OMP `getLastAssistantUsage`（跳过 error/aborted）与 `calculateContextTokens`；阈值计算照 Spec 输出 9，`effectiveReserveTokens` 来自 OMP。

### 6. 入口与边界

- `src/compaction/compaction.ts` 再导出；`package.json` 加 `./compaction`；模块表登记 `compaction`：依赖模块 `session`（只 `import type`），`typebox` 运行时，`@oh-my-pi/pi-agent-core` 运行时，`@oh-my-pi/pi-ai`、`@oh-my-pi/pi-catalog` 只 `import type`；不用 Node 内置模块。

## Spec 与文档改动

| 文档 | 改什么 | 片 |
|---|---|---|
| `docs/specs/harness/compaction.md` | 本 Task 新写；实现中发现歧义先改 Spec；收口加证据 | 计划时、S2 |
| `docs/specs/README.md` | 登记；收口标“待晋升” | 计划时、S2 |
| `packages/nb-harness/package.json`、`src/architecture.test.ts` | 入口与模块表 | S1 |
| Work README | 切片 5 链接 | 计划时 |
| 本 Task README | 每片更新 | 各片 |

## 切片

| 片 | 内容 | 关键设计 | 自跑验证 |
|---|---|---|---|
| S1 | 类型、设置、注册表、`soft`、执行、阈值、合同测试与 llm 冒烟（不运行） | 1–6 | `bun test src/compaction`、`bun run typecheck`、`bun test src/architecture.test.ts` |
| S2 | Spec 证据与注册表；omp 审查（计划与实现合一） | 全部 | `bun test`、仓库根 `bun run governance:check` 与 `bun run docs:check` |

## 验收映射

| `harness.compaction` | 测试 |
|---|---|
| 输出 1；场景 1 | `src/compaction/compaction.test.ts`（注册表） |
| 输出 2、3、4、5、6、7、8、11；场景 2、3、4 | 同上（真实内存存储、真实 OMP `prepareCompaction`/`compact`、`completeImpl` 脚本化） |
| 输出 9、10；场景 5、6 | 同上（纯函数） |
| 场景 7 | `src/compaction/compaction.llm.test.ts`（`llmTestConfig`，`skipIf`） |

## 验证

- `bun test src/compaction`、`bun run typecheck`；变异检查：`unknown-method` 提前返回被去掉、失败不换下一个、`aborted` 不转 `cancelled`、空摘要被接受、`append` 分两次、阈值比较 `>=`、`error` 助手消息被计入用量。
- 先在 lab 用真实 OMP 验证两件事再写 Spec 措辞：中止时本地摘要是否真的不抛出；`prepareCompaction` 第二次压缩是否从上一条 `firstKeptEntryId` 起并带 `previousSummary`。
- 未验证边界：真实模型冒烟（待授权）。

## 不做与风险

- 不做：触发时机；`remote` 等方法；种子渲染。
- 风险：OMP `compact` 固定再做一次短摘要调用（费用翻倍、延迟增加）；换成直接调 `generateSummary` 可以省掉，但要自己拼 `details`。先照设计稿用 `compact`，记入待确认清单。
- 风险：OMP `compact` 的签名与 `SummaryOptions` 随 OMP 升级变化；`typecheck` 先失败。
