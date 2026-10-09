---
schema: nbook.proposal/v1
status: accepted
created: 2026-10-06
decided: 2026-10-07
supersedes: []
superseded-by: null
specs:
  - docs/specs/ui/workbench-shell.md
  - docs/specs/workbench/commands.md
  - docs/specs/storage/persistence.md
adrs: []
---

# 工作台外壳的抽象（v2）

2026-10-06 起草，2026-10-07 按 omp 审查 11 条与运行时拓扑的决定修订。外壳实现排在运行时拓扑 K5 之后。

本稿定义新应用 `nbook.workbench` 的外壳抽象：Part、ActivityBar、Switcher、ViewContainer、View 各是什么、归谁、怎样与插件体系接上，以及外壳实现的切片。

- **行为合同**：仍以 [`ui/workbench-shell.md`](../specs/ui/workbench-shell.md) 与 [`ui/nested-grid.md`](../specs/ui/nested-grid.md) 为准，本稿只给出它们在 v2 上的修订方向。
- **与 View Host 提案的关系**：本稿沿用 [Workbench 与 View Host](workbench-view-host.md) 已接受的分层（Part、容器、视图三层位置、布局状态分层、三种拖动、覆盖记录的默认指纹），取代其中的 descriptor 字段与持久化细节（见“对旧设计的取舍”）。
- **与运行时拓扑的关系**：外壳实现排在 [多实例运行时拓扑](multi-instance-runtime-topology.md) 的 K1–K5 之后。外壳状态用 [插件状态 store](plugin-data-model.md)（`defineStore`）写，布局记录直接存 `nbook.storage`，面板命令的可用条件读工作台的公开状态。
- **审查**：omp 审查 11 条与核实见 [t50 证据](../../.agents/works/w00017-application-runtime-architecture/tasks/t50-workbench-shell-design/evidences/omp-review.txt)；本稿各节注明对应的条目。

## 问题

1. **旧外壳不能原样搬。** 旧应用 `app/utils/workbench/`、`app/components/workbench/` 约 2.1 万行（不含测试）。
   - 抽象本身成熟：Part、容器、视图、落位模型、拖放判定、实例停放层。
   - 约三分之一（7000 行）是旧后端的接线：Storage 宿主的 CAS 会话、Project 与用户资产两类工作面、旧存储桶迁移、工具焦点与揭示端口；组件另由 `factoryKey` 经宿主白名单解析。
   - 新应用的 Storage、项目实例与插件状态 store 都按新拓扑重做，旧接线不迁。
