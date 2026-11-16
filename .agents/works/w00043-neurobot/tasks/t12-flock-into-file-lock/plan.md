# t12 不判旧的文件锁单独成包 nb-flock 并随 nb-story 发布：实施计划

## Context

工作区里有两份几乎相同的“不判旧”的系统文件锁 `tryLock`（`bun:ffi` 调 `flock` 或 `LockFileEx`，进程怎样结束锁都由系统放掉）：nb-story 的 `src/platform/flock.ts`（书库、导入、问答配置的锁，[ADR 0031](../../../../../docs/adr/0031-nb-story-supports-windows.md) 加了 Windows），和照它写的 nb-harness `src/kernel/log/flock.ts`（会话日志的锁）。w00032 t15 又把后者开成 `@notnotype/nb-harness/file-lock`，给应用的 Skill 安装用，t15 的后端实现审查第 10 条指出它与 nb-file-lock 职责重叠。

开发者 2026-11-13 先定方案 A（放进 nb-file-lock 的子路径、nb-file-lock 随 nb-story 发布）；计划审查（两位 Sonnet，[细节](evidences/design-review-detail.txt)、[整体](evidences/design-review-overview.txt)、[处理](evidences/design-review-handling.txt)）指出 A 要把 nb-file-lock 整包公开：17 个导出、`proper-lockfile` 与它的 3 个依赖都随 nb-story 装到用户机器上却用不到，`.` 入口在 npm 上还缺仓库补丁。开发者同日改定方案 E：把这把锁单独做成零依赖的小包 `@notnotype/nb-flock`，随 nb-story 发布；nb-file-lock 不动（仍是 private、只有 `.`）。来源与决定见 [README](README.md)。

已查清的事实：

- 两份副本的代码只差三处报错文字（nb-story 的是中文、写着 nbstory，nb-harness 的是中性英文）与 nb-harness 把两处内联的 `released` 提成了 `releaseOnce`，其余逐行相同。在 Windows 上实测过的是 nb-story 那份（ADR 0031）。
- `@notnotype/nb-harness/file-lock` 是 2026-11-11（t15 切片 4）加的，nb-harness 在 registry 上的 latest 是 2026-10-28 的 0.1.1，这个子路径从没发布过，可以直接去掉，不留转发。`@notnotype/nb-flock` 在 registry 上没有被占用（发布前再查一次）。
- 应用包 `@notnotype/neuro-book` 把工作区包打进服务端 bundle（`scripts/pack-app.ts`），新包对它没有影响。

工作方式：主会话写代码；代码在 worktree `.worktree/w00043-t12-flock`（分支 `feat/w00043-t12-flock`）；ADR、Spec、边界文档与 Task 记录在主工作区的 master 上改。

## 技术选型

无新的通用问题。不判旧、进程退出即放的锁沿用现有的 `bun:ffi` 实现：Bun 与 Node 都没有文件锁 API；`proper-lockfile` 按过期判旧，正是这里不要的语义；原生模块（`fs-ext` 一类）要按平台构建，不比 ffi 可移植。

## 关键设计

### `packages/nb-flock`（新包）

- `src/index.ts`：**以 nb-story 那份为底**，只把三处报错文字换成 nb-harness 那份的中性英文，保留内联的 `released`，Windows 段与实测过的一致（ADR 0031 要求改到锁的代码在 Windows 上重测，这里不改代码就不触发）。导出 `tryLock(path): FileLock | null` 与 `FileLock`；只导入 `bun:ffi` 与 `node:fs`，没有运行时依赖。改写的只有注释：头注释不再写“照 nb-story”，`tryLock` 的说明写全失败通道（返回 null 表示别的持有者拿着；打不开文件、平台不支持、Win32 锁不上都抛 Error），并写明 POSIX 分支把 `flock` 的任何失败都当作被占用（ffi 读不到 errno），所以 NFS 一类不支持 `flock` 的文件系统上会一直拿不到。
- `package.json`：照已发布的 `nb-session` 的形状：`name`、`version: 0.1.0`（首发，同 [ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md) 决策 5）、`description`、`license`、`repository`（`directory: packages/nb-flock`）、`publishConfig.access: public`、`type: module`、`engines.bun`、`exports: {".": "./src/index.ts"}`、`scripts` 的 `test` 与 `typecheck`、`files`（`src`、排除 `src/**/*.test.ts` 与 `src/testing`、`README.md`、`LICENSE`）；没有 `dependencies`。`tsconfig.json` 照 nb-file-lock 的。包目录放一份与仓库根相同的 `LICENSE`。
- `README.md`（npm 包页）：第一段写明只在 Bun 里用（`bun:ffi`）、支持 Linux（glibc，`libc.so.6`）、macOS 与 Windows，NFS 上不可靠；接口与一个例子；和“按过期判旧”的锁的区别：适合一直持有到进程结束、不许被接管的单一所有者（单实例、独占写），短时间的临界区要等待或接管时用判旧的锁。
- `AGENTS.md`：边界（零运行时依赖，只导入 `bun:ffi` 与 `node:` 内置模块；与应用无关）；改到 Windows 段要在 Windows 上重测（ADR 0031）；随 nb-story 发布（ADR 0052）；完成门禁（本包 `bun test`、`typecheck`，再跑三处使用方的锁测试）。
- 测试 `src/index.test.ts`：同一进程第二个句柄拿不到、`release` 后能再拿、重复 `release` 无事；子进程拿着时本进程拿不到，结束子进程后能拿到。子进程脚本 `src/testing/lock-child.ts` 只导入 `../index`，拿到后在标准输出打一行再挂着；测试按那一行等它拿到（不按固定时长），`try`/`finally` 里 `kill` 并等它退出，用例失败也收口（照 `nb-harness/src/kernel/log/store.test.ts` 的写法）。不另加导入边界的测试：包没有 `dependencies`，`release:check` 的 `undeclared_import` 已经拦住任何外部包导入。

