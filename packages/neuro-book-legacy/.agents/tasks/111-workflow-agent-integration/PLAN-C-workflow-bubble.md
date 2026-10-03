# PLAN-C：Workflow 展示气泡（前端模块，子任务 agent）

目标：agent 聊天流中，`run_workflow` 工具调用渲染为一个功能强大的 workflow 气泡：审批阶段看清要跑什么，运行阶段实时看状态图长出来，完成后留终态图与元数据。

依赖：A 模块的 details DTO 与 `GET /api/agent/workflow/runs/:id` 定形后开工。

## C1. 注册

- `app/components/novel-ide/agent/tool-render-registry.ts` 注册：
  ```ts
  run_workflow: {mode: "block", typeLabel: "Workflow", component: markRaw(AgentWorkflowBubble)}
  ```
- 新组件 `app/components/novel-ide/agent/AgentWorkflowBubble.vue`。参考 `AgentApplyPatchBubble` 等 block 气泡的宿主契约（props 从 `agent-message.ts` 的 AgentToolCall 取）。

## C2. 气泡三阶段

1. **待审批**：显示 workflowKey + description（或内联 script 折叠代码块）、args 摘要、目标模型；审批按钮走既有审批流（勿另造）。
2. **运行中**：主视图 = `wf.chart` 状态图（mermaid），复用/下沉 `app/components/workflow-preview/` 的渲染件（`WorkflowMermaid.vue`、`render-mermaid.ts` 移入通用位置或直接引用）；辅以 runningNow 脉冲行（谁在干活 + 耗时）。数据源：
   - 首选 details partial（A 的 onUpdate 推流，随消息 SSE 走）；
   - 气泡挂载且 run 未完时轮询 `GET /api/agent/workflow/runs/:id` 拉全量 RunVm（500ms 运行 / 停止即停，参考 WorkflowRunPanel 的节奏）。
3. **完成**：details.chartMermaid 终态图（静态，不再轮询）+ 元数据摘要行：状态、创建的 session（可点开 session？V1 只展示 profileKey+title+tokens）、总 token 用量、result 摘要（JSON 折叠）。

## C3. 体验细节

- 状态图区域可折叠；默认运行中展开、完成后折叠留摘要。
- mermaid 渲染失败兜底为代码块（demo 页已有该兜底，照搬）。
- 颜色走主题变量；运行中=info、完成=success、失败=danger 状态语义。
- 大小控制：气泡内图高度上限 + 滚动，不撑爆聊天流（F6：VM 是扁平结构，shallowRef 安全）。
- 用户主动触发入口（非 agent 发起）：V1 最小做法是在 workflow.preview 页切换到正式 API；聊天内「/workflow 运行」入口记 TODO 不做。

## 验证

- `bun run typecheck`；组件逻辑简单不强制测试。
- 浏览器验收留用户（可建议 playwright 走查）。
