# t28 计划：右栏与底部面板的入口条与切换容器

第 4 稿（2026-11-17）：按第三轮设计审查（[`evidences/design-review-r3.txt`](evidences/design-review-r3.txt)，7 条，都在第 3 片）改，并去掉“交换中别的布局变化先收尾”那条规则（和已有的合同用例冲突，见下）。第 3 稿按第二轮（[`evidences/design-review-r2.txt`](evidences/design-review-r2.txt)，12 条）改；第 2 稿按第一轮（[`evidences/design-review.txt`](evidences/design-review.txt)，14 条）改，逐条的处理在 Task README。第 1 稿从 t27 拆出来；t27 计划第 3 稿里入口条的部分（提交 `c56ab99a7` 的 `tasks/t27-region-entry-strips/plan.md`）与 t27 第二轮设计审查（[`design-review-r2.txt`](../t27-region-entry-strips/evidences/design-review-r2.txt)）转过来的几条是起点。

## Context

开发者 2026-11-16 试用 t25 后说：“底部的面板应该也是类似 ActivityBar 的那种容器（类似 vscode），切换应该是左右滚动切换。右栏也应该是和 ActivityBar 一样能切换容器的”。评审页 [`container-switch`](../t27-region-entry-strips/artifacts/container-switch/index.html) 定下的，编号同 [t27 README](../t27-region-entry-strips/README.md)：

- 1. `switch-1` 甲：切换时整个容器滚过去，470ms 布局曲线；滚到一半又点从这一刻接着滚。
- 2. `indicator-1`：选中标记和内容同时滑过去（右栏图标的按下底色、底部面板标题的下划线）。
- 6. 底部面板的一个标签（容器）下面可以有几节，左右并排。
- 8. `card-3`：右栏、底部面板一个容器一张卡片，卡片里几节之间是开放式分割线（t27 第 1 片已做）。
- 9. `strip-3` 甲：入口条是卡片顶上一行，切换时不动；当前容器只有一节时那一节的标题和动作并进这一行，不多占高度。
- 第 3 版“直接做”：底部面板、右栏的卡片与顶上一行不动，里面的内容左右滚；方向跟着入口条（点右边的往左走）；点当前容器的入口是隐藏区域；区域隐藏或拖到零时点别的入口按显示长出来、不滚；减少动态效果直接换。
- 待确认清单 2026-11-16：右栏、底部面板只要显示着分节就有入口条，只有一个容器时也有。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 6、11、13、17、20、25、36、42、44 到 47；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的“交换”与呈现；[ADR 0046](../../../../../docs/adr/0046-workbench-view-containers.md)（“入口条怎么进几何”留给第二步）；[一棵树的提案](../../../../../docs/proposals/workbench-single-tree-layout.md)（accepted：除标题栏外工作台是一棵树）。

已做（开发者 2026-11-17 改判 t27 的侧栏切换后，提交 `b88d9c708`、合入 `a670baa38`）：nb-layout 的静止的底（`swap-backdrop`）、带记下两组外框的外接矩形；侧栏切换时卡片不动、内容在卡片里滚。本计划里右栏、底部面板的切换照用。

和 [t29](../t29-panel-head-redesign/README.md) 的关系：并成一行的头就是工具面板的面板头，t29 正在重新设计它（展开标记、按钮悬停才出、点标题行做什么），第 3 片排在 t29 定稿之后，照定下的头画。

约束：nb-layout 要做成通用库（t26）。这次往 nb-layout 里加的都由宿主驱动：投影选项 `regionStrip`、交换的插槽 `swap-backdrop`、交换的两条通用规则（同时只有一个交换；交换中来了别的布局变化先送到终点）。

不改上游（第一轮第 13 条）：把右栏、底部面板做成一片叶、里面嵌一个内层网格，会让头、入口条与正文同在一片叶里，省掉入口条叶与头跨叶的大部分工作。一棵树的提案（accepted）写的理由是“布局分成几棵树，移动就要跨树”“递归 DOM 限制了拖动手感”；分节之间的手势、拖放、实时布局都要穿两层网格、t27 的“几片叶拼一张卡片”要回头改，是本计划的推断。按已接受的提案留在一棵树里；本计划为此要付的代价（表面、卡片、拖动几何、焦点、悬停、最大化、`panelOf`、`geometryOf` 逐个按“叶代表哪块面板”改）一并记进待确认清单。`swap-backdrop` 是 t27 第二轮第 11 条“卡片层”的特例，t26 若采纳卡片层就删掉它。

