# 批次 D：上下文检查面板前端

> 状态：**已实施**（2026-07-27）。浏览器走查待用户。

## 交付

批次 A/B/C 的数据终于有了消费者。面板入口 = Agent composer 状态条上的 gauge 芯片，点开是一个非模态浮动窗口（`DialogWindow`，可与聊天并存），两个 Tab。

## 规划期查实的两件事（写在前面，因为它们改变了实施）

**1. 校准公式不需要按 provider 分支。** README 验收里点名「必须逐 provider 实测、混淆会让百分比错得离谱」的最高风险项，实测消解了：`input + cacheRead + cacheWrite` 在 pi 层已统一等于真实 prompt 总量。

- Anthropic：直接映射 `input_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`（`anthropic-messages.js:362-368`），`input_tokens` 本身不含缓存。
- OpenAI 兼容：`input = prompt_tokens - cacheRead - cacheWrite`（`openai-completions.js:906-917`），三者相加正好还原 `prompt_tokens`。

附带发现：`cacheWrite1h` 是 `cacheWrite` 的**子集**（Anthropic 的 `cache_creation` 是对 `cache_creation_input_tokens` 的拆分），不能再加一次。

**2. 时间轴深度不成问题。** `piTrace.maxRecords` 默认 100（`server/config/normalizer.ts:100`），够诊断用。README 遗留的 Q2 就此关闭，不做独立汇总文件。

## 实际改动

### D1 · 可枚举 code 与共享均摊

- `CONTEXT_DIAGNOSTIC_CODES` 常量元组，判别联合的 `code` 从它派生。TS 联合运行时不可枚举，而 i18n 完备性测试要遍历它。
- 加了一条**编译期对齐断言**：判别联合与常量元组必须互为子集，任一侧漏加当场报错。
- 均摊规则（分区内按条数、多来源再按来源数）抽成 `trace-segments.ts` 的 `aggregateSegmentLabels`，诊断引擎与端点共用，随 `labelBreakdown` 下发给前端。**前端不再实现第二遍**——这是本批次刻意守住的边界。

### D2 · legacy 归因回退

批次 A 之前建的 session，entry 没有 `promptSource`，原本会把整个前缀判成对话历史——**用户现有的所有项目会话都看不到分区**。

`buildPromptPrefixAttribution` 现在在「一条 promptSource 都没有」时按位置推断：首条真实 `message` 之前的连续 `custom_message` 判 historySet，之后的判 appending。依据是 `compilePrepareRunWritePlan` 只在 `context.messages.length === 0` 时写 HistorySet。

局限**必须披露、已经披露**：首轮的 AppendingSet 提醒和 HistorySet 写在同一批、同样排在首条用户消息之前，无标签分不开，会被并进 historySet。`PromptPrefixAttribution.mode` 记为 `legacy`，经 `PiTraceRequest.attribution` 落盘，面板顶部出现一行说明。

### D3 · 组合端点

`GET /api/agent/sessions/[sessionId]/context-inspection?traceId=`，走新增的 `harness.getSessionContextInspection()`。

只读、不触发 prepare、不写 session、不调 provider。装配沿用既有范式（`sessionContextUsage` 与 manual compact 的 config/model 解析路径）。

两个刻意的设计：

- **只返回聚合量，不返回消息正文。** 正文体积大且已有 `/api/agent/traces/[bucket]/[id]` 可按需拉。
- **事实解析失败退化成 null 而不是抛错。** 面板是诊断工具，配置本身有问题时更应该打得开——`contextWindowUnset` 本身就是一条诊断。

新增两个决策函数并各自单测：

- `resolveCompactionTriggerTokens`（放 `harness/compaction.ts`，与 `shouldCompactWithOptions` 同源）——判定顺序必须一致，否则面板显示的线和真实触发时机对不上。
- `resolveModelCacheRetention`（放 `observability/context-inspection.ts`）——**按 pi 适配器的实际行为判定，不按厂商名猜**：Anthropic/Bedrock 有显式断点（5 分钟 / 1 小时），OpenAI Responses 只在 long 档传 24h，其余一律返回 null = 自动前缀缓存。宁可少报控制权，也不能声称我们没有的控制权。

### D4 · 视图模型

`context-inspector-view-model.ts` 四个纯函数：`aggregateByKind`（同 kind 多段合并）、`calibrate`（比例分摊，构造上保证和守恒）、`cacheBar`（三段拆分）、`groupDiagnostics`（按 Tab 与 traceId 三分）。

