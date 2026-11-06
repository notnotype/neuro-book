---
验证入口: EditorArea
标签: [state:local, env:global, env:portal, env:clipboard]
---

# MarkdownBlockGutter

块按钮与块菜单（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 的块模型、输出 14–19）：指针停在一块上，或光标在这一块时，左侧出现 `+` 与手柄。按钮传送到滚动容器里，随正文滚动；块的判断与操作在 `@notnotype/nb-markdown/editor`。

## 行为

- 按钮对着谁：菜单开着时是菜单的块，其次是指针下的块（`pointermove` 用 `posAtCoords` 算），再次是光标所在的块。正文变了或滚动了，指针下的块作废，回到光标所在的块；正文变了要重新量位置。选中内容时光标这一条不算，那是选区菜单的事。
- 不用 `@tiptap/extension-drag-handle`：它运行时 import 协作相关的包。拖动用浏览器的拖放，起拖门槛由浏览器定，落点线是 StarterKit 的 dropcursor；`dragend` 里要清 `view.dragging`，原因写在代码里。
- 菜单打开前先把选区放进这一块：菜单项的可用性与执行都按选区，和工具栏同一条路径。
- 按钮不进 Tab 顺序，键盘经快捷键与命令面板。只读文档不出现。

`state:local`：指针下的块、光标所在的块、位置、菜单开关。`env:global`：`ResizeObserver`，卸载时断开。`env:portal`：按钮传送到滚动容器。

## 不支持

用键盘走到按钮；跨列表移动列表项的按钮（拖动的落点按 ProseMirror 的结果）。
