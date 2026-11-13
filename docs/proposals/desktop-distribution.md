---
schema: nbook.proposal/v1
status: draft
created: 2026-11-13
decided: null
supersedes: []
superseded-by: null
specs: []
adrs: []
---

# 桌面发行：Windows 安装包、便携包与打标签自动发布

本稿回应 [ADR 0033](../adr/0033-app-delivered-as-built-npm-package.md) 决定 6 留下的“发行按两个维度另写提案”。调研与实测在 [w00046 t01](../../.agents/works/w00046-desktop-release/tasks/t01-distribution-proposal/README.md)，下文的数字都出自那里的证据。

## 一、问题

现在装 NeuroBook 只有一条路：先装 Bun，再在终端里 `bun add -g @notnotype/neuro-book`，再运行 `nbook`，页面开在浏览器里。对不用命令行的写作者，这三步每一步都会把人挡住；Windows 用户尤其如此，旧应用的 Windows 一键启动在 v2 里已经删掉（ADR 0033 决定 7）。

发布也是手工的：开发者在本机 `npm login` 后跑 `release:publish`，没有 GitHub Release，CI 不参与发布。

## 二、目标与非目标

目标：

- Windows 用户下载一个安装程序，装好后从开始菜单或桌面打开 NeuroBook，在应用自己的窗口里写作；不需要装 Bun，不需要碰命令行。
- 同时提供便携包：解压即用，数据放在程序旁边，适合 U 盘或不想安装的人。
- 装好的桌面版能自动更新。
- 打 `v*` 标签后，CI 构建、冒烟并发布全部产物（npm 包、桌面包、GitHub Release），不需要人在本机操作。
- 应用里有外部工具（Git、Python 等）的安装向导，Agent 用到时再引导安装。

非目标：

- macOS 与 Linux 的桌面包：方案按三平台设计，第一版只做 Windows。
- 代码签名（开发者 2026-11-13 定不买 Windows 签名证书）。
- 服务器部署、后台常驻（`nbook service`）：ADR 0033 已把它们划给别的提案。

## 三、当前行为与证据

Windows 上的实测（pc-notype：Windows 11 x64；GitHub 的 windows-2025 runner）：

- **新应用在 Windows 上能跑。** `smoke:server` 十个场景过九个：项目子进程、命名管道的实例认领、SQLite、标准输入停止都正常。ADR 0033 担心的“命名管道认领在 Bun 上失败”在 Bun 1.4.4 上没有出现。没过的一个是 SIGTERM 停止：Windows 没有这个信号。
- **Agent 的命令工具在 Windows 上能用。** 它跑在 pi-natives 内嵌的 bash 兼容 shell 里，自带 ls、cat、sed、find、jq 等 40 多个命令，中文文件名正常，不需要 Git Bash。git、awk、python 走系统程序，要另装。
- **Electrobun 原型能完整走通。** 主进程用应用自带的 Bun 拉起服务端，窗口加载回环页面；书房页面显示正常；关窗时经标准输入有序停止，197 毫秒退出；卸载干净。窗口 80 毫秒出现，服务端 0.6 秒开始监听，页面 1.4 秒就绪。
- **体积。** 安装包约 86 MB，装好后 275 MB：Bun 110 MB，pi-natives 的 Windows 二进制 124 MB，服务端与页面约 23 MB，Electrobun 约 7 MB。pi-natives 不依赖 VC++ 运行库。作为对照，旧应用 2026-08 的同类实测里 Electron 便携 zip 约 230 到 390 MB，Tauri 约 84 到 244 MB。
- **内存。** 打开书房后整套工作集约 610 MB：WebView2 428 MB、服务端 123 MB、壳进程 62 MB。
- **外壳崩溃。** 强行结束壳进程后服务端 0.1 秒内一起退出，不留孤儿，但没走有序停止。

- **CI 能无人值守地构建与冒烟。** GitHub 的 windows-2025 runner 上：整个工作区装依赖 112 秒，Hutch 构建 82 秒；静默安装、直接起应用到页面就绪（4.7 秒）、关窗有序停止（206 毫秒）、卸载都能自动完成。
- **Setup 的一个怪现象。** 安装程序显示“安装完成”后既不打开应用也不退出（runner 与 pc-notype 经 SSH 运行时都这样）；用户双击时的表现还没亲手验证。

## 四、方案

### 4.1 两种发行，共用一套产物