## 技术选型

无。

## 关键设计

### 呈现树里的入口条叶与“并成一行”：`packages/nb-layout/src/layout-project.ts`、`layout-doc.ts`

- 投影选项 `regionStrip?: (region: PanelName) => {readonly height: number; readonly mergeSole: boolean} | null`：带入口条的区域顶上一行的高度，以及当前容器只有一节时那一节是否并进这一行。区域在呈现里至少有一节时（不是空区域的锚自己），区域节点呈现成纵向分支 `[入口条叶, 内层]`，id 是文档里区域节点的 id（`regionAnchors` 照旧登记它，拖到零、隐藏按拖到零画都在它上面，入口条跟着整个区域缩到零）；内层是原来呈现出来的节点：一节时是那一节的叶，几节时是原来的分支、id 改成 `<区域节点 id>:sections`。入口条叶 id `regionStripLeafId(region)`（`strip:<区域>`），`ref` 用新前缀 `strip:`，`regionOfStripRef`、`regionOfStripLeaf` 反解，三样都从包入口导出（t27 第二轮第 12 条）。入口条叶高度固定（`sizing: "fixed"`），和内层之间的缝宽 0、不可拖；区域外沿的缝照旧 1px、可拖。
- “并成一行”是投影的结果，不由宿主另算（第一轮第 2、6 条）：投影输出加 `strips: ReadonlyArray<{region, leaf, merged: string | null}>`。`merged` 按被投影的那份文档的结构判：`mergeSole` 为真、区域当前容器在文档里恰有一个分节（按容器归属数，不看区域隐藏、拖到零与放不下收走），而且这一节呈现着。所以：隐藏、拖到零的那 470ms 里不翻转；放不下收得只剩一节的几节容器不并；拖动的预览拿预览文档投影，预览里摘掉来源后剩一节的就是并的，和放下的结果一致。表面、`layoutContents`、拖动的几何都读这一份，没有第二处判断。
- 并成一行的那一节，投影把它的最小与最大高度都减去入口条高度（它的头在入口条里，叶里没有头；第二轮第 9 条）：区域的最小、最大高度和今天只有一节时相同（最小 80，或视图声明的更大值），输出 6 不变；几节时每节照旧，区域多出入口条那一行（底部面板 112，右栏 32 加各节）。宿主的 `constraints` 闭包不知道“并”，不用改。
- 包装了的区域节点不再登记 `collapsedTo`（它的 id 就是包装分支，没有塌陷；第二轮第 11 条）；补用例断言它不在里面。
- `assignByParent`：入口条叶不改 `sizing`（循环里跳过）；和入口条叶同在包装分支里的那一节叶不配收起策略（输出 11；t27 第二轮第 14 条）。
- `minimumOf`、`rebaseIntents` 不用改：包装分支纵向，最小高度是入口条加内层；区域节点取到的是包装分支的尺寸（含入口条），入口条叶与 `:sections` 分支不在文档里、不写。补用例守住，含区域里有不显示的兄弟分节（`away` 缩放路径）。
- `regionAnchors` 的说明改成“有入口条的区域一节时是包装分支，不再塌陷成分节的叶”；`collapsedTo` 不变。

### 交换的两条通用规则与静止的底：`packages/nb-layout/src/grid-swap.ts`、`vue/useGridMotion.ts`、`vue/NestedGrid.vue`

