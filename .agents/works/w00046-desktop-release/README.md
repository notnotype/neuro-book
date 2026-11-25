---
schema: nbook.work/v1
workId: w00046-desktop-release
issueId: null
status: active
updated: 2026-11-15
---

# 桌面端打包、CI 与自动发布

## 目标

让用户不用先装 Bun、不用命令行就能装上并打开 NeuroBook：按 ADR 0033 决定 6 写发行提案，实测 Electrobun、Tauri、Electron 选定桌面壳，做出 Windows、macOS、Linux 的桌面安装包，并由 GitHub Actions 在打标签时构建、冒烟并自动发布（npm 包与桌面包同一版本号）。

## 背景

- [ADR 0033](../../../docs/adr/0033-app-delivered-as-built-npm-package.md) 定了第一种发行：npm 包 `@notnotype/neuro-book`（构建产物、带 `nbook` 命令、要用户先装 Bun）。决定 6 留下两个维度另写提案：运行时用用户的 Bun 还是随发行捆绑 Bun（目录包）；界面在浏览器、浏览器安装的独立窗口还是原生窗口（桌面壳，在 Electrobun、Tauri、Electron 里实测后选，都把 Bun 当独立进程、窗口加载回环页面）。决定 7：不恢复旧 Manager，Windows 一键启动由目录包或桌面壳承担。
- 现有发布链（[w00027 t15](../w00027-plugin-platform/tasks/t15-author-api-round2/README.md) 第三期）：`release:smoke` 打包并冒烟、`release:publish` 由开发者 `npm login` 后手动发 npm；不建 GitHub Release。CI（`.github/workflows/ci.yml`）只跑治理、文档、受影响的包和应用包能打出来，没有发布作业。
- 旧应用的交付链（Windows zip、Manager、`desktop/`）在 v2 分支已删，只作参照，见 [v2 重建提案](../../../docs/proposals/neuro-book-v2-rebuild.md)。
- 已知风险：新应用在 Windows、macOS 上整体未验证（ADR 0033 后果一节：命名管道的实例认领在 Bun 上有失败报告）；`bun build --compile` 的单文件起不来项目子进程。

## 范围

- 发行提案：两个维度的取舍、桌面壳选型、安装包形态、更新方式、签名与公证、版本号与发布顺序。
- 桌面壳与安装包：Electrobun（候选 Electron）；先做 Windows 的 setup 安装程序与便携包，macOS、Linux 在后。
- 外部工具（Git、Python 等）：第一版只检测加提示（2026-11-13 第一轮审查后定），两条安装路径以后再做。
- CI：构建与冒烟；打 `v*` 标签后全自动发布（npm 包、桌面包、GitHub Release）。
- 桌面端体验（开发者 2026-11-13 列的后续）：有界面的安装程序（为当前用户安装、安装位置、快捷方式）、自定义标题栏、桌面端专有设置（开机自启、系统托盘、通知）。
- 桌面端体验第二批（开发者 2026-11-15 列、指定用 autonomous-delivery 推进把握较高的）：拖拽导入文件与图片、拖拽安装插件、系统托盘、自定义标题栏、系统通知、应用图标、桌面端专属配置（例如界面缩放）、磨砂透明背景。

### 桌面端体验的决定（开发者 2026-11-15）

