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

- Task 130 已提供 verified Runtime Image、Product Runtime Contract v4、Manager 进程编排、loopback shutdown、State/Cache Root 和 Windows Product smoke。
- 当前仓库已经有 `desktop/spikes/electron` 与 `desktop/spikes/tauri` 的 Windows-first spike 实现，但它们仍不是生产桌面实现；生产安装器、更新器、签名和最终框架选择不在本任务冻结。
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
- 2026-08-04：Electron 依赖只安装在 `desktop/spikes/electron`，版本为 Electron 43.2.0；Tauri 使用 Rust 1.97.1 stable MSVC 与 Tauri 2.11.5。两个壳都通过共享 Product launcher 解析 Product Runtime Contract v4，未复制数据库、Profile、Workspace 或 shutdown 业务实现。
- 2026-08-04：完成 Electron main/preload 与 Tauri Rust/WebView2 最小壳。Electron 固定 `nodeIntegration=false`、`contextIsolation=true`、`sandbox=true`，只暴露只读状态 IPC；Tauri 只声明窗口 capability，CSP 仅允许 loopback，未声明 shell/fs 权限。两个壳都使用动态端口和每次启动随机 256-bit shutdown token，token 不写磁盘、URL 或 WebView storage。
- 2026-08-04：以仓库外、非当前 checkout 构建的 Windows verified Product fixture（source revision `4947c1e4ab7643c71d875bae4083a56412f06ee3`，Contract v4）完成两次 headless launch。Electron 端口 `37641`、Tauri 端口 `37642` 均通过 version health、数据库/Application State 准备、14 个 system profiles 准备和认证 graceful shutdown；Application Root 前后均为 3,239 文件，digest `sha256:a99cf1d0a1e9e563b177a7955ddf21f87a92e20c28656b8d04f3a9c3a762aa25`。
- 2026-08-04：最终 focused 门禁通过：spike TypeScript typecheck、Contract Vitest `1 file / 1 test`、security audit、Electron bundle、Tauri `cargo fmt --check`、`cargo test`（0 个 Rust 单测）和 `cargo build --release`。测量见 [measurement.json](evidence/measurement.json)：Product fixture 3,239 文件 / 133,936,301 bytes；Electron runtime 75 文件 / 364,266,454 bytes，Envelope bundle 2 文件 / 41,349 bytes；Tauri release exe 1 文件 / 8,921,088 bytes，PDB 6,279,168 bytes。
- 2026-08-04：测量只记录逻辑文件数与字节数，没有把 Electron runtime、WebView2 或最终安装器压缩大小冒充已知结果。Tauri 的当前构建关闭正式 bundle，WebView2 Evergreen/Fixed/Bootstrapper 分发成本尚未测量。
- 2026-08-05：在当前 checkout 的空 `NEURO_BOOK_OUTPUT_DIR` 完成 clean Build A。Runtime Image manifest 报告 `dirty=false`、source revision `9c1c0f3564fbb1543a9ef198bccf31d9c1eef112`、source digest `sha256:d2d110e00f0957c36507f587107457aa819d1b4a9e6dd3355205f8bb662cde45`、imageId `sha256:f4010c53f1ae261a7574294be41dbb737a91d31439d3be8ce5b809dd6fbbb4e3`，共 3,242 个文件 / 134,529,839 bytes，shape digest `sha256:5548e16f91f23d3cedf43aa61c15a8cc65fdcde06673aa18346b464f45ce62d4`。Owner inventory 为 authoring-kit 513/14,745,912、commands 109/10,748,046、frontend 181/15,882,924、native-islands 2,059/75,260,633、runtime-meta 3/5,069、server-bundle 1/12,557,491、system-assets 376/5,329,764；该候选已通过 Product Runtime Image verifier，但文档随后还会进入最终 Build B。

## Acceptance Matrix

