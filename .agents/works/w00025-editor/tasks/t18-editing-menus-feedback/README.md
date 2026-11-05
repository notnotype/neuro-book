---
schema: nbook.task/v2
taskId: t18-editing-menus-feedback
status: planned
updated: 2026-11-05
---

# 编辑菜单的体验修正：当前行的块按钮与工具栏的位置

## 目标与范围

开发者体验 t08 后的反馈（2026-11-05）：当前行的块按钮要显示出来；工具栏放在顶部感觉突兀。合同：[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md)。

## 开发者的决定

1. （2026-11-05）光标所在的块常显块按钮。
2. （2026-11-05，`r1-place`，会话里定）工具栏位置做成设置，三种都支持：通栏（缺省）、并入面包屑、底部浮条。“现在的样子”不留。“不显示”不算一种：视图菜单本来就能关。

## 当前状态

完成，已合入本地 master（`fe35f61fd`、`b3450fcfd`），没有 push。

验证：`markdown-editing.e2e.ts` 36 条连跑两轮 72 次全过；neuro-book `typecheck`、`test:bun` 通过，`test:vitest` 同一份代码跑过一次 427 条全过。之后另外几轮在负载 15 下（别的会话在跑检查）有 2 到 4 条 5 秒超时，每轮不全相同，单独把这 4 个文件放宽到 60 秒超时跑全过。合入前没有再跑 `test:affected`，也没有重跑现有的编辑器 e2e。

## 下一步

开发者体验。worktree 与分支已删。
