---
schema: nbook.task/v2
taskId: t27-editor-font-size
status: planned
updated: 2026-11-18
---

# 编辑器字号：Markdown 正文字体设置与 Ctrl+滚轮调字号

## 目标与范围

开发者 2026-11-18 提出：设置里只有代码编辑器有字体、字号、行高（editor.code.*），Markdown 正文没有；要给 Markdown 正文加同类设置，并让代码编辑器与 Markdown 编辑器都支持 Ctrl+滚轮调字号。未开工，开工时按当时的结果修订。

## 背景

- 现状（2026-11-18 从代码与 Spec 查得，未逐页点开确认）：设置里只有代码编辑器有字体、字号、行高（`editor.code.fontFamily`、`editor.code.fontSize`、`editor.code.lineHeight`，声明在 `packages/neuro-book/src/plugins/editor/shared/settings.ts`）；Markdown 正文没有对应设置；主题编辑器只能改字体栈、不能改字号。桌面版另有界面缩放（`nbook.desktop`，50% 到 200% 共 11 档），那是整个界面等比放大，不等于改字号。
- 开发者要的：Markdown 正文的字体、字号等设置也能改；代码编辑器与 Markdown 编辑器里按 Ctrl+滚轮调字号。
- 与桌面界面缩放的关系：[desktop-shell 输出 26](../../../../docs/specs/runtime/desktop-shell.md) 写了“页面自己处理了 Ctrl+滚轮的地方（图片查看器）不接管”。编辑器处理 Ctrl+滚轮后，桌面里在编辑器上按 Ctrl+滚轮改的是字号、不再是界面缩放；这条要写进输出 26 与场景 16（图片查看器之外再列编辑器），并想好光标在编辑器之外时仍是界面缩放。

- 参照 VS Code（开发者 2026-11-18 提到，凭记忆、开工时再查文档核对）：界面缩放 `window.zoomLevel` 与字号 `editor.fontSize`、`markdown.preview.fontSize` 是两套设置；`editor.mouseWheelZoom` 默认关，开了以后 Ctrl+滚轮在编辑器里改的是编辑器字号，界面缩放只走快捷键。

## 已定的决定（开发者 2026-11-18）

- Markdown 正文做字体、字号、行距三项，只管 Markdown 编辑器的纸面，对话里的 Markdown 不动。
- Ctrl+滚轮改的是设置值（防抖写进用户层，所有同类编辑器一起变）。
- 只在桌面里接管：桌面里编辑器上的 Ctrl+滚轮改字号、编辑器外不再用滚轮缩放界面（界面缩放只走键盘与命令面板）；浏览器里完全不接管。
- 顺带提出的“界面默认不可选中文字”拆成 w00046 t22。

合同：[`workbench.editor`](../../../../docs/specs/workbench/editor.md) 输出 32、52，[`runtime.desktop-shell`](../../../../docs/specs/runtime/desktop-shell.md) 输出 26 与场景 16（计划里写了要改的地方）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-18：开发者确认计划；设计审查第 1 轮（Sonnet 15 条，全部成立）已吸收，plan.md 改为 r2（见“设计审查”）；worktree `.worktree/w00025-t27-editor-font-size`，分支 `feat/w00025-t27-editor-font-size`，按切片实施中。

## 下一步

按计划的切片 1 到 4 实施；收口后做实现审查。
