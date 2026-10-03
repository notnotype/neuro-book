# 批次 A：server 侧归因地基

> 状态：**已实施并验证**（2026-07-27）

## 目标

让每次 provider 请求的 trace 里带上「这段上下文由什么组成」的结构化事实，供后续批次的诊断引擎与面板消费。本批次不产出任何 UI。

## 实际改动

### 1. 分区归因数据结构

- `server/agent/observability/pi-request-recorder.ts`
  - 新增 `PiTraceSegmentKind`（`system` / `tools` / `historySet` / `conversation` / `modelContext` / `appending` / `currentInput`）与 `PiTraceSegment`。
  - `PiTraceRequest` 增补 `segments` 与 `toolsHash`。
  - `PiTraceIndexEntry` 增补 `usage`（input/output/cacheRead/cacheWrite 拆分）与 `toolsHash`，`writeOnce` 写入时从记录复制——**这是 F3 的落实**：缓存时间轴只读 index，不再需要为四个数字去读 N 份含全量 prompt 正文的完整记录。
- `shared/dto/agent-trace.dto.ts` 同步镜像（靠 typecheck 防两份定义漂移）。

### 2. 归因计算（纯函数）

新增 `server/agent/observability/trace-segments.ts`：

- `buildTraceSegments({systemPrompt, tools, messages, prefix})` → `PiTraceSegment[]`。按 `prefix.kinds` 把连续同 kind 压成区间；超出前缀长度的消息（同一 invocation 后续 turn 追加的 assistant / toolResult）落入 `conversation`。
- `computeToolsHash(tools)` → 8 字符 sha256 前缀，覆盖完整 tool 定义（含 schema），因为 description / schema 变更同样会击穿 Anthropic 的 tools 断点。
- token 一律 `chars/4`，与 compaction 同口径。**刻意不在此做「按 provider 真实用量校准」**——校准需要响应侧 usage，而本函数在请求侧调用，两处各留一半会让口径漂移。

### 3. 来源标签（Profile DSL）

- `ProfileStringFragmentNode` 增加可选 `label`，在具名工厂里赋值：`Import:<path>`、`SkillCatalog`、`AgentCatalog`、`WorkflowCatalog`、`ActivatedSkills`、`SqlSchemaSummary`、`SystemReminder`、`LinkedAgentsSummary`、`MentionedSkillsReminder`。
- `CompileState` 增加 `pendingLabels` / `scopeLabels` / `messageLabels`。`renderMessageNode` 拆成外壳 + `renderMessageNodeContent`，外壳负责进出时保存/恢复累加器并把结果登记进 **WeakMap 旁表**。
- `Reminder` / `Watch` 通过新的 `withScopeLabel` 给内部产生的每条消息挂 `Reminder:<id>` / `Watch:<key>`——它们的消息由内部 `Message` 节点产出，光靠 fragment 标签认不出归属。
- `ProfileTurnPlan` 增加 `promptSourceLabels`（四个分区各一份平行数组），并加进 `validateProfileTurnPlan` 白名单。

**关键设计**：标签走对象标识旁表，绝不写进消息体。消息体会原样发给 provider，塞归因字段等于污染 prompt。

### 4. 落盘

- `CustomMessageSessionEntry` 增加 `promptSource?: {zone, labels?}`。
- `compilePrepareRunWritePlan` 写入时带上：`historyInitMessages` → `zone: "historySet"`，`modelContextAppending + appending` → `zone: "appending"`。
- **zone 恒写入，即使没有具名 labels**：「这条是 AppendingSet 产物」本身就是归因信息，否则匿名提醒在面板里会和普通对话混在一起。
- `modelContextAppending` 记 `appending` 而非 `modelContext`：它在消息数组里的位置和生命周期都与 AppendingSet 一致，DSL 里的书写位置仍能从 labels 看出。

### 5. 前缀归因与接线

- `buildPromptPrefixAttribution`（prepare-run.ts）从 `snapshot.entries` 建对象标识索引，按 `assemblePersistedProfilePromptMessages` 的同一套下标切出 kinds/labels。
- 链路：`prepareRun` → `PreparedRun.promptPrefix` → `runLoop` → `RunFrame.promptPrefix` → `TurnSnapshot.promptPrefix` → `streamAssistant` 调 `buildTraceSegments` → `PiTraceProjection.segments`。
- `TraceCollector` 构造参数从单个 `payloadOmittedReason` 改为 `extras: Omit<PiTraceProjection, "context">`，把三个投影附加事实一起收进来。

## 关键发现与决策

