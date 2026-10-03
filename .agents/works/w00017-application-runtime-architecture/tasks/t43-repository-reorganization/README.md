---
schema: nbook.task/v2
taskId: t43-repository-reorganization
---

# NeuroBook v2 第 1 步：仓库整理

## 目标与范围

按 [NeuroBook v2：并排重建应用](../../../../../docs/proposals/neuro-book-v2-rebuild.md)（`accepted`）方案第 1 节整理仓库，为新应用腾出原路径并让入口文档与实际结构一致。本步不写新应用代码，不迁内核（第 2 步）。

**A. 旧包改名**

- `packages/neuro-book` → `packages/neuro-book-legacy`，包名改为 `@notnotype/neuro-book-legacy`。
- 留在根 `package.json` 的 workspaces 中、依赖照装；去掉对 `@notnotype/neuro-book-manager` 的依赖和指向已删除脚本的命令；从类型检查、测试与治理检查中排除。
- 在原路径建新应用的占位包 `packages/neuro-book`（包名 `@notnotype/neuro-book`）：只有 `package.json`、`README.md` 与 `AGENTS.md`，写明结构约定与“代码从第 3 步开始”。

**B. 删除交付链**（git 历史与 master 中保留）

- `packages/neuro-book-manager`、`desktop/`；
- `scripts/build`、`scripts/release`、`scripts/install`、`scripts/deploy`，以及只服务它们的 `scripts/utils` 文件；
- `RELEASE.md`；
- `.github/workflows` 中的 `release-container.yml`、`release-manager.yml`、`product-platforms.yml`、`product-runtime-baselines.yml`、`desktop-envelope-contract.yml`、`deploy-docs.yml`；
- 根 `package.json` 中对应的脚本（`product:*`、`release*`、`manager:*`、`desktop:*`、`package:*`、`docker:*`、`test:install`、`test:windows-owned-process`、`test:desktop-contract`、`docs:stage/dev/build/preview` 等）。

`packages/neuro-book-contracts` 与 `patches/` 保留：旧包依赖它们。

**C. 归档到 `docs/archived/`**（保留原目录结构，归档目录的 README 写明“不是当前合同，只作参照”）

- Spec：`agent/*`、`media/*`、`ui/model-role-selection.md`、`ui/agent-conversation-view.md`、`ui/agent-profile-settings.md`，登记表移除对应行；
- 代码规范：`agent-assets.md`、`database.md`、`delivery.md`、`desktop/`、`docs-site.md`、`server.md`、`workspace-assets.md`、`tooling.md`（Nuxt 配置相关），规范路由表同步；`frontend.md`、`components.md` 等保留，路径表述按新结构改写；
- `vitepress/` 用户文档站；`docs/testing/manual-eval/`（旧产品的人工评测）。

**D. 把仍有效的设计文档移到仓库级**

- `docs/adr/`（新建，带 README）：迁入 ADR 0022，新写 ADR 0023（去掉 Nuxt、Vue + Vite、Bun + Hono、TypeBox）；
- `docs/proposals/`：迁入 `extensible-application-platform.md`、`project-file-foundation.md`、`workbench-view-host.md`；
- `docs/research/vscode/`：迁入 VS Code 调研；
- 其余文档随旧包留在 `packages/neuro-book-legacy/docs/`；所有指向它们的链接改到新位置。

**E. 入口与治理**

- 改写根 `AGENTS.md`（结构图与路由表）、`README.md`、`PROJECT-STATUS.md`、`packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md`、`docs/specs/README.md`、`docs/standards/code/README.md`、`.omp/RULES.md`；
- `scripts/ci/` 的治理与文档检查按新结构调整，旧包排除在检查之外；
- `.agents/skills/` 中引用旧路径的条目改到新位置或旧包；
- 仍为 `implemented` 的 `runtime.*`、`platform.*`、`workbench.*`、`ui.*` Spec 在登记表注明“实现迁移中”，证据指向 `neuro-book-legacy`。

行为合同未变：本步只移动、删除、归档与改写入口文档，不改产品行为。

## 验收

