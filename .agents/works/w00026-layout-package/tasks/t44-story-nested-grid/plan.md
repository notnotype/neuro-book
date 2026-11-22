# t44 计划：nb-story 三栏改用 NestedGrid

## Context

- **为什么做**：ADR 0054 第 8 条定 nb-story 是 nb-layout 的第一个外部使用方，第二档在把它改造成用 `NestedGrid`、拖动这些公开面时做，由它校验形状。开发者 2026-11-22 选了“加并排看卡片”（t45）；t44 是前一步：先把三栏换成 `NestedGrid` 加 `useGridHost`，外观与行为不变，t45 再在右侧详情里拆出第二张卡、接拖动。
- **依据**：[`story/viewer`](../../../../../docs/specs/story/viewer.md) 输出 1（版式、分隔条、收起与过渡）、32（平板）、33（手机）与“边界与兼容”的浏览器偏好；nb-layout 的 [README](../../../../../packages/nb-layout/README.md) 起步、[`NestedGrid`](../../../../../packages/nb-layout/src/vue/NestedGrid.md)、[`useGridHost`](../../../../../packages/nb-layout/src/vue/useGridHost.md)。
- **期望结果**：用户看不出差别（静止外观、拖动、收起与展开、键盘、三档切换、偏好记忆）；记下按公开入口接入时缺什么、别扭什么，作为 t47、t48、t49 的输入。
- **工作方式**：autonomous-delivery。worktree `.worktree/w00026-t44-story-grid`（分支 `w00026/t44-story-grid`）。只改 `packages/nb-story/src/web/`（外加必要的测试与 Spec 实现合同）；nb-layout 的公开面不动，发现缺口记下来，留给 t47 之后的 Task。

## 技术选型

无。用 nb-layout 已有的公开入口（`createGrid`、`NestedGrid`、`useGridHost`），不另引库。

## 关键设计

### `packages/nb-story/src/web/shell/book-grid.ts`（新）

建树与收起策略，纯函数、可单测：

- `createBookGrid({navWidth, drawerWidth, navCollapsed, drawerCollapsed})`：根是横向分支，三片叶 `nav`、`main`、`drawer`，`sashSize: 1`（与现在 `sash-sizes [1, 1]` 一致）。
  - `nav`：`sizing: "fixed"`，宽 188，最小 150、最大 300，收起到 44（`restoreSize` 188，阈值 60、40）；
  - `main`：按比例分，最小 360；
  - `drawer`：`sizing: "fixed"`，宽取偏好（`readDrawerWidth`），最小 280、最大 640，收起到 0（`restoreSize` 取偏好，阈值 80、40）。
  - 数值照搬现在 `BookFrame.vue` 的 `panels`，单独成函数是为了让单测核对“与旧配置同值”。
- 不存快照：现在的偏好只有导航收起与抽屉宽度两项（`host/prefs.ts`），照旧经它们存取，不引入网格快照（快照存的是结构与尺寸意图，这里结构固定，没有要存的结构）。

### `packages/nb-story/src/web/shell/BookFrame.vue`

- `Splitter` 换成 `<NestedGrid ref="gridRef" v-bind="host.bindings.value">`，三片叶在 `leaf` 插槽里按 `node.id` 画导航、主区与抽屉，内容不变。网格只在宽屏与平板两档挂着（手机照旧不用分栏），与现在 `v-if="tier !== 'phone'"` 一致。
- **宿主**：`useGridHost({grid, contextKey: "book-frame", onApplied})`。
- **三档**：树在宽屏与平板两档相同，不随档位增删叶：
  - 平板：导航收起（照旧 `navIsCollapsed`）；`drawer` 叶收起到 0，抽屉照旧画成浮层；`sashDisabled` 让主区与抽屉之间的分隔线不能拖（现在平板只给两块面板，没有这条线）。
  - 回到宽屏：按 `book.drawer` 展开或保持收起。
  - 理由：增删叶是结构变化，会和容器尺寸变化在同一刻发生，过渡与 `revision` 的先后更难推；收起标记的翻转由 `host.setCollapsed` 一处负责。
- **收起状态的两个来源**：
  - 宿主改：`watch(navIsCollapsed)`、`watch(抽屉该不该收起 = book.drawer 为空或浮层档)` 调 `host.setCollapsed`；
  - 手势改：`onApplied(commit)` 读 `commit.changes` 里有变化的 `collapsed`：导航变了写偏好（`setNavCollapsed`），抽屉收起调 `book.closeDrawer()`、展开调 `book.reopenDrawer()`；抽屉的目标宽度不小于 280 时写偏好（同现在 `onGestureEnd`）。
  - 分隔线上按 Enter 收起与展开也经 `onApplied` 回来，与拖动同一条路。