- 同时只有一个交换（第一轮第 3 条）：新的交换和进行中的带不相交（离开、换上来的叶都不在带的组里，按叶 id 判）时，先收尾再规划；相交的照旧是重定向，从此刻接着滚（t27 的“滚到一半点回来”是相交）。
- 交换中来了一次不带交换的布局变化：不收尾，照已有的合同（`useGridMotion.dom.test.ts` 的“交换进行中来了一次不是交换的布局变化：滑出去的那组接着留着、终点不变，带不换”）。第一轮第 12 条说的“别的区域显隐时裁切窗与静止的底停在开始时的位置”记为已知限制：只在交换的 470ms 里又显隐别的区域时出现，滚完就对上；为它改这条合同不值得。
- “先收尾”是 `decideMotion` 返回的一个标记（第二轮第 6 条），纯函数里判：带标记时这一轮按空带重新规划（`band: null`、`now: []`、`busy` 为空，第三轮第 5 条），上一轮留着滑出去的项不带进这一轮；单元测试测不相交（返回的带只含这一次的两组、轴取新交换的）、点回来（不带标记）两类。`update()` 照标记先 `stop()` 再开这一轮。
- `NestedGrid` 暴露 `moving`（这一刻有没有过渡在走，第三轮第 2 条）：表面要在过渡结束后再换画法时按它判，判“为假”这个状态、不判由真变假（减少动态效果时它一直为假）。Spec 与 `NestedGrid.md` 同步。收尾和 `settleMotion` 一样，是整个网格进行中的过渡一起到终点（第二轮第 5 条：别处正在长出来、缩回去的也一起），已知限制照实写。
- `swap-backdrop` 插槽：交换进行时在窗口矩形上画一层宿主给的东西，在外框下面，交换结束摘掉；窗口等于静止时的外观，结束那一帧外框换回自己画卡片与摘掉底在同一次渲染里。

### 尺寸与入口：`web/state/layout-constraints.ts`、`web/state/layout-present.ts`

- `layoutProjectionOptions` 给 `regionStrip`：右栏、底部面板 `{height: PANEL_HEAD_HEIGHT, mergeSole: true}`，侧栏 null（侧栏的入口在活动栏）。
- `layoutContents`：并成一行的那一节内容的上边是 0（头在入口条里），自己画头时上边照旧 32；`hasRoom` 对它按“高度大于 0”判。“画成并成一行”由表面给（见下一节），不直接读投影。
- 入口与意图推广到三个区域：`regionEntries(doc, region, catalog, containers)`（结构同 `containerEntries`）、`regionEntryIntent(doc, region, container, facts)`（不是当前容器就切换、是当前容器且区域可见就隐藏）；活动栏照旧用侧栏的。
- 焦点落点（第一轮第 11 条）：`focusLandings` 的 `entry` 推广到三个区域（入口菜单关闭、容器被搬走后焦点回到那个区域的入口）。

### 表面：`web/components/WorkbenchSurface.vue`

