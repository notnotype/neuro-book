# t07 计划：合成一棵树

第二稿：按设计审查（[`evidences/plan-review.txt`](evidences/plan-review.txt)，26 条）修订，归类见 [README](README.md)。

## Context

**要解决什么。** 外壳、工具区域的每个容器、编辑区现在各是一棵布局树。跨树没有“同一块面板在移动”这件事，所以视图跨容器时先消失再瞬移，每种移动各写一套规则，外壳还要靠三层 Teleport 和 `TeleportMemory` 补救滚动与焦点（[提案](../../../../../docs/proposals/workbench-single-tree-layout.md)“当前问题”）。

**期望结果。** 除标题栏外，工作台是一棵树。开发者 2026-11-06 给的验收场景：`侧栏(视图 A | 视图 B) | (编辑器 A.md | 编辑器 B.md) | 右栏(视图 C | 视图 D)`，把视图 A 移到右栏，松手后看得到它从旧位置滑到新位置。

**依据。** 提案（已接受，第 1 到第 9 节）、[ADR 0044](../../../../../docs/adr/0044-workbench-single-layout-tree.md)、[nested-grid](../../../../../docs/specs/ui/nested-grid.md)、[layout-drag](../../../../../docs/specs/ui/layout-drag.md)；t04 到 t06 的成果。

**开发者已确认。** 提案决策记录全部；2026-11-06 内容跟随；2026-11-06 回复“可以”开始 t07；2026-11-06 接受 t07 到 t11 之间窄屏只有树。

**工作方式。** 主工作区的记录与 Spec 走路径限定提交；代码在 worktree；计划内工作量大的机械部分派 Sonnet 或 Haiku，核心设计主会话写，diff 自己审。

## 技术选型

无新的通用问题：继续用 `nb-layout`、TypeBox（记录外层校验）、`nbook.storage`（记录）、`@vue/reactivity`。不引入新依赖。

## 范围

| 在 t07 里 | 不在 t07 里 |
|---|---|
| `LayoutDoc`、规范形、领域操作、接受矩阵 | 实时布局手感：t08 |
| 内容层（实例不换父元素，跨面板有位移） | 浮动：t09。`floats` 字段在模型里，恒为空；无落点就是取消 |
| 默认树、具名面板、工具条式活动栏、面板头 | 资源树拖出树：t10。文件拖到编辑组的现有行为保留 |
| 按邻接算卡片 | 手机呈现：t11 |
| 落点指示手感的拖动：规则 1、4 到 8，预备区，键盘拖动 | 条移到四边：t13。条在树里，位置固定 |
| 第 8 节的记录，第 9 节的命令与状态键 | Splitter 迁移：t14 |
| 最大化（瞬时、不落盘）、“移动到”放进标签右键、视图动作放面板头、F6、焦点交接 | **统一标签条**与**每标签一实例**：新建两个 Task，排在 t07 与 t08 之间（待确认 1） |
| 组归面板：`editor.tabs`、编辑组变成 `role: "editor"` 的面板 | 工作台发起的两阶段关闭（`requestClose`）：标签条还在编辑器里，关闭仍由编辑器发起，随统一标签条做 |

提案“外壳现行行为的去向”表逐行保留。**改动一行**：落点指示手感的收尾动画（输出 22）去掉，不再让高亮从插入线长成整块；依据是开发者 2026-11-06 的反馈“视图自己占满容器的动画就行”，由内容层的位移代替。写进新 Spec，提案追加决策记录。

## 关键设计

### 文档树与呈现树

**文档树是用户的布局，呈现树是这一刻交给 `createGrid` 的树。** 隐藏的面板留在文档树里（提案第 1 节），但不进呈现树：否则它的零宽缝夹在两个可见面板之间，拖那条缝改的是隐藏面板，不是两边。

`projectDoc(doc, facts) => {input: GridNodeInput; aliases}`，纯函数，每次文档或呈现事实变了调用，结果变了才重建 Grid（重建会让 `NestedGrid` 取消进行中的手势）。它负责：

