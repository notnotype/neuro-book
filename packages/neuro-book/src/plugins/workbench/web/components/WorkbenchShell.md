---
标签: [state:local, state:inject, state:shared-read, state:shared-write, io:mutate, env:global, env:portal]
别名: ["工作台外壳", "Workbench"]
---

# WorkbenchShell

产品的工作台外壳（[`ui/workbench-layout.md`](../../../../../../../docs/specs/ui/workbench-layout.md)）：把一棵树的布局 store 接到 [`WorkbenchSurface`](WorkbenchSurface.md)，放标题栏、活动栏、面板头、状态栏与视图内容，把按钮接到命令，把拖放接到 `layout-drag.ts`。Lab 用 [`WorkbenchSurface`](WorkbenchSurface.md) 的场景演示几何与手势，这个组件要真实的 store、命令与视图注册表，只在产品页验证（`e2e/workbench-shell.e2e.ts`、`workbench-views.e2e.ts`、`workbench-dnd.e2e.ts`）。

## 布局

外壳根占满页面（父级给它确定的宽高），底色是主题的 `--shell-ground`（卡片主题里是窗体底；平铺的主题没有这个变量，用面板底色），字体 `--font-ui`。

- 标题栏：固定 36px，在树之外（[`WorkbenchTitleBar`](WorkbenchTitleBar.md)）。
- 活动栏：[`WorkbenchToolStrip`](WorkbenchToolStrip.md)，上段一项一个侧栏里的视图容器（`regionEntries`；Spec 输出 22、41），底段是 `chrome` 给的全局项。
- 右轨：同一个 [`WorkbenchToolStrip`](WorkbenchToolStrip.md)（`region="auxiliarybar"`），画在表面的 `rail` 插槽里（Spec 输出 50）。一项一个右栏里的视图容器，没有底段；入口的点击、右键与活动栏同一套（`selectRegionEntry`、`openContainerMenu`）。
- 视图段（`workbench/views.md` 输出 21）：外壳把“哪个视图声明了视图段”交给 store（`acceptRailBounds`：注册表的 `railOf`，渲染出错的实例给 null），store 的 `state.rail` 算出此刻借给谁、生效的展开与宽。右轨交来 `main`、`foot` 后，一个 `watchEffect` 按已提交的文档把位置与展开状态分给借着的那个实例的 `ViewRailControl`，别的实例都是 `none`；当前容器没有视图段时先收回再拆元素。视图的 `request` 只对借着的那个视图转给 `requestRailExpanded`，别的是 `revoked`。展开按钮、轨宽手柄的预览与落账分别调 `requestRailExpanded`、`previewRailWidth`、`commitRailWidth`。
- 底部面板的入口条：[`WorkbenchRegionStrip`](WorkbenchRegionStrip.md)，画在表面的 `strip` 插槽里（Spec 输出 47）。当前容器只有一节时，那一节的头放进它的默认插槽，和分节自己的叶里的头是同一组属性与事件（`toolHeadProps`、`toolHeadEvents`），以面板为 `key`。并进来的头没有展开标记（`foldOf` 排除此刻投影里并进来的）；视图接管标题区时，头那一段的布局宽度小于 `VIEW_HEAD_MIN_PX` 就不接管（`views.md` 输出 19）。
- 工具面板：[`WorkbenchPanelHead`](WorkbenchPanelHead.md) 加视图内容（[`WorkbenchViewFrame`](WorkbenchViewFrame.md)）。视图动作由共享组件 [`TitleActions`](../../../../ui/menus/TitleActions.md) 画在面板头，按面板宽度算放几个按钮，其余收进“⋯”：一个截断的标签、其余只留图标的宽度总要留给标签带。
- 视图的标题区（[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 19）：只写标题的面板里，活动视图申请了标题区、实例就绪时，面板头改成三列，交来的位置按面板记下，再分给此刻在这块面板里的那个实例；视图换面板时旧面板头拆掉与新面板头画出的先后不定，按面板记就与先后无关。点标题时先记下面板收没收：收着只展开，展开着才通知视图；这时展开、收起走头上单独的展开标记（`toggle-fold`）。
- 编辑区：提供者（`editorArea`，Spec 的“贡献点”里 `workbench.editor-area` 的形状）交三个组件，外壳这样挂：`head` 是每块编辑组的头（`panel-id`、`dragging-tab`、`frame-actions`）；`group` 是每个内容项一个（`panel-id`、`tab-id`、`context`，空的编辑组 `tab-id` 为 null；别的面板最大化盖住它时 `context.visible` 为假）；`host` 在外壳根上挂一次，交出标签的拖动（`attach-tab-drag`）。提供者换了才重挂。没有提供者时编辑组里是欢迎文字，那块面板有标签时写不可用的原因。
- 状态栏：[`WorkbenchStatusBar`](WorkbenchStatusBar.md)。

## 交互

- 拖动边界的结果（手势开始时与落账之后的尺寸、收起变化）交给 store 的 `commitGesture`，布局发布的尺寸交给 `acceptPresented`（结构操作之前写回意图与可见标签的计算用它）；记录读完之前边界不能拖。
- 视图自绘头（[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 19 的“自绘头”）：`ownHeadBands` 按已提交的文档算，在浮动窗里、只写标题、活动视图声明了 `VIEW_OWN_HEAD` 且实例就绪（`ownHeadOf`）的面板。这些面板的头画在表面的 `own-head` 插槽里（内容里、视图之前，压在视图之上；画在窗口零件层的话不算这块面板，焦点、F6 与当前面板都落空），同一组 `toolHeadProps` 加 `ownHead`；交来的右端宽度按面板记，经表面的 `ownHeads` 写到内容上。`headOfPanel` 在这些面板上是 null（不接管标题区、不转按下），分发时 `setOwnHead` 告诉实例。视图标出的拖动区（`data-window-drag`）拖整个窗由 `layout-drag.ts` 的 `fromElement` 认；拖动区空白处的右键在外壳根上开“移动到”（`onOwnHeadContextMenu`，冒泡阶段、视图没处理的、按下的元素不直接写字也不是图片）。
- 面板头的框架按钮执行命令（浮动、`toggle-panel-maximized`）；面板头上没有隐藏按钮，区域的显隐在活动栏入口、状态栏与命令上，可用与原因取命令系统的可用性。
- 收起不是框架按钮，是标题行（Spec 输出 20）：只写标题、上下排、没有被最大化的面板给头 `fold`（带容器的区域里底部面板的分节与区域此刻唯一显示的分节没有，`sectionCollapseBlock`；收没收问 `isSectionCollapsed`；都按已提交的文档算）。点标题在 `activateTab` 一处决定：展开着、视图没接管标题区、点的是当前标签时执行 `set-panel-collapsed` 收起，否则照旧激活（收着的会展开）；接管标题区时单独的展开标记发 `toggle-fold`。分节标题与浮动窗视图标签的右键或菜单键开“移动到”（Spec 输出 23）：别的容器（写容器的标题，与活动栏同一个结果）、三个区域的“新容器”、浮动、“重置位置”；目标表与命令面板同一份（`moveTargetsOf`），各项经 `nbook.view.move-view` 执行。视图、它所在的面板与容器、交付状态或代际一变菜单就关。
- 头在入口条与分节的叶之间搬家（并、分、最大化、还原、换了并进来的那一节）时，焦点进头时记下的元素（标题、框架按钮的命令、接管标题区的展开标记）交给同一块面板新头里的同一个元素，只在焦点已经丢了的时候（Spec 输出 13）。
- 入口条的入口按 `regionEntryIntent`，同活动栏，隐藏区域执行 `set-part-hidden`（Spec 输出 47）。底部面板的入口写只含一个视图的容器的计数（`views.badge`，`views.md` 输出 17），右轨与活动栏的图标入口写容器里各视图计数的合计（图标入口没有分节头，几个视图的数只能合在入口上）；视图交还标题区（`ViewHead.claim` 为 false）时 `headOfPanel` 当它没接管，点标题、分发位置、面板头画法一起回到普通画法；并成一行时那一节的头不写标题（`titleInEntry`），按下的入口就当它的标题：右键与菜单键开这个视图的“移动到”，末尾接上容器的“移到”另外两个区域（`openStripMenu`；视图不让移动时开容器的菜单，选了容器的“移到”时焦点按容器的规则去新区域里的入口），焦点要落到它的标题时落到这个入口（`titleIn`）。
- 点活动栏或入口条的入口切换容器时，区域显示着、里面没有最大化的分节，就在同一次提交之前给表面一次交换（`swap`，Spec 输出 42）：离开、换上来的是两个容器在文档里的分节，侧栏、右栏竖着滚（入口竖排在侧轨上，`entriesOnRail`），底部面板横着滚，方向按入口顺序。表面同时只接一个交换，`token` 在三个区域之间递增；入口的 `slideToken` 是这个区域滚过几次，选中标记只在自己的区域滚的那一次滑。
- 活动栏的入口按 `regionEntryIntent`（Spec 输出 22）：不是当前容器就切到它（store 的 `showContainer`，侧栏隐藏或拖到零时同时展开）；是当前容器时，侧栏可见就隐藏侧栏，不可见就展开。按下态是“当前容器且侧栏可见”（`regionVisible`），至多一项。入口的右键或菜单键开容器的菜单（Spec 输出 44）：先是“移到”另外两个区域（`containerMoveTargets`），再是“重置”（搬回声明的区域；容器已经在声明的区域、或是用户拖出来的容器时没有这一项），“移到”调 store 的 `moveContainer`，“重置”调 `resetContainer`（同时清掉这个容器的侧轨意图，Spec 输出 50）。有成员的容器总有菜单。
- 状态栏的面板按钮执行 `set-part-hidden`；重试、放弃转给 store。
- 焦点所在的面板看不见了（内容被停放，或整块面板不显示了：切走容器、隐藏区域、搬走）而焦点因此丢了：按 `focusLandings` 的先后找第一个看得见的落点，同一面板头上的标签、切走容器时新容器的第一个分节、侧轨（活动栏、右轨）或底部面板入口条里它那个容器的入口，都没有时外壳根（Spec 输出 16、42）。焦点没丢（比如还在刚按的活动栏入口上）或在外壳之外时不动。
- F6 由 `attachPaneFocus` 接到命令，调表面的 `moveFocus`。
- 拖放的来源是视图标签、分节的标题、活动栏与入口条里的入口（只含一个视图的拖的是那个视图，含几个视图的拖的是容器）与编辑器标签，规则见 `layout-drag.ts` 与 Spec 的“拖动”；入口条上的落点同活动栏，并入的高亮与被拖入口的占位由外壳传给入口条（Spec 输出 45、46）。树里整块面板不能拖；浮动窗能整窗拖，头的空白处或它唯一的标签（Spec 输出 39）。外壳根登记 `WORKBENCH_FILE_DROP`：资源树的文件出树后问这里，判定与反馈同一份，提交归编辑器。实时布局的预览（Spec 输出 38）：长出新块时那一块是空位，不画头；并入时目标不动，盖一层 `--layout-merge-*`，别人的标签条上再加一条插入线。

## 数据

```ts
type Props = {
    /** 外壳挂上时交出移动焦点的实现，返回撤销。 */
    attachPaneFocus?: (move: PaneFocusMover) => () => void;
    /** 布局文档的 store；受控，必填。 */
    layout: LayoutDocStore;
    /** 命令服务；必填。 */
    commands: CommandService;
    /** 视图的交付与加载；必填。 */
    views: ViewSource;
    /** 编辑器槽的提供者；不给时是欢迎文字。 */
    editorArea?: EditorAreaSource;
    /** 标题栏与活动栏的条目、视图动作；不给时标题栏只有品牌与项目名。 */
    chrome?: ShellChrome;
    /** 作品的显示名；必填，没有项目为 null。 */
    project: string | null;
    /** 通知中心里没看过的条数（状态栏铃铛的点）；没有通知服务时不给。 */
    unreadNotifications?: number;
    /** 拖动时画不画落点分区（设置 `nbook.workbench/dropSectors`）；缺省画。 */
    dropSectors?: boolean;
    /** 拖动的手感（设置 `nbook.workbench/dragFeel`）；缺省实时布局。 */
    dragFeel?: "live" | "indicator";
    /** 卡片什么时候缩小（设置 `nbook.workbench/dragCardShrink`）；缺省离开标签条就缩。 */
    dragCardShrink?: "strip" | "panel";
    /** 卡片的尺寸多久写一次（设置 `nbook.workbench/dragCardRefresh`）；缺省跟随屏幕每帧写。 */
    dragCardRefresh?: LiveCardRefresh;
    /** 拖到四周时怎么分（设置 `nbook.workbench/dropSplit`）；缺省只分本窗口。 */
    dropSplit?: DropSplit;
    /** 网格的诊断与被拒的提交（`grid-diagnostics.ts`，记成事件 `workbench.grid`）；必填，插件入口交 `recordGridIssues`。 */
    reportGridIssues: (issues: readonly WorkbenchGridIssue[]) => void;
};
```

没有 emits、slots、expose；attrs 落在根元素上。

## 状态

记录没读完：按默认树显示，手势与依赖就绪的命令不可用。读不了或存不下：状态栏给出原因与重试、放弃，显示不受影响。放不下：呈现降级写在外壳根的 `data-layout-diagnostics`，不写文档。

## 不支持

手机上的另一套呈现、操作系统级的独立窗口都不在这里：窄屏只保证不溢出、够得着（见 `WorkbenchSurface`），浮动窗是应用内的。

## 隐藏通道理由

`state:shared-read`、`state:shared-write` 是它的本职：它就是 store 与界面之间的接线。`state:inject` 取翻译端口。`io:mutate` 经命令服务。`env:global` 是拖放会话与表面对文档根的监听，`env:portal` 是拖动反馈与菜单传送到 body。
