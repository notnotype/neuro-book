---
schema: nbook.task/v2
taskId: t01-distribution-proposal
status: active
updated: 2026-11-13
---

# 发行提案与桌面壳实测选型

## 目标与范围

写出 ADR 0033 决定 6 要求的发行提案（`docs/proposals/`），供开发者拍板后再拆实现 Task：

- 运行时：桌面包捆绑 Bun；与现有 npm 包（用户自备 Bun）的关系、共用哪些产物。
- 桌面壳：按开发者决定直接用 Electrobun，在 Windows 上做最小原型验证——拉起捆绑的 Bun 服务端、窗口加载回环页面、退出时有序停止、与 `nbook` 的实例认领共存；记下安装包体积、内存、启动时间。原型遇到 Electrobun 解决不了的阻断才转候选 Electron，并写明阻断。
- 安装包与更新：Windows 的 setup 安装程序与便携包（解压即用）；自动更新的来源与校验。
- 签名：开发者定不买 Windows 代码签名证书；提案写清未签名的代价（SmartScreen 的“未知发布者”警告、自动更新包的完整性改靠发布的摘要校验）。
- CI 与发布：Windows 构建与冒烟；打 `v*` 标签后全自动发布（npm 包、桌面包、GitHub Release），发布前的门禁全部在 CI 里跑完、半途失败的处理，接现有 `release:smoke` 与 `release:publish`。
- 外部工具向导：见下面“开发者决定”第 3 条，提案里单列一节。

非目标：本 Task 不写产品代码，不改 CI；原型放本地或 `.local/`，结论与测量数值进 `evidences/`。macOS、Linux 桌面包放在 Windows 之后。

合同：本 Task 产出提案，不改 Spec；采纳后视情况新增 ADR 与发行相关 Spec。

## 开发者决定（2026-11-13）

1. 桌面壳直接用 Electrobun，候选 Electron。
2. 先做 Windows，提供 setup 安装程序与便携包。
3. 应用内要有第三方工具的安装向导（Git、Python 等），两种安装路径：随 NeuroBook 安装（NeuroBook 自己管理）；系统安装（装到用户或系统，NeuroBook 装完后只识别）。开发者 2026-11-13 确认 Agent 的细化：首次启动不强制走向导，Agent 第一次用到找不到的 git 或 python 时在对话里提示一次、从提示进向导，设置页留“外部工具”入口；每个工具一条登记（检测、两种来源的装法、最低版本）；随 NeuroBook 装的 Git 用 PortableGit（MinGit 不带 bash），Python 用 uv 管理；下载地址与 SHA-256 随发行版固定，可选国内镜像；系统安装调起 winget 或官方安装器，装完只检测、不升级不卸载；向导做成独立 Task 并配 Spec。
4. 打 `v*` 标签后全自动发布。
5. 不用 Windows 代码签名证书（2026-11-13 第二轮答复）。

## 当前状态

2026-11-13 完成：提案 [desktop-distribution](../../../../../docs/proposals/desktop-distribution.md) 经两轮设计审查后由开发者接受（`b78b8547f`），长期决定写成 [ADR 0051](../../../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md)。实现拆为 t06 到 t11。下面是实测与审查的记录。

查到的事实（读代码与已装的包，未在 Windows 上运行）：

- Agent 的 `shell` 工具不调用系统的 bash：它用 `@oh-my-pi/pi-natives` 的 `executeShell`（`packages/nb-harness/src/kit/tools/shell.ts`），在进程内跑 pi-natives 内嵌的 brush（Rust 写的 bash 兼容 shell）。所以 Windows 上没有 Git Bash，Agent 照样能跑命令。最早那版判断（“Windows 要靠 Git 自带的 bash”）不对，已更正。
- pi-natives 内置的命令（见它的 `THIRD-PARTY-NOTICES.txt`）：uutils coreutils（ls、cat、cp、mv、rm、mkdir、head、tail、sort、uniq、wc、tr、cut 等 40 多个）、findutils（find、xargs）、uutils sed、jaq（jq）；grep 与 glob 是工具层的原生实现。omp 的 `resolveWindowsShell` 注释写明：bash 工具的命令一律在内嵌 shell 里跑，宿主的 bash 可有可无，只给交互终端用。
- 内置的 `git` 只是一层防护（omp 的 `gitGuard`），真正执行仍然调用系统的 git：二进制里有 `spawn git`、`spawn git apply`、`spawn git worktree add`。所以 Git 仍要另装，但只是 Agent 要用 git 命令时才需要，不是 Agent 能不能跑命令的前提。awk、Python、curl 这些不在内置命令里。
- v2 产品代码自身不调用 git 或 python。
- 体积：pi-natives 是原生 N-API 模块，`@oh-my-pi/pi-natives-win32-x64` 18.20.0 解压后约 133 MB（npm registry 的 `dist.unpackedSize`）；Linux 包含 baseline 与 modern 两份，共 234 MB。它会是桌面包里最大的一块，比 Bun 本身还大。应用包里它是 dependencies（`scripts/pack-app.ts` 的 `SERVER_EXTERNALS`），没有打进 bundle。

