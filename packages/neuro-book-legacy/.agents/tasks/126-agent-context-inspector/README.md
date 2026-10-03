# Agent 上下文组成与缓存诊断面板

> Active task。状态：**四个批次全部实施完成，浏览器走查与真实数据核对待用户**（2026-07-26 建档，2026-07-27 实施）

## Relative documents refs

- `docs/tasks/86-pi-request-observability/README.md`：Pi 请求 trace 采集层，本任务的数据地基。
- `docs/tasks/102-agent-change-inbox-and-prompt-order/README.md`：Prompt 四分区顺序合同。
- `docs/tasks/04-tsx-profile-workbench/README.md`：Profile prepare 预览（分区预演能力的现有实现）。
- `reference/agent/`：Profile DSL 与 harness 合同。
- `PROJECT-STATUS.md`：仓库级状态同步。

## User Request / Topic

用户希望参照 Claude Code 的 `/context`，给 NeuroBook 加一个「查看上下文组成」的功能，但要处理两个 NeuroBook 特有的问题：

1. **动态上下文**。NeuroBook 的上下文不是单调追加的，有每轮重新生成、且不落盘的 `ModelContext` 分区。
2. **缓存状态可见**。用户需要能自己诊断「为什么 prompt cache 命中率这么低」。

讨论中追加的要求：

- **不做作者摘要层**。`AgentComposer.vue:613-638` 的状态条已经承担了粗略展示（gauge 芯片 + 累计 usage 芯片）。用户打开面板就是要**具体信息**。
- 面板要给出**诊断信息并带严重等级**，参照 Claude Code `/context` 的风格。
- **诊断以展示为主，不是规训**。语气是「观察 + 因果解释」，不是「你不该这么用」。

## Goal

交付一个**只读**的 Agent 上下文检查面板，让使用者能回答两个问题——「我的上下文由什么组成、各占多少」和「这一轮缓存为什么没命中」——验证面板显示的分区归因与 `.nbook/agent/traces/` 中该次请求的原始记录逐条对得上、缓存诊断结论与 trace 的 usage 字段和时间戳一致。

约束：不改动 harness 的 prompt 组装顺序、不改动 `cacheRetention` 默认值、不引入 tokenizer 依赖、不让新增采集进入 provider 调用的热路径。

边界：`server/agent/observability/`、`server/agent/harness/`、`server/agent/profiles/`（仅新增来源标签）、`app/components/novel-ide/agent/trace-viewer/`、`app/components/novel-ide/agent/AgentComposer.vue`（仅加入口）。

阻塞停止条件：若发现分区归因无法在不改动 prompt 组装合同的前提下做到准确，停止并报告——不要用前端启发式反推糊过去。

## Current State

### 已有的能力（本任务的地基，不重复造）

| 能力 | 位置 | 说明 |
| --- | --- | --- |
| Pi 请求 trace | `server/agent/observability/pi-request-recorder.ts` | 默认开启，落 `.nbook/agent/traces/<sessionId>/`，每次 provider 调用记录完整 `{systemPrompt, messages, tools}` |
| usage 含缓存字段 | `shared/dto/agent-trace.dto.ts:45-55` | `input / output / cacheRead / cacheWrite / cacheWrite1h / reasoning / totalTokens` |
| trace 查看器 | `app/components/novel-ide/agent/trace-viewer/` | 列表 + 详情 + 按 invocationId 分组，Header 入口 |
| prepare 预演 | `server/agent/profiles/profile-http-service.ts:115` | 已按 `history / modelContext / appending / stateWrites` 分区输出，已支持传真实 sessionId |
| 上下文用量 | `neuro-agent-harness.ts:7019` `sessionContextUsage()` | 喂给 composer gauge 芯片 |

### 上下文的真实组装方式

每次 provider 调用的消息数组（`prompt-order.ts:29`、`neuro-agent-harness.ts:1892`）：

```
[ HistorySet + 历史对话（落盘） ]
[ ModelContext（不落盘，每次 invocation 重新生成，插在中间） ]
[ AppendingSet（落盘，本轮 reminder） ]
[ 本轮用户输入 ]
```

以 `leader.default` 为例（`assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx:273-330`）：

