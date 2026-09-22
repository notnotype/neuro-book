---
schema: nbook.task/v2
taskId: t67-workbench-shell-parts-lab
role: tasker
---

# 工作台部件布局、标题操作与无业务骨架 Lab

**状态：本轮交互修正已实施，交开发者手动验收**（2026-09-21）。原批准计划：[`local://workbench-shell-parts-lab-plan.md`](../../../../../../../../local/workbench-shell-parts-lab-plan.md)；本轮已批准拖放反馈增量见 `local://workbench-drag-feedback-plan.md`，后续用户明确取消标题落点与内容区插线。本文件记录执行与证据，行为合同见 Spec。

**当前增量（2026-09-21）**：非空 left 整个头部（包括当前容器标题）不接收投递，标题仍可拖动；left/right/panel 零容器头部接回整容器；内容半区只画内缩矩形与独立提示，不叠加蓝色插线。View 与容器继续共用既有拖动会话/解析器，真实 Switcher 接收两类来源。开发者已授权在当前工作树启动3001，旧CSS阻塞解除；最新自动检查完成后，开发者要求后续浏览器验证交其手动进行。服务保持运行。详见末尾及 [实施记录](walkthroughs/implementation.md)；此前各轮数据仅是历史证据，本轮合同为 [ui.workbench-shell](../../../../../docs/specs/ui/workbench-shell.md) 与 [ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)。

## 目标

开发者四项要求：底部 Panel 不得切断左侧活动栏；Panel 标题需同时包含框架操作与随活动 View 切换的 View 操作；活动栏、面板、主/辅助侧边栏等主页面部件在 Component Lab 可发现；提供不加载业务内容但具备真实 Grid、sash 与面板操作的骨架 fixture。

## 交付面

| 切片 | 内容 | 完成判据 |
|---|---|---|
| 1 几何与稳定槽位 | `app/utils/workbench/layout.ts`、`panel-state.ts`（新）、`components/workbench/WorkbenchShellLayout.vue/.md`（新）、`descriptors.ts` 加 statusbar、对应测试 | 默认 activity 通高、四位置/四对齐投影、手势取消、七槽实例保留；内存测试闭环，不触 Storage |
| 2 尺寸保存与 Panel 状态 | `storage-grid-host.ts`（`commitFields`）、`layout-session.ts`（`commitSizes`）、`shell-layout.ts`（按 id 读偏好）、`shared/storage/workbench-panel-size.ts` 加 `width`、`shared/storage/workbench-views.ts` 加 panel 字段、`view-placements*.ts` | 旧 v2 原件不重写、单字段 CAS、height/width 独立、隐藏/收起可恢复 |
| 3 活动栏与菜单原语 | nb-ui `Dropdown` 一层 submenu/radio/checkbox/受控 open、新 `WorkbenchActivityBar.vue/.md`、`NovelIdeActivityBar.vue` 适配器、fixture | 真实键盘 submenu、产品入口与短高度 overflow 不丢；nb-ui CSS 重建 |
| 4 View 动作与宿主 | `view-title-actions.ts`、`workbench-shell-commands.ts`、`useWorkbenchViewActions.ts`、`WorkbenchTitleActions.vue`、ViewHost/Instances、`WorkspaceFilePanel` 首贡献 | 命令到精确实例、旧代际拒绝、空 Panel 仍有框架操作 |
| 5 Lab 目录与整壳骨架 | component-index 别名/displayName、LabShell 搜索、`WorkbenchShellLayoutFixture.vue`、部件文档与场景 | 指定中英文词命中真实组件；11 场景可操作；无产品 factory 静态依赖 |
| 6 主页接入与统一验证 | `WorkbenchShell.vue` wrapper、`index.vue`、i18n、smoke 脚本、Spec/提案 | 三 host 事件接线、Panel 状态栏语义、工具移动、editor 实例保留；统一测试/类型/构建/文档验证 |

## 范围与排除

不做：用户编辑工具栏（开发者已选“由 View 贡献操作”）、浮动窗口、活动栏换边、侧栏对调、业务终端/输出内容、t66 编辑器多组/正文同步重设计、旧 spike 状态系统。不重写 `GridRenderer` 既有像素/sash 交叉行为。

## 验证入口

计划 §验证 的必留回归测试、一次统一命令验证、隔离运行环境（`Temp/neuro-book/acceptance/workbench-shell-parts-lab-<runId>`，端口 44779 起）、真实浏览器 smoke（`--suite workbench-shell` 与 `core`）。t66 旧 531 用例与未闭合浏览器结论不能替代本任务证据。构建只允许 `bun run nuxt:build:raw`。

## 记录

实施叙事与验收证据写入 [walkthroughs/implementation.md](walkthroughs/implementation.md)；原始输出按需写入 `evidences/`。

## 执行状态（2026-09-19 夜）

**已通过（本机实测，命令与数字见 walkthrough §统一验证结果）**

- 聚焦套件 `packages/neuro-book`：48 文件 / 531 例；编辑器套件 15 文件 / 133 例。
- `bun run typecheck`（neuro-book）0 个 TS 错误；`packages/nb-ui` 24 文件 / 399 例 + 类型生成 + CSS 构建通过。
- Work 根 `docs:check`（6174 文件）与 `governance:check` 均 0 failures。
- `bun run nuxt:build:raw` 成功，且产物里没有 `/lab` 路由与任何 fixture-only 标识（正向对照通过）。

**真实浏览器（已全绿）**

- `--suite workbench-shell`（Lab 骨架八步：部件检索、默认与跨度、resize 与取消、收起/隐藏/最大化、View 动作与三段真实拖动 + Escape、lifetime 实例保留、窄画布、静置不抖动、复位）**passed**。
- `--suite core`（Lab 既有冒烟）**passed**。
- 四主题 × 浅深 8 组合对照通过（截图在 `evidence/theme-*.png`）。

**未做（不得当成已验收）**

- 主页验收：需要创建 Project 与文档（写状态根），开发者已选择暂缓、先修拖放；拖放已修完，随时可以拿着同一套隔离/授权口径继续。

**并行改动说明**：`packages/nb-ui/dist/nb-ui.css`、`src/tokens.css`、`themes/nbook/vars.css` 的改动来自并行 nb-ui 工作，不是本任务编辑；本任务对这些文件只跑过 `build:css`（产物与源码改动都不是本任务成绩）。

仓库未配置 formatter 脚本（无 prettier/biome/dprint 配置），计划里的「统一格式化」一项无对应命令，未执行。

## 2026-09-20 开发者实测反馈

上一轮 smoke 通过仅代表已执行场景，不覆盖本节新增行为，也不否定开发者的实测缺陷。本节允许修改原范围排除的 Grid/sash 交互实现，继续保留未提交改动与主页验收暂缓边界。

- 删除 `WorkbenchShellLayoutFixture` 顶部场景说明段落。
- Activity Bar 只表示主侧栏当前打开的容器，选择互斥；核对本地 VS Code 调研中的 Part / ViewContainer / View 层次。
- 容器内各 View 用同一 Grid 竖向分屏；View 的拖动入口改为整个 Tab 或 Section 标题，不能只拖专用小把手。
- 区分容器整体跨 Part 移动与其内部 View 独立移动；递归容器尚属用户推测，必须先以本地模型和调研澄清，不擅自加任意递归树。
- 修复 editor / panel / right 交汇拖动时 editor 不实时更新、横竖线厚度/把手不一致、T 与十字交汇双线高亮遗漏。
- 新增分隔条继续缩小时收起、从收起边界拖回展开；不得因过渡尺寸保存 0 覆盖原展开尺寸，取消应回基线。

并行归属：GridFixSlice 负责共享 Grid/Splitter 与外壳实时投影修复；ViewModelScout 只读核对领域模型；Leader 集成和统一验证。子代理不运行格式化、测试、构建或浏览器验收。新模型和收起合同需先明确边界，再实施。

## 2026-09-20 计划执行状态（`local://workbench-container-grid-sash-plan.md`）

计划已批准并按波次执行。**本任务只做计划的前三波（共享 sash 数值/渲染 + Shell & editor 宿主）**；
容器位置/选择闭环（第 4 波）与稳定容器宿主（第 5 波）由独立实现者并行推进，产品页面接线（第 6 波）与
集中浏览器矩阵（第 7 波）尚未完成。

**已落地并通过本机实测（命令与数字即时复核）**

