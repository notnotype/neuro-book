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

- 缝的命中半径是 `max(缝宽, 4px)`，默认缝宽 6px，优先于边和标签条（`drag.ts` 的 `retarget`）。
- 插到缝上时，新块占 `1/(n+1)`，其余的按原比例缩，不是把所有块拉平（`spatial.ts` 的 `insertAtSeam`）。文档写的 “equal shares” 只在原来就相等时成立。
- 预览里的新块是占位 `DROP_SLOT`，没有头；来源在第一个落点时收起，这一场不再回来。
- 并入标签时布局不动，占位盖住目标面板：填充 70%、内描边 2px、写 “Add as tab”，标签条和正文同一个样子（`style.css` 的 `drop-slot[data-kind="tab"]`）。

## 技术选型

无。规则都在现有的 `layout-drop`、`layout-doc`、`live-drag` 里改。

## 关键设计

设计审查（一个 Sonnet，[`evidences/plan-review.txt`](evidences/plan-review.txt)，16 条）之后的版本；各条的处理见 Task README。

### `nb-layout/src/layout-doc.ts`：四周的第三种目标

```ts
type LayoutEdgeTarget =
    | {kind: "split"; panel: string; edge: LayoutEdge}                   // 只分本窗口
    | {kind: "spread"; panel: string; edge: LayoutEdge}                  // 同方向一起分（新增）
    | {kind: "between"; branch: string; before: string; after: string};  // 两块之间，不变
```

`between` 不改形状：调用方（`moveToEdge`、`openAt`、`moveView`、`pointOfCandidate`）都不用动。

**`spread` 的规则**（`placeLeaf`，先摘掉来源）：`panel` 经别名找到它此刻的父分支。

- 父分支和这条边同方向：取分支里 `countsInShare` 为真且不是固定的子节点，n 个、总量 S。新块 `S/(n+1)`，这些子节点乘 `n/(n+1)`，其余（隐藏的、收起的、固定的、条）一律不动。新块插在 `panel` 这条边那一侧。n 为 0 时按 `split`。
- 不同方向（包括摘掉来源后分支塌陷）：按 `split`。`H[b, src]` 把 src 放到 b 左边：摘掉后 H 塌成 b，结果还是 src 在 b 左边，各一半。

**固定**：`isFixedChild(doc, siblings, child)` 放在 `layout-doc.ts`，`layout-project.ts` 的 `assignByParent` 也用它，同一条规则：条总是固定；分支里有编辑组时，不含编辑组的子节点固定。文档树和呈现树的答案相同：呈现里去掉的只有工具面板。所以 `V[e1, e2, panel]` 无论放到 e1 的上面、e2 的下面，都只在 e1、e2 里分，新块插在 panel 之前。

**原位**：`touches` 改成看文档：目标就是来源，或者来源就在这条边那一侧挨着（跳过隐藏的）。所以 `H[a, src, b]` 放到 a 的右边还是原位，`half` 也一样，不缩 a。`layout-drop.ts` 的 `isInPlace` 用同一个函数。

### `nb-layout/src/layout-drop.ts`：缝

```ts
export const LAYOUT_SEAM_HIT_PX = 6;
export interface LayoutSeam {branch: string; orientation: GridOrientation; before: string; after: string; at: number; from: number; to: number}
export function layoutSeamsOf(doc: LayoutDoc, panels: ReadonlyArray<LayoutDropPanelGeometry>): ReadonlyArray<LayoutSeam>;
```

- **几何**：`LayoutDropPanelGeometry` 加 `frame`（`[data-shell-card]`，缺省 `strip` 与 `body` 的并集：编辑组的头里还有提示条）。子节点的矩形是后代叶的并集，**没有几何的叶（隐藏、拖到零）不算**：相邻性按几何判，`H[A, Z(拖到零), B]` 的缝是 A|B，`before`、`after` 是 A、B。
- **判定顺序**：浮动窗 → 挡住的区域 → 缝 → 标签条 → 四周 → 中央 → 预备区。指针离缝的中线不超过 6px 且在交叉范围内，最近的缝胜出。预备区还是最后（“指针在真实落点上时不算”）。
- **策略**：`policy.seamAccepts?(doc, tabs, before, after)`，缺省没有缝落点：库的旧行为不变。还要过 `policy.accepts(tabs, 锚点, "edge")`。动作是 `{kind: "edge", target: {kind: "between", ...}}`。
- **键盘**：`enumerateDropCandidates` 加参数 `seams`，每条接受的缝一个候选，`region` 是树序靠前的那块；`pointOfCandidate` 返回缝的中点，判定就落回同一个动作。
- **分区**：指针在缝上时没有分区（`withSectors` 只在动作属于这块的五块时画），反馈只有空位。
- 文件头“同一个落点无论从这条边、缝……”的不变量改写：缝和四周是两个落点。

### `workbench/web/state/layout-constraints.ts`：限制

