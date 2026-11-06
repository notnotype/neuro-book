---
验证入口: EditorGroup
标签: [state:local, env:global]
---

# MarkdownSelectionMenu

选区浮动菜单（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 6–9）：用 nb-ui 的 `AnchoredPopover` 贴在选区旁边，不抢焦点。

## 行为

- 显示条件见 Spec 输出 7；“选完了”由指针松开或按键松开决定，所以拖选中不出现。切标签恢复的选区不算刚选的。
- 不用 `@tiptap/extension-bubble-menu`：它默认拖选中就出现，松开鼠标又不产生事务；元素在配置时固定，遇到组件重挂会失效；还会多一套定位。
- 状态只由事件推进，不写 ProseMirror 插件视图（`MarkdownControl.md`）。

`state:local`：是否选完、是否按过 Esc、是否在组字、是否有焦点。`env:global`：`window` 上的 `pointerup`（在正文外松手也算），卸载时摘掉。

## 不支持

块类型（决定在工具栏、块菜单与斜杠菜单里）；链接按钮在 `nbook.edit.link` 登记之前不出现。
