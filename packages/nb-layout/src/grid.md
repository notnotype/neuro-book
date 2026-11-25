# 嵌套 grid

`createGrid` 管理领域无关的两轴布局树。节点 `size` 是分配意图，分支的外部分配与内部子布局各自独立；`layout({width, height})` 只计算呈现，不回写快照。完整的行为合同在仓库的 [`docs/specs/ui/nested-grid.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md)。

## 建树

`createGrid(root, {sashSize})`：`sashSize` 是每条分隔线的主轴占用（CSS px），可以是数，或 `(branchId, sashIndex) => number` 的函数。**缺省是 0**：分隔线没有宽度、不可交互（`data-disabled`），也没有诊断；要可拖的分隔线必须传一个正数。接了提交处理又没停用的 `NestedGrid` 遇到全是 0 的分隔线时，开发模式下会警告（`setLayoutDevChecks`）。

## 几何与手势

`layout` 返回每个节点的 `sizes`、有效交互 `constraints`、每条分隔条的 `sashSizes` 和 `issues`（这一次求解的全部诊断，`{code, message, params?}`，码与参数见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“诊断：形状与码”一条）。Renderer 同时消费这三份几何数据；不可满足的窄容器已经降级，不能再用原始 min/max 把面板夹回溢出。

收起且 `collapsedSize` 为 0 的节点看不见：它在两根轴上都不占最小尺寸，不抬高父分支另一根轴的下限，另一根轴放不下它里面的叶时也不报诊断（完整规则见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“分支的收起”几条）。`collapsedSize` 大于 0 的（标题行）只在父分支主轴上换成 `collapsedSize`，另一根轴照常约束、照常诊断。

保留像素的节点标 `rigid: true`（刚性）时，它沿父分支主轴的最小与最大都是它的意图（先夹进声明的最小与最大）：拖动的级联补偿推不动它，位移传给更远的兄弟。最小尺寸之和放不下时先按比例压别的节点，刚性的最后才让；刚性的之和也放不下时只在刚性的之间按比例压，别的为 0，诊断照旧是 `over-constrained`（`min-total`）。交叉轴不受影响，按比例分的节点标了不起作用；`setSize` 照样能改它的意图；和 `sizing` 一样不写快照，恢复时由解析函数给。只认这个标记：最小等于最大而不标的节点，窄窗口里照旧和别的一起按比例压。

`resizeBranches(changes)` 一次提交一场手势的全部分支；每项 `{branchId, axis, baseline, target}` 取同一分支全部直接子节点的当前呈现 px。基线和目标均不包含 sash；两者必须覆盖相同子节点、有限非负、总量相等，基线必须符合当前树，目标必须符合当前约束。过期基线、越界目标或无法反解时整批失败且树不变。

原语按未触界节点的呈现比例反解尺寸意图。当前 min/max 约束呈现像素，不能直接夹取反解后的比例权重；仍能呈现目标的兄弟保留原意图。无变化的手势保持快照逐值不变。所有节点都触界或权重为零时以现有总量选择权重单位，再重新布局验证目标后一次发布。

改意图的两个入口：拖动与键盘由 `useGridHost` 经 `resizeBranches` 提交（呈现 px，见上）；宿主要把一块保留像素的设成已知宽度（偏好、菜单）用 `setSize`。用户手势携带的是当前呈现 px，用 `resizeBranches`，不要逐个面板按增量改。

`setSize(id, px)` 只对保留像素的节点（叶或分支）：把它沿父分支主轴的意图设成 `px`（竖向分支里是高度），夹进它自己展开时的最小与最大，兄弟不动，不读布局；结果里的 `size` 是存下的值，宿主拿它存偏好；`changed` 只看意图。收起中的也只改意图，展开时回到它；刚性的同样能设，夹进声明的最小与最大。按比例分的节点给 `wrong-sizing`：它的意图是份额，没有像素可设。改的是活树，规则同 `setCollapsed`（`useGridHost` 的宿主经 `host.setSize`）。`find(id).size` 读到的是意图，不是呈现。

宿主保存手势开始时的布局；上下文或容器变化后应取消旧手势。`NestedGrid` 的 `gesture-end` 只告诉宿主一次手势结束了：它在提交回调之前发，宿主拒绝或没接回调时也发，不要在它里面改树或保存。一次完整的 px 提交（含主动节点列表）经 `onGestureCommit` 同步交给宿主，宿主用 `resizeBranches` 一次落账；落账成功之后再按自身产品规则保存主动偏好，用 `useGridHost` 的 `onApplied`，自己写宿主的就在同样的成功路径上。取消、挂载、测量和窗口变化不保存意图。

拖动求解（`sash-drag`）的边界只读冻结的按下基线：指针位移是**相对按下位置的绝对总量**，理想边界 = `baselineBoundary + deltaPx`，吸附与展开只改约束状态、不用记忆尺寸重锚几何，因此同一个指针位置永远对应同一条边界与同一组收起状态，过冲不会留下永久偏移。兄弟之间的分配从上一帧解出的尺寸出发（首帧是基线，经 `snapState.sizesPx` 逐帧串下去）：先把每个兄弟夹进它当前的 bounds，再按两侧目标总量由近到远补偿，结果逐叶合法且全分支守恒；掉头往回拖时先动挨着分隔条的面板，已被推开的兄弟留在被推到的地方，和拖一段松手再拖一样，同一方向分几帧到达结果不变。手势中途做显式折叠、恢复的调用方要把它的结果写进 `snapState.sizesPx`；约束装不下总量时给诊断并保持基线，不产出半更新。收起判定同样只看理想尺寸：低于 `minimum − collapseThreshold` 吸附到 `collapsedSize`，回到 `max(minimum, collapsedSize + expandThreshold)` 且容量允许时展开（用理想边界）；锁住的面板不过阈值，展开着的拖到最小尺寸就停，收着的拉不开（见“收起与展开”）。会话提交的就是最后发布的那份几何，`finish` 不拿最后一次位移重解。收起意图对哪种叶都生效：`sizing` 为 weight 的余量叶也可以带 `collapse`，被拖到底时吸附成 `collapsedSize`、拖回来时展开，宿主用它表达“把另一侧拖到顶”。这种叶通常再标 `toggleable: false`：分隔条上的 `Enter` 与显式切换跳过它，仍作用于另一侧原来那个可收起的面板；独立 `Splitter` 同样遵守。它只决定会话挑哪一侧做显式切换。两侧都可收起时，同一帧里一侧展开、另一侧收起会在一次求解里一起完成（判定重复到不再变化），结果不取决于位移分几帧到达。

## 收起与展开

收起策略（节点的 `collapse`）有这几项：

- `collapsed`：此刻收着没有。
- `collapsedSize`：收着时沿父分支主轴的尺寸；0 是看不见，大于 0 是标题行（见“几何与手势”）。
- `collapseThreshold`、`expandThreshold`：拖动时越过最小尺寸再往里多少像素收起、从收起处往外拉多少像素展开。
- `toggleable: false`：分隔条上的 Enter（显式切换）跳过它，只经拖动收起与展开。
- `locked: true`：锁住收起状态，见下面的“锁”。

**展开回到意图**。网格的节点只有一份展开尺寸，就是它的意图（`size` 在父分支主轴上的分量）：保留像素的回到意图的像素，按比例分的回到它的份额。收起不改意图，策略里也没有恢复尺寸。独立 `Splitter` 的面板没有意图，它的 `restoreSize` 是另一回事（见 [Splitter](vue/Splitter.md)）。

三个入口：

- **拖动**：越过阈值收起；从收起处往外拉过阈值展开，展开后跟随指针，松手按呈现写回意图。
- **分隔条上的 Enter（显式切换，手势会话的 `toggleCollapsed`）**：能翻时结果和 `setCollapsed` 翻这块面板的标记相同，按比例分的兄弟按份额吸收或让出，保留像素的兄弟不变。不同只有三处：翻了之后最小尺寸之和放不下时不展开，给 `no-room-to-restore`；翻了之后让出的空间没有兄弟能吸收（兄弟都到上限、都收着或都保留像素）时不收起，给 `no-room-to-collapse`，这两种这场手势都不提交；锁住的面板跳过。
- **`setCollapsed(id, collapsed, options?)`**：只翻标记，意图不动，下一次 `layout` 按分配规则重排，和宿主改了自己的记录、重新建树相同。`toggleable` 与锁都不挡它：放不下时照样翻、报 `over-constrained`，没人吸收时留白、报 `unabsorbed-space`。结果是 `{ok: true, changed, collapse}`：`changed` 是标记或锁有没有变，`collapse` 是调用之后的策略。它改的是活树：用 `useGridHost` 的宿主经 `host.setCollapsed`（重发布局并通知 `onApplied`），直接调的宿主之后要自己 `invalidate()`。

**落账保住意图**。手势经 `resizeBranches` 落账时：

- 一个分支应用了这次的收起变化之后，用现有意图布局就得出目标的，这个分支的意图一个也不改。显式切换都这样落账，所以窄窗口里被压缩的保留像素兄弟不会被写成压缩后的值。
- 否则照常反解。反解之后这个分支里还有收着的按比例分的孩子时，展开着的按比例分的孩子按同一个倍数缩放，使它们的和等于落账前的和；呈现不变，收着的那块展开时拿回收起前的份额。

**锁**。`locked: true` 时，拖动收不了它，也拉不开收着的它；分隔条上的 Enter 跳过它（同 `toggleable: false`，作用于另一侧）；`resizeBranches` 要翻它的标记时整批失败，给 `collapse-locked`（`params` 是 `id`、`branch`）。只有宿主能翻它：`setCollapsed` 照常翻，`options.locked` 同时改锁，不给时锁不变；建树、恢复时也可以在策略里给。独立 `Splitter` 同样遵守。它表达“这块此刻不能展开”，例如条上没有工具窗的停靠区。锁不停用分隔线：要去掉拖动光标、让读屏读成不可用，宿主照旧给 `NestedGrid` 的 `sashDisabled`。

**存档存什么**。收起状态要跨会话保存的，存意图（快照，或宿主自己的记录）与 `collapsed` 就够了。策略不写快照，恢复时由解析函数按引用给回（见包的 README 的“约定”）。

**分隔线**。`sashSize` 不随收起变：收起到 0 的节点两侧各有一条分隔线，挨在一起是两条线的缝。要只留一条，用 `sashSize` 的函数形式，给挨着拖不动的那一侧（例如刚性的按钮条）的线 0；宽 0 的线库画成不可交互的接缝。写法见 ide 示例的 `sashSize`。

### 已知限制

- **一支里只有保留像素的面板、又有留白时，Enter 展开的预览与落账不同**：例如 604 宽里放 `[a 保留像素 200 收着, b 保留像素 200]`，分隔条上的 Enter 展开 a 时，预览按这一支此刻呈现的总量（200）重排，是 `[100, 100]`；松手落账时意图不变，布局回到 `[200, 200]`。手势提交要守恒，预览用不到没人吸收的留白。有按比例分的兄弟时没有这个差别。
- **窄窗口里拖分隔线落账**：被压缩、这次没动的保留像素节点的意图会被写成压缩后的值，放宽后回不到原宽。显式收起与展开不受影响（见“落账保住意图”）。

## 拆分叶

`splitLeaf(targetId, split)` 在一块叶旁边插入新叶，`split` 是 `GridSplitInput<T>`：`{branchId, orientation, side, leaf, ratio?}`。`orientation` 是新叶与目标的排列方向，`side` 是 `before`（左/上）或 `after`（右/下），`left/top → before`、`right/bottom → after` 的宿主词汇映射留在交互层；`leaf` 是新叶的输入（`GridLeafInput` 去掉 `size`，尺寸由 `ratio` 定）。参数只有 `ratio`，不开放 `size`：否则初始意图会有两个 authority，测得的 px 还会被当成权重。

按目标的父分支分两种做法：

- **同向并入**：`orientation` 与目标的父分支相同时，新叶并进这个父分支、挨着目标，不新建分支，树不加深，只加一个节点。兄弟的意图不动；新叶与目标分掉目标在这根轴上的意图。并入后这个分支的孩子多了一个，之后按序号调 `addLeaf`、`moveLeaf` 的宿主要按新的孩子数算；分隔线的 `data-sash` 序号随之后移，元素身份按两侧节点认，过渡不受影响。
- **新建分支**：目标是根叶，或 `orientation` 与父分支不同时，目标原位换成一个 `branchId`、`orientation` 方向的新分支。新分支继承目标叶的外部分配意图，目标叶与新叶按 `ratio` 分掉目标在新轴上的意图；新轴意图为 0 时以 1 为分配基数，不会塌成 0。

`branchId` 两种做法都必填、都查重：并入时用不上，但成败不取决于树此刻的形状，宿主不用先看父分支再决定传什么。

`ratio` 有两种写法，缺省 `0.5`：

- **数**：必须有限且严格介于 0 与 1。新叶得底数乘 `ratio`，目标留下其余。底数是目标的意图；并入时目标的意图为 0（此刻呈现也是 0），底数取这一支的平均一份（同 `addLeaf` 不给意图时的取法）。这一支按比例分的意图全是 0 时底数也是 0，两块与兄弟一起均分，`ratio` 不生效。
- **`"even"`**：并入时新叶取这一支的平均一份、目标的意图不动，结果与 `addLeaf` 不给意图相同，新叶与兄弟平分（两块按比例分的再来一块就是三等分）；新建分支时等于 `0.5`。

目标叶保留像素（`sizing: "fixed"`）时返回 `wrong-sizing`（`expected: "weight"`），树不变：它的意图是像素，新叶与目标都分不到有意义的份额。要在保留像素的一栏旁边加一块，拆它旁边按比例分的叶，或者先建好分支（建树或重建）。

未知目标、非叶目标、重复 id、比例不合法（不是有限数也不是 `"even"` 报 `not-finite`，越出 0 到 1 报 `invalid-argument`）、超过节点数或层数上限都失败且不改树。层数从根算第 1 层，最多 16 层（`GRID_MAX_DEPTH`），节点数最多 256（`GRID_MAX_NODES`）；结构操作只判这次新造出来的那一处：并入看目标所在的层，新建分支看新叶会落到的层（目标再深一层），`addLeaf` 与 `moveLeaf` 看新叶在目标分支下的层。`createGrid` 不查规模，建进来的树已经超深时，浅处的增删移动照常成功，深处照旧被拒。删除与移动继续复用 `removeLeaf` / `moveLeaf`，手势提交继续复用 `resizeBranches`。

## 复制与试做

`grid.clone()` 交回一份独立的网格：树、意图、约束、`sizing`、收起策略与状态，连同建网格时的选项（`sashSize`、`encodeRef`）。之后改其中一份，另一份的树、快照与布局都不变；叶的 `ref` 是同一个宿主对象，不复制。

“这次拆分放不放得下”这类问题用它试做：在副本上照做一遍，读结构操作的结果（被拒就是 `limit-exceeded` 之类的失败）与副本的 `layout(容器).issues`（放不下时有 `over-constrained`），满意了再在原网格上做同样的操作。副本的 `layout` 还能给出新叶的矩形，作落点反馈的区域。“这次才放不下、原来就放不下的不算”这类规则留在宿主：先读原网格的诊断，再与副本的比。

## 渲染与投影

`NestedGrid` 把叶与分隔线放在同一父元素下，矩形来自 `placeGrid`（`grid-rects.ts`，相对 grid 根的 CSS px，沿主轴按设备像素累加）。几何只有 px 一种口径，`buildGridBranchPanels` 只是把布局投影成分隔线 aria 要的面板配置，数值算法在 `grid-geometry` / `sash-drag`。`NestedGrid` 独占一份 `useSashGesture` 会话：拖动中发布 `preview`，松手把一次 `GridGestureCommit` 交给宿主的 `onGestureCommit`，由宿主用 `resizeBranches` 原子落账。

## 布局文档

工作台的布局文档（用户的布局、到呈现树的投影、落点规则）不在本包，在 [`@notnotype/nb-workbench-layout`](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workbench-layout/README.md#布局文档)：它只经本包的公开入口建在 `createGrid` 之上（[ADR 0054](https://github.com/notnotype/neuro-book/blob/master/docs/adr/0054-nb-layout-general-library.md)）。

## 快照与引用

v2 快照只保存结构、方向、稳定 id/ref 和两轴尺寸意图，不保存运行约束。恢复先完整校验，再一次发布。未知引用过滤结果单独报告，宿主保留原记录；过滤后的 `serialize()` 不是无损替代。

从存档建网格用 `restoreGrid(快照, 解析引用, 选项)`：成功时结果里有 `grid`、`dropped`、`clamped`，失败时是恢复失败的形状、没有 `grid`，宿主不看结果就拿不到网格，也就不会拿一棵空树或缺省布局去自动保存、盖掉原件。约束、`sizing` 与收起策略只来自解析引用的结果，`sashSize` 这类选项也要在这里给（快照里没有，缺省是 0）。原地的 `grid.restore(快照, 解析引用)` 保留：解析结果没给的约束、`sizing` 与收起策略回落到当前树里同 id 的节点，用在“同一个网格换一份存档”。

字符串 ref 默认原样编码；对象等非字符串 ref 必须在 `createGrid` options 中提供 `encodeRef: (ref) => string`，并由恢复解析器把该稳定 key 还原为对象。编码器须给不同身份分配稳定且可区分的非空 key；原语不使用 `String(object)` 推测身份。

v1 无法可靠推导两轴意图，明确拒绝；未知高版本、重复 id、非法方向/尺寸/children、超过 256 节点或超过 16 层（根算第 1 层，与结构操作同一个计法）也整体拒绝。宿主保留原件并禁止自动保存默认布局覆盖它。

## 结构操作

`addLeaf` / `removeLeaf` / `moveLeaf` / `splitLeaf`；同分支重排不触发塌陷；跨分支的 `moveLeaf` 先做完全部检查（含规模守卫），再直接在树上改，失败的移动不动树。失败不留下被移除的半棵树，也不改快照。

增删与移动不改兄弟的意图（见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“结构操作与 resize 不改兄弟的意图”一条）：保留像素的兄弟宽度不变，按比例分的兄弟按份额重分，空出或多出的空间由按比例分且没收起的兄弟吸收，没有就留白（诊断 `unabsorbed-space`）。

- **按比例分的新叶不给意图**（`size` 省略或主轴为 0）：取这一支里不是保留像素的兄弟（收起中的也算）的正意图的平均，即平分一份；这些兄弟的意图全是 0 时取 0，和它们一起均分；没有这样的兄弟时取 1。给了就照用，单位同兄弟：兄弟是 600、新叶给 400，新叶拿 400/1000，不是 400 像素。要等分就别给。
- **`moveLeaf` 跨分支**：按比例分的节点到了别的分支，意图按新叶重取目标分支的平均，不带来源分支的单位；保留像素的节点移到同向的分支意图不变。保留像素的节点移到方向不同的分支失败（`invalid-argument`，`field: "fixed-cross-axis"`）：它的意图只对父分支主轴有意义，换方向后宽度没有来处。要换方向就 `removeLeaf` 再 `addLeaf` 并给新方向的意图，叶上的收起状态由宿主带过去。

### 已知限制

- **展平**：`removeLeaf` 删到只剩一个孩子、或跨分支 `moveLeaf` 把来源分支移到只剩一个孩子时，分支被它的孩子替换。分支的 id 没了（`find` 得 `null`），分支的约束与收起策略丢掉；留下的节点拿到分支的 `size`，按它自己的 `sizing` 重新解释这个数：保留像素 240 的分支里剩下一块按比例分的叶，它变成份额 240，按兄弟的份额重分，不再是 240 像素。宿主要一组栏常在（例如一列可增删的面板），就保留至少两个孩子，或从自己的记录重建网格（工作台的做法）。根是例外：根只剩一块保留像素或带收起策略的节点时根分支留着，这块照旧呈现（保留像素的还是它的宽度），余下留白并给 `unabsorbed-space`；根只剩按比例分、没有收起策略的节点时照旧换成它。
- **拆分时新叶保留像素**：`split.leaf` 写了 `sizing: "fixed"` 时，新叶的意图仍来自比例（目标意图乘 `ratio`，或平均一份），单位不是像素，没有诊断。要加一块已知宽度的保留像素的叶，用 `addLeaf` 并给它的意图。
- **`moveLeaf` 的深度判定偏保守**：规模守卫与 `addLeaf` 同一个公式，按移动前的树判深度（节点数不变，叶移进目标后的深度不超过 16 层）。来源分支因此塌陷、移动后其实变浅的移动，在目标已经在第 16 层时也会被拒（`limit-exceeded`），树不变。
- **`createGrid` 不查规模**：建树时超过 256 个节点或 16 层也照建，只有结构操作新造出来的那一处与快照恢复按上限拒绝。宿主的记录要先自己校验（工作台的布局文档就是这样）。
- **没有能吸收空间的兄弟**：一个分支里只有保留像素的兄弟，或按比例分的全收起了，增删之后有空就留白（`unabsorbed-space`），放不下就按已有规则压缩。

`find(id)` 是只读查找（宿主读身份与意图用）；改动仍走结构操作，直接改写节点会绕过守恒与规模判定。

行为见 [`docs/specs/ui/nested-grid.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md)，能力仍为 planned：宿主一侧的持久化（Storage 宿主、同名叶的恢复地址隔离、双标签订阅）还没有闭合。
