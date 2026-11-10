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

1. （2026-11-10，`review` v1 的 `q1-color`）文字颜色与高亮用拆分按钮：左半边一点就上色，用上次用过的颜色（第一次是红色文字、黄色高亮），图标下的色条是这个颜色；右半边的小箭头开色板。工具栏的两个颜色按钮一起改。
2. （同上，`q2-items`）选区菜单最前面加块类型下拉（与工具栏同一个：正文、标题 1–3）。末尾的“⋯”（上标、下标）不加。
3. （同上，`q3-ruby`）注音用一行卡片：贴在文字下方，外框与 t13 的批注卡片相同，注音直接写在卡片里、没有输入框的框；右边是确定，已有注音时多一个“移除注音”。共用部分照板上写的：选中的文字里有注音时菜单上的注音按钮按下；点它或点注音小字打开修改；写的时候原来的选区保持高亮；回车确定、Esc 取消。

## 当前状态

执行位置：`.worktree/w00025-t20-selection-menu-polish`，分支 `feat/w00025-t20-selection-menu-polish`。草稿在 t13 的草稿 worktree `.worktree/w00025-t13-drafts`（`drafts/web/components/selection-menu/`，Lab 组件 `SelectionMenuDraft`），不合并。

**第一段（[plan.md](plan.md)）已实施，未合入**：`e22401bfb` 注音当成整体（注音语法的 ProseMirror 插件，按加标记、去标记的步把只盖住一半的补到整段；设新注音改为放一个新的标记）与注音小字不可选；`e9e67dc0a` `AnchoredPopover` 淡入淡出、退场时停在原处，`SuggestionMenu` 只淡入（斜杠菜单关上时锚点与内容已被收走）；`5cf6164ea` 源码编辑器底色改成 `--bg-panel`。

- 验证：`whole-ruby.dom.test.ts` 11 例（修之前 9 例失败；改成在“这一步之前的文档”上认注音时 2 例失败，即两次变异检查）；nb-markdown 全部测试与类型检查、nb-ui 的弹层与静态扫描测试、两包与应用的类型检查都过。e2e `markdown-editing`、`editor-code-menu`、`markdown-input` 57 例：第一次两例失败，动效用例的断言把变量原文与计算值比（`.23` 与 `0.23`），改成比计算值后通过；`markdown-input` 的“按快捷键打出删除线”在负载 16 时丢了按键，单独重跑 3 次都过（与改动无关，t17 记的同一类偶发）。
- Spec（主工作区，未提交，合入时一起提交）：`markdown-editing.md` 加输出 26、验收 7 与实现合同；`theme/system.md` 写 Monaco 底色取 `--bg-panel`；待确认清单 t05 第 5 行写了改判结果。
- 实现审查（Sonnet）进行中：说明与报告在仓库外 `/tmp/nb-review-w00025/t20-impl1/`。

**第二段**：[plan-2.md](plan-2.md) 已写，等开发者确认。

## 下一步

处理第一段的实现审查；开发者确认第二段计划后实施；两段做完一起做四种主题组合的 UI 取证，再合入。
