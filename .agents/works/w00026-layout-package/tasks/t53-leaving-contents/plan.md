# t53 计划：离开的内容由库留到过渡结束（第 1 稿）

## Context

- **为什么做**：开发者 2026-11-22 定“离开的内容由库留住”（[t51 的“决定”](../t51-layout-api-gaps/README.md)）。t45 关一张卡片时，叶与内容项同一轮被宿主删掉，现在内容当即卸载、叶一帧消失；宿主要自己留一份最后的数据（t44 的 `BookFrame` 为抽屉写了 `lastDrawer`）。
- **依据**：`ui/nested-grid` 输出 44 到 46（离开的叶）、83 到 93（内容层）、“时序与寿命”的 `content-parked`；t51 两份审查里交给本 Task 的几条（[设计审查](../t51-layout-api-gaps/evidences/design-review.txt)第 1、2、6、7、8 条，[API 审查](../t51-layout-api-gaps/evidences/api-review.txt)第 2、3、11 条）。
- **先跑了探针**（[证据](evidences/probe.txt)）：原型在分支上（提交 `45e0a7a50`，“t53 原型（探针用）”），真实 `NestedGrid` 加 SFC 编译的插槽，七条路径都有结果，下面的设计按探针写。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t53-leaving-contents`（分支 `w00026/t53-leaving-contents`）。只改 `packages/nb-layout/`，宿主不改（nb-story 在 t45 采用）。

## 技术选型

- 冻结插槽：Vue 的 `withMemo`（`v-memo` 的运行时，`vue` 包导出）。不直接返回上一次的 VNode：已挂载的 VNode 再被返回时 Vue 先克隆再修补，根上的组件可能重渲染；带 `memo` 的才整棵跳过（探针一节，读的 3.5.39 源码）。
- 不做“连子组件一起冻住”：`ReactiveEffect.pause()` 只在触发那一刻起作用，宿主在同一个同步段里删数据时，子组件的渲染任务已经排进队列，事后暂停拦不住（探针一节）。

## 关键设计

### 一、开关与条件：`src/grid-rects.ts`、`src/grid-motion.ts`

- `GridContentInput` 加 `leave?: "unmount" | "retain"`，缺省 `"unmount"`（当即卸载，同现在）。按内容项给，不是全局开关：工作台的内容（编辑器、终端）关掉就该当即卸载，保存、释放、还焦点不能推迟（t51 设计审查第 2 条）。形状取字符串而不是布尔，留给以后别的离开方式。
- 留下的条件（新输出 155），同一轮里同时成立：
  - 内容项上一帧在、标了 `"retain"`，这一帧宿主的 `contents` 里没有这个 key；
  - 它的叶这一轮在缩回去：按输出 45 留着缩回的离开的叶，或这一轮降到零的叶（`shrinkingLeaves`）；
  - 不在拖动中（同输出 45 的第 4 个条件）；它的叶不在交换里滑出去（带只认这一帧在的项，留着的内容不会跟着滑、跟着裁）；
  - 过渡时长大于 0（减少动态效果时不过渡，当即卸载）。
  - 叶不动、只是内容被换掉或去掉的，一律当即卸载，别处有没有过渡都一样（探针 P4）。
- 解开“叶靠内容留、内容靠叶留”（t51 设计审查第 1 条阻断）：`leavingPlacements` 判“下面还有挂着的内容”时，除了这一帧挂着的，也算上一帧标了 `"retain"`、这一帧被去掉的内容项。两样都只读上一帧与这一帧，不等内容层。输出 45 的第 3 个条件相应改写。
- 新纯函数 `leavingContents(items, previous, outgoing, holding)`：返回要留的上一帧内容项，带 `leaving: true`。`GridContentPlacement` 加 `retain?: true`（宿主给了 `"retain"`）与 `leaving?: true`（库留着的）。

### 二、跨轮：`src/vue/useGridMotion.ts`

- `decideMotion` 的 `move` 加 `leavingContents`：这一轮新留的，加上一轮留下、叶仍在缩回去（接着留的离开的叶、仍为零的叶）的；宿主又给了同一个 key 的不算（探针 P5）。交换那一支把叶在带上的去掉；`holding` 时为空。
- `withoutLeaving` 也滤掉 `leaving` 的内容项：留着的内容并进渲染层后，下一次触发布局回调不算布局变化，同留着缩回的叶（现有处理）。
- 状态同 `leaving`：`start` 写入，`none` 不动，`stop`（过渡结束、容器变了、dpr 变了、`settleFirst`、时长为 0）清空，内容这时才卸载。

### 三、内容层与渲染：`src/vue/useContentLayer.ts`、`src/vue/NestedGrid.vue`、新 `src/vue/frozen-slot.ts`

- 留着的内容项是内容层的输入之一（t51 设计审查第 6 条）：`placements` 并上它们，矩形按这一帧的叶重算（离开的叶是缩到的终点，降到零的叶是零），所以停放、`memory`（停放时保持最后的尺寸，缩回去时不重排）、`content-parked`、`aria-owns` 都走现有的一处。宿主又给了同一个 key 的，以宿主的为准，沿用同一个元素（探针 P3）。
- 下表是留着的内容项在各处取的值：

  | 方面 | 取值 | 依据 |
  |---|---|---|
  | `inert`、停放 | 是（它的叶在缩回去） | `isParked` 已认 `outgoingLeaves` |
  | 看得见 | 过渡结束前看得见 | `frameStyle` 的 `showing`（`moving` 且活动且叶在缩回去） |
  | `aria-owns` | 不列 | 停放的本来就不列 |
  | F6、Tab 接管的站点 | 不算 | `useGridFocus` 排除 `leaving` 的内容项 |
  | `content-parked` | 焦点在里面时照发，key 是宿主刚去掉的那个（探针 P6） | 这是宿主知道“焦点要丢”的唯一通知；`inert` 会让浏览器把焦点放到 body |
  | 标记 | `data-content-leaving` | `data-leaving` 已表示“它的叶是离开的叶”（t51 设计审查第 2 条） |

- `FrozenSlot`（内部组件，不导出）：`frozen` 为真时不调宿主的插槽，用 `withMemo` 返回上一次的结果；不冻结时每次换一个记号照常渲染。
  - 内容项的 `content` 插槽：`frozen` 是“库留着的”。
  - 叶的 `leaf` 插槽（面板头）：`frozen` 是“离开的叶”。所有离开的叶都冻（新输出 156）：t53 之后留下的叶可能是宿主刚删掉的，再调插槽就是拿没了的数据去渲染面板头（探针 P1 的面板头读的数据已删）；交换里滑出去的叶同样不在宿主的布局里（同 t51 的 `sashLooks`）。
  - 插槽改在 `FrozenSlot` 的渲染里调，宿主数据的依赖从记在 `NestedGrid` 上变成记在每项的 `FrozenSlot` 上：宿主改一项的数据只重渲染那一项。现有用例全过（bun 410、vitest 275），没有依赖“整个网格重渲染”的行为。
- 合同的限制（探针 P7，写进输出 155 与 `NestedGrid.md`）：冻住的只是这一项的插槽调用。里面的组件照常按自己的响应式依赖更新；交给子组件的插槽在子组件的渲染里调，里面按 key 查宿主已删的数据会抛错。宿主先取出这一项、经属性传下去（nb-story 的 `DrawerCard :entity :tab` 就是这样）。

### 四、测试夹具：`src/vue/test-fixtures/`

- dom 测试要 SFC 编译的插槽（t51 API 审查第 11 条），夹具是 `.vue` 文件，放 `src/vue/test-fixtures/`；`package.json` 的 `files` 加 `!src/**/test-fixtures`，不进发布包。入口不导出它们，不需要同名契约文档。

## Spec 与文档改动

- `ui/nested-grid`：
  - 输出 45 第 3 个条件：“它下面还有挂着的内容（隐藏，不是关掉），或有这一轮被宿主去掉、标了留住的内容项（输出 155）”。
  - 新增输出 155（离开的内容由库留到过渡结束：开关、条件、各处的取值、同 key 回来、`content-parked`、限制）、156（离开的叶的面板头停在最后一次渲染），planned，实现后去掉。
  - “边界与兼容”或输入表：`GridContentInput` 的 `leave`。
- nb-layout：
  - `src/vue/NestedGrid.md`：内容层一节写 `leave`、限制与推荐写法；数据属性表加 `data-content-leaving`；离开的叶一段补“面板头停在最后一次渲染”。
  - README “我要做 X”表加一行：“关掉一块，内容跟着缩回去再卸载”→ 内容层的 `leave: "retain"`（README 起步只用 `leaf` 插槽，删叶没有缩回去的动画，t51 API 审查第 3 条）。
- `packages/neuro-book/CHANGELOG.md` 的 `[Unreleased]`：插件 SDK 的 `NestedGrid` 内容项多了 `leave`；离开的叶的面板头在过渡里停在最后一次渲染。

## 测试

- `src/grid-motion.test.ts`（纯函数）：
  - `leavingPlacements`：叶与标了留住的内容同一轮被删时留着缩回；没标的照旧不留；拖动中不留。
  - `leavingContents`：叶在缩回去才留；叶不动的不留；拖动中为空。
- `src/vue/useGridMotion.test.ts` 或同文件（`decideMotion`）：跨轮接着留、宿主加回同 key 后不留、交换里滑出去的叶不留、减少动态效果时为空。
- `src/vue/NestedGrid.dom.test.ts`（真实组件、SFC 夹具、桩布局盒，同现有“降到零”那条的做法），由探针改成断言：
  - P1 留住：离开的叶与内容都在、带标记、`inert`、看得见；面板头与内容停在删之前的样子；这一轮宿主的插槽没再被调；过渡结束后卸载。
  - P2 缺省当即卸载、叶也不留；P3 同 key 回来沿用同一个元素；P4 叶不动换内容当即卸载；P5 跨轮；P6 `content-parked`。
  - 降到零的叶（收起）且内容同一轮被去掉：留到过渡结束。
  - 留着的内容项不进 F6 站点。
  - 变异检查：把留下的条件改成永远不留，P1 要红（t51 设计审查第 8 条）。
- 回归：nb-layout 全部单测；应用 `typecheck`；Lab e2e `lab-grid-swap`、`lab-grid-panels`（用内容层的两个场景）；工作台 `editor-area.e2e.ts`、`workbench-views.e2e.ts`（关视图、关编辑组走离开的叶，面板头改为冻结）。

## 切片

1. 一到三：把原型补成正式实现（注释、`leave` 的缺省、交换与减少动态效果），纯函数测试与 dom 测试，测试夹具与 `files`；提交。
2. 文档：Spec 输出 45 改写与 155、156，`NestedGrid.md`、README、CHANGELOG；提交。
3. 收口：回归的 e2e，Spec 去掉 planned，Task README；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输出 45 第 3 个条件 | `grid-motion.test.ts` |
| 输出 155 | `grid-motion.test.ts`、`NestedGrid.dom.test.ts` |
| 输出 156 | `NestedGrid.dom.test.ts`（P1 的面板头） |

## 验证

- 真实浏览器里的手感（缩回去时内容跟着裁、过渡结束才消失）由 t45 的 nb-story `frame.e2e.ts` 覆盖：t45 是第一个开 `"retain"` 的宿主。本 Task 不另做 Lab 场景，dom 测试用的是真实 `NestedGrid` 与真实计时，过渡结束靠计时器，不靠 `transitionend`，在 happy-dom 与浏览器里走的是同一条路。
- 未验证的边界：交换里留内容（不做）；`leaf` 插槽为空、只用 `content` 的宿主之外的写法。

## 不做与风险

- 不做：`leaf` 插槽的“删叶也缩回去”（只用 `leaf` 插槽、没有内容层的宿主删叶照旧一帧消失，README 指到内容层；要做另立 Task）；交换里留内容；连子组件一起冻住（见技术选型）。
- 风险：
  - 依赖记到每项的 `FrozenSlot` 上之后，宿主依赖“改了数据整个网格重渲染”的写法会变（例如插槽里读一个和这一项无关的全局值并期望它刷新别的地方）。插槽本来就只渲染它自己那一项，没找到这样的调用方；回归跑工作台两个 e2e 兜底。
  - 冻结的面板头对所有离开的叶生效，工作台关编辑组时面板头不再跟着宿主数据变（反正在缩回去、不可交互）。由回归的工作台 e2e 兜底。