- 入口条叶在叶插槽里画新插槽 `strip`（`{region, merged}`）；并成一行的那一节自己不画头。
- 画成并成一行（第二轮第 1、4 条，第三轮第 1、2、4 条）：投影的 `merged`，但正在离开的叶照它最后一次呈现的样子：`lastPresented` 加记 `merged`，入口条叶也记最后一次的入口与并进来的那一节（区域最后一节离开、入口条缩回去时条里照旧有东西）；`layoutContents` 收一个按叶覆盖上边的参数。所以滑出去的那一节不冒出自己的头、内容不下跳。最大化方向在提交的那一刻就换：那一节的叶画自己的头，入口条叶这期间不带 `merged`（同一块面板不出现两个头）；还原方向等过渡结束（`moving` 为假）才把头搬回入口条，所以还原过渡中整窗的卡片一直有头。别的区域同时在过渡时搬回会跟着推迟，已知限制。补逐帧用例：离开的那一节在滑出的 470ms 里没有头、内容不下跳；区域最后一节离开时入口条缩回去的过程中入口还在；还原过渡中整窗的卡片一直有头；减少动态效果时还原立即搬回。
- 头换了地方时焦点跟过去（第二轮第 4、10 条，第三轮第 1 条）：在会让头搬家的那次提交之前（`state.maximized`、文档的 `flush: "pre"` watcher，此刻旧头还在、没被 `inert`）读 `document.activeElement`，在某块面板的头里就记下“哪块面板、哪个元素”（标题或 `data-panel-action` 的命令）；同一块面板的新头挂上时把焦点交给同一个元素，没有新头就照现有的焦点规则。并、分、最大化、还原、预览里翻转都走这一条。验收加 e2e：键盘在入口条里按最大化，焦点在叶里的还原按钮上；再按还原，焦点回到入口条里的最大化按钮。视图自己的状态（例如对话的会话列表开着没有）在视图里，跟着 `head-slots` 走，不丢。
- 入口条叶与下面之间那条 0 宽的缝不画线（第二轮第 7 条）：宽度为 0 的缝本来就不画线（`SashHandle` 的 `seamOnly`，第三轮第 6 条更正），只在验收里读这条缝的像素，确认没有线、`panes` 的底也没露出来。
- 卡片：入口条叶和分节同组（`groupOf` 先认入口条叶），拼成一张卡片，沿用 t27 第 1 片的规则。
- 一片叶代表哪块面板（第一轮第 1、8 条，t27 第二轮第 2 条）：`panelOf(leaf)` 对入口条叶返回 `merged`（没有并时是 null，和活动栏一样）；焦点在入口条里时当前面板是那一节、标签与动作的命令照常；悬停动作的范围按面板比，入口条的卡片也带 `data-hover-actions-scope`。拖动几何里并成一行的那一节的外框是入口条叶与它的叶的并集（`geometryOf` 的 `frame`），标题行按面板 id 在整个表面里找头。
- 最大化（t27 第二轮第 1 条、第一轮第 9 条）：最大化并成一行的那一节时它自己画头（含还原按钮），入口条叶和别的叶一样被盖住，还原过渡结束后回到并成一行。另一条路（入口条不算被盖住）不可行：`maximizePlacement` 让不盖住的叶保持原矩形，入口条会以原来的宽度浮在整窗的面板上。焦点按上面“头换了地方时焦点跟过去”；最大化时内容的上边在过渡开始时让出 32px，不随过渡渐变（待确认清单）。

### 入口条：新组件 `web/components/WorkbenchRegionStrip.vue`（同名 `.md`、Lab 场景）、`WorkbenchShell.vue`、`WorkbenchPanelHead.vue`

- 横着排：右栏是容器图标（按下底色），底部面板是容器标题（下划线）；当前容器的入口总在外面，放不下时排在后面的收进“更多”（复用 `layoutStrip`）。
- 这一行放不下时的让位（第二轮第 3 条，第三轮第 3 条）：先截断标题，再把入口收进“更多”（当前容器的入口总在外面），再把视图动作收进“⋯”，框架按钮最后。视图接管标题区时两侧列是视图送进来的、收不进“⋯”：头那一段窄于一个阈值（由第 3 片按接管的两侧列实际宽度定）时 `head-slots` 给 null，走已有的“头回到视图内容里”（`views.md` 输出 19）。160px（右栏最窄）的验收写成 Lab 场景加 e2e：真实宽度下每个控件的矩形都在条里，`elementFromPoint` 够得着。
- 并成一行时入口之后接那一节的头，占这一行剩下的宽度：右栏接标题、视图动作、框架按钮；底部面板的入口本身就是标题，只接视图动作与框架按钮（待确认清单）。头用 `WorkbenchPanelHead` 的同一套（元素照旧带那一节的 `data-panel-head`、按面板 id 发 `head-slots`），加一个“嵌在入口条里”的写法：不画自己的底与高度；底部面板不画看得见的标题，但留着隐藏的标题元素（`panelTitleDomId`，内容区的 `region` 名称从它来）。
- 视图接管标题区（第一轮第 1 条，`views.md` 输出 19，默认右栏的对话就是这样）：并成一行时接管照常，三列排在入口之后剩下的宽度里，居中按这段宽度算；头在入口条与自己的叶之间换（并、分、最大化）时 `head-slots` 先 null 再给新的，视图的内容跟过去。
- 底部面板并成一行时（第一轮第 7 条；第 5 片才做，第二轮第 2 条：之前它照旧写标题，标题照旧是拖动源，入口成为拖动源的那一片再拿掉）：计数写在那个容器的入口上（只含一个视图的容器，同那个视图的标签；输出 17），活动栏的入口照旧不写；焦点落到“标题”的地方（`recoverFocus` 找 `[data-panel-tab]`）找不到标签时落到入口；拖这一节就是拖入口（`data-tool-view`）。
- 交互同活动栏：点入口发 `select`（宿主按 `regionEntryIntent` 切换或隐藏），右键与菜单键发 `context-menu`（输出 44），左右方向键在入口之间走，读屏是一组带 `aria-pressed` 的按钮。F6 停在入口条叶上时焦点回到上次在这一条里的入口，没有就是按下的那个。
- 选中标记：抽出 `WorkbenchToolStrip` 里按下块的逻辑成组合函数 `useEntryIndicator`（按轴量、沿 `offsetParent` 加到条目区、`slideToken`、`data-settled`、只在过渡真结束时摘标记），活动栏与入口条共用；底部面板是一条下划线，右栏是按下底色。宿主按区域给 `slideToken`，只有内容滚过去的那一次滑。
- 交换时头那一段（第一轮第 10 条）：入口条不动，并进来的头在点的那一刻换成新容器的（新容器有几节时这一段空出来，新的头随内容滑进来）；记进待确认清单，逐帧验收里断言这一点。

