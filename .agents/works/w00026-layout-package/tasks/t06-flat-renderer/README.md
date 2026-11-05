---
schema: nbook.task/v2
taskId: t06-flat-renderer
status: planned
updated: 2026-11-05
---

# 扁平渲染层

## 目标与范围

在 nb-layout 里实现按矩形摆放的渲染层：模型算出叶子与分隔线的矩形，都放在同一父元素下，取代递归的 NestedGrid；独立的 Splitter 保留给 nb-story 与 dev-panel，拿掉 branchId、sashLineEnds。处理 Tab 与读屏顺序（按 t02 的结论）。

合同：[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md) 的摆放、取整、过渡、停放、Tab、F6、读屏顺序与验收 8、9。计划：[`plan.md`](plan.md)。

## 当前状态

开发者 2026-11-05 确认计划要点（“没问题”）：470ms 外框过渡放在这一片，新增依赖 `tabbable`，工作量大的切片按难度派 Haiku 或 Sonnet。

设计审查（Sonnet，[报告](evidences/design-review.txt)）22 条，重要 11、建议 11，已改进 Spec 与计划，没有开第二轮：

| 条 | 处理 |
|---|---|
| 1 取整做不到缝宽相同 | 成立（枚举核实）。改成沿主轴按设备像素累加，缝宽也取整，单元枚举 |
| 2 预览矩形为零就停放 | 成立。停放只看已发布的布局 |
| 3 放下收尾按帧数量矩形，会和过渡打架 | 成立。上限改成按时间 |
| 4 `snapLines` 在过渡开始时读旧位置 | 成立。过渡结束再排一次；窗口监听与 rAF 合并到父组件一份 |
| 5 过渡的判定有漏 | 成立。按结果判定，手势开始、尺寸变化无条件撤掉，计时重置，差不到 1px 不过渡 |
| 6 新叶、离开的叶没有定义 | 成立。新叶从边上长出来，离开的立即消失 |
| 7 Tab 进入 grid、点空白后按 Tab 回到 DOM 序 | 成立（Chrome 复现）。这一片不做，写进 Spec 的已知限制，t07 处理；配合第 13 条，这一片只在外壳改面板位置后才不一致 |
| 8 Tab 的边界 | 成立。纯函数 `nextFocusStop` 跳过空项，`compareDocumentPosition` 处理不在列表里的焦点，输入法组字放行。外层接手的“标记冒泡”去掉：内层 DOM 序总等于树序 |
| 9 `ariaSnapshot()` 看不到 `aria-owns` | 成立（Chrome 复现）。改用 CDP；id 用不透明串 |
| 10 搬走 grid 模式会丢的行为 | 成立，逐条写进计划。其中“分隔线上 Enter 收起的动画会丢”不成立：`keydown` 时手势已激活，属性写不上，现在就是瞬时的 |
| 11 选择器迁移写不死 | 成立。不派 Haiku，主会话随第 3 片改；“不改断言”改成“行为断言不改” |
| 12 分隔线的 key | 成立。DOM key 用前后节点 id，`data-sash` 不变 |
| 13 新叶不必排到 DOM 最后 | 成立（审查在 Chrome 里验证）。改成插在树序的前一块之后，Tab 接管和 `aria-owns` 只在不一致时挂 |
| 14 第 2 片前后矛盾 | 成立。只抽组件，grid 模式第 3 片删 |
| 15 第一帧、Teleport 时序、尺寸记录 | 成立。第一帧不停放，`stableOrder` 同步算，关闭时清记录 |
| 16 交叉轴 | 成立。取父分支的完整长度 |
| 17 F6 绕过命令系统 | 成立。库导出 `moveGridFocus`，工作台登记命令 |
| 18 量几何的用例约 113 个 | 成立。e2e 默认减少动态效果，测动画的开回来 |
| 19 `dpr` 的来源 | 成立。`ref` 加 `resize` 与 `matchMedia` |
| 20 `shellNodeRects` 重复 | 成立但接受：t07 换树时去掉 |
| 21 公开面的变化 | 成立。写进 `NestedGrid.md`；包还没发布 |
| 22 根上的标记与 t08 不相容 | 成立。标记写在外框上 |

## 下一步

开发者确认计划后，按 `plan.md` 的切片实施。
