---
标签: [state:local, state:inject, env:global]
---

# NestedGrid

`NestedGrid` 把 `createGrid` 一类领域无关的树与其同源布局结果呈现出来：叶与分隔线是同一父元素的子元素，按矩形摆放，叶的内容交给宿主插槽。树的结构变了只换矩形，不搬、不重建还在的叶。它同时把一次指针或键盘手势的预览投影到所有叶，并将最终提交交回宿主；树、布局意图和任何持久化都不由渲染器拥有。

完整的行为合同在仓库的 [`docs/specs/ui/nested-grid.md`](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md)。本文只写 Spec 没有的：接口、用法、使用提醒和标记。

## 布局

根节点填满父级可用盒。每个叶是一个外框（`data-leaf`，`left`/`top` 加宽高）加一个内容容器（`data-leaf-content`，插槽在这里）；外框裁切内容。交叉轴拉满父分支；沿主轴按设备像素累加取整，缝宽至少 1 个设备像素，同一占用的缝宽不随位置跳动。

叶的矩形在已发布的布局里从非零降到零时，`leaf` 插槽的内容容器停放：`visibility: hidden` 加 `inert`。载入时就是零的叶（例如一开始就收起为零的面板）不算：它的内容容器不停放，外框把它裁得看不见，里面能聚焦的元素却仍在 Tab 顺序里。这样的叶在 `leaf` 插槽里别放能聚焦的元素，或者宿主自己给它加 `inert`。内容层的项没有这条例外：量到容器之后，叶为零就停放（见“内容的停放与 content-parked”）。

外框、内容与浮动窗手柄带 `contain: layout`：是里面 `position: fixed` 的包含块，也自成层叠上下文，要盖住整个窗口的东西 Teleport 到 `body`。位置不用 `transform`：过渡时它在合成线程上走、宽高在主线程上走，主线程一忙，不动的那条边会跳；只有拿起的内容跟手时用 `transform`。

内容可以放进内容层（`contents` 与 `content` 插槽）。此时 `leaf` 插槽只放面板头。内容项要被停放而焦点在里面时发 `content-parked`，宿主决定焦点去哪（“时序与寿命”）；哪些操作会发、哪些不发见下面的“内容的停放与 content-parked”。正飞过别的面板的外框与内容带 `data-flying`。

内容项的外层（`data-content`）和叶的外框（`data-leaf`）都是网格根的直接子元素，是兄弟，不是父子：在 `[data-leaf]` 里面找不到内容层的正文。

- 取某一项的元素按它的 key：`[data-content="<key>"]`，它此刻属于哪块叶看 `data-content-leaf`。
- 同一块叶可以挂几项内容（例如几个标签），不活动的停放着、矩形照旧，所以按 `data-content-leaf` 会取到几个元素，要挑宿主自己知道的活动的那一项。
- 叶的正文区域（判落点、摆宿主自己的东西用）是叶的矩形去掉顶上的 `insetTop`：宽度相同，上边往下挪 `insetTop`，高度少 `insetTop`。静止时内容外层的矩形就是它；过渡中外层带 `data-by-leaf` 时外层是叶的矩形（见“过渡”）。不读 DOM 时，拿 `placeGrid` 给的叶矩形照这条减。

### 内容的停放与 content-parked

内容层的项在下面这些情况下停放（`visibility: hidden` 加 `inert`，不卸载，实例与状态都留着）：

- 宿主把它的 `active` 改成 `false`（例如切到同一编组的另一个标签）；
- 它的 `leaf` 既不在树里、也不在 `floats` 里；
- 它的叶在两根轴的任一根上为零，例如收起为零（按钮、Enter、拖动落账都算）；
- 叶收成标题行，叶还有高度，`insetTop` 把正文吃到了零；
- 它的叶被最大化的叶盖住（见“最大化”）；
- 它的叶在过渡里缩回去：离开了留着缩回的、这一轮降到零的、交换里滑出去的（提交那一刻就停放）；
- 宿主把它从 `contents` 去掉、它标了 `leave: "retain"`、库留它到过渡结束（见“过渡”）。

一项从没停放变成停放的那一次，焦点正在这一项的外层里时，组件发一次 `content-parked`，key 是这一项的。这时 DOM 还没变，焦点还在里面，宿主在处理函数里把焦点交给别处。下面这些情况不发，焦点要宿主自己管：

- 焦点不在这一项里。最常见的是面板头上的按钮（`leaf` 插槽里）收起或隐藏了这块面板：按下时焦点在按钮上，不在内容里，不发；按钮的点击处理里自己给焦点。
- 宿主不用内容层、内容放在 `leaf` 插槽里：叶的内容容器停放时没有这个事件。
- 宿主把它从 `contents` 去掉而没标 `leave: "retain"`：它当即卸载，不算停放，焦点落到 `body`。
- 内容换了叶：它没有停放。
- 手势预览中：往零拖时预览不停放内容，松手落账的那一次才停放、才发。
- 被拿起（`lifted`）的项不算停放。

## 过渡

不是手势、也不是容器尺寸变化引起的布局变化（程序开关面板、拆分与关闭叶）时，外框与分隔线按 `--nb-layout-motion-layout`、`--nb-layout-ease-layout` 过渡到新矩形，每一帧一块的四条边一起到位；拖动分隔线、松手落账和容器尺寸变化不过渡，过渡中开始手势或容器尺寸变化时直接到终点，系统减少动态效果时没有过渡。完整规则见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“过渡”几条。下面是 Spec 没有的用法与提醒：

