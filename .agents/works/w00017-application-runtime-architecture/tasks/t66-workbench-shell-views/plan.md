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

- **声明**（`ViewDeclaration`，设计稿第 5 节）：`title`（`LocalizedText`）、`icon`、`location`（`sidebar | auxiliarybar | panel`）、`order?`、`layout`（`scroll | fill`）、`minimumSize?`、`maximumSize?`、`movable?`（默认 true）。校验：id 规则同命令（`nbook.*` 插件写 `nbook.<名>`，其它插件以自己的插件 id 开头），只接受浏览器入口。
- **不做声明式容器**：设计稿第 2 节把它排给“第一个需要把多个视图归为一组的消费者”；本片只有隐式容器 `view:<视图 id>`，多视图容器只经“移动到”形成（审查 D06、L5）。`container?` 字段随容器贡献点一起加。
- **实现**：`{load(): Promise<Component>}`，与页面贡献同一形状；组件 props 为 `{context: ViewContext}`（`id`、`generation`、`visible`、`location`）。
- **贡献点** `workbench.views`：由工作台浏览器入口定义（`implementation: "required"`，与 `workbench.pages` 同法）。
- **注册表的两种输入**（审查 D04、L1）：
  - 声明目录：工作台入口激活时从 `context.declarations.list("workbench.views")` 取本位置已接受的声明（当前是静态清单，登记后不变）；未交付的声明也出现在导航里。
  - 交付句柄：接收者 `published` 时记下 `ContributionHandle`，`revoke` 时按原因改交付状态：`receiver-closed` 只释放运行资源；`scope-closed`、`activation-stopped`、`delivery-failed` 卸载实例、保留布局项，原位显示原因。声明真正消失（插件禁用、卸载）要等插件管理，本片没有来源，只在纯模型测试里覆盖清理规则。
  - 入口状态：新增宿主能力 `window.plugins`（`browser-host.ts` 用应用自己的 `PluginHost` 实现）：`entryState(ref)`、状态变化通知（经插件诊断观察者与 `startup` 完成）、`retry(ref)`（对 `failed` 入口 `recover` 再 `activate`）。工作台只经视图 id 查询与重试。注册表据此区分 `declared`（入口未激活或激活中）、`entry-blocked(reason)`、`entry-failed(reason)`、`entry-stopped`、`available`；加载与渲染失败在实例层另记（第 4 节）。
- **加载门禁**（审查 L3）：每次加载调用 `handle.implementation().load()`，不缓存实现；结果回来时核对“所捕获句柄仍是当前句柄且 `published`、视图代际未变、工作台未停止”，任一不符就丢弃，不记为加载失败。
- **新 Spec** `docs/specs/workbench/views.md`（`planned`，外壳二实现后标注）：声明、实现、注册表输入、实例生命周期矩阵、三种失败、撤回与受阻的呈现、`ViewContext`、`window.plugins` 的边界、验收。

### 2. 注册表、落位与呈现模型（`plugins/workbench/web/views/`，纯 TS）

- `registry.ts`：声明目录、每个视图的交付状态（上节）、容器 id 规则与隐式容器 `view:<视图 id>`。
- `placement.ts`：默认落位（视图在自己的隐式容器，容器的 `location` 取起源视图的声明）加用户定制，求出每个视图的实际容器与顺序、每个容器的实际 ToolPart 与顺序、每个 ToolPart 的选中容器。
  - 隐式容器的存在由实际成员证明：起源视图的声明消失而容器仍有成员时，容器保留身份与成员，位置取有效的容器位置覆盖；没有覆盖时回落到首个实际成员的默认区域与顺序，并诊断（审查 D05、L6，记入待确认清单）。
  - 用户覆盖带默认指纹：默认位置变了，基于旧默认的覆盖失效、回到新默认并诊断（View Host 规则 ①）；引用未知视图或容器只在呈现中忽略并诊断，原件不删。
