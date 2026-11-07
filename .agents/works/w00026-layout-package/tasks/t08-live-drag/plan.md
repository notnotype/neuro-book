# t08 计划：实时布局

## Context

**要解决什么。** 拖动现在只有落点指示：布局不动，靠区域与插入线说结果。开发者要两种手感都有，缺省实时布局：卡片跟手、邻居真实让位、来源收起，松手飞到结果，取消飞回（t01 决定 1）。

**依据。** [提案](../../../../../docs/proposals/workbench-single-tree-layout.md) 第 3 节手感表、第 5 节“参数分两类”；t01 决定 1、14、15、18；t02 原型 `LayoutTreeDraft.vue` 的 `tick`、`updateCard`、`surfaceStyle`；[ui/layout-drag](../../../../../docs/specs/ui/layout-drag.md)；[ui/workbench-layout](../../../../../docs/specs/ui/workbench-layout.md) 输出 25 到 32、37；[t06 的测量](../t06-flat-renderer/evidences/follow-content.txt)。

**开发者已确认。** t01 决定 1（两种都要，叫实时布局、落点指示）；决定 15（让位缓出 5 次幂约 470ms，已是 `--ease-layout`）；决定 14（分区在卡片后面，淡线不写字）。2026-11-06“都按推荐”：t08 在 t19 之后。

## 技术选型

无新依赖。标签滑开用 Vue 的 `TransitionGroup`（`move-class`），不手写位移动画。

## 关键设计

第二稿按设计审查修订（[`evidences/plan-review.txt`](evidences/plan-review.txt)，处理见 README）。

### 什么时候是实时布局

拿起时定一次，整场不变。`nbook.workbench/dragFeel`（`live` | `indicator`，缺省 `live`，只有用户层）。这些情况一律落点指示：键盘拖动；减少动效（`layoutMotionMs` 为 0：邻居瞬移看不出去了哪）；有面板最大化（别的面板盖着，预览看不见）；容器还没量到。所以 e2e 缺省（`reducedMotion: reduce`）行为不变，测实时布局的用例开回来。

`drag-gesture` 的 `activate(source, keyboard)` 把键盘告诉宿主。

### 判定的基准

- **文档**用已提交的。**矩形**用拿起后第一次判定时存的一份（面板、标签条、活动栏）：否则邻居让位之后指针下的东西变了，预览自己把自己换掉（原型的 `baseGeo`）。
- **快照取在稳定的时候**：拿起时先让进行中的过渡到终点（`NestedGrid` 暴露 `settleMotion()`，和分隔线手势开始时一样），第一次判定（下一帧）才量。
- **标签条**：`tab-strip-geometry.ts` 拆成 `measureTabStrip(strip, {exclude})` 与 `insertionIn(snapshot, point)`，现有的 `resolveTabStripInsertion` 是两者的组合。实时布局用拿起时量的、摘掉来源的那份，不读预览里的 DOM（预览里标签在滑，来源已经挪了）。`inPlace` 用快照里记的来源分区。
- **容器尺寸变了**（容差 0.5px，同 `useGridMotion`）：实时布局整场取消。基准没了，也没有办法从预览里量回来。写进 Spec 输出 32，落点指示照旧重算。
- `resolve` 不再是“只读”：它读宿主维护的粘滞状态，但不推进时间、不产生副作用。Spec 与 `drag-session.ts` 的注释改。

### 粘滞、稳定、松手

纯函数 `nb-layout/src/live-drop.ts`（`stepLiveDrop(state, {now, candidate})` 与 `stickyCandidate(state, point, candidate)`），注入时间测试：

- **稳定**：候选连续 150ms 不变才换预览；标签条内（已经在这条标签条里，或来源自己那条）不等。候选变成没有时同样等 150ms。
- **粘滞**：只有长出新面板的落点（`edge`、`reveal`）有空位：矩形取那次落点的 `preview.areaRect`（提交时的同一个函数算的终态，不量 DOM），含 8px 边距。`center`、标签条没有粘滞：不然这块面板自己的四个外缘就选不到了。
- **输出**是 `{candidate, preview: {kind: "candidate"} | {kind: "source-removed"} | {kind: "none"}}`：没预览过是 `none`；预览过又没有候选了是 `source-removed`（来源收起，原型的做法，t09 落成浮动也用它）。
- **松手**：`drag-gesture` 的 host 加 `commitsUnderPointer(keyboard): boolean`。为真时，`shown` 不是 null 就提交放下这一刻的判定，不要求与最后显示的相同；`shown` 是 null（撤下期间）仍不提交。松手这次判定也走粘滞：所见即所得。

