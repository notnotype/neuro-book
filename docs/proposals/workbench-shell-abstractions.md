# 工作台外壳的抽象（v2）

## 状态

reviewing（2026-10-06 起草，交开发者审批）。

本稿定义新应用 `nbook.workbench` 的外壳抽象：Part、ActivityBar、Switcher、ViewContainer、View 各是什么、归谁、怎样与插件体系接上，以及第 4 步剩余部分的切片。

- **行为合同**：仍以 [`ui.workbench-shell`](../specs/ui/workbench-shell.md) 与 [`ui.nested-grid`](../specs/ui/nested-grid.md) 为准，本稿只给出它们在 v2 上的修订方向。
- **与 View Host 提案的关系**：本稿沿用 [Workbench 与 View Host](workbench-view-host.md) 已接受的分层（Part、容器、视图三层位置、布局状态分层、三种拖动），取代其中的 descriptor 字段与持久化细节（见“对旧设计的取舍”）。

## 问题

1. **旧外壳不能原样搬。** 旧应用 `app/utils/workbench/`、`app/components/workbench/` 约 2.1 万行（不含测试）。
   - 抽象本身成熟：Part、容器、视图、落位模型、拖放判定、实例停放层。
   - 约三分之一（7000 行）是旧后端的接线：Storage 宿主的 CAS 会话、Project 与用户资产两类工作面、旧存储桶迁移、工具焦点与揭示端口；组件另由 `factoryKey` 经宿主白名单解析。
   - 新应用没有这些后端：还没有 `nbook.storage`，也没有 Project。