**`applyCompaction` 按引用保留 `entry.message`（`session-repo.ts:867`），对象标识在压缩后依然成立。** 这让归因可以用对象标识旁表实现，**完全不用改 `reduce()` 也不用改 `applyCompaction`**——原本预计要改这两处并给它们加平行数组，那会是侵入性大得多的改动。压缩合成的 summary 消息不在旁表里，自然落入 `conversation`，语义正确。

**归因必须在 prepareRun 重读 snapshot 之前算。** `prepareRunSnapshot` 在组装完 `messages` 之后会重新 `readSession` + `reduce`，若在那之后算，描述的就不是实际发出去的那份数组了。已加注释锁定。

**trace 关闭时零开销**：`buildTraceSegments` 会遍历全部消息，因此在 `streamAssistant` 里以 `input.trace.settings.enabled` 短路。

## 偏离计划之处

- **`promptSource` 从 `readonly string[]` 改成 `{zone, labels?}`。** 原设计（README 里 F2 的处置）只存标签数组，实施时发现无法区分「HistorySet 前缀」与「历史里沉淀的旧 AppendingSet 提醒」——两者都带标签，会让 HistorySet 桶随对话轮次不断虚增。加 zone 后归因才正确。README 已同步。
- **`PiTraceSegment` 去掉了 `chars` 字段。** 原设计有 `chars`，实施时发现给消息算 chars 要么重复 pi 的字符统计逻辑，要么用 JSON 长度（被序列化开销污染），会引入第二套口径。token 才是要展示的量，chars 是可有可无的装饰，删掉更干净。
- **新增 `vitest.config.ts` 的 `server/**/*.test.tsx`。** Profile DSL 是 JSX，端到端归因测试必须用真实 DSL 才算数，而 `.ts` 文件里的 JSX 会被 oxc 直接解析失败。这是配置层的必要增量，不是绕道。

## 验证

| 项 | 结果 |
| --- | --- |
| `bun run typecheck` | 26 errors / 26 在 `llmlint.test.ts`（Task 118 记录的既有基线），**零新增** |
| `trace-segments.test.ts`（新，9 用例） | 全绿。覆盖空 system/tools 省略、多段同 kind、超前缀落 conversation、chars/4 口径、指纹随 schema 变化 |
| `prepare-run.test.ts`（+5 用例） | 全绿。覆盖 zone 分派、modelContextAppending 与 appending 的拼接顺序、匿名消息仍写 zone、旧 session 无 promptSource 不报错、ModelContext 插入位置 |
| `harness-trace-segments.test.tsx`（新，2 用例） | 全绿。**含关键回归**：第二轮从 JSONL 读回时 HistorySet 仍能按落盘的 promptSource 归因——这条如果不落盘就会退化成 conversation |
| `server/agent/{harness,observability,session}` 全量 | 42 passed / 2 failed 文件，6 用例失败 |

### 失败用例归属（逐条核实，非推断）

改动前后失败集完全一致，**零新增**：

- `neuro-agent-harness-payload.test.ts` ×2（followup / steer 入队校验）：**他人未提交的在途工作**。`neuro-agent-harness.ts` 相对 HEAD 有 2762 行差异，我的编辑只占约 15 行。用 `git show HEAD:` 只读对比确认：payload 校验路径被重构过（HEAD 2 处 `parsePayload`，当前 4 处，含新增的 `item.input === undefined ? {} : ...` 条件分支——正是「入队前校验」失效的直接原因）。测试文件本身未修改。
- `已删除的session模型不回退默认模型` / `create_agent 子 session ... effective 默认模型`：模型解析面，对应 `agent-visible-models.ts` 的未提交改动 + 未提交的 `agent-visible-models.test.ts`。Task 108 walkthrough 已记录过同类失败。
- `Plan Mode ... ProjectSession Service已经绑定到另一个Workspace Root`：测试间 ProjectSession Root 污染，Task 108 已记录。
- `abort clearQueue 会清空已持久化的 followUp queue projection`：**抖动**。同一测试单独跑第一次失败、第二次通过，与 Task 123 记录的「套件处于不稳定状态」一致。

> 注：本轮想用 `git stash` 做严格的 before/after 对照，但沙盒内 `git stash` 写 `.git` 被静默拒绝（无输出、exit 1）。改用只读的 `git show HEAD:` 对比 + 单文件隔离复跑取得同等证据。

## 后续批次的已知输入

- 面板消费 `record.request.segments` 做分区表，消费 `index.jsonl` 的 `usage` + `toolsHash` + `ts` 画缓存时间轴。
- 校准公式：`分区校准值 = 分区估算值 / 分区估算值之和 × provider 真实输入总量`。真实输入总量的构成**必须逐 provider 核对**（Anthropic 是 `input + cacheRead + cacheWrite`，OpenAI 的 `cached_tokens` 含在 `prompt_tokens` 内），这是 README 验收里点名的高风险项。