`cacheBar` 有一条关键区分：usage 三项全 0 返回 `unreported` 而不是 0% 命中——**这两件事在诊断上完全不同**，混在一起会让用户以为缓存彻底失效。

### D5/D6 · 组件与入口

四个组件（Dialog 粘合层 + 组成 Tab + 缓存 Tab + 共用诊断列表），沿用 trace-viewer 的粘合层/纯展示拆分。gauge 芯片由 `div` 改 `button` 并新增 `open-context-inspector` emit，`AgentChatSurface` 持开关。

i18n 中英各 ~50 条。诊断文案严格按 D4：陈述观察与因果，无一条祈使句、无「建议」二字。例：`cacheExpired` → 「距上次请求 12 分钟，超过 5 分钟的保留期，前缀缓存已过期。」

**D10 落实**：面板没有导出 / 复制全部 / 分享入口，注释里写明了原因。

### D7 · 防回归门

`diagnostic-messages.test.ts` 断言 13 个 code 在 zh-CN / en-US 都有文案，且两个语言 key 集合一致。

**做了失败注入验证**：把 `cacheToolsChanged` 改名成 `cacheToolsChangedTYPO` 后，两条断言同时抓到（缺失列表非空 + key 集合不一致），确认这道门不是摆设。已还原。

## 偏离计划之处

- **诊断按 Tab 三分而不是两分。** 原计划 `groupDiagnostics` 只拆「面板级 / 逐请求」，实现时发现那样缓存 Tab 会混进 `fixedOverhead`、`dominantSource` 这类与缓存无关的观察，重点被淹没。改成 `composition / cachePanel / byTraceId` 三组。
- **新增 `resolveModelCacheRetention` 与 `resolveCompactionTriggerTokens` 两个具名函数**，计划里只说「端点装配时解析」。抽出来是因为两者都是有判断分支的决策逻辑，藏在方法体里没法单测。
- **`context-inspection.ts` 是计划外的新模块**，承载端点装配助手。原打算把这些塞进 harness，但 `neuro-agent-harness.ts` 已 7000+ 行且 Task 123 点名过，不该继续堆。
- **消息正文预览未实现。** 计划里写了「展开单条消息时按需 `getRecord` 并用 `normalizeTraceContext` 出预览」，本轮只做到分区 + 来源明细两级展开。原因：来源明细已经能回答「哪个文件占多少」这个主问题，正文预览需要额外的取数与截断策略，而现有 trace 查看器已经能看全文。**这是有意的裁剪，不是遗漏**——若浏览器走查时发现确实需要，再补。

## 验证

| 项 | 结果 |
| --- | --- |
| `bun run typecheck` | 26 errors / 26 在 `llmlint.test.ts` 既有基线，**零新增** |
| `server/agent/observability` + `context-inspector` | 13 文件 / 97 用例全绿 |
| `app/components/novel-ide/agent` + `app/utils` + `server/agent/observability` | 57 文件 / 336 用例全绿 |
| `server/agent/harness` 回归 | 20 通过 / 2 失败文件，6 用例失败——**与批次 A 记录的基线逐条一致，零新增** |
| i18n 门失败注入 | 通过（改名后两条断言同时抓到，已还原） |

本批次新增 27 个聚焦用例：view-model 11、i18n 门 7、端点集成 4（.tsx，真实跑 turn 后读回）、helpers 16 中的新增部分。

失败用例归属见[批次 A walkthrough](batch-a-server-foundation.md#失败用例归属逐条核实非推断)：5 个稳定失败均属他人未提交在途工作，`abort clearQueue` 是抖动。

## 待用户执行

- 浏览器走查（仓库约定不自动做浏览器验证）。
- **真实数据逐条核对**：跑一轮 Agent，打开面板，比对分区与 `.nbook/agent/traces/<sessionId>/<id>.json` 的 `request.segments`；校准值之和应等于 `usage.input + cacheRead + cacheWrite`。
- **降级路径**：关掉 `observability.piTrace.enabled` 后打开面板，应见明确空状态并指向该开关。
- **legacy 归因**：用一个批次 A 之前创建的旧 session 打开面板，应能看到分区并显示 legacy 说明行。

## 后续（本任务明确不做）

`cacheRetention` 暴露到模型设置、ModelContext 位置调整、把 System/tool schema 纳入 compaction 口径。等面板产出真实数据后再定「5 分钟 TTL」与「ModelContext 中间插入」孰为主因——现在面板已经能给出这个判据。
