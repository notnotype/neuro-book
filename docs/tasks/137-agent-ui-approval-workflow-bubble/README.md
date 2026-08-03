# Agent UI 优化：审批界面 + Workflow 气泡

> Active task directory format: `137-agent-ui-approval-workflow-bubble/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [AgentUserInputPrompt.vue](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/app/components/novel-ide/agent/AgentUserInputPrompt.vue) — 审批/用户输入提示面板
- [AgentWorkflowBubble.vue](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/app/components/novel-ide/agent/AgentWorkflowBubble.vue) — Workflow 气泡组件
- [workflow-bubble.ts](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/app/components/novel-ide/agent/workflow-bubble.ts) — Workflow 气泡状态归约逻辑
- [workflow-run-vm.ts](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/workflow/workflow-run-vm.ts) — 后端 Run VM 构建（LiveCardVm、PhaseVm、TimelineLaneVm 等）
- [WorkflowAgentCards.vue](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/app/components/workflow-preview/WorkflowAgentCards.vue) — 已有的 Agent 直播卡片组件
- [WorkflowTimeline.vue](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/app/components/workflow-preview/WorkflowTimeline.vue) — 已有的泳道时间线组件
- [WorkflowRunPanel.vue](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/app/components/workflow-preview/WorkflowRunPanel.vue) — 开发预览面板（所有可视化的参考实现）
- [agent-pending-resolution.ts](file:///c:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/app/components/novel-ide/agent/agent-pending-resolution.ts) — 待处理决议逻辑

## User Request / Topic

1. **审批界面不好看**。`request_user_input` 类型也不好看。"其他选项"的输入栏应该默认展示。
2. **Workflow 气泡（`run_workflow`）不直观**。运行参数看起来点不了，整体信息层级太平。需要展示 workflow 内各个 Agent 的消息。

## Goal

优化两个 Agent 交互界面的视觉质量和直观性：

### 问题一：审批/用户输入提示面板
- `showNoteInput` 始终展示输入区域
- 选项 radio 指示器放大（h-3 w-3 → h-4 w-4）+ 内环
- 选项卡片增加左侧 accent 色条选中态
- Header 进度数字改为 pill 样式

### 问题二：Workflow 气泡
- **新增 Agent 直播卡片**：消费 `matchingRunState.value?.live`（`LiveCardVm[]`），可复用 `WorkflowAgentCards.vue`
- **新增 Phase 步进条**：消费 `matchingRunState.value?.phases`（`PhaseVm[]`）
- **Mermaid 多图 Tab**：把单状态图升级为 4 种图的 tab 切换（状态图/Trace/序列图/关系图）
- **泳道时间线**：消费 `matchingRunState.value?.timeline`，可复用 `WorkflowTimeline.vue`
- **折叠样式统一**：运行参数 `<details>` → 按钮式折叠卡片

## Current State

计划已制定完毕，等待实施。

## ADR / Decisions / Discussion

1. **`showNoteInput` 修改安全性已确认**：`pendingResolutionItemComplete()` 独立于 `showNoteInput` 判断完成态，改动不影响现有测试。
2. **后端数据已就绪**：`WorkflowDemoRunState` 已提供 `live`、`phases`、`timeline`、`flowMermaid`、`traceMermaid`、`relationMermaid` 等全部数据，不需要后端改动。
3. **`WorkflowPreview.vue` 已有参考实现**：`WorkflowAgentCards.vue` 和 `WorkflowTimeline.vue` 已独立为组件，可直接在气泡中复用。
4. **Timeline 复杂度**：`WorkflowTimeline.vue` 是纯 CSS 版（非 Canvas），适合在气泡中使用。

## Verification / Test

- `agent-pending-resolution.test.ts` — 不受 `showNoteInput` 影响，无需修改
- `workflow-bubble.test.ts` — 只测试纯函数（状态归约等），不涉及模板，无需修改
- 手动浏览器验证：触发 `request_user_input`、审批流程、运行 workflow

## Implementation Walkthrough

-

## TODO / Follow-ups

-
