---
schema: nbook.task/v2
taskId: t44-lab-and-component-folders
status: planned
updated: 2026-11-27
---

# Lab 与组件目录的整理（开发者 11-26 第 3 条）

## 目标与范围

canon 的组件按区域分子目录、Lab 左栏跟着目录分组；场景一个状态一个（ConfirmBar 砍到 4 个左右）；场景登记按插件拆开、放进各插件自己的目录；规则写进 Lab 的场景说明与组件规范。开发者 2026-11-26 在 t43 里同意，计划把它拆成单独的 Task，t43 之后做

合同：[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)（输入边界那一句：场景登记的位置）；产品界面的行为合同不变（组件只换目录）。规则改 [`fixtures/README.md`](../../../../../packages/neuro-book/src/plugins/lab/web/fixtures/README.md) 与 [组件规范](../../../../../docs/standards/code/components.md)。

## 当前状态

2026-11-26 经 nbdev 新建。2026-11-27 开发者定 t45 之后先做它；[plan.md](plan.md) 第 1 稿已写。开发者 2026-11-27 答“要开发者定的”三条，都按推荐：

1. 场景放各插件自己的 `web/lab/`（架构测试开一个口子，只许引 Lab 的 `scene-kit`）。
2. canon 的组件按计划的六组分子目录。
3. `ConfirmBar` 留 5 个场景；这次只精简 canon 的场景，别的插件以后改到哪个组件再照规则收。

## 下一步

开发者确认计划后做设计审查（前端，Sonnet），再按切片 S1 到 S5 实施。
