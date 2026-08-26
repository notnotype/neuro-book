---
schema: nbook.walkthrough/v1
taskId: 00159-agent-abort-mutation-contract
sequence: 3
role: tasker
status: completed
createdAt: 2026-08-26T01:10:00Z
---
# Agent abort 合同最终实现与验证

## 实现

- `NeuroAgentHarness` 的 waiting abort 在 mutation admission 内处理 queue、resolution 和 aborted lifecycle；所有 durable 写入先完成，再 `finishInvocationState`，最后按 `invocation_aborted -> session_entry -> session_state_changed -> agent_end` 发布公开事件。
- waiting abort 的 resolution/lifecycle/queue 与 partial lifecycle 的 `ensureAutoLeaf` 修复均经 `SessionWriteExecutor` 的窄化 `suppressEvents` 选项和 per-session write queue；失败时保留 waiting ownership 并允许重试，不重复 lifecycle。
- forced abort 继续使用同一 per-session write queue、精确 plan/authorization、pending recovery 和 late-result ownership fence。
- forced recovery 的 existing-aborted active-leaf repair 已改为 `SessionWriteExecutor` 内部的 `lifecycle.aborted.repair` / `ensureAutoLeaf` write op；该路径使用 `suppressEvents`，不再直接调用 repository，幂等 no-op 不产生空事件。
- `abortInvocationMatching()` 的 admission 先解析 runtime projection；归档状态在 claim 前返回 409，非归档无 active（包括 Profile unavailable 的 Idle）返回幂等 idle，只有匹配 active 才检查 `interaction.canAbort`；黑盒/历史 Session 回归覆盖两种无 active 分支且不写 lifecycle。

## 实际验证

| 命令 | 结果 |
| --- | --- |
| `bun run --cwd packages/neuro-book test:agent -- --reporter=dot --silent` | 156 files, 1460 passed |
| `bun run --cwd packages/neuro-book typecheck` | 通过，exit code 0 |
| `bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.black-box.test.ts server/agent/harness/neuro-agent-harness.test.ts server/agent/session/write-plan.test.ts server/api/agent/sessions/[sessionId]/abort.post.test.ts server/agent/http.test.ts --reporter=dot --silent` | 5 files, 289 passed |
| `bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.black-box.test.ts -t "外部 signal 只取消 admission"` | 1 passed；trace cleanup race 修复后通过 |
| `bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.test.ts -t "waiting abort 的 partial lifecycle append|waiting abort 的 lifecycle 持久化失败"` | 2 passed；partial lifecycle/leaf repair retry 通过 |
| `bun run --cwd packages/neuro-book test -- server/agent/harness/neuro-agent-harness.black-box.test.ts -t "Archived 且没有 active invocation 时 abort 返回 409" --reporter=dot --silent` | 1 passed；验证归档无 active 的 409 分支 |
| `bun run --cwd packages/neuro-book test -- server/agent/session/write-plan.test.ts -t "partial lifecycle append 后 repair 失败可继续重试并只补一条 auto leaf"` | 1 passed；验证 recovery repair 经 write op、失败重试、唯一 auto leaf 与事件抑制 |
| `bun run --cwd packages/neuro-book test -- server/agent/session/write-plan.test.ts --reporter=dot --silent` | 20 passed |
| `bun run docs:check` | `failures: []`, `checkedFiles: 5285` |
| `bun run governance:check` | `failures: []`, `warnings: []` |
| `git diff --check` | 通过；仅报告仓库既有 LF/CRLF 转换警告 |

未运行：浏览器人工验收、真实 Provider/Model smoke、远端 CI、push、PR、发布、部署、数据删除。

## Reviewer verdict

- `overall_correctness`: `correct`
- `explanation`: 最新 worktree 已闭合 waiting partial lifecycle 的 active-leaf repair、existing aborted lifecycle 与已落盘 abort resolution 的 retry 去重/重发；durable write 事件抑制后按约定顺序公开；forced queue/recovery、strict DTO、ownership fence、follow-up pause、HTTP error seam 与锁边界未发现新增缺陷。
- `confidence`: `0.99`
- `findings`: `[]`
- `tests`: Reviewer 本轮只读审查，未运行命令；命令结果以上表实际输出为准。
