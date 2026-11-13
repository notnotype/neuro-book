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

2026-11-13 开工。

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

## 下一步

1. 先查新应用在 Windows 上能否起来（实例认领的命名管道、项目子进程）：本机只有 Linux，靠 GitHub Actions 的 Windows runner 或开发者的机器。
2. 调研 Electrobun 在 Windows 上的现状（版本、安装包形态、自动更新、签名），做最小原型。
3. 写提案草稿，先给开发者看要点，确认后再交审查。
