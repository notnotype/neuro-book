---
标签: [state:local, env:global]
别名: ["工作台表面", "一棵树的布局", "Workbench Surface"]
---

# WorkbenchSurface

工作台主体的表面（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 的“渲染”“面板头与活动栏”）：把一份布局文档画成一个 `NestedGrid`。面板外框里是卡片和面板头，内容在内容层，所以视图换面板时内容不重建、还能从旧位置滑到新位置。文档、投影、显隐和命令都在宿主手里；它只测量、把呈现事实交出去、按相邻关系算卡片。

## 布局

根填满父级。呈现树的每块叶一个外框：状态栏不是卡片，活动栏和面板是。卡片四边留多少由邻接决定：贴着窗体、标题栏或状态栏的一边整缝，挨着别的卡片半缝，相连的一边不留缝；相连与否按拖动中的几何算。同一个区域里相邻的两块相连（`regionOf` 给的卡片组；实时布局的空位自成一块），一个容器的几节拼成一张卡片；活动栏和侧栏里贴着它、宽度大于零的每一块相连，侧栏几节时整列相连。四个角各自算：两侧的边都不相连才圆（写在外框里那一层与内容外层上的 `--shell-corner-tl`、`-tr`、`-br`、`-bl`）。相连的一边内边距为 0，投影在那里被外面一层的 `overflow` 裁掉。`data-shell-join` 只标活动栏与侧栏相连（活动栏是 `start`，侧栏的块是 `end`）。

内容项放在内容层，从面板头下面开始：工具面板的头固定 32px；编辑组的头一到三行，表面观察它的高度（`ResizeObserver`），高了内容立刻让开，不过渡。它按卡片的内边距缩进、按卡片的圆角裁切，和外框拼成一张卡片。最大化的面板盖住除条以外的区域，它的四边按贴窗体算。

面板显示、隐藏、拆分时，外框露出、盖住保持尺寸的卡片；表面把卡片的形状（四边的内缩、四个角的圆角，相连的一侧不圆）交给 `NestedGrid` 的 `leafShape`，过渡中露出来的一截始终是一张完整的卡片：和邻居之间的缝还在，角是圆的。离开的叶用它最后一次呈现时的形状。这期间这张卡片的投影被裁掉，过渡结束时才出现。缩回去的卡片（`NestedGrid` 的 `outgoingLeaves`）四边与场景图沿用它最后一次有尺寸时的。

和活动栏相连的侧栏隐藏缩回去、显示从零宽长出来的这段（外框按卡片裁，`NestedGrid` 的 `shapedLeaves`），活动栏和侧栏画成一张，侧栏右边的两个圆角跟着它的右沿走（几节时整列一起，圆的是最上面一块的右上角、最下面一块的右下角）：活动栏照断开的样子画（右边留半缝、四个角都圆），侧栏每一块的形状往左伸过活动栏的半缝与一个圆角，伸出去的部分是活动栏的底色、压在活动栏下面（`GridLeafShape.fill`），盖住活动栏的圆角与半缝；缩到零时面板的两个圆角正好落在活动栏右边，摘掉面板画面不变，显示长完了换回相连的画法，画面同样不变。所以卡片的圆角不过渡，相连、断开的那一刻活动栏的角都被盖着。这段时间活动栏带 `data-shell-cap`（隐藏 `leave`、显示 `enter`）：它不画投影（投影会在伸过来的那一截上描出它的右边与圆角），中间那条短线（`data-shell-join-seam`）隐藏时淡出、显示时淡入。切换容器时活动栏前后都相连，不换画法。

分隔线按两侧是什么分（`data-sash-kind`）：同一张卡片里几节之间（`panes`）是开放式分割线，取 `--shell-pane-divider`，沿长轴两端缩进 `--shell-pane-divider-inset`；线所占的那 1px 也是卡片：表面经 `NestedGrid` 的 `sashStyle` 给出卡片在长轴方向的范围（`--shell-sash-fill-start`、`--shell-sash-fill-end`），分隔线的 `::before` 在这段里画卡片底色与两端的投影，线两端不露窗体底、深色的外框不断开。编辑组之间（`editors`）和别的卡片之间（`shell`）取 `--shell-seam`，贯通整个高度；卡片主题里缝就是分界，这两种线透明，平铺主题里画。