- **去掉不呈现的面板**：隐藏的、最大化挤走的、放不下被收走的。单子分支塌陷时，把分支的外部分配给幸存者，`aliases` 记下幸存者的提交写回哪个文档节点。
- **运行约束**：按提案第 4 节的表写 min、max、collapse。
- **谁吸收余量（审查第 2 条）**：一个子节点是 `weight`，当且仅当它含编辑组，或它的兄弟都不含编辑组；其余是 `fixed`。所以 `H[工具, V[编辑组, 工具], 工具]` 的工具面板保留像素，`V[视图 A, 视图 B]` 按比例分，和现行容器网格一致（`views/container-grid.ts`），分支里总有人吸收余量，不留白。提案的约束表只在这个范围成立，写进新 Spec。
- **缝宽**：条两侧 0，其余 1。

**意图统一用 CSS px（审查第 4 条）**：结构操作之前，先把树上每个非零节点的两轴意图写成当前呈现尺寸（`rebaseIntents(doc, sizes)`）；呈现为零的节点保留原意图，那就是它展开时的尺寸。`fixed` 的 px 就是目标，`weight` 的 px 当比例用。所以展平不用换算，节点切换 `fixed` 与 `weight` 也不用换算，展平前后每个叶的尺寸不变（性质测试）。于是 `PanelRecord.restoreSize` 不需要了，从提案的形状里去掉（审查第 26 条）。

**面板可见状态表**（写进新 Spec）：

| 状态 | 文档 | 呈现 | “显示”之后 |
|---|---|---|---|
| 正常 | 无标记 | 按意图 | |
| 隐藏 | `hidden` | 不进呈现树，内容停放 | 清 `hidden` 与 `collapsed`，按意图回来 |
| 收成标题行（上下方向） | `collapsed` | 高度等于面板头，内容停放 | 清 `collapsed` |
| 拖到零（左右方向） | 意图不变，`collapsed` | 宽度 0，内容停放 | 清 `collapsed`，按意图回来 |
| 最大化挤走 | 无（内存） | 不进呈现树，内容停放 | 退出最大化 |
| 放不下被收走 | 无（内存） | 不进呈现树，内容停放，给诊断 | 窗口够大时自动回来 |

**放不下（审查第 16 条）**：`presentationCollapse(doc, extent, policy) => {removed, issues}`，纯函数：先压到最小；还放不下时按右栏、面板、侧栏、其它工具面板的顺序收走，焦点所在的面板最后；再放不下才压编辑组。只有结果集合变了才重建 Grid。

### `packages/nb-layout/src`：模型与领域操作

新增 `layout-doc.ts`（类型、校验、操作）、`layout-drop.ts`（有序规则）。

