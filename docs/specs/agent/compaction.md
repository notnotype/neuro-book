---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent-context-compaction
owners:
  - agent-runtime
---

# Agent Context Compaction

## 目标与非目标

**目标**：Agent 对话上下文达到模型窗口触发线时压缩早期历史为摘要，使后续轮次可继续执行。摘要请求自身受独立输入预算约束，不会因请求过大而失败。模型摘要为空时以确定性文本兜底。已压缩过的会话若压缩后仍达触发线，停止继续压缩。

**非目标**：不承诺压缩后能容纳任意长的后续输入。不提供多级递进裁剪（压缩后仍超线时停止，不自动加大裁剪力度）。恢复材料只覆盖本次 invocation 工具接触过的文件，不注入 Project 其他上下文。不保证首次压缩无收益时报错（见"失败与恢复"的门禁边界）。

## 术语与参与者

- **触发线（trigger tokens）**：`resolveCompactionTriggerTokens` 依据 `CompactionOptions` 与 `contextWindow` 算出的 token 阈值。
- **输入预算（input budget）**：摘要请求可用输入 token 上限，由 `COMPACTION_INPUT_BUDGET_RATIO`、`COMPACTION_INPUT_MIN_TOKENS`、`COMPACTION_INPUT_MAX_TOKENS` 共同约束。
- **摘要策略（summaryStrategy）**：entry `details` 字段，`"llm"` 表示模型生成，`"deterministic-fallback"` 表示模型输出为空后使用确定性兜底文本。
- **恢复材料（recovery materials）**：本次 invocation 被 `read`/`write`/`edit`/`apply_patch` 工具接触过的文件；物化后可产生一条运行时消息重新注入上下文。
- **参与者**：`NeuroAgentHarness`（触发与编排）、`compaction.ts`（压缩、预算、门禁）、`context-admission.ts`（provider 请求准入）、`recovery-materials.ts`（材料追踪与物化）。

## 输入与前置条件

`compactBeforeNextTurn` 在 `prepareNextTurn` 中被调用，实际压缩需同时满足：

- `frame.automaticCompactionDoneForTurn` 为 `false`（本轮尚未压缩）；
- `frame.compaction?.enabled` 为 `true`；否则只执行 `assertContextWithinWindow` 后返回；
- `shouldCompactWithOptions(contextTokens, contextWindow, options)` 为 `true`，即 `enabled`、`contextWindow > 0` 且 `contextTokens` 达到触发线。

`CompactionOptions`（`resolveCompactionOptions` 由 Profile patch 与 Model 解析，默认值见 `DEFAULT_NEURO_COMPACTION_OPTIONS`）决定触发线、保留轮次、摘要前缀、保留 token 与摘要上限。

摘要输入预算由内部常量约束，不可通过 Profile 配置：

| 常量 | 值 | 含义 |
|---|---|---|
| `COMPACTION_INPUT_BUDGET_RATIO` | 0.45 | 输入预算占 `contextWindow` 比例 |
| `COMPACTION_INPUT_MIN_TOKENS` | 1 | 输入预算下限 |
| `COMPACTION_INPUT_MAX_TOKENS` | 32000 | 输入预算上限 |
| `COMPACTION_TOOL_RESULT_MAX_CHARS` | 2000 | 单个工具结果保留字符数 |
| `COMPACTION_TEXT_TRUNCATION_MARKER` | `"\n\n[... tool result truncated for compaction ...]"` | 裁剪标记 |

工具结果按**字符数**裁剪（非 token），超出部分替换为固定标记，保证同一输入产生同一裁剪结果。

恢复材料预算常量（`recovery-materials.ts` 导出）：`RECOVERY_MATERIAL_MAX_CAPTURE_BYTES` 16384、`RECOVERY_MATERIAL_MAX_VERIFY_BYTES` 262144、`RECOVERY_MATERIAL_MAX_REFERENCES` 16、`RECOVERY_MATERIAL_MAX_BODY_TOKENS` 1200、`RECOVERY_MATERIAL_MAX_TOTAL_TOKENS` 2000。

## 输出与可观察行为

压缩写入的唯一 entry 类型是 `CompactionSessionEntry`：

```typescript
{
  type: "compaction";                  // 唯一取值
  summary: string;                      // 含 summaryPrefix 的摘要正文
  firstKeptEntryId: SessionEntryId | null;
  tokensBefore: number;
  details?: {
    summaryStrategy?: "llm" | "deterministic-fallback";
    triggerTokens?: number;
    reserveTokens?: number;
    summarizedTokens?: number;
    // 其余为诊断字段
  };
}
```

- `summaryStrategy: "llm"`：模型返回非空摘要。
- `summaryStrategy: "deterministic-fallback"`：模型返回空文本，摘要正文由 `deterministicCompactionFallback` 生成。**兜底结果写入同一个 `type: "compaction"` entry；不存在 `compaction_checkpoint` 或任何其他压缩 entry 类型。**

