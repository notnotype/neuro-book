---
schema: nbook.task/v2
taskId: t20-selection-menu-polish
status: planned
updated: 2026-11-10
---

# 选区菜单、注音与菜单动效的修正

## 目标与范围

开发者 2026-11-10 试用 t04、t05 之后提的问题：

1. 选区菜单的文字颜色、高亮没有默认色，要下拉；菜单有点简陋，可以扩充。
2. 注音的交互没做好。
3. 菜单打开的动效与动画曲线对照 UI 规范检查。
4. 拖选时注音也被选中，改格式后出现预期之外的结果（别的字也像有了注音）。
5. 源码编辑器的底色：开发者同意统一成 Markdown 稿纸的底色。

合同：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 6（选区菜单的内容）、9（注音与双语的输入）要改；注音当成整体的规则补进同一份 Spec；源码编辑器底色涉及 [`theme/system.md`](../../../../../docs/specs/theme/system.md) 与 `tokens.css` 里语法色那段注释。

## 调查结果（2026-11-10）

- **注音被拆成两份**：在真实浏览器里复现。注音是 Tiptap 的 mark（`nb-markdown` 的 `syntax/ruby`），渲染成 `<ruby>` 加不可编辑的 `<rt>`，优先级最低、在最里层。从注音中间开始拖选再加粗，注音被粗体切成两段，每段各渲染一个 `<rt>`，完整的注音显示两次，看起来像旁边的字也被注了音；存盘也写成两个 `<ruby>`（写出时注音总在最里层，见 `codec/render/inline.ts` 的 `ordered`）。拖选时 `<rt>` 也被画成选中、进了 DOM 选区的文字，复制走 ProseMirror 的序列化，不带注音。
- **注音输入**：点了“注音”后焦点进输入框，正文的选区不再高亮；输入框没有按钮；已有注音不预填；界面上没有移除注音的入口（`unsetMarkdownRuby` 没人调用，“清除格式”按 Spec 输出 8 不动注音）；选区里有注音时按钮不显示按下。
- **动效**：选区菜单与注音输入用 nb-ui 的 `AnchoredPopover`，斜杠菜单用 `SuggestionMenu`，两者都没挂共享的 `.nb-ui-popover-motion`，没有入场动画；右键菜单、块手柄菜单（`ContextMenu`）、色板（`Popover`）、工具栏下拉（`DropdownMenu`）符合设计语言“浮层入退场的编排是固定的”。
- **源码编辑器底色**：把 t05 的量色脚本改成在 `--bg-panel` 上量，八套配色的语法色对比度都达标，近色与原来相同；两套护眼配色的 `--bg-main` 与 `--bg-panel` 同值。

## 开发者的决定

（待第 1 轮评审）

## 当前状态

2026-11-10 第 1 轮静态稿评审板：[`artifacts/review/`](artifacts/review/index.html)，问颜色按钮（拆分按钮或合成下拉）、选区菜单加哪些项、注音怎么写与改。草稿在 t13 的草稿 worktree `.worktree/w00025-t13-drafts`（草稿目录 `drafts/web/components/selection-menu/`，Lab 组件 `SelectionMenuDraft`），不合并。

不用开发者定、直接修的（评审板最后一节）：拖选不再选中注音小字；注音当成整体，改格式时选区扩到整个注音；三个菜单补入场动效；源码编辑器底色改成 `--bg-panel`。

## 下一步

开发者看评审板期间，先写计划并实施“直接修”的四项；评审定了再把颜色、菜单项与注音卡片写进 Spec 与计划。
