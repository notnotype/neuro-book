# t29 计划：面板头与分节全部收起的样子

第 2 稿（2026-11-17）：按第一轮设计审查（[`evidences/design-review.txt`](evidences/design-review.txt)，11 条）改，逐条的处理在 Task README。最大的变化：全部收起时卡片满高改在投影里做，不给网格加分支选项（第 1、2、10 条）。

## Context

开发者 2026-11-17：“侧栏一个容器中的所有视图都收起，样式不对，重新设计一下，而且现在的标题头有点小丑，特别是收起后更丑”。第 1 轮评审板（[`artifacts/review`](artifacts/review/index.html)）的决定，编号同 Task README：

1. `all-collapsed` 甲：一个容器的分节全部收起时，卡片和活动栏照旧连成满高的一列，收起的标题行排在上面，下面是卡片自己的底。
2. `head-style` 甲：展开标记在标题左边，浮动、最大化与视图动作悬停才出，收起按钮拿掉，收起的行标题退成次要字色。附言：“记得细节检查一下，看看对齐了没”。
3. `title-click` 甲：点分节的标题行在展开、收起之间来回切；Enter 同样切换，空格照旧拿起拖动（评审板的推荐理由写的是“整行就是开关，和 VS Code 一样”）。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 11、20、25；[`workbench/views`](../../../../../docs/specs/workbench/views.md) 输出 10、19。

和 [t28](../t28-panel-entry-strips/README.md) 的关系：t28 第 3 片并进入口条的头就是这个面板头，它在本 Task 合入后按新头重写设计。

## 技术选型

无。

## 关键设计

### 全部收起时卡片满高：`packages/nb-layout/src/layout-project.ts`（投影），`web/state/layout-present.ts`、`web/layout-drag.ts`

- 网格不动（`grid-geometry.ts` 照旧在全部收起时留空，“收起的节点尺寸等于收起尺寸”的不变量不改）。投影里：带容器的区域的一列（纵向排的分节，侧栏、右栏；t28 包装之后是 `:sections`）当前显示的分节全部收起时，最后一节不配收起策略，按比例分（`weight`）、最小高度是面板头高度，吸收这一列剩下的空间——叫它“垫底的那一节”。它在文档里仍是收起的：
  - 内容停放、不可见：`effectiveVisibleTabs` 的“已提交”已按 `isSectionCollapsed` 排除；手势预览里的“拉出来”另排除垫底的那一节（它是否垫底由文档算得出：区域当前容器显示的分节全部收起、它是最后一个），所以拖别的缝时它的内容不露出来（第 3 条）。
  - `rebaseIntents` 不写它（已有：收起的分节跳过）；`minimumOf`、放不下收走按它的最小高度（面板头）算，和收起时一样。
  - 拖它上面那条缝：上面那节是收起的、带收起策略，它是按比例分的，和今天“收起的分节在展开的分节上面”同一个情形，过了阈值上面那节展开（第 2 条：这条路径已有，不是新能力）。
  - 点上面某节展开：那节按份额长出来，垫底的那一节缩回标题行，卡片的上下边都不动（一列的总高不变），过渡照常（第 11 条）。点垫底的那一节展开：它的外框已经在那里，内容出现。
- 落点几何保持旧约定（第 4 条）：`geometryOf` 对收起的分节，外框与标题行都只取标题那一行，正文是零面积；所以垫底的那一节下面那片卡片底和今天的空白一样不是落点，指针与键盘的候选一致。
- 悬停范围：收起的分节把 `data-hover-actions-scope` 放在头上，不放在整张卡片上，指针停在垫底的那一节下面的空白里不显示它的按钮（第 8 条后半）。

### 面板头：`web/components/WorkbenchPanelHead.vue`（同名 `.md`）、`WorkbenchShell.vue`

- 新属性 `fold?: {collapsed: boolean} | null`：这块面板在这里能收成标题行（Shell 现有的 `collapsibleHere`）时给；没有就不画标记（底部面板的分节、区域唯一的分节、浮动窗、编辑组），标题左缘照旧（第 9 条：有标记与没标记的头左缘差一个标记宽，这是想要的样子，写进 Spec）。
- 整行是开关（第 5 条）：标题按钮铺满标题那一格（`flex: 1`），展开标记放在按钮里、标题前面；按钮带 `aria-expanded`（有 `fold` 时）与 `aria-controls`（内容 `region` 的 id）。框架按钮、视图动作是按钮的兄弟（`data-no-drag`），点它们不冒成切换。整行仍是拖动源（就是这个按钮）。
- 点击只有一个事件（第 6 条）：头照旧只发 `activate`，Shell 一处决定：展开着、可收起 → 收起（`setPanelCollapsed(panel, true)`），焦点留在标题上；收着 → 照旧 `activate`（它已经会展开）；不可收起 → 照旧激活。Enter 是按钮的点击，同样切换；空格照旧先交给键盘拖动，拖不了（视图不可移动、拖动关闭）时是按钮的点击，也切换（写进 Spec）。双击切换两次，回到原样（同 VS Code，不限速）。
- 视图接管标题区时（第 7 条，`views.md` 输出 19）：标题按钮是视图的（弹会话列表），这时展开标记是左列最前面一个单独的按钮（可访问名称“展开/收起 <标题>”、`aria-expanded`，进 Tab 序），算进左右两列的等宽（`sideWidth`），标题照旧居中；标题照旧“收着时只展开、展开着时通知视图”。收起时接管的标题同样退成次要字色。这个模式不按下面的“左缘对齐”判。
- 框架按钮里拿掉“收起”（`frameActionsOf` 不再列 `SET_PANEL_COLLAPSED_COMMAND`）；命令照旧。
- 悬停才出（第 8 条）：框架按钮的容器也带 `data-hover-actions`，和视图动作同一个显示范围（这块面板；焦点在头里时也显示；触摸设备一直显示，`hover-actions.css` 已有）；按下的按钮（`aria-pressed="true"`，最大化着时的还原）一直显示，加进豁免。`headReserved` 改成两个框架按钮加标记的宽度。
- 标题：12px、600，展开时主字色，收起时次要字色。头仍是 32px。

