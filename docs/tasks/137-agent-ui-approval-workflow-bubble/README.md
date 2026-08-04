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

GitHub Issue：#50（主需求）。跟进：#51（直播卡片展开完整对话）、#52（Mermaid 主题适配）。

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
- **抽共享组件 `WorkflowRunVisuals.vue`**：Phase 步进条 + 视图 tab + 各视图内容，气泡与 `WorkflowRunPanel.vue` 共用
- **新增 Agent 直播卡片**：消费 `matchingRunState.value?.live`（`LiveCardVm[]`），复用 `WorkflowAgentCards.vue`，作为共享组件的 `cards` tab
- **新增 Phase 步进条**：消费 `matchingRunState.value?.phases`（`PhaseVm[]`）；workflow 未声明 phases 时为空数组，不渲染
- **视图 tab 懒渲染**：tab 含状态机 / 对话流 / 时间线 / 直播卡片 / 关系图 / 执行图（Trace）；只渲染激活 tab（`v-if`），否则 500ms 轮询会每拍重渲染 4 张 Mermaid 图
- **空态策略**：`machineMermaid` 为 null（无 chart 事件）时保留 tab + 占位文案
- **折叠样式统一**：运行参数、执行元数据、Workflow 返回值三处 `<details>` 全部改为按钮式折叠卡片

## Current State

实施完成，本地验证通过，待 PR。

## ADR / Decisions / Discussion

1. **`showNoteInput` 修改安全性已确认**：`pendingResolutionItemComplete()` 独立于 `showNoteInput` 判断完成态，改动不影响现有测试。
2. **后端数据已就绪**：`WorkflowDemoRunState` 已提供 `live`、`phases`、`timeline`、`flowMermaid`、`traceMermaid`、`relationMermaid` 等全部数据，不需要后端改动。
3. **`WorkflowPreview.vue` 已有参考实现**：`WorkflowAgentCards.vue` 和 `WorkflowTimeline.vue` 已独立为组件，可直接在气泡中复用。
4. **Timeline 复杂度**：`WorkflowTimeline.vue` 是纯 CSS 版（非 Canvas），适合在气泡中使用。
5. **完整消息查看妥协（用户确认）**：直播卡片只展示最近一问一答摘要（`buildLive` 截断 40 字符），本轮不做完整对话查看；跟进 issue #51。
6. **Mermaid 深色硬编码接受现状（用户确认）**：`workflow-run-vm.ts` 的 hex 颜色与 `render-mermaid.ts` 的 `theme:"neutral"` 本轮不动，浅色主题下对比度问题跟进 issue #52。
7. **共享组件而非复制（用户确认）**：tab 切换 + Phase 步进条抽为 `WorkflowRunVisuals.vue` 供 RunPanel 与气泡共用，避免两份实现漂移；trace 从 RunPanel 的 `<details>` 升级为统一 tab。

## Verification / Test

- `agent-pending-resolution.test.ts` — 不受 `showNoteInput` 影响，无需修改
- `workflow-bubble.test.ts` — 只测试纯函数（状态归约等），不涉及模板，无需修改
- 手动浏览器验证：触发 `request_user_input`、审批流程、运行 workflow

## Implementation Walkthrough

分支 `feat/i50-t137-agent-bubble-visuals`（worktree `wt/agent-bubble-visuals`）。

变更文件：

- `app/components/novel-ide/agent/AgentUserInputPrompt.vue`：`showNoteInput` 常显；radio 指示器 h-4 w-4 + 选中内环（inset shadow）；选项卡片选中态加左侧 accent 色条 + accent 底色；header 两个进度数字改 pill。
- `app/components/workflow-preview/WorkflowRunVisuals.vue`（新建）：Phase 步进条 + 6 视图 tab（状态机/对话流/时间线/直播卡片/关系图/执行图），只渲染激活 tab；machine 图缺失时保留 tab + 占位。
- `app/components/workflow-preview/WorkflowRunPanel.vue`：删除自有 tab / 步进条 / trace `<details>`，左栏改用共享组件；logs、ask 卡、session 树、rerun 不变。
- `app/components/novel-ide/agent/AgentWorkflowBubble.vue`：wf.chart 块换成共享组件（`chartExpanded` 折叠语义保留，作用于整个可视化区）；运行参数 / 内联脚本 / 执行元数据 / 返回值四处 `<details>` 统一改按钮式折叠卡片。

与计划的出入：

1. 折叠统一范围除计划内 3 处外，顺带统一了「内联 workflow 脚本」（第 4 处 `<details>`），否则同一卡片内两种折叠样式并存。
2. 可视化区外层容器在未连上 run 但 details 带 `chartMermaid` 时仍展示（保留旧回退行为）；未连接且无任何图时的占位文案由「等待 workflow 发布首个 wf.chart 状态节点…」改为「正在连接 workflow run…」（机器图占位文案移入共享组件内部）。

自查修复（提交后 diff 复审发现，已补第二个提交）：

1. 气泡可视化区条件从 `v-if="matchingRunState"` 改为 `matchingRunState || effectiveChart`——run 不可查询（服务重启 404）时旧版仍展示 details 里的状态图，初版改丢了该回退。
2. `WorkflowRunVisuals` 的 showMachineTab watch 加 `immediate`——否则 defaultView=machine 且 tab 隐藏时无 tab 激活、内容落到末尾 else（trace）。
3. RunPanel 给共享组件加 `:key="runId"`——恢复旧版切换 run 时 tab 重置回默认视图的行为。

验证：

- `bunx vitest run agent-pending-resolution.test.ts workflow-bubble.test.ts`：19 passed。
- `bun run typecheck`：通过（0 error；worktree 首次需先 `nuxt prepare` + `bun run generate` 生成 tsconfig 与 prisma client）。
- 手动浏览器验证待用户确认后进行。

## TODO / Follow-ups

- 产品级跟进已开 issue：#51（直播卡片展开完整对话）、#52（Mermaid 主题适配）。
