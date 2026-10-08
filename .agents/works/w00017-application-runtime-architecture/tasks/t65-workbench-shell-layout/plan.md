# t65 实施计划：外壳一：外壳与布局

## Context

- **为什么做**：K1–K6 交付了多实例内核、Storage、插件状态 store、公开状态与配置。新应用的 `/` 页仍只是一段“工作台已就绪”文字加命令面板，没有外壳。按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节，外壳分三片：外壳一（外壳与布局，本 Task）、外壳二（容器与视图）、外壳三（拖放），之后是第 6 步 Files。
- **依据**：外壳设计稿第 1、2、6、7、9、10、11 节；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（`planned`，旧应用口径，本 Task 按 v2 修订）、[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 第二批、[`state/store.md`](../../../../../docs/specs/state/store.md)、[`state/public-state.md`](../../../../../docs/specs/state/public-state.md)、[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)。
- **已定的**：外壳设计稿的对象模型、七个 Part、面板四位置 × 四对齐、四种“消失”形态、紧凑呈现、三条布局记录的划分与写入时机、公开状态键与面板命令的 `when`、代码分层（`shell/`、`state/`、`components/`）；开发者 2026-10-08 说明旧应用的外壳（`packages/neuro-book-legacy/app/utils/workbench/`、`app/components/workbench/`）已人工验证，拖放等基础功能较完善，可以参照。
- **推进方式**：按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)：计划交三个 omp 审查后按推荐修订再实施，本该开发者确认的点记入 [待确认清单](../../pending-confirmations.md)。
- **现状**：
  - 新应用：`nbook.workbench` 浏览器入口提供页面表、选择服务、命令面板宿主、主题与显示语言（t64）；`/` 页是 `empty-workbench.ts` 的一段文字，`WorkbenchDocument.vue` 写文档根。
  - nb-ui 的布局原语：`createGrid`、`GridRenderer`、`Splitter`、sash 手势会话（`@notnotype/nb-ui/layout`），旧外壳就建在它上面。
  - 旧应用的外壳几何是纯模块：`app/utils/workbench/layout.ts`（957 行：七个 Part 的树、位置与对齐决定 body 形状、尺寸分配与夹取、紧凑呈现、拖到零、手势结算）、`panel-state.ts`（87 行：取值域与判定），测试 `layout.test.ts`；渲染是 `WorkbenchShellLayout.vue`（483 行：测量、Grid、Teleport 停放、手势结算），面板外观 `WorkbenchPanelSurface.vue`、状态栏 `WorkbenchStatusBar.vue`。旧的保存会话 `layout-session.ts`（1568 行：CAS、外来订阅、旧存储桶）不迁，由插件状态 store 的持久化字段与 `nbook.storage` 承担（设计稿第 10 节）。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交、提交后 push 本分支；测试用真实内核、真实 `nbook.storage`、真实 nb-ui 组件与本机 Chrome，不用 mock、spy、假计时器、固定等待；交付前对验收映射逐条做变异检查；主 Agent 编码，最后三个 omp 只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. Spec：`ui/workbench-shell.md` 按 v2 修订（S0）

按设计稿“对 Spec 与提案的预期改动”：术语与对象模型改为设计稿第 2 节；删去旧产品专属内容（固定入口清单、用户资产工作面、旧存储键、CAS 与外来订阅、`descriptor` 的 `requiredAuthority`/`stateScope`/工厂键）；布局状态一节改为三条记录（第 6 节）与插件状态 store 的持久化字段；验收场景按外壳一、二、三分组重写，编辑器分组与标签的场景移出（随编辑器插件），EditorWorkbench 拖拽行为表整节移出。外壳一的条目写成可判定的行为（下面各节），容器、视图、拖放的条目保留已批准的行为、标明属于外壳二、三。仍是 `planned`，外壳一的条目实现后在原文标注。

`workbench/commands.md`：第二批命令的“随 t50”改为“随外壳一、外壳二”；五条面板命令的 `when` 改写为读工作台公开状态（第 4 节），登记公开状态键；“显示面板”入口归状态栏。

