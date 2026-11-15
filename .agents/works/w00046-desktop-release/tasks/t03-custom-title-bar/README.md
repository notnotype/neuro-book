---
schema: nbook.task/v2
taskId: t03-custom-title-bar
status: active
updated: 2026-11-15
---

# 桌面端自定义标题栏与应用图标

## 目标与范围

桌面窗口不要 Windows 原生标题栏，参考 VS Code 自己画：窗口按钮放进工作台的标题栏，没有标题栏的页面（书架首页、宿主页、启动页）由宿主画一条后备的；拖动、双击最大化、贴边分屏交给系统。同一 Task 补上应用图标（安装包、程序、窗口），用高清图标。来源：开发者 2026-11-13 列的后续，2026-11-15 定“参考 VS Code 自己画”“图标不用 16、24 的像素版”（[Work README](../../README.md) 的“桌面端体验的决定”）。

合同：[`runtime/desktop-shell.md`](../../../../../docs/specs/runtime/desktop-shell.md) 输出 10、13 与新验收场景；[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md) 新输出“窗口外框”；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 输出 28。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15：
- pc-notype 上的探针（[frame-probe-r1.txt](evidences/frame-probe-r1.txt)）确认，沙箱页面里的 `app-region: drag` 走 WebView2 的原生非客户区（`HTCAPTION`）。
- 发现 Electrobun 的 `hiddenInset` 窗口最大化会压住任务栏，用 `bun:ffi` 补三位窗口样式可修。
- 应用图标按开发者的两次决定做完（分支 `be074783f`、`39276fe1e`）：每个尺寸都从同一份不带边框的 SVG 渲染，不再用像素专用版，品牌规范随之改写；[对比图](artifacts/icon-variants/index.html)。
- 设计审查第 1 轮：omp 14 条、Sonnet 17 条，处理见 [disposition](evidences/design-review-r1-disposition.txt)，计划改为 r2。不开第 2 轮。

## 下一步

按 plan r2 的切片 1（壳与约定）实施。