- **System**：settings 派生（persona / 协作模式 / 熟悉度 / 提问策略），确定性，无时间戳。
- **HistorySet**：14 条一次性注入。其中 11 个 `Import` 的**原文合计 92,267 字符**（实测；AGENTS.md 9,526、`reference/plot/system.md` 16,880、`reference/world-engine/workflow.md` 16,591 为前三），另有 `AgentCatalog` / `SkillCatalog` / `WorkflowCatalog` 三个运行时生成文本。
- **ModelContext**：`SqlSchemaSummary`，每 invocation 重算且不落盘。
- **AppendingSet**：`WorkspaceFocusReminder` / `FileChangeNotice` / `ModeAvailabilityReminder` / `LinkedAgentsReminder` / `TaskReminder`（每 8 轮）/ `ModeReminder` / `MentionedSkillsReminder`。
- **Tools**：root 工具 schema。

### token 口径的真实情况（讨论中更正过一次）

`estimateStoredContextTokens`（`stored-message-presentation.ts:105`）转调 pi 的 `estimateContextTokens`。后者**优先锚定最后一条 assistant 消息的真实 usage**（`@earendil-works/pi-agent-core` `compaction.js:98-122`，`calculateContextTokens = totalTokens || input+output+cacheRead+cacheWrite`），只有该锚点之后的尾部消息才用 `chars/4` 估算（`compaction.js:147-177`）。

结论：composer 上那个数字**主体是真实值**，不是纯字符估算。纯估算只在首轮（尚无 assistant usage）和尾部增量生效。但注意：

- `chars/4` 对中文明显低估，影响首轮和尾部；
- 该口径**不含 System prompt 和 tool schema**，只统计 messages。

### 缓存机制的真实情况

pi 的 Anthropic 适配器只打 **3 个 cache 断点**：system prompt、最后一个 tool、最后一条 user message（`node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js:686 / 947 / 907`）。`cacheRetention` 默认解析为 `"short"`（5 分钟 ephemeral，同文件 `:15-33`）；业务链路不显式传该参数，只有模型连通性 smoke 显式传了 `"none"`（`server/utils/model-settings.ts:243`）。

OpenAI 兼容 provider 是自动前缀缓存，无 `cache_control`，部分第三方转发不回 `cached_tokens`。

### 已确认的两个缺陷（本任务顺手修）

**缺陷 1：命中率分母漏了 `cacheWrite`。**

```ts
// app/components/novel-ide/agent/AgentChatSurface.vue:679-685
// 同一份实现在 app/components/novel-ide/agent/AgentTextBubble.vue:278 重复了一遍
function formatCacheHitRate(usage: {input: number; cacheRead: number}): string {
    const promptTokens = usage.input + usage.cacheRead;   // 缺 cacheWrite
    ...
}
```

Anthropic 的 `input_tokens` 既不含 cacheRead 也不含 cacheWrite，三者相加才是本次 prompt 总量。分母漏项使显示值**系统性偏高**。

**缺陷 2：芯片上的命中率是 session 累计值**（`AgentChatSurface.vue:603-606` 读 `activeSummary.usage`）。首轮把 HistorySet 全量写入缓存、cacheRead 为 0，这笔永久压在分母里，后续每轮命中再好累计值也难回升。**累计命中率无法用于诊断**，必须换成 per-request 时间轴。

两个缺陷都属于「测量口径」而非「缓存优化」，在本任务范围内。

## ADR / Decisions / Discussion

以下已与用户拍板，勿重议：

- **D1 不做作者摘要层。** composer 状态条已承担粗略展示，面板定位为详情。入口 = 点击 `AgentComposer.vue:614` 的 gauge 芯片。
- **D2 归因粒度 = 分区级 + 已知来源名。** 六个分区（System / Tools / HistorySet / 对话历史 / ModelContext / AppendingSet / 本轮输入），HistorySet 与 AppendingSet 内按 `Import` path、Catalog 节点名、Reminder id 逐条列出。不做全节点级追溯。
- **D3 本任务只做可观测，不做缓存优化。** 不改 prompt 组装顺序、不暴露 `cacheRetention` 到设置页、不动 ModelContext 位置。这些等面板产出真实数据后另开任务。
- **D4 诊断以展示为主。** 语气是「观察 + 因果解释」的陈述句，不用祈使句、不劝阻用户的使用方式。绝大多数条目应为 info 级。
- **D5 分区 token 在 server 侧算完再下发。** 前端不能 import server 模块（`agent-trace.dto.ts:1-8` 明确：会把 `node:fs` 带进前端 bundle）。
- **D6 不引入真 tokenizer。** 分区 token 用「估算值按比例分摊 provider 返回的真实输入总量」做校准。
- **D7 面板用 `DialogWindow`**（非模态浮动、可拖动），与 Jobs 任务中心一致——使用者会一边看一边发消息。
- **D8 来源标签落盘。** `HistorySet` 只在首轮注入并落成 `custom_message`，第二轮从 session 读回时已无从判断哪条是 `AGENTS.md`。因此在写入时把来源名存进 entry。老 session 无此字段，显示「未标注」，不做数据迁移（符合仓库「快速开发期不兼容老数据」方针）。字段名见 F2。
- **D9 面板 = 上一次真实请求的快照，不是「当前 session 状态」。** 与 composer 芯片是两个不同时刻、不同口径的量，二者数值不应相等，UI 必须显式标注数据时刻。见 F1。
- **D10 面板不提供导出 / 复制全部 / 分享入口。** traces 刻意保留完整 prompt 正文并被排除在可分享日志包之外（`pi-request-recorder.ts` 头注释），面板继承同一隐私边界。见 F6。