- `presentation.ts`：`buildPresentation(input)`（设计稿第 8 节的输入输出表）：
  - 导航：每个 ToolPart 的 Switcher 条目、标题与图标按四级回落、选中项。
  - 当前切片：选中容器的模式、可见视图、尺寸意图与收起、轴向（侧栏与右栏纵向、Panel 横向）。模式规则在这里一次求定（审查 D03）：隐藏不计数、收起计数；single 不应用收起、不改保存值；multiple 才应用；Sidebar 只在 single 显示容器标题行，multiple 不画容器标题行。
  - 常驻资格（有实际成员的容器都常驻）、空状态与原因、诊断。
  - “移动到”目标：除当前容器外全部有效容器，含同一 ToolPart 的，按 ToolPart 分组（审查 D08）；不在默认位置时另给“重置位置”。导航与目标表共用同一份标题回落结果。
  - 组件、DOM、`load()` 的 Promise 与实例表都不进纯模型。
- `intents.ts`：`applyIntent(state, intent) → rejected | unchanged | patch`：选中容器、移动视图到已有容器（带来源容器）、视图尺寸补丁（主动叶的当前轴，正有限 CSS px，零与补偿值不写）、视图收起、重置视图或容器到默认。整批拒绝；补丁只改本次主动修改的字段，其余字段与未知数据原样保留。同一视图两个窗口先后移动时按 Spec“同字段后保存胜出”重放；菜单过期在命令接纳时检查（第 5 节）。
- 旧 `view-placements.ts` 中可直接参照的部分：插入位求解（`resolveInsertion`）、移动判定（`resolveViewMove`）、视图尺寸补丁的取值规则（`viewSizePatchesOf`）；按 v2 的容器口径改写。

### 3. 记录与 store（`plugins/workbench/web/state/`）

- `views-customizations` 加可选字段组（版本不变，旧记录仍合法）：`containers`（容器 id → `{location, order, fingerprint}`）、`selected`（ToolPart → 容器 id）、`views`（视图 id → `{container, order, width, height, collapsed, fingerprint}`）。字段取值约束与 Spec 的“副作用与数据”一致（尺寸正有限且 ≤ 1,000,000；id 长度 ≤ 128；指纹是有界的稳定编码；未知字段在已知对象内拒绝，顶层仍严格）。
- 容量（审查 L9）：按 id ≤ 128、指纹 ≤ 64 估算单个视图项上限，Spec 写明前提；超出 64 KiB 时 Storage 拒绝写入，走 t65 已有的保存失败路径（状态栏提示、重试、放弃），补一条真实 Storage 场景。
- 布局 store 加：视图注册表的只读输入（响应式）、`presentation`（computed，调纯模型）、action `selectContainer`、`moveView`、`commitViewSizes`、`setViewCollapsed`、`resetView`；每个 action 经 `applyIntent` 合成按字段的 change（同 t65 的写法），冲突重放作用在最新值上。
- 公开状态：补上外壳一推迟的 `focusedPart`：最近获得焦点的 Part，默认 `editor`（焦点移到外壳之外的菜单、对话框或页面空白处时保持原值；公开状态是非空字符串）；`focusin` 由外壳根上报给 store。

### 4. 组件（`plugins/workbench/web/components/`，同名 `.md` 先写）