| ID | 当前结果 | 证据 / 边界 |
| --- | --- | --- |
| S1 | 通过 | verified Product fixture、Contract v4、动态启动入口和 source identity 均已审计。 |
| S2 | 通过（headless） | 两个壳均通过动态 `127.0.0.1` port 的 version health；cookie 属性尚未单独做浏览器检查。 |
| S3 | 未完成 | SSE/WebSocket 长连接与断开没有在真实窗口中验证。 |
| S4 | 未完成 | Monaco、TipTap、剪贴板、拖放、下载和文件对话框只生成了人工验收范围，没有自动点击或视觉验收。 |
| S5 | 自动审计通过 | Electron isolation/sandbox/navigation、Tauri loopback CSP/capability 均通过静态安全审计；页面运行时 Origin 行为仍需人工验收。 |
| S6 | 通过（focused） | Electron `requestSingleInstanceLock` 与 Tauri lock fixture 的第二实例竞争已通过；没有把第二实例 UI 转发冒充为完整人工验收。 |
| S7 | 部分通过 | 两个壳的空 State Root 首次启动均完成 Product-owned migration、health 和认证 graceful shutdown；Electron 复用 Owned Process，Tauri spike 的 forced fallback 仍是 `taskkill /T /F`，不是生产级共享 Owned Process/Job Object 合同。crash/disconnect 后完整进程树证明未完成。 |
| S8 | 自动 smoke 通过（上一轮 dirty spike 包） | 两包 Application Root 均为 3,240 文件，digest `sha256:c2e250be2deb50d567c3510aef1b33e6310c94a4246cc311829d3d67d2fe2144` 前后不变；两个 State Root 均完成移出/移回和进程退出后的删除。该证据使用旧 dirty Product，最终 clean Product 包待 Build B 后重做；完整 WebView profile 回收仍未验证。 |
| S9 | portable measurement 通过（上一轮 dirty spike 包） | K/L 两次输入完全相同：Electron 3,324 文件 / 597,293,364 bytes / ZIP 230,564,235 bytes；Tauri 3,247 文件 / 241,920,090 bytes / ZIP 84,492,619 bytes。冷启动沿用同一运行时输入的既有测量（Electron 14,878 ms、Tauri 14,444 ms）；这些数字不作为 clean Release baseline，稳定 RSS、安装器/updater 和 WebView2 分发成本仍未测量。 |

## Findings and Follow-ups

- 本 spike 证明两个桌面壳可以保持薄层边界，复用 Product Runtime Contract v4 和现有生命周期；它没有证明任何框架已经达到生产发布条件，也没有修改 ADR 0009/0010 的最终选择。
- Tauri 的单文件 release executable 明显小于 Electron Chromium runtime，但这不是完整安装包对比：Tauri 仍需 WebView2 分发策略，Electron 还需把 runtime、Product Image、Bun 和资源一起计入安装载荷。
- 生产实现前必须把 Tauri 的强制收口接入共享 Owned Process/Windows Job Object 或等价的受控 native supervisor；不得把当前 `taskkill` fallback 带入正式 Desktop Envelope。
- 生产实现前必须完成真实窗口的 S3/S4/S5/S8 场景，并分别测量冷启动、RSS、压缩安装器、WebView2 Evergreen/Fixed/Bootstrapper 与升级/卸载行为。
- 当前 checkout 已完成 clean Build A，并将在文档收口后执行 Build B 与最终 Portable smoke；这仍不构成跨平台完成或 Electron/Tauri 的生产选择。

## Portable Packaging Phase

本阶段继续使用同一 Task 140，不创建第三个桌面架构。目标是生成两个 Product-only Desktop Envelope spike ZIP：

```text
portable-root/
├─ app/.output/              # 只读、已验证的 Windows Product Runtime Image
├─ runtime/bun.exe           # 随包 Bun runtime
├─ desktop/                  # Envelope、launcher bundle、桌面 runtime
├─ data/                     # Portable State Root；用户内容 owner
├─ .cache/                   # Portable Cache Root；可重建数据
└─ manifest.json             # image、source、runtime、root 和 webview identity
```

Electron 包携带完整 Chromium runtime；Tauri 包只携带 release executable，并在 manifest 中明确依赖系统 WebView2 Evergreen。两个包都提供包相对 launcher 与 `--headless` smoke，不要求普通用户设置 `T140_*` 环境变量。包内不携带完整 Source、根 `node_modules`、用户数据、固定 token 或未经验证的 `.output`。

