# t09 计划：应用内浮动

## Context

**要解决什么。** 布局收紧到骨架之后，编辑器标签离不开编辑区，工具视图也进不了编辑区（开发者 2026-11-06：“编辑器标签想离开编辑区用浮动”）。t01 决定 6：松手时没有落点、这个东西允许浮动，就在松手处浮动打开；决定 8：浮动的单位是带标签的组，回到停靠要拖到标签条或外缘窄带。

**依据。** [提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 1 节不变量、第 3 节规则与“浮动窗经过面板”、第 5 节面板头、第 7 节“浮动”、命令表；t01 决定 6、7、8；t02 原型 `LayoutTreeDraft.vue`；[ui/workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 24 到 32、35 到 38；`workbench/views.md`、`workbench/commands.md`、`workbench/editor.md` 输出 3、35、49、55。设计审查 [`evidences/plan-review.txt`](evidences/plan-review.txt)。

**开发者已确认。** t01 决定 6、7、8；2026-11-06“都按推荐”：t09 在 t08 之后。操作系统级浮动不做（t12 不在这一轮）。

## 技术选型

无新依赖。缩放不复用 nb-ui `useFloatingWindow`：它读全局 `document`、`useWindowSize` 与传送目标，t01 决定 7 要求新包不读全局；只照抄方向表与按键步长（10px，Shift 1px）。

## 关键设计

### 模型：`nb-layout/src/layout-doc.ts`

```ts
export interface LayoutFloatRect {readonly x: number; readonly y: number; readonly width: number; readonly height: number}
export interface LayoutFloat {
    readonly panel: string;
    /** 卡片的矩形，相对树区域的 CSS 像素，写入时取整。呈现时夹取，标签条总能抓到，夹取不写回。 */
    readonly rect: LayoutFloatRect;
}
// LayoutDoc.floats: ReadonlyArray<LayoutFloat>，后面的压在前面的上面。
export const LAYOUT_MAX_FLOATS = 16;
```

- 面板记录都在 `panels`，树里的是叶，浮动的在 `floats`。校验：浮动的面板存在、不在树里、不重复；没有名字、不隐藏、不收起；`x`、`y` 有限，`width`、`height` 有限且大于零；每块面板要么在树里要么在 `floats`；**“至少一个编辑组”只数树里的**；个数不超上限。旧记录 `floats: []` 不用升版本；旧构建读到非空的 `floats` 按损坏处理、不覆盖原件，可以接受。
- 操作：`floatTab(doc, {tab, rect}, policy)`（新的无名面板，继承角色；来源是只有这一个标签的浮动窗时等于改矩形）；`setFloatRect(doc, {panel, rect})`；`raiseFloat(doc, panel)`；`applyLayoutDrop` 的 `float` 动作：标签来源走 `floatTab`，面板来源走 `setFloatRect`。超上限返回 `limit-exceeded`。
- **`sameLayoutShape` 要比 `floats`**（面板次序加矩形）：否则只改矩形、只换叠放的结果会被当成放回原处吞掉。矩形写入时取整，所以比相等就行，也解决了小数像素发虚。
- `movePanelToEdge`、`moveTabToEdge`、`movePanelToStrip`、`moveTabToStrip` 支持来源在浮动窗里：`movePanelToEdge` 给浮动窗现造一片叶，从 `floats` 摘掉。`removePanelNode` 同时摘 `floats`。
- `settleEmptyPanel`：浮动窗空了移除。编辑组“最后一个”只数树里的：浮动的编辑组空了总是移除，树里最后一个留着（整块拖走时同一次操作留一个空组，这是现成行为）。活动编辑组没了时换到 `treeEditorAnchor(doc)`：**树序最后一个编辑组**（浮动窗没有相邻，见“编辑器”）。
- `setPanelCollapsed` 对浮动窗返回 `rejected`。`findTab`、`stripDynamicTabs`、`carryDynamicTabs`、`reconcileViews` 都按 `panels` 走，核对过不用改：放弃改动时不在目标文档里的浮动窗，它的编辑器标签回活动编辑组；模板里浮动的工具视图照留（它是“上一次的布局”，矩形呈现时夹取）。
- `fitsSkeleton`、`projectLayoutDoc` 只看树：浮动不影响骨架与投影。

### 落点：`layout-drop.ts`

- `LayoutDropAction` 加 `{kind: "float"; rect}`。**动作键只写 `float`**（`dropKey`）：矩形每帧变，会话的“与最后显示相同”和实时布局的“候选稳定”都按键比；`float` 不进预览缓存。
- `LayoutDropInput` 加：`floats?: ReadonlyArray<LayoutDropPanelGeometry>`（已按叠放从上到下排好），`noCenter?: boolean`。
- `resolveLayoutDrop` 的先后：**先判浮动窗**（在 `excluded` 之前：浮动窗可以盖在条上）。命中了只看这一块：标签条接受就插入，正文接受就添加为标签，否则 `null`，不穿透到底下的面板、条与预备区；浮动窗外缘没有缝的容差。`layoutDropPanelAt` 同样先判浮动窗。
- `noCenter`（整窗拖动）：`resolveInPanel` 与 `layoutDropSectors` 不给中央，空面板也不算整块中央。窄带比例由调用方传 `edgeRatio: 0.14`。
- `enumerateDropCandidates` 在树后面列浮动窗（标签条、中央）。

### 没有落点：`workbench/web/layout-drag.ts`

`dropAt` 拆出三种结果，`float` 只在“明确的无落点”里给：

| 情形 | 结果 |
|---|---|
| `resolveLayoutDrop` 得 `null`（包括被接受矩阵拒绝、指针在条、标题栏、窗口外） | 浮动；来源不许浮动（`floatable: false`）或窗数到上限时 `null` |
| 被挡：顶层元素不在外壳里（菜单、对话框） | `null`，取消 |
| 标签来源，指针在 `data-no-drag` 上（按钮区） | `null`，取消 |
| 活动栏上段 `barDrop` 的 `null`（编辑器标签、最大化时） | `null`，取消：拖到活动栏是想放进侧栏，放不进不该开窗 |
| 标签条量不到、`applyLayoutDrop` 失败 | `null`：这是出错或暂时算不出 |
| 指针在窗口外（`top === null`） | 浮动，矩形夹进树区域；t12 不做，这里就是回退 |

矩形：大小 `FLOAT_DEFAULT = 460×340`（原型），不小于角色的最小尺寸，不大于树区域；位置让指针落在头上（左起 40px、上起 14px）。落点指示下反馈画这个矩形，文字“浮动打开”；实时布局下卡片头写同样的字。

### 整窗拖动（`source.kind === "panel"`）

工作台从前只有标签来源，`LayoutTabSource` 改成 `LayoutSource`，用到 `source.tab` 的地方分开。

- **起拖**（`fromElement`）：在浮动窗的头里（`[data-float] [data-panel-strip], [data-float] [data-panel-head]`），不在 `data-no-drag` 上：标签以外的空白，或只有一个标签的窗的那个标签，来源是整窗。多标签窗拖标签是撕下，走普通标签。键盘的来源始终是标签。
- **跟手**：窗不走卡片。拿起时记下指针相对呈现矩形（夹取之后的）的偏移；每次判定把新矩形写进 store 的 `floatPreview`（**不走 `setLivePreview`**，不换文档、不重算投影）。窗此刻 `pointer-events: none`（`data-float-moving`），判定才看得到底下。
- **落点**：`noCenter`、`edgeRatio: 0.14`、自己不在 `floats` 里。指针在标签条或窄带上：反馈按落点指示画（线、矩形、分区），窗继续跟手，**这一场不走实时布局**：窗没有卡片可缩，候选文档里它已经没了，指针下什么也跟不上。其余情形动作是 `float`（移动），放下写一次。被菜单挡住 `null`，放下回原处。别的窗的按钮、活动栏放不进时也算移动。
- `commitsUnderPointer` 对整窗为真。Esc 取消，矩形回原处。

### 叠放与呈现：`NestedGrid`

- 属性 `floats?: ReadonlyArray<{id: string; rect: GridRect}>`：追加到 `maximizePlacement` 之后的摆放里（`GridLeafPlacement.float: true`），内容项照常归属（`placeContents` 用叶矩形），所以浮动与停靠之间内容不换父元素、不重建。不进 `obscuredLeaves`：浮动窗始终在最大化的面板上面。
- **层级不用 `NB_Z_INDEX.workbenchFloat`**：内容层要和外框同一父元素才能不搬 DOM，浮动窗只能在网格的层叠上下文里；全局次序不变（网格根在下拉菜单之下）。外框 `10 + 3i`，内容 `11 + 3i`，手柄 `12 + 3i`（内联样式）；盖层 900、拿起的内容 1000。提案第 7 节与 t09 README 的说法追加决策记录。
- 外观：投影、圆角直接画在浮动窗的外框上（`--layout-card-*`）：元素自己的 `box-shadow` 不被自己的 `overflow: clip` 裁；外框不留内边距，矩形就是卡片。外壳把 `--shell-card-radius` 在 `[data-float]` 上覆盖成 `--layout-card-radius`，内容的下圆角跟着。
- **过渡**：只有浮动窗矩形变了不是布局变化。`grid-motion.ts` 加 `settleFloats(items, previous)`：同一块浮动窗（键相同、都是 float，内容项还属于它）的矩形按上一次的算，`decideMotion` 就认不出变化。浮动窗出现、消失照常走过渡：撕下、停靠时内容从旧矩形飞到新矩形。
- 插槽 `float-chrome {id, rect}`：网格根的直接子元素，矩形同浮动窗，`pointer-events: none`，里面的手柄自己开；放在外框里会被内容层盖住。
- 夹取 `clampFloatRect(rect, extent, {keepWidth: 80, keepHeight})`（`layout-doc.ts`，纯函数），外壳在呈现时调：头的 `keepHeight` 高度与 80px 宽留在树区域里，不写回。
- Tab 与读屏：浮动窗追加在 `layers` 后面，F6 循环经过它（`useGridFocus` 不用改）。

### `FloatWindowHandles`（`nb-layout/src/vue`，同名 `.md`、Lab 场景）

属性 `rect`、`min`、`max`、`labels`；事件 `preview(rect | null)`、`commit(rect)`。

- 指针：四边四角 8 个手柄（命中带 6px，骑在边上），指针捕获在手柄上，Esc 取消。纯函数 `resizeFloatRect(start, direction, dx, dy, bounds)` 在 `layout-doc.ts`，负方向同时改 `x`、`y`。
- 键盘：只有两个能聚焦：右下角手柄（方向键缩放），和一个平时看不见、聚焦时才露出来的移动把手（方向键移动）。步长 10px，Shift 1px，每次 `commit`。别的手柄 `tabindex=-1`，不让 Tab 走八步。
- 不读全局 `document`、`window`。

### 外壳：`WorkbenchSurface`、`WorkbenchShell`、store

- Store：`floatPreview`；`renderedFloats`（`renderedDoc.floats` 加预览，再夹取）；`previewFloat`、`setFloatRect`、`raiseFloat`、`floatView`、`dockFloat`、`commitDrop`。**`commitDrop(source, action, part, keyboard)` 收编现在写在 Shell 里的分流**：编辑器标签走 `EditorTabDrag.drop`；编辑器的整窗停靠走 `EditorTabDrag.dropPanel`；只改矩形、工具面板走 `drop`。命令也经它。
- `toggleMaximized` 对浮动窗返回 false（命令 `unavailable`），`effectiveMaximized` 同样不认。浮动窗不可最大化、不可收起。
- 有效可见：`effectiveVisibleTabs` 先判 `doc.floats`：活动标签算可见，被盖住、别的面板最大化时也算（提案）。
- 面板头：动作按钮的预算按浮动窗的矩形宽（`state.presented` 里没有它）。框架按钮：浮动窗只有“回到停靠”；树里的工具面板加“浮动”（提案第 5 节）。`panelTitle` 对浮动编辑组写“浮动编辑区”。
- 叠放：Surface 在 `pointerdown`（捕获）与 `focusin` 时 `raiseFloat`，已在最前不写。`data-float-chrome` 上按下也算。
- `focusedPart` 在当前面板浮动时是 `float`（提案）。`ViewContext.location` 不加 `float`：浮动窗没有名字，现在就是 `null`。
- “移动到”菜单加一节“浮动”（`floatable` 且不是已经独占一个窗）。

### 命令（`commands/panel-commands.ts`、`workbench/commands.md`）

- `nbook.view.float {panelId?}`：把这块面板的活动标签浮出来，矩形按树区域居中、按窗数错开 24px。不可浮动的视图、已经独占一个窗时 `unavailable`。
- `nbook.view.dock {panelId?}`：浮动窗回到停靠。工具视图各回声明的具名面板；编辑器回 `treeEditorAnchor`。不是浮动窗时 `unavailable`。命名沿用提案。

### 键盘拖动

- `regions`、`stopsOf`、`panelGeometry`、`freeze` 都包括浮动窗；来源在浮动窗里时它是起点区域（Spec 31 直接 Enter 不动）。
- 区域末尾加一个“浮动”（`FLOAT_REGION`）：Enter 就是 `float`，矩形同命令的缺省。`floatable: false`、已独占一个窗时不列。
- 键盘判定时 `floats` 只传所在区域那一块：别的窗盖着的落点也要能选。

### 编辑器：`shared/editor-panels.ts`、`groups.ts`、`area.ts`、`tab-drag.ts`

- `editorEntries`：树序之后接浮动的编辑组，`area.groups` 里就是普通的组。
- `PanelTabs.float(tabId, rect)`；`area.moveToFloat(tabId, rect, options)`：和 `moveToNewGroup` 同样先结算。`EditorTabDrag.drop` 的 `float` 走它；`previewable` 的 `float` 判法同新组。
- **整窗停靠走编辑器区**：`EditorTabDrag.dropPanel(panelId, action, part, keyboard)`，按标签顺序逐个走 `moveTab` / `moveToNewGroup` 的结算、同文件合并与固定分区；中途被拒绝就停，剩下的留在窗里，提示照旧。只改矩形不走它。
- **浮动编辑组没有相邻**：`rightOf(浮动组)` 是 `treeEditorAnchor`（“在侧边打开”不再拆，直接进树里的组）；`openAtEdge(浮动组, edge)` 落到 anchor 上（浮动窗不拆）。关到空后活动组换到 anchor。
- 编辑组的头（`EditorAreaParts.head`）加属性 `frameActions: ReadonlyArray<{id, icon, label, run()}>`，画在标题动作之后，`data-no-drag`。外壳只给浮动窗传“回到停靠”。
- 标签右键菜单加“浮动”（`tab-menu.ts`），走 `area.moveToFloat`，矩形同命令的缺省。
- `createMemoryEditorPanels` 的 `newId` 同时查 `panels`：测试里新组 id 不再撞上浮动组。

### 实时布局

`float` 候选（撕下、指针下没有落点）：`candidateDoc` 就是摘掉来源的文档，键是 `float`，稳定 150ms 判定照旧。卡片头写“浮动打开”，松手内容从卡片飞到浮动窗（`land`）。`freeze` 含浮动窗的矩形与标签条。

## Spec 与文档改动

- `ui/workbench-layout.md`：输出 1（模型的 `floats`）、17（可见）、20（框架按钮）、24（整窗能拖）、25（规则：浮动窗优先、不穿透）、26、28（“没有落点”分清）、31（键盘）、32（结构键含窗）、35（命令）、36（`focusedPart`）、38（整窗不走实时布局）；新增输出“应用内浮动”与验收；“不承诺”去掉浮动。
- `ui/nested-grid.md`：`floats`、`float-chrome`、叠放、过渡、最大化。
- `workbench/views.md`、`views.ts`、SDK 作者文档：`floatable`。`workbench/commands.md`：两条命令。`workbench/editor.md` 输出 3、35、49、55、57。
- 组件 `.md`：`NestedGrid`、`WorkbenchSurface`、`WorkbenchShell`、`FloatWindowHandles`、`EditorGroupHead`。
- 提案追加决策记录；t09 README 目标段同步。`workbench/files-explorer.md` 留给 t10。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | 模型：`floats`、校验、操作、`sameLayoutShape`、夹取与缩放的纯函数；落点 `floats`、`noCenter`、`float` 动作 | `layout-doc.test.ts`、`layout-drop.test.ts`、`default-tree.test.ts` |
| 2 | 呈现：`NestedGrid`、`grid-motion`、`FloatWindowHandles`；store、可见性、Surface、Shell 的只读部分 | `NestedGrid.dom.test.ts`、`grid-motion.test.ts`、`layout-doc-store.test.ts`、Lab |
| 3 | 工具视图：无落点就浮动、整窗拖动、撕下、停靠、`floatable`、框架按钮、命令、键盘 | 新 `workbench-float.e2e.ts`、`workbench-dnd`、`workbench-live-drag` |
| 4 | 编辑器：`editor-panels`、`area`、`dropPanel`、头的按钮、菜单 | `area.test.ts`、`editor-area` |
| 5 | Spec、提案、README，收口 | `docs:check`、`lab-scenes`、`lab-grid-*` |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 校验：坏的 `floats` 拒绝；操作保持不变量（空窗移除、树里至少一个编辑组、只改矩形与换叠放不被吞、到上限失败） | `layout-doc.test.ts` |
| 浮动窗优先、不穿透；`noCenter`；缝的容差不吸进浮动窗 | `layout-drop.test.ts` |
| 工具视图拖到编辑区中央松手：浮动打开，内容同一个节点；记录里有矩形，刷新后还在 | `workbench-float` |
| 不浮动的清单：`floatable: false`、按钮区、菜单挡住、活动栏放不进、Esc | `workbench-float`、`workbench-dnd`（`noDropShown` 改判据，不放宽：断言种类是 `float`） |
| 拖窗的标签条空白处：跟手、没有过渡、不写记录；放下写一次；经过中央继续浮着，到标签条、14% 窄带才停靠 | `workbench-float` |
| 窗口变小后拖窗不跳；夹取不写回 | `workbench-float`、`layout-doc.test.ts` |
| 多标签窗拖标签撕下；单标签窗拖标签是移动 | `workbench-float` |
| 回到停靠：拖到标签条；框架按钮回声明的位置；内容同一个节点 | `workbench-float` |
| 缩放：边角手柄、最小尺寸、键盘；键盘移动 | `workbench-float`、`FloatWindowHandles.dom.test.ts` |
| 点击提到最前，没变时不写 | `workbench-float` |
| 焦点在窗里时最大化、收起命令 `unavailable`，工作台不空白；树里的面板最大化时窗还在上面 | `panel-commands.test.ts`、`workbench-float` |
| 键盘：拿起窗里的标签停在原位；浮动区域；回到树里；`nbook.view.float`、`nbook.view.dock` | `workbench-float` |
| 编辑器标签拖到工具面板上松手：浮动打开；可以接着输入，撤销还在；关到空后焦点回树里 | `editor-area` |
| 整窗停靠：目标组已有同一文件并掉、固定标签进固定区、有未裁决输入时不动 | `area.test.ts` |
| 拆分、在侧边打开在浮动的编辑组上：作用在树里的组 | `area.test.ts` |
| 被盖住仍算可见 | `layout-present.test.ts` |
| 实时布局：撕下到没有落点的地方，卡片飞到窗；候选键稳定 | `live-drag.test.ts`、`workbench-live-drag` |
| Tab、F6 经过浮动窗 | `workbench-float` |

## 验证

`bun run test:affected --since master --typecheck`；e2e：`workbench-float`、`workbench-dnd`、`workbench-live-drag`、`workbench-views`、`editor-area`、`lab-grid-*`、`lab-scenes`（新组件有场景）。手感由开发者试。

## 不做与风险

- 操作系统级窗口（t12）；手机呈现下的浮动（t11）；资源树拖文件（t10）。
- **原来“没有落点”的松手现在会开一个窗**：拖错了多一个窗。提案定的，开发者试过原型后认可（决定 6）；Esc 取消；上限 16。
- 整窗经过停靠位置时窗还在指针下，落点反馈在它底下：提案没定，这里按落点指示画，手感由开发者试。
