---
schema: nbook.task/v2
taskId: t57-grid-diagnostics
status: planned
updated: 2026-11-25
---

# 网格诊断有出口：工作台接 issues、拖动会话的约定有开发检查（摩擦第 4 组）

## 目标与范围

工作台把 WorkbenchSurface 的 issues 接到应用的诊断出口（开发者 11-23 定）；nb-layout 补摩擦第 4 组：漏调 settleMotion、漏标 data-drag-feedback 的开发检查，没接 onIssues 时的缺省出口，拖动会话的时序与先后写进说明

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 158、159（planned）；[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 5、23；[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) “失败与恢复”的网格诊断一条与验收 34（planned）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-25 计划由规划子代理起草（先跑探针），主会话核对后定稿，四项待确认按推荐做、记进[待确认清单](../../pending-confirmations.md)；Spec 的 planned 条目已写在 master。编码派 coder 子代理，分支 `w00026/t57-diagnostics`。

## 下一步

按计划三片实施；e2e 先在起点跑基线。
