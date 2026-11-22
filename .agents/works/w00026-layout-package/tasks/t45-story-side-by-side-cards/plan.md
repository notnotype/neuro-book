# t45 计划：nb-story 并排看卡片（第 4 稿）

第 2 稿按第 1 轮设计审查（Claude Sonnet，重要 9、建议 5，[证据](evidences/design-review.txt)）与结构探针（[证据](evidences/structure-probe.txt)）改；第 3 稿按第 2 轮（重要 7、建议 8，[证据](evidences/design-review-2.txt)）改；第 4 稿按第 3 轮（重要 2、建议 7，[证据](evidences/design-review-3.txt)）改，没有再审（三轮是上限）。差别见末尾“修订记录”。

## Context

- **为什么做**：开发者 2026-11-22 选“加并排看卡片”，评审板第 1 轮四题按推荐定稿（决定见 [Task README](README.md)）。这也是 nb-story 校验 nb-layout 拖动公开面的一步（ADR 0054 第 8 条）：拖动会话、落点反馈、内容层在叶之间移动、叶的增减。
- **前提**：t44 已把三栏换成 `NestedGrid` 加 `useGridHost`（`shell/book-grid.ts`、`BookFrame.vue`），分栏有 `e2e/frame.e2e.ts`（8 条）。
- **依据**：[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 1、4（地址优先）、20、32、33、“状态与转换”、“边界与兼容”；nb-layout 的 [`NestedGrid`](../../../../../packages/nb-layout/src/vue/NestedGrid.md)（内容层、过渡、`moving`）、[拖动会话](../../../../../packages/nb-layout/src/vue/drag-session.md)、[`DropFeedbackOverlay`](../../../../../packages/nb-layout/src/vue/DropFeedbackOverlay.md)；[`ui/layout-drag`](../../../../../docs/specs/ui/layout-drag.md) 输出 7（结构变了整场取消）。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t45-side-by-side`（分支 `w00026/t45-side-by-side`）。只改 `packages/nb-story/`；nb-layout 公开面不动，缺口记进接入记录。

## 技术选型

无。拖动用 nb-layout 的 `useDragSession`，反馈用 `DropFeedbackOverlay`，右键菜单用 nb-ui 的 `ContextMenu`。

## 关键设计

### 详情模型：`packages/nb-story/src/web/host/details.ts`（新，纯模块）

不碰 DOM、不依赖会话，单测直接测（审查第 12 条：`openBookSession` 一调用就挂 `document` 监听，不好直接测）。

- 状态 `DetailsState = {items: readonly DetailItem[]; active: number | null; open: boolean}`，`DetailItem = {key: number; content: DrawerContent}`，`items` 按左右排、最多两张。`key` 每打开一张新详情递增，是这张详情的身份（内容层的键、关闭与对调的参数）。
- `open` 为假是“整块收起、记着两张”（顶栏开关、拖到 0），替代 `lastDrawer`：再展开时两张都回来。
- 纯函数（每个返回新状态）：
  - 任何打开（`openIn`、`openBeside`）在整块收起时先展开，记着的两张一起回来（与顶栏开关一致）。
  - `openIn(state, content, at)`：`at` 是 `{key}`（卡片里的链接换它自己那张）或 `"active"`（主区里的链接）。同一内容已开着（任一张）时只让它成为 `active`；没有详情时开第一张；否则换掉 `at` 指的那张。
  - `openBeside(state, content)`：同一内容已开着（任一张）时只让它成为 `active`（先判这一条）；只有一张时加在右边；两张时换掉不是 `active` 的那张；打开的那张成为 `active`。
  - `touch(state, key)`：成为 `active`。
  - `close(state, key)`：关掉一张，剩下的成为 `active`；关的是最后一张时等于 `collapse`（记着，开关还能展开）。
  - `collapse(state)`、`expand(state)`：整块收起与展开。
  - `swap(state, movedKey)`：对调左右，被拖的那张成为 `active`。
  - `toView(state)`、`fromView(view)`：地址与存下的状态（见下）。`open` 为假时等于没有详情（同 t44：收起后地址与存下的状态里没有 `entity`）。
- 同一内容的判定：人物卡按 `entity`（页签不同也算同一个，换页签）；原文按出处；段落按章与段；节点按 id。

### 会话：`packages/nb-story/src/web/host/book.ts`

- 会话持有 `details: Ref<DetailsState>`。`drawer` 改成只读计算值：`open` 且有 `active` 时是那张的内容，否则 `null`。读它的页面（人物页、关系图、全书图、待确认页）读到的是最近点过的那张。
- 写入口照旧名字、改走纯函数：`openCard`、`openSource`、`openParagraph`、`openNode` 换 `active` 那张；新增 `openBeside(content)`；`closeDetail(key)`、`closeDrawer()`（= `collapse`）、`reopenDrawer()`（= `expand`）、`swapDetails(key)`、`touchDetail(key)`。所有 `open*` 包在 `afterFresh` 里、是异步的：回来时 `key` 已经不在（那张被关或被换）时，`openIn` 回到按 `active`，`close`、`swap` 忽略。
- **卡片里的入口按所在的那张**（第 1 轮第 4 条、第 2 轮第 6 条）：每张详情的外壳是一个组件（`shell/DetailShell.vue`，`provide` 只能在组件里调；`pointerdown`、`focusin`、`wheel` 的监听也在它里面），在里面 `provide(BOOK_SESSION, scoped)`。`scoped` 用 `Object.create(book)` 加覆盖做成（不用展开语法：会话的 `info` 是 getter，展开会把它求值成旧值，第 3 轮第 3 条），单测核对 `refresh()` 之后 `scoped.info === book.info`。`scoped` 是同一个会话的薄代理：`openCard`、`openSource`、`openParagraph`、`openNode` 换所在的那张，`closeDrawer` 关所在的那张，其余原样。卡片里的 `NameLink`、`RefLink`、`DrawerCard` 换页签、`CardRelations` 的迷你关系图都不用改，以后卡片里新加的入口也自动按所在的那张。窄档浮层不提供代理，按 `active`。
- **`active`**：最后一次在里面按下指针、获得焦点、滚动（`wheel`，被动监听，与当前 `active` 不同才写）或打开的那张（与决定 3 一致）。载入时取右边那张（与“最后打开”一致）。
- **当前是哪一张看得见**（第 2 轮第 12 条）：两张都在时，`active` 那张的头部下边一条 2 像素的强调色线，另一张没有（待确认）。
- **写地址与保存**（第 1 轮第 3 条）：写地址与保存的 watch 盯 `toView(details)` 的序列化结果（与位置、页面、视角一起），不盯 `drawer`；只改 `active` 不保存。
- `lastDrawer` 删掉，顶栏开关的“还没有打开过内容”改成 `details.items` 为空。
- **能不能并排**：会话不知道容器多宽。`BookFrame` 写会话的 `besideRoom: Ref<boolean>`（见“布局”的门槛），`openBeside` 读它：不够时退化成换 `active` 那张，并给一条提示（`book.notice`）。窄档时同样退化，不提示。

### 地址与存下的状态（输出 69，审查第 5 条）

- 键：`entity`、`tab` 是左边那张人物卡，`entity2`、`tab2` 是右边那张人物卡。只有人物卡进地址（同现在）；左边是原文、右边是人物卡时，记成只有一张（`entity` 是那张人物卡），重载后只剩它一张，写进 Spec。
- 合并：地址里出现 `entity`、`tab`、`entity2`、`tab2` 任一个，这四个键整组取地址，没写的当没有（页签缺省 `summary`）；一个都没出现才整组用存下的。Spec 输出 4 加一句“人物卡的四个地址参数按组取”（第 2 轮第 9 条：命令行给出的地址只写 `entity` 时，页签不再从存下的状态补）。
- 去重在规范化之后：两个 `entity.card` 并行，按返回的 `id` 比；相同时只留左边那张。
- 核对“这个阅读位置还没出现”：没出现的那张去掉、留下的那张放在左边，每张一句提示（同现在用“；”连起来）。载入两张时不受宽度门槛限制（窗口窄时网格按最小值压缩）。
- “边界与兼容”的地址形状加上 `entity2`、`tab2`；`web/router.ts` 头注释跟着改。

### 布局：`book-grid.ts` 与重建

- **网格由状态算出来**（第 2 轮第 2、14 条）：`createBookGrid({cards, navWidth, navCollapsed, cardWidth, compact})`。`cards` 取“宽屏且 `open` ? `items.length` : 0”：0 时是三叶、`drawer` 收起（同 t44）；1 时三叶；2 时四叶 `nav | main | drawer | drawer2`。只有 `cards` 与档位变了才建一个新 `Grid` 交给 `useGridHost`：`watch([cards, tier], rebuild)` 配 `shallowRef`，不用 `computed`（它会把导航收起、偏好、容器宽都跟踪成依赖，拖窗口边缘也重建，第 3 轮第 1 条）；同 id 的叶不重建，换矩形有过渡，`drawer2` 从 0 长出、关掉时缩回去。导航收起这类不改结构的变化仍走 `host.setCollapsed`（同 t44）。
  - 理由：探针表明宿主没有干净的入口把保留像素的节点加宽（`resizeBranches` 要求分支内守恒，`resize` 与 `addLeaf` 会改兄弟的意图），也不能改收起策略（两张时要去掉 `drawer` 的），`Grid.setCollapsed` 注释认可“宿主改了自己的记录、重新建树”。重建会取消进行中的手势（版本递增），重建只发生在点击、档位变化与落账之后，不在拖动中。
  - 不走“详情做成分支、按需增删叶”：`removeLeaf` 把只剩一个孩子的分支展平（结构探针）。
- **意图从哪来**（第 2 轮第 8 条、第 3 轮第 4 条）：都从偏好与 ref 读，重建不依赖旧网格。卡片宽度取 `readDrawerWidth()`（两张都取它，所以重建后等宽）；导航收起取 `navCollapsed` 与档位两个 ref；导航宽度写进偏好（`prefs.ts` 加 `nav-width`，范围 150 到 300，落账时导航那条线参与才写），平板往返不丢拖过的宽度。
- **门槛**（第 2 轮第 5 条、第 3 轮第 1 条）：网格放得下两张的条件按最小宽度判：`导航 + 360 + 2 × 280 + 3 ≤ 容器宽`（导航取当前宽度：展开的偏好或收起的 44），`BookFrame` 用它已有的宽度 ref（ResizeObserver 量的，不用 `host.extent`：建树时它还是 null）算出写进会话的 `besideRoom`，只是一个布尔门。够时两张仍按偏好建，放不下偏好时由网格按最小值压缩（1280 宽、偏好 400 时导航约 178、主区 360、两张约 369，`over-constrained` 照 t44 不打），不另算收紧的宽度；真放不下才退化（会话一节）。之后窗口变窄，网格照样压缩，不自动收掉一张（已知限制，`ui/nested-grid` 的已知限制第三条：压缩时落账会把意图写成压缩值）。
- 叶仍按位置叫 `drawer`、`drawer2`：读屏名称（“调整 drawer 与 drawer2 的宽度”）与 t44 的 e2e 选择器不变。
- **线的语义**（第 2 轮第 1、2 条）：
  - `main` 与 `drawer` 之间：一张时同 t44（拖动改宽度、写偏好，拖到 0 收起整块）。两张时只有 `drawer` 跟着变（求解器由近到远，`drawer` 到 280 才推 `drawer2`），松手后不拉齐，两张可以不一样宽，到下次重建（张数、档位变了）回到等宽；落账时这条线参与（`active` 含 `main`）才写偏好，写的是 `drawer` 的目标宽度。两张时 `drawer` 没有收起策略，这条线拖不出收起。
  - `drawer` 与 `drawer2` 之间：只分配两张的宽度，不收起、不写偏好，两张都没有收起策略。
  - 两张时整块收起只走顶栏开关与各张的关闭按钮（Spec 输出 66 写明）。
  - 整块收起、记着两张时，主区那条线停用，只能用顶栏开关展开（第 3 轮第 2 条：拖开时预览是一张、松手后两张一起回来，主区会再缩一整张）；与“没打开过内容时停用”写在同一处。
  - `BookFrame` 现在 `watch([navIsCollapsed, drawerIsCollapsed])` 里的 `drawer` 拿掉：抽屉的收起改由重建表达，两张的树里 `drawer` 没有收起策略，`setCollapsed` 会报 `not-collapsible`。
- 平板档：主区右侧的线宽 0（同 t44 的 `compact`）；平板时 `cards` 是 0，不会有第二条线。

### 详情画进内容层：`BookFrame.vue`

- `drawer`、`drawer2` 两栏不在 `leaf` 插槽里画详情，改走内容层：`contents` 为每张详情一项 `{key: "detail-<key>", leaf: 左 "drawer"、右 "drawer2", insetTop: 0, active: true}`，`content` 插槽按 key 画。对调就是两项换 `leaf`，关掉左边那张时右边那项换到 `drawer`：都是内容在叶之间移动，不重建（`ui/nested-grid` 输出 82、92）。
- **正在关的内容**（第 1 轮第 1 条、第 2 轮第 3、4 条）：不读 `outgoingLeaves` 决定去留（它只保证在插槽里读到这一轮的）。宿主维护 `closing` 列表：关右边那张、整块收起时把被关的项（`key`、内容、原来的叶）放进去，继续留在 `contents` 里。清理：写入状态之后再调 `nextTick`（写入之前调的话回调排在刷新之前，读到的是过渡还没开始的 `moving`，第 3 轮第 5 条），等它（网格在同一轮刷新里已判过要不要过渡），那时 `gridRef.moving` 为假就清（手势落账、减少动态效果、矩形没动都不开过渡），为真就等它变假再清。`closing` 里的 key 与 `items` 里的相撞（展开、过渡中又打开）时以 `items` 为准，从 `closing` 摘掉。关左边那张时被关的那项不进 `closing`、立即消失：右边那张换到 `drawer` 叶，矩形不变，露出的是左边那块，不需要滑动（对调过之后叠放顺序会反过来，被关的会盖住留下的）。t44 的 `paneDrawer` 换成这一套。
- **关掉一张之后焦点**（第 3 轮第 8 条）：接 `NestedGrid` 的 `content-parked`，被停放的项里有焦点时把焦点交给剩下那张的外壳，没有剩下的交给主区。
- **标记**（审查第 2 条）：每张详情的外壳（`content` 插槽最外层）带 `data-testid="drawer"`、`data-closing`（在 `closing` 里时）与 `data-detail-index`（0 或 1）；叶槽里不再画 `aside`。t44 `frame.e2e.ts` 里按 `[data-leaf='drawer'] [data-testid='card-name']` 取卡片的那条改成按外壳取；两张开着时用例按 `data-detail-index` 选。`qa.e2e.ts`、`revisions.e2e.ts`、`viewer.e2e.ts` 里的 `getByTestId("drawer")` 与 `data-closing` 都是一张卡的场景，列进切片 1 的回归。
- 只在宽屏画两栏；平板与手机的浮层只画 `drawer`（最近点过的那张）。
- `onIssues` 照 t44 不打 `over-constrained`。

### 打开第二张：名字、出处、图上的点

- `NameLink`：`click` 时 `ctrlKey || metaKey` 走 `openCardBeside`，否则 `openIn(…, scope ?? "active")`。macOS 上 Ctrl 点是右键，到不了这里，⌘ 点走这条（Spec 写明）。
- `RefLink`：Ctrl 或 ⌘ 点出处走 `openSourceBeside`。出处不加右键菜单（决定 2 只说名字与图上的点）。
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

- `host/details.test.ts`（新）：各纯函数的结果（没有详情、一张、两张；同一内容已开着时 Ctrl 点；收起时打开会先展开、两张一起回来；关最后一张等于收起；对调后 `active`；`open` 为假时 `toView` 没有详情）；会话代理的 `info` 跟着 `refresh()`；`toView`、`fromView` 的情形表（只有 `entity`、只有 `entity2`、左原文右人物卡、`entity` 与 `entity2` 相同、地址与存下的整组规则）。
- `book-grid.test.ts`：一张卡数值与 t44 相同；两张：抽屉 2 × 偏好、两张等宽、主区吸收；两张时 `drawer` 没有收起策略；平板档线宽 0；`2 × 偏好` 放不下时的判断函数。
- `e2e/frame.e2e.ts`（原有 8 条照过，选择器按“标记”一节改）加：
  1. Ctrl 点名字开第二张：两张各 400、主区 449（三条线各 1 像素）；再 Ctrl 点换掉不是最近点过的那张；对已开着的人 Ctrl 点只让它成为最近的那张；
  2. 普通点击：主区的名字换最近点过的那张（在右边那张里滚一下也算最近）；右边那张里的名字、迷你关系图上的人换右边那张（焦点在左边时也一样）；最近的那张头部有强调线；
  3. 名字右键“在旁边打开”；关系图右键“在旁边打开”；
  4. 拖右边那张的头到左边：落点指示出现在左栏，松手对调，人物卡元素还连着；拖到自己那一栏、拖到主区松手不动；Escape 取消；只有一张时头部按下拖动不起拖；点头部的关闭按钮不起拖；“与另一张对调”菜单项；
  5. 关掉右边那张：抽屉回到 400、主区 849；（两张等宽时）关掉左边那张：右边那张占满抽屉、位置不变、元素还连着、焦点在它里面；对调之后再关左边那张同样；顶栏开关两张一起收起与展开，记着两张时主区那条线停用；一张时拖到 0 收起再拖开（走手势落账这条路），`[data-testid='drawer']` 只有一个；
  6. 拖中间那条线：两张宽度改变、偏好不变、拖不出收起；两张时拖主区那条线：左边那张跟手、松手不跳、偏好记它的宽度，拖到底不收起；
  7. 平板宽度只显示最近点过的那张，回到宽屏两张回来；平板里 Ctrl 点等于普通打开；
  8. 1280 宽：Ctrl 点照样并排，两张各不小于 280、主区 360（网格压缩）；放不下的宽度（把导航拖到 300、窗口 1150 造）不并排并提示；
  9. 地址带 `entity2`、`tab2`，刷新后仍并排；对调之后地址跟着对调。
- 变异检查：`openBeside` 改成普通打开、`closing` 不保留、`closing` 永不清、`nextTick` 挪到写入之前、展开时不摘 `closing` 里同 key 的项、`structure` 不传、写地址的 watch 不盯 `details`、写偏好不分线、外壳不提供会话代理、宽度门槛不判，各有用例变红。

## Spec 与文档改动

- `story/viewer` 新增输出 66 到 69（planned）与验收 15，实现之后去掉 planned：
  - 66 并排两张详情：宽屏最多两张、各保持一张的宽度（窗口窄时网格按最小值压缩，每张不小于 280，放不下才不并排并提示）、两张中间的线只分配宽度、每张右上角有关闭按钮、关掉一张剩下的占满抽屉、两张时整块收起只走顶栏开关与关闭按钮，记着两张时只能用顶栏开关展开；最近的那张头部有强调线；平板与手机只显示最近点过的那张，宽屏两张回来。
  - 67 打开第二张：Ctrl（macOS 上 ⌘）点名字或出处；名字与关系图、全书图上的点右键“在旁边打开”；同一内容已开着时只让它成为最近的那张；普通点击：卡片里的链接换它所在的那张，主区里的换最近点过的那张（最后一次在里面按下指针、获得焦点或打开的那张）。
  - 68 拖详情换边：两张都在时按住头部拖，标题小块跟手，另一半盖落点指示（写“与这一张对调”），在另一半松手对调，别处松手不动，Escape 取消；只有一张时不能拖；菜单里有“与另一张对调”。
  - 69 地址与回到上次：`entity2`、`tab2`；整组规则；左原文右人物卡时只记人物卡；相同的去重。
- 输出 1：“抽屉里每种内容右上角都有关闭按钮”改成“每张详情右上角”；输出 4 加“人物卡的四个地址参数按组取”；输出 20 补一句 Ctrl 点名字见输出 67。
- “边界与兼容”的地址形状加 `entity2`、`tab2`。
- 待确认清单：窗口窄时交给网格压缩、真放不下才退化并提示；记着两张时只能用顶栏开关展开；导航宽度写进偏好；窄档 Ctrl 点退化、菜单项隐藏、关闭是整块收起；两张时拖不出收起、中间那条线只分配；两张时主区线只改左边那张、松手不拉齐；“与另一张对调”菜单项；原文、段落、节点头部加标题；最近那张头部的强调线；地址参数按组取（页签不再从存下的补）。

## 切片

1. `details.ts` 与单测；会话改走它（`drawer` 计算值、外壳的会话代理、写地址的 watch、`lastDrawer` 删掉），这时还只开一张；标记改到详情外壳，`frame.e2e.ts`、`qa.e2e.ts`、`revisions.e2e.ts`、`viewer.e2e.ts` 的选择器跟着改。验证：nb-story `bun test`、`typecheck`、`build:web`，四个 e2e 文件全过。
2. 重建网格与四栏、内容层与 `closing`、`openBeside` 与 Ctrl 点、共用右键菜单、宽度门槛、窄档；`frame.e2e.ts` 1、2、3、5、6、7、8、9。
3. 拖动换边与“与另一张对调”、三种详情的头部标题；`frame.e2e.ts` 4；变异检查。
4. 收口：Spec 去掉 planned、Task README、接入记录、待确认清单；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `story/viewer` 输出 66 | `frame.e2e.ts` 1、5、6、7、8；`book-grid.test.ts` |
| 输出 67 | `frame.e2e.ts` 1、2、3、7；`details.test.ts` |
| 输出 68 | `frame.e2e.ts` 4 |
| 输出 69 | `frame.e2e.ts` 9；`details.test.ts` 的情形表 |
| 输出 1、32、33、4 不退 | `frame.e2e.ts` 原有 8 条、`viewer.e2e.ts` 28 条、`qa.e2e.ts`、`revisions.e2e.ts` |

## 验证

见切片。另截一组图（宽屏两张、拖动中、平板）放进 Task 证据，与评审板的草稿对照。未验证边界：触屏拖动；120Hz；macOS 的 ⌘ 点（Linux 的 Chrome 用 Meta 键模拟）。

## 不做与风险

- 不做：三张以上；拖名字进抽屉（决定 2 没选）；键盘拖动换边；实时让位（等 t49）；出处的右键菜单；并排时两张的高亮（读 `drawer` 的页面只高亮最近点过的那张，记为已知限制）。
- 风险：
  - 重建网格时 `useGridHost` 换实例：进行中的手势被取消（版本递增），`frame.e2e.ts` 的过渡用例与“关掉左边那张”兜住过渡与内容寿命。
  - `closing` 的清理时机靠 `moving` 由真变假；重建与关闭在同一个同步段里时 `moving` 要等网格发布新布局后才变真，清理的 watch 要按“曾经为真、现在为假”判，减少动态效果时走 `nextTick`。
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
