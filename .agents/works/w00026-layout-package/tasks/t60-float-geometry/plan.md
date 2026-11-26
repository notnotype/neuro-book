# t60 实施计划：浮动窗的几何接口（摩擦第 3 组）

第 1 稿（规划子代理起草，主会话 2026-11-26 核对定稿，起点 master `d8faf5ed5`）。探针副本在 [evidences/](evidences/)：`probe-geometry.test.ts.txt`（bun test，输出 `probe-geometry-output.txt`）、`probe-float.dom.test.ts.txt`（happy-dom）；使用方清单 `consumers.txt`。

## Context

- 起因：t50 的三个示例只经公开入口写，桌面示例为浮动窗自补了一批几何（`deskClamp` 减原点、`withinDesk` 求交、`leafRect` 再跑一遍 `placeGrid`、`raiseOnPress`、`tileOnNextFrame`、非响应式的 `dpr`）。摩擦第 3 组共 15 条：11、12、13、23、24、25、28、38、39、48、49、50、51、52、53（[摩擦记录](../t50-example-app/friction.md)，[0.3.0 复查](../t50-example-app/evidences/friction-recheck-0.3.0.md)：52 已解决，11、13、48、50、53 部分，其余 9 条没解决）。
- 期望结果：几何收进库，桌面示例、工作台、Lab 共用一份；桌面示例的自补几何删短，README“绕过的库的空缺”跟着改。15 条逐条的处理见文末“逐条处理”。
- 依据：[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的“浮动窗”一组（输出 101 到 115）；[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 39、45、51；ADR 0054 第 10 条（0.x 期间公开面只承诺 `@stable` 的名字，新名字一律 `@experimental`）。
- 工作方式（开发者定）：编码派 coder 子代理，主会话审 diff、自己跑验证并合入，不做逐 Task 的审查，一批做完整段交 omp 一次。改变产品行为或公开接口的取舍列在“待确认”，默认按推荐做，记进 `pending-confirmations.md`。
- 与 w00043 t19 的关系（要先定）：t19（在做，片 3b 已提交，下一步片 4）的第 6 片也要改 `grid-motion.ts`、`NestedGrid.vue`、`FloatWindowHandles.vue`：程序改宽度时的过渡（nested-grid 输出 105 的 planned 指引）、“窗的手柄只结算动的边”、夹取。t60 先合入，t19 到第 6 片时变基、直接用 t60 的 `animate`、`area` 与 `commit` 的第二个参数，不另做第二套开关，也不给同一行为另起编号（待确认 1）。主会话已在 t19 的 README“下一步”留了协调的一行（t19 的租约属另一个会话，16 小时前活动过，联系不上）。
- 没做的：独立设计（另请一个只拿到目标的子代理出一版）不补：方案多数是把示例里已验证的绕法收进库，探针逐个对照了等价。

## 技术选型

无。几何与过渡都在 nb-layout 已有的模块里改：`grid-rects.ts`、`grid-motion.ts`、`useGridMotion.ts`、`NestedGrid.vue`、`FloatWindowHandles.vue`；稳定次序沿用 `grid-motion.ts` 的 `stableOrder`。

## 关键设计

### `packages/nb-layout/src/grid-rects.ts`（夹取与缩放，条目 23、24）

`clampFloatRect` 收区域矩形，`keep` 可省；类型只放宽，不改名：

```ts
/** @experimental */
export function clampFloatRect(rect: GridRect, area: GridRect | GridExtent, keep?: {readonly width: number; readonly height: number}): GridRect
```

- 原点：`area` 的 `x`、`y` 是有限数时用它，否则为 0。今天传 `GridRect` 能通过类型检查，但 `x`、`y` 被静默忽略：探针里桌面从 x=300 起，窗 x=100 被夹在 100，落进平铺窗里；`deskClamp` 得 300。
- 尺寸：`width = min(rect.width, area.width)`，高同理（不变）。
- `keep`：不给时是整扇窗；给了也不超过上一步缩后的尺寸。这修的是探针复现的 x=-200（800 宽的窗、600 宽区域、keep 取窗自己的大小）。
- 位置：`x = ox + clamp(rect.x - ox, keepW - width, area.width - keepW)`，`y = oy + clamp(rect.y - oy, 0, area.height - keepH)`，上边总在区域里（不变）。
- 对照（探针 `geometry.test.ts`）：只传尺寸、`keep` 不超过缩后尺寸时，与今天逐个相同（11817 个随机样本）。工作台的 `keepVisible`（keep 80×32，浮动窗最小 160×80）与 `wholeInTree`（`floatSize` 已把尺寸夹进区域）都落在这一类，现有单测 `grid-rects.test.ts` 的“夹取”与 `drag-geometry.test.ts` 的三条不用改。传区域矩形、`keep` 不给时，与 `deskClamp` 逐个相同（20000 个样本）；桌面的 `moveTarget` 换成一行 `roundRect(clampFloatRect(…, desk))`，结果相同（5000 个样本）。

`resizeFloatRect` 的 `bounds` 加可选的 `area`，`max` 改成可选：

```ts
/** @experimental */
export function resizeFloatRect(start: GridRect, direction: LayoutFloatResize, delta: {readonly x: number; readonly y: number}, bounds: {readonly min: GridExtent; readonly max?: GridExtent; readonly area?: GridRect}): GridRect
```

- 规则：跟着指针的边不越过 `area`。起点就在区域外的边不再往外拉，也不往里跳；不动的边不变。实现上把它折成那一轴的上限：右边是 `max(区域右缘, 起点右缘) - start.x`，左边是 `start 右缘 - min(区域左缘, start.x)`，与 `max` 取小；之后照旧按 `min` 夹，`min` 优先。
- 对照：起点在区域里、最小尺寸放得下时，结果等于桌面示例的“先缩放、再与桌面求交、取整”（20000 个样本，0 个不同）。只给 `max` 时与今天相同（5000 个样本）。起点右缘已在区域外时，往外拉宽度不变，往里拉照常（探针“推荐 24”）。
- 不导出新类型；JSDoc 写清 `area` 的含义。

### `packages/nb-layout/src/vue/FloatWindowHandles.vue`（条目 24、38、51、48 的说明）

- 属性：加 `area?: GridRect`，原样进 `bounds`，指针与键盘缩放都按它；`max` 改成可选（缺省不限）。Lab 的场景（`fixtures/nb-layout/index.ts`）照传 `max`，不用改。
- 事件：`commit` 加第二个参数 `direction: LayoutFloatResize`，是这次动的边：指针取按下的手柄，键盘缩放取右下角。`preview` 不变。工作台的监听只取第一个参数，不受影响。
- 先后不变（探针：`preview → preview(null) → commit`，同一个同步段），在 `.md` 与 JSDoc 里写明：松手时先 `preview(null)` 再 `commit`；Esc 与失去捕获只发 `preview(null)`；`rect` 是已夹取的呈现矩形，没动的那一轴在 `commit` 里也是夹过的值，要保住记录的宿主只取 `direction` 不为 0 的轴。
- `.md` 补一句：手柄在 `pointerdown`、`keydown` 里阻止冒泡（`.vue` 第 61、87、97 行），要在按下时抬升，用 `NestedGrid` 的 `float-raise`（见下节），或在外层的捕获阶段听。

### `packages/nb-layout/src/vue/NestedGrid.vue`（条目 39、48、25、13、12）

**手柄层按稳定次序渲染（39）**
- 现状：`float-chrome` 层是 `v-for="float in floats"`，DOM 次序跟着 `floats` 走（`.vue` 第 644 行）。外框与内容走 `useRenderOrder` 的 `stableOrder`，不搬。
- 探针 `float.dom.test.ts`：四扇窗，抬升最底下的 notes，Vue 搬的是 notes 自己的手柄层节点，按钮的焦点丢了；抬升 clock，搬的是 files，焦点还在。桌面 e2e“按住后面那扇窗的缩放手柄”用的正是 clock，所以对这条是空过的。这违反已实现的输出 103“换次序只改层级，不搬节点”。工作台在 focusin 时抬升，Tab 走到后面那扇窗的移动把手，焦点很可能当场丢（片 0 浏览器核）。
- 改法：手柄层按 `stableOrder(上一轮的 id 序列, floats 的 id)` 渲染。还在的保持相对次序，新的接在后面。和 `useRenderOrder` 一样必须在 `computed` 里同步算，注释照抄它的那条理由。层级照旧由 `floatLayer` 按 `floats` 的下标写 `z-index`。手柄之间的 Tab 次序从“叠放次序”变成“出现次序”，在 `.md` 里写一句。

**抬升的请求 `float-raise`（48）**
- 新事件 `(event: "float-raise", id: string)`，加进 `defineEmits` 与 `.md` 的 Emits。
- 根元素加 `@pointerdown.capture`，并在已有的 `@focusin` 里一起判：从事件目标往上走到根元素的直接子元素，读它的 `data-leaf`、`data-content-leaf`、`data-float-chrome`；是 `floats` 里的窗、又不是最后一个时发。嵌在窗内容里的子网格照样认到外层的窗，这正是工作台 `leafOf` 处理嵌套网格的那套走法。任何指针键都算（今天桌面与工作台都不分键）。
- 网格不改次序，挪到 `floats` 末尾由宿主做。

**叶此刻的矩形 `leafRect`（25、49）**
- expose 加 `leafRect: (id: string) => GridRect | null`。它读 `treePlacement`：只有树，含手势预览与 `maximized`，按网格自己的 `dpr` 取整。
- 不读 `placement`：`placement` 依赖 `floats`，而桌面的 `floats` 由桌面矩形算出。读 `placement` 的话，“桌面矩形 → floats → 摆放 → 桌面矩形”每轮都交回新对象，会无限循环。
- 浮动窗、离开中的叶、不存在的 id 交回 `null`。在计算属性里调会跟着摆放重算：expose 的函数读的是子组件的 computed。`.md` 第 261 行“expose 五个方法”的计数与清单一起改。
- 不导出 `useDevicePixelRatio`（条目 49 不做）：桌面的实时桌面矩形改读 `leafRect`，dpr 就是库的；剩下 `previewTile` 在试做的副本上算落点反馈的区域，每次 `resolve` 现读 `window.devicePixelRatio`，非响应式也对，差一个设备像素也看不出来。

**松手的起点（13）**
- 现状：`placeFloat(id, null)` 只清 `translate`。宿主在同一拍里把窗放回树里时，外框与内容的 CSS 过渡从上一次计算样式出发，也就是记录矩形（按下之前的位置），所以窗先跳回去再飞。桌面示例靠 `tileOnNextFrame` 绕：先发布拖到的矩形，下一帧再改树。e2e 的变异“改成同一拍”会失败，这是桌面一侧的证据。工作台的 `onActiveChange(false)` 也是同一拍里先 `placeFloat(null)` 再提交（`layout-drag.ts` 第 930 行），停靠的 e2e 只断言终点，有没有跳没核过（片 0）。
- 改法：在过渡的起点表里给出“松手时画着的位置”，不读 DOM。
  - `NestedGrid` 记下每扇窗最后一次非 null 的偏移。`placeFloat(id, null)` 时，若有非零偏移，转进 `released`（id → 偏移），并排一个 `requestAnimationFrame` 清掉它。这样下一帧之前发布的变化认它，之后的不认，取消（什么都不发布）也不会留到以后误用。
  - `released` 经 `GridMotionFrame` 的新字段 `released?: ReadonlyMap<string, {readonly x: number; readonly y: number}>` 交给 `motion.update`，用完即清。
- `grid-motion.ts` 新增纯函数 `releaseStarts(items, previous, released): Map<string, GridRect>`。对每个 id：
  - 上一帧里这扇窗的外框（`leaf:<id>`，`float === true`）不在时跳过。
  - 这一帧它还是浮动窗（`items` 里有 `leaf:<id>` 且 `float === true`）时跳过，不比较矩形：`NestedGrid` 在调 `decideMotion` 之前已跑过 `settleFloatMoves`，留在原处的浮动窗矩形已被改回上一帧的值，按“矩形等于上一帧加偏移”判永远不成立，同一次渲染里别的东西也动了时会多出一个起点。移动的提交正好落在这一条里。
  - 否则（它离开了 `floats`：进树、并进别的叶、关掉）起点表加 `leaf:<id>` → 上一帧矩形加偏移，再给上一帧属于它的每个活动内容项加 `item.key` → 上一帧内容矩形加偏移。
  - `decideMotion` 把它最后并进 `entering`：放在 `kept` 之后，不影响 `following` 与 `keptSize` 的判定。
- 起点表已有的机制保证不跳：用起点的那一次渲染不带 `data-moving`（`structureMoving`、`contentMoving`），`flushGrowingStart` 强制一次布局后才写终点（`useGridMotion.ts` 第 242 到 247 行）。回到树里、并进别的叶、窗关掉时留着的外框都在 `growing` 的查找范围里。手柄层也读 `growing.get("leaf:<id>")`。
- 不在 happy-dom 里证：它没有 CSS 过渡，`await setProps` 之后起点已被清掉，探针读到的 `left 0` 是终点，不算证据。证据是 `grid-motion.test.ts` 的纯函数用例，加上桌面 e2e 的“松手到边缘：窗从松手的位置飞进那一侧”（同一拍改树之后照过；去掉 `releaseStarts` 的变异要失败）。

**矩形变化的过渡开关 `animate`（12）**
- `GridFloatInput` 加 `readonly animate?: boolean`（`@experimental`）。实现 nested-grid 输出 105 的 planned 指引，改成通用的“宿主标了就过渡”，不限于宽度。
- `settleFloatMoves(items, previous, animated)` 多一个集合，集合里的窗不压成“没变”。集合由 `NestedGrid` 在 watcher 里算：这一次标了 `animate`、这一次与上一次都没有 `gesture`（记下上一次的 `floats` 手势表）、不在 `released` 里。
  - 手势撤掉与矩形变化落在同一次渲染里（缩放、整窗拖动的提交），靠“上一次有 gesture”排除。
  - 松手放开靠 `released` 排除。
- 手势预览中 `decideMotion` 本来就不过渡；容器尺寸变化照旧 `stop`。

### `packages/nb-layout/examples/desktop/`（示例删短，验收的价值）

- `model.ts`：
  - 删 `deskClamp`、`intersectRect`、没有调用方的 `desktopRect`。
  - `leafRect` 留着，只给 `previewTile` 的试做副本用，注释改成“试做的副本不在网格上画，只能自己摆一遍”。
  - `resize(id, rect, direction)`：`direction` 为 0 的轴取记录里的 `x`/`width`（`y`/`height`），再照旧夹到最小尺寸以上。
  - `move` 的注释不再提 `deskClamp`。
- `drop.ts`：`moveTarget` 用 `clampFloatRect(…, desk)`。
- `App.vue`：
  - 删 `dpr` 一段与它的已知限制注释。
  - `desk` 改成 `host.extent.value === null ? null : (gridView.value?.leafRect(DESKTOP) ?? null)`。
  - 删 `raiseOnPress` 与承载盒的 `@pointerdown.capture`，`NestedGrid` 上接 `@float-raise`（是窗就 `settle(layout.value.raise(id), false)`）。
  - 删 `tileOnNextFrame`：`commit` 里移动之后同一拍 `settle(layout.value.tile(…))`。
  - 删 `withinDesk` 与 `deskExtent`：手柄传 `:area="desk"`、不传 `max`，预览与提交只取整，提交带上 `direction`。
  - `onKeyboardMove` 用 `clampFloatRect`。
  - `animate` 只标在刚最大化或还原的那扇窗上：`App.vue` 记一个 `toggled`（`onAction` 的 maximize 设成这扇窗，别的 `settle` 清掉），`floats` 里 `animate: toggled.value === id`。不全标：标了的窗每次矩形变化都走完整的布局时长（`--nb-layout-motion-layout`，缺省 470ms），键盘移动每按一下都要滑 470ms。桌面 e2e 不减动效（`e2e/playwright.config.ts` 没设 `reducedMotion`），`expectRect` 是轮询、`settled` 等 `data-moving` 清掉，所以只标最大化不会让现有用例量到中间值。
  - `previewTile` 的 `dpr` 现读。
- `README.md`“绕过的库的空缺与已知限制”：
  - 删“库不交出某块叶此刻的矩形”“`clampFloatRect` 只收宽高……”“浮动窗的矩形变化库不做过渡”“设备像素比……”四条。
  - “取消平铺……松手平铺靠先发布……”改成一句现状。
  - “拖平铺窗与桌面之间的分隔线时浮动窗不让位”只在片 4 的浏览器核过之后删。
  - “几个值得先知道的点”第 3 条去掉“下一帧再改树”。
- 预计删减：`App.vue` 约少 38 行，`model.ts` 约少 19 行，`drop.ts` 约少 1 行，`src/examples-desktop.test.ts` 约少 12 行（`deskClamp`、`intersectRect` 的用例搬进 `grid-rects.test.ts`，`roundRect` 的留着），README 少 4 到 5 条。示例源码合计约少 55 行。
- 留着的：`leafRect`、`placeGrid`、`dpr` 的试做路径；`inViewport`（条目 50 不做）；整窗移动的会话约 35 行（条目 11 不做组合函数）。

### 工作台与 Lab 的调用点（逐个）

使用方是先数总数再全列的：引用这五个名字的文件共 40 个（`/tmp/claude-1000/w00026-plans/t60-consumers.txt`），nb-layout 自己的源码与 `api/` 之外，按行列在下表。另有 `GridPanelsScene.vue` 只传 `floats`，那份清单里没有，是另外搜到的。

| 调用点 | 改法 | 行为影响 |
|---|---|---|
| `nb-workbench-layout/src/layout-doc.ts:51、57` | 不改（只有注释） | 无；存档里浮动窗矩形的格式不变：夹取只用于呈现、不写回（第 57 行），读旧存档不受影响 |
| `nb-workbench-layout/src/layout-drop.ts:441` | 不改（试做的 `placeGrid`） | 无 |
| `workbench/web/state/layout-constraints.ts:57` `keepVisible` | 不改 | 无：keep 80×32 不超过浮动窗最小 160×80，`keep` 的上限不起作用 |
| 同上 `:60` `wholeInTree` | 改成 `clampFloatRect(rect, extent)`（省 `keep`） | 无：`floatSize` 已把尺寸夹进区域；单测 `drag-geometry.test.ts` 不改 |
| `workbench/web/drag-geometry.ts:173`、`state/layout-doc-store.ts:169、302` | 不改；`floatBounds` 不加 `area`（待确认 2） | 无 |
| `workbench/web/components/WorkbenchShell.vue:1134` `FloatWindowHandles` | 不改：`commit` 的第二个参数不取，留给 t19 | 无 |
| `WorkbenchShell.vue:850`、`WorkbenchSurface.vue:556`、`layout-drag.ts:909、930` `placeFloat` | 不改 | 停靠时从松手处飞（片 0 核实之后才算数，待确认 4） |
| `WorkbenchSurface.vue:528-532、536、570` `raiseIfFloat` | 删掉，`NestedGrid` 上接 `@float-raise="(id) => emit('raise-float', id)"`；`leafOf` 留给悬停与焦点 | 同今天（按下、焦点进入）；已在最前时 Surface 不再发（store 本来也跳过）；`WorkbenchSurface.md:83` 的注释补“已在最前不发” |
| 手柄层次序（库） | 无需改 | Tab 到后面那扇窗的移动把手，焦点不再丢（片 0 先核今天丢不丢） |
| `lab/web/fixtures/nb-layout/index.ts:61` `FloatWindowHandles` 场景 | 不改 | 无 |
| `lab/.../editor-scene/EditorAreaFixture.vue:332`、`nb-layout/GridPanelsScene.vue`、`LivePanelsScene.vue:88` | 不改 | 无 |
| `neuro-book/src/sdk/components.ts:48` | 不改；重写快照 `src/sdk/nb-layout-surface.txt` | 只加不改：`FloatWindowHandles` 的 `area?`、`max?`、`commit` 的第二个参数，`NestedGrid` 的 `float-raise` 与 `leafRect`，`GridFloatInput.animate?`。`PLUGIN_API_SINCE` 不动（releasing.md 第 2 步只管不兼容的改动） |

## Spec 与文档改动

Spec 在主工作区 master 上改：下面的 planned 草稿主会话已提交（输出 101、103、105 加 planned 的句子，末尾 172 到 177）；收口时去掉 planned、换掉旧句。

**`docs/specs/ui/nested-grid.md` 改已有条目**

- 输出 101
  - 原句：“宿主可以传浮动窗（`floats`，`{id, rect, gesture?}`）：”
  - 新句：“宿主可以传浮动窗（`floats`，`{id, rect, gesture?, animate?}`）：”
- 输出 103
  - 原句：“**浮动窗：层叠次序**：后面的压在前面的上面，换次序只改层级，不搬节点。”
  - 新句：“**浮动窗：层叠次序**：后面的压在前面的上面，换次序只改层级，外框、内容与手柄层都不搬节点：抬升不让手柄里的焦点与指针捕获丢掉（手柄层 planned）。”
- 输出 105
  - 原句：“（planned：宿主用程序改一个浮动窗的宽度时，例如窗里的视图段展开、收起（[workbench-layout.md](workbench-layout.md) 输出 51），这次算布局变化、走布局过渡；同一时刻的移动、缩放手势照旧跟手、不过渡。）”
  - 新句：“（planned：宿主给这扇窗标 `animate: true` 时，它的矩形变化算布局变化、走布局过渡，例如最大化与还原、窗里的视图段展开与收起（[workbench-layout.md](workbench-layout.md) 输出 51）；这一次或上一次渲染里它带着 `gesture`，或这次变化是松手放开（输出 172）时，照旧不过渡。）”

**新增（末尾追加，planned）**

172. **浮动窗：松手的起点**（planned）：宿主拖动中用 `placeFloat(id, offset)` 挪过这扇窗。`placeFloat(id, null)` 之后、下一帧之前发布的变化里，它要过渡的部分（回到树里或离开的外框、它的内容）从松手时画着的位置出发，即记录矩形加最后一次的偏移；这次它仍是浮动窗、矩形就是拖到的位置时不过渡（输出 105）。下一帧之后才发布的，照旧从记录矩形出发。
173. **浮动窗：抬升的请求**（planned）：指针在一扇浮动窗上按下（外框、内容、手柄层，含其中嵌的网格；在捕获阶段判，手柄阻止冒泡也收得到），或焦点进入它时，它不是 `floats` 的最后一个就发 `float-raise`（窗的 id）；已在最上面不发。网格不改次序，宿主把它挪到 `floats` 末尾。
174. **摆放：叶此刻的矩形**（planned）：expose 的 `leafRect(id)` 交回树里这块叶此刻的矩形（相对网格根，CSS px）。它与网格渲染用的是同一份摆放：手势预览中是预览的，最大化时最大化的那块是盖住的外接矩形，取整与网格相同。不在树里的（浮动窗、离开中的叶、不存在的 id）交回 null；不给过渡的中间帧。在计算属性里调用，摆放变了会重算。
175. **浮动窗：夹取**（planned）：`clampFloatRect(rect, area, keep?)` 把窗夹进区域。`area` 是带原点的矩形（相对网格根），或只有宽高（原点为 0）。窗比区域宽或高时缩到区域。`keep` 是至少留在区域里的宽与高：不给时是整扇窗，给了也不超过窗缩后的尺寸。窗的上边总在区域里。结果只用于呈现，宿主不写回记录。
176. **浮动窗：缩放的边界**（planned）：`resizeFloatRect` 的 `bounds.area`（矩形）给出时，跟着指针的边不越过它；起点就在区域外的边不再往外，也不往里跳；不动的边不变；最小尺寸优先。`max` 可以不给（不限）。`FloatWindowHandles` 的 `area` 属性同义，指针与键盘缩放都按它。
177. **浮动窗：手柄的结算**（planned）：`FloatWindowHandles` 松手时，在同一个同步段里先发 `preview(null)`，再发 `commit(rect, direction)`（没动不发 `commit`）；Esc 与失去捕获只发 `preview(null)`。`direction` 是这次动的边（形状同 `LayoutFloatResize`，0 是这一轴没动；键盘缩放是右下角）。`rect` 从已夹取的呈现矩形算起，没动的那一轴是夹过的值；要保住记录的宿主只取 `direction` 不为 0 的轴。

收口时补“实现合同”的入口（`releaseStarts`）与“证据”的合同测试（`grid-rects.test.ts`、`grid-motion.test.ts`、`FloatWindowHandles.dom.test.ts`、`NestedGrid.dom.test.ts` 的“浮动窗”一组），晋升另请开发者批准。`workbench-layout.md` 不改：输出 45 的“点击或焦点进入提到最前”行为不变，停靠时从哪里出发由 nested-grid 172 管。

**包内文档**（不引 Spec 编号，`readme.test.ts` 查）

- `README.md`：
  - “我要做 X”表第 153 行改成“夹取（区域可带原点，缺省整扇窗留在里面）、按手柄改尺寸（可给边界）”。
  - 加一行“某块叶此刻摆在哪 | `NestedGrid.leafRect(id)`（expose）| `./vue`”，带点的写法不进入口检查。
  - “两种矩形”一段不变。
- `src/vue/NestedGrid.md`：
  - 第 117 行 `floats` 一段加 `animate`、松手的起点、`float-raise`、手柄层的次序。
  - 第 115 行 `placeFloat` 一句后加“`null` 之后同一帧里改树，窗从松手处出发”。
  - Props 注释（第 190 行）、Emits、`GridFloatInput` 类型（第 220 行）、expose 清单（第 261 行）同步。
  - 新写“整窗移动的做法”一小段：拖动会话的 `resolve` 里算位置并 `placeFloat`，`commit` 里 `placeFloat(null)` 后同一拍发布；不另给组合函数的理由一句。
- `src/vue/FloatWindowHandles.md`：`area`、`max` 可省、`commit` 的第二个参数、事件先后、阻止冒泡与抬升的做法。
- `src/vue/drag-session.md` 第 52 行：`placeFloat` 的撤销一句后链到 `NestedGrid.md` 的“整窗移动的做法”。
- `CHANGELOG.md` 的 `[Unreleased]`：
  - “新增”写 `leafRect`、`float-raise`、`GridFloatInput.animate`、`FloatWindowHandles` 的 `area` 与 `commit` 的 `direction`、`resizeFloatRect` 的 `bounds.area`。
  - “改动”写四条：`clampFloatRect` 收区域矩形、`keep` 可省且不超过窗缩后的尺寸（比区域大的窗不再被推出区域）；手柄层不再随抬升搬节点；松手后同一帧改树从松手处出发；`max` 可省。
  - 都不进“不兼容的改动”：类型只放宽。

## 切片

分两段派 coder：第一段片 0 到 2（基线与探针、夹取与缩放、`NestedGrid` 的手柄层次序、`float-raise`、`leafRect`）；第二段片 3 到 5（松手的起点与 `animate`、桌面示例、工作台）。片 6 收口由主会话做。

每片一个提交，coder 在 worktree 里做。命令从仓库根写；`bunx` 不收 `--cwd`，先 `cd`。

| 片 | 内容（对应关键设计） | 受影响的测试与自跑命令 |
|---|---|---|
| 0 | 第一段 coder 开工前做：e2e 基线与浏览器探针（见“验证”第 1 条），结果写进报告（主会话转存 `evidences/`）。探针只决定测试怎么写，不决定做不做：13 由桌面示例的 `tileOnNextFrame` 就成立，照做；工作台停靠跳不跳只决定片 5 加不加首帧断言（不跳就在报告里写清为什么不跳）。39 已在 happy-dom 复现，照做；浏览器结果只决定新用例写成“修前失败”还是“回归” | 不改代码 |
| 1 | `grid-rects.ts` 的 `clampFloatRect`、`resizeFloatRect`；`FloatWindowHandles` 的 `area`、`max?`、`direction`；两份 `.md`、README 两行、CHANGELOG | `grid-rects.test.ts` 加：区域带原点、`keep` 省略、`keep` 超过缩后尺寸、`area` 的四个方向与“起点在区域外”，`deskClamp`、`intersectRect` 的对照用例从示例单测搬来。`FloatWindowHandles.dom.test.ts` 加：`area` 挡住指针与键盘缩放；`commit` 带 `direction`；松手先 `preview(null)` 后 `commit`。`cd packages/nb-layout && bun test src/grid-rects.test.ts src/readme.test.ts && bunx vitest run src/vue/FloatWindowHandles.dom.test.ts && bun run typecheck && bun run api:report` |
| 2 | `NestedGrid`：手柄层稳定次序、`float-raise`、`leafRect`；`.md` | `NestedGrid.dom.test.ts` 的“浮动窗”：把“换次序只改层级，不搬节点”扩到四扇窗、抬升第一扇，断言手柄层节点的 DOM 下标不变、按钮焦点还在（今天会失败）；`float-raise` 在外框、内容、手柄层、嵌套子网格里按下各发一次，最上面的不发，焦点进入也发；`leafRect` 的值等于同一份 `placeGrid`，预览中跟预览，浮动窗为 null，计算属性里读会更新。`cd packages/nb-layout && bunx vitest run src/vue/NestedGrid.dom.test.ts && bun run typecheck && bun run api:report` |
| 3 | `grid-motion.ts` 的 `releaseStarts` 与 `settleFloatMoves` 的集合；`useGridMotion.ts` 的 `released` 字段；`NestedGrid` 记偏移、算集合；`GridFloatInput.animate` | `grid-motion.test.ts`：松手进树、松手并进别的叶、移动提交不出起点、零偏移不出起点；`animate` 的窗矩形变了算移动，带 `gesture`、上一次带 `gesture`、在 `released` 里的不算。`NestedGrid.dom.test.ts`：手势撤掉与矩形变化同一次渲染不带 `data-moving`；`animate` 的窗只改矩形时带 `data-moving`，不标的照旧不带（现有“只有窗的矩形变了不过渡”一条保留）。`cd packages/nb-layout && bun test src/grid-motion.test.ts && bunx vitest run src/vue/useGridMotion.dom.test.ts src/vue/NestedGrid.dom.test.ts && bun run api:report` |
| 4 | 桌面示例与它的 README、单测、e2e | `src/examples-desktop.test.ts`（`resize` 带 `direction` 只写动的轴；删搬走的用例）。`e2e/desktop.e2e.ts`：头注释的变异清单换新（见“验证”）。新用例：按住最底下的 notes 的右下角手柄，它到最上面、缩放照常（39 与指针捕获）；聚焦 notes 的移动把手，它到最上面、焦点还在把手上；最大化与还原中途的矩形在两端之间；视口变窄后只拉高被夹的窗，视口变回来宽度回到记录的。片 0 核过“分隔线拖动时浮动窗让位”的，再加一条：拖平铺窗与桌面之间的分隔线，浮动窗跟着进桌面、松手不跳。`bun run --cwd packages/nb-layout typecheck && cd packages/nb-layout && bun test src/examples-desktop.test.ts src/examples.test.ts && bun run test:e2e -- desktop.e2e` |
| 5 | 工作台：`WorkbenchSurface` 改接 `float-raise`，`wholeInTree` 省 `keep`，`WorkbenchSurface.md`；SDK 快照重写 | `workbench-float.e2e.ts` 加：三扇窗时 Tab 到最底下那扇的移动把手，焦点留在把手上（片 0 核过今天会丢才加，否则作为回归守着）；片 0 核出停靠会跳的，在“窗回到树里”一条里加首帧离松手处近的断言（取样同桌面 e2e 第 451 行那条）。`cd packages/neuro-book && bun scripts/nb-layout-surface.ts --write && bun test src/sdk/sdk.test.ts src/plugins/workbench/web/drag-geometry.test.ts && bun run typecheck`；`bun run --cwd packages/neuro-book test:e2e -- e2e/workbench-float.e2e` |
| 6 | 收口：`api:check`、两个包的类型检查、合入前 e2e 清单、发布冒烟、Spec 的实现合同与证据；交 omp 一次 | 见“验证” |

## 验收映射

| Spec 条目 | 覆盖 |
|---|---|
| nested-grid 101（形状加 `animate`） | `NestedGrid.dom.test.ts`“浮动窗”（片 3） |
| nested-grid 103（手柄层不搬） | `NestedGrid.dom.test.ts` 四扇窗抬升第一扇（片 2）；`desktop.e2e.ts` 按住 notes 的手柄、聚焦 notes 的移动把手（片 4）；`workbench-float.e2e.ts` Tab 到后面那扇的移动把手（片 5） |
| nested-grid 105（`animate`） | `grid-motion.test.ts`、`NestedGrid.dom.test.ts`（片 3）；`desktop.e2e.ts` 最大化与还原的中途矩形（片 4） |
| nested-grid 172（松手的起点） | `grid-motion.test.ts` 的 `releaseStarts`（片 3）；`desktop.e2e.ts`“松手到边缘：窗从松手的位置飞进那一侧”，同一拍改树之后照过，变异要失败（片 4）；片 0 核出工作台会跳时加 `workbench-float.e2e.ts` 的首帧断言（片 5） |
| nested-grid 173（`float-raise`） | `NestedGrid.dom.test.ts`（片 2）；`desktop.e2e.ts`“按下后面的窗它到最上面”“按住后面那扇窗的缩放手柄”（片 4）；`workbench-float.e2e.ts`“点击提到最前，已在最前不写”（不改，回归） |
| nested-grid 174（`leafRect`） | `NestedGrid.dom.test.ts`（片 2）；`desktop.e2e.ts`“左侧有平铺窗时……浮动窗被夹在平铺窗右边”（不改，回归） |
| nested-grid 175（夹取） | `grid-rects.test.ts`（片 1）；`drag-geometry.test.ts`（不改，守工作台不变）；`desktop.e2e.ts`“视口缩小后浮动窗都在桌面里……” |
| nested-grid 176（缩放的边界） | `grid-rects.test.ts`、`FloatWindowHandles.dom.test.ts`（片 1）；`desktop.e2e.ts`“向桌面外拉大：预览与松手后的矩形相同、不伸出桌面” |
| nested-grid 177（手柄的结算） | `FloatWindowHandles.dom.test.ts`（片 1）；`examples-desktop.test.ts` 的 `resize`、`desktop.e2e.ts` 只拉高被夹的窗（片 4） |

## 验证

1. **片 0（主会话，开工前）**
   - 基线：在起点上把下面的 e2e 清单各跑一遍记下。直接跑 Playwright 前先构建三份产物；`workbench-float:316` 是已知偶发，只它失败时对照基线 worktree。
   - 浏览器探针（Chromium，`emulateMedia({reducedMotion: "no-preference"})`），各写一份结果进 `evidences/`：
     - a. 工作台：浮出一扇窗，拖到右栏分节下缘窄带停靠。松手后逐帧取外框位置（同桌面 e2e 第 451 行的取样），看首帧离松手处近还是离按下处近。跳的话 13 的库修法同时修工作台，片 5 加首帧断言。不跳的话先查清为什么不跳，再定 13 是只写说明还是照做。
     - b. 桌面示例（今天的代码）：按住 notes 的右下角手柄（它上面有三扇窗）拖动，看抬升之后缩放还在不在。在 notes 的移动把手上聚焦，看焦点还在不在。
     - c. 工作台：开三扇窗，Tab 到最底下那扇的移动把手，看焦点还在不在。
   - b、c 定片 4、片 5 的新用例写成“修前失败”还是“回归”。
2. **单测与 dom**：各片表里列的文件；收口时 `bun run --cwd packages/nb-layout test`、nb-workbench-layout 的 `bun test`、`bun run test:affected`（不跑全量）。
3. **类型与公开面**：`bun run --cwd packages/nb-layout typecheck`（含示例与 e2e），`bun run --cwd packages/nb-layout api:check`（片 1 到 3 已 `api:report`），`bun run --cwd packages/neuro-book typecheck`，`cd packages/neuro-book && bun test src/sdk/sdk.test.ts`。
4. **合入前跑一次的 e2e 清单**（5 个文件）：
   - `packages/nb-layout/e2e/desktop.e2e.ts`
   - 应用的 `workbench-float.e2e.ts`、`workbench-live-drag.e2e.ts`（实时布局开窗走起点表，输出 108）、`lab-grid-panels.e2e.ts`（Lab 的浮动窗场景）、`workbench-dnd.e2e.ts`（停靠）
   - 实施中只重跑改动覆盖的那份与失败项。
5. **desktop e2e 的变异**（头注释换新，各改坏一处、重建、只跑对应的用例都要失败，再 `git show HEAD:<文件> > <文件>` 恢复；变异前先提交）：
   - `clampFloatRect` 不认 `area` 的原点
   - `resizeFloatRect` 忽略 `area`
   - `NestedGrid` 的手柄层恢复 `v-for="float in floats"`
   - `float-raise` 只听冒泡阶段
   - `decideMotion` 不并 `releaseStarts`
   - `settleFloatMoves` 不看 `animate`
   - 桌面的 `resize` 写回整个矩形
   - 删掉的旧变异（`deskClamp`、`withinDesk`、`tileOnNextFrame`、`raiseOnPress`）从清单里拿掉。
6. **发布冒烟**：合入 master、工作树干净之后，`prox bun run release:smoke`（含 nb-layout 产物两次生成字节相同、空项目里装用）；nb-layout 的 `bun run --cwd packages/nb-layout build:package` 在片 3 之后先跑一次。
7. **治理**：`bun run governance:check`、`bun run docs:check`（Spec 与包内文档）。
8. **开发服务**：主会话在开发服务上点一遍工作台的浮动窗（开窗、拖动、停靠、缩放、Tab 到把手），并在桌面示例的开发服务上看最大化、平铺的过渡。e2e 是生产构建加减弱动效，开发构建的过渡只在真实页面看得到。
9. **未验证边界**：
   - 触摸与笔的松手起点（只测鼠标）。
   - 窗拖到比例不同的另一块屏幕时，`previewTile` 的反馈区域可能差一个设备像素（只是反馈，不改布局）。
   - 编辑器标签的浮动窗停靠走异步提交，晚于下一帧时照旧从记录矩形出发。

## 不做与风险

**不做**
- 整窗移动的组合函数（11）：工作台的整窗拖动是多来源会话里的一种来源，用不了独立的移动会话，做出来只有桌面一个使用方。能共用的平移后夹取（23）与松手时序（13）已经进库。
- 手柄命中带做成属性或变量（28）：说明早已写；只有桌面一个使用方要知道它，加主题变量要进 `NB_LAYOUT_THEME_VARS` 与其测试。
- 两种矩形的换算函数（50）：说明已写，宿主约 4 行，换来又一个导出。
- 拖动会话的“每次移动”回调（53）：说明已认可在 `resolve` 里做跟手的副作用；加回调就是第二个入口。
- 导出 `useDevicePixelRatio`（49）：25 之后实时的桌面矩形用库的 dpr，剩下的试做路径现读就够。

**风险**
1. 13 是内核时序：起点表依赖“用起点的那次渲染不带过渡标记、强制布局后再写终点”（`useGridMotion.ts` 第 242 行）。happy-dom 证不了，靠片 0 的探针与桌面 e2e 的取样用例，变异要能杀掉。
2. `requestAnimationFrame` 清 `released`：宿主在下一帧之后才发布（异步提交）时退回从记录矩形出发，写进说明。测试环境里 rAF 不走时，`released` 在下一次 `motion.update` 用完即清，不残留。
3. 手柄层改稳定次序之后，手柄之间的 Tab 次序是出现次序，不是叠放次序；写进 `.md`。工作台的 F6 走网格焦点、不经手柄，片 5 的 `workbench-float` 里 F6 一条守着。
4. CHANGELOG：主会话已把 0.3.0 的条目定稿成 `[0.3.0] - 2026-11-26`（`[Unreleased]` 现在是空的），t60 的条目照常写进 `[Unreleased]`；版本号不在本 Task 提。
5. 与 t19 的合并：t60 先合；t19 第 6 片变基时，`NestedGrid.vue`、`grid-motion.ts`、`FloatWindowHandles.vue` 会冲突，它按 t60 的 `animate`、`area`、`direction` 改写自己的那部分。并行的 t61 改 `README.md` 的安装一节与 CHANGELOG，和本 Task 是不同的行，合入时注意 CHANGELOG 的同一节。
6. `leafRect` 跟着手势预览：拖平铺窗与桌面之间的分隔线时，浮动窗会随预览被重新夹取（今天不让位）。片 0 之外，片 4 在浏览器里核“手势不被取消、松手不跳”，不成立就让桌面在预览中不重算（改读一份非预览的值），README 那条保留。

## 待确认（默认按推荐做，记进 `pending-confirmations.md`）

| 类别 | 决定（推荐） | 理由 | 改回代价 |
|---|---|---|---|
| 偏离已排的分工 | 条目 12 在 t60 做：`GridFloatInput.animate` 落实 nested-grid 输出 105 的 planned 指引，w00043 t19 第 6 片改用它，不另做 | 同一行为只要一个开关；t60 先于 t19 第 6 片合入；桌面示例的最大化是第一个使用方 | 低：去掉 `animate`，t19 照原计划自己做 |
| 产品取舍 | 工作台的缩放手柄不传 `area`：窗照旧能缩出树区域，只保证留 80px | 工作台有意允许窗伸出去（`keepVisible`）；传了是用户能感到的变化；收不收由 t19 的“夹取保证可达”定 | 低：一个属性 |
| 公开接口行为 | `clampFloatRect` 收区域矩形，`keep` 可省且不超过窗缩后的尺寸；类型只放宽，记进 CHANGELOG 的“改动” | 旧行为把比区域大的窗推出区域（x=-200），传矩形时原点被静默忽略；工作台两处调用不触发（探针） | 低 |
| 产品取舍 | 松手的起点进库：工作台把拖着的窗停靠回树里，也从松手处飞（片 0 核过才算） | 桌面与工作台共用一份，桌面的 `tileOnNextFrame` 删掉 | 中：撤掉 `releaseStarts`，桌面恢复下一帧再改树 |
| 示例行为 | 桌面示例：焦点进入窗也抬升（今天只有按下）；最大化与还原有布局过渡（470ms），键盘移动与平铺时被夹的窗照旧瞬变；拖分隔线时浮动窗跟着让位（片 4 核过才算） | 库的新事件与开关的直接结果，与工作台的“点击或焦点进入提到最前”一致；键盘移动每步滑 470ms 太慢，所以不全标 | 低 |

## 逐条处理

| # | 现象（摘） | 处理 | 理由与落点 |
|---|---|---|---|
| 11 | 整窗移动没有组合函数 | 只写说明 | 不做组合函数（见“不做”）；共用部分由 23、13 进库；`NestedGrid.md` 写“整窗移动的做法” |
| 12 | 矩形变化不过渡 | 做 | `GridFloatInput.animate`，落实输出 105 的指引（待确认 1） |
| 13 | 松手要先发布、下一帧再改树 | 做 | 松手的起点进起点表（`releaseStarts`，输出 172）；片 0 先核工作台 |
| 23 | `clampFloatRect` 没有原点、大窗被推出 | 做 | `area` 收矩形、`keep` 可省且有上限（输出 175） |
| 24 | 缩放的 `max` 是尺寸不是边界 | 做 | `bounds.area`、`FloatWindowHandles` 的 `area`（输出 176） |
| 25 | 取不到叶此刻的矩形 | 做 | expose `leafRect`，读树的摆放（输出 174） |
| 28 | 手柄带尺寸写死 | 不做 | 说明已写，只有一个使用方 |
| 38 | `commit` 交回夹过的矩形 | 做 | `commit` 带 `direction`，说明写后果（输出 177）；桌面只写动的轴，工作台留给 t19 |
| 39 | 抬升会搬手柄层节点 | 做 | 稳定次序；探针复现焦点丢失，违反输出 103 |
| 48 | 按到窗就抬升要自己接 | 做 | `float-raise`（输出 173）；`.md` 写手柄阻止冒泡；桌面与工作台都删掉自己的判断 |
| 49 | `useDevicePixelRatio` 不导出 | 不做 | 25 之后实时路径用库的 dpr，试做路径现读就够 |
| 50 | 两种矩形要手工换算 | 不做 | 说明已写（README“两种矩形”） |
| 51 | 松手 `preview(null)` 与 `commit` 的先后没写 | 只写说明 | 先后不改（探针），写进 `.md` 与输出 177 |
| 52 | 不在树也不在 `floats` 的内容停放 | 不做 | 已解决（NestedGrid.md 第 32 行） |
| 53 | 没有“每次移动”的回调 | 不做 | 说明已认可 `resolve` 里做；不加第二个入口 |
