---
schema: nbook.task/v2
taskId: t09-in-app-float
status: done
updated: 2026-11-05
---

# 应用内浮动

## 目标与范围

浮动窗放在网格的层叠上下文里（内容不换父元素），全局次序仍在下拉菜单之下（nb-ui 的 FloatingWindow 在对话框那一档，不能直接用，移动与缩放的几何可以复用）。浮动的单位是带标签的组，覆盖工具视图和编辑器标签；布局记录保存矩形与前后顺序。实现 t01 决定 6 的无落点就浮动，以及决定 8 的回到停靠。

合同：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md)。计划见 [`plan.md`](plan.md)。

## 当前状态

2026-11-07 已合入，实现审查已处理（`4ccb63654`）。

- 验证：`test:affected --since master --typecheck` 只有已知失败（`plugins/agent` 的跨插件导入、`permission-page` 的类型）；e2e：`workbench-float`（新，10 条）、`workbench-dnd`、`workbench-live-drag`、`editor-area`、`workbench-shell`、`workbench-views`、`lab-editor`、`lab-workbench-surface`、`lab-grid-panels`、`lab-grid-structure` 全过；`lab-scenes` 只有 ThemeEditor 假素材的 404，版面没有新问题（临时改 `expect.soft` 看过后面的检查）。
- 变异：`sameLayoutShape` 不比 `floats`、忽略 `noCenter`、`settleFloatMoves` 恒不改，对应单测都失败。`NestedGrid.dom.test` 的“只有窗的矩形变了不过渡”没有抓到第三个（happy-dom 里过渡令牌读不到），由 `grid-motion.test` 与 e2e 的“拖窗没有过渡”守住。
- 和计划不同的地方：手柄贴着窗的边往里，不骑在边上（骑在边上要越出窗，网格根裁切）；整窗抓住的是按下的那一点，不是过门槛处；`nbook.view.float` 多一个 `tab` 参数，给“移动到”和标签右键用，它们作用于被右击的标签，不先激活。
- 没做的：Lab 里 `NestedGrid` 没有浮动窗的场景，`FloatWindowHandles` 有；手感由开发者试。

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，15 条：重要 9、建议 6），计划照改：

| 条 | 判定 | 处理 |
|---|---|---|
| F1 改矩形被吞 | 成立（已复现） | `sameLayoutShape` 比 `floats`；矩形写入时取整，比相等 |
| F2 内存宿主 `newId` | 成立（已复现） | 同时查 `panels` |
| F3 最大化、收起 | 成立 | 浮动窗都不可；不进 `obscuredLeaves` |
| F4 整窗停靠绕过编辑器 | 成立 | `EditorTabDrag.dropPanel`，逐个走结算与合并 |
| F5 键盘 | 成立 | “浮动”按钮与 `nbook.view.float`、`nbook.view.dock` 照提案做；键盘区域加“浮动”；聚焦才露出的移动把手 |
| F6 null 混在一起 | 成立 | 不浮动的情形列成表，只有明确的无落点才浮动 |
| F7 命中落在哪层 | 成立 | `LayoutDropInput.floats` 先判、不穿透；`noCenter` 显式传 |
| F8 候选键、整窗与卡片 | 成立 | 动作键只写 `float`；整窗不走实时布局 |
| F9 每帧换文档 | 成立 | `floatPreview` 单独放；`motionless` 不要了，改由 `settleFloats` 认出只有矩形变 |
| F10 手柄、投影 | 部分成立 | 手柄是网格根的直接子元素；投影画在外框自身，自己的 `overflow: clip` 不裁自己的 `box-shadow`，所以不用放大外框 |
| F11 没有相邻 | 成立，做法简化 | `treeEditorAnchor`（树序最后一个）；不存“最近活动的树里编辑组”，进待确认 |
| F12 编辑组的头 | 成立 | `frameActions` 属性；不另画窗框，窗的头和原型一样 |
| F13 Spec 清单 | 成立 | 补全；命令名沿用提案 |
| F14 细节 | 成立 | 逐条写进计划（8 条） |
| F15 验收与模板 | 成立，模板部分接受取舍 | 补场景；模板里浮动的工具视图照留，进待确认 |

待确认里有“不用 `NB_Z_INDEX.workbenchFloat`”：内容层要和外框同一父元素，追加决策记录。

实现审查（一个 Sonnet，[`evidences/impl-review.txt`](evidences/impl-review.txt)，14 条：重要 1、建议 13）：

| 条 | 判定 | 处理 |
|---|---|---|
| 1 夹过的大小写回 | 成立 | 整窗拖动的大小取记录里的，手柄没动不提交，键盘移动只发位置；e2e 窗口变小后移动、单击手柄再变回来 |
| 2 手势中带过渡拖尾 | 成立 | `data-float-gesture` 上 `transition: none`；e2e 窗刚开就拖，变异去掉这条失败 |
| 3 放不进时窗弹回 | 成立 | 整窗判定拆成 `windowDrop`，算不出都是移动 |
| 4 命令不管结果报成功 | 成立 | `EditorTabDrag.drop`、`dropPanel` 返回结果，命令转成 `unavailable` |
| 5 窗的 id 撞分支 | 成立 | 校验拒绝；`removePanelNode` 对窗不摘树 |
| 6 拖窗每帧重算树 | 成立 | 树的摆放单独算，只有树变了才对齐分隔线 |
| 7 每帧重算面板头 | 成立，后半不改 | 窗的宽度读记录里的；`floatBounds` 每帧新对象：手柄本来就随矩形重渲，不值得缓存 |
| 8 工具窗停靠丢活动标签 | 成立 | 搬完激活原来的 |
| 9 打开窗里的视图 | 成立 | 提到最前，不退出最大化 |
| 10 失败原因 | 成立 | 加“不能收起”“太多了” |
| 11 菜单对独占的窗 | 成立 | 不列；占位 `run` 去掉 |
| 12 `dockGroup` 的 `reveal` | 成立 | 删 |
| 13 e2e 判别力 | 成立 | 点窗正文与头，不点手柄；去掉 `networkidle`；最小尺寸比精确值；负向断言等两帧；Esc 断言零写入 |
| 14 整窗状态散落 | 成立 | 判定收成 `windowDrop`，`dropAt` 只管标签 |

## 下一步

无。手感由开发者试。