- `LayoutDoc`、`PanelRecord`、`TabRef` 形状按提案第 1 节，去掉 `restoreSize`。`validateLayoutDoc(value)` 是形状的唯一权威（审查第 19 条）：每个面板恰被树引用一次、`TabRef` 全局唯一、`active` 属于 `tabs`、条恰各一个、具名面板名唯一、至少一个编辑组、id 不能是 `__proto__` 这类键、节点数与深度上限。工作台的 TypeBox 只校验外层版本与字节。
- 规范形 `normalizeTree`：展平同轴嵌套、塌陷单子分支。放在领域操作出口，`createGrid` 的结构操作语义不变（现有宿主与测试依赖）。这是和提案写法的差异，理由同前。
- 领域操作都是纯函数 `(doc, input, policy) => {ok: true; doc} | {ok: false; code}`，失败不改文档：`insertTab`、`replaceTab`（一次写完，没有中间态）、`reorderTab`（`policy.canInsert` 问固定分区）、`removeTab`、`activateTab`、`movePanelToEdge`、`moveTabToEdge`、`moveTabToStrip`、`showPanelAndInsert`（预备区：一次写入显示并接收）、`setPanelHidden`、`setPanelCollapsed`、`resizeFromCommit`（经 `aliases` 写回）、`stripDynamicTabs`。
- 不变量（提案第 1 节）在操作里保证：至少一个编辑组；无名工具面板拖空移除；具名面板隐藏；编辑组拖空移除、最后一个除外。`policy` 是宿主给的接受矩阵与拖空策略，库不知道角色含义。
- 单标签面板移到别处是**同一块叶移动**，叶 id 不变。
- **放回原处**（审查第 17 条）：结果的拓扑、顺序、标签集合、活动标签都与现状相同时，返回原 `doc` 对象，意图不动，宿主据此不提交。不比较意图：摘出再放回，比例舍入后不会相等。
- 规则 6（放到两块之间，新块只从这两块按比例取）不是 `addLeaf` 的语义（它从全部兄弟取），操作自己写尺寸。
- `resolveLayoutDrop`：输入是摘掉来源之后的树与矩形、指针、`extraZones`（预备区）、`stripSlots`（各标签条量出来的插入位，两种标签条都能给）、`policy`；按提案规则 4 到 8 输出落点与预览矩形。预览矩形用提交时的同一个函数算。`enumerateDropCandidates`：同一份规则列出全部落点，键盘拖动用（方向键逐个，Tab 跨区）。

### `packages/nb-layout/src/vue/NestedGrid.vue`：内容层

新增可选 prop `contents: ReadonlyArray<{key: string; leaf: string; insetTop: number; active: boolean}>` 与 `content` 插槽。不传的宿主行为不变；叶槽位（`leaf`）现在只放面板头，内容走这一层。

**结构（审查第 1 条）**：每项两层，和叶外框同样的做法：外层 `.nb-grid-content` 按矩形摆放、`overflow: clip`、带过渡；内层放插槽。外层是内容自己的裁切框，不是叶外框，所以飞过别的面板时不被它们裁。内层尺寸沿用 t06 的规则：`following` 的是 `100%`（逐帧跟），新项与从零出来的是最终尺寸（外框长出来时露出它，`ResizeObserver` 只报一次）。

- **矩形（第 8 条）**：纯函数 `placeContents(placement, contents, dpr)`，`insetTop` 先按设备像素取整再减，外框顶加取整后的 inset 等于内容顶。
- **动画判定（第 5 条）**：`GridMotionFrame` 带上内容矩形，`placementMoved` 一起比；`watch` 同时看叶与内容。所以“标签并入已有面板，两块叶都不动”时内容也滑过去。
- **叠放（第 6 条）**：根上 `isolation: isolate`，三层固定：外框 0、内容 1、分隔线 2；飞行中的内容在内容层里再抬一级。
- **停放**：不活动的标签、叶为零、找不到叶（第 20 条，文档与树发布不同步的瞬间）都是 `visibility: hidden` 加 `inert`，保持最后的非零尺寸，不卸载。
- **焦点（第 7 条）**：`GridFocusItems` 的一“站”改成 `{frame, content | null}` 的并集，`contains`、`atEdge`、`lastFocused`、哨兵都按并集算。DOM 序：新内容紧跟它的叶外框之后；换叶之后不搬，靠 `aria-owns` 与接管 Tab，这条路径 t07 之后是常态。t06 遗留的“从 grid 外 Tab 进来、点空白后 Tab”这里解决：根上 `focusin` 从外面进来且不在树序首尾时，重定向到首或尾；叶外框给 `tabindex="-1"` 接住点击。
- **焦点交接（第 21 条）**：新事件 `content-parked(key)`，发出时焦点还在里面；`WorkbenchSurface` 把焦点移到同面板的标签或最近的框架控件，焦点在外壳之外时不抢。取代 `WorkbenchShellLayout` 的 `focusTarget`。
- **无障碍（第 24 条）**：分隔线的 `aria-controls` 列外框与活动内容的 id。