### 待确认（均已关闭）

- **Q1 「预演下一轮」按钮** — **不做**。它回答的是「未来」而非「当前」，与主视图语义容易混淆。批次 D 改为「组成」Tab 支持切换历史请求（用户拍板），对比需求由此满足。
- **Q2 trace retention 上限截断时间轴** — **不成问题，关闭**。`piTrace.maxRecords` 默认 100（`server/config/normalizer.ts:100`），足够诊断，不引入独立汇总文件。
- **校准口径的 provider 差异**（原验收里的最高风险项）— **消解**。实测 pi 层已统一：Anthropic 直接映射三字段、OpenAI 兼容侧 `input = prompt_tokens - cacheRead - cacheWrite`，两边都使 `input + cacheRead + cacheWrite` 等于真实 prompt 总量，无需按 provider 分支。注意 `cacheWrite1h` 是 `cacheWrite` 的子集，不可重复相加。

## 设计

### 数据层

**1. trace 增补分区边界。** `PiTraceRequest` 加 `segments`：

```ts
type PiTraceSegment = {
    kind: "system" | "tools" | "historySet" | "conversation"
        | "modelContext" | "appending" | "currentInput";
    /** messages 数组下标区间 [start, end)；system / tools 不在 messages 里，为 null */
    range: {start: number; end: number} | null;
    /** 与区间内消息一一对应的来源名；无标签的条目为 null */
    labels?: (string | null)[];
    /** server 侧按 compaction 同口径算好；前端零计算 */
    estimatedTokens: number;
    chars: number;
};
```

下标 `assemblePersistedProfilePromptMessages`（`prompt-order.ts:29`）本来就在算，取出来即可，不引入额外遍历成本。

**2. index 增补（F3 强制）。** `PiTraceIndexEntry` 当前只有 `totalTokens`，缺少缓存拆分与工具集指纹，缓存时间轴无法只读 index 渲染。增补：

```ts
usage?: {input: number; output: number; cacheRead: number; cacheWrite: number};
/** tools 数组的稳定短 hash（8 字符），用于检测工具集变化导致的缓存失效 */
toolsHash?: string;
```

**3. 来源标签。** 给 `custom_message` entry 加 `promptSource?: {zone, labels?}`，由 DSL 渲染时收集（`Import` 知道 path、Catalog 是具名节点、`Reminder` 有 id），`compilePrepareRunWritePlan`（`prepare-run.ts`）写入时带上。

> 实施修正：原设计只存 `string[]`，实测无法区分「HistorySet 前缀」与「历史里沉淀的旧 AppendingSet 提醒」——两者都带标签，会让 HistorySet 桶随轮次虚增。加 `zone` 后归因才正确。

**4. 诊断计算。** 放 server 侧纯函数模块（与 recorder 一样零领域依赖），输入 = 该 session 的 trace index + 最近一条完整 trace + 模型配置 + 压缩设置，输出 = 诊断条目数组。

**5. 新端点。** 需要一个组合端点返回「最近一条完整 trace 的分区 + index 时间轴 + 模型窗口 + 压缩触发线 + 诊断条目」。压缩触发线来自 `resolveCompactionOptions`，recovery DTO 里没有（F4）。

### 诊断条目

三级严重度，对应仓库状态色语义（`info` = 说明 / `warning` = 需注意 / `danger` = 配置问题）。语气按 D4。

**组成类**

