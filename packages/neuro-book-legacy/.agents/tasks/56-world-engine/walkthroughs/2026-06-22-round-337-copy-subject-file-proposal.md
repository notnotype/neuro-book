# Round 337: Copy Subject File Proposal

## Context

Round 336 已经在 Inspector 展示主体文件建议，但作者还需要把建议拿去审查、交给 Agent 或手动写入。P1 自动提交尚未开始，因此本轮只补复制入口，保持“建议不自动写文件”的边界。

## Changes

- 新增 `formatWorldWorkbenchSubjectFileProposal()`，把单个主体文件建议格式化成可复制文本：
  - subject id / subject path。
  - `events.jsonl` draft 与目标 path。
  - 可选 `memory.jsonl` facts 与目标 path。
  - 可选 `state.md` review reasons 与目标 path。
  - 结尾明确提示：这是建议，不会自动写入 `simulation/subjects`。
- `WorldEngineWorkbenchPreviewInspector.vue` 在每个 proposal 中增加“复制建议”按钮：
  - 使用 `navigator.clipboard.writeText()`。
  - 成功 / 失败通过 `useNotification()` 反馈。
  - 按钮放在展开内容顶部，不嵌套在 `<summary>` 内。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过。
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts` 通过。
- `bun run typecheck` 仍未通过，当前失败来自无关 `app/components/novel-ide/agent/useAgentSession.test.ts` 的 ToolCall / low-code fixture 类型漂移：
  - `args` 不存在于 `ToolCall`。
  - low-code field fixture 使用了旧 `name` 字段。
  - low-code form fixture 缺少 `defaults`。
  - `api` 不存在于 `ToolResultMessage`。

## Actual Result

- 作者现在能复制主体文件建议，用于手动审查或交给后续 Agent。
- 仍未实现 P1 显式写入，也没有自动调用 subject memory 工具。
- 未执行浏览器验证。