恢复材料物化成功且产生消息时，该消息作为运行时消息加入下一轮上下文，不写入 session entry。被跳过的候选通过 `agent.compaction.recoveryMaterialsSkipped` info 日志可观察。

失败以异常形式可观察：`ProviderContextOverflowError`（摘要请求超窗）、`assertCompactionMadeProgress` 抛出的重复压缩停止错误。

## 状态与转换

| 初始状态 | 事件 | 下一状态 | 拒绝条件 |
|---|---|---|---|
| 轮次结束，未压缩 | `contextTokens` 未达触发线 | 不压缩，直接进入下一轮 | — |
| 轮次结束，未压缩 | 达触发线且 `enabled` | 写入 `compaction` entry | `automaticCompactionDoneForTurn` 已为 `true` 则跳过 |
| 压缩已写入 | 恢复材料物化产生消息 | 重注入上下文并执行进展门禁 | 物化结果为 `null` 时跳过门禁 |
| 压缩已写入且曾压缩过 | 压缩后仍达触发线 | 抛错终止本轮 | `hadPreviousCompaction` 为 `false` 时放行 |

`hadPreviousCompaction` 的判定：`this.repo.activePath(snapshot).some((entry) => entry.type === "compaction")`，即当前活动路径上已存在压缩 entry。

`assertCompactionMadeProgress` 的真实逻辑：

```
if (!hadPreviousCompaction || !shouldCompactWithOptions(afterTokens, contextWindow, options)) return;
throw new Error(...)   // 消息含 beforeTokens、afterTokens 与 triggerTokens
```

即它是**重复压缩停止门禁**，判据只有"曾经压缩过"与"压缩后仍达触发线"两项；`beforeTokens` 仅出现在错误消息中，不参与判定，不存在 before/after 收益比较。

幂等性：同一 invocation 的恢复材料由 `RecoveryMaterialTracker` 按 `recoveryMaterialKey`（`projectRoot + projectGeneration + path + version`）去重；已接受的键记入 `frame.recoveryMaterialKeys`。

## 副作用与数据

- **Session 持久化**：`appendCompaction` 追加一条 `type: "compaction"` entry；被压缩的历史 entry 仍留在 JSONL，由 reducer 在投影时跳过。
- **运行时上下文**：`reinjectHistorySetAfterCompaction` 重建 `frame.messages`；恢复材料消息进入 `frame.nextTurnRuntimeMessages`，不持久化。
- **恢复材料追踪**：`invocationRecoveryMaterials`（`Map<string, RecoveryMaterialTracker>`）按 invocationId 持有，invocation 收尾时 `delete`，不跨 invocation 保留。
- **文件读取**：物化阶段读取候选文件；超过 `RECOVERY_MATERIAL_MAX_VERIFY_BYTES` 的文件不读入正文。
- **网络**：一次摘要模型调用。
- **无缓存写入，无跨 session 状态。**

## 失败与恢复

| 失败场景 | 行为 |
|---|---|
| 摘要模型返回空文本 | 使用 `deterministicCompactionFallback`，`summaryStrategy` 记 `"deterministic-fallback"`，压缩成功 |
| 摘要请求超出模型窗口 | `assertProviderContextWithinWindow` 在 `tracedCompleteSimple` 前抛 `ProviderContextOverflowError`，**provider 请求不发出**；该错误随后被 `generateCompactionSummary` 自身的 catch 捕获，转为 `strategy: "deterministic-fallback"` 并把消息写入 `details.summaryError`。是否外抛取决于 `allowFallback`（见下） |
| 压缩未启用但上下文超窗 | `assertContextWithinWindow` fail-closed 抛错 |
| 恢复材料读取或版本校验失败 | 该候选计入 `skipped` 并记 info 日志，压缩继续 |
| 曾压缩过且压缩后仍达触发线 | `assertCompactionMadeProgress` 抛错，本轮 fail-closed 终止 |

**`allowFallback` 决定失败是否外抛**：`appendCompaction` 的 `allowFallback` 参数决定摘要不可用时的收口方式。

| 调用路径 | `allowFallback` | 行为 |
|---|---|---|
| 自动压缩（`compactIfNeeded`，硬编码 `allowFallback: true`） | `true` | 写入 `type: "compaction"` entry，`details.summaryStrategy = "deterministic-fallback"`，`details.summaryError` 记录原始消息；调用方不感知失败 |
| 手动压缩（harness 直接调 `appendCompaction`，未传该参数） | falsy | 抛出普通 `Error`（消息取自 `summaryError`），**不写入任何 entry** |

因此自动压缩路径下超窗**不会**向上冒泡为 `ProviderContextOverflowError`；对外可观察的是一条带 `summaryError` 的 compaction entry。原始错误类型只在 `generateCompactionSummary` 内部短暂存在。

**进展门禁边界（当前真实行为，非目标缺陷）**：进展门禁只在 `compactBeforeNextTurn` 返回非 `null` 的 recovery materialization 分支内执行。因此以下两种情形不会触发停止错误：

