---
标签: [state:inject]
别名: ["子会话行"]
---

# AgentSessionChildRows

会话面板里挂在父会话下的子会话，只给 [`AgentSessionPanel`](AgentSessionPanel.md) 用。每个子会话一行：图标（对齐父会话的标题）、名字、正在做什么（说明）、状态（运行中转圈、等你处理、已中断与出错的图标）；左边一条细线把这一组挂在父会话下。子会话自己还有子会话时，行尾有“N 个子代理”的开关，展开后再往里缩一层。

## 数据

属性 `nodes`（`nestSessions` 的子树）、`selectedId`、`expanded`（`Record<string, boolean>`，面板持有）、`label`（父会话的标题，组的读屏名称）、`listId`（组元素的 id，父会话行的开关用 `aria-controls` 指它）。事件 `select`（会话 id）、`toggle`（会话 id）。

## 隐藏通道理由

`state:inject`：翻译端口，由面板提供。
