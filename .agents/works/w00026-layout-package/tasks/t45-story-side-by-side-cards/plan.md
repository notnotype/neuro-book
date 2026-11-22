# t45 计划：nb-story 并排看卡片（第 7 稿）

第 5 稿在 nb-layout 补了公开面之后重写（开发者 2026-11-22 选“先补 nb-layout 再做”）：t51 的分隔线显示名、t52 的 `setSize` 与“增删不压固定栏”、t53 的内容项 `leave: "retain"`。用上 t53 之后，宿主自己管“正在关的内容”的一整套（`closing` 列表、按 `moving` 清理）去掉。第 5 稿重新开一轮审查。第 6 稿按第 5 稿的设计审查（Claude Sonnet，重要 2、建议 10，[证据](evidences/design-review-5.txt)）与随后的[分支探针](evidences/branch-probe.txt)改：两张卡做成常驻的嵌套分支，不再重建网格。第 7 稿按第 2 轮（重要 2、建议 6，[证据](evidences/design-review-6.txt)）改，八条都成立、改法都具体，不再审第 3 轮，靠实现审查兜底。

第 2 稿按第 1 轮设计审查（Claude Sonnet，重要 9、建议 5，[证据](evidences/design-review.txt)）与结构探针（[证据](evidences/structure-probe.txt)）改；第 3 稿按第 2 轮（重要 7、建议 8，[证据](evidences/design-review-2.txt)）改；第 4 稿按第 3 轮（重要 2、建议 7，[证据](evidences/design-review-3.txt)）改，没有再审（三轮是上限）。差别见末尾“修订记录”。

## Context

