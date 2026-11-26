---
schema: nbook.task/v2
taskId: t60-float-geometry
status: done
updated: 2026-11-26
---

# 浮动窗的几何接口（摩擦第 3 组）

## 目标与范围

夹取认区域原点、缩放上限是边界、能取到叶此刻的矩形、整窗移动与松手时序有现成做法；桌面示例的自补几何随之删掉

合同：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 101、103、105 的 planned 句子与新增的 172 到 177；t50 摩擦第 3 组 15 条，逐条处理见计划末尾。计划见 [plan.md](plan.md)，探针与使用方清单在 [evidences/](evidences/)。

## 结果

2026-11-26 完成，分两段由 coder 子代理实施（片 0 到 2、片 3 到 5），主会话每段审 diff、自己复跑，变基后整段验收并合入 master，Spec 收口（输出 101、103、105 的新句子、172 到 177 去掉 planned、证据一句）：

- 夹取与缩放（输出 175、176）：`clampFloatRect(rect, area, keep?)` 的 `area` 可带原点、`keep` 可省且不超过窗缩后的尺寸（比区域大的窗不再被推出区域）；`resizeFloatRect` 的 `bounds.area` 是边界、`max` 可省；`FloatWindowHandles` 加 `area`，`commit` 多 `direction`（输出 177，松手先 `preview(null)` 再 `commit` 写进说明）。
- `NestedGrid`：手柄层按稳定次序渲染，抬升只改层级（输出 103；探针证实工作台三扇窗时聚焦最底下那扇的移动把手焦点会丢到 body，修后守住）；`float-raise` 事件（输出 173，捕获阶段判，按下或焦点进入）；expose `leafRect(id)`（输出 174，读树的摆放，读含浮动窗的那份会无限递归，变异证实）。
- 松手的起点（输出 172）：`placeFloat(id, null)` 之后、下一帧之前发布的变化从松手处出发（`releaseStarts` 并进起点表）；探针证实修前工作台停靠先跳回按下处三帧，修后首帧在松手处。`GridFloatInput.animate`（输出 105）：标了的窗矩形变化走布局过渡。
- 桌面示例删掉自补的几何（`deskClamp`、`intersectRect`、`withinDesk`、`raiseOnPress`、`tileOnNextFrame`、`dpr`）：`App.vue` 430 → 404，`model.ts` 491 → 474，示例单测 463 → 454，README 删 5 条限制（含“拖分隔线时浮动窗不让位”，浏览器核过让位、手势不取消、松手不跳）。工作台：`WorkbenchSurface` 改接 `float-raise`，`wholeInTree` 用缺省整窗；两条新 e2e（停靠首帧、三扇窗聚焦把手）。SDK 快照只加不改。
- 变异：第一段 5 项、第二段 9 项，都失败，只有“`float-raise` 只听冒泡”e2e 杀不掉（手柄自己 focus 照样请求抬升），由 `NestedGrid.dom.test.ts` 按次数守着。
- 主会话的处理：第二段在起点那次渲染保留 `data-float`、想让投影与圆角淡去，浏览器里不起作用，撤掉（`refactor` 一条）；拖回树里时投影与圆角不淡去记进 Work 的已知问题（从探针推断分支之前就有，不合输出 110）。
- 验收（主会话，变基后）：nb-layout 测试、typecheck、`api:check`、`build:package`，nb-workbench-layout 测试，应用 typecheck、SDK 与 `drag-geometry` 单测，`docs:check`、`governance:check` 都过；负载 7.6 到 7.7 时 e2e：应用 `workbench-float`、`workbench-live-drag`、`lab-grid-panels`、`workbench-dnd` 共 102 条全过，nb-layout 示例 55 条全过。`lab-grid-panels:460` 第二段 coder 那里连挂两次（都在等 Lab 就绪），主会话与 master 对照各单跑 3 轮：分支 2 过 1 挂，master 也是 2 过 1 挂，同样的冷启动偶发。`release:smoke` 由 coder 在干净工作树上跑过（过），这一批合完后在 master 上再跑。
- omp 批量审查（t60 到 t64 整段，`@review`，约 30 分钟，[报告](evidences/impl-review-omp-t60-t64.txt)）：阻断 0、重要 4、建议 7，都成立，都已修并合入：
  - 重要：同帧分两次发布时停靠从按下处出发（偏移改成按窗用掉）、另一扇窗的过渡带着刚松手的窗回弹（按窗跳过三层的过渡标记）——这两条与 t65 由同一个 coder 做；边缘滚到头不动指针松手丢落点（t62，最后一步滚完先发布一次再停）；焦点抬升打断 Tab 顺序（浮动窗之间的导航次序改成出现的次序，接管时手柄也是停靠点；修时另发现 Shift+Tab 在两扇窗之间死循环，一并修好；`ui/nested-grid` 输出 103 补了一句窗之间的次序）。
  - 建议：横向缩放撑高不动的轴（方向为 0 的轴照搬起点）；反向滚动的容器（`column-reverse`、从右到左、竖排，Chrome 实测 18 种组合定规则，从右到左横向改为支持）；整行标签都在行尾之外时当成空行（t61，原行有标签就返回 null）；SDK 输出目录与声明临时目录重叠时构建前拒绝、失败也清临时目录（t64，nb-layout 的打包脚本同补）；CHANGELOG 写明调用 `GridSashResolver` 要传第三个参数（t63）。
  - 每条修正把修法改回去，对应的新用例都失败；主会话每次变基后复跑单测、typecheck、`api:check` 再合入。
- 与 w00043 t19 的协调：t19 第 6 片变基后用 `area`、`direction`、`leafRect`、`animate`（已在它的 README 留话）。
- 没验证：触摸与笔的松手起点；编辑器标签的浮动窗停靠走异步提交、晚于下一帧时照旧从记录矩形出发；`previewTile` 现读设备像素比，跨屏比例不同时反馈区域可能差一个设备像素。