- `layoutEdgeTarget(doc, tabs, panel, edge, split)`：工具面板只有所在方向上的两条边，别的边 `null`（算中央）；`split` 是 `half` 返回 `split`，是 `shared` 返回 `spread`。`onlyEditors` 那段不再需要。
- `layoutSeamAccepts`：两边都只有编辑组，或两边都只有工具面板且分支方向是这一列、这一排的方向。所以活动栏、侧栏、编辑区、右栏之间，编辑区与面板之间都没有缝落点。
- `moveView` 的“新面板（挨着 X）”不跟设置走：直接用 `edgeTargetOf`（从相邻两块取，和现在一样）。
- `createLayoutPolicy({dropSplit: () => ...})` 传 getter，改设置不用重新挂载。store 自己那份 policy 只用 `accepts`、`newId`，不受影响。

### 设置

`nbook.workbench/dropSplit`：`half`（只分本窗口，缺省）或 `shared`（同方向的窗口一起分）。只有用户层，放在 `dragFeel` 旁边。不叫“均分”：其余的是按原比例缩，不是拉平。

### `workbench/web/layout-drag.ts`：被拒绝就取消

- `layoutDropOverPanel(input)`（`layout-drop.ts`）：浮动窗命中，或任一面板（不管接不接收）的正文、标签条及其 `SEAM_PX` 内，挡住的区域除外。**不用** `layoutDropPanelAt`：它在缝里只找接收的面板。
- `dropAt` 的 `resolved === null`：在面板上 → 返回 null 并置 `rejected`；不在面板上 → `canFloat` 就 `floatDrop`。所以窗口外、标题栏、状态栏、活动栏底段开窗；浮动窗不接收时也取消。
- `drag.rejected: Ref<boolean>`。标记写在 `documentElement` 的 `data-drop-rejected`，规则写成 `:root[data-workbench-dragging][data-drop-rejected] * {cursor: not-allowed !important}`（`WorkbenchDragFeedback` 的全局样式，否则压不过 `grabbing`）。读屏的状态节点写“不能放在这里”。
- `fileDrop` 同样判定。文件是资源树的会话，光标不归外壳：被拒绝时没有反馈，松手取消。

### `workbench/web/live-drag.ts`、`layout-drag.ts` 的 `candidateDoc`：预览

| 落点 | 预览文档 | 头 | 盖层 |
|---|---|---|---|
| 四周、缝（长出新块） | 真实结果 | 新块不画头（空位） | 无，只有空位的边框 |
| 预备区，面板没有别的标签 | 真实结果 | 不画头（空位） | 无 |
| 预备区，面板有自己的标签 | `removeTab` 再显示面板 | 它自己的头 | 并入盖层 |
| 中央、别人的标签条 | `removeTab` | 不动 | 并入盖层；标签条再加插入线 |
| 自己的标签条 | 真实结果 | 不动 | 无，标签跟手、其余滑开 |

- **卡片**：`wantsCard` 只对自己的标签条不拿起。别人的标签条要拿起：`removeTab` 之后内容靠 `lifted` 留着，不拿起实例就卸了。`homeOf` 在预览里找不到来源时看已提交的，卡片还是从来源面板缩出来。`candidateOf.immediate` 只看自己的标签条。
- **空位怎么认**：预览文档里来源标签所在的面板，且这块只有这一个标签（`slotPanel`）。整块移动时 id 不变，同样不画头。`WorkbenchSurface` 的 `head` 插槽都不渲染；内容只有拿起的那一项，不会露出别的。
- **盖层矩形**：`previewPanelRect(doc, panel, projection, extent, dpr)`，新写，和 `previewRevealRects` 共用摆放那一段，不经 `setPanelHidden`：收成标题行的目标，盖层就是那一行。浮动窗取它的矩形。放在外壳的 `overlay` 插槽里，跟着邻居用 `--motion-layout` 过渡。
- **插入线**画在盖层里面：偏移是冻结的标签条坐标减冻结的面板外框，盖层动它跟着动。
- **`previewable` 为假**（编辑器要合并或拒绝）：`candidateDoc` 为 null，`shownAction` 也是 null，不画盖层。文字用现有的 `shell.drop.addTab`。
- **落点指示模式不变**：它没有预览，分区和 `--drop-area-*` 已经是变暗加边框。

令牌（`nb-ui` 的 `tokens.css`、`theme/tokens.ts`、`docs/specs/theme/system.md`）：`--layout-slot-fill`（缺省透明）、`--layout-merge-fill`、`--layout-merge-border`、`--layout-merge-border-width`。

### `workbench/web/state/layout-present.ts`：头的样式

`titleOnlyPanels(doc)` 代替 `WorkbenchShell` 的 `titleOnlyIn`：

