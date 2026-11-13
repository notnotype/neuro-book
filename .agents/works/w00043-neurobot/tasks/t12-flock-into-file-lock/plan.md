# t12 不判旧的文件锁并入 nb-file-lock 并随 nb-story 发布：实施计划

## Context

工作区里有两份几乎相同的“不判旧”的系统文件锁 `tryLock`（`bun:ffi` 调 `flock` 或 `LockFileEx`，进程怎样结束锁都由系统放掉）：nb-story 的 `src/platform/flock.ts`（书库、导入、问答配置的锁，[ADR 0031](../../../../../docs/adr/0031-nb-story-supports-windows.md) 加了 Windows），和照它写的 nb-harness `src/kernel/log/flock.ts`（会话日志的锁）。w00032 t15 又把后者开成 `@notnotype/nb-harness/file-lock`，给应用的 Skill 安装用，t15 的后端实现审查第 10 条指出它与 nb-file-lock 职责重叠。

开发者 2026-11-13 定方案 A：合成一份，放进 nb-file-lock 的单独子路径，nb-harness 与 nb-story 都从那里取；nb-file-lock 随 nb-story 发布到 npm。不把 nb-file-lock 并进 nb-harness（它的主要使用者与 Agent 无关）。来源与决定见 [README](README.md)。

已查清的事实：

- 两份副本的代码只差三处报错文字（nb-story 的是中文、写着 nbstory，nb-harness 的是中性英文）与一个 `releaseOnce` 的写法，其余逐行相同。
- `@notnotype/nb-harness/file-lock` 是 2026-11-11（t15 切片 4）加的，nb-harness 最近一次发版是 2026-10-28 的 0.1.1，这个子路径从没发布过，可以直接去掉，不留转发。
- nb-file-lock 的 `private: true` 来自 [ADR 0045](../../../../../docs/adr/0045-shared-host-packages-for-second-app.md) 决策 4，当时按“待确认默认追认”定下，没有专门的理由。
- 应用包 `@notnotype/neuro-book` 把工作区包打进服务端 bundle（`scripts/pack-app.ts`），nb-file-lock 改成公开包对它没有影响。

工作方式：主会话写代码；代码在 worktree `.worktree/w00043-t12-flock`（分支 `feat/w00043-t12-flock`）；ADR、Spec、边界文档与 Task 记录在主工作区的 master 上改。

## 技术选型

无新的通用问题。不判旧、进程退出即放的锁沿用现有的 `bun:ffi` 实现：Bun 与 Node 都没有文件锁 API；`proper-lockfile` 按过期判旧，正是这里不要的语义。

## 关键设计

### `packages/nb-file-lock`

- 新增 `src/flock.ts`：以 nb-harness 那份为底（中性英文报错、`releaseOnce`），导出 `tryLock(path): FileLock | null` 与 `FileLock`。只导入 `bun:ffi` 与 `node:fs`，不引 `proper-lockfile`：nb-harness 与 nb-story 只经这个子路径取锁，运行时不加载 `proper-lockfile`。
- `package.json`：`exports` 加 `"./flock": "./src/flock.ts"`；按发布清单检查（`scripts/release/packages.ts` 的 `checkReleasePackages`）补齐：去掉 `private`，加 `files`（`src`，排除测试与 `src/testing/`，加 `README.md`、`LICENSE`）、`publishConfig.access: public`、`repository`（`directory: packages/nb-file-lock`），包目录放一份与仓库根相同的 `LICENSE`；版本保持 0.1.0（首发，同 [ADR 0029](../../../../../docs/adr/0029-workspace-packages-publish-source-to-npm.md) 决策 5）。
- `README.md` 改写成 npm 包页能读的说明：两个入口各做什么；写明 `proper-lockfile` 的补丁只在本仓库生效：从 npm 装的包，`.` 入口用的是原版 `proper-lockfile`，在 Windows 的 exFAT 卷上续期会被误报 `ECOMPROMISED`（w00009 修的就是这个）；`./flock` 不受影响。
- `AGENTS.md`：边界一节改为两个入口，`./flock` 不得导入 `proper-lockfile`；发布随 nb-story（ADR 0052）。
- 测试 `src/flock.test.ts`：同一进程第二个句柄拿不到、`release` 后能再拿、重复 `release` 无事；另起子进程拿着时本进程拿不到，杀掉子进程后能拿到（子进程脚本放 `src/testing/`，同 `lock-child.ts` 的做法）。再加一条边界断言：`src/flock.ts` 只导入 `bun:ffi` 与 `node:` 内置模块（守住“nb-harness、nb-story 不加载 `proper-lockfile`”）。`app-neutral.test.ts` 已扫整个 `src/`，覆盖新文件。

### `packages/nb-harness`

- `src/kernel/log/files.ts`、`jsonl-store.ts` 改从 `@notnotype/nb-file-lock/flock` 取 `tryLock`、`FileLock`；删掉 `src/kernel/log/flock.ts`。
- `package.json`：去掉 `./file-lock` 子路径；`dependencies` 加 `"@notnotype/nb-file-lock": "workspace:^"`（ADR 0029 决策 4）。
- `src/kernel/architecture.test.ts` 的目录规则：`log` 的 `packages` 加 `@notnotype/nb-file-lock/flock`，`builtins` 去掉 `bun:ffi`，改掉说 `flock.ts` 的那句注释。nb-file-lock 不依赖 nb-runtime，“nb-harness 不依赖 nb-runtime”的约束不受影响。

### `packages/nb-story`

