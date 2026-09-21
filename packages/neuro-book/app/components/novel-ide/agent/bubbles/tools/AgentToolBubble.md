---
标签: [state:local]
---

# AgentToolBubble

工具调用消息的外壳分发器。
根据工具注册表（`resolveToolRenderConfig`），决定是渲染专用气泡卡片（如文件编辑、写入、任务、工作流）还是回退到通用折叠节点 `AgentToolNode`，并在底部承载输出附件画廊 `AgentAttachmentGallery`。
纯受控展示分发零件。
