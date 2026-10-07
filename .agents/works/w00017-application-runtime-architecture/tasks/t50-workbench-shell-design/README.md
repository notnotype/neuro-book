---
schema: nbook.task/v2
taskId: t50-workbench-shell-design
---

# NeuroBook v2 第 4 步（三）：工作台外壳的抽象设计

## 目标与范围

开发者 2026-10-06 在 [t49](../t49-commands-quick-open/README.md) 规划时要求：
- workbench 的抽象要先做好，参照 VS Code 的 Part、ActivityBar、Switcher、ViewContainer、View；
- 在实现外壳之前单独设计一轮，交开发者审批；
- 贡献点按真实消费者逐个加，不一次做全。

本 Task 只做设计稿，不改产品代码：
- 设计稿：[工作台外壳的抽象（v2）](../../../../../docs/proposals/workbench-shell-abstractions.md)。
- 行为合同 [`ui.workbench-shell`](../../../../../docs/specs/ui/workbench-shell.md)、[`ui.nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 本 Task 不改；设计稿接受后按其“对 Spec 的预期改动”修订。
- 第 4 步原计划的“t50 外壳、拖放与布局”由设计稿的切片 t51–t53 承接。

依据：
- [Workbench 与 View Host](../../../../../docs/proposals/workbench-view-host.md)（`accepted`）；
- [平台设计 P7](../../../../../docs/proposals/extensible-application-platform.md#p7-浏览器宿主与第三方界面)；
- VS Code [调研 03](../../../../../docs/research/vscode/03-workbench-layout-views.md)；
- 旧外壳实现 `packages/neuro-book-legacy/app/{utils,components}/workbench/`（只读）。

## 当前状态

2026-10-06 设计稿起草完成，状态 `reviewing`。

开发者 2026-10-06 批准待定项 1–3：
1. 持久化先经 `LayoutStore` 端口存浏览器 `localStorage`，`nbook.storage` 就绪后换适配器；
2. 视图未指定容器时自成隐式容器；
3. 对旧设计的取舍表。

omp 只读审查（默认模型）11 条，主 Agent 逐条核实全部成立：6 条阻断（隐式容器身份、`LayoutStore` 端口过薄、与平台设计 P7 的实例释放冲突、尺寸记录划分与 `storage/persistence.md` 不符、面板命令的 `when` 无法登记、实现撤回与声明删除未区分），5 条建议。报告原文与核实见 [evidences/omp-review.txt](evidences/omp-review.txt)。

待定项 4（切片）由后续讨论改变：开发者 2026-10-07 决定先做 [多实例运行时拓扑](../../../../../docs/proposals/multi-instance-runtime-topology.md) 的 K1–K5，再做外壳实现。外壳状态改用插件状态 store，面板命令的可用条件读公开状态（第 7 条由此解决）；原定的 t51–t53 编号不再保留，外壳的三个切片在 K5 之后按当时的最大编号创建。

读过的材料与依据的事实：
- **新应用**：工作台插件、页面表、命令宿主。
- **nb-ui**：布局原语的导出（Grid、`GridRenderer`、sash、插入位求解、落点反馈）。
- **旧外壳**：分层与各模块头注释；统计约 2.1 万行（不含测试），其中约 7000 行是 Storage 会话、迁移与工作面接线，约 1300 行是已在 t49 迁走的命令部分。
- **旧产品目录**：三个默认容器，只有文件树一个真实视图。

## 下一步

- 按 omp 审查的 11 条修订设计稿：第 2、5、6 条按插件状态 store 与 `nbook.storage` 的分区归属重写持久化一节；第 7 条按公开状态重写；切片改为 K5 之后的三个外壳切片。
- 修订稿交开发者审批后改为 `accepted`，按“对 Spec 的预期改动”修订 `ui/workbench-shell.md`、`workbench/commands.md`。
