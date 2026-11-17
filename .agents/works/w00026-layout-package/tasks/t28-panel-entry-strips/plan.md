# t28 计划：右栏与底部面板的入口条与切换容器

第 1 稿（2026-11-17）。从 t27 拆出来；t27 计划第 3 稿里入口条的部分（提交 `c56ab99a7` 的 `tasks/t27-region-entry-strips/plan.md`）与第二轮设计审查（[`design-review-r2.txt`](../t27-region-entry-strips/evidences/design-review-r2.txt)）转过来的几条是这一稿的起点，逐条的回答在“关键设计”里标了出处。

## Context

开发者 2026-11-16 试用 t25 后说：“底部的面板应该也是类似 ActivityBar 的那种容器（类似 vscode），切换应该是左右滚动切换。右栏也应该是和 ActivityBar 一样能切换容器的”。评审页 [`container-switch`](../t27-region-entry-strips/artifacts/container-switch/index.html) 定下的，编号同 [t27 README](../t27-region-entry-strips/README.md)：

- 1. `switch-1` 甲：切换时整个容器滚过去，470ms 布局曲线；滚到一半又点从这一刻接着滚。
- 2. `indicator-1`：选中标记和内容同时滑过去（右栏图标的按下底色、底部面板标题的下划线）。
- 6. 底部面板的一个标签（容器）下面可以有几节，左右并排。
- 8. `card-3`：右栏、底部面板一个容器一张卡片，卡片里几节之间是开放式分割线（t27 第 1 片已做）。
- 9. `strip-3` 甲：入口条是卡片顶上一行，切换时不动；当前容器只有一节时那一节的标题和动作并进这一行，不多占高度。
- 第 3 版“直接做”：底部面板、右栏的卡片与顶上一行不动，里面的内容左右滚；方向跟着入口条（点右边的往左走）；点当前容器的入口是隐藏区域；区域隐藏或拖到零时点别的入口按显示长出来、不滚；减少动态效果直接换。
- 待确认清单 2026-11-16：右栏、底部面板只要显示着分节就有入口条，只有一个容器时也有。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 6、10、11、13、20、36、42、44 到 47；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的“交换”与呈现；[ADR 0046](../../../../../docs/adr/0046-workbench-view-containers.md)（“入口条怎么进几何”留给第二步）。

约束：nb-layout 要做成通用库（t26）。这次往 nb-layout 里加的两样都由宿主驱动：投影选项 `regionStrip`（带容器的区域顶上一行，和已有的容器模型同在 `layout-project.ts`）、交换的插槽 `swap-backdrop`。

## 技术选型

无。

## 关键设计

### 呈现树里的入口条叶：`packages/nb-layout/src/layout-project.ts`、`layout-doc.ts`

- 投影选项 `regionStrip?: (region: PanelName) => number`：入口条的高度，0 或不给是没有。区域在呈现里至少有一节时（不是空区域的锚自己），区域节点呈现成纵向分支 `[入口条叶, 内层]`，id 是文档里区域节点的 id（`regionAnchors` 照旧登记它，拖到零、隐藏按拖到零画都在它上面，入口条跟着整个区域缩到零）；内层是原来呈现出来的节点：一节时是那一节的叶，几节时是原来的分支、id 改成 `<区域节点 id>:sections`。入口条叶 id `regionStripLeafId(region)`（`strip:<区域>`），`ref` 用新前缀 `strip:`，`regionOfStripRef`、`regionOfStripLeaf` 反解，三样都从包入口导出（第二轮第 12 条）。入口条叶高度固定（`sizing: "fixed"`，最小、最大高度都是它），和内层之间的缝宽 0、不可拖；区域外沿的缝照旧 1px、可拖。
- `assignByParent`：入口条叶不改 `sizing`；和入口条叶同在包装分支里的那一节叶不配收起策略（输出 11：区域只显示一个分节时它不收成标题行；第二轮第 14 条）。
- `minimumOf` 不用改：包装分支纵向，最小高度是入口条加内层。最小值怎样不变见下一节。
- `rebaseIntents` 不用改：区域节点取到的是包装分支的尺寸（含入口条），和现在相同；入口条叶与 `:sections` 分支不在文档里，不写。补一条用例守住。
- `regionAnchors` 的说明改成“一节时是包装分支，不再塌陷成分节的叶（有入口条的区域）”；`collapsedTo` 不变。