2. **旧的 descriptor 是宿主写死的目录**（`product-catalog.ts`）。v2 里视图由插件贡献、组件由插件激活时交出（[平台设计 P7](extensible-application-platform.md#p7-浏览器宿主与第三方界面)），旧的描述对象需要改造：
   - 哪些字段留在可序列化的声明里；
   - 哪些改由实现交出；
   - 哪些暂不需要。
3. **旧设计留了一处没定的地方。** 三个默认容器（左栏工具、右栏 Agent、底部面板）各对应一个 Part，左栏容器注释写着要承载“文件树 / 角色 / 情节”三个视图。但旧图标栏上这三个是各自独立的入口，只有文件树真正迁进了视图模型，两种组织方式从未对齐。
4. **开发者要求**：
   - workbench 的贡献点按真实消费者逐个加，不一次做全；
   - 外壳抽象要先设计好，参照 VS Code 的 Part、ActivityBar、Switcher、ViewContainer、View。

## 目标与非目标

**目标**

- 给出一套对象模型：每个对象有定义、所有者、持有的状态、不做的事，并写明是工作台固定的还是插件可贡献的。
- 给出插件面向的视图合同（声明、实现、实例生命周期、失败呈现），等第一个消费者（Files，第 5 步）出现时原样实现。
- 给出代码分层与目录，纯模型可以用 `bun test` 直接测。
- 把第 4 步剩余的外壳工作切成可独立验收的 Task。

**非目标**

- 不重新讨论 `ui.workbench-shell` 已批准的交互细节（面板四态、拖放行为表、半区分配等），只决定它们落在哪个切片。
- 不在本步实现编辑器分组与标签（随第 5 步编辑器插件）、Project 作用域的布局记录（随 Project）、跨窗口同步、第三方插件加载。
- 不做 Part 的任意重排、跨窗口浮动、状态栏换位（View Host 提案已列为以后）。

## 当前行为与证据

- **新应用**：`nbook.workbench` 的浏览器入口提供页面表与贡献点 `workbench.pages`。`/` 页只有空工作台和命令宿主（[t49](../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md)），没有外壳。
- **nb-ui 已有领域无关的布局原语**，新应用直接消费：
  - `createGrid`、`GridRenderer`、`Splitter`；
  - sash 手势会话；
  - `resolveGridInsertion`、`resolveListInsertion`；
  - `DropIndicator`、`DropFeedbackOverlay`。
- **旧外壳的分层**（`packages/neuro-book-legacy/app/`）：
  - 纯模型：`descriptors.ts` 注册表、`view-placements.ts` 落位与意图、`layout.ts` 外壳几何、`view-container-layout.ts` 容器单轴编排、`workbench-drop.ts` 拖放判定。
  - 会话：`layout-session.ts`、`view-placements-session.ts`，各是一类记录的唯一写者。
  - 渲染：`WorkbenchShellLayout` 是纯几何；`WorkbenchPartHost`、`WorkbenchViewHost` 渲染已求值的切片；`WorkbenchContainerInstances`、`WorkbenchViewInstances` 用 Teleport 在 Part 之间搬 DOM，让实例在移动与切换时不重建。
  - 这套分层经过 2026-09-13 至 09-22 的多轮审查与验证台实测，本稿保留。
- **VS Code 的对应物**（[调研 03](../research/vscode/03-workbench-layout-views.md)）：
  - `Parts` 词表；
  - 用 `SerializableGrid` 表示外层区域树；
  - 视图注册表与 `ViewContainerModel`；
  - 跨容器位置记在 `views.customizations`；
  - `CompositeBar`：活动栏与面板标题里的容器切换条。

## 方案

### 1. 原则

1. **工作台拥有布局，插件只声明和提供内容。** 用户的每个操作（切换、收起、移动、拖放、调尺寸）都是交给工作台的意图，工作台校验后应用，并记入唯一的布局记录。插件组件不改布局。
2. **声明与实例分开。**
   - 声明可序列化，登记时校验；
   - 实现（组件）由插件激活时交出；
   - 实例由工作台按可见性创建与保留。
3. **渲染只消费求值结果。** 可见性、落位、容器模式在纯模型里算成一份呈现模型，组件不各自重算筛选规则（View Host 评审遗留第 11 项）。
4. **几何原语归 nb-ui，拓扑与策略归工作台。** 外壳不另写拖拽、夹取或快照解析。
5. **三种移动互不替代**（沿用 View Host）：
   - 移动视图改视图的归属；
   - 移动容器改容器所在的 Part；
   - 改面板位置改外壳拓扑。
6. **贡献点随第一个真实消费者加入**（2026-10-06 开发者确认）。本稿先定形状，实现跟着消费者走。

### 2. 对象模型

```text
Workbench（每个窗口一个；nbook.workbench 浏览器入口激活时建立）
├─ Shell：七个固定 Part 的拓扑与几何
│  ├─ TitleBar
│  ├─ ActivityBar ─────── 呈现 Sidebar 的 Switcher，底部放全局项
│  ├─ Sidebar ┐
│  ├─ AuxiliaryBar ├─ 工具区域（ToolPart）：Switcher + 当前 ViewContainer
│  ├─ Panel ┘                └─ View × n（单轴排列）
│  ├─ Editor ─────────── 内容由编辑器插件提供（第 5 步）
│  └─ StatusBar
├─ ViewRegistry：容器与视图的声明
├─ Placement：默认落位 + 用户定制 → 实际落位
└─ LayoutState：尺寸、面板与 Part 状态；经 LayoutStore 持久化
```

| 对象 | 是什么 | 所有者与状态 | 不做什么 | 可贡献 |
|---|---|---|---|---|
| **Workbench** | 一个窗口的外壳根，也是布局的唯一写者 | `nbook.workbench`；持有注册表、落位、布局状态、实例表 | 不读写领域数据 | 否 |
| **Part** | 七个固定区域：`titlebar`、`activitybar`、`sidebar`、`auxiliarybar`、`editor`、`panel`、`statusbar` | 外壳；区域级几何与可见性（显示、隐藏、拖到零、32px 标题头、瞬时最大化，按 Spec 各 Part 适用的子集） | 不知道里面是哪个容器、哪个视图 | 否：Part 集合与拓扑固定 |
| **ToolPart** | 能承载容器的三个 Part：`sidebar`、`auxiliarybar`、`panel`；也就是容器的“位置” | 外壳；当前选中的容器、本区域的 Switcher | 不持有视图正文 | 否 |
| **Switcher** | 在一个 ToolPart 里选容器的导航，也是容器级拖放的插入位 | 工作台；条目是位于该区域、至少有一个成员的容器，按顺序排列，至多一个选中 | 不持有视图；不是 Part | 否 |
| **ActivityBar** | 主体左侧通高列。上段呈现 Sidebar 的 Switcher，底段放全局项（以后：账号、设置） | 外壳；Sidebar 的 Switcher 由它呈现。重复点击当前项会保持选择，并打开被隐藏的 Sidebar | 不切换别的区域的容器 | 全局项以后可贡献（随账号、设置插件） |
| **ViewContainer** | 一组视图的归属与单轴排列单位；一个容器对应 Switcher 上的一个条目 | 工作台；位置、在该区域内的顺序、成员与顺序、成员尺寸与收起；可见成员数决定 empty、single、multiple 三种模式；区域决定轴向（侧栏纵向、Panel 横向） | 不随移动、模式切换或换轴重建视图实例 | 声明式容器以后可贡献（第一个需要把多个视图归为一组的消费者） |
| **View** | 一项工具能力的内容面板 | 插件提供声明与组件；工作台持有实例、落位与尺寸 | 不自己决定落在哪里，不改布局 | 是（`workbench.views`，第一个消费者是 Files） |
| **Editor** | 编辑器区域 | 外壳拥有区域；组与标签归编辑器插件（第 5 步定接口） | 不走视图模型 | 第 5 步定 |
| **StatusBar / TitleBar** | 状态栏、标题栏 | 外壳拥有区域；条目与菜单以后可贡献 | 不显示假数据 | 条目、菜单以后可贡献 |

**ViewContainer 的三种来源：**

- **隐式容器**：视图没有指定容器时，在其声明的默认位置自成一个容器。这是常见情况，Files、角色、情节各占一个图标栏入口。容器的标题与图标取首个可见视图的，与 Spec 2026-09-20 的规则一致。
- **声明式容器**：插件声明一个容器，几个视图指定并入它，在同一个条目下同屏排列（例如“资源”下放文件与大纲）。随第一个需要分组的消费者加入。
- **自建容器**：用户把单个视图拖到 Switcher 时生成，身份为 `custom:<UUID>`，按 Spec 保存在用户定制里。

容器的实际成员数归零时，从 Switcher 移除（声明保留）；全部成员只是隐藏或条件不满足时不移除。

**View 的三层：**

| 层 | 内容 | 生命周期 |
|---|---|---|
| 声明 | id、标题、图标、默认位置或所属容器、顺序、`layout: scroll \| fill`、尺寸约束、能否移动 | 贡献登记时校验，撤回时消失 |
| 实现 | `load(): Promise<Component>`，与页面贡献同一形状 | 插件激活时交出；首次可见时才加载 |
| 实例 | 组件实例与代际号 `generation`（重建时加一，用于拒绝迟到的动作） | 首次可见时创建。隐藏、切换容器、移动、换轴都保留（Teleport 停放）。声明撤回、插件禁用或工作台释放时销毁 |

视图组件出错时只影响它自己：原位显示错误与“重试”，重试会重建实例（代际加一）。插件入口受阻或激活失败时，视图保留落位，原位显示原因（平台设计 P7）。

### 3. 插件面向的视图合同（随 Files 实现）

```ts
// 贡献点 workbench.views；贡献 id 就是视图 id，id 规则同命令：nbook.* 插件写 nbook.<名>，其它插件以自己的插件 id 开头。
interface ViewDeclaration {
    readonly title: LocalizedText;          // 中英文本，与命令标题同一方案
    readonly icon: string;                  // 图标类名，例如 i-lucide-files
    readonly location: "sidebar" | "auxiliarybar" | "panel"; // 默认位置
    readonly container?: string;            // 并入已声明的容器；省略时自成隐式容器
    readonly order?: number;                // 同一位置或容器内的顺序，同值按 id
    readonly layout: "scroll" | "fill";     // scroll：外壳给内边距并负责滚动；fill：视图占满、自己滚动
    readonly minimumSize?: {width?: number; height?: number};
    readonly maximumSize?: {width?: number; height?: number};
    readonly movable?: boolean;             // 默认 true
}
interface ViewImplementation {
    load(): Promise<Component>;             // 组件收到 ViewContext
}
interface ViewContext {
    readonly id: string;
    readonly generation: number;
    readonly visible: Readonly<Ref<boolean>>;
    readonly location: Readonly<Ref<"sidebar" | "auxiliarybar" | "panel">>;
}
```

撤回与插件禁用时，按平台设计 P7 处理：
- 实例释放，该插件视图的布局项清理；
- 重新启用后回到声明的初始位置；
- 启用但受阻或失败时保留布局项。

以下各项随消费者再加，本稿只占位：
- 标题动作（命令 id 加位置，标题与图标取命令元数据）；
- `when`（需要上下文键服务，随编辑器插件）；
- 视图自己的持久化状态（随 `nbook.storage`）；
- 供其它插件打开或揭示视图的服务（随第一个需要揭示视图的插件，例如 Agent 揭示文件树）。

### 4. 布局状态与持久化

| 记录 | 内容 | 写入时机 |
|---|---|---|
| `workbench.layout` | Sidebar、AuxiliaryBar 宽度，Panel 高度与宽度 | 主动调整结束；测量、夹取、临时显隐不保存 |
| `workbench.views/customizations` | 面板位置、对齐、隐藏、收起；Part 显隐与拖到零；容器位置、顺序与各区域选中项；视图归属、顺序、尺寸、收起；自建容器 | 每个意图一次合成 |
| 只在内存 | 瞬时最大化、紧凑呈现、拖动预览、焦点 | 不保存 |

- 两条记录都带版本号。
- 损坏或版本不符：回落默认布局并记诊断，保留原件、不覆盖。
- 未知容器或视图：只丢这一条并记诊断，其余照常恢复。
- 尺寸越界：夹取并记诊断。

以上沿用 Spec。

工作台经一个窄端口读写记录：`LayoutStore {read(key), write(key, value)}`。适配器怎么选是待定项 1。

新应用暂时只有一个工作面（没有 Project），所以两条记录都是用户级。Project 作用域的尺寸与跨窗口同步，在 Project 与 `nbook.storage` 就绪后按 [`storage.persistence`](../specs/storage/persistence.md) 接入。

### 5. 代码分层（`packages/neuro-book/src/plugins/workbench/web/`）

| 目录 | 内容 | 依赖与测试 |
|---|---|---|
| `shell/` | Part 词表；外壳拓扑（面板四位置 × 四对齐决定主体形状）；尺寸分配、紧凑呈现与降级 | 纯 TS，`bun test` |
| `views/` | 注册表（声明校验）、落位（默认 + 定制 → 实际，意图 → 补丁）、呈现模型（各 ToolPart 的切片：Switcher 条目、选中容器、模式、可见视图）、拖放判定 | 纯 TS，`bun test` |
| `state/` | `LayoutStore` 端口与适配器；`WorkbenchState`：响应式，各记录的唯一写者，对外只收意图 | Vue 响应式；Bun 与 Vitest |
| `components/` | `WorkbenchShell`（外壳几何，用 `GridRenderer`）、`ActivityBar`、`SwitcherTabs`、`ToolPartHost`、`ViewContainerHost`、`ViewSection`、容器与视图两个实例层、`StatusBar`、`TitleBar`、`EditorPlaceholder` | Vitest（真实 nb-ui）、Lab 场景、e2e |

- 命令 `nbook.view.*` 由工作台贡献给 `commands.definitions`（[`workbench.commands`](../specs/workbench/commands.md) 第二批）。`refresh-files` 属于 Files，随 Files 加入。
- Lab 场景用局部 `WorkbenchState` 与样例视图（与 t49 命令场景同一做法），不把样例视图贡献进产品工作台。

### 6. 对旧设计的取舍

| 旧设计 | v2 | 理由 |
|---|---|---|
| `factoryKey` 加宿主白名单解析组件 | 实现交出 `load()` | 平台设计 P7 已修订 |
| `titleKey`（i18n key） | `LocalizedText` | t49 已定，不引入 vue-i18n |
| 容器位置枚举 `sidebar-left \| sidebar-right \| panel \| window` 与 Part `left/right` | 位置就是 ToolPart id：`sidebar \| auxiliarybar \| panel`；去掉预留的 `window` | 少一层映射；浮动窗口不做 |
| 每个区域一个默认容器，视图都并进去 | 视图默认自成隐式容器；需要分组时再声明容器 | 与图标栏“一个工具一个入口”一致；补上旧设计没对齐的地方 |
| `requiredAuthority`（project/session/job/files） | 去掉。视图在自己的界面里表达“没有项目”等状态，动作可用性由命令的 `when` 与执行结果给出 | 枚举绑定旧后端；与命令可用性重复 |
| `stateScope` | 推迟到 `nbook.storage` | 现在没有存储后端 |
| `canToggleVisibility` | 推迟到有隐藏需求的消费者 | 旧产品也没有真实落账通道 |
| CAS 会话、外来订阅、工作面切换、旧存储桶迁移 | 不迁。记录写入先只做本窗口顺序写；跨窗口与 Project 随存储与 Project 接入 | 新应用没有旧数据，也没有这些后端 |
| 七个 Part、面板四态、紧凑呈现、容器单轴、实例停放、拖放行为表、半区分配 | 保留，按切片迁入 | 已批准、已验证 |

### 7. 切片

本稿通过后建实现 Task，每个 Task 有真实结果后再开下一个：

| Task | 范围 | 验收要点 |
|---|---|---|
| t51 外壳与布局 | 七个 Part 的外壳几何（nb-ui `GridRenderer` 与 sash）；面板四位置 × 四对齐、隐藏、32px 标题头、拖到零、瞬时最大化；紧凑呈现；`workbench.layout` 与面板、Part 状态的持久化；`nbook.view.set-panel-*` 与最大化命令；状态栏的显示面板入口；`/` 页套上默认产品主题；Lab 外壳场景 | `ui.workbench-shell` 中外壳几何、面板与布局恢复的场景；四主题 × 双配色、390 px |
| t52 容器与视图 | 注册表、落位与呈现模型；ActivityBar 与面板、右栏的 Switcher；容器三种模式与单轴排列；两个实例层；视图错误边界与重试；`nbook.view.move-view` 与“移动到”菜单；Lab 样例视图场景 | 容器选择、模式切换时实例与输入保留、未知引用回落 |
| t53 拖放 | 视图与容器拖放、自建容器、整组并入、半区按来源比例分配、键盘拖放、拖影与落点反馈 | Spec 的拖放行为表、方向与命中表 |
| 第 5 步 Files | `workbench.views` 贡献点（第一个消费者）；编辑器区域的接口随编辑器插件 | 视图合同 |

## 待定项

1. **持久化后端**（推荐 a）：
   - (a) 现在由 `LayoutStore` 的浏览器 `localStorage` 适配器保存；`nbook.storage` 就绪后换成存储适配器，不迁移数据（新应用没有发布，无用户数据）。
   - (b) 先做 `nbook.storage`，再做外壳持久化。范围大，会把外壳推迟一个 Task。
2. **视图默认自成隐式容器**（推荐采用），见对象模型。备选是旧设计的“每个区域一个默认容器”：工具视图会叠在同一个侧栏容器里，与图标栏一个工具一个入口的期望不符。
3. **对旧设计的取舍表**：特别是去掉 `requiredAuthority`，以及推迟 `stateScope`、`canToggleVisibility`。
4. **切片 t51–t53**：设计 Task 占用 t50，实现从 t51 开始（原计划“t50 外壳”顺延）。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：新增两条用户级布局记录，不触碰领域数据。新应用未发布，不需要从旧应用迁移布局。
- **接口**：`workbench.views` 的声明形状与 `ViewContext` 是将来对插件公开的合同，随 Files 落地时写入 Spec。在那之前只有工作台内部使用。
- **安全**：视图组件在工作台组件树内渲染，外包错误边界（平台设计 P7）。本稿不改变信任模型。
- **回滚**：每个切片单独提交；持久化走端口，换后端不改调用方。

## 对 Spec 的预期改动

- **`ui.workbench-shell`**（planned）按 v2 修订：
  - 术语与对象模型按本稿；
  - 删去旧产品专属内容：固定入口清单（角色、情节、World Engine 等）、Project 与用户资产工作面、旧存储键；
  - CAS 与外来订阅一节注明随 `nbook.storage` 接入；
  - 验收场景按 t51–t53 分组重写，编辑器分组与标签的场景移到第 5 步。
- **`workbench.views`**（新，planned）：插件面向的视图合同（声明、实现、实例生命周期、撤回与受阻呈现、失败与验收）。随 Files 实现。
- **`workbench.commands`**：第二批命令的“随 t50”改为“随 t51、t52”。
- **`ui.nested-grid`**、**`storage.persistence`**：不改。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-06 | 开发者 | workbench 贡献点按真实消费者逐个加入；外壳抽象参照 VS Code 在 t50 之前单独设计一轮，交开发者审批（见 [t49](../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md)） |
| 2026-10-06 | 开发者 | 批准待定项 1–3：布局先经 `LayoutStore` 存 `localStorage`；视图未指定容器时自成隐式容器；对旧设计的取舍表 |
| 2026-10-07 | 开发者 | 先做 [多实例运行时拓扑](multi-instance-runtime-topology.md) 的 K1–K5，外壳实现排在其后；外壳状态用插件状态 store，面板命令的可用条件读公开状态；第 7 节切片的 t51–t53 编号不再保留。本稿按 omp 审查 11 条（见 [t50 证据](../../.agents/works/w00017-application-runtime-architecture/tasks/t50-workbench-shell-design/evidences/omp-review.txt)）修订前仍为 `reviewing` |
