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
- Manager GUI 通过已 Accepted 的 [ADR 0016](0016-windows-desktop-uac-broker.md) 一次性 UAC Broker 请求 machine-scope 安装、修复和卸载；Broker 的协议、secret 传递和真实 Windows UAC 生命周期已通过 Task 145 验收。
- Portable：程序和用户数据跟随解压根移动。
- `Desktop Installation Manifest v2` 必须记录安装范围、程序相对根、用户 Root locators、组件 receipts 和默认保留 State Root 的卸载策略。
- 卸载默认删除程序、Cache、Desktop/WebView 和有界日志，保留 State Root；明确选择删除数据时才删除托管 State Root，外部 Project Workspace 永不删除。

### 首次引导与认证

本地 Desktop 默认 `auth.enabled=false`，安装不创建管理员。只有用户显式开启 auth 后才通过现有 Product 管理员流程创建账户，密码只经 stdin 进入子进程，不出现在 argv、环境、日志或 NDJSON。

Provider 配置使用当前 Global Config 合同：`State Root/workspace/.nbook/config.json`。计划中的“config.yaml”名称与现有仓库合同冲突；本 ADR 选择保留已验证的 Global Config 路径，避免把业务 Provider 写进 Boot Config。

### 发行形态

- 联网 Bootstrap：只准备 Bun 并启动 Manager/GUI；组件下载和校验由 Manager 完成。
- 离线 Depot：包含共享 Electron Runtime、Manager GUI、主 Electron、verified Product、Bun 和可选 Tool Pack。
- Product、Source、Bun 和 native islands 不进入 ASAR；Electron 壳代码、启动页和 Manager GUI 进入 `app.asar`。
- 首版不实现后台 updater，不声称公开代码签名；manifest 保留来源和签名字段的扩展位置。

## 后果

用户可以在不打开终端的情况下完成本地安装和首次 Provider 配置；全局安装需要系统权限但不改变用户数据位置。共享 Chromium 降低安装包重复体积，同时要求 Manager GUI 与主应用严格复用 Desktop/Manager 合同。

## 未采用

- 为 Manager GUI 再携带一份 Electron Runtime；
- 让 GUI 自己执行 Product migration 或直接持有 shutdown token；
- 把 Provider secret 放进命令行参数、环境变量或持久化日志；
- 在首版同时冻结远端 Desktop、Tauri UI、updater、公开签名和 macOS 实包。