### 尺寸与“只有一节”：`web/state/layout-constraints.ts`、`web/state/layout-present.ts`

- `layoutProjectionOptions` 给 `regionStrip`：右栏、底部面板是 `PANEL_HEAD_HEIGHT`（32），侧栏 0。
- 并成一行（`mergedSection(doc, region, facts)`）：区域是右栏或底部面板、当前容器在文档里恰有一节显示着（按文档判，不按放不下收走后的呈现：收走使节数变化时头不在两片叶之间来回搬，第二轮第 2 条），而且这一节没有最大化。几节的容器被放不下收得只剩一节时不并，那一节照旧有自己的头。
- 最小高度（第二轮第 9 条）：并成一行的那一节最小高度是 `SHELL_PANEL_MIN_HEIGHT - PANEL_HEAD_HEIGHT`（48），区域合计仍 80，和输出 6 一致；几节时每节照旧 80，区域多出入口条那 32。按文档判，不随最大化变（最大化不重新求解布局）。
- `layoutContents`：并成一行的那一节内容的上边是 0（头在入口条里）；最大化时它自己画头，上边照旧 32。`hasRoom` 对它按“高度大于 0”判。
- 入口与意图推广到三个区域：`regionEntries(doc, region, catalog, containers)`（右栏、底部面板的入口，结构同 `containerEntries`）、`regionEntryIntent(doc, region, container, facts)`（不是当前容器就切换、是当前容器且区域可见就隐藏）；活动栏照旧用侧栏的。

### 表面：`web/components/WorkbenchSurface.vue`

- 入口条叶在叶插槽里画新插槽 `strip`（`{region, merged}`，`merged` 是并进来的那一节或 null）；并成一行的那一节自己不画头。
- 卡片：入口条叶和分节同组（`groupOf` 先认入口条叶，`regionOfStripLeaf`），和下面的分节相连，拼成一张卡片；和第 1 片的规则一样，不另写。
- 按叶认面板（第二轮第 2 条）：`panelOf` 拿到入口条叶时换成并进来的那一节（没有并时是 null，和活动栏一样），所以焦点在入口条里时当前面板是那一节、标签与动作的命令照常；悬停动作的范围按“这块叶代表的面板”比（`actionsShownOn(id)` 先换成面板），入口条与那一节的正文是同一个范围，入口条的卡片也带 `data-hover-actions-scope`。
- 最大化（第二轮第 1 条）：最大化并成一行的那一节时它自己画头（含还原按钮），入口条叶和别的叶一样被盖住；还原后回到并成一行。

### 入口条：新组件 `web/components/WorkbenchRegionStrip.vue`（同名 `.md`、Lab 场景）、`WorkbenchShell.vue`、`WorkbenchPanelHead.vue`

- 横着排：右栏是容器图标（按下底色），底部面板是容器标题（下划线）；当前容器的入口总在外面，放不下时排在后面的收进“更多”（复用 `layoutStrip`）。并成一行时后面接那一节的头：右栏接标题、视图动作、框架按钮；底部面板的入口本身就是标题，只接视图动作与框架按钮（产品取舍，记进待确认清单）。头用 `WorkbenchPanelHead` 的同一套（元素照旧带那一节的 `data-panel-head`），加一个“嵌在入口条里”的写法：不画自己的底与高度，标题可省。
- 交互同活动栏：点入口发 `select`（宿主按 `regionEntryIntent` 切换或隐藏），右键与菜单键发 `context-menu`（输出 44 的容器菜单，宿主现有的 `containerMenuItemsOf`），左右方向键在入口之间走，读屏是一组带 `aria-pressed` 的按钮。F6 照常停在入口条叶上。
- 选中标记：抽出 `WorkbenchToolStrip` 里按下块的逻辑成一个组合函数（`useEntryIndicator`，按轴量 `offsetTop`/`offsetLeft` 与尺寸），活动栏与入口条共用；底部面板的是一条下划线，右栏的是按下底色。只在按下的入口换了的那一次滑。

