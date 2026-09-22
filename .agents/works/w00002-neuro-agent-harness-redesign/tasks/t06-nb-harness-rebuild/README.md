---
schema: nbook.task/v2
taskId: t06-nb-harness-rebuild
role: tasker
---

# nb-harness 三包重建（基于 OMP）

## 当前状态

- 2026-09-18 **已完成**：三包（`nb-session` 14 用例、`nb-profile` 11 用例、`nb-harness` 20 用例）全部实现并通过测试与 `typecheck`；真实 DeepSeek 调用已验证（`completeSimple` 344ms、stopReason=stop）；仓库门禁 `docs:check` 0 失败、`workspace-workflows.test.ts` 13/13、`governance:check` 无新增失败、包矩阵对三个新包均正确选中。实施记录与计划偏差见 [`walkthroughs/001-implementation-2026-09-18.md`](walkthroughs/001-implementation-2026-09-18.md)。
- 2026-09-18 **开工**：按开发者批准的 `local://nb-harness-rebuild-plan.md`（slug `nb-harness-rebuild`）执行。批准依据：开发者 2026-09-18 的「删掉 agent-kit、全面转向 bun、以 OMP 为底座重做 harness」决定与随后对计划的批准。

## 目标

1. 新建 `packages/nb-harness`（`@notnotype/nb-harness`）：基于 OMP 包族的 agent 内核 + `read`/`edit` 工具 + SSE + 插件缝最小骨架。
2. 新建 `packages/nb-session`（`@notnotype/nb-session`）：append-only 会话日志与可替换存储，由 harness 依赖。
3. 新建 `packages/nb-profile`（`@notnotype/nb-profile`）：`.profile.tsx` 提示词装配 DSL + JSX 运行时 + 加载器。
4. 交付 OMP 能力上手报告 `packages/nb-harness/docs/omp-capabilities.md`。

## 范围与非目标

范围：三个新包、仓库接线（workspaces / CI 矩阵 / 三个 workflow 路径过滤 / 包级 AGENTS.md）、OMP 依赖锁定 `18.2.5`、真实文件与真实 LLM 的端到端验证。

非目标：不动 `packages/neuro-agent-harness`（冻结）；不迁移 llmlint；不接入 NeuroBook 产品；不接入任何域工具（只留插件缝）；不改产品侧 `@earendil-works/pi-*` 集成。

## 验证

- 三包 `bun test` 与 `bun run typecheck` 全绿。
- `packages/nb-harness/tests/harness.e2e.test.ts`：装配断言恒跑；真实 LLM 两条在缺凭据时 skip 并记「未验证」。
- 端到端可观察结果：临时文件被 `edit` 工具真实改写；JSONL 会话可读回 `message`/`tool_call`/`tool_result`。
- 仓库门禁：`bun x vitest run --config scripts/vitest.config.ts scripts/ci/agent-governance.test.ts scripts/ci/workspace-workflows.test.ts`、`bun run docs:check`、`bun run governance:check`（不新增失败）、包矩阵脚本复核。

## 决策与权限边界

批准依据：开发者批准的计划 `nb-harness-rebuild`。范围内本地可逆的实现、测试与文档由本 Task 执行；远端写入、push、发布、部署、真实 Provider 配置变更、数据删除仍需分别授权。
