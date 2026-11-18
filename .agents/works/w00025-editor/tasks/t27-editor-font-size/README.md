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

## 开工时要决定

- Markdown 正文设置的范围：字体、字号、行高各要不要；影响的是编辑器、阅读预览、还是对话里的 Markdown。
- Ctrl+滚轮改的是设置值（写进用户层、所有编辑器一起变，像 VS Code 的 `editor.mouseWheelZoom`），还是只改当前编辑器的临时字号。
- 是否在浏览器里也接管 Ctrl+滚轮（浏览器自己有页面缩放，接管会和它冲突，倾向只在桌面里接管，或者做成默认关的设置）。

合同：待补充（`workbench/markdown-editing`、编辑器设置相关 Spec，以及 desktop-shell 输出 26）。

## 当前状态

2026-11-18 经 nbdev 新建，尚未开工。

## 下一步

读 `editor/shared/settings.ts` 与 Markdown 正文的样式来源，列出开工时要决定的三点交开发者；再写 plan.md。
