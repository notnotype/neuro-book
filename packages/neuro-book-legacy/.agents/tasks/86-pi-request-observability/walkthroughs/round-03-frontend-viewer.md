# Round 03 — 前端查看器 + 设置开关 (P1)

2026-07-05。按「P1 Design」定稿实现。本轮新增约束（用户）：**pi 查看器将来要能分离成独立库**，实现按可分离分层执行。

> 并行说明：本轮与 round-02（链路走查修复，另一会话）同日并行。round-02 §4 观察到 `traceHealthCheck` 代码删除并记为「用户手动删除」——实际是本轮的审查修复（见下第 2 条），两个并行会话互把对方当外部改动。round-02 的 sidecar 接入使 `correlation.mode` 有了真实取值（`user`/`agent`/`sidecar:<passName>` 等），本轮查看器的 Overview Mode 行直接受益。

## 实现前审查发现（已修复）

1. **config observability 不在 DTO 链路（P0 遗留缺口，🔴）**：`redactGlobalConfig`（`config-service.ts:422`）逐字段组装 → editor snapshot 丢 `observability`；`saveGlobalConfig`（`:196`）只搬运白名单 section → 面板写不进去。若不修，面板永远显示默认值，且保存会把手写配置覆盖回默认。今天盘上数据不丢（`...current` + `normalizeGlobalConfig` 的 `...raw` + zod `.passthrough()` 三层透传），但设置面板必须先把 observability 提升为一等 section。
2. **`traceHealthCheck` 是死配置（🟠）**：health-check 已划出范围（Round 01），该开关无任何消费者。趁 DTO 未暴露直接删除（`server/config/types.ts` / `normalizer.ts`），避免设置链路出现永远无效的开关。`PiTraceKind` 的 `"health-check"` 字面量保留备用。
3. **分离库分层规则（🟢，用户新约束的落法）**：
   - 后端 `pi-trace-reader.ts` 零 NeuroBook 依赖：只吃 `node:fs` + recorder 的类型/布局；不碰 appLogger（读失败返回空态或 throw，由 route 转状态码）。route 薄文件承担 NeuroBook 粘合（`useAgentHarness().repo.rootWorkspace`）。
   - 前端 `AgentTraceList` / `AgentTraceDetail` / `trace-view-model.ts` 纯 props-in/events-out：不 import session store / API，只吃 trace DTO；`AgentTraceViewerDialog` 承担全部粘合（$fetch、session 标题 join、跳转转发）。
   - 将来抽库：recorder + reader + 类型 + List/Detail + view-model 整体搬走；`.nbook/agent/traces` 前缀与 recorder 的 appLogger 依赖到抽包时再参数化（现在不做，避免过度设计）。

## 已交付

### Config：observability 提升为一等 section

- `shared/dto/config.dto.ts`：新增 `ObservabilityConfigDtoSchema`（piTrace: enabled/maxRecords/capturePayload，全 partial），进 `GlobalConfigDtoSchema` 与 `GlobalConfigUpdateDtoSchema`。
- `server/config/config-service.ts`：`redactGlobalConfig` 带上 `observability`（无 secret 不需掩码）；`saveGlobalConfig` 增加 observability 搬运行。
- `server/config/types.ts` + `normalizer.ts`：删除 `traceHealthCheck`。
- `bun run generate:openapi` 已重跑（40 routes 更新）。

### 后端读侧

- `server/agent/observability/pi-trace-reader.ts`：`PiTraceReader`（listBuckets 按最新时间倒序 / listIndex 最新在前、坏行跳过 / readRecord 缺失返回 null）+ `isValidTraceBucket`（`^\d+$|^_system$`）/ `isValidTraceId`（`^\d+$`）白名单防路径穿越。
- `shared/dto/agent-trace.dto.ts`：镜像 recorder 类型的 wire 契约；route 返回值同时标注两侧类型，靠 typecheck 防漂移。
- 3 个 route：`GET /api/agent/traces`、`/[bucket]`、`/[bucket]/[id]`（参数校验 400；记录被 retention 清理返回 404）。

### 前端查看器

- `app/components/novel-ide/agent/trace-viewer/`：
  - `trace-view-model.ts`：invocation 连续分组、pi 规范化 context 形状探测（text/thinking/toolCall 块，探测不出降级 json 块）、格式化（formatMs/formatTokens/状态点配色）。
  - `AgentTraceList.vue`：分组列表，行显示 kind/model/status/#id/时间/turn/tokens/TTFT/耗时/stopReason。
  - `AgentTraceDetail.vue`：状态条（含错误红框、「打开会话」按钮）+ 六 tab（概览键值 / System / Messages / Tools 吃 context / Payload / 响应吃 JsonViewer）；payload 缺失显示「未捕获」提示（faux provider / capturePayload 关）。
  - `AgentTraceViewerDialog.vue`：Dialog xl 左列表右详情；bucket 下拉 join session 标题（`listSessions({includeArchived,includeSystem,limit:200})` best-effort）；当前会话无记录也补 0 条选项；刷新按钮；详情 404 走 notification。
- `app/composables/useAgentTraceApi.ts`。
- `AgentChatSurface.vue`：顶栏 Session Tree 旁新增「请求记录」按钮（`i-lucide-activity`）；`@open-session` → 既有 `selectSession()` 完成 trace→session 跳转。

### 设置开关

- `NovelIdeObservabilitySettingsPanel.vue`：enabled 开关 + 每会话保留条数（0..10000，0=不裁剪）+ 隐私提示（记录含完整 prompt，仅本地，不进日志包）；写回时保留手写的其它 piTrace 字段（如 capturePayload）。
- `NovelIdeSettingsDialog.vue`：新增 "observability" section（global scope），走标准 `SettingsSavePanelExpose` 保存链。
- i18n：`agent.chatSurface.traceViewerTitle`、`agent.traceViewer.*`、`settings.section.observability.*`、`settings.panels.observability.*`（zh-CN + en-US）。

## 验证

- `bunx vitest run server/agent/observability server/config server/agent/harness/compaction.test.ts` → **57 通过**（新增 `pi-trace-reader.test.ts` 4 个：空态 / 与 recorder 互通+倒序 / 路径穿越拒绝 / 坏行跳过）。
- `bun run typecheck` → **0 error**（含全部新前端文件；此前的 plot 既有红灯已由用户修复）。
- `bun run generate:openapi` → 40 routes updated, 0 failed。
- **前端手动验收未执行**（CLAUDE.md：不自动做浏览器验证）。验收清单见 README「P1 验证」：跑一次 agent → 顶栏打开查看器 → 分组/详情/双向跳转 → 设置页关开关后新请求不落盘。可以让我做浏览器验证。

## 绕道 / 出入

- 计划外新增两项（均为实现前审查发现，见上）：config observability DTO 链路修复、`traceHealthCheck` 删除。
- 其余按「P1 Design」定稿执行，无偏离；新 trace route 未配 OpenAPI meta（生成器只覆盖注册过的 DTO 映射，可后续按需补）。

## 下一步

- 前端手动验收（或让我浏览器验证）。
- P2（可选）：pi-ai 重跑重放。
- 抽独立库时机到来时：参数化 traces 前缀 + recorder logger 注入，recorder/reader/List/Detail/view-model 一起搬。
