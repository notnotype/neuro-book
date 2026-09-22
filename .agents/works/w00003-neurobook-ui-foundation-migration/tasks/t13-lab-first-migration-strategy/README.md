---
schema: nbook.task/v2
taskId: t13-lab-first-migration-strategy
---

# 固定 Lab-first 组件迁移路线

## 目标

依据开发者对 Issue #191 迁移方式的新决定，把 w00003 的后续路线调整为：先在 nb-ui 与 NeuroBook Component Lab 中完成新组件及其新主题合同，再通过一次开发者与 Agent 协作的真实界面试迁移沉淀步骤和陷阱，随后拆分批次由 Agent 自主迁移并记录不确定项；组件达到 Lab-ready 后再执行产品 `theme.system` clean cutover、接回主页消费者并统一审查。

本 Task 同时修正 `ui.component-lab` implemented Spec 与当前实现的两处失真，不实现任何组件，不启动 C，不创建整条未来 Task 链。

## 已批准决定

- 迁移分支采用 Lab-first replacement；新组件只依赖 nb-ui 语义 token，不在组件内部判断宿主是 Lab 还是主页。
- 主页旧实现不再作为每批新组件的可用性门禁。允许的红色只限 NeuroBook 主应用仍未接入新组件的消费者路径；该接受不外推到 `master` 或最终交付。
- `packages/nb-ui` 自身 build/typecheck、Lab focused tests/smoke 与 Product 排除门禁是每批必须保持绿色的硬门禁；其失败不得以主页未接入解释，也不得据此宣称组件 Lab-ready。
- 红色中间 revision 不得 push、提 PR、合并、发布或声明 Work 完成；每项主应用集成失败必须记录命令、cwd、路径、错误原文、引入批次和恢复条件；不得损坏数据库、Project Workspace、Session、用户文件或其它产品数据。
- 每个组件仍须单独满足文档、fixture、行为、键盘/焦点/ARIA、桌面与 `390 × 844` Lab 验证；单组件门禁不因主应用集成红色而放宽。
- C 暂缓，不取消。全部目标组件达到 Lab-ready 后，C 负责让产品主页成为 nb-ui 语义主题的合法宿主；随后按消费者批次接回主页并删除旧实现。
- t09 继续延期，不由本 Task 实现；延期状态和触发条件记录到 t09 的 Leader walkthrough。

## 允许改动

- 本 Task README 与 walkthrough。
- w00003 Work README：登记当前路线、红分支边界与继续条件。
- `docs/specs/ui/component-lab.md`：收窄缺失文档/实现与 `state:shared-read` 的当前行为，保持 `implemented` 只描述现状。
- t09 Leader walkthrough：记录延期决定、当前 `<800` 缺口和恢复触发条件；Task README 保持目标合同，不承担 canonical status。
- t12 walkthrough：追加后续校正，明确其“与实现一致”结论被本 Task 收窄的两处。

不修改应用或 nb-ui 源码，不修改 `theme.system`，不创建 C Task，不执行批量迁移，不执行远端动作。

## 后续路线

1. 完成本 Task，消除 Spec 失真并固定 Lab-first 门禁。
2. 根据当前依赖选择一个真实界面，创建唯一的协作试迁移 Task；Task 必须设置开发者参与点，逐步记录组件选择、文档、fixture、拆宿主依赖、新主题适配、验证和踩坑。
3. 试迁移闭合后，Leader依据实际步骤和不确定项拆分可独立验收的自主迁移批次，不预建结果未知的完整 Task 链。
4. Agent 执行批次时把无法由代码、规范或测试消除的不确定项写入各 Task walkthrough；产品取舍停止请求开发者，机械事实自行查明。
5. 目标组件达到 Lab-ready 后创建 C；C 完成产品主题宿主后，按消费者批次接回主页、恢复构建/typecheck/真实页面并删除旧实现。
6. 最后对当前 merge revision 集合做统一 Reviewer 审查；不能用 Lab smoke 代替真实产品 surface 验收。

## 验证

- `bun run docs:check`
- `bun run governance:check`
- `git diff --check`
- 逐条对照 `component-index.ts` 与 `LabShell.vue`，确认 Spec 不再声称缺失条目有占位，也不声称 `state:shared-read` 已获得快照。

## 完成门禁

- t09 延期存在独立 Leader walkthrough，且 Task README 不被当作状态字段。
- Component Lab Spec 两处失真已修正；未提供的状态快照明确标为当前限制。
- Work README 可独立恢复新路线、红分支边界、协作试迁移、自主迁移、C、消费者接回和统一审查顺序。
- 下一 Task 只在本 Task 结果明确后创建，不提前创建批量迁移链。
