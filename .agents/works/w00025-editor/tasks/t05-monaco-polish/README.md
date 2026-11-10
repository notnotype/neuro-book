---
schema: nbook.task/v2
taskId: t05-monaco-polish
status: planned
updated: 2026-11-10
---

# Monaco 打磨：右键菜单与语法配色

## 目标与范围

- 右键菜单：关掉 Monaco 自己的菜单（在 shadow DOM 里，只能改颜色），换成应用的右键菜单（nb-ui `ContextMenu`），菜单项来自 Monaco 的动作，并给插件一个菜单位置。开发者 2026-10-15 同意。
- 语法配色：现在编辑器的背景、前景、行号、光标取自产品主题，语法着色仍是 Monaco 默认的 vs/vs-dark；把一套语法配色加进主题 token（[`theme/system.md`](../../../../../docs/specs/theme/system.md)），用户覆盖以后再做。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)。

实施计划：[plan.md](plan.md)。

## 当前状态

2026-11-10 计划已写并过了设计审查，未开工；执行位置同 t04：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`。

- **计划审查**（2026-11-10）：独立审查，一个 fable 子代理（开发者指定本会话不用 omp），在真实 Chrome 里对 Monaco 0.55.1 做了实验。17 条：阻断 2、重要 9、建议 6，全部成立，计划重写为第二稿。报告 [`evidences/design-review-fable.txt`](evidences/design-review-fable.txt)，逐条处理 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。两条阻断：`editor.addCommand` 的键位是整页单例、会在编辑器实例之间串；`document.execCommand("cut")` 在 Chrome 的 EditContext 输入下无效。第二稿改为在 DOM 事件与 `onKeyDown` 上打开菜单、每项执行 Monaco 的命令、主题用 `inherit: false` 自己写规则、语法色缺省重新推导并用脚本量过。
- 照推荐先做、等开发者追认的决定记在 [待确认清单](../../pending-confirmations.md)。

## 下一步

t04 收口后按计划第二稿的四个切片实施。
