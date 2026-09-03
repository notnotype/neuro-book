---
schema: nbook.walkthrough/v1
taskId: t06-preview-retirement
sequence: 1
role: tasker
status: completed
createdAt: 2026-09-03T00:00:00Z
---

# t06 收尾：Preview 场景留证与发布页面清退

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

## 已完成

- 新增 `evidences/preview-retirement-scenarios.json`，使用 `nbook.preview-retirement-evidence/v1`：31 个唯一场景覆盖 14 个页面，包含 7 份 diff 文档、3 个 timeline 阶段、4 卷 dnd 数据及其余 demo 输入、动作和预期结果。
- 删除 `packages/neuro-book/app/pages/` 下精确 14 个 preview 页面，包括容易被 `*.preview.vue` 漏掉的 `world-engine.workbench-preview.vue`。
- 删除只被这些页面消费的 dnd 组件与数据、Plot preview host/mock/旧 View 闭包、World Engine 独立 preview 四个子组件及创建编排 utility。
- 删除正式 World Engine Workbench 中指向已退役 `/world-engine.preview` 的 `Preview` 按钮、路由计算和控制器。
- 删除只读取已退役页面的 Workflow preview 合同测试；`agent-jobs-wiring.test.ts` 保留正式 Agent Job/Workflow 接线测试，只移除 preview 页和 `WorkflowRunPanel` 断言。页面专属 `WorkflowRunPanel.vue`、`WorkflowSessionTree.vue` 与 `/api/agent/workflow-demo/**` HTTP 路由/测试一并删除。
- `world-engine-workbench-preview.test.ts` 不整份删除：移除 mock 页面断言，保留正式 Dialog、共享组件、reducer/filter/value 行为测试；mock 数据重命名为 `world-engine-workbench.test-fixtures.ts`，明确其测试 fixture 所有权。
- `vitest.config.ts` 显式纳入此前未被默认 include 收集的 `world-engine-ide-entry.test.ts` 与 `world-engine-workbench-preview.test.ts`，避免命令看似指定文件但实际零收集。
- 同步 `docs/specs/theme/system.md`：删除已退役页面的主题要求，保留真实 `WorldEngineWorkbenchDialog.vue` 的 `.world-engine-workbench-theme` 合同。

## 删除边界

按真实调用方与规范所有权判断，不按文件名中的 `preview` 批删。

保留：

- 正式 `WorldEngineWorkbenchDialog.vue` 直接消费的 `world-engine/workbench-preview/**`。
- 正式 Agent surface 消费的 `components/workflow-preview/WorkflowRunVisuals.vue`、图表/时间线/卡片组件与底层 `workflow-demo-service.ts`；正式 `/api/agent/workflow/**` 继续复用该 service。
- 正式 Plot 的 `thread-panel/**`、`workbench/**`、`chapter-panel/**`。
- 主题规范明确保留的 `plot-preview.types.ts` 与 `tree/plot-tree.types.ts`，即使当前无运行时消费者也不删除。

删除：

- 14 个页面及它们独占的 host、mock、导航和控制器。
- Plot 的 `PlotWorkspacePreview`、timeline/tree preview host 及无正式消费者的旧 View/tree/timeline 实现；场景数据已进入结构化 evidence。
- Workflow preview 页面独占的 `WorkflowRunPanel` / `WorkflowSessionTree` 与 demo HTTP 路由；正式 Agent 气泡和 Workflow API 未删。

全仓精确页面路径扫描仍命中历史 Task、基线和本次 evidence。它们是 provenance，不是活动源码引用；活动 `app/server/shared` 的页面路径、导航链接和专属 mock 扫描均为 0。

## 正式入口证据

删除前已在开发入口运行态观察：

- 设置 Activity Bar 可打开模型设置。
- World Activity Bar 可打开 `WorldEngineWorkbenchDialog`。
- Agent Activity Bar 可打开 Agent surface。
- `/?project=workspace%2F.nbook` 的用户资产表层可打开 Profile 工作台。

删除后的浏览器人工验收未运行：根授权规则要求浏览器人工验收单独取得明确授权，本轮未取得。不能用删除前观察或静态测试替代删除后运行态结论。

## 验证

- 证据 JSON 解析：31 个场景、31 个唯一 id、14 个唯一页面；schema 为 `nbook.preview-retirement-evidence/v1`。
- `bun run --cwd packages/neuro-book typecheck`：通过。
- `NODE_ENV=production bun x nuxt build --dotenv .env.product --preset node-server`：通过，Nitro 产物 5.59 MB（1.2 MB gzip）。构建仅有现存 sourcemap、PURE annotation、chunk size 和 `node:sqlite` / `bun:ffi` external warning。
- 最终 `.nuxt/product-raw` 精确扫描 14 条 preview 路由与 `/api/agent/workflow-demo`：0 命中。同一产物正控命中正式 `/api/agent/workflow/runs` 与 `/api/config/bootstrap`，证明扫描目标可读。
- 活动源码专属资源、demo HTTP 路由与导航扫描：0 命中。
- `git diff --check`：通过。

`scripts:typecheck` 仍失败，错误保持在既有 `server/workspace-files/system-asset-installation.ts`：594、597、600、603 行的 `assets` / `profiles` 属性、隐式 `any` 与 `LegacySyncStateDocument` 赋值错误。本 Task 未修改该文件，不把基线失败归因于 preview 清退。

## 终态与后续

- t06 的页面、证据、源码引用、聚焦测试和生产产物门禁闭合。
- 删除后四个正式入口的浏览器人工验收为未验证项，等待单独授权时重放。
- Lab UI/UX 细调与 `scripts:typecheck` 基线修复继续作为 t06 之后的独立质量任务，不混入本 Task。
