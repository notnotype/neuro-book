# nb-layout 58 条摩擦复查（master d9bcd4ee6，nb-layout 0.3.0）

| 编号 | 判定 | 证据（一两句，带文件:行或探针结果） | 还剩什么 |
|---|---|---|---|
| 1 | 部分解决 | `grid.clone()`（grid.ts:104、756）加 README“我要做 X”表一行、grid.md“复制与试做”写了做法；探针 structure.test.ts：`splitLeaf` 拆到放不下仍 `{ok:true}`，`layout().issues` 4 条 `over-constrained`，Grid 上没有 `canSplit`（Object.keys 无）。示例 `TabbedLayout.canSplit`（model.ts:~165）、`DesktopLayout.previewTile`（desktop model.ts:284-291）仍是“副本上做一遍、读 issues、与原网格比”共约 8 行 | “放不下就拒绝”的选项与 `canSplit` 是 t58 plan 技术选型有意不做（理由：试做是组合操作、要读布局违背“结构操作不读布局”、“这次才放不下”是宿主规则）；两个示例 README 仍写“库没有试拆”类旧话（见 2） |
| 2 | 部分解决 | `grid.clone()` 带 sizing、minimumSize、collapse 一起复制（探针：clone 后 `find("f")` 仍是 fixed、有 minimumSize 与 collapse）；两示例 `clone()` 一行 `this.grid.clone()`。快照仍不带策略：探针 `restoreGrid(快照, ref=>({ref}))` 成功、`f` 变回按比例分、minimumSize 0、layout 无任何 issue | 快照不带策略是 t58 plan 待确认 2 有意不做（ADR 0054 第 10 条、Spec“副作用与数据”）；读档漏给策略仍无诊断；tabbed-panels/README.md:25 与 desktop/README.md:27 仍写“库没有 `grid.clone()`”，已过时 |
| 6 | 已解决 | `collapse()` 在根且幸存者保留像素或带收起策略时不展平（grid.ts:195-203）；探针：删掉 `e` 后 root 仍是分支、`find("root")` 非空、f 宽 240、issues 为 `unabsorbed-space`，不再占满 | 示例的“最后一个标签不能关”规则保留（TabBar/model.ts:117 `canClose`），但注释“会被拉满整个宽度”与 tabbed-panels/README.md:28 已与库行为不符（过时说明，规则本身的产品理由是“存档回不到有编组的样子”） |
| 7 | 已解决 | 同向 `splitLeaf` 并进父分支（grid.ts:~600，grid.md:69）；探针：连续 39 次同向拆分全部成功不到 16 层上限；展平丢分支约束仍是 grid.md:118 的已知限制 | 中间分支展平丢约束仍在（已知限制，t58 待确认 4 有意只管根）；tabbed-panels/README.md:26 仍写“同向拆分会造出同向嵌套的分支”，过时 |
| 15 | 已解决 | 桌面 `applyTile` 只调一次 `splitLeaf(..., ratio:"even")`（desktop model.ts:303-305）；探针：二扇平铺后 w1、desk、w2 都是 397.33（三等分，不再 602/299/299） | 删叶后兄弟份额跳变这半句没单独验证；中间分支展平改份额仍是已知限制 |
| 20 | 已解决 | 快照恢复与结构操作都按“根算第 1 层，最多 16 层”（grid-snapshot.ts 从 1 起、grid.md:81、105）；探针：16 层快照可恢复、17 层 `limit-exceeded`，16 层树深处再拆报 `Nesting too deep: 17 > 16`，与恢复一致；`createGrid` 仍不查（已写进 grid.md:121） | 无 |
| 27 | 已解决 | 同向、异向都用一个 `splitLeaf`（grid.md:65-72）；探针：删掉 w1 后 t1 分支被展平消失，再同样调用 `splitLeaf("desk",{branchId:"t1",…})` 仍成功，宿主不用按父形状选 `addLeaf`/`splitLeaf`；示例 applyTile 的“先拆后删”只剩原子性理由（desktop model.ts:301-302） | desktop/README.md:30 仍写“removeLeaf 会把只剩一个孩子的分支展平：同一侧换窗时先加新的、再删旧的”，作为库空缺已过时 |
| 31 | 已解决 | `restoreGrid`（grid.ts:155-158）失败时结果没有 `grid`（探针：`{ok:false}`，`"grid" in r` 为 false）；README 约定一节与 grid.md:101 推荐它；原地 `grid.restore` 保留，仍可忽略结果 | 无（`createGrid(null)`+`restore` 的旧写法仍可用，说明里已改推荐新写法） |
| 4 | 已解决 | `host.setCollapsed`、`host.setSize` 与手势共用 `applyAndNotify`（useGridLayout.ts:181、useGridHost.ts:94）；探针 host.test.ts：`setCollapsed`、`setSize` 各触发一次 `onApplied`（kind 为 `collapse`、`size`），`invalidate()` 与无变化不触发。tabbed-panels App.vue:96-99 已删掉“另调一次保存” | 无（直接调 `grid.setCollapsed` 再 `invalidate()` 的路径仍不通知，ide 示例是这样做并自己 `persist()`，文档已写） |
| 17 | 有意不做 | 收起到 0 旁边仍两条线：探针 `sashSize:4` 时 `sashSizes` 为 `[4,4]`；宿主可用函数形式 `sashSize:(branch,index)=>…` 给 0（探针 `[0,4]`）。grid.md:56 写明做法；t59 plan“不做”第一条：工作台输出 11、12 要求拖到零后边界还留着能拉回 | ide 示例的 `sashSize`（ide model.ts:~20）靠“分支 id 加序号”写死（`main` 的第 0、3 条与 `root`），与第 16 条同类的结构耦合，树形变了要同改；库没有“按叶给线宽”的写法 |
| 19 | 部分解决 | `restoreSize` 已从网格策略里删（grid.md:39；`normCollapse` 忽略多余字段，grid-geometry.ts:331）：宽度来自快照里的意图，tabbed-panels 的 `ExplorerState` 只剩 `{collapsed}`，ide 存意图加收起。探针 19：快照只有结构与 size，不含收起策略 | 收起策略与 `collapsed` 仍不进快照，宿主另存再经 `restoreGrid` 的解析函数给回（t59 plan 待确认 4：不改快照格式，留 t58 的“快照带策略”，t58 待确认 2 又定不做）。重载后收起状态仍要靠宿主 |
| 35 | 已解决 | 展开只回意图：探针（策略里塞 `restoreSize:333`，意图 400）`setCollapsed(false)` 得 400，分隔条 Enter（`createGridGestureSession.toggleCollapsed`）也得 400；策略对象里已没有 `restoreSize` 键（Object.keys 为 collapsedSize、阈值、collapsed） | 无 |
| 41 | 已解决 | `restoreSize` 从网格策略删除；ide `fromSaved` 直接 `buildTree(zones)`，不再 `setSize` 再 `setCollapsed`（ide model.ts:~277-282）。探针：Enter 收起再展开意图始终 400 | 无（旧存档里的 `restoreSize` 字段被忽略、不报错） |
| 42 | 已解决 | 策略 `locked: true`（grid.md:52）：探针锁住的收起叶上 Enter 无提交（`no-commit`），`setCollapsed(f,false,{locked:false})` 展开并解锁；`onApplied(change)` 带 `change.collapsed`（useGridHost.md:61-67）。ide 的 `reconcile` 兜底收回逻辑已删，`setCollapsed(zone,collapsed,{locked})`（ide model.ts:~237） | 锁不停用分隔线（grid.md:52），ide 仍要 `sashDisabled`（`sashLocked`）去掉拖动光标与读屏的“可调”，即“两层”还剩一层，但只管外观 |
| 45 | 已解决 | 保留像素的节点标 `rigid: true`（grid.md:15）：探针右区拖 +900，不标时右条 28→0，标了仍是 28；ide `stripeLeaf` 只写 `rigid:true`，不再写最小最大各一遍（ide model.ts:~88） | `rigid` 要宿主显式标；不标仍被压到 0，不标时库不报诊断；工作台的活动栏、状态栏没标（t59 待确认 5，有意不做） |
| 47 | 已解决 | `useGridHost` 有 `setSize`（useGridHost.ts:74、166，useGridHost.md:24），探针里改了意图就重发布局并通知 `onApplied`；“restoreSize 的规则分散三处”随删除消失，规则集中在 grid.md“收起与展开”一节 | 无 |
| 55 | 已解决 | `rigid` 在放不下时最后才让（grid.md:15）：探针 520 宽（总最小 ≈ 684）时不标 rigid 的条 28→22.75、有 rigid 的保持 28，别的叶被压，issue 仍是 `over-constrained`；ide README 的窄窗口一条已改成“刚性的条最后才让” | `over-constrained` 诊断仍不说哪些叶被压了（候选里的第二半没做）；不标 rigid 的条与最小等于最大的叶照旧一起压（grid.md:15 写明） |
| 56 | 已解决 | grid.md:29-56 新写“收起与展开”一节：三个入口、展开回意图、落账保住意图、锁、存档存什么、分隔线、已知限制；Splitter 的 `restoreSize` 另说（grid.md:39） | 无 |
| 26 | 已解决 | 行为没改（根、外框、内容不接焦点），说明补了：NestedGrid.md:121“点在空白处焦点落到 body，挂在根上的快捷键收不到；挂 window 或给承载盒 tabindex=-1”，t57 plan 定为只改说明。三个示例仍把快捷键挂 window | 绕法（挂 window）还在，是说明认可的写法，不是缺口；网格外框可聚焦的候选没做 |
| 29 | 部分解决 | `NestedGrid` 加 sync 侦听：`dragging` 变真时过渡还在走就开发警告一次（NestedGrid.vue:525-527，dev-checks.dom.test.ts:405-436）；`createLiveDragSession` 起拖自己 `settleMotion`（live-drag-session.ts:6）；drag-session.md:41 写明。示例的 `useDragSession.activate` 仍要自己调（tabbed-panels App.vue:167、ide :223、desktop :241） | 普通 `useDragSession` 没和网格连起来，仍靠宿主记得调；检查只在宿主把 `dragging` 交给 `NestedGrid` 时才查得到（drag-session.md:41 已写） |
| 30 | 已解决 | 只补说明（t57 plan 有意不改行为）：useGridHost.md:51-55 列出哪些操作要调 `invalidate()`、哪些不用、为什么不要每次都调（版本递增取消手势）。desktop App.vue:93 对“没碰树的操作”已不调 | 每次点标签仍整张重算：tabbed-panels `settle` 一律 `host.invalidate()`（App.vue:73），库没给不重算的路径；影响小 |
| 34 | 有意不做 | t57 plan 待确认 3 决定不加检查，只改说明：drag-session.md:33、README:189 写明 `data-drag-feedback` 的用处，并说明 `pointer-events:none` 的元素本来不在浏览器命中里 | 忘标且反馈元素接指针时仍无诊断；库自带反馈组件都是 `pointer-events:none`，所以只有自画的接指针反馈会踩 |
| 36 | 已解决 | drag-session.md:43-52 写了收场先后（`onEnd` 在 `commit` 之前，源码 drag-gesture.ts:263-264）与 `actionKey` 为 null 时以 `no-action` 结束、不调 `commit`、`placeFloat` 的副作用要自己撤，及 `commitsUnderPointer` 的出路 | 无 |
| 37 | 已解决 | drag-session.md:39 写出 6px、触摸 200ms 长按、期间移动不超过 6px，缺省值 `DRAG_GESTURE_DEFAULTS`（drag-gesture.ts:22 为 6、200、6，吻合），e2e 要先移过门槛 | 无 |
| 54 | 已解决 | drag-session.md:54 写了 click 被发给根、会话在根的捕获阶段吞掉末尾 click（drag-session.ts:314）、两层保护各自足以让按钮收不到、测试只能断言“动作没发生” | 测试仍难设计（只能整体断言），说明认可这是预期 |
| 57 | 已解决 | 没给 `onIssues` 时 `useGridHost` 在开发检查打开时警告一次“没有出口”（useGridHost.ts:123，dev-checks.dom.test.ts:358-373）；README 起步例子带 `onIssues`（README:68-74）；三个示例都接了 `onIssues`，并在 main.ts 里 `setLayoutDevChecks(import.meta.env.DEV)` | 库仍不把诊断本身打到控制台（t57 plan 待确认 4：缺省打印会绕过宿主出口）；开发检查默认关，要宿主自己打开 |
| 5 | 已解决 | 说明补了：NestedGrid.md:57-69 写明 `leave:"retain"` 留着时宿主数据已删、插槽里的组件仍按响应式更新、要经属性交数据，给出 `<CardBody :card>` 写法与 `content-parked` 的 key 是刚删的；库补了一条报错（frozen-slot.ts:36，NestedGrid.dom.test.ts:2455）；README:138 表格行链到它。示例 TabPanel.vue 按属性取数据 | 不接 `content-parked`、焦点自己给的绕法仍在（说明认可）；“内容层给离开中标记”已有 `data-content-leaving`（NestedGrid.md:157） |
| 10 | 已解决 | FloatWindowHandles.md:4-9 去掉对工作台 Spec 的链接，写出“页面里的窗、不是 OS 窗口、`floats` 里的叶、本组件只管缩放与键盘移动” | 同类残留：t56 记的 `DropSectorsOverlay.md` 开头仍链工作台 Spec、`sortable.ts` 的 JSDoc 引工作台 Spec 编号（不在 58 条内） |
| 14 | 已解决 | README:153 表格行“把浮动窗的矩形夹进一块区域、按手柄改尺寸 \| `clampFloatRect`、`resizeFloatRect`”，FloatWindowHandles.md:11 也提 | 行里同时写明它们“只收尺寸、从 0 开始”，即第 23、24 条的限制仍在（见 23、24） |
| 16 | 部分解决 | NestedGrid.md:92-99 新写“分隔线的身份”：`before`/`after` 是直接孩子、可能是分支 id、结构变会变，推荐按不变的一侧判（`before===“files”\|\|after===“files”`）；ide `sashLocked` 就是这样写（ide App.vue:139、model.ts `sashLocked`）。回调形状没改 | 回调直接给挨着线的叶（t56 记的“没做的候选 16”）没做；要靠 `grid.find(id)` 往下找叶才能判另一侧 |
| 18 | 已解决 | NestedGrid.md:106-113“最大化”写明：盖的是除 `exclude` 外全部叶的外接矩形，`exclude` 的叶只有落在矩形之外才露出，要留的条放在最外一层一头，被罩住的 `exclude` 叶也不加 `inert`；ide 示例把下条放在 main 外面并注明理由（ide model.ts:~93-96） | `exclude` 叶被外接矩形罩住时看不见却不加 `inert`、Tab 走得到（t56 没做的候选），说明里已写这个事实 |
| 21 | 已解决 | NestedGrid.md:21-25 写清：内容外层 `data-content` 与外框 `data-leaf` 是兄弟不是父子；叶的正文区域 = 叶矩形去掉 `insetTop`（宽相同、上边下移、高减），不读 DOM 时用 `placeGrid` 的叶矩形照这条减；同一叶多项内容按 `data-content-leaf` 取到几个，要挑活动的 | 库仍不直接交“正文区域”的矩形，宿主自己减 `insetTop`（说明里给了公式） |
| 22 | 已解决 | DropFeedbackOverlay.md:21 写明同一句文案在 DOM 里两份（药丸 `data-drop-feedback-label` 与播报 `data-drop-feedback-live`），按文字定位要限定在其中一个标记下 | 无（live 区域没加可区分的结构，只靠标记区分） |
| 32 | 部分解决 | 说明写出了不一致：NestedGrid.md:56“把内容全部挪到别的叶、同一轮删掉这块叶时，这块叶也一帧消失……‘关掉最后一个标签’有缩回去的过渡，‘挪走最后一个标签’没有”。行为没改 | 同一个视觉操作两种动画仍在（t56 没做的候选 32）；该动画差异未在浏览器验证（本复查不起服务） |
| 33 | 已解决 | NestedGrid.md:27-46 新写“内容的停放与 content-parked”：停放的七种情况与 `content-parked` 只在焦点在内容里时发，以及不发的六种情形（面板头按钮、不用内容层、没标 retain 的去掉、换叶、手势预览中、被拿起） | 无 |
| 40 | 已解决 | NestedGrid.md:101-104 写明 `sashDisabled` 不进缓存表、每次渲染都调，读响应式状态会跟着重渲染，读普通变量要宿主让网格重绘（如 `host.invalidate()`）；NestedGrid.vue:196 JSDoc 同步 | 与 `sashKind`/`sashStyle`/`paneLabel` 进缓存表的口径不一致仍在（t56 没做的候选），只靠说明区分 |
| 43 | 已解决 | NestedGrid.md:96-97、:159 写明 `data-sash` 为 `分支 id:序号`（序号从 0 起、是线前孩子的下标、收起的孩子也占下标）、`paneLabel` 对分支也会被问、返回 `undefined` 时念分支 id；SashHandle.vue:283 与 dev-checks.dom.test.ts:46 的 `root:0` 吻合 | e2e 仍要先知道树的分支 id；t58 并入同向拆分会让序号后移，已写进 grid.md:69 |
| 44 | 已解决 | NestedGrid.md:41 写明面板头上的按钮（`leaf` 插槽里）收起面板时按下时焦点在按钮上、不发 `content-parked`，处理里自己给焦点；与第 33 条合并成同一节 | 无 |
| 46 | 部分解决 | NestedGrid.md:15 写明：载入时就是零的叶，`leaf` 插槽的内容容器不停放（里面可聚焦元素仍在 Tab 序），内容层的项量到容器后就停放；t56 核实后纠正“只对 `leaf` 插槽成立”。ide 示例仍绕开：收着的区不画面板头按钮（ide/README.md 第 4 条） | “零尺寸的叶一律停放”（t56 没做的候选）没做；`leaf` 插槽路径的宿主仍要自己兜 |
| 3 | 没解决 | grid-drop.ts 自 t50 后没改（git log 无提交）；探针 sortable.test.ts：容器 0..300、a b c 可见、d e 已滚出，指针在最后一个可见标签 c 后半，`resolveListInsertion` 交回 `beforeId:null`（追加），线贴 c 的后缘，实际会插到隐藏的 d、e 之后 | 滚动标签条仍不能用；tabbed-panels/README.md:31 仍把“标签条不滚动、标签变窄截断”列为限制；说明里（grid-drop.ts:70-92、DropFeedbackOverlay.md:59）写的是“越过最后一个可用成员就是追加”，没提隐藏成员的后果 |
| 8 | 部分解决 | 发布冒烟的空宿主改了：pack-smoke.ts:300-301 `types:["vite/client"]` 并注明 TS2882；三个示例 tsconfig 也是 `types:["vite/client"]` | README 的“安装”一节（README:14-27）没写 TS 6 下 `types:[]` 导入 `style.css` 会报 TS2882，第三方照别的写法仍会撞；CHANGELOG 也没写 |
| 9 | 部分解决 | 说明补了两处：README:187 写明焦点只有前后两个方向；README:189 与 drag-session.md:18 写明 `sourceAt` 要自己排除可交互元素。其余没动：`leaf` 插槽的 `node` 仍是 `GridLeaf<unknown>`（NestedGrid.md:246）、没有缺省的“交互元素不起拖”过滤与拖影、`insetTop` 库不量 | 四项能力都没做（体验审查推迟的几条，没排 Task）；tabbed-panels、ide 的 `sourceAt` 仍各写一遍排除 |
| 58 | 没解决 | desktop/README.md 仍写“窗的缩放与移动有键盘……整窗移动没有键盘，也没有键盘平铺的路径”；`FloatWindowHandles` 的键盘移动把手在位（FloatWindowHandles.md:16）但没有接到“拖标题栏平铺”的键盘等价；该组件自 t50 后未改 | 只能用指针平铺；会话的键盘拖动没接到浮动窗（候选未做、没排 Task） |
| 11 | 部分解决 | 没有整窗移动的组合函数（`FloatWindowHandles` 与 grid-rects.ts 自 t50 后没改）；说明指了路：FloatWindowHandles.md:9“指针拖标题栏移动整个窗不归它管”，README:145 表格行“整窗移动见 desktop”。desktop 仍用 `useDragSession` + `placeFloat` + `commitsUnderPointer`（App.vue:~233-285，约 50 行） | 组合函数或手柄（候选）没做，也没排 Task（第 3 组整组没排） |
| 12 | 没解决 | 浮动窗矩形变化仍不过渡：NestedGrid.md:190“只有矩形变了不过渡”原文未动；desktop/README.md 仍把“最大化与恢复是瞬间的”列为限制 | 候选开关没做 |
| 13 | 部分解决 | 补了一部分：`gesture:"move"`（move 时外框内容不接指针、手势中不过渡，NestedGrid.md:148、:220）、`placeFloat` 的 `null` 复位（NestedGrid.md:115）、`actionKey` 为 null 时副作用要自己撤（drag-session.md:52）都写了 | 松手后“先发布拖到的矩形、等下一帧再改树，否则窗先跳回再飞”只在 desktop App.vue 的 `tileOnNextFrame` 注释与 desktop/README.md 里，库的说明没写；整窗移动组合函数没做 |
| 23 | 没解决 | `clampFloatRect(rect, extent, keep)` 仍无原点（grid-rects.ts:170，自 t50 没改）；探针 float.test.ts：800 宽的窗在 600 宽区域里、keep 取窗自己大小，结果 x=-200（推出左缘）；README:153 把限制写成说明（“都只收尺寸、从 0 开始，区域不在网格根原点时先减掉原点”） | desktop 的 `deskClamp`（model.ts:96-100，减原点、keep 取较小、加回）原样还在 |
| 24 | 没解决 | `resizeFloatRect` 的 `max` 仍是尺寸不是边界（grid-rects.ts:194）；探针：起点 x=500 宽 300，右拉 +900、max 1000，结果宽 1000，伸出 800 宽的桌面；desktop 的 `withinDesk` 求交仍在（App.vue:~292-300） | 候选“收边界矩形”没做；README:153 只把限制写明 |
| 25 | 没解决 | `NestedGrid`/`useGridHost` 仍不交出摆放结果（useGridHost 返回值只有 node、layout、revision、extent、invalidate、setCollapsed、setSize、bindings，useGridHost.ts:166）；desktop 仍自己 `placeGrid`（desktop model.ts:85-89 的 `leafRect`，App.vue:~120 的 `desk`） | 同一份布局算两遍、`dpr` 要与库一致；说明（README:149 的 `placeGrid`）只是指路 |
| 28 | 没解决 | 手柄命中带写死 6px、上边 3px，说明早已写（FloatWindowHandles.md:15，t50 时就有，diff 无变化）；组件没有属性或变量 | 宿主标题栏按钮仍要离边 ≥8px（desktop WindowFrame.vue 的做法没变） |
| 38 | 没解决 | FloatWindowHandles.vue 自 t50 没改；`rect` 仍是“已夹取”的起点（FloatWindowHandles.md:25），`commit` 交回夹过的矩形，宿主不另存原矩形就会把夹过的尺寸当新尺寸；desktop 仍只写回位置（`onKeyboardMove`、`move()` 注释 model.ts:174） | “交回相对改了多少”的候选没做；说明只写了 rect 是已夹取的，没提这个后果 |
| 39 | 没解决 | `float-chrome` 层仍是 `v-for="float in floats" :key="float.id"`（NestedGrid.vue:644），层级用 z-index（`floatLayer`，:200-203），DOM 次序跟 `floats` 数组走，抬升会让 Vue 搬手柄节点；库自 t50 后没改这处 | “正在拖的手柄是否受影响”本复查没在浏览器验证（不起服务）；desktop 的“按手柄抬升”是否稳仍靠它自己的 e2e |
| 48 | 部分解决 | NestedGrid.md:143-149 公开标记表写明三层标记：叶外框 `data-leaf`、内容 `data-content-leaf`、手柄 `data-float-chrome`；desktop `raiseOnPress` 注释写了“手柄在 pointerdown 里阻止冒泡，挂在窗上收不到”（App.vue:~172-176） | 库不带“按到浮动窗”的事件，示例仍 12 行捕获阶段监听；库的说明没写手柄层阻止冒泡（FloatWindowHandles.vue:61、87、97 有 `stopPropagation`，md 里搜不到） |
| 49 | 没解决 | `useDevicePixelRatio` 仍不导出（vue/index.ts 与 src/index.ts 无）；desktop 仍 `window.devicePixelRatio` 非响应式读（App.vue:114）并在注释里承认（并入 25） | 浏览器缩放可能差 1px 的已知限制仍在 desktop/README.md |
| 50 | 部分解决 | README:188“两种矩形”写明 `GridRect`（相对网格根）与 `GridDropRect`（视口）、库不互转、减网格根左上角即可；NestedGrid 的 `origin()` 给左上角（NestedGrid.md:115）。desktop 仍自写 `inViewport`（App.vue:~232） | 形状没统一、没有换算函数（候选未做）；约 8 行换算仍在宿主 |
| 51 | 没解决 | FloatWindowHandles.vue:70-77 松手仍是同一同步段先 `preview(null)` 再 `commit`；FloatWindowHandles.md:15 只写“松手发 commit、Esc 或失去捕获发 preview(null)”，没写松手时两个事件的先后 | 说明没补，`preview` 也没带原因；desktop 靠两个处理函数各管一件，碰巧不受影响 |
| 52 | 已解决 | NestedGrid.md:32 把“`leaf` 既不在树里、也不在 `floats` 里”列为内容层项的停放情形（不卸载、状态留着），desktop 最小化就是这样用（App.vue:`active:false` 的 `contents`） | 无 |
| 53 | 部分解决 | drag-session.md:20 写明 `resolve` “放下时、自动滚动时也会调，不能假定一次移动只调一次……可以记下这一场的判定、在读完 DOM 之后写跟手的反馈”，认可 desktop 在 `resolve` 里 `placeFloat`；drag-session.md:52 写了副作用要在 `onActiveChange(false)`/`onEnd` 撤 | 专门的“每次移动”回调（候选）没加；desktop 仍把跟手副作用写在 `resolve`（App.vue:~267-269） |

