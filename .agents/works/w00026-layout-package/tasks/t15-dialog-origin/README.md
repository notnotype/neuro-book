---
schema: nbook.task/v2
taskId: t15-dialog-origin
status: done
updated: 2026-11-06
---

# Dialog 与设置窗口从触发点展开

## 目标与范围

打开 Dialog、设置窗口时从触发点的方向展开，关闭时收回去；只改 nb-ui 与设置窗口的接入，和布局互不影响。来自开发者 2026-11-06 的手感反馈第 3 条。

合同：行为写在组件同名 `.md`（`Dialog.md`、`DialogSurface.md`、`FloatingWindow.md`），没有单独的 Spec。

## 当前状态

已合入 master。Dialog 与 FloatingWindow（设置窗口就是它）从触发点方向展开、朝同一方向收回：取最近 600ms 内的按下坐标，没有就取焦点所在的按钮、菜单项的中心，都没有就原地缩放淡入。开发者试过第一版（18%、最多 64px、缩放 0.9、关闭 93ms）说太小、关闭像瞬间没了，改成：起点中心离触发点只差 15%，起始缩放 0.3，入场 `--motion-layout`，退场 `--motion-enter`。一次按下只算一次打开。`AlertDialog` 不接入，仍原地弹出。

代码在 `packages/nb-ui/src/components/feedback/dialog-origin.ts`，编码由 Sonnet 按主会话的设计完成，diff 主会话审过（去掉了测试专用导出，改成按下用一次就清）。

验证：`nb-ui` 单元 565 条过；`settings` e2e 19 条过，其中一条放慢令牌读起点与终点矩形，证明起点比终点更靠近齿轮，减少动态效果时第一帧就是终点；`lab-nb-ui` 与 `settings` 合跑 32 条过。

未验证：动画观感要开发者试；键盘 Enter、空格触发这条路径只有单元测试。行为合同：组件同名 `.md`，没有单独的 Spec。

## 下一步

开发者试观感，有意见再调常量。
