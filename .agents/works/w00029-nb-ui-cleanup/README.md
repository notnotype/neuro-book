---
schema: nbook.work/v1
workId: w00029-nb-ui-cleanup
issueId: null
status: done
updated: 2026-11-04
---

# nb-ui 组件整理

## 目标

nb-ui 组件整理、消歧与规范化：删掉没用的组件，改掉名字不好、有歧义的，合并功能重复的，弹出列表的样式收成一套，nb-ui 的 Spec 与规范文档一并整理；做完再回到编辑器主线（w00025 t08）

## 收尾

已收尾：`cd085308b`（t02）、`dc2d2f09b`（t03）、`da0a5e168` 与 `5b7b3df9b`（t04）、`f51fe1a20`（t08）、`7fc24af03`（t05）；t06、t07 是快进合入，提交号见各自的 README。待清理：无，worktree 与分支都已删除。

t09 移到 [w00040](../w00040-list-row-equal-height/README.md)，继续搁置。目标里说的“做完再回到编辑器主线（w00025 t08）”开发者 2026-11-05 定现在接。

收尾后的小修 `21e359c3e`：`Button` 的加载图标改成与 `iconClass` 同尺寸。Lab 里实测（nbook、macos × 明暗 × 自由画布、手机画布），带图标的按钮进入加载前后宽度相同（nbook 108.09px，macos 102.64px），没有页面错误。没有图标的按钮加载时仍会变宽（nbook 86 到 108.09px），没有改。`.nb-ui-switch-*` 原定删除，核实后发现旧应用的三个设置页还在用，所以保留，只更正了设计语言里的说法。