### 2. 外壳几何的纯模型（`packages/neuro-book/src/plugins/workbench/web/shell/`）

- 从旧应用 `layout.ts`、`panel-state.ts` 搬入，按 v2 改 Part 词表：`titlebar`、`activitybar`、`sidebar`、`auxiliarybar`、`editor`、`panel`、`statusbar`（旧名 `activity`、`left`、`right`）。拓扑、尺寸常量、夹取、紧凑呈现（容器宽 < 800）、高度不足时面板退到 32px 标题头、拖到零（保留展开尺寸意图、相邻 1px 边界）、手势结算（`settleShellGesture`：一次手势一批 `GridGestureCommit`，只把主动改变的叶写成补丁，零值不进尺寸）照搬，连同测试。
- 尺寸偏好四项：`sidebarWidth`、`auxiliarybarWidth`、`panelHeight`、`panelWidth`；面板状态：`position`、`alignment`、`hidden`、`collapsed`（落盘）与 `maximized`（只在内存）；Part 状态：`hiddenParts`（`titlebar`、`activitybar`、`sidebar`、`auxiliarybar`）与 `dragCollapsed`（`sidebar`、`auxiliarybar`、`panel`）。
- 纯模块不依赖 Vue、Storage 与 store，`bun test` 直接测。

### 3. 工作台 store 与布局记录（`plugins/workbench/web/state/`）

- **记录**（`defineRecord`，`locality: "local"`，各带版本 1）：
  - `layout-sizes-side`（`sidebarWidth`、`auxiliarybarWidth`）与 `layout-sizes-panel`（`panelHeight`、`panelWidth`）：窗口绑定了项目时用 project 分区，没有绑定时用 user 分区（两份定义，同一 schema）；
  - `views-customizations`：user 分区；本 Task 只放面板状态与 Part 状态两个字段组；外壳二加容器与视图时作为可选字段加入、版本不变（旧记录仍合法，action 用 `commit(current => ({...current, …}))` 只改自己的字段组）。
- **store**（`defineStore("workbench", …)`，setup 写法）：三个 `persist` 字段；内存状态 `maximized`、`compact`（来自布局组件发布的呈现事实）；派生 `effectivePanel`；公开状态（第 4 节）；action：`setPanelPosition`、`setPanelAlignment`、`setPanelHidden`、`setPanelCollapsed`、`togglePanelMaximized`、`setPartHidden`、`commitSizes(patch)`、`commitDragCollapsed(map)`。每个 action 校验后合成一次意图：尺寸只在手势结束提交一次；位置、对齐、隐藏、收起变化时清除瞬时最大化（不落盘）；同值操作不产生写入。
- 读取就绪前显示默认布局、尺寸手势不可用（store 字段的 `ready`）；记录损坏或版本不支持时按 store 的读取分类显示默认并记诊断，原件不被普通保存覆盖；尺寸越界只夹取显示、记诊断、不改写记录。多窗口共用记录：另一窗口保存后只更新已确认值，本窗口的当前显示不被强改（store 的 base 与 display 分开，`state/store.md` 输出 5–11）。
- 工作台浏览器入口增加依赖 `storageKey`、`publicStateKey`（store 的 `publish` 要的）；store 随入口代次创建与释放。

### 4. 公开状态与面板命令（`plugins/workbench/web/`）

- 公开键（`definePublicState("nbook.workbench", …)`，写在工作台描述旁的定义里、入口贡献 `state.public`）：布尔 `layoutReady`、`nonCompact`、`panelHorizontal`、`panelMaximizable`、`panelVisible`、`panelMaximized`（未就绪均为 `false`）；字符串 `panelPosition`（`bottom`）、`panelAlignment`（`center`）。`focusedPart` 推迟到外壳二（要追踪焦点所在 Part，没有消费者）。
- 五条命令由工作台贡献给 `commands.definitions`，参数严格、`effect: "write"`、Agent 暴露 `never`（与 `commands.md` 第二批一致），`when.requires` 按设计稿第 7 节的表：
  - `nbook.view.set-panel-position` `{position}`：`layoutReady`、`nonCompact`；
  - `nbook.view.set-panel-alignment` `{alignment}`：`panelHorizontal`、`nonCompact`；
  - `nbook.view.set-panel-hidden` `{hidden}`：`layoutReady`；
  - `nbook.view.set-panel-collapsed` `{collapsed}`：`panelHorizontal`；
  - `nbook.view.toggle-panel-maximized` `{}`：`panelMaximizable`、`nonCompact`。