- `WorkbenchActivityBar`：通高卡片，上段是 Sidebar 的 Switcher（容器图标按钮，至多一个选中；点非选中项切换并打开 Sidebar，重复点选中项保持选择并打开被隐藏或拖到零的 Sidebar），底段全局项（本 Task 无，保留区域）。受控零件。
- AuxiliaryBar 与 Panel 的容器标签带（只有一个容器也保留）直接用 nb-ui `Tabs`，不另包一层组件（实施时改定：包一层只转发属性）。
- `WorkbenchMoveViewMenu`：“移动到”菜单（nb-ui `Dropdown`，按 Part 分级），single 上提与 multiple 标题共用；菜单目标身份在这里（下一条）。
- **Panel 标题行的唯一拥有者**（审查 impl 5）：`WorkbenchPanelSurface` 仍是唯一的 32px 标题行与内容显隐拥有者，新增左侧导航槽；ToolPartHost 在 Panel 分支把标签带放进这个槽，不另画标签头。空、单、多容器时的焦点目标、可访问名称、标签与内容的关联、溢出优先级写进两个组件的 `.md`。
- `WorkbenchToolPartHost`：一个 ToolPart 的宿主：Switcher（Sidebar 的由 ActivityBar 承担）+ 选中容器的挂载目标 + single 模式的动作上提（视图动作位，本片无贡献 → 容器管理“移动到” → Part 框架）。空 Part 的框架按钮仍可达。
- `WorkbenchViewContainerHost`：容器内部的单轴网格（`useLayoutExtent`、`useGridLayout`，每个可见视图一个叶，叶里是 `WorkbenchViewSection`）；手势只把主动叶折成视图尺寸补丁；降级与补偿不写盘。
- `WorkbenchViewSection`：视图标题（multiple 时显示）、动作（“移动到”菜单，nb-ui Dropdown 的 Escape 与焦点归还）、收起（横向 32px 竖条、纵向 32px 横标题，键盘可展开）；内容区按 `layout` 给内边距与滚动。
- **菜单目标身份**（审查 D01）：“移动到”菜单打开时捕获视图 id 与来源容器，身份由视图、来源容器、容器模式与交付状态拼成，任一变化即关闭菜单（实施时改定：视图代际只在实例层，上提的菜单拿不到；过期点击最终由命令按来源容器核对拒绝）。single 上提的菜单与 multiple 的 Section 菜单共用一个组件。菜单一层平铺、右侧注明 Part（实施时改定：nb-ui Dropdown 的级联子菜单在真实浏览器里指针点不进去）。
- 实例层：`WorkbenchContainerInstances`（每个常驻容器一个稳定宿主，Teleport 到当前落点，没有落点时停放）与 `WorkbenchViewInstances`（每个视图一个实例宿主：首次有效可见才 `load()`、错误边界、加载与渲染失败的“重新加载”“重试”、代际号）。“有效可见”由呈现模型的活动容器、Part 可见性、收起与落点状态共同求值。
- **滚动与焦点记忆**（审查 L8、impl 4、D09）：把 t65 `WorkbenchShellLayout.vue` 里的滚动记忆与焦点恢复抽成 `web/shell/teleport-memory.ts`，外壳层、容器层、视图层三处真正搬动 DOM 的地方各自在搬动前捕获、搬动后恢复，规则同一份：原节点仍可见时恢复输入与滚动；被停放时把焦点给可见的框架控件；焦点在外壳外的菜单或对话框时不抢；停放的内容不能 Tab 到达。视图代际销毁时清理它的记忆。
- `WorkbenchShell` 接线：三个 ToolPart 放 `WorkbenchToolPartHost`，ActivityBar 放 `WorkbenchActivityBar`。

### 5. 命令

- `nbook.view.move-view` `{viewId, sourceContainerId, targetContainerId}`：`when` 读公开状态 `layoutReady`；Agent 暴露 `never`。
  - 参数要么三项齐全（菜单路径），要么全部省略（命令面板路径）；只给一部分为 `invalid-args`。
  - 无参时用面板命令同一个选择服务：先选可移动的视图，再选目标（第 2 节的目标表）；任一步取消为成功且无写入；选择期间来源、目标或视图代际变了则拒绝（审查 D07、L7）。
  - 执行时核对来源：视图当前容器不是 `sourceContainerId` 时返回已有失败码 `stale-target`，零写入（审查 D01）。视图不可移动、目标不存在为 `invalid-args`；目标与当前相同为成功无写入。
- 不提供“新建容器（在 X）”（审查 D02、L2、impl 1）：隐式容器 `view:<id>` 可能已有其它成员，不能当作新身份；单视图分离与移到空区域随外壳三的自建容器 `custom:<UUID>` 一起做（记入待确认清单）。回到默认位置用“重置位置”。

### 6. Lab 与测试插件

