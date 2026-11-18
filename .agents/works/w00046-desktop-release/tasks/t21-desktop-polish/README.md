---
schema: nbook.task/v2
taskId: t21-desktop-polish
status: done
updated: 2026-11-18
---

# 桌面端第二轮试用反馈：默认窗口、标题栏搜索与对齐、书架的窗口外框

## 目标与范围

开发者 2026-11-18 试用 t18 之后的五条反馈：

1. 清理 pc-notype 上的验证残留；
2. 桌面窗口的默认尺寸大一点；
3. 标题栏中间的搜索命令窄一点；
4. 标题栏的标志与项目切换同旁边的文字对齐；
5. 书架界面的标题栏是白底、不好看，要像 JetBrains 欢迎页那样（窗口按钮浮在页面上，不另画一条栏）。

合同改动（都是改数值或一处样式约定，不改机制）：[desktop-shell](../../../../docs/specs/runtime/desktop-shell.md) 输出 10（缺省大小）；[ui/workbench-shell](../../../../docs/specs/ui/workbench-shell.md) 输出 30（搜索最宽）；[runtime/browser-host](../../../../docs/specs/runtime/browser-host.md) 输出 12（书架首页自己占窗口顶端那一条）与场景 16；组件说明 `WorkbenchTitleBar.md`、`BookshelfPage.md`。没有写 plan.md：每条改动一两处，做法都在这里。

## 做法与依据

- **默认窗口**：1280×800 改为 1600×1000（逻辑像素，放不下仍取工作区九成）。数值是我定的，记进待确认清单。
- **搜索**：最宽 560px 改为 360px，判定让位时留的宽度 `SEARCH_COMFORT` 从 480 改为 320（让搜索不为撑满而让两侧过早收起）。
- **对齐**：先在 pc-notype 的 Edge 里渲染测量（把本机的构建经反向隧道交给 Edge 无头渲染，只截页面自己；没有截屏）。几何上各部件的中线本来就是同一条（17.5px），差别在文字基线：Windows 上字标底在 25px、菜单文字基线约 23px，字标低约 2px；项目名比菜单淡一档、也像没对齐。改了两处：字标的图形往上提 1px（只提图形，悬停面不动），项目名改成与菜单文字同色（图标与下拉箭头仍淡）。提完后字标底 24px。Latin 项目名的基线比 CJK 文字高约 0.5px，是字体本身的度量，没有处理。
- **书架**：书架页首个子元素是一条 `data-desktop-titlebar="plain"` 的透明行（高度取 `--nb-window-frame-height`，普通浏览器里为 0），宿主因此不再画后备标题栏、`#app` 从窗口顶端开始；窗口按钮浮在页面底纹上，左边那道分隔线（分隔标题栏右端的布局按钮）隐去，滚动时这一行 sticky 留在顶端。“页面不存在”与宿主页仍用后备标题栏。
- **清理**：见下。

## 当前状态

2026-11-18：2、3、4、5 实现并合入 master（260677e28，不 push），worktree 与分支已删。

pc-notype 清理（第 1 条）：
- 删了测试标识 t03test、t04test、t10test、proto、frame-probe、tauri-spike 的安装目录，以及 proto、t04test、t10test 的 Uninstall 注册表键与 `NeuroBook Proto` 的两个快捷方式；没有跑卸载程序（它会连同名快捷方式一起删）。
- 桌面与开始菜单里的 `NeuroBook.lnk` 之前被 t18 的测试安装改成指向 t18test，已改回指向开发者的正式安装（`io.github.notnotype.neurobook`，0.12.1）。
- 临时目录 `nb-w00046` 只留 `hutch`（构建缓存）、`bun` 与 `t18`（验收脚本和 t18test 的构建）；其余约 9.9 GB 已删。同时删掉了根目录的几个旧辅助脚本（`run-in-desktop.ps1` 等），本机 `/tmp` 里有副本，要用时重传。
- **没动**：t18test 的测试版 2026-11-18 08:38 起在跑（默认状态根 `%LOCALAPPDATA%\NeuroBook`，可能是开发者点了被我改过的快捷方式），所以它的安装目录、Uninstall 键、托盘图标设置项与 `t18` 目录都留着，等开发者关掉后再删。默认状态根的 `settings.json` 里有 `nbook.desktop/zoom: 1.25`，不确定是不是我测试写的（t04 验收时记录过把缩放改成 125%）；没改。

## 验证

- 类型检查通过；`test:affected`：vitest 731 条全过，bun 有 9 条失败（SDK 导出面 2、真实子进程宿主 6、内置插件清单 1），同样 9 条在 master 上也失败，与本次改动无关。
- e2e：desktop-frame、workbench-titlebar、welcome、bookshelf 四个文件全过（含新写的书架用例：没有后备标题栏、顶端 36px 透明行是拖动区域、窗口按钮左边的分隔线隐去、工作台里分隔线仍在）。书架用例第一次失败暴露了一处真问题：窗口拖动规则只写在工作台标题栏组件的样式里，书架页没有加载，桌面里书架顶端拖不动窗口；已把这组规则移到总是加载的 `src/web/styles.css`。
- Windows 渲染（pc-notype 的 Edge 无头渲染，只截页面自己）：标题栏基线对齐、搜索 360px 见上文；书架的新外观只在 Linux 的 Chrome 里截图看过，没有在真实桌面窗口里看（拖动、点窗口按钮、滚动时那一行的表现需要开发者在测试版里试）。
- 没有做正式的实现审查：改动是数值与一处样式约定，不改机制。

## 下一步

开发者关掉 t18test 后删它的安装、Uninstall 键、托盘图标设置项与 `t18` 目录；下一个桌面测试版里试书架顶端与标题栏。
