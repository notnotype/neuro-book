---
schema: nbook.task/v2
taskId: t45-nb-runtime-package
---

# NeuroBook v2 第 2 步：内核抽成 `nb-runtime` 包

## 目标与范围

按 [NeuroBook v2：并排重建应用](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 方案第 3、5、6 节，把旧应用的内核 `packages/neuro-book-legacy/runtime/` 整理后搬入新包 `packages/nb-runtime`（`@notnotype/nb-runtime`），供新应用的前后端宿主共用。开发者 2026-10-03 决定：本步由主 Agent 编码，完成后交 omp 审查。

- **内容**：`lifecycle`、`services`、`plugins`、`application`、`diagnostics` 五个机制连同合同测试，目录结构与模块间的依赖方向不变；只改与包位置有关的内容（导入的测试运行器、注释里旧应用的路径）。
- **公开入口**：每个机制一个子路径（`@notnotype/nb-runtime/lifecycle` 等），对应原来各目录的“唯一公开入口”文件；不另设汇总入口。
- **依赖**：运行时零依赖；测试用 `bun test`（通用包的仓库约定），由 `vitest` 改为 `bun:test`。
- **旧应用**：`packages/neuro-book-legacy/runtime/` 保持原样（旧应用只读）。
- **登记**：根 workspaces、CI 自治包矩阵、包与模块边界文档、仓库结构图；`runtime.lifecycle`、`runtime.services`、`runtime.plugins`、`runtime.diagnostics`、`runtime.application` 五份 Spec 的证据与实现合同里的路径改指新包。宿主相关的 smoke 仍在旧应用，随第 3 步在新应用重建。

行为合同未变：只搬移代码，不改内核行为。

不在本步：后端与浏览器宿主（`server/runtime/foundation`、`app/runtime`）、内置服务插件、`nbook.http`，属第 3 步。

## 验收

1. `packages/nb-runtime` 的 `bun run test` 通过，用例数与旧位置一致（旧位置在 `vitest.runtime-foundation.config.ts` 下为 10 个文件 166 个用例）。
2. `bun run typecheck` 0 错误。
3. `package.json` 没有 `dependencies`；源码只有包内相对导入（由各机制的边界测试检查）。
4. `docs:check`、`governance:check` 失败为 0；`test:affected --dry-run` 能选中新包。
5. omp 审查无未处理的阻断意见。

## 当前状态

2026-10-03 完成：主 Agent 编码（`9c513eb3`），omp 审查后按意见修正。

**实际改动：**

- `packages/nb-runtime`：`package.json`（零 `dependencies`，五个子路径 `exports`，`test`/`typecheck` 脚本）、`tsconfig.json`、`AGENTS.md`；`src/` 自旧应用 `runtime/` 复制。与旧位置逐文件对比，源码只改了注释：框架列表由“Vue、Nuxt、Nitro”改为“UI 或 HTTP 框架”，去掉旧应用的路径（`server/runtime/foundation`、`app/runtime`、`server/app-logs`、`server/features/runtime-diagnostics`）。
- 测试由 `vitest` 改为 `bun:test`。`bun:test` 的 `toEqual`/`toContain` 按实参类型约束期望值，3 个测试文件出现 7 处类型错误，改为给期望值写明类型（`EntryBlocked`、`ActivationResult`、`RegistrationRejectionReason`）、`catalogs.at(-1)!`，回调里赋值的局部变量改用数组收集；断言含义不变。
- 登记：根 `workspaces`、`bun.lock`；CI 自治包矩阵与 `workspace-packages.yml`、`code-baseline.yml` 的路径；根 `AGENTS.md` 结构图、`packages/AGENTS.md`、`monorepo-boundaries.md`、两份 README、`PROJECT-STATUS.md`。
- Spec：五份内核 Spec 的“实现入口”“合同测试”链接与实现合同里的路径改指新包；Smoke 仍链接旧应用的双宿主 smoke，并注明它运行的是旧副本。登记表这五项标为“内核已迁入 `packages/nb-runtime`，宿主与 smoke 迁移中”，并在登记表开头说明该标记。

**验收（主 Agent 自跑）：**

1. `bun run test`：10 个文件 166 个用例通过，与旧位置逐文件计数相同（[`legacy-baseline.txt`](evidences/legacy-baseline.txt)）。
2. `bun run typecheck` 0 错误。
3. `package.json` 无 `dependencies`；各机制的边界测试通过（源码只有同目录或允许的机制入口导入，无动态 import）。
4. `docs:check`、`governance:check` 失败为 0，本次改动无新警告；`test:affected --dry-run` 选中 `nb-runtime`。

**omp 审查（`--slow`，只读）：** 无阻断，3 条建议、1 条疑问（[`omp-review.txt`](evidences/omp-review.txt)），全部采纳：

1. 旧位置基线的证据命令不能原样复现（配置里还收录了宿主测试）：改为显式列出五个内核目录的命令重新取证，仍为 10 个文件 166 个用例。
2. `runtime.plugins` 实现合同里一处测试路径只写了包内相对路径：改为仓库相对路径。
3. 源码与测试共用带 Bun 类型的配置，源码误用 `process`、`Bun` 等也能通过类型检查：新增只查源码、带 DOM、不带 Bun/Node 类型的 `tsconfig.browser.json`，`typecheck` 两份都跑。用临时探针验证：源码用 `process` 被浏览器配置拦住，用 `document` 被原配置拦住。
4. 疑问：源码用到 `Promise.withResolvers`、`AbortSignal.any`、`AbortSignal.timeout`，包里没写运行环境要求。已写进包的 `AGENTS.md`；浏览器宿主的最低版本与真实浏览器 smoke 归第 3 步。

证据见 [evidences/](evidences/)。

**后续事项：**

- 第 3 步建浏览器宿主时确定最低浏览器版本，并以真实浏览器运行 smoke（不只做 Vite 构建）。
- 五份内核 Spec 的 Smoke 仍指旧应用的双宿主 smoke，随第 3 步改指新应用。

## 下一步

第 3 步：应用骨架。
