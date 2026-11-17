# t29 计划：面板头与分节全部收起的样子

第 1 稿（2026-11-17）。

## Context

开发者 2026-11-17：“侧栏一个容器中的所有视图都收起，样式不对，重新设计一下，而且现在的标题头有点小丑，特别是收起后更丑”。第 1 轮评审板（[`artifacts/review`](artifacts/review/index.html)）的决定，编号同 Task README：

1. `all-collapsed` 甲：一个容器的分节全部收起时，卡片和活动栏照旧连成满高的一列，收起的标题行排在上面，下面是卡片自己的底。
2. `head-style` 甲：展开标记在标题左边，浮动、最大化与视图动作悬停才出，收起按钮拿掉，收起的行标题退成次要字色。附言：“记得细节检查一下，看看对齐了没”。
3. `title-click` 甲：点分节的标题行在展开、收起之间来回切；Enter 同样切换，空格照旧拿起拖动。

合同：[`ui/workbench-layout`](../../../../../docs/specs/ui/workbench-layout.md) 输出 11、20；[`workbench/views`](../../../../../docs/specs/workbench/views.md) 输出 10、19；[`ui/nested-grid`](../../../../../docs/specs/ui/nested-grid.md) 的“分支的收起”。

和 [t28](../t28-panel-entry-strips/README.md) 的关系：t28 第 3 片并进入口条的头就是这个面板头，它在本 Task 合入后按新头重写设计。

## 技术选型

无。

## 关键设计

### 全部收起时最后一行拉到底：`packages/nb-layout/src/grid-geometry.ts`、`grid-types.ts`、`layout-project.ts`

- 网格现在故意留空（`grid-geometry.ts` 的“全部收起时留空是有意的”），卡片是按叶画的，所以空出来的地方没有卡片。加一个分支选项 `GridBranchInput.collapsedRest?: "empty" | "last"`（缺省 `"empty"`，现有行为不变）：`"last"` 时子节点全部收起，主轴上剩下的空间给最后一个子节点，它仍是收起的（收起状态、收起策略不变，只是外框更长）。有一个展开着就照常分。
- 投影给带容器的区域里纵向的分节分支设 `"last"`（侧栏、右栏一列几节时；t28 包装之后是 `:sections`）：只在呈现里，不进文档。
- 拉长的那一节仍按收起算：内容停放（`effectiveVisibleTabs` 的“已提交”已排除收起的分节；手势预览里的“拉出来”要另加一条：收起的分节只在预览把它判成展开时才算），`rebaseIntents` 不写它（已有：收起的分节跳过），焦点、键盘落点不落进它的正文。
- 收起策略的手势照旧：拖它上面那条缝，上一节按阈值展开；它自己展开（点标题）时外框已经在那里，内容出现、上面几行不动。

### 面板头：`web/components/WorkbenchPanelHead.vue`（同名 `.md`）、`WorkbenchShell.vue`

