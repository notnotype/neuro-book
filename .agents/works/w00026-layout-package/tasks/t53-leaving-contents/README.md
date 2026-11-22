---
schema: nbook.task/v2
taskId: t53-leaving-contents
status: done
updated: 2026-11-22
---

# nb-layout 离开的内容由库留到过渡结束

## 目标与范围

从 t51 拆出（开发者 2026-11-22 定的“离开的内容由库留住”）：内容项从 contents 去掉、它的叶这一轮在离开或降到零时，库重用最后一次的渲染留到过渡结束；由内容项显式开启，缺省照旧当即卸载；先解开“叶靠内容留、内容靠叶留”的互相依赖（t51 设计审查第 1 条阻断）。依据 t51 两份审查（design-review.txt 第 1、2、6、7、8 条，api-review.txt 第 2、3、11 条）。

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 45 第 3 个条件改写，新增输出 155、156（planned）。

## 当前状态

2026-11-22：完成，已合入 master（`e85dbbd11`）。

- 先跑探针（[证据](evidences/probe.txt)），七条路径都有结果：冻结插槽用 `withMemo`；不做“连子组件一起冻住”（宿主同步段里删数据时子组件的渲染任务已经排队，暂停拦不住）。
- [计划](plan.md)第 2 稿：设计审查（Claude Sonnet，重要 4、建议 6，[证据](evidences/design-review.txt)）十条都成立；不采纳“留 DOM 快照”（nb-story 人物卡里的画布小图与滚动区），记进[待确认清单](../../pending-confirmations.md)。
- 实现审查（Claude Sonnet，重要 2、建议 5，[证据](evidences/impl-review.txt)）：
  - 重要 1：一列整组离开、只有一块带着留着的内容时，同列别的叶的面板头没冻。改成有留着的内容时，留着缩回的离开的叶都冻（交换里滑出去的除外），Spec 输出 156 跟着改；补整列用例，变异（回到旧判据）红 1 条。
  - 重要 2：补容器尺寸变化提前卸载、F6、交换、`settle` 的用例。变异核出两处判断到不了，删掉：`useGridFocus` 排除留着的内容（它 `inert`，本来就不是落点），交换分支按带过滤（交换里滑出去的叶不会带着留着的内容）。`stop` 不清留着的内容红 4 条。
  - 建议：拖动那条按结果分支的断言写死；e2e 加“过渡到三分之一时叶与内容都在缩”；说明报错只对渲染错误、每次冻住只报一次；留着的内容不接指针；冻结判据读内容层去重之后的项（第 5 条）；第 7 条（Vue 内部行为）接受，文件头已写明。
- 提交：原型 `45e0a7a50`，实现 `3a09797b8`，补用例 `a409cf801`，文档 `534a11595`，审查处理 `eb676227f`、`6c27b666f`、`58fe76bee`；之后并入 master（`e85dbbd11`）。
- 验证：nb-layout `typecheck`、`test`（bun 412、vitest 294）；应用 `typecheck`（并入 master 之后再跑一次）；`readme.test.ts`；`bun pm pack --dry-run`；e2e 第一轮五个文件 116 条，审查处理之后 `lab-grid-leaving`（4 条）与 `lab-grid-swap` 共 9 条全过。

## 下一步

无。t45 第 5 稿采用 `leave: "retain"`。
