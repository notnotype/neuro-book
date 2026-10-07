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

2026-10-07 开发者确认布局直接用 `nbook.storage`，不再经 `localStorage` 过渡。设计稿按 omp 审查 11 条修订完成（仍为 `reviewing`）：三类容器身份与典型情况表、标题回落顺序、移动保留实例并列入 P7 修订、生命周期矩阵、三种失败与加载代际、`ViewContext` 经 `context` 属性投递、三条布局记录按 Storage 归属表、持久化字段四部分状态与多窗口规则、公开状态键与面板命令的 `when.requires`、呈现模型输入输出与意图合成。修订时发现现行 `when` 只支持布尔键全部为真，面板条件改为由 store 派生的正向布尔键。

## 下一步

2026-10-07 开发者认可修订稿，设计稿改为 `accepted`。本 Task 的设计工作完成。

后续 Spec 修订随实现切片进行（避免先改出与实现脱节的合同）：
- `workbench/commands.md` 的公开状态键与面板命令 `when.requires` 随运行时拓扑 K5；
- `ui/workbench-shell.md` 按 v2 修订随外壳一；
- 平台设计 P7 的实例释放表述已在平台设计“状态”中注明以本稿为准，正文随外壳二修订。