要守的不变量：内容元素从建到销毁不换父元素，这是“内容不重建、滚动不丢”的唯一保证。

### `packages/neuro-book/src/plugins/workbench/web/state`：布局文档 store

新增 `layout-doc-store.ts`、`default-tree.ts`、`project-doc.ts`；记录在 `records.ts` 加 `workbench.layout`、`workbench.layout-template`，都显式 `maxBytes: MAX_RECORD_MAX_BYTES`（缺省 64KiB 不够，第 19 条）。

- 默认树：`V[H[bar:activitybar, panel:sidebar, V[panel:<编辑组>, panel:panel], panel:auxiliarybar], bar:statusbar]`。具名面板的叶 id 就是名字（`sidebar`），`[data-leaf="sidebar"]` 这类约定不变。
- 第一次生成文档时：有视图的具名面板显示，空的隐藏（等于现行输出 39、42 的缺省）。之后新出现的视图按 `location` 加到面板标签末尾，面板隐藏着就保持隐藏（提案第 1 节）。
- 最大化是 store 的内存状态，进 `projectDoc`，不落盘。
- 写入：手势结束；打开、关闭、切标签合并，至多 1 秒一次。后写胜出。损坏或版本不支持时回落默认并记诊断，原件不覆盖。沿用现有“布局未保存”。
- **未绑定项目（第 10 条）**：`editor.tabs` 不落盘，所以存盘前 `stripDynamicTabs`，刷新后没有坏标签。
- **两条记录（第 11 条）**：`tabId` 用随机不透明串，不用计数器。`editor.tabs` 按键合并（`change` 在最新值上重放，和现行定制一样）。保存顺序先 `editor.tabs` 后 `workbench.layout`，前者失败后者不写；崩在两次之间只多一条无主的项，恢复时丢弃。“布局未保存”算上这条。
- 视图目录：`location` 只决定第一次放到哪个具名面板；未知条目留在树上显示占位（提案第 2 节）。
- 公开状态与命令按提案第 9 节，“当前面板”是最近获得焦点的面板。

### `packages/neuro-book/src/plugins/workbench/web/components`：新表面

新增 `WorkbenchSurface.vue`（一个 `NestedGrid` 加内容层）、`WorkbenchPanelHead.vue`（标签、视图动作、框架按钮）、`WorkbenchToolStrip.vue`（活动栏，列全部工具视图）。卡片按邻接：`shell/adjacency.ts` 取代 `cards.ts`，输入节点种类与相邻关系，输出四边的 outer、inner、joined，沿用现有样式变量。

- **复用**：`WorkbenchViewFrame`（加载、代际、失败）、`WorkbenchStatusBar`、`WorkbenchTitleBar`；面板头的标签用 nb-ui `Tabs` 与 `tabs-adapt`（四档让位），活动栏用 `item-strip`（“更多”）；F6 沿用 `attachPaneFocus`；拖动播报沿用 `data-drop-feedback-live`。
- 面板头的标签部分按提案第 5 节 `TabStripProps` 的形状接参，以后换成统一标签条不改调用方（待确认 1 的条件）。
- 工具面板的 `insetTop` 是面板头高度（32px），收成标题行时叶高度就是它。编辑组的 `insetTop` 为 0：标签条还在 `EditorGroup` 里，统一标签条之后再改。
- 工具视图一个内容项，`key` 是 `view:<id>`。编辑组一个内容项，`key` 由编辑器给（现在是 `editor:<面板 id>`，每标签一实例之后是 `editor:<tabId>`）。`data-editor-group`、`data-editor-group-active` 放在内容项的根元素上，作为编辑器的对外标记写进 Spec，e2e 与 `scripts/perf` 不用各自适配。
- 标签右键菜单：“移动到”（面板、新面板）、命令 `nbook.view.move-view` 的目标改成面板 id。
- 有效可见按提案第 6 节算，继续喂 `ViewContext.visible` 与首次加载。

### `packages/neuro-book/src/plugins/editor/web`：组归面板