### 仓库登记

- 根 `package.json` 的 `workspaces` 加 `packages/nb-flock`；`scripts/ci/test-conventions.ts` 的 `STRICT_TEST_ROOTS` 加 `packages/nb-flock/`（同 nb-file-lock）。
- `scripts/release/packages.ts` 的 `RELEASE_PACKAGES` 加 `"nb-flock"`（`publishOrder` 按 `dependencies` 深度优先，它会排在 nb-harness 与 nb-story 之前）；`scripts/release/packages.test.ts` 的“按依赖顺序排出 9 个包”改为 10。
- 根上 `bun install` 刷新 `bun.lock`。
- 不改 nb-harness、nb-story 的版本号，不发布（ADR 0029 决策 5，远端写入要授权）。下次发布必须同时提 nb-harness 与 nb-story 的版本号，否则 `release:publish` 跳过同号的已发布版本，只发出一个没人依赖的 nb-flock：写进 ADR 0052 的“后果”与 Task README。

### `packages/nb-harness`

- `src/kernel/log/files.ts`、`jsonl-store.ts` 改从 `@notnotype/nb-flock` 取 `tryLock`、`FileLock`；删掉 `src/kernel/log/flock.ts`；`jsonl-store.ts` 模块头里说 `flock.ts` 的那句改为指向 nb-flock。
- `package.json`：去掉 `./file-lock` 子路径；`dependencies` 加 `"@notnotype/nb-flock": "workspace:^"`（ADR 0029 决策 4）。
- `src/kernel/architecture.test.ts` 的目录表：`log` 的 `packages` 写 **`@notnotype/nb-flock`**（测试先用 `packageName()` 把说明符截成包名再比对），`builtins` 去掉 `bun:ffi`，改掉说 `flock.ts` 的那句注释。

### `packages/nb-story`

- `server/registry.ts`、`qa/config.ts`、`ingest/store.ts`、`ingest/runner.ts`、`server/ingest.test.ts` 改从 `@notnotype/nb-flock` 取；删掉 `src/platform/flock.ts`（目录里还有 `startup-env.ts`，目录保留）；`registry.ts` 模块头“flock 的细节见 src/platform/flock.ts”改为指向 nb-flock。
- `package.json` 的 `dependencies` 加 `"@notnotype/nb-flock": "workspace:^"`。
- `AGENTS.md` 第 16 行：单实例的锁取自 `@notnotype/nb-flock`，支持 Linux、macOS 与 Windows（原文“只支持 Linux 与 macOS”在 ADR 0031 之后已经过时）。
- 报错文字从中文变成中性英文。只在不支持的平台、Win32 打不开或锁不上锁文件时出现，nb-story 的 Spec 与测试都没有写这几句（ADR 0034：开发诊断用英文）；接受，不另做翻译。

### `packages/neuro-book`

- `src/plugins/agent/backend/skills/install.ts` 与 `install.test.ts`（子进程拿锁的那段内联脚本）改从 `@notnotype/nb-flock` 取；`package.json` 的 `dependencies` 加 `"@notnotype/nb-flock": "workspace:*"`（同应用里别的工作区依赖）。
- `src/architecture.test.ts` 的 `PACKAGE_SIDES` 登记 `{specifier: "@notnotype/nb-flock", side: "backend"}`（这里按说明符全串比对）。

## Spec 与文档改动