| 级别 | 条目 | 触发 | 文案方向 |
| --- | --- | --- | --- |
| info→warning | 固定开销占比 | System+Tools+HistorySet 占窗口 <30% / 30–50% / >50% | 「这部分每次请求都在，不随对话增长，它决定了对话可用空间的上限。」 |
| info | 单一来源突出 | 某来源 > 固定开销的 20% | 「`reference/plot/system.md` 占 HistorySet 的 17%。」 |
| info | 工具 schema 开销 | 恒显示 | 「15 个工具的 schema 占窗口 10%。」 |
| warning | 接近压缩线 | 已用 / 压缩触发线 > 80% | 「按最近几轮的平均增量，约 N 轮后触发自动压缩。」 |
| danger | 窗口未配置 | `contextWindowTokens` 为 null | 真配置问题，百分比无法计算。 |

**缓存类**

| 级别 | 条目 | 触发 | 文案方向 |
| --- | --- | --- | --- |
| warning | 间隔超过保留期 | 相邻请求间隔 > TTL | 「第 13 次请求距上次 12 分钟，超过 5 分钟保留期，前缀缓存已过期。」 |
| info | 压缩重建缓存 | 该轮前有 compaction | 「历史被重写，缓存从头建立。」 |
| warning | 工具集变化 | tools 数组 hash 变化 | 「工具清单由 15 个变为 12 个，工具断点之后的缓存全部失效。」 |
| info | 模型切换 | model 变化 | 陈述。 |
| info | 动态上下文固定损耗 | 恒显示 | 「每个新回合会重写约 N token 的动态上下文，这是当前组装顺序决定的。」——结构性事实，用户不可改，纯陈述。 |
| info | provider 未上报 | cacheRead/Write 恒为 0 且非 Anthropic | 「该 provider 未上报缓存指标，命中情况无法测量——不代表没有缓存。」 |
| info | 当前保留期 | 恒显示 | 「缓存保留期 5 分钟（默认值）。」 |

### 视图层

`DialogWindow`，两个 Tab。

**Tab 1 · 组成**：顶部堆叠条 + 分区表格（分区 / 条数 / token / 占比），HistorySet 与 AppendingSet 可展开到来源名逐条，每条可展开原文。表尾标注数据来源（哪次请求、真实输入总量、分摊方式）。

**Tab 2 · 缓存**：provider 能力条（断点策略 + 保留期）+ per-request 时间轴，每根柱拆 `cacheRead / cacheWrite / 未缓存 input`，柱下挂该轮的诊断条目。

## Review 轮次 1（2026-07-26，建档同轮自审）

设计稿完成后做了一次整体审查，9 条发现已全部回写到上面的 ADR / 设计 / 验收各节。

| 编号 | 级别 | 发现 | 处置 |
| --- | --- | --- | --- |
| F1 | 阻断 | 面板总数与 composer 芯片必然不等（时刻不同、口径不同：芯片锚定最后一条 assistant 真实 usage，面板是上次请求的逐分区估算）。原验收条「分区 token 之和等于总估算值」站不住。 | 立 D9；改写验收口径。 |
| F2 | 阻断 | 字段名 `origin` 在 session entry 里已有两义（`LeafSessionEntry.origin: "auto"\|"move"`、`MessageSessionEntry.origin: "prompt"\|"harness"`），再加第三义即复刻 Task 123 的「models 一词三义」。且一个 `<Message>` 可含多个 `Import`。 | 改名 `promptSource`，类型 `string[]`。 |
| F3 | 阻断 | `PiTraceIndexEntry` 无 cacheRead/cacheWrite/input 拆分、无 toolsHash，缓存时间轴需读 N 个完整 trace（含全量 prompt 正文），长 session 读放大严重。 | index 增补 `usage` 与 `toolsHash`，并入批次 A。 |
| F4 | 主要 | 「接近压缩线」诊断需要 `resolveCompactionOptions` 结果，recovery DTO 没有。 | 由新端点一并返回。 |
| F5 | 主要 | `piTrace.enabled` 关闭时面板全空，降级行为未定。（`capturePayload` 关闭**不**影响本面板：它只 gate provider 原生 payload，pi 规范化 context 照常记录，见 `traced-provider.ts:108`。） | 补空状态文案 + 指向设置页开关。 |
| F6 | 次要 | traces 刻意含完整 prompt 且被排除在可分享日志包外；面板加导出/分享按钮等于绕过该边界。 | 立 D10。 |
| F7 | 次要 | 加 `promptSource` 要动 session entry schema，牵连 `stored-message-codec` 与 session repo 测试，批次 A 实际改动面大于「server 地基」的描述。 | 批次 A 说明中补注。 |
| F8 | 次要 | `AgentTextBubble.vue:236` 已有 per-message 命中率（同分母 bug），批次 C 若只改两处会留下第三份。 | 批次 C 收敛为单一 shared util。 |
| F9 | 观察 | 「固定开销 >50% 报 warning」与 D4「不规训」有轻微张力。 | 保留——客观结构事实用陈述句表达（「固定开销占窗口 54%，对话可用空间 46%」），不写「建议精简」。文案交付时按此尺度把关。 |

