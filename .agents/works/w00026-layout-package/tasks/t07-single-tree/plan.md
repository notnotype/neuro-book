# t07 计划：合成一棵树

## Context

**要解决什么。** 外壳、工具区域的每个容器、编辑区现在各是一棵布局树。跨树没有“同一块面板在移动”这件事，所以视图跨容器时先消失再瞬移，每种移动各写一套规则，外壳还要靠三层 Teleport 和 `TeleportMemory` 补救滚动与焦点（[提案](../../../../../docs/proposals/workbench-single-tree-layout.md)“当前问题”）。

**期望结果。** 除标题栏外，工作台是一棵树。开发者 2026-11-06 给的验收场景：`侧栏(视图 A | 视图 B) | (编辑器 A.md | 编辑器 B.md) | 右栏(视图 C | 视图 D)`，把视图 A 移到右栏，松手后看得到它从旧位置滑到新位置。

**依据。** 提案（已接受，第 1 到第 9 节）、[ADR 0044](../../../../../docs/adr/0044-workbench-single-layout-tree.md)、[nested-grid](../../../../../docs/specs/ui/nested-grid.md)、[layout-drag](../../../../../docs/specs/ui/layout-drag.md)；t04 到 t06 的成果。

**开发者已确认。** 提案决策记录全部；2026-11-06 内容跟随；2026-11-06 回复“可以”开始 t07。

**工作方式。** 主工作区的记录与 Spec 走路径限定提交；代码在 worktree；计划内工作量大的机械部分派 Sonnet 或 Haiku，核心设计主会话写，diff 自己审。

## 技术选型

无新的通用问题：继续用 `nb-layout`、TypeBox（记录校验）、`nbook.storage`（记录）、`@vue/reactivity`。不引入新依赖。

## 范围

| 在 t07 里 | 不在 t07 里 |
|---|---|
| `LayoutDoc`、规范形、领域操作、接受矩阵 | 实时布局手感：t08 |
| 内容层（实例不换父元素，跨面板有位移） | 浮动：t09。`floats` 字段在模型里，恒为空；无落点就是取消 |
| 默认树、具名面板、工具条式活动栏、面板头 | 资源树拖出树：t10。文件拖到编辑组的现有行为保留 |
| 按邻接算卡片 | 手机呈现：t11 |
| 落点指示手感的拖动，走规则 1、4 到 8；键盘拖动 | 条移到四边：t13。条在树里，位置固定 |
| 第 8 节的记录，第 9 节的命令与状态键 | Splitter 迁移：t14 |
| 组归面板：`editor.tabs`、编辑组变成 `role: "editor"` 的面板 | **统一标签条**与**每标签一实例**：新建两个 Task，排在 t07 与 t08 之间（待确认 1） |

## 关键设计

### `packages/nb-layout/src`：模型与领域操作

新增 `layout-doc.ts`（类型与操作）、`layout-drop.ts`（有序规则）。

- `LayoutDoc`、`PanelRecord`、`TabRef` 形状按提案第 1 节。`parseLayoutDoc(value)` 校验版本与引用完整性，返回 `{ok, doc}` 或问题码。
- 规范形：`normalizeTree` 展平同轴嵌套、塌陷单子分支。提案写的是 `createGrid` 补这一步；放在领域操作的出口，`createGrid` 的结构操作语义不变（现有宿主与测试依赖它）。展平时把子分支的意图按比例还给子节点。
- 领域操作都是纯函数 `(doc, input, policy) => {ok: true; doc} | {ok: false; code}`，失败不改文档：`insertTab`、`removeTab`、`activateTab`、`movePanelToEdge`、`moveTabToEdge`、`moveTabToStrip`、`setPanelHidden`、`setPanelCollapsed`、`resizeFromCommit`。
- 不变量（提案第 1 节）在操作里保证：至少一个编辑组；无名工具面板拖空移除；具名面板隐藏；编辑组拖空移除、最后一个除外。`policy` 是宿主给的接受矩阵与拖空策略，库不知道角色含义。
- 单标签面板移到别处是**同一块叶移动**：`movePanelToEdge`，叶 id 不变。这是验收场景能滑过去的前提，也让“放回原处”自然变成 no-op：结果与现状相同（规范形相等）时返回 `{ok: true, doc}` 且 `doc` 是原对象，宿主据此不提交。
- `resolveLayoutDrop`：输入摘掉来源之后的树与矩形、指针、`policy`，按提案规则 4 到 8 输出落点与提交后的预览矩形。预览矩形用提交时的同一个函数算（提案“指示画真实结果”）。

