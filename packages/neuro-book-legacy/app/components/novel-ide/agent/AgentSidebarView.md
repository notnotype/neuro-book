---
标签: [state:local]
---

# AgentSidebarView

Agent 完整右侧边栏纯展示装配视图组件。

依次装配 Header 顶部栏、附件/关联 Agent/系统提示面板、ChatFlow 消息流、Workflow 待处理面板、工作区变更摘要面板、Composer 底部输入区，以及会话列表、会话分支树、上下文检查器等弹窗。

## 职责边界

- **纯受控视图**：不持有 Pinia store、HTTP fetch、localStorage 或计时器轮询逻辑，所有数据和异步意图通过 props 传入和 emits 上报。
- **宿主/Lab 共用**：真实宿主 `AgentChatSurface.vue` 与 Component Lab 挂载使用同一份模板与交互合同，保证视图渲染和行为在 Lab 中 100% 可重现。
- **分组 Contract**：按子组件职责划分 11 组受控 props（`header`、`flow`、`composer`、`attachments`、`linkedAgents`、`systemPrompt`、`workspaceChanges`、`workflowPending`、`sessions`、`sessionTree`、`contextInspector`），统一浮层控制状态。

## 对外方法 (Expose)

- `focusComposer()`: 聚焦输入框
- `scrollToBottom()`: 滚动对话流到底部
