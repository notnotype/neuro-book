# t66 实施计划：外壳二：容器与视图

## Context

- **为什么做**：外壳一（t65）交付了七个 Part 的几何、面板形态与布局记录，但三个工具区域（Sidebar、AuxiliaryBar、Panel）还是空卡片。按 [外壳设计稿](../../../../../docs/proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 11 节，外壳二做容器与视图：注册表、落位与呈现模型、意图合成、ActivityBar 与 Switcher、三类容器与标题回落、容器三种模式与单轴排列、两个实例层、生命周期矩阵与三种失败、移动视图命令。之后是外壳三（拖放）与第 6 步 Files。
- **依据**：设计稿第 2–5、8、10 节；[`ui/workbench-shell.md`](../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 15–18 与验收 14–18（t65 按 v2 重写）；[`workbench/commands.md`](../../../../../docs/specs/workbench/commands.md) 第二批的 `nbook.view.move-view`；[平台设计 P7](../../../../../docs/proposals/extensible-application-platform.md#p7-浏览器宿主与第三方界面) 与它 2026-10-08 的决策记录（移动只停放）；[`runtime/plugins.md`](../../../../../docs/specs/runtime/plugins.md) 的贡献点与撤回原因（`scope-closed`、`receiver-closed`、`delivery-failed`）。
- **已定的**：设计稿的对象模型、三类容器 id、标题与图标的回落顺序、视图的三层与生命周期矩阵、三种失败分开处理、呈现模型的输入输出、意图合成的“整批拒绝、只改主动字段”；旧应用的容器与视图实现经开发者 2026-10-08 人工验证，可以参照（`packages/neuro-book-legacy/app/utils/workbench/{descriptors,view-placements,view-placements-session}.ts`、`app/components/workbench/` 的 `WorkbenchPartHost`、`WorkbenchContainerSurface`、`WorkbenchViewHost`、`WorkbenchViewSection`、`WorkbenchViewInstances`、`WorkbenchContainerInstances`、`WorkbenchActivityBar`、`WorkbenchContainerTab`、`WorkbenchTitleActions`）。
- **需要先定的一项（本计划按推荐写，记入待确认清单）**：设计稿把插件面向的视图合同（贡献点 `workbench.views`、`workbench/views.md`）排在 Files 一起做。外壳二若没有贡献点，产品页没有任何视图来源，生命周期矩阵里“实现所属入口停止”等几行与产品接线都只能在 Lab 里用局部样例验证，要等 Files 才在真实运行时测到。推荐把贡献点与 `workbench/views.md` 提前到外壳二：外壳二用一个测试插件（e2e 构建里的 `test.sample-views`）贡献样例视图验收全链路，Files 只作为第一个消费者接入。
- **推进方式**：按 [autonomous-delivery](../../../../skills/autonomous-delivery/SKILL.md)；工作方式同 t65（worktree 逐片提交并 push；真实内核、真实 Storage、真实 nb-ui 与本机 Chrome；不用 mock、spy、假计时器、固定等待；交付前变异检查；三个 omp 审查计划与实现）。不修改 `packages/neuro-book-legacy`。
- **现状**：
  - 新应用：`web/shell/`（几何）、`web/state/`（三条布局记录与布局 store，`views-customizations` 只有面板与 Part 两组字段）、`web/components/`（`WorkbenchShellLayout`、`WorkbenchShell`、面板与状态栏）；ActivityBar、侧栏、右栏是空卡片，面板内容是空状态。
  - 旧应用：`descriptors.ts`（注册表与声明校验）、`view-placements.ts`（2254 行：读取与落位、移动与合并的判定、意图合成；其中合并、自建容器、半区比例属于外壳三）；旧口径是“每个区域一个默认容器、视图并进去”，v2 改为“视图默认属于自己的隐式容器”（设计稿第 3、10 节），落位规则要按 v2 重写，不能照搬。

## 关键设计

### 1. 视图合同与贡献点（`plugins/workbench/shared/views.ts`、`web/views/contribution.ts`）

- **声明**（`ViewDeclaration`，设计稿第 5 节）：`title`（`LocalizedText`）、`icon`、`location`（`sidebar | auxiliarybar | panel`）、`container?`、`order?`、`layout`（`scroll | fill`）、`minimumSize?`、`maximumSize?`、`movable?`（默认 true）。声明式容器（`ContainerDeclaration`：`title`、`icon`、`location`、`order?`）同一贡献点、不同的贡献种类（`kind: "view" | "container"`）。校验：id 规则同命令（`nbook.*` 插件写 `nbook.<名>`，其它插件以自己的插件 id 开头）；容器 id 不得以 `view:`、`custom:` 开头；`container` 引用的容器在登记时不必已存在（呈现时找不到即诊断、按隐式容器处理）。
- **实现**：`{load(): Promise<Component>}`，与页面贡献同一形状；组件 props 为 `{context: ViewContext}`（`id`、`generation`、`visible`、`location`）。
- **贡献点** `workbench.views`：由工作台浏览器入口定义（`implementation: "required"`，与 `workbench.pages` 同法）；接收者把声明与实现交给视图注册表；撤回时按原因区分（`receiver-closed` 只释放运行资源；入口停止 `scope-closed`、补交失败 `delivery-failed` 卸载实例、保留布局项；声明真正消失才清理布局项）。
- **新 Spec** `docs/specs/workbench/views.md`（`planned`，外壳二实现后标注）：声明、实现、实例生命周期矩阵、三种失败、撤回与受阻的呈现、`ViewContext`、验收。

### 2. 注册表、落位与呈现模型（`plugins/workbench/web/views/`，纯 TS）

- `registry.ts`：已接受的视图与容器声明、每个视图的实现状态（`available | loading | failed(reason) | blocked(reason)`），容器 id 规则与隐式容器 `view:<视图 id>`。
- `placement.ts`：默认落位（视图声明的 `container` 或隐式容器；容器的 `location` 取声明式容器的声明或隐式容器起源视图的 `location`）加用户定制，求出每个视图的实际容器与顺序、每个容器的实际 ToolPart 与顺序、每个 ToolPart 的选中容器。用户覆盖带默认指纹：默认位置变了，基于旧默认的覆盖失效、回到新默认并诊断（View Host 规则 ①）；引用未知视图或容器只在呈现中忽略并诊断，原件不删。
- `presentation.ts`：`buildPresentation(input)`（设计稿第 8 节的输入输出表）：导航（每个 ToolPart 的 Switcher 条目、标题与图标按四级回落、选中项）、当前切片（选中容器的模式 empty、single、multiple，可见视图、尺寸意图与收起，轴向：侧栏纵向、Panel 横向）、常驻资格（有实际成员的容器都常驻）、空状态与原因、诊断。组件、DOM、`load()` 的 Promise 与实例表都不进纯模型。
- `intents.ts`：`applyIntent(state, intent) → rejected | unchanged | patch`：选中容器、移动视图到容器、视图尺寸补丁（主动叶的当前轴，正有限 CSS px，零与补偿值不写）、视图收起、重置视图或容器到默认。整批拒绝；补丁只改本次主动修改的字段，其余字段与未知数据原样保留。旧应用的合并、自建容器、半区比例、拖放落点留给外壳三。
- 旧 `view-placements.ts` 中可直接参照的部分：插入位求解（`resolveInsertion`）、移动判定（`resolveViewMove`、`resolveContainerMove`）、视图尺寸补丁的取值规则（`viewSizePatchesOf`）；按 v2 的容器口径改写。

### 3. 记录与 store（`plugins/workbench/web/state/`）

- `views-customizations` 加可选字段组（版本不变，旧记录仍合法）：`containers`（容器 id → `{location, order, fingerprint}`）、`selected`（ToolPart → 容器 id）、`views`（视图 id → `{container, order, width, height, collapsed, fingerprint}`）。字段取值约束与 Spec 的“副作用与数据”一致（尺寸正有限且 ≤ 1,000,000；未知字段在已知对象内拒绝，顶层仍严格）。
- 布局 store 加：视图注册表的只读输入（来自贡献点接收者，响应式）、`presentation`（computed，调纯模型）、action `selectContainer`、`moveView`、`commitViewSizes`、`setViewCollapsed`、`resetView`；每个 action 经 `applyIntent` 合成按字段的 change（同 t65 的写法），冲突重放作用在最新值上。
- 公开状态：补上外壳一推迟的 `focusedPart`（字符串，焦点所在 Part；`focusin` 由外壳根上报给 store 的 action）。

### 4. 组件（`plugins/workbench/web/components/`，同名 `.md` 先写）

- `WorkbenchActivityBar`：通高卡片，上段是 Sidebar 的 Switcher（容器图标按钮，至多一个选中；点非选中项切换并打开 Sidebar，重复点选中项保持选择并打开被隐藏或拖到零的 Sidebar），底段全局项（本 Task 无，保留区域）。受控零件：条目、选中项、Sidebar 是否可见由 props 给，点击发事件。
- `WorkbenchSwitcherTabs`：AuxiliaryBar 与 Panel 的容器标签带（只有一个容器也保留）；受控零件。面板的标签带放进 `WorkbenchPanelSurface` 的标题头（替代现在的“面板”标题，框架按钮不变）。
- `WorkbenchToolPartHost`：一个 ToolPart 的宿主：Switcher（Sidebar 的由 ActivityBar 承担，这里只显示当前容器的标题行）+ 选中容器的挂载目标 + single 模式的动作上提（视图动作 → 容器管理（移动到）→ Part 框架）。
- `WorkbenchViewContainerHost`：容器内部的单轴网格（`useLayoutExtent`、`useGridLayout`，每个可见视图一个叶，叶里是 `WorkbenchViewSection`）；手势只把主动叶折成视图尺寸补丁。
- `WorkbenchViewSection`：视图标题（multiple 时显示；single 时不显示）、动作（“移动到”菜单）、收起；内容区按 `layout` 给内边距与滚动。
- 实例层：`WorkbenchContainerInstances`（每个常驻容器一个稳定宿主，Teleport 到当前落点，没有落点时停放）与 `WorkbenchViewInstances`（每个视图一个实例宿主：首次可见才 `load()`、错误边界、加载与渲染失败的“重新加载”“重试”、代际号）。一次加载绑定“声明身份 + 实现所属入口的激活代次 + 视图代际号”，结果回来时有一项变了就丢弃。
- `WorkbenchShell` 接线：三个 ToolPart 放 `WorkbenchToolPartHost`，ActivityBar 放 `WorkbenchActivityBar`，面板标题头放标签带。

### 5. 命令

- `nbook.view.move-view` `{viewId, targetContainerId}`：`when` 读公开状态 `layoutReady`；参数严格；视图不可移动、目标不存在或与当前相同时 `invalid-args` 或成功无写入（Spec 写明）；Agent 暴露 `never`。“移动到”菜单经它执行。
- 目标列表：其它 ToolPart 的现有容器 + 每个 ToolPart 的“新建容器（在 X）”（新建即移入视图的隐式容器并放到该 ToolPart；隐式容器 id 由视图决定，不需要生成 id）。

### 6. Lab 与测试插件

- Lab 场景：`WorkbenchActivityBar`、`WorkbenchSwitcherTabs`、`WorkbenchViewSection`（受控零件，透传或局部 fixture）；容器与实例层用一个局部场景（纯模型 + 局部定制 ref + 样例视图组件，带输入、滚动与实例编号，可切模式 empty/single/multiple、移动、隐藏、加载失败、渲染出错）。
- e2e 测试插件 `test.sample-views`（`src/web/testing/`，只进 e2e 构建）：贡献两个容器声明与五个视图（侧栏三个、右栏一个、面板一个，其中一个声明式容器放两个视图），一个视图的 `load()` 按开关失败、一个视图组件按开关渲染出错，一个入口可由测试停止与恢复。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/views.md`（新，planned） | 视图合同：声明与校验、实现、`ViewContext`、实例生命周期矩阵、三种失败、撤回与受阻的呈现、验收 |
| `docs/specs/ui/workbench-shell.md` | 外壳二输出 15–18 细化（容器标题行、动作顺序、移动到菜单的目标、`focusedPart`）；记录字段（`containers`、`selected`、`views`）写进“状态与转换”；链接 `views.md` |
| `docs/specs/workbench/commands.md` | `move-view` 的参数、`when` 与无写入的情况 |
| `docs/specs/README.md` | 登记 `workbench/views.md` |
| `docs/proposals/workbench-shell-abstractions.md` | 只追加决策记录：视图合同提前到外壳二（若开发者改判则撤回） |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档表 | 新 Spec 与修订 | `docs:check`、`governance:check` |
| S1 | 第 2 节 | 注册表、落位、呈现模型与意图合成（纯 TS）及测试 | `bun test` 该目录 |
| S2 | 第 3 节 | 记录字段、store 的 action 与 `presentation`、`focusedPart` | store 测试（真实 Storage 场地） |
| S3 | 第 1、5 节 | 贡献点、接收者与撤回、`move-view` 命令 | 贡献点与命令测试（真实内核与命令系统） |
| S4 | 第 4 节零件 | ActivityBar、Switcher 标签带、ViewSection 与同名 `.md`、Lab 场景 | 组件测试 |
| S5 | 第 4 节宿主与实例层 | ToolPartHost、ViewContainerHost、两个实例层与同名 `.md`、局部 Lab 场景 | 组件测试 |
| S6 | 第 4 节接线、第 6 节测试插件 | `WorkbenchShell` 接线、`test.sample-views` | 组件测试、聚焦 e2e |
| S7 | — | `e2e/workbench-views.e2e.ts` 与截图 | 新 e2e |
| S8 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 设计稿第 3 节典型情况表（初始、B 拖进 `view:A`、再把 A 拖走、刷新、重置 A、重置 B、A 的插件被禁用、A 改默认位置） | S1 纯模型逐行 |
| 标题与图标四级回落；容器实际成员归零才移除、全部隐藏时保留 | S1；S7 |
| 模式 empty、single、multiple 与轴向；single 不出第二个标题、动作上提；可见成员 1→2→1 时实例的输入、滚动与代际保持 | S1；S5 组件测试；S7（Lab 与测试插件） |
| 意图合成：整批拒绝、只改主动字段、未知字段保留；跨轴移动时迟到的提交被拒 | S1；S2（真实 Storage，两个窗口改不同视图都保留） |
| ActivityBar：选择互斥；重复点选中项打开被隐藏或拖到零的 Sidebar；显式恢复用记忆尺寸 | S4；S7 |
| 移动到菜单与 `move-view`：目标列表、移动后入口与选中、无写入的情况；参数严格 | S3；S7 经菜单与命令面板 |
| 实例停放：容器在 Part 之间移动、目标卸载与重新登记时退回停放区再搬回；来源 Part 显示空态 | S5；S7 |
| 生命周期矩阵：入口停止时卸载组件、保留布局项、原位显示原因，恢复后新代际重新创建；声明消失时清理布局项；`receiver-closed` 不当作用户删除 | S3（真实内核）；S7（测试插件停止与恢复入口） |
| 三种失败：入口受阻原位显示原因；`load()` 失败“重新加载”只重试加载、代际加一；渲染出错“重试”重建实例、代际加一；迟到的加载结果被丢弃 | S5；S7 |
| 未知引用只在呈现中忽略并诊断、原件不删；默认指纹失效回到新默认并诊断 | S1；S2 |
| `focusedPart` 随焦点变化 | S2；S7 |
| 主题与 390 px：新零件的颜色取 token，窄屏下 Switcher 与动作可达 | S7（计算样式与截图） |

## 验证

- 每片：上表的自跑验证；类型改动影响时跑三份 typecheck。
- 收口：`bun run test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`；交付前对验收映射逐条做变异检查。
- 真实环境：e2e 构建装上 `test.sample-views` 走完全链路；开发服务下的 Lab 截图（四主题 × 双配色 × 1440×900、390×844）与产品页截图存证据。
- 未验证边界：插件真正禁用与卸载（插件管理尚未实现）只在纯模型与贡献点撤回的测试里覆盖；DPR 不验证（同 t65）。

## 不做

- 拖放、自建容器 `custom:<UUID>`、整组并入、半区比例、键盘拖放（外壳三）；视图的 `when`、标题动作贡献、揭示视图的服务（随消费者）；ActivityBar 底段的全局项（随账号、设置插件）。

## 风险

- 旧 `view-placements.ts` 的落位按“每区一个默认容器”写成，直接搬会把旧口径带进来：只参照插入、移动判定与尺寸补丁的写法，落位与呈现按设计稿第 3、8 节重写。
- 视图实例的 `load()` 与错误边界跨越插件信任边界：错误边界只覆盖 Vue 调用路径，组件自己的异步错误归所属插件（设计稿第 4 节），Spec 写明。
- `views-customizations` 字段变多：单条记录上限 64 KiB，视图上百时仍远低于上限；超出时 Storage 拒绝写入，按保存失败处理。
