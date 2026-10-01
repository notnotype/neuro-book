# t37 验证记录

工作目录：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation`。以下第 1–9 节记录首次交付验证；返工 1 的当前有效证据见 `delivery.md` 第 10 节。构建、smoke、开发服务、类型检查均按各自阶段串行执行，构建期间未编辑源码。证据覆盖未提交 diff，不对应新的独立 revision。

## 首次交付验证记录（返工前）

| 实际命令 | 结果 | 完整输出 |
|---|---|---|
| `bun run --cwd packages/neuro-book test -- server/runtime server/features server/middleware server/routes server/host server/api/workspace-files/events.get.test.ts server/api/projects/presence.get.test.ts server/api/agent/jobs/events.get.test.ts` | code 0；21 文件 / 148 用例通过（包含来源绑定注册信号的适配器用例，不证明 Node/Bun 无参数） | `server-tests-signal-fix.log` |
| `bun x vitest run --config scripts/vitest.config.ts scripts/build/nuxt-output-contract.test.ts` | code 0；1 文件 / 8 用例通过 | `build-contract-tests-signal-fix.log` |
| `bun run --cwd packages/neuro-book typecheck:runtime-foundation` | code 0；0 错误 | `typecheck-runtime-foundation-signal-fix.log` |
| `bun run --cwd packages/neuro-book scripts:typecheck` | code 0；0 错误 | `scripts-typecheck-signal-fix.log` |
| `bun run --cwd packages/neuro-book typecheck` | code 0；0 错误 | `typecheck-signal-fix.log` |
| `bun run --cwd packages/neuro-book smoke:runtime-foundation -- --host server` | code 0；`failures=0`；来源为 `signal:SIGTERM` | `runtime-foundation-smoke-signal-fix.log` |
| `bun run --cwd packages/neuro-book smoke:product-lifecycle -- --only L1,L2,L3,L4,L5,L6 --browser-executable /usr/bin/google-chrome-stable --report /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/evidences/lifecycle-report.json` | 首次交付 code 0；最终源码真实生产构建；`skipBuild=false`；6 项 / 18 子断言全部 pass | `lifecycle-L1-L6-signal-fix.log`、`product-lifecycle-build.log`、`lifecycle-report.json`、`L1.log` 至 `L6.log` |

最终 Product imageId：`sha256:aaa41be756879ff2be4cd743084706e856d202c9cb0687e2540887567a455be9`；入口 `.output/server/index.mjs` 不变。

## 开发模式有效参考证据

- 实际命令：`bun run --cwd packages/neuro-book dev:runtime`，日志 `development-service-final.log`；显式临时 State Root 为 `/tmp/neuro-book/runs/t37-server-host-entry/e08bdc9c-46cf-492a-a859-d9ff0d1a6b04`，端口 `44527`。
- `/api/app/version` 返回 200；隔离浏览器加载首页并显示“我的书架”，无浏览器错误。证据 `development-browser.json`、`development-home.webp`。
- 停止后端口不可连接、进程树无残留，State Root 已删除。证据 `development-service-final.log`、`process-cleanup-final.json`。
- 实际命令：`bun run --cwd packages/neuro-book smoke:product-lifecycle -- --only L7,L8 --report /home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/.agents/works/w00017-application-runtime-architecture/tasks/t37-server-host-entry/evidences/development-lifecycle-report.json`。code 1；L7 pass，L8 fail；完整输出 `lifecycle-L7-L8.log`、`L7.log`、`L8.log` 与 JSON。
- L7：Node ready、热重载、leaseId 变化、health 200 全部 pass。L8：SIGTERM 在窗口内 code 0，但 runtime lease lock/owner 未释放，fail 原文为 `SIGTERM后runtime lease锁未释放`；这是 #244 范围外问题，未掩盖。

## 其他审计

- 首次交付范围结果：40 个源码/测试文件均在 brief 允许范围；`packages/neuro-book/docs/research/README.md` 是开发者既有改动，保留且未触碰。返工恢复 `server/utils/event-stream.ts` 为 HEAD，当前返工涉及的源码/测试范围见 `delivery.md` 第 10 节。见 `repository-audit.log`、`scope-audit.json`。
- 分支：`refactor/w00017-runtime-foundation`；HEAD：`8d6b2d7ffb3a7a1bbfa85ba88b13ea5308caf697`；无提交、push、stash、分支切换或 Git 配置修改。
- 当前源码未使用全量 `bun run test`；这是 brief 明确由主 Agent 执行但本任务要求不运行的命令。无将 focused 结果冒充全量结果。
- 原 HTTP 审查关于 Node/Bun 信号监听器不接收信号名的结论已撤回；主 Agent 实测两者均收到 `["SIGTERM", 15]`。闭包绑定注册信号仅用于使来源不依赖实参，见更正后的 `http-review.json`。此前命令通过不证明原运行时断言；返工后的有效证据以 `delivery.md` 的“返工 1”小节为准。