- **标题栏**：不要 Windows 原生标题栏，参考 VS Code 自己画：窗口按钮放进工作台的标题栏，桌面窗口只剩一条标题栏（t03）。
- **关最后一个窗口**：默认照旧退出（停服务端），设置里可改为留在托盘（t13）。
- **从系统拖入**：第一版的落点是文件树、Markdown 编辑器插图、书架导入新作品三处；支持文件夹，保留层级（t15）。
- **Web 与桌面要不要统一 facade**：按能力分，不建统一的一层（主会话的建议，开发者没有异议）。两端都是同一个网页、同一套 Web 标准时只写一份（拖放用 HTML5 拖放，两端都拿不到本机路径，只能读内容上传）；两端确实不同的（系统通知若 WebView2 的网页通知不可用）才在页面宿主层 `src/web/host/` 加一个窄接口，按“有没有这项能力”分支；只有桌面有的（窗口按钮、托盘、缩放、开机自启）没有 Web 对应物，壳不在时不出现。
- **推进顺序**：t03 标题栏与应用图标 → t04 桌面专属设置（机制、界面缩放、开机自启）→ t13 托盘与关窗去向 → t14 系统通知 → t15 拖拽导入 → t16 拖拽安装插件 → t17 磨砂背景（实验，最后做，只在 Windows 11 22H2 以上）。原来的 t04 拆成 t04、t13、t14（2026-11-15，见待确认清单）。开发者 2026-11-16 试用后的反馈插在 t13 之前：t18（窗口按钮、回到书架、最小尺寸）→ t19（改大小时页面的重排）。
- **长时间的后台工作**（2026-11-17，开发者）：之后要在后台长时间进行的事（上传、下载等）都做成后台任务（`nbook.tasks`，[`workbench.background-tasks`](../../../docs/specs/workbench/background-tasks.md)）。现有能力只让服务端入口登记任务、不承诺浏览器入口登记；上传的字节在页面里，页面关掉上传就断，所以 t16 的上传先用页面里的进度，服务端收到之后的预览与安装是一瞬间的事；要让上传能脱离页面，需要另建 Task 扩展“浏览器入口登记任务”和可续传。
- **应用图标**（2026-11-15，开发者两次）：不用 16、24 的像素专用版；每个尺寸都从同一份 SVG 渲染，桌面与 favicon 用不带边框的那一份，品牌规范随之改写（t03）。

代码分支：`feat/w00046-desktop-release`，worktree `.worktree/w00046-desktop-release`（2026-11-13 从 master 开出）。

非目标：服务器部署（Docker、远端访问，以鉴权为前提另写提案）；后台运行与系统服务（`nbook service`）。

## 授权

- 开发者 2026-11-13 定打 `v*` 标签后全自动发布。流水线本身上线前由开发者确认；push、打标签、配置仓库 Secrets 等远端写入仍要开发者逐次授权。
- 签名证书与 Apple 开发者账号由开发者提供，Agent 不经手密钥原文。

## Task

开发者 2026-11-13 指定 t06 到 t11 用 autonomous-delivery 推进，2026-11-15 指定桌面端体验第二批（t03、t04、t13 起）同样推进；本该开发者决定的点记在 [待确认清单](pending-confirmations.md)。

