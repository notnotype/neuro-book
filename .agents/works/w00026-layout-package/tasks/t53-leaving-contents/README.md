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

2026-11-22：[计划](plan.md)第 2 稿，实现在分支 `w00026/t53-leaving-contents`（worktree `.worktree/w00026-t53-leaving-contents`），还没合入。

- 先跑探针（[证据](evidences/probe.txt)），七条路径都有结果。探针里定下两件事：冻结插槽用 `withMemo`（直接返回上一次的 VNode，Vue 会克隆再修补）；不做“连子组件一起冻住”（宿主同步段里删数据时子组件的渲染任务已经排队，暂停拦不住）。
- 设计审查（Claude Sonnet，重要 4、建议 6，[证据](evidences/design-review.txt)）十条都成立，改进第 2 稿后实施，没有再审：面板头只冻带着留着的内容离开的叶；留着的内容按最终留着的叶过滤；只留活动的；加 Lab 场景与 e2e；不采纳“留 DOM 快照”（理由见计划的技术选型，记进[待确认清单](../../pending-confirmations.md)）。
- 提交：`3a09797b8`（实现、测试、Lab 场景与 e2e）、`a409cf801`（补一条 `decideMotion` 用例）、`534a11595`（文档）。原型 `45e0a7a50` 在前。
- 变异检查：从不留红 8 条（dom）加 1 条（纯函数）；去掉最终按叶过滤红 1 条；内容插槽不冻红 7 条。
- 验证：nb-layout `typecheck`、`test`（bun 412、vitest 288 之后又加 1 条）；应用 `typecheck`；`readme.test.ts`；`bun pm pack --dry-run` 核过夹具不进发布包；e2e 五个文件 116 条全过（新的 `lab-grid-leaving` 3 条、`lab-grid-swap`、`lab-grid-panels`、工作台 `editor-area`、`workbench-views`，负载约 5 到 10）。
- 实现审查（Claude Sonnet，不阻塞）进行中。

## 下一步

处理实现审查 → Spec 输出 155、156 去掉 planned → 合入。
