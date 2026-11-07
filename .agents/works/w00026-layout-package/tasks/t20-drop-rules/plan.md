# t20 计划：落点按中央、四周、缝重排，预览改成空位

## Context

开发者 2026-11-07 试用 t08、t09 之后提的要求（原话在 Task README）：

- 落点要简单明朗：中央并入，四周分屏，缝插到两块之间。骨架和“侧栏只上下分、面板只左右分”这些限制是去掉落点，不是把落点改到别处。
- 四周两种语义都支持；均分时固定的面板不参与：编辑区分屏不能分走侧栏的空间。
- 面板上被拒绝时松手取消，不开浮动窗。
- 头的样式按标签数。
- 预览不提前画头；并入标签时面板变暗加边框，样式可配置。
- 侧栏全部收成标题行时，整页变矮（片 1，已修）。

依据：[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 11、20、22、25、26、30、37、38、39，[nested-grid](../../../../../docs/specs/ui/nested-grid.md)，提案第 3 节。

Trellis 的本地副本在 `.local/trellis`（许可证与 AGPL 不兼容，只读行为，不抄代码）。读代码得到的、和它文档不同的事实：

- 缝的命中半径是 `max(缝宽, 4px)`，优先于边和标签条（`drag.ts` 的 `retarget`）。
- 插到缝上时，新块占 `1/(n+1)`，其余的按原比例缩，不是把所有块拉平（`spatial.ts` 的 `insertAtSeam`）。文档写的 “equal shares” 只在原来就相等时成立。
- 预览里的新块是占位 `DROP_SLOT`，没有头；来源在第一个落点时收起，这一场不再回来。
- 并入标签时布局不动，占位盖住目标面板：填充 70%、内描边 2px、写 “Add as tab”，标签条和正文同一个样子（`style.css` 的 `drop-slot[data-kind="tab"]`）。

## 技术选型

无。规则都在现有的 `layout-drop`、`layout-doc`、`live-drag` 里改。

## 关键设计

### `nb-layout/src/layout-doc.ts`、`layout-drop.ts`：缝和边

`LayoutEdgeTarget` 改成：

```ts
type LayoutEdgeTarget =
    | {kind: "split"; panel: string; edge: LayoutEdge}
    | {kind: "between"; branch: string; before: string | null; after: string | null; share: "neighbours" | "even"};
```

- **判定顺序**：浮动窗 → 挡住的区域 → 缝 → 标签条 → 四周 → 中央。缝用 `LAYOUT_SEAM_HIT_PX = 6`（我们的缝只有 1px，Trellis 默认 6px），最近的缝胜出。缝的位置由文档树加 `panels` 几何算（分支里相邻的可见子节点之间），不增加输入。
- **缝**：`between` + `share: "neighbours"`，新块只从两边取（现有的 `placeLeaf`）。`policy.seamTarget(doc, tabs, branch, before, after)` 回答这条缝是不是落点，`null` 就是没有这个落点，按面板的区域继续判。
- **四周**：`policy.edgeTarget` 不变，由策略决定。`half`：永远 `split`，取一半。`even`：这条边与父分支同方向时 `between` + `share: "even"`（可以在两端，`before` 或 `after` 为 null）；否则 `split`。
- **均分**：新块占可分配总量的 `1/(n+1)`，其余按原比例缩（同 Trellis 的代码）。固定的子节点不算进 n，也不缩：规则和 `layout-project.ts` 的 `assignByParent` 同一份，抽成 `isFixedChild`。所以 `V[e1, e2, panel]` 只在两个编辑组里分，`panel` 不动。
- **不变量**：`fitsSkeleton` 照旧守在 `apply` 出口，`default-tree.test.ts` 的随机操作性质测试加上缝与均分。

### `workbench/web/state/layout-constraints.ts`：限制

- `seamTarget`：两边都只有编辑组，或两边都是工具面板且这个分支是这一列、这一排。所以活动栏、侧栏、编辑区、右栏之间，编辑区与面板之间，都没有缝落点。
- `edgeTarget`：侧栏、右栏这一列只有上下，面板这一排只有左右；别的边没有窄带，算中央（现有规则）。

### 设置

`nbook.workbench/dropSplit`：`half`（只分本窗口，缺省）或 `even`（同方向的窗口一起分）。只有用户层，放在 `dragFeel` 旁边，经 `createLayoutPolicy` 传入。

### `workbench/web/layout-drag.ts`：被拒绝就取消

`dropAt`、`fileDrop` 的 `resolved === null`：指针在面板上（`layoutDropPanelAt` 不为 null）时返回 null，并标 `rejected`；不在面板上（窗口外、标题栏、状态栏、活动栏底段）才 `floatDrop`。外壳根写 `data-drop-rejected`，光标 `not-allowed`。键盘的“浮动”区域不变。

### `workbench/web/live-drag.ts`、`WorkbenchShell.vue`、`WorkbenchSurface.vue`：预览

- **长出新面板（`edge`、`reveal`）**：预览文档照旧，这块是**空位**：`live.slotPanel` 是它的 id，外壳不画它的头（工具面板和编辑组都一样），只有 `--layout-slot-fill`（缺省透明）和 `--layout-slot-border`。
- **并入（`center`、别人的 `strip`）**：预览文档是 `removeTab`（来源收起，内容靠拿起留着，和“浮动”的预览同一条路），目标面板的头、活动标签都不动。盖层 `data-live-merge`：矩形用 `previewRevealRects` 从预览文档算，跟着邻居过渡；`--layout-merge-fill`、`--layout-merge-border`、`--layout-merge-border-width`，中间写“作为标签加入”。别人的标签条再加一条插入线。
- **自己的标签条**不变：标签跟手，其余滑开。
- **落点指示模式**的并入用同一组令牌，五块分区的中央不变。

### `workbench/web/state/layout-present.ts`：头的样式

`panelHeadMode(doc, panelId)` 代替 `titleOnlyIn`：

| 位置 | 一个视图 | 多个视图 |
|---|---|---|
| 侧栏这一列（活动栏显示着） | 只写标题 | 只写标题 |
| 别的工具面板、工具视图的浮动窗 | 只写标题 | 标签带 |
| 编辑组 | 标签条 | 标签条 |

按**已提交的**文档算：拖动中来源少了一个标签，头不跟着变，放下才变。预览里新长出来的块本来就没有头。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `ui/workbench-layout.md` | 输出 11 全部收起留空；20、22 头的样式；25、26 重写判定表；27 均分；30、38 空位与并入；37 分区遇到缝；39 被拒绝取消；设置；验收 2、10、21、22、23 |
| `ui/nested-grid.md` | 交叉轴上限取最大的子节点，放不满的留空 |
| `workbench/files-explorer.md` | 工具面板上松手取消 |
| `nb-layout` 的 `TabStrip.md`、`WorkbenchPanelHead.md`、`WorkbenchShell.md` | 头的样式、盖层令牌 |
| `pending-confirmations.md` | 开发者改判：t09 “无落点就浮动”收窄 |

## 切片

1. **全部收起不再变矮**：`grid-geometry.ts` 的交叉轴上限。已完成。
2. **落点规则**：缝、四周两种语义、均分、限制、被拒绝取消、设置。验证 `layout-drop.test.ts`、`layout-doc.test.ts`、`default-tree.test.ts`；e2e `workbench-dnd`、`workbench-float`、`editor-area`、`files-explorer`。
3. **预览**：空位不画头、并入盖层、令牌。验证 `live-drag.test.ts`；e2e `workbench-live-drag`、`lab-grid-panels`。
4. **头的样式**：`panelHeadMode`。e2e `workbench-views`、`workbench-shell`。

每片单独提交，片内只跑上面列的文件。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 11 全部收起 | `layout-project.test.ts`、`workbench-shell.e2e.ts` |
| 输出 25、26 判定表 | `layout-drop.test.ts`；`workbench-dnd.e2e.ts` |
| 输出 27 均分与固定 | `layout-doc.test.ts`（`V[e1, e2, panel]`、`H[e1, e2]`） |
| 输出 38 空位、并入 | `workbench-live-drag.e2e.ts`：读头是否存在、盖层矩形、并入时目标的活动标签不变 |
| 输出 39 被拒绝取消 | `workbench-float.e2e.ts`：工具视图放在编辑组上不开窗；放在状态栏开窗 |
| 输出 20 头的样式 | `workbench-views.e2e.ts` |

## 验证

上面的文件；`test:affected --since master --typecheck`；手试：亮色截图给开发者看空位、并入、两种分屏。

未验证的边界：`LAYOUT_SEAM_HIT_PX = 6` 是估的，要开发者手试。

## 不做与风险

- **一排全部拖到零**：页面不再被压住，但这一排原来的高度留成空白带。开发者没提，先不动。
- **视图声明的高度上限**：交叉轴改成取最大值后，这一列放不满时下面留空，不再压住整行。
- **风险：缝和四周都在面板边上**：缝带只有 13px，四周 28%，手感要试。
- **风险：`even` 让别的面板变小**：只在开发者打开设置时才有。
