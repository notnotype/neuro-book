# 任务说明：阶段 1 生命周期 smoke 与当前基线（w00017 t31）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

NeuroBook 正在把进程生命周期交给自己的内核（设计：`packages/neuro-book/docs/proposals/extensible-application-platform.md` 的 P6、P7、P11；行为合同：`docs/specs/runtime/server-host.md`、`docs/specs/runtime/browser-host.md`，二者为 `planned`）。阶段 1 的完成标准是一个自动化 smoke 全部通过。本任务**先写这个 smoke，并在当前代码上跑出基线**，不改产品行为。

## 目标

在 `packages/neuro-book/scripts/smoke/product-lifecycle.ts` 新增 smoke，并在 `packages/neuro-book/package.json` 加脚本 `smoke:product-lifecycle`。每个检查项的结果是 `pass`、`fail` 或 `pending` 三者之一：

- `pending`：当前代码还不具备被检查的能力（例如内核还没有输出激活顺序的诊断），并写明缺什么；
- `fail`：能力应该存在但行为不对。

脚本把 JSON 报告写到参数指定的路径（每项含 id、结果、耗时、证据摘要与原始日志路径），同时在终端打印一张汇总表。存在 `fail` 时退出码非 0；只有 `pass` 与 `pending` 时退出码为 0。支持 `--only <id,...>` 只跑部分检查，`--skip-build` 复用已有的 `.output`。

## 检查项（阶段 1 的全部目标）

| id | 对应 Spec 场景 | 检查内容 |
|---|---|---|
| L1 | server-host 6、browser-host 1 | 生产构建经 Manager 的就绪探测启动；Chromium 登录后主页工作台渲染，资源管理器列出临时 Project 中预置的文件 |
| L2 | plugin-manifest 11 | 运行时诊断中，内置插件入口的激活顺序满足依赖关系（依赖先于依赖者） |
| L3 | server-host 3 | 有一个在途的长请求时发 SIGTERM：新请求得到 503，在途请求正常完成，关闭按依赖逆序（从诊断读取），进程以 0 退出，租约锁已释放 |
| L4 | server-host 4 | 与 L3 相同，但经 Manager 的停止函数（`PRODUCT_SHUTDOWN_PATH` 控制请求）停止 |
| L5 | server-host 2 | 临时 State Root 未迁移：进程写出致命诊断后以 1 退出，在限定时间内（建议 30 秒）结束，没有残留监听 |
| L6 | server-host 5 | 就绪后使 Session Store 租约失效：进程以 75 退出 |
| L7 | server-host 7 | 开发模式（`nuxt dev`）：触发一次服务端热重载后，后续请求不出现持续的 500，新实例持有租约 |
| L8 | server-host 8 | 开发模式：对 dev 进程发 SIGTERM，运行实例有序停止后进程退出，租约锁已释放 |
| L9 | browser-host 2 | 页面打开后服务端停止：刷新得到连接失败页（不是半个工作台）；服务端恢复后重试成功 |
| L10 | browser-host 4 | 两个窗口：关闭其中一个，另一个照常工作，服务端不停止 |

“长请求”优先用现有接口自然产生（例如读取大文件时客户端慢速消费），不要为了 smoke 往产品里加测试路由。如果某项确实需要产品提供钩子才能检查，把它标为 `pending` 并在汇报中说明需要什么钩子，不要自己加。

## 可复用的材料（先读）

- `docs/testing/README.md`：临时根、证据与清理规则，必须遵守。
- `packages/neuro-book-test-support/src/`：临时目录与进程工具。
- `.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g0/harness/prod-harness.ts`：已验证过的做法，用 Manager 的 `applicationEnvironment`、`waitForApplicationReady`、`shutdownNativeProduct` 与 owned-process 驱动 `.output`，包括创建 admin 与迁移临时 State Root。`dev-env.sh`、`dev-reload.sh` 是开发模式的做法。G0 报告：同目录的 `../REPORT.md`。
- `.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g2/lease/`：模拟租约被接管或失效的做法。
- `packages/neuro-book/scripts/smoke/component-lab.ts`、`runtime-foundation.ts`：仓库里 playwright-core 驱动浏览器的写法。本机 Chromium 可用 `/usr/bin/google-chrome-stable`，同时提供 `--browser-executable` 参数。

## 约束

- 只能新增 `packages/neuro-book/scripts/smoke/product-lifecycle.ts`（必要时在 `scripts/smoke/product-lifecycle/` 下拆分辅助文件），以及修改 `packages/neuro-book/package.json` 中的 scripts 一行。**不得修改任何产品代码**，也不修改其它文件。
- 所有运行数据放在系统临时目录下自建的临时根，结束后清理；不触碰 `~/.neuro-book`、仓库根 `workspace/` 或任何用户数据。
- 端口用运行时分配的空闲端口，不要用 3000、3001（开发者可能在用）。
- 不要 `git commit`、`git push`、`git stash`、切分支，不改 git 配置。不要设置 http_proxy，不改时区与 locale。不要启动后不清理的长期进程；每个子进程在 finally 中收口。
- 仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。

## 完成标准

1. `bun run smoke:product-lifecycle -- --report <路径>` 能在本机完整跑完（含一次生产构建），不挂住、不残留进程与临时目录。
2. 在当前代码上的基线结果：每一项都有明确的 `pass`、`fail` 或 `pending`，且原因可信。已知预期：L5 应为 `pass`（启动失败退出的修复刚合入）；L7、L8 大概率为 `fail`（issue #244）；L2 与 L3、L4 中的关闭顺序部分大概率为 `pending`。
3. 你自己把完整跑一遍的 JSON 报告与终端输出保存到 `.agents/works/w00017-application-runtime-architecture/tasks/t31-product-lifecycle-smoke/evidences/baseline-report.json` 与 `baseline-output.txt`。
4. 在包目录下运行 `bun run typecheck:runtime-foundation` 不新增错误；如果 smoke 脚本不在该配置覆盖范围内，说明你用什么方式做了类型检查。

## 最终汇报

1. 结论：基线里各项的 pass、fail、pending；
2. 每个检查的实现方式与判定依据（一两句）；
3. 标为 `pending` 的项各缺什么能力；需要产品钩子的列出建议；
4. 运行一次的总耗时，以及哪一步最慢；
5. 改动的文件列表。
