---
schema: nbook.task/v2
taskId: t18-desktop-window-feedback
status: active
updated: 2026-11-16
---

# 桌面窗口第一轮试用反馈：窗口按钮、回到书架、最小尺寸

## 目标与范围

窗口按钮与标题栏同一套图标与尺寸；标题栏作品下拉、文件菜单与标志都能回到书架；桌面窗口最小 800×560

开发者 2026-11-16 试用 t03、t04 测试版后提的四条里的前三条；第四条（改大小不流畅）的页面一层是 [t19](../t19-resize-relayout/README.md)。合同改动见 [plan.md](plan.md) 的“Spec 与文档改动”：desktop-shell 输出 10（最小尺寸）、browser-host 窗口外框、workbench-shell 输出 28、commands 项目目录、bookshelf 输出 19。

## 当前状态

2026-11-16 计划 r1 经设计审查第 1 轮（omp 13 条、Sonnet 13 条，[处理](evidences/design-review-r1-disposition.txt)）改为 r2：最小尺寸从消息钩子改成子类化窗口过程（[探针](evidences/min-size-probe-r1.txt)证明钩子改不动系统读的结构体）。pc-notype 上 PrintWindow 拍过测试版窗口：按钮几何正确，偏的感觉来自字形与样子。开发者当场定：按钮“不统一、太大太高、位置偏”三项都选；最小尺寸 800×560；回到书架放作品下拉、文件菜单、标志三处。

## 下一步

最小尺寸一片的 r2 请 omp 再审一轮；前端两片（窗口按钮、回到书架）先实施。