## 行号更正（上面各行里写成“约”或写错的引用，以这里为准）

- 示例 README 的行：tabbed-panels/README.md 第 26 行（没有 clone，条目 2）、27 行（同向嵌套与展平，条目 7）、28 行（只剩保留像素拉满，条目 6）、29 行（标签条不滚动，条目 3）；desktop/README.md 第 33 行（没有 clone，条目 2）、36 行（removeLeaf 展平，条目 27）、37 行（矩形不过渡，条目 12）、39 行（设备像素比，条目 49）、42 行（整窗移动无键盘，条目 58）；ide/README.md 第 35 行（零尺寸叶的按钮，条目 46）。
- desktop/src/App.vue：`dpr` 在 114，`raiseOnPress` 在 190，`inViewport` 在 202，`tileOnNextFrame` 在 221，`useDragSession` 在 229，`withinDesk` 在 303。
- ide：model.ts 的 `sashSize` 在 20，`stripeLeaf` 在 87，`buildTree` 在 97，`setCollapsed` 在 238；App.vue 的 `sashDisabled` 在 139。
- NestedGrid.vue 里 `sashDisabled` 的 JSDoc 在 76-80（不是 196）；grid-snapshot.ts 的 `convert(envelope.root, 1, null)` 在 222；tabbed-panels model.ts 的 `canSplit` 在 172。

