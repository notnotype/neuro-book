---
schema: nbook.task/v2
taskId: t65-float-dock-fade
status: done
updated: 2026-11-26
---

# 浮动窗拖回树里时投影与圆角随过渡淡去

## 目标与范围

拖动停靠（工作台）与贴边平铺（桌面示例）时，窗的投影、底色与圆角随过渡淡去，合 ui/nested-grid 输出 110；框架按钮回到停靠的路径不变

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 110（已实现的条目，拖动路径不合）；输出 172（松手的起点）。

## 当前状态

2026-11-26 开发者同意先修（t60 发现、记在 Work 的“后续”）。现象：拖动停靠（工作台）与贴边平铺（桌面示例）时，松手后第一帧投影与圆角就是 0，只有位置在过渡；框架按钮“回到停靠”那条路径的 e2e（`workbench-float.e2e.ts:482`）是过的。t60 第二段试过在起点那次渲染保留 `data-float`（条件 `releasedLeaves.has(id) && growing.has(item.key)`），浏览器里不起作用，已撤掉（`921b0f5ff`）。

## 结果

2026-11-26 完成，coder 子代理实施，主会话审 diff、变基后复跑并合入 master；同一个 coder 顺带做了 t60 批量审查的三条修正（第 1、3、5 条）。

- 根因（真实 Chromium 逐帧量）：拖动停靠走同步路径，`releaseStarts` 把外框起点放进 `growing`，用起点的那次渲染按设计不带 `data-moving`（没有 `transition-property`），而外框的 `data-float` 也在这同一次渲染里摘掉，投影、圆角、底色在没有过渡的那一刻直接成终值。框架按钮的停靠不经 `growing`，`data-float` 与 `data-moving` 同一次渲染里摘，本来就淡去。数值：按钮停靠第 0 帧圆角 9.992px、第 20 帧 6.78px、第 36 帧 0；拖动停靠修前每帧都是 0px，修后与按钮同一条曲线。
- 修法：`useGridMotion` 新增 `docking`（`grid-motion.ts` 的 `dockedLeaves`：这一轮从浮动回到树里的叶），与 `growing` 同生同灭（`start()` 设、`flushGrowingStart` 与 `stop()` 清）；`NestedGrid` 外框的 `data-float` 改成 `floatAt.has(id) || docking.has(key)`：用起点那次照旧画成窗，下一次带着过渡标记再摘。多出来的 `data-float` 在任何一次绘制之前就摘了；工作台读 `data-float` 的两处不受影响。
- 审查第 1 条（松手偏移按窗用掉，`consumedReleases`）、第 3 条（这一次改了矩形又不过渡的窗按窗跳过三层的过渡标记，`floatRectJumps`）、第 5 条（`resizeFloatRect` 方向为 0 的轴照搬起点）。
- 用例：`workbench-float.e2e.ts:391` 与 nb-layout `desktop.e2e.ts` 的拖动停靠、贴边平铺加逐帧圆角与投影的断言（第一帧大于 0、只减不增、最后为 0）；`NestedGrid.dom.test.ts` 新增松手起点两条、混合发布两条；`grid-rects.test.ts` 方向为 0 的轴；桌面示例矮视口横拖一条。变异 8 项都失败。
- 验证：coder 跑了 nb-layout 测试（bun 728、vitest 388）、typecheck、`api:check`，应用 typecheck；e2e 桌面示例 28/28，应用 `workbench-float`、`workbench-live-drag`、`lab-grid-panels` 63/63（负载 8.6 起跑、中途到 20）。主会话变基后复跑 nb-layout 测试、typecheck、`api:check` 与应用 typecheck，都过；CHANGELOG 的“修复”只留 0.3.0 里就有的两处（淡去、方向为 0 的轴），没发布过的回归不列。
- 没验证：审查第 3 条只有 happy-dom 对 `data-moving` 的断言，没有真实浏览器的混合发布用例（`data-moving` 是三层过渡唯一的 CSS 闸门）；提交 `087afce94` 单独检出时 nb-layout 的 typecheck 不过（测试辅助函数，下一个提交补上）。
