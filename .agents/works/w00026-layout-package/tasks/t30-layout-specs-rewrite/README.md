---
schema: nbook.task/v2
taskId: t30-layout-specs-rewrite
status: active
updated: 2026-11-18
---

# 布局 Spec 的晋升与重写：workbench-layout 已实现条目晋升、nested-grid 编号拆条

## 目标与范围

从 t26 拆出：ui/workbench-layout 里已实现、有测试守着的 planned 条目晋升（含 t27、t28 的入口条与切换，补实现合同与证据）；ui/nested-grid 输出条目编号、长条拆成能各自对上测试的小条、组件 API 移到 NestedGrid.md，并改全部引用。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md)、[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md)。只改写法与成熟度标记，不改行为；发现 Spec 与代码不一致时按“核实后修正错误的一侧”，改行为的另建 Task。依据：t26 README 里开发者 2026-11-16 答第 3、4 件（晋升已实现、有测试守着的条目；nested-grid 编号、拆条、组件 API 移到 `NestedGrid.md`）；晋升不需要开发者批准（`docs/specs/README.md`“两种成熟度，一个文件”，开发者 2026-11-17 定）。

## 当前状态

2026-11-18 开工。先盘点：两份 Spec 里每一处 planned 有没有实现、有没有测试守着，nested-grid 的条目被哪些地方按小标题引用，Smoke 与证据行缺哪些 e2e（Claude Sonnet，`claude -p`，只读，报告在主工作区 `.local/agent/works/w00026-layout-package/tasks/t30-layout-specs-rewrite/reports/inventory.txt`）。盘点回来后写 `plan.md`，做设计审查，再动 Spec。

盘点回来（[`evidences/inventory.txt`](evidences/inventory.txt)）：workbench-layout 149 处标记，A（已实现、有测试）141，B（已实现、没找到测试）3，C（没做）1，N（不是功能条目）4；nested-grid 7 处，A 6，B 1。计划第 1 稿见 [`plan.md`](plan.md)。

## 下一步

计划的设计审查（Claude Sonnet），处理完再动 Spec。
