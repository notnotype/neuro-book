# t65 实施计划：外壳一：外壳与布局

## Context

- **为什么做**：K1–K6 交付了多实例内核、Storage、插件状态 store、公开状态与配置。新应用的 `/` 页仍只是一段“工作台已就绪”文字加命令面板，没有外壳。按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节，外壳分三片：外壳一（外壳与布局，本 Task）、外壳二（容器与视图）、外壳三（拖放），之后是第 6 步 Files。
- **依据**：外壳设计稿第 1、2、6、7、9、10、11 节；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md)（`planned`，旧应用口径，本 Task 按 v2 修订）、[`ui/nested-grid.md`](../../../../../docs/specs/ui/nested-grid.md)、[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 第二批、[`state/store.md`](../../../../../docs/specs/state/store.md)、[`state/public-state.md`](../../../../../docs/specs/state/public-state.md)、[`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)。
- **已定的**：外壳设计稿的对象模型、七个 Part、面板四位置 × 四对齐、四种“消失”形态、紧凑呈现、三条布局记录的划分与写入时机、公开状态键与面板命令的 `when`、代码分层（`shell/`、`state/`、`components/`）；开发者 2026-10-08 说明旧应用的外壳（`packages/neuro-book-legacy/app/utils/workbench/`、`app/components/workbench/`）已人工验证，拖放等基础功能较完善，可以参照。
- **推进方式**：按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)：计划交三个 omp 审查后按推荐修订再实施，本该开发者确认的点记入 [待确认清单](../../pending-confirmations.md)。
- **现状**：
  - 新应用：`nbook.workbench` 浏览器入口提供页面表、选择服务、命令面板宿主、主题与显示语言（t64）；`/` 页是 `empty-workbench.ts` 的一段文字，`WorkbenchDocument.vue` 写文档根。
  - nb-ui 的布局原语：`createGrid`、`GridRenderer`、`Splitter`、sash 手势会话（`@notnotype/nb-ui/layout`），旧外壳就建在它上面。
  - 旧应用的外壳几何是纯模块：`app/utils/workbench/layout.ts`（957 行：七个 Part 的树、位置与对齐决定 body 形状、尺寸分配与夹取、紧凑呈现、拖到零、手势结算）、`panel-state.ts`（87 行：取值域与判定），测试 `layout.test.ts`；渲染是 `WorkbenchShellLayout.vue`（483 行：测量、Grid、Teleport 停放、焦点策略、手势结算），面板外观 `WorkbenchPanelSurface.vue`、状态栏 `WorkbenchStatusBar.vue`，产品宿主 `WorkbenchShell.vue` 把布局事实回传宿主（清过期最大化）。旧的保存会话 `layout-session.ts`（1568 行：CAS、外来订阅、旧存储桶）不迁，由插件状态 store 的持久化字段与 `nbook.storage` 承担（设计稿第 10 节）；它对用户的可观察承诺（失败可重试或放弃、多窗口窄改）保留。
  - nb-ui 已有共享宿主：`useLayoutExtent`（布局盒测量，区分未挂载与真实零）、`useGridLayout`（一次提交只调一次 `resizeBranches`、发布匹配布局、递增 revision）。旧外壳组件自建的测量与落账不搬，改用这两个（`ui/nested-grid.md` 输出“共享宿主”）。
- **工作方式**：worktree `.worktree/w00017-runtime-foundation` 逐片提交、提交后 push 本分支；测试用真实内核、真实 `nbook.storage`、真实 nb-ui 组件与本机 Chrome，不用 mock、spy、假计时器、固定等待；交付前对验收映射逐条做变异检查；主 Agent 编码，最后三个 omp 只读审查。不修改 `packages/neuro-book-legacy`。

## 关键设计

### 1. Spec：`ui/workbench-shell.md` 按 v2 修订（S0）

按设计稿“对 Spec 与提案的预期改动”：术语与对象模型改为设计稿第 2 节；删去旧产品专属内容（固定入口清单、用户资产工作面、旧存储键、CAS 与外来订阅、`descriptor` 的 `requiredAuthority`/`stateScope`/工厂键）；布局状态一节改为三条记录（第 6 节）与插件状态 store 的持久化字段。验收场景按外壳一、二、三分组重写，每条旧验收都有去向（保留、改写、拆分到外壳二三、移出并写明去向），删机制描述时保留用户可观察的恢复、焦点、主动字段与取消合同。编辑器分组与标签、EditorWorkbench 拖拽行为表移出（写明随编辑器插件）。顺带改正旧验收 15 与后续决定的矛盾（展开内容窗格在允许轴的前后各 50% 接收，没有中央禁投区）。外壳一的条目写成可判定的行为（下面各节）；仍是 `planned`，外壳一的条目实现后在原文标注。`nested-grid.md` 不改。

`workbench/commands.md`：第二批的“随 t50”改为“随外壳一、外壳二”；五条面板命令的 `when` 改为读工作台公开状态（第 4 节）；位置、对齐、隐藏、收起四条的参数改为可省略（第 4 节）；登记公开状态键；“显示面板”入口归状态栏。

### 2. 外壳几何的纯模型（`packages/neuro-book/src/plugins/workbench/web/shell/`）

- 从旧应用 `layout.ts`、`panel-state.ts` 搬入，按 v2 改 Part 词表：`titlebar`、`activitybar`、`sidebar`、`auxiliarybar`、`editor`、`panel`、`statusbar`（旧名 `activity`、`left`、`right`）。改名贯穿树引用、`hiddenParts`、`dragCollapsed` 键、尺寸补丁字段、插槽、`data-leaf`/`data-shell-slot`、紧凑渲染与样式；新应用没有旧布局数据，不留别名。
- 拓扑、尺寸常量、夹取、紧凑呈现（容器宽 < 800）、高度不足时面板退到 32px 标题头、拖到零（保留展开尺寸意图、相邻 1px 边界）照搬，连同 `layout.test.ts`（改为 `bun:test` 与新路径）。侧栏默认宽 340、右栏 400 收进本模型的常量，不再取旧 Storage 定义。
- 手势结算拆成两步，配合 `useGridLayout`：`shellGestureProblem(grid, commit)` 在落账前拒绝含不可保存分支的整批提交；`shellPatch(commit)` 在落账后从这批提交算出补丁（只取主动且真实变化的可保存叶，零值不进尺寸，拖到零只写布尔位）。一次手势只经 `useGridLayout.onGestureCommit` 一个落账入口。
- 尺寸偏好四项：`sidebarWidth`、`auxiliarybarWidth`、`panelHeight`、`panelWidth`；面板状态：`position`、`alignment`、`hidden`、`collapsed`（落盘）与 `maximized`（只在内存）；Part 状态：`hiddenParts`（`titlebar`、`activitybar`、`sidebar`、`auxiliarybar`）与 `dragCollapsed`（`sidebar`、`auxiliarybar`、`panel`）。
- 纯模块不依赖 Vue、Storage 与 store，`bun test` 直接测。

### 3. 工作台 store 与布局记录（`plugins/workbench/web/state/`）

- **记录**（`defineRecord`，`locality: "local"`，各带版本 1）：
  - `layout-sizes-side`（`sidebarWidth`、`auxiliarybarWidth`）与 `layout-sizes-panel`（`panelHeight`、`panelWidth`）：窗口绑定了项目时用 project 分区，没有绑定时用 user 分区（两份定义，同一 schema；窗口一生只绑定一个项目，不会中途换分区）；
  - `views-customizations`：user 分区；本 Task 只放面板状态与 Part 状态两个字段组；外壳二加容器与视图时作为可选字段加入、版本不变。
- **store**（`defineStore("workbench-layout", …)`，setup 写法）：三个 `persist` 字段；内存状态 `maximized` 与布局事实（`mode`、生效的面板状态，事实到达前为 `null`）；派生的有效状态；action：
  - 定制：`setPanelPosition`、`setPanelAlignment`、`setPanelHidden`、`setPanelCollapsed`、`togglePanelMaximized`、`setPartHidden`。每个 action 校验后按**字段**合成一次意图：`commit((current) => ({...current, panel: {...current.panel, position}}))`；`hiddenParts` 只增删本次这一个 Part，`dragCollapsed` 只合并本次的键；不把整份显示值当作待保存值（冲突重放时同一个 change 作用在最新值上，另一个窗口改的别的字段保留）。位置、对齐、隐藏、收起变化时清内存最大化；同值不写。
  - 尺寸：`commitSizes(patch)` 只写补丁里的字段，一次手势按涉及的记录各提交一次（两条记录各自保存，不是事务）；`commitDragCollapsed(map)` 同上。
  - 布局事实：`acceptLayoutFacts(facts)`：组件发布的呈现事实（模式、生效的面板状态）只经它写进 store；内存最大化为真而事实里已不是最大化（进入紧凑）时清掉，不写任何记录。
  - 恢复：`retry(record)`、`discard(record)`：转给对应字段的 `retry`/`discard`（打开或订阅确定失败时先 `reopen`）；失败只暂停那一条记录，别的记录照常保存。
- 读取就绪前显示默认布局、尺寸手势不可用；记录损坏或版本不支持时按 store 的读取分类显示默认并记诊断，原件不被普通保存覆盖；尺寸越界只夹取显示、记诊断、不改写记录。多窗口共用记录：另一窗口保存后只更新已确认值，本窗口当前显示不被强改（`state/store.md` 输出 5–11）。同一客户端的两个窗口共用 `local` 记录；不同绑定项目的窗口尺寸记录不同。
- **创建时机**：store 不在工作台入口激活时创建，而是产品外壳页面第一次挂载时由入口持有的惰性取值创建（登记在入口作用域上、随入口这一代释放）。直接打开 `/lab` 的窗口因此不打开、不订阅产品布局记录（`ui/component-lab.md` 的数据隔离）。工作台浏览器入口增加依赖 `storageKey`（store 的 `persist` 要的）。

### 4. 公开状态与面板命令（`plugins/workbench/web/`）

- 公开键（`definePublicState("nbook.workbench", …)`，入口贡献 `state.public`，用 `bindingsOf` 绑定到读惰性 store 的 computed；store 未创建、未就绪或布局事实未到时布尔键都为 `false`）：`layoutReady`、`nonCompact`、`panelHorizontal`、`panelMaximizable`、`panelVisible`、`panelMaximized`；字符串 `panelPosition`（`bottom`）、`panelAlignment`（`center`）。`focusedPart` 推迟到外壳二（要追踪焦点所在 Part，没有消费者；记入待确认清单）。
- 五条命令由工作台贡献给 `commands.definitions`，`effect: "write"`、Agent 暴露 `never`，`when.requires` 按设计稿第 7 节的表：
  - `nbook.view.set-panel-position` `{position?}`：`layoutReady`、`nonCompact`；省略参数时用选择服务列出四个位置、标出当前；
  - `nbook.view.set-panel-alignment` `{alignment?}`：`panelHorizontal`、`nonCompact`；省略参数时列出四种对齐；
  - `nbook.view.set-panel-hidden` `{hidden?}`：`layoutReady`；省略参数时切换；
  - `nbook.view.set-panel-collapsed` `{collapsed?}`：`panelHorizontal`；省略参数时切换；
  - `nbook.view.toggle-panel-maximized` `{}`：`panelMaximizable`、`nonCompact`。
  参数仍是严格对象（多余字段、非法值为 `invalid-args`）。命令面板对普通候选执行 `{}`，所以四条都能从面板直接用；这与设置命令（`switch-locale` 等）的写法一致。取消选择为成功且不写。
- 命令实现调 store 的 action；面板标题头的框架按钮与状态栏按钮也经这五条命令执行（同一入口）。

### 5. 外壳组件（`plugins/workbench/web/components/`，同名 `.md` 先写）

- `WorkbenchShellLayout.vue`：纯布局组件，从旧应用搬入并改接共享宿主：`useLayoutExtent` 测量承载盒（无 padding、border）、`useGridLayout` 落账与发布；`GridRenderer` 渲染；落账后发一次 `resize` 补丁；发布呈现事实（`layout` 事件）。七个 Part 的插槽内容由稳定宿主渲染再 Teleport 到叶落点，隐藏与最大化时停放（`hidden inert aria-hidden`），结构变化不卸载。保留旧焦点策略：搬动后恢复焦点与滚动；隐藏使焦点所在内容停放时焦点到状态栏“显示面板”（`data-shell-focus-target="panel-toggle"`），最大化时到面板标题（`panel-title`）；焦点在外壳之外（菜单、对话框）时不抢。同名 `.md` 写一份 sash scope、一次提交、取消不提交，不复制旧文档的逐轴描述。
- `WorkbenchPanelSurface.vue`：32px 标题头（标题带 `panel-title` 落点）与位置、对齐、收起、最大化、隐藏的框架按钮（经命令执行，不可用时禁用并有名称），内容区空状态；旧的面板标签子组件不搬，用 nb-ui 现有控件。
- `WorkbenchStatusBar.vue`：22px，显示项目名或“未打开项目”、面板显隐按钮（`panel-toggle` 落点；“显示面板”同时清除隐藏与收起）；布局有记录保存失败时显示“布局未保存”与原因，带重试与放弃；读取失败时显示“布局未读取，正在用默认布局”。不显示假数据；旧的状态栏项子组件不搬。
- `WorkbenchShell.vue`：产品外壳，取惰性 store，接到 `WorkbenchShellLayout`；七个 Part 的内容：标题栏（应用名与项目短名，没有菜单与搜索：未实现的不以可操作的假入口呈现）；活动栏（通高列，本 Task 没有容器，只保留列）；侧栏与右栏（空状态说明）；编辑器（稳定内容槽，放原首页的欢迎文字，语言跟随配置）；面板与状态栏用上面两个组件。它连产品 store，Lab 里标为不可挂载，在产品页验收。
- 页面：`/` 页由 `createEmptyWorkbench` 换成外壳（`WorkbenchDocument` 与命令宿主照旧挂在页面上）；页面单根，承接 `PageOutlet` 透传的窗口状态属性；当前项目的唯一标记 `data-workbench-project` 只放在外壳根上；删去 `.nb-empty-workbench` 的居中、padding、`min-height` 等旧样式，外壳根占满视口。外壳根、Part 与面板消费 nb-ui token；不渲染双重边框、标题条或标签条；390 px 下无页面级横向滚动。

### 6. Lab 场景（`plugins/lab/web/fixtures/`）

- 每个可挂载组件与它同片交付最小场景并在 `fixtures/index.ts` 登记：`WorkbenchShellLayout`（局部状态，可切面板位置与对齐、隐藏、收起、最大化、拖到零、容器宽度；编辑器槽放样例内容：内部持有输入与滚动，暴露实例编号与累计创建、卸载次数）；`WorkbenchPanelSurface`、`WorkbenchStatusBar`（受控零件，可复用 `defineSubjectFixture`）。场景不连产品 store 与 Storage。
- 停放不卸载在同一场景里连续转换验证（切换场景会重挂，不能用来验证）。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/ui/workbench-shell.md` | 按第 1 节改为 v2；外壳一的行为写成可判定条目；旧验收逐条给去向；改正验收 15 的中央禁投 |
| `docs/specs/workbench/commands.md` | 第二批面板命令：公开状态的 `when`、Agent 暴露 `never`、四条参数可省略；公开状态键登记；“随 t50”改为外壳一、外壳二 |
| `docs/specs/storage/persistence.md` | “首批消费者”登记三条布局记录 |
| `docs/proposals/extensible-application-platform.md` | 只追加决策记录：P7 “离开容器时释放”按外壳设计稿改为“移动只停放” |
| 组件同名 `.md` | 随各组件所在的片写 |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | 第 1 节与文档表 | Spec 与提案决策记录 | `docs:check`、`governance:check` |
| S1 | 第 2 节 | 纯模型与测试（搬入、改词表、拆结算） | `bun test` 该目录、typecheck |
| S2 | 第 3 节 | 记录、store、action（含布局事实、重试与放弃） | store 测试（真实 Storage 场地） |
| S3 | 第 4 节 | 公开状态与五条命令 | 命令与公开状态测试（真实命令系统、选择服务按请求作答） |
| S4 | 第 5 节纯布局、第 6 节 | `WorkbenchShellLayout` 与同名 `.md`、Lab 场景 | 组件测试（props、emits、停放属性）、Lab 现有 e2e |
| S5 | 第 5 节面板与状态栏、第 6 节 | `WorkbenchPanelSurface`、`WorkbenchStatusBar` 与同名 `.md`、Lab 场景 | 组件测试（名称、禁用、命令结果、失败提示） |
| S6 | 第 5 节产品外壳与页面 | `WorkbenchShell`、`/` 页接线；迁移受影响的 e2e（`settings.e2e.ts` 的底色量到外壳根并对照 token、`projects.e2e.ts` 的项目标记、Lab 返回路径） | 组件测试；聚焦 e2e：settings、projects、browser-host、lab |
| S7 | — | `e2e/workbench-shell.e2e.ts` 与截图证据 | 新 e2e；Lab 与产品截图 |
| S8 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`；浏览器产物体积对照 |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 面板四位置 × 四对齐的拓扑：活动栏始终是主体左侧通高列、面板不跨过活动栏，`justify` 只跨左右侧栏 | S1 纯模型；S7 在 1440×900 下逐一核对几何 |
| 尺寸夹取与补丁：越界只夹取不改写；拖到零保留展开意图、零值不进尺寸；不可保存分支整批拒绝 | S1 |
| 真实拖动：越界停在边界不弹回、1px 边界可从零拉回、松手后各记录只提交一次、读取就绪前不能拖 | S7 |
| 键盘调整：sash 方向键 10px、Shift 1px、Home/End、Enter 恢复拖到零、Escape 取消不提交；拖动中改容器尺寸后零提交 | S7 |
| 紧凑呈现：容器宽 < 800 时纵向排布、面板强制底部两端对齐、无可拖边界、位置与对齐命令不可用并给出原因；宽屏最大化 → 紧凑 → 宽屏不复活最大化，三条记录的 revision 不因测量变化 | S1；S2（`acceptLayoutFacts`）；S3（`when`）；S7（390 px） |
| 高度不足时面板退到 32px 标题头、编辑器取非负余量；260 px 高承载盒里显示与还原操作可完成、控件不被裁切 | S1；S7 |
| 四种“消失”互不等价：隐藏零占用、“显示面板”同时清除隐藏与收起；32px 收起只对水平位置；最大化只在左右或水平居中可用、不落盘、换位置等即清除；拖到零 | S1、S2、S7 |
| 同值操作不写入；坏记录与版本不支持回落默认并保留原件 | S2（真实 Storage 场地） |
| 保存失败：确定失败、`unknown-outcome`、读取失败后恢复；一条记录失败时另一条照常保存、只重试失败的那条；放弃回到已确认值；状态栏显示未保存与原因 | S2；S5（状态栏提示）；S7（一条真实失败路径） |
| 两个窗口：A 改位置、B 改对齐，最终两项都在；两个 Part 隐藏位各改一个都在；同一字段后写胜出；本窗口当前显示不被强改 | S2（同一客户端两个窗口）；S7（两个页面） |
| 绑定项目时尺寸记录在 project 分区，未绑定在 user 分区；面板与 Part 状态在 user 分区 | S2 |
| 五条面板命令随公开状态可用与不可用；带参数直接执行，省略参数经选择或切换；非法参数 `invalid-args`；经命令面板改变布局 | S3；S7 经命令面板 |
| 编辑器内容在最大化、换位置、隐藏、紧凑往返时不卸载：同一场景里实例编号不变、创建 1 次、卸载 0 次，输入、滚动与焦点保留 | S7（Lab 场景，真实浏览器） |
| 焦点：隐藏后到“显示面板”、最大化后到面板标题；停放内容不进入 Tab 顺序；外部浮层的焦点不被抢 | S7 |
| Lab 隔离：直接打开 `/lab` 不打开、不订阅产品布局记录 | S7（观察 Storage 远程调用，不只数 HTTP） |
| 状态栏显示项目名或未打开项目；标题栏不出现假入口；项目标记唯一 | S6；S6 迁移后的 `projects.e2e.ts` |
| 主题：外壳根、面板、状态栏的背景、文字、边框的计算样式等于对应 token 的解析值；结构边界只有一个绘制者 | S6 迁移后的 `settings.e2e.ts`；S7 |
| 截图证据：Lab 场景 nbook、macos、editorial、aurora × nbook-light、nbook-dark × 1440×900、390×844（`lab:shot`）；产品页 nbook 与 macos 的默认明暗 | S7 |

## 验证

- 每片：上表的自跑验证；类型改动影响时跑 `bun run --cwd packages/neuro-book typecheck`。
- 收口：`bun run test:affected --typecheck`、`bun run --cwd packages/neuro-book test:e2e`、`smoke:server`、`docs:check`、`governance:check`；交付前对验收映射逐条做变异检查。
- 真实环境：生产构建下打开 `/` 与 `/?project=…`，操作面板四位置与对齐、收起、隐藏、最大化、拖动边界、刷新恢复，两窗口同时改；截图存证据。浏览器产物：同一构建配置下记录 JS 原始与 gzip 大小的增量（不设阈值）。
- 未验证边界：DPR 1.25/1.5/2 的线与热区（只在本机 DPR 1；旧验收 17 的这一部分记入待确认清单，去向为以后在高 DPR 设备上补）；桌面版标题栏的窗口控制（桌面壳不在新应用范围）。

## 不做

- 容器、视图、Switcher、实例层（外壳二）；拖放（外壳三）；`workbench.views` 贡献点与视图合同（随 Files）；编辑器分组与标签（随编辑器插件）；标题栏菜单与搜索；`focusedPart` 公开键。

## 风险

- 旧组件依赖旧 nb-ui 接口或旧主题宿主：以当前 nb-ui 的接口为准，接口不符先查 nb-ui 现有用法再改，不在 nb-ui 里加适配。
- `views-customizations` 现在只有面板与 Part 两组字段：外壳二加的字段可选、版本不变；若外壳二要改已有字段的含义，按 Storage 的版本规则升版本。
- happy-dom 不计算盒布局：几何、手势、停放与焦点的验收都放在真实浏览器（S7），组件测试只测不需要布局的部分。

## 审查处理

2026-10-08 三个 omp 审查（对照旧应用与设计稿、状态与多窗口、可实现性与测试；报告见 `evidences/plan-review-*.txt`），合并去重后 13 条，全部并入：

| 发现 | 处理 |
|---|---|
| 保存失败没有用户可达的恢复（三份都提） | 第 3 节 `retry`/`discard`、第 5 节状态栏提示；验收补确定失败、`unknown-outcome`、读取恢复、只重试失败的那条 |
| 四条必填参数命令无法从命令面板执行（三份都提，一份定为阻断） | 第 4 节：参数可省略，省略时经选择或切换，与设置命令同一写法；记入待确认清单 |
| 进入紧凑不清内存最大化、组件事实没有写入口（两份） | 第 3 节 `acceptLayoutFacts`；验收补宽屏最大化 → 紧凑 → 宽屏 |
| 按字段组替换会覆盖另一窗口同组的字段 | 第 3 节按字段写 change；验收区分不同字段保留与同字段后写胜出 |
| 焦点、滚动、键盘调整与取消没有验收（两份） | 第 5 节保留旧焦点策略与落点；S7 验收补键盘、取消、焦点 |
| 原样搬布局宿主会复制共享测量与落账 | 第 2、5 节改用 `useLayoutExtent`、`useGridLayout`，结算拆成落账前检查与落账后补丁 |
| 布局 store 随入口创建会让 Lab 读取产品记录 | 第 3 节改为外壳页面首次挂载时惰性创建；验收补 Lab 隔离 |
| 首页切换没有迁移既有 e2e 与根元素合同 | S6 同片迁移 settings、projects 与 Lab 返回路径，唯一项目标记与单根 |
| DOM 几何、手势与不卸载放在测不了布局的层级 | 验收映射把几何、手势、停放、焦点移到 S7 真实浏览器；不卸载用同一场景的实例编号与计数 |
| 新组件缺场景、S4 过大 | 拆为 S4（纯布局）、S5（面板与状态栏）、S6（产品外壳与页面），组件与场景同片 |
| 截图不区分 Lab 与产品主题、截图证明不了 token | 验收映射分开 Lab 四主题与产品两主题，主题判据改为计算样式对照 token |
| 依赖边界笼统 | 第 2 节默认宽收进新模型；第 5 节不搬旧标签与状态栏项子组件；S8 记录产物增量 |
| Spec 修订会丢旧验收 | 第 1 节旧验收逐条给去向，改正验收 15 的中央禁投 |

`focusedPart` 推迟、DPR 未验证、面板命令参数可省略三项记入待确认清单。