- `packages/nb-ui` 全量：`bunx vitest run`（cwd `packages/nb-ui`）**26 文件 / 434 例通过**；其中布局 8 文件 / 259 例。
- nb-ui `vue-tsc --noEmit`：源码与已迁移测试 **0 错误**。
- 共享原语：`sash-drag`（事件级求解，收起/恢复共用同一锚点）、`grid-geometry`（`allocateSashPanels` 唯一分配口径、
  fixed/weight、collapse 感知约束）、`grid-gesture`（一场会话、冻结基线、批量 `changes`）、`useSashGesture`
  （scope 冒泡仲裁、rAF、Escape/blur/卸载/上下文取消、Home/End/Enter 键盘）、`Splitter`（px 受控 + 独立自分配、
  1px 线盒 + 装饰胶囊 dpr 对齐）、`GridRenderer`（独占 scope、预览布局、`onGestureCommit` 同步接纳）
  全部替换了 reka-ui 拖动通道；`grid-renderer-context.ts`、`createSplitterGestureTracker`、百分比投影与
  `ancestorDragging` 100% 旁路已删除。
- editor 切片：`EditorWorkbench` 只透传 `GridGestureCommit`/`GridGesturePreview` 与接纳回调，落账走
  `applyEditorGesture → grid.resizeBranches`，成功只推进一次 `editorSessionRevision`；
  测试 15 文件 / 137 例通过。
- Shell：`WorkbenchShellLayout` 不再按分支记账，改 `onGestureCommit` 同步接纳 + 一次批量 `resizeBranches` +
  单次 `resize` 发布；`layout-session.commitSizes` 改为**分项回执**（`{status, records:{widths,panel}}`），
  一份补丁可同时含侧栏与面板两轴（先整份校验 → 一次乐观呈现 → 分项写入，非原子持久化取舍）；
  `layout.ts` 新增拖到零合同（`dragCollapsedParts`、保留展开意图 + 1px 可拖边界、`splitRowFits` 忽略其最小宽度、
  compact 呈现排除）与 `ShellSizePatch.dragCollapsed`（只经定制会话写入）。

**尚未完成（不得当成已验收）**

- 容器模型/选择闭环与稳定容器宿主两波仍在并行执行中；产品页面（`index.vue`、Activity Bar、命令端口、
  fixtures/index、smoke 选择器）未接线；`WorkbenchShellLayoutFixture` 仍在用已退役的 `place-view`/`select-view` 补丁口径。
- 计划第 7 波的集中验证（应用聚焦套件、typecheck、Lab `--suite workbench-shell`/`core`、原始构建、docs/governance 检查、
  真实浏览器矩阵：T/十字同场两轴、fine/coarse 热区、收起/拉回、跨层预览、四主题 8 组合）**本轮未运行**。
- 主页数据验收仍待单独授权（创建 Project/文档或迁移独立数据根），不因本波次完成而自动获得。

### 集成待办（按依赖顺序，供下一轮直接接手）

1. 等 `ContainerModelSlice`（`view-placements*.ts` / `workbench-views.ts` / `containers.ts` / `product-catalog.ts`）与
   `ContainerHostSlice`（`WorkbenchPartHost.vue` / `WorkbenchContainerInstances.vue` / `WorkbenchViewHost.vue` / `useWorkbenchDrag.ts`）停止写入。
2. 收口 `app/component-lab/fixtures/{WorkbenchShellLayoutFixture,WorkbenchViewHostFixture,index}.vue`：
   已失效的口径是 `place-view` / `select-view` 补丁、`resolveViewPresentation({activeViewByContainer})`、
   `ContainerViewPresentation.activeViewId`（单活动 View 模型已退役）、`container(id)` 现在可能返回 `null`；
   （已退掉 `WorkbenchViewDragHandleFixture.vue` 与 `fixtures/index.ts` 的注册项，`fixtures/index.test.ts` 回到 11/11。）
3. 接线产品页面：`index.vue` 的 Part 化（`part("left"|"right"|"panel")` + PartHost）、Activity Bar 容器单选、
   容器命令端口实现（`SHELL_CONTAINER_COMMAND_IDS` 与 `CONTAINER_COMMAND_ARGS_SCHEMAS` 已就绪）、
   拖收起位经定制会话 `setPartVisibility` 写入（`WorkbenchShell` 已增加 `drag-collapse` 事件与 `dragCollapsedParts` prop）。
4. 集成 owner 集中验证（须在所有实现者停下后一次跑完）：`packages/nb-ui`（test/typecheck/build:css）、
   `packages/neuro-book` 聚焦套件 + `typecheck` + `scripts:typecheck`、Lab `--suite workbench-shell` / `--suite core`、
   浏览器矩阵（同场两轴 T/十字、fine/coarse 热区、拖到零与拉回、跨层预览、四主题 8 组合）、
   `nuxt:build:raw`、`docs:check`、`governance:check`。

本轮已收口并实测的聚焦套件：nb-ui 26 文件 / 434 例、Shell 4 文件 / 72 例、editor 15 文件 / 137 例、
Storage/Spike 2 文件 / 35 例、`workbench-grid-consumers.test.ts` 6 例、`fixtures/index.test.ts` 11 例。

第 6 波（产品接线）落地后由 Leader 独立复核：`bunx vue-tsc --noEmit -p tsconfig.json`（neuro-book）
**0 报错**；`bunx vitest run app/components/workbench app/utils/workbench app/component-lab
app/components/novel-ide/NovelIdeActivityBar.test.ts app/stores/novel-ide-legacy-writer.test.ts shared/storage`
**50 文件 / 611 例通过**。`bun run scripts:typecheck` 有 1 处**既有**报错
（`scripts/deploy/product-agent-state-root-smoke.ts:318` 缺 `colorwayId`/`userColorways`；`git status` 显示该文件未被本工作改动），
与本次改造无关，不在本任务范围。

legacy 工具上下文退役落地后由 Leader 复核：`vue-tsc`（neuro-book）**0 报错**；
`bunx vitest run app/components/workbench app/utils/workbench app/component-lab
app/components/novel-ide/NovelIdeActivityBar.test.ts app/components/novel-ide/agent
app/stores/novel-ide-legacy-writer.test.ts shared/storage` → **78 文件 / 896 例通过**。
`bun run docs:check` → `failures: []`（6224 文件）；`bun run governance:check` → `failures: []`, `warnings: []`。

**浏览器实测抓出并修掉的两个真缺陷**（由 `WorkbenchSmokeSlice` 在 3001 上发现）：
1. Shell 级 sash 手势自取消：`GridRenderer` 会话根 extent 用 `getBoundingClientRect()`，被 Lab 舞台淡入的
   `transform: scale(0.99)` 污染且 `ResizeObserver` 不再回调；预览布局因此与受控布局不一致，
   `Splitter` 的约束键（含 layout 派生 min/max）变化把自己的手势取消。修法：根 extent 改取布局盒
   （`clientWidth/clientHeight`）；受控模式的约束键不再包含 layout 派生的 min/max 与 `sashSizes`（由宿主 `revision` 负责失效）。
2. 拖收起把 0 写进尺寸偏好：`settleShellGesture` 对本次收起的叶也写了 `target`（0），
   抹掉了展开意图、拉回只能得到最小尺寸。修法：本次收起的叶只写 `dragCollapsed` 布尔位，尺寸字段跳过。

**原始产物构建与静态检查（Leader 实测）**

- `NODE_ENV=production bun run nuxt:build:raw`（`packages/neuro-book`）→ **exit 0，171.9s，`✨ Build complete!`**。
- 产物 `public/_nuxt`（100 个 JS）阴性对照全部为 0：`WorkbenchShellLayoutFixture`、`WorkbenchViewDragHandleFixture`、
  `NestedGridFixture`、`data-workbench-skeleton-fixture`、`nbook.view.lab`、`tmp-shell-feedback`、`WorkbenchSpike`，以及 `"/lab"` 路由。
- 阳性对照全部命中同一个 workbench 包（`VMw99tvU.js`）：`workbench-view-target`、`workbench-part-target`、`data-sash`、
  `WorkbenchContainerInstances`、`workbench-container-tab`。
- `bun run docs:check` → `failures: []`（6225 文件）；`bun run governance:check` → `failures: []`, `warnings: []`。

**真实浏览器（3001 隔离实例，本机实测）**

- `--suite workbench-shell`：**passed**（1m24.995s，尾行 `Component Lab workbench shell smoke passed: http://localhost:3001/`）。
- `--suite core`：**passed**（11.155s）。
- 新增/重写：`scripts/smoke/workbench-lab.ts`（共享定位与真实指针工具）、`scripts/smoke/workbench-containers.ts`（71 断言）、重写 `workbench-shell.ts`（48 断言）；证据目录
  `C:/Users/notnotype/AppData/Local/Temp/neuro-book/acceptance/workbench-container-grid-sash-r1/evidence`。
- 覆盖：主侧栏两容器单选与重复点击语义、Panel 两容器切换且容器内两 View 同屏、右栏容器、整容器 left→panel→right（实例不重挂）、单 View 换序与跨容器移动、来源搬空与空容器/空 Part 接收、
  T/十字两格（线中心与 fine 边缘 +4px 落在拖动源上）、只动一轴、Escape 双轴取消、拖到零与拉回（左栏与 Panel 横向）。