- `server/registry.ts`、`qa/config.ts`、`ingest/store.ts`、`ingest/runner.ts`、`server/ingest.test.ts` 改从 `@notnotype/nb-file-lock/flock` 取；删掉 `src/platform/flock.ts`。
- `package.json` 的 `dependencies` 加 `"@notnotype/nb-file-lock": "workspace:^"`。
- `AGENTS.md` 第 16 行改：单实例的锁取自 nb-file-lock 的 `./flock`，支持 Linux、macOS 与 Windows（原文“只支持 Linux 与 macOS”在 ADR 0031 之后已经过时）。
- 报错文字从中文变成中性英文。只在不支持的平台、Win32 打不开或锁不上锁文件时出现，nb-story 的 Spec 没有写这几句；接受，不另做翻译。

### `packages/neuro-book`

- `src/plugins/agent/backend/skills/install.ts` 与 `install.test.ts`（子进程拿锁的那段内联脚本）改从 `@notnotype/nb-file-lock/flock` 取。
- `src/architecture.test.ts` 的 `PACKAGE_SIDES` 登记 `{specifier: "@notnotype/nb-file-lock/flock", side: "backend"}`。

### 发布链与锁文件

- `scripts/release/packages.ts` 的 `RELEASE_PACKAGES` 加 `"nb-file-lock"`（`publishOrder` 按依赖排序，它会排在 nb-harness 与 nb-story 之前）。
- 根上 `bun install` 刷新 `bun.lock`（`staleLockfileVersions` 查 `bun.lock` 里记的工作区版本）。
- 不改 nb-harness、nb-story 的版本号，不发布：发版与版本号由开发者在发布时定（ADR 0029 决策 5，远端写入要授权）。

## Spec 与文档改动

- 新 ADR（下一个空闲编号，现在是 0052）“不判旧的文件锁归 nb-file-lock，nb-file-lock 随 nb-story 发布”：部分取代 ADR 0045 决策 4 中 nb-file-lock 的“不发 npm”，其余决定不变；补充 ADR 0029 的发布清单（决策 6 说“其它工作区包需要发布时另作决定”，这就是那次决定）。写明 `proper-lockfile` 补丁的代价与为什么接受。ADR 索引加一行，0045 那一行补注“其中 nb-file-lock 不发 npm 已被 0052 取代”，0029 那一行补注“发布清单加 nb-file-lock 见 0052”。
- `docs/modules/monorepo-boundaries.md`：nb-file-lock 一行（两个入口、随 nb-story 发布）、nb-harness 一行（去掉 t15 加的 `./file-lock`，改写依赖 nb-file-lock 的 `./flock`）、nb-story 一行（连同依赖的工作区包从 8 个变成 9 个，列上 nb-file-lock）。
- 根 `README.md` 与 `README.en.md` 的包表各加一行 nb-file-lock。
- [`agent/skills.md`](../../../../../docs/specs/agent/skills.md) 实现合同：跨进程锁改为取自 `@notnotype/nb-file-lock/flock`。
- 用户可观察的行为不变，没有别的 Spec 要改（`docs/specs` 里没有提到这两份 flock 文件的地方）。

## 切片

1. **合并与改导入**（nb-file-lock 的 `./flock` 与测试、nb-harness、nb-story、应用的导入与两处架构测试、删两份副本、`bun install`）。验证：nb-file-lock 的 `bun test` 与 `typecheck`；nb-harness 的 `src/kernel/log`、`architecture.test.ts` 与 `typecheck`；nb-story 的 `bun test` 与 `typecheck`；应用的 `install.test.ts`、`architecture.test.ts`。单独提交。
2. **发布准备**（nb-file-lock 的 `package.json` 发布字段、`LICENSE`、`README.md`、`AGENTS.md`，`RELEASE_PACKAGES`）。验证：`bun run release:check`；`prox bun run release:smoke`（打包、从 tarball 安装、跑一遍 nbstory 与应用；第三方依赖从 registry 装）。单独提交。
3. **文档**（master 上）：新 ADR 与索引、边界文档、两份根 README、`agent/skills.md`。`bun run docs:check`。
4. 实现审查（后端，Opus 子代理），处理后合入 master，删 worktree。

## 验收映射

行为合同不变，没有新的 Spec 编号。对应关系：

- 锁的语义（同进程第二个句柄拿不到、进程结束即放、跨进程互斥）→ nb-file-lock `src/flock.test.ts`。
- 会话日志的锁 → nb-harness `src/kernel/log` 的现有测试。
- nb-story 书库与导入的锁 → nb-story 现有测试（`server/ingest.test.ts` 等）。
- Skill 安装的跨进程锁（[`agent/skills.md`](../../../../../docs/specs/agent/skills.md) 输出 20、场景 5）→ 应用 `install.test.ts`“场景 5”。
- 发布：清单检查 → `release:check`；从 tarball 安装与运行 → `release:smoke`。

## 验证

上面各片的命令；`release:smoke` 是唯一的端到端（从打好的 tarball 装进仓库外的空项目，跑 nbstory 与应用）。没验证的边界：Windows 上的 `LockFileEx` 路径这次没有实测，代码与 nb-story 0.2.x 在 Windows 上实测过的那份相同（ADR 0031）。

## 不做与风险

- 不发布、不改版本号；发版由开发者执行。
- 不在 `./flock` 上加判旧、等待或超时：要那种语义用 `.` 的 `holdLock`。
- 风险：从 npm 装 nb-story 的用户多装一个用不上的 `proper-lockfile`（连同它的几个小依赖）；`.` 入口在 npm 上没有补丁，在包说明里写明，ADR 里记为接受的代价。以后要在 npm 上给 `.` 的使用者补丁，再考虑把补丁写进源码。
