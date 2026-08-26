---
schema: nbook.walkthrough/v1
taskId: 00159-agent-abort-mutation-contract
sequence: 4
role: tasker
status: completed
createdAt: 2026-08-26T06:06:12Z
---
# Task 18 合同与迁移登记收尾

## 本轮变更

- 未改写既有 `003-tasker-2026-08-26-abort-contract-final.md`；本文件按 Task 目录规则作为追加式收尾报告。
- 修正 `packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md:74`：仅非归档 Session 在没有匹配 active invocation（包括重复取消已收口 invocation）时返回 `idle` 且无副作用。
- 继续保持三分支 admission 合同：Archived 无论是否有 active 都返回 409；非归档无匹配 active（包括 Profile `missing`/`unloadable`）返回 200 `idle`；有匹配 active 时才检查 `interaction.canAbort`。

## 迁移登记同步

- Task 18 `HARNESS-BLACK-BOX-CONTRACT.md` canonical SHA-256：
  `sha256:1764db93056b37aedb8819392f2d49300d4f9c31ac2619596fe7ae4054711002`。
- `.agents/tasks/ownership.json` 对应 `file.sha256` 与 `.agents/tasks/legacy-index.json` 对应 `mapping.destinationSha256` 已同步为上述值。
- `.agents/tasks/legacy-index.json` 对应 mapping 的 `sourceSha256` 保持原值：
  `sha256:2e0f87da418450938512f9f6196b671065886482f3c9a1809763f4698c7a4201`。
- 迁移 manifest 严格按治理代码字段顺序 `{schema, sourceRevision, mappings, repositoryLinkRewrites, preservedSourceFiles}` 重算；新值为：
  `sha256:f375131c107f8d2b900c53675b6c78e8c23c2de7e20886961e41ec6178d766b2`。
- 上述 manifest hash 已同时写入 `.agents/tasks/legacy-index.json` 与 `.agents/tasks/.migration-complete`。
- 登记 diff 仅包含 Task 18 的目标 canonical/destination hash 与两处 `manifestSha256`；其它 mapping 字段保持不变。

## 本轮实际验证

| 命令 | 结果 |
| --- | --- |
| `bun run docs:check` | `failures: []`，`checkedFiles: 5286` |
| `bun run governance:check` | `failures: []`，`warnings: []` |
| `git diff --check -- packages/neuro-book/.agents/tasks/18-agent-runtime-pipeline-hooks/HARNESS-BLACK-BOX-CONTRACT.md packages/neuro-book/assets/reference/agent/sse.md .agents/tasks/ownership.json .agents/tasks/legacy-index.json .agents/tasks/.migration-complete` | 通过，无 whitespace error |

既有 `003` 报告中的 Agent 全量、类型检查及 5 文件聚焦测试结果仍作为前序验证证据；本轮仅新增文档合同与迁移登记，未改动运行时代码。

## 未运行

浏览器人工验收、真实 Provider/Model smoke、远端 CI、push、PR、发布、部署和数据删除继续未运行/未授权。