- Lab 场景：`WorkbenchActivityBar`、`WorkbenchSwitcherTabs`、`WorkbenchViewSection`（受控零件，透传或局部 fixture）；容器与实例层用一个集成场景（纯模型 + 局部定制 ref + 样例视图组件，带输入、滚动与实例编号，可切模式 empty/single/multiple、移动、隐藏、加载失败、渲染出错），其它注入或 Teleport 零件的 `验证入口` 指向它（审查 impl 7）。
- e2e 测试插件 `test.sample-views`（审查 impl 3、L4、D04 补充）：
  - 描述与客户端定义同版本共享，放 `src/web/testing/`；后端测试入口 `src/server/testing/` 的测试插件白名单与引导清单加上它，fixture 用 `NBOOK_TEST_PLUGINS` 选择；只进 e2e 构建。
  - 五个视图（侧栏三个、右栏一个、面板一个），都在各自的隐式容器；一个视图的 `load()` 按开关失败、一个视图组件按开关渲染出错（开关是测试插件自己的 `localStorage` 键，测试用 `addInitScript` 设）。
  - 一个浏览器入口，贡献视图并登记测试命令 `test.sample-views.stop`。入口状态的三条真实路径：
    - 激活失败后恢复：开关让入口激活抛错 → 工作台原位显示原因与“重试” → 测试清掉开关、点“重试”（`window.plugins.retry`）→ 新代次交付、视图新代际、布局保留。
    - 入口停止：测试命令让入口关闭自己这一代的激活作用域（`context.scope.parent`；`context.scope` 是其下的入口工作作用域，单关它会等借用它的资源；不等待，真实 `scope-closed` 撤回，声明仍在）→ 原位显示“已停止”、布局保留；正常停止后的再启用要插件管理，本片不做（记入待确认清单），刷新页面后恢复。
    - `receiver-closed`：只在 S3 的真实内核测试里覆盖（停止工作台入口）。
  - 先做最小全链路探针（一个视图从测试插件到产品页），再扩到五个。

## Spec 与文档改动（S0）

| 文档 | 改什么 |
|---|---|
| `docs/specs/workbench/views.md`（新，planned） | 视图合同：声明与校验、实现、`ViewContext`、注册表的两种输入、`window.plugins` 的边界、实例生命周期矩阵、三种失败、撤回与受阻的呈现、加载门禁、验收 |
| `docs/specs/ui/workbench-shell.md` | 外壳二输出 15–18 细化（容器标题行、动作顺序、移动到的目标表与“重置位置”、菜单目标身份、Panel 标题行的拥有者、`focusedPart`、起源声明消失时的回落）；记录字段（`containers`、`selected`、`views`）与容量前提写进“状态与转换”；链接 `views.md` |
| `docs/specs/workbench/commands.md` | `move-view` 的参数（三项齐全或全省略）、无参选择、过期与无写入的情况 |
| `docs/specs/README.md` | 登记 `workbench/views.md` |
| `docs/proposals/workbench-shell-abstractions.md` | 只追加决策记录：视图合同提前到外壳二；本片不做声明式容器与“新建容器” |

## 切片

| 片 | 对应设计 | 提交边界 | 自跑验证 |
|---|---|---|---|
| S0 | Spec 与文档表 | 新 Spec 与修订 | `docs:check`、`governance:check` |
| S1 | 第 2 节 | 注册表、落位、呈现模型与意图合成（纯 TS）及测试 | `bun test` 该目录 |
| S2 | 第 3 节 | 记录字段、store 的 action 与 `presentation`、`focusedPart` | store 测试（真实 Storage 场地） |
| S3 | 第 1、5 节 | 贡献点、注册表两种输入、`window.plugins`、加载门禁、`move-view` | 贡献点与命令测试（真实内核与命令系统） |
| S4 | 第 4 节零件 | ActivityBar、MoveViewMenu、ViewSection 与同名 `.md`、Lab 场景 | 组件测试 |
| S5a | 第 4 节 | `teleport-memory.ts`（外壳层改用它）、ViewContainerHost 单轴网格 | 组件测试；Lab 里一次真实 sash 调整 |
| S5b–c | 第 4 节 | 两个实例层（`WorkbenchViewInstances` 一个组件内两层）、`WorkbenchViewFrame`（交付状态、加载、两种失败与错误边界）、ToolPartHost、PanelSurface 导航槽、`WorkbenchShell` 接线、集成 Lab 场景（挂在 `WorkbenchShellLayout` 的 views 场景下） | 组件测试；Lab 场景在本机 Chrome 里连续移动、切容器、加载失败与入口停止的探针 |
| S6 | 第 6 节 | `test.sample-views` 全链路（先一个视图的探针） | 聚焦 e2e |
| S7 | — | `e2e/workbench-views.e2e.ts` 与截图 | 新 e2e |
| S8 | — | Spec 标注、Task 证据、三个 omp 实现审查与修正 | `test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check` |

