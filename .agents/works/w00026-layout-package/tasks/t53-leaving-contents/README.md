---
schema: nbook.task/v2
taskId: t53-leaving-contents
status: active
updated: 2026-11-22
---

# nb-layout 离开的内容由库留到过渡结束

## 目标与范围

从 t51 拆出（开发者 2026-11-22 定的“离开的内容由库留住”）：内容项从 contents 去掉、它的叶这一轮在离开或降到零时，库重用最后一次的渲染留到过渡结束；由内容项显式开启，缺省照旧当即卸载；先解开“叶靠内容留、内容靠叶留”的互相依赖（t51 设计审查第 1 条阻断）。依据 t51 两份审查（design-review.txt 第 1、2、6、7、8 条，api-review.txt 第 2、3、11 条）。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 45 第 3 个条件改写，新增输出 155、156（planned）。

## 当前状态

2026-11-22：先跑探针（[证据](evidences/probe.txt)，原型在分支 `w00026/t53-leaving-contents` 的 `45e0a7a50`），七条路径都有结果；[计划](plan.md)第 1 稿，等设计审查。

探针里定下的两件事：冻结插槽用 `withMemo`（直接返回上一次的 VNode，Vue 会克隆再修补）；不做“连子组件一起冻住”（宿主同步段里删数据时子组件的渲染任务已经排队，暂停拦不住），改为合同里写明限制与推荐写法。

## 下一步

设计审查 → 实施（把原型补成正式实现）→ 实现审查。
