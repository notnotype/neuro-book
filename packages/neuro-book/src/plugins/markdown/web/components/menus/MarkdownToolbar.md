---
标签: [state:local, state:inject, env:global]
---

# MarkdownToolbar

Markdown 编辑器的固定工具栏（[`workbench/markdown-editing.md`](../../../../../../../../docs/specs/workbench/markdown-editing.md) 输出 1–5）：`MarkdownControl` 把它放在滚动容器之上，与版心同宽居中，没有底色，下面一条分隔线。

## 数据

```ts
type Props = {
    /** 自己这一组控件的编辑动作：按钮显示它的状态，不读公开键，拆分后互不带偏。 */
    editing: EditorEditing;
    /** 命令、文字与贡献项。 */
    menus: EditorMenus;
    readonly: boolean;
};
```

## 行为

- 按钮的内容照输出 1；点了经 `menus` 执行命令，按下不夺走正文的焦点。
- 放不下时从右往左收进“⋯”：按钮宽度是定值，`ResizeObserver` 量容器宽度后按算术决定留几个，不用隐藏的测量层。贡献的 `inline` 项在最后，最先被收。
- 只读时全部置灰，版面不变。

`state:local`：可放下的宽度、颜色弹层的开关。`state:inject`：图标按钮的翻译端口。`env:global`：`ResizeObserver`，卸载时断开。

## 不支持

键盘快捷键（在 Tiptap 里）；链接按钮在 `nbook.edit.link` 登记之前不出现。