2. **旧的 descriptor 是宿主写死的目录**（`product-catalog.ts`）。v2 里视图由插件贡献、组件由插件激活时交出（[平台设计 P7](extensible-application-platform.md#p7-浏览器宿主与第三方界面)），旧的描述对象需要改造：哪些字段留在可序列化的声明里，哪些改由实现交出，哪些暂不需要。
3. **旧设计留了一处没定的地方。** 三个默认容器（左栏工具、右栏 Agent、底部面板）各对应一个 Part，左栏容器注释写着要承载“文件树 / 角色 / 情节”三个视图。但旧图标栏上这三个是各自独立的入口，只有文件树真正迁进了视图模型，两种组织方式从未对齐。
4. **开发者要求**：workbench 的贡献点按真实消费者逐个加，不一次做全；外壳抽象要先设计好，参照 VS Code 的 Part、ActivityBar、Switcher、ViewContainer、View。

## 目标与非目标

**目标**

- 给出一套对象模型：每个对象有定义、所有者、持有的状态、不做的事，并写明是工作台固定的还是插件可贡献的。
- 给出三类容器的身份规则与视图实例的生命周期矩阵。
- 给出插件面向的视图合同（声明、实现、实例、失败呈现），等第一个消费者（Files）出现时原样实现。
- 给出布局状态的记录划分、公开状态键与纯模型的输入输出；纯模型可以用 `bun test` 直接测。
- 把外壳实现切成可独立验收的 Task。

**非目标**

- 不重新讨论 `ui/workbench-shell.md` 已批准的交互细节（面板四态、拖放行为表、半区分配等），只决定它们落在哪个切片。
- 不实现编辑器分组与标签（随编辑器插件，编辑器选型未定）、跨窗口布局同步的即时应用、第三方插件加载。
- 不做 Part 的任意重排、跨窗口浮动、状态栏换位（View Host 提案已列为以后）。

## 当前行为与证据

- **新应用**：`nbook.workbench` 的浏览器入口提供页面表与贡献点 `workbench.pages`。`/` 页只有空工作台和命令宿主（[t49](../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md)），没有外壳。产品命令表现在不认任何上下文键，带 `when` 的命令贡献被拒（`packages/neuro-book/src/plugins/commands/shared/plugin.ts` 的 `PRODUCT_CONTEXT_KEYS`）。
- **nb-ui 已有领域无关的布局原语**，新应用直接消费：`createGrid`、`GridRenderer`、`Splitter`；sash 手势会话；`resolveGridInsertion`、`resolveListInsertion`；`DropIndicator`、`DropFeedbackOverlay`。
- **旧外壳的分层**（`packages/neuro-book-legacy/app/`）：
  - 纯模型：`descriptors.ts` 注册表、`view-placements.ts` 落位与意图、`layout.ts` 外壳几何、`view-container-layout.ts` 容器单轴编排、`workbench-drop.ts` 拖放判定；`product-catalog.ts` 的纯求值另输出常驻容器集合（`residentContainers`），并在容器没有可见首成员时回落到声明或起源视图。
  - 会话：`layout-session.ts`、`view-placements-session.ts`，各是一类记录的唯一写者。
  - 渲染：`WorkbenchShellLayout` 是纯几何，结构变化后恢复原焦点；`WorkbenchPartHost`、`WorkbenchViewHost` 渲染已求值的切片；`WorkbenchContainerInstances`、`WorkbenchViewInstances` 用 Teleport 在 Part 之间搬 DOM，让实例在移动与切换时不重建。
  - 这套分层经过 2026-09-13 至 09-22 的多轮审查与验证台实测，本稿保留。
- **内核的撤回原因**（[`runtime/plugins.md`](../specs/runtime/plugins.md)）：`scope-closed`（贡献方关闭）、`receiver-closed`（拥有者关闭，贡献回到等待接收者）、`delivery-failed`（补交失败）。这三种情况下静态声明都还在。
- **VS Code 的对应物**（[调研 03](../research/vscode/03-workbench-layout-views.md)）：`Parts` 词表；用 `SerializableGrid` 表示外层区域树；视图注册表与 `ViewContainerModel`；跨容器位置记在 `views.customizations`；`CompositeBar`：活动栏与面板标题里的容器切换条。

## 方案

### 1. 原则

1. **工作台拥有布局，插件只声明和提供内容。** 用户的每个操作（切换、收起、移动、拖放、调尺寸）都是交给工作台的意图，工作台校验后应用，并经工作台 store 的 action 写入布局记录。插件组件不改布局。
2. **声明与实例分开。** 声明可序列化，登记时校验；实现（组件）由插件激活时交出；实例由工作台按可见性创建与保留。
3. **渲染只消费求值结果。** 可见性、落位、容器模式、标题回落、常驻资格都在纯模型里算成一份呈现模型，组件不各自重算（View Host 评审遗留第 11 项）。
4. **几何原语归 nb-ui，拓扑与策略归工作台。** 外壳不另写拖拽、夹取或快照解析。
5. **三种移动互不替代**（沿用 View Host）：移动视图改视图的归属；移动容器改容器所在的 Part；改面板位置改外壳拓扑。
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
│  ├─ Editor ─────────── 内容由编辑器插件提供（编辑器选型未定）
│  └─ StatusBar
├─ ViewRegistry：容器与视图的声明
├─ Placement：默认落位 + 用户定制 → 实际落位
└─ 工作台 store（defineStore）：布局记录、内存状态、公开状态与 action
```

| 对象 | 是什么 | 所有者与状态 | 不做什么 | 可贡献 |
|---|---|---|---|---|
| **Workbench** | 一个窗口的外壳根，也是布局的唯一写者 | `nbook.workbench`；持有注册表、落位、工作台 store、实例表 | 不读写领域数据 | 否 |
| **Part** | 七个固定区域：`titlebar`、`activitybar`、`sidebar`、`auxiliarybar`、`editor`、`panel`、`statusbar` | 外壳；区域级几何与可见性（显示、隐藏、拖到零、32px 标题头、瞬时最大化，按 Spec 各 Part 适用的子集） | 不知道里面是哪个容器、哪个视图 | 否：Part 集合与拓扑固定 |
| **ToolPart** | 能承载容器的三个 Part：`sidebar`、`auxiliarybar`、`panel`；也就是容器的“位置” | 外壳；当前选中的容器、本区域的 Switcher | 不持有视图正文 | 否 |
| **Switcher** | 在一个 ToolPart 里选容器的导航，也是容器级拖放的插入位 | 工作台；条目是位于该区域、至少有一个实际成员的容器，按顺序排列，至多一个选中 | 不持有视图；不是 Part | 否 |
| **ActivityBar** | 主体左侧通高列。上段呈现 Sidebar 的 Switcher，底段放全局项（以后：账号、设置） | 外壳；重复点击当前项会保持选择，并打开被隐藏的 Sidebar | 不切换别的区域的容器 | 全局项以后可贡献（随账号、设置插件） |
| **ViewContainer** | 一组视图的归属与单轴排列单位；一个容器对应 Switcher 上的一个条目 | 工作台；位置、在该区域内的顺序、成员与顺序、成员尺寸与收起；可见成员数决定 empty、single、multiple 三种模式；区域决定轴向（侧栏纵向、Panel 横向） | 不随移动、模式切换或换轴重建视图实例 | 声明式容器以后可贡献（第一个需要把多个视图归为一组的消费者） |
| **View** | 一项工具能力的内容面板 | 插件提供声明与组件；工作台持有实例、落位与尺寸 | 不自己决定落在哪里，不改布局 | 是（`workbench.views`，第一个消费者是 Files） |
| **Editor** | 编辑器区域 | 外壳拥有区域与稳定的内容槽（最大化时停放而不卸载）；组与标签归编辑器插件 | 不走视图模型 | 随编辑器插件定 |
| **StatusBar / TitleBar** | 状态栏、标题栏 | 外壳拥有区域；条目与菜单以后可贡献 | 不显示假数据 | 条目、菜单以后可贡献 |

### 3. 容器身份（审查第 1、4 条）

**三类容器，id 互不重叠：**

| 来源 | id | 何时产生 |
|---|---|---|
| 隐式容器 | `view:<起源视图 id>` | 视图声明没写 `container` 时，它默认属于自己的隐式容器 |
| 声明式容器 | 插件声明的 id，不得以 `view:` 或 `custom:` 开头 | 随第一个需要分组的消费者 |
| 自建容器 | `custom:<UUID>` | 用户把单个视图拖到 Switcher 时生成，保存在用户定制里 |

- 隐式容器的 id 只由起源视图决定，与所在区域、当前成员无关；默认位置取起源视图声明的 `location`。
- **容器是否出现，看实际成员**：先由“默认落位 + 用户定制”求出每个视图的实际归属，再把至少有一个实际成员的容器放进 Switcher。容器本身不单独记“存在”，所以恢复默认不会制造空入口。
- 布局记录统一用上表的 id 引用三类容器。
- **用户覆盖记录它基于哪一版默认**（View Host 规则 ①）：视图或容器的默认位置变化后，基于旧默认的覆盖失效，回到新默认并记诊断。

**典型情况**（A、B 都是没写 `container` 的视图）：

| 情况 | 结果 |
|---|---|
| 初始 | `view:A` 只含 A，`view:B` 只含 B，各占一个入口 |
| 把 B 拖进 `view:A` | B 的归属覆盖为 `view:A`；`view:B` 没有实际成员，从 Switcher 消失 |
| 再把 A 拖到别的容器 | `view:A` 仍含 B，入口保留，id 不变；标题与图标按下面的回落顺序取 B 的 |
| 刷新 | 由同一份定制求出同样的结果，不产生空入口 |
| 重置 A | 清除 A 的覆盖，A 回到 `view:A`（与 B 同处） |
| 重置 B | 清除 B 的覆盖，B 回到 `view:B`，`view:B` 重新出现 |
| A 的插件被禁用 | A 的声明消失，按第 4 节清理 A 的布局项；`view:A` 若仍有 B 则保留，标题回落到 B |
| A 改了默认位置（插件升级） | 基于旧默认的覆盖失效，A 与 `view:A` 回到新默认位置并记诊断 |

**容器的标题与图标**，纯模型按固定顺序求出，活动栏、标签、“移动到”菜单只读这一个结果：

1. 首个可见成员；
2. 首个实际成员（成员都被隐藏或条件不满足时）；
3. 声明式容器自己的声明，或隐式容器起源视图的声明（起源视图仍有声明时）；
4. 可诊断的兜底：容器 id，并记一条诊断。

容器的实际成员数归零时，从 Switcher 移除；全部成员只是隐藏或条件不满足时不移除。

### 4. 视图的三层与生命周期（审查第 3、9、10、11 条）

| 层 | 内容 | 生命周期 |
|---|---|---|
| 声明 | id、标题、图标、默认位置或所属容器、顺序、`layout: scroll \| fill`、尺寸约束、能否移动 | 贡献登记时校验；随贡献方插件启用而存在 |
| 实现 | `load(): Promise<Component>`，与页面贡献同一形状 | 插件入口激活时交出；首次可见时才加载 |
| 实例 | 组件实例与代际号 `generation` | 首次可见时创建；见下面的矩阵 |

**移动保留实例**：隐藏、切换容器、移动、换轴都只停放（Teleport），不重建。这与 [平台设计 P7](extensible-application-platform.md#p7-浏览器宿主与第三方界面) 现行的“离开容器……时释放”相反，以本稿为准，P7 的这一句列入预期改动。

**生命周期矩阵**：

| 事件 | 实例 | 实现与加载缓存 | 声明 | 布局项 | 呈现 |
|---|---|---|---|---|---|
| 用户隐藏、切换容器、移动、换轴 | 停放，不重建 | 保留 | 保留 | 按意图更新 | 正常 |
| 实现所属入口停止（`scope-closed`）、拥有者暂时关闭（`receiver-closed`）、补交失败（`delivery-failed`） | 卸载组件 | 丢弃实现与 `load()` 结果，当前代际作废 | 保留 | **保留** | 原位显示原因；入口恢复后用新代际重新交付并创建 |
| 入口受阻或激活失败 | 无实例 | 无 | 保留 | 保留 | 原位显示原因 |
| 插件被禁用、卸载，或声明真正消失 | 销毁 | 丢弃 | 消失 | 按 P7 清理该视图的布局项（只清实际撤回的视图，不误清同插件其它仍有效的视图） | 从呈现中移除 |
| 重新启用 | 新实例 | 新实现 | 重新出现 | 回到声明的初始位置 | 正常 |
| 工作台释放 | 销毁 | 丢弃 | — | 不变（已保存的记录保留） | — |

`receiver-closed` 只释放运行资源，不当作“用户删除定制”的意图。

**三种失败分开处理**：

| 失败 | 归谁 | 重试 |
|---|---|---|
| 插件入口激活失败或受阻 | 内核 | 经内核的显式恢复；视图原位显示原因 |
| `load()` 失败（组件模块加载失败） | 工作台的视图宿主 | “重新加载”只重试加载，代际加一 |
| 组件渲染或运行出错（Vue 错误边界接住的部分） | 工作台的视图宿主 | “重试”重建这个视图的实例，代际加一 |

- 一次加载绑定“声明身份 + 实现所属入口的激活代次 + 本视图的代际号”；结果回来时三者有一项变了就丢弃，不把旧组件挂上去。
- 错误边界只覆盖 Vue 调用路径；组件自己发起、没有交给 Vue 的异步错误由组件所属插件处理。

**`ViewContext` 的投递**：组件经只读的 `context` 属性收到 `ViewContext`（见第 5 节）。代际号在工作台存活期内按视图 id 单调递增，视图撤回后再登记也不复用旧编号；工作台重建后旧回调全部作废。代际号不写进布局记录。

### 5. 插件面向的视图合同（随 Files 实现）

```ts
// 贡献点 workbench.views；贡献 id 就是视图 id，id 规则同命令：nbook.* 插件写 nbook.<名>，其它插件以自己的插件 id 开头。
interface ViewDeclaration {
    readonly title: LocalizedText;          // 中英文本，与命令标题同一方案
    readonly icon: string;                  // 图标类名，例如 i-lucide-files
    readonly location: "sidebar" | "auxiliarybar" | "panel"; // 默认位置
    readonly container?: string;            // 并入已声明的容器；省略时属于隐式容器 view:<本视图 id>
    readonly order?: number;                // 同一位置或容器内的顺序，同值按 id
    readonly layout: "scroll" | "fill";     // scroll：外壳给内边距并负责滚动；fill：视图占满、自己滚动
    readonly minimumSize?: {width?: number; height?: number};
    readonly maximumSize?: {width?: number; height?: number};
    readonly movable?: boolean;             // 默认 true
}
interface ViewImplementation {
    load(): Promise<Component>;             // 只负责取得组件定义；实例由工作台创建
}
// 组件的 props：{context: ViewContext}
interface ViewContext {
    readonly id: string;
    readonly generation: number;
    readonly visible: Readonly<Ref<boolean>>;   // 当前是否显示；停放与加载中都不算显示
    readonly location: Readonly<Ref<"sidebar" | "auxiliarybar" | "panel">>;
}
```

以下各项随消费者再加，本稿只占位：
- 标题动作（命令 id 加位置，标题与图标取命令元数据）；
- 视图的 `when`（读公开状态，随第一个需要条件显示的视图）；
- 供其它插件打开或揭示视图的服务（随第一个需要揭示视图的插件，例如 Agent 揭示文件树）。

视图自己的持久化状态由视图所属插件用自己的 store 声明，不在视图声明里加 `stateScope`。

### 6. 布局状态（审查第 2、5、6 条）

**记录划分**按 [`storage/persistence.md`](../specs/storage/persistence.md) 的归属表，三条记录都用 `defineRecord` 定义、经 `nbook.storage` 保存：

| 记录 | 分区 | 内容 | 写入时机 |
|---|---|---|---|
| `layout-sizes-side` | project / local（未开项目时 user / local） | Sidebar、AuxiliaryBar 宽度 | 主动调整结束 |
| `layout-sizes-panel` | project / local（未开项目时 user / local） | Panel 高度与宽度 | 主动调整结束 |
| `views-customizations` | user / local | 面板位置、对齐、隐藏、收起；Part 显隐与拖到零；容器位置、顺序与各区域选中项；视图归属、顺序、尺寸、收起；自建容器；每条覆盖基于的默认指纹 | 每个意图一次合成 |
| 只在内存 | — | 瞬时最大化、紧凑呈现、拖动预览、焦点 | 不保存 |

- 测量、夹取、临时显隐、拖动期间都不保存。
- 每条记录带版本。损坏或版本不支持：回落默认布局显示并记诊断，原件保留，普通保存不覆盖它（只有有效迁移或用户显式重置才替换）。
- 快照里引用了未知容器或视图：只在呈现时忽略这一条并记诊断，原件不删；临时缺少插件不等于该插件已被禁用。
- 尺寸越界：夹取显示并记诊断，不因夹取改写记录。

**持久化字段的状态**沿用 [插件的数据与状态](plugin-data-model.md) 的四部分模型：读取分类、已确认值与 revision、当前显示、未保存意图与保存状态。

- 读取就绪前显示默认布局，尺寸调整控件不可用；读取失败后允许暂时调整，并明确显示“未保存”。
- 拖动只改当前显示；结束时提交一次意图。同一记录按提交顺序串行保存。
- 条件保存冲突：重读后只重放本次主动修改的字段，再保存一次；再失败则保留当前显示与未保存意图，提供重试与放弃。
- **多窗口**：两个窗口共用同一条记录。另一个窗口保存后，本窗口的订阅只更新已确认值，不强行改变当前布局；本窗口之后的保存以条件保存防止覆盖对方。

**工作台 store**（示意，字段按上表）：

```ts
const workbench = defineStore("workbench", {
    persisted: {side: persist(sideSizesRecord), panelSize: persist(panelSizesRecord), customizations: persist(customizationsRecord)},
    memory: {maximized: false, compact: false, focusedPart: "editor"},
    derived: {presentation: (s) => buildPresentation(/* 见第 7 节 */)},
    public: {/* 见下表 */},
    actions: {setPanelPosition(position) {/* 校验 → 合成 customizations 意图 → 提交 */}},
});
```

### 7. 公开状态与面板命令（审查第 7 条）

工作台在清单里静态声明公开状态键（键名在修订 `workbench/commands.md` 时定稿）；store 激活时为本入口代次绑定读取函数。

按现行 `workbench/commands.md`，`when` 是一组布尔键的“全部为真”（`when.requires: [...]`），不支持比较、或、非；保持这一语法（键位冲突裁决依赖它）。所以给 `when` 用的键是**正向的布尔键**，由 store 的 `public` 从当前显示派生；字符串等其它标量也公开，供 Agent 与其它插件读取，不进 `when`。

| 键 | 类型 | 未就绪时 | 含义 |
|---|---|---|---|
| `workbench.layoutReady` | 布尔 | `false` | 三条布局记录读取完成 |
| `workbench.nonCompact` | 布尔 | `false` | 不在紧凑呈现 |
| `workbench.panelHorizontal` | 布尔 | `false` | 面板在底部或顶部 |
| `workbench.panelMaximizable` | 布尔 | `false` | 面板在左右两侧，或水平且居中对齐 |
| `workbench.panelVisible` | 布尔 | `false` | 面板显示中 |
| `workbench.panelMaximized` | 布尔 | `false` | 面板瞬时最大化中 |
| `workbench.panelPosition` | 字符串 | `bottom` | 面板位置（只供读取，不进 `when`） |
| `workbench.panelAlignment` | 字符串 | `center` | 面板对齐（同上） |
| `workbench.focusedPart` | 字符串 | `editor` | 焦点所在 Part（同上） |

`workbench/commands.md` 第二批面板命令的条件改写为：

| 命令 | Spec 条件 | `when.requires` |
|---|---|---|
| `nbook.view.set-panel-position` | 外壳就绪且非紧凑呈现 | `workbench.layoutReady`、`workbench.nonCompact` |
| `nbook.view.set-panel-alignment` | 水平位置且非紧凑呈现 | `workbench.panelHorizontal`、`workbench.nonCompact` |
| `nbook.view.set-panel-hidden` | 外壳就绪 | `workbench.layoutReady` |
| `nbook.view.set-panel-collapsed` | 水平位置 | `workbench.panelHorizontal` |
| `nbook.view.toggle-panel-maximized` | 左右位置或水平居中且非紧凑呈现 | `workbench.panelMaximizable`、`workbench.nonCompact` |

### 8. 呈现模型的输入与输出（审查第 8 条）

纯模型 `buildPresentation(input) → output`，组件、DOM 元素、`load()` 的 Promise 与“已创建的实例表”都不进入纯模型，留在运行层。

| 输入 | 内容 |
|---|---|
| 声明与可用性 | 视图与容器的声明；每个视图的实现状态（可用、加载失败、入口受阻并附原因） |
| 用户定制 | `views-customizations` 的当前显示值（含默认指纹） |
| 内存条件 | 紧凑呈现、各区域的临时显隐、用户隐藏偏好 |

| 输出 | 内容 |
|---|---|
| 实际归属 | 每个视图属于哪个容器、顺序；每个容器在哪个 ToolPart、顺序 |
| 导航 | 每个 ToolPart 的 Switcher 条目（含标题与图标的回落结果）与选中项 |
| 当前切片 | 每个 ToolPart 选中容器的模式（empty、single、multiple）、可见视图与尺寸 |
| 常驻资格 | 哪些容器、视图有资格保留已创建的实例（有实际成员的容器都常驻，不只是选中的那个） |
| 空状态与原因 | 空 Switcher、无可见视图、视图不可用的原因 |
| 诊断 | 失效覆盖、未知引用、夹取等 |

**意图合成** `applyIntent(state, intent) → rejected | unchanged | patch`：

- 来源、轴、锚点任何一项失效，整批拒绝，不逐个应用留下半状态；
- 补丁只改本次主动修改的字段，其余字段与未知数据原样保留。

用下列矩阵固定结果：切换容器；容器成员 1 → 2 → 1；最后一个成员移出（容器归零）与全部成员隐藏（容器保留）；跨轴移动时迟到的提交。

### 9. 代码分层（`packages/neuro-book/src/plugins/workbench/web/`）

| 目录 | 内容 | 依赖与测试 |
|---|---|---|
| `shell/` | Part 词表；外壳拓扑（面板四位置 × 四对齐决定主体形状）；尺寸分配、紧凑呈现与降级 | 纯 TS，`bun test` |
| `views/` | 注册表（声明校验与 id 规则）、落位（默认 + 定制 → 实际）、呈现模型、意图合成、拖放判定 | 纯 TS，`bun test` |
| `state/` | 三条布局记录的定义；工作台 store（持久化字段、内存、派生、公开、action） | Bun 与 Vitest |
| `components/` | `WorkbenchShell`（外壳几何，用 `GridRenderer`）、`ActivityBar`、`SwitcherTabs`、`ToolPartHost`、`ViewContainerHost`、`ViewSection`、容器与视图两个实例层、`StatusBar`、`TitleBar`、编辑器内容槽 | Vitest（真实 nb-ui）、Lab 场景、e2e |

- 命令 `nbook.view.*` 由工作台贡献给 `commands.definitions`（`workbench/commands.md` 第二批）。`refresh-files` 属于 Files，随 Files 加入。
- Lab 场景用局部工作台 store 与样例视图（与 t49 命令场景同一做法），不把样例视图贡献进产品工作台。编辑器内容槽用有输入与挂载计数的 Lab 内容验证停放不卸载。

### 10. 对旧设计的取舍

| 旧设计 | v2 | 理由 |
|---|---|---|
| `factoryKey` 加宿主白名单解析组件 | 实现交出 `load()` | 平台设计 P7 已修订 |
| `titleKey`（i18n key） | `LocalizedText` | t49 已定，不引入 vue-i18n |
| 容器位置枚举 `sidebar-left \| sidebar-right \| panel \| window` 与 Part `left/right` | 位置就是 ToolPart id：`sidebar \| auxiliarybar \| panel`；去掉预留的 `window` | 少一层映射；浮动窗口不做 |
| 每个区域一个默认容器，视图都并进去 | 视图默认属于自己的隐式容器；需要分组时再声明容器 | 与图标栏“一个工具一个入口”一致；补上旧设计没对齐的地方 |
| `requiredAuthority`（project/session/job/files） | 去掉。视图在自己的界面里表达“没有项目”等状态，动作可用性由命令的 `when` 与执行结果给出 | 枚举绑定旧后端；与命令可用性重复 |
| `stateScope` | 去掉；视图的持久化状态由所属插件用自己的 store 声明 | Storage 按插件划分命名空间，不按视图 |
| `canToggleVisibility` | 推迟到有隐藏需求的消费者 | 旧产品也没有真实落账通道 |
| CAS 会话、外来订阅、工作面切换、旧存储桶迁移 | 由 `nbook.storage` 的条件保存与订阅、store 的持久化字段承担；旧存储桶迁移不做 | 新拓扑已有对应机制；新应用没有旧数据 |
| 七个 Part、面板四态、紧凑呈现、容器单轴、实例停放、拖放行为表、半区分配、默认指纹 | 保留，按切片迁入 | 已批准、已验证 |

### 11. 切片

外壳实现排在运行时拓扑 K5 之后（2026-10-07 开发者决定）；编号在创建时按 Work 最大值连续分配：

| 切片 | 范围 | 验收要点 |
|---|---|---|
| 外壳一：外壳与布局 | 七个 Part 的外壳几何（nb-ui `GridRenderer` 与 sash）；面板四位置 × 四对齐、隐藏、32px 标题头、拖到零、瞬时最大化；紧凑呈现；工作台 store 与两条尺寸记录、用户定制中的面板与 Part 状态；公开状态键；`nbook.view.set-panel-*` 与最大化命令；状态栏的显示面板入口；`/` 页套上默认产品主题；编辑器内容槽；Lab 外壳场景 | `ui/workbench-shell.md` 中外壳几何、面板与布局恢复的场景；面板命令的 `when` 随公开状态变化；两窗口共用记录不互相覆盖；四主题 × 双配色、390 px |
| 外壳二：容器与视图 | 注册表、落位与呈现模型、意图合成；ActivityBar 与面板、右栏的 Switcher；三类容器身份与标题回落；容器三种模式与单轴排列；两个实例层；生命周期矩阵与三种失败；`nbook.view.move-view` 与“移动到”菜单；Lab 样例视图场景 | 第 3 节典型情况表；容器选择、模式切换时实例与输入保留；入口停止后保留布局、恢复后用新代际；未知引用只在呈现中忽略 |
| 外壳三：拖放 | 视图与容器拖放、自建容器、整组并入、半区按来源比例分配、键盘拖放、拖影与落点反馈 | Spec 的拖放行为表、方向与命中表 |
| 第 6 步 Files | `workbench.views` 贡献点（第一个消费者） | 视图合同 |

## 待定项

无。原待定项 1–3 已批准（其中持久化后端由“先存 `localStorage`”改为直接用 `nbook.storage`，见决策记录），待定项 4 由“外壳排在 K5 之后”取代。公开状态的键名在修订 `workbench/commands.md` 时定稿。

## 数据、接口、安全、迁移、发布与回滚影响

- **数据**：三条布局记录经 `nbook.storage` 保存在 user 或 project 分区，不触碰领域数据。新应用未发布，不需要从旧应用迁移布局。
- **接口**：`workbench.views` 的声明形状、`ViewContext` 与工作台公开状态键是对插件公开的合同；视图合同随 Files 落地时写入 Spec，公开状态键随外壳一写入。
- **安全**：视图组件在工作台组件树内渲染，外包错误边界（平台设计 P7）。本稿不改变信任模型。
- **回滚**：每个切片单独提交。

## 对 Spec 与提案的预期改动

- **`ui/workbench-shell.md`**（planned）按 v2 修订：
  - 术语、对象模型与三类容器身份按本稿；
  - 删去旧产品专属内容：固定入口清单（角色、情节、World Engine 等）、用户资产工作面、旧存储键；
  - CAS 与外来订阅一节改为 `nbook.storage` 的条件保存与订阅；
  - 验收场景按外壳一至三分组重写，编辑器分组与标签的场景移到编辑器插件。
- **`workbench/views.md`**（新，planned）：插件面向的视图合同（声明、实现、实例生命周期矩阵、三种失败、撤回与受阻呈现、验收）。随 Files 实现。
- **`workbench/commands.md`**：第二批命令的“随 t50”改为“随外壳一、外壳二”；面板命令的条件改写为读工作台公开状态的 `when`；公开状态键登记。
- **`storage/persistence.md`**：本稿的三条记录与其归属表一致；只需在“首批消费者”中登记记录名。
- **[平台设计 P7](extensible-application-platform.md#p7-浏览器宿主与第三方界面)**：“离开容器或所属插件被禁用时释放”改为“用户移动只停放；实现所属入口停止时卸载但保留布局；插件被禁用或声明消失时释放并清理布局项”。
- **`ui/nested-grid.md`**：不改。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-06 | 开发者 | workbench 贡献点按真实消费者逐个加入；外壳抽象参照 VS Code 在 t50 之前单独设计一轮，交开发者审批（见 [t49](../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md)） |
| 2026-10-06 | 开发者 | 批准待定项 1–3：布局先经 `LayoutStore` 存 `localStorage`；视图未指定容器时自成隐式容器；对旧设计的取舍表 |
| 2026-10-07 | 开发者 | 先做 [多实例运行时拓扑](multi-instance-runtime-topology.md) 的 K1–K5，外壳实现排在其后；外壳状态用插件状态 store，面板命令的可用条件读公开状态；原定的 t51–t53 编号不再保留 |
| 2026-10-07 | 开发者 | 布局直接用 `nbook.storage`，不再经 `localStorage` 过渡；`LayoutStore` 端口删除 |
| 2026-10-07 | 主 Agent（待开发者审批） | 按 omp 审查 11 条修订：三类容器身份与典型情况表、标题回落顺序、移动保留实例并列入 P7 修订、生命周期矩阵、三种失败与加载代际、`ViewContext` 经 `context` 属性投递、三条布局记录按 Storage 归属表、持久化字段四部分状态与多窗口规则、公开状态键与面板命令的 `when`、呈现模型输入输出与意图合成 |
| 2026-10-07 | 开发者 | 认可修订稿，改为 `accepted` |
| 2026-10-08 | 主 Agent（待开发者确认，见 w00017 待确认清单） | 插件面向的视图合同（第 5 节）从 Files 提前到外壳二，写成 [`workbench/views.md`](../specs/workbench/views.md)，外壳二用 e2e 测试插件验收全链路；外壳二不做声明式容器（第 5 节的 `container?` 随它）与“新建容器”，多视图容器只经“移动到”形成；起源声明消失的隐式容器回落到首个实际成员的默认位置 |
| 2026-10-09 | 主 Agent（待开发者确认，见 w00017 待确认清单） | 外壳三的拖动手势自写指针会话，不引入 `@dnd-kit`（组件只加 DOM 标记，命中与判定每帧同步自算）；拖放的保存冲突政策：普通移动重建被另一窗口清掉的目标自建容器，带半区的并入前提不成立时整条不写 |