接缝按**标签级操作**切（第 12 条）。先把 `groups/groups.ts` 拆成两块，各有单元测试，行为不变：

- `PanelTabs`：每面板有序的标签 id、活动标签、插入、移动、替换，带 `canInsert`（固定分区由编辑器回答）。
- `PanelTree`：拆分、移除、邻接。`side`（右侧相邻）只在 `role: "editor"` 的面板里找，所以换成一棵树之后不会找到工具面板。
- 标签属性（地址、编辑器、语言、preview、固定、光标）留在编辑器，变成记录 `editor.tabs`。

先用本地实现，切换时换工作台实现。`area.ts` 有三处要跟着改（`layoutVersion`、`snapshot`、`EditorArea.vue` 读 `grid`）。活动编辑组的所有者是工作台（`currentEditor`），编辑器经服务读写。

`EditorArea.vue` 拆开：组级的（提示条、键位）进 `EditorGroup`；区级的（关闭询问、拖影、`focusin`）进一个无布局的 `EditorHost`，工作台挂一次。贡献点 `workbench.editor-area` 改成给 `EditorHost` 与按面板 id 渲染的组组件。

一个组仍是一个控件（每标签一实例见待确认 1），所以多标签组里的标签跨组移动时视图按现行输出 49 重建；**单标签的组移动是面板移动，不重建**。

### 拖动

