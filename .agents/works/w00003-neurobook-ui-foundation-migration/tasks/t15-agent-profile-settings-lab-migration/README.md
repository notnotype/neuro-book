---
schema: nbook.task/v2
taskId: t15-agent-profile-settings-lab-migration
role: tasker
---

# 协作试迁移 Agent Profile 设置页

## 目标

在 NeuroBook Component Lab 中交付完整可操作的 Agent Profile 设置页 `AgentProfileSettingsView`：常用设置优先的双栏工作区，包含默认设置页、Profile 详情、模型与运行策略、LowCodeForm 自定义设置、未保存状态、保存/放弃/恢复默认与加载/保存错误状态。允许重新设计组件与前端数据结构；正式页面可以保持不可用，不要求本次恢复主页或兼容旧界面。Lab 数据只作用于场景内存，不写真实配置、不删除 Home、不调用真实 Provider。

## 范围与边界

- 交付物：`app/components/novel-ide/settings/agent-profile/AgentProfileSettingsView.vue` + `.types.ts` + 同名 `.md`；原地重设计 `AgentProfileModelFields.vue`、`ProfileRuntimeSettingsFields.vue`、`AgentProfileDetailPanel.vue`、`AgentProfileDefaultsPanel.vue`；新增 `app/component-lab/fixtures/AgentProfileSettingsViewFixture.vue` 并在 `fixtures/index.ts` 登记 9 个场景。
- 计划正文：`local://profile-settings-lab-plan.md`（本 Task 的行为合同来源）。批准它的用户授权即为开发者决策记录。
- 不修改 `component-index.ts`、LabShell、shared DTO、后端 schema、LowCodeForm 渲染器本体；不新增 Profile 资产 CRUD、编译器、模型调用或真实持久化。
- Product gate 已知 incomplete：本次不生成 Product image evidence，不宣称 Work/Product gate 闭合。
- 保留用户未跟踪文件 `packages/neuro-book/eval-tmp.ts`。

## 开发者参与点

已确认（2026-09-08，本会话）：
1. 先在 Lab 做新版设计，正式页面暂不接线。
2. 常用设置优先：模型/推理强度/专属设置常驻，高级参数与运行策略折叠。

## 验证

1. 聚焦测试：`bun run --cwd packages/neuro-book test -- app/components/novel-ide/settings/agent-profile/AgentProfileNavList.test.ts app/components/novel-ide/settings/agent-profile/profile-runtime-settings.test.ts app/component-lab`
2. Lab smoke：`bun run --cwd packages/neuro-book smoke:component-lab -- --url http://127.0.0.1:3001 --browser-executable <chromium>`（Node + tsx）。
3. 真实 `/lab` 交互验证 9 组观察点（计划「验证」节）：编辑/保存/放弃/继承/错误态/场景隔离/键盘/明暗主题/无真实副作用。
4. `git diff --check`。
