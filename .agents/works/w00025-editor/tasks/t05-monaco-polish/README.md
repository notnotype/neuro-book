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

2026-11-10 计划已写（开发者用 autonomous-delivery 指定 t04 之后做），正在做计划审查（fable 子代理）。未开工；执行位置同 t04：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`。

## 下一步

t04 的切片提交后，处理计划审查的结论，再按计划实施。