### 右栏、底部面板切换容器时滚过去：`WorkbenchShell.vue`、`WorkbenchSurface.vue`、`packages/nb-layout/src/vue/NestedGrid.vue`

- 点入口切换，区域显示着、宽度大于零、里面没有最大化的分节时，提交前给交换（同 t27 第 3 片的 `prepareSidebarSwap`，推广成按区域）：离开、换上来的是两个容器在文档里显示着的分节（入口条叶前后都在，不在里面），`axis: "width"`，方向按入口顺序。
- 窗口：裁在卡片里入口条以下那块：`window.inset` 是分节外框到卡片的内缩（px，表面按缝宽算：区域外沿整缝、挨着别的卡片半缝），`radius` 是卡片下面两个角。滑动的外框不画自己的卡片（底、圆角、投影），只带着头与内容滑；静止的卡片由 NestedGrid 的新插槽 `swap-backdrop` 画：交换进行时在窗口矩形上画一层宿主给的东西，在外框下面，交换结束摘掉。表面在里面画一块卡片底（和卡片同一组变量），入口条叶在上面不动，两者拼成一张不动的卡片。
- 交换结束那一帧外框换回自己画卡片，和摘掉底在同一次渲染里（窗口等于静止的样子，见 NestedGrid 说明）。

### 入口条的拖放：`web/layout-drag.ts`、`web/entry-drop.ts`、`web/drag-presentation.ts`

- 入口带从一条推广成一组（第二轮第 8 条）：`DragGeometry.band` 换成 `bands: ReadonlyArray<{region, rect, axis}>`，`FrozenGeometry.bar` 换成按区域的入口矩形；`measureBar` 按 `data-region-strip` 量每条入口条的 `[data-tool-entry]`；`entryDrop` 先找指针落在哪一条带上，横着的带按 x 判（`barSpotAt` 加轴）。
- 来源收起后的平移：`collapsed()` 的 `moves` 按叶 id 算，入口条叶不在文档里（`treeLeaves(doc.tree.root)` 取不到），改为按呈现树的叶取；`barAfterCollapse` 推广到三个区域：来源是某区域当前容器唯一的分节、拿走后容器空了时，那一条的入口去掉、后面的挪一格（横着的挪宽度）。
- 落点：入口上是并入（输出 45），入口之间是插入线（竖线），空位是新容器；同活动栏。并成一行的头里标题那一段仍是那一节的标题行（输出 10 的“放到分节的标题行 → 上面多一个分节”）：`geometryOf` 找头按面板 id 在整个表面里找（`[data-panel-head="<id>"]`），不只在它自己的外框里。

## Spec 与文档改动

条目级 planned，各片动手前写：

- `docs/specs/ui/workbench-layout.md`：输出 6（右栏、底部面板的最小高度含入口条：并成一行时区域至少 80）、输出 11（入口条下面唯一的分节不收成标题行）、输出 13（最大化并成一行的那一节时它自己画头）、输出 20（头的高度与并成一行）、输出 36（焦点在入口条里时当前面板是并进来的那一节，没有并时没有）、输出 42（右栏、底部面板切换的样子）、输出 44 到 46（入口条上的菜单与拖放）、输出 47（入口条的位置、何时有、内容、交互、放不下时的让位，替掉“几何另行设计”）；验收场景补右栏、底部面板的切换与拖放。
- `docs/specs/ui/nested-grid.md`：交换的 `swap-backdrop`。
- `docs/specs/ui/workbench-layout.md` 的术语“呈现树”（第 51 行起）：右栏、底部面板有分节时多一片入口条叶，只在呈现里、不进文档。投影的写法（`regionStrip`、入口条叶的 id）在 `layout-project.ts` 的模块头与导出函数的注释里，不另立 Spec。
- 组件说明：`NestedGrid.md`、`WorkbenchSurface.md`、`WorkbenchShell.md`、`WorkbenchPanelHead.md`、`WorkbenchToolStrip.md`、新组件的 `.md`。