### 对齐（开发者附言，第 9 条）

e2e 里量的几条（浅色、深色各一遍）：

- 标记左缘离卡片左缘 8px（和正文的左内边距一样），同一节展开、收起两种状态下标记与标题的横坐标相同，几行收起的标题行标题左缘在一条竖线上；
- 标记图标与标题字形（`Range.getBoundingClientRect`）的竖直中心相差不超过 1px，都在 32px 的头里居中；
- 收起的几行之间是开放式分割线，垫底的那一节标题下面不画线；
- 截图给开发者：展开、一节收起、全部收起、悬停各一张（浅色），平铺主题（macos）一张。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md`：输出 11（一列全部收成标题行时，最后一节垫底，卡片满高；垫底的那一节仍按收起算）、输出 20（展开标记、整行是开关、Shell 一处决定、Enter 与空格、双击、收起按钮拿掉、框架按钮悬停才出、按下的一直显示、字色、有无标记的左缘）、输出 25 第 7 行（垫底的那一节下面不是落点）；验收补“全部收起时卡片满高”。
- `docs/specs/workbench/views.md`：输出 10（框架按钮和视图动作同一个显示范围，收起的分节范围是头）、输出 19（接管标题区时展开标记在左列）。
- 组件说明：`WorkbenchPanelHead.md`、`WorkbenchShell.md`、`WorkbenchSurface.md`。

## 切片

1. **投影：垫底的那一节**（`layout-project.ts` 的 `assignByParent`，在 nb-layout 里但只动投影）。验证：`layout-project.test.ts`（全部收起时最后一节没有收起策略、按比例分、最小高度是面板头，前面几节照旧收起；有一节展开着照常；t28 包装分支里同样；`rebaseIntents` 不写它）、nb-layout 全部测试与类型检查。
2. **工作台：头、悬停、可见性与落点几何**。`WorkbenchPanelHead` 的 `fold`、整行开关、`aria-*`、接管模式的标记；Shell 的点击决定；框架按钮悬停才出与豁免、`headReserved`；`effectiveVisibleTabs` 排除垫底的那一节；`geometryOf` 对收起的分节只取标题行；收起的分节悬停范围放在头上。验证：`WorkbenchPanelHead` 的 DOM 测试、`layout-present.test.ts`、`layout-drag` 相关单元测试；e2e：`workbench-containers`（全部收起时卡片满高、右下角圆；点标题切换、Enter、空格拿起、双击；全部收起后拖侧栏宽度，垫底的那一节内容仍停放；点上面一节展开时卡片上下边不动；拖垫底的那一节上面的缝展开上一节）、`workbench-views`（按钮悬停才出、焦点在头里时显示、最大化着时还原一直在；对齐几条）、`workbench-shell`、`workbench-dnd`（垫底的那一节下面不是落点）、`files-explorer`、`editor-area`、`agent-conversation`（接管模式的标记）、`lab-workbench-surface`（原来点收起按钮的改成点标题或执行命令，逐个核对“点标题激活”的用例在可收起的分节上是否会被收起）。

## 验收映射

- 输出 11（全部收起卡片满高、垫底的那一节）→ `layout-project.test.ts`、e2e `workbench-containers`。
- 输出 20（标记、整行开关、点击决定、按钮悬停、对齐）→ `WorkbenchPanelHead` 的 DOM 测试、e2e `workbench-containers`、`workbench-views`。
- 输出 25 第 7 行（垫底的那一节下面不是落点）→ `layout-drag` 单元测试、e2e `workbench-dnd`。
- `views.md` 输出 10、19 → e2e `workbench-views`、`agent-conversation`。

## 验证

- 每片跑受影响的单元测试、类型检查与 e2e；全部收起与对齐在 e2e 里读像素与矩形。
- 浅色截图给开发者看，对照评审板的甲。

## 不做与风险

- 不做：底部面板分节的折叠（照旧不折叠）；头的高度（32px 不变，t28 的入口条同高）；网格的“全部收起时留空”不改（只在投影里垫底）。
- 风险：原来点收起按钮、点标题让焦点进面板的 e2e 要逐个核对；可收起的分节上“点标题”现在会收起。
- 风险：垫底的那一节在实时布局拖动的预览文档里（来源摘掉后剩下的全部收起）也垫底，预览与落点几何按同一份投影；单测覆盖“预览里出现垫底”。
