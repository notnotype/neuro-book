---
schema: nbook.task/v2
taskId: t01-fix-message-only-invoke
---

# 修复 Workflow message-only invoke

## 目标

使 `agent.invoke({message})` 在未声明 PayloadSchema 的 profile 上正常运行，同时保持调用方显式提供 `input`（包括 JSON null）时继续按 PayloadSchema 严格校验。

## 已知证据

- NeuroBook `AgentProfileCatalog.parsePayload()` 仅在 payload 非 `undefined` 时校验，行为与 Reference 一致。
- `packages/nb-workflow/src/agent-extension.ts` 当前把缺省 `options.input` 归一化成 `null`，并将该值传给 `AgentPort.invoke()`。
- `HarnessAgentPort` 将 `opts.input` 原样映射成 harness `payload`，因此缺省 input 被误报为显式 invocation input。
- 现有 `runner-backend.test.ts` 锁定了 message-only 调用传 `input: null` 的错误行为，需要改成正确合同。

## 修改范围

1. 在 `@notnotype/nb-workflow` Agent 扩展调用 AgentPort 时保留可选字段缺省语义；activity fingerprint/params 必须继续确定性记录，且不泄漏未知字段。
2. 增加包级回归测试：message-only invoke 到 AgentPort 时 `input` 不存在；显式 `input: null` 仍保留为 null。
3. 增加 NeuroBook 适配器回归测试，证明没有 PayloadSchema 的 profile 可通过 Workflow message-only invoke，同时显式 input 仍被严格拒绝。
4. 核对并仅在需要时更新现有 Agent Workflow Reference；不得放宽 `parsePayload()`。
5. 运行聚焦测试、相关包 typecheck/测试、`git diff --check`，把真实命令与结果写入 walkthrough。

## 允许文件

- `README.md`
- `walkthroughs/**`
- `packages/nb-workflow/src/agent-extension.ts`
- `packages/nb-workflow/test/runner-backend.test.ts`
- `packages/neuro-book/server/agent/workflow/workflow-agent-port.ts`
- `packages/neuro-book/server/agent/workflow/workflow-agent-port.test.ts`
- `packages/neuro-book/assets/reference/agent/workflow/authoring.md`
- `packages/neuro-book/assets/reference/agent/workflow/README.md`

## 边界

不修改 PayloadSchema 的严格失败语义，不引入兼容 fallback，不运行真实 Provider/Model，不写远端 Issue/PR，不 push、发布或部署。