Portable 验收必须在仓库外、祖先没有 `node_modules` 的临时目录中完成，且清空 `NODE_PATH`；必须检查 Product Contract、动态端口、migration/Profile 准备、认证 shutdown、Application Root digest、端口/进程收口和包内绝对路径泄漏。两次从同一输入组包的 payload identity 必须一致，时间戳不计入比较。

本阶段仍不提供签名、安装器、updater、卸载器、跨平台包或最终 Electron/Tauri 决策。Tauri 的系统 WebView2、Electron Chromium 体积、Tauri forced fallback 的生产级 Owned Process/Job Object，以及真实窗口交互都单独记录，不以单个 exe 大小代替完整 portable 包结论。

## Portable Packaging Result (2026-08-05, historical dirty spike)

- 使用 verified Product image `sha256:5a35e96ad4f642c555d7dba63a656087e5cb813683aabbb87642166faca5749b`、Contract v4、Bun 1.3.14，在同一 Windows x64 输入上连续生成 K/L 两批 ZIP。Product image 的 source revision 为 `d08199fdc56a6b8e7e3ec0670daa009d5b99c732`，`dirty=true`，所以该段只保留作历史 spike 证据，不能作为正式 Release 或当前 clean baseline。
- 最终交付目录为 worktree 外的 `.agent/artifacts/t140-desktop-portable/`，包含：
- `neuro-book-electron-portable-win-x64.zip`：3,324 文件、597,293,364 bytes，ZIP 230,564,235 bytes，payload digest `sha256:eb3340c9987721e8f5697be8c9fcd98b98cc4d50ee526b21a89d7e50d2ef6310`。
  - `neuro-book-tauri-portable-win-x64.zip`：3,247 文件、241,920,090 bytes，ZIP 84,492,619 bytes，payload digest `sha256:318cee4013c90cfe025a89e32cbd22123f7b5cc474772296b371123a0617cb67`。
- K/L 的 Electron payload digest、Tauri payload digest、ZIP SHA-256 和 payload shape 均一致；ZIP SHA-256 分别为 `c8aa5356a249285406ff0a7b27fc5c08a601510a498264ca5d38c2ac2e711010` 与 `49041726c3cfbefba33b6862b687a21dffaf7a68a0c52d72bf9298da8b92e5c1`。Electron 携带 75 文件 Chromium runtime；Tauri 只携带 release executable，manifest 标明 `Microsoft WebView2 Evergreen` 为系统前置条件。
- 两包均从仓库外且祖先无 `node_modules` 的临时根启动，清空 `NODE_PATH`，自动执行 Product-owned SQLite/Application State migration，准备 14 个 system profiles，通过动态 loopback health/version；无效 shutdown token 返回 `401`，随后由 envelope 内存中的 token 完成认证 graceful shutdown。Electron 动态端口为 `59372`；Tauri 动态端口为 `9883`；两次退出码均为 0。
- 两包的 Application Root 均为 3,240 文件、134,488,581 bytes，digest `sha256:c2e250be2deb50d567c3510aef1b33e6310c94a4246cc311829d3d67d2fe2144`，启动前后不变。两个 State Root 均完成移出/移回，Product 进程退出后可删除，Application Root 和 Cache Root 不受影响。
- 本轮补修了三个 packaging 级问题：Electron `resources/app` 反推 portable root 少退一层；Windows Scoop shim 不能作为随包 Bun，打包器现在拒绝 `shims` 与 `node_modules/.bin` 路径；Tauri 与 Electron 的 headless 参数统一支持 `--headless`。空 Portable State Root 的 migration 由共享 launcher 的 `prepare` 合同步骤完成。
- 仍未完成的门禁：真实窗口及 SSE/WebSocket、Monaco/TipTap、剪贴板、拖放、下载、文件对话框和 Origin 行为；稳定 RSS；WebView2 Evergreen/Fixed/Bootstrapper 分发成本；Tauri 生产级 Owned Process/Job Object 强制收口；签名、安装器、updater、卸载器和跨平台 runner。不得据此冻结 Electron/Tauri 生产选择。
