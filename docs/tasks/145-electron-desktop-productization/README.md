# Task 145：Electron Desktop Productization

## 目标

将 Task 143/144 的 Electron Desktop Envelope 从可见验收 spike 收口为 Windows 内部 beta 产品。首发只支持本地 Product，提供当前用户安装、全局程序安装和 Portable；Manager CLI 继续拥有安装、校验、迁移、回滚、修复、卸载和 Product 生命周期，Manager GUI 只提供向导和状态投影。

关联生产 Issue：[Issue #87](https://github.com/notnotype/neuro-book/issues/87)（`Refs #66`）。

## 当前状态

**2026-08-12（晚间）：完成三个发行缺陷修复与 Windows Sandbox `--delete-data` 全自动验收，沙盒证据 `ok=true`（`evidence/t145-sandbox-acceptance.json`）。当前最终包基于 Product image `sha256:df2f4812...`（3250 files / 136,634,228 bytes，内容与 `e7b804f9` 文件级一致、仅 source 元数据不同）、Electron Portable ZIP `sha256:7ac0c915...`（390,489,189 bytes）与 Desktop Depot ZIP `sha256:cf7f2b2c...`（387,870,766 bytes），Manager bundle `sha256:3182ba99...`；A/B 两次组包逐字节一致。** 详见下方「2026-08-12 收口：发行缺陷修复与 Windows Sandbox 验收」。旧 checkpoint 只作为历史时间线保留，不代表当前包。

### 2026-08-13 审查修复：CI 覆盖、默认 MSVC 输入与最终包重验

对 Task 145 全链路做只读审查后补上的修复：

- **发布链路断点**：release-container.yml 的 product-windows job（windows-latest）
  与 product-runtime-baselines.yml 的 windows-x64 都会执行 Windows nuxt:build，
  而 MSVC 门禁此前要求显式 env，发布会 fail closed。修复：固定版本 MSVC Runtime
  DLL（VC++ 2015-2022 redist 14.51.36247.0，约 0.9 MB）入仓为
  scripts/build/inputs/msvc-runtime，productBuildEnvironment/copyMsvcRuntime
  默认使用该目录（NEURO_BOOK_MSVC_RUNTIME_DIR 仍可显式覆盖）——本地与 CI
  同一字节、零 workflow 改动。
- **CI 测试覆盖缺口**（win32-only 测试此前只在本地跑）：desktop-envelope-contract.yml
  的 Manager focused 步骤加入 windows-uninstall-host.test.ts，并新增
  windows-x64 专属步骤运行 product-runtime-bundle.test.ts（MSVC 复制分支）、
  product-build-environment.test.ts、install.test.ts（PowerShell 语法/离线
  Bootstrap 分支）；workflow paths 补充 scripts/build/**、scripts/install/**。
- **BOM 门禁缺测试**：assertPowerShellBom 从嵌套函数提升为模块导出并加
  import.meta.main 守卫（import 不再执行 CLI），
  desktop-distribution-packaging-contract.test.ts 新增「无 BOM 拒绝 / 带 BOM
  通过 / 非 ps1 跳过」用例（Desktop Contract 58/58）。
- **最终包重验**：基于新 image（df2f4812）重新组包 A/B（逐字节一致），宿主机
  仓库外 Portable 直启 headless exit 0（graceful shutdown，端口/进程收口）；
  Windows Sandbox 全新环境再次通过 --delete-data 验收（ok=true，11/11）。
  新旧 image 文件级完全一致（3252 文件路径/大小零差异），shape digest 相同，
  仅 runtime-image.json 的 source 元数据变化。
### 2026-08-12 收口：发行缺陷修复与 Windows Sandbox 验收

#### 沙盒自动化通道

Windows Sandbox（Store 版 0.8.107.0）在 System32 启动器路径下反复崩溃（6 次尝试：
窗口 8-11 分钟消失或 VM 约 2 分钟被销毁，WER 内核报告经核对为 7 月旧记录）。改用
Store 版自带的 `wsb.exe` CLI（`start`/`share`/`exec`/`ip`/`stop`/`connect`）后稳定；
`wsb exec --run-as System` 允许无人值守执行安装与卸载。沙盒内无交互用户会话，
UAC Host 委托路径无法运行，卸载删除由 Manager CLI 调度出的同一 Host 脚本在
System 上下文直接执行（产品删除逻辑与 Programs and Features 路径共用）。

#### 发现并修复的三个真实发行缺陷（宿主机无法暴露，仅干净 Windows 可复现）

1. **`windows-bun-stage0.ps1` 无 UTF-8 BOM**：Windows PowerShell 5.1 把无 BOM UTF-8
   按 ANSI 读取，中文注释破坏语法，安装引导脚本在干净系统上解析即失败。
   `scripts/install/windows-bun-stage0.ps1` 补 BOM；`desktop/packaging/package-portable.mjs`
   对发行 `.ps1` 增加 BOM fail-closed 门禁。
2. **全新 Windows 缺 VC++ Redistributable**：libsql/sharp/sqlite-vec/esbuild 的 MSVC
   prebuilt 在无 VC++ Runtime 的系统上 `LoadLibrary` 失败（安装 migration 崩溃）。
   修复：win32-x64 Product 镜像 app-local 携带 `vcruntime140.dll`/`vcruntime140_1.dll`/
   `msvcp140.dll`（复制到每个含 `.node` 的目录和 esbuild.exe 目录，共 9 files /
   2,616,720 bytes）；构建必须显式提供 `NEURO_BOOK_MSVC_RUNTIME_DIR`（固定版本输入），
   缺失 fail closed（`product-runtime-bundle.ts` + `build-product-runtime-image.ts`）。
3. **Windows Uninstall Host 删除超过 MAX_PATH（260）的路径失败**：Cache Root 的
   product-runtime 缓存树最长 302 字符（SYSTEM profile 前缀 + 深层 artifacts），
   Host 删除 cache 时 ENOENT。修复（`windows-uninstall-host.ts`）：
   - 所有删除/枚举路径加 `\\?\` 长路径前缀（`Add-LongPathPrefix`）；
   - Host 脚本保持纯 ASCII（PS 5.1 对无 BOM UTF-8 的非 ASCII 注释解析异常）；
   - Host 顺带清理安装时创建的 Programs and Features launcher root（读
     `desktop-installation.json` 的 `installationId`；CLI/外置 Host 路径此前无
     launcher 自删，会残留 `manager\uninstall\<id>`）。

新增回归：`windows-uninstall-host.test.ts` 深层路径删除测试（5/5 通过）；Manager
全量 41 files / 327 passed / 3 skipped；Manager typecheck 通过。

#### 重建与重新打包

- Product A/B（全新空输出根 ×2）：均 3250 files / 136,634,228 bytes，
  `imageId=sha256:df2f481299ec0968eb5e46739a30e0cf7c942f11406171e1d16651c8123a0741`，
  tree digest `sha256:164b646d...`，shape digest `sha256:c8d5b7aa...`（与上一代一致），
  Source digest `sha256:82f58733...`（clean tree `2892f648`，MSVC DLL 已入仓
  `scripts/build/inputs/msvc-runtime` 作为默认构建输入；文件级对比与 `e7b804f9`
  完全一致，仅 runtime-image.json 的 source 元数据不同）。
- 同一输入连续组包两次，5 个固定文件逐字节一致：Electron Portable ZIP
  390,489,189 bytes（`7ac0c9159ea6887b9e5a199c8996d80ac2083acd5252739a17677fb14a53118d`）、
  Desktop Depot ZIP 387,870,766 bytes（`cf7f2b2c156e744c395fa4418c339d906bc7f55817cbf792361ed4e0aa59eab3`）；
  Manager bundle `3182ba993454d43f0bf498a5e22aa07faf6063777371156eb51aeba4920964a5`。

#### Windows Sandbox `--delete-data` 验收（全自动，证据 `ok=true`）

全新 Windows Sandbox（无 VC++ Runtime、无用户会话）完成：machine 安装（约 65 秒，
含 migration）→ Provider 本地假 `/models` smoke（模型发现 sandbox-fake-a/b，API Key
不进输出/日志/argv）→ headless 启动（exit 0）→ `uninstall --yes --delete-data`
（Host 删除）→ 全部 11 项断言通过：Program Files、State/Cache/Desktop/WebView、
HKLM 卸载项、`neurobook://` 协议、开始菜单/公共桌面快捷方式、launcher root、进程树
全部消失，预创建的外部 Project Workspace 保留。证据：
`evidence/t145-sandbox-acceptance.json`（schema `nbook.task-145-sandbox-acceptance/v1`）。

口径说明：`manager\uninstall` 与开始菜单的空父目录属于 Manager 自身状态/已知可接受
残留（宿主机验收同口径，只断言内容消失）；System 上下文没有交互 UAC，真实 UAC
行为由宿主机验收覆盖（machine install/repair/uninstall 均真实批准）。

#### 验收矩阵（最终包）

- 宿主机（旧 image `c5f208`）：UAC 交互、Repair、单实例、托盘、CDP、启动统计、
  默认卸载保留 State Root——交互/生命周期路径未受本轮修复影响，保持有效。
- Windows Sandbox（新 image `e7b804f9`）：干净系统安装、Provider、headless 启动、
  delete-data 卸载——覆盖本轮修复后的真实删除路径。

- `Desktop Installation Manifest v3`：记录 `installationScope`、程序根、用户 Root、组件 receipts、Manager/Application Runtime 与 Git/rg provider，以及默认保留 State Root 的卸载策略；旧 v2 不静默兼容；
- 当前用户与全局安装目录选择，machine scope 写入 `Program Files` 前执行权限门禁；
- 本地 Desktop 默认写入 `auth.enabled: false`，只有显式 `--enable-auth` 才读取密码并创建管理员；
- `desktop configure-provider --stdin-json`，API Key 只经 stdin 写入现有 Global Config（`State Root/workspace/.nbook/config.json`）；
- 与主 Electron 共用 Chromium 的 Manager GUI 入口：`--manager-gui`、`manager-main.mjs`、`manager-preload.cjs` 和本地向导页面；
- Portable 将 Manager GUI 入口和 `NeuroBook-Manager.cmd` 放入同一 Electron 载荷，避免复制 Chromium；
- `ensureDirectory()` 兼容 Windows/Bun 对已存在只读目录返回 `EEXIST` 的行为，同时仍拒绝把文件当目录；
- machine-scope GUI 已接入一次性 UAC Broker：安装、修复和卸载均由提升后的同一 Manager CLI 执行，控制管道与密码管道分别进行 nonce/operation 身份握手；
- machine-scope GUI 已接入一次性 UAC Broker；当前最终包的非提升路径已按合同 fail-closed，旧 Depot 的真实提升 install/uninstall 证据单独标记为基线，不作为当前 Product image 证据；
- 修复了 machine canonical root 仍被 Installed v1 校验拒绝，以及 GUI uninstall 未传 `--json` 导致 UAC Broker 解析失败的两个回归。
- Follow-up 已将 Manager GUI `manager:run` 收窄为 typed operation，补充页面/frame/origin 导航门禁、固定 State Root 展示和 stdout/stderr drain；UAC 控制合同升级为 v2，repair/uninstall 绑定 installation root、installation ID、manifest 摘要和 deleteData；
- Follow-up 已让 Electron 从安装清单解析 application runtime 与 managed tool 私有 PATH，并在生产启动时不再自动消费 `NBOOK_DESKTOP_DEV_*` 环境覆盖；缺失 Installed locator 时 fail closed 到 Repair。
- Follow-up 又将 Manager GUI 的安装完成回执绑定到已验证的 Desktop Installation Manifest、安装范围和 Electron Envelope checksum；Portable 模板不再写入固定构建日期，安装时间由实际 Manager 安装事务生成。
- Follow-up 复核发现 Installed locator 存在但 `desktop-installation.json` 缺失或 scope 不一致时仍可能落回 Portable runtime；Electron 与 Tauri 现在都在启动前 fail closed，并先显示启动页。Manager GUI 增加显式的“同时删除 State Root”确认，本地 Provider 没有 API Key 时也能保存。
- 追加修复 `4a40b554`：Programs and Features 外置 launcher 现在解析并等待 Host 的最终 `resultPath/ok=true` 回执，成功后异步清理自身；Host 失败或超时保留 launcher 以便重试。本修复已有 Manager focused 回归，但尚未用新的最终 Depot 做真实 machine 重跑。
- 最终收口将聚合 Depot 变成可直接选择的正式来源：安装前验证邻接 sidecar、固定五项、ZIP bytes/SHA-256 和内置 distribution manifest；嵌套 Portable 只在本次事务中短期展开，成功或失败后回收，不再额外留下约一份 Electron Portable 的长期缓存。
- Windows 离线脚本可以从本地 Portable 精确提取并校验 managed Bun 与单文件 Manager bundle，再调用正式 Manager；PowerShell 不复制 Product payload 安装、migration、注册或回滚。
- Manifest v3 的 Product Bun、Git/Bash 和 rg provider 现在同步投影到 Product `installation.json`。Electron 始终使用 managed Manager Bun 启动 Supervisor，避免 system Bun 消失时连 Repair 都无法运行；system provider 只影响 Product/工具执行。
- 安装完成事件现在位于 Product Runtime 校验、Application State migration plan、一次 HTTP ready 和 graceful shutdown 之后。health/migration 失败会撤销 Windows 注册、程序根和本事务创建的用户 Root；原 PATH 快照也随事务恢复。
- user 与 machine 程序根因共享同一组 State/Cache/Desktop Root 而禁止并存；有效 State Root 的重装复用要求真实目录、可解析 Boot Config 及已登记所有权字段，symlink/junction、任意 YAML 和未知非空目录全部 fail closed。
- Manager GUI/CLI 的普通与 UAC 卸载路径都等待外置 Host 的最终 `ok=true`；结构化输出校验错误不再降级为普通日志。Manager 实例索引写入失败只产生明确 warning，不会把已经提交的有效安装误报为失败。

[ADR 0016](../../adr/0016-windows-desktop-uac-broker.md) 已 Accepted。

## 合同

- 当前用户安装：`%LOCALAPPDATA%/Programs/NeuroBook`。
- 全局安装：`%ProgramFiles%/NeuroBook`，需要可写 `Program Files` 的提升权限；State、Cache、Desktop/WebView 仍使用登录用户的根。
- user 与 machine 安装共享用户 Root，同一登录用户不能同时保留两个程序根；另一 scope 的安装或残留必须先 Repair/Uninstall。
- Portable：沿用 Installation Root 下的 `data/`、`.cache/` 和 `data/.desktop/`。
- 只注册 `neurobook://`、开始菜单、桌面快捷方式和卸载项；不注册 `.nbook` 文件扩展名。
- Desktop 默认关闭 auth；Provider 连接测试与远端连接、后台 updater、公开签名、macOS 实包和 Tauri 可见 UI 不在本 Task。
- Installed 的成功回执表示 payload、manifest/locator、Windows 注册、migration、HTTP ready 与 graceful shutdown 均已完成；首次正式启动不承担“把未验证安装变成可用安装”的职责。

## 实现记录

### Manager CLI / GUI

Manager CLI 增加 `desktop install --scope user|machine --enable-auth --json`，`--json` 输出单行阶段/完成事件供 GUI 消费。Manager GUI 通过同一 Electron Runtime 的 `--manager-gui` 入口运行，使用安全 preload 调用 CLI，未向 Renderer 暴露 shell、文件系统或 Manager secret。machine scope 由一次性 UAC Broker 只接受白名单动作：`desktop install`、`desktop repair` 和当前安装的 `uninstall`。

GUI 当前提供 Depot 选择、用户/全局安装选择、Provider 类型/Base URL/模型/API Key、离线测试警告、auth 选择、安装/修复/状态/卸载和退出；Provider 测试失败仍允许保存，API Key 在测试后清空。安装、校验、迁移、注册和卸载仍由 CLI 完成。

### 首次引导与 Provider

本地 Desktop 新安装先创建 `config.yaml` 的 `auth.enabled: false`，不自动创建管理员。显式启用 auth 时沿用现有 `createAdmin` 的 `--password-stdin` 传递；Provider 配置沿用仓库当前 Global Config 真值源，而不是把业务 Provider 写回 Boot Config。

### 载荷

Electron main/preload/manager entry/manager preload/启动页/Manager 页面都进入 `app.asar`；Product、Source、Bun、Tool Pack 和 native islands 保持在 ASAR 外。Portable 仍只构建一次 Electron Runtime，不复制第二份 Chromium。

## 验证

### 2026-08-12：checkpoint 339853fb 最终 A/B 与宿主机验收

本节是 checkpoint `339853fb` 的历史证据；当前最终包证据见上方「2026-08-12 收口」段落（新 image `e7b804f9` 与重新组包的 Depot `b6d35d99`）。下方更早的 checkpoint 小节只作历史时间线。

#### 最终 Product A/B

- 两次 clean build 均为 3,241 个文件、134,016,722 bytes；manifest 排除 `createdAt` 后完全一致，独立 `openSelfVerified()` 均通过。
- `imageId=sha256:c5f208754125491af2a0d7f61c53144df3dee79e489f55be373eed9f5c0f30dc`，tree digest `sha256:16815e871d54a260fcbab2054d03f78cd7111e0510b85f9b56cd6ffcded7574a`，shape digest `sha256:84efc1ecdbdada7bcf9db8e2f3895118cfc7efcd0f304c8de3f346ec525c495a`，Source digest `sha256:25245d6b75ec63291b9bcac3231c225f20450584c5bae534aaaeb32305bd566b`，lockfile digest `sha256:2fe27b0edf74c1738aa657fcbb9d797d6122daf356dbd17b8d6c6e8e50fea922`。
- 最终 image 已包含 `server/commands/product-start.mjs` 的 `NEURO_BOOK_PRODUCT_IMAGE_ROOT`/`NEURO_BOOK_APPLICATION_ROOT` 分离；从 `C:\Program Files` 直接加载 Bun Product 脚本不再触发 Windows `EPERM`。

#### 最终 Portable / Depot A/B

- 使用 Product A 同一输入（同一 verified image、同一 Manager/Electron dist、Bun 1.3.14、同一 Tool Pack）连续组包两次，固定 5 个文件全部逐字节一致：
  - Electron Portable ZIP：`neuro-book-electron-portable-win-x64.zip`，389,512,576 bytes，SHA-256 `2c67e58b2943ab4d797b23c917f453a505dca72275e93d616cc297049abffd79`；
  - Desktop Depot ZIP：`neuro-book-desktop-depot-win-x64.zip`，386,895,039 bytes，SHA-256 `ce116d6cc5d9f7ce322ffdbfb7b972172ee6f5330c86741815f69dfa0319a9fb`（比上一版多 3 字节：`windows-bun-stage0.ps1` 补 UTF-8 BOM，见下方 BOM 修复记录）；
  - distribution/sidecar manifest 一致；channel 为 canary。
- 固定输入摘要：Manager bundle `1D59588282802DFB4C9BD2E07EF0F20D5DF89480D8E8B49F136563855B18D2F7`、Electron main `71137D559D53D523186B0BDA207BFBD188A9C59F1EE16D18E32F8A74F4E232C4`、Manager main `CFCF4693DC1230B2B644A96B1ACDA9A94F00EE91AFEB0C99049EA7BBB346F80B`、Bun `0187F68D843F825A72ADA4A7ECA60DB896ED753759A7F8252EDCD31AC1BF1B9C`。
- Tauri 不重新组包生产 artifact（按计划只保留合同与历史证据）。

#### 仓库外 Portable 实包验证

- 展开到 `C:\Users\Public\Documents\NeuroBookAcceptance\t145-339853fb`（祖先无 `node_modules`），`openSelfVerified` 通过，revision/image/tree/shape 与上方一致。
- hostile `NODE_PATH` + 隔离 `LOCALAPPDATA` headless：graceful exit 0（约 13.5 s），forced exit 0（约 4.2 s），两种路径端口/进程均归零；Manager GUI headless exit 0。

#### 宿主机 machine 全链路（真实可见 UAC 批准）

旧 machine 安装（installation ID `727f8652-c25c-4396-9791-7f9c7efdcc09`，旧 Product image）已通过当前 Manager 正式卸载：

- Program Files、HKLM 卸载项、`neurobook://`（HKLM Classes）、公共桌面快捷方式、launcher/run root 全部删除；State Root `%LOCALAPPDATA%\NeuroBook\data` 保留，`config.yaml` SHA-256 `F104B5E7CA77E9F2A0630A6B152BB03620B6DA4DEECED8D6E97AD4D7D68CB975` 与卸载前一致。

随后用当前最终 Depot 完成 machine 安装（可见 UAC 批准）：

- 新 installation ID `e9ccfc62-b325-4e9d-9276-10106f148b67`；`nbook.desktop-installation/v3`、`nbook.desktop-installation-runtime/v1` locator、HKLM 卸载项、开始菜单/公共桌面快捷方式、`neurobook://` 注册全部生成；migration checked、HTTP health ready、Manager 实例已注册。
- 安装时有效 State Root 复用成功：`config.yaml` SHA-256 未变；Portable/Depot 组件 receipts 与当前构建一致（Product image `c5f208...`、app.asar `1360f1b2d7cff2ba415bda91fa77ab695ab51328321c3605522852b2d9772fb2`、envelope 43.2.0）。
- Installed headless：graceful exit 0（首启约 25.7 s，含完整验证/migration/health 探测；warm 约 4.7 s），forced exit 0（约 4.1 s），两种路径端口/进程均归零。
- 可见窗口 CDP：标题栏 `y=0, height=36`，页面根 `y=36`，旧 Header 计数 0，`backdrop-filter=none`，Bridge quit 后 graceful、exit 0。
- 单实例：第二实例带 `neurobook://open/project/demo` 立即退出，主实例记录 `electron-second-instance {argumentCount:1, protocolRequest:true}`，随后 Bridge quit 收口。
- locator 缺失 → Repair 页：移走 `runtime-locators.json` 后启动停在 `startup.html`，显示“缺少 runtime-locators.json，请通过 Manager Repair 修复”，含重试/打开 Manager 修复/打开日志/退出，未回退 Portable；`desktop repair`（machine，UAC 批准）重建 locator，SHA-256 与备份完全一致（`D52F628A...`），修复后 headless 启动成功。
- 最终 machine 卸载（Programs and Features launcher，UAC 批准）：exit 0，Program Files、HKLM 卸载项、协议、快捷方式、launcher/run root、manifest 全部删除，State Root 保留（`config.yaml` 摘要未变）；唯一残留是空的“开始菜单\Programs\NeuroBook”目录（卸载只删除 `.lnk` 不删除空目录）。

#### Provider smoke

- 本地 loopback 假 `/models` 服务：`test-provider` 返回 `ok=true, status=200, discoverySupported=true, models=[fake-model-a, fake-model-b]`；`configure-provider` 写入 `State Root/workspace/.nbook/config.json`（`providerId=fake-local`、`modelKey=fake-local/fake-model-a`）。
- API Key 只出现在 State Root `config.json`（合同位置），argv/env/日志/桌面目录零泄漏；测试副本 config.json 已还原。

#### 聚焦与构建门禁

- `bun run manager:test`：41 files passed / 1 skipped，326 tests passed / 3 skipped；Manager release contract 1/1。
- `bun run manager:typecheck`、根 `bun run typecheck`（含 Nuxt + Electron）、`bun run test:desktop-contract`（16 files / 57 tests）、Electron bundle、`desktop/packaging/security-audit.mjs` 全部通过；`git diff --check` 通过。

### 2026-08-12：CI 修复（53b4a79d）

PR #88 在 `339853fb` 上 push 后 CI 有 5 项必检 fail，已修复并推送 `53b4a79d`（`fix(t145): repair desktop CI platform gates and tsconfig transform`），只改测试与 CI 配置，不改任何发行产物源码：

- `desktop/shared/src/manager-runtime.test.ts`：补 `process.platform` mock（win32 + 还原），macOS/Linux runner 上 machine 投影测试走真实 Cache 投影路径，不再因守卫直接返回 source。
- `packages/neuro-book-manager/src/desktop-installation.test.ts`：5 个依赖 Windows 路径语义的测试加 `it.runIf(process.platform === "win32")`，与仓库既有惯例一致。
- `packages/neuro-book-manager/vitest.config.ts`：改用独立 esbuild transform（`oxc: false`），消除 CI 无 `.nuxt/tsconfig.json` 时 transform `server/config/boot-config.ts` 的 `TSCONFIG_ERROR`；与 `desktop-contract-vitest.config.ts` 先例一致。
- `.github/workflows/code-baseline.yml`：typecheck job 增加 `bun install --cwd desktop/electron --frozen-lockfile`，修复 CI 上 `Cannot find module 'electron'`。

修复后必检全部通过：windows-x64/macos-x64/macos-arm64 desktop contracts、linux-x64/aarch64/darwin-x64/aarch64 Product、Typecheck (advisory)、Community files and docs。`Full tests (advisory)` 仍为既有 Harness 黑盒 30 秒超时基线（见下方历史 checkpoint 记录，`e5ec1534` 时代已存在），PR diff 不包含相关测试文件，已另开 [Issue #90](https://github.com/notnotype/neuro-book/issues/90) 单独治理。截至 2026-08-12 连续 6 轮观察：失败率约 50%，失败用例固定为 cancel/abort 语义两个黑盒用例（30 秒超时），通过时其余 3450+ 测试全绿；日志固定伴随 workspace-history 记账 fail-open 降级与 Product graceful shutdown 强制收口，疑似与共享 fixture 的 libsql/生命周期状态相关；判定与桌面改动无关。该提交不改动 server、desktop/shared 业务代码和 Manager 业务源码，Product image `sha256:c5f208...`、Electron Portable/Depot 的 digest 与 final acceptance 证据保持有效。

Windows Sandbox `--delete-data` 破坏性验收工具已就绪（`evidence/sandbox-acceptance/`：宿主机准备脚本、`.wsb` 映射配置、Sandbox 内分阶段验收脚本与 README），宿主机输入目录已生成；该路径含 Sandbox 内 UAC 交互与删除数据操作，等待用户在场执行。实现核对确认：Programs and Features 外置 launcher 的 `broker-client` 硬编码 `deleteData=false`（该入口固定保留 State Root），`--delete-data` 删除路径由 Manager CLI `uninstall --yes --delete-data` 承担（machine 安装经外置 UAC Host 删除 Program Files 与托管用户数据）；Sandbox 验收脚本与 README 已按此修正。

### Follow-up 2026-08-12：Windows Sandbox 宿主侧无法稳定启动（门禁仍阻塞）

**后续（同日）：改走 Store 版 `wsb.exe` CLI 后通道稳定，验收已完成，见上方
「2026-08-12 收口」段落；本段保留为排障记录。**

2026-08-12 全天在宿主机对 Windows Sandbox 共进行 6 次启动尝试，全部未产出验收证据，
门禁仍停在「等待沙盒可用 + 用户在场批准 UAC」。记录如下（避免后续把短暂窗口误认为成功）：

- 9:23/10:23/10:49/13:19 四次：`Windows Sandbox` 窗口出现，但 8-11 分钟后窗口消失，
  且窗口存活期间 Win+R 键盘注入（写 `C:\NeuroBook\evidence\ping.txt`）均未生效，
  即 VM 桌面从未进入可交互状态；Hyper-V VmSwitch 日志显示 14:14 一次 VM 网卡创建后
  约 110 秒即被删除（会话被销毁，未完成启动）。
- 14:14/14:26/14:36 三次：连窗口都不出现（launcher 派生 `WindowsSandboxServer` 后直接退出，
  无 VM 创建）；14:36 一次是在杀掉残留 server 后全新启动，仍无窗口。
- 已排除的误判：WER 中 12:05 批量刷出的 `Kernel_124/15e/1e/3b` 报告对应的是 7 月 14-25 日
  宿主机旧崩溃（Minidump/WHEA 文件名日期可证），不是今天的沙盒崩溃；Kernel-Power 566
  （睡眠恢复）仅出现在 9:06/11:49/13:11，与 10:49/13:19 会话消失时刻不吻合，睡眠不是原因。
- 无管理员权限，无法重启 `vmcompute`、重注册 Store 组件或清理沙盒基础镜像；`winget` 未登记
  该 Store 包，无可用更新入口。最可能的修复是重启宿主机清掉 Hyper-V 异常状态，或由用户
  手动从开始菜单打开默认沙盒验证组件本身是否可用。
- 沙盒可用后的验收路径已全部就绪：`run-sandbox-acceptance.ps1`（校验 Depot SHA-256、
  预创建外部 Workspace、轮询安装/卸载产物、Provider 假 `/models` smoke、headless 启动、
  消失项断言），用户仅需在 Sandbox 内执行两条命令并各批准一次 UAC。宿主机侧还准备了
  `step1/step2` 包裹脚本与键盘驱动，供重试时使用；这些是宿主机临时文件，不入库。

在沙盒 `--delete-data` 全新环境卸载证据出现之前，Task 145 不标记为可发布内部 beta；
宿主机 machine 全链路（旧装卸载→Depot 安装→启动/修复→卸载，State Root 全程保留）已通过，
见 final-acceptance.json。

### 历史 checkpoint（重建前基线，不代表当前包）

### 聚焦和构建门禁

- 2026-08-10 最终收口当前代码门禁：`bun run manager:test` 为 41 files passed / 1 skipped、318 tests passed / 3 skipped，Manager release contract 1/1；`bun run manager:typecheck`、`bun run manager:build`、根 `bun run typecheck` 和 Electron bundle 通过。
- Desktop Contract 为 13 files / 49 tests；安装/migration/provider/UAC/Windows Host 聚焦批次为 5 files / 69 tests，Manager GUI typed operation 为 1 file / 11 tests；`bun run test:install` 为 13 passed / 9 skipped。
- `desktop/packaging/security-audit.mjs` 的 Electron/Manager sandbox、origin/frame、preload、CSP 和 Tauri headless 合同全部为 `true`；`git diff --check` 通过。
- 上述结果只证明 code gate。新的 clean Product A/B、Electron Portable A/B、Electron-only Depot A/B、仓库外安装和真实 machine/Sandbox 验收仍在 code-freeze 后执行，不能沿用下方历史构建数字。
- `bun run manager:test`：41 个测试文件通过、1 个跳过；299 个测试通过、3 个跳过；Manager release contract 1/1 通过。
- `bun run manager:typecheck`、`bun run typecheck`、`bun run test:desktop-contract`：通过；Desktop Contract 为 11 个文件 / 40 个测试，新增 canonical Installed Manifest 和 Electron 启动配置恢复回归。
- `bun run manager:build`、`bun run --cwd desktop/electron build`：通过；Electron 生成 `main.mjs`、`preload.cjs`、`manager-main.mjs`、`manager-preload.cjs`。
- `packages/neuro-book-manager/src/files.test.ts` 与 `desktop-installation.test.ts`：2 个文件 / 15 个测试通过；新增目录 `EEXIST` 回归覆盖。
- UAC Broker focused：共享协议 4 个测试通过；Manager Broker 3 个测试通过，覆盖 machine action 白名单、UTF-8 stdin 字节传递、secret pipe 握手和 CLI 输出回显 fail-closed。
- 基础 machine root focused：InstallationMutation、Windows Uninstall Host、UAC Broker 共 3 files / 15 tests 通过；Desktop Manager GUI Contract 1/1 通过。Follow-up 的安装/UAC focused 为 2 files / 18 tests。
- 代码提交 `e5ec1534` 的必需检查（Windows/Linux/macOS Desktop/Product、Typecheck、Community files/docs）全部通过。`Full tests (advisory)` 在该提交重跑后仍未通过：`494 passed / 3 skipped`，两个 Harness 黑盒用例 30 秒超时；首次运行则是同一领域的 `ENOTEMPTY` 清理竞态。该 advisory 基线不涉及 Electron 壳或本轮文档变更，因此不改变桌面必需门禁结论，但不能把当前 CI 写成“全部通过”。
- Follow-up 新增回归：machine-scope 外置卸载 launcher 按安装清单中的 `manager/neuro-book.mjs` 生成，不再硬编码不存在的 `.runtime/manager`；UAC repair/uninstall 缺少 `--root` 时 fail closed。两文件 / 18 个 Manager focused tests 通过。
- Follow-up 已完成生产目录和命名收口：`desktop/electron`、`desktop/tauri`、`desktop/shared`、`desktop/packaging` 使用正式路径；活动源代码改用 `NBOOK_DESKTOP_DEV_*` 和 `--desktop-*` 测试入口，Tauri release binary 为 `neuro-book-tauri-envelope.exe`。迁移后的 `desktop-security-audit`、`cargo fmt --check`、`cargo check --locked`、Electron bundle 均通过。
- Follow-up 后重新通过 `bun run manager:test`（41 个测试文件通过、1 个跳过；299 个测试通过、3 个跳过）、Manager typecheck、根 typecheck、Electron bundle、Tauri `cargo fmt --check`/`cargo check --locked` 和 Desktop Contract（11 个文件 / 40 个测试）；`git diff --check` 通过。全量 `bun run test` 为 494 个测试文件通过、1 个跳过、3 个失败；失败分别是 Git 文本扫描 5 秒超时、忽略 AbortSignal 的 Harness 黑盒用例 30 秒超时，以及全套并发清理的 `ENOTEMPTY`。其中 Git 扫描单独以 60 秒预算通过，Harness 黑盒用例单独仍可复现超时，第三项单独运行通过；这些是独立基线问题，不归因于 Electron 改动。

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
- 2026-08-09 追加复核：在旧 machine 安装仍存在时，先关闭 Electron，再由当前分支 Manager CLI 直接执行外置 Host 卸载；Host 回执 `ok=true`（token `e247f891-97f5-4d04-9ae4-5205543fb947`），Program Files、Cache、Desktop/WebView 和 HKLM 注册项均已删除，`%LOCALAPPDATA%\NeuroBook\data\config.yaml` 保留。该证据验证当前 Manager 的 machine uninstall/UAC Host，不把旧 Product image 误写成当前最终 Product。
- 随后用修复后的 Manager GUI（commit `7654e997`，提升 helper 不再使用 `-NonInteractive`）对旧 Depot payload `sha256:e35bbfe35f04ce5a7048eb01c516b3b866fe5fa3c12786d5e707d5baed10d8bf` 完成真实 machine install，生成 `nbook.desktop-installation/v3`、installation ID `56535935-a442-4948-8996-09611e18fc2c` 和 `C:\Program Files\NeuroBook`。安装版日志只写到 `electron-product-spawned`，没有出现 `product-ready`、`bridge-ready` 或 `window-ready`；因此该次不能声称安装后应用启动成功。随后外置 launcher 删除了 Program Files、Cache、Desktop/WebView、HKLM 和 `neurobook://` 注册，State Root 与 `config.yaml` 保留；复核发现这次旧 launcher 自身目录仍残留且未观察到新的 Host result 文件，已由 `4a40b554` 修复，尚未重新做真实 machine 回归。
- 当前最终 Depot 仍有一次 `uac-cancelled` 记录（Manager GUI CDP 事件为 `starting → process-exit(uac-cancelled) → failure(uac-cancelled)`），未创建 `C:\Program Files\NeuroBook`，也未触碰 State Root；所以最终 Product image 的 machine install/repair 成功路径仍需在干净用户环境重跑。

## 偏差与后续

计划文字把 Provider 配置称为 State Root `config.yaml`；当前仓库已冻结的运行合同是 `State Root/workspace/.nbook/config.json`，`config.yaml` 只负责 Boot Config。为避免破坏 B/S、Product 和 CLI 既有真值源，本 Task 保留现有 Global Config 路径，并在 ADR 0014 明确记录该偏差。

仍未在本 Task 声称完成：后台 updater、公开代码签名、macOS `.app`、远端 Desktop、文件扩展名关联、Tauri 可见 UI、Windows Snap Layout 展开面板、可见的 Windows 文件选择器操作、真实外部 Provider 成功连接和 Windows Sandbox `--delete-data` 全新环境卸载。宿主机 machine 全链路已在保留真实 State Root 的前提下通过；删除数据的破坏性路径保留给 Windows Sandbox 或显式用户授权，不拿真实用户数据做删除测试。上述未完成项分别属于后续发行或原生验收任务，不影响当前 Windows 本地内部 beta candidate 的可复核性。

### Follow-up 2026-08-09：原生托盘、窗口状态与文件选择器

- 新增 `scripts/deploy/electron-native-acceptance.ts` 与 `desktop:native-acceptance` 命令，使用真实 Electron `BrowserWindow` 记录窗口、托盘和文件选择入口；不把普通 Chromium smoke 当作原生证据。
- 在当前分支的 Electron main 上验证：托盘创建事件记录 `iconEmpty=false`；窗口从 `1280×840` 最大化到 `2576×1408` 后恢复原 bounds，`BrowserWindow` 报告 `maximizable=true`；窗口最大化/还原事件写入 `desktop-envelope-current.jsonl`。
- 封面选择入口存在，`input[type=file]` 接受 `image/png,image/jpeg,image/webp`；Playwright Electron 模式观察到 `filechooser` 事件。真正的 Windows 文件选择器可见操作和 Snap Layout 展开面板仍需 Windows UI automation / 用户手动确认。
- 本批证据使用 `.agent/tmp/t145-uac-candidate-extracted` 的旧 Product image `sha256:e35bbfe35f04ce5a7048eb01c516b3b866fe5fa3c12786d5e707d5baed10d8bf` 作为隔离载荷，不能替代最终 Product image 的重新组包证据。

### Follow-up 2026-08-08：本轮收口与仍未完成事项

- 本轮 focused 证据：Manager 41 files / 296 tests、Manager typecheck、根 typecheck、设置合同 2 files / 5 tests、Desktop Contract 11 files / 40 tests、Electron bundle、Tauri release build、Tauri locator fail-closed 代码门禁和 packaging security audit 通过。
- 已运行：checkpoint `8edef0f2` 后 clean Product A/B、同一 verified image 的 Electron/Tauri/Depot 重复组包、仓库外新 Portable headless、Manager GUI headless、主 Electron CDP（书架、标题栏、Activity Bar、配置中心 Dialog、File → Quit）、当前包 5×冷启动/5×暖启动、当前包用户级安装/启动/状态/卸载、system provider、machine 非提升 fail-closed。
- 尚未运行：Follow-up 后当前最终包的 machine UAC install/repair、Programs and Features 外置 launcher 的当前包实测、Windows Snap Layout 展开面板、可见的 Windows 文件选择器操作、真实 Provider 成功连接。
- 2026-08-09 已用当前分支 Manager 完成一次既有 machine 安装的外置 Host 卸载并取得 `ok=true`，并用修复后的 GUI helper 完成一次旧 Depot machine install 后再卸载；安装版启动停在 `product-spawned`，旧 launcher 目录残留问题已在 `4a40b554` 修复但未重跑，当前最终 Depot 的 machine install 仍因 UAC 取消而未取得提升成功回执。该结果分别证明当前 Manager uninstall/UAC Host 和旧 Depot install 事务可工作，不把旧 Product image 或取消路径写成当前最终包的 install 成功。
- 生产源目录已收口为 `desktop/electron`、`desktop/tauri`、`desktop/shared`、`desktop/packaging`；Task 143 历史文档仍保留旧 `desktop/spikes` 路径作为历史证据。`NBOOK_DESKTOP_DEV_*` 仅允许显式 headless/development 配置，生产启动会忽略这些覆盖；活动源代码与测试不再命中旧 `T140_*`/`*-spike-*` 名称。

### Follow-up 2026-08-08：checkpoint 8edef0f2 后的最终输入

- Product A/B 均为 3241 个文件、134016408 bytes；`imageId=sha256:387f637ec10f4334d73bb749879f3d47304dffbc73ce56de37a9d37f41d78e0d`，tree digest `sha256:03684226781cd709a8fad601ef0ae11dd887cfeb4595612a9ad5c3b4035f4b3d`，shape digest `sha256:8b269a9572585b19f21e8f8b434aabbc81d5f8aa9d584cd55fd1e6ece427d1a7`。
- Electron Portable payload 为 9608 个文件、985666335 bytes；连同 sidecar manifest 后输出目录为 9609 个文件。ZIP 389368123 bytes，SHA-256 `sha256:19ede9713a7ac6c85ef3f437434cc55687dee4dec40ffa2756c737acaa848ef8`。Tauri ZIP 243586814 bytes，Depot ZIP 627861992 bytes；同一输入连续组包两次，七个归档/manifest 逐字节一致。
- 新 Portable headless graceful smoke：10 次均 exit code 0；5×冷启动 Product ready 平均 4209.23 ms、wall 平均 4553.18 ms，5×暖启动 Product ready 平均 4262.34 ms、wall 平均 4504.56 ms。每次 shutdown 均为 `graceful`。
- 新 Portable CDP 的配置中心实际使用 `data-dialog-size="full"`，尺寸 1120×640；遮罩为 `rgba(0,0,0,.5)`，`backdrop-filter=none`，统一阴影生效；关闭后 Electron/Product 进程均收口。Manager GUI headless exit code 0。
- 当前 checkpoint 用户级安装默认卸载已保留 State Root；第二个隔离 sandbox 使用 `--delete-data` 卸载后 State/Cache/Desktop/Installation Root 均删除。当前包 machine 非提升安装返回 `exitCode=1` 的管理员权限错误，隔离 State Root 未触碰。
- Provider 矩阵补测：`system Bun + managed Git/rg` 安装成功且不修改全局 PATH；`system Bun + system Git/rg` 因本机 Bash shim 无版本输出而 fail-closed，未写半成品 Manifest。
- 该批次修复了 ready 回调在 Installation lease 释放前触发的竞态，以及配置中心和 Profile 导航残留的 90vh 尺寸耦合；修复均已进入 checkpoint，不改变安装、State Root、UAC 或 Product Runtime 合同。

### Follow-up 2026-08-09：machine runtime projection 后的最终重建

- 在 Source `30e9dfe32e37fc8ef0e31ab942e2019c2091cf36` 上重新完成 clean Product A/B。两次均为 3241 个文件、134016681 bytes，`imageId=sha256:25bbc74be7bfa9753d337ce15e789dbd56ae78fc3c0fb7a4912fa9c2a3449e65`，tree digest `sha256:911bf15a9d901e6c4f0e8148b6229d589ce71439e769cb7b0f5cd289a10744ca7`，shape digest `sha256:8b269a9572585b19f21e8f8b434aabbc81d5f8aa9d584cd55fd1e6ece427d1a7`；manifest 去除 `createdAt` 后完全一致。
- 新镜像已包含 `server/commands/product-start.mjs` 的 `NEURO_BOOK_PRODUCT_IMAGE_ROOT`/`NEURO_BOOK_APPLICATION_ROOT` 分离；该修复用于避免从 `C:\Program Files` 直接加载 Bun Product 脚本的 Windows `EPERM`。
- 使用新镜像、重建后的 Manager/Electron dist、Bun `1.3.14` 和同一 Tool Pack 连续组包两次，Electron ZIP 为 389371963 bytes、Tauri ZIP 为 243596394 bytes、Aggregate Depot ZIP 为 627874804 bytes；7 个归档/manifest 逐字节一致。新 Electron Portable 在仓库外且祖先无 `node_modules` 的目录中以无效 `NODE_PATH` 完成 headless Product ready、Manager GUI ready 和 graceful shutdown。
- 本轮 focused 门禁重新通过：Manager 41 files / 299 passed / 3 skipped、Manager typecheck、Desktop Contract 12 files / 44 passed、根 typecheck、Electron bundle 和 `git diff --check`。
- 当前机上仍有旧的 `C:\Program Files\NeuroBook` Portable/test 残留（`nbook.desktop-portable/v1`，不是 Installed v3 manifest）以及 HKLM 注册项；普通用户移动/删除被 Windows ACL 拒绝。调用正式外置 launcher 的提升请求在本自动化会话中被安全桌面自动取消，没有生成新的 Host receipt；State Root `AppData\Local\NeuroBook\data` 保持未修改。因而当前最终包的 machine install/repair/Programs and Features uninstall 仍未验证，必须由用户可见 UAC “是”确认后在干净 State Root 重跑。