### `packages/nb-layout/src/vue/NestedGrid.vue`：内容层

新增可选 prop `contents: ReadonlyArray<{key: string; leaf: string; insetTop: number; visible: boolean}>` 与 `content` 插槽。每项一个外层元素 `.nb-grid-content`，与叶外框、分隔线是同一父元素的子元素，矩形是所属叶减去 `insetTop`。`key` 不变就不重建、不换父元素。

- 叶槽位（`leaf`）现在只放面板头；内容走这一层。不传 `contents` 的宿主行为不变。
- 过渡：与外框同一组令牌同时开始。`useGridMotion` 的 `following`、`entering` 扩展到内容项：`leaf` 变了的项从旧矩形滑到新矩形，这就是跨面板的位移；移动中的项 `z-index` 抬高，飞过别的面板时不被盖住。新项跟新叶从边上长出来。
- 不可见（非活动标签、叶为零）：`visibility: hidden` 加 `inert`，保持最后的非零尺寸，沿用 `useLeafParking` 的判定。
- `useRenderOrder`、`useGridFocus` 的 Tab 与读屏顺序纳入内容项：叶头之后紧跟这块叶的可见内容。同时处理 t06 遗留的“从 grid 外 Tab 进来、点空白后 Tab 按 DOM 序”（t07 README）。
- 接入形状的遗留（t06 记录的接入 1、2、5、10）在这里一起收：`useGridLayout` 返回可 `v-bind` 的对象；合同写明宿主与 grid 量同一个盒；`issues` 不再两个出口；过渡结束与叶停放通知宿主，外壳不再按时间猜（`SETTLE_TRACK_SLACK_MS` 去掉）。

要守的不变量：内容元素从建到销毁不换父元素，这是“内容不重建、滚动不丢”的唯一保证；`contents` 的项序只影响 DOM 序与读屏，不影响矩形。

### `packages/neuro-book/src/plugins/workbench/web/state`：布局文档 store

新增 `layout-doc-store.ts`、`default-tree.ts`、`panel-constraints.ts`；记录在 `records.ts` 加 `workbench.layout`、`workbench.layout-template`。

- 默认树：`V[H[bar:activitybar, panel:sidebar, V[panel:<编辑组>, panel:panel], panel:auxiliarybar], bar:statusbar]`。
- `resolveRef` 按提案第 4 节的约束表由 `PanelRecord` 给 min、max、sizing、collapse；视图声明的最小最大取所有标签的并。沿用 `shell/sizes.ts` 的数值。
- **隐藏不移出树**：隐藏的面板是 `collapse.collapsed` 且尺寸 0，`sashSize` 函数在它相邻处给 0。这样不用投影树，手势提交按节点 id 直接写回文档；隐藏与显示走和拖到零同一条路径，也有过渡。
- 放不下只改呈现（提案第 4 节）：在 `resolveRef` 这一步按实测容器算“呈现时收起”的工具面板，不写文档，给诊断。
- 写入：手势结束；打开、关闭、切标签合并，至多 1 秒一次。后写胜出：条件保存冲突时重读 revision 再用本窗口文档覆盖。损坏或版本不支持时回落默认并记诊断，原件不覆盖。沿用 `state/layout-store.ts` 现有的保存状态与“布局未保存”提示。
- 视图目录：`location` 只决定第一次放到哪个具名面板；未知条目留在树上显示占位（提案第 2 节）。
- 公开状态与命令按提案第 9 节，“当前面板”是最近获得焦点的面板。

### `packages/neuro-book/src/plugins/workbench/web/components`：新表面

新增 `WorkbenchSurface.vue`（一个 `NestedGrid` 加内容层）、`WorkbenchPanelHead.vue`（标签、视图动作、框架按钮）、`WorkbenchToolStrip.vue`（活动栏，列全部工具视图）。复用 `WorkbenchViewFrame`（加载、代际、失败）与 `WorkbenchStatusBar`、`WorkbenchTitleBar`。卡片按邻接：`shell/adjacency.ts` 取代 `cards.ts`，输入节点种类与相邻关系，输出四边的 outer、inner、joined，沿用现有样式变量。

