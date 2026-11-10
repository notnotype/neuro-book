---
schema: nbook.task/v2
taskId: t05-monaco-polish
status: active
updated: 2026-11-10
---

# Monaco 打磨：右键菜单与语法配色

## 目标与范围

- 右键菜单：关掉 Monaco 自己的菜单（在 shadow DOM 里，只能改颜色），换成应用的右键菜单（nb-ui `ContextMenu`），菜单项来自 Monaco 的动作，并给插件一个菜单位置。开发者 2026-10-15 同意。
- 语法配色：现在编辑器的背景、前景、行号、光标取自产品主题，语法着色仍是 Monaco 默认的 vs/vs-dark；把一套语法配色加进主题 token（[`theme/system.md`](../../../../../docs/specs/theme/system.md)），用户覆盖以后再做。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)。

实施计划：[plan.md](plan.md)。

## 当前状态

2026-11-10 实施完成，实现审查进行中（不阻塞）。执行位置：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`，未合入 master。

- **计划审查**：fable 子代理，17 条：阻断 2、重要 9、建议 6，全部成立，计划重写为第二稿。[报告](evidences/design-review-fable.txt)，[处理](evidences/design-review-disposition.txt)。
- **提交**（分支上）：`c919a0082` 语法着色的主题变量与 Monaco 主题；`4c611eaba` 右键菜单、菜单位置 `editor.code-context`、共用的读剪贴板、括号着色；`817dd6dfa` e2e，以及右击查找框时拦住 Monaco 那段处理（e2e 发现焦点被抢回正文）。
- **Spec**：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 64、65，场景 40–43；[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md) 的位置表；[`theme/system.md`](../../../../../docs/specs/theme/system.md) 的语法变量，都已标为实现。
- **验证**（[`evidences/verification.txt`](evidences/verification.txt)，量色见 [`evidences/palette.txt`](evidences/palette.txt)）：Bun、nb-ui、组件测试与 typecheck 全过；e2e 合入前清单 133 例 131 过，败的两例是开发模式 Lab 在负载 24–30 下 15 秒内起不来，在没有 t05 改动的提交上对照同样失败，判为环境，待负载降下来重跑。
- **未验证**：真实键盘的菜单键、Windows 与 macOS；Safari、Firefox 的剪贴板权限。语法色的截图报告还没做（要开发服务，负载高时延后）。
- 待开发者追认的决定在 [待确认清单](../../pending-confirmations.md)（t05 五行）。

## 下一步

处理实现审查的报告；负载降下来后重跑 Lab 两例，做语法色的截图报告；之后与 t04 一起合入 master。