### 预览：布局文档 store

`state/layout-doc-store.ts` 加 `livePreview` 与 `setLivePreview`（走 `fitsSkeleton`，不合骨架的不显示）。**只多一份渲染用的投影**：`renderedDoc`、`renderedProjection`（`projectLayoutDoc(livePreview, projectionOptions)`）。已有的 `doc`、`projection`、`collapse`、`visibleTabs`、`rebased`、`projectionOptions`、`partVisible`、`effectiveMaximized` 全都还是已提交的。

- 预览不改可见性（Spec 输出 17）：`visibleViews`、`useViewInstances`、活动栏按下态不动。预览里露出来的、没有实例的视图是空白，不为预览加载。
- 预览期间 `acceptPresented`、`acceptPreview` 不收：呈现尺寸里有预览才有的节点。预览撤下后 Surface 重新发布。
- **撤预览挂在 `onActiveChange(false)`**：放下、取消、abort、dispose 都经过它，并且手势的收场顺序里它先于 `commit`，同一个同步段不渲染，不闪。编辑器标签并到同一标签要问的时候提交是异步的，这时会先回到原样、问完再动：接受。

### 外壳：两份文档

`WorkbenchShell` 拆成 `doc`（已提交）与 `renderedDoc`。逐项：

| 读哪份 | 地方 |
|---|---|
| `renderedDoc` | 传给 `WorkbenchSurface` 的 `doc` 与 `projection`；`#head` 的 role 分支；`panelTitle`、`headTabs`、`active`；`titleOnlyPanels`；`frameActionsOf`、`collapsibleHere`、`headReserved` |
| `doc` | 命令、菜单、“移动到”、`placedViews`、`panelOfView`、`useViewInstances`、`toolEntries`（活动栏不跟预览，落点才稳）、`viewIdentity`、`onContentParked`、拖动判定、`headActions` |

### 编辑器

- `EditorPanels` 加只读的 `shownEntries()`，`groups` 加 `shown`，**只有 `EditorGroupHead` 读**。`mountedControls`、`moveTab`、`leave`、活动组都还看已提交的。`titleActions` 照旧跟已提交的活动组：活动组被拖空时预览里那一行动作没有地方画，接受。
- `EditorGroup` 的组级读取不用属性 `groupId`：改成这个标签真正所在的组（`area.groups.find(tabId).group.id`，空态才用属性）。不然标签预览进别的组时，横幅、面包屑、`documentOf` 都读到那个组的活动文档。所以被拖的内容在卡片里还是它自己；预览里露出来的下一个标签 `current` 为假，没有面包屑，控件 `visible` 为假，没活动过的是空白。这是预览的取舍。
- **预览和 `moveTab` 的结果可能不同**：目标组已有同一文件（并掉）、有未裁决输入（拒绝）。`EditorTabDrag` 加 `previewable(tabId, action): boolean`，为假时这个候选不预览：卡片上写落点文字，松手照常走 `moveTab`。固定分区的差异（调整位置）不算，松手后位置差一点。

### 卡片：`nb-layout` 的内容层

都在 `NestedGrid` 自己的层叠上下文里（它是 `isolation: isolate`，放外面夹不到内容与面板之间）：外框 < 内容 1 < 飞行内容 2 < 分隔线 3 < **`#overlay` 插槽 4**（分区）< **拿起的内容 5**。

- 属性 `lifted?: {key: string; rect: GridRect} | null`：这个内容项不按叶摆放。外层 `frameStyle` 用 `rect`，写 `data-lifted`，不带过渡，`pointer-events: none`（`elementsFromPoint` 才看得到底下的面板）；内层 `bodyStyle` 固定在拿起时的尺寸，不重排，靠外层裁切。不算停放。
- **卡片外观是这个内容项自己的**：底色、圆角、阴影由宿主经 CSS 变量给（`--layout-card-*`），头是插槽 `lifted-head`，占内容项上面的 `insetTop`。不另画兄弟元素。
- **落地**：`lifted` 变成 null 时内容从卡片的矩形飞到叶的矩形。`useGridMotion.land(key)` 把它放进 `flying`、启动计时，并让这一轮的 `following` 不含它：内容体一次到终点尺寸，不先压成小卡再逐帧长回去。放下与取消都走它。
- `Spec`：`nested-grid.md` 的“三层叠放”改成这五层。

