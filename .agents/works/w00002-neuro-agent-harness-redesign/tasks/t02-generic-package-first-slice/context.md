# 通用包首个切片恢复卡

## 当前状态

- Current Task：`t02-generic-package-first-slice`（canonical role: tasker）；Work `w00002-neuro-agent-harness-redesign`；Issue #193。
- 授权来源：开发者 2026-09-11「可以，都授权。可以跑 spike」。
- 依据：`../t01-product-host-success-research/walkthroughs/006-decision-record.md`（决定记录）与 `../t01-product-host-success-research/evidences/2026-09-11-extraction-spike-report.md`（spike 结果与最小脚手架配方）。
- 已有参考：spike 骨架在 `.local/spike-extract-20260911/`（`.gitignore` 覆盖，不进入仓库；建包完成、证据落盘后可删除）。

## 恢复顺序

1. [Issue #193](https://github.com/notnotype/neuro-book/issues/193)：公开目标与整体进度。
2. [`packages/neuro-agent-harness/docs/issue-193-roadmap.md`](../../../../../packages/neuro-agent-harness/docs/issue-193-roadmap.md)：非绑定候选阶段；不能执行。
3. 本 Task [`README.md`](README.md)：current Task 合同。
4. 上述 `006-decision-record.md` 与 `2026-09-11-extraction-spike-report.md`。
5. 存在时读取本 Task `evidences/`；不存在不得推断其内容。

## 决策与范围

| 编号 | 结论 |
| --- | --- |
| `D-TEST-01` | T1：TDD；只测关键（最小集合）；每包 1 条 smoke；L1–L4 分层；真实 LLM 不 mock（`DEEPSEEK_API_KEY`，缺凭据 skip + 记录） |
| `D-SPLIT-01` | 领域级单包 + subpath；首切片：`agent-file-tools`（`truncate`）、`agent-sse`（`sse-writer`） |

本 Task 采用包名 `@notnotype/agent-file-tools`、`@notnotype/agent-sse`（若开发者改主意，先改合同再动手）。待决：bash 归属、真实 LLM 调用预算。

## 下一合法动作

本 Task 已完成（2026-09-11）：两个包建成并通过包级 `test`/`typecheck`（file-tools 7/7、sse 4/4），`workspaces` 与 `bun.lock` 已登记并核实，`docs/testing` 已写入"通用包测试合同"；证据见 `evidences/2026-09-11-first-slice-verification.md`。

后续：CI 接线已完成（见 [`t03-package-ci-wiring`](../t03-package-ci-wiring/README.md)）；`bash` 归属已定——单独成包 `@notnotype/agent-shell`（见 t01 `walkthroughs/006-decision-record.md` 补充决定）；下一批成员待圈定（候选：`agent-sse/frame`、`agent-sse/hub`、`agent-file-tools/patch`、`agent-file-tools/tools`、`agent-shell` 本体）；产品 `server/agent` 改为消费新包（#117 或单独授权）。
