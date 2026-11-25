---
schema: nbook.task/v2
taskId: t59-collapse-semantics
status: planned
updated: 2026-11-25
---

# 收起与展开的语义统一（摩擦第 2 组）

## 目标与范围

统一展开回到哪并写在一处，setCollapsed 也通知 onApplied，策略加不能展开与刚性，useGridHost 补 setSize；IDE 示例的绕法随之删短（0.x 不兼容改动）

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 166 到 171（planned），输出 20、147 到 150、154、诊断 `no-room-to-collapse`、失败 5 `collapse-locked`、已知限制与不承诺的 planned 改动。计划见 [plan.md](plan.md)，探针与使用方清单在 [evidences/](evidences/)。

## 当前状态

2026-11-25 计划由规划子代理起草（先跑探针，在 t57、t58 合入之前的 master 上），主会话核对后定稿，Spec 编号顺延到 166 起；待确认按推荐做、记进[待确认清单](../../pending-confirmations.md)。等 t58 合入后开 worktree，开工前先读 t58 合入后的 `clone` 与快照代码。

## 下一步

t58 合入后分两段派 coder：片 1 到 4（内核），片 5、6（宿主、示例与文档）；之后 t56 到 t59 整段交 omp 一次。