切换容器时卡片不动、里面的内容滚过去（输出 42）：宿主经 `swap` 给离开、换上来的分节与方向（不含缝宽与裁切窗），表面补上主题的缝宽（`--shell-gap`）与裁切窗交给 `NestedGrid` 的 `swap`：窗是这一列的卡片（外框按卡片的四边内缩、四个角照卡片的）。右栏、底部面板的入口条叶不在交换里，窗与静止的卡片就是卡片里入口条以下那块：上边和入口条相连（不内缩、两个角是直的），下面两个角照卡片的，入口条叶照常画自己那一段卡片，拼成一张不动的卡片。静止的卡片画在 `swap-backdrop` 里（`data-shell-swap-card`，外层同外框里那一层，相连那一边的投影照样裁掉），滑动的外框这期间不画自己的底与投影、不挂主题的场景图，只带着头与内容滑。滚动中的叶（`NestedGrid` 的 `swappingLeaves`）照它们离开前、终点的样子画，不算上面的“角接过去”：活动栏前后都和侧栏相连，不换画法。

窄屏（例如 `390×844`）只保证没有页面级横向溢出、活动栏与框架按钮够得着，放不下的面板按输出 10 收走；不是为手机排的版。

## 交互

- 边界的手势、Tab 与 F6 的顺序、位移过渡都来自 `NestedGrid`。F6 的命令由宿主绑，调 `moveFocus`。
- 手势落账发 `gesture-commit`（手势开始时与落账之后的尺寸、这次的收起变化），宿主经 `applyGestureCommit` 写回文档；组件不写文档。
- 视图动作随鼠标显示的范围是整块面板：指针或焦点在这块面板的外框或内容上时，给卡片写 `data-hover-actions-active`。不能悬停的设备一直显示。头并在入口条里的分节，范围跨入口条叶与它自己的叶（入口条叶代表并进来的那一节）。
- 焦点换了面板发 `focus-panel`。指针与焦点按叶记，面板按此刻的投影现算：在入口条里点入口切了容器，焦点没动，并进来的那一节一换就再发一次。内容被停放时焦点还在里面，发 `content-parked`，焦点去哪由宿主定。
- 工具面板的内容：头只写标题的（分节、只有一个标签的浮动窗，`titleOnlyPanels`）是以标题命名的 `region`（`aria-labelledby` 指向头里隐藏的标题元素）；有标签带的（几个标签的浮动窗）是 `tabpanel`，和头里的标签互相引用（`idPrefix`）。

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
    /** 头只写标题的面板：没有标签带，内容是以标题命名的 `region`，不是 `tabpanel`。默认空集。 */
    titleOnlyPanels?: ReadonlySet<string>;
    /**
     * 视图自绘头的面板 → 右端按钮让出的宽度（CSS px）。只认此刻画成浮动窗的：外框里不画头，内容从窗口顶上开始（同并成一行的 `headless`）、
     * 四个角都裁圆，内容外层写 `data-own-head` 与 `--workbench-own-head-inset-end`；头由宿主画在 `own-head` 插槽里。默认空表。
     */
    ownHeads?: ReadonlyMap<string, number>;
    /** 拿起的内容项（实时布局）：预览把来源摘掉时由网格留住，内容不卸载（`NestedGrid` 的 `lifted`）。矩形不走属性，由 `placeLifted` 写。 */
    lifted?: {key: string} | null;
    /** 拖动进行中（外壳在拖动会话里）：转给 NestedGrid 的 `dragging`，离开的叶不留着缩回去。 */
    dragging?: boolean;
    /** 实时布局预览里的空位：这块什么都不画，露出窗体底。 */
    slotPanel?: string | null;
    /** 画出来的浮动窗：矩形已夹取，拖动中是预览。 */
    floats?: ReadonlyArray<GridFloatInput>;
    /** 切换容器时卡片不动、内容滚过去：和那次提交在同一个同步段里给，token 变了才算新的；缝宽与裁切窗由表面补。默认 null。 */
    swap?: {token: number; leaving: ReadonlyArray<string>; entering: ReadonlyArray<string>; axis: "width" | "height"; direction: 1 | -1} | null;
    /** 禁用边界手势；默认 false。 */
    disabled?: boolean;
};

