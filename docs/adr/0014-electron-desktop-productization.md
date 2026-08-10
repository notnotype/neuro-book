# ADR 0014：Electron Desktop Productization

- 状态：Accepted
- 日期：2026-08-07
- 关联任务：[Task 145](../tasks/145-electron-desktop-productization/README.md)
- 继承 spike：[ADR 0013](0013-desktop-envelope-distribution-and-interaction.md)、[Issue #66](https://github.com/notnotype/neuro-book/issues/66)
- 生产 Issue：[Issue #87](https://github.com/notnotype/neuro-book/issues/87)

## 背景

Task 143/144 已证明 Electron Envelope 可以在同一 Product Runtime Image 上完成启动页、Desktop Bridge v2、Workbench Chrome、动态 loopback、单实例和 graceful shutdown。它们仍是 spike：没有稳定的 Manager GUI、双安装范围、首次引导和内部 beta 的发行载荷合同。

## 决策

### Electron 首发

Electron 是第一个真实桌面壳。首发只做 Windows 本地 Product；Tauri 可见 UI、远端 Desktop、后台 updater、公开签名和 macOS 实包另行处理。主应用与 Manager GUI 使用同一个 Electron/Chromium Runtime，两个入口是独立进程，不重复携带 Chromium。

### Manager 边界

Manager CLI 继续拥有安装、组件摘要、迁移、修复、回滚、卸载、Tool/Runtime 管理和 Product Supervisor。Manager GUI 只能通过 CLI/Supervisor 的结构化事件驱动向导、进度和错误页，不复制 Product、数据库、Profile、Workspace 或 shutdown 实现。

### 安装范围与生命周期

- `user`：程序位于 `%LOCALAPPDATA%/Programs/NeuroBook`。
- `machine`：程序位于 `%ProgramFiles%/NeuroBook`，需要提升权限；State、Cache、Desktop/WebView 仍按登录用户隔离。
- 两种 Installed scope 共享同一组用户 Root，因此同一登录用户不能同时保留 user 与 machine 程序根；发现另一 scope 的有效安装或残留时 fail closed，交给 Repair/Uninstall 处理。Portable 不参与该互斥。
- Manager GUI 通过已 Accepted 的 [ADR 0016](0016-windows-desktop-uac-broker.md) 一次性 UAC Broker 请求 machine-scope 安装、修复和卸载；Broker 的协议、secret 传递和历史 Windows UAC 基线已通过验收。当前最终包仍需在不接管既有用户 State Root 的干净用户环境中重跑 machine UAC，不能把历史包结果当作当前包证据。
- Portable：程序和用户数据跟随解压根移动。
- `Desktop Installation Manifest v3` 必须记录安装范围、程序相对根、用户 Root locators、组件 receipts、Manager/Application Runtime 与 Git/rg provider，以及默认保留 State Root 的卸载策略。`v2` 不是兼容输入，必须由 Manager repair/reinstall 生成 v3。
- provider 选择分为 `managed` 和 `system`：Manager 自身始终保留可修复的 managed Bun；Product Bun 与 Git/Bash/rg 可以使用 system，但只检测 PATH 和版本，不自动调用系统包管理器。managed 工具只注入 Product 私有 PATH。
- Desktop Manifest 与 Product `installation.json` 必须投影同一份 Product Bun、Git/Bash 和 rg provider；不能只改变 Electron 启动参数。Electron 始终使用 managed Manager Bun 启动 Supervisor，Supervisor 再按 Product manifest 选择 Application Runtime。
- 安装完成回执只能在 Product Runtime 完整校验、Application State migration plan、一次 HTTP ready 和 graceful shutdown 都完成后生成。普通启动继续复用同一 Manager lifecycle，不在 Electron 中复制 migration 或健康检查。
- 默认卸载保留的非空 State Root 只有在真实目录中的 `config.yaml` 能被 Boot Config parser 解析，且包含已登记的 `auth`、`server` 或 `database` 所有权字段时才允许重装复用；symlink/junction、任意 YAML 和未知非空目录都拒绝接管。
- 卸载默认删除程序、Cache、Desktop/WebView 和有界日志，保留 State Root；明确选择删除数据时才删除托管 State Root，外部 Project Workspace 永不删除。
- Manager GUI 的安装完成事件只作为候选输入；GUI 必须在启动主 Electron 前重新读取并校验 Desktop Installation Manifest、安装范围、Electron Envelope 路径和 checksum，不能复用上一次操作的裸 Installation Root。
- Canonical Installed root 缺少 `runtime-locators.json` 或 `desktop-installation.json`、manifest 损坏或 installation scope 与程序根不一致时，Envelope 必须停在本地启动页并引导 Manager Repair；不得回落到 Portable 的 `data/.cache` 布局。Portable 只有在非 canonical root 且没有安装清单时才使用 installation-scoped roots。

### 首次引导与认证

本地 Desktop 默认 `auth.enabled=false`，安装不创建管理员。只有用户显式开启 auth 后才通过现有 Product 管理员流程创建账户，密码只经 stdin 进入子进程，不出现在 argv、环境、日志或 NDJSON。

Provider 配置使用当前 Global Config 合同：`State Root/workspace/.nbook/config.json`。计划中的“config.yaml”名称与现有仓库合同冲突；本 ADR 选择保留已验证的 Global Config 路径，避免把业务 Provider 写进 Boot Config。

### 发行形态

- 联网 Bootstrap：只准备 Bun 并启动 Manager/GUI；组件下载和校验由 Manager 完成。
- 离线 Depot：包含共享 Electron Runtime、Manager GUI、主 Electron、verified Product、Bun 和可选 Tool Pack。
- 离线 Bootstrap 只从 Portable 中精确提取并校验 managed Bun 与单文件 Manager bundle，随后仍调用正式 Manager；不得在 PowerShell 中复制 payload 安装、migration、注册或回滚逻辑。
- 聚合 Depot 的嵌套 Portable 只在当前安装事务中短期展开，成功或失败后删除，不在 Manager Cache 额外长期保留一份完整 Electron Portable。HTTPS 组件仍使用按摘要命名的下载缓存。
- Product、Source、Bun 和 native islands 不进入 ASAR；Electron 壳代码、启动页和 Manager GUI 进入 `app.asar`。
- 首版不实现后台 updater，不声称公开代码签名；manifest 保留来源和签名字段的扩展位置。
- Portable 包内的 `installation.json` 是未安装模板；其时间字段沿用 verified Product 的稳定构建时间，实际 user/machine 安装时间由 Manager 安装事务写入。

## 后果

用户可以在不打开终端的情况下完成本地安装和首次 Provider 配置；全局安装需要系统权限但不改变用户数据位置。共享 Chromium 降低安装包重复体积，同时要求 Manager GUI 与主应用严格复用 Desktop/Manager 合同。

## 未采用

- 为 Manager GUI 再携带一份 Electron Runtime；
- 让 GUI 自己执行 Product migration 或直接持有 shutdown token；
- 把 Provider secret 放进命令行参数、环境变量或持久化日志；
- 在首版同时冻结远端 Desktop、Tauri UI、updater、公开签名和 macOS 实包。
