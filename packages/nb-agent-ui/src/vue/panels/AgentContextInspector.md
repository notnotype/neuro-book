---
标签: [state:local, state:inject]
别名: ["上下文详情", "上下文检查器", "Context Inspector"]
---

# AgentContextInspector

上下文详情弹窗的内容，外框、开关与刷新在 `AgentConversationView`。行为合同见 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“上下文检查器”。

## 布局与交互

自上而下：下一次请求的组成（总量、窗口与压缩线、比例条、各块的 token 与占比，写明是估算）；缓存（本会话与最近一次的命中率、累计用量，服务商不报缓存时说明）；系统提示词、扩展的槽、诊断三块默认收起。系统提示词展开时才取。算不出时只留原因与缓存。

## 数据

`inspection`（`ContextInspectionView`）、`systemPrompt`（`SystemPromptView`，没取时为 null）、`usage`（`ctx.usage`）。事件 `load-system-prompt`。

## 隐藏通道理由

- `state:local`：系统提示词那一块开着没有。
- `state:inject`：翻译端口，同视图里的其它零件。
