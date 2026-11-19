# t07 计划：应用包托管入口与桌面载荷组装

## Context

桌面壳要用随包的 Bun 运行服务端，并且桌面载荷必须是发到 npm 的那个应用包（[ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md) 决定 3，提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 4.1）。今天的应用包只有命令行入口 `server/nbook.js`，`nbook.js` 不接受 `--stop-stdin`，服务端的产品入口 `src/server/main.ts` 只在 `bun run build:server` 的 `dist/server` 里，没进包。

合同：[`runtime/server-host`](../../../../../docs/specs/runtime/server-host.md) 的“托管宿主”、[`runtime/cli`](../../../../../docs/specs/runtime/cli.md) 输入与前置条件里的托管入口（都是 planned 条目）。

开发者指定用 autonomous-delivery 推进（见 [t06 计划](../t06-desktop-specs/plan.md)）。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 解开 tarball | `Bun.Archive`（Bun 1.4 自带） | 不依赖系统的 `tar`，Windows runner 上同样可用 | 调 `tar` 命令：Windows 上是 bsdtar，参数与行为要另核对 |
| 装 Windows 的依赖闭包 | 在解开的包目录里先 `bun install --lockfile-only --os win32 --cpu x64` 写出锁文件、核对后 `bun install --production --frozen-lockfile --os win32 --cpu x64 --linker hoisted --backend copyfile` | Bun 1.4 原生支持按目标平台装可选依赖（审查实测只装 `pi-natives-win32-x64`）；`--production` 本身不写锁文件（审查实测），所以先单独写锁、再按锁装；`copyfile` 免得载荷里是指向全局缓存的硬链接 | 只在 Windows 上组装：本机测不了；手抄 `node_modules`：与包声明的依赖脱节 |

依赖闭包的事实（读 `node_modules/@oh-my-pi/*/package.json`）：应用包声明的四个外部依赖往下只有 `@oh-my-pi/omptype`、`pi-wire` 与 `pi-natives` 的平台包，全部是同一个精确版本（18.14.0），没有第三方依赖。所以“按包声明装”本身就是可复现的。核对用完整性哈希而不是版本号：载荷锁文件里的每个包，在仓库根 `bun.lock` 里都要有同名同版本、`sha512` 相同的条目（审查实测 13 个包逐字相同）；对不上或根锁里没有就失败。这样同版本内容被换、将来依赖链带进第三方包，都会被拦下。

## 关键设计

### `packages/neuro-book/scripts/pack-app.ts`

- 命令行入口与托管入口一次打包、共用 chunk：`Bun.build` 的入口是 `src/cli/main.ts` 与 `src/server/main.ts`，`root` 设为 `src`，入口命名 `[dir]-[name].[ext]`，chunk 命名 `chunk-[hash].[ext]`；打完把 `cli-main.js` 改名为 `nbook.js`、`server-main.js` 改名为 `main.js`（入口不被 chunk 引用，改名不影响相对导入；打包后核对没有任何文件引用这两个旧名）。项目宿主 `project.js` 仍单独打（它与服务端不同进程，共用 chunk 没有收益）。
- 包的 `files` 不变（`server/` 已含）；`bundleProblems` 照样逐个检查 `server/*.js`。
- 打包后的核对加一条：`server/main.js` 用系统临时目录下的临时状态根、`NBOOK_PORT=0`、`NBOOK_RPC_PORT=0`、`NBOOK_WEB_ROOT` 指向包里的 `web/`、`--stop-stdin` 起来；用 `src/server/instance.ts` 的 `queryNeuroBook` 轮询认领应答，`ready` 后取 `url`，health 为 200；写 `stop` 后以 0 退出。整段 60 秒截止，失败或超时都结束子进程、删临时状态根（复用 `--version` 那一段临时链接 `node_modules` 的做法）。
- `pack-app.test.ts` 的文件白名单与 chunk 名随之改：入口 `server/nbook.js`、`server/main.js`、`server/project.js`，chunk 为 `server/chunk-*.js` 与 `server/project-*.js`。`package.json` 的 `build:server` 与 `cli.test.ts` 的构建是开发与测试用的另两套打包，这次不动，记进模块头：发布形态只以 `pack-app.ts` 为准。
- 模块头的说明补上托管入口。

### `packages/neuro-book/scripts/desktop-payload.ts`（新增）

放在应用包旁边、用 `bun test` 测（根 `scripts/release/` 的测试由 Vitest 在 Node 里跑，没有 `Bun.Archive`）。

`assembleDesktopPayload({releaseManifest, outDir, os, cpu})`，命令行 `bun scripts/desktop-payload.ts <release-manifest.json> <输出目录> [--os win32 --cpu x64]`。输入是 `release:smoke` 写的发布清单，不是裸 tarball：从清单里取应用包的 tarball 与它的 `sha256`、`commit`，先核对 tarball 的摘要等于清单，t11 的发布作业用同一份清单核对（审查第 5 条）：

