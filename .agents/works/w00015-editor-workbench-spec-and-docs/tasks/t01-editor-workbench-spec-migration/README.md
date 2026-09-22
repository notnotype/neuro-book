---
schema: nbook.task/v2
taskId: t01-editor-workbench-spec-migration
---

# 编辑工作台域规范迁移（含 Inline AI Prompt Bar 行为合同）

## 目标

按 `docs/specs/README.md` 的迁移合同，把「Markdown Studio 与编辑工作台」从用户文档/历史 plan 转成内部 `implemented` 规范，并把 Inline AI Prompt Bar 这批行为合同（w00014 修复所恢复的语义）纳入其中，从而关闭 w00014/t01 缺口 8。

## 修改范围

1. 先按 `docs/specs/TEMPLATE.md` 与 `docs/specs/README.md` 的九节 behavior 合同确定 capability 与 owner（例如 `editor.inline-ai-prompt-bar`，owner 取实际模块名），确保不与现有正文并列成第二份真相源。
2. 合同至少覆盖：Prompt Bar 发送必须落到 Agent Session API（`POST /api/agent/sessions/:id/invocations`）且不依赖右侧面板是否挂载；发送后的输入与状态反馈；失败（未就绪、模型不可用）的可观察表现；「打开 Session 聊天」把该 session 载入右侧面板主会话槽；Prompt Bar 的会话选择与新建。
3. 现有行为证据：用户文档 `vitepress/locales/zh-Hans/core/markdown-studio.md#inline-ai`（承诺「Inline AI 不占用主会话，发送后不会自动弹开右侧 Agent 面板」）、历史 plan `packages/neuro-book/docs/archived/plan/06-editor-workbench.md`、`packages/neuro-book/shared/editor-workbench.ts`，以及 w00014/t01 的过程记录（`.agents/works/w00014-issue-227-inline-ai-send-owner/tasks/t01-inline-ai-send-owner-fix/walkthroughs/` 与 `evidences/`，已随 PR #235 合并进 master）。
4. 完成后更新 `docs/specs/README.md` 的「已实现规范」注册表，以及该域在「规范缺口」表中的状态。

## 验证

- `bun run docs:check` 退出码 0：capability 精确唯一、必需章节有实义内容、implemented 证据链接有效。
- 合同中每条可观察行为都能指向代码位置或已有验证证据；证据不支持的条款不得写成 `implemented`。
- 回到 w00014/t01 记录，把缺口 8 更新为已闭合，并注明该 Task 其余缺口的状态。

## 边界

不改变产品行为；不执行远端写入（除开发者单独授权的登记/PR 动作）；不调用真实 Provider/Model。
