# t17 计划：每标签一实例

## Context

**要解决什么。** 现在一个编辑组一种编辑器一个控件，切标签时换绑定、换视图状态（`workbench/editor.md` 术语“视图”）。所以多标签组里的标签移到别的组时视图重建、撤销历史清空（输出 49），实时布局（t08）的卡片也带不了真内容。提案第 2 节定的是每标签一实例。

**期望结果。** 每个打开过的标签有自己的控件，切走隐藏不卸载；标签移到别的组实例不重建，光标、滚动、撤销历史都跟着走，内容从旧位置滑到新位置；每种编辑器最多留最近 20 个控件，其余卸载，切回来时光标、滚动、撤销还在。

**依据。** [提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 2 节“实例回收”；[workbench.editor](../../../../../docs/specs/workbench/editor.md) 术语、输出 7、10、49、55；[workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 14、27、33；t02 原型的数据（第二个 Monaco 约 6MB，新建 TipTap 最长帧 33 到 50ms）。

**开发者已确认。** 2026-11-06：单列 Task，排在 t07 与 t08 之间。

## 技术选型

无新依赖。

## 关键设计

### 不变量

- 内容项 `tab:<tabId>` 从建到销毁不换父元素：所以换组不重建（`NestedGrid` 的内容层已经保证）。
- 视图状态（模型、编辑状态、撤销历史）在 `binding.slot` 里，控件自己留的东西（Markdown 的 TipTap 实例）在 `controlSlot` 里，都按 `tabId|editor` 存，跟标签走。**回收只卸 Vue 组件，这两个槽都留着**（审查第 1 条：TipTap 的编辑状态只能回到同一个实例，销毁实例就丢撤销；留着实例只拿下 DOM，现有的 `onBeforeUnmount` 已经这样做）。它们只在标签关闭、换编辑器时释放。
- 同一个 Tab 在同一时刻只有一个控件实例。

### `workbench/web/state/layout-present.ts`、`WorkbenchShell`、贡献点

`layoutContents`：编辑组每个标签一项，`key` 就是标签键（`tab:<tabId>`），`active` 是面板的活动标签；没有标签的编辑组一项 `editor:<面板 id>`（空态）。`WorkbenchShell` 的 `#content`：不是视图的内容项一律画 `editorArea.group`，属性加 `tabId`（空态是 null）。工作台不解析 `tabId` 以外的东西。`NestedGrid` 停放不活动的内容项（已有）。

### `editor/web/area.ts`：从“组的绑定”到“标签的绑定”

- `binding(groupId)` 留着（活动标签的绑定，命令、状态栏都用它），内部改成 `tabBinding(tabId)`；`bindings` 按 `tabId` 存。
- 视图状态槽 `slots` 与 `controlSlots` 的键都是 `tabId|editor`：换组不换槽。`recent`、`retire`、`RETAINED_VIEWS` 删掉：槽随标签活着，不再按“每组最近 3 个”淘汰。释放只有三条路（审查第 4 条）：`releaseTab`（关闭、preview 被替换、文档关闭）放掉这个标签的全部；`reopenWith` 放掉换下的编辑器那一份；`dispose` 全放。现有按组 id 比较的 `watch` 删掉。
- 接口按标签改名，让类型检查抓到旧调用（审查第 7 条：组 id 和标签 id 都是 string，改参数不报错）：`tabBinding(tabId)`、`tabControlSlot(tabId, editor)`、`registerTabHandle(tabId, editor, handle)`、`tabWritable(tabId)`。组级的 `binding(groupId)`、`handleOf(groupId)`、`documentOf(groupId)` 留着，都是“这组活动标签的”，命令、状态栏用。
- **回收**：`mountedControls: ComputedRef<ReadonlySet<tabId>>`：各组活动标签（用一个 `watch` 盯它们的集合，记最近使用，不在七八条路径上各调一次：审查第 5 条）加上每种编辑器最近 `MOUNTED_CONTROLS_PER_EDITOR = 20` 个。不在里面的控件卸下 Vue 组件，两个槽留着。没活动过的标签不在里面（恢复时不建 200 个编辑器）。t08 的卡片要带内容时，被拖的标签已经活动过或者由它加一个保护集，那时再加。
- **preview 替换照旧换 `tabId`**（第一稿想留同一个 id，审查第 3 条指出 `remember` 这类按 id 现查的地方会写错标签，也和提案、Spec 33 不一致）。代价：方向键在资源管理器里走一路，每步建一个控件（TipTap 最长帧 33 到 50ms）；片 3 量，不够再说。
- `moveTab`、`moveToNewGroup`：结算与未裁决的拦截留着（行为不变），绑定和槽都不动。
- **焦点**：现在的 `refocusOnRemount` 靠“布局变化会重挂控件”，这条没了，但有新的同类问题：新的活动标签早就有控件，可它的内容项此刻还停放着（`inert`、`visibility: hidden`），`focus()` 静默失败（审查第 2 条）。`focusActive` 改成等这次渲染（`nextTick`）之后再聚焦；控件还没挂上时照旧等它登记（`focusWhenReady`）。
- 拆分（`split`）是新标签，带着光标（不变），撤销从空开始（不变）。

### `editor/web/components`

`EditorGroup` 改成一个标签的内容：

- 属性：`groupId`（这个标签现在在哪块编辑组，内容从 `WorkbenchShell` 拿）、`tabId: string | null`。`null` 是空态。控件的属性（`readonly`、`label`、`host`、`binding`）都按这个标签取，不按组（审查第 12 条）。
- 根的 `data-editor-group`、`data-editor-group-active` 只在这是组的活动标签时写：所以每组一个，e2e 与 `closest` 照旧。
- **活动标签才算的东西**：面包屑、横幅、进度条、失败原因、不能渲染的原因。它们读 `area` 的组级接口（`documentOf(groupId)` 等，取活动标签）；不活动的标签不算，也不画，只留控件（`NestedGrid` 已经把它停放了）。
- **控件**：`v-if` 控件允许挂载（`mountedControls`）且编辑器已交付；`binding` 是 `area.tabBinding(tabId)`；`visible` 是“这是活动标签”（和现在一样，不算被最大化盖住：`HtmlPreview` 不可见时销毁 iframe，审查第 9 条）。
- 工具栏插槽（`editorToolbarSlotKey`）每个内容一个，跟着标签走。
- **页面标签（`page://`）不隐藏保留**：只在活动时渲染，切走卸载，和现在一样（审查第 6 条：页面合同里没有可见信号，主题编辑器隐藏后会一直把预览套在应用上）。丢了记录的标签同样。

`EditorGroupHead` 不变。

### 控件

`MonacoControl`、`MarkdownControl`、`ImageViewer`、`HtmlPreview`：属性不变（`binding`、`host`、`visible`），都已经支持卸载后从槽恢复。要核对的：`visible=false` 时不抢焦点；不可见时 `ResizeObserver` 不做重活（t06 的停放保持最后的非零尺寸，不会触发）；隐藏的控件照常跟正文更新（不能懒：结算时会造成假冲突，审查第 13 条）；回收时 `onBeforeUnmount` 先交出没交出的输入。Monaco 每个实例一个主题观察者，最多 20 个，线性可以接受（第 14 条）。给第三方编辑器作者的说明：`binding` 现在一个控件一份，不再换（Spec 的控件合同写明，第 11 条）。

### 焦点

切标签时把焦点给新的活动控件的路径不变（上面“焦点”）。`onContentParked` 对编辑器内容项：等渲染之后焦点仍在 `inert` 的元素或 `body` 上（编辑器区没有接手：面板收起、被最大化盖住），移到活动编辑组的活动标签（`[data-editor-group-head-active]`），都没有时外壳根：这才符合输出 16，现在的代码直接给外壳根。编辑器区接手了（切标签、关闭、移动）时焦点已经落下，不动。

## Spec 与文档改动

- `workbench/editor.md`：术语“视图”（每个标签一个控件，不活动时隐藏，每种编辑器最多留 20 个，其余卸载且不丢光标、滚动、撤销）；控件合同（`binding` 一个控件一份，`visible` 为假时要继续跟正文）；输出 10（不变，理由变）；输出 49（移到别的组视图不重建，撤销跟着走；删“撤销历史从空开始”“以前留下的视图状态沿用”）；输出 7；全文搜“控件”“视图状态”改完（审查第 11 条）；同名 `.md`。
- `ui/workbench-layout.md`：不承诺里去掉“每标签一实例”；输出 27、33 的内容项。
- 提案不改（这是它定的）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | `area.ts` 按标签的绑定、槽、句柄与回收；内容项按标签分开：`layoutContents`、贡献点属性、`EditorGroup` 改成一个标签的内容、Lab 夹具。中间态不单独合入（审查第 7 条：只改一半时恢复 200 个标签会建 200 个编辑器） | `area.test.ts`、`groups.test.ts`、`EditorGroupHead.dom.test.ts`、`editor-area`、`editor-types`、`markdown-editing`、`lab-editor`、`workbench-dnd` 等引用 `data-editor-*` 的 11 个文件（`NB_E2E_WIDE`） |
| 2 | 回收：上限可注入（只经 Lab 夹具与 `area.test.ts`，审查第 8 条）；卸载后切回；量 30 个标签的内存、切换与 preview 连走的耗时 | 单元、`lab-editor` 新增；`evidences/` 记测量 |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| A 输入、切 B 输入、回 A 撤销只作用于 A（验收 9） | `editor-area` 现有 |
| 多标签组里的标签拖到别的组：实例不重建（`evaluateHandle` 比 DOM 节点同一性），撤销还能撤移动前的输入，光标与滚动在；内容从旧矩形滑到新矩形 | `editor-area` 新增（Monaco 与 Markdown 各一例，读计算样式的中间帧） |
| 同一文档在两组：一组输入另一组更新（验收 6） | `editor-area` 现有 |
| preview 替换：新标签新控件，旧标签的两个槽释放 | `area.test.ts`；`editor-area` 现有 preview 用例 |
| 不活动的控件跟正文：另一组输入、外部改写之后切回来是新的，不出现假冲突 | `editor-area` 新增 |
| 主题编辑器这类页面标签切走卸载 | `theme-editor` 现有 |
| 超过 20 个：最久没用的卸载；切回时光标、滚动、撤销都在 | `area.test.ts`（回收顺序）；`lab-editor` 新增（Lab 夹具把上限注入成 2，Monaco 与 Markdown 各一例） |
| 恢复会话时只建活动标签的控件 | `editor-area` 新增（数控件） |
| 关闭标签释放视图状态（`slot.dispose` 被调） | `area.test.ts` |
| 焦点：切标签、关闭标签、移动后焦点在活动视图；停放不抢外部焦点 | `editor-area` 现有 |

## 验证

`bun run test:affected --since master`；e2e 见切片（片 2 超过 8 个文件时写 `NB_E2E_WIDE`）；测量写进证据，负载写明。真实手感由开发者确认。未验证边界：几百个标签的 DOM 占用（只有打开过的才有控件，最多每种 20 个；页面标签不限）。

## 不做与风险

- **切 preview 的速度**：每步建一个控件，片 2 量；不够再考虑复用（要先解决按 id 现查的问题）。
- **内存**：视图状态随打开过的标签增长（旧规则每组每种最多 3 份，审查第 10 条）；回收只省 DOM。标签是用户自己开的，片 2 量 30 个标签的数；很大再定上限。
- **风险：把上限注入**：`MOUNTED_CONTROLS_PER_EDITOR` 经 `EditorAreaOptions` 可覆盖，只为测试不用开 21 个标签，缺省 20。
- **风险：别的代码假定一组一个控件**：`scripts/perf`；`editor-types` 里“换文档不重建控件”的用例（Spec 输出 7“控件不重建”仍成立）。接口改名让类型检查抓到。
- **`aria-owns`**：每标签一个内容项之后列表会变长，只写不停放的内容项（审查第 15 条）。