- 临时探针已清理（含计划模式前的 `scripts/smoke/tmp-shell-feedback.ts`）。

**浏览器实测发现的 4 个产品缺陷（均已修，前 4 条由 `WorkbenchSmokeSlice` 定位）**

1. 会话根 extent 用 `getBoundingClientRect()`（被祖先 `transform: scale(0.99)` 污染且 ResizeObserver 不再回调）→ 预览与受控布局不一致 → Shell sash 全部自取消。
2. 受控模式 `Splitter` 的约束键含 layout 派生 `min/max` → 预览帧自取消。
3. `settleShellGesture` 把拖收起的 0 写进尺寸偏好 → 拉回丢记忆尺寸。
4. 分隔线 `pointerdown` 未做捕获阶段仲裁 → 命中带内压在 dnd-kit 拖动源上时被抢捕获。

**仍未覆盖（不得当作已验收）**

- **右栏拖到零后拉回那一格：已定性为 smoke 场景构造问题，不是产品缺陷（只读定位结论）**。
  677 / 689 不是右栏列宽，而是**紧凑（compact）单列布局**的读数：split 下左栏叶上限 560、右栏叶上限
  `max(360, 0.45 × 壳宽)`（812 → 365），`grid-geometry.ts` 的 `measure` 会把叶呈现夹到节点上限，所以
  「左栏 = 编辑区 = 689」只可能来自 `WorkbenchShellLayout.vue` 的紧凑模板（所有主体叶 `w-full` 同列宽，
  右栏 PartHost = 叶 − 12px gutter = 677）；689 是整数说明缩放为 1、该时刻壳布局宽 749。
  模型不可能把手势目标写成 677：面板 `[min,max]` 与 `resizeBranches` 的 fixed 夹取两重约束、投影再夹一次，
  即便记录里存了越界值也只呈现 365（「越界只夹呈现、不回写原件」是既有设计）。
  「多一次保存」也无法成立：该断言是等式，0 次同样报错；compact 下 `[data-sash="body:1"]` 不存在，
  `dragSash` 直接返回 false —— 那次「拉回」根本没发生。
  **下一步（可选收尾）**：把该格用不会进入 compact 的场景加回（例如先把右栏拖小再收起，或从更小的初始宽度起步），
  并在场景开头断言 `mode === "split"`（`data-shell-layout`），避免同类误测。产品侧无需改动。

- Lab fixture 的「重复点当前容器条目打开被隐藏/拖收起的主侧栏」只覆盖了保持选中那一半：fixture 的隐藏位是内存 ref 而不是组合进记录，纯 compose 在清隐藏位前就返回 `changed=false`；产品侧同路径是记录字段（`openPart()` 会清并置 `changed=true`，已有单测）。
- 短容器 260px、DPR 1/1.25/1.5/2、四主题 × 浅深 8 组合、真实数据主页验收：**本轮未运行**。

### 当前中间状态警告（所有实现切片已停写）

四波实现全部落盘：nb-ui 通用 Grid/sash（波 1-2）、Shell 与 editor 宿主（波 3）、容器模型/存储（波 4）、
宿主与拖动组件（波 5）。**产品页面 `app/pages/index.vue` 仍按旧容器 API 写，处于未接线状态、不可当作可运行产品**
（`viewPlacements.selectView` / `handleSelectView` / `WorkbenchViewHost` 旧 props / 单活动 View 模型都已退役）。
必须在第 6 波接线完成后才能跑产品侧验收。

第 6 波接线所需的确切签名（由两波实现者交付）：

- 呈现：`resolveViewPresentation({registry, context, overrides: record.placements, containerOverrides: record.containerPlacements,
  activeContainerByPart: record.activeContainerByPart, titleOf})`；`presentation.part(partId): PartContainerPresentation`；
  `presentation.container(id): ContainerViewPresentation | null`（切片含 `moveTargets` / `containerMoveTargets`，**无** `activeViewId`）。
- 会话入口：`moveContainer(request)`、`moveView(request)`、`selectContainer(partId, containerId)`、`restoreViewPlacement(viewId)`、
  `restoreContainerPlacement(containerId)`、`setViewSizes({containerId, contextKey, patches})`、
  `setPartVisibility({partId, hidden?, dragCollapsed?})`、`revealView(viewId)`、既有 `setPanelState`；`contextKey()` 是方法。
- 拖动：`useWorkbenchDrag`（类型常量与落点 id 工厂见其 `.md`）；页面 `drag-end` 路由
  `workbench-view` → `moveView`、`workbench-container` → `moveContainer`；载荷在拖动开始时冻结。
- 组件：`WorkbenchPartHost`（Part 头/落点/容器挂载目标）、`WorkbenchContainerInstances`（常驻 parking + Teleport）、
  `WorkbenchViewHost`（容器内部竖向 Grid，props 含 `presentation`/`viewSizes`/`contextKey`/`actionsByView`/`allowViewMove`）、
  `WorkbenchViewSection`、`WorkbenchContainerTab`；容器动作 scope 走 `view-title-actions.ts` 的 `{scope:"container"}` 分支。
- Lab：`WorkbenchShellLayoutFixture.vue` 要补 `PlacementCatalog.containerDefaults`、把 `place-view`/`select-view`
  改成 `move-view`/`select-container`/`move-container`；`WorkbenchViewHostFixture.vue` 要适配新 props 与可空切片。

## 容器重构批准增量（2026-09-20）

- 顺序：规范→纯solver修复→共享测量/宿主/落点→hover/cursor；独立状态链为双轴记录→merge/reopen/CAS→容器模式与驻留→统一DnD/页面→Lab/证据收口。
- 取代历史全部vertical、single独立标题、pointer24px跳记忆、内容drop仅搬容器的合同。保留二维原语、稳定实例、单一写者、原件与业务数据。
- 本轮只实施本地可逆变更；不commit/push/远端写入，不重启3001，不创建真实Project/文档，不迁移，不运行真实Provider。构建仅 `NODE_ENV=production bun run nuxt:build:raw`。
- 验收：状态/原语聚焦回归、类型、raw产物隔离、docs/governance、四主题8组合、DPR1/1.25/1.5/2、390窄屏与260px高、恢复右栏split场景。真实主页数据验收仍待单独授权。
- 当前证据（2026-09-20 执行中）：两份planned Spec、索引与批准提案已更新。已落地并本机实测：
  `packages/nb-ui` 布局 8 文件/171 例、组合式函数 3 文件/17 例；`packages/neuro-book` 工作台聚焦 49 文件/623 例；
  编辑器工作台 13 文件/112 例。含 3px 覆盖线/250ms 显现/文档级临时光标/由内向外的 scope 仲裁、
  `useLayoutExtent`+`useGridLayout`+`grid-drop` 共享层（GridRenderer/Splitter/NestedGridFixture/EditorGroup 已迁移）、
  双轴尺寸记录与 `view-container-layout` 纯映射、外壳新下限（左右栏/Panel 宽 160、Panel 高 80）与内部 View min 64。
- 待办：merge/reopen/抑制与 CAS 回执、容器模式/轴/驻留实例、统一拖放与活动栏、Lab/冒烟迁移、类型/构建/浏览器矩阵。
  `scripts/smoke/workbench-containers.ts::assertCollapseRoundTrip` 仍按旧语义断言「拉回 26px 即回记忆尺寸」，
  绝对跟随合同下需在壬中改写（先断 `data-shell-layout="split"`，再按绝对跟随采样）。

## 容器重构执行增量（2026-09-20 第二轮）

- **统一拖放层落地**：`useWorkbenchDrag` 载荷带 `location` / `contextKey`（容器源另带完整 `viewIds` 快照）；落点词汇改为
  `workbench-switcher-target`（`switcherScope` 区分同一 Part 的头部与活动栏）与
  `workbench-container-content-target`（每容器一个，插入位由内容盒 + 可见叶 client rect 求值）。
  逐 Section 的 `/before/<viewId>`、`/end`、`/empty` 落点与 `useWorkbenchDrag` 里全部旧 id 工厂已删除。
  新增 `app/composables/useWorkbenchDrop.ts`（几何登记 + resolver 调用 + 指针/键盘坐标 + 提交端口）与
  `app/components/workbench/WorkbenchDropOverlay.vue`（预览线与条目高亮，`pointer-events:none`）。
  页面与 Lab 都改成 `useWorkbenchDrop` 接线，`PointerSensor.configure(...)` 与 `handleViewDropEnd` 的重复实现删除。