## 验收映射

| 行为 | 覆盖 |
|---|---|
| 设计稿第 3 节典型情况表（初始、B 进 `view:A`、再把 A 移走、刷新、重置 A、重置 B、A 的声明消失、A 改默认位置）；A 离开后操作 `view:A` 的菜单，B 不随 A 移动 | S1 纯模型逐行；S7 |
| 起源声明消失、B 默认在另一 ToolPart、没有容器覆盖：`view:A` 身份与 B 归属保留、区域回落到 B 的默认并诊断，刷新后一致 | S1；S2 |
| 标题与图标四级回落；容器实际成员归零才移除、全部隐藏时保留 | S1；S7 |
| 模式与轴向：隐藏不计数、收起计数；两视图收起 A → 移出 B → A 展开但记录不变 → B 回来 A 再收起；Sidebar 只在 single 画容器标题行 | S1；S7（含 Panel 横向 32px 竖条键盘展开） |
| 实例保留：可见成员 1→2→1、跨容器、跨 Part、停放与重新登记，不重载页面；每步断言 DOM 身份、输入、滚动、焦点与代际；焦点在外部菜单时不抢 | S5a、S5b；S7（`scroll` 与 `fill` 各一） |
| 容器网格：侧栏纵向与 Panel 横向各调整一次，核对主动轴与记录 revision；键盘、Escape 取消；收成 32px 后恢复记忆尺寸；降级与补偿不写盘 | S5a；S7 |
| 意图合成：整批拒绝、只改主动字段、未知字段保留；跨轴迟到的提交被拒；两个窗口改不同视图都保留、同一视图后保存胜出 | S1；S2（真实 Storage） |
| 记录超出容量：保存失败、状态栏提示、重试与放弃 | S2 |
| ActivityBar：选择互斥；重复点选中项打开被隐藏或拖到零的 Sidebar；显式恢复用记忆尺寸 | S4；S7 |
| 移动到与 `move-view`：目标表含同 ToolPart 容器；移动后入口与选中；参数三项齐全或全省略；无参经命令面板两步选择、取消无写入；菜单打开后移动、切模式或重试实例，旧点击零写入 | S3；S7（菜单与命令面板） |
| Panel 标题行：唯一拥有者；仅用键盘切容器、打开“移动到”、Esc 返回、最大化后聚焦；390 px 下单标签、长标签与五个框架按钮的溢出 | S5c；S7 |
| 实例停放：容器在 Part 之间移动、目标卸载与重新登记时退回停放区再搬回；来源 Part 显示空态；空 Part 与“成员仍在但全隐藏”时框架按钮可达 | S5b；S7 |
| 生命周期矩阵：从未交付的声明原位显示 `declared` 或受阻、失败原因；入口激活失败后“重试”产生新代次、布局保留；入口停止（`scope-closed`）卸载组件、保留布局、原位显示；`receiver-closed` 不当作删除；`receiver-closed` 后贡献方代次不变、句柄换新 | S3（真实内核）；S7（测试插件） |
| 三种失败与加载门禁：`load()` 失败“重新加载”只重试加载、代际加一；渲染出错“重试”重建实例、代际加一；入口停止后、撤回前返回的加载结果被丢弃 | S3（真实串行锁窗口）；S5b；S7 |
| 未知引用只在呈现中忽略并诊断、原件不删；默认指纹失效回到新默认并诊断 | S1；S2 |
| `focusedPart`：随焦点变化；移到外壳之外时保持原值 | S2；S7 |
| 主题与 390 px：新零件的颜色取 token，窄屏下 Switcher 与动作可达 | S7（计算样式与截图） |

