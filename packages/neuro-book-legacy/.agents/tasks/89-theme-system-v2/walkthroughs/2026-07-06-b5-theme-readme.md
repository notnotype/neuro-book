# B5 Phase 1 规范文档

## 范围

- `app/utils/theme/README.md`

## 变更

- 全文重写主题变量规范为 v2.1，删除 v1 中已经废弃的 `--bg-active`、`--border-color-hover`、`--prompt-*`、`--agent-bg`、旧 editor 变量描述。
- 补齐 36 个变量的分组、用途、事实源、宿主类、fallback 规则。
- 固化核心 13 色与派生默认的边界：内置主题保存完整字面值，自定义主题可派生也可覆盖，消费端不得临时计算颜色。
- 固化状态语义映射：warning / success / danger / info / accent 按业务角色选择。
- 明确分类色板例外、阴影与选区规则、组件层变量登记规则、禁止事项与推荐写法。

## 验证

- 旧变量名扫描无输出：
  - `rg -- '--bg-active|--border-color-hover|--prompt-|--agent-bg|--editor-canvas-bg|--editor-preview-bg|--editor-shell-bg|--editor-head-bg|--editor-gutter-bg' app/utils/theme/README.md`
- `bun run typecheck` 未通过，失败不在 B5 文档范围：
  - agent Plan Mode / Agent Mode 契约不一致：`planModeActive` 不存在、`"plan"` 不在 command kind union、`AGENT_PLAN_MODE_STATE_KEY` 缺失、`enterPlanMode/exitPlanMode` 工具缺失。
  - `app/components/novel-ide/agent/trace-viewer/AgentTraceViewerDialog.vue(197,150)` 仍有列表选择事件类型不匹配：`TraceListEntry` 传给了 `string | null` 参数。
  - `server/agent/profiles/writer-profile-contract.test.ts` 仍缺 `customTopSystemPrompt`。
  - `server/low-code-form/index.ts(798,13)` 仍是 `LowCodeJsonValue | undefined` 赋给 `LowCodeJsonValue`。
- `bun run test` 未通过，失败不在 B5 文档范围：
  - 汇总：19 failed files，77 failed tests，2 unhandled errors。
  - 代表性失败：agent harness / profile compile / profile catalog / Plan Mode 相关用例、workspace-files hook timeout、sqlite-vec smoke、auth timeout、web_fetch timeout、plot API timeout、writer `customTopSystemPrompt.trim()`。

## 与计划出入

- B5 只改文档，不触碰主题运行时代码。
- 未做浏览器验证，遵守“浏览器验证先征求用户同意”的约束。
- 继续记录但不修复无关基线失败，避免把 agent/profile 修复混入主题系统批次。

## 下一步

- 进入 B6：新增 shared 主题变量 DTO，放宽 global config 的 `ui.theme`，接入 `ui.customThemes`，并更新服务端 normalizer / registry / bootstrap / deploy config-render。