## 判定口径与更正（复查收尾时追加）

口径：改库的候选里有“说明写出”这一支、说明也按代码写了的，算已解决；候选里只有改行为、而只补了说明的，算部分解决；计划或开发者明确写了不做的，算有意不做。按此口径更正两条：

| 编号 | 判定 | 证据（一两句，带文件:行或探针结果） | 还剩什么（没有就写“无”） |
|---|---|---|---|
| 17（更正） | 已解决 | 候选是“收起到 0 时不留缝，或说明写出”：grid.md:56 写明 `sashSize` 不随收起变、要只留一条线用函数形式给 0；探针 collapse.test.ts：函数形式得 `[0,4]`、统一 4 得 `[4,4]`；ide 示例用它（ide model.ts:20）。库行为照旧是 t59 plan“不做”第一条 | ide 的 `sashSize` 靠“分支 id 加序号”写死，与第 16 条同类，树形变了要同改 |
| 29（更正） | 已解决 | 候选是“会话与网格连起来，或说明里写在会话一节”：drag-session.md:41 写在“时序与先后”里，另有开发检查（NestedGrid.vue:525-527）与 `createLiveDragSession` 自带 `settleMotion` | 普通 `useDragSession` 仍要宿主在 `activate` 里自己调（三个示例都调），检查只在宿主把 `dragging` 交给网格时才查得到 |
| 55（重测） | 已解决 | 原行的窄窗口探针用的是刚拖过 +900 的网格，混进了拖动落账的影响，作废。新建网格单独测（narrow.test.ts，五块：条 28、左区 200、编辑区 300 起、右区 200、条 28，缝 4）：520 宽时不标 rigid，两条条被压到 0.44；标 rigid，两条条仍是 28、区压到 89.6、编辑区压到 268.8（低于它的最小 300），诊断是 4 条 `over-constrained`；800 宽时两种都不挤。“总最小 684”是 ide 示例的数，不是这棵树的 | 同原行：`over-constrained` 不说哪些叶被压；不标 rigid 的条与最小等于最大的叶照旧一起压 |