- 过渡中外框与分隔线带 `data-moving`。前后都有尺寸的叶，内容逐帧跟外框，叶里的 `ResizeObserver` 每帧都会收到尺寸：不要把过渡中的尺寸当事实记下来；要最终尺寸读宿主自己的布局结果。
- 外框只有右边在动时，外框与内容外层带 `data-anchor-right`，过渡结束就摘掉。纵向不贴：贴下边要让面板头那一条里也画内容，那一条现在被裁掉。
- 这些叶的内容外层在过渡中按叶的矩形摆、带 `data-by-leaf`：内容体往下挪一个面板头，面板头那一条用 `clip-path` 裁掉（不挡面板头的指针），外层的上边就是外框的上边；过渡结束换回内容自己的矩形，位置相同、不跳。宿主在过渡中量内容外层，量到的是叶的矩形，要量内容的位置量内容体。
- 不给 `leafShape` 时，这些叶按外框的矩形裁，卡片在不动的那边被直着切掉；给了形状时，外框与内容外层都按它裁，露出来的一截始终是一张完整的卡片，卡片的投影到结束才出现，浮动窗不按形状裁。形状可以伸出外框时，`fill` 画伸出去的部分。
- 离开的叶留着缩回去（一整棵子树离开；前后的兄弟这一帧相接，或它在分支一头而挨着的兄弟伸到了它原来的那一头；下面还有挂着的内容，或有这一轮被去掉、标了留住的活动内容项；又不在拖动中）时带 `data-leaving`、`inert`、不接指针；宿主用 `dragging` 属性告诉网格拖动在进行（不论内容拿没拿起），这时离开的叶不留着。还在树里、这一轮降到零的叶不带 `data-leaving`。只用 `leaf` 插槽、没有内容层的宿主删叶时，叶一帧消失；要删一块并让它缩回去，把内容放进内容层、标 `leave: "retain"`（见下一条）。把一块叶里的内容全部挪到别的叶、同一轮删掉这块叶（例如把编组最后一个标签拖到另一个编组）时，这块叶也一帧消失：挪走的内容不算去掉，叶下面这一轮没有挂着的内容。所以“关掉最后一个标签”有缩回去的过渡，“挪走最后一个标签”没有。
- **关掉的内容留到过渡结束**：内容项标了 `leave: "retain"`、宿主把它从 `contents` 去掉，而它的叶这一轮在缩回去（离开的叶留着缩回，或降到零）时，库用它最后一次的渲染留到过渡结束，宿主不用自己留一份数据。缺省（`"unmount"`）当即卸载：内容里有保存、释放、还焦点这类卸载逻辑的（编辑器、终端）就别开。
  - 留着的内容项带 `data-content-leaving`、`inert`、看得见、不接指针，跟着叶缩回去，不是 F6 与 Tab 的落点；只留活动的，叶不动、只是内容被换掉或去掉的当即卸载；拖动中、交换里滑出去的叶、减少动态效果时不留。过渡中宿主又给了同一个 key，沿用同一个元素回到照常渲染。
  - 焦点在里面时照样发 `content-parked`，key 是宿主刚去掉的那个：处理函数别按 key 查自己的数据（查不到），直接选焦点的去处。
  - 有留着的内容时，留着缩回的离开的叶的面板头（`leaf` 插槽）也停在最后一次渲染；离开的叶按子树整组留，同一列里没有留着内容的叶也是。交换里滑出去的叶、没有留着的内容时的离开的叶（区域隐藏）照常渲染，插槽读得到这一轮的 `moving`、`swappingLeaves`。
  - **留着的这段时间，宿主的数据已经删了，插槽里的组件还活着**：面板头与正文都不要按 key 查宿主的数据，把数据经属性交给组件。冻住的只是这一项的插槽调用。里面的组件照常按自己的响应式依赖更新：交给子组件的插槽在子组件的渲染里调，那里面按 key 查宿主已删的数据会抛错（库补一条 `[nb-layout/NestedGrid] … is kept until the transition ends` 的报错，原错误照常交给应用的错误处理）。把这一项交给一个组件、经属性传进去，组件里再用壳组件与插槽：

    ```vue
    <template #content="{contentKey}">
        <!-- 不这样写：<Panel>{{ cards[contentKey].title }}</Panel>，Panel 的插槽在宿主删掉 cards[contentKey] 之后还会再调 -->
        <CardBody :card="cards[contentKey]" />
    </template>
    ```
  - 删数据与改 `contents`、改树要在同一次刷新里（同一个同步段）：数据先删、`contents` 晚一拍才变时，那一拍里宿主的插槽还会被调。

## 交换

宿主在一次布局变化之前给出 `swap` 时，这次变化里离开的一组与换上来的一组不按普通过渡长出来、消失，而是像胶片一样沿轴整块平移：换上来的一组从方向那头滑进来，离开的一组往另一头滑出去，外框、内容与组里的分隔线一起平移、尺寸不变。拖动中、系统减少动态效果时不交换；`swap` 的字段见“数据”，完整规则见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“交换”几条。下面是 Spec 没有的用法与提醒：

