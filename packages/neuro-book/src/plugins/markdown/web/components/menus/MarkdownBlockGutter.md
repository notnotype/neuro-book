---
验证入口: EditorArea
标签: [state:local, env:portal, env:clipboard]
---

# MarkdownBlockGutter

块按钮与块菜单（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 的块模型、输出 14–19）：指针停在一块上时左侧出现 `+` 与手柄。按钮传送到滚动容器里，随正文滚动；块的判断与操作在 `@notnotype/nb-markdown/editor`。

## 行为

- 位置由 `pointermove` 用 `posAtCoords` 算。正文变了或滚动了就收起，等下一次指针移动：指针没动时位置已经不对。
- 不用 `@tiptap/extension-drag-handle`：它运行时 import 协作相关的包。拖动用浏览器的拖放，起拖门槛由浏览器定，落点线是 StarterKit 的 dropcursor；`dragend` 里要清 `view.dragging`，原因写在代码里。
- 菜单打开前先把选区放进这一块：菜单项的可用性与执行都按选区，和工具栏同一条路径。
- 按钮不进 Tab 顺序，键盘经快捷键与命令面板。只读文档不出现。

`state:local`：当前块、位置、菜单开关。`env:portal`：按钮传送到滚动容器。

## 不支持

用键盘走到按钮；跨列表移动列表项的按钮（拖动的落点按 ProseMirror 的结果）。
