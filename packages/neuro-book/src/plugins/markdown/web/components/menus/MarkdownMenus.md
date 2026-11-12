---
验证入口: EditorGroup
标签: [state:local]
---

# MarkdownMenus

Markdown 控件的菜单层（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md)）：放选区菜单、斜杠菜单、块按钮、右键菜单与它们共用的注音、双语卡片（`MarkdownTextPrompt`）。`editor` 由控件给，重挂、换文档时控件按实例更新，这一层不持有跨组件的状态。

## 注音与双语的卡片（输出 9）

- 从选区菜单、工具栏的“⋯”或斜杠菜单打开。打开注音时选区里已有注音，就预填它的注音、多一个“移除注音”（执行 `ruby-remove`）；选区碰到几段读音不同的注音时不预填（确定会把整个选区写成一个读音）。双语没有移除。
- 卡片开着时正文的选区一直画成高亮（`@notnotype/nb-markdown/editor` 的 `holdSelection`），关上时撤掉。换文档时控件在存下编辑状态之前撤掉，换回来不会还亮着。
- 在可写的正文里点注音小字（不带修饰键）：选中这段注音、打开卡片修改；卡片开着时点另一段的小字，卡片留着，换成那一段、重新预填。
- 换文档、变只读时卡片关上。

## 批注（输出 28–35）

批注的浮层、“写”的状态与 Ctrl+Alt+M 由 `comments/MarkdownCommentLayer`（同目录 `comments/`）负责，这一层只做两件事：选区菜单的“批注”按钮与右键菜单的“添加批注”调它的 `beginAdd`；注音与双语卡片开着、右键菜单开着时告诉它“不弹”（`blocked`），批注在“写”时让选区菜单不显示（`suspended`）。

`state:local`：正在写注音还是双语、卡片的预填与有没有移除；批注是否在“写”、右键菜单是否开着。
