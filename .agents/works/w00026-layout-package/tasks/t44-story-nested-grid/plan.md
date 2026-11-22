# t44 计划：nb-story 三栏改用 NestedGrid（第 2 稿）

第 2 稿按设计审查（Claude Sonnet，10 条，[证据](evidences/design-review.txt)）改。和第 1 稿的差别见末尾“修订记录”。

## Context

- **为什么做**：ADR 0054 第 8 条定 nb-story 是 nb-layout 的第一个外部使用方，第二档在把它改造成用 `NestedGrid`、拖动这些公开面时做，由它校验形状。开发者 2026-11-22 选了“加并排看卡片”（t45）；t44 是前一步：先把三栏换成 `NestedGrid` 加 `useGridHost`，t45 再在右侧详情里拆出第二张卡、接拖动。
- **依据**：[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 1（版式、分隔条、收起与过渡）、32（平板）、33（手机）与“边界与兼容”的浏览器偏好；nb-layout 的 [README](../../../../../packages/nb-layout/README.md) 起步、[`NestedGrid`](../../../../../packages/nb-layout/src/vue/NestedGrid.md)、[`useGridHost`](../../../../../packages/nb-layout/src/vue/useGridHost.md)；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 输出 142（减少动效时宿主在根上设的时长也归零）。
- **期望结果**：静止外观、拖动、收起与展开、键盘、三档切换、偏好记忆与改前一致；看得出的差别只有下面“有意的差别”几条，记进待确认清单。按公开入口接，记下接入时缺什么、别扭什么（Task README 的“接入记录”），作为 t47、t48、t49 的输入。
- **工作方式**：autonomous-delivery。worktree `.worktree/w00026-t44-story-grid`（分支 `w00026/t44-story-grid`）。只改 `packages/nb-story/`；nb-layout 的公开面不动，缺口记下来。

## 有意的差别

1. **抽屉开合时内容的动法**：现在的抽屉内容贴住外框右边、静止不动，外框像幕布从右往左擦开；换成 `NestedGrid` 后，降到零与从零长出的叶，内层保持最终尺寸、贴外框左上，跟着外框左边缘一起移动，看起来是整张从右边滑进滑出。只在 280ms 的过渡里看得出。保留旧画法要库支持“按叶贴右”（库里只对“左边不动、右边在动”的叶贴右，`grid-motion.ts` 的 `rightAnchored`），本 Task 不改库，记进接入记录与待确认清单。Spec 输出 1 写的是“看起来从右边滑进滑出”，新画法也合这句。
2. **只在抽屉参与手势时写宽度偏好**：现在拖导航线时，窗口窄、抽屉被压缩，压缩后的宽度也会写进偏好；改成提交的 `changes` 里抽屉在 `active` 之内时才写。
3. **平板档的导航线不能拖**：现在平板档导航强制收成图标条，但那条线仍能拖、能按 Enter，拖开后被配置弹回，还把“导航展开”写进了偏好；改成停用（`sashDisabled`）。
4. **首次打开就按窗口宽度定档**：`BookFrame` 的宽度初值从写死的 1440 改成 `window.innerWidth`，在平板宽度打开时不先按宽屏建网格、再播一次收起动画。

## 技术选型

无。用 nb-layout 已有的公开入口（`createGrid`、`NestedGrid`、`useGridHost`），不另引库。

## 关键设计

### `packages/nb-story/src/web/shell/book-grid.ts`（新）

建树与收起策略，纯函数、可单测：

- `createBookGrid({drawerWidth, navCollapsed, drawerCollapsed, compact})`：根是横向分支，三片叶 `nav`、`main`、`drawer`。
  - `nav`：`sizing: "fixed"`，宽 188，最小 150、最大 300，收起到 44（`restoreSize` 188，阈值 60、40）；
  - `main`：按比例分，最小 360；
  - `drawer`：`sizing: "fixed"`，宽取偏好，最小 280、最大 640，收起到 0（`restoreSize` 取偏好，阈值 80、40）。
  - 数值照搬现在 `BookFrame.vue` 的 `panels`，单独成函数是为了让单测核对“与旧配置同值”。
- `sashSize` 用函数形式：`main` 与 `drawer` 之间那条在平板档（`compact()` 为真）是 0，其余是 1。0 宽的线是 `seamOnly`：不接指针、不画接缝、Tab 落不上，平板档主区与现在一样宽（审查第 6 条：用 1 会多占 1px）。档位变了宿主调 `host.invalidate()`。
- 不存网格快照：偏好只有导航收起与抽屉宽度两项（`host/prefs.ts`），照旧经它们存取。t45 定的是“两张卡各保持一张的宽度”，这份宽度偏好在 t45 仍是每张卡的宽度。

### `packages/nb-story/src/web/shell/BookFrame.vue`

- `Splitter` 换成 `<NestedGrid ref="gridRef" v-bind="host.bindings.value">`，三片叶在 `leaf` 插槽里按 `node.id` 画，内容不变。网格只在宽屏与平板两档挂着，手机照旧不用分栏。
- **宿主**：`useGridHost({grid, contextKey: "book-frame", onApplied, onIssues})`；`onIssues` 把诊断码 `console.warn` 出来（同一码只发新增），不吞掉。
- **抽屉叶里画什么**：`contentOf(leafId)` 按叶取内容。`drawer` 叶只在宽屏档画抽屉内容：平板与手机档抽屉是浮层，叶里不画，换档那一两帧也不会出现两份抽屉（审查第 4 条）。宽屏档里，叶在网格 expose 的 `outgoingLeaves` 里（正在收到 0）时画 `book.lastDrawer`，否则画 `book.drawer`。替换掉现在的 `closingDrawer` 与定时器。
- **收起状态以宿主为准、落账后对账**（审查第 2 条）：
  - 期望值：`nav` 收起 = 平板档或偏好收起；`drawer` 收起 = 不是宽屏档或 `book.drawer` 为空。
  - 宿主改：`watch` 这两个期望值，变了调 `host.setCollapsed`。
  - 手势改：`onApplied(commit)` 先把有变化的 `collapsed` 映射回宿主（宽屏档才写导航偏好；抽屉收起调 `book.closeDrawer()`、展开调 `book.reopenDrawer()`），再无条件调 `reconcile()`：对两片叶各 `host.setCollapsed(id, 期望值)`，没变不重发布局。这样“没开过任何详情时把抽屉线拖开”（`reopenDrawer` 是空操作）会弹回收起。
  - 分隔线停用：平板档的导航线；没开过任何详情（`book.drawer` 与 `book.lastDrawer` 都为空）时的抽屉线，与顶栏开关“还没有打开过内容”时禁用一致。
  - 分隔线上的 Enter 与拖到阈值走同一条路（`onApplied`）。
- **宽度偏好**：`onApplied` 里，某个分支变化的 `active` 含 `drawer` 且目标宽度不小于 280 时写偏好（有意的差别 2）。
- **过渡**：
  - 时长：`NestedGrid` 元素自己的 `style` 设 `--nb-layout-motion-layout: var(--nb-layout-motion-move)`，保持现在 Splitter 的 280ms（曲线两者都是 `--nb-layout-ease-layout`）。设在网格根上，Spec 输出 142 保证减少动效时仍归零。280 还是工作台的 470 交开发者定（待确认清单）。
  - 图不逐帧重画：`LAYOUT_MOTION` 改成读网格 expose 的 `moving`（`computed`，经模板 ref 自动解包）；网格不在（手机档）时为假。
- **首次打开**：宽度初值 `window.innerWidth`（有意的差别 4）。
- 删除：`panels` 计算、`onGestureEnd`、`startMotion` 与 `motionTimer`、`closingDrawer`、`MOTION_SLACK_MS`、`motionMs`、抽屉 `aside` 上过渡时的 `absolute inset-y-0 right-0` 与 `width`。

### 测试

- `book-grid.test.ts`（新，Bun）：三片叶的保留像素、最小最大与收起策略与现在的 `panels` 同值；1440 宽三栏 188、余量、偏好宽度；抽屉收起时主区吸收；导航收起为 44；平板档 `main` 与 `drawer` 之间的线宽 0。
- `packages/nb-story/e2e/frame.e2e.ts`（新，提交；1440 视口，审查第 3 条）：
  1. 拖抽屉线变宽后偏好 460；拖到 0 后抽屉收起、偏好仍 460；从 0 拖开回到 460 附近的值并显示最近一次的内容。
  2. 导航线 Home、End、Enter（收起到 44、偏好记收起）、再 Enter（展开）；抽屉线 Enter 收起。
  3. 顶栏按钮与卡片的关闭按钮收起后抽屉那一片叶宽 0；顶栏按钮再打开回来。
  4. 没开过任何详情时抽屉线停用（`aria-disabled`、`tabindex=-1`）；开过之后可用。
  5. 平板宽度（900）：导航线停用、主区与抽屉之间没有能交互的线、导航 44 宽，主区宽 = 900 − 44 − 1（与改前一致）；在平板宽度直接打开，导航从未是 188。
  6. 过渡：关抽屉时第一帧抽屉里仍是刚关掉的内容；过渡中关系图的画布宽度不变，过渡结束（`data-moving` 摘掉）后铺满。
  - 每条先做变异检查：删掉 `closeDrawer` 回写、删掉 `outgoingLeaves` 分支、删掉 `reconcile()`、删掉 `moving` 接 `LAYOUT_MOTION`，对应用例应当失败。
- `viewer.e2e.ts` 现有的 28 条照跑（输出 1 的“收起抽屉后重画”、宽度、平板浮层与跨档）。
- 改前改后探针（一次性，不提交）：改前已在分支起点跑过（`probe/base`）；改后同一份再跑，JSON 对照、截图比较，另加开合过渡的中间帧取样（抽屉标题与关闭按钮的 x），把有意的差别 1 量出来。

## Spec 与文档改动

- `story/viewer`：输出 1 的过渡写法与新画法相合，不改；“实现合同”里依赖方向已写“分栏用 nb-layout”，不改。合同测试一行加 `e2e/frame.e2e.ts`（输出 1、32 的分栏部分）。
- 待确认清单：有意的差别 1 到 4、时长 280 还是 470。

## 切片

1. `book-grid.ts` 与单测；`BookFrame.vue` 换成 `NestedGrid`；`frame.e2e.ts` 与变异检查；探针对照。验证：nb-story `typecheck`、`bun test`、`build:web`、`frame.e2e.ts`、`viewer.e2e.ts`。一个提交。
2. 收口：Task README 写接入记录与有意的差别，Spec 合同测试一行，待确认清单；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `story/viewer` 输出 1（拖分隔条、阈值收起展开、按钮收起展开、过渡中图不逐帧重画、关闭按钮） | `frame.e2e.ts` 1、2、3、6；`viewer.e2e.ts` 的收起抽屉后重画 |
| `story/viewer` 输出 32（平板：导航图标条、抽屉浮层不挤主区） | `frame.e2e.ts` 5；`viewer.e2e.ts` 的平板浮层与跨档 |
| `story/viewer` 输出 33（手机） | `viewer.e2e.ts` 的手机用例；手机不挂网格 |
| `story/viewer` 验收 4（收起抽屉后重画） | `viewer.e2e.ts` 现有用例 |
| “边界与兼容”的偏好（导航收起、抽屉宽度） | `frame.e2e.ts` 1、2 |

## 验证

- worktree 里，在 `packages/nb-story`：`bun run typecheck`、`bun test`、`bun run build:web`、`bunx playwright test -c e2e/playwright.config.ts e2e/frame.e2e.ts e2e/viewer.e2e.ts`。
- 探针改前改后对照，差别逐条解释。
- 未验证边界：触屏拖分隔线；120Hz。

## 不做与风险

- 不做：网格快照存盘、并排卡片与拖动（t45）、动效时长改成 470ms（等开发者）、nb-layout 公开面的任何改动。
- 给 t45 留的路（审查第 5 条）：t44 只走了“降到零”的路，“按需增删叶”（拆出第二张卡、关掉一张）由 t45 走；t44 按叶取内容（`contentOf`），t45 把 `drawer` 换成一个分支时只换这一处与 `book` 会话的内容模型。
- 风险：`outgoingLeaves` 是 `NestedGrid.md` 写的读数，不在 Spec 的“时序与寿命”里；`frame.e2e.ts` 6 兜住它的时机。

## 修订记录

- 第 2 稿（设计审查 10 条）：
  - 第 1 条：承认抽屉内容的动法变了，列为有意的差别 1、待确认，探针加中间帧取样。
  - 第 2 条：落账后无条件对账；平板档不写导航偏好、导航线停用；没开过详情时抽屉线停用。
  - 第 3 条：`viewer.e2e.ts` 是 28 条、没有分栏用例，新增提交的 `frame.e2e.ts` 并做变异检查。
  - 第 4 条：抽屉叶只在宽屏档画内容。
  - 第 5 条：部分采纳：按叶取内容；增删叶的路由 t45 走；偏好在 t45 仍成立，不改。
  - 第 6 条：平板档那条线用 `sashSize` 函数设成 0，不用 `sashDisabled`。
  - 第 7 条：接 `onIssues`；只在抽屉参与手势时写宽度偏好。
  - 第 8 条：时长覆盖写在网格根上；280 还是 470 交开发者。
  - 第 9 条：宽度初值用 `window.innerWidth`。
  - 第 10 条：公开面的缺口写进接入记录。