- 工具面板的 `insetTop` 是面板头的固定高度（32px），收成标题行时叶高度就是它。编辑组的 `insetTop` 为 0：标签条还在 `EditorGroup` 里，统一标签条之后再改。
- 一个工具视图一个内容项，`key` 是 `view:<id>`。一个编辑组一个内容项，`key` 是 `editor:<面板 id>`。
- 有效可见按提案第 6 节算，继续喂 `ViewContext.visible` 与首次加载。

### `packages/neuro-book/src/plugins/editor/web`：组归面板

分两步，第一步不改行为：

1. `groups/groups.ts` 里的结构部分（`grid`、`splitLeaf`、`removeLeaf`、顺序、活动标签）抽成接口 `GroupStructure`，先用本地实现（行为不变，现有测试全过）。`area.ts` 只认 `groups.ts` 的 API，不用改。
2. 切换时换成工作台实现：结构在 `LayoutDoc`，标签内容（地址、编辑器、语言、preview、固定、光标）在新记录 `editor.tabs`。

`EditorArea.vue` 拆开：组级的（提示条、键位）进 `EditorGroup`；区级的（关闭询问、拖影、`focusin`）进一个无布局的 `EditorHost`，工作台挂一次。贡献点 `workbench.editor-area` 改成给 `EditorHost` 与按面板 id 渲染的组组件。

一个组仍是一个控件（每标签一实例见待确认 1），所以标签跨组移动时视图按现行输出 49 重建；**单标签的组移动是面板移动，不重建**。

### 拖动

