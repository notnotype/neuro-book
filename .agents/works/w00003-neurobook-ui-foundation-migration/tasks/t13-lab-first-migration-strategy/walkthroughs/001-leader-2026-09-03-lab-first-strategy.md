---
schema: nbook.walkthrough/v1
taskId: t13-lab-first-migration-strategy
sequence: 1
role: leader
status: completed
createdAt: 2026-09-03T00:00:00Z
---

# t13 Lab-first 组件迁移路线

## 开发者决定

开发者决定暂缓 C 产品主题 clean cutover，先在 nb-ui 与 NeuroBook Component Lab 中重写和验证目标组件。开发者接受 `refactor/w00003-nb-ui-adoption` 在此期间主页功能、构建与 typecheck 暂时失败，但该接受不外推到 `master` 或最终交付。

## 固定路线

1. 单组件先达到 Lab-ready：同名文档、fixture、关键状态、键盘/焦点/ARIA、桌面与 `390 × 844` 验证闭合。
2. 先由开发者与 Agent 协作迁移一个真实组件，逐步记录宿主依赖、主题适配、验证和踩坑。
3. Leader 根据试迁移结果拆分后续自主迁移批次；不确定项写入各 Task，能从代码、规范或测试查明的事实不转交开发者。
4. 目标组件 Lab-ready 后再创建 C；C 使主页成为 nb-ui 主题合法宿主。
5. C 后接回主页消费者，恢复构建、typecheck、测试与真实产品 surface，删除旧实现和旧主题 authority。
6. 最后统一 Reviewer 审查；Lab smoke 不替代产品验收。

## 红分支边界

- 红色中间 revision 不得 push、提 PR、合并、发布、部署或声明 Work 完成。
- 不得损坏数据库、Project Workspace、Session、用户文件或其它产品数据。
- 全局失败必须记录引入批次、命令、路径、错误原文和恢复条件；单组件 Lab-ready 门禁不因全局红分支而放宽。
- 组件不得通过 `isLab`、路由或旧主题变量判断宿主；组件只消费 nb-ui 语义 token，宿主负责主题和数据。

## Spec 校正

对照 `component-index.ts` 与 `LabShell.vue` 后修正 `ui.component-lab`：

- 缺少同名 Markdown 或 `.vue` 的组件被直接跳过，当前没有缺失占位。
- `state:shared-read` 当前只产生 `needsSnapshot` 标记，没有快照 provider；在快照机制实现并验证前，不能把这类组件在 Lab 中挂载写成确定性验证通过。

`t12` walkthrough 已追加后续校正，不改写其历史检查结果。

## t09 延期

t09 的延期已从 Task README 移到独立 Leader walkthrough。当前 `LabShell.vue` 约 1242 行，仍未满足 `<800` 硬验收。新增 LabShell 职责、文件继续增长、C 开始或统一审查前仍未闭合，任一条件都会触发恢复 t09。

## 协作试迁移候选

选择 `AgentProfileNavList`：127 行，真实消费者为 `NovelIdeAgentProfileModelSettingsPanel`，以 props/emits 持有搜索、选中和列表状态，无 API、store、数据库或持久化。它能覆盖旧 `FormInput` 到 nb-ui、列表选中/默认/dirty/状态/空结果、键盘与窄屏，而不会把 World Engine 的工作台、草稿、API 和持久化同时引入首个样本。

## 未执行

本 Task 未修改任何应用或 nb-ui 源码，未启动 C，未迁移组件，未执行真实浏览器、测试、构建或 typecheck，未执行远端动作。
