# 任务说明：修复 w00017 分支的测试与类型检查基线（w00017 t30）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑全部验证并决定验收。用简体中文写最终汇报。

## 背景

分支 `refactor/w00017-runtime-foundation` 刚同步了 master（见 `.agents/works/w00017-application-runtime-architecture/tasks/t29-master-sync/README.md` 与同目录 `evidences/`）。对照结果：

- 全量 `bun run test`（在 `packages/neuro-book`）有 416 条测试只在本分支失败、在 master 上通过，清单见 `t29-master-sync/evidences/failing-tests-comparison.txt` 的“仅 w00017 基线失败”一节（25 个文件）。已知根因：
  1. t25 把 Project 代次的 owner 移进了 `runtime.application`（见 `server/runtime/product-project.ts`、`server/runtime/product-startup.ts`），打开 Project 的测试没有建立运行实例，报 “Product runtime 未就绪，不接纳 Project generation”；`neuro-agent-harness.test.ts` 一个文件就有 195 条，另有 `drainBackgroundTasks` 读不到的连带错误。
  2. `server/config/config-service.test.ts` 报 “Project test owner未关闭，不允许重置”，一个失败导致后续用例连锁失败。
  3. `server/runtime/product-startup.test.ts` 有 3 条写死 Windows 路径 `C:/state`，本机是 Linux。
  4. 其余文件（file-tools、workspace-files、api/workspace-files、session-attachment 等）请逐个查明根因。
- `bun run typecheck:runtime-foundation` 有 92 个错误（原始输出 `t29-master-sync/evidences/typecheck-runtime-foundation.txt`），集中在 `../nb-ui/src/composables/useSashGesture.ts`、`app/utils/workbench/storage-migration-legacy-bucket.ts`、`app/utils/storage/client-identity.ts`、`server/utils/auth.ts`（`createError` 等 Nuxt 自动导入）、`app/features/files/files-client.ts` 等。t09、t13 时这项是 0 错误，推断是 Files 切片把依赖 Nuxt 自动导入的产品代码带进了这个独立配置的检查范围。
- `bun run typecheck`（nuxt）有 7 个错误，来自 master 的 Lab 场景：`app/component-lab/fixtures/AgentExtraPanels.scenes.ts` 4 处、`AgentSidebarView.scenes.ts` 1 处缺 `width`，`fixtures/index.ts` 2 处。

## 目标（全部满足才算完成）

1. 在 `packages/neuro-book` 运行 `bun run test`：上面 416 条全部通过；不新增任何其它失败。允许仍然失败的只有 master 基线也失败的那些（`failing-tests-comparison.txt` 的“两个基线都失败”与“仅 master 基线失败”两节，共 25 条）。
2. `bun run typecheck:runtime-foundation`：0 个错误。
3. `bun run typecheck`：0 个错误。

## 做法要求

- **修根因，不绕过。** 禁止：`it.skip`、`describe.skip`、删测试、放宽或删除断言、在产品代码中加“测试环境专用”的分支或开关、用 `any` 与 `as unknown as` 压类型错误、为通过测试改变产品行为。
- **Project 代次 owner：** 测试应经过正规的 owner 取得 Project 代次，例如提供一个测试用的运行实例或 owner 辅助函数（放在测试支持代码里），并在每个测试后正确关闭。先读 `product-project.ts` 与 `product-startup.ts` 理解 owner 的合同，不要削弱“Product runtime 未就绪时不接纳 Project generation”的检查。
- **类型检查范围：** `typecheck:runtime-foundation` 的用途是独立检查运行时机制、宿主适配器与最小消费者，不依赖 `.nuxt` 生成态（见 `.agents/works/w00017-application-runtime-architecture/implementation-plan.md` 的“第一片验证命令”）。如果错误来自不属于这一范围、依赖 Nuxt 自动导入的产品代码被间接纳入，合理的修法是让机制代码不再依赖这些产品模块，或者让这些产品模块显式导入所需函数；只是把文件从配置里排除掉，必须在汇报中说明为什么它本来就不属于这个范围。
- **平台无关：** 路径断言用 `path` 与临时目录，不写死盘符或分隔符。
- **真实产品缺陷：** 如果某个失败其实暴露了产品缺陷，做最小修复，并在汇报中单独列出（现象、根因、修法）。
- 仓库规则见 worktree 根目录的 `AGENTS.md`；测试与临时根规则见 `docs/testing/README.md`；TypeScript 规范见 `docs/standards/code/`。

## 约束

- 只在 worktree `/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation` 中工作。不要改动主工作区 `/home/notnotype/CodeRepository/neuro-book`。
- 不要 `git commit`、`git push`、`git stash`、切分支、改 git 配置。不要改 `packages/neuro-book/docs/research/README.md`（开发者未提交的改动）。
- 不要改 Spec、设计稿、ADR 与 Work/Task 文档（本 Task 的 `evidences/` 除外）。
- 全量测试约 5 分钟；调试时优先跑单个文件（`bunx vitest run <文件>`），最后再跑全量。
- 不要设置 http_proxy，不改时区与 locale；运行数据只放系统临时目录，不触碰用户数据；不要留下后台进程。

## 交付

1. 把最终三项验证的原始输出保存到 `.agents/works/w00017-application-runtime-architecture/tasks/t30-branch-test-baseline/evidences/`：`test-full.txt`、`typecheck-runtime-foundation.txt`、`typecheck.txt`。
2. 最终汇报：
   - 三项目标是否全部达成；全量测试里剩余的失败逐条对照 master 基线清单；
   - 每个根因、修法与涉及的文件；
   - 暴露出的真实产品缺陷（如有）；
   - 对类型检查范围所做的调整及理由；
   - 完整的改动文件列表。