- **产品接线补齐**：`index.vue` 的实例层/三个 Part 宿主接上 `actionsContextKey` / `actionsByView` / `viewActionsLabel` /
  `moveViewLabel` / `allowContainerMove`，`context-key` 统一取 `viewPlacements.contextKey()`，命令端口补
  `mergeContainer` / `reopenContainer`。`WorkbenchPartHost` 的 `contextKey` 先按死属性删除、随后按容器拖动载荷的真实需要恢复。
- **标签与动作**：容器切片新增 `canMoveContainer`；容器标题/图标改为**跟随生效顺序第一个可见 View**（空容器才回落 descriptor），
  Activity Bar、标签带、左栏标题因此同名同图。
- **本轮实测证据**：
  - `packages/nb-ui`：`bun run test` → 28 文件 / 471 例通过。
  - `packages/nb-ui` 浏览器验收（隔离 playground 3100）：`e2e/nested-grid.spec.ts` + `e2e/splitter.spec.ts` → **30 例全通过**（含 4 主题组合 × desktop/390×844、DPR 场景外的键盘与拖动）。
    为让窄画布仍有可拖空间，`SplitterFixture` 的最小尺寸改为 80/110/80（合计 270 + 8 接缝 < 390 画布），默认尺寸与上限不变；
    `e2e/splitter.spec.ts:51` 的 strict-mode 定位错误改为 `sash.first()`。
  - `packages/neuro-book`：`bun x vue-tsc --noEmit` → 工作台相关 0 错误（另有一个**非本轮**的未跟踪文件
    `app/component-lab/fixtures/AgentSidebarViewFixture.test.ts` 自身类型错误，见下）。
  - `bun run test -- app/components/workbench app/utils/workbench app/component-lab` → 51 文件 / 690 例通过。
  - Lab 真机手动验证（`/lab` + WorkbenchShellLayout）：Panel 收起→Enter 恢复记忆尺寸 ✓、右栏收起→Enter 恢复 ✓、
    状态栏「显示面板」恢复 ✓、左栏只有可拖标题不再画标签条 ✓。
- **仍未完成（下一轮直 接接手）**：
  1. `scripts/smoke/workbench-containers.ts` 的**中段**仍按旧模型断言：Panel 容器现在是**左右排**（旧断言要求纵向堆叠）、
     右栏始终是标签带（旧断言要求单容器标题形态）、容器拖进内容＝整组并入且**源容器消失**（旧断言去点「搬空后的空态落点」）、
     落点选择器仍是 `workbench-part-target` / `workbench-view-target`（已不存在）。
  2. §⑦ 探针在**长序列**中 Enter/拉回读数为 0（单独复现全部正常）——需要把探针改成先断 `document.activeElement` 与
     `data-shell-layout`、并逐帧记录 `dragCollapsedParts` 的 mid-flight 状态，才能区分是 shell 的 drag-collapse 意图
     还是脚本残留状态。
  3. 主题矩阵（4 主题 × light/dark）、DPR 1/1.25/1.5/2、260px 高场景、容器两源×两目标的 Lab 走查尚未在本轮模型上跑。
- **外部阻塞/旁路**：`app/component-lab/fixtures/AgentSidebarViewFixture.test.ts` 是**未跟踪**文件（非本轮改动），
  自身类型错误使 `vue-tsc` 无法全绿；未触碰，收口时需由它的作者修好或删除。

### 第三轮补充（同日）

- **活动栏成为主侧栏真正的切换器**：新增 `WorkbenchActivityContainerEntry.vue`（容器条目＝拖动源＋切换器落点）
  与 `WorkbenchActivitySwitcherBand.vue`（主入口组落点＋`…:activity` 作用域几何，零 DOM 包装）。
  `WorkbenchActivityBar` 新增 `containers` / `allowContainerMove` / `allowViewMove` / `contextKey`，**只有显式开启拖放时才实例化 dnd 子组件**
  （无 `DragDropProvider` 的普通用法与组件测试不受影响）。产品 `NovelIdeActivityBar` 的 `WorkbenchActivityContainer` 增加
  `location` / `partId` / `viewIds` / `canMoveContainer`，页面与 Lab 都按同形传。
- **实测（本轮）**：`bun x vue-tsc --noEmit` 工作台相关 0 错误；`bun run test -- app/components/workbench app/component-lab app/utils/workbench app/components/novel-ide/NovelIdeActivityBar.test.ts`
  → **52 文件 / 694 例通过**；`docs:check` 与 `governance:check` → `failures: []`。
  （两份 Spec 的 `实现合同` / `证据` 章节从 `###` 提升为 `##`，检查器只认二级标题。）
- **Lab 冒烟当前状态**：场景选择（下拉/分段两种形态）已修好；容器单选、容器内多 View、整容器跨 Part 移动等中段已按新模型更新；
  `containerEntry()` 现在覆盖标签带、左栏标题与活动栏条目三种形态。
  仍在收口的三处：① 阶段⑤「View 换序与跨容器移动」的第一步定位超时（reset 之后的目标可见性）；
  ② §⑦ 探针在长序列里 Enter/拉回读 0（单独复现全部正常，需按帧记录 `activeElement` 与 `dragCollapsedParts`）；
  ③ 长序列里状态栏「显示面板」未恢复（单跑该路径正常）。
- **非本轮**：`app/component-lab/fixtures/AgentSidebarViewFixture.test.ts`（未跟踪）自身类型错误；
  `app/components/novel-ide/project-image-experience.contract.test.ts` 读取不存在的 `AgentAttachmentCard.vue`（他人进行中改动）。

### 第四轮补充（同日，冒烟迁移推进）

- 已修：场景选择（下拉/分段两形态，`FormSelect` 选项补 `data-value` 钩子与 `SegmentedControl` 对齐）、
  主侧栏容器切换走活动栏、`containerEntry()` 覆盖三种条目形态、Panel 容器内 View 左右排、右栏始终标签带、
  活动栏容器条目成为真正的拖动源与落点（新增 `WorkbenchActivityContainerEntry` / `WorkbenchActivitySwitcherBand`，
  普通活动栏用法不实例化 dnd 钩子）、Part 头补 `data-part-switcher` 稳定标记、
  single 容器没有 View 标题这条新语义（搬空改为「整容器拖到目标 Part 的切换器」）。
- 冒烟中段现在的状态：容器单选 / 容器内多 View / 整容器跨 Part 移动 / **跨容器 View 移动**都已按新模型走通。
- 剩余失败集中在一处**长序列状态**问题（单跑各路径都正常）：
  1. `workbench-shell.ts` 的「隐藏面板 → 状态栏显示面板」在序列中未恢复（隔离复现：正常）；
     它连带导致后续「最大化面板」「面板位置菜单」等断言因标题动作不可见而失败。
  2. `workbench-containers.ts` 阶段⑤「左栏还有一个容器时不该显示空态：1」——左栏活动容器被搬走后
     空态标记为 1，需要确认是「Part 选择未回退到剩余第一项」还是「空态块在 DOM 里常驻」。
  3. §⑦ 探针 Enter/拉回读 0（隔离复现全部正常）。
  三条共同点：**长序列里 Part 头 / 状态栏的「焦点 + Enter」路径失效**，怀疑同一环境原因（例如先前阶段留下的
  隐藏/收起状态或菜单焦点陷阱）；需要按帧记录 `data-shell-layout`、`hiddenParts`、`activeElement` 与菜单打开状态。

### 第五轮补充（同日，冒烟收口证据）

- 已修：面板恢复断言改成**等事实**（`waitForGeometry`，壳的恢复是「命令 → 记录 → 重排」异步链）；
  空 Part 步骤的前提在新序列下已失效（上一步已把活动容器整组搬走），改为「把剩下的容器也搬走 → 断言空态可接收」。
- 浏览器直接复现（隔离、真实指针/菜单）：整容器「菜单移动」与「拖到目标 Part 切换器」两条路径**都正确**——
  源 Part 选择回退到剩余第一项（`lab.container.left-b`）、空态不出现、目标 Part 收到容器。
- 仍失败的两处，附最新原始证据：
  1. `workbench-shell.ts` 状态栏恢复：点击后 2s 面板叶仍为 `null`，几何 `mode=split`、`left=260`、`editor=491`、
     `overflow=0`，诊断里留着上一阶段 Escape 取消的 `手势被取消：escape`（说明该字符串是**陈旧诊断**，不是本次原因）。
     隔离路径（控制条隐藏 + 状态栏恢复、菜单隐藏 + 状态栏恢复）两次都正常 → 需要在序列里逐帧记录
     `panel.hidden`/`hiddenParts`/菜单打开状态与状态栏条目的 `clickable`。
  2. §⑦ 探针在序列里 Enter/拉回读 0（隔离复现正常），与 (1) 同属「序列态」问题。
- 空 Part 步骤最新读数：`part=无 mount=无 parking size=0x0` —— 容器既不在任何 Part，也不在 parking，
  需要确认是「被抑制」还是实例层丢失（这条是新信息，优先级高于上面的序列问题）。

