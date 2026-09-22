---
schema: nbook.task/v2
taskId: t02-generic-package-first-slice
role: tasker
---

# 通用包首个切片：agent-file-tools 与 agent-sse

## 当前状态

- 2026-09-11 **已完成**：`packages/agent-file-tools`（首成员 `truncate`）与 `packages/agent-sse`（首成员 `sse-writer`）建成，包级 `test`/`typecheck` 通过（7/7、4/4）；`workspaces` 与 `bun.lock` 已登记并核实；`docs/testing` 已写入"通用包测试合同"。证据：`evidences/2026-09-11-first-slice-verification.md`。
- 后续待决：根级测试入口/CI 接线、下一批成员（`patch`、`tools`）、bash 归属、产品侧消费。

## 目标

按 2026-09-11 决定（`../t01-product-host-success-research/walkthroughs/006-decision-record.md`）与抽取 spike（`../t01-product-host-success-research/evidences/2026-09-11-extraction-spike-report.md`）落地第一批领域无关通用包：

1. `packages/agent-file-tools`：首成员 `truncate`（来源：产品 `server/agent/tools/truncate.ts`，按仓库规则适配后迁入）。
2. `packages/agent-sse`：首成员 `sse-writer`（来源：产品 `server/agent/events/agent-sse-writer.ts`，同上）。
3. 登记 root `package.json` 的 `workspaces`，并核实 `bun.lock` 影响。
4. 把 `D-TEST-01` 规范落到 `docs/testing/`（"通用包测试合同"一节）。

## Agent 工作

1. 按 TDD 建包：先写测试（RED）→ 迁入实现（GREEN）→ 按仓库默认 lint 规则适配（spike 已发现 `Promise.withResolvers()` 一类改写）→ 复跑测试与 typecheck。
2. 每个包必含：`package.json`（private、`type: module`、包级 `test`/`typecheck` 脚本）、`tsconfig.json`、`vitest.config.ts`（显式 `root` 与 `include`）、源码（同目录测试）、1 条 smoke（模块导入 + 最小真实路径）。
3. 包内不得出现 `nbook/*` 别名、产品 workspace/prisma、`@earendil-works/pi-*` 或产品 DTO。
4. 登记 `workspaces` 后运行一次 install 检查 `bun.lock` 差异；差异超出必要范围即停止并报告。
5. `docs/testing/` 增加"通用包测试合同"一节：TDD；只测关键最小集合；每包 smoke；L1–L4 分层；包内测试与独立配置；真实 LLM 不 mock、凭据与 skip 语义。

## 开发者参与

开发者审查包边界、命令与证据；不需要逐项审批构建步骤。

## 任务产物

- 两个包目录（源码、测试、配置）与包级脚本。
- root `workspaces` 变更与 `bun.lock` 差异说明。
- `docs/testing/` 规范一节。
- `evidences/`：两条包级 `test` 与 `typecheck` 的真实输出摘要（命令、退出码、关键结果）；spike 目录处置说明。

## 允许文件

- `packages/agent-file-tools/**`、`packages/agent-sse/**`
- 根 `package.json`（仅 `workspaces` 数组）、`bun.lock`
- `docs/testing/README.md`（或 `docs/testing/` 下新增文件）
- 本 Task 目录内 `evidences/**`、`walkthroughs/**`

## 完成门禁

- 两个包的 `test` 与 `typecheck` 对 current revision 真实通过；每包 smoke 存在且通过。
- 包内无禁用依赖；`workspaces` 已登记；`bun.lock` 差异已核实并说明。
- `docs-check`、`governance-check`、`diff-check` 有真实结果；既有失败与本次失败分开报告。
- 未运行项与原因写入 evidence。

## 决策与权限边界

本轮授权（开发者 2026-09-11）：建包、登记 `workspaces`、`docs/testing` 规范落地、运行包级测试与 typecheck。不做：修改产品 `server/agent` 源码、改产品行为、接入 NeuroBook、发布 npm、改动其它包、删除 spike 之外的既有内容。