- **为什么做**：开发者 2026-11-22 选“加并排看卡片”，评审板第 1 轮四题按推荐定稿（决定见 [Task README](README.md)）。这也是 nb-story 校验 nb-layout 拖动公开面的一步（ADR 0054 第 8 条）：拖动会话、落点反馈、内容层在叶之间移动、叶的增减。
- **前提**：t44 已把三栏换成 `NestedGrid` 加 `useGridHost`（`shell/book-grid.ts`、`BookFrame.vue`），分栏有 `e2e/frame.e2e.ts`（8 条）。
- **依据**：[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 1、4（地址优先）、20、32、33、“状态与转换”、“边界与兼容”；nb-layout 的 [`NestedGrid`](../../../../../packages/nb-layout/src/vue/NestedGrid.md)（内容层、过渡、`moving`）、[拖动会话](../../../../../packages/nb-layout/src/vue/drag-session.md)、[`DropFeedbackOverlay`](../../../../../packages/nb-layout/src/vue/DropFeedbackOverlay.md)；[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 7（结构变了整场取消）。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t45-side-by-side`（分支 `w00026/t45-side-by-side`），从 t53 合入之后的 master 开（`e85dbbd11` 之后）；开工核对时重读 nb-layout `NestedGrid.md` 的“过渡”一节与 `ui/nested-grid` 输出 153 到 156。只改 `packages/nb-story/`，用 nb-layout 已有的入口。

## 技术选型

无。拖动用 nb-layout 的 `useDragSession`，反馈用 `DropFeedbackOverlay`，右键菜单用 nb-ui 的 `ContextMenu`。

## 关键设计

### 详情模型：`packages/nb-story/src/web/host/details.ts`（新，纯模块）

不碰 DOM、不依赖会话，单测直接测（审查第 12 条：`openBookSession` 一调用就挂 `document` 监听，不好直接测）。

- 状态 `DetailsState = {items: readonly DetailItem[]; active: number | null; open: boolean}`，`DetailItem = {key: number; content: DrawerContent}`，`items` 按左右排、最多两张。`key` 每打开一张新详情递增，是这张详情的身份（内容层的键、关闭与对调的参数）。
- `open` 为假是“整块收起、记着两张”（顶栏开关、拖到 0、关最后一张），替代 `lastDrawer`：再展开时两张都回来。
- 纯函数（每个返回新状态）：
  - 任何打开（`openIn`、`openBeside`）在整块收起时先展开，记着的两张一起回来（与顶栏开关一致）。
  - `openIn(state, content, at)`：`at` 是 `{key}`（卡片里的链接换它自己那张）或 `"active"`（主区里的链接）。没有详情时开第一张。其余按下表（第 5 稿审查第 2 条），`key` 只在换成别的内容时递增：

    | 情形 | 结果 |
    |---|---|
    | 同一个人在 `at` 指的那张里（卡内换页签、主区点开着的那个人） | 给了页签就原位改页签，没给就不动；`key` 不变，成为 `active` |
    | 同一内容在另一张里 | 那张成为 `active`；给了页签就改成那个页签，没给就不动 |
    | 别的内容 | 换掉 `at` 指的那张，新 `key`，成为 `active` |
  - `openBeside(state, content)`：同一内容已开着（任一张）时只让它成为 `active`（先判这一条）；`open` 为假时按“只有这一张新内容”展开，丢掉记着的（第 2 轮第 4 条：用户 ✕ 掉最后一张 A 再 Ctrl 点 B，不该把 A 复活）；只有一张时加在右边；两张时换掉不是 `active` 的那张；打开的那张成为 `active`。
  - `touch(state, key)`：成为 `active`。
  - `close(state, key)`：关掉一张，剩下的成为 `active`；关的是最后一张时等于 `collapse`（记着，开关还能展开）。
  - `collapse(state)`、`expand(state)`：整块收起与展开。
  - `swap(state, movedKey)`：对调左右，被拖的那张成为 `active`。
  - `toView(state)`、`fromView(view)`：地址与存下的状态（见下）。`open` 为假时等于没有详情（同 t44：收起后地址与存下的状态里没有 `entity`）。
- 页签“给了”与“没给”分开（第 2 轮第 5 条）：`openCard(entity, tab?)` 的 `tab` 缺省是“没给”，不是 `summary`；新开一张时没给才用 `summary`。`NameLink` 的 `tab` 属性缺省改成不传（现在缺省 `"summary"`），关系图与迷你图显式传 `"relations"` 的照旧换到关系页签。
- 同一内容的判定：人物卡按 `entity`（页签不同也算同一个）；原文按出处；段落按章与段；节点按 id。换页签保 `key`：内容项的键不变，外壳与 `DrawerCard` 不重挂，滚动与焦点（键盘切页签时焦点在页签上）都在。

### 会话：`packages/nb-story/src/web/host/book.ts`

- 会话持有 `details: Ref<DetailsState>`。`drawer` 改成只读计算值：`open` 且有 `active` 时是那张的内容，否则 `null`。读它的页面（人物页、关系图、全书图、待确认页）读到的是最近点过的那张。
- 写入口照旧名字、改走纯函数：`openCard`、`openSource`、`openParagraph`、`openNode` 换 `active` 那张；新增 `openBeside(content)`；`closeDetail(key)`、`closeDrawer()`（= `collapse`）、`reopenDrawer()`（= `expand`）、`swapDetails(key)`、`touchDetail(key)`。所有 `open*` 包在 `afterFresh` 里、是异步的：回来时 `key` 已经不在（那张被关或被换）时，`openIn` 回到按 `active`，`close`、`swap` 忽略。
- **卡片里的入口按所在的那张**（第 1 轮第 4 条、第 2 轮第 6 条）：每张详情的外壳是一个组件（`shell/DetailShell.vue`，`provide` 只能在组件里调；`pointerdown`、`focusin`、`wheel` 的监听也在它里面），在里面 `provide(BOOK_SESSION, scoped)`。`scoped` 用 `Object.create(book)` 加覆盖做成（不用展开语法：会话的 `info` 是 getter，展开会把它求值成旧值，第 3 轮第 3 条），单测核对 `refresh()` 之后 `scoped.info === book.info`。`scoped` 是同一个会话的薄代理：`openCard`、`openSource`、`openParagraph`、`openNode` 换所在的那张，`closeDrawer` 关所在的那张，其余原样。卡片里的 `NameLink`、`RefLink`、`DrawerCard` 换页签、`CardRelations` 的迷你关系图都不用改，以后卡片里新加的入口也自动按所在的那张。窄档浮层不提供代理，按 `active`。
- **`active`**：最后一次在里面按下指针、获得焦点、滚动（`wheel`，被动监听，与当前 `active` 不同才写）或打开的那张（与决定 3 一致）。载入时取右边那张（与“最后打开”一致）。
- **当前是哪一张看得见**（第 2 轮第 12 条）：两张都在时，`active` 那张的头部下边一条 2 像素的强调色线，另一张没有（待确认）；外壳带 `aria-label`（一张时“详情”，两张时“左边的详情”“右边的详情”，同分隔线的显示名一张表），`active` 那张另带 `aria-current="true"`（第 5 稿审查第 9 条：不只靠颜色）。
- **外壳不读 `details`**（第 5 稿审查第 4 条）：关掉的那张由库冻住插槽调用（t53），但外壳自己读的响应式数据照常更新。所以外壳要的几样（是否 `active`、左右位置、是否两张、这一项的内容）都由 `content` 插槽按 key 取出、作为属性传进去，外壳里不读 `details`；会话代理只在事件处理里用 `key`，`key` 已经不在时什么都不做。
- **关掉之前移交焦点**（第 5 稿审查第 1 条、第 2 轮第 6 条）：移交写在外壳提供的会话代理的 `closeDrawer`（关所在的那张）里，先于写 `details`：焦点在这张外壳里时，移到关完之后还看得见的那张外壳（按 `data-detail-index` 找，外壳根带 `tabindex="-1"` 才接得住焦点），没有就移到主区（`[data-testid=main]`，加 `tabindex="-1"`）。关左边那张时被关的那项当即卸载、不经停放，`content-parked` 不会发，所以不靠它；它只作兜底。顶栏开关、Escape、拖到 0、分隔条上的 Enter 是整块收起，焦点一般不在外壳里，不移交（落账引起的停放由 `content-parked` 兜底）。
- **写地址与保存**（第 1 轮第 3 条）：写地址与保存的 watch 盯 `toView(details)` 的序列化结果（与位置、页面、视角一起），不盯 `drawer`；只改 `active` 不保存。
- `lastDrawer` 删掉，顶栏开关的“还没有打开过内容”改成 `details.items` 为空。
- **能不能并排**：宽屏档一律并排（第 2 轮第 2 条：宽屏档下限 1100，导航压到最小 150 时两张加主区只要 1073，网格总放得下，按导航当前宽度判的门槛只会误拒；同一布局从地址载入又放得下，两条路径矛盾）。不设门槛、不提示；窄档（平板、手机）退化成换 `active` 那张，不提示。

### 地址与存下的状态（输出 69，审查第 5 条）

- 键：`entity`、`tab` 是左边那张人物卡，`entity2`、`tab2` 是右边那张人物卡。只有人物卡进地址（同现在）；左边是原文、右边是人物卡时，记成只有一张（`entity` 是那张人物卡），重载后只剩它一张，写进 Spec。
- 合并：地址里出现 `entity`、`tab`、`entity2`、`tab2` 任一个，这四个键整组取地址，没写的当没有（页签缺省 `summary`）；一个都没出现才整组用存下的。Spec 输出 4 加一句“人物卡的四个地址参数按组取”（第 2 轮第 9 条：命令行给出的地址只写 `entity` 时，页签不再从存下的状态补）。
- 去重在规范化之后：两个 `entity.card` 并行，按返回的 `id` 比；相同时只留左边那张。
- 核对“这个阅读位置还没出现”：没出现的那张去掉、留下的那张放在左边，每张一句提示（同现在用“；”连起来）。载入两张时不受宽度门槛限制（窗口窄时网格按最小值压缩）。
- “边界与兼容”的地址形状加上 `entity2`、`tab2`；`web/router.ts` 头注释跟着改。

### 布局：`book-grid.ts`，两张卡是常驻的嵌套分支

- **树**（[分支探针](evidences/branch-probe.txt)，第 5 稿审查第 3 条）：`frame` 横排 `[nav, main, details]`，`details` 是保留像素的分支，里面 `[drawer, drawer2]` 两块按比例分的叶。结构从头到尾不变，不重建网格、不增删叶：
  - `details`：宽度意图是“抽屉”的宽度，带整块收起的策略（收到 0，阈值 80，同 t44 的抽屉）。
  - `drawer`、`drawer2`：各 280 到 640，按比例分 `details` 的宽度（缺省各一份，等宽）。`drawer2` 带收起策略：一张卡时收起到 0；收起阈值 100000（拖不到）、`toggleable: false`，里面那条线拖到底停在 280，不会把第二张拖没，Enter 也不翻它。
  - `details` 里那条线一张卡时 0 像素（`sashSize` 按分支返回，读张数），两张时 1 像素。
- **张数变了**（第 2 轮第 3 条）：一个 `watch` 盯原始值 `items.length >= 2`（不盯 `details` 对象：`touch` 每次点击、聚焦都换对象，盯它会把用户拖出来的宽度弹回偏好），与现有的收起 watch 放进同一个函数，顺序固定；用 `grid.setCollapsed`、`grid.setSize`（不用 `host.setCollapsed`：它每次都发布布局，三步会发出两份中间布局），最后一次 `host.invalidate()`。
  - 打开第二张：先 `setCollapsed("drawer2", false)`，再 `setSize("details", 2 × 卡宽 + 1)`（顺序反了 `details` 会被一张卡时的上限夹住）；然后把两张的份额拉平：按此刻的布局 `grid.resizeBranches([{branchId: "details", axis: "width", baseline: 两张此刻的呈现, target: 各一半}])`（第 2 轮第 1 条：按比例分的叶没有设份额的入口，上次拖过里面那条线的份额会留着，关一张再开一张时不等宽又回来；关的时候 `drawer2` 收起了，拉不平，所以在开的时候拉）；
  - 关掉一张：先 `setCollapsed("drawer2", true)`，再 `setSize("details", 卡宽)`；
  - 之后 `host.invalidate()`。卡宽取偏好（`readDrawerWidth()`）。三步与写 `details`、改 `contents` 在同一个同步段里（t53 的要求，第 5 稿审查“未发现问题”一节核过 watch 的先后）。
  - 整块收起时也照做：`setSize` 对收起中的节点同时改它的恢复尺寸（`ui/nested-grid` 输出 154），展开回到对的张数。
- **整块收起与展开**：`details` 的收起由 `host.setCollapsed("details", …)` 表达（顶栏开关、窄档），拖主区那条线到 0 也收起，一张、两张一样；拖开或顶栏开关展开，两张一起回来（`drawer2` 的状态还在树里）。第 4 稿的几条让步都去掉：两张时拖得出收起，记着两张时主区那条线不停用，两张的宽度不因“重建”回到等宽，导航宽度不用写进偏好。
- **线的语义**：
  - `main` 与 `details` 之间：改抽屉的宽度，两张时两张按比例一起变（探针 Q4）。落账时这条线参与才写偏好：一张时写 `details` 的目标宽度，两张时写 `(目标 − 1) ÷ 2` 取整（一张卡的宽度），夹在 280 到 640。
  - `drawer` 与 `drawer2` 之间：只分配两张的宽度，不收起、不写偏好；两张可以不一样宽，整块收起再展开也还在（探针 Q6），关掉一张再开第二张时拉回等宽（见“张数变了”）。
  - 没打开过任何内容时主区那条线停用（同 t44）。
- **窗口窄时**：按偏好开，放不下偏好时由网格按最小值压缩（1280 宽、偏好 400 时导航约 178、主区 360、两张约 369；1100 宽默认导航时导航约 154、主区 360、两张约 292，探针 Q3 与第 2 轮第 2 条；`over-constrained` 照 t44 不打）。之后窗口变窄，网格照样压缩，不自动收掉一张。压缩态下拖主区那条线，主区已到 360 时由近到远推到导航，导航的意图会被写窄（第 2 轮第 7 条，是现有拖动规则；导航意图只在这一页里，重载回到 188），记进待确认清单。
- **读屏名称**：叶按位置叫 `drawer`、`drawer2`（偏好与 e2e 认的身份）；`NestedGrid` 的 `paneLabel`（t51，`ui/nested-grid` 输出 152）给显示名：导航、正文、详情（`details` 分支与一张卡时的 `drawer`），两张时左边的详情、右边的详情（待确认）。t44 `frame.e2e.ts` 按“调整 nav 与 main 的宽度”取分隔线的辅助函数跟着改成“调整 导航 与 正文 的宽度”这一类。
- `book-grid.ts` 交叉轴的 `maximumSize` 改成 `Number.POSITIVE_INFINITY`：写 0 时 `layout()` 报出的高是 0（画面按父分支的盒子画，看不出来，t52 查出），nb-layout README 的“约定”已写明。
- `BookFrame` 现在 `watch([navIsCollapsed, drawerIsCollapsed])` 里的 `drawer` 换成 `details`；`onApplied` 里的 `change.collapsed.drawer` 换成 `details`，`change.active.includes("drawer")` 换成含 `details`。
- 平板档：主区右侧的线宽 0、`details` 收起（同 t44 的 `compact`），浮层只画最近点过的那张；回到宽屏 `details` 展开，`drawer2` 的状态还在，两张回来。

### 详情画进内容层：`BookFrame.vue`

- `drawer`、`drawer2` 两栏不在 `leaf` 插槽里画详情，改走内容层：`contents` 为每张详情一项 `{key: "detail-<key>", leaf: 左 "drawer"、右 "drawer2", insetTop: 0, active: true}`，`content` 插槽按 key 画。对调就是两项换 `leaf`，关掉左边那张时右边那项换到 `drawer`：都是内容在叶之间移动，不重建（`ui/nested-grid` 输出 82、92）。
- **关掉的内容**：每张详情的内容项标 `leave: "retain"`（t53，`ui/nested-grid` 输出 155、156），宿主关掉时直接从 `contents` 去掉，库决定留不留：
  - 关右边那张：`drawer2` 收起到 0（降到零的叶），内容停在关之前的样子跟着它缩回去，过渡结束才卸载；
  - 整块收起（顶栏开关）：`details` 降到零，里面一张或两张的内容都留到过渡结束；拖到 0 与分隔条上的 Enter 走手势落账，不过渡，内容当即消失，同 t44（第 2 轮第 8 条）；
  - 关左边那张：右边那项换到 `drawer` 叶，左边那项的叶不动，库当即卸载它，同第 4 稿“立即消失”的规则（对调过之后被关的会盖住留下的，所以不滑）；
  - 过渡中又打开同一张（展开、又点同一个名字）：内容项回到 `contents`，库沿用同一个元素。
  - 宿主不再维护 `closing` 列表与按 `moving` 的清理；t44 的 `paneDrawer`（读 `outgoingLeaves` 加 `lastDrawer`）删掉，`lastDrawer` 本来就删了（会话一节）。
  - 合同的限制（t53）：冻住的只是插槽调用。详情的外壳经属性拿到它那一项（`content` 插槽里按 key 取出、交给 `DetailShell` 的属性），外壳与卡片里不在交给子组件的插槽里按 key 查会话的 `details`；卡片组件按 `entity` 读的书库数据关掉时不删，不受影响。删 `details` 与改 `contents`、`setCollapsed`、`setSize` 在同一次刷新里（都是同步段里的写入与 `computed`）。
- **焦点的兜底**（第 3 轮第 8 条）：接 `NestedGrid` 的 `content-parked`，被停放的项里有焦点时把焦点交给还看得见的那张外壳（按 `open ? items : []`），没有就交给主区。不按事件里的 key 去查 `details`：关掉的那张已经不在（t53 输出 155）。主路径是会话一节的“关掉之前移交焦点”。
- **标记**（审查第 2 条）：每张详情的外壳（`content` 插槽最外层）带 `data-testid="drawer"` 与 `data-detail-index`（0 或 1）；叶槽里不再画 `aside`。“正在关”不再由宿主写 `data-closing`（插槽冻住之后宿主改不了它），改由网格的内容外层带 `data-content-leaving`：`qa.e2e.ts:189` 的 `[data-testid='drawer']:not([data-closing])` 改成排除 `[data-content-leaving]` 里的外壳。t44 `frame.e2e.ts` 里按 `[data-leaf='drawer'] [data-testid='card-name']` 取卡片的那条改成按外壳取；两张开着时用例按 `data-detail-index` 选。`qa.e2e.ts`、`revisions.e2e.ts`、`viewer.e2e.ts` 里的 `getByTestId("drawer")` 都是一张卡的场景，列进切片 1 的回归。
- 只在宽屏画两栏；平板与手机的浮层只画 `drawer`（最近点过的那张）。
- `onIssues` 照 t44 不打 `over-constrained`。

### 打开第二张：名字、出处、图上的点

- 入口只有会话的几个写法（第 5 稿审查第 10 条）：`NameLink` 的 `click` 在 `ctrlKey || metaKey` 时调 `book.openBeside(content)`，否则调 `book.openCard`；卡片里的 `NameLink` 拿到的 `book` 是外壳提供的会话代理，自然换它所在的那张。macOS 上 Ctrl 点是右键，到不了这里，⌘ 点走这条（Spec 写明）。
- `RefLink`：Ctrl 或 ⌘ 点出处调 `book.openBeside(content)`，否则 `book.openSource`。出处不加右键菜单（决定 2 只说名字与图上的点）。
- **右键菜单**（审查第 13 条）：`BookFrame` 里一个共用的 `ContextMenu`，经注入的 `openNameMenu(at, content)` 打开，只有一项“在旁边打开”；`NameLink` 的 `contextmenu` 调它，不每个实例挂一个菜单。关系图与全书图已有的菜单在“打开”之后加一项“在旁边打开”，只在“打开”会开详情的点上（全书图只有人物点，关系图都是；全书图的情节、秘密等点是跳页，不加）。
- 窄档：Ctrl 点与“在旁边打开”退化成普通打开（只显示一张，看不出并排），右键菜单里那一项隐藏（审查第 10 条）。

### 拖详情换边（审查第 9 条）

- 会话的根：包着 `NestedGrid` 的那个 div（模板 ref）；内容层是网格根的子元素，不在叶里，没有“抽屉两栏的共同容器”。
- `useDragSession(根, …)`：
  - `sourceAt`：只认 `[data-detail-handle]`，且不在按钮、菜单与输入框上，且两张都在时，来源是那张的 `key`；
  - `structure`：`items` 的 key 序列，拖着时详情变了整场取消（`ui/layout-drag` 输出 7）；
  - `resolve`：指针在另一张那一栏的叶矩形里时，落点是“对调”；在自己那一栏或别处是 `null`；
  - `actionKey`：`"swap"`；`commit`：`swapDetails(key)`；Escape、失焦由会话取消。
- 头部（`data-detail-handle`）：人物卡是名字那一行（`DrawerCard.vue` 的头部）；原文、段落、节点三种在现在只有关闭按钮的那一行左边加标题：原文写出处（`37.8—37.12`），段落写“第 N 章第 M 段”，节点写它的 `label`。两张都在时头部的光标是 `grab`。
- 反馈：`DropFeedbackOverlay` 在另一栏的叶矩形上（视口坐标）画区域，`label` 写“与这一张对调”；被拖的那张缩成写着标题的小块跟着指针（带 `data-drag-feedback`，Teleport 到 `body`）。
- **不靠拖动的对调**：两张都在时，人物卡的“⋯”菜单与其余三种头部的一个小按钮里加“与另一张对调”。键盘拖动不接（会话支持，本 Task 不做）。

### 测试

- `host/details.test.ts`（新）：各纯函数的结果（没有详情、一张、两张；同一内容已开着时 Ctrl 点只激活、不改它的页签；卡内换页签保 `key`；收起时打开会先展开、两张一起回来、新内容成为 `active`；关最后一张等于收起；对调后 `active`；`open` 为假时 `toView` 没有详情）；会话代理的 `info` 跟着 `refresh()`；`toView`、`fromView` 的情形表（只有 `entity`、只有 `entity2`、左原文右人物卡、`entity` 与 `entity2` 相同、地址与存下的整组规则）。
- `book-grid.test.ts`：一张卡数值与 t44 相同（`details` 里那条线 0 像素）；张数变了（`setCollapsed` 加 `setSize`）：两张各等于偏好、主区吸收，关一张回到一张，顺序反了会被夹（钉住顺序）；拖过里面那条线、关一张再开一张，回到等宽；整块收起再展开两张回来、不等宽也在；里面那条线拖到底不收起第二张；平板档线宽 0；一张时里面那条线宽 0、`tabindex -1`。
- `e2e/frame.e2e.ts`（原有 8 条照过，选择器按“标记”一节改）加：
  1. Ctrl 点名字开第二张：两张各 400、主区 449（三条线各 1 像素）；再 Ctrl 点换掉不是最近点过的那张；对已开着的人 Ctrl 点只让它成为最近的那张；
  2. 普通点击：主区的名字换最近点过的那张（在右边那张里滚一下也算最近）；右边那张里的名字、迷你关系图上的人换右边那张（焦点在左边时也一样）；最近的那张头部有强调线、带 `aria-current`；卡内切页签（键盘方向键）焦点还在页签上、外壳元素还连着；
  3. 名字右键“在旁边打开”；关系图右键“在旁边打开”；
  4. 拖右边那张的头到左边：落点指示出现在左栏，松手对调，人物卡元素还连着；拖到自己那一栏、拖到主区松手不动；Escape 取消；只有一张时头部按下拖动不起拖；点头部的关闭按钮不起拖；“与另一张对调”菜单项；
  5. 关掉右边那张：抽屉回到 400、主区 850，过渡中逐帧都是刚关掉的那张（同 t44 的过渡用例）；（两张等宽时）关掉左边那张：右边那张占满抽屉、位置不变、元素还连着；三种关法（关左边、关右边、关最后一张）焦点都在关闭按钮上时，关完焦点在剩下那张的外壳里，没有剩下的在主区；对调之后再关左边那张同样；顶栏开关两张一起收起与展开（过渡中逐帧两张都在）；一张时拖到 0 收起再拖开（走手势落账这条路），`[data-testid='drawer']` 只有一个；
  6. 拖中间那条线：两张宽度改变、偏好不变、拖到底停在 280；两张时拖主区那条线：两张一起变宽、松手不跳、偏好记一张的宽度，之后只点一下另一张的头，宽度不弹回；拖到底两张一起收起，拖开两张一起回来、不等宽也还在；
  7. 平板宽度只显示最近点过的那张，回到宽屏两张回来；平板里 Ctrl 点等于普通打开；
  8. 1280 与 1100 宽：Ctrl 点照样并排，两张各不小于 280、主区 360（网格压缩）；
  9. 地址带 `entity2`、`tab2`，刷新后仍并排；对调之后地址跟着对调。
- `viewer.e2e.ts` 的“宽度（验收 7）”加两张开着的 1440 与 1280 两档：没有横向溢出（两张最小 280 加主区 360 是最容易溢出的版面）。
- 变异检查：`openBeside` 改成普通打开、详情内容项不标 `leave: "retain"`（关右边那张时内容当即消失）、关闭前不移交焦点、换页签换 `key`、`setCollapsed` 与 `setSize` 顺序反过来、张数的 watch 盯 `details` 对象、开第二张不拉平份额、显式页签被吞、`structure` 不传、写地址的 watch 不盯 `details`、写偏好不分线、外壳不提供会话代理、宽度门槛不判，各有用例变红。

## Spec 与文档改动

- `story/viewer` 新增输出 66 到 69（planned）与验收 15，实现之后去掉 planned：
  - 66 并排两张详情：宽屏最多两张、各保持一张的宽度（窗口窄时网格按最小值压缩，每张不小于 280）、两张中间的线只分配宽度、每张右上角有关闭按钮、关掉一张剩下的占满抽屉；主区那条线拖到 0 或顶栏开关整块收起，一张两张一样，展开时记着的都回来、两张的宽度也还在；最近的那张头部有强调线并带 `aria-current`，每张有读屏名称；平板与手机只显示最近点过的那张，宽屏两张回来。
  - 67 打开第二张：Ctrl（macOS 上 ⌘）点名字或出处；名字与关系图、全书图上的点右键“在旁边打开”；同一内容已开着时只让它成为最近的那张；普通点击：卡片里的链接换它所在的那张，主区里的换最近点过的那张（最后一次在里面按下指针、获得焦点或打开的那张）。
  - 68 拖详情换边：两张都在时按住头部拖，标题小块跟手，另一半盖落点指示（写“与这一张对调”），在另一半松手对调，别处松手不动，Escape 取消；只有一张时不能拖；菜单里有“与另一张对调”。
  - 69 地址与回到上次：`entity2`、`tab2`；整组规则；左原文右人物卡时只记人物卡；相同的去重。
- 输出 1：“抽屉里每种内容右上角都有关闭按钮”改成“每张详情右上角”；输出 4 加“人物卡的四个地址参数按组取”；输出 20 补一句 Ctrl 点名字见输出 67。
- “边界与兼容”的地址形状加 `entity2`、`tab2`。
- 组件文档（第 5 稿审查第 8 条）：新建 `shell/DetailShell.vue` 配同名 `DetailShell.md`（属性、事件、它不读 `details` 的约定）；`parts/NameLink.md`、`parts/RefLink.md` 改写入口（`book.openBeside`），`NameLink` 新注入 `openNameMenu`，标签补 `state:inject`。偏好没有新增（不再写导航宽度）。
- 待确认清单：分隔线与外壳的读屏名称（导航、正文、详情，两张时左边的详情、右边的详情）；宽屏档一律并排、窗口窄时交给网格压缩（不设门槛、不提示）；压缩态下拖主区那条线会把导航意图写窄（这一页里）；只关着一张时 Ctrl 点不把它复活；窄档 Ctrl 点退化、菜单项隐藏、关闭是整块收起且记着两张；中间那条线只分配、拖不到收起；两张时拖主区那条线两张一起变、偏好记一张的宽度；“与另一张对调”菜单项；原文、段落、节点头部加标题；最近那张头部的强调线；地址参数按组取（页签不再从存下的补）；整块收起时任何打开先展开、两张一起回来；Ctrl 点已开着的内容只激活不新开；关最后一张等于收起（第 5 稿审查第 12 条）。第 4 稿的“两张时拖不出收起”“记着两张时只能用顶栏开关展开”“导航宽度写进偏好”“两张时主区线只改左边那张”不再有。

## 切片

1. `details.ts` 与单测；会话改走它（`drawer` 计算值、外壳的会话代理、写地址的 watch、`lastDrawer` 删掉），这时还只开一张；这一张从 `leaf` 插槽搬进内容层（`leave: "retain"`，`paneDrawer` 跟着删，关上时的过渡由库留住）；标记改到详情外壳，`frame.e2e.ts`、`qa.e2e.ts`、`revisions.e2e.ts`、`viewer.e2e.ts` 的选择器跟着改。验证：nb-story `bun test`、`typecheck`、`build:web`，四个 e2e 文件全过。
2. 嵌套分支与张数变化（`setCollapsed` 加 `setSize`）、两张的内容层、分隔线与外壳的读屏名称、关闭前移交焦点、`openBeside` 与 Ctrl 点、共用右键菜单、宽度门槛、窄档；`frame.e2e.ts` 1、2、3、5、6、7、8、9，`viewer.e2e.ts` 的宽度。
3. 拖动换边与“与另一张对调”、三种详情的头部标题；`frame.e2e.ts` 4；变异检查。
4. 收口：Spec 去掉 planned、组件文档、Task README、接入记录、待确认清单；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `story/viewer` 输出 66 | `frame.e2e.ts` 1、5、6、7、8；`book-grid.test.ts` |
| 输出 67 | `frame.e2e.ts` 1、2、3、7；`details.test.ts` |
| 输出 68 | `frame.e2e.ts` 4 |
| 输出 69 | `frame.e2e.ts` 9；`details.test.ts` 的情形表 |
| 验收 15 | `frame.e2e.ts` 1、5、9 连起来（开第二张、关一张、刷新后仍并排） |
| 输出 1、32、33、4 不退 | `frame.e2e.ts` 原有 8 条、`viewer.e2e.ts` 28 条、`qa.e2e.ts`、`revisions.e2e.ts` |

## 验证

见切片。另截一组图（宽屏两张、拖动中、平板）放进 Task 证据，与评审板的草稿对照。未验证边界：触屏拖动；120Hz；macOS 的 ⌘ 点（Linux 的 Chrome 用 Meta 键模拟）。

## 不做与风险

- 不做：三张以上；拖名字进抽屉（决定 2 没选）；键盘拖动换边；实时让位（等 t49）；出处的右键菜单；并排时两张的高亮（读 `drawer` 的页面只高亮最近点过的那张，记为已知限制）。
- 风险：
  - `drawer2` 的“拖不到收起”靠收起阈值取一个够不着的大数（100000）加 `toggleable: false`：是收起策略的正常用法，但读者看不出意图，`book-grid.ts` 写注释；nb-layout 以后有“只给程序收起、拖动不收”的写法时换掉。
  - 张数变了时 `setCollapsed` 与 `setSize` 的先后：反了 `details` 会被一张卡时的上限夹住（探针），`book-grid.test.ts` 钉住；两步与写 `details`、改 `contents` 在同一个同步段里，t53 才在同一次刷新里判留不留；`frame.e2e.ts` 5 的逐帧用例兜住。
  - 关掉的内容靠 t53 的规则留住：只在叶这一轮缩回去时留（关右边是 `drawer2` 降到零，整块收起是 `details` 降到零）。
  - 读 `drawer` 的页面行为在一张卡时与现在相同，由切片 1 的四个 e2e 文件兜。

## 修订记录

- 第 2 稿（设计审查 14 条、结构探针）：
  - 第 1 条：不读 `outgoingLeaves` 决定内容去留，宿主维护 `closing` 列表；关左边那张的样子写明。
  - 第 2 条：标记挪到详情外壳；t44 的过渡用例与四个 e2e 文件的选择器列进切片 1。
  - 第 3 条：写地址与保存的 watch 改盯 `toView(details)`，只改 `active` 不保存。
  - 第 4 条：`DETAIL_SCOPE`，卡片里的链接、关闭、换页签按所在的那张；`active` 不再算滚轮；关最后一张等于收起。
  - 第 5 条：地址整组规则、情形表、去重、并行核对，“边界与兼容”加两个键。
  - 第 6 条：中间那条线只分配不收起（两张时 `drawer` 没有收起策略）；写偏好按线分。
  - 第 7 条：并排要求窗口够宽，不够时退化并提示（待确认）。
  - 第 8 条：张数变了按当前意图重建网格，两张取同一宽度。结构探针表明宿主没有干净的加宽入口、分支删到一个孩子会被展平，所以不走分支。
  - 第 9 条：会话的根、`structure`、key 作来源、三种详情的头部标题、反馈的 `label`、不靠拖动的对调。
  - 第 10 条：窄档 Ctrl 点退化、菜单项隐藏、关闭是整块收起。
  - 第 11 条：一张卡时不再有第三条线（重建成三栏）。
  - 第 12 条：详情模型抽成纯模块单测；补测试与变异清单。
  - 第 13 条：共用一个右键菜单；同一内容不重复开；`active` 的初值是最后打开的那张。
  - 第 14 条：上游缺口（设置保留像素意图的入口、内容项寿命）写进接入记录。
- 第 3 稿（第 2 轮设计审查 15 条）：
  - 第 1 条：两张时主区线只改左边那张，松手不拉齐，到下次重建回到等宽；写偏好写它的目标。
  - 第 2 条：网格由状态算出来，`cards` 含整块收起与档位，收起、展开、跨档都走重建；两张时整块收起只走开关与关闭。
  - 第 3 条：`closing` 在关闭后 `nextTick` 看 `moving`，为假就清；同 key 回来以 `items` 为准。
  - 第 4 条：关左边那张不进 `closing`、立即消失。
  - 第 5 条：门槛按每张最小 280 判，够时两张一起收紧；`besideRoom` 由 `BookFrame` 写；提示不写“顶栏”。
  - 第 6 条：外壳里提供会话代理，卡片里所有入口自动按所在的那张，去掉 `DETAIL_SCOPE`。
  - 第 7 条：滚轮恢复算最近（决定 3）。
  - 第 8 条：卡片宽度取偏好、导航收起取 ref、导航宽度只在宽屏从旧网格读。
  - 第 9 条：输出 4 加按组取；去重在规范化之后；失败时留下的放左边；`active` 初值取右边；载入两张不受门槛限制。
  - 第 10 条：`key` 不在时回退；对已开着的内容 Ctrl 点只让它成为最近的那张。
  - 第 11 条：“在旁边打开”只在会开详情的点上。
  - 第 12 条：最近那张头部的强调线（待确认）。
  - 第 13 条：主区 449；提示不写顶栏。
  - 第 14 条：平铺四叶加翻收起的替代做法也看过：它要在一张时去掉第三条线、两张时管住 `drawer` 的收起策略，偏好变了 `drawer2` 不跟、宽度对不齐，仍选重建；上游缺口写进接入记录。
  - 第 15 条：测试与变异清单补齐。
- 第 4 稿（第 3 轮设计审查 9 条，没有再审）：
  - 第 1 条：去掉收紧的 `min()`，窗口窄时交给网格压缩；重建只由 `cards` 与档位触发（`watch` 配 `shallowRef`）；`besideRoom` 用 `BookFrame` 的宽度 ref。
  - 第 2 条：记着两张时主区那条线停用，只能用顶栏开关展开。
  - 第 3 条：外壳单列为组件；会话代理用 `Object.create`，不展开，单测核对 `info`。
  - 第 4 条：导航宽度写进偏好，重建不依赖旧网格。
  - 第 5 条：`nextTick` 在写入之后调，变异加一条；e2e 走手势落账这条路。
  - 第 6 条：收起时打开先展开、两张一起回来；`openBeside` 先判“同一内容已开着”；`open` 为假时 `toView` 没有详情。
  - 第 7 条：“关掉左边那张位置宽度不变”只在等宽时成立，e2e 写明前提，Spec 不写“宽度不变”。
  - 第 8 条：接 `content-parked`，焦点交给剩下那张。
  - 第 9 条：上游缺口（设置保留像素叶的意图、收起策略只能建树时给、内容项的离开状态、一对卡一起动）写进接入记录。
- 第 5 稿（nb-layout 补了公开面之后重写，新一轮审查）：
  - 关掉的内容改用 t53 的 `leave: "retain"`：去掉 `closing` 列表、`nextTick` 与按 `moving` 的清理、`data-closing`，以及它们的四条变异；关左边那张“立即消失”由库的“叶不动、内容被换掉当即卸载”给出。
  - 网格仍按状态重建：卡在运行时改不了收起策略（t52 已补 `setSize` 与“增删不压固定栏”）。
  - 分隔线读屏名称用 `paneLabel`（t51）；`book-grid.ts` 交叉轴 `maximumSize` 改成 `Infinity`（t52）。
  - `content-parked` 的处理不按 key 查 `details`。
- 第 6 稿（第 5 稿设计审查，重要 2、建议 10；[分支探针](evidences/branch-probe.txt)）：
  - 第 3 条：两张卡做成常驻的嵌套分支（`details` 里 `drawer`、`drawer2`），张数变化走 `setCollapsed` 加 `setSize`，不重建网格。探针核过一张、两张、1280 压缩、拖主区线、里面那条线拖到底、整块收起再展开、关右边那张的数值。随之去掉第 4 稿为重建做的让步（两张时拖不出收起、记着两张时主区线停用、导航宽度写偏好、两张时主区线只改左边那张、重建后回到等宽），第 7 条（不等宽被重建丢掉）一起没了。
  - 第 1 条：关闭前由宿主移交焦点，`content-parked` 只作兜底；e2e 加三种关法的焦点。
  - 第 2 条：`openIn` 的同一内容写成表，换页签保 `key`；单测与 e2e 补换页签。
  - 第 4 条：外壳不读 `details`，要的状态经插槽调用作为属性传入。
  - 第 5 条：主区 850。第 6 条：从 t53 合入之后的 master 开工。第 8 条：`DetailShell.md`、`NameLink.md`、`RefLink.md`。第 9 条：外壳的 `aria-label` 与 `aria-current`。第 10 条：入口统一成 `book.openBeside`。第 11 条：补测试与变异、`viewer.e2e.ts` 两张的宽度、验收 15 的映射。第 12 条：待确认清单补齐。
- 第 7 稿（第 2 轮设计审查，重要 2、建议 6，[证据](evidences/design-review-6.txt)；没有再审）：
  - 第 1 条：开第二张时用 `resizeBranches` 把两张的份额拉平。第 2 条：删掉并排门槛与提示，宽屏档一律并排；e2e 8 换成 1280 与 1100 两档。
  - 第 3 条：张数的 watch 盯 `items.length >= 2`，三步用 `grid.*`、最后一次 `invalidate`；e2e 加“点一下不弹回”。第 4 条：`open` 为假时 `openBeside` 丢掉记着的。第 5 条：页签“给了”与“没给”分开，`NameLink` 缺省不传。
  - 第 6 条：移交焦点写在代理的 `closeDrawer` 里、外壳根 `tabindex="-1"`，整块收起不移交。第 7 条：压缩态下拖主区线改窄导航，记进待确认。第 8 条：拖到 0 与 Enter 当即消失，只有顶栏开关的收起留住内容。
