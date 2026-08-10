# ADR 0016：Windows Machine-scope UAC Broker

- 状态：Accepted
- 日期：2026-08-08
- 关联任务：[Task 145](../tasks/145-electron-desktop-productization/README.md)
- 相关决策：[ADR 0014](0014-electron-desktop-productization.md)
- 生产 Issue：[Issue #87](https://github.com/notnotype/neuro-book/issues/87)

## 背景

当前用户安装、Portable、Manager CLI 和 machine-scope UAC Broker 已完成协议与非提升 fail-closed 验证；历史包曾从普通权限 Manager GUI 进入提升后的安装、修复、卸载可见验收。此前
[`install-desktop.ps1`](../../scripts/install/install-desktop.ps1) 可以调用
`Start-Process -Verb RunAs`，但提升后的进程脱离原来的 NDJSON/stdin 通道，并且在
`--password-stdin` 场景下明确拒绝继续。

Manager GUI 不能把管理员密码放进命令行参数、环境变量、普通临时文件或日志。GUI 也不能自己复制安装、校验、迁移、回滚和注册逻辑。

## 推荐决策

Manager GUI 保持普通权限，machine-scope 操作由一个一次性的 elevated Manager Broker 执行。Broker 仍调用同一个 Manager CLI 逻辑，只增加跨权限传输层：

1. GUI 主进程生成一次性随机 pipe 名称、连接 nonce 和 operation ID，并创建一次性 Windows named pipe；控制管道和独立 secret 管道都必须完成身份握手。协议使用 `nbook.desktop-uac-broker/v2`。
2. GUI 通过 `Start-Process -Verb RunAs` 启动安装根内的 Manager/Bun Broker；命令行只包含非敏感的 pipe 名称、nonce、operation ID 和逻辑命令 ID。
3. Broker 连接后先完成 nonce、父进程/operation 身份和协议版本握手，再接收白名单动作参数。每个请求同时绑定 canonical Installation Root、installation ID、已有 manifest 的 SHA-256 摘要和 deleteData；install 不绑定已有 manifest，repair/uninstall 必须绑定并在提升进程中复核摘要。
4. 参数和阶段事件使用版本化 NDJSON；管理员密码使用独立 secret 管道的 nonce 握手后以内存字节帧写入 CLI stdin，不进入 NDJSON、argv、环境变量、磁盘或日志。
5. Broker 只允许一个请求（`desktop-install`、`desktop-repair` 或 `uninstall`）、一个完成回执或一个失败回执；UAC 取消、pipe 断开、超时和校验失败都回滚 staging，并把明确状态回传 GUI。
6. GUI 继续展示阶段、Retry、Repair、Open Logs 和 Quit；CLI 直接从已提升终端运行的合同保持不变。
7. Broker 必须等待 delegated CLI 退出且 stdout/stderr 全部 EOF 后才能发送 `complete`。结构化事件校验、重复卸载回执或 Secret 输出门禁失败时立即终止完整子进程树，排空管道并返回失败；不能把协议错误降级为普通日志。
8. machine uninstall 的 CLI `scheduled` 只表示外置 Host 已接管，不表示卸载完成。Broker、Manager GUI 和 Programs and Features launcher 都必须等待绑定 token/root 的 Host `ok=true` 回执；`ok=false`、畸形回执或超时保持失败/待处理状态。

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

## 验收结果

- 非管理员 Windows 用户从 Manager GUI 选择 machine scope 后出现真实 UAC；允许、拒绝和取消都分别有可读结果。
- machine install 的阶段、checksum、迁移、注册项、快捷方式、失败回滚和卸载都由同一 Manager CLI 完成。
- auth 开启时覆盖 Unicode 密码、空换行语义、超限输入，以及 argv/env/NDJSON/log 不含明文。
- UAC 取消、Broker 崩溃、pipe 超时和父 GUI 退出后，Installation Root、HKLM/HKCU 注册项、Public/桌面快捷方式和 staging 均无残留；State Root 保持既定卸载策略。
- 历史包已在真实 Windows 桌面完成 machine install、repair、uninstall；当前安装清单合同为 `nbook.desktop-installation/v3`，程序根为 `C:\Program Files\NeuroBook`，注册项和公共快捷方式使用 machine scope。Follow-up 的当前最终包尝试因实际用户 State Root 已存在而按 fail-closed 合同停止，尚未重新取得成功回执。
- 新包的 uninstall 入口改为 `--json` NDJSON，修复了 Broker 将 ANSI/多行人类输出误判为无效消息的问题；Installed user/machine 两类 canonical root 均由 lease、intent 和外置 Host 校验。
- Programs and Features 的 machine uninstall 入口只指向安装根外 `%LOCALAPPDATA%\NeuroBook\manager\uninstall\<installationId>` 下的轻量 launcher；launcher 只建立绑定 installation ID/root/manifest digest 的 UAC 请求，不复制卸载逻辑。
- Follow-up 已验证 launcher 使用 manifest 中的 `manager/neuro-book.mjs` 相对路径；repair/uninstall 缺少 `--root` 时 fail closed。Follow-up 后真实 UAC 允许路径仍需在没有既有托管 State Root 的干净用户环境中，以当前最终包重跑；本轮的阻断是安装所有权保护，不是 UAC 协议失败。
- 随后从当前安装的 launcher 再次尝试 machine uninstall 时，自动化终端未获得可见 UAC consent，launcher 以 `exit=1` 结束且 Program Files、State/Cache/Desktop 根未被触碰；该结果只记录为环境无法承接提升，不改变成功/取消路径合同。
- UAC 取消路径仍保持 fail-closed；成功卸载默认保留 State Root，删除 Program Files、Cache、Desktop/WebView、HKLM 注册和公共快捷方式。