| 发行 | 给谁 | 运行时 | 界面 |
|---|---|---|---|
| npm 包 `@notnotype/neuro-book`（已有） | 会用命令行的人、Agent、作者 | 用户自己的 Bun | 浏览器 |
| 桌面包（新增） | 写作者 | 随包的 Bun | 应用窗口 |

两者用同一份 `dist/server` 与 `dist/web`，版本号相同。桌面包另外带上当前平台的 pi-natives 二进制。

### 4.2 桌面壳用 Electrobun

开发者 2026-11-13 定用 Electrobun，候选 Electron。理由与实测：

- 主进程本身就是 Bun，与服务端同一个运行时，不用另带 Node 或 Rust；构建工具 Hutch 下载并打包 Bun，Bun 版本由 Electrobun 版本决定（2.0.6 对应 Bun 1.4.4）。
- 用系统的 WebView2，包比 Electron 小得多，实测安装包 86 MB。
- 自带安装程序、卸载程序、增量更新与 GitHub Actions 的构建示例。

代价：项目年轻（v2 刚发布），Hutch 有已知问题（见 4.8）；系统 WebView2 的版本随用户机器变化，页面兼容性要按 WebView2 测，不能按固定的 Chromium。

候选 Electron 只在遇到 Electrobun 解决不了的阻断时启用。

### 4.3 桌面壳做什么、不做什么

壳只负责窗口与服务端的寿命，产品逻辑全在服务端：

1. 启动：先显示启动页；用状态根认领查有没有正在运行的实例（可能是 `nbook` 起的，也可能是另一个桌面窗口）。有就直接打开它的地址；没有就用随包的 Bun 拉起 `server/main.js --stop-stdin`，读到监听地址后导航过去。
2. 关闭：关最后一个窗口时，往服务端标准输入写 `stop`，等它退出再退出应用；超过时限才强制结束。只关壳自己拉起的服务端，打开的是别人的实例时只关窗口。
3. 失败：服务端起不来或中途退出时，启动页显示原因与日志位置，提供重试。

Windows 上不能用信号停服务端，标准输入是唯一的有序停止渠道；`--stop-stdin` 在标准输入关闭时也会停，壳正常退出时不会留下服务端。

### 4.4 状态根与数据位置

