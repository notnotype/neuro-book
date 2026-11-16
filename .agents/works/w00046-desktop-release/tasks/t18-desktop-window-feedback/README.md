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

2026-11-16 计划 r1 写好（[plan.md](plan.md)），等设计审查。开发者当场定：按钮“不统一、太大太高、位置偏”三项都选；最小尺寸 800×560；回到书架放作品下拉、文件菜单、标志三处。

## 下一步

设计审查（Sonnet 审前端两片，omp 审整份计划与最小尺寸的原生钩子），处理后按切片实施。
