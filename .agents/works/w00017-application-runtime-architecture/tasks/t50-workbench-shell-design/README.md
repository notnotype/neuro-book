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

2026-10-06 设计稿起草完成，状态 `reviewing`，待开发者审批四个待定项：
1. 持久化后端；
2. 视图默认自成隐式容器；
3. 对旧设计的取舍；
4. 切片。

读过的材料与依据的事实：
- **新应用**：工作台插件、页面表、命令宿主。
- **nb-ui**：布局原语的导出（Grid、`GridRenderer`、sash、插入位求解、落点反馈）。
- **旧外壳**：分层与各模块头注释；统计约 2.1 万行（不含测试），其中约 7000 行是 Storage 会话、迁移与工作面接线，约 1300 行是已在 t49 迁走的命令部分。
- **旧产品目录**：三个默认容器，只有文件树一个真实视图。

## 下一步

开发者审批后：
- 设计稿改为 `accepted`；
- 按“对 Spec 的预期改动”修订 `ui.workbench-shell`、`workbench.commands`；
- 建 t51（外壳与布局）。