| Task | 内容 |
|---|---|
| [t01](tasks/t01-distribution-proposal/README.md) | 发行提案与桌面壳实测选型。已完成：提案 [desktop-distribution](../../../docs/proposals/desktop-distribution.md) 已接受，[ADR 0051](../../../docs/adr/0051-desktop-shell-electrobun-tag-release.md) |
| [t02](tasks/t02-installer/README.md) | 安装程序：调研后定为继续用 Electrobun 的安装程序，加首次启动向导（外观、桌面快捷方式、开机自启、关窗去向、数据位置）。完成，合入 master（e0012fa24）；Windows 验收第 1 轮通过 |
| [t03](tasks/t03-custom-title-bar/README.md) | 桌面端自定义标题栏与应用图标。已完成，合入 master；拖动、双击、贴边等真实操作待开发者试 |
| [t04](tasks/t04-desktop-settings/README.md) | 桌面端专属设置：机制（只在桌面显示的设置分区、页面把值交给壳）、界面缩放、开机自启。已完成，合入 master；真实键盘下的缩放快捷键待开发者试 |
| [t05](tasks/t05-external-tools-wizard/README.md) | 外部工具：第一版只检测加提示。未开工 |
| [t06](tasks/t06-desktop-specs/README.md) | 桌面发行的 Spec（desktop-shell、desktop-update 新建，server-host、browser-host、editor、cli、notifications 等修改）。已完成，omp 三轮设计审查 |
| [t07](tasks/t07-managed-entry-payload/README.md) | 应用包托管入口与桌面载荷组装。已完成 |
| [t08](tasks/t08-desktop-shell/README.md) | Electrobun 桌面壳。已完成，合入 master；desktop-shell 已晋升 implemented |
| [t09](tasks/t09-close-handshake/README.md) | 关闭前询问（页面与壳）。已完成，合入 master |
| [t10](tasks/t10-auto-update/README.md) | 桌面版自动更新。已完成，合入 master；desktop-update 已晋升 implemented |
| [t11](tasks/t11-release-pipeline/README.md) | 打标签自动发布流水线。已完成：第一次正式发布 v0.13.0（2026-11-15）走完，registry 冒烟改为先等版本可见 |
| [t18](tasks/t18-desktop-window-feedback/README.md) | 开发者试用 t03、t04 后的反馈：窗口按钮与标题栏统一、回到书架的入口、窗口最小 800×560。实现、两路审查与 Windows 验收完成并合入 master |
| [t19](tasks/t19-resize-relayout/README.md) | 改窗口大小时页面的重排开销（分隔条吸附、过渡列表）。完成（每步样式重算 26 → 7.65，样式时间约少四成），已合入 |
| [t13](tasks/t13-tray/README.md) | 托盘与关窗去向。切片 1 到 5 合入 master（82d15e3cc），实现审查已处理；Windows 验收两轮完成（主流程、退出对话框、后台 30 分钟）；自启、缩放图标、资源管理器重启未做，Spec 输出 28 到 31 已晋升 implemented（2026-11-18 开发者批准） |
| [t14](tasks/t14-system-notifications/README.md) | 系统通知（先实测 WebView2 的网页通知）。调研完，等 Windows 探针 |
| [t15](tasks/t15-drag-import/README.md) | 从系统拖入文件、图片与文件夹（文件树、编辑器插图、书架导入）。未开工 |
| [t16](tasks/t16-plugin-drag-install/README.md) | 拖拽安装插件。实现与两路审查完成并合入 master；切片 6（Windows 拖放手测）等 Windows 开发机 |
| [t20](tasks/t20-background-tasks-from-browser/README.md) | 浏览器入口登记后台任务与可续传上传（t15 批量拖入的前置，2026-11-17 开发者同意分两步）。未开工 |
| [t17](tasks/t17-window-backdrop/README.md) | 磨砂透明的窗口背景（实验）。已合入 master（f92d24efd），设置缺省关 |
| [t21](tasks/t21-desktop-polish/README.md) | 开发者 2026-11-18 的第二轮反馈：清理 Windows 开发机 残留、默认窗口 1600×1000、搜索收窄、标志与项目名对齐、书架顶端像 JetBrains 欢迎页。已完成，合入 master；真实桌面里试书架顶端待开发者 |
| [t22](tasks/t22-desktop-user-select/README.md) | 桌面壳里界面框架默认不可选中文字，内容区显式可选（2026-11-18 开发者提出）。完成，合入 master（4d07ba077） |
| [t23](tasks/t23-macos-desktop/README.md) | macOS 桌面版（Apple Silicon，未签名）：GitHub Actions 构建并补传到 Release（2026-11-18 开发者提出，尽力而为）。v0.14.1 的 Release 上已有 DMG，等真机反馈 |
| [t24](tasks/t24-release-one-command/README.md) | 发版跑通：CI 全绿、一条命令发版（`bun run release`）、macOS 并入 Release 流水线、Release 说明由谁写的调研（2026-11-20 开发者提出）。完成，v0.15.0 经流水线发出（npm 与 Release） |
| [t25](tasks/t25-release-0-16-0-17/README.md) | 发 v0.16.0、v0.17.0（2026-11-23、24 经流水线发出）；推送 CI 40 次里 25 次失败的逐次归类，失同步竞态已修，S10 与 shell 输出 21 待现场数据；发版命令加目录干净预检与 macOS 自动重跑 |
| [t26](tasks/t26-resume-last-project/README.md) | 打开 NeuroBook 时回到上次的作品（启动类入口、只回最近一个、设置“启动时打开”缺省上次的作品）。完成，合入 master，Windows 安装版冒烟验证 |
| [t12](tasks/t12-release-stages-and-changelog/README.md) | 发布阶段（canary → preview → stable）、CHANGELOG 与由它生成的中文 Release 说明、发版脚本 `release:prepare`、发布手册、安装包改名。已完成，合入 master；推送后演练待开发者授权 |
