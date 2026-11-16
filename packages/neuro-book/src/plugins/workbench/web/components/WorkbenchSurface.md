---
标签: [state:local, env:global]
别名: ["工作台表面", "一棵树的布局", "Workbench Surface"]
---

# WorkbenchSurface

工作台主体的表面（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 的“渲染”“面板头与活动栏”）：把一份布局文档画成一个 `NestedGrid`。面板外框里是卡片和面板头，内容在内容层，所以视图换面板时内容不重建、还能从旧位置滑到新位置。文档、投影、显隐和命令都在宿主手里；它只测量、把呈现事实交出去、按相邻关系算卡片。

## 布局

根填满父级。呈现树的每块叶一个外框：状态栏不是卡片，活动栏和面板是。卡片四边留多少由邻接决定：贴着窗体、标题栏或状态栏的一边整缝，挨着别的面板半缝，活动栏与相邻且等长的工具面板相连时不留缝；相连与否按拖动中的几何算。

内容项放在内容层，从面板头下面开始：工具面板的头固定 32px；编辑组的头一到三行，表面观察它的高度（`ResizeObserver`），高了内容立刻让开，不过渡。它按卡片的内边距缩进、按卡片的圆角裁切，和外框拼成一张卡片。最大化的面板盖住除条以外的区域，它的四边按贴窗体算。

面板显示、隐藏、拆分时，外框露出、盖住保持尺寸的卡片；表面把卡片的形状（四边的内缩、四个角的圆角，相连的一侧不圆）交给 `NestedGrid` 的 `leafShape`，过渡中露出来的一截始终是一张完整的卡片：和邻居之间的缝还在，角是圆的。离开的叶用它最后一次呈现时的形状。这期间这张卡片的投影被裁掉，过渡结束时才出现。缩回去的卡片（`NestedGrid` 的 `outgoingLeaves`）四边与场景图沿用它最后一次有尺寸时的。

和活动栏相连的工具面板隐藏缩回去、显示从零宽长出来的这段（外框按卡片裁，`NestedGrid` 的 `shapedLeaves`），两张卡片画成一张，面板右边的两个圆角跟着它的右沿走：活动栏照断开的样子画（右边留半缝、四个角都圆），面板的形状往左伸过活动栏的半缝与一个圆角，伸出去的部分是活动栏的底色、压在活动栏下面（`GridLeafShape.fill`），盖住活动栏的圆角与半缝；缩到零时面板的两个圆角正好落在活动栏右边，摘掉面板画面不变，显示长完了换回相连的画法，画面同样不变。所以卡片的圆角不过渡，相连、断开的那一刻活动栏的角都被盖着。这段时间活动栏带 `data-shell-cap`（隐藏 `leave`、显示 `enter`）：它不画投影（投影会在伸过来的那一截上描出它的右边与圆角），中间那条短线（`data-shell-join-seam`）隐藏时淡出、显示时淡入。切换容器时换上来的一节从上往下长，活动栏前后都相连，不换画法。

分隔线的颜色按两侧是什么分：工具面板之间取 `--shell-pane-divider`，沿长轴两端缩进 `--shell-pane-divider-inset`；编辑组之间和其余的一样取 `--shell-seam`，贯通整个高度。卡片主题里一块一张卡片，缝就是分界，这几种线都是透明的；平铺主题里都画。

`390×844` 由 w00026 t11 的手机呈现决定；在它之前窄屏只是挤（开发者 2026-11-06 接受）。

## 交互

- 边界的手势、Tab 与 F6 的顺序、位移过渡都来自 `NestedGrid`。F6 的命令由宿主绑，调 `moveFocus`。
- 手势落账发 `gesture-commit`，宿主写回文档；组件不写文档。
- 视图动作随鼠标显示的范围是整块面板：指针或焦点在这块面板的外框或内容上时，给卡片写 `data-hover-actions-active`。不能悬停的设备一直显示。
- 焦点换了面板发 `focus-panel`。内容被停放时焦点还在里面，发 `content-parked`，焦点去哪由宿主定。
- 工具面板的内容带 `role="tabpanel"`，和面板头里的标签互相引用（`idPrefix`）。

## 数据