- 裁切窗可以按 `window.inset` 内缩、按 `window.radius` 圆角：带上的外框、内容外层与分隔线各自的 `clip-path` 是窗在它坐标里的位置，起点那一帧就写上，和 `left`/`top` 同一段过渡。
- 带上的项带 `data-swap`；离开的一组带 `data-leaving`、`inert`；组里的分隔线两侧尺寸冻结在离开前。
- 布局是异步算出来的宿主，在拿到新布局、写进属性的同一个同步段里给 `swap`。
- 裁切窗应当等于两组静止时的外观：过渡结束那一帧摘掉裁切，窗比静止时小的部分会一下子露出来。
- 滑出去的分隔线不再问宿主的 `sashKind`、`sashStyle`、`paneLabel`（两侧已经不在宿主的布局里），沿用它离开前最后一次的结果。
- 宿主的 `sashKind`、`sashStyle`、`paneLabel` 在每次重算里每条线只问一次（`paneLabel` 按线两侧的节点各问一次），结果由一张表供渲染用；渲染层（`layers`）变了、回调里读的响应式状态变了、或属性里的回调换了，这张表才重算；与这些无关的渲染不再重问。
- 宿主按文档列的叶对不上呈现时（被收走、没呈现出来），不在呈现里的忽略。交换开始之后才挂上来的内容项按它的叶属于哪一组裁，但从终点出现（已知限制）。
- 网格同时只有一条带：进行中的过渡全部送到终点的做法同 `settleMotion`，别处正在长出来、缩回去的也一起。
- 交换中来了一次不带交换的布局变化，带照旧走完，裁切窗与静止的底不跟着变（已知限制）。
- `swap-backdrop` 插槽里宿主画不动的东西，外框这期间不画自己的卡片。

## 交互

指针在分隔线命中带内按下会开始一次会话；命中带的外扩距离见 [Splitter](Splitter.md)。交叉处最多同时调整一条宽度轴和一条高度轴，两条线一起亮，交汇的一端连着（悬停线两端挨着哪条外层分隔线由 `placeGrid` 按树结构算）。拖动期间只从按下时冻结的树、布局、容器尺寸、contextKey 与 revision 求解预览，所有受影响的子树尺寸实时跟随；松手仅提交一次。没有有效变化不会提交。提交的 `changes` 每项对应一个分支，给出该分支全部直接子节点沿主轴的 px（`baseline` 为按下时的值，`target` 为结果）、`active`、`compensated` 与有变化的 `collapsed`；宿主用 `grid.resizeBranches(changes)` 一次原子落账。提交由 `onGestureCommit` 同步接纳；拒绝会回滚预览并报告诊断。接纳后宿主应发布与提交匹配的新 `layout`，否则下一 tick 回到已发布布局并报告问题。

与主轴同向的方向键每次调整 10px，Shift 调整 1px；Home / End 跳到可行范围端点，Enter 切换相邻可收起面板（能翻时结果同 `setCollapsed`；放不下或没人吸收时不切换，锁住的跳过）。键盘按键抬起时结束该手势。取消的情形：Escape、pointercancel、窗口失焦、上下文变化和卸载都不结算旧基线；分隔线失去焦点时结束键盘会话。禁用时不启动手势。沿自己长度方向为零的分隔线按不可交互处理。数据、约束、上下文或 revision 变化会使现有手势失效。点击非分隔区域不由渲染器处理；焦点不被组件搬移。

### 分隔线的身份

分隔线属于它所在的分支，不属于两侧的叶：

- `data-sash` 的值是 `<分支 id>:<序号>`，分支是线的父分支。序号从 0 起，就是线前面那个孩子在分支 `children` 里的下标：`root:0` 在 `root` 的第 0 与第 1 个孩子之间。收起的孩子也占下标。
- `sashKind`、`sashStyle`、`sashDisabled` 收到 `{branch, before, after}`：`branch` 是这条线的父分支，`before`、`after` 是线两侧的直接孩子。孩子是分支时，收到的是分支 id，不是叶 id。`paneLabel` 同样会被问到分支 id；对分支返回 `undefined` 时，读屏名称里念的是分支 id。
- 这些 id 与序号随结构变：拆分在叶外面包一层新分支，删到只剩一个孩子时分支被展平、id 没了（见 [`grid`](../grid.md) 的“已知限制”）。拆分、关闭之后，同一条线可能换了 `branch`、序号与两侧的 id。
- 要判断“这是不是某块叶旁边的线”，按宿主自己定的、不会变的那一侧判：`before === "files" || after === "files"`。另一侧可能是分支，别按它的 id 写死。拿到分支 id 时可以用 `grid.find(id)` 取到它，再沿 `children` 往下找挨着线的叶。

宿主回调什么时候被调：

- `sashKind`、`sashStyle`、`paneLabel` 每次重算每条线只问一次，结果存在一张表里（这张表什么时候重算见“交换”里讲它的那一条）。
- `sashDisabled` 不进这张表，网格每次渲染分隔线时都调它。它读的响应式状态变了，网格自己重新渲染，结果跟着变。它读的是普通变量时，变了网格不知道，要等下一次别的原因引起的渲染；这时宿主要让网格重新渲染，例如调 `host.invalidate()`，或者把这个状态改成响应式的。

### 最大化

`maximized` 给出的叶盖住一个矩形：除 `exclude` 以外的全部叶（含它自己）的外接矩形。它不是“整个网格减去 `exclude`”：

