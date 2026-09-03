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
3. 第一个真实界面由开发者与 Agent 协作迁移，逐步记录边界识别、宿主依赖上移、主题适配、fixture、验证、失败与踩坑；该记录成为后续批次的输入，不预先假定所有组件步骤相同。
4. 协作试迁移闭合后，Leader 按实际依赖拆分可独立验收的 Agent 自主迁移批次。Agent 自行查明代码、规范和测试可回答的事实；无法消除的产品取舍与风险逐项记录并请求开发者决定。
5. 目标组件达到 Lab-ready 后，再创建 C 产品 `theme.system` clean cutover Task。C 让主页面成为 nb-ui 主题的合法宿主，但不以 Lab 主题状态代替产品配置、首帧和失败合同。
6. C 闭合后按消费者批次把主页接到新组件，恢复真实功能、构建、typecheck、测试和产品 surface 验收；全部消费者切换后删除旧组件与旧主题 authority。
7. 最后对当前 merge revision 集合统一审查。Lab smoke 不能代替主页面、桌面、窄屏和 Product 构建证据。

## 红分支边界

- 开发者接受 `refactor/w00003-nb-ui-adoption` 在 Lab-first 迁移期间出现主页功能不可用、构建失败和 typecheck 失败；该接受不外推到 `master`、其它 Work 或最终交付。
- 红色中间 revision 不得 push、提 PR、合并、发布、部署或声明 Work 完成。不得损坏数据库、Project Workspace、Session、用户文件或其它产品数据。
- 每个组件仍须独立达到 Lab-ready；全局失败必须记录引入批次、命令、路径、错误原文和恢复条件，不能只写“迁移中预期失败”。
- t09 `LabShell.vue` 拆分继续延期；命中其 Leader walkthrough 的恢复触发条件时必须先恢复 t09。

## 下一阶段触发条件

- 当前只创建一个协作试迁移 Task；候选界面、开发者参与点和验收边界由该 Task 固定。
- 批量自主迁移 Task 只在试迁移闭合、步骤与不确定项已形成证据后创建。
- C 只在已批准的目标组件集合达到 Lab-ready 后创建；创建前仍须把同一个 `docs/specs/theme/system.md` 从当前旧系统的 `implemented` 原地改为目标合同的 `planned`。
