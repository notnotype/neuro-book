# Workbench 与 View Host 提案

状态：accepted（2026-09-13 已获批准）

对应 Issue：[#192 建立类 VS Code 的 Workbench 与 View Host 抽象](https://github.com/notnotype/neuro-book/issues/192)（硬前置 #191 主应用 nb-ui 底座迁移）。

本提案引用先行调查用相对路径（如 [`../research/vscode/03-workbench-layout-views.md`](../research/vscode/03-workbench-layout-views.md)）；「研究 03」指该文件，同类的 08、12、15 同理。

## 问题

NeuroBook 的产品 UI 是**固定槽位**：Activity Bar 是写死的 capability 列表（`app/utils/workbench-chrome.ts:12-26`），侧栏、右栏、编辑器区各是一段模板，右栏 Agent 面板与左栏文件树是两套独立实现。结果是三件事都做不了：插件（含内置插件）注册入口、视图在栏间移动、按作用域恢复布局。

**布局状态目前分散在四处**：store 的 `novel.ide.local`（面板宽度/开关等，`app/stores/novel-ide.ts:221-235`、`:1988-2030`）与 `novel.ide.session`（每 Project 的编辑器会话，`:317-326`）、页面级 ref（`app/pages/index.vue`）、以及设置窗口尺寸（`nbook.settingsDialog.size`，宿主内直接读写 `localStorage`）。这四处的 owner、作用域与恢复时机互不相同。

**另有一处不应并入布局**：Agent 侧栏自己的 `localStorage` 存的是**固定会话身份**（workspace/project 范围的 pinned identity，`app/components/.../AgentModeSessionSidebar.vue:73-92`），它不属于布局状态，迁移时必须留在原处。

现状里唯一接近这套模型的是设置外壳：元数据驱动区段 + 受控插槽 + 宿主持有 I/O + `layout: scroll|fill` 合同 + 加载与失败的统一呈现（`app/components/novel-ide/settings/sections/NovelIdeSettingsView.vue:207-224`、同目录 `.types.ts:17-28`）。**注意**：最后一条有已知例外——目标切换失败时会保留旧快照且不报错，见文末「与 nb-ui 规范的关系」里的说明，不能当作已完全统一。它是**单容器、手写注册表**的特例，缺位置层、factory 绑定与 descriptor 级错误。

## 术语（首次出现处就地解释）

- **Part**：Workbench 的大区域（标题栏、图标栏、侧栏、右侧栏、编辑器区、面板、状态栏），拥有**区域级**几何、可见性与位置。
- **图标栏**（= Activity Bar = 活动栏）：图标入口条；图标项**有两类**——容器切换项与命令项（见下）。
- **View Container**：一组视图的归属单位，也是图标栏上的一个可切换项；拥有容器级状态。
- **View**：一项能力的描述与内容面板；有自己的可见性、最小尺寸与可动性。
- **PaneView**：容器内一维 **split view**（可拖分隔的并排/上下排列，分隔条称 **sash**）里的可布局 pane。
- **memento**：按 id 命名的一小块持久化存储（VS Code 术语），这里指「按视图 id 存的视图自身 UI 状态」。
- **Editor Part**：编辑器区域，内部是 Editor Group（第一版单组）；**不走 View 模型**。

> 上表中 View/PaneView 的生命周期（懒实例化、隐藏不销毁、离开容器释放）是**研究建议**，不是已验证合同：研究 03 明确把真实拖拽与重启恢复列为未验证。第一版按此实现，但把「何时释放」当作**可调整参数**，不写进持久化格式。
- **factoryKey**：descriptor 里指向"由谁创建这个视图"的键；解析走宿主白名单，**不存组件、不存模块路径**。
- **L1 / L2 / L3**：插件开放度的三档——**L1 内置**（模块随产品发布，用与第三方相同的注册 API）、**L2 声明式外部**（只有数据、无代码）、**L3 可执行第三方**（跑别人的代码，需安装账本/权限/沙箱）。

## 目标

1. **标题栏**：一个 Titlebar Part，支持自绘与 Electron 原生两种呈现。
   - 边界：平台外壳（原生窗口按钮、无边框/overlay 安全区、静态 menus 数据）仍归既有桌面任务与 `DesktopTitleBar`；Workbench 只拥有**自绘 chrome 的布局**与**菜单项数据**。
   - **注意**：仓库目前**没有**菜单注册表——这是本提案要新建的基础设施；第一版只做「最小菜单项数据 + 渲染」，不实现完整菜单贡献体系。
2. **图标栏**：图标项分两类——`kind: "container"`（点开切换容器）与 `kind: "command"`（执行命令或打开 Dialog）。现状里 `world / trace / history / settings / account` 属**第二类**（研究 12 的 Dialog/命令分类），其余才是容器。目标是让内置插件与将来的第三方走**同一条注册 API**（设计意图；第一版只实现内置解析器，L3 能否原样复用尚未验证）。
3. **侧栏**：容器的**默认位置**决定它落在主侧栏还是右侧栏；容器可在主侧栏 / 右侧栏 / 面板之间移动；**视图**也可跨容器移动（改的是视图归属，不是 Part 的父节点）。
4. **编辑器区**：`EditorPart`，第一版**单组 + Tab**。
5. **面板与状态栏**：`PANEL_PART` 支持位置与对齐；状态栏**第一版固定底部**（VS Code 也无此能力），"可换位置"见开放问题 4。

## 非目标（第一版明确不做）

- **不开放 L3 可执行第三方**：与 #192 非目标一致。
- **不做编辑器分屏**（多 Editor Group）。
- **不做把 Panel Part 拖到别处形成新分栏**（改变 Part 在布局树上的父节点）——与"视图跨容器移动"是两件事，见「三种拖动」。
- **不做跨窗口浮动**：`window` 只在位置枚举里保留，其真实行为研究未验证。
- **复用 resize 边界**：sash 与尺寸提交继续使用 `useResizablePanel` 和 nb-ui `Splitter`；嵌套与用户调整结束能力按 ui.nested-grid 扩展这些边界，不建立第二套面板持久化。
- **不把任意组件放进快照**；**不把 Dialog / 命令塞进 View 抽象**。

## 位置与意图（集中定义，避免三类移动混淆）

这里有**三个互不相同的位置概念**和一个排布属性，必须分开命名：

| 概念 | 含义 | owner | 载体 |
|---|---|---|---|
| **Part 位置** | 某个 Part 在布局树上的位置（左 / 右 / 底 / 顶） | 布局层 | `workbench.layout` |
| **容器位置** | 容器**默认**落在哪个 Part：`sidebar-left`（主侧栏）\| `sidebar-right`（即 AuxiliaryBar 辅助侧栏）\| `panel`（面板）；`window` 仅预留、真实行为未验证 | descriptor | 容器声明 |
| **视图位置** | 视图**实际**归属的容器（默认继承其容器位置；用户改过则以覆盖为准） | descriptor service | `workbench.views.customizations` |
| **面板对齐** | 面板在其**所属水平区域内**的排布：`left` \| `center` \| `right` \| `justify`（研究 03） | 布局层 | `workbench.layout` |

**注意**：`justify`（跨全宽）与"面板只在编辑器下（嵌套）"**不是同一个属性**——前者是对齐，后者是**面板所在父节点不同（拓扑）**。两者是独立字段，可以组合：

```
justify + 父节点=整行     → 面板横跨全宽（左|编辑器|右 之下）
通配  + 父节点=编辑器中列  → 面板只在编辑器下
```

**三种拖动，三个 owner（不得互相替代）**：

| 拖动 | 改什么 | 谁来处理 |
|---|---|---|
| 拖**视图**到另一个容器 / 容器内换序 | 视图位置与顺序 | 容器模型 + descriptor service |
| 移动**整个 Panel Part**（含换到另一侧） | Part 位置（树上的父节点） | 布局层 |
| **拆分编辑器** | Editor Group | Editor Part（第一版不做） |

### 默认位置 vs 实际位置（优先级与恢复）

- **① 用户覆盖优先**，但覆盖记录**它基于哪一版默认**；descriptor 的默认位置变更后，该覆盖失效 → 视图回新默认，并在诊断里说明原因。
- **② 快照引用了未知容器** → 该容器下的视图回各自默认位置 + 产出 issue；**不整树回默认**。
- **③ 重置** = 清除该视图/容器的覆盖，不做整树重置。

## descriptor 字段

| 字段 | 类型与值域 | 语义 | 从设置外壳能否直接长出 |
|---|---|---|---|
| `id` | string，命名空间化（内置 `nbook.*`，插件 `<publisher>.<name>`） | 稳定 view id | 是（`SettingsSectionOption.value`） |
| `titleKey` | string（i18n key，**不存译文**） | 标题；注册表存 key，宿主渲染时解析 | 部分（现有 `label` 已是解析后的字符串） |
| `icon` | string（图标 token/class） | 只表达展示 | 是（`iconClass`） |
| `container` | string | 所属容器 id | 否 |
| `layout` | `"scroll" \| "fill"` | `scroll`：外壳给内边距并拥有滚动；`fill`：自己占满、内部滚动 | 是 |
| `when` | 结构化谓词（第一版为枚举数组，见开放问题 2） | **只决定是否可见/可选**；不满足时**不实例化**，容器内显示不可用原因 | 部分（`scopes` 可贡献粗粒度项） |
| `requiredAuthority` | 枚举：`project` \| `session` \| `job` \| `files`；多个为 **allOf** | 执行该视图动作所需的 authority；不可用时**视图仍可见但动作不可执行**，并给出原因（view 级 issue） | 否（新增） |
| `order` | integer | 同容器内顺序；**同值按 `id` 稳定排序** | 否（新增） |
| `weight` | number，**无单位比例**（同容器内归一化） | 初始尺寸分配；**用户保存的尺寸（绝对像素）优先于初始 weight** | 否（新增） |
| `canToggleVisibility` / `canMoveView` | boolean | 用户可否隐藏 / 可否跨容器移动 | 否（新增） |
| `factoryKey` | string → 宿主白名单解析器 | 创建视图内容；**不接受组件、模块路径、HTML/CSS** | 否（现为宿主模板 `v-if` 分支） |
| `stateScope` | `"user" \| "project"` | 该视图的 memento 存在哪一层。**不存在 session/window scope**。**注意**：设置外壳里的 `scopes` 是「Config 写入作用域」，与这里的 `stateScope` 不是一回事 | 部分 |

**`when` 与 `requiredAuthority` 的分工**：`when` 管**看得见**，`requiredAuthority` 管**做得了**。可见性永远不是权限。

### descriptor 示例

```ts
const explorer: ViewDescriptor = {
    id: "nbook.files",
    titleKey: "workbench.view.files",
    icon: "i-lucide-files",
    container: "nbook.explorer",
    layout: "scroll",
    when: {requires: ["project"]},
    requiredAuthority: ["files"],
    order: 10,
    canToggleVisibility: true,
    canMoveView: true,
    factoryKey: "nbook.view.files",
    stateScope: "user",
};
```

## 基础原语：可序列化拆分树（SerializableGrid）

**放哪**：nb-ui（领域无关的布局原语，与 `Splitter` 同层），被两处复用——Workbench 外壳（Part 排布）与将来的 `EditorPart`（编辑器组）。VS Code 亦如此分层（该原语在 `vs/base/browser/ui/grid`，不在 workbench 内）。

### 职责边界（消除"不拥有 resize 却暴露 resize"的矛盾）

| 归属 | 内容 |
|---|---|
| **原语拥有** | 树操作（增删/移叶/换父）、**尺寸约束传播与夹取**、序列化与恢复、"哪个节点在哪个矩形"的布局计算 |
| **原语不拥有** | **拖拽手势与 sash 的产生**（由既有边界负责：nb-ui `Splitter` 生成 resize handle，`useResizablePanel` 提交单面板尺寸）、持久化键、组件实例 |

`resize(id, delta)` 是**受控 API**：由既有 sash 的拖拽回调调用，原语只做夹取与传播。Lab 验证时必须走这条路径，**不得**另写一套拖拽。

```ts
type GridOrientation = "horizontal" | "vertical";
type GridLeaf<T>   = {kind: "leaf";   id: string; ref: T; minimumSize: number; maximumSize: number; size: number};
type GridBranch<T> = {kind: "branch"; id: string; orientation: GridOrientation; children: GridNode<T>[]};
type GridNode<T>   = GridLeaf<T> | GridBranch<T>;
/** 快照把 T 具体化为宿主 ref 字符串：叶子里的 ref 就是那个字符串，不再嵌套。 */
type GridSnapshot = {version: 1; root: GridNode<string>};
```

操作：`addLeaf(parentId, index, leaf)`、`removeLeaf(id)`、`moveLeaf(id, parentId, index)`、`resize(id, delta)`、`serialize()`、`restore(snapshot, resolveRef)`、`layout()`。

**结果合同**：所有操作返回结果对象而不抛未捕获异常——成功 `{ok: true}`；失败 `{ok: false, reason, issue?}`（未知父 id、自环、重复 ref 等）。`restore` 额外返回 `{dropped: [{ref, reason}], clamped: string[]}`；`layout()` 返回 `{rects, issues}`。调用方据此产出可诊断信息。

### 不变量测试矩阵（修完才算有验收）

| 分组 | 用例 | 期望 |
|---|---|---|
| 尺寸边界 | 叶子的 `size` 小于 `minimumSize` / 大于 `maximumSize`；`resize` 越过 min/max；父链多个节点同时触界 | 夹取到边界；父链逐级传播，不出现负尺寸或溢出 |
| 结构 | `addLeaf` 到未知父 id；`moveLeaf` 到自身子树；`removeLeaf` 删掉分支的**最后一个子节点**；空树；单叶根 | 未知父/自环返回错误结果（不抛未捕获异常）；空分支**塌陷**；空树与单叶根是合法状态 |
| 删除后的尺寸 | 删除后兄弟如何分配 | 按现有尺寸**比例吸收**，总和不变 |
| 快照 | 未知 ref；版本号不认识；ref 重复 | 未知 ref → 丢该叶 + issue；版本不符 → 回默认 + 原因；重复 ref → 拒绝并报告 |
| 快照纯洁性 | 快照字段扫描 | **不得出现**组件、descriptor、函数等非 ref 字段 |

### 验证台（已建：`/workbench-spike` 独立路由，仅 Source Dev）

旧 `WorkbenchViewHostSpike`（Lab 探针，只有按钮式移动/尺寸加减/内存快照）已删除；验证台改为**独立路由** `/workbench-spike`（`app/pages/workbench-spike.vue` + `app/components/workbench-spike/`），与 `/lab` 共用同一套 Source-Dev 排除（`nuxt.config.ts` 的 `pages:extend`），不进产品构建。三件事均已落地：

1. **基于树的重新挂父**：把面板叶从"编辑器中列"移到"整行"，走 `moveLeaf`，不是切换按钮；
2. **真实 sash**：拖拽由既有 `Splitter` handle 驱动，回调进 `resize()`；
3. **快照恢复**：注入未知 ref、版本不符、空分支三类场景，观察 issue 与回退。

同时补齐 Lab 侧的场景与注册条目（注意：Lab 导航由文档扫描派生，组件文档必须在 Lab 顶层目录才会出现）。

### 验证台验收（2026-09-13 人工复核 → 已达成）

验证台现已按下面四条改造完毕（实测：29/29 浏览器断言 + 截图，原语单测 13/13 未受影响）：

1. **观感要到「像个 IDE」**：活动栏、容器头、视图行、面板、状态栏要有工作台该有的形态——图标可辨识、有悬停与选中态、视图行有标题与动作区、编辑器区有标签栏与空白页，而不是把 descriptor 摊成裸列表。
2. **sash 必须可发现且可拖**：当前 handle 热区不可见，用户找不到也拖不动。要求：悬停高亮 + 足够大的命中区（沿用既有 Splitter 的热区约定），真实指针拖拽生效。
3. **视图跨容器拖拽**：把视图从主侧栏拖到右侧栏或面板（以及反向），改的是**视图位置**——这是 `workbench.views.customizations` 的覆盖，与「移动 Part」（改树上的父节点）是两件事。要求：拖拽期间有落点提示，落下后容器内顺序正确、快照记录覆盖位置，且默认位置变化时覆盖失效并给 issue（见「默认位置 vs 实际位置」）。
4. **活动栏与侧栏收起**：活动栏图标**可点击切换容器**（有选中态，图标按容器默认位置分组）；左右侧栏**可收起/展开**（收起后活动栏仍在，点它的图标恢复）。收起状态进布局快照——**收起如何表示是本轮要定的**：`size` 夹到最小 + `collapsed` 标记（原语需新增字段），或由布局层在快照外记录；无论选哪种，恢复语义都要与「尺寸夹取」一致。

## 状态分层与持久化键

**两类 Config、两类 Storage，加上内存态与领域数据排除项**。Config 和 Storage 是不同的
owner；不能因为都能保存 JSON 就互相替代。

| 层级 | 内容 | 键 / scope | 现有事实 |
|---|---|---|---|
| **Global Config** | 跨 Project 生效的设置与策略 | Config service；`Workspace Root/.nbook/config.json` | 例如主题、外观、费用币种；不由 Workbench storage 写入 |
| **Project Config** | 单个 Project 的设置覆盖 | Config service；`Project Workspace Root/.nbook/config.json` | 写入服从既有 Project ready gate；global-only 字段被拒绝 |
| **User Storage** | 未开项目/用户资产尺寸、普通窗口尺寸、容器位置与顺序、视图隐藏偏好、面板位置与对齐 | 独立 user/local 尺寸记录与 `workbench.views.customizations` | 现散在旧浏览器键；目标按 storage.persistence 迁移 |
| **Project Storage** | 主工作台左右尺寸、World Engine 尺寸及按项目恢复的插件状态 | project/local 尺寸与 owner 的独立记录 | 通用 service 尚未实现；主尺寸首批迁移，World Engine 后续接入 |
| **内存态** | 当前焦点、拖拽态、Dialog 开关、无需恢复的跨模块状态 | 组件 ref、非持久化 Pinia、宿主 service 或 context | 页面/进程销毁即释放；不是 Storage scope |
| **（排除）领域数据** | Project 文件、Agent Session、Job、Trace | 各自 authority | **不进任何布局键** |

**位置覆盖单独一键**：`workbench.views.customizations`（User Storage）。

作用域与职责按 [ADR 0020](../adr/0020-user-project-storage-boundaries.md)，本地阶段与消费者归属按 [ADR 0021](../adr/0021-local-storage-persistence.md)。
一个插件可同时消费 User Storage、Project Storage 与内存状态；World Engine 尺寸逐项目记忆是开发者的明确选择。
`stateScope` 只描述该视图的默认记忆归属，不限制插件其它状态。有效 Project 上下文、身份隔离、版本保留与 grid 消费边界
以 [Storage 架构规范](../../../../docs/specs/storage/boundaries.md) 和 [本地持久化合同](../../../../docs/specs/storage/persistence.md) 为准；
跨独立 data 的在线同步仍由 [后续提案](../../../../docs/proposals/storage-service-and-sync.md) 设计。

2026-09-16 补充：[ui.nested-grid](../../../../docs/specs/ui/nested-grid.md) 承接最小嵌套样例及必要原语修复。
下文历史验证台的“分支 sash 不可拖”等限制描述实施前基线，不能代替该新增能力的验收。

**迁移前需要分清的状态**：

| 状态 | 真实归属 | 迁移处置 |
|---|---|---|
| `workspaceSessions` 的项目编辑器状态 | 编辑器恢复态（按 Project 分区） | Tabs/活动文件的记忆可归 Project Storage；未保存 buffer 按编辑器数据恢复合同迁移，不塞进布局 |
| `workspaceSessions["user-assets"]` | 用户资产编辑器恢复态 | 没有 Project 身份；其界面记忆可归 User Storage，未保存正文仍归编辑器 owner |
| `selectedLorebookEntryId` / `selectedCharacterId` | 项目内选择 | 需要恢复时归 Project Storage；仅当前页面使用时留内存 |
| `currentProjectRoot` | 当前打开哪个 Project | 当前事实留内存；“上次打开项目”的记忆需要在打开项目之前可读，应归 User Storage |
| `activeLeftTab`（在 `novel.ide.local`，用户级） | 用户级 UI 偏好 | 本期不动，退役时一次性迁移（见上节） |
| Agent 侧栏的固定会话身份（workspace/project 范围） | 身份 | 留在原处 |

**新旧键迁移**（消除与删除门禁的冲突）：

- 本提案的布局键只存尺寸 / 位置 / 可见集 / 顺序；活动视图仍由旧键负责（`novel.ide.local` 的 active tab 一类），不属于 Storage 首批迁移。
- 主左右尺寸和书架模式按 [首批迁移合同](../migrations/storage-state.md) 逐字段迁移；原件保留，不持续双写。其它旧桶字段退役时另定迁移，不能套用统一的“一个版本兼容”期限。
- 新旧键**并存期内不双写**：任一时刻只有一个写者。

## 第一版范围

| 项 | 判断 | 理由 |
|---|---|---|
| 注册表 + `when` 求值 + 懒实例化 | 现在做 | 后加会改公共契约 |
| 位置层（Part / 容器 / 视图 / 对齐四个概念）+ 位置枚举 | 现在做 | 已决定允许移动，晚做要重写快照 |
| 可序列化拆分树原语 + 测试矩阵 + 新 Lab 验证台 | 现在做 | 面板拓扑与将来编辑器分屏共用 |
| 状态归属与持久化键 | 现在做 | Config、Storage、内存与领域数据各自有明确 owner |
| Tab（单组）+ Tab 状态带 `editorGroupId` | 现在做 | 见下「`editorGroupId` 合同」 |
| **视图跨容器移动**（改视图归属） | 现在做 | 目标 3 |
| **L1 内置插件注册路径** | 现在做，落在**阶段 2（`files` 同批）** | 与研究 15 排序一致：先用最简单的 View 验证注册表；图生文若属 Dialog 边界（研究 12），走命令注册，不进 View Host |
| **Panel Part 拖到任意边**（改 Part 父节点） | 以后做 | 位置属性写对了就不返工 |
| 编辑器分屏（多组） | 以后做 | 价值靠后、代价最高、贴近数据 authority |
| 跨窗口浮动 | 以后做 | 研究未验证 |
| L3 可执行第三方 | 别做（本阶段） | 需独立任务；无需求依赖 |
| 状态栏可换位置 | 以后做 | VS Code 无此能力，需自定义规则（开放问题 4） |

### `editorGroupId` 合同（第一版）

- 字段位置：**落在 Tab 状态上**（`WorkspaceEditorTab`，`app/stores/novel-ide.ts:84-96`），不属于布局快照。
- **该字段当前并不存在，是第一版新增**；因此没有历史数据迁移，只需定义默认值与归一规则（下条）。
- 取值：第一版**固定常量**（如 `"main"`）；缺失或未知值 → 归一到该常量并记诊断，**不报错**。
- 验收：恢复后所有 Tab 的 `editorGroupId` 一致且等于该常量；将来加入第二组时，迁移是"新增取值 + 按组归属"，**不改字段位置与默认规则**。

## 迁移顺序与删除门禁

1. **阶段 0**：登记边界（本提案 → 获批 Spec → Task），不改消费者。
2. **阶段 1**：原语 + 测试矩阵 + 新 Lab 验证台；Lab 侧场景与注册齐备；外壳接入但**保留现有槽位**，不删任何固定入口。
3. **阶段 2**：`files`（同时落 **L1 内置插件注册路径**）；验证 descriptor → 容器 → 既有 Project/文件 authority。
4. **阶段 3**：`characters`（验证 Project generation、dirty flush、Project 切换与恢复）。
5. **阶段 4**：`plot`（左侧 View 与 Plot 专用 Dialog 分开，共享 Project/Markdown authority）。
6. **阶段 5**：命令与只读描述快照桥接（后置）。

**每个消费者的删除条件**（全部满足才可删旧槽位，不留兼容别名）：入口闭环（Activity/Tab/命令/深链接都已唯一走新路径）· 行为等价证据（打开、关闭、选中、尺寸、Project 切换、恢复、失败都在真实 Workbench 观察过）· 生命周期安全（组件销毁、隐藏、Project generation 变化后旧异步结果不发布到新视图；factory 错误不拖垮其他视图）· owner 已迁移（布局与尺寸进宿主，数据副作用仍回原 authority）· 单 Editor Group 不变。

## 与 nb-ui 规范的关系

通用 View 的**数据层与组合合同继承** nb-ui `ui-development-spec` §4.3（受控视图数据层：一个数据源、宿主草稿、加载与失败由外壳统一呈现、视图不接收 loading）与 §4.4（组合与布局归属：单根、布局随内容、区段接线清单）。本提案**不另立**一套；`layout: scroll|fill` 即 §4.4 的组合方式在 Workbench 层的延续。

**已知例外（不要默认继承）**：设置宿主对**旧目标快照**（stale snapshot）的处理与 §4.3 的"统一失败 + 单一加载形态"口径不一致——目标切换时若读取失败，宿主会**保留旧快照且不设置 `loadError`**，而界面只看 `loadError`，于是可能把**旧 Project 的配置当作新目标渲染**（`app/composables/useSettingsSnapshot.ts:91-100`、`NovelIdeSettingsDialog.vue:599-601`；由交叉审查指出，本轮未复核代码）。通用 View 必须**显式定义 stale 语义**：目标切换后到达的旧结果标记为 superseded、不覆盖当前目标、不触发全局错误屏；目标切换本身失败要能表达为"当前目标无数据"，而不是沿用上一目标的数据。

## 真相源检查点

| 检查点 | 迁移时必须保持 |
|---|---|
| 保存 / dirty flush | 视图只发意图；写入、dirty、save/discard 仍归 Editor Part / Project Session；切 Project 不得绕过 flush |
| Session | JSONL/Attachment 仍是 durable truth，视图只订阅投影 |
| Job | Job 与取消仍归 Agent Job Manager；视图隐藏不等于取消失败，也不替 Job 背书成功 |
| Project 文件 / History | Project generation 与记账仍由既有 authority 持有；视图不持 raw Project root |
| 布局 / 尺寸 | 所有尺寸继续经唯一 resize 边界；不建第二套 |
| 异步 stale guard | Project revision / Session ready revision 变化时，旧结果标记为 superseded，不写当前视图 |

## 已决取舍

- **容器可跨栏移动**：允许（位置层与快照格式必须第一天就在）。
- **视图可跨容器移动**：允许（改视图归属，不是改 Part 父节点）。
- **factory 开放性**：descriptor 只放 `factoryKey`，第一版解析器为第一方（内置插件同路）。**设计意图**是 L3 接入时注册 API 与 descriptor 都不必变更——此为推断，尚未验证（L3 的安装、权限与隔离都不在本提案内）。
- **活动视图恢复层级**：保留现有用户级行为，本期不改既有用户数据。
- **嵌套排布**：用可序列化拆分树原语，而非固定骨架 + 特例分支。
- **面板位置的 scope**：用户级；**切 Project 不重置**（原开放问题 5 收敛）。

## 开放问题（2026-09-13 已逐条定夺）

1. **`titleKey` 解析位置** —— (a) 注册表统一解析；(b) 注册表存 key、宿主渲染时解析。**建议 (b)**：语言切换与快照稳定，代价是需要一个统一 resolver。
   **已定：取值 (b)**——注册表只存 key，宿主渲染时解析。
2. **`when` 谓词形态** —— (a) 枚举数组（`requires: ["project"]`）；(b) 表达式 AST。**建议 (a)**：第一版可校验、可解释；代价是遇到复杂条件要加枚举项，扩到 (b) 时需迁移谓词格式。
   **已定：取值 (a)**——`when` 用枚举数组；扩到表达式 AST 时按迁移格式处理。
3. **descriptor 级错误合同** —— (a) 统一进 view 级 issue + 重试，与外壳级 loading/error 分开；(b) 只保留外壳级错误。**建议 (a)**：一个视图坏了不遮住其他；代价是要定 issue 分类（factory / 恢复目标缺失 / context 不可用）与重试动作。
   **已定：取值 (a)**——descriptor 级错误统一进 view 级 issue + 重试，并承担 issue 分类与重试动作的合同成本。
4. **状态栏位置规则**（第一版固定底部，若将来支持）—— (a) 仅顶/底两值，与面板冲突时面板让位；(b) 与面板互斥、谁在外侧谁赢。**建议 (a)**：规则少、可验收；代价是失去"状态栏贴面板"的组合。
   **已定：取值 (a)**——位置只有顶/底两值，与面板冲突时面板让位；第一版仍固定底部。
5. **面板对齐默认值** —— (a) `justify`（跨全宽，与现状视觉一致）；(b) `left`。**建议 (a)**：迁移时无视觉突变。
   **已定：取值 (a)**——默认 `justify`。
6. **sash 的百分比与逻辑尺寸如何对齐** —— (a) 每次 `layout(sizes)` 后把百分比**反算**回逻辑尺寸（原语成为唯一尺寸真相）；(b) 逻辑尺寸只作初始值，之后以百分比为准（原语不追踪运行期尺寸）。**建议 (a)**：夹取边界与持久化快照都在逻辑尺寸里，反算才能让两者一致；代价是每次拖拽都要一次换算与一次快照写回。
   **已定：取值 (a)**——每次 `layout(sizes)` 后反算回逻辑尺寸，原语是唯一尺寸真相；每次拖拽的换算与快照写回按该代价接受。

### 评审遗留设计项（2026-09-13 交叉审查；2026-09-13 已逐条定夺）

以下由三位独立审查者确认为「真实现会疼、但验证台不必实现」的设计缺口；第 7–11 项**已定：要做**（进入第一版范围），第 12–13 项**已定为第一版已知限制**（限制行为与解封条件逐条写在下文）：

7. **容器跨栏位置状态缺失**：现只有「每个位置的活动容器」，没有「容器实际位于哪个位置」的覆盖，容器从主侧栏移到右栏/面板无法用快照表达。需要独立的 `containerPlacements`（含默认回落与版本校验），`activeContainer` 只表示选择。**已定：要做。**
8. **视图位置覆盖需要默认指纹**：覆盖只有 `containerId`/`order`，记录不了它基于哪一版默认位置；descriptor 改默认后旧覆盖会静默生效。需要 `defaultRevision`（或默认位置指纹），不匹配则丢弃覆盖、回落新默认并给 issue。**已定：要做。**
9. **布局的端到端 round-trip 未闭环**：`serializeLayout` 产字符串而 `restoreLayout` 只接对象，直接串接会静默回退默认。需要唯一的 `deserializeLayout`（安全 parse）+ 宿主侧 load/save 适配层，布局模块保持纯函数。**已定：要做。**
10. **用户隐藏偏好 ≠ 上下文可见性**：现只按 `when` 过滤，descriptor 的 `canToggleVisibility` 无处落地。需要经 catalog 校验的 `hiddenViews`，与 `when` 合并成渲染模型，恢复时分别诊断失效引用。**已定：要做。**
11. **策略上移到模型层**：`when`／authority／factory 状态／隐藏偏好在组装根合成 `ViewRenderModel[]`，渲染器只消费模型——否则第二个渲染器（面板、浮动容器）会复制同一套筛选规则。**已定：要做。**
12. **`resize` 只作用于叶子**（分支尺寸由子节点求和）⇒ 分隔**分支**的 sash 拖不动（验证台里状态栏上方那条）。**已定为第一版已知限制**：尺寸操作只接受叶子，分支尺寸恒等于子节点之和，因此「两侧都是分支」的 sash 在第一版不可拖动，也不进快照的尺寸记录；**解封条件**是原语补上「按比例分配分支尺寸」的操作，且该操作有自己的不变量测试（子节点求和恒等于父尺寸、夹取不越界）之后。
13. **移动是单向的**：叶子移出后源分支若只剩一个子节点会塌陷，按原分支 id 移回会失败（验证台的「移到整行」再移回需重建分支）。**已定为第一版已知限制**：快照与恢复只承诺对**当前树**有效，不承诺跨塌陷的分支往返；**解封条件**是要么在快照里保留空分支（空分支同时进入不变量与恢复校验），要么让落点按内容（相邻兄弟/位置）而非分支 id 寻址——两者都到位后才能撤销该限制。

## 决策记录

| 日期 | 决策 | 结论 |
|---|---|---|
| 2026-09-13 | 开放问题 1 `titleKey` 解析位置 | (b) 注册表存 key、宿主渲染时解析 |
| 2026-09-13 | 开放问题 2 `when` 谓词形态 | (a) 枚举数组 |
| 2026-09-13 | 开放问题 3 descriptor 级错误合同 | (a) 统一进 view 级 issue + 重试 |
| 2026-09-13 | 开放问题 4 状态栏位置规则 | (a) 仅顶/底两值，冲突时面板让位 |
| 2026-09-13 | 开放问题 5 面板对齐默认值 | (a) `justify` |
| 2026-09-13 | 开放问题 6 sash 百分比与逻辑尺寸 | (a) 每次 `layout(sizes)` 后反算回逻辑尺寸，原语是唯一尺寸真相 |
| 2026-09-13 | 评审遗留 7–11（`containerPlacements`、`defaultRevision`、`deserializeLayout`、`hiddenViews`、`ViewRenderModel`） | 要做，进入第一版范围 |
| 2026-09-13 | 评审遗留 12–13（分支 sash 不可拖、移动单向性） | 第一版已知限制，逐条写明限制行为与解封条件 |
| 2026-09-13 | 提案整体 | 开发者批准，状态 `draft` → `accepted` |
| 2026-09-15 | Storage scope 与 Config 边界 | 开发者确认 Config 为 Global/Project，Storage 为 user/project；不引入 session/window Storage scope，详见 ADR 0020。Storage 同步和消费者细分仍在讨论 |
| 2026-09-16 | 本地持久化与嵌套验证 | 开发者确定 project/local 尺寸、user 定制与本地备份阶段，并同意计划审查补充；当前合同为 storage.persistence 与 ui.nested-grid，取舍见 ADR 0021 |

决策者：开发者（经 #192 设计门复核）。

## 证据与边界

- 分层结论来自研究 [`03`](../research/vscode/03-workbench-layout-views.md)（Part 词表与四层状态分层以固定 commit 核对；**真实拖拽与重启恢复在该调研中未验证**），以及 [`08`](../research/vscode/08-neurobook-mapping.md)、[`12`](../research/vscode/12-workbench-view-host-refactor.md)、[`15`](../research/vscode/15-refactor-sequence-and-decision-gates.md)。
- 代码结论（写死的 activity union、设置外壳的元数据驱动与受控插槽、布局状态四处分散）来自设计门侦察与两轮交叉审查，逐条带 `文件:行号`。
- 本文是**提案**，不是已生效 Spec；状态已由 `draft` 改为 `accepted`（2026-09-13），下一步是登记唯一 `planned` capability Spec，实现 Task 才可创建。实现被 #191 阻塞。
- 跨窗口浮动的真实行为、编辑器分屏的恢复语义、L3 的安装与隔离**均未验证**，本文只给边界不给实现承诺。
- **验证台实测（2026-09-13，真实 dev server）**：树挂父、空分支塌陷、未知 ref 丢弃、真实 sash 拖拽与夹取、懒实例化、factory 抛错隔离、`when` 不可见与 `requiredAuthority` 动作禁用七项均可观察；原语单测 13/13（快照键集合纯净性为断言之一）。同时暴露三个实现层面的坑，后续实现必须知道：
  1. **作用域插槽不穿透递归**：分区渲染组件递归渲染子分支时，必须显式转发 `leaf` 插槽，否则嵌套层的叶子渲染为空（顶层正常，极易漏测）。
  2. **插槽 prop 不驼峰化**：`:leaf-id` 在子侧解构 `{leafId}` 恒为 `undefined`，两端必须同名（或改用子组件 + 显式 prop）。
  3. **百分比与逻辑尺寸是两个空间**：`Splitter` 按百分比夹取、原语按逻辑尺寸夹取，实测越界停在约 79px 而非逻辑上限 96px——原语不变量成立，但生产实现需要把百分比映射回逻辑尺寸，见开放问题 6。