### 右栏、底部面板切换容器时滚过去：`WorkbenchShell.vue`、`WorkbenchSurface.vue`

- 点入口切换，区域显示着、宽度大于零、里面没有最大化的分节时，提交前给交换（t27 的 `prepareSidebarSwap` 推广成按区域，读已提交的文档）：离开、换上来的是两个容器在文档里显示着的分节（入口条叶前后都在，不在里面），`axis: "width"`，方向按入口顺序。
- 窗口：裁在卡片里入口条以下那块：`window.inset` 是分节外框到卡片的内缩（表面按缝宽算），`radius` 是卡片下面两个角。滑动的外框不画自己的卡片（底、圆角、投影），只带着头与内容滑；静止的卡片由 `swap-backdrop` 画一块卡片底（和卡片同一组变量），入口条叶在上面不动，两者拼成一张不动的卡片。

### 入口条的拖放：`web/layout-drag.ts`、`web/entry-drop.ts`、`web/live-drag.ts`、`web/drag-presentation.ts`

- 条 id 按区域（第一轮第 4 条）：`BAR_STRIP` 换成三条（活动栏、`strip:auxiliarybar`、`strip:panel`），`dropStripOf`、`homeStripOf`、`isHomeStrip` 按区域；`EntryDropAction` 加 `region`；`soleSidebarContainer` 改成按区域；`applyEntryDrop` 三个区域都处理。含几个视图的入口落到另一个区域的入口条上，整个容器搬过去（输出 46）：现有的 `moveContainer` 加 `setContainerEntries` 把它放在落下的空位。
- 入口带从一条推广成一组（t27 第二轮第 8 条）：`DragGeometry.band` 换成 `bands: ReadonlyArray<{region, rect, axis}>`，`FrozenGeometry.bar` 换成按区域的入口矩形；`measureBar` 按 `data-region-strip` 量每条的 `[data-tool-entry]`；`barSpotAt`、`barStopsOf` 加轴，横着的带按 x 判、插入线是竖线；键盘的区域表列出三条带。
- 来源收起后的平移：`collapsed()` 的 `moves` 按呈现树的叶取（入口条叶不在文档里）；`barAfterCollapse` 推广到三个区域。来源拿走后同一容器剩一节、在预览里并成一行时（第一轮第 2 条后半），那一节的标题行按新投影取（入口条叶里入口之后那一段），不平移旧的头。
- 入口条这一行从左到右的落点（第一轮第 8 条）：

  | 指针落在 | 结果 |
  |---|---|
  | 一个入口上 | 并进这个容器，成为最后一个分节（输出 45） |
  | 入口之间、第一个之前、最后一个之后一格内 | 插入线，放下是这个位置的新容器（输出 45） |
  | 入口之后的空白（没有并成一行时） | 新容器，排在最后 |
  | 并进来的头（标题、动作、框架按钮整段） | 那一节的标题行（输出 25 第 7 行）：右栏是上面多一个分节；底部面板按那一节正文的竖线分左右，头只占入口右边一段，竖线左边的部分按左半算 |

  入口上与入口之间是输出 25 第 2 行（入口条）。只含一个视图的入口落到另一个区域的入口之间（第二轮第 8 条）：视图是它容器唯一的成员时整个容器搬过去、id 不变（同 t25 拖进空区域的规则），否则新建只含它的用户容器；搬容器只在放下时提交（`moveContainerTo` 连带显示与切换），预览照活动栏的样子（入口让位，零写入）。

