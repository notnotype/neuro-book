# t09 计划：应用内浮动

## Context

**要解决什么。** 布局收紧到骨架之后，编辑器标签离不开编辑区，工具视图也进不了编辑区（开发者 2026-11-06：“编辑器标签想离开编辑区用浮动”）。t01 决定 6：松手时没有落点、这个东西允许浮动，就在松手处浮动打开；决定 8：浮动的单位是带标签的组，回到停靠要拖到标签条、接缝或边缘窄带。

**依据。** [提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 1 节模型与不变量、第 3 节规则与“浮动窗经过面板”、第 7 节“浮动”；t01 决定 6、7、8；t02 原型 `LayoutTreeDraft.vue` 的 `floatActive`、`startFloatResize`、`floatRectAt`；[ui/workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 25 到 32、37、38；`workbench/views.md`、`workbench/editor.md` 输出 49、55。

**开发者已确认。** t01 决定 6、7、8；2026-11-06“都按推荐”：t09 在 t08 之后。操作系统级浮动不做（t12 不在这一轮）。

## 技术选型

无新依赖。缩放的几何看 nb-ui `useFloatingWindow` 能不能复用；它绑定对话框的 DOM 与层级时只抄算法，写明原因。

## 关键设计

### 模型：`nb-layout/src/layout-doc.ts`

```ts
export interface LayoutFloat {
    readonly panel: string;
    /** 相对树区域的 CSS 像素。呈现时夹取，标签条总能抓到，夹取不写回。 */
    readonly rect: {readonly x: number; readonly y: number; readonly width: number; readonly height: number};
}
// LayoutDoc.floats: ReadonlyArray<LayoutFloat>，后面的压在前面的上面。
```

- 面板记录都在 `panels`，树里的是叶，浮动的在 `floats`。校验：浮动的面板存在、不在树里、不重复、没有名字（具名面板留在骨架上）；矩形是有限正数；每块面板要么在树里要么在 `floats`。
- 操作：`floatTab(doc, {tab, rect}, policy)`（新的无名面板，继承角色）、`setFloatRect`、`raiseFloat`。`moveTabToStrip`、`moveTabToEdge`、`movePanelToStrip`、`movePanelToEdge` 支持来源在浮动窗里。
- `settleEmptyPanel`：浮动窗空了移除。**树里至少一个编辑组**：`editorIds` 只数树里的，浮动的编辑组空了总是移除。
- `currentEditor` 可以是浮动的编辑组。
- `layoutStructureKey`、`stripDynamicTabs`、`carryDynamicTabs`、`rebaseIntents` 核对。
- `fitsSkeleton` 只看树：浮动不影响骨架。

### 落点：`layout-drop.ts`

- `LayoutDropAction` 加 `{kind: "float"; rect}`，`applyLayoutDrop` 支持。
- 判定顺序：先按叠放从上到下看浮动窗（标签条、正文都接收同角色的标签：插入、添加为标签；外缘没有），再看树。浮动窗不接收的角色：盖住的地方算无落点，不穿透到底下。
- **无落点就浮动**：`resolveLayoutDrop` 不变，`layout-drag` 的 `dropAt` 在得到 null 且这个来源允许浮动时给 `float`。被菜单、对话框挡住的（`top` 判定）不浮动：是 null；工作台之外（包括标题栏、状态栏）算无落点，也浮动，矩形夹在树区域里。
- **浮动窗整个拖动**（`source.kind === "panel"`）：只有标签条与 14% 的外缘窄带能停靠，中央继续浮着（`edgeRatio`、策略不接受 `center`）。没有落点就是移动。
- 允许浮动：工具视图声明 `floatable?: boolean`（缺省真，`workbench/views.md`）；编辑器标签都允许。不允许时照旧没有落点、取消。

### 动作键

`float` 的矩形每帧变，动作键只写 `float`：落点指示“与最后显示相同才提交”按它比。放下用此刻的矩形。

### 呈现：`NestedGrid`、`WorkbenchSurface`

- `NestedGrid` 加 `floats?: ReadonlyArray<{id: string; rect: GridRect}>`：追加到叶的摆放后面（`data-float`），内容项照常归属它（`placeContents` 用叶矩形），所以浮动与停靠之间内容不换父元素、不重建。
- 叠放：还在网格的层叠上下文里，提案说的 `NB_Z_INDEX.workbenchFloat` 不需要了：外框按序 `10 + 2i`，内容 `11 + 2i`；盖层、拿起的内容抬到最上（900、1000）。全局次序不变（网格根在下拉菜单之下）。`nested-grid.md` 同步。
- 夹取（纯函数 `clampFloatRect`，`layout-project` 或 `layout-doc`）：标题栏高度与 80px 宽留在树区域里。
- 卡片外观：浮动窗一圈投影与圆角（`--layout-card-*`），不用 `layoutCardEdges`。
- 有效可见（`effectiveVisibleTabs`）：浮动窗里的活动标签算可见，被盖住也算（提案）。

### 操作：外壳

- **移动**：拖标签条空白处，或单标签窗的标签（`data-float-move`）：来源是整个面板。多标签窗拖标签是撕下，走普通的标签拖动。
- **跟手**：整窗移动不走卡片（它本身就是窗）。实时布局与落点指示都一样：`showPreview` 摆一份改了矩形的文档，不等稳定，且这次布局变化不过渡（`NestedGrid` 属性 `motionless`：判定当手势）。放下写一次。经过可停靠的位置时按当时的手感走。
- **缩放**：四边四角的手柄（`nb-layout/src/vue/FloatResizeHandles.vue`，同名 `.md`、Lab 场景），键盘方向键缩放。最小尺寸取角色的约束（`panelConstraints`）。预览写 `setLivePreview`，放下写一次。
- **叠放**：点击或聚焦提到最前（`raiseFloat`，已在最前不写）。
- **回到停靠**：拖（决定 8）。框架按钮只有一个“回到停靠”：工具视图回它声明的位置，编辑器标签回活动的树里编辑组（命令 `nbook.view.dock-panel`，图标 `i-lucide-panel-top`）。不做“浮动”按钮、不做窗口标题。

### 编辑器

- `editorEntries` 把浮动的编辑组排在树的后面：`area.groups` 里就是普通的组。
- `PanelTabs.float(tabId, rect)`；`area.moveToFloat(tabId, rect)`：和 `moveToNewGroup` 一样先结算。`EditorTabDrag.drop` 的 `float` 走它。
- 拆分、`side` 在活动组是浮动的时候：`tree.openAtEdge` 落到树里相邻的编辑组上（浮动窗不拆），`rightOf` 对浮动组是 null。
- 目标是浮动的编辑组：`moveTab` 照常（已有同一文件就并掉）。

### 实时布局

`float` 候选（标签撕下、指针下没有落点）：预览是“来源收起”（t08 的 `source-removed`），卡片上写“浮动打开”，松手内容从卡片飞到浮动窗。落点指示：拖影写字，反馈画矩形。

### Tab 与读屏

浮动窗在层序里排在树之后（`layers` 追加），`F6` 循环经过它。

## Spec 与文档改动

- `ui/workbench-layout.md`：不承诺去掉浮动；模型的 `floats`；输出 25 加规则；输出 26、28 “没有落点就是取消”改；新增输出“应用内浮动”；验收。
- `ui/nested-grid.md`：`floats`、`motionless`、叠放。
- `workbench/views.md`：`floatable`。`workbench/editor.md` 输出 49、55：离开编辑区的路径。
- `workbench/files-explorer.md` 留给 t10。
- 组件 `.md`：`NestedGrid`、`WorkbenchSurface`、`FloatResizeHandles`。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | 模型：`floats`、校验、操作、`fitsSkeleton`；落点 `float` | `layout-doc.test.ts`、`layout-drop.test.ts`、`default-tree.test.ts` |
| 2 | 呈现：`NestedGrid` 的 `floats`、夹取、外观、可见性；store 动作；记录往返 | `layout-doc-store.test.ts`、Lab 场景、`lab-grid-*` |
| 3 | 拖动：无落点就浮动、移动、撕下、回到停靠、`floatable`；编辑器 | 新 `workbench-float.e2e.ts`、`editor-area` |
| 4 | 缩放、叠放、框架按钮、键盘；Spec | `workbench-float`、`lab-scenes` |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 校验：坏的 `floats` 拒绝；操作保持不变量（浮动窗空了移除、树里至少一个编辑组） | `layout-doc.test.ts`（随机走） |
| 工具视图拖到编辑区中央松手：浮动打开，内容同一个节点；记录里有矩形，刷新后还在 | `workbench-float` |
| 编辑器标签拖到工具面板上松手：浮动打开；可以接着输入，撤销还在 | `editor-area` |
| `floatable: false` 的视图：没有落点、取消 | `workbench-float` |
| 拖浮动窗的标签条空白处：跟手、没有过渡；放下写一次；经过中央继续浮着，到标签条、14% 窄带才停靠 | `workbench-float` |
| 多标签窗拖标签撕下；单标签窗拖标签是移动 | `workbench-float` |
| 回到停靠：拖到标签条；框架按钮回声明的位置；内容同一个节点 | `workbench-float` |
| 缩放：边角手柄、最小尺寸、键盘；夹取不写回：窗口变小再变大矩形不变，标签条总抓得到 | `workbench-float`、`layout-project` 单测 |
| 点击提到最前，没变时不写 | `workbench-float` |
| 拆分命令在浮动的编辑组上：拆到树里 | `area.test.ts` |
| 被菜单挡住不浮动；Esc 取消 | `workbench-float` |
| 现有“没有落点”的 e2e 改成新规则（工具视图在编辑组上是浮动） | `workbench-dnd`、`editor-area` |

## 验证

`bun run test:affected --since master --typecheck`；e2e：`workbench-float`、`workbench-dnd`、`workbench-live-drag`、`editor-area`、`lab-grid-*`、`lab-scenes`。手感由开发者试。

## 不做与风险

- 操作系统级窗口（t12）；手机呈现下的浮动（t11）；资源树拖文件（t10）。
- **风险：原来“没有落点”的松手现在会开一个窗**：拖错了多一个窗。提案定的，开发者试过原型后认可（决定 6）；Esc 取消。
- 整窗移动每帧 `setLivePreview` 换文档：投影重算一次，只改了矩形，`createGrid` 重建。量一下，慢就把矩形单独传。