1. 首次压缩（`hadPreviousCompaction === false`）——即使压缩后仍达触发线也放行，允许第一次压缩后继续尝试；
2. 恢复材料物化结果为 `null`——门禁整段不执行。

若需要"任何一次无收益压缩都立即停止"，须先修改调用方分支条件，本 Spec 不宣称该行为。

压缩失败不自动重试，由 `prepareNextTurn` 的调用方终止本轮。

## 边界与兼容

- **所有权**：`server/agent/harness/` 拥有压缩实现；`server/agent/session/types.ts` 拥有 `CompactionSessionEntry`；`shared/dto` 拥有对外投影。
- **依赖方向**：harness → compaction / context-admission / recovery-materials；反向无依赖。
- **Schema 兼容**：`type`、`summary`、`firstKeptEntryId`、`tokensBefore` 为必填，`details` 及其子字段可选；新增 `summaryStrategy` 落在 `details` 内，旧 session JSONL 无需迁移。
- **安全**：恢复材料只覆盖本 invocation 工具接触过的路径，并受 bytes / tokens / references 三重预算约束。

## 验收与 Smoke

- **Given** 上下文达触发线且模型返回非空摘要，**When** 进入下一轮，**Then** 写入一条 `type: "compaction"` entry 且 `details.summaryStrategy === "llm"`。
- **Given** 上下文达触发线且摘要模型返回空文本，**When** 压缩执行，**Then** 仍写入 `type: "compaction"` entry，`details.summaryStrategy === "deterministic-fallback"`，正文为确定性文本。
- **Given** 工具结果超过 `COMPACTION_TOOL_RESULT_MAX_CHARS`，**When** 构造摘要输入，**Then** 超出部分被 `COMPACTION_TEXT_TRUNCATION_MARKER` 替换，同输入结果字节一致。
- **Given** 活动路径已存在 `compaction` entry 且压缩后仍达触发线，**When** 恢复材料物化返回非空，**Then** 抛出含 before/after/trigger token 数的停止错误。
- **Given** 摘要最终上下文估算超过 `contextWindow` 且走自动压缩路径，**When** 压缩执行，**Then** provider 调用次数为 0，写入 `type: "compaction"` entry，`details.summaryStrategy === "deterministic-fallback"`，`details.summaryError` 含 `"Provider 请求上下文"`（见 `compaction.test.ts` "摘要最终上下文超窗时在 provider 调用前降级"）。
- **Given** turn 路径的 provider 请求估算超过 `contextWindow`，**When** `streamAssistant` 发起调用前，**Then** `ProviderContextOverflowError` 冒泡为 invocation 错误，`streamSimple` 未被调用（见 `neuro-agent-harness.test.ts` "自动 compaction 开启时首次超窗请求也会在 provider 前失败"）。

Smoke 入口：

```
bun run --cwd packages/neuro-book test -- server/agent/harness/compaction.test.ts server/agent/harness/recovery-materials.test.ts server/agent/harness/neuro-agent-harness.test.ts --reporter=dot
```

**未验收**：真实 provider trace、作者视角长 session 与实际压缩频率，不能用上述自动化测试替代。

## 实现合同

- **压缩与门禁** `packages/neuro-book/server/agent/harness/compaction.ts`：`compactIfNeeded`、`appendCompaction`、`shouldCompactWithOptions`、`resolveCompactionOptions`、`resolveCompactionTriggerTokens`、`assertCompactionMadeProgress`、`DEFAULT_NEURO_COMPACTION_OPTIONS`
- **请求准入** `packages/neuro-book/server/agent/harness/context-admission.ts`：`estimateProviderContextTokens`、`estimateProviderMessageTokens`、`estimateProviderTextTokens`、`assertProviderContextWithinWindow`、`pruneProviderMessagesForWindow`、`ProviderContextOverflowError`
- **恢复材料** `packages/neuro-book/server/agent/harness/recovery-materials.ts`：`createRecoveryMaterialTracker`、`materializeRecoveryMaterials`、`recoveryMaterialKey`
- **编排入口** `packages/neuro-book/server/agent/harness/neuro-agent-harness.ts`：`prepareNextTurn`、`compactBeforeNextTurn`、`invocationRecoveryMaterials`
- **Entry schema** `packages/neuro-book/server/agent/session/types.ts`：`CompactionSessionEntry`

**关键不变量**：

- 压缩只写 `type: "compaction"`；摘要来源差异只体现在 `details.summaryStrategy`。
- 兜底摘要在相同输入下字节一致。
- 进展门禁仅在"曾压缩过 + 压缩后仍达触发线"时抛错，且只在恢复材料物化非空分支内执行。
- 恢复材料 tracker 生命周期不跨 invocation。

## 证据

- 实现 provenance：[Task 147](../../../packages/neuro-book/.agents/tasks/147-agent-context-compaction-reliability/README.md)
- 合同测试：`compaction.test.ts`、`recovery-materials.test.ts`、`neuro-agent-harness.test.ts`、`prepare-next-turn.test.ts`
- Smoke 命令：见"验收与 Smoke"