**尺寸**：指针还在来源面板里时是面板原大小，离开后缓动到小卡（320×220，取和原大小的较小者），抓住的那一点一直在指针下（原型 `updateCard`）。

**循环**：`layout-drag` 在实时布局的一场里，`onActiveChange(true)` 起自己的帧循环与 `window` 捕获阶段的 `pointermove`（不经 `publish`，不然卡片慢一帧、还被判定拖慢），推进卡片与稳定计时；`onActiveChange(false)` 全部收掉（五条结束路径都经过它）。

### 空位

`stepLiveDrop` 的预览是长出新面板时，那块面板上一圈 `--layout-slot-border`，不铺遮罩。经 `#overlay` 画，矩形取外框。

### 分区

`DropSectorsOverlay` 加 `variant: "live"`（不压暗、不写字，线用 `--layout-live-sector-line`）与 `inline`（不 Teleport，放进 `#overlay`，坐标相对网格根）。`NB_Z_INDEX.dropSectors` 只管落点指示。

### 预备区

照画，直到它成为预览：那块预备区隐去，面板真的长出来，其余预备区照留。空位矩形就是这块预备区。

### 活动栏

落点不预览：照旧一条插入线（`DropFeedbackOverlay` 只画这一种），卡片照旧跟手。条目不跟预览，判定才稳。

### 落点文字

实时布局不画 `DropFeedbackOverlay` 的区域与药丸。文字写在卡片头（`aria-hidden`），读屏靠 `WorkbenchDragFeedback` 里常驻的 `role="status"`：实时区域要先在 DOM 里，内容变了才播报。

### 标签条里

两种手感都不拿起卡片。实时布局下标签条内的落点立刻预览，来源标签占位隐藏，拖影跟手，其余标签滑开。指针离开标签条才撕下：卡片从这个标签此刻所在的面板开始缩。

`TabStrip` 加两个属性：`placeholder: string | null`（这个标签留盒子、`aria-hidden`、不进键盘序，还在测量层）；`animateMoves`（同一行内位移用 `TransitionGroup` 的 `move-class`；跨行不动画）。工具面板的头是 `adapt`，换档时所有标签一起变宽，滑开看不出来还抖：只给 `scroll`、`wrap` 的条（编辑组）开，工具面板的头换序直接到位。

### 可观察的状态

表面根写 `data-drag-feel`、`data-live-preview`（预览的结构键或 `none`），e2e 等这些，不按时长等。

### 被拖的内容的焦点

拿起时不动焦点；内容不停放，输入与滚动都在。放下后按现有规则。

## Spec 与文档改动

- `ui/workbench-layout.md`：不承诺去掉实时布局；输出 25 “按这一刻看到的矩形判”分手感写；输出 30 分手感写；输出 32 实时布局下尺寸变了取消；输出末尾追加实时布局（条件、拖动中、落点反馈、分区、粘滞、松手、取消、标签条内、预备区、活动栏）；验收加条。输出 17 不改：预览不改可见性。
- `ui/layout-drag.md`：`activate` 带键盘、`commitsUnderPointer`、`resolve` 的说法；手势合同之外的（粘滞、稳定）写进 workbench-layout，这里“不承诺”改成指过去。
- `ui/nested-grid.md`：`lifted`、`#overlay`、叠放五层。组件 `.md`：`NestedGrid`、`TabStrip`、`DropSectorsOverlay`、`WorkbenchSurface`、`WorkbenchDragFeedback`、`EditorGroupHead`、`EditorGroup`。
- `theme/system.md`、`tokens.ts`、`pack.ts`：`--layout-slot-border`、`--layout-live-sector-line`、`--layout-card-*`。
- `workbench` locale：设置与卡片；`locales.test.ts`。

## 切片

