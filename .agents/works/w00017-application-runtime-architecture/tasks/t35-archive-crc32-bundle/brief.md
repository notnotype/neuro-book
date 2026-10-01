# 任务说明：修复生产构建中归档下载的 crc32 打包错误（w00017 t35）

你是本任务的编码者。主 Agent（Claude）会审查你的 diff、自己重跑验证并决定验收。用简体中文写最终汇报。

## 背景

t34（提交 `5808b507`）验收时发现：生产构建里下载项目归档会崩溃。`smoke:product-lifecycle` 的 L3、L4 下载 128MB 归档时，只收到 42 字节，服务端就记录了未捕获异常：

```text
TypeError: POo.unsigned is not a function. (In 'POo.unsigned(A, this.crc32)', 'POo.unsigned' is undefined)
    at <anonymous> (.output/server/index.mjs:897:96614)
    at <anonymous> (internal:streams/transform:52:18)
```

主 Agent 的初步判断（从代码推断，未验证）：`yazl` 3.3.1 用 `require("buffer-crc32")` 加载 crc32，并调用 `crc32.unsigned(...)`。`buffer-crc32` 1.0.0 通过 `exports` 同时提供 `import`（`dist/index.mjs`）与 `require`（`dist/index.cjs`）两个入口。打包时这个 `require` 很可能被解析到 ESM 入口，拿到的是模块命名空间对象，所以 `.unsigned` 为 `undefined`。产品构建包括 Nitro 的 Rollup 构建和之后的产品后处理（`scripts/build/` 下的 `product-runtime-bundle`、`product-reproducible-bundle` 等），具体是哪一步出错需要你查明。

后果：
- 生产环境的项目归档下载不可用。`server/workspace-files/workspace-archive.ts` 与 `server/app-logs/archive.ts` 都用 `yazl`。
- 崩溃的请求一直占着 Project 操作，SIGTERM 后 Project 根作用域无法关闭，直到 Nitro 60 秒后强制退出。L3、L4 的 `inflight-complete` 与 `close-order` 因此失败。

证据：`.agents/works/w00017-application-runtime-architecture/tasks/t34-builtin-service-plugins/evidences/acceptance-L3-plugins.jsonl`（产品日志，含异常栈）、`acceptance-lifecycle-report.json`。

## 目标

1. 查明出错的打包步骤与原因：哪一步把 `require("buffer-crc32")` 解析成了什么，用构建产物中的实际代码作证据。
2. 在出错的那一层修复，让 `yazl` 在生产构建中拿到可用的 crc32 实现，不改 `yazl` 或 `buffer-crc32` 的源码，不改业务代码的调用方式。优先沿用仓库已有的做法（例如 `nuxt.config.ts` 的 Nitro 配置、`scripts/build/` 里对依赖的处理与补丁约定），在汇报中说明为什么选这一层。
3. 加一个在修复前失败、修复后通过的自动检查，防止同类 CJS/ESM 互操作错误再次进入产物。形式由你按现有构建测试的写法决定，例如对构建产物执行一次真实的 zip 生成并校验 crc，或在构建检查中核对该模块的解析结果。检查要验证实际产物，不能只检查配置文本。
4. 排查产物中是否还有同类问题：其它被 `require` 的、同时提供 `import` 与 `require` 入口且导出默认值的依赖。只报告发现，不在本任务修复。

## 不做

- 归档下载取消或服务端关闭时 `/tmp/nbook-project-archive-*` staging 目录不清理的问题（已登记为后续问题）；
- 排空期间新请求返回 503、停止来源汇合、自有宿主入口（后续 Task）；
- 内核显式恢复的问题（后续 Task）；
- 升级或替换 `yazl`、`buffer-crc32`。

## 允许改动的文件

- `packages/neuro-book/nuxt.config.ts` 中与 Nitro 构建、依赖解析相关的配置
- `scripts/build/**`（仓库根目录下）及其测试
- 新增的构建检查或测试文件
- 本 Task 的证据目录 `.agents/works/w00017-application-runtime-architecture/tasks/t35-archive-crc32-bundle/evidences/`

不改：`packages/neuro-book/server/**`、`app/**`、`runtime/**`、`node_modules/**`、`docs/**`、任何 `README.md` 与 Work/Task 文档、`package.json`、锁文件、`tsconfig*.json`、`vitest*.config.ts`。确实需要改列表外的文件时，先在汇报中说明原因，不要自己改。

## 验证命令与完成标准

1. 新增的检查：修复前失败、修复后通过，两次输出都保存。
2. `scripts/build/` 下与改动相关的测试全部通过；在 `packages/neuro-book` 下 `bun run scripts:typecheck`、`bun run typecheck` 为 0 错误。
3. 在 `packages/neuro-book` 下运行 `bun run smoke:product-lifecycle -- --only L1,L3,L4 --browser-executable /usr/bin/google-chrome-stable --report <证据目录>/lifecycle-report.json`（含生产构建）：L1 通过；L3、L4 的 `inflight-complete` 通过，日志中不再出现 crc32 异常。其余子断言照实报告。L3 的 `drain-new-request` 预期仍失败，它属于后续 Task。
4. 全量 `bun run test` 由主 Agent 跑，你不用跑。
5. 把第 1–3 步的完整输出保存到证据目录。

本机内存有限：构建、smoke 与类型检查不要并行跑，一次只跑一个重任务。构建期间不要改动 worktree 中的文件，产品构建会检查源码在构建期间是否变化。

## 禁止清单（汇报前逐条自查，在汇报中逐条写明结果）

- 不按错误文案做程序分支，用错误类型或错误码；不用静默的 `catch` 吞掉错误，至少写一条诊断；
- 不为让测试或检查通过而掩盖问题：不跳过测试、不放宽断言、不把一种失败改报成另一种，不在产品代码里加测试专用分支；
- 不删除或替换任务之外的已有代码行、配置项（例如 `package.json` 里的其它 scripts）和注释，也不顺手改写无关注释；
- 重构时保留原有的清理与收口语句（例如失败分支里的资源释放），不留下多余的第二条路径或不可达的代码；
- 不跨包深导入其它包的源码，跨包只经包名与公开入口；
- 不确定能否检查或实现时，先找现有的自然做法，不要直接标成“无法做到”。

设计与主要编码由你自己完成，不交给子代理；子代理只用于调研、审查或批量机械改动这类独立、简单而工作量大的活。

另外：不 `git commit`、`git push`、`git stash`、切分支，不改 git 配置；不设置 http_proxy，不改时区与 locale；测试产生的临时数据放在系统临时目录并清理；注释用中文，只写边界上不明显的原因，不复述代码。仓库规则见 worktree 根目录的 `AGENTS.md`，TypeScript 规范见 `docs/standards/code/`。不要触碰 `packages/neuro-book/docs/research/README.md`（开发者自己的改动）。

## 最终汇报

先写入证据目录的 `delivery.md`，再输出同样内容：

1. 结论：完成标准 1–3 各自的结果（附证据文件名），以及 L1、L3、L4 各子断言的结果；
2. 根因：出错的打包步骤、解析结果、产物中的代码证据；
3. 修复：改在哪一层、为什么选这一层、对其它依赖的影响；
4. 新增检查如何在修复前失败；
5. 同类问题排查结果；
6. 改动的文件列表；
7. 禁止清单逐条自查结果；
8. 后续需要注意的问题（不超过 5 条）。