## 验证

- 每片：上表的自跑验证；类型改动影响时跑三份 typecheck。
- 收口：`bun run test:affected --typecheck`、全量 e2e、`smoke:server`、`docs:check`、`governance:check`；交付前对验收映射逐条做变异检查。
- 真实环境：e2e 构建装上 `test.sample-views` 走完全链路；开发服务下的 Lab 截图（四主题 × 双配色 × 1440×900、390×844）与产品页截图存证据。
- 未验证边界：插件真正禁用与卸载（声明消失）只在纯模型测试里覆盖；正常停止后的入口再启用要插件管理；DPR 不验证（同 t65）。

## 不做

- 拖放、自建容器 `custom:<UUID>`、单视图分离与移到空区域、整组并入、半区比例、键盘拖放（外壳三）；声明式容器贡献点、视图的 `when`、标题动作贡献、揭示视图的服务（随消费者）；ActivityBar 底段的全局项（随账号、设置插件）；入口的正常停止后再启用（插件管理）。

## 风险

- 旧 `view-placements.ts` 的落位按“每区一个默认容器”写成，直接搬会把旧口径带进来：只参照插入、移动判定与尺寸补丁的写法，落位与呈现按设计稿第 3、8 节重写。
- 视图实例的 `load()` 与错误边界跨越插件信任边界：错误边界只覆盖 Vue 调用路径，组件自己的异步错误归所属插件（设计稿第 4 节），Spec 写明。
- `views-customizations` 字段变多：按第 3 节的前提估算容量，超出时走保存失败路径；需要大量插件视图时再为这条记录单独定上限。
- `window.plugins` 是新的宿主能力，给了工作台查询与重试别的入口的能力：只对声明了 `workbench.views` 的入口生效，Spec 写明边界。

## 审查处理

三份计划审查（`evidences/plan-review-{design,lifecycle,impl}.txt`）合计 26 条，都按推荐改入计划：

| 审查条目 | 处理 |
|---|---|
| D04、L1、D04 补充 | 注册表分声明目录与交付句柄两种输入；新增宿主能力 `window.plugins` 给入口状态与重试（第 1 节） |
| L3 | 每次加载经 `handle.implementation()`，结果回来核对句柄与 `published`（第 1 节） |
| D06、L5 | 本片不做声明式容器，按设计稿留给第一个分组消费者（第 1 节） |
| D02、L2、impl 1 | 不提供“新建容器”，只移到已有容器；单视图分离随外壳三（第 5 节，待确认） |
| D08 | 目标表含同一 ToolPart 的容器（第 2 节） |
| D01 | `move-view` 保留来源容器；菜单目标身份变化即关闭，过期点击零写入（第 4、5 节） |
| D07、L7、impl 2 | 无参经选择服务两步选择（第 5 节） |
| D03 | 模式、收起与标题行规则在呈现模型一次求定（第 2 节） |
| D05、L6 | 起源声明消失时回落到首个实际成员的默认位置并诊断（第 2 节，待确认） |
| D09、L8、impl 4 | 抽出 `teleport-memory.ts`，三层共用；`focusedPart` 取值定义（第 3、4 节） |
| impl 3、L4 | 测试插件的后端装配与三条真实入口状态路径（第 6 节） |
| impl 5 | PanelSurface 是 Panel 标题行唯一拥有者，开导航槽（第 4 节） |
| impl 6 | 容器网格的浏览器验收（验收映射） |
| impl 7 | S5 拆为 S5a–S5c；集成 Lab 场景作为验证入口 |
| L9 | 容量前提与超限场景（第 3 节） |
| lifecycle 决定点 4 | 同一视图并发移动按现行 Spec 后保存胜出，菜单过期在接纳时检查（第 2 节） |