```ts
type Props = {
    /** 布局文档，受控，必填。 */
    doc: LayoutDoc;
    /** 这份文档的呈现树（`projectLayoutDoc`），受控，必填。 */
    projection: LayoutProjection;
    /** 副作用上下文（窗口绑定的项目）：变化取消进行中的手势。必填。 */
    contextKey: string;
    /** 最大化的面板；默认 null。只在内存。 */
    maximized?: string | null;
    /** 拿起的内容项（实时布局），`home` 是它已提交时所在的面板：预览把来源摘掉时内容也不卸载。矩形不走属性，由 `placeLifted` 写。 */
    lifted?: {key: string; home: string | null} | null;
    /** 拖动进行中（外壳在拖动会话里）：转给 NestedGrid 的 `dragging`，离开的叶不留着缩回去。 */
    dragging?: boolean;
    /** 实时布局预览里的空位：这块什么都不画，露出窗体底。 */
    slotPanel?: string | null;
    /** 画出来的浮动窗：矩形已夹取，拖动中是预览。 */
    floats?: ReadonlyArray<GridFloatInput>;
    /** 禁用边界手势；默认 false。 */
    disabled?: boolean;
};

type Emits = {
    /** 根的布局尺寸；同步发，还没量出来时是 null。 */
    (event: "extent", extent: GridExtent | null): void;
    /** 主题的 `--shell-gap`，换主题时重发：活动栏的叶宽要算上它。 */
    (event: "card-gap", gap: number): void;
    /** 布局发布了：这一刻的呈现尺寸（结构操作前写回意图用）。 */
    (event: "presented", sizes: Readonly<Record<string, GridExtent>>): void;
    /** 手势的预览尺寸；手势结束或预览撤回时是 null。 */
    (event: "preview", sizes: Readonly<Record<string, GridExtent>> | null): void;
    /** 手势落账。`collapsed` 只含这次手势改了收起状态的面板。 */
    (event: "gesture-commit", sizes: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void;
    (event: "issues", issues: readonly string[]): void;
    (event: "content-parked", key: string): void;
    /** 焦点现在在哪块面板；离开所有面板时是 null。 */
    (event: "focus-panel", panel: string | null): void;
};

type Slots = {
    /** 活动栏；条隐藏时不渲染。 */
    activitybar?(): unknown;
    statusbar?(): unknown;
    /** 面板的头：工具面板放 `WorkbenchPanelHead`，编辑组放编辑器给的头（可以什么都不放，内容占满）。 */
    head?(props: {panelId: string; idPrefix: string}): unknown;
    /** 打开着的空区域：区域的锚只在区域里一个分节都没有时进呈现树（ADR 0050），这时卡片里画它，不画头。 */
    "empty-region"?(props: {panelId: string}): unknown;
    /** 内容项。工具视图的 `contentKey` 是 `view:<id>`，编辑器标签是 `tab:<id>`，空的编辑组是 `editor:<面板 id>`；挪到别的面板时实例不重建。 */
    content?(props: {contentKey: string; panelId: string; active: boolean}): unknown;
    /** 拿起的内容项上面那一条头。 */
    "lifted-head"?(props: {contentKey: string}): unknown;
    /** 盖在分隔线之上、拿起的内容之下，不接指针（实时布局的分区与空位）。 */
    overlay?(): unknown;
    /** 浮动窗的手柄。 */
    "float-chrome"?(props: {id: string; rect: GridRect}): unknown;
};

type Expose = {
    /** 进行中的过渡直接到终点（拖动拿起后要量矩形）。 */
    settleMotion(): void;
    /** 写拿起的内容项的矩形（相对网格根）：跟手，不走渲染。 */
    placeLifted(rect: GridRect): void;
    /** 拖动中挪窗；`null` 回到原处。跟手，不走渲染。 */
    placeFloat(panel: string, offset: {x: number; y: number} | null): void;
    /** 在面板之间移动焦点；没动时返回 false。 */
    moveFocus(direction: "next" | "previous"): boolean;
};
```

attrs 落在根元素上。

## 状态

还没量出尺寸时外框为空、手势禁用。停放的内容不可交互、保持最后的非零尺寸、不卸载。没有加载、错误状态：视图的加载与失败由内容自己（`WorkbenchViewFrame`）画。

## 不支持

不读写 store 与记录，不执行命令，不处理拖放，不决定内容是什么，不算有效可见（`state/layout-present.ts`）。

## 隐藏通道理由

`env:global`：主题写在文档根上、CSS 变量的变化没有事件，缝宽又要进几何，所以观察文档根的主题属性。

## 注意事项

内容层在外框之外：视图里用 `closest("[data-leaf]")` 找不到外框，要找所在面板读 `data-content-leaf`。
