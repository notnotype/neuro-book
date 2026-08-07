# ADR 0016：Windows Machine-scope UAC Broker

- 状态：Proposed（等待用户确认）
- 日期：2026-08-07
- 关联任务：[Task 145](../tasks/145-electron-desktop-productization/README.md)
- 相关决策：[ADR 0014](0014-electron-desktop-productization.md)
- 生产 Issue：[Issue #87](https://github.com/notnotype/neuro-book/issues/87)

## 背景

当前用户安装、Portable 和 Manager CLI 的安装事务已经闭环；全局安装还缺少从普通权限 Manager GUI 进入 UAC 提升后的完整交互。现有
[`install-desktop.ps1`](../../scripts/install/install-desktop.ps1) 可以调用
`Start-Process -Verb RunAs`，但提升后的进程脱离原来的 NDJSON/stdin 通道，并且在
`--password-stdin` 场景下明确拒绝继续。

Manager GUI 不能把管理员密码放进命令行参数、环境变量、普通临时文件或日志。GUI 也不能自己复制安装、校验、迁移、回滚和注册逻辑。

## 推荐决策

Manager GUI 保持普通权限，machine-scope 操作由一个一次性的 elevated Manager Broker 执行。Broker 仍调用同一个 Manager CLI 逻辑，只增加跨权限传输层：

1. GUI 主进程生成一次性随机 pipe 名称、连接 nonce 和 operation ID，并创建只允许当前用户/System 访问的 Windows named pipe。
2. GUI 通过 `Start-Process -Verb RunAs` 启动安装根内的 Manager/Bun Broker；命令行只包含非敏感的 pipe 名称、nonce、operation ID 和逻辑命令 ID。
3. Broker 连接后先完成 nonce、父进程/operation 身份和协议版本握手，再接收安装参数。
4. 参数和阶段事件使用版本化 NDJSON；管理员密码使用独立的内存字节帧写入 CLI stdin，不进入 NDJSON、argv、环境变量、磁盘或日志。
5. Broker 只允许一个请求、一个完成回执或一个失败回执；UAC 取消、pipe 断开、超时和校验失败都回滚 staging，并把明确状态回传 GUI。
6. GUI 继续展示阶段、Retry、Repair、Open Logs 和 Quit；CLI 直接从已提升终端运行的合同保持不变。

## 不变量

- Broker 不能执行任意 shell、任意 Manager 子命令或任意路径；只接受 GUI 已选择的 machine Desktop install/repair/uninstall 动作。
- pipe 名称、nonce 和 operation ID 不持久化；一次操作结束立即关闭 pipe。
- 密码最大长度、UTF-8 字节语义和 `--password-stdin` 合同与 Product/Manager 现有实现一致。
- 安装路径、组件摘要、receipt、Registry/HKLM 和 Public 快捷方式仍由 Manager 事务拥有；Broker 不绕过 `assertInstallationScopeWritable()`、payload verification 或 rollback。
- UAC 取消不能留下半安装目录、未提交 receipt、注册项、快捷方式或密码痕迹。

## 未采用

### 只调用 PowerShell 安装脚本

实现简单，但 GUI 无法可靠接收实时阶段和失败回滚；启用 auth 时还会失去 stdin 密码合同。

### 让整个 Manager GUI 重新以管理员身份启动

可以保留普通 stdin/stdout，但会复制窗口状态、Provider 草稿和安装事务，且需要另一套跨进程 Secret 交接；不接受这种隐式双实例。

### 继续只允许用户级安装

安全风险最低，但不满足 Task 145 的 machine-scope 产品合同，只能作为明确的临时 beta 限制。

## 验收要求

- 非管理员 Windows 用户从 Manager GUI 选择 machine scope 后出现真实 UAC；允许、拒绝和取消都分别有可读结果。
- machine install 的阶段、checksum、迁移、注册项、快捷方式、失败回滚和卸载都由同一 Manager CLI 完成。
- auth 开启时覆盖 Unicode 密码、空换行语义、超限输入，以及 argv/env/NDJSON/log 不含明文。
- UAC 取消、Broker 崩溃、pipe 超时和父 GUI 退出后，Installation Root、HKLM/HKCU 注册项、Public/桌面快捷方式和 staging 均无残留；State Root 保持既定卸载策略。
- 完成自动化后必须在真实 Windows 桌面执行一次可见 UAC 验收；未执行前不得把 machine scope 写成已完成。