- 命令实现调 store 的 action；面板标题头的框架按钮也经这五条命令执行（同一入口）。

### 5. 外壳组件（`plugins/workbench/web/components/`，同名 `.md` 先写）

- `WorkbenchShellLayout.vue`：从旧应用搬入的纯布局组件。只接受尺寸、面板状态、隐藏与拖到零、`contextKey`，测量容器、建 Grid、`GridRenderer` 渲染、手势结束发一次 `resize` 补丁、发布呈现事实（模式、生效的面板状态、诊断）；七个 Part 的插槽内容由稳定宿主渲染再 Teleport 到叶落点，隐藏与最大化时停放（`hidden inert`），结构变化不卸载编辑区。
- `WorkbenchShell.vue`：产品外壳，持有工作台 store，把它接到 `WorkbenchShellLayout`；七个 Part 的内容：
  - 标题栏：应用名与当前项目短名（没有菜单与搜索：未实现的不以可操作的假入口呈现）；
  - 活动栏：通高列，本 Task 没有容器（外壳二加 Switcher），只保留列与底部区域；
  - 侧栏与右栏：外壳二之前没有视图，显示空状态说明；
  - 编辑器：稳定内容槽，现在放原首页的欢迎文字（语言跟随配置）；最大化时停放不卸载；
  - 面板：`WorkbenchPanelSurface.vue`，32px 标题头带位置、对齐、收起、最大化、隐藏的框架按钮（经命令执行），内容区空状态；
  - 状态栏：`WorkbenchStatusBar.vue`，22px，显示项目名或“未打开项目”、面板显隐按钮（“显示面板”同时清除隐藏与收起）；不显示假数据。
- 页面：`/` 页由 `createEmptyWorkbench` 换成外壳（`WorkbenchDocument` 与命令宿主照旧挂在页面上）；外壳根、Part 与面板消费 nb-ui token（主题已由 t64 应用）。
- 不渲染双重边框、标题条或标签条；390 px 下无页面级横向滚动。

### 6. Lab 场景（`plugins/lab/web/fixtures/`）

