# t24 实施计划：视图容器（第一步：侧栏）

## Context

开发者 2026-11-09 要求活动栏一个图标切换侧栏的一整块内容（例：会话与资源管理器一起显示，记住位置与展开收起），右栏、底部面板也做；容器既能由插件声明，也能由用户拖出来。提案 [工作台的视图容器](../../../../../docs/proposals/workbench-view-containers.md) 经两轮设计审查，2026-11-10 接受；长期决定见 [ADR 0046](../../../../../docs/adr/0046-workbench-view-containers.md)。

开发者已定：容器里是分节（一个视图一节）；三片具名面板留作区域的锚；归属记在分节自己的记录上；默认声明侧栏容器“项目”（会话、资源管理器），对话留在右栏；用户容器用第一个视图的图标；旧记录不迁移、回落默认布局；拖到入口不预览切容器；只含一个视图的入口拖它就是拖视图，含几个视图的入口只在入口条之间走；活动栏隐藏时只用命令切换；切换容器不改尺寸意图。

本计划只做第一步（侧栏）。第二步（右栏、底部面板的入口条）另做设计：入口条作树上的条节点和现有条规则有六处冲突（第二轮审查 R3）。

## 技术选型

无：都在已有的 nb-layout 与工作台代码里改，没有通用问题要引库。

## 关键设计

### `packages/nb-layout/src/layout-doc.ts`、`layout-project.ts`

- **记录**：`PanelRecord` 加 `container?: string`（分节的归属）；具名面板（锚）加 `entries?: string[]`（入口顺序）与 `active?: string | null`（当前容器）。锚的 `tabs` 恒为空。
- **可见**：`isNodeShown(doc, node)` 是唯一判定：面板没被隐藏；是分节的话，`container === 锚.active` 且锚没隐藏。`layout-project.ts:110`、`:150` 与工作台里直接读 `hidden` 的地方（`layout-doc-store.ts:133`、`:442`，`layout-present.ts:56`、`:113`，`layout-drag.ts:365`）改走它（切片 0 时还没有容器条件，行为不变）。校验（`:933`–`:936`）留着直接读，那是格式规则。
- **区域**：`regionOf(doc, panelId)`：沿树往上找到与某片锚同一列（排）的分支，返回锚的名字；锚自己返回自己的名字。
- **区域级收起**：`projectLayoutDoc` 把收起策略配给区域在呈现树里的节点（可能是一块叶，也可能是分支，`GridBranch.collapse` 已支持），零宽记在锚的 `collapsed` 上；分节的 `collapsed` 只表示收成标题行。切换容器时清掉锚的 `collapsed`。
- **结构操作**：往区域里放标签只新建分节（写 `container`），不并进已有分节；搬出区域清掉 `container`；新的 `splitIntoSections`：多标签组停靠进区域时每个标签一节；`setActiveContainer(doc, region, id)`；`createContainer(doc, region, index, panel)` 写入口顺序。新分节的 id 在提交时由 `policy.newId` 生成；默认布局的分节 id 由视图 id 定。
- **比较**：`sameLayoutShape` 比 `container`、`entries`、`active`。
- 不变量：规范形不碰身份（身份不在分支上）；锚永远不进呈现树，所以骨架判定照旧。

### `packages/nb-layout/src/layout-drop.ts`

- 分节的正文沿区域方向分前后两半：落点规则、落点分区、键盘候选三处一起改，结果是“插在这一节前或后，成新分节”；区域里的分节没有中央落点。

### `packages/neuro-book/src/plugins/workbench/web/state/`

- `default-tree.ts`：按声明建默认布局：每个出现的容器在它的区域里，成员各成一节；锚 `tabs: []`。`fitsSkeleton` 加：锚没有标签、区域里的面板只有一个标签且有归属。
- `layout-doc-store.ts`：不合新规则的记录走现有的 `outsideSkeleton`，回落时用 `carryDynamicTabs` 带走开着的编辑器标签；不加版本号，不进 `guarded`。
- `layout-constraints.ts`：宽度约束、`COLLAPSE_ORDER`、`toolPanelAxis` 按 `regionOf` 问，约束取区域与当前容器视图声明的并。
- `layout-present.ts`：活动栏条目改成侧栏的容器（按锚的 `entries`，只列有实际成员的）；标题与图标按提案第 1 节的顺序求；按下态是“当前容器且侧栏可见”。
- `public-state.ts`：`focusedPart` 按区域。
- 容器身份的求值（隐式 `view:<id>`、声明的、`custom:<UUID>`；按实际成员出现）放一个纯函数模块 `state/containers.ts`，活动栏、“移动到”菜单只读它的结果。

### 声明：`views/registry.ts`、插件合同

- 视图声明加 `container?`；新贡献点 `workbench.viewContainers`：`{id, title, icon, location, order?}`，id 不得以 `view:`、`custom:` 开头；引用不存在的容器落回隐式容器并诊断。
- 工作台插件声明侧栏容器“项目”；资源管理器（`explorer/web/plugin.ts`）、会话（`agent/web/plugin.ts`）的声明写 `container`。

