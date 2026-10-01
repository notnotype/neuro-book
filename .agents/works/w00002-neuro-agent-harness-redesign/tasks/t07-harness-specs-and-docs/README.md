---
schema: nbook.task/v2
taskId: t07-harness-specs-and-docs
---

# 三包补 Spec、文档与示例，并重写 #193

## 目标

1. 给 `nb-session`、`nb-profile`、`nb-harness` 补 `implemented` Spec，按当前代码、测试与实测写黑盒合同，并把不打算锁进合同的现状列为已知缺口。
2. 每个包补 `README.md`、`docs/api.md` 与可运行示例，示例由包内测试以子进程运行，作为 smoke。
3. 补 Spec 时顺带审查三包。
4. 按 2026-09-18 之后的现状重写 Issue #193 正文。

非目标：不修改三包的产品源码（审查发现只记录、不修）；不接入 NeuroBook 产品；不 push、不建 PR。

## 当前状态（2026-10-01）

- 已完成：五份 Spec（[`session-log`](../../../../../docs/specs/harness/session-log.md)、[`profile-dsl`](../../../../../docs/specs/harness/profile-dsl.md)、[`agent-turn`](../../../../../docs/specs/harness/agent-turn.md)、[`file-tools`](../../../../../docs/specs/harness/file-tools.md)、[`sse`](../../../../../docs/specs/harness/sse.md)）并登记到 [`docs/specs/README.md`](../../../../../docs/specs/README.md)；三包 README、API 参考、示例与示例 smoke；`nb-session`、`nb-profile` 新增包级 `AGENTS.md`，`nb-harness/AGENTS.md` 补充 Spec 入口与真实 LLM 的运行方式；三包 `tsconfig` 把 `examples` 纳入类型检查。
- 新增测试：`nb-harness/tests/sse.test.ts`（7 例，t06 交付时 SSE 没有测试）；三包各一个 `tests/examples.test.ts`。
- 审查：16 条发现见 [`walkthroughs/001-review-2026-10-01.md`](walkthroughs/001-review-2026-10-01.md)，其中 3 条高优先级（文件工具无访问边界且 harness 中 `edit` 不经确认、`turn` 吞掉失败与中止、模型上下文不从日志恢复）。均未修复。
- #193 正文：见本文“Issue”一节。

## 验证证据

在 worktree `.worktree/w00002-neuro-agent-harness-redesign`（分支 `docs/w00002-harness-specs`）运行：

| 命令 | 结果 |
|---|---|
| `packages/nb-session`：`bun test`、`bun run typecheck` | 15 pass；exit 0 |
| `packages/nb-profile`：`bun test`、`bun run typecheck` | 12 pass；exit 0 |
| `packages/nb-harness`：`bun test`、`bun run typecheck` | 28 pass、2 skip（真实 LLM，未加载凭据）；exit 0 |
| `packages/nb-harness`：`bun --env-file=<主仓库根>/.env test tests/harness.e2e.test.ts` | 5 pass（含 2 条真实 DeepSeek，13.4 s） |
| `packages/nb-harness`：`bun --env-file=<主仓库根>/.env examples/real-model.ts` | 模型调用 `read` 后正确回答；exit 0 |

仓库门禁结果见交付报告。

## Issue

开发者 2026-10-01 授权“按 09-18 之后的现状重写 #193 正文”。旧正文备份在会话临时目录，未入库；新正文引用本分支的 Spec 路径，合入 `master` 前这些链接在 GitHub 上会 404。

## 下一步

- 合入本分支（需开发者批准）。
- 由开发者决定审查发现的处理顺序；建议第 1–3 条并入后续设计（插件装配、审批、上下文恢复），第 4–10 条单开修复 Task。
