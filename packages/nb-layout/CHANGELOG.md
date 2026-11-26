# 变更记录

`@notnotype/nb-layout` 每个版本里使用方看得到的变化，写给直接用这个包的人。怎么写见[发布手册的“写变更记录”](../../docs/standards/releasing.md#写变更记录)。变更记录不进 npm 包。

## [Unreleased]

## [0.3.0] - 2026-11-26

### 不兼容的改动

- `splitLeaf` 的方向与目标叶的父分支相同时，新叶并进这个父分支、挨着目标，不再新建一层分支：树不再越拆越深，呈现与以前一样把目标那份分开（只差分隔线的分摊，不到 2px）。`branchId` 照样必填、查重，但这时树里没有这个分支：同向拆分之后按 `branchId` 找新分支的宿主要改成按叶找；父分支的孩子多了一个，之后按序号调 `addLeaf`、`moveLeaf` 要按新的孩子数算，分隔线 `data-sash` 的序号随之后移（元素身份按两侧节点认，过渡不受影响）。
- 拆分保留像素（`sizing: "fixed"`）的叶返回 `wrong-sizing`（`expected: "weight"`），树不变；以前会把像素当份额拆，画出来不对。
- 快照恢复的层数改成根算第 1 层，与结构操作相同：17 层的快照以前能恢复，现在 `limit-exceeded`。
- 删到或移到根分支只剩一块保留像素或带收起策略的节点时，根分支留着，不再展平成这一块：保留像素的照旧是它的宽度，余下留白并报 `unabsorbed-space`；以前这块会占满容器、收起策略也用不了。
- 网格节点的收起策略（`SashCollapsePolicy`、`SashCollapseState`）去掉 `restoreSize` 与 `restoreToShare`：没有类型检查的宿主照写也不报错，建树、恢复与 `clone` 时不进节点。独立 `Splitter` 的面板配置照旧要 `restoreSize`，`SplitterPanelConfig.collapse` 的类型改成新导出的 `SplitterCollapseState`（`SashCollapseState` 加 `restoreSize`）。
- 网格的节点展开回到意图：`setCollapsed(id, false)`、分隔条上的 Enter 与区段按钮都不再读收起策略的 `restoreSize`、`restoreToShare`，收起时网格也不再改写 `restoreSize`。分隔条上的 Enter 能翻时结果和 `setCollapsed` 相同：按比例分的兄弟按份额吸收与让出，不再由隔着分隔条的邻居独自让位；翻了之后放不下时不展开（`no-room-to-restore`），让出的空间没人吸收时不收起（`no-room-to-collapse`）。`setSize` 改收起中的节点也只改意图，`changed` 只看意图。
- `useGridHost` 的 `onApplied` 改成 `(change, before)`：`change.kind` 是 `"gesture"`（带 `commit`、`result`）、`"collapse"` 或 `"size"`（带 `id`、`result`），三种都带 `collapsed`（这次翻了收起标记的节点）。以前的 `(commit, result, before)` 要改成先判 `change.kind === "gesture"`，再读 `change.commit`、`change.result`；只存档、不读参数的写法不用改。

### 新增

- `grid.clone()`：复制一份独立的网格，连同约束、`sizing`、收起策略与状态，以及建网格时的 `sashSize`、`encodeRef`（取建网格那一刻的，之后改传进去的选项对象不影响原网格与副本）；叶的 `ref` 是同一个对象。用来先在副本上试做一次结构操作、读结果与布局。
- `restoreGrid(快照, 解析引用, 选项)` 与类型 `GridRestoredGrid`：从快照建一份新网格，失败时结果里没有 `grid`。原地的 `grid.restore` 照旧可用。
- `GridSplitInput.ratio` 可以写 `"even"`：同向并入时新叶与这一排的兄弟平分（等于 `addLeaf` 不给意图），新建分支时等于 `0.5`。
- 收起策略的 `locked: true` 锁住收起状态：拖动收不了也拉不开，分隔条上的 Enter 跳过它（作用于另一侧），`resizeBranches` 要翻它时整批失败，新失败码 `collapse-locked`（`params` 是 `id`、`branch`）；独立 `Splitter` 同样遵守。只有宿主经 `setCollapsed` 翻它；`setCollapsed` 多了第三个参数 `GridCollapseOptions`，`locked` 同时改锁、不给时锁不变，`changed` 是收起标记或锁有没有变。
- 保留像素的节点可以标 `rigid: true`（叶与分支的建树输入、`GridRefResolution` 都能给）：沿父分支主轴的最小与最大都是它的意图（先夹进声明的最小与最大），拖动推过它时位移传给更远的兄弟、它不变；最小尺寸之和放不下时先按比例压别的，它最后才让，刚性的之和也放不下时只在它们之间按比例压，诊断照旧是 `min-total`。交叉轴不受影响；按比例分的节点标了不起作用；`setSize` 照样能改它；和 `sizing` 一样不进快照，恢复时解析结果优先、其次当前树。只认这个标记：最小等于最大、不标的节点行为不变。
- `SplitterPanelConfig.overflow`：写 `"visible"` 时这块面板不裁切内容，内容可以伸到相邻面板上面（收起的栏里拉出的抽屉）；缺省 `"hidden"`，行为不变。
- 开发模式的配置检查（`setLayoutDevChecks`）多了两条：`useGridHost` 没给 `onIssues`（诊断与被拒的提交会被丢掉）时建立时警告一次；`NestedGrid` 的 `dragging` 变真时布局过渡还在走（起拖时没调 `settleMotion()`）时警告一次。库仍不把诊断本身打到控制台。
- `useGridHost` 的 `setSize(id, px)`：调 `grid.setSize`，意图变了时重发布局并通知 `onApplied`（`kind: "size"`），没变时版本不变；没有网格时 `not-ready`。`setCollapsed` 多了第三个参数，同 `grid.setCollapsed`。`onApplied` 第一个参数的类型 `GridHostChange` 从 `./vue` 导出。

### 改动

- `resizeBranches` 落账保住意图：一个分支应用了这次的收起变化之后，用现有意图布局就得出目标时，意图一个也不改；否则照旧反解，反解后这个分支里还有收起着的按比例分的孩子时，展开着的按比例分的孩子按同一倍数缩回落账前的和，收起着的那块展开时拿回收起前的份额。
- `createLiveDragSession` 在键盘拖动、`live` 返回 null 的起拖时也把网格的过渡送到终点（`settleMotion`），不只在实时布局开始时：落点指示与键盘拖动的判定量到的是终点的矩形，代价是进行中的过渡会直接跳到终点。
- `useGridHost` 的 `setCollapsed` 在标记或锁变了时也通知 `onApplied`（`kind: "collapse"`），存档只接这一处；以前要在调用之后另存一次。宿主直接改 `grid.*` 再 `invalidate()` 的照旧不通知。`onApplied` 抛出时的 `notify-failed` 消息改成 “The change was applied, but the host's onApplied threw: …”；`host.setCollapsed` 落账后的布局诊断与这条通知，宿主的 `onIssues` 抛出时也像手势那样被接住、交给 `reportError`，不再冒到调用方。

### 修复

- 窄窗口里经分隔条的 Enter 收起或展开，会把被压缩的保留像素兄弟的意图写成压缩后的宽度，放宽后回不到原宽：现在只翻标记，意图不变。
- 经 `createGrid` 建进来的树已经超过 16 层时，浅处的插入、拆分与移动不再被规模上限拒绝：规模守卫只判这次新造出来的那一处，深处照旧被拒。
- `Splitter` 的预览回到手势开始时的样子（拖过收起的门槛又拖回来）时没有发 `gesture-update`，跟着预览换内容的宿主停在上一次的状态：现在补发一次，带开始时的尺寸。

## [0.2.0] - 2026-11-23

### 不兼容的改动

- 删掉 `Grid.resize`、`Grid.resizeBranch` 与它们的结果类型 `GridResizeResult`、`GridBranchResizeResult`：改用 `resizeBranches`（单个分支就传一项）。
- 删掉 `GridGestureSession.setCollapsed`：键盘收起与展开用 `toggleCollapsed`。
- `createLiveDragSession`、`useLiveDragSession` 的 `live` 回调只收 `source`：键盘拖动本来就不问它，以前的第二个参数总是 `false`。
- `useLiveDragSession` 不再返回 `session`、`live`，`LiveDragSessionRefs` 只剩两个类型参数；要状态读 `state`、`liveState`。
- 根入口不再导出实时布局的内部零件：`createDragCard`、`createFrameLoop`、`initialLiveDrop`、`stepLiveDrop`、`insideShownSlot`、`solveSashCollapse` 与类型 `DragCard`、`DragCardFrame`、`DragCardOptions`、`FrameLoop`、`FrameLoopOptions`、`LiveDropCandidate`、`LiveDropState`。拖动里的实时布局用 `createLiveDragSession`。
- 删掉 `resolveGridInsertion` 与类型 `GridInsertion`：列表的插入位用 `resolveListInsertion`。

### 改动

- `NestedGrid` 的 `sashKind`、`sashStyle`、`paneLabel` 每次重算每条线只问一次（布局、回调读的响应式状态或回调本身变了才重算），不再每次渲染都问。

### 修复

- `moveLeaf` 与 `addLeaf`、`splitLeaf` 一样查规模上限：会超过 256 个节点或 16 层时返回 `limit-exceeded`，树不变。

## [0.1.0] - 2026-11-23

### 不兼容的改动

- 没有注入文字时，组件的读屏名称与提示用英文（以前是中文）。中文宿主注入 `zh-CN` 目录，见 README 的“文字”。

### 新增

- 第一次发到 npm：编译产物（ES 模块、类型声明、`style.css`），许可证 MIT。宿主是 Vue 3 加 Vite，要自己导入 `@notnotype/nb-layout/style.css`；对等依赖只有 `vue`。
- `layoutCatalogTranslate`（`@notnotype/nb-layout/text`）：只有一种语言、没有翻译引擎的宿主按自带目录注入文字。
- 公开名字都带稳定性标注，0.x 期间全部是 `@experimental`（编辑器悬停可见）；README 的“版本承诺”写了 `@stable` 的条件与它承诺什么。
- 实时布局的拖动会话 `createLiveDragSession` 与组件版 `useLiveDragSession`（`./vue`）：候选稳定才换预览、来源收起与展开、判定几何的冻结与换算、收起那一刻指针不动不重判、空位粘住、拿起的内容做成卡片跟手、一帧里先读后写，宿主只写落点与预览（类型 `LiveDragHost`、`LiveDragState`、`LiveDropFacts`、`LiveShowTarget`、`LiveGrid` 等）。`@experimental`，1.0 之前签名会变。
- 拖动会话的选项 `sampled`：会话的 `pointermove` 处理一开头调，按需排帧的循环在这里叫醒，不用另挂一个要抢在会话前面的监听。
- `NestedGrid`：拿起的内容项不在 `contents` 里时网格自己留住它（实例不卸载）；expose 加 `origin()`、`motionMs()`。
