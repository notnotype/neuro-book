# Task 145：Electron Desktop Productization

## 目标

将 Task 143/144 的 Electron Desktop Envelope 从可见验收 spike 收口为 Windows 内部 beta 产品。首发只支持本地 Product，提供当前用户安装、全局程序安装和 Portable；Manager CLI 继续拥有安装、校验、迁移、回滚、修复、卸载和 Product 生命周期，Manager GUI 只提供向导和状态投影。

关联生产 Issue：[Issue #87](https://github.com/notnotype/neuro-book/issues/87)（`Refs #66`）。

## 当前状态

**Windows x64 内部 beta candidate 已完成代码与自动化收口，尚未作为公开发行版发布。** Product candidate 的 Source revision 为 `37ca96bc`；Task 144 的启动页、Desktop Bridge v2、动态 loopback、startup nonce、单实例、托盘、Workbench Chrome 和 graceful shutdown 已迁移到本生产分支。本轮已经加入：

- `Desktop Installation Manifest v2`：记录 `installationScope`、程序根、用户 Root、组件 receipts 和默认保留 State Root 的卸载策略；
- 当前用户与全局安装目录选择，machine scope 写入 `Program Files` 前执行权限门禁；
- 本地 Desktop 默认写入 `auth.enabled: false`，只有显式 `--enable-auth` 才读取密码并创建管理员；
- `desktop configure-provider --stdin-json`，API Key 只经 stdin 写入现有 Global Config（`State Root/workspace/.nbook/config.json`）；
- 与主 Electron 共用 Chromium 的 Manager GUI 入口：`--manager-gui`、`manager-main.mjs`、`manager-preload.cjs` 和本地向导页面；
- Portable 将 Manager GUI 入口和 `NeuroBook-Manager.cmd` 放入同一 Electron 载荷，避免复制 Chromium；
- `ensureDirectory()` 兼容 Windows/Bun 对已存在只读目录返回 `EEXIST` 的行为，同时仍拒绝把文件当目录。

## 合同

- 当前用户安装：`%LOCALAPPDATA%/Programs/NeuroBook`。
- 全局安装：`%ProgramFiles%/NeuroBook`，需要可写 `Program Files` 的提升权限；State、Cache、Desktop/WebView 仍使用登录用户的根。
- Portable：沿用 Installation Root 下的 `data/`、`.cache/` 和 `data/.desktop/`。
- 只注册 `neurobook://`、开始菜单、桌面快捷方式和卸载项；不注册 `.nbook` 文件扩展名。
- Desktop 默认关闭 auth；Provider 连接测试与远端连接、后台 updater、公开签名、macOS 实包和 Tauri 可见 UI 不在本 Task。

## 实现记录

### Manager CLI / GUI

Manager CLI 增加 `desktop install --scope user|machine --enable-auth --json`，`--json` 输出单行阶段/完成事件供 GUI 消费。Manager GUI 通过同一 Electron Runtime 的 `--manager-gui` 入口运行，使用安全 preload 调用 CLI，未向 Renderer 暴露 shell、文件系统或 Manager secret。

GUI 当前提供 Depot 选择、用户/全局安装选择、Provider 类型/Base URL/模型/API Key、离线测试警告、auth 选择、安装/修复/状态/卸载和退出；Provider 测试失败仍允许保存，API Key 在测试后清空。安装、校验、迁移、注册和卸载仍由 CLI 完成。

### 首次引导与 Provider

本地 Desktop 新安装先创建 `config.yaml` 的 `auth.enabled: false`，不自动创建管理员。显式启用 auth 时沿用现有 `createAdmin` 的 `--password-stdin` 传递；Provider 配置沿用仓库当前 Global Config 真值源，而不是把业务 Provider 写回 Boot Config。

### 载荷

Electron main/preload/manager entry/manager preload/启动页/Manager 页面都进入 `app.asar`；Product、Source、Bun、Tool Pack 和 native islands 保持在 ASAR 外。Portable 仍只构建一次 Electron Runtime，不复制第二份 Chromium。

## 验证

### 聚焦和构建门禁

- `bun run manager:test`：40 个测试文件通过、1 个跳过；289 个测试通过、3 个跳过；Manager release contract 1/1 通过。
- `bun run manager:typecheck`、`bun run typecheck`、`bun run test:desktop-contract`：通过；Desktop Contract 为 8 个文件 / 31 个测试。
- `bun run manager:build`、`bun run --cwd desktop/spikes/electron build`：通过；Electron 生成 `main.mjs`、`preload.cjs`、`manager-main.mjs`、`manager-preload.cjs`。
- `packages/neuro-book-manager/src/files.test.ts` 与 `desktop-installation.test.ts`：2 个文件 / 15 个测试通过；新增目录 `EEXIST` 回归覆盖。

### 最终 Product A/B

- Build A/B 均为 3241 个文件、134016535 bytes。
- image identity：`sha256:5eb2ee830d0d4fe2e7da817564007d2a6ac309f0010fb06e9c7dd3b3d97e3e77`。
- A/B 的 shape digest 与 payload identity 一致；Build warning 仅为 Nuxt sourcemap、chunk size 和 `node:sqlite` external 提示。

### 最终 Portable/Depot

同一 Product image、同一 Manager/Electron dist 组包两次，结果逐字节一致：

- Electron Portable：9608 个文件、985584699 bytes payload，ZIP 389349707 bytes，SHA-256 `d1ee3f2a9a06bb4f38cb35fe2f9281d93e02bf425fd9025be8248f7384982232`。
- Tauri Portable：9531 个文件、630952015 bytes payload，ZIP 243582137 bytes，SHA-256 `6f0098d8f9b2f1b8aa8cc0f9bef25092ac3fece88eec4b2e32c4ebc775f1765c`；本轮只保留 headless/合同输入，不重新做 Tauri 可见 UI。
- Aggregate Depot：7 个文件、632947326 bytes payload，ZIP 627839386 bytes，SHA-256 `910c2c364babbb9d53b50a641c3fb0262d9a35dfa8cdabb0c6d871003682c601`。

### 仓库外 Product 与 Electron 验收

- Product archive 在祖先目录没有 `node_modules` 的 `C:\nbook-t145-final-product-37ca-5eb2ee83` 中通过 migration、全部 Windows release checks、Profile HTTP 编译、sqlite-vec、Sharp、Workspace CLI、hostile `NODE_PATH`、错误/正确 shutdown token、graceful shutdown 和 State Root 移动删除。
- 最终 Electron Portable 的 Manager GUI 从 `app.asar/manager.html` 加载；CDP 检查确认 2 个 `<select>`、Provider 离线测试返回 warning 且 API Key 清空。
- 最终主 Electron CDP：标题栏 `y=0,height=36px`，页面根 `y=36`，旧 Header 计数为 0，未使用 `backdrop-filter`；关闭后 Electron/Product 进程均收口。
- 当前用户安装/卸载：安装根、State/Cache/Desktop roots、`neurobook://`、开始菜单和桌面快捷方式均实际验证；卸载删除程序、Cache、Desktop/WebView、注册项和快捷方式并保留 State Root。
- 全局安装的非提升路径按合同 fail-closed，返回“全局安装需要管理员权限写入 C:\Program Files”；真正的 UAC 提升安装尚未在本机自动化执行。

## 偏差与后续

计划文字把 Provider 配置称为 State Root `config.yaml`；当前仓库已冻结的运行合同是 `State Root/workspace/.nbook/config.json`，`config.yaml` 只负责 Boot Config。为避免破坏 B/S、Product 和 CLI 既有真值源，本 Task 保留现有 Global Config 路径，并在 ADR 0014 明确记录该偏差。

仍未在本 Task 声称完成：后台 updater、公开代码签名、macOS `.app`、远端 Desktop、文件扩展名关联、Tauri 可见 UI、真实托盘/Snap Layout/文件对话框和真实 Provider 成功连接。它们分别属于后续发行或原生验收任务，不影响当前 Windows 本地内部 beta candidate 的可复核性。