### 第六轮补充（同日，落点复核）

**已修（真实缺陷）**：空 Part 的空位曾经声明 `switcherScope = "<part>:head/empty"`，而几何只登记在 `"<part>:head"` 上
→ 判定层查不到几何、整条被拒。现在空位**复用头部的切换器作用域**（几何只登记一份，空态只是同一作用域的另一个可落区域）。

**浏览器隔离复核（真实指针）**：
- 容器标签拖动**正常**：把 `lab.container.panel` 从面板标签带拖到右栏切换器，overlay 显示 `move-container`，
  右栏标签带真的多出该容器、面板标签带少一个 ✓。
- 整容器菜单移动、整容器拖到目标 Part 切换器**正常**：源 Part 选择回退到剩余第一项、不出现空态 ✓。
- **仍不成立**：把容器拖到**空 Part 的空位**上——overlay 不出现、没有 notice、容器不动。
  已知：目标元素存在（`[data-workbench-part-empty]`，带 `ref="emptyRef"`、`allow-container-move=true`），
  判定层没有给出拒绝诊断 ⇒ 更可能是该 droppable 未被命中（元素/绑定或碰撞检测），
  下一轮先用 `data-*` 探针确认 emptyRef 的 droppable 是否登记、以及命中集合里有没有它。

#### 第六轮追加（空位落点仍未命中）

- 已落地两处修复：① 空位落点复用头部作用域（原来声明了没有几何的 `…/empty` 作用域）；
  ② 空态块改为**常驻 DOM**（`v-show`）——它原来 `v-if` 晚挂载，dnd-kit 不会为晚绑的 ref 登记元素；
  ③ 落点在「本 Part 有容器」时显式 `disabled`（不可见的空位不该被命中）。
- 期间发现并修掉自己引入的一个运行期错误：`disabled` 里写成 `presentation.value`（prop 不是 ref），
  会让整个 Part 宿主渲染失败——浏览器复核时表现为骨架整棵不在 DOM 里。
- **结论仍未变**：把容器拖到空 Part 的**空位**上依旧不出现 overlay（判定层没有任何拒绝诊断 ⇒ 命中集合里没有它），
  而拖到同一 Part 的**头部**完全正常（overlay `move-container`、容器真的搬过去了）。
  下一步：在 PartHost 里给空位落点加临时 `data-*` 探针（登记 id / disabled / element 是否非空），
  并在拖拽时打印 dnd-kit 的命中集合，确认是「落点没登记」还是「登记了但没被命中」。

#### 第七轮（空位落点收口 + Enter 卡点定位）

- **空 Part 接收容器：通过**。做法是**只保留一个落点**——Part 头部（空 Part 时它就是空态说明所在的那条），
  空态块退回纯视觉元素（实测单独绑在它上面的落点不可命中，且同一作用域不该有两份 authority）。
  同步更新了 `WorkbenchPartHost.md`、组件用例与冒烟目标；冒烟里「空 Part 的空态应当能接收容器」与
  「还有一个容器时不该显示空态」两条已消失。
- **Enter 卡点定位（仍未解）**：Lab 装了 capture 阶段的 `window` keydown → 工作台键位派发器
  （`LabShell.handleWorkbenchKeydown` → `createKeymapDispatcher`），但它只对 `Mod+Shift+P` 有绑定，命中时会
  `preventDefault + stopImmediatePropagation`；已确认**不是**它吞掉 Enter。
  现有证据链：`左栏：Enter 之前 {"focused":"body:0","mode":"split","leafState":"collapsed","mount":"0x618","sash":"414@1"}`
  —— 焦点在分隔线上、叶确实收起、模式 split，按 Enter 却既没有保存也没有展开；同一操作在**隔离场景**下正常。
  同时刻壳的诊断里留着上一阶段 Escape 取消的 `手势被取消：escape`。
  ⇒ 最可能的方向：**上一场手势（大位移拖动结束在窗口外 / Escape 取消）没有把会话清干净，键盘手势被会话闸门忽略**。
  下一步：在 `useSashGesture` 的键盘入口打印当前会话状态（是否有未结束会话、baseline 是否过期），
  并用「先 Escape 取消一场手势，再 focus + Enter」的最小序列在 Lab 里复现。

#### 第八轮（构建与产物隔离）

- `NODE_ENV=production bun run nuxt:build:raw` → `Build complete!`（133s）。
- 产物隔离扫描：`.nuxt/product-raw/public` 共 100 个 JS 文件，负向标记全部为 0
  （`WorkbenchShellLayoutFixture` / `WorkbenchViewDragHandleFixture` / `NestedGridFixture` /
  `data-workbench-skeleton-fixture` / `nbook.view.lab` / `tmp-shell-feedback` / `WorkbenchSpike` / `"/lab"`），
  正向对照全部命中（`workbench-switcher-target` / `workbench-container-content-target` / `workbench-container-tab` /
  `data-sash` / `WorkbenchContainerInstances` / `WorkbenchDropOverlay`）——说明扫描不是空集造成的假绿。
- 收口时的回归：`app/components/workbench + app/component-lab + app/utils/workbench + 活动栏` →
  **52 文件 / 695 例通过**；`vue-tsc` 工作台相关 0 错误；`docs:check` 与 `governance:check` 全绿。

#### 第九轮（Enter 卡点缩到两行代码）

读 `packages/nb-ui/src/composables/useSashGesture.ts` 得到精确闸门：

- `keydown()`（450-495）在按 Enter 时先 `keyboardSession(registration, "enter")`；
- `keyboardSession()`（503-517）在 **`binding !== null`（已有一场会话）且它不是同一模式** 时**直接返回 null**，
  也就是「已有一场指针拖动时键盘一律不介入」；
- `begin(...)` 失败（几何/基线不可用）时同样返回 null → Enter 无提示地什么都不做；
- `keyup()`（520-530）只在「当前会话是键盘且模式匹配」时才 `finish()`。

已排除的假设（都做了真实浏览器复现，均正常）：Escape 取消后再 Enter、Escape 取消后再拖到零再 Enter、
隔离场景下的整容器菜单/拖动、Lab 的全局键位派发器（只有 `Mod+Shift+P` 有绑定）。

⇒ 下一步只需在 `keyboardSession()` 的 `binding !== null` 分支加一条临时诊断（谁还开着、什么 source、什么模式），
在 Lab 里跑冒烟序列即可定位是「指针会话没收尾」还是「`begin()` 拒绝」；这两条分别对应
`useSashGesture` 的 `finish()`/`cancel()` 时机与 `begin()` 的几何校验。

#### 第十轮（独立复核：拖放层四项发现与处置）

独立复核代理 `DropLayerReview`（25m59s，`agent://DropLayerReview`）对容器/落点层给出四项发现，全部复核并处置：

1. **P0（已修，真实缺陷）**：`app/composables/useWorkbenchDrag.ts` 的 `captured` 从不清空
   （"captured 从不清空 … 第二场及以后拖动在 drag-start 就冻结上一场的载荷"）。dnd-kit 的 `dragstart`
   在 pointerdown 的同一拍同步派发，而 Vue `watch` 的回调要等一个微任务，于是第二场拖动拿到的是**上一场的载荷**。
   现在 `resetSuppression()` 在 pointerdown 里同步 `captured.value = input.payload()`，拖放结束时清回 `null`
   （click 抑制标记仍保留到被消费为止）。
2. **P2（已修，真实缺陷）**："resolveViewPresentation 没有接抑制信息，被并入的源容器仍出现在切换器/活动栏/移动到菜单"。
   `ViewPresentationOptions` 新增 `suppressedContainers`，`resolveViewPresentation` 用
   `readViewPlacements` + `readEffectiveContainerPlacements` 两份读投影：**导航与落点**消费 effective（受抑制的源容器
   不出现在任何 Part 切片、`container()` 返回 `null`、`viewTargets` 里也没有它），**实例层**继续从
   `residentContainers`（全量读投影）泊车。写者（`view-placements-session.ts:424` 早已用 effective）与预览/提交现在是同一口径，
   判定层那几句「已被并入别处」的拒绝不再是「预览能提交、写者拒绝」的错配。
   调用点同步：`pages/index.vue:445`、两个 Lab 夹具（`WorkbenchShellLayoutFixture.vue:594`、`WorkbenchViewHostFixture.vue:205`）。
   新增用例 `product-catalog.test.ts`「被抑制的源容器不进导航与落点，但仍留在 resident 里泊车」。
