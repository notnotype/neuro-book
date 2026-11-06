---
标签: [state:local, state:inject]
别名: ["消息编辑", "Message Editor"]
---

# AgentMessageEditor

用户消息就地变成的编辑器。回车发送，Shift+回车换行，Esc 取消；输入法组字时这些键不算。打开时聚焦，高度随内容长，最高占视图的 40%。这一版只改文字。

## 数据

`text`（原文）、`loading`（原文还在加载时只读）。事件 `submit`（文字）、`cancel`。

## 隐藏通道理由

- `state:local`：正在改的文字，发送前不进宿主。
- `state:inject`：翻译端口，同视图里的其它零件。
