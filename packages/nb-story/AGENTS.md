# nb-story 包入口

本包位于 `packages/nb-story`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-story` 是剧情图谱：把抽好的 V9 小说记忆图收进本机书库，按“读到哪里”回答查询，提供命令行 `nbstory`、网页查看器的独立服务与给外部 Agent 的 Skill。行为合同见 [`story/queries.md`](../../docs/specs/story/queries.md)、[`story/viewer.md`](../../docs/specs/story/viewer.md)、[`story/cli-skill.md`](../../docs/specs/story/cli-skill.md)、[`story/qa.md`](../../docs/specs/story/qa.md)；方案见 [提案](../../docs/proposals/novel-story-app.md)。

## 边界

- Owner：w00024（nb-story）。公开合同是核心库入口 `src/core/index.ts`（`.`）、查询接口合同 `src/contract/` 与 `nbstory` 的命令行合同。
- 依赖方向：只依赖 `@notnotype/nb-runtime` 的 `./remote`（合同写法）、`@notnotype/nb-ui`（网页）、`@notnotype/nb-layout`（网页的分栏，只进前端构建，devDependencies），内置问答用的 `@notnotype/nb-harness`、`@notnotype/nb-profile`、`@notnotype/nb-session`，以及网页问答页与设置页用的 `@notnotype/nb-agent-ui`、`@notnotype/nb-markdown`、`@notnotype/nb-form` 与 `eventsource-parser`（只进前端构建）；不依赖 `@notnotype/neuro-book` 与 `packages/nb-memory`，不导入根 `scripts/`。
- 内置问答（`src/qa/`，[`story/qa.md`](../../docs/specs/story/qa.md)）经 nb-harness 用 OMP，只能跑在 Bun 上，也只有它依赖那三个包；`src/core/` 不导入 `src/qa/`。命令行只在 `ask` 与 `serve` 时加载它，其余命令不加载 OMP。OMP 一被导入就接管 SIGINT、SIGTERM、SIGHUP：`ask` 经 nb-harness 的 `onProcessInterrupt`、`serve` 经 `onProcessTermination` 收口，不要另装 `process.on(信号)`（拦不住它的退出）。
- 命令行：`src/cli/commands.ts` 的命令表是命令、位置参数、选项与解码器的唯一来源，`src/cli/program.ts` 用 commander 切词并生成按命令的 `--help`（位置参数个数与取值仍由 `decodeArguments` 检查，用法错误的中文提示留在那里）。`nbstory config init` 的交互用 `@clack/prompts`，只在交互路径里动态导入（`src/cli/config-init.ts`）。
- 网页（`src/web/`）只引本包的 `src/contract/`（不碰 node 的合同、问答记录与配置的 schema、出处的认法），不引 `src/core/`、`src/qa/`、`src/server/`；网页要的纯逻辑放进 `src/contract/` 或 `src/web/` 自己的模块。
- `src/core/` 与 `src/contract/` 只用 Node 兼容 API：以后插件在 NeuroBook 的 Node 环境里直接调用。`tsconfig.core.json` 只带 Node 类型，并把 `bun`、`bun:*` 指到空模块 `types/no-bun-in-core.d.ts`。不要在这两个目录里用 `Bun.*` 或 `bun:*`。
- 不剧透的过滤只在核心库里做：查询只经 `src/core/projection.ts` 的视图取数，不直接读索引里的数组；命令行、服务与网页不另外过滤或补数据。
- 命令行（`src/cli/`）只有 `serve` 才加载服务端代码（`src/server/`）；服务单实例靠 `@notnotype/nb-flock` 的文件锁（`bun:ffi` 调 `flock` 或 `LockFileEx`），支持 Linux、macOS 与 Windows。
- 用户对图的修订（[`story/revisions.md`](../../docs/specs/story/revisions.md)）存在书目录的 `revisions-<版本>.json`，只经 `src/core/overlay/` 读写：套用在 `openBookIndex` 里、`settle` 之前（`applyOverlay`），写入靠“临时文件加硬链接按版本只创建一次”，不要改成直接覆盖。代码里叫 overlay，因为 `BookMeta.revision` 已经是数据版本。
- 书库的并发与原子性靠同一文件系统内的 `rename`（见 `src/core/library.ts` 模块头）；不要改成“先写目标再补”的写法。
- 抽取（`src/ingest/`，[`story/ingest.md`](../../docs/specs/story/ingest.md)）的编译、“已有记录”与提示词搬自 w00005 t27、t29（来源见各模块头）。发给模型的文字（提示词、规则、“已有记录”每一行的写法）必须逐字不变：抽取质量是用那份文字验证的，`context.test.ts` 对照当时实际发出的请求；要改就另做质量对照。普通章的“已有记录”只详列与本章相关的行（w00024 t10，选法见 ingest.md 输出 4），也按这条规矩：改选法要重跑 t10 的回归。
- 抽取的模型调用（`src/ingest/model.ts`）直接用 `openai` SDK，不经 nb-harness：OMP 一次调用里自带最多 6 次重试、端点拒绝 `minimal` 时自动降成 `low`，都关不掉，而抽取要自己按延迟表重发、不降档。抽取线程与 `nbstory ingest` 不加载 OMP：它一被导入就接管中断信号、跑完清理就退出进程，`nbstory ingest` 要等任务停下、放锁后才退出。所以问答与抽取共用的 `src/qa/config.ts` 不导入 nb-harness，转换到 nb-harness 模型的部分在 `src/qa/harness-model.ts`。

## 测试

- 用 `bun test`；临时目录用 `@notnotype/neuro-book-test-support/tmp` 的 `createTestTmpRoot`。
- 测试与被测源码同目录（`<module>.test.ts`）；测试工具与子进程入口放 `testing/`，不含断言。
- 样例书是 `tests/fixtures/sample-100ch.json.gz`（来源见同目录 README），Spec 验收里的数字都按它；`testing/sample.ts` 负责解压与建临时书库。
- 并发导入、中途结束进程、服务登记这类跨进程合同用真的子进程测；命令行与服务的测试经 `testing/processes.ts` 跑真实的 `nbstory` 与 `serve`，用完在 afterEach 里收口。

## 完成门禁

```text
bun run --cwd packages/nb-story typecheck
bun run --cwd packages/nb-story test
```
