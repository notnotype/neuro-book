---
schema: nbook.task/v2
taskId: t01-startup-exit-api-auth
---

# 启动失败有序退出与 API 路径认证修复

## 目标

1. Product 启动失败时记录原因并经关闭控制器有序退出，不再依赖会被 Nitro 吞掉的未捕获异常。
2. `/api/` 下的路径只按显式白名单公开，不再按扩展名判为静态资源。

## 授权

开发者 2026-09-30 指示“1，2 可以一起修”。本地实现与本地提交随 Task 交付；push 与 PR 需另行授权。

## 当前状态

已实现并通过聚焦测试。2026-09-30 经开发者授权 push 并开 [PR #245](https://github.com/notnotype/neuro-book/pull/245)；按开发者要求，等 master 上正在进行的工作完成后再合并。

改动：

- `packages/neuro-book/server/runtime/product-startup.ts`：新增 `exitOnProductStartupFailure`，记录 `runtime.startup.failed` 致命诊断后经 `productShutdownController.requestProcessExit(1)` 有序退出；已请求的租约失效退出码 75 保持优先（控制器既有规则）。
- `packages/neuro-book/server/middleware/00-product-startup.ts`：启动失败改为调用上述函数，不再 `setImmediate` 抛出。
- `packages/neuro-book/server/middleware/auth.ts`：`/api/` 路径只按 `publicApiPaths` 白名单公开，不再按扩展名判为静态资源；`/_nuxt/`、`public` 下的静态资源规则不变。
- 测试：`00-product-startup.test.ts`（新增，启动失败交给有序退出）、`product-startup.test.ts`（记录诊断并请求退出码 1）、`product-shutdown-controller.test.ts`（75 之后再请求 1 仍以 75 退出）、`auth.test.ts`（以扩展名结尾的 API 路径不公开，静态资源仍公开）。

## 验证

- `bunx vitest run server/middleware/ server/runtime/product-startup.test.ts server/runtime/shutdown/`（在 `packages/neuro-book`）：8 个文件、31 个测试通过，无未处理错误。
- 回归有效性：把中间件还原为 master 版本后，新增的中间件测试失败。
- `bun run typecheck`：30 个错误，全部位于未改动的文件（`server/workspace-history/tracked-workspace-files.ts` 22 个、`app/component-lab/fixtures/*` 5 个、`server/api/workspace-files/batch.post.ts` 3 个），本次改动的文件为 0 个；推断为 master `6faecf81` 的既有基线，未另行在 master 上复跑确认。
- 未在真实产品构建上复现或验证进程退出；启动失败时的根因依据 nitropack 2.13.4 `runtime/internal/utils.mjs` 的 `trapUnhandledNodeErrors` 源码与 w00017 t27 G0 的实测。
- worktree 初始化需要先执行 `bunx nuxt prepare` 与 `bun run generate`，否则测试因缺少 tsconfig 与 Prisma 客户端失败（环境问题，非本次改动）。

## 下一步

等 master 上正在进行的工作完成后合并 PR #245。本修复不阻塞 w00017：认证修复与 w00017 无冲突；启动失败修复只在 `server/runtime/product-startup.ts` 及其测试上与 w00017 冲突，w00017 阶段 1 的自有入口会以同样语义取代这段代码，同步时保留“启动失败即有序退出”的行为。

## 依据

- w00017 t27 G0 报告的发现 4（本地分支 `refactor/w00017-runtime-foundation`）；nitropack 2.13.4 `runtime/internal/utils.mjs` 的 `trapUnhandledNodeErrors`。
- w00017 设计审查：`isPublicPath` 的扩展名规则覆盖 `/api/`。