1. 输出目录只在不存在、为空或带上次生成的标记时清空重建（同 `pack-app.ts` 的 `clearPreviousApp` 规则，抽成共用函数或照写一份并注明）。
2. `Bun.Archive` 解开 tarball，`package/` 的内容放到 `<输出>/app/`。
3. 在 `app/` 里按“技术选型”先写锁文件、按完整性哈希对照仓库根 `bun.lock`，再按锁安装；锁文件留在 `app/` 作记录。
4. 核对：目标平台的 `pi-natives-<os>-<cpu>` 存在，别的平台包不存在。
5. 写 `<输出>/payload-manifest.json`：`{schema: 1, product, version, commit, bun, target: {os, cpu}, tarball: {name, sha256}, dependencies: {名: {version, integrity}}, files: [{path, size, sha256}]}`，`files` 按路径排序，覆盖 `app/` 下全部文件；`commit` 来自发布清单，`bun` 是组装用的 Bun 版本。
6. 许可：`app/` 里已有 `LICENSE`、`THIRD-PARTY-NOTICES.md` 与各 `node_modules` 包自带的许可文件，不另生成；核对 `node_modules` 下每个包（不只 `@oh-my-pi/*`）都带许可文件，没有就失败。
7. 清空标记沿用 `pack-app.ts` 的规则，标记名不同（`.nbook-desktop-payload`），共用一个判断函数。

载荷目录 `app/` 就是桌面壳要放进安装包的内容；壳运行 `app/server/main.js`，Web 根是 `app/web`（t08 用）。

## Spec 与文档改动

- `docs/specs/runtime/cli.md`：验收加场景 8“托管入口”；“实现合同”的入口说明补 `server/main.js`；Smoke 行补一句。条目级 planned 标记在验证后去掉。
- `docs/specs/runtime/server-host.md`：“托管宿主”的 planned 标记在验证后去掉，实现合同补托管入口。
- `docs/standards/` 不改。

## 切片

1. pack-app 的托管入口：改打包、加打包后的核对；`pack-app.test.ts` 改白名单并加托管入口的场景（标准输入 `stop`、标准输入结束、状态根已被占用时以 1 退出）；`release:smoke` 的应用闭环在 `bun add -g` 装好的包里另起一次 `server/main.js`（安装布局下的托管入口）。提交。
2. 桌面载荷组装：新脚本；快速测试只覆盖不联网的部分（清单与 tarball 摘要不符、锁文件的完整性对照、文件清单），用测试自己打的小 tarball 与锁文件；联网的整段组装作为 `release:smoke` 的一步（用它刚打的应用包与清单，组装本机平台的载荷并运行 `app/server/main.js`）。在本机组装 `--os win32 --cpu x64` 的载荷，到 Windows 开发机上运行一遍（证据进 `evidences/`）。提交。
3. Spec：去掉已验证条目的 planned、补实现合同与证据（代码合入 master 之后）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| server-host “托管宿主”：`--stop-stdin` 的 `stop` 与标准输入结束、认领应答的就绪与地址、退出码 0 与 1（状态根被占用） | `pack-app.test.ts` 托管入口场景（真实子进程）；`release:smoke` 安装布局下的一次；Windows 开发机上的 Windows 载荷手工运行 |
| cli 场景 8（新增） | 同上 |
| 载荷与 npm 包同一份（ADR 0051 决定 3） | `desktop-payload.test.ts`：摘要与清单不符时失败、锁文件对照失败时失败、文件清单覆盖 `app/`；`release:smoke` 的组装步骤：`app/` 由 tarball 内容加 `node_modules` 与锁文件组成，托管入口能起 |

## 验证

- 包内 `bun test scripts/pack-app.test.ts scripts/desktop-payload.test.ts`。
- `prox bun run release:smoke` 一次（应用包结构变了，闭环要照样过；组装步骤从 registry 装依赖，直连冷缓存约 4 到 5 分钟，走 `prox` 约 6 秒）。
- 不跑 e2e：没有界面改动；`e2e/app-package.e2e.ts` 用 `bun add -g` 装的是同一个包，`release:smoke` 已覆盖它的启动场景。
- 未验证边界：Windows 上的载荷只在 Windows 开发机 手工跑；进 CI 在 t11。

## 不做与风险

- 不做 macOS、Linux 的载荷（目标参数已留）。
- 风险：`bun install --os win32` 在 Linux 上装的平台包与 Windows 上原生装的不同（例如可选依赖的过滤规则）。兜底：Windows 开发机上用 Linux 组装出的载荷实际运行一遍，并与 Windows 上原生组装的文件清单对比。
- 风险：共用 chunk 改变了两个入口的模块求值顺序（`startup-env` 与 `omp-process` 要在 OMP 的静态导入之前）。审查已实验确认共用后顺序成立；兜底是托管入口场景、`--version` 与 `release:smoke` 这几个真实进程，不另做文本核对。