## Verification / Test

- **归因正确性**：面板分区边界与 `.nbook/agent/traces/<sessionId>/<id>.json` 的 `request.context.messages` 逐条对齐。
- **token 口径自洽（按 F1 改写）**：分区**校准值**之和等于 provider 真实输入总量（构造上恒等）；分区**纯估算值**之和等于各条消息 `estimateTokens` 之和。**不要求**面板总数等于 composer 芯片的数字——二者是不同时刻、不同口径的量，UI 需显式标注数据时刻。
- **口径正确性**：修正后的命中率在 Anthropic 与 OpenAI 兼容两条链路上分别核对分母构成——Anthropic 是 `input + cacheRead + cacheWrite`，OpenAI 的 `cached_tokens` 包含在 `prompt_tokens` 内。**这两个口径混淆会让百分比错得离谱，必须逐 provider 实测，不能想当然。**
- **诊断触发**：为每个诊断条目构造聚焦单测（间隔超时、compaction、工具集变化、模型切换、provider 未上报）。
- **零热路径开销**：trace 关闭时不应产生任何新增计算。
- **降级状态**：`piTrace.enabled` 关闭时面板显示明确空状态并指向设置页开关，不是空白或报错（F5）。
- **老 session 兼容**：无 `promptSource` 字段的 session 打开面板不报错，显示「未标注」。
- 浏览器验收由用户执行。

## Implementation Walkthrough

分批计划（每批产出后可独立验证）：

- **批次 A（server 地基，改动面最大）✅ 已实施并验证（2026-07-27）** → [walkthrough](walkthroughs/batch-a-server-foundation.md)
  trace `segments` + index 的 `usage`/`toolsHash` 增补 + `promptSource` 标签 + 分区 token 计算。typecheck 零新增（26/26 全在既有 llmlint 基线），新增 16 个聚焦用例全绿，回归面失败集与改动前逐条一致。
  实际比预计轻：`applyCompaction` 按引用保留 `entry.message`，对象标识在压缩后成立，因此归因用旁表实现，**没有动 `reduce()` / `applyCompaction`**，F7 担心的 `stored-message-codec` 连带改动也未发生。
- **批次 B（诊断引擎）✅ 引擎已实施，组合端点延后** → [walkthrough](walkthroughs/batch-bc-diagnostics-and-metric.md)
  `server/agent/observability/context-diagnostics.ts`，13 个 code 的判别联合 + 20 用例。**组合端点本轮未做**：返回形状应由面板实际渲染需求决定，先定端点再写 UI 大概率返工，故与批次 D 合并。代价是引擎当前无消费者（有意的中间态）。
- **批次 C（口径修正）✅ 已实施** → 同上 walkthrough
  新增 `app/utils/prompt-cache.ts` 作为唯一口径源，分母补 `cacheWrite`，两处重复实现消除（F8），总量为 0 时显示「—」而非误导性的 0%。
- **批次 D（前端）✅ 已实施，浏览器走查待用户** → [walkthrough](walkthroughs/batch-d-frontend-panel.md)
  DialogWindow 面板两个 Tab + composer gauge 芯片入口 + 空状态（F5）+ 组合端点 `GET /api/agent/sessions/[id]/context-inspection`（含压缩触发线，F4）+ 中英文案各 ~50 条 + i18n 完备性门（做过失败注入验证）。顺带补了 legacy 归因回退，让批次 A 之前创建的旧 session 也能看到分区。

（各批实现报告写入本目录 `walkthroughs/`。）

## TODO / Follow-ups

- Q1「预演下一轮」按钮是否进第一版。
- Q2 缓存时间轴的历史深度受 trace retention 限制，是否需要独立汇总文件。
- **后续任务（本任务明确不做）**：`cacheRetention` 暴露到模型设置；ModelContext 位置调整；把 System prompt 与 tool schema 纳入 compaction 的 token 口径。这三项都等本面板产出真实数据后再定优先级——尤其是「5 分钟 TTL」与「ModelContext 中间插入」到底哪个才是命中率低的主因，现在拍脑袋改风险大于收益。