| 内容 | 安装版 | 便携版 |
|---|---|---|
| NeuroBook 状态根（作品登记、设置、插件、日志） | ADR 0033 的缺省：`%LOCALAPPDATA%\NeuroBook`，与 `nbook` 共用 | 程序目录下的 `data\` |
| WebView2 的浏览器数据 | Electrobun 管的 `%LOCALAPPDATA%\<identifier>\stable` | 同左（Electrobun 不支持改，见待定项） |
| 作品本身 | 用户选的文件夹，缺省 `文档\NeuroBook` | 同左 |

状态根不放进 Electrobun 管的目录：卸载时选“应用和数据”会删掉那个目录，作品登记与设置不应该跟着一个卸载选项消失；放在 ADR 0033 的位置，桌面版和 `nbook` 看到的是同一个书架。

便携版用程序目录里的一个标记文件识别，状态根随程序走。

### 4.5 安装包与便携包

- **安装包**：Hutch 产出的 `Setup.zip`，里面的 setup 程序没有界面，静默装到 `%LOCALAPPDATA%`（按用户安装，不要管理员权限），建开始菜单与桌面快捷方式，装完直接打开应用。
- **便携包**：CI 把装好的应用目录加上便携标记打成 zip。便携版不自动更新（更新会改程序目录，便携场景里那可能是只读的 U 盘），启动时只提示有新版本。
- **未签名**：第一次运行 setup 会看到 SmartScreen 的“未知发布者”，下载页写明怎么点“仍要运行”。

### 4.6 自动更新

用 Electrobun 的 Updater，更新源是 GitHub Releases（`release.baseUrl` 指向最新 Release 的下载地址）。应用启动后在后台检查；有新版本时提示用户，用户确认后下载并在下次启动时换上。更新文件经 HTTPS 下载，`update-v2.json` 里有更新包的 SHA-256 与大小；没有签名，所以真实性只靠 HTTPS 与 GitHub 账号的安全。增量补丁按上一版的哈希命名，取不到就下载完整包。

### 4.7 外部工具向导

单独做一个 Task，配 Spec；开发者 2026-11-13 已确认的做法：

- 首次启动不强制；Agent 第一次调用找不到的 git 或 python 时，在对话里提示一次，从提示进向导；设置页有“外部工具”入口。
- 每个工具一条登记：怎么检测、两种来源怎么装、最低版本。
- 两种来源：随 NeuroBook 安装（下载便携版放进数据目录，NeuroBook 负责升级与卸载；Git 用 PortableGit，Python 用 uv 管理）；装到系统（调起 winget 或官方安装器，装完只检测）。
- 下载地址与 SHA-256 随发行版固定，可选国内镜像。

### 4.8 CI 与打标签自动发布

新增 `release.yml`，由 `v*` 标签触发，分四段，任何一段失败都不发布：

1. **核对**：标签版本与各包 `package.json` 的版本一致；标签所在提交在 master 上。
2. **构建与冒烟**（并行）：
   - ubuntu：`release:smoke` 打 npm 的两个包并跑现有闭环；
   - windows-2025：构建应用产物、组装桌面载荷、Hutch 构建，在 runner 上静默安装、启动到页面就绪、有序停止、卸载；再打便携包。
3. **发布 npm**：用 npm 的 trusted publishing（GitHub OIDC），仓库里不存长期 token；`release:publish` 已能跳过 registry 上已有的版本，失败后重跑可以接着发。
4. **发布 GitHub Release**：上传安装包、便携包、更新文件与 `SHA256SUMS`，正文从变更记录生成。

Hutch 与 Electrobun 的版本都固定（现在是 0.29.0 与 2.0.6），升级单独提交。Hutch 0.29.0 在设了 `HTTPS_PROXY` 时下载必失败，只能直连；runner 上没有代理不受影响，国内开发者本机构建要注意。

## 五、数据、接口、安全、迁移、发布与回滚影响

- 数据：桌面版与 `nbook` 共用状态根，格式不变。便携版的状态根在程序目录里。
- 接口：服务端入口与 `--stop-stdin` 合同不变；桌面壳只是又一个调用方。
- 安全：服务端仍只监听回环；窗口只加载本机服务端的页面。未签名的安装包与更新包的真实性只靠 HTTPS 与 GitHub。
- 发布：版本号收不回，所以所有冒烟都在发布前跑完。npm 发了但 Release 没建成时，重跑工作流只补缺的部分。
- 回滚：npm 用 `npm dist-tag` 把 latest 指回旧版本；桌面版在 Release 上把旧版本重新标为最新，已更新的用户要手动重装旧版本（Electrobun 的更新器会不会接受版本号更低的“最新版”还没查，查清前按要手动重装处理）。

## 六、对 Spec 的预期改动

- 新建 `runtime/desktop-shell`：启动、复用已有实例、关窗停止、失败显示、便携模式的状态根、更新检查与提示。验收用 Windows runner 上的安装、启动、停止、卸载场景。
- 新建 `runtime/external-tools`：工具登记、检测、两种来源的安装、向导入口与提示时机。
- 改 `runtime/cli`：已知限制里写明 Windows 上 `nbook start` 只能在同一个控制台里按 Ctrl-C 有序停止。
- 发布流程写进 `docs/standards/repository-workflow.md` 的发布一节：打标签即发布，替代手工 `release:publish`。

## 七、待定项

1. **双击安装这条路径还没验证**：脚本运行 setup 时，它显示“安装完成”后既不打开应用也不退出。等开发者在 pc-notype 上亲手双击一次，确认后再定稿。

以下几项开发者 2026-11-13 已按推荐定下，见决策记录：状态根位置、更新的打扰程度、第一版安装程序没有界面、便携版的浏览器数据。

## 八、决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-11-13 | 开发者 | 桌面壳直接用 Electrobun，候选 Electron；先做 Windows，提供 setup 安装程序与便携包；应用内做外部工具安装向导，两种安装路径（随 NeuroBook 安装、装到系统），首次启动不强制、用到时提示；打 `v*` 标签后全自动发布；不用 Windows 代码签名证书 |
| 2026-11-13 | 开发者 | 状态根沿用 ADR 0033 的 `%LOCALAPPDATA%\NeuroBook`，与 `nbook` 共用；更新为后台检查、提示用户、下次启动换上；第一版接受 Electrobun 无界面的安装程序，完整安装程序（为当前用户安装、选择安装位置、是否建快捷方式）作为后续任务；便携版在 `%LOCALAPPDATA%` 留下浏览器缓存，第一版接受并写明。后续任务另有自定义标题栏、桌面端专有设置（开机自启、系统托盘、通知） |
