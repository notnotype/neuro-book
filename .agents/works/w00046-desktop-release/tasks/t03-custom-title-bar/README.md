---
schema: nbook.task/v2
taskId: t03-custom-title-bar
status: done
updated: 2026-11-15
---

# 桌面端自定义标题栏与应用图标

## 目标与范围

桌面窗口不要 Windows 原生标题栏，参考 VS Code 自己画：窗口按钮放进工作台的标题栏，没有标题栏的页面（书架首页、宿主页、启动页）由宿主画一条后备的；拖动、双击最大化、贴边分屏交给系统。同一 Task 补上应用图标（安装包、程序、窗口），用高清图标。来源：开发者 2026-11-13 列的后续，2026-11-15 定“参考 VS Code 自己画”“图标不用 16、24 的像素版”（[Work README](../../README.md) 的“桌面端体验的决定”）。

合同：[`runtime/desktop-shell.md`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 10、13 与新验收场景；[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 新输出“窗口外框”；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 输出 28。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15：
- Windows 开发机上的探针（[frame-probe-r1.txt](evidences/frame-probe-r1.txt)）确认，沙箱页面里的 `app-region: drag` 走 WebView2 的原生非客户区（`HTCAPTION`）。
- 发现 Electrobun 的 `hiddenInset` 窗口最大化会压住任务栏，用 `bun:ffi` 补三位窗口样式可修。
- 应用图标按开发者的两次决定做完（分支 `be074783f`、`39276fe1e`）：每个尺寸都从同一份不带边框的 SVG 渲染，不再用像素专用版，品牌规范随之改写；[对比图](artifacts/icon-variants/index.html)。
- 设计审查第 1 轮：omp 14 条、Sonnet 17 条，处理见 [disposition](evidences/design-review-r1-disposition.txt)，计划改为 r2。不开第 2 轮。

- 实施（分支 `feat/w00046-t03-title-bar`）：
  - 切片 1（`bd17317c3`）：壳、桥、能力标记、`win32.ts`、启动页的拖动条与按钮、旧 WebView2 的退路。
  - 切片 2（`4eef85139`）：页面宿主的窗口外框、工作台标题栏的拖动区域与留位、浮层 no-drag、关闭层的例外、层级登记。
  - `92f8de4d6`：桌面壳 README。
- 与计划 r2 的出入：
  - 窗口状态的去重只是一个 Map，按“单调用的包装不进代码库”写在适配层里，没有建 `src/desktop/window-state.ts`；
  - 启动页复用已有的 `shell-ready` 报到，壳收到就推一次状态，没有另发查询；
  - 按钮字形只用 Windows 的图标字体，没有 SVG 回退：外框只在 Windows 的桌面壳里出现；
  - 后备标题栏的属性改名 `data-desktop-fallback-bar`：与 `<html>` 上的 `data-desktop-frame-bar` 同名时选择器会选中两个元素；
  - e2e 的“搜索在窗口正中”在 1600 宽量：1280 宽时右栏（布局按钮、条目、138px 留位）已比一半宽，按 Spec 不再居中。
- 验证：
  - 单测、DOM 测试与类型检查通过；
  - e2e `desktop-frame.e2e.ts` 7 条，加受影响的 `bookshelf`、`browser-host`、`desktop-close`、`rpc` 共 36 条，全过；
  - Windows 验收 [windows-frame-r1.txt](evidences/windows-frame-r1.txt)：命中测试、样式、图标、最大化几何、三个按钮、并发开窗、书架后备标题栏、关最后一个窗口都通过；真实操作（拖动、双击、贴边、Alt+Space）未验证，等开发者。
- 实现审查第 1 轮：omp 6 条、Sonnet 14 条，处理见 [disposition](evidences/impl-review-r1-disposition.txt)，修正 `b40a4b902`；e2e `desktop-frame`、`desktop-close` 重跑 11 条通过。
- Spec：`runtime/desktop-shell.md`（输出 10、13、场景 15、实现合同、已知限制）、`runtime/browser-host.md`（输出 10 的例外、输出 11 改为三类、新输出 12“窗口外框”、场景 16）、`ui/workbench-shell.md` 输出 28。

- Windows 复验第 2 轮 [windows-frame-r2.txt](evidences/windows-frame-r2.txt)：修正之后各项照旧通过，另验关闭询问期间点最小化可用、取消询问后窗口还在。
- 变基到 master 后：类型检查、`src/shared`、`src/desktop` 的单测、两个 DOM 测试文件、nb-ui 层级测试、`governance:check`、`docs:check` 通过；master 带进来的改动与本分支没有交集，e2e 不重跑。2026-11-15 快进合入 master（`9223e131a`），worktree 与分支已删。

## 下一步

- 请开发者在 Windows 开发机上真实操作一次：拖动、双击、贴边、Alt+Space，以及点标题栏空白处时开着的菜单会不会关。启动方法：双击 `%USERPROFILE%\nb-w00046\t03\launch.cmd`（测试状态根，带调试端口）。结果记进证据。
- 待确认清单里 t03 的几行（图标的取舍、书架首屏的后备标题栏、模态时不能拖等）等开发者追认。