- 新属性 `fold?: {collapsed: boolean} | null`：这块面板在这里能收成标题行（Shell 现有的 `collapsibleHere`）时给，没有就不画标记（底部面板的分节、区域唯一的分节、浮动窗、编辑组）。
- 展开标记在标题左边：14px 的 chevron（展开向下、收起向右），次要字色，和标题竖直居中；它是按钮的一部分（点它和点标题一样），不单独占焦点。
- 点标题：有 `fold` 时切换收起（发 `toggle-collapsed`，宿主执行 `nbook.view.set-panel-collapsed`），并照旧激活这块面板；没有时照旧只激活。标题按钮带 `aria-expanded`（有 `fold` 时）。Enter 是按钮的点击，所以同样切换；空格照旧拿起拖动（现有的键盘拖动先拦）。视图接管标题区时（`views.md` 输出 19）：标题按钮是视图的（弹会话列表），这时展开标记单独可点、`aria-expanded` 写在它上面，标题照旧“收着时只展开、展开着时通知视图”。
- 框架按钮里拿掉“收起”（`frameActionsOf` 不再列 `SET_PANEL_COLLAPSED_COMMAND`）；命令照旧，命令面板与快捷键能用。
- 视图动作与框架按钮一起悬停才出：沿用视图动作现有的显示范围（这块面板，`data-hover-actions-active`，`views.md` 输出 10），焦点在头里（`:focus-within`）时也显示；不显示时透明但占位（现有写法，按面板宽度算放几个按钮不变）。
- 标题：12px、600，展开时主字色，收起时次要字色。头仍是 32px。
- 对齐（开发者附言）：标记、标题、按钮在 32px 里竖直居中（中心线相差不超过 0.5px）；标记的左缘离卡片左缘与正文第一层的缩进对齐；收起的行与展开的头标记、标题横坐标相同；几行收起的标题行左缘在一条竖线上。逐项在 e2e 里量矩形。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md`：输出 11（一列全部收成标题行时，最后一行的外框拉到底，卡片满高）、输出 20（展开标记、点标题切换、Enter 切换、收起按钮拿掉、框架按钮悬停才出、标题字色）；验收补“全部收起时卡片满高”。
- `docs/specs/workbench/views.md`：输出 10（框架按钮和视图动作同一个显示范围）、输出 19（接管标题区时展开标记单独可点）。
- `docs/specs/ui/nested-grid.md`：“分支的收起”加 `collapsedRest`。
- 组件说明：`WorkbenchPanelHead.md`、`WorkbenchShell.md`、`NestedGrid.md`（分支选项）。

## 切片

1. **nb-layout：`collapsedRest`**。`grid-geometry.ts` 的分配、类型、投影给区域的分节分支设上。验证：`grid-geometry` 相关单元测试（全部收起时剩下的给最后一个、仍是收起的；有一个展开着照常；缺省留空）、`layout-project.test.ts`（区域的分节分支带这个选项）、nb-layout 全部测试与类型检查。
2. **工作台：头与全部收起**。`WorkbenchPanelHead` 的 `fold` 与标记、点标题切换、`aria-expanded`、框架按钮悬停才出、拿掉收起按钮、字色；`effectiveVisibleTabs` 的预览条件。验证：`WorkbenchPanelHead` 的 DOM 测试、`layout-present.test.ts`；e2e：`workbench-containers`（全部收起时卡片满高、最下一行下面是卡片底、右下角是圆的；点标题切换；Enter 切换；空格拿起）、`workbench-views`（按钮悬停才出、焦点在头里时显示；对齐的矩形）、`workbench-shell`、`workbench-dnd`、`files-explorer`、`editor-area`（原来点收起按钮的改成点标题或执行命令）、`lab-workbench-surface`；浅色截图给开发者看。

## 验收映射

- 输出 11（全部收起卡片满高）→ `grid-geometry` 单元测试、e2e `workbench-containers`。
- 输出 20（标记、点标题切换、按钮悬停才出、对齐）→ `WorkbenchPanelHead` 的 DOM 测试、e2e `workbench-containers`、`workbench-views`。
- `views.md` 输出 10、19 → e2e `workbench-views`、`agent-conversation`（接管标题区时标记单独可点）。
- `ui/nested-grid` 的 `collapsedRest` → `grid-geometry` 单元测试。

## 验证

- 每片跑受影响的单元测试、类型检查与 e2e；全部收起与对齐在 e2e 里读像素与矩形。
- 浅色截图（展开、一节收起、全部收起、悬停）给开发者看，对照评审板的甲。

## 不做与风险

- 不做：底部面板分节的折叠（照旧不折叠）；头的高度（32px 不变，t28 的入口条同高）。
- 风险：原来点收起按钮的 e2e 有 5 个文件，改成点标题后，“点标题激活”的用例（例如点标题让焦点进来）在可收起的分节上会顺带收起，逐个核对。
- 风险：拉长的最后一行在手势预览里被判成“拉出来”而露出内容；单测加这一条。
