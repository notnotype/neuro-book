# 变更记录

`@notnotype/nb-layout` 每个版本里使用方看得到的变化，写给直接用这个包的人。怎么写见[发布手册的“写变更记录”](../../docs/standards/releasing.md#写变更记录)。变更记录不进 npm 包。

## [Unreleased]

### 新增

- `SplitterPanelConfig.overflow`：写 `"visible"` 时这块面板不裁切内容，内容可以伸到相邻面板上面（收起的栏里拉出的抽屉）；缺省 `"hidden"`，行为不变。
- 开发模式的配置检查（`setLayoutDevChecks`）多了两条：`useGridHost` 没给 `onIssues`（诊断与被拒的提交会被丢掉）时建立时警告一次；`NestedGrid` 的 `dragging` 变真时布局过渡还在走（起拖时没调 `settleMotion()`）时警告一次。库仍不把诊断本身打到控制台。

### 改动

- `createLiveDragSession` 在键盘拖动、`live` 返回 null 的起拖时也把网格的过渡送到终点（`settleMotion`），不只在实时布局开始时：落点指示与键盘拖动的判定量到的是终点的矩形，代价是进行中的过渡会直接跳到终点。

### 修复

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
