# Task 140 - Electron / Tauri Desktop Envelope Spike

> 这是 Task 130 的后续验证任务。它只验证桌面壳，不替换 Product、Manager、Runtime Contract、State Root、Cache Root 或 Owned Process 的所有权。

## Relative documents refs

- [Task 130：桌面应用前置架构、发行载荷与存储生命周期](../130-desktop-application-foundation/README.md)
- [ADR 0009：Product Runtime Image 生成与消费](../../adr/0009-product-runtime-image-generation.md)
- [ADR 0010：桌面存储、loopback 与关闭生命周期](../../adr/0010-desktop-storage-loopback-shutdown.md)
- [AGENTS.md](../../../AGENTS.md)
- [Issue #66](https://github.com/notnotype/neuro-book/issues/66)

## User Request / Topic

在现有 Product Runtime Image、Manager 和生命周期合同之上，分别做一个 Electron 与 Tauri 的 Windows-first Desktop Envelope spike。用户当前偏向 Electron，但最终选择必须由同一验收矩阵的实测证据决定；本任务不提前把任何一个框架标记为正式生产方案。

## Goal

执行 `GOAL.md` 中的长期 unattended spike：建立两个最薄的桌面壳，验证它们能从仓库外打开 verified Product、连接动态 loopback、承载真实前端并完成有认证的优雅关闭；记录体积、文件数、启动、内存、权限和失败证据。保持业务逻辑在 Product/Manager 内，保持 Electron 依赖只在 spike 包，保持 Tauri 使用 stable MSVC，不引入 nightly 或新的长期运行时。

成功必须同时满足：

- 两个壳都通过同一份 Product Runtime Contract resolver 启动现有 verified Product，不复制 Profile、Workspace、数据库、迁移或 shutdown 实现。
- 两个壳都实现单实例、动态端口、loopback 控制凭据、health/version、优雅关闭和强制收口后的进程/句柄检查。
- 两个壳都保存可复现的配置、版本、命令、日志、测量和失败分类；自动化检查与人工浏览器验收分开报告。
- 只在 Windows 真实证据足够时提出跨平台推断；macOS/Linux 不因 Windows 通过而宣称完成。

## Non-goals

- 不把桌面壳并入生产发行、不修改根 Product dependencies、不移动 Product 领域代码。
- 不用 Electron main 或 Tauri Rust 重写 Manager、数据库、Agent、Profile、Workspace 或安装更新流程。
- 不为 Bun Product 自造 ASAR/虚拟文件系统；不把完整 Source、Skill 依赖或 native island 塞进桌面壳。
- 不自动执行需要用户授权的真实浏览器验收；自动化只覆盖可重复的进程、HTTP、WebView 配置和测试 harness 检查。

## Current State

- Task 130 已提供 verified Runtime Image、Product Runtime Contract v5、Manager 进程编排、loopback shutdown、State/Cache Root 和 Windows Product smoke。
- 当前仓库已经有 `desktop/spikes/electron` 与 `desktop/spikes/tauri` 的 Windows-first spike 实现；NeuroBook Manager CLI 已补齐 Windows 用户级安装事务，但图形化 Manager、签名安装器、更新器和最终框架选择仍不在本任务冻结。
- 本机已有 `rustup-msvc` stable MSVC toolchain、Visual Studio 2022 Community、Windows SDK 和 WebView2 Runtime。
- Electron 不进入根依赖；spike worktree 内单独安装并记录版本。

## Architecture Boundary

```text
Electron main / Tauri Rust envelope
    -> Desktop Local Root、单实例、窗口、原生对话框
    -> Manager / verified Product Runtime Contract
    -> http://127.0.0.1:<dynamic-port>
    -> existing Bun Product
```

桌面壳拥有窗口、单实例、WebView profile、桌面 lease 和原生系统交互；Manager 拥有安装、迁移、版本切换、Product 启停和 rollback；Product 拥有业务 API、Agent、数据库、Profile、Workspace 和统一 shutdown controller。动态 loopback token 只在内存/进程环境中传递，不写入 WebView 或磁盘。

## Shared Matrix

两种壳必须用同一个 verified Product、同一个 State/Cache Root fixture、同一份场景编号和同一套计时/尺寸口径：

| ID | 场景 | 证据 |
| --- | --- | --- |
| S1 | verified image / contract / source identity | resolver 输出、manifest、失败日志 |
| S2 | 动态端口 health/version 与同源 cookie | HTTP 结果、端口、cookie 属性 |
| S3 | SSE/WebSocket 长连接和断开 | 连接事件、关闭原因 |
| S4 | Monaco、TipTap、剪贴板、拖放、下载、文件对话框 | 自动 harness 结果；真实 UI 另列人工项 |
| S5 | Origin/CSP、Electron isolation 或 Tauri capability | 配置审计和拒绝越权检查 |
| S6 | 单实例与第二次启动转发/退出 | 进程树和退出码 |
| S7 | Product crash / Manager shutdown / 30s graceful drain / forced fallback | shutdown trace、Owned Process 终态 |
| S8 | State Root 可移动、Cache/WebView profile 可回收 | move/delete 检查 |
| S9 | 启动时间、RSS、文件数、逻辑/压缩大小 | 同机 measurement JSON |

## Spike Shape

- `desktop/spikes/shared/`：只放测试 fixture、测量 schema 和 envelope 与 Product Contract 的适配测试，不复制领域逻辑。
- `desktop/spikes/electron/`：Electron main、preload、最小 renderer、CSP、单实例和窗口/进程生命周期；`nodeIntegration: false`、`contextIsolation: true`、sandbox 和最小 IPC。
- `desktop/spikes/tauri/`：Rust/Tauri main、WebView2 配置、最小 capability、sidecar/Manager 启停和窗口生命周期；不引入 nightly。
- `docs/tasks/140-desktop-envelope-installation-spike/evidence/`：只保存脱敏的版本、测量、日志摘要和失败报告，不保存 State Root、token、用户内容或完整 WebView profile。

## Iteration / Stop Rules

每个实验先记录假设、命令和预期，再运行最小场景；失败时先保留复现和环境证据，不能通过放宽 CSP、关闭 isolation/capability、使用固定 token、绕过 verified image 或复制 Product 逻辑来“修绿”。同一阻断连续三次仍无新证据时停止该路径，报告阻断、已尝试路径和需要人工决定的选项。

## Verification / Test

- focused tests：共享 resolver、配置审计、单实例、shutdown、路径/凭据不落盘。
- Electron：安装后 `npm`/Bun 只在 spike 目录工作；执行 package build、main/preload smoke 和仓库外 Product launch。
- Tauri：`cargo metadata`、`cargo test`、`cargo build` 与 WebView2/sidecar smoke。
- Product：复用 Task 130 verified image 和现有 Windows verifier；不在本任务重做 clean A/B build。
- UI：S4 的真实点击、编辑器、文件对话框、拖放和视觉确认需用户单独授权；没有该授权只能报告自动化准备/未完成。

## Implementation Walkthrough

- 2026-08-04：创建 Issue #66、从 `origin/master` 建立 `feat/i66-t140-desktop-envelope-installation-spike` worktree；确认 Rust/MSVC/WebView2 前置已安装。随后以当前合同迁移到 `feat/i66-t140-desktop-envelope-hardening` 继续收口。
- 2026-08-04：Electron 依赖只安装在 `desktop/spikes/electron`，版本为 Electron 43.2.0；Tauri 使用 Rust 1.97.1 stable MSVC 与 Tauri 2.11.5。两个壳都通过共享 Product launcher 解析 Product Runtime Contract；当日历史 fixture 使用 v4，后续 clean fixture 已升级为 v5，未复制数据库、Profile、Workspace 或 shutdown 业务实现。
- 2026-08-04：完成 Electron main/preload 与 Tauri Rust/WebView2 最小壳。Electron 固定 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`，只暴露只读状态 IPC；Tauri 只声明窗口 capability，CSP 仅允许 loopback，未声明 shell/fs 权限。两个壳都使用动态端口和每次启动随机 256-bit shutdown token，token 不写磁盘、URL 或 WebView storage。
- 2026-08-04：以仓库外、非当前 checkout 构建的 Windows verified Product fixture（source revision `4947c1e4ab7643c71d875bae4083a56412f06ee3`，历史 Contract v4）完成两次 headless launch。Electron 端口 `37641`、Tauri 端口 `37642` 均通过 version health、数据库/Application State 准备、14 个 system profiles 准备和认证 graceful shutdown；Application Root 前后均为 3,239 文件，digest `sha256:a99cf1d0a1e9e563b177a7955ddf21f87a92e20c28656b8d04f3a9c3a762aa25`。
- 2026-08-04：最终 focused 门禁通过：spike TypeScript typecheck、Contract Vitest `1 file / 1 test`、security audit、Electron bundle、Tauri `cargo fmt --check`、`cargo test`（0 个 Rust 单测）和 `cargo build --release`。测量见 [measurement.json](evidence/measurement.json)：Product fixture 3,239 文件 / 133,936,301 bytes；Electron runtime 75 文件 / 364,266,454 bytes，Envelope bundle 2 文件 / 41,349 bytes；Tauri release exe 1 文件 / 8,921,088 bytes，PDB 6,279,168 bytes。
- 2026-08-04：测量只记录逻辑文件数与字节数，没有把 Electron runtime、WebView2 或最终安装器压缩大小冒充已知结果。Tauri 的当前构建关闭正式 bundle，WebView2 Evergreen/Fixed/Bootstrapper 分发成本尚未测量。
- 2026-08-05：在当前 checkout 的空 `NEURO_BOOK_OUTPUT_DIR` 完成 clean Build A。Runtime Image manifest 报告 `dirty=false`、source revision `9c1c0f3564fbb1543a9ef198bccf31d9c1eef112`、source digest `sha256:d2d110e00f0957c36507f587107457aa819d1b4a9e6dd3355205f8bb662cde45`、imageId `sha256:f4010c53f1ae261a7574294be41dbb737a91d31439d3be8ce5b809dd6fbbb4e3`，共 3,242 个文件 / 134,529,839 bytes，shape digest `sha256:5548e16f91f23d3cedf43aa61c15a8cc65fdcde06673aa18346b464f45ce62d4`。Owner inventory 为 authoring-kit 513/14,745,912、commands 109/10,748,046、frontend 181/15,882,924、native-islands 2,059/75,260,633、runtime-meta 3/5,069、server-bundle 1/12,557,491、system-assets 376/5,329,764；该候选已通过 Product Runtime Image verifier，但文档随后还会进入最终 Build B。
- 2026-08-05：修复空 Portable State Root 的端口生命周期缺陷：首次启动不再把未配置端口误判为固定 `3000`，由 Supervisor 选择的动态端口写入首次 `.env`；已有 `.env` 仍严格检查显式端口。Manager focused 2 files / 25 tests、typecheck 和 bundle 通过。
- 2026-08-05：文档收口前完成 clean Build C2。Runtime Image manifest 报告 `dirty=false`、source revision `b1ba910e2c0de18cad50de31161a1bb7bcb7812f`、source digest `sha256:55b7663e08c00c146af902f93e7f5d69a66fc253b2d51179dca71bfc201965ce`、imageId `sha256:3fdf7e692d533050d7356045d1a5459cf28f008425ce4ade081cf6451e11fcd3`，共 3,242 个文件 / 134,529,839 bytes，tree digest `sha256:82f8777b01150ee090035ad3ef0f685a4c1b68622dce62e7b67e89af33400a04`，shape digest 仍为 `sha256:5548e16f91f23d3cedf43aa61c15a8cc65fdcde06673aa18346b464f45ce62d4`。Owner inventory 为 authoring-kit 513/14,745,912、commands 109/10,748,046、frontend 181/15,882,924、native-islands 2,059/75,260,633、runtime-meta 3/5,069、server-bundle 1/12,557,491、system-assets 376/5,329,764；C2 仅作为历史证据，之后的 stdio 和 startup nonce 修复尚未进入该镜像。
- 2026-08-05：修复 Owned Process 监督器的 stdout/stderr 继承策略，避免 Product 日志污染 Supervisor NDJSON；修正 Tauri 64 字符 startup nonce 与 `/api/app/version` 合同不一致的问题。两项修复都必须在新的 source-locked Product Image、Portable 组包和 Tauri headless smoke 中重新验证。
- 2026-08-05：完成最终 source-locked Build A/B。两次构建均 `dirty=false`、revision `3623d32c66aa7ab0a9ad4769e4405036ea9d5433`、source digest `sha256:c5fea97c659ca9035aaa82a63c99615649d070cc91d23a575d215bec429667bf`、imageId `sha256:7f70530cbdb076c27f32285802d4f891515ec1dfec9582522f1e4fd3b7ac40e2`，Product inventory 均为 3,242 文件 / 134,532,224 bytes，tree digest `sha256:e5afa0d9dc500b5acfe366e4a6385ecea3c3fa3b24031801ca6470a3088ad626`，shape digest `sha256:917c43569fa43d60045dacb23c5de6d71fb1d3100a2779cd4d464ada2d814aab`。Owner inventory 为 authoring-kit 513/14,746,686、commands 109/10,748,820、frontend 181/15,882,924、native-islands 2,059/75,260,633、runtime-meta 3/5,069、server-bundle 1/12,558,328、system-assets 376/5,329,764；A/B 的 manifest、payload identity 和文件内容完全一致，只有 `createdAt` 不同。
- 2026-08-05：最终 Windows Portable 两次组包逐字节一致。Electron payload 为 9,623 文件 / 986,194,835 bytes、payload digest `sha256:a6a2b7a97d6287d40b0b649795d76dc7750211833b198e79be6dec8d11c6f369`，ZIP 为 389,496,381 bytes、SHA-256 `B7C1B270E22471B11733EAC787E829B4F8C0C65F7BB5FFB689DBBA786A7F8205`；Tauri payload 为 9,546 文件 / 631,727,064 bytes、payload digest `sha256:998efdeb60da35d883075cc7b2379c2d3d32103da8069f2b59d931c8d6fb9a57`，ZIP 为 243,786,881 bytes、SHA-256 `70B03065D101ECA43079D4BF94CF393BF2EB3015CD0E15DBBB42BEFFB8D55872`。两包共享 Bun 1.3.14、Tool Pack 6,293 文件 / 387,904,585 bytes / digest `sha256:74932c8d99a61c0ec7022b6860545ce58c8d201cedc0a2a805d26f424892ce0c`；Electron runtime 为 75 文件 / 364,266,454 bytes，Tauri release executable 为 9,863,680 bytes、PDB 为 6,467,584 bytes。
- 2026-08-05：补齐 NeuroBook Manager CLI 的 Windows 用户级安装事务：`scripts/install/install-desktop.ps1` 只负责准备 Bun 并转交 Manager；本地模式在安装事务内通过 stdin/隐藏 TTY 创建管理员，远端模式不接收本地密码；安装前拒绝 dirty Product，复核 Product、Manager、Bun、rg、PortableGit/bash 与 Envelope；安装完成后写相对 wrapper、开始菜单/桌面快捷方式、HKCU 卸载项和 `neurobook://`，注册失败和卸载都清理同一组资源。Portable 数据根不会被复制到 Installed 根，State Root 默认保留。
- 2026-08-05：收口远端 Desktop 安装路径：`desktop install --remote` 不再接受完整 Product Portable，而是要求独立 `nbook.desktop-shell/v1` shell depot；Manager 先请求 `/api/app/desktop-capability` 并解析 Product 版本，再只写入 Envelope、远端连接清单和 Desktop/WebView locator。远端安装拒绝 Product、Bun、Tool Pack 和 CLI PATH；卸载注册表改为调用 `neuro-book desktop uninstall --dir ...`，默认保留 State Root；`desktop/spikes/package-portable.mjs` 通过可选 `--shell-output-dir` 生成 Electron/Tauri shell ZIP 与 sidecar manifest。
- 2026-08-05：补齐 `nbook.desktop-user-installation/v1` 的 Windows x64 与 macOS x64/arm64 路径合同。macOS 只完成 Application Support/Caches locator、Manager schema 和 CI 合同检查，不声称签名、公证或正式 `.app` 已通过。
- 2026-08-05：安装收口后的 focused 回归为 Manager `38 files / 275 tests passed; 1 file / 3 tests skipped`，其中 `desktop-installation.test.ts` 覆盖 Portable strict manifest、独立 shell manifest、distribution manifest 组件选择与 checksum、远端 capability、Product/Tool Pack 隔离、clean/image/checksum、密码模式、相对 wrapper、注册回滚和卸载清理；Manager typecheck、pack check、Desktop Contract `1 file / 9 tests`、Electron bundle/audit、Tauri `cargo fmt --check`/`cargo check` 均通过。独立无全局 Agent fixture 的安装脚本合同为 `1 file / 10 passed / 9 skipped`。该回归不重跑已完成的双 clean build 或仓库外 Portable smoke。
- 2026-08-05：`desktop/spikes/package-portable.mjs` 现在为 Portable depot 和独立 shell depot 各生成 `nbook.desktop-distribution/v1` sidecar。`neuro-book desktop install --distribution-manifest <path>` 由 Manager 解析 Windows x64、通道、Envelope 组件、同根相对路径、ZIP 字节数和 SHA-256 后再进入安装事务；合同中的 HTTPS 组件仍只完成严格解析，本地 Manager 不假装提供联网下载。
- 2026-08-05：最终包在仓库外、祖先无 `node_modules`、清空 `NODE_PATH` 的临时根完成 Electron 与 Tauri headless smoke。两者均启动同一 Contract v5 Product、动态 loopback、迁移、14 个 system profiles、version health 和认证 graceful shutdown；Electron 额外在保持运行期间验证错误 token HTTP `401`，两包均完成 Application Root `.output` 前后 3,244 文件同 digest 检查、State Root move/delete 和进程树收口。Focused 门禁为 Desktop 5 files/17 tests、security audit 全项通过、Electron bundle、Desktop TS typecheck、Manager 37 files/263 tests（1 skipped file/3 skipped tests）、Manager typecheck、Tauri `cargo fmt --check`/`cargo check`。
- 2026-08-05：根据安装后交互复核补做 Electron 启动与托盘加固。启动页现在显示 Product 检查、Supervisor 启动、ready/full verification 等阶段；本地启动失败不会立即退出，而是提供重试、经 Manager Supervisor 修复回执后重试、打开日志和退出。托盘改为复用现有 `desktop/spikes/tauri/icons/icon.ico`，并由 Electron build/Portable staging 带入 `resources/icon.ico`；新增桌面合同断言覆盖启动恢复入口和非空图标加载。该批次只验证构建和合同，不声称真实窗口视觉或托盘人工验收完成。
- 2026-08-05：使用现有最终 Product/Portable 输入重新组包，打包器保持拒绝 Scoop shim Bun 的门禁；改用真实 Bun 1.3.14 后 Electron/Tauri 两个 ZIP 均成功生成，历史包已确认图标随 Envelope 携带。将当前 `main.mjs`、`preload.mjs` 和图标替换进仓库外解压的旧版 Electron ZIP 后运行 `--headless`，退出码为 0；Product 日志记录动态端口启动、`GET /api/app/version` 和 `POST /__nbook/control/shutdown`，无残留 Electron/Product 进程。该 smoke 复用了历史 verified Product image，不重新声明 Build A/B。
- 2026-08-05：补齐托盘关闭策略边界：当用户关闭托盘后仍保留 `tray` 设置时，Electron/Tauri 不再把窗口隐藏到没有入口的托盘；`ask` 只有在托盘启用时才弹出隐藏选择，否则直接走统一 graceful shutdown。桌面合同测试仍为 5 files / 20 tests，Electron bundle、Tauri `cargo fmt --check` 和 `cargo check` 通过。
- 2026-08-05：按 ADR 0013 收口 Electron 载荷：`desktop/spikes/package-portable.mjs` 使用 spike 依赖 `@electron/asar` 将 `main.mjs`、`preload.mjs` 和壳 `package.json` 写入 `desktop/resources/app.asar`，托盘图标作为 native resource 放在 `desktop/resources/icon.ico`；ASAR 生成前仍执行绝对路径、`.bun`、`.pnpm` 和固定 token 泄漏检查，Portable ZIP 不再展开 `resources/app/main.mjs`。在复用最终 Build A/B 的 verified Product image 上重新组包，Electron 为 9,622 个 payload 文件 / 986,432,007 bytes / ZIP 389,591,210 bytes，Tauri 为 9,546 个文件 / 631,748,475 bytes / ZIP 243,791,957 bytes；两次同输入组包的 ZIP SHA 与 payload digest 均一致。仓库外清空 `NODE_PATH` 后，Electron ASAR headless 和 Tauri headless 均退出 0、graceful shutdown 且无残留进程；focused 门禁为 6 files / 22 tests、Electron build 和 security audit 通过。证据见 [asar-packaging.json](evidence/asar-packaging.json)。此前用当前 dirty Product 尝试 Tauri 时被 `dirty expected=false actual=true` 正确拒绝，未放宽该门禁。

## Acceptance Matrix

| ID | 当前结果 | 证据 / 边界 |
| --- | --- | --- |
| S1 | 通过（最终 Build A/B） | 两次 clean build 的 verified Product image、Contract v5、source identity、owner policy/inventory、tree/shape digest 和 payload 文件内容完全一致；构建机绝对路径、`.bun`、`.pnpm` 泄漏为 0。 |
| S2 | 通过（headless） | 两个壳均通过动态 `127.0.0.1` port 的 version health；cookie 属性尚未单独做浏览器检查。 |
| S3 | 未完成 | SSE/WebSocket 长连接与断开没有在真实窗口中验证。 |
| S4 | 未完成 | Monaco、TipTap、剪贴板、拖放、下载和文件对话框只生成了人工验收范围，没有自动点击或视觉验收。 |
| S5 | 自动审计通过 | Electron isolation/sandbox/navigation、Tauri loopback CSP/capability 均通过静态安全审计；页面运行时 Origin 行为仍需人工验收。 |
| S6 | 通过（focused） | Electron `requestSingleInstanceLock` 与 Tauri lock fixture 的第二实例竞争已通过；没有把第二实例 UI 转发冒充为完整人工验收。 |
| S7 | 部分通过 | 两个壳均完成 Product-owned migration、动态 health、认证 graceful shutdown、错误 token `401` 和退出后进程树收口；Electron 复用 Owned Process。Tauri spike 的 forced fallback 仍是 `taskkill /T /F`，不是生产级共享 Owned Process/Job Object 合同；crash/disconnect 后的完整矩阵仍未完成。 |
| S8 | clean Portable 自动 smoke 通过（最终 Build A/B） | 两包均从仓库外且祖先无 `node_modules`、清空 `NODE_PATH` 的临时根启动；14 个 system profiles、动态 loopback health/version、认证 graceful shutdown、`.output` immutable digest 和 State Root move/delete 均通过；Electron 保持运行期间额外验证错误 token `401`。`data/`、`.cache/` 和 WebView profile 是运行期 owner，不纳入 immutable Product payload digest；完整 WebView profile 回收仍未验证。 |
| S9 | clean Portable measurement 通过 | 同一 Build B 输入连续两次组包逐字节一致：Electron 9,623 文件 / 986,194,835 bytes、ZIP 389,496,381 bytes、payload digest `sha256:a6a2b7a97d6287d40b0b649795d76dc7750211833b198e79be6dec8d11c6f369`、ZIP SHA-256 `B7C1B270E22471B11733EAC787E829B4F8C0C65F7BB5FFB689DBBA786A7F8205`；Tauri 9,546 文件 / 631,727,064 bytes、ZIP 243,786,881 bytes、payload digest `sha256:998efdeb60da35d883075cc7b2379c2d3d32103da8069f2b59d931c8d6fb9a57`、ZIP SHA-256 `70B03065D101ECA43079D4BF94CF393BF2EB3015CD0E15DBBB42BEFFB8D55872`。Tool Pack 为 6,293 文件 / 387,904,585 bytes / digest `sha256:74932c8d99a61c0ec7022b6860545ce58c8d201cedc0a2a805d26f424892ce0c`；稳定 RSS、正式安装器/updater 和 WebView2 分发成本仍未测量。 |
| S10 | CLI 用户级安装合同通过（focused） | Manager 安装/注册/回滚/卸载测试覆盖本地密码、远端 shell capability/version、远端 Product/Tool Pack 隔离、dirty/checksum/image identity、相对 wrapper 和 Windows 资源清理；macOS 仅通过路径合同与 CI 配置检查。 |

## Findings and Follow-ups

- 本 spike 证明两个桌面壳可以保持薄层边界，复用 Product Runtime Contract v5 和现有生命周期；它没有证明任何框架已经达到生产发布条件，也没有修改 ADR 0009/0010 的最终选择。
- Tauri 的单文件 release executable 明显小于 Electron Chromium runtime，但这不是完整安装包对比：Tauri 仍需 WebView2 分发策略，Electron 还需把 runtime、Product Image、Bun 和资源一起计入安装载荷。
- 生产实现前必须把 Tauri 的强制收口接入共享 Owned Process/Windows Job Object 或等价的受控 native supervisor；不得把当前 `taskkill` fallback 带入正式 Desktop Envelope。
- 生产实现前必须完成真实窗口的 S3/S4/S5/S8 场景，并分别测量冷启动、RSS、压缩安装器、WebView2 Evergreen/Fixed/Bootstrapper 与升级/卸载行为。
- 最终 Build A/B 与两次 Portable 组包已覆盖 stdio、startup nonce、Contract、生命周期和 Windows-first 自动化矩阵；旧 C2/旧 ZIP 仅保留为历史证据。上述证据仍不构成跨平台完成或 Electron/Tauri 的生产选择。

## Portable Packaging Phase

本阶段继续使用同一 Task 140，不创建第三个桌面架构。目标是生成两个 Product-only Desktop Envelope spike ZIP：

```text
portable-root/
├─ .output/                  # immutable、已验证的 Windows Product Runtime Image
├─ runtime/bun.exe           # 随包 Bun runtime
├─ desktop/                  # Envelope、launcher bundle、桌面 runtime
├─ data/                     # Portable State Root；用户内容 owner
├─ .cache/                   # Portable Cache Root；可重建数据
└─ manifest.json             # image、source、runtime、root 和 webview identity
```

Electron 包携带完整 Chromium runtime；Tauri 包只携带 release executable，并在 manifest 中明确依赖系统 WebView2 Evergreen。两个包都提供包相对 launcher 与 `--headless` smoke，不要求普通用户设置 `T140_*` 环境变量。包内不携带完整 Source、根 `node_modules`、用户数据、固定 token 或未经验证的 `.output`。

Portable 验收必须在仓库外、祖先没有 `node_modules` 的临时目录中完成，且清空 `NODE_PATH`；必须检查 Product Contract、动态端口、migration/Profile 准备、认证 shutdown、immutable Product payload digest、端口/进程收口和包内绝对路径泄漏。`data/`、`.cache/`、Desktop/WebView root 是可写 owner，不能用整个 Portable 根 digest 冒充只读证明。两次从同一输入组包的 payload identity 必须一致，时间戳不计入比较。

本阶段已提供 Windows 用户级安装的 Manager CLI 事务，但仍不提供图形化 Manager、签名安装器、updater、跨平台正式包或最终 Electron/Tauri 决策。Tauri 的系统 WebView2、Electron Chromium 体积、Tauri forced fallback 的生产级 Owned Process/Job Object，以及真实窗口交互都单独记录，不以单个 exe 大小代替完整 portable 包结论。

## Portable Packaging Result (2026-08-05, historical dirty spike)

- 使用 verified Product image `sha256:5a35e96ad4f642c555d7dba63a656087e5cb813683aabbb87642166faca5749b`、Contract v4、Bun 1.3.14，在同一 Windows x64 输入上连续生成 K/L 两批 ZIP。Product image 的 source revision 为 `d08199fdc56a6b8e7e3ec0670daa009d5b99c732`，`dirty=true`，所以该段只保留作历史 spike 证据，不能作为正式 Release 或当前 clean baseline。
- 最终交付目录为 worktree 外的 `.agent/artifacts/t140-desktop-portable/`，包含：
- `neuro-book-electron-portable-win-x64.zip`：3,324 文件、597,293,364 bytes，ZIP 230,564,235 bytes，payload digest `sha256:eb3340c9987721e8f5697be8c9fcd98b98cc4d50ee526b21a89d7e50d2ef6310`。
  - `neuro-book-tauri-portable-win-x64.zip`：3,247 文件、241,920,090 bytes，ZIP 84,492,619 bytes，payload digest `sha256:318cee4013c90cfe025a89e32cbd22123f7b5cc474772296b371123a0617cb67`。
- K/L 的 Electron payload digest、Tauri payload digest、ZIP SHA-256 和 payload shape 均一致；ZIP SHA-256 分别为 `c8aa5356a249285406ff0a7b27fc5c08a601510a498264ca5d38c2ac2e711010` 与 `49041726c3cfbefba33b6862b687a21dffaf7a68a0c52d72bf9298da8b92e5c1`。Electron 携带 75 文件 Chromium runtime；Tauri 只携带 release executable，manifest 标明 `Microsoft WebView2 Evergreen` 为系统前置条件。
- 两包均从仓库外且祖先无 `node_modules` 的临时根启动，清空 `NODE_PATH`，自动执行 Product-owned SQLite/Application State migration，准备 14 个 system profiles，通过动态 loopback health/version；无效 shutdown token 返回 `401`，随后由 envelope 内存中的 token 完成认证 graceful shutdown。Electron 动态端口为 `59372`；Tauri 动态端口为 `9883`；两次退出码均为 0。
- 两包的 Application Root 均为 3,240 文件、134,488,581 bytes，digest `sha256:c2e250be2deb50d567c3510aef1b33e6310c94a4246cc311829d3d67d2fe2144`，启动前后不变。两个 State Root 均完成移出/移回，Product 进程退出后可删除，Application Root 和 Cache Root 不受影响。
- 本轮补修了三个 packaging 级问题：Electron `resources/app` 反推 portable root 少退一层；Windows Scoop shim 不能作为随包 Bun，打包器现在拒绝 `shims` 与 `node_modules/.bin` 路径；Tauri 与 Electron 的 headless 参数统一支持 `--headless`。空 Portable State Root 的 migration 由共享 launcher 的 `prepare` 合同步骤完成。
- 仍未完成的门禁：真实窗口及 SSE/WebSocket、Monaco/TipTap、剪贴板、拖放、下载、文件对话框和 Origin 行为；稳定 RSS；WebView2 Evergreen/Fixed/Bootstrapper 分发成本；Tauri 生产级 Owned Process/Job Object 强制收口；签名图形安装器、updater、图形化卸载器和跨平台 runner。不得据此冻结 Electron/Tauri 生产选择。

## Portable Packaging Result (2026-08-05, clean C2)

- 使用 verified Product image `sha256:3fdf7e692d533050d7356045d1a5459cf28f008425ce4ade081cf6451e11fcd3`、Contract v5、Bun 1.3.14 和 Tool Pack `sha256:74932c8d99a61c0ec7022b6860545ce58c8d201cedc0a2a805d26f424892ce0c`，在同一 Windows x64 输入上连续生成两批 ZIP。Product image `dirty=false`，source revision `b1ba910e2c0de18cad50de31161a1bb7bcb7812f`。
- `neuro-book-electron-portable-win-x64.zip`：9,623 文件、986,190,469 bytes，ZIP 389,495,337 bytes，payload digest `sha256:8f03205320d053e4629d2c2bfe24c6c1c8ffc8dc64534cd29379be1f80778407`，ZIP SHA-256 `50676CB6A5224FEAF7C66644B22A0EA40E719050094EBC6B700E42A42D9C1A11`。Electron 携带 75 文件 Chromium runtime。
- `neuro-book-tauri-portable-win-x64.zip`：9,546 文件、631,757,465 bytes，ZIP 243,795,710 bytes，payload digest `sha256:eca610463a112582c56db0238362d3836bc9a7615f99a6c52cf059b3a75b9b90`，ZIP SHA-256 `B4B7797AF2B758086CD085D092DB945448791AF4549DEF32086C06E26CF11018`。Tauri manifest 标明 `Microsoft WebView2 Evergreen` 为系统前置条件。
- 两批的 payload digest、ZIP SHA-256 和 payload shape 完全一致。两包都从仓库外、祖先无 `node_modules` 的临时根启动，清空 `NODE_PATH`，并通过 Product-owned migration、14 个 system profiles、动态 loopback health/version、无效 token `401`、认证 graceful shutdown、Application Root digest 保持和 State Root move/delete；最终 source-locked Build A/B 见下一节，本段仅保留 C2 历史证据。

## Portable Packaging Result (2026-08-05, final Build A/B)

- 逐项环境、owner inventory、ZIP/manifest identity、黑盒 smoke 和 focused 门禁见 [final-build-a-b.json](evidence/final-build-a-b.json)；旧 [measurement.json](evidence/measurement.json) 保留为历史 dirty Contract v4 fixture。
- 最终输入为 verified Product image `sha256:7f70530cbdb076c27f32285802d4f891515ec1dfec9582522f1e4fd3b7ac40e2`、Contract v5、source revision `3623d32c66aa7ab0a9ad4769e4405036ea9d5433`、`dirty=false`。Build A/B 的 inventory、owner policy、tree/shape digest 和 payload 文件内容完全一致，只有 manifest `createdAt` 不同。
- Electron Portable 为 9,623 文件 / 986,194,835 bytes，ZIP 389,496,381 bytes，payload digest `sha256:a6a2b7a97d6287d40b0b649795d76dc7750211833b198e79be6dec8d11c6f369`，ZIP SHA-256 `B7C1B270E22471B11733EAC787E829B4F8C0C65F7BB5FFB689DBBA786A7F8205`；Tauri Portable 为 9,546 文件 / 631,727,064 bytes，ZIP 243,786,881 bytes，payload digest `sha256:998efdeb60da35d883075cc7b2379c2d3d32103da8069f2b59d931c8d6fb9a57`，ZIP SHA-256 `70B03065D101ECA43079D4BF94CF393BF2EB3015CD0E15DBBB42BEFFB8D55872`。
- 两包均在仓库外、祖先无 `node_modules`、清空 `NODE_PATH` 的临时根通过 Contract、migration、14 个 system profiles、动态 loopback health/version、认证 graceful shutdown、`.output` immutable digest、State Root move/delete 和进程收口；Electron 黑盒额外验证错误 token `401`。Electron 使用 bundled Chromium；Tauri manifest 明确依赖系统 WebView2 Evergreen，未携带 WebView2。
- 这两个 ZIP 仍是未签名 Windows spike 产物，不是签名图形安装器、updater、图形化卸载器或框架选型结论。真实窗口/SSE/WebSocket/Monaco/TipTap/剪贴板/拖放/文件对话框、冷启动/RSS、WebView2 分发、跨平台 runner，以及 Tauri 生产级 Owned Process/Job Object forced fallback 仍需后续授权和任务。

## Desktop User Installation Result (2026-08-05)

- `install-desktop.ps1` 是临时 CLI 向导入口：负责准备 Bun，随后调用 NeuroBook Manager CLI；本地模式可传完整 Portable 或 distribution manifest，远端模式可传独立 shell archive 或 shell distribution manifest。下载、复制、校验、回滚、注册和卸载的所有权仍在 Manager。
- Windows 本地安装必须在事务内设置管理员密码，密码只经隐藏 TTY 或 stdin 传给 Product；远端安装先完成 capability/version 探测，只保存服务端 origin、HTTP 风险确认和 Envelope，不读取本地管理员密码，也不复制 Product/Bun/Tool Pack。
- 用户级 Installation Root 为 `%LOCALAPPDATA%/Programs/NeuroBook`，State/Cache/Desktop/WebView 使用 `local-app-data` locator；Portable 的 `data/`、`.cache/` 不会遮蔽用户级数据。安装失败先删除候选 Installation Root，再回滚快捷方式、注册表和可选 CLI PATH。
- macOS 已登记 `~/Applications/NeuroBook.app`、Application Support、Caches 与 x64/arm64 分包合同，并在 `desktop-envelope-contract.yml` 做 Bun/Manager/合同检查；没有签名凭据、真实 `.app`、公证或安装 smoke 证据。
