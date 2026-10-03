# 批次 B（诊断引擎）与批次 C（命中率口径修正）

> 状态：**已实施并验证**（2026-07-27）。批次 B 的组合端点部分延后，理由见下。

## 批次 C：命中率口径修正

### 问题

`formatCacheHitRate` 的分母漏了 `cacheWrite`，且同一份实现在两个组件里各写了一遍：

```ts
// 修正前，AgentChatSurface.vue 与 AgentTextBubble.vue 各一份
const promptTokens = usage.input + usage.cacheRead;   // 缺 cacheWrite
return formatPercent(usage.cacheRead / promptTokens * 100);
```

Anthropic 的 `input_tokens` 既不含缓存读取也不含缓存写入，三者相加才是本次 prompt 总量。漏项让显示值**系统性偏高**——首轮把整个 HistorySet 写进缓存时最失真（真实命中 0%，旧口径也算 0%，但之后每一轮都被高估）。

### 改动

- 新增 `app/utils/prompt-cache.ts`：`promptCacheTotalTokens` / `promptCacheHitRate`，作为**唯一口径真相源**。
- `AgentChatSurface.vue`（会话累计芯片）与 `AgentTextBubble.vue`（单条消息标签）改为消费它，两份重复实现消除。
- 总量为 0 时返回 `null`，调用方显示「—」而不是误导性的 `0%`。
- 在 `formatCacheHitRate` 的注释里写明语义边界：**会话累计命中率不适合诊断**（首轮全量 cacheWrite 永久压分母），判断缓存健康度要看逐请求时间轴。

### 验证

`app/utils/prompt-cache.test.ts` 4 用例，含一条把旧口径的 88.9% 与新口径的 80% 并列断言的对照用例，防止有人「顺手改回去」。`app/utils` + `app/components/novel-ide/agent` 全量 24 文件 / 133 用例通过。

## 批次 B：诊断引擎

新增 `server/agent/observability/context-diagnostics.ts`，纯函数、无 IO。

### 输出形态

返回 `{code, severity, ...params}` 的**判别联合**，而不是拼好的中文串：

- 文案由前端按 i18n key 渲染，与仓库其余 UI 一致，中英双语不用改 server。
- 判别联合而非 `Record<string, unknown>`，前端渲染时每个 code 的参数类型可查（符合仓库类型覆盖要求）。

13 个 code，分两类：

**组成类**：`fixedOverhead`（System+Tools+HistorySet 占窗口比，>50% 升 warning）、`dominantSource`（占比最大的单一来源）、`toolSchemaCost`、`nearCompaction`（>80% 触发线，附剩余轮次估算）、`contextWindowUnset`（danger，真配置问题）、`dynamicContextRewrite`（每回合重写量）。

**缓存类**：`cacheRetention` / `cacheAutoPrefix`（provider 能力二选一）、`cacheNotReported`、`cacheExpired`（逐条，附间隔与保留期）、`cacheCompactionRebuild`、`cacheToolsChanged`、`cacheModelChanged`。

### 语气契约的代码化

D4「诊断是展示不是规训」不是靠自觉，而是落在结构里并用测试锁住：

- 13 个 code 中 10 个恒为 `info`；`warning` 只给「会实际影响下一步的状态」（接近压缩线、缓存已过期、工具集变了）；`danger` 只有 `contextWindowUnset` 这一个真配置错误。
- 有一条测试专门断言「固定开销未过半时保持 info」，用例名直接写着「诊断是展示不是规训」——避免后续有人顺手把阈值调低。
- `dynamicContextRewrite` 是用户改不了的结构性事实，恒 info、只陈述。

### 几个刻意的判断

- **`dominantSource` 按条数均摊、多标签再均分**。segment 只有总 token 没有逐条明细，直接把整段算给某个 label 会严重高估。均摊后总和守恒，不重复计数。
- **`estimateTurnsLeft` 样本不足时返回 `null`**，不硬编一个假数字。前端显示「暂无法估算」比显示一个编出来的轮次更诚实。
- **`cacheToolsChanged` 要求前后两条都有 `toolsHash`**。旧记录没有这个字段，缺失时不比对，避免把「本任务之前的记录」全部误报成工具变化。
- **`findPreviousTurn` 跳过 compaction / health-check**。这两类记录的 model 与工具集跟主 turn 不可比，拿它们当基准会持续误报换模型。

### 验证

`context-diagnostics.test.ts` 20 用例全绿，逐条覆盖每个 code 的触发与**不触发**边界（未接近压缩线不产出、间隔在保留期内不报过期、缺指纹不误报工具变化、跳过非 turn 记录）。

`server/agent/observability` 全套 9 文件 / 54 用例通过；`bun run typecheck` 26 errors 全在 `llmlint.test.ts` 既有基线，零新增。

## 偏离计划之处

**批次 B 计划里的「组合端点」本轮未做**，只交付了诊断引擎（纯逻辑）。

理由：端点的返回形状应该由面板的实际渲染需求决定。先定端点、再写 UI，大概率要返工一次；而诊断引擎是纯函数，形状不受 UI 影响，可以先行落地并锁死测试。端点连同批次 D 一起做更省。

代价是：**批次 B 的产物目前没有消费者**，`buildContextDiagnostics` 除测试外零调用。这是有意的中间态，不是遗漏——批次 D 会把它接上。

## 批次 D 的已知输入

- 调 `buildContextDiagnostics` 需要凑齐：最近一条 turn trace 的 `segments`、`index.jsonl` 时间轴、provider、`contextWindowTokens`、压缩触发线（`resolveCompactionOptions`，recovery DTO 里没有）、`cacheRetention`（从 provider requestOptions 解析，缺省 `short`/300s）。
- 13 个 code 各需一条 i18n 文案（zh-CN + en-US），语气按 D4：陈述句 + 因果，不用祈使句。
- 校准公式与 provider 口径核对仍是最高风险项，见 README 验收节。
