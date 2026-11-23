---
schema: nbook.task/v2
taskId: t49-drag-orchestration
status: active
updated: 2026-11-23
---

# 手感编排进库

## 目标与范围

撕下来源、来源收起后按新布局重判、指针不动不重判、空位粘住等编排从应用提进 nb-layout（提案“手感引擎分两步”的第二步）；工作台与 nb-story 并排卡片两个宿主验证，先写接口草案交审查，先标 @experimental。

合同：[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 加实时布局的编排；[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 38 行为不变、通用部分改链接；nb-story [`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 68 的换边从落点指示改成实时让位（t45 定“实时让位等 t49”）。

## 当前状态

2026-11-23：[计划第 1 稿](plan.md)：引擎放 nb-layout 核心入口（纯 TS），会话接上它并负责唤醒，`useLiveDrag` 给 Vue 宿主；工作台改用它，nb-story 的拖详情换边作第二个宿主。worktree `.worktree/w00026-t49`（分支 `w00026/t49-drag-orchestration`），改前的基线在跑。

## 下一步

计划审查（细节 Claude Sonnet，从整体看 Claude Opus，阻塞），处理完按切片实施。
