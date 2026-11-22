# t45 计划：nb-story 并排看卡片（第 1 稿）

## Context

- **为什么做**：开发者 2026-11-22 选“加并排看卡片”，评审板第 1 轮四题按推荐定稿（决定见 [Task README](README.md)）。这也是 nb-story 校验 nb-layout 拖动公开面的那一步（ADR 0054 第 8 条）：拖动会话、落点反馈、内容层在叶之间移动，以及 t44 没走的“按需增减一栏”。
- **前提**：t44 已把三栏换成 `NestedGrid` 加 `useGridHost`（`packages/nb-story/src/web/shell/book-grid.ts`、`BookFrame.vue`），分栏有 `e2e/frame.e2e.ts`。
- **依据**：[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 1、20（名字打开人物卡）、32、33 与“状态与转换”；nb-layout 的 [`NestedGrid`](../../../../../packages/nb-layout/src/vue/NestedGrid.md)（内容层 `contents`、`content` 插槽）、[拖动会话](../../../../../packages/nb-layout/src/vue/drag-session.md)、`DropFeedbackOverlay`。
- **工作方式**：autonomous-delivery；worktree `.worktree/w00026-t45-side-by-side`（分支 `w00026/t45-side-by-side`）。只改 `packages/nb-story/`；nb-layout 公开面不动，缺口记进接入记录。

## 技术选型

无。拖动用 nb-layout 的 `useDragSession`，反馈用 `DropFeedbackOverlay`，右键菜单用 nb-ui 的 `ContextMenu`（关系图已在用）。

## 关键设计

### 书页会话的详情模型：`packages/nb-story/src/web/host/book.ts`

- 现在：`drawer: Ref<DrawerContent | null>` 与 `lastDrawer`。改成一组最多两张的详情，按左右排：`details: Ref<readonly DetailItem[]>`，`DetailItem = {key: number; content: DrawerContent}`。`key` 每打开一张新详情递增，是内容层的身份：对调、关掉左边那张时，留下的那张换叶不重建（`DrawerCard` 不重新取数）。
- `active: Ref<number>`：最近点过的那张的下标。宿主在详情那一栏里 `pointerdown`、`focusin`、`wheel` 时调 `book.touchDetail(index)`。
- `drawer` 保留为只读的计算值：`details[active]?.content ?? null`。读它的页面（人物页高亮、关系图选中、待确认页高亮）不用改，读到的是最近点过的那张。
- 写入口：
  - `openCard`、`openSource`、`openParagraph`、`openNode` 照旧（不按 Ctrl 的点击）：没有详情时打开第一张；有就换掉 `active` 那张（`key` 不变则 `DrawerCard` 按 `entity` 重建，同现在）。
  - 新增 `openBeside(content)`：只有一张时加在右边，已经两张时换掉不是 `active` 的那张；打开的那张成为 `active`。没有详情时同普通打开。
  - `closeDetail(index)`：关掉一张；剩下的成为 `active`。`closeDrawer()`：两张一起收起，记进 `lastDetails`；`reopenDrawer()` 恢复 `lastDetails`。
  - `swapDetails()`：对调左右，被拖的那张成为 `active`。
- 地址与存下的阅读状态（输出 69）：`viewState` 的 `entity`、`tab` 取左边那张（是人物卡时），新增 `entity2`、`tab2` 取右边那张（是人物卡时）；`readSavedView` 认这两个键；打开时 `entity2` 照 `entity` 的做法核对“这个阅读位置还没出现”并提示。服务端的 `view` 是不透明值（`contract.ts` 的 `Type.Unknown()`），不用改。

### 三栏变四栏：`book-grid.ts`

- 根是 `nav | main | drawer | drawer2`。`drawer2` 与 `drawer` 同一组策略（保留像素、偏好宽度、280 到 640），收起到 0。
- 期望值（`BookFrame` 推给网格）：
  - `drawer` 收起 = 不是宽屏或没有详情；
  - `drawer2` 收起 = 不是宽屏或详情不到两张。
- 线：
  - `drawer` 与 `drawer2` 之间的线只在两张都在时可用（`sashDisabled`），平板档宽 0（同 t44 的 `compact`）；
  - `main` 与 `drawer` 之间那条拖到 0 时收起整块：落账时 `drawer` 收起 = `closeDrawer()`（两张一起），`drawer2` 单独收起（拖中间那条线到右边缘）= `closeDetail(1)`。
- 宽度偏好仍是一张卡的宽度（决定 1 “两张各保持原宽”）：拖 `main|drawer` 记 `drawer` 的目标；拖中间那条只改两张的分配，不写偏好（两张的分配不进偏好，下次打开第二张仍各取偏好宽度）。
- t44 选的是“结构固定、只翻收起”，这里沿用：增减第二张只翻 `drawer2` 的收起标记，不增删叶。理由同 t44 计划（过渡与版本的先后简单）；t44 设计审查第 5 条说的“按需增删叶”这一路仍没走到，写进接入记录。

### 详情画进内容层：`BookFrame.vue`

- `drawer`、`drawer2` 两栏的内容改走 `NestedGrid` 的内容层：`contents` 为每张详情一项 `{key: "detail-<key>", leaf: 左边那张在 "drawer"、右边那张在 "drawer2", insetTop: 0, active: true}`，`content` 插槽按 `key` 画详情（人物卡、原文、段落、节点，同现在的四种）。对调就是两项换 `leaf`，内容不重建、由网格飞过去。
- t44 的“正在关的内容”：内容层的项在 `book.details` 里没了就会被卸载。关上整块时要接着画到过渡结束：关掉的那几项在 `outgoingLeaves` 含它们所在的叶时保留在 `contents` 里（`lastDetails` 里取），过渡结束后去掉。核对：t44 的 `frame.e2e.ts` 过渡用例原样要过。
- 只在宽屏画两栏；平板与手机的浮层只画 `book.drawer`（最近点过的那张），同现在。
- 详情那一栏上的 `pointerdown`、`focusin`、`wheel` 调 `book.touchDetail(index)`。

### 打开第二张：名字、出处、图上的点

- `parts/NameLink.vue`：`click` 时 `event.ctrlKey || event.metaKey` 走 `book.openBeside(card)`，否则照旧；右键（`contextmenu`）弹 nb-ui 的 `ContextMenu`，只有一项“在旁边打开”。
- `parts/RefLink.vue`：Ctrl 或 ⌘ 点出处走 `openBeside(source)`。出处的右键菜单不加（决定 2 只说名字与图上的点）。
- `pages/RelationsPage.vue`、`pages/BookGraphPage.vue`：点的右键菜单在“打开”之后加一项“在旁边打开”。
- 平板与手机：`openBeside` 照样记进 `details`，浮层只显示 `active` 那张（输出 66）。

### 拖详情换边

- 每张详情的头部（人物卡的名字那一行；其余三种的关闭按钮那一行）是拖动的来源，带 `data-detail-handle`。`useDragSession(抽屉两栏的共同容器, …)`：
  - `sourceAt`：按在头部、不在按钮或菜单上，且两张都在时，来源是它的下标；
  - `resolve`：指针在另一张那一栏的矩形里时，落点是“对调”；在自己那一栏或抽屉外是 `null`；
  - `actionKey`：`"swap"`；`commit`：`book.swapDetails()`；Escape、失焦由会话取消。
- 反馈：`DropFeedbackOverlay` 在另一栏的矩形上画区域（与工作台拖标签的落点指示同一皮肤）；被拖的那张缩成写着名字的小块跟着指针（带 `data-drag-feedback`，Teleport 到 `body`）。
- 只有一张时没有来源，不起拖。

### 测试

- `host/book.test.ts`（或现有的会话测试文件，先查）：`openBeside`、普通打开换 `active` 那张、`touchDetail`、`closeDetail`、`swapDetails`、`closeDrawer`/`reopenDrawer` 两张一起、`viewState` 与 `readSavedView` 的 `entity2`。
- `book-grid.test.ts`：四栏的宽度（两张时抽屉 2 × 偏好、主区吸收）；只有一张时 `drawer2` 为 0；平板档两条线宽 0。
- `e2e/frame.e2e.ts` 加：
  1. Ctrl 点名字开第二张，抽屉变宽、主区变窄，两张各 400；再 Ctrl 点换掉不是最近点过的那张；
  2. 普通点名字换最近点过的那张；在右边那张里点一下，再点正文的名字，换的是右边；
  3. 名字右键“在旁边打开”；关系图右键“在旁边打开”；
  4. 拖右边那张的头到左边：落点指示出现在左栏，松手两张对调，人物卡不重建（元素还连着）；拖到自己那一栏松手不动；Escape 取消；
  5. 关掉一张：剩下的占满、抽屉回到 400；顶栏开关两张一起收起与展开；
  6. 平板宽度只显示最近点过的那张，回到宽屏两张回来；
  7. 地址带 `entity2`、刷新后仍并排。
- 变异检查：`openBeside` 改成普通打开、`touchDetail` 不调、`swapDetails` 不对调、内容层的 `key` 换成按位置，各有用例变红。

## Spec 与文档改动

- `story/viewer` 新增输出 66 到 69（planned，见下）与验收 15；实现之后去掉 planned。
  - 66 并排两张详情：宽屏最多两张、各保持一张的宽度、中间的线、关掉一张、顶栏开关两张一起、窄屏只显示最近点过的那张。
  - 67 打开第二张：Ctrl 或 ⌘ 点名字或出处；名字与图上的点右键“在旁边打开”；普通点击换最近点过的那张（最后一次在里面按下指针、获得焦点或滚动的那张）。
  - 68 拖详情换边：按住头部拖，名字小块跟手，另一半盖落点指示，在另一半松手对调，自己那一半或抽屉外松手不动，Escape 取消；只有一张不能拖。
  - 69 地址与回到上次：两张人物卡时地址与存下的状态记 `entity2`、`tab2`。
- 输出 1 的“抽屉里每种内容右上角都有关闭按钮”不变；输出 20 补一句 Ctrl 点名字见输出 67。

## 切片

1. 会话模型与单测（`book.ts`），现有页面不改行为（只有一张时与现在相同）。验证：nb-story `bun test`、`typecheck`、`viewer.e2e.ts` 与 `frame.e2e.ts` 全过。
2. 四栏、内容层、`openBeside` 与两种右键菜单、Ctrl 点击；`frame.e2e.ts` 1、2、3、5、6、7。
3. 拖动换边；`frame.e2e.ts` 4；变异检查。
4. 收口：Spec 去掉 planned、Task README、接入记录；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `story/viewer` 输出 66 | `frame.e2e.ts` 1、5、6；`book-grid.test.ts` |
| 输出 67 | `frame.e2e.ts` 1、2、3；会话单测 |
| 输出 68 | `frame.e2e.ts` 4 |
| 输出 69 | `frame.e2e.ts` 7；会话单测 |
| 输出 1、32、33 不退 | `frame.e2e.ts` 原有 8 条、`viewer.e2e.ts` 28 条 |

## 验证

见切片。另截一组图（宽屏两张、拖动中、平板）放进 Task 证据，和评审板的草稿对照。未验证边界：触屏拖动；120Hz；键盘拖动换边（会话支持键盘，本 Task 不接，写进不做）。

## 不做与风险

- 不做：三张以上；拖名字进抽屉（决定 2 没选）；键盘拖动换边；拖动的实时让位（等 t49）；出处的右键菜单。
- 风险：
  - 内容层与“正在关的内容”的寿命：关掉的项过早卸载会闪空白，过晚会留下一张看不见的卡。用 t44 的过渡用例与新加的“关掉一张”用例兜。
  - `drawer` 改成计算值后，写 `book.drawer.value = …` 的地方（`book.ts` 里的 `openCard` 等）全部改成经新入口；`rg "drawer.value ="` 核对没有漏。
  - 起拖来源在卡片头部，头部还有修改菜单与关闭按钮：`sourceAt` 排除按钮与菜单，用例里点关闭按钮不起拖。
