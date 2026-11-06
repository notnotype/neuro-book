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
- 视图状态（模型、编辑状态、撤销历史）在 `binding.slot` 里，跟标签走；控件卸载不影响它，它只在标签关闭、编辑器换了、地址换了时释放。所以回收控件不丢东西。
- 同一个 Tab 在同一时刻只有一个控件实例。

### `workbench/web/state/layout-present.ts`、`WorkbenchShell`、贡献点

`layoutContents`：编辑组每个标签一项，`key` 就是标签键（`tab:<tabId>`），`active` 是面板的活动标签；没有标签的编辑组一项 `editor:<面板 id>`（空态）。`WorkbenchShell` 的 `#content`：不是视图的内容项一律画 `editorArea.group`，属性加 `tabId`（空态是 null）。工作台不解析 `tabId` 以外的东西。`NestedGrid` 停放不活动的内容项（已有）。

### `editor/web/area.ts`：从“组的绑定”到“标签的绑定”

- `binding(groupId)` 留着（活动标签的绑定，命令、状态栏都用它），内部改成 `tabBinding(tabId)`；`bindings` 按 `tabId` 存。
- 视图状态槽 `slots` 的键去掉组（`tabId|editor|documentId`）：换组不换槽。`recent`、`retire`、`RETAINED_VIEWS` 删掉：槽随标签活着，不再按“每组最近 3 个”淘汰（那是控件共用时为了省内存；现在关掉标签就释放）。
- `controlSlot(groupId, editor)` 改 `controlSlot(tabId, editor)`，`handles` 的键改 `tabId|editor`，`registerHandle` 同。`handleOf(groupId)` 取活动标签的句柄。
- **回收**：新增 `mountedControls: ReadonlySet<tabId>` 与 `touchTab(tabId)`：标签成为活动标签时记入最近使用，每种编辑器超过 `MOUNTED_CONTROLS_PER_EDITOR = 20` 时卸载最久没用、此刻不是任何组活动标签的那个，并 `dropControlSlot`（控件自己保留的编辑器实例，比如 TipTap，随之销毁）；`binding.slot` 不动。
- **preview 替换留在同一个 `tabId`**（`groups.open`）：地址、编辑器换掉，`tabId` 不变，所以 `PanelTabs.replace` 不走，控件走现成的换绑定路径（`watch(() => props.binding)`）。否则方向键在资源管理器里走一路，每步都建一个控件。`releaseTab` 只释放旧文档的引用与槽。**要核对**：别的地方把“tabId 不变”当成“文档不变”的（`known` 记录、`pendingReveal`、标签菜单身份、`bindings` 的 token）。
- `moveTab`、`moveToNewGroup`：结算与未裁决的拦截留着（行为不变），去掉“重建”的处理：绑定和槽都不动。`registerHandle` 的 `refocusOnRemount` 这条靠“布局变化会重挂控件”的逻辑删掉：一棵树之后不重挂。
- 拆分（`split`）是新标签，带着光标（不变），撤销从空开始（不变）。

### `editor/web/components`

`EditorGroup` 改成一个标签的内容：

- 属性：`groupId`（这个标签现在在哪块编辑组，内容从 `WorkbenchShell` 拿）、`tabId: string | null`。`null` 是空态。
- 根的 `data-editor-group`、`data-editor-group-active` 只在这是组的活动标签时写：所以每组一个，e2e 与 `closest` 照旧。
- **活动标签才算的东西**：面包屑、横幅、进度条、失败原因、不能渲染的原因。它们读 `area` 的组级接口（`documentOf(groupId)` 等，取活动标签）；不活动的标签不算，也不画，只留控件（`NestedGrid` 已经把它停放了）。
- **控件**：`v-if` 控件允许挂载（`mountedControls`）且编辑器已交付；`binding` 是 `area.tabBinding(tabId)`；`visible` 是“这是活动标签”且内容没被盖住。第一次成为活动标签才挂（恢复会话时不建 200 个编辑器）。
- 工具栏插槽（`editorToolbarSlotKey`）每个内容一个，跟着标签走。
- 页面标签（`page://`）、丢了记录的标签同样按标签画，组件第一次活动才建。

`EditorGroupHead` 不变。

### 控件

