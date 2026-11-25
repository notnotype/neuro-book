---
schema: nbook.task/v2
taskId: t58-grid-structure-trial
status: planned
updated: 2026-11-25
---

# 结构操作能试做、树能复制（摩擦第 1 组）

## 目标与范围

nb-layout 加 grid.clone、结构操作的试做或 canSplit、在叶旁插入兄弟、同向拆分并入父分支、深度计法统一、restore 结果不易忽略；示例里的试拆代码随之删短（0.x 不兼容改动）

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 160 到 165（planned），失败 5、失败 7 的 `limit-exceeded` 与 `wrong-sizing`、`not-finite`，验收 7。计划见 [plan.md](plan.md)，探针在 [evidences/](evidences/)。

## 当前状态

2026-11-25 计划由规划子代理起草（先跑探针），主会话核对后定稿，待确认按推荐做、记进[待确认清单](../../pending-confirmations.md)；Spec 的 planned 条目已写在 master。等 t57 合入后开 worktree，编码派 coder 子代理。

## 下一步

t57 合入后按计划第 1 到 3 片实施；nb-layout 0.3.0 等 t59 合入再发。
