# t02 调研第 1 轮：Electrobun 2.0.6 的安装、卸载与更新能留给安装程序多少余地

2026-11-18。读的是 Electrobun 2.0.6 的源码（`package/src/extractor/main.zig`、`windows_uninstall_prompt.c`、`sdks/main/core/Updater.ts`、`Utils.ts`），另查了上游 2.0.6 之后的提交与 issue。

## 现在的安装程序已经做到的

- 按用户安装，不要管理员权限：装到 `%LOCALAPPDATA%\<identifier>\<channel>\app`（正式版是 `%LOCALAPPDATA%\io.github.notnotype.neurobook\stable\app`）。
- 建桌面与开始菜单两个快捷方式（`WScript.Shell` 写 `.lnk`，指向 `app\bin\launcher.exe`），在 `HKCU` 的“卸载或更改程序”里登记（`DisplayName`、`InstallLocation` 等）。
- 有一个英文的进度窗口（标题“NeuroBook Setup”，“Installing NeuroBook”，完成后“Installation complete”），装完自动打开应用。
- 卸载是英文的任务对话框“Uninstall NeuroBook?”，三个按钮：App、App and Data、Cancel。“App and Data”删的是 `%LOCALAPPDATA%\<identifier>`（含 WebView2 数据），不碰 NeuroBook 的状态根 `%LOCALAPPDATA%\NeuroBook`（提案 4.4 的安排）。

## t02 要的三件事各卡在哪里

| 要的 | 2.0.6 的行为 | 结论 |
|---|---|---|
| 选择安装位置 | 安装（`getAppDataDir` 拼路径）、更新器（`Updater.ts` 按 `LOCALAPPDATA\<identifier>` 找通道根与 `self-extraction`）、卸载（`windowsManagedPathsFromBaseDir` 要求通道根的父目录正好是 `%LOCALAPPDATA%\<identifier>`，否则 `InvalidUninstallLocation`）三处都把位置写死 | 不改 Electrobun 做不到；绕开它的安装就要连更新器、卸载一起自己做 |
| 是否建桌面、开始菜单快捷方式 | 每次更新换上之后都重跑 `installWindowsIntegration`，无条件重建两个快捷方式 | 安装时不建，第一次更新又会出现；要保留用户的选择，得由我们的壳在每次更新后再删一次 |
| 中文界面、选项页 | 进度窗口与卸载对话框的文字写死在 C 源码里，没有可配置项；Setup 没有带参数的安装入口（Windows 上任何参数都进卸载管理器的命令解析），也没有静默安装 | 只能外面再包一层安装程序；里面那层的进度窗口可以用环境变量 `ELECTROBUN_INSTALLER_UI_AUTOCLOSE=1` 让它完成后自动关，但窗口本身仍会出现 |

另外：快捷方式没有设 AppUserModelID（t14 的 B 方案要它；上游 #514 是同一根因，运行中的窗口在任务栏另起一个按钮）。

## 上游

2.0.6 之后到 2.0.7-beta.24（2026-11-15），改到安装程序的提交只有失败上报与重试安全，没有安装选项。相关 issue（2026-11-18 查，都没有维护者回复）：

- #592（open）：要自选安装位置、正常的目录结构（例如 `D:\Apps\…`），不要悄悄装进 `%LOCALAPPDATA%`。
- #612（open，2026-11-13）：要能关掉首次运行的“<App> Setup”进度窗口；`ELECTROBUN_INSTALLER_UI_AUTOCLOSE` 只管完成后自动关。
- #600（open）：Setup 的无人值守安装（给 winget 用）。作者用 Inno Setup 把解开的应用另装一遍（Terrain Viewer 的 `desktop/installer.iss`：装到 `{userpf}`，放弃 Electrobun 的卸载登记、快捷方式与更新器）；还指出单写 `--quiet` 在 Electrobun 里是卸载。
- #514（open）：快捷方式没有 AppUserModelID，运行中的窗口在任务栏另起一个按钮（t14 的 B 方案也要它）。
- #296（closed）：用 NSIS 或 Inno Setup 做安装程序，按 #286（appx、pkg 等发布形态，open，没有进展）的重复关掉。

## 可选的做法

1. **不另做安装程序**：保留 Electrobun 的，安装位置固定、两个快捷方式都建，记为已知限制；同类应用（Discord、Slack、GitHub Desktop 用的 Squirrel）也是这样。可以顺手做的小事：下载页写明装在哪、卸载时选项的含义。成本最低。
2. **外面包一层 Inno Setup**：中文界面、许可页、勾选快捷方式；里面静默跑 Electrobun 的 Setup（进度窗口仍会闪一下）；不勾桌面快捷方式时，由壳在每次更新后把它删掉。安装位置仍然固定。要维护两层安装、发布流水线与冒烟都要改。
3. **完全自己装**：Inno Setup 把应用装到用户选的位置，放弃 Electrobun 的安装、卸载与更新器，t10 的自动更新要重做。成本最高，与 ADR 0051 选 Electrobun 的理由（自带安装、卸载与增量更新）相冲突。
4. **向上游提需求或 PR**：安装选项（位置、快捷方式、静默、AppUserModelID）。要开发者授权远端写入；落地时间不可控，可与 1 并行。

## 决定（2026-11-18，开发者，会话里）

继续用 Electrobun 的安装程序；“为当前用户安装”已经满足，安装位置固定、记为已知限制；快捷方式、开机自启、关窗去向、主题与语言放进首次启动向导，数据位置只显示。上游先不提 issue。