新建 `web/layout-drag.ts`，工具视图先走（片 7a），编辑器标签并入（片 7b），都用 `resolveLayoutDrop` 与同一套领域操作。来源是视图标签、编辑器标签或整个面板；接受矩阵按提案第 3 节。键盘沿用外壳三输出 23 的手势，落点来自 `enumerateDropCandidates`。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md`（**新建**，planned）：外壳一到三的新合同，按提案第 1 到第 9 节、“外壳现行行为的去向”、上面的可见状态表。`ui/workbench-shell.md` 文首写明外壳一到三将被它取代，切换前仍是现行合同；别的 Work 改外壳时改旧的，切换片把仍成立的搬过来。切换时删掉外壳一到三，只留外壳四、首页与主题相关条目。
- `ui/nested-grid.md`：内容层、规范形（条目级 planned）。
- `workbench/views.md`、`workbench/commands.md`、`workbench/editor.md`、`workbench/files-explorer.md`、`theme/system.md`、设置相关：片 1 加条目级 planned，切换片去掉标记、删旧条目。
- `workbench-shell-abstractions.md` 记 `superseded-by`。SDK 作者文档写 `location` 含义、`floatable`、删除的命令与状态键。提案追加决策记录：收尾动画、`restoreSize` 去掉、余量规则。
- 组件同名 `.md`：新组件补，删除的组件一起删。

## 切片

新模块先进 master，不接产品，靠单元测试与 Lab 验证。这样分支不会长期落后，外壳这几天还在被别的 Work 改。

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| 1 | 新 Spec；现行输出与 e2e 73 条的去向表（保留、改写、删除、由 Lab 取代） | 只有文档，交开发者看 | `docs:check` |
| 2 | 模型、规范形、`projectDoc`、领域操作、落点规则 | 纯 TS 加单元测试，合入 | `nb-layout` 的 `bun run test` |
| 3 | 内容层加 Lab 场景，含验收场景的组件级版本。**请开发者试一次跨面板的手感** | 不影响现有宿主，合入 | `lab-grid-structure`、`lab-nested-grid`、`editor-area`、`workbench-shell` |
| 4 | 布局文档 store、默认树、约束、邻接 | 不接产品，合入 | 单元测试（真实 storage） |
| 5 | `WorkbenchSurface`、面板头、工具条，Lab 场景（用夹具文档） | 不接产品，合入 | Lab e2e |
| 6 | `groups.ts` 拆成 `PanelTabs`、`PanelTree` 本地实现，`tabId` 改随机串 | 行为不变，合入 | `groups.test.ts`、`editor-area` |
| 7a | **外壳切换**：表面、工具面板、条、记录、命令与状态键、工具视图的拖动（指针、键盘、预备区）。编辑区暂时是树里一块 `role: "editor"` 的面板，里面还是现有的 `EditorArea`。重写 `workbench-shell`、`workbench-views`、`workbench-dnd`。t06 接入遗留 1、2、5、10 跟着宿主改。**真实产品里你的验收场景到这一片成立，请开发者再试一次**。开工前用 `nbdev status` 看谁在改外壳，排先后 | 一个分支，整片合入 | 见“验证” |
| 7b | **编辑组归面板**：`PanelTabs`、`PanelTree` 换工作台实现，`editor.tabs`，`EditorHost`，标签拖动并入。编辑器标签能拆到工具面板旁边 | 合入 | `editor-area` 与下面列的编辑器相关 e2e |
| 8 | 删旧代码，晋升 Spec。`shell/layout.ts`、`cards.ts`、`panel-state.ts`、`teleport-memory.ts`、`sizes.ts` 不再用的部分、`views/` 的落位与容器网格、`public-state.ts` 与 `panel-commands.ts` 的旧键、locales 的旧条目、`WorkbenchShellLayout`、`ToolPartHost`、`ViewContainerHost`、`PanelSurface`、Lab 的 `WorkbenchShellLayoutFixture`、`ShellViewsScene`（迁到新场景）、旧记录的读写 | 合入 | 类型检查，全部相关 e2e |

派发：片 1 的去向表、片 5 的组件样式、片 7a 的 e2e 重写、片 8 派 Sonnet；片 2、3、4、6 与片 7 的接线主会话写。片 2、3 没把握，当场派实现审查（前端，Sonnet）。

## 验收映射

新 Spec 的编号写完后补进这张表。先按提案的场景：

| 场景 | 覆盖 |
|---|---|
| 开发者的验收场景：视图 A 移到右栏，中间帧内容矩形严格在新旧矩形之间，且与外框差值恒为 inset | 片 3 Lab e2e；片 7a `workbench-dnd` 真实产品一例（放慢令牌读中间帧） |
| 标签并入已有面板，两块叶都不动，内容滑过去 | `decideMotion` 表驱动；片 3 Lab e2e |
| 新叶揭示：`ResizeObserver` 只报一次；飞行中不被邻叶裁 | 片 3 Lab e2e（nested-grid 验收 9 扩到内容层） |
| 内容换叶后仍可见（`elementFromPoint` 命中内容）；Tab、F6、`aria-owns` 按树序 | 片 3 Lab e2e |
| 规则 6 的两个例子：`H[A, B, C]`、`H[V[A, B], C]` | `layout-drop` 表驱动 |
| 全是工具面板的分支不留白；展平前后叶尺寸不变（fixed、weight、混合） | `project-doc`、`layout-doc` 单元测试 |
| 隐藏在首、中、尾、相邻两个、挨着条：缝与可拖的边界正确 | `project-doc` 表驱动 |
| 放回原处 no-op（带非整数比例）：视图、单标签编辑组 | 领域操作单元测试；`editor-area`、`workbench-dnd` 各一例（编辑区的已有） |
| 接受矩阵：编辑器标签进不了工具面板的标签条，能拆到旁边 | `layout-drop` 单元测试；`workbench-dnd` |
| 不变量：最后一个编辑组不被移除，具名面板隐藏不删 | 领域操作单元测试 |
| 实例不重建、滚动输入焦点不丢 | `lab-grid-structure` 验收 8 扩到内容层；`workbench-views` |
| 隐藏、收起、拖到零、十字交汇、从零拉回、最大化 | `workbench-shell` 重写后的用例 |
| 预备区：隐藏的面板放上去，显示并接收 | `workbench-dnd` |
| 键盘拖动 | `enumerateDropCandidates` 单元测试；`workbench-dnd` |
| 焦点交接：隐藏、挤走时焦点到可见控件；外壳之外不抢 | `workbench-shell` |
| 放不下：先压、再按顺序收走、最后压编辑组；窗口变大回来 | `presentationCollapse` 表驱动 |
| 多窗口后写胜出；损坏回落、原件不覆盖；旧键原样保留；首次用默认树 | store 单元测试（真实 storage） |
| 未绑定窗口存盘没有动态标签；`editor.tabs` 失败时布局不写；两个窗口各开一个标签刷新后都没有占位 | store 单元测试 |
| 恢复：`editor.tabs` 缺的 `tabId` 显示原因可关闭；编辑器入口未交付时标签仍在；未知视图显示占位 | store 单元测试；`workbench-views` |
| 视图首次有效可见才加载 | `workbench-views` 现有用例 |
| 重内容：10 万字章节相邻让位的单帧耗时，记数不设门槛（无头环境不可靠） | 片 7a 用 t06 的脚本重量，写进证据 |
| 标题栏、状态栏、设置、资源管理器不回退 | `workbench-titlebar`、`settings`、`files-explorer` 现有用例 |

## 验证

- 单元：`nb-layout`、`neuro-book` 按 `bun run test:affected`。
- 真实浏览器（片 7a、7b、8）：`workbench-shell`、`workbench-views`、`workbench-dnd`、`workbench-titlebar`、`editor-area`、`files-explorer`、`lab-nested-grid`、`lab-grid-structure`、`lab-drag-session`、`lab-scenes`、`lab-explorer`、`lab-editor`、`settings`、`markdown-editing`；依赖会变动的标记的 `plugin-code`、`plugin-authoring`、`editor-types`、`themes`、`markdown-input`、`bookshelf-stats`、`editor-code-settings`；`scripts/perf` 跑一次。
- 真实窗口手感由开发者确认：片 3 一次（Lab），片 7a 一次（产品），片 7b 一次（编辑器）。
- **未验证边界**：无头软件渲染的帧率只看相对差别；多窗口实际并发只测 store 层。

## 不做与风险

- **合入后用户在新布局的调整回退时会丢**（提案已接受）：旧记录不读、不写、不删。
- **片 7a 大**：e2e 73 条要改写（`workbench-dnd`、`workbench-views` 依赖的容器概念本身取消了）。风险交给片 3、5 先在 Lab 跑通，片 1 先定每条的去向。`editor-area` 的 37 条沿用 `data-editor-group` 这些标记，应该不用改。
- **片 7a 与 7b 之间**：编辑区还是一棵子树，编辑器标签不能拆到工具面板旁边，视图也不能放进编辑组之间；其余都是新行为。
- **别的 Work 同时改外壳**：`WorkbenchShell.vue` 三天内被改 10 次。片 7a 开工前看 `nbdev status`，切换分支尽量短。
- **内容层的外层不在叶里**：视图里用 `closest("[data-leaf]")` 的代码会失效。片 3 全仓搜一遍，现有只有 `WorkbenchShellLayout` 用 `data-leaf-content`。
- **重内容**：内容跟随的代价在 t06 量过（`t06 evidences/follow-content.txt`）；飞行中的内容如果换尺寸也要每帧排版。

## 待确认

1. **统一标签条、每标签一实例单列 Task，不进 t07。** 提案写了这两件事但没有分给任何 Task。放进 t07 会让切换片再大一圈。代价：在它们做完之前，多标签组里的标签跨组移动仍重建视图，撤销历史也清空，和今天一样；单标签的组是整块移动。t08 的“卡片带真内容走”对编辑器标签依赖每标签一实例，对工具视图不依赖。开发者还没回复，按建议先走。

## 已确认

- 2026-11-06 开发者：t07 到 t11 之间窄屏只有树，接受。提案取消紧凑呈现，它依赖旧的固定拓扑，保留要多写一份。窄于 600 时界面会很挤，直到 t11 做完手机呈现；`workbench-shell` 里 390×844 的验收随之移到 t11。
