---
schema: nbook.task/v2
taskId: t60-float-geometry
status: planned
updated: 2026-11-26
---

# 浮动窗的几何接口（摩擦第 3 组）

## 目标与范围

夹取认区域原点、缩放上限是边界、能取到叶此刻的矩形、整窗移动与松手时序有现成做法；桌面示例的自补几何随之删掉

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 101、103、105 的 planned 句子与新增的 172 到 177（planned）；t50 摩擦第 3 组 15 条，逐条处理见计划末尾。计划见 [plan.md](plan.md)，探针与使用方清单在 [evidences/](evidences/)。

## 当前状态

2026-11-26 计划由规划子代理起草（先跑探针），主会话核对定稿：15 条做 8 条、只写说明 2 条、不做 5 条（52 已解决）；Spec 的 planned 条目已提交；待确认 5 条按推荐做、记进[待确认清单](../../pending-confirmations.md)；与 w00043 t19 第 6 片的重叠已在 t19 的 README 留协调一行。

- 协调（2026-11-26，w00043 t19 的会话留）：t19 片 5 给 `NestedGrid` 加了可选属性 `gesturing`（宿主自己的尺寸手势进行中，并进“手势预览中不过渡”的判定；`vue.api.txt` 多一行，`NestedGrid.md` 与 Spec ui/nested-grid 输出 35 的 planned 句子），在 `feat/w00043-neurobot` 的 `9a3aec88a`，还没合入 master。t60 改同一处判定或 `NestedGrid` 的属性时，合入顺序在后的那边并一下；形状不合用请在 t19 的 README 留话。t19 第 6 片等 t60 合入后再做。

## 下一步

分两段派 coder：片 0 到 2、片 3 到 5；主会话每段验收，片 6 收口。