Electrobun 调研（读 v2.0.6 源码仓库的文档，2026-11-13；源码克隆在本地 `.local/agent/works/w00046-desktop-release/tasks/t01-distribution-proposal/research/`）：

- 现状：MIT，GitHub 约 1.3 万星，最新稳定版 v2.0.6（2026-11-04），之后几天一个 beta。构建工具叫 Hutch，只为当前主机平台构建，多平台靠各平台的 CI runner。主进程缺省是 Bun 1.4.4，由 Hutch 下载并打进应用（pi-natives 要求 `bun >= 1.4.4`，正好对上）；应用的 JavaScript 跑在 worker 里，原生事件循环占主线程。Windows 用系统的 WebView2，也可以选择捆绑 CEF。
- Windows 产物：`win-x64-<App>-Setup.zip`（里面是 setup 程序与隐藏的安装数据）、更新用的 `.tar.zst`、`update.json`、可选的增量补丁。**没有现成的便携包**，要用 `postPackage` 钩子或 CI 另打一个。装到 `%LOCALAPPDATA%\<identifier>\<channel>`，按用户安装，不需要管理员权限。
- 更新：更新文件都是静态文件，文档点名 GitHub Releases 也能当来源。`update-v2.json` 里有 tar 的 SHA-256 与大小，文档写明这是完整性校验、不是签名。增量补丁按上一版的哈希命名，缺了就退回下载完整包。
- 签名：文档写明 Hutch 的打包流程目前不做 Windows 签名，与“不买证书”的决定一致。
- 卸载：自带的卸载程序提供“只删应用”和“应用和数据”两个选项，后者删 `Utils.paths.userData` 等目录。**要在提案里定状态根放哪**：ADR 0033 的缺省状态根是 `%LOCALAPPDATA%\NeuroBook`，与 npm 包的 `nbook` 共用；Electrobun 管的是 `%LOCALAPPDATA%\<identifier>\<channel>`。放在后者，卸载时选“应用和数据”会连作品登记与设置一起删掉，也和 `nbook` 不通。
- 官方文档给了 GitHub Actions 的矩阵示例：打标签触发，各平台构建都成功后才建 Release。

