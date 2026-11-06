---
验证入口: EditorArea
标签: [state:local]
---

# MarkdownMenus

Markdown 控件的菜单层（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md)）：放选区菜单、斜杠菜单、块按钮、右键菜单与它们共用的输入弹层。`editor` 由控件给，重挂、换文档时控件按实例更新，这一层不持有跨组件的状态。

`state:local`：正在输入注音或双语。