| 位置 | 一个视图 | 多个视图 |
|---|---|---|
| 侧栏这一列（活动栏显示着） | 只写标题 | 只写标题 |
| 别的工具面板、工具视图的浮动窗、活动栏隐藏时的侧栏这一列 | 只写标题 | 标签带 |
| 编辑组 | 标签条 | 标签条 |

- **按已提交的文档算**，外壳渲染、`headReserved`、`role`、拖动判定都用同一份（现在前三个按预览文档）：拖动中来源少了一个标签，头不跟着变。不在已提交文档里的 id（预览的新块）不问：它不画头。
- 写进 Spec：只写标题的头没有插入位，拖到头上是添加到最后；标签数变化时内容的 `role` 在 `region` 与 `tabpanel` 之间变。

## Spec 与文档改动

| 文件 | 改什么 |
|---|---|
| `ui/workbench-layout.md` | 20、22 头的样式；23 不跟设置走；25、26 判定表；27 两种分法；28 原位；30、37、38 空位、并入、缝上没有分区；31 键盘到缝；39 被拒绝取消、整窗能停靠到缝；设置；验收 2、10、21、22、23 |
| `theme/system.md` | 新令牌 |
| `workbench/files-explorer.md` | 工具面板上松手取消 |
| `nb-layout` 的 `TabStrip.md`、工作台的 `WorkbenchPanelHead.md`、`WorkbenchShell.md`、`WorkbenchDragFeedback.md` | 头的样式、盖层、光标 |
| `pending-confirmations.md` | 开发者改判：t09 “无落点就浮动”收窄 |

## 切片

1. **全部收起不再变矮**：已合入。
2. **落点规则**：`spread`、缝、限制、被拒绝取消、设置、键盘。验证 `layout-doc.test.ts`、`layout-drop.test.ts`、`default-tree.test.ts`、`layout-constraints.test.ts`；e2e `workbench-dnd`、`workbench-float`、`editor-area`、`files-explorer`。
3. **预览**：空位、并入盖层、令牌。验证 `live-drag.test.ts`、`tokens.test.ts`；e2e `workbench-live-drag`。
4. **头的样式**：`titleOnlyPanels`。e2e `workbench-views`、`workbench-shell`。

每片单独提交，片内只跑上面列的文件。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 11 全部收起 | `layout-project.test.ts`、`workbench-shell.e2e.ts` |
| 输出 25 判定表 | `layout-drop.test.ts`：缝先于四周和标签条、最近的缝胜出、嵌套分支、拖到零的面板不算、收成标题行、最大化没有缝 |
| 输出 26 限制 | `layout-constraints.test.ts`；`workbench-dnd.e2e.ts`：放到缝上插到两块之间、骨架上的缝不是落点 |
| 输出 27 两种分法 | `layout-doc.test.ts`：`V[e1, e2, panel]` 上下两端、`H[b, src]` 塌陷、一列里一块收起一块隐藏、来源在同一分支、原比例不相等 |
| 输出 28 原位 | `layout-doc.test.ts`：`H[a, src, b]` 放到 a 的右边，两种分法都不变 |
| 输出 31 键盘 | `layout-drop.test.ts` 的候选；`workbench-dnd.e2e.ts` 键盘放到缝上 |
| 输出 38 空位、并入 | `workbench-live-drag.e2e.ts`：新块没有头；并入时目标的头和活动标签不变、盖层在；别人的标签条上内容是同一个节点；收成标题行的目标盖层就是那一行 |
| 输出 39 被拒绝 | `layout-drop.test.ts`：缝上、浮动窗上；`workbench-float.e2e.ts`：工具视图放在编辑组上不开窗、光标标记在，放在状态栏开窗 |
| 输出 20 头的样式 | `workbench-views.e2e.ts`：一个视图只写标题，第二个进来变标签带，拖动中不变 |
| 设置 | `workbench-dnd.e2e.ts`：改设置不重新加载就生效，“移动到”不随设置变 |
| 令牌 | `tokens.test.ts` |
| 骨架不变量 | `default-tree.test.ts` 的随机操作加上缝和 `spread`：`fitsSkeleton` 成立，总尺寸守恒 |

## 验证

上面的文件；`test:affected --since master --typecheck`；手试：亮色截图给开发者看空位、并入、两种分屏。

未验证的边界：`LAYOUT_SEAM_HIT_PX = 6` 是估的（Trellis 是 `max(缝宽, 4)`，它默认缝宽 6，所以也是 6；我们的缝只有 1px），要开发者手试。

## 不做与风险

- **一排全部拖到零**：页面不再被压住，但这一排原来的高度留成空白带。开发者没提，先不动。
- **视图声明的高度上限**：交叉轴改成取最大值后，这一列放不满时下面留空，不再压住整行。
- **风险：缝和四周都在面板边上**：缝带只有 13px，四周 28%，手感要试。
- **风险：`shared` 让别的面板变小**：只在开发者打开设置时才有。
- **文件被拒绝时没有反馈**：资源树的会话管光标，这次不改。