3. **P2（已修）**：落点 `disabled` 把"允许移动容器"和"允许移动视图"两个按源类型声明的门压成一个总开关
   （"落点 disabled 把两个按源类型声明的门压成一个总开关"），而 `accept` 同时列了两种类型 ⇒ 只允许一种的落点在
   另一种拖动里会被整体禁用。现在 `accept` 是两个标志各自算出来的谓词，`disabled` 只在两者都不允许时为真
   （`WorkbenchViewHost` / `WorkbenchPartHost` / `WorkbenchContainerTab` / `WorkbenchActivityContainerEntry` /
   `WorkbenchActivitySwitcherBand`）。
4. **P3（已删）**：`useWorkbenchDrag.ts` 的三个无消费者遗留导出 `WorkbenchDragSourceInfo`、`workbenchDragPayloadField`、
   `workbenchAcceptPredicate` 已删除（`accept` 谓词仍按需包一层 getter：裸函数会被 dnd-kit 的 `toValue` 当场调用）。

#### 第十一轮（§⑦ 收口：三条根因都在量具/环境，不在产品）

容器套件的 §⑦ 探针此前在序列里失败、单跑却"正常"，第九轮把它归到「上一场手势没收尾 ⇒ 键盘被会话闸门忽略」。
逐条查证后，**三条根因全部与产品无关**，产品行为本身一直是合同要求的那个：

1. **Enter 无反应＝量具抢走了焦点。** `restEvents()` 会去点右侧检查器的「事件」tab（真实鼠标点击），
   焦点因此落到 tab 上；而 `keydown` 只绑在分隔线元素上（`packages/nb-ui/src/components/layout/Splitter.vue:495`），
   紧接着的 `page.keyboard.press("Enter")` 打在 tab 上，分隔线那条键盘路径**根本收不到这次按键**。
   在 `useSashGesture.keydown` 顶部加临时探针（记录 key/target/registered/disabled/binding）后，改顺序的第一次运行
   就拿到 `{"key":"body:0","target":"body:0","registered":true,"disabled":false,"binding":false}`，且 Enter 真的保存并回到记忆尺寸
   ⇒ 第九轮怀疑的"会话闸门"**排除**。修法：**先读事件数 → 再把焦点交给分隔线 → 最后按 Enter**。
   历史记录里那行 `focused:"body:0"` 之所以看着正确，是因为 mark 打印在 `restEvents()` **之前**。
2. **绝对位移差 12px / 32px＝量错了元素。** 探针原来读 Part 里的**容器挂载点**（`[data-container-mount]`），
   它在 Part 叶里还有一圈内边距（左右各 6、面板上下各 16）：差值断言（"拖大 90px"）看不出来，
   绝对断言就恰好差这一圈（240 → 228、160 → 128）。现在尺寸统一读 **Part 叶**（`data-leaf`，与 `readGeometry` 同源）；
   "收起到零不占尺寸"读 **内容**（挂载点）——叶在收起时仍留 1px 边界与命中带（读数 12px），那是边界不是内容。
3. **右栏探针把 Lab 画布拖宽了＝Lab 外框手柄压住分隔线。** `.nb-lab-stage-handle` 的东侧缩放柄贴着画布右缘，
   正好盖住骨架右栏那条 1px 分隔线：指针按下被手柄接走 ⇒「分隔线没反应」**并且画布宽度被改成 1277px**
   （＝松手点 − 画布左缘，与实测吻合），之后每一格的几何都跟着变（`编辑区尺寸应可解释：146 → 909` 就是这么来的）。
   现在 §⑦ 开始时 `muteStageHandles()`（只停 Lab 外框自己的手柄，不加任何产品侧开关），量完 `restoreStageHandles()`。

**判据留在冒烟里**：新增 `requireSashAt()` 用 `elementFromPoint` 确认按下点真的落在这条分隔线上，
命中别的元素就把实际元素写进失败原因——1px 分隔线的中心要**向下**取整，向上取整会自己造出假命中
（第一版守卫就是这么误报的，修掉后 5 条误报同时消失）。
#### 第十二轮（最终验证矩阵与交付边界）

- `bun x vitest run app/utils/workbench/product-catalog.test.ts app/utils/workbench/view-placements-session.test.ts app/composables/useWorkbenchDrag.test.ts` → **3 文件 / 73 例通过**。
- Node + Playwright 真实浏览器 `--suite workbench-shell`（1600×1300，3001 隔离服务）→ **passed**；覆盖外壳、容器、View/容器拖放、原子并入、空 Part、两轴手势、拖到零/Enter/拉回/Escape。最终一轮耗时 127.29s。
- Node + Playwright `--suite core` → **passed**，耗时 25.03s。
- 主题/配色矩阵：`nbook`、`macos`、`editorial`、`aurora` × `nbook-light`/`nbook-dark`，每组合跑完整 `workbench-shell` 与 390×844 窄画布 / 260px 短画布几何检查；**8 个完整组合 + 8 个画布组合全部通过**，窄画布均 `mode=compact`、`overflow=0`，短画布均无横向溢出。
- DPR 矩阵：`1`、`1.25`、`1.5`、`2`，默认主题深色配色下各跑完整 `workbench-shell`；**4 个组合全部通过**，完整组合 console error 均为空。矩阵 runner 最终摘要 `failed: 0`。
- `NODE_ENV=production bun run nuxt:build:raw` → **Build complete!**，耗时 178.50s；仍遵守不运行 `bun run nuxt:build`。
- `bun run docs:check` → `failures: []`（6216 文件）；`bun run governance:check` → `failures: []`、`warnings: []`。
- `bun x vue-tsc --noEmit -p tsconfig.json`：本轮工作台/产品目录改动无新增错误；剩余为无关的未跟踪 `app/component-lab/fixtures/AgentSidebarViewFixture.test.ts` 类型错误与既有 `AgentChatFlow.vue(70,22): Cannot find name 'AgentSessionSummaryDto'`。

**边界仍保持明确**：未做真实主页面 Project/文档创建、真实数据迁移、远端写入、commit/push/PR/merge/deploy；3001 服务未重启。上述矩阵只证明隔离 Component Lab 与纯逻辑/产品构建行为，不替代真实主页面数据验收授权。
#### 第十三轮（accept 修正后的最终收口）

- 第十二轮矩阵之后，聚焦复核发现 `WorkbenchViewHost` 内容落点的两个源类型映射写反：`allowViewMove` 曾错误接到容器源，`allowContainerMove` 曾错误接到 View 源。已在 `app/components/workbench/WorkbenchViewHost.vue:273-276` 修正，并让测试夹具显式传入两种权限。
- 为此补充单源权限回归：`WorkbenchViewHost.test.ts` 与 `WorkbenchPartHost.test.ts` 覆盖只开 View、只开容器时各自接受/拒绝另一种源；落点组件聚焦测试 **2 文件 / 37 例通过**。
- 修正后的完整工作台聚焦套件：**52 文件 / 698 例通过**。
- 独立 `DropLayerReview` 追加复核：**无阻断项**。确认同步冻结/结束清空拖动载荷、五类落点按源类型门控、空态不注册第二落点、抑制容器的 effective/resident 投影与调用点均已接通。非阻断观察为活动栏 band 的父级非空前提、`memberRects()` 的全局查询，以及 resolver 只校验源侧、目标权限由 `accept` 承担。
- 第十二轮真实浏览器矩阵发生在上述 accept 修正之前；修正后尝试重跑时 `http://localhost:3001` 返回 `ERR_CONNECTION_REFUSED`，现有服务已退出。按约束未重启或修改 3001，因此不能把修正后的浏览器重跑称为通过。历史矩阵仍保留为修正前的 Lab 几何/交互证据；本轮修正由 52 文件 / 698 例测试、raw 构建和静态复核覆盖。
- 修正后 `NODE_ENV=production bun run nuxt:build:raw` → **Build complete!**（166.96s）；`vue-tsc` 输出仍仅为既有无关 `AgentSidebarViewFixture.test.ts` 与 `AgentChatFlow.vue` 错误；`docs:check` → `failures: []`（6214 文件）。

**独立复核未验证边界**：未启动服务、未重新执行浏览器 DOM/指针、DPR 与窄屏矩阵；未做真实主页面 Project/文档创建、数据迁移、远端写入、commit/push/PR/merge/deploy。
#### 第十四轮（修正后浏览器矩阵与量具收口）