## 切片

1. **nb-layout 的入口条叶**：投影选项、导出的 id 函数、`assignByParent`、说明。验证：`layout-project.test.ts`（有分节时包装分支的形状与 id；一节、几节；空区域没有入口条；拖到零、隐藏按拖到零画、放不下收走时一起没；`rebaseIntents` 写回的区域尺寸不变；唯一的分节没有收起策略；最小高度是入口条加内层）、nb-layout 全部测试与类型检查。
2. **工作台画出入口条与并成一行**：尺寸、`mergedSection`、`layoutContents`/`hasRoom`、入口与意图、表面的插槽与按叶认面板、最大化、`WorkbenchRegionStrip`、`useEntryIndicator`（滑动先不接交换）。验证：`layout-present.test.ts`、`adjacency.test.ts`（入口条叶与分节拼成一张）、新组件的 DOM 测试与 Lab 场景、e2e `workbench-views`（右栏、底部面板的入口条、并成一行、悬停动作、焦点）、`workbench-shell`（最大化并成一行的那一节有还原按钮、底部面板高度）、`workbench-containers`（点入口切换与隐藏、菜单）。
3. **左右滚动切换**：`swap-backdrop`、宿主按区域给交换、窗口内缩、滑动的外框不画卡片、选中标记与内容同时滑。验证：`NestedGrid.dom.test.ts`（插槽只在交换中）、e2e `workbench-containers`（逐帧：入口条与卡片不动、内容在卡片里、卡片外没有像素、下划线与按下底色同时走、滚到一半点回来）、`lab-grid-swap`。
4. **入口条的拖放**。验证：`layout-drag` 相关单元测试、e2e `workbench-live-drag`、`workbench-dnd`、`workbench-containers`。

每片单独提交、跑上面的验证。

## 验收映射

- 输出 6、11、20、47（入口条的几何、并成一行、最小高度）→ `layout-project.test.ts`、`layout-present.test.ts`、e2e `workbench-views`、`workbench-shell`。
- 输出 13、36（最大化、当前面板）→ e2e `workbench-shell`、`workbench-views`。
- 输出 42（右栏、底部面板切换的样子）→ e2e `workbench-containers`。
- 输出 44 到 46（菜单与拖放）→ e2e `workbench-containers`、`workbench-live-drag`、`workbench-dnd`。
- `ui/nested-grid` 的 `swap-backdrop` → `NestedGrid.dom.test.ts`、e2e `workbench-containers`。

## 验证

- 每片跑受影响的单元测试、类型检查与 e2e；量动画时放慢 `--motion-layout` 停在几个时刻读像素（t27 的做法）。
- 开发服务上看右栏、底部面板的切换，浅色截图给开发者。
- 未验证的边界：无头浏览器固定 60Hz；真机帧时间。

## 不做与风险

- 不做：标签切换的动画；右栏、底部面板的入口条拖到活动栏以外的新位置（入口条不能移动，ADR 0046）；卡片层（t27 第二轮第 11 条，待开发者在 t26 定）。
- 风险：入口条叶让区域在呈现里多一层分支，按呈现节点认区域的地方（`regionAnchors` 的消费者 `commitGesture`、实时布局按叶找区域、落点分区、`sceneCorners`）要逐个核对；第 1 片先跑 `layout-project`、`layout-drag` 相关的单元测试。
- 风险：交换中外框不画卡片、底由插槽画，结束那一帧两者要在同一次渲染里换，第 3 片逐帧看。
- 风险：并成一行的头跨两片叶（头在入口条叶里、正文在分节的叶里），按叶认面板的地方（焦点、悬停、落点、`geometryOf`）第 2 片逐个改并补用例；漏改的表现是动作不显示、命令取不到面板、落点判错。
