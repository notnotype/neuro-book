---
schema: nbook.work/v1
workId: w00003-neurobook-ui-foundation-migration
issueId: i191
---

# NeuroBook UI Foundation Migration

把 NeuroBook 主应用 UI 底座迁移到 monorepo 内的 `@notnotype/nb-ui`，先固定当前消费边界、迁移切片与真实 UI 验收合同，再逐片删除主应用重复实现。

## 当前迁移路线

开发者于 2026-09-03 决定后续采用 **Lab-first replacement**，取代此前“每批组件立即接入主页”的执行顺序：

1. 新组件在 `packages/nb-ui` 或其领域 owner 中实现，只消费 nb-ui 语义 token；组件不得通过 `isLab`、路由或旧主题变量区分宿主。
2. 每个组件先在 NeuroBook Component Lab 完成同名文档、确定性 fixture、状态与关键交互、键盘/焦点/ARIA、桌面和 `390 × 844` 验证，达到 `Lab-ready`。
3. 第一个真实界面由开发者与 Agent 协作迁移，逐步记录边界识别、宿主依赖上移、主题适配、fixture、验证、失败与踩坑；该记录成为后续批次的输入，不预先假定所有组件步骤相同。参考实现：Agent Profile 设置页（t15），配方与坑表见 [t13 walkthrough 002](tasks/t13-lab-first-migration-strategy/walkthroughs/002-trial-migration-gold-standard.md)。
4. 协作试迁移闭合后，Leader 按实际依赖拆分可独立验收的 Agent 自主迁移批次。Agent 自行查明代码、规范和测试可回答的事实；无法消除的产品取舍与风险逐项记录并请求开发者决定。
5. 目标组件达到 Lab-ready 后，再创建 C 产品 `theme.system` clean cutover Task。C 让主页面成为 nb-ui 主题的合法宿主，但不以 Lab 主题状态代替产品配置、首帧和失败合同。
6. C 闭合后按消费者批次把主页接到新组件，恢复真实功能、构建、typecheck、测试和产品 surface 验收；全部消费者切换后删除旧组件与旧主题 authority。
7. 最后对当前 merge revision 集合统一审查。Lab smoke 不能代替主页面、桌面、窄屏和 Product 构建证据。

## Workbench 外壳接入（#192）

Workbench 与 View Host 提案 [`workbench-view-host.md`](../../../packages/neuro-book/docs/proposals/workbench-view-host.md)（#192）已于 2026-09-13 获批 `accepted`。阶段 1 的「外壳接入但保留现有槽位」已登记为 `planned` Spec [`docs/specs/ui/workbench-shell.md`](../../../docs/specs/ui/workbench-shell.md)（`capability: ui.workbench-shell`），实现 Task [`tasks/t20-workbench-shell-adoption`](tasks/t20-workbench-shell-adoption/README.md) 已创建、**尚未开工（pending）**。阶段 2–5 的消费者迁移与固定槽位删除不在该 Task 内，仍按 #191 与提案的删除门禁逐项推进。

## 红分支边界

- 允许出现的红色只限 NeuroBook 主应用仍未接入新组件的消费者路径：主页真实流程、主应用 Product build/typecheck 或由该未接线直接导致的主应用集成检查失败。每项必须记录命令、cwd、路径、错误原文、引入批次和恢复条件。
- `packages/nb-ui` 自身的 build、typecheck、测试与 E2E；NeuroBook Component Lab 的聚焦测试、Lab smoke；以及 Product 排除门禁必须保持绿色。它们失败时不得归因于“主页未接入”，当前批次不得宣称 Lab-ready，必须定位并修复或停止交付。
- 红色中间 revision 不得 push、提 PR、合并、发布、部署或声明 Work 完成。不得损坏数据库、Project Workspace、Session、用户文件或其它产品数据。
- 每个组件仍须独立达到 Lab-ready；主应用集成失败不能放宽组件、nb-ui、Lab 或 Product 排除门禁。t09 `LabShell.vue` 拆分继续延期；命中其 Leader walkthrough 的恢复触发条件时必须先恢复 t09。

## 下一阶段触发条件

- 当前只创建一个协作试迁移 Task；候选界面、开发者参与点和验收边界由该 Task 固定。
- 批量自主迁移 Task 只在试迁移闭合、步骤与不确定项已形成证据后创建。
- C 只在已批准的目标组件集合达到 Lab-ready 后创建；创建前仍须把同一个 `docs/specs/theme/system.md` 从当前旧系统的 `implemented` 原地改为目标合同的 `planned`。
