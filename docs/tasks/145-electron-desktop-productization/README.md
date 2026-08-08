# Task 145：Electron Desktop Productization

## 目标

将 Task 143/144 的 Electron Desktop Envelope 从可见验收 spike 收口为 Windows 内部 beta 产品。首发只支持本地 Product，提供当前用户安装、全局程序安装和 Portable；Manager CLI 继续拥有安装、校验、迁移、回滚、修复、卸载和 Product 生命周期，Manager GUI 只提供向导和状态投影。

关联生产 Issue：[Issue #87](https://github.com/notnotype/neuro-book/issues/87)（`Refs #66`）。

## 当前状态

**当前分支 HEAD `912bc093` 的 Electron 壳门禁、聚焦测试、同一 verified Product image 的重组包和仓库外 Portable/Manager smoke 已通过。** machine-scope 的真实 UAC install/repair/uninstall 尚未在本轮最终包上完成：实际用户 State Root 已存在时，安装前置检查按合同拒绝覆盖，未触碰用户数据。当前 verified Product Source revision 为 `b2e6d986ec04672922725bd1db3fc13c95297c7c`，Product image 为 `sha256:2c6cc85a7cbbcbd77b73f6d135c55a02f73424befbfd89e2f8e818e0890ef813`；Task 144 的启动页、Desktop Bridge v2、动态 loopback、startup nonce、单实例、托盘、Workbench Chrome 和 graceful shutdown 已迁移到本生产分支。本轮已经加入：

- `Desktop Installation Manifest v3`：记录 `installationScope`、程序根、用户 Root、组件 receipts、Manager/Application Runtime 与 Git/rg provider，以及默认保留 State Root 的卸载策略；旧 v2 不静默兼容；
- 当前用户与全局安装目录选择，machine scope 写入 `Program Files` 前执行权限门禁；
- 本地 Desktop 默认写入 `auth.enabled: false`，只有显式 `--enable-auth` 才读取密码并创建管理员；
- `desktop configure-provider --stdin-json`，API Key 只经 stdin 写入现有 Global Config（`State Root/workspace/.nbook/config.json`）；
- 与主 Electron 共用 Chromium 的 Manager GUI 入口：`--manager-gui`、`manager-main.mjs`、`manager-preload.cjs` 和本地向导页面；
- Portable 将 Manager GUI 入口和 `NeuroBook-Manager.cmd` 放入同一 Electron 载荷，避免复制 Chromium；
- `ensureDirectory()` 兼容 Windows/Bun 对已存在只读目录返回 `EEXIST` 的行为，同时仍拒绝把文件当目录；
- machine-scope GUI 已接入一次性 UAC Broker：安装、修复和卸载均由提升后的同一 Manager CLI 执行，控制管道与密码管道分别进行 nonce/operation 身份握手；
- machine-scope GUI 已接入一次性 UAC Broker；当前最终包的非提升路径已按合同 fail-closed，真实提升路径因实际用户 State Root 已存在而未执行，历史包的成功 UAC 证据单独标记为基线，不作为当前包证据；
- 修复了 machine canonical root 仍被 Installed v1 校验拒绝，以及 GUI uninstall 未传 `--json` 导致 UAC Broker 解析失败的两个回归。
- Follow-up 已将 Manager GUI `manager:run` 收窄为 typed operation，补充页面/frame/origin 导航门禁、固定 State Root 展示和 stdout/stderr drain；UAC 控制合同升级为 v2，repair/uninstall 绑定 installation root、installation ID、manifest 摘要和 deleteData；
- Follow-up 已让 Electron 从安装清单解析 application runtime 与 managed tool 私有 PATH，并在生产启动时不再自动消费 `NBOOK_DESKTOP_DEV_*` 环境覆盖；缺失 Installed locator 时 fail closed 到 Repair。
- Follow-up 又将 Manager GUI 的安装完成回执绑定到已验证的 Desktop Installation Manifest、安装范围和 Electron Envelope checksum；Portable 模板不再写入固定构建日期，安装时间由实际 Manager 安装事务生成。
- Follow-up 复核发现 Installed locator 存在但 `desktop-installation.json` 缺失或 scope 不一致时仍可能落回 Portable runtime；Electron 与 Tauri 现在都在启动前 fail closed，并先显示启动页。Manager GUI 增加显式的“同时删除 State Root”确认，本地 Provider 没有 API Key 时也能保存。

真实 UAC 的取消/未连接路径仍返回 `uac-cancelled` 且不执行安装；历史包的成功路径保留在基线证据中，当前最终包的成功路径仍需在干净用户环境重跑。
[ADR 0016](../../adr/0016-windows-desktop-uac-broker.md) 已 Accepted。

## 合同

- 当前用户安装：`%LOCALAPPDATA%/Programs/NeuroBook`。
- 全局安装：`%ProgramFiles%/NeuroBook`，需要可写 `Program Files` 的提升权限；State、Cache、Desktop/WebView 仍使用登录用户的根。
- Portable：沿用 Installation Root 下的 `data/`、`.cache/` 和 `data/.desktop/`。
- 只注册 `neurobook://`、开始菜单、桌面快捷方式和卸载项；不注册 `.nbook` 文件扩展名。
- Desktop 默认关闭 auth；Provider 连接测试与远端连接、后台 updater、公开签名、macOS 实包和 Tauri 可见 UI 不在本 Task。

## 实现记录

### Manager CLI / GUI

Manager CLI 增加 `desktop install --scope user|machine --enable-auth --json`，`--json` 输出单行阶段/完成事件供 GUI 消费。Manager GUI 通过同一 Electron Runtime 的 `--manager-gui` 入口运行，使用安全 preload 调用 CLI，未向 Renderer 暴露 shell、文件系统或 Manager secret。machine scope 由一次性 UAC Broker 只接受白名单动作：`desktop install`、`desktop repair` 和当前安装的 `uninstall`。

GUI 当前提供 Depot 选择、用户/全局安装选择、Provider 类型/Base URL/模型/API Key、离线测试警告、auth 选择、安装/修复/状态/卸载和退出；Provider 测试失败仍允许保存，API Key 在测试后清空。安装、校验、迁移、注册和卸载仍由 CLI 完成。

### 首次引导与 Provider

本地 Desktop 新安装先创建 `config.yaml` 的 `auth.enabled: false`，不自动创建管理员。显式启用 auth 时沿用现有 `createAdmin` 的 `--password-stdin` 传递；Provider 配置沿用仓库当前 Global Config 真值源，而不是把业务 Provider 写回 Boot Config。

### 载荷

Electron main/preload/manager entry/manager preload/启动页/Manager 页面都进入 `app.asar`；Product、Source、Bun、Tool Pack 和 native islands 保持在 ASAR 外。Portable 仍只构建一次 Electron Runtime，不复制第二份 Chromium。

## 验证

### 聚焦和构建门禁

- `bun run manager:test`：41 个测试文件通过、1 个跳过；295 个测试通过、3 个跳过；Manager release contract 1/1 通过。
- `bun run manager:typecheck`、`bun run typecheck`、`bun run test:desktop-contract`：通过；Desktop Contract 为 11 个文件 / 40 个测试，新增 canonical Installed Manifest 和 Electron 启动配置恢复回归。
- `bun run manager:build`、`bun run --cwd desktop/electron build`：通过；Electron 生成 `main.mjs`、`preload.cjs`、`manager-main.mjs`、`manager-preload.cjs`。
- `packages/neuro-book-manager/src/files.test.ts` 与 `desktop-installation.test.ts`：2 个文件 / 15 个测试通过；新增目录 `EEXIST` 回归覆盖。
- UAC Broker focused：共享协议 4 个测试通过；Manager Broker 3 个测试通过，覆盖 machine action 白名单、UTF-8 stdin 字节传递、secret pipe 握手和 CLI 输出回显 fail-closed。
- 基础 machine root focused：InstallationMutation、Windows Uninstall Host、UAC Broker 共 3 files / 15 tests 通过；Desktop Manager GUI Contract 1/1 通过。Follow-up 的安装/UAC focused 为 2 files / 18 tests。
- 代码提交 `e5ec1534` 的必需检查（Windows/Linux/macOS Desktop/Product、Typecheck、Community files/docs）全部通过。`Full tests (advisory)` 在该提交重跑后仍未通过：`494 passed / 3 skipped`，两个 Harness 黑盒用例 30 秒超时；首次运行则是同一领域的 `ENOTEMPTY` 清理竞态。该 advisory 基线不涉及 Electron 壳或本轮文档变更，因此不改变桌面必需门禁结论，但不能把当前 CI 写成“全部通过”。
- Follow-up 新增回归：machine-scope 外置卸载 launcher 按安装清单中的 `manager/neuro-book.mjs` 生成，不再硬编码不存在的 `.runtime/manager`；UAC repair/uninstall 缺少 `--root` 时 fail closed。两文件 / 18 个 Manager focused tests 通过。
- Follow-up 已完成生产目录和命名收口：`desktop/electron`、`desktop/tauri`、`desktop/shared`、`desktop/packaging` 使用正式路径；活动源代码改用 `NBOOK_DESKTOP_DEV_*` 和 `--desktop-*` 测试入口，Tauri release binary 为 `neuro-book-tauri-envelope.exe`。迁移后的 `desktop-security-audit`、`cargo fmt --check`、`cargo check --locked`、Electron bundle 均通过。
- Follow-up 后重新通过 `bun run manager:test`（41 个测试文件通过、1 个跳过；295 个测试通过、3 个跳过）、Manager typecheck、根 typecheck、Electron bundle、Tauri `cargo fmt --check`/`cargo check --locked` 和 Desktop Contract（11 个文件 / 40 个测试）；`git diff --check` 通过。全量 `bun run test` 为 494 个测试文件通过、1 个跳过、3 个失败；失败分别是 Git 文本扫描 5 秒超时、忽略 AbortSignal 的 Harness 黑盒用例 30 秒超时，以及全套并发清理的 `ENOTEMPTY`。其中 Git 扫描单独以 60 秒预算通过，Harness 黑盒用例单独仍可复现超时，第三项单独运行通过；这些是独立基线问题，不归因于 Electron 改动。

### 最终 Product A/B

- Build A/B 均为 3241 个文件、134016535 bytes，`imageId`、tree digest、shape digest、Source digest 和 lockfile digest 完全一致。
- image identity：`sha256:2c6cc85a7cbbcbd77b73f6d135c55a02f73424befbfd89e2f8e818e0890ef813`；revision 为 `b2e6d986ec04672922725bd1db3fc13c95297c7c`，Product 为 3241 个文件 / 134016535 bytes；tree digest 为 `sha256:f442d09a2a40c11cafc4fb3014ca511e7698f15be27e45248d86716e4923d781`，shape digest 为 `sha256:5af1d40bfd4713bb2957fc2a28c914e412dace32bfef1e0f11573e5c6825a009`。
- Build warning 仅为 Nuxt sourcemap、chunk size 和 `node:sqlite` external 提示；A/B 没有发现 Product payload 漂移。

### 最终 Portable/Depot

同一 Product image、同一 Manager/Electron dist 组包两次，结果逐字节一致：

- Electron Portable：9609 个文件、985663532 bytes payload，ZIP 389367434 bytes，SHA-256 `870f6349a1249a7515c32f4cee183f2b2527994320054f8f31ad6d48a39ce81c`。
- Tauri Portable：9532 个文件、630965108 bytes payload，ZIP 243586839 bytes，SHA-256 `6f6d91d973a8b4cf3dcf3fa8b075aa79be24a056714b934f13e5cc5bc8e54e23`；本轮只保留 headless/合同输入，不重新做 Tauri 可见 UI。
- Aggregate Depot：7 个文件、632969989 bytes payload，ZIP 627861550 bytes，SHA-256 `555cd546d3ba9b5cc85d472f5ca680f6876e2a0f6e1c22b8f1f6afa35b2e1230`。
- 使用同一 verified Product image、同一 Manager/Electron dist 连续组包两次：Electron、Tauri、Aggregate Depot 及 sidecar manifest 均逐字节一致。

### Follow-up 壳门禁后的重组包

本轮只替换 Electron/Tauri Envelope 与 Manager GUI，不重跑 Product A/B；输入仍是已验证的 Product image `sha256:2c6cc85a7cbbcbd77b73f6d135c55a02f73424befbfd89e2f8e818e0890ef813`。最后一轮同一输入连续组包两次（`C:\t145-followup-6316375e-desktop-f`、`C:\t145-followup-6316375e-desktop-g`），六个归档/manifest 摘要逐字节一致：

- Electron Portable：9,608 个 payload 文件、985,666,351 bytes，ZIP 389,368,150 bytes，SHA-256 `873cdd7c94bb51171b7ee3c767517f9bbf2c20bc2929d15e5ccf9630e34c74b9`。
- Tauri Portable：ZIP 243,586,839 bytes，SHA-256 `6f6d91d973a8b4cf3dcf3fa8b075aa79be24a056714b934f13e5cc5bc8e54e23`。
- Aggregate Depot：7 个文件、632,970,705 bytes payload，ZIP 627,862,215 bytes，SHA-256 `2431dd7ab04c914335eafd822c3b5ecd436086f819844c5fe737cbab101bb5f5`。

新 Electron Portable 的仓库外 headless Product、Manager GUI headless 和 Manager GUI CDP 均通过；它们不替代真实 machine UAC、托盘或窗口 Snap 验收。

### 仓库外 Product 与 Electron 验收

- 仓库外当前最终 Portable 在 `C:\t145-current-b2e6d986-portable-smoke` 解压后，以祖先无 `node_modules`、无效 `NODE_PATH`、隔离 `LOCALAPPDATA` 通过 Product/Supervisor headless 启动和 graceful shutdown；Manager GUI headless 也通过。
- 最终 Electron Portable 的 Manager GUI 从 `app.asar/manager.html` 加载；CDP 检查确认 2 个 `<select>`、Provider 离线测试返回 warning 且 API Key 清空。
- 最终主 Electron CDP：标题栏 `y=0,height=36px`，页面根 `y=36`，旧 Header 计数为 0，未使用 `backdrop-filter`；关闭后 Electron/Product 进程均收口。
- 本次打包 Electron 的一次真实启动记录：启动页可见 `241.90 ms`，Product 后台验证完成 `1394.28 ms`，Product ready `11377.68 ms`，Desktop Bridge ready `11565.09 ms`，正式窗口 ready `11567.06 ms`。这是一轮观测值，不替代五次冷/暖启动统计；若需继续优化，应单开 Product Runtime 启动 profiling 任务。
- 远端协议 smoke 使用真实打包 Electron 连接 loopback capability 服务通过：Bridge 返回 `connection=remote`，origin 精确匹配，远端页面成功加载并 graceful shutdown；这不是完整远端 Product/B/S UI 验收。
- 最终 Electron Portable ZIP 完成一次隔离当前用户安装→顶层 `status`→卸载；生成 `nbook.desktop-installation/v3` 和外置 locator，卸载删除程序、Cache、Desktop/WebView 并保留 State Root。另以当前最终包验证了 system provider 的 managed/system manifest 解析、Product 启动和 `--delete-data` 卸载。
- 最终包的 machine-scope 非提升路径按合同 fail-closed，返回“全局安装需要管理员权限写入 C:\Program Files”，未创建 Program Files 目标。尝试通过 Manager GUI 触发真实 UAC 时，提升后的安装前置检查发现实际用户 `%LOCALAPPDATA%\NeuroBook\data` 已存在而 Installation Root 不存在，返回“Desktop 用户 Root 已存在但 Installation Root 尚未建立；拒绝覆盖”，因此本轮没有修改或删除该用户 State Root，也没有把该次尝试记为成功。
- Follow-up 前完成的真实 machine-scope UAC install/repair/uninstall 基线仍单独保留：Programs and Features、HKLM、协议、公共快捷方式、Cache/Desktop 删除和 State Root 保留均已通过；它使用旧包/旧 manifest，不能替代当前最终包证据。

## 偏差与后续

计划文字把 Provider 配置称为 State Root `config.yaml`；当前仓库已冻结的运行合同是 `State Root/workspace/.nbook/config.json`，`config.yaml` 只负责 Boot Config。为避免破坏 B/S、Product 和 CLI 既有真值源，本 Task 保留现有 Global Config 路径，并在 ADR 0014 明确记录该偏差。

仍未在本 Task 声称完成：后台 updater、公开代码签名、macOS `.app`、远端 Desktop、文件扩展名关联、Tauri 可见 UI、真实托盘/Snap Layout/文件对话框和真实 Provider 成功连接。它们分别属于后续发行或原生验收任务，不影响当前 Windows 本地内部 beta candidate 的可复核性。

### Follow-up 2026-08-08：本轮收口与仍未完成事项

- 本轮 focused 证据：Manager 41 files / 295 tests、Manager typecheck、根 typecheck、Desktop Contract 11 files / 40 tests、Electron bundle、Tauri release build、Tauri locator fail-closed 代码门禁和 packaging security audit 通过。
- 已运行：Follow-up 后 clean Product A/B、同一 verified image 的 Electron/Tauri/Depot 重复组包、仓库外 Portable headless、Manager GUI headless、当前最终包主 Electron CDP（书架、Project、标题栏、Activity Bar、Agent 面板、Dialog、File → Quit）、最终包当前用户安装/状态/卸载、system provider、machine 非提升 fail-closed。
- 尚未运行：Follow-up 后真实 Windows machine UAC install/repair/uninstall、Programs and Features 外置 launcher 的新包实测、五次冷/暖启动、真实托盘/Snap/file dialog、真实 Provider 成功连接。
- 本轮再次从当前安装的外置 launcher 发起 machine uninstall；自动化终端未获得可见 UAC consent，launcher 以 `exit=1` 结束，Program Files 安装和用户数据均未被触碰。该结果只能证明当前环境无法承接提升，不替代成功/取消两条 UAC 验收。
- 生产源目录已收口为 `desktop/electron`、`desktop/tauri`、`desktop/shared`、`desktop/packaging`；Task 143 历史文档仍保留旧 `desktop/spikes` 路径作为历史证据。`NBOOK_DESKTOP_DEV_*` 仅允许显式 headless/development 配置，生产启动会忽略这些覆盖；活动源代码与测试不再命中旧 `T140_*`/`*-spike-*` 名称。