`createShellDrag` 与 `createTabDrag` 合成 `web/layout-drag.ts`，都走 `resolveLayoutDrop` 与同一套领域操作。来源是视图标签、编辑器标签或整个面板；接受矩阵按提案第 3 节。键盘拖动沿用外壳三输出 23 的手势。收尾的高亮动画去掉：内容自己滑过去。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md`（**新建**，planned）：外壳一到三的新合同，按提案第 1 到第 9 节与“外壳现行行为的去向”。切换时晋升。切换前现行 `workbench-shell.md` 不动，它仍是现在成立的行为；切换时删掉外壳一到三，只留外壳四、首页与主题相关条目，并链接过去。
- `ui/nested-grid.md`：内容层、规范形（条目级 planned）。
- `workbench/views.md`、`workbench/commands.md`、`workbench/editor.md`、`workbench/files-explorer.md`、`theme/system.md`、设置相关：按提案“对 Spec 的预期改动”，在切换切片一起改。
- `workbench-shell-abstractions.md` 记 `superseded-by`。SDK 作者文档写 `location` 含义、`floatable`、删除的命令与状态键。
- 组件同名 `.md`：新组件补，删除的组件一起删。

## 切片

新模块先进 master，不接产品，靠单元测试与 Lab 验证；最后一片才切换。这样分支不会长期落后，外壳这几天还在被别的 Work 改。

| 片 | 内容 | 提交边界 | 自跑验证 |
|---|---|---|---|
| 1 | 新 Spec `ui/workbench-layout.md`（主工作区），交开发者看 | 只有文档 | `docs:check` |
| 2 | 模型、规范形、领域操作、落点规则 | 纯 TS 加单元测试，合入 | `nb-layout` 的 `bun run test` |
| 3 | 内容层加 Lab 场景，含验收场景的组件级版本。**这里请开发者试一次跨面板的手感** | 不影响现有宿主，合入 | `lab-grid-structure`、`lab-nested-grid` |
| 4 | 布局文档 store、默认树、约束、邻接 | 不接产品，合入 | 单元测试（真实 storage） |
| 5 | `WorkbenchSurface`、面板头、工具条，Lab 场景（用夹具文档） | 不接产品，合入 | Lab e2e |
| 6 | `groups.ts` 抽 `GroupStructure` 本地实现 | 行为不变，合入 | `groups.test.ts`、`editor-area` |
| 7 | **切换**：外壳换表面、编辑组归面板、拖动合一、命令与状态键、记录；晋升 Spec；重写 `workbench-shell`、`workbench-views`、`workbench-dnd` 的 e2e。开工前用 `nbdev status` 看谁在改外壳，排先后 | 一个分支，整片合入 | 见“验证” |
| 8 | 删旧代码：`shell/layout.ts`、`cards.ts`、`panel-state.ts`、`teleport-memory.ts`、`views/` 的落位与容器网格、`WorkbenchShellLayout`、`ToolPartHost`、`ViewContainerHost`、`PanelSurface`、旧记录的读写 | 合入 | 类型检查，全部相关 e2e |

派发：片 5 的组件样式、片 7 的 e2e 重写与 Spec 机械迁移、片 8 派 Sonnet；片 2、3、4、6 与片 7 的接线主会话写。

## 验收映射

新 Spec 的编号写完后补进这张表。先按提案的场景：

| 场景 | 覆盖 |
|---|---|
| 开发者的验收场景：视图 A 移到右栏，看得到位移 | 片 3 Lab e2e；片 7 `workbench-dnd` 真实产品一例（放慢令牌读中间帧） |
| 规则 6 的两个例子：`H[A, B, C]`、`H[V[A, B], C]` | `layout-drop` 表驱动 |
| 放回原处 no-op：视图、单标签编辑组 | 领域操作单元测试；`editor-area`、`workbench-dnd` 各一例（编辑区的已有） |
| 接受矩阵：编辑器标签进不了工具面板的标签条，能拆到旁边 | `layout-drop` 单元测试；`workbench-dnd` |
| 不变量：最后一个编辑组不被移除，具名面板隐藏不删 | 领域操作单元测试 |
| 实例不重建、滚动输入焦点不丢 | `lab-grid-structure` 验收 8 扩到内容层；`workbench-views` |
| 隐藏、收起、拖到零、十字交汇、从零拉回 | `workbench-shell` 重写后的用例 |
| 多窗口后写胜出；损坏回落、原件不覆盖 | store 单元测试（真实 storage） |
| 视图首次有效可见才加载 | `workbench-views` 现有用例 |
| 标题栏、状态栏、设置、资源管理器不回退 | `workbench-titlebar`、`settings`、`files-explorer`、`editor-area` 现有用例 |

## 验证

- 单元：`nb-layout`、`neuro-book` 按 `bun run test:affected`。
- 真实浏览器（片 7、8）：`workbench-shell`、`workbench-views`、`workbench-dnd`、`workbench-titlebar`、`editor-area`、`files-explorer`、`lab-nested-grid`、`lab-grid-structure`、`lab-drag-session`、`lab-scenes`、`lab-explorer`、`lab-editor`、`settings`、`markdown-editing`。
- 真实窗口手感由开发者确认：片 3 一次，片 7 一次。
- **未验证边界**：无头软件渲染的帧率只看相对差别；多窗口实际并发只测 store 层。

## 不做与风险

- **合入后用户在新布局的调整回退时会丢**（提案已接受）：旧记录不读、不写、不删。
- **切换片大**：e2e 73 条要重写。风险交给片 3、5 先在 Lab 跑通，片 6 先把编辑器的接缝切出来，切换片只剩接线。e2e 里编辑区的 37 条沿用 `data-editor-group` 这些标记，应该不用改。
- **别的 Work 同时改外壳**：`WorkbenchShell.vue` 三天内被改 10 次。片 7 开工前看 `nbdev status`，切换分支尽量短。
- **内容层的外层元素不在叶里**：视图里用 `closest("[data-leaf]")` 的代码会失效。片 3 全仓搜一遍，现有只有 `WorkbenchShellLayout` 用 `data-leaf-content`。
- **重内容**：内容跟随的代价在 t06 量过（`evidences/follow-content.txt`）；一棵树后手势预览的范围变大，片 7 用同一脚本重量一次。

## 待确认

1. **统一标签条、每标签一实例单列 Task，不进 t07。** 提案写了这两件事但没有分给任何 Task。放进 t07 会让切换片再大一圈。代价：t07 之后、这两个 Task 之前，标签跨组移动仍重建视图（单标签的组除外）；t08 的“卡片带真内容走”依赖每标签一实例，所以排在 t08 之前。

## 已确认

- 2026-11-06 开发者：t07 到 t11 之间窄屏只有树，接受。提案取消紧凑呈现，它依赖旧的固定拓扑，保留要多写一份。窄于 600 时界面会很挤，直到 t11 做完手机呈现；`workbench-shell` 里 390×844 的验收随之移到 t11。