- 修正后的真实浏览器 `--suite workbench-shell` → **passed**，耗时 132.48s；`--suite core` → **passed**，耗时 14.66s。运行时访问 3001 `/lab`，未触碰真实 Project/文档状态。
- 修正后的主题/配色矩阵：`nbook`、`macos`、`editorial`、`aurora` × `nbook-light`/`nbook-dark`，8 个完整 `workbench-shell` + 8 个 `390×844` 窄 / `short` 260px 高画布检查，**16/16 通过**；全部窄画布 `mode=compact`、`overflow=0`，短画布无横向溢出。
- 修正后的 DPR 矩阵：`1`、`1.25`、`1.5`、`2`，各运行完整 `workbench-shell`，**4/4 通过**，console errors 为空；矩阵最终 `failed: 0`。
- 矩阵中发现并修正一次性验收量具问题：事件面板读取由坐标点击改为 Tab 语义点击，并等待事件/文档的 `aria-selected` 与面板可见，避免 macOS 深色主题动画及长序列状态下读到旧页。定向复现 `macos+nbook-dark`、DPR `1.25` 随后均通过，最终矩阵全绿。该修正位于 `scripts/smoke/workbench-lab.ts:eventLog`，不改变产品逻辑。
- 当前版本完整聚焦测试维持 **52 文件 / 698 例通过**；独立 `DropLayerReview` 追加复核**无阻断项**，确认 `WorkbenchViewHost` 映射、五类落点门控、拖动载荷清空/冻结、effective/resident 抑制投影均正确。矩阵一次性 runner、诊断脚本与输出已清理。

**最终边界**：未做真实主页面 Project/文档创建、数据迁移、远端写入、commit/push/PR/merge/deploy；3001 只被读取和浏览器验收访问，未由本任务重启。

#### 第十五轮（开发者反馈：拖动没有指示 —— 两个真实缺陷与回归判据）

开发者实测：「移动视图没有指示，没有类似 grid sash 分屏的那种指示」「移动视图似乎位置不对，而且高度为 0」。
逐条在 Lab 里复现后确认是**两个彼此独立的真实缺陷**，都在产品侧（Lab 与主页面共用同一套 composable 与覆盖层）：

1. **同容器拖动整场没有预览**：`useWorkbenchDrop` 只接 `dragover`，而 dnd-kit 的 `DragActions.setDropTarget`
   在 `targetIdentifier` 未变化时直接返回，`dragover` 因此只在**命中目标变化**时派发——同容器内拖动时命中目标
   从头到尾是同一个内容落点，整场一次都不派发 ⇒ 预览恒为 `null`；`dragEnd` 仍按最终坐标算一次并提交，
   表现就是「松手真的换了序，但拖动过程没有任何指示」。修法：`handlers` 新增逐帧的 `onDragMove`（走同一个
   resolver），`pages/index.vue` 与 Lab 夹具同时绑定 `@drag-move`。用临时探针写入 DOM 取证：
   修复前一场同容器拖动只有一条 `end` 记录、`lastOver: null`。
2. **指示线画在别处**：`WorkbenchDropOverlay` 用 `position: fixed; inset: 0` 配 viewport 坐标，而 Lab 舞台底座
   `.nb-lab-stage-box` 带 `backdrop-filter: blur(8px) saturate(1.6) brightness(0.62)`——按规范它是 fixed 后代的
   包含块：覆盖层被压成 900×728、原点挪到 (350,30)，`style.left: 634px` 实际画在 `x=984`，差值恰好一个水平偏移。
   修法：覆盖层 `Teleport to="body"`，与 `getBoundingClientRect` 的几何同源。
3. **回归判据落在冒烟里**：`scripts/smoke/workbench-lab.ts` 新增 `readDropPreview()`（同时读标称 `style` 与浏览器
   `rendered` 两份坐标）与 `dragOnto({sample})` 松手前采样；`workbench-containers.ts` 的同容器换序步骤断言
   「预览存在 + `kind=move-view` + 线非零尺寸 + 两份坐标差 ≤1.5px」。修复前实测同容器 `overlay: null`、
   跨容器标称 634 / 实际 984 ⇒ 两条断言在旧代码上都会红。

- 真实浏览器 `--suite workbench-shell` → **passed**（91.03s，含上述新断言；开发者反馈的同容器换序步骤在内）。
- 聚焦套件（`app/components/workbench app/utils/workbench app/component-lab`）→ **54 文件 / 712 例通过**（44.46s）。
- `bun x vue-tsc --noEmit -p tsconfig.json` → 94 个错误，**全部落在既有 6 个文件**
  （`AgentSystemPromptPanelFixture.test.ts` 30、`AgentLinkedAgentPanelFixture.test.ts` 24、`AgentSidebarViewFixture.test.ts` 20、
  `AgentSessionHeaderFixture.test.ts` 18、`AgentChatFlow.vue` 1、`NovelIdeActivityBarFixture.vue` 1）；
  本轮改动的四个文件与两个冒烟脚本**零命中**。这些既有错误来自并行 Agent 夹具工作，不在本任务范围内。

**本轮边界**：主页当前没有可拖的 View（没有打开的 Project），视图拖动只能在 Lab 复现；未做真实主页面
Project/文档创建、数据迁移、远端写入、commit/push/PR/merge/deploy。3001 只被读取和浏览器验收访问，未由本任务重启。
#### 第十六轮（容器承载与收起断言收口）

- 真实 `--suite workbench-shell` 在保留的 `http://localhost:3001` Lab 服务上通过；覆盖 shell 几何、left/right/Panel 拖到零与拉回、3px sash 装饰带、250ms hover/reduced-motion、容器跨 Part、View 换序/跨容器移动、空 Part 接收和实例保持。
- 首轮四项失败中，侧栏外层 12px 是两侧 6px gutter；smoke 改量 `[data-container-mount]` 内容盒，保留产品外壳留白。整容器失败根因是 Panel header 中心被标题动作区遮挡，真实 DOM 命中规则正确；smoke 改瞄准 header 左侧可接收空白区。
- `WorkbenchContainerInstances` 反注册目标时同步切 parking，登记新目标时同步切挂载点，并由 `nextTick` 做最终校正；旧 Teleport 节点不再留在无 Part 祖先的脱离树上。来源 Part 最后容器移走后的 `activeContainerByPart` 回退与空态 `v-show` 同一呈现切片收敛。
- 验证：`bun run test app/components/workbench app/utils/workbench app/component-lab --run` 为 **55 文件 / 744 例通过**；拖放 resolver/DOM 为 **2 文件 / 53 例通过**；`scripts:typecheck` 仅剩既有 `product-agent-state-root-smoke.ts:318` 的 `colorwayId`/`userColorways` 诊断。
- 边界：未创建 Project/文档，未做主页业务拖动；未 commit、push、PR、merge、发布或部署；3001 未由本轮重启。
#### 收尾复验（最终 Teleport 目标条件）

- 目标合同最终收紧为 `target.isConnected`：未连接的 Part 挂载盒与旧 Teleport 目标立即按 parking 规则收敛；测试 harness 挂到 `document.body`，不再靠放宽产品规则兼容脱离文档的 jsdom 根。
- 最新 `WorkbenchPartHost` / `view-placements` focused 为 **2 文件 / 97 例通过**；最近一次 `app/components/workbench app/utils/workbench` 为 **42 文件 / 678 例通过**。更广的 `app/components/workbench app/utils/workbench app/component-lab` 重跑中 **54/55 文件通过**，仅 `AgentSidebarViewFixture.test.ts` 的既有测试 `挂载 delivery-unknown 与 sessions 场景时不抛出 Invalid Teleport target 警告` 在 15000ms 超时；本轮随后的 42 文件工作台套件与 Teleport/placements 定向套件均通过。
- 最终目标条件下再次运行 Node + Playwright `--suite workbench-shell` → **passed**（111.12s），覆盖整容器 left→panel→right、空 Part 接收、同容器换序、跨容器 View 移动、侧栏/Panel 收起与恢复和 reduced-motion；3001 未重启。
- nb-ui：全量单测 **28 文件 / 490 例通过**，`typecheck` 与 `build:css` 通过。`test:e2e` 未通过：Playwright 配置的 webServer 等待 **120000ms** 后超时，未进入用例执行，不能记为 E2E 通过。
- `NODE_ENV=production bun run nuxt:build:raw` → **Build complete!**；`bun run docs:check` → `failures: []`（6217 files）；`bun run governance:check` → `failures: []`、`warnings: []`。脚本类型检查仍只有既有 `product-agent-state-root-smoke.ts:318` `colorwayId` / `userColorways` 错误；应用 `vue-tsc` 仍有既有 Agent fixture API 类型与 `AgentChatFlow.vue` 错误，未命中本轮 Workbench 改动。
- 独立 reviewer 后台任务超时并取消，未取得可交付审查报告；主审据目标有效性代码检查发现并修正 detached target 接受问题，但不将其表述为独立审查通过。

**最终边界**：没有真实主页面 Project/文档和业务 View 拖动验收；Lab 证据不替代主页验收。未运行四主题/DPR 完整矩阵（本轮既有 workbench-shell 桌面 smoke 含窄画布与 reduced-motion）；未提交、push、PR、合并、发布或部署。


## 2026-09-21 统一拖放反馈与切换器落点增量（初次实施记录）