- 新 ADR 0052“不判旧的文件锁单独成包 nb-flock，随 nb-story 发布”：补充 ADR 0029 的发布清单（决策 6 说“其它工作区包需要发布时另作决定”，这就是那次决定）；写选哪种锁的规则（两行：短临界区、允许判旧接管、可等待用 nb-file-lock 的 `holdLock`；一直持有到进程结束、不许被接管用 nb-flock 的 `tryLock`）；被否的候选与理由（A 整包公开 nb-file-lock、B nb-story 改用 nb-harness 的子路径、维持两份副本）；后果（`bun:ffi` 被 Bun 标为实验性，已发布的 nb-story 一直在用，这次没有新增风险；Windows 段改动要在 Windows 上重测；下次发布要一起提 nb-harness 与 nb-story 的版本号）。ADR 索引加一行，0029 那一行补注“发布清单加 nb-flock 见 0052”。
- `docs/modules/monorepo-boundaries.md`：加 nb-flock 一行（零依赖、随 nb-story 发布、与 nb-file-lock 的分工）；nb-file-lock 一行补与 nb-flock 的分工；nb-harness 一行去掉 t15 加的 `./file-lock`，改写为依赖 nb-flock；nb-story 一行的工作区依赖从 8 个变成 9 个，列上 nb-flock。
- `packages/AGENTS.md` 第 4 行：成员列表加 w00043 t12 新建的 `nb-flock`（随 nb-story 发布），nb-story 的“8 个工作区包”改 9。
- `docs/standards/repository-workflow.md` 第 89、94、95 行：以源码发布的 9 个改 10（nb-story 与它依赖的 9 个），“11 个包”改 12。
- 根 `README.md` 与 `README.en.md` 的包表各加一行 nb-flock。
- 根 `AGENTS.md` 仓库结构图加 nb-flock 一行（该文件有别的会话未提交的改动，只提交自己的一行：用 `git update-index --cacheinfo` 写入 HEAD 加这一行的版本）。
- [`agent/skills.md`](../../../../../docs/specs/agent/skills.md) 实现合同：跨进程锁改为取自 `@notnotype/nb-flock`。
- 用户可观察的行为不变，没有别的 Spec 要改（`docs/specs` 里没有提到这两份 flock 文件的地方）。

## 切片

1. **新包与发布登记**（`packages/nb-flock` 全部文件、`workspaces`、`STRICT_TEST_ROOTS`、`RELEASE_PACKAGES` 与 `packages.test.ts`、`bun install`）。此时还没有包依赖它，每个提交都能过发布检查。验证：nb-flock 的 `bun test` 与 `typecheck`；`bun test scripts/release/packages.test.ts scripts/ci/test-conventions.test.ts`；`bun run release:check`。单独提交。
2. **改用新包、删两份副本**（nb-harness、nb-story、应用的导入、依赖、两处架构测试、注释、`bun install`）。验证：nb-harness 的 `src/kernel/log`、`src/kernel/architecture.test.ts` 与 `typecheck`；nb-story 的 `bun test` 与 `typecheck`；应用的 `install.test.ts`、`architecture.test.ts`；`bun run release:check`；`prox bun run release:smoke`（打包、从 tarball 装进仓库外的空项目、跑一遍 nbstory 与应用；`nbstory serve` 走的就是 nb-flock）。单独提交。
3. **文档**（master 上）：新 ADR 与索引、边界文档、`packages/AGENTS.md`、发布流程文档、两份根 README、根 `AGENTS.md` 一行、`agent/skills.md`。`bun run docs:check`。
4. 实现审查（后端，Opus 子代理），处理后合入 master，删 worktree。

## 验收映射

行为合同不变，没有新的 Spec 编号。对应关系：

- 锁的语义（同进程第二个句柄拿不到、`release` 幂等、跨进程互斥、进程结束即放）→ nb-flock `src/index.test.ts`。
- 会话日志的锁 → nb-harness `src/kernel/log` 的现有测试。
- nb-story 书库、导入与问答配置的锁 → nb-story 现有测试（`server/ingest.test.ts` 等）。
- Skill 安装的跨进程锁（[`agent/skills.md`](../../../../../docs/specs/agent/skills.md) 输出 20、场景 5）→ 应用 `install.test.ts`“场景 5”。
- 发布：清单与顺序 → `scripts/release/packages.test.ts`、`release:check`；从 tarball 安装与运行 → `release:smoke`。

## 验证

上面各片的命令；`release:smoke` 是唯一的端到端（从打好的 tarball 装进仓库外的空项目，跑 nbstory 与应用）。没验证的边界：Windows 上的 `LockFileEx` 路径这次没有实测；代码除三处报错文字外与 nb-story 在 Windows 上实测过的那份相同（ADR 0031），nb-harness 那份改写过的 `releaseOnce` 不进新包。

## 不做与风险

- 不发布、不改版本号；发版由开发者执行。
- 不在 nb-flock 上加判旧、等待或超时：要那种语义用 nb-file-lock 的 `holdLock`。
- 不改的审查意见（理由见[处理](evidences/design-review-handling.txt)）：musl 上 `dlopen("libc.so.6")` 的原始报错不另包；Windows 上 `GetLastError` 可能被中间的系统调用覆盖（推断，未复现）不改；平台不支持时 POSIX 分支先开文件再抛错、漏一个文件描述符不改（保持与实测版相同）。
- 风险：`bun:ffi` 被 Bun 标为实验性；已发布的 nb-story 0.2.x 一直依赖它，这次只是换个包名公开，没有新增。
