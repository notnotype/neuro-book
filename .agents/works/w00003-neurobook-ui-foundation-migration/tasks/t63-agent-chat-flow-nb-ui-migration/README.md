---
schema: nbook.task/v2
taskId: t63-agent-chat-flow-nb-ui-migration
---

# AgentChatFlow 组件拆分、解耦与 nb-ui 迁移

**状态：进行中**

依据：[Issue #191](https://github.com/notnotype/neuro-book/issues/191)；[组件规范](../../../../../docs/standards/code/components.md)；[Component Lab 规范](../../../../../docs/specs/ui/component-lab.md)。

## 结果

1. 完成 `AgentChatFlow` 及其子模块拆分：
   - 拆分空状态为 `AgentChatEmptyState.vue`，接入 `@notnotype/nb-ui` 的 `EmptyState` 原语。
   - 拆分历史加载为 `AgentChatHistoryLoader.vue`，接入 `@notnotype/nb-ui` 的 `Button` 原语。
   - `AgentChatFlow.vue` 提纯为纯粹流容器，支持作用域插槽 `#node` 与 `#empty` 解耦，同时保持原有 props/emits 兼容性。
2. 规范文档先行：交付 `AgentChatFlow.md`，明确能力标签（`state:local`、`env:timer`）与交互/布局合同。
3. Component Lab 场景覆盖：新增 `AgentChatFlowFixture.vue` 并在 `fixtures/index.ts` 登记 7 个场景，通过 `fixtures/index.test.ts` 门禁。

## 范围

- `packages/neuro-book/app/components/novel-ide/agent/AgentChatFlow.md`
- `packages/neuro-book/app/components/novel-ide/agent/AgentChatEmptyState.vue`
- `packages/neuro-book/app/components/novel-ide/agent/AgentChatHistoryLoader.vue`
- `packages/neuro-book/app/components/novel-ide/agent/AgentChatFlow.vue`
- `packages/neuro-book/app/component-lab/fixtures/AgentChatFlowFixture.vue`
- `packages/neuro-book/app/component-lab/fixtures/index.ts`
- `packages/neuro-book/app/component-lab/fixtures/index.test.ts`

## 排除

- 不破坏 `AgentChatSurface.vue` 的既有调用签名与功能。
- 不修改其它气泡（`AgentTextBubble`, `AgentToolBubble`）内部实现。
- 不动用户 dirty 文件（如 `editor-workbench` 系列）。

## 验证

- `bun test app/component-lab/fixtures/index.test.ts`
- `bun --cwd packages/neuro-book run typecheck`
- `bun run docs:check`
- `bun run governance:check`