- 已实施：非空 left 空白/动作区拒绝，当前标题精确接受；非空 Panel/right 只接受 selector；三个零容器 Part 的整个头部只接整容器，正文仅说明。保留 placements/session、常驻空态与唯一 Teleport 实例。
- 新增 nb-ui `DropIndicator` / `DropIndicatorLabel` 纯渲染原语，迁移 Editor 四缘/中心预览、标签前后/两组末尾插线与 Workbench 三种反馈；工作台只缩绘制盒，独立药丸按真实尺寸夹紧，live region 保留全文。
- 浏览器暴露并修复两项身份/事件缺陷：left 活动标题缺少容器 key 导致切回后 dnd registry 按新 id 查不到目标；Editor pinned 组末尾事件冒泡到外层，改写为普通组。分别保留真实 registry/resolver 回归和原生冒泡回归。
- 最新工作台整壳 `--suite workbench-shell` **passed，189.65s**，旧几何/sash/取消场景未跳过；包含源激活、真实命中链、两稳定帧、释放归属、实例保持与精确提交次数。前次 `offset=4` 失败发生于文档写入期间，无文件变更复跑通过；热更新影响属于推断，原失败保留。
- 应用 focused **57文件/810例通过**；其后标题和Editor新增回归 **2文件/29例通过**。最新应用类型 `error TS` 行与基线差异为空；scripts仍只有既有 `product-agent-state-root-smoke.ts:318` 缺 `colorwayId` / `userColorways` 的诊断。
- nb-ui **28文件/490例**、typecheck、CSS build通过；独立playground桌面/390px五场景以及reduce/contrast检查通过。完整E2E首跑49通过/15失败，其中2个服务入口失败后以 `e2e/lab.spec.ts` **19/19通过**；13个全页视觉差异未更新基线、未判作通过。
- 本轮生产 `NODE_ENV=production bun run nuxt:build:raw` **Build complete!，175.21s**，在最终恢复Editor事件穿透class之前执行；最终class改动另有真实浏览器验证。验证针对未提交工作树，没有独立revision；沿用 `refactor/w00003-nb-ui-adoption`，未把共享脏树其它改动算作本轮交付。
- 独立审阅：覆盖层未发现阻断项；原语/Editor审阅发现分屏覆盖层丢失宿主 `pointer-events-none`，已恢复。修复后Editor真实native拖动 **passed，8.53s**：标签前后、pin/两组末尾、左/上/下预览取消、右分屏创建第二组、跨组center移回。最后定向Vitest实际只收集EditorTabBar **1文件/10例通过**，没有收集不存在的EditorGroup测试，不记作2文件。
- **未闭合**：3001完整CSS响应没有 `.nb-ui-drop-indicator`，磁盘dist有；最终公共皮肤、四主题/DPR矩阵仍未验收。未重启/调整3001，未注入CSS绕过。core失败于刷新后未恢复 `390 × 844`，完整nb-ui视觉快照仍有13项差异；无真实主页Project/View验收。
- 滚舞台/窗口resize后Escape与页面卸载清理已有局部证据；按住拖动时键盘打开场景下拉、选择 `container-moved` 后旧overlay清除，**passed，7.81s**。CSS缩放和实际滚动位移的完整矩阵未闭合。390px窗口与260px画布探针均有源不可达记录，没有伪造激活。
- 原始产物保存在系统Temp的 `neuro-book/acceptance/workbench-drag-feedback-1789968348964/`，主要文件与审阅结论见实施记录。未commit、push、PR、合并、部署或创建业务数据。
- 文档与治理检查：`docs:check` 6221文件、failures为空；`governance:check` failures/warnings均为空。仓库无已配置formatter，未安装格式化依赖；范围空白检查与探针清理见实施记录收口。

## 2026-09-21 服务恢复、最新交互修正与手动验收交接

- 最新用户要求覆盖旧计划：非空 left 的当前标题也不再是落点，保留整容器拖动；内容 area 存在时不显示蓝色插线，Switcher 无 area 的换序/空头部仍有位置线。`WorkbenchContainerTab` 的 title accept 为空，`WorkbenchPartHost` 的非空 left 几何为空；Panel/right 与空 Part 原有接收权限保留。
- 用户明确授权启动本工作树3001，服务 `workbench-feedback-3001` 使用应用 `bun run dev`，端口3001；完整CSS响应200、包含 `.nb-ui-drop-indicator`，旧资源阻塞解除。服务保留运行，入口 `http://localhost:3001/lab`。
- 最新完整 `--suite workbench-shell` **exit0，230.01s**：两个来源投标题前后半均零预览/零提交；活动栏、Panel/right标签均真实释放；三个空Part菜单清空回收，以及直接拖空全部Panel容器后搬回；内容双轴换序/并入不画线，事件差值与归属正确；保留旧sash与取消场景。
- 静止指针改尺寸的缺陷已修：活动会话用一个 `ResizeObserver` 观察已登记落点盒，与既有单rAF重算共用调度，结束disconnect。真实回归修复前目标208→228px而反馈仍196px（exit1，7.66s），修复后反馈216px且Escape清理（exit0，7.78s）；同一行为已加入长期smoke。
- 最新聚焦命令实际收集 **5文件/89例通过，23.06s**；列入命令但不存在的 `WorkbenchContainerTab.test.ts` 不计入。应用类型与本轮基线 `error TS` 对照 added/removed 均为空；scripts仍只有既有 `product-agent-state-root-smoke.ts:318` 缺 `colorwayId` / `userColorways` 的错误，未称全量类型通过。
- 最终自动视觉检查：四主题双配色8组合（含Editor对照）通过，81.40s；nbook双配色 × DPR1/1.25/1.5/2共8组合通过（内容两轴、Switcher两轴线、小条目）；合并/仅线/75%明暗两轴/260px短画布共10场景通过，27.99s；390×844窗口内容与entry、短屏entry通过，13.18s。均有真实激活、两帧、可见提示/图标与无残留记录，无console/pageerror。原生复核已看四主题联系表、最终合并及手机area/entry；没有宣称逐张DPR截图人工签核。
- 后续浏览器验收已按开发者要求交其手动进行，不再继续浏览器操作。以上自动结果均在该要求前完成；真实主页仍未验收。原有core尺寸恢复失败（新服务38.46s）、nb-ui 13项全页快照差异和基线类型错误保留，不扩大本轮修改。
- 续验产物：原证据根下 `resume-3001/` 的 `workbench-shell-final.txt`、`stationary-red.json`/`stationary-green.json`、`dynamic.json`、`narrow.json`、`types-delta.json`；最终视觉在 `final-visual/`。原旧CSS与失败量具产物保留。未提交、push、PR、合并、部署或创建真实业务数据。
- 续验收口：两份独立静态审阅均结论correct，无已证明阻断；会话审阅列出RO的4项未验证机制/覆盖边界，未当作新缺陷扩大实现。docs检查6221文件、failures为空，governance failures/warnings为空（38.39s）；31文件范围无空白/冲突问题；7个新增一次性脚本已清理，产物与3001保留。详见实施记录末段。

## 2026-09-21 依赖升级与编辑器选型讨论

- 开发者批准dnd-kit升级，并将交互修复优先范围收敛到EditorWorkbench；编辑器采用dnd-kit还是native仍在讨论，未据此实施迁移。
- 根与主应用的vue/helpers依赖已升级至 `^0.5.0`，七个关联包实际0.5.0；三处旧feedback默认参数移除。主应用冻结安装通过，初次全workspace安装的file合同包ENOENT保留；Bun生成锁文件含类型包重解析，未宣称仅七条锁记录变化。
- 聚焦8文件/130例通过；旧配置镜像测试改为公开激活行为后，该文件6例通过。最终应用类型检查仍exit2、94条诊断，无Workbench、PlotThread、PlotWorkbench、ProfileTemplate或dnd-kit相关错误；未宣称全量类型通过。
- 浏览器验收继续由开发者手动进行，3001未重启。详细修改、失败与证据路径见实施记录末节。

## 2026-09-21 编辑器拖放迁移

- 开发者批准Editor迁移与统一复用：Tab排序、跨组移动、拖动四向分屏由局部dnd-kit会话统一管理；原native手势和全局拖动状态退出，编辑会话/Grid仍是唯一状态权威。
- 公共 `DropFeedbackOverlay`被Editor与Workbench同时消费，统一方框/2px线/提示与生命周期；公共 `resolveListInsertion`规范化同一插入位的坐标。nb-ui Lab既有drop-indicator场景可单独打开覆盖层inspect；独立EditorTabBar夹具与完整EditorWorkbench使用相同Provider。
- 非浏览器检查与手动检查入口见实施记录末节；本轮证据为系统Temp `editor-dnd-migration-1789981993152/`。浏览器验收由开发者执行，未将组件环境检查冒充真实浏览器通过。
