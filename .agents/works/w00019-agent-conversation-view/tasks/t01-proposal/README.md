---
schema: nbook.task/v2
taskId: t01-proposal
---

# 现状分析、需求调研与提案起草

## 目标

把 Agent 面板重做的需求、范围和设计取舍写成可评审的 Proposal，供开发者接受后再写 planned Spec。

## 当前状态（2026-09-28）：已完成

- 已完成现状分析与需求调研，结论和开发者决定都写进了 [Agent 对话视图重做提案](../../../../../packages/neuro-book/docs/proposals/agent-conversation-view.md)，开发者已接受（`accepted`）。
- 数据层与后端的问题单独记入 [数据层后续提案](../../../../../packages/neuro-book/docs/proposals/agent-session-data-layer.md)（`draft`），本 Work 不实现。

## 合同

行为合同未变：本 Task 只起草提案，不修改代码，也不修改任何 Spec。提案接受后才会新增 `ui.agent-conversation-view`，并修订 [Component Lab 规范](../../../../../docs/specs/ui/component-lab.md)。

## 证据

- 代码盘点：只读分析 `packages/neuro-book/app/components/novel-ide/agent/`、`server/api/agent/`、`shared/dto/agent-session.dto.ts`、`shared/dto/agent-public-event.dto.ts`。
- Lab 截图：master `6faecf81`，Source Dev 起在 `127.0.0.1:3002`，State Root 与 Cache Root 使用会话临时目录（执行过 `migrate:deploy` 和 `migrate:application-state -- --apply`），没有碰真实数据。用 Playwright 驱动系统 Chrome，逐个打开 `/lab?c=AgentSidebarView&s=<场景>`，切到“手机”预设（390 宽）后截图并量节点高度。截图可按同样步骤复现，不入库。
- 实测发现 `pending-input` 场景在 master 上渲染崩溃（`Cannot read properties of undefined (reading 'length')`）。

## 后续

提案已接受，Spec 由 [t02](../t02-planned-specs/README.md) 完成。数据层后续提案仍为 `draft`，不在本 Work 实现。
