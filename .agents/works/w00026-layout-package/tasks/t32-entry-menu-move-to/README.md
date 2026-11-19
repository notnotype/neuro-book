---
schema: nbook.task/v2
taskId: t32-entry-menu-move-to
status: active
updated: 2026-11-19
---

# 入口右键菜单的“移到”另外两个区域

## 目标与范围

补 ui/workbench-layout 输出 44 里还标着 planned 的“移到”菜单项：侧栏入口“移到右栏”“移到底部面板”，右栏、底部面板的入口对应另外两个区域；底层 moveContainerTo 已有（拖入口已经能搬整个容器，输出 46），只差菜单项、文案与测试；做完去掉输出 44 的两处标记

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 44 的两处 planned，做完去掉标记；搬法沿用输出 46，不改。

## 当前状态

2026-11-19 写计划第 1 稿（[`plan.md`](plan.md)）。照现成的“重置”菜单项加两项、底层操作已有：按“按任务大小降级”不做设计审查，实现审查（Claude Sonnet）兜底。

## 下一步

建 worktree，按计划一片实施。
