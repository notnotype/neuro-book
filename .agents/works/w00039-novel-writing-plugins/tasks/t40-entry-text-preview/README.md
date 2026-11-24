---
schema: nbook.task/v2
taskId: t40-entry-text-preview
status: active
updated: 2026-11-24
---

# 条目主文字的分屏预览与源文字高亮

## 目标与范围

编辑条目主文字时能一边写源文字、一边看渲染后的结果（宽处左右分屏，窄处预览排在下面）；源文字的输入框按条目的写法着色（Markdown 的标题、列表、强调，花括号里的字段，Ref 与 Image 标签）。开发者 2026-11-24：“可以再做一个分屏编辑（试试预览）。然后是代码编辑可以用 Monaco 这个组件来实现，还有文本高亮”。

范围：内核只加一条只读的方法（把一段没提交的源文字当作条目的主文字渲染），不改写入与写法；预览只能看；富文本、换解析器照旧搁置（[t38](../t38-kernel-shared-parser/README.md)）。

合同（都是 planned）：[`canon/rendering.md`](../../../../../docs/specs/canon/rendering.md) 输出 16、[`canon/project.md`](../../../../../docs/specs/canon/project.md) 方法表的 `renderSource`、[`canon/author-ui.md`](../../../../../docs/specs/canon/author-ui.md) 输出 48 与验收 16 新加的一句。

## 当前状态

2026-11-24 新建。[实施计划](plan.md)第 1 稿写好、Spec 的 planned 条目补上。开发者要的是先用起来，计划没有先交确认；主会话自定的几处记在[待确认清单](../../pending-confirmations.md)（预览缺省开着；开关记在各自的标签上；窄处预览排在输入框下面；分屏时整页放宽）。

动手前查到的现状：编辑用的输入框已经是 Monaco，语言是 `markdown`，花括号与标签没有专门的颜色；Monaco 自带的 `mdx` 会把中文字段名画成红色下划线，不能直接用；预览只能由世界服务算（网页端在运行时不能引内核的渲染链）。

## 下一步

照计划的切片做：内核与合同（S1）、预览的读取（S2）、界面（S3）、语言（S4）、e2e 与实现审查、合入（S5）。