1. `bun install` 成功（含旧包依赖）。
2. `docs:check` 与 `governance:check` 的 `failures` 为空（t40 起存在的 `product-command.test.ts` 跨根导入违规随旧包排除与 `scripts/build` 删除消失）。
3. 保留下来的包（`nb-ui`、`nb-*`、`neuro-agent-harness`、`llmlint`、`owned-process`、`file-snapshot-cache`、`neuro-book-test-support`、`neuro-book-contracts`）各自的类型检查与测试结果与整理前一致。
4. 根入口文档描述的目录结构与实际一致；仓库内没有指向已删除或已移动路径的活跃链接。

## 当前状态

2026-10-03 完成，由主 Agent 直接执行。

**实际改动：**

- **A**：`git mv packages/neuro-book packages/neuro-book-legacy`（3726 个文件）；旧包包名改为 `@notnotype/neuro-book-legacy`，去掉 `@notnotype/neuro-book-manager` 开发依赖与指向根 `scripts/build` 的 `nuxt:build`（旧包自己 `scripts/build` 下的命令保留）。原路径建占位包，只有 `package.json`、`README.md`、`AGENTS.md`。
- **B**：删除 Manager、`desktop/`、`scripts/{build,release,install,deploy}`、`RELEASE.md`、6 个交付 workflow；`scripts/utils` 只留仍被治理脚本使用的 `process.mjs` 与 `workspace-roots.ts`；随交付链与文档站一起删除只服务它们的 `scripts/ci/{stage-docs-locales,tutorial-assets,baseline-change-scope,validate-nitropack-patch}.ts` 与 `scripts/types/yazl.d.ts`；根 `package.json` 删除 34 条脚本，workspaces 去掉 Manager、加入旧包。
- **C**：归档目录定名 `docs/archived/`（与检查脚本既有的归档约定一致），内容按清单归档；旧的 `PROJECT-STATUS.md` 归档为 `docs/archived/project-status-2026-08-17.md`，按现状重写。
- **D**：整个 `docs/research/`（含 VS Code 调研与开发者在旧位置未提交的研究 README 改动，按开发者要求原样搬入，只改首句路径与两个相对链接）、ADR 0022、三份设计稿移到仓库级；新建 `docs/adr/README.md` 与 ADR 0023。
- **E**：现行文档的相对链接按“旧位置解析 → 映射新位置 → 重算相对路径”批量改写（52 个文件、320 条，先 dry run）；指向已删除文件的链接与正文提法逐处手改。入口文档、Spec 登记表（新增“旧应用的规范与 Reference”一节，11 项标“实现迁移中”）、代码规范路由、测试规范、模块边界、两个开发技能按新结构改写。治理与文档检查：归属账本与历史 Task 的 owner 根改指旧包；去掉 `test:agent-state-root`、发布合同与文档站的检查及其死代码；CI 只保留治理、社区文件与文档检查和自治包矩阵，新应用的 job 随第 3 步加入。

**验收：**

1. `bun install` 成功，移除 Manager 依赖共 116 个包，`bun.lock` 同步更新。
2. `docs:check`、`governance:check` 的 `failures` 均为 0；t40 起存在的 `product-command.test.ts` 跨根导入违规已消失。文档检查警告由 89 条变为 137 条，新增 48 条全部是历史 Task README 指向已移动文件的旧链接，按“历史记录不回改”保留。
3. 根脚本测试 5 个文件 186 个用例通过（整理前 54 个文件中，其余属已删除的 build、deploy、install、release 目录），脚本类型检查 0 错误。保留的 13 个包整理前后类型检查与测试的退出码逐项相同（`packages-before.txt` 对 `packages-after.txt`）；整理前已失败的项原样保持：`nb-ui` 测试 5 个用例（colorway）、`llmlint` 类型检查与测试（web 岛缺 `diff-match-patch`）、`neuro-book-test-support` 测试 1 个用例（paths）。
4. 根入口文档描述的结构与实际一致。

证据见 [evidences/](evidences/)。

**后续事项：**

- `docs:check` 的组件同名文档检查仍指向 `packages/neuro-book/app/components/common/`，新应用的组件位置在第 4 步确定后同步。
- 根 `package.json` 的依赖仍是旧应用依赖的镜像（旧包依赖照装需要），旧包退出时清理；`patches/nitropack` 补丁同理保留。
- `neuro-book-contracts` 的交付链出口不再维护，旧包退出时清理。

## 下一步

第 2 步：内核抽成 `nb-runtime` 包。