- **过渡**：
  - 时长：在网格的承载盒上把 `--nb-layout-motion-layout` 设成 `var(--nb-layout-motion-move)`，保持现在 Splitter 的 280ms；曲线两者本来都是 `--nb-layout-ease-layout`（`Splitter.vue` 的折叠过渡），不用改。理由：t44 的验收是“看不出差别”；改成工作台的 470ms 是另一个决定。
  - 图不逐帧重画：`LAYOUT_MOTION` 改成读网格 expose 的 `moving`（现在是按 `--motion-move` 掐表的 `startMotion` 定时器）。`moving` 在减少动效时一直为假，与现在“时长为 0”的结果一致。
  - 抽屉关上时的内容：`NestedGrid` 对降到零的叶保持内层尺寸、按外框裁切（即现在“抽屉内容固定宽度、贴右边滑出”的效果），所以 `BookFrame` 里手写的 `absolute inset-y-0 right-0` 与 `width` 不要了。关上那一刻 `book.drawer` 已是 `null`，抽屉要继续画刚关掉的内容：叶在网格 expose 的 `outgoingLeaves` 里时画 `book.lastDrawer`，过渡结束就空了。替换掉现在的 `closingDrawer` 与定时器。
- **偏好**：导航收起与抽屉宽度照旧读写 `host/prefs.ts`；建树时读一次。
- 删除：`panels` 计算、`onGestureEnd`、`startMotion` 与 `motionTimer`、`closingDrawer`、`MOTION_SLACK_MS`、`motionMs`。

### 测试

- `book-grid.test.ts`（新，Bun）：`createBookGrid` 的三片叶、保留像素、最小最大与收起策略与现在的 `panels` 同值；1440 与 1024 宽下算出的布局：宽屏三栏 188、余量、偏好宽度，抽屉收起时主区吸收；导航收起为 44。
- e2e：`packages/nb-story/e2e/viewer.e2e.ts` 现有的 56 条照跑（含输出 1 的“收起抽屉后重画”与三档）。
- 改前改后探针：照 t14 的做法（一次性 Playwright，不提交），e2e 夹具起真实 `nbstory serve` 与 100 章样例书，宽屏、平板、手机各状态截图加 JSON（每块面板的宽度与收起、每条分隔线的读屏属性），真操作：拖抽屉分隔线变宽、拖到 0、从 0 拖开，导航分隔线 Home、End、Enter，减少动效时关抽屉。选择器从 `data-panel-id` 改成 `data-leaf`，改前那一份用旧选择器取同样的值。

## Spec 与文档改动

- `story/viewer`：行为不变，不改输出条目；实现合同里“分栏”一句改成 `NestedGrid` 加 `useGridHost`（有这一句时）。
- `packages/nb-story/AGENTS.md` 的依赖方向已写 nb-layout（t14），不用改。

## 切片

1. `book-grid.ts` 与单测；`BookFrame.vue` 换成 `NestedGrid`。验证：nb-story `typecheck`、`bun test`（单测）、`build:web`、`viewer.e2e.ts`、改前改后探针。一个提交。
2. 收口：Task README 写接入记录（缺什么、别扭什么），Spec 实现合同（若有）；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `story/viewer` 输出 1（拖分隔条、阈值收起展开、按钮收起展开、过渡中图不逐帧重画、抽屉关闭按钮） | `viewer.e2e.ts` 现有用例；探针的拖动、Enter、按钮与截图对照 |
| `story/viewer` 输出 32（平板：导航图标条、抽屉浮层不挤主区） | `viewer.e2e.ts` 的平板用例；探针平板截图与“主区与抽屉之间没有能拖的线” |
| `story/viewer` 输出 33（手机） | `viewer.e2e.ts` 的手机用例；手机不挂网格，探针截图对照 |
| `story/viewer` 验收 4（收起抽屉后重画） | `viewer.e2e.ts` 现有用例 |
| “边界与兼容”的偏好（导航收起、抽屉宽度） | 探针读偏好：拖宽后 460、拖到 0 后仍 460、从 0 拖开后的值与改前一致 |

## 验证

- worktree 里：`bun run --cwd packages/nb-story typecheck`、`bun test`（nb-story）、`bun run --cwd packages/nb-story build:web`、`bunx playwright test -c e2e/playwright.config.ts e2e/viewer.e2e.ts`（在包目录）。
- 探针改前（分支起点）改后各跑一份，JSON 逐字对照、截图逐像素比较；有差别逐条解释。
- 未验证边界：触屏拖分隔线（e2e 与探针只用鼠标与键盘）；120Hz。

## 不做与风险

- 不做：网格快照存盘、并排卡片与拖动（t45）、动效时长改成 470ms、nb-layout 公开面的任何改动。
- 风险：
  - 平板档的 `drawer` 叶收起到 0 而分隔线停用：`sashDisabled` 只停用手势，线照画；收到 0 的一侧不画静止接缝（`data-beside-zero`），所以平板右边缘不该多出一条线。探针的平板截图兜底。
  - `outgoingLeaves` 的时机：关上抽屉那一刻 `book.drawer` 变空、网格这一轮的 `outgoingLeaves` 已含 `drawer` 才不会闪空白。探针在关上之后第一帧截一张兜底；对不上就保留 `lastDrawer` 直到 `moving` 为假。
  - 过渡变量覆盖：`NestedGrid` 读 `--nb-layout-motion-layout` 的位置若不在承载盒的后代上，覆盖不生效。探针量关抽屉过渡的时长兜底。
