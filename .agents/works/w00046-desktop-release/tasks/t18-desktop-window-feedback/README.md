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

2026-11-16：三片都实现、提交在分支 `fix/w00046-t18-desktop-window-feedback`（worktree `.worktree/w00046-t18-desktop-window-feedback`），没有合入。

- 计划经两轮设计审查定为 r3（第 1 轮 omp 13 条、Sonnet 13 条，[处理](evidences/design-review-r1-disposition.txt)；第 2 轮 omp 撞上额度上限、改派 Opus 9 条，[处理](evidences/design-review-r2-disposition.txt)）。最小尺寸从消息钩子改成子类化窗口过程，C 里不链接库、用相对路径编译，依据是 [探针](evidences/min-size-probe-r1.txt)。
- 切片 1 窗口按钮（5488ac50e）、切片 2 回到书架（284ece566）：单元、DOM 测试与 e2e（desktop-frame、welcome、workbench-titlebar，18 + 5 条）通过；本机带桌面能力标记的 Chrome 截图对照过亮色、悬停与高对比度。
- 切片 3 最小尺寸（607813710、1824618f9）：类型检查、`src/desktop` 109 条测试（含 C 纯函数在 Linux 上经 cc 的 5 条、初始外框 5 条）通过；完整 C 源在 Linux 上能编译。**Windows 实测没做成**：pc-notype 上 Windows Defender 今天 05:28 起把 Hutch 的 `hutch.exe` 判成 `Trojan:Win32/Bearfoos.A!ml`（机器学习规则）并删除，Hutch 构建跑不起来；改 Defender 设置要开发者决定。验收脚本已写好放在 pc-notype 的 `nb-w00046	18\`。
- 已知的旁支：高对比度模式下标题栏里 nb-ui 图标类画的图标（布局按钮等）会消失，是图标类的既有问题，不在本 Task。

## 下一步

开发者处理 Defender 对 hutch.exe 的拦截后，在 pc-notype 上构建测试版、跑 `t18\check.ts` 与 PrintWindow 截图；实现审查回来后处理；然后合入。