| 片 | 内容 | 自跑验证 |
|---|---|---|
| 1 | `live-drop.ts`；手势的 `activate(keyboard)`、`commitsUnderPointer`；标签条快照；store 的预览；外壳两份文档；`groups.shown`；设置。这一片拖影照旧，邻居已经让位。**量一次**长章节（见“不做与风险”） | `live-drop.test.ts`、`drag-gesture.test.ts`、`tab-strip-geometry`、store 测试、`groups.test.ts`、`workbench-dnd` |
| 2 | `lifted`、`#overlay`、落地、卡片外观、空位、预备区、分区 `live` | `workbench-live-drag.e2e.ts`、`lab-scenes` |
| 3 | 标签条内、撕下、标签滑开；`EditorGroup` 按自己的组读 | `workbench-live-drag`、`editor-area`、`EditorGroup.dom.test.ts` |
| 4 | 量长章节；Spec | `evidences/live-drag-frames.txt`，脚本入库 |

## 验收映射

| 判据 | 覆盖 |
|---|---|
| 稳定 150ms；粘滞只对新面板、8px；标签条内不等；没有候选时 `source-removed`；撤下不等 | `live-drop.test.ts` |
| 键盘放下仍要求与最后显示相同；`shown` 为 null 不提交 | `drag-gesture.test.ts` |
| 拖视图到面板边：拖动中邻居真实让位（量矩形），`data-live-preview` 变，记录零写入；松手一次写入，结果与最后的预览一致 | `workbench-live-drag` |
| 松手时候选还没预览（`mouse.move` 紧跟 `mouse.up`）：提交指针下的候选；内容体宽度全程等于终点宽度 | `workbench-live-drag` |
| 取消（Escape）：布局回原样，零写入，内容回到原处 | `workbench-live-drag` |
| 预览不改可见性：拖动中被顶下去、新露出的视图 `visible` 不变，没打开过的视图不加载 | `workbench-live-drag` |
| 拿起的内容是同一个 DOM 节点，松手后输入与滚动还在（视图与编辑器标签各一例） | `workbench-live-drag`、`editor-area` |
| 卡片跟手：抓住的点在指针下，快速移动后松手位置对；离开来源面板后缩小；卡片盖在分隔线上、分区线在卡片后 | `workbench-live-drag` |
| 标签条内不拿起卡片，其余标签滑开；离开才撕下 | `workbench-live-drag`、`editor-area` |
| 编辑器标签拆到新组：预览里新组的头是编辑组的头、有这个标签，`area.groups` 没变；放下后才变。拖活动标签与不活动标签各一例；内容里读到的还是它自己的文档 | `editor-area`、`EditorGroup.dom.test.ts` |
| 目标组已有同一文件：不预览，松手照常并掉 | `editor-area` |
| 右栏隐藏时拖到预备区：拖动中右栏真的长出来，零写入；松手一次写入 | `workbench-live-drag` |
| 键盘、减少动效、最大化、设置关：落点指示 | `workbench-live-drag`、现有 `workbench-dnd` |
| 中途结构变化、容器尺寸变化：整场取消 | `workbench-live-drag` |
| 读屏文字：`role="status"` 按语义变化更新 | `workbench-live-drag` |
| 十万字章节开着时让位的帧率 | `evidences/live-drag-frames.txt` 记数 |

## 验证

`bun run test:affected --since master --typecheck`；e2e：`workbench-live-drag`、`workbench-dnd`、`editor-area`（拖动相关）、`lab-nested-grid`、`lab-scenes`。手感由开发者试，这是本 Task 最大的未验证边界。

## 不做与风险

- **预览里的编辑器内容**：下一个活动标签没有面包屑、没活动过的是空白。要它完整得为预览打开文档，副作用大，先不做。
- **文件从资源树拖进来**（t10）与浮动（t09）的卡片：这里只管标签。
- **长章节的让位帧率**：t06 量过单次过渡，10.7 万字 14 到 24 帧；扫过一排面板时每 150ms 换一次预览，上一轮过渡没走完又重启。片 1 做完就量（卡片还没做，看让位本身），片 4 再量带卡片的。卡片的帧间隔 p95 超过 50ms 算不达标；不达标的候选：加长稳定时长、预览期间邻居内容用最终尺寸（这和开发者选的“内容跟随”冲突，要开发者定，所以到时候不自己改，写进待确认）。