## Spec 与文档改动

条目级 planned，各片动手前写：

- `docs/specs/ui/workbench-layout.md`：输出 6（入口条与最小、最大高度：并成一行时区域同只有一节时，几节时多一行入口条）、输出 25 第 2、7 行（入口条这一行的落点表、跨区域的单视图入口）、输出 11（入口条下面唯一的分节不收成标题行）、输出 13（最大化并成一行的那一节时它自己画头、还原过渡结束才回到入口条、焦点交给新头的同一个元素）、输出 17（底部面板入口条的入口写计数）、输出 20（头的高度、并成一行、接管标题区排在剩下的宽度里、底部面板留隐藏的标题元素）、输出 36（焦点在入口条里时当前面板是并进来的那一节）、输出 42（右栏、底部面板切换的样子；几个区域前后脚切换、交换中别的区域显隐时进行中的过渡一起送到终点；头那一段在点的那一刻换，离开的那一节滑出时没有头）、输出 44 到 46（入口条上的菜单与拖放，跨区域搬容器）、输出 47（入口条的位置、何时有、内容、交互、放不下时的让位）；验收场景补右栏、底部面板的切换、并成一行加视图接管、拖放。
- `docs/specs/workbench/views.md` 输出 19：并成一行时接管标题区的位置。
- `docs/specs/ui/nested-grid.md`：交换的 `swap-backdrop`、同时只有一个交换、交换中来了别的布局变化。
- `docs/specs/ui/workbench-layout.md` 的术语“呈现树”：右栏、底部面板有分节时多一片入口条叶，只在呈现里、不进文档。投影的写法在 `layout-project.ts` 的模块头与导出函数的注释里，不另立 Spec。
- 组件说明：`NestedGrid.md`、`WorkbenchSurface.md`、`WorkbenchShell.md`、`WorkbenchPanelHead.md`、`WorkbenchToolStrip.md`、新组件的 `.md`。

## 切片

1. **nb-layout：入口条叶与并成一行**。投影选项、`strips`、并成一行的最小与最大高度、`collapsedTo`、导出的 id 函数、`assignByParent`、说明。验证：`layout-project.test.ts`（有分节时包装分支的形状与 id；一节、几节；空区域没有入口条；拖到零、隐藏、放不下收走时一起没、`merged` 不翻转；预览文档摘掉一节后 `merged` 是剩下那一节；并成一行时区域最小、最大高度同只有一节、几节时多一行；包装了的区域节点不在 `collapsedTo` 里；`rebaseIntents` 写回的区域尺寸不变，含不显示的兄弟分节；唯一的分节没有收起策略）、nb-layout 全部测试与类型检查。
2. **nb-layout：交换的两条规则**（和第 1 片分开提交）。`decideMotion` 的“先收尾”标记。`NestedGrid` 暴露 `moving`。验证：`useGridMotion.dom.test.ts`（不相交的新交换、点回来两类）、`NestedGrid.dom.test.ts`（`moving` 在过渡中为真、结束为假、减少动效时一直为假）；e2e `lab-grid-swap` 加“滚到一半点另一列”（Lab 场景加一列）。
3. **工作台画出入口条与并成一行**（t29 定稿之后）：`regionStrip`、`layoutContents`/`hasRoom`、入口与意图、`focusLandings`、表面的插槽、“叶代表哪块面板”、画成并成一行（离开与最大化过渡里沿用）、头换地方时焦点跟过去、`WorkbenchRegionStrip`、`useEntryIndicator`、让位顺序。底部面板并成一行时照旧写标题。验证：`layout-present.test.ts`、`adjacency.test.ts`、新组件与 `WorkbenchPanelHead` 的 DOM 测试（并成一行加接管时 `slots` 不为 null；160px；头换地方焦点跟过去）、Lab 场景；e2e 跑引用右栏、底部面板头的全部文件（`workbench-views`、`workbench-shell`、`workbench-containers`、`workbench-live-drag`、`workbench-dnd`、`workbench-float`、`workbench-drag-cost`、`background-tasks`、`agent-conversation`、`lab-workbench-surface`，超过 8 个，写 `NB_E2E_WIDE`：头从分节的叶搬进入口条叶，按叶找头的用例都可能受影响），逐个给改法。动手前先按 t29 定下的头重写这一片的设计，单独交一次设计审查（第三轮之后它是新的对象：t29 会改头的画法）。
4. **左右滚动切换**：宿主按区域给交换、窗口内缩、静止的底、选中标记随 `slideToken` 滑。验证：e2e `workbench-containers`（逐帧：入口条与卡片不动、内容在卡片里、卡片外没有像素、头那一段在点的那一刻换、离开的那一节滑出时没有头、下划线与按下底色同时走、滚到一半点回来、侧栏与右栏前后脚切换时侧栏送到终点）。
5. **入口条的拖放与底部面板不写标题**：条 id 按区域、入口带一组、落点表、跨区域搬容器、单视图入口跨区域、预览里并成一行翻转时的标题行；底部面板并成一行时拿掉标题、计数写到入口、拖入口。验证：`layout-drag`、`entry-drop` 相关单元测试，e2e 同第 3 片的清单（逐个核对引用 `[data-panel-tab]` 的地方是不是底部面板的头），`background-tasks` 断言通知计数搬到入口。