`MonacoControl`、`MarkdownControl`、`ImageViewer`、`HtmlPreview`：合同不变（`binding`、`host`、`visible`），都已经支持换绑定与卸载后从槽恢复。要核对的只有两件：绑定在 `visible=false` 时不抢焦点；不可见时 `ResizeObserver` 不做重活（Monaco `layout`）。t06 的停放保持最后的非零尺寸，不会触发。

### 焦点

`focusActive` 里“控件要重挂”的等待保留给“控件还没挂上”（第一次活动），`refocusOnRemount` 删掉。切标签时把焦点给新的活动控件的路径不变。停放的内容里的焦点：`content-parked` 已经把焦点交给宿主（`onContentParked`）；编辑器标签的 `key` 现在是 `tab:<id>`，`onContentParked` 要认：视图以外的不抢，编辑器自己的 `focusActive` 处理。

## Spec 与文档改动

- `workbench/editor.md`：术语“视图”（每个标签一个控件，不活动时隐藏，每种编辑器最多留 20 个，其余卸载且不丢光标、滚动、撤销）；输出 10（不变，理由变）；输出 49（移到别的组视图不重建，撤销跟着走；删“撤销历史从空开始”“以前留下的视图状态沿用”）；输出 7；同名 `.md`。
- `ui/workbench-layout.md`：不承诺里去掉“每标签一实例”；输出 27、33 的内容项。
- 提案不改（这是它定的）。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | `area.ts`：按标签的绑定、槽、句柄、回收、preview 留 `tabId`；组里还是一个内容项，`EditorGroup` 里按标签 `v-for` 挂控件（`v-show` 活动的）。这一片行为不变，只是控件不再共用 | `area.test.ts`、`groups.test.ts`、`editor-area` 里撤销与切换相关 |
| 2 | 内容项按标签分开：`layoutContents`、贡献点属性、`EditorGroup` 改成一个标签的内容、Lab 夹具。跨组移动不重建，有位移 | `editor-area`、`editor-types`、`markdown-editing`、`lab-editor`、`workbench-dnd` |
| 3 | 回收与性能：20 个的上限，卸载后切回；量 30 个标签的内存与切换耗时 | 单元、`editor-area` 新增；`evidences/` 记测量 |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| A 输入、切 B 输入、回 A 撤销只作用于 A（验收 9） | `editor-area` 现有 |
| 多标签组里的标签拖到别的组：实例不重建（窗口上的计数），撤销还能撤移动前的输入，光标与滚动在；内容从旧矩形滑到新矩形 | `editor-area` 新增（Monaco 与 Markdown 各一例，读计算样式的中间帧） |
| 同一文档在两组：一组输入另一组更新（验收 6） | `editor-area` 现有 |
| preview 连续替换不建新控件 | `area.test.ts`（`tabId` 不变，绑定换了）；`editor-area` 现有 preview 用例 |
| 超过 20 个：最久没用的卸载；切回时光标、滚动、撤销都在 | `area.test.ts`（回收顺序）；`editor-area` 新增（把上限注入成 2） |
| 恢复会话时只建活动标签的控件 | `editor-area` 新增（数控件） |
| 关闭标签释放视图状态（`slot.dispose` 被调） | `area.test.ts` |
| 焦点：切标签、关闭标签、移动后焦点在活动视图；停放不抢外部焦点 | `editor-area` 现有 |

## 验证

`bun run test:affected --since master`；e2e 见切片（片 2 超过 8 个文件时写 `NB_E2E_WIDE`）；测量写进证据，负载写明。真实手感由开发者确认。未验证边界：几百个标签的 DOM 占用（只有打开过的才有控件，最多每种 20 个；页面标签不限）。

## 不做与风险

- **切 preview 的速度**：同一个 `tabId` 走换绑定，和现在一样。
- **风险：把上限注入**：`MOUNTED_CONTROLS_PER_EDITOR` 经 `EditorAreaOptions` 可覆盖，只为测试不用开 21 个标签，缺省 20。
- **风险：别的代码假定一组一个控件**：`handleOf(groupId)`、`activeHandle`、`registerHandle` 的调用方；`scripts/perf`；`editor-types` 里“换文档不重建控件”的用例（Spec 输出 7“控件不重建”仍成立）。片 1 就把 `area` 的接口换掉，类型检查抓得到。
- **风险：不活动的 Monaco 收到文档更新**（另一组输入）：`binding.text` 变了要更新模型，隐藏着也要更新，否则切回来是旧的；现行的共用控件切回时才换。片 1 核对。
