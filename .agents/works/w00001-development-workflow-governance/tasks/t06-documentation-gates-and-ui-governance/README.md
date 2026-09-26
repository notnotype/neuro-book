---
schema: nbook.task/v2
taskId: t06-documentation-gates-and-ui-governance
---

# 文档门禁与 UI 治理收口

## 目标与范围

开发者 2026-09-24 批准修复 DOC-H1/H2/H3，并采纳 UI 验收分档、implemented Spec 证据分类、受管组件范围、主工作区写入与 Work 收尾建议；随后另行批准将 [Component Lab 显式输入合同](../../../../../docs/specs/ui/component-lab.md) 与主线场景整合到本治理工作树。治理规则与文档检查的行为合同未变；Component Lab 运行期输入合同改为单一 `{props?, model?, slots?}`。

受管组件范围为 nb-ui barrel 对外导出的组件及 `packages/neuro-book/app/components/common/**` 下的 Vue 组件。为应用组件补文档时，同时满足 Component Lab 场景合同；无场景的组件按其实际宿主依赖补可运行场景或标记真实验证入口，不虚构状态。

非目标：修复其他 Work 的历史 Task 警告、清理任何 worktree/branch、运行真实 Provider/Model、远端写入或发布。开发者随后明确要求将当前本地 diff 合并到 `master`，故本地提交与合并属于此次授权；隔离 State Root 的 `migrate:application-state -- --apply` 与浏览器人工验收仍分别需要明确授权。

## 当前状态

集成前执行位置为 `.worktree/w00001-development-workflow-governance`，分支 `feat/w00001-docs-anchor-check`；最终验证与合并结果位于 `master`。治理规则、检查器和受管组件文档保留；本轮导入主线已提交的场景差异并消除冲突，132 个组件的 468 个场景全部通过 `defineLabFixture<typeof C>` 显式登记。场景仅登记 JSON 输入，函数、Date、Set、服务与宿主回调由 fixture 在内存中提供；三个确无可编辑 JSON 输入的组件提供 `noInput` 理由。LabShell 移除旧 `data` 通道，`useLabSubject` 接入输入和事件；`index.test.ts` 验证输入登记、schema、JSON 无损往返与插槽预设。Grid 布局字典原为 null-prototype 对象，编辑台场景在登记处正规化为普通 JSON 对象，不修改 Grid 运行期逻辑。

治理树显式输入合同提交为 `98b495e0b1eaf3a960355b33177510b282839962`，治理阻塞快照提交为 `d5d0b486924c2c7902c06aa60040451b0194e546`。开发者随后明确要求先提交 `master` 原有改动再合并；原有 nb-ui 文档与 Agent/ModelPicker 行为分别提交为 `14d504f8fe68effa235520bfa95a174542039ffd`、`964ef83a1acecd952ca4cb6da18c640a1d3069ed`，最终在 `master` 提交合并结果 `1ec1a8b8abcd093b46d97cbb4e82661375d6a821` 并解决冲突；AgentSidebar fixture 修复提交为 `1b677f775f4d6f74ab9c523ac39e83ca6f42afad`，已授权合入的 nb-harness 包规则提交为 `5c8f11cfbaf14ddf72b578c00c111866b8612e7f`。治理工作树此前原有的 `packages/nb-harness/AGENTS.md` 修改已按开发者授权同步到 `master`，治理工作树当前仅保留该文件的工作副本状态应以实际 Git 状态为准。此前 `localhost:3000` 与 `127.0.0.1:3127` 的浏览器记录属于不同 checkout/revision，不能充作本轮运行证据。

## 本轮有效证据

| 验证 | 结果 |
|---|---|
| `bun x vue-tsc --noEmit --project tsconfig.json --pretty false`（`packages/neuro-book`） | 通过，零诊断；包含 `lab-subject.typecheck.ts` 的负例约束 |
| `node ../../node_modules/vitest/vitest.mjs run app/component-lab`（`packages/neuro-book`，`master` 合并结果） | 19 个文件、120/120 通过，包含 132/468 场景覆盖、编辑台 JSON 往返、项目选择与 Agent 面板交互回写；提示面板单文件冷加载复验 6/6 通过，AgentSidebar 模型选择器 readonly 回归通过 |
| `bun run nuxt:prepare`（`packages/neuro-book`） | 通过，生成 `.nuxt` 类型 |
| `bun run docs:check`（仓库根） | `failures: []`；其他历史 Work/Task 的已存在链接与 Spec 警告仍保留 |
| `bun run governance:check`（仓库根） | `failures: []`、`warnings: []` |
| `bun x vitest run --config scripts/vitest.config.ts scripts/ci/check-documentation.test.ts` | 21/21 通过 |
| `bun run docs:build`（仓库根） | VitePress client/server bundle 与页面渲染通过 |
| `git diff --cached --check && git diff --check && git ls-files -u`（治理工作树） | 无空白错误、无未解决冲突；Git 对部分 LF 工作副本报告将来替换为 CRLF 的提示 |

## 授权边界与下一步

本轮未执行隔离 State Root 的 `migrate:application-state -- --apply`，也未启动当前合并结果的 Source Dev 或浏览器人工验收；测试和静态检查不能替代实际界面视觉证据。迁移与浏览器人工验收仍各需单独授权，本地合并授权不包含 push、PR 或远端写入。
