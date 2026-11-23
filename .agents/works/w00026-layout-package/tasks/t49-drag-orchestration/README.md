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

2026-11-23：第 1 稿两份设计审查（细节 Sonnet 阻断 1、重要 7、建议 4；整体 Opus 阻断 1、重要 7、建议 2，证据在 `evidences/`）都成立，改成[第 2 稿](plan.md)：落点只是落点、`offer` 与被拒绝留在宿主；会话只加通用的 `sampled`；公开名字只从 `./vue` 出；加 Lab 场景 `live-panels` 作收起与粘住的第二个形状；进 `[Unreleased]`，0.1.0 没发时合入前停下问。改前基线：三份工作台拖动 e2e 68 条全过。

2026-11-23：第 2 轮（细节：重要 5、建议 6；整体：重要 4、建议 4；都没有阻断）都成立，改成[第 3 稿](plan.md)：接线进库（`createLiveDragSession`、`useLiveDragSession`），“指针不动不重判”进引擎（`unmoved`），拿起的内容由 `NestedGrid` 自己留住，引擎规则逐条写全。

2026-11-23：第 3 轮（细节：重要 4、建议 3；整体：重要 4、建议 1；都没有阻断）都成立，改成[第 4 稿](plan.md)：合成的四条先后写死、来源类型分开（`live` 返回 `L`）、`grid` 必填、`unmoved` 的清除规则、`resolve` 的 Spec 措辞、nb-story 三处。三轮的重要条数 14、9、8，多半是上一稿的改法带出来的，都过得了类型检查。同一对象审满三轮，**停下等开发者**：A 按第 4 稿开工、不再审第 4 轮，切片 2、3 落地各派一次后台实现审查（推荐）；B 拆成两个 Task，t49 只做引擎、合成、`NestedGrid` 留住与工作台改用，Lab 场景与 nb-story 换边另起。

## 下一步

等开发者在 A、B 之间选；选之前不开工任何切片。