Windows 实测（pc-notype：Windows 11 26200 x64、32 GB；独立的 Bun 1.4.4 放在 `C:\Users\notnotype\nb-w00046\`，不动机器上 scoop 装的 Bun；代码是 master `0ac934e53` 打出的产物）：

- `smoke:server` 十个场景过九个（[evidences/windows-smoke-server-r1.txt](evidences/windows-smoke-server-r1.txt)）：health、标准输入停止、端口占用、Web 外壳、RPC 握手、项目子进程（S7）、SQLite 与 WAL 收回、设置文件、同一状态根第二个实例被命名管道认领拦下（S10）都正常。ADR 0033 担心的“命名管道认领在 Bun 上失败”在 Bun 1.4.4 上没有出现。没过的 S2 是 SIGTERM：Windows 没有这个信号，`kill("SIGTERM")` 直接结束进程。所以**桌面壳要用标准输入让服务端有序停止**（S1 的做法），不能发信号。`nbook start` 目前只认信号，Windows 上只有在同一个控制台里按 Ctrl-C 才能有序停止；提案里要处理这一点。
- Agent 的内嵌 shell（[evidences/windows-embedded-shell-r1.txt](evidences/windows-embedded-shell-r1.txt)）：echo 与变量、ls、cat 加管道 wc、sort、uniq、head、sed、find、jq、for 循环与 `$(...)`、重定向、mkdir、cp、mv、rm、退出码全部正常，中文文件名与中文内容正常，每条 60 到 100 毫秒；也能调起 Windows 程序（`where.exe`）。git、awk、python 失败，原因是这台机器 scoop 的目录联接在 SSH 会话里解析不了，证实它们走的是外部程序。

Electrobun 原型在 Windows 上的实测（[evidences/windows-electrobun-proto-r1.txt](evidences/windows-electrobun-proto-r1.txt)，主进程代码 [windows-electrobun-proto-main.ts.txt](evidences/windows-electrobun-proto-main.ts.txt)，截图 [windows-electrobun-proto-bookshelf.webp](evidences/windows-electrobun-proto-bookshelf.webp)）：

- 做法：Electrobun 主进程用 `process.execPath`（应用自带的 `bin\bun.exe`）拉起 `server/main.js --stop-stdin`，窗口先显示启动页，读到 `Listening on` 后导航到回环地址；关窗时往服务端的标准输入写 `stop`，等它退出后再退出应用。
- 结果：能构建（66 秒）、能安装、能启动、书房页面正常显示，关窗后服务端 197 毫秒以 0 退出，进程全部退出，卸载干净。服务端拉起项目子进程用的也是 `process.execPath`，不依赖 PATH 上的 Bun。
- 体积：Setup.zip 与更新包都约 86 MB；装好后 275 MB，其中 Bun 110 MB、pi-natives 约 133 MB。
- 速度与内存：窗口 80 毫秒出现，服务端 0.6 秒开始监听，页面 1.4 秒就绪；整套工作集约 610 MB，其中 WebView2 428 MB、服务端 123 MB。服务端的“私有内存”569 MB 是 Windows 的提交量，不是常驻：本机 Linux 上同一产物常驻 151 MB、私有脏页 91 MB，与 Windows 的工作集同一量级（从对照推断，JavaScriptCore 在 Windows 上预先提交大块堆）。
- 外壳崩溃：强行结束壳进程（`Stop-Process -Force`）后，服务端 0.1 秒内也退出，没有孤儿进程；但服务端日志在启动后再无记录，是被直接终止、没走有序停止（推断是 Windows 上子进程随父进程所在的作业对象一起结束）。服务端代码本身在标准输入关闭时会走有序停止（`nb-host/src/server/host.ts` 的 `stdin:closed`），这次没来得及。崩溃时的数据安全只能靠 SQLite 与原子写入。
- 旧应用的经验（[legacy t143](../../../../tasks/143-desktop-envelope-installation-spike/README.md)、[t145](../../../../tasks/145-electron-desktop-productization/README.md)，2026-08）：同一产品的 Windows 便携 zip，Electron 约 230 到 390 MB、Tauri 约 84 到 244 MB（随产品体积变化）；干净 Windows 上踩过三类坑——无 BOM 的 `.ps1` 被按 ANSI 读坏、没装 VC++ 运行库时原生模块加载失败、超过 260 字符的路径删不掉；当时用 Windows Sandbox 做干净环境验收。pi-natives 不依赖 VC++ 运行库：`pi_natives.win32-x64-baseline.node`（18.14.0，124 MB，Windows 包只有 baseline 一份）的 PE 导入表只有系统 DLL（kernel32、user32、bcrypt、ws2_32 等），没有 `vcruntime140.dll`、`msvcp140.dll`。
- 要另行处理的：Setup 没有界面、静默安装并自动建桌面快捷方式；经计划任务在桌面会话里运行 Setup 的两次没装上，原因未查，双击安装这条路径未验证。便携方式（复制 `app` 目录）能跑，但数据仍写在 `%LOCALAPPDATA%` 下与安装版共用，便携模式要 NeuroBook 自己把状态根放到程序旁边。Hutch 0.29.0 设了 `HTTPS_PROXY` 时下载必失败，只能直连，国内直连 GitHub 偶有中断。

GitHub Actions windows-2025 runner 上的探针（[evidences/windows-runner-probe-r1.txt](evidences/windows-runner-probe-r1.txt)；临时分支 `probe/w00046-windows`，两次运行）：整个工作区 `bun install` 112 秒；`smoke:server` 同样十过九（只有 SIGTERM 不过）；Hutch 构建 82 到 84 秒，产物与本地构建大小一致；静默安装成功（建快捷方式、在 HKCU 登记卸载项）；装完直接运行 `launcher.exe`，2 秒建好窗口、服务端开始监听，4.7 秒页面就绪，`WM_CLOSE` 后服务端 206 毫秒以 0 退出；卸载干净。**Setup 显示“安装完成”后既不打开应用也不退出**（runner 上等 120 秒未退出，pc-notype 经 SSH 运行时同样），开发者 2026-11-13 在 pc-notype 上双击验证：装完自动打开应用、setup 自己退出，只有在没有桌面的会话里运行时才停住。CI 里可以做“安装、启动到页面就绪、有序停止、卸载”的发布前冒烟，但要直接起 `launcher.exe`，不能等 Setup 自己打开。

## 下一步

无（本 Task 已完成）。临时分支 `probe/w00046-windows` 与 worktree `.worktree/w00046-probe` 已删（GitHub 上的两次运行与 7 天内的产物仍在）。

pc-notype 上本 Task 建的、留给 t07、t08 在 Windows 上实测继续用的：`%USERPROFILE%\nb-w00046\`（独立 Bun、Hutch、原型与脚本）、`%USERPROFILE%\nb-w00046-*.ps1`（三个早期脚本）、`%LOCALAPPDATA%\cottontail\cache`（Hutch 建的）、`%TEMP%` 里 Bun 的安装缓存。测试安装已用卸载程序清掉。
