---
验证入口: EditorGroup
标签: [state:local]
---

# MarkdownTextPrompt

注音、双语要一段文字时的弹层（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 9）：一个输入框，打开时聚焦；回车确定（输入法组字时不算），空的回车与 Esc 都是取消，焦点离开时收起。没有说明文字，输入框的可访问名称是 `label`。

`state:local`：输入的文字，每次打开清空。