- `exclude` 里的叶只有落在这个外接矩形之外才露出来。夹在两块别的叶之间的，照样被盖住。
- 要留出来的条放在最外一层的一头，例如根分支的第一个或最后一个孩子，外接矩形就不会罩住它。
- 被盖住的叶与它的内容不可交互（`inert`）；`exclude` 里的叶不算被盖住，被外接矩形罩住时也不加 `inert`。
- 最大化期间所有分隔线不画、不能拖。

`dragging` 为真时宿主的拖动在进行（不论内容拿没拿起），离开的叶不留着缩回去。开发模式开关打开时，`dragging` 变真的那一刻还有布局过渡在走（宿主起拖时没调 `settleMotion()`），警告一次；同一次更新里改了布局、过渡是这次才开始的不算。`lifted`（`{key}`）拿起一个内容项（实时布局：拖动时别的面板按预览即时让位，拿起的内容做成卡片跟着指针）：不接指针，外层是一列（`lifted-head` 加内层）。落进已有的叶时，那块叶上一帧显示着的内容留在卡片下面（`inert`、不接指针），过渡结束才停放，卡片长的一路叶不空；落进的是这次才出现的叶（拖出来的浮动窗）时，叶的外框和窗的手柄也从卡片的矩形一起长到终点。矩形（相对网格根）由 expose 的 `placeLifted(rect)` 直接写在元素上，不走属性：跟手的东西每帧都变，走属性的话这个组件和每块叶的插槽都要跟着重跑。整窗拖动同样：expose 的 `placeFloat(id, offset)` 把窗的外框、内容、手柄一起挪（写 `translate`），`null` 回到原处，`floats` 属性整场不变。`null` 之后、下一帧之前发布的变化里，窗从松手处出发（见下面“整窗移动的做法”）。插槽 `lifted-head` 是它上面那一条头，`overlay` 是盖在分隔线之上、拿起的内容之下的一层（不接指针）。暴露 `settleMotion()`：进行中的过渡直接到终点，宿主马上要量矩形时用。卡片的圆角与投影走 `--nb-layout-card-radius`、`--nb-layout-card-shadow`。这一项这一轮不在 `contents` 里时（宿主的预览把来源摘掉了）网格自己留住它，叶是拿起那一刻它所在的叶，实例不卸载（记录与读取方式见 `useHeldLifted.ts` 的文件头）；宿主要在摘掉它的那一次渲染里（或更早）给出 `lifted`。expose 的 `origin()` 是网格根的左上角（视口坐标），`motionMs()` 是网格元素上的布局过渡时长（减少动效时是 0），实时布局的会话从它们取。

`floats`（`{id, rect, gesture?, animate?}`）是浮动窗。窗回到树里时叶的 id 不变，外框就从窗的位置过渡回去；摘掉 `data-float` 的那一刻外框还带着 `data-moving`，窗的投影、底色与圆角跟着过渡掉。插槽 `float-chrome` 放手柄（[`FloatWindowHandles`](FloatWindowHandles.md)）。

- 矩形变化：只有窗的矩形变了不过渡（移动、缩放是手势）。宿主给这扇窗标 `animate: true` 时，它的矩形变化算布局变化、走布局过渡，例如最大化与还原；这一次或上一次渲染里它带着 `gesture`、或这次变化是松手放开时照旧不过渡。标了的窗每次矩形变化都走完整的布局时长（`--nb-layout-motion-layout`），所以只标在要动的那一次上，别一直标着：键盘移动每按一下都要滑完一整段。

- 层叠：`floats` 后面的压在前面的上面，层级写在 `z-index` 上。换次序只改层级，外框、内容与手柄层都不搬节点，手柄里的焦点与指针捕获不丢。手柄层的 DOM 次序是出现的次序：还在的保持相对次序，新开的窗排在它在 `floats` 里前一扇之后，所以手柄之间的 Tab 次序也是这个次序，不是叠放次序。
- 抬升：指针在一扇窗上按下（外框、内容、手柄层，含嵌在里面的网格；任何指针键），或焦点进入它，它又不是 `floats` 的最后一个时，网格发 `float-raise`（窗的 id）。按下在捕获阶段判，手柄在 `pointerdown` 里阻止冒泡也收得到。网格不改次序：宿主把这扇窗挪到 `floats` 末尾。宿主不想按焦点抬升时，不接这个事件、自己在外层听按下。
- 某块树里的叶此刻摆在哪：expose 的 `leafRect(id)`，例如浮动窗要夹在“桌面”那块叶里。见下面 expose 的说明。

### 整窗移动的做法

库不给整窗移动的组合函数：工作台那样的宿主里，整窗拖动是一场多来源拖动会话里的一种来源，用不了一份独立的移动会话。做法是三步：

1. 拖动会话（[`useDragSession`](drag-session.md)）的 `resolve` 里按指针算出窗的位置（夹取用 `clampFloatRect`），再 `placeFloat(id, 偏移)` 让窗跟手；`floats` 整场不变，只把这扇窗标上 `gesture: "move"`。
2. `commit` 里先 `placeFloat(id, null)`，再在同一拍里发布结果：改窗的矩形，或者把窗放回树里、并进别的叶。网格记着最后一次的偏移，`null` 之后、下一帧之前发布的变化里，要过渡的部分（回到树里的外框、换了叶的内容）从松手时画着的位置出发；窗还是浮动窗、矩形就是拖到的位置时不过渡。
3. 取消（`onEnd` 不是 `committed`）时只 `placeFloat(id, null)`，什么都不发布：窗回到原处，记下的偏移下一帧就清掉。

