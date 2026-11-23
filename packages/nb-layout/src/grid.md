# 嵌套 grid

`createGrid` 管理领域无关的两轴布局树。节点 `size` 是分配意图，分支的外部分配与内部子布局各自独立；`layout({width, height})` 只计算呈现，不回写快照。完整的行为合同在仓库的 [`docs/specs/ui/nested-grid.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md)。

## 建树

`createGrid(root, {sashSize})`：`sashSize` 是每条分隔线的主轴占用（CSS px），可以是数，或 `(branchId, sashIndex) => number` 的函数。**缺省是 0**：分隔线没有宽度、不可交互（`data-disabled`），也没有诊断；要可拖的分隔线必须传一个正数。接了提交处理又没停用的 `NestedGrid` 遇到全是 0 的分隔线时，开发模式下会警告（`setLayoutDevChecks`）。

## 几何与手势

`layout` 返回每个节点的 `sizes`、有效交互 `constraints`、每条分隔条的 `sashSizes` 和 `issues`（这一次求解的全部诊断，`{code, message, params?}`，码与参数见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“诊断：形状与码”一条）。Renderer 同时消费这三份几何数据；不可满足的窄容器已经降级，不能再用原始 min/max 把面板夹回溢出。

收起且 `collapsedSize` 为 0 的节点看不见：它在两根轴上都不占最小尺寸，不抬高父分支另一根轴的下限，另一根轴放不下它里面的叶时也不报诊断（完整规则见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“分支的收起”几条）。`collapsedSize` 大于 0 的（标题行）只在父分支主轴上换成 `collapsedSize`，另一根轴照常约束、照常诊断。

`resizeBranches(changes)` 一次提交一场手势的全部分支；每项 `{branchId, axis, baseline, target}` 取同一分支全部直接子节点的当前呈现 px。基线和目标均不包含 sash；两者必须覆盖相同子节点、有限非负、总量相等，基线必须符合当前树，目标必须符合当前约束。过期基线、越界目标或无法反解时整批失败且树不变。

原语按未触界节点的呈现比例反解尺寸意图。当前 min/max 约束呈现像素，不能直接夹取反解后的比例权重；仍能呈现目标的兄弟保留原意图。无变化的手势保持快照逐值不变。所有节点都触界或权重为零时以现有总量选择权重单位，再重新布局验证目标后一次发布。

`setCollapsed(id, collapsed)` 收起或展开一块有收起策略的面板：只翻它的收起标记，尺寸意图不动，下一次 `layout` 按分配规则重排（按比例分的兄弟吸收，保留像素的不变，展开回到意图），和宿主改了自己的记录、重新建树相同。分隔条上的 Enter 是另一种结果：隔着那条分隔条的邻居由近到远让位，恢复到 `restoreSize`；另一侧吸收不了时不收，给 `no-room-to-collapse`。`setCollapsed` 改的是活树，用 `useGridHost` 的宿主经 `host.setCollapsed`（会重发布局），直接调的宿主之后要自己 `invalidate()`（见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“收起与展开的入口”“宿主的收起入口”两条）。

`restoreSize` 由网格在收起的那一刻记下，宿主只给初值：保留像素的面板记它的意图（被压缩时也是意图）；按比例分的面板在 `resizeBranches`（拖动收起、Enter）里记收起前呈现的宽度，经 `setCollapsed` 时不改，要“恢复到合适的那一份”就给它 `restoreToShare`。收起策略不写快照：宿主要跨会话保存，从 `setCollapsed` 的结果或 `find(id)` 读。

改意图的两个入口：拖动与键盘由 `useGridHost` 经 `resizeBranches` 提交（呈现 px，见上）；宿主要把一块保留像素的设成已知宽度（偏好、菜单）用 `setSize`。用户手势携带的是当前呈现 px，用 `resizeBranches`，不要逐个面板按增量改。

`setSize(id, px)` 只对保留像素的节点（叶或分支）：把它沿父分支主轴的意图设成 `px`（竖向分支里是高度），夹进它自己展开时的最小与最大，兄弟不动，不读布局；结果里的 `size` 是存下的值，宿主拿它存偏好。收起中的同时把 `restoreSize` 改成 `max(collapsedSize, size)`，`setCollapsed(false)` 与 Enter 回到同一个宽度。按比例分的节点给 `wrong-sizing`：它的意图是份额，没有像素可设。改的是活树，规则同 `setCollapsed`。`find(id).size` 读到的是意图，不是呈现。

宿主保存手势开始时的布局；上下文或容器变化后应取消旧手势。`NestedGrid` 的 `gesture-end` 只告诉宿主一次手势结束了：它在提交回调之前发，宿主拒绝或没接回调时也发，不要在它里面改树或保存。一次完整的 px 提交（含主动节点列表）经 `onGestureCommit` 同步交给宿主，宿主用 `resizeBranches` 一次落账；落账成功之后再按自身产品规则保存主动偏好，用 `useGridHost` 的 `onApplied`，自己写宿主的就在同样的成功路径上。取消、挂载、测量和窗口变化不保存意图。

拖动求解（`sash-drag`）的边界只读冻结的按下基线：指针位移是**相对按下位置的绝对总量**，理想边界 = `baselineBoundary + deltaPx`，吸附与展开只改约束状态、不用记忆尺寸重锚几何，因此同一个指针位置永远对应同一条边界与同一组收起状态，过冲不会留下永久偏移。兄弟之间的分配从上一帧解出的尺寸出发（首帧是基线，经 `snapState.sizesPx` 逐帧串下去）：先把每个兄弟夹进它当前的 bounds，再按两侧目标总量由近到远补偿，结果逐叶合法且全分支守恒；掉头往回拖时先动挨着分隔条的面板，已被推开的兄弟留在被推到的地方，和拖一段松手再拖一样，同一方向分几帧到达结果不变。手势中途做显式折叠、恢复的调用方要把它的结果写进 `snapState.sizesPx`；约束装不下总量时给诊断并保持基线，不产出半更新。收起判定同样只看理想尺寸：低于 `minimum − collapseThreshold` 吸附到 `collapsedSize`，回到 `max(minimum, collapsedSize + expandThreshold)` 且容量允许时展开（用理想边界）；记忆的 `restoreSize` 只服务按钮 / `Enter` 的显式恢复；策略带 `restoreToShare` 时显式恢复不读它，回到这块按 `size` 权重此刻该得的那一份（给没有像素记忆、按比例分的面板；`resizeBranches` 反解权重时不保份额，只用 grid 自己落账的宿主不要打开）。会话提交的就是最后发布的那份几何，`finish` 不拿最后一次位移重解。收起意图对哪种叶都生效：`sizing` 为 weight 的余量叶也可以带 `collapse`，被拖到底时吸附成 `collapsedSize`、拖回来时展开，宿主用它表达“把另一侧拖到顶”。这种叶通常再标 `toggleable: false`：分隔条上的 `Enter` 与显式切换跳过它，仍作用于另一侧原来那个可收起的面板；独立 `Splitter` 同样遵守。它只决定会话挑哪一侧做显式切换。两侧都可收起时，同一帧里一侧展开、另一侧收起会在一次求解里一起完成（判定重复到不再变化），结果不取决于位移分几帧到达。

## 拆分叶

`splitLeaf(targetId, split)` 把一个叶原位拆成新分支，`split` 是 `GridSplitInput<T>`：`{branchId, orientation, side, leaf, ratio?}`，`branchId` 是新分支的 id，`leaf` 是新叶的输入（`GridLeafInput` 去掉 `size`，尺寸由 `ratio` 定），`ratio` 是新叶的份额，缺省 `0.5`，必须有限且严格介于 0 与 1。新分支继承目标叶的外部分配意图，目标叶与新叶按 `ratio` 分掉**目标在新轴上的意图**；新轴意图为 0 时以 1 为分配基数，仍按 `ratio` 拆，不会塌成 0。参数只有 `ratio`，不开放 `size`：否则初始意图会有两个 authority，测得的 px 还会被当成权重。

`split` 用几何词汇表达位置与方向：`orientation` 是分配轴，`side` 是 `before`（左/上）或 `after`（右/下）；`left/top → before`、`right/bottom → after` 的宿主词汇映射留在交互层。新分支与新叶的 id 由宿主保证唯一；未知目标、非叶目标、重复 id、非法比例、超过 256 节点或 16 层深度都失败且不改树。深度的计法与快照恢复差一层（已知问题）：结构操作把根算第 1 层，16 层的目标再拆一层被拒；恢复从 0 数起，17 层的快照能恢复，18 层才拒。删除与移动继续复用 `removeLeaf` / `moveLeaf`，手势提交继续复用 `resizeBranches`。

## 渲染与投影

`NestedGrid` 把叶与分隔线放在同一父元素下，矩形来自 `placeGrid`（`grid-rects.ts`，相对 grid 根的 CSS px，沿主轴按设备像素累加）。几何只有 px 一种口径，`buildGridBranchPanels` 只是把布局投影成分隔线 aria 要的面板配置，数值算法在 `grid-geometry` / `sash-drag`。`NestedGrid` 独占一份 `useSashGesture` 会话：拖动中发布 `preview`，松手把一次 `GridGestureCommit` 交给宿主的 `onGestureCommit`，由宿主用 `resizeBranches` 原子落账。

## 布局文档

工作台的布局文档（用户的布局、到呈现树的投影、落点规则）不在本包，在 [`@notnotype/nb-workbench-layout`](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workbench-layout/README.md#布局文档)：它只经本包的公开入口建在 `createGrid` 之上（[ADR 0054](https://github.com/notnotype/neuro-book/blob/master/docs/adr/0054-nb-layout-general-library.md)）。

## 快照与引用

v2 快照只保存结构、方向、稳定 id/ref 和两轴尺寸意图，不保存运行约束。恢复先完整校验，再一次发布；当前树或 `resolveRef` 提供当前约束。未知引用过滤结果单独报告，宿主保留原记录；过滤后的 `serialize()` 不是无损替代。

字符串 ref 默认原样编码；对象等非字符串 ref 必须在 `createGrid` options 中提供 `encodeRef: (ref) => string`，并由恢复解析器把该稳定 key 还原为对象。编码器须给不同身份分配稳定且可区分的非空 key；原语不使用 `String(object)` 推测身份。

v1 无法可靠推导两轴意图，明确拒绝；未知高版本、重复 id、非法方向/尺寸/children、超过 256 节点或深度超限也整体拒绝（深度从 0 数起，17 层的快照还能恢复，见“拆分叶”的已知问题）。宿主保留原件并禁止自动保存默认布局覆盖它。

## 结构操作

`addLeaf` / `removeLeaf` / `moveLeaf` / `splitLeaf`；同分支重排不触发塌陷；跨分支的 `moveLeaf` 先做完全部检查（含规模守卫），再直接在树上改，失败的移动不动树。失败不留下被移除的半棵树，也不改快照。

增删与移动不改兄弟的意图（见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“结构操作与 resize 不改兄弟的意图”一条）：保留像素的兄弟宽度不变，按比例分的兄弟按份额重分，空出或多出的空间由按比例分且没收起的兄弟吸收，没有就留白（诊断 `unabsorbed-space`）。

- **按比例分的新叶不给意图**（`size` 省略或主轴为 0）：取这一支里不是保留像素的兄弟（收起中的也算）的正意图的平均，即平分一份；这些兄弟的意图全是 0 时取 0，和它们一起均分；没有这样的兄弟时取 1。给了就照用，单位同兄弟：兄弟是 600、新叶给 400，新叶拿 400/1000，不是 400 像素。要等分就别给。
- **`moveLeaf` 跨分支**：按比例分的节点到了别的分支，意图按新叶重取目标分支的平均，不带来源分支的单位；保留像素的节点移到同向的分支意图不变。保留像素的节点移到方向不同的分支失败（`invalid-argument`，`field: "fixed-cross-axis"`）：它的意图只对父分支主轴有意义，换方向后宽度没有来处。要换方向就 `removeLeaf` 再 `addLeaf` 并给新方向的意图，叶上的收起状态由宿主带过去。

### 已知限制

- **展平**：`removeLeaf` 删到只剩一个孩子、或跨分支 `moveLeaf` 把来源分支移到只剩一个孩子时，分支被它的孩子替换。分支的 id 没了（`find` 得 `null`），分支的约束与收起策略丢掉；留下的节点拿到分支的 `size`，按它自己的 `sizing` 重新解释这个数：保留像素 240 的分支里剩下一块按比例分的叶，它变成份额 240，按兄弟的份额重分，不再是 240 像素。宿主要一组栏常在（例如一列可增删的面板），就保留至少两个孩子，或从自己的记录重建网格（工作台的做法）。
- **拆分保留像素的叶**：`splitLeaf` 的新分支按比例分、没有约束，目标叶仍保留像素、落进新方向，没有诊断。例如 1200×600 的横排 `[导航 保留像素 188（最小 150）, main 600, side 300]` 里竖着拆导航：新分支的 188 成了份额，宽约 207，导航的高只剩约 1，新叶占了约 600。要在保留像素的一栏里加一块，先建好分支（建树或重建），不要拆那块叶。
- **`moveLeaf` 的深度判定偏保守**：规模守卫与 `addLeaf` 同一个公式，按移动前的树判深度（节点数不变，叶移进目标后的深度不超过 16 层）。来源分支因此塌陷、移动后其实变浅的移动，在目标已经在第 16 层时也会被拒（`limit-exceeded`），树不变。
- **没有能吸收空间的兄弟**：一个分支里只有保留像素的兄弟，或按比例分的全收起了，增删之后有空就留白（`unabsorbed-space`），放不下就按已有规则压缩。

`find(id)` 是只读查找（宿主读身份与意图用）；改动仍走结构操作，直接改写节点会绕过守恒与规模判定。

行为见 [`docs/specs/ui/nested-grid.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md)，能力仍为 planned：宿主一侧的持久化（Storage 宿主、同名叶的恢复地址隔离、双标签订阅）还没有闭合。