type Emits = {
    /** 网格根（铺满本组件）的布局尺寸，由 `NestedGrid` 量、经 `useGridHost` 转出；同步发，还没量出来时是 null。 */
    (event: "extent", extent: GridExtent | null): void;
    /** 主题的 `--shell-gap`，换主题时重发：活动栏的叶宽要算上它。 */
    (event: "card-gap", gap: number): void;
    /** 布局发布了：这一刻的呈现尺寸（结构操作前写回意图用）。 */
    (event: "presented", sizes: Readonly<Record<string, GridExtent>>): void;
    /** 手势的预览尺寸；手势结束或预览撤回时是 null。 */
    (event: "preview", sizes: Readonly<Record<string, GridExtent>> | null): void;
    /** 手势落账。`collapsed` 只含这次手势改了收起状态的面板。 */
    (event: "gesture-commit", before: Readonly<Record<string, GridExtent>>, after: Readonly<Record<string, GridExtent>>, collapsed: Readonly<Record<string, boolean>>): void;
    /** 网格两路诊断的并集（`ui/nested-grid` 输出 139、140）：带 `ok` 的是被拒的提交。只发新出现的。外壳把它交给 `reportGridIssues`，记进窗口的诊断（事件 `workbench.grid`）。 */
    (event: "issues", issues: readonly (GridIssue<GridIssueCode | GridHostIssueCode> | GridFailure)[]): void;
    (event: "content-parked", key: string): void;
    /** 焦点现在在哪块面板；离开所有面板时是 null。 */
    (event: "focus-panel", panel: string | null): void;
    /** 指针按在浮动窗上、焦点进了它：宿主把它提到最前（改叠放次序）。已在最前不发。 */
    (event: "raise-float", panel: string): void;
};

type Slots = {
    /** 活动栏；条隐藏时不渲染。 */
    activitybar?(): unknown;
    statusbar?(): unknown;
    /** 面板的头：工具面板放 `WorkbenchPanelHead`，编辑组放编辑器给的头（可以什么都不放，内容占满）。 */
    head?(props: {panelId: string; idPrefix: string}): unknown;
    /** 打开着的空区域：区域的锚只在区域里一个分节都没有时进呈现树（ADR 0050），这时卡片里画它，不画头。 */
    "empty-region"?(props: {panelId: string}): unknown;
    /** 右栏、底部面板卡片顶上的入口条：`merged` 是此刻画在这一行里的那一节（它的头在这里），没有时是 null。 */
    strip?(props: {region: PanelName; merged: string | null; idPrefix: string}): unknown;
    /** 内容项。工具视图的 `contentKey` 是 `view:<id>`，编辑器标签是 `tab:<id>`，空的编辑组是 `editor:<面板 id>`；挪到别的面板时实例不重建。 */
    content?(props: {contentKey: string; panelId: string; active: boolean}): unknown;
    /** 拿起的内容项上面那一条头。 */
    "lifted-head"?(): unknown;
    /** 盖在分隔线之上、拿起的内容之下，不接指针（实时布局的分区与空位）。 */
    overlay?(): unknown;
    /** 浮动窗的手柄。 */
    "float-chrome"?(props: {id: string; rect: GridRect}): unknown;
    /**
     * 自绘头的浮动窗盖在视图之上的那一条：画在内容里、视图之前，焦点、悬停与 F6 都算这块面板，飞行时跟着内容走。`actionsShown`：指针或焦点在这块窗上
     * （同卡片的 `data-hover-actions-active`）；`idPrefix` 同 `head`。
     */
    "own-head"?(props: {panelId: string; idPrefix: string; actionsShown: boolean}): unknown;
};

type Expose = {
    /** 进行中的过渡直接到终点（拖动拿起后要量矩形）。 */
    settleMotion(): void;
    /** 写拿起的内容项的矩形（相对网格根）：跟手，不走渲染。 */
    placeLifted(rect: GridRect): void;
    /** 网格根的左上角（视口坐标）：实时布局的卡片与空位相对它。 */
    origin(): {x: number; y: number};
    /** 网格上的布局过渡时长；减少动效时是 0，实时布局不走。 */
    motionMs(): number;
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

一列分节全部收成标题行时（投影的 `fillers`，最后一节垫底、外框拉到了底，[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 11）：这一列的分隔线经 `NestedGrid` 的 `sashDisabled` 不能拖；垫底的那一节内容项不活动（不显示、不可交互）；收起的分节卡片上不写悬停范围（头自己写），指针停在垫底的空白里不显示它的按钮。

切换容器滚动的那几百毫秒里（`swap`），换上来的分节外框在半路、已经可以交互。这时起拖（实时布局、落点指示、键盘拿起都一样），拖动会话先把过渡送到终点（`settleMotion`），量到的是终点的几何；代价是进行中的滚动直接跳到终点。

## 入口条与并成一行

右栏、底部面板顶上的入口条（投影的 `strips`，[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md) 输出 47）是呈现树里的一片叶，不在文档里：它的角色算工具面板、卡片组算它的区域，所以和下面的分节拼成一张卡片；叶里画宿主的 `strip` 插槽。

“画成并成一行”在表面里只有一处决定（`mergedIn`），正文的上边、分节的叶里画不画头、入口条里接不接头、悬停与焦点的面板都读它：投影的 `merged`；正在离开的叶照最后一次呈现的样子（滑出去的那一节不冒出自己的头）；那一节最大化着时在自己的叶里画头，还原时等网格没有过渡（`moving` 为假）才搬回入口条（输出 13）。