- `WorkbenchShellLayout` 的 Lab 场景：局部状态（不连产品 store 与 Storage），可切面板位置与对齐、隐藏、收起、最大化、拖到零，编辑器槽放有输入与挂载计数的样例内容，验证停放不卸载；按组件规范登记组件索引与同名 `.md`。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 按第 1 节改为 v2；外壳一的行为写成可判定条目，验收场景分组 |
| `docs/specs/workbench/commands.md` | 第二批的面板命令改为读公开状态的 `when`、Agent 暴露 `never`；公开状态键登记；“随 t50”改为外壳一、外壳二 |
| `docs/specs/storage/persistence.md` | “首批消费者”登记三条布局记录 |
| `docs/proposals/extensible-application-platform.md` | 只追加决策记录：P7 “离开容器时释放”按外壳设计稿改为“移动只停放”（设计稿列为预期改动；视图合同随外壳二、Files 写进 Spec） |
| 组件同名 `.md` | `WorkbenchShellLayout`、`WorkbenchShell`、`WorkbenchPanelSurface`、`WorkbenchStatusBar` |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 第 1 节与文档表 | Spec 与提案决策记录 | `docs:check`、`governance:check` |
| S1 | 第 2 节 | 纯模型与测试（搬入并改词表） | `bun test` 该目录、typecheck |
| S2 | 第 3 节 | 记录、工作台 store、action | store 测试（真实 Storage 场地） |
| S3 | 第 4 节 | 公开状态与五条命令 | 命令与公开状态测试（真实命令系统） |
| S4 | 第 5 节 | 外壳组件与同名 `.md`、`/` 页接入 | 组件测试、typecheck |
| S5 | 第 6 节 | Lab 场景与组件索引 | 组件测试、Lab 现有 e2e |
| S6 | — | e2e 与截图证据 | `e2e/workbench-shell.e2e.ts`；四主题 × 双配色 × 桌面与 390 px 的截图 |
| S7 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 面板四位置 × 四对齐的拓扑：活动栏始终是主体左侧通高列、面板不跨过活动栏，`justify` 只跨左右侧栏 | S1：`shell/layout.test.ts`；S6：e2e 在 1440×900 下逐一核对几何 |
| 尺寸夹取：越界停在边界、不弹回、记诊断不改写记录；拖到零保留展开意图与 1px 边界，零值不进尺寸 | S1；S4 组件测试 |
| 紧凑呈现：容器宽 < 800 时纵向排布、面板强制底部两端对齐、无可拖边界、位置与对齐命令不可用并给出原因；回到宽屏恢复偏好 | S1；S3 命令的 `when`；S6 e2e 390 px |
| 高度不足时面板退到 32px 标题头、编辑器取非负余量 | S1 |
| 四种“消失”互不等价：隐藏零占用、状态栏“显示面板”同时清除隐藏与收起；32px 收起只对水平位置；最大化只在左右或水平居中可用、不落盘、换位置等即清除；拖到零 | S1、S2、S6 |
| 同值操作不写入；手势结束只提交一次；读取就绪前尺寸手势不可用；坏记录回落默认并保留原件 | S2：`state/workbench-store.test.ts` |
| 两个窗口共用记录：一处保存，另一处只更新已确认值、不强改当前显示；之后的保存不覆盖对方 | S2（真实 Storage 场地两个窗口）；S6 e2e |
| 绑定项目时尺寸记录在 project 分区，未绑定在 user 分区；面板与 Part 状态在 user 分区 | S2 |
| 五条面板命令随公开状态变为可用与不可用；参数严格；经命令执行改变布局 | S3：命令测试；S6 e2e 经命令面板 |
| 编辑器内容在最大化、换位置与紧凑切换时不卸载（输入保留） | S4 组件测试（挂载计数）；S5 Lab |
| 状态栏显示项目名或未打开项目、面板显隐按钮；标题栏不出现假入口 | S4 |
| 主题：四主题 × 双配色下外壳颜色来自 token、无双重边框；390 px 无页面横向滚动 | S6 截图证据与 e2e 的横向溢出检查 |

## 验证

- 每片：上表的自跑验证；类型改动影响时跑 `bun run --cwd packages/neuro-book typecheck`。
- 收口：`bun run test:affected --typecheck`、`bun run --cwd packages/neuro-book test:e2e`、`smoke:server`、`docs:check`、`governance:check`；交付前对验收映射逐条做变异检查。
- 真实环境：开发服务下打开 `/` 与 `/?project=…`，操作面板四位置与对齐、收起、隐藏、最大化、拖动边界、刷新恢复，两窗口同时改；截图存证据。
- 未验证边界：DPR 1.25/1.5/2 的线与热区（只在本机 DPR 1 截图）；桌面版标题栏的窗口控制（桌面壳不在新应用范围）。

## 不做

- 容器、视图、Switcher、实例层（外壳二）；拖放（外壳三）；`workbench.views` 贡献点与视图合同（随 Files）；编辑器分组与标签（随编辑器插件）；标题栏菜单与搜索；`focusedPart` 公开键。

## 风险

- 旧组件依赖旧的 nb-ui 版本或旧主题宿主：搬入时以当前 nb-ui 的接口为准，接口不符先查 nb-ui 现有用法再改，不在 nb-ui 里加适配。
- `views-customizations` 现在只有面板与 Part 两组字段，外壳二要加容器与视图：新字段可选、版本不变，外壳二不需要迁移；若外壳二要改已有字段的含义，按 Storage 的版本规则升版本。
- 尺寸记录按绑定选分区：窗口一生只绑定一个项目，不会中途换分区。