宿主在下一帧之后才发布（例如等一次异步提交）时，过渡照旧从记录矩形出发，窗会先跳回按下之前的位置再飞。

焦点：DOM 序与树序不一致（叶换了位置）时，根上有 `aria-owns`，Tab 走出一块时由组件按树序接管，内容自己处理了 Tab（`preventDefault`）或输入法正在组字时不接管，走出最后一项时离开这个 grid。`moveGridFocus(container, direction)` 在叶之间按树的先后移动，回到这块上次的焦点，没有就是第一个可聚焦的元素；没有可聚焦元素的叶跳过，嵌套时内层先走、走到头交给外层，最外层绕回。完整规则见 [Spec](https://github.com/notnotype/neuro-book/blob/master/docs/specs/ui/nested-grid.md) 的“Tab”“移动焦点”“读屏顺序”几条。

根、外框与内容都不接焦点：点在空白处时焦点落到 `body`，挂在网格根上的快捷键这时收不到。要在网格里接快捷键，宿主把键挂在 `window` 上，或给承载盒加 `tabindex="-1"`、按下时聚焦它。

## 接入

宿主要做五件事：建树（`createGrid`，**`sashSize` 要传正数**：缺省是 0，分隔线没有宽度、拖不动）、量容器、算布局、接纳手势提交、结构变了通知。后四件由 [`useGridHost`](useGridHost.md) 接好，整包绑到组件上：`<NestedGrid v-bind="host.bindings.value">`。能直接用的例子见包的 [README](../../README.md) 的“起步”。

不经 `useGridHost`、自己接组件时，要知道组件这一侧的几条：

- 组件自己量根盒（读 `clientWidth`、`clientHeight`，不随祖先的变换缩放），挂载后量到就发 `extent` 事件，两轴变了才再发，同步发；卸载前发 `null`。承载盒要有确定的高度，组件的根铺满它。
- 宿主拿这个尺寸算布局；没量到可用尺寸（`null`，或宽、高任一为 0）时给空布局、停用手势。尺寸只来自组件，不要把它挂在“有了尺寸才渲染”的条件后面，那样永远等不到尺寸。
- 提交处理 `onGestureCommit` 是属性，要返回 `{ok: true}` 或失败对象。写成 `@gesture-commit` 时处理函数会被当作这个属性调用，返回 void 就回滚；整包绑定之后再写它，会和包里的合成数组，提交时出错。
- `contextKey` 与 `revision` 要和宿主核对提交用的值一致：手势开始时组件把它们冻结进这场手势，提交时宿主拿此刻的值比，对不上就拒绝（拖不动）。

开发构建里、网格挂载之前调一次根入口的 `setLayoutDevChecks(true)`：接线错了（能拖的边界全是 0 宽、没接或接错提交处理、整包绑定后模板里另写了 `context-key` 或 `:revision`）时控制台警告，每个网格每种一次。库不读 `import.meta.env`，开不开由宿主决定。

## 公开的标记与变量

宿主与测试可以依赖下面这些，改名要同步它们：

| 名字 | 在哪 | 含义 |
|---|---|---|
| `data-grid-scope` | grid 根 | 值是实例 id；`moveGridFocus` 靠它找 grid，宿主取根用它 |
| `data-leaf` | 叶外框 | 值是节点 id；外框按 `left`/`top` 加宽高摆放，过渡中会动 |
| `data-content`、`data-content-leaf` | 内容项的外层 | 值是它的 key、所属叶 id；过渡中会动，飞行中带 `data-flying`。它是叶外框的兄弟，不在 `data-leaf` 里面；正文区域怎么取见“布局” |
| `data-flying` | 外框与内容外层 | 这次过渡里压在别的面板上面飞过去的项：换了叶的内容、整块挪到别处的面板、从浮动窗回到树里的叶；还原最大化的过渡结束之前，被还原的那块也带它 |
| `data-lifted` | 内容外层 | 这一项被拿起（`lifted`），盖在别的上面跟手 |
| `data-float` | 外框与内容外层 | 这块叶是浮动窗 |
| `data-float-gesture` | 浮动窗的外框、内容外层与手柄层 | 手势进行中，值是 `move` 或 `resize`：跟手、不过渡；`move` 时外框与内容不接指针 |
| `data-float-chrome` | 浮动窗的手柄层（`float-chrome` 插槽的外层） | 值是浮动窗的 id |
| `data-sash-kind` | 分隔线 | 值是宿主 `sashKind` 给的种类，没给时没有这个属性；宿主据此设 `--nb-layout-splitter-seam` |
| `data-leaf-content` | 叶的内容容器 | 值是节点 id；宿主 Teleport 内容用它。过渡中的尺寸见“过渡”；要最终尺寸读宿主自己的布局结果。`node` 变化后的同一次渲染里新叶的它已经存在 |
| `data-moving` | 外框与分隔线 | 过渡进行中 |
| `data-anchor-right` | 外框与内容外层 | 过渡中里面那层（`data-leaf-content` 与内容体）贴右边；没有时贴左上 |
| `data-by-leaf` | 内容外层 | 过渡中按叶的矩形摆（含面板头那一条，裁掉）；有它时外层的矩形不是内容的位置 |
| `data-swap` | 外框、内容外层与分隔线 | 交换进行中，值是 `in`（换上来的）或 `out`（离开的）；带它时 `clip-path` 是裁切窗，不是 `leafShape` |
| `data-leaving` | 外框、内容外层与分隔线 | 离开了、在过渡里留着（缩回去，或交换里滑出去），不接指针；降到零但还在树里的叶不带它 |
| `data-content-leaving` | 内容外层 | 宿主已经去掉、库留到过渡结束的内容项（`leave: "retain"`）；插槽停在最后一次渲染 |
| `data-swap-backdrop` | 静止的底（`swap-backdrop` 插槽的外层） | 交换进行中、宿主给了这个插槽时才有 |
| `data-sash` | 分隔线 | 值是 `分支 id:序号`：分支是线的父分支，序号从 0 起、是线前面那个孩子的下标，结构变了两者都会变（见“分隔线的身份”）；`data-sash-hover`、`-active`、`-revealed`、`-cross` 是它的状态 |
| `--nb-layout-motion-layout`、`--nb-layout-ease-layout` | 继承来的 CSS 变量 | 过渡的时长与曲线：装了 nb-ui 时经它的桥接取主题的 `--motion-layout`、`--ease-layout`；减少动态效果时为 0；宿主没给时按缺省（470ms） |
| `--nb-layout-splitter-seam`、`--nb-layout-splitter-seam-inset` | 继承来的 CSS 变量 | 宿主旋钮，主题不写：分隔线静止接缝的颜色与两端缩进，可以设在子树上 |
| `--nb-layout-sash-line-*` | 继承来的 CSS 变量 | 悬停线的颜色、粗细、圆角、发光与缩进，装了 nb-ui 时经桥接取主题的 `--sash-line-*`，见 [Splitter](Splitter.md)。全部变量与回退见包的 README |

## 数据

```ts
import type {GridFailure, GridGestureCommit, GridGesturePreview, GridIssue, GridIssueCode, GridLayoutResult, GridLeaf, GridNode, GridGestureCancellation, GridGestureStart, GridExtent} from "@notnotype/nb-layout";

type NestedGridProps = {
    /** 当前树；null 时呈现 empty 插槽。必填。 */
    node: GridNode<unknown> | null;
    /** 与 node 同源的已计算呈现几何；必填。 */
    layout: GridLayoutResult;
    /** 禁止所有分隔线手势；默认 false。 */
    disabled?: boolean;
    /** 手势所属工作面/布局键；默认空字符串。变化会取消活动手势。 */
    contextKey?: string;
    /** 树、约束或容器尺寸变化时由宿主递增的版本；默认 0。 */
    revision?: number;
    /** 同步接纳一次完整提交；未提供或返回失败都会回滚预览。失败是 `{ok: false, code, message, params?}`：`code` 给程序分支（宿主自己拒绝可以用自己的码），`message` 是英文、只给日志看。 */
    onGestureCommit?: (commit: GridGestureCommit) => {ok: true} | GridFailure;
    /** 内容层：和叶外框同一父元素的内容，换叶不重建；默认无，内容放在 leaf 插槽里。 */
    contents?: ReadonlyArray<GridContentInput>;
    /** 这块叶盖住除 exclude 以外的全部叶的外接矩形（exclude 的叶落在这个矩形里照样被盖住，见“最大化”），别的叶不动；默认 null。只在内存，宿主决定。 */
    maximized?: {leaf: string; exclude: ReadonlyArray<string>} | null;
    /** 拿起的内容项（实时布局）：盖在别的面板与分隔线上跟手，不接指针，矩形由 placeLifted 写；变成 null 时飞回它的叶。默认 null。 */
    lifted?: {key: string} | null;
    /** 宿主的拖动进行中（不论内容拿没拿起）：离开的叶立即消失，不留着缩回去。默认 false。 */
    dragging?: boolean;
    /** 浮动窗：不在树里的叶，后面的压在前面的上面；矩形相对网格根，只有矩形变了不过渡（标了 animate 的过渡）；按下或焦点进入后面的窗时发 float-raise。默认没有。 */
    floats?: ReadonlyArray<GridFloatInput>;
    /** 分隔线的种类，写到 data-sash-kind，宿主据此给不同的线不同的颜色；默认不写。 */
    sashKind?: (sash: {branch: string; before: string; after: string}) => string | undefined;
    /** 写在分隔线元素上的内联样式（多半是 CSS 变量），宿主据此在线所占的那一条里画东西；位置与尺寸由网格写，同名属性被覆盖。默认不写。 */
    sashStyle?: (sash: {branch: string; before: string; after: string}) => Record<string, string> | undefined;
    /** 宿主让这条分隔线此刻不能拖（指针、键盘都不行，线照画），例如一列分节全部收成标题行时；缺省都能拖。before、after 可能是分支 id；每次渲染都调，读响应式状态（见“分隔线的身份”）。 */
    sashDisabled?: (sash: {branch: string; before: string; after: string}) => boolean;
    /**
     * 节点的显示名（宿主翻译好的），代进分隔线的读屏名称“调整 {before} 与 {after} 的宽度”；挨着分支时问分支 id。
     * 没给、返回 undefined 或空串时用节点 id。交换里滑出去的分隔线用离开前最后一次的名字。一次渲染里可能问几次（同 `sashKind`），要便宜、没有副作用。
     */
    paneLabel?: (id: string) => string | undefined;
    /**
     * 叶在外框里画成的卡片：inset 是相对外框上右下左的内缩，radius 是左上、右上、右下、左下的圆角，都是 CSS 长度。过渡中外框露出、盖住保持尺寸的内层时按它裁；默认按外框的矩形裁。
     * 给了 fill 时形状可以伸出外框（内缩为负）：外框里的东西照旧裁在外框里，伸出去的部分画成 fill，这块外框画在别的外框下面，伸到邻居那里的部分被邻居盖住。
     */
    leafShape?: (leaf: string) => GridLeafShape | undefined;
    /**
     * 交换：下一次布局变化里一组叶换成另一组时整块平移。和那次布局变化在同一个同步段里给，token 变了才算新的；默认 null。
     * window.inset 是外接矩形上右下左的内缩（px），window.radius 是四个角（CSS 长度）。
     */
    swap?: {token: number; leaving: ReadonlyArray<string>; entering: ReadonlyArray<string>; axis: "width" | "height"; direction: 1 | -1; gap: number; window?: {inset: [number, number, number, number]; radius?: [string, string, string, string]}} | null;
};

/**
 * 内容层的一项：key 是身份（不变就不重建、不换父元素），换 leaf 是在叶之间移动；insetTop 是叶顶部留给面板头的高度；不 active 的停放、不卸载。
 * leave 是宿主把它从 contents 去掉时怎样：缺省 "unmount" 当即卸载，"retain" 在它的叶缩回去时留到过渡结束（见“过渡”）。
 */
type GridContentInput = {key: string; leaf: string; insetTop: number; active: boolean; leave?: "unmount" | "retain"};
/** 浮动窗：rect 相对网格根；gesture 是手势进行中（跟手、不过渡；move 还不接指针，判定才看得到底下）；animate 是这扇窗的矩形变化走布局过渡（见“浮动窗”）。 */
type GridFloatInput = {id: string; rect: GridRect; gesture?: "move" | "resize"; animate?: boolean};
/** 叶画成的卡片：inset 上右下左的内缩、radius 四个角（CSS 长度）；fill 是形状伸出外框（内缩为负）时伸出去那部分的颜色。 */
type GridLeafShape = {inset: [string, string, string, string]; radius: [string, string, string, string]; fill?: string};

type NestedGridEmits = {
    /** 手势建立并冻结上下文时发出。 */
    (event: "gesture-start", info: GridGestureStart): void;
    /** 每次产生新几何预览时发出；预览撤回、画面回到已发布的布局时（拖回基线、无变化松手、取消、提交被拒）也发一次，`changes` 为空、`layout` 是已发布的布局。 */
    (event: "gesture-update", preview: GridGesturePreview<unknown>): void;
    /** 手势正常结束时发出最终提交；无变化时没有提交。 */
    (event: "gesture-end", commit: GridGestureCommit): void;
    /** 手势被取消时发出原因和参与分隔线。 */
    (event: "gesture-cancel", info: GridGestureCancellation): void;
    /**
     * 诊断与被拒的提交：带 `ok` 的（`"ok" in issue`）是被拒的提交，已经回滚；其余是诊断。
     * 只发新出现的：一场手势里同一个诊断只发一次；要知道现在有哪些问题，读 `layout.issues` 与 `gesture-update` 载荷的 `issues`。
     */
    (event: "issues", issues: readonly (GridIssue<GridIssueCode | "not-published"> | GridFailure)[]): void;
    /** 内容项要被停放，这一刻焦点还在里面：焦点去哪由宿主定。 */
    (event: "content-parked", key: string): void;
    /** 量到的根盒：挂载后量到就同步发、两轴变了才再发；卸载前发 null。`useGridHost` 的整包里带着接它的处理。 */
    (event: "extent", extent: GridExtent | null): void;
    /** 指针在一扇浮动窗上按下（捕获阶段）或焦点进入它，它又不在最上面：宿主把它挪到 floats 末尾。已在最上面不发。 */
    (event: "float-raise", id: string): void;
};

type NestedGridSlots = {
    leaf(props: {node: GridLeaf<unknown>}): unknown;
    /** 内容层的一项；leaf 是它此刻所属的叶。 */
    content(props: {contentKey: string; leaf: string; active: boolean}): unknown;
    /** 拿起的内容项的头：卡片上面那一条。 */
    "lifted-head"?(props: {contentKey: string}): unknown;
    /** 盖在分隔线之上、拿起的内容之下的一层（实时布局的分区、空位），不接指针。 */
    overlay?(): unknown;
    /** 浮动窗的手柄：网格根的直接子元素，矩形同浮动窗，叠在它的内容上面；外层不接指针，里面的控件自己开。 */
    "float-chrome"?(props: {id: string; rect: GridRect}): unknown;
    /** 交换进行中静止的底：在所有外框下面、两组外框的外接矩形上；inset、radius 是裁切窗在这一层里的四边内缩（px）与四个角。 */
    "swap-backdrop"?(props: {inset: [number, number, number, number]; radius: [string, string, string, string] | null}): unknown;
    empty(): unknown;
};
```

Grid 根/叶结构的公开类型是 `GridNode<T> = GridLeaf<T> | GridBranch<T>`；分支包含 `children`，叶以 `kind: "leaf"` 区分。`leaf` 插槽仅收到叶节点，不提供额外作用域；空树与 null 根由 `empty` 插槽呈现。expose 六个方法：`settleMotion()` 把进行中的过渡直接送到终点，`placeLifted(rect)` 写拿起元素的矩形，`placeFloat(id, offset)` 写拖动中的窗挪了多少，`origin()` 是网格根的左上角（视口坐标），`motionMs()` 是网格元素上的布局过渡时长（减少动效时是 0），`leafRect(id)` 是树里这块叶此刻的矩形。

`leafRect(id)` 交回树里这块叶此刻的矩形（相对网格根，CSS px）：与网格渲染用的是同一份摆放，手势预览中是预览的，最大化时最大化的那块是盖住的外接矩形，取整与网格相同；不给过渡的中间帧。浮动窗、离开中还画着的叶、不存在的 id 交回 null。在计算属性里调用，摆放变了会重算。它只看树、不看 `floats`，所以宿主可以拿它算 `floats`（把窗夹进某块叶）而不会转个不停；同理，传给网格的 `layout` 要是发布出来的那一份，别在渲染函数里每次新算一份。

expose 的读数：

- `outgoingLeaves`：过渡里离开、还画着的叶（节点 id 集合），留着缩回去或交换里滑出去的离开的叶（已经不在 `node` 里）与这一轮降到零的叶（还在，尺寸已经是零）；宿主按它们缩回去之前的样子画挨着的东西（例如相连的卡片），不按这一刻的布局，过渡结束就空了。
- `shapedLeaves`：这一刻外框按 `leafShape` 裁的叶（长出来的、缩回去的、内容不跟外框的），宿主要在这段时间换一种形状时读它。
- `swappingLeaves`：这一刻在交换里的叶（含滑出去的），宿主在这段时间不换别的画法时读它。
- `moving`：这一刻有没有布局过渡在走（整个网格的），宿主要等过渡结束再换画法时按它“为假”判；减少动态效果时一轮过渡都不开，它一直为假。
- `outgoingLeaves`、`shapedLeaves`、`swappingLeaves` 在插槽渲染时读到的都是这一轮的（后两者也是 Spec“时序与寿命”的合同）。

未声明 attrs 按 Vue 单根行为落到外层承载 div，不透传到递归 Splitter 或叶容器。

## 状态与边界

- 默认允许分隔线交互；受控事实始终来自 `node` 与 `layout`，拖动中的临时预览才由组件持有。
- 宿主应在树、约束或承载盒尺寸变化时递增 `revision`；`node`、`contextKey`、`revision` 或 `disabled` 改变会取消活动手势。新 `layout` 发布会释放预览，宿主须保持它与树及容器尺寸同源。
- 容量不足、被宿主拒绝、宿主未发布匹配几何等问题通过 `issues` 事件报告，元素是 `{code, message, params?}`，按 `code` 与 `params` 分支，`message` 是英文、只给日志看；只发新出现的。松手、取消与卸载时宿主的监听抛出，手势已经收尾；拖动途中某一帧里抛出，手势照常进行。异常都照常冒出去。
- 空树由 `empty` 插槽处理；组件不为叶内容定义加载、错误或空数据视觉。
- 回滚只恢复到宿主最近发布的树与 layout；本组件不会自行修改树或写入快照。

## 隐藏通道理由

- `state:local`：保存拖动预览、布局盒测量和手势 scope 生命周期状态，仅在本实例的交互期间存在。
- `state:inject`：分隔线的读屏名称与取值文字经 `LAYOUT_TEXT_KEY` 注入的翻译函数取，同 [Splitter](Splitter.md) 的“文字”；名称里两侧的名字由 `paneLabel` 给，没给时是节点 id。另向后代的分隔线（`SashHandle`）提供共享 sash gesture scope，使整个 Grid 共用一次会话；这让交叉处的两根轴能一起预览和一次提交，避免每个分支各自提交半场手势。叶槽里再嵌一个公开 `NestedGrid` 或独立 `Splitter` 会得到自己的 scope。
- `env:global`：`useSashGesture` 在手势根、`window` 和 `document` 上监听指针捕获/释放、窗口失焦与 Escape，并按 viewport pointer 坐标命中分隔线；组件卸载或会话结束时移除监听。该通道为手势生命周期服务，不是常驻快捷键。分隔线的设备像素对齐（`useSashSnap`）在 `window` 上常驻 `resize` 与捕获阶段 `scroll` 监听，页面上任何滚动（包括叶里编辑器的）都排一帧、读一遍所有分隔线的位置；`useDevicePixelRatio` 监听 `resize` 与 `matchMedia`。模块级的焦点注册表（`grid-focus.ts` 的两个 `WeakMap`）是同一页面上所有 grid 共享的：同一页面只能有一份 nb-layout。

## 上游边界

`SashHandle` 负责分隔线元素，`useSashGesture` 负责命中、指针/键盘生命周期、取消和手势仲裁；布局计算与手势求解由 grid 几何模块及 Grid session 提供，矩形由 `placeGrid` 给。`NestedGrid` 承诺摆放、预览呈现、事件和同步提交：宿主拒绝提交时回滚预览并给出诊断。主工作台与编辑器工作区共用这一份渲染实现。

公开面相对递归版的变化：grid 里不再有 `data-splitter`、`data-panel-id`；`data-leaf` 在外框上，过渡中会动。
