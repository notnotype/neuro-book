# dev-panel 包入口

本包位于 `packages/dev-panel`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/dev-panel` 是开发者项目面板与命令行 `nbdev` 的核心库，是开发工具，不是 NeuroBook 产品功能：不进 Product、Desktop 与发布产物，不改 `docs/specs/`。方案与取舍见 [Proposal](../../docs/proposals/dev-panel.md)，术语与不变量见 [`CONTEXT.md`](CONTEXT.md)，命令行合同见 [`docs/cli.md`](docs/cli.md)，面板见 [`docs/panel.md`](docs/panel.md)，文件格式见 [`docs/file-formats.md`](docs/file-formats.md)，herdr 的接口、白名单与降级见 [`docs/herdr.md`](docs/herdr.md)。

## 边界

- Owner：w00022（开发者项目面板）。公开合同是 `src/index.ts` 的导出面与 `nbdev` 的命令行合同。
- 依赖方向：不依赖 `@notnotype/neuro-book`，不导入根 `scripts/`；根 `scripts/ci/dev-panel-records.test.ts` 导入本包公开入口，是允许的方向。面板要的治理入口行数上限按文本读 `scripts/ci/agent-governance-contract.ts`（`src/core/governance-limits.ts`，不执行它），根测试核对读出的与治理检查导出的一致。
- `src/index.ts` 与 `src/core/` 只用 Node 兼容 API（根脚本测试在 Node 下导入它们），由两层保证：`tsconfig.core.json` 只带 Node 类型，并把 `bun`、`bun:*` 指到空模块 `types/no-bun-in-core.d.ts`，类型检查拦住 `Bun` 全局与从 bun 模块取导出；`scripts/ci/dev-panel-records.test.ts` 在 Node 下导入公开入口，运行时再拦一次。不要在核心里用 `Bun.*` 或 `bun:*`。
- 记录锁是本包自己实现的目录锁（`src/core/lock.ts`），持锁者是否存活按 `/proc/<pid>/stat` 的启动时刻判断，没有心跳；不要换回按 mtime 判过期的锁库。
- 只支持 Linux。
- `src/server/` 是面板服务（Bun），只在 `nbdev panel serve`、`panel open` 里按需导入，命令行的其它命令不加载它；合同见 [`docs/panel.md`](docs/panel.md)。写接口（`src/server/writes.ts`）只调核心函数，不另写写逻辑；新的写入先写成核心函数（命令行以后可以直接用）。
- 页面解析用 `parse5`，只在发布路径里经 `parseQuestionMarkup` 按需导入；`status` 等读取路径不能加载它（`tests/artifacts-cli.test.ts` 用 `tests/no-parse5-preload.ts` 检查）。

## 测试

- 用 `bun test`；临时目录用 `@notnotype/neuro-book-test-support/tmp` 的 `createTestTmpRoot`，仓库建在临时根的子目录里（根目录有测试支持包的标记文件）。
- Git 夹具见 `tests/git-fixture.ts`：子进程环境隔离开发者的全局配置，并设 `GIT_CEILING_DIRECTORIES`，不会爬到外层仓库。
- 测试不碰真实仓库的 `.agents/works/` 与 `.local/agent/`；在真实仓库运行命令行属于验收，按 Task 记录执行。发布、提问、答复只在临时仓库里测：真实仓库第一次用 nbdev 写要开发者授权。
- 测试不碰默认 herdr：`tests/git-fixture.ts` 在导入时按前缀删掉 `HERDR_*`、`CLAUDE*`、`OMPCODE`，并把 `HERDR_SOCKET_PATH` 指到不存在的路径；需要 herdr 的 L3 用 `tests/fake-herdr.ts`。L4（`tests/herdr-live.test.ts`）只用命名会话 `nbdev-test`，herdr 子进程只拿 HOME、PATH、TERM，用完停 server、删会话；本机没有 herdr 时跳过，记为未验证。t12 的终端流另用主工作区里不入库的 herdr 0.9.1 二进制当命名会话的 server 跑一组（路径见测试），二进制不在时这一组跳过；网页终端的 L3 用 `tests/fake-herdr-cli.ts` 扮 herdr 命令行。t14 的开发服务只用假开发脚本（`tests/fixtures/fake-dev.ts`，经临时 `package.json` 由真实的 `bun run` 起），在临时仓库里起；GitHub 页用假 `gh`（`tests/fixtures/fake-gh.ts`）。测试不在真实仓库上起开发服务、不建 worktree。
- 扮成 Claude 主进程（`CLAUDE_PID`）时用 `tests/processes.ts` 的 `startFakeClaude`，经它运行 nbdev：nbdev 要求 `CLAUDE_PID` 是调用者的祖先；也不能用测试进程自己扮，从真实 Claude 会话里跑起来的测试进程，`/proc/<pid>/environ` 里带着那个会话的 id，会被当成嵌套调用。L4 里扮成 Claude 的进程还要在 pane 的前台（写标签前会核对），由 `herdr pane run` 在 pane 里运行 `tests/l4-claude-pane.ts`。
- 等子进程就绪用 `spawnMarked`（轮询到 `/proc/<pid>/environ` 带上标记），结束用 `stopProcess`（等到 `exit`），不用固定等待。

## 面板前端

- 前端在 `src/web/`（Vue 3 加 Vite，组件来自 nb-ui，分栏来自 nb-layout），合同见 [`docs/panel.md`](docs/panel.md#前端)。`tsconfig.json` 排除 `src/web`，前端的类型检查走 `tsconfig.web.json`（`vue-tsc`，已并进 `typecheck`）；构建 `bun run --cwd packages/dev-panel build:web`，产物 `dist/web/` 不入库。
- 零件（`src/web/parts/`）遵守 [组件规范](../../docs/standards/code/components.md)：同名 `.md`、能力标签、只经 props、emits、slots 连接；页面与外壳是宿主，写请求、定时器、`beforeunload`、剪贴板都在页面里。偏好只经 `src/web/host/prefs.ts` 读写浏览器存储。
- 前端的字段校验直接导入核心的纯模块（`src/core/text-rules.ts`、`questions.ts`、`ids.ts`），不复制规则；这几份模块不能加 `node:` 依赖，否则 `vue-tsc` 与前端构建会失败。
- 服务端测试不依赖 `dist/web`：`startPanelServer` 之后用 `setStatic` 注入桩页面（见 `tests/panel-server.test.ts`）。
- 浏览器验收用 Playwright 加本机的 `/usr/bin/google-chrome-stable`（`chromium.launch({executablePath})`），在临时仓库上起 `nbdev panel serve`，用 `nbdev panel open --print` 拿登录链接；截图留在本地 `.local/agent/works/<workId>/tasks/<taskId>/shots/`，不入库。面板进程用会话的后台机制起，记下 PID、日志写文件，用完发 SIGTERM（它会删 `panel.json`、放锁）。
- 涉及尺寸、溢出或滚动的浏览器验收，`launch` 要加 `ignoreDefaultArgs: ["--hide-scrollbars"]`：Playwright 起的无头 Chrome 缺省不画滚动条，滚动条占位挤掉的行列在验收里看不出来（t12 接管后又改一次尺寸就是这样漏掉的）。

## 完成门禁

```text
bun run --cwd packages/dev-panel typecheck
bun run --cwd packages/dev-panel test
bun run --cwd packages/dev-panel build:web
bun x vitest run --config scripts/vitest.config.ts scripts/ci/dev-panel-records.test.ts
```

触及包级文档或本文件时，另跑仓库门禁 `bun run governance:check` 与 `bun run docs:check`。