每片单独提交、跑上面的验证。

## 验收映射

- 输出 6、11、20、47（入口条的几何、并成一行、最小高度）→ `layout-project.test.ts`、`layout-present.test.ts`、e2e `workbench-views`、`workbench-shell`。
- 输出 13、36（最大化、焦点、当前面板）→ e2e `workbench-shell`、`workbench-views`。
- 输出 17、20 与 `views.md` 输出 19（计数、隐藏的标题元素、接管标题区）→ `WorkbenchPanelHead` 的 DOM 测试、e2e `workbench-views`。
- 输出 42（右栏、底部面板切换的样子）→ e2e `workbench-containers`。
- 输出 25 第 2、7 行、44 到 46（落点、菜单与拖放、跨区域搬容器）→ `entry-drop`、`layout-drag` 单元测试，e2e `workbench-containers`、`workbench-live-drag`、`workbench-dnd`。
- `ui/nested-grid` 的 `swap-backdrop` 与交换的两条规则 → `NestedGrid.dom.test.ts`、`useGridMotion.dom.test.ts`、e2e `workbench-containers`。

## 验证

- 每片跑受影响的单元测试、类型检查与 e2e；量动画时放慢 `--motion-layout` 停在几个时刻读像素（t27 的做法），按下的块与下划线另在真实时间里读几帧（t27 实现审查第 1 条的教训：暂停动画量不到过渡事件）。
- 开发服务上看右栏、底部面板的切换，浅色截图给开发者。
- 未验证的边界：无头浏览器固定 60Hz；真机帧时间。

## 不做与风险

- 不做：标签切换的动画；入口条本身的移动（入口条不能移动，ADR 0046）；卡片层（t27 第二轮第 11 条、本轮第 13 条，待开发者定）。
- 已知限制：几个区域前后脚切换时，整个网格进行中的过渡一起到终点（不只是前一个滚动）；交换的 470ms 里又显隐别的区域时，裁切窗与静止的底停在开始时的位置，滚完才对上；还原过渡中别的区域也在过渡时，头搬回入口条跟着推迟。
- 风险：入口条叶让区域在呈现里多一层分支，按呈现节点认区域的地方（`regionAnchors` 的消费者 `commitGesture`、实时布局按叶找区域、落点分区、`sceneCorners`）要逐个核对；第 1 片先跑 `layout-project`、`layout-drag` 相关的单元测试。
- 风险：交换中外框不画卡片、底由插槽画，结束那一帧两者要在同一次渲染里换，第 3 片逐帧看。
- 风险：并成一行的头跨两片叶，按叶认面板的地方（焦点、悬停、落点、`geometryOf`、`head-slots`）第 2 片逐个改并补用例；漏改的表现是动作不显示、命令取不到面板、落点判错、接管的头回到内容里。
