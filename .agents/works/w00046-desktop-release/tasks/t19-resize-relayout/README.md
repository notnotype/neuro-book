---
schema: nbook.task/v2
taskId: t19-resize-relayout
status: done
updated: 2026-11-16
---

# 改窗口大小时页面的重排开销

## 目标与范围

改窗口大小时工作台每帧的强制样式重算从约 24 次降下来（分隔条吸附、过渡列表重量），改大小更跟手

开发者 2026-11-16 反馈“拖动改窗口大小不够流畅”。量过（本机 Chrome、开发服务、带桌面能力标记）：工作台每次改尺寸约 24 次样式重算、书架页约 4 次；主要来自 nb-layout 分隔条的吸附（`SashHandle.vue` 的 `snap` 边读位置边写样式）与一个 `TransitionGroup` 在每次更新时重新量所有子元素。WebView2 窗口式托管的闪白要 Electrobun 改合成托管（上游 blackboardsh/electrobun#484），不在这里做。行为合同不变。

## 当前状态

2026-11-16 完成并合入 master（`fe76f3880`），worktree 与分支已删：

- `e84e1c29a` 顺带修 master 上的失败：插件页的内置插件名表漏了 t04 加的 `nbook.desktop`（`builtin-names.test.ts` 失败）。
- `6a5d0ae69` 重排开销：改法与原因见 [plan.md](plan.md)。

证据（[evidences/resize-measure.txt](evidences/resize-measure.txt)）：每步样式重算 26.2 → 7.65 次；同一时刻交替量，样式时间约少四成，主线程任务时间少 25% 到 30%。

验证：nb-layout 与 neuro-book 类型检查通过；`bun run test:affected` 3165 过、2 败（`architecture.test.ts` 负载下超时，单独重跑通过；`builtin-names` 是上面那条，已修）；e2e 7 个文件 153 条，第一轮 4 条失败：3 条（`editor-area:1265`、`lab-nested-grid:92`、`lab-nested-grid:160`）单独重跑通过，是负载约 14 时的超时；`workbench-views:754` 在 master 上同样一过一败（活动栏入口的提示气泡盖住侧栏分节标题，右键点不到），t19 上连跑三次都过，是已有的不稳定用例，不是本 Task 引入的。

实现审查第 1 轮（Sonnet）0 阻塞、4 条可选，处理见 [evidences/impl-review-r1-disposition.txt](evidences/impl-review-r1-disposition.txt)，修正 `fe76f3880`。

## 下一步

无。开发者在桌面版上试拖动改大小，觉得仍不够跟手时，剩下的是 WebView2 的窗口式托管（上游 blackboardsh/electrobun#484）与各处 ResizeObserver 的串行回调。