### 活动栏：`components/WorkbenchToolStrip.vue`、`WorkbenchShell.vue`

- 条目是容器：点击规则同提案第 3 节；右键菜单是容器的（移到右栏或底部面板在第二步才有意义，第一步只有“重置”）；“更多”溢出照旧。
- 活动栏隐藏时切换侧栏容器只经 `nbook.view.open`（Spec 定稿时定，不另加命令）。
- 搬整个容器做成 store 的一个动作，第一步的“重置”与第二步的“移到”共用：分节的先后、比例、收成标题行都带着。

### 拖动：`web/layout-drag.ts`、`live-drag.ts`

- 活动栏的落点：两个入口之间是新容器（入口滑开留位），入口上是并入（入口高亮），预览不切当前容器；放下才切。现在的 `barDrop` 换成这一套（顺带消掉 t22 审查第 4 条的“活动栏单独一套判定”）。
- 来源是当前容器唯一的分节、收起后容器空了：预览里区域是空的；放下后切到相邻容器。
- 拖入口：单视图入口等于拖视图（现状）；多视图入口只在入口条里换序，用落点指示。
- 当前容器进结构键（`layoutStructureKey`）。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md`、`workbench/views.md`、`ui/layout-drag.md`、`ui/nested-grid.md`：按提案“对 Spec 的预期改动”，条目级 planned（另行起草，审过后提交）。
- 组件 `.md`：`WorkbenchToolStrip.md`、`WorkbenchSurface.md`；插件作者文档里视图声明的 `container?` 与新贡献点。

## 切片

0. **可见判定收到一处**（行为不变）：`isNodeShown` 取代直接读 `hidden` 的地方。验证：nb-layout 与工作台的单元测试，`workbench-views`、`workbench-dnd` e2e。单独提交。
1. **nb-layout 的模型**：记录字段、可见条件、`regionOf`、区域级收起、结构操作与比较、校验。单元测试补在 `layout-doc.test.ts`、`layout-project.test.ts`。
2. **工作台的模型与声明**：默认布局、读取回落、约束、`focusedPart`、容器求值、声明与贡献点、内置“项目”容器。单元测试；`workbench-views`、`plugins` e2e 会因默认活动栏变化而改期望。
3. **活动栏**：条目、点击、按下态、右键、溢出、命令。e2e 新文件 `e2e/workbench-containers.e2e.ts` 起头。
4. **拖动**：活动栏落点、分节前后两半、拖入口、结构键、容器拖空。e2e 补全提案的九条场景；`workbench-live-drag`、`workbench-dnd`、`workbench-drag-cost` 回归。
5. **命令**：“移动到”的目标、重置、打开视图切容器、最大化与浮动作用于分节。

每片完成后单独提交；切片 1、4 是没把握的，提交后当场派审查（后台，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 提案验收 1（切走切回分节原样） | `workbench-containers.e2e.ts` |
| 验收 2、3（入口之间新建、入口上并入，预览不切） | `workbench-containers.e2e.ts`、`workbench-live-drag.e2e.ts` |
| 验收 4（空容器入口的去留） | `containers.test.ts`（纯函数）与 e2e |
| 验收 5（侧栏拖到零、点图标展开） | `layout-project.test.ts` 与 e2e |
| 验收 6（拖走唯一分节，放下才切） | `live-drag.test.ts` 与 e2e |
| 验收 7（旧记录回落、编辑器标签带走、能保存） | `layout-doc-store` 的单元测试与 e2e |
| 验收 8（空区域能放进、拿走最后一节仍能保存） | 第二步（底部区域的入口在第二步才有）；第一步只测侧栏空了 |
| 验收 9（拖动中切容器取消） | e2e |

Spec 编号定下来之后，把上表改成 Spec 的条目号。

## 验证

- 每片：受影响的单元测试与类型检查（`bun run test:affected --since master --typecheck` 在收口跑一次）。
- e2e 只跑覆盖改动的文件：`workbench-containers`（新）、`workbench-views`、`workbench-dnd`、`workbench-live-drag`、`workbench-drag-cost`、`workbench-shell`、`editor-area`、`workbench-float`、`plugins`（默认布局变了）。超过 8 个时分两轮，或写明 `NB_E2E_WIDE` 的理由。
- 开发者在开发服务上试：默认侧栏是“项目”（两个分节）、切容器、拖出新容器、拖到零。
- 未验证的边界：第二步的右栏、底部面板；真机触摸拖动。

## 不做与风险

- 不做：容器里隐藏单个视图；右栏、底部面板的入口条（第二步）；多视图入口拖进分节区域。
- 风险：默认活动栏从三个图标变成“项目”一个加别的，很多 e2e 假定了旧的活动栏，要逐个改期望；靠 `workbench-views`、`workbench-dnd` 的现有用例兜底，改期望时逐条对照 Spec，不放宽断言。
- 风险：可见条件进 `isNodeShown` 后，切片 0 漏改的直接读 `hidden` 会让不活动容器的分节露出来；切片 0 用 grep 列全，测试里加一条“不活动容器的分节不进呈现树、不是键盘候选、不进收走队列”。
