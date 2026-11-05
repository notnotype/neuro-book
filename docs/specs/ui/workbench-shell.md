---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: ui.workbench-shell
owners:
  - nbook.workbench
---

# 工作台外壳

## 目标与非目标

**目标**：每个窗口一个工作台外壳：七个固定 Part 的几何与可见性、面板的位置与形态、紧凑呈现、布局记录的保存与恢复；工具区域按 Switcher、ViewContainer、View 分层，容器单轴编排，移动、合并与模式切换不销毁视图实例；拖放与保存走同一个模型。外壳由 `nbook.workbench` 拥有，是布局的唯一写者。

按切片实现（[外壳设计稿](../../proposals/workbench-shell-abstractions.md) 第 11 节）：**外壳一**（外壳与布局）、**外壳二**（容器与视图）、**外壳三**（拖放），之后的**外壳四**（标题栏、状态栏与条目贡献点）。下文各节按切片标出所属。书架页（[workbench.bookshelf](../workbench/bookshelf.md)）为工作台增加无项目首页的贡献点与 `/workbench` 页（输出 36–37）；设置窗口（[settings.window](../settings/settings-window.md)）为工作台增加活动栏底部条目与页面浮层两个贡献点（输出 40–41）。

**非目标**：

- 编辑器分组与文档标签：归编辑器插件（[workbench.editor](../workbench/editor.md)），外壳只提供稳定的编辑器内容槽。槽的内容由贡献点 `workbench.editor-area` 提供：声明 `{order}`，实现 `{load(): Promise<Component>}`，组件收到只读的 `context.visible`；外壳取 `order` 最小的一个挂一次，布局变化时停放不重挂，第二个提供者记诊断、不挂，没有贡献时显示欢迎文字（planned）。旧应用的 EditorWorkbench 拖放行为表不在本 Spec，编辑器拖放立项时从归档的旧口径 Spec（[`docs/archived/specs/ui/workbench-shell.md`](../../archived/specs/ui/workbench-shell.md)）取回。
- 插件面向的视图合同（`workbench.views` 的声明、实例生命周期、撤回与失败）：见 [workbench.views](../workbench/views.md)，随外壳二实现。
- 桌面窗口控制与桌面菜单接线（有桌面宿主再做）；跨窗口浮动；第三方可执行插件。标题栏的应用菜单、命令搜索与两类条目贡献点见外壳四。
- 不读写领域数据（项目文件、会话、历史），不建第二套 resize 边界或第二套布局存储。

## 术语与参与者

```text
Workbench（每个窗口一个；nbook.workbench 浏览器入口激活时建立）
├─ Shell：七个固定 Part 的拓扑与几何
│  ├─ TitleBar
│  ├─ ActivityBar ─────── 呈现 Sidebar 的 Switcher，底部放贡献来的全局项
│  ├─ Sidebar ┐
│  ├─ AuxiliaryBar ├─ 工具区域（ToolPart）：Switcher + 当前 ViewContainer
│  ├─ Panel ┘                └─ View × n（单轴排列）
│  ├─ Editor ─────────── 稳定内容槽；内容由编辑器插件提供
│  └─ StatusBar
├─ ViewRegistry：容器与视图的声明（外壳二）
├─ Placement：默认落位 + 用户定制 → 实际落位（外壳二）
└─ 工作台 store：布局记录、内存状态、公开状态与 action
```

- **Part**：七个固定区域 `titlebar`、`activitybar`、`sidebar`、`auxiliarybar`、`editor`、`panel`、`statusbar`；拥有区域级几何与可见性。Part 集合与拓扑固定，不可贡献。
- **ToolPart**：能承载容器的 `sidebar`、`auxiliarybar`、`panel`，也就是容器的“位置”。
- **ActivityBar**：主体左侧的通高列；上段呈现 Sidebar 的 Switcher，底段放插件贡献的全局项（输出 40）。
- **页面浮层**：插件交给页面根的组件（输出 41），首页与工作台页都挂；内容自己决定渲染到哪里（例如对话框传送到 body）。
- **Switcher**：在一个 ToolPart 里选容器的导航，也是容器级拖放的插入位。Sidebar 的 Switcher 在 ActivityBar 上；AuxiliaryBar 与 Panel 用标签带。
- **ViewContainer**：一组视图的归属与单轴排列单位，对应 Switcher 上的一个条目。可见成员数决定 empty、single、multiple 三种模式；区域决定轴向（侧栏纵向、Panel 横向）。实际成员数为 0 时移除容器及入口；成员只是隐藏或暂时不可见不算空。
- **View**：一项工具能力的内容面板；插件提供声明与组件，工作台持有实例、落位与尺寸。
- **面板的四种“消失”**：隐藏、32px 标题头收起、拖到零、瞬时最大化（见外壳一）。
- **呈现事实**：外壳组件按实测容器算出的当前模式（`split`、`compact`）与生效的面板状态。它不是保存意图：保存的是用户偏好，呈现事实可能因容器尺寸临时不同。

`WorkbenchShellLayout` 只管七个 Part 的几何与受控手势；容器导航、视图归属与移动由工作台持有。容器标题文字、工具按钮区与 Switcher 条目带是不同落点：前者不接收投递，后者接收容器插入。“移除空容器”只移除布局容器与导航入口，不删除视图定义与业务数据。

## 输入与前置条件

- 触发：打开或刷新窗口、窗口绑定项目、容器尺寸变化、用户操作（拖动边界、面板框架按钮、状态栏、命令、点击 ActivityBar、拖动视图）。
- 输入：三条布局记录（可缺失、损坏、版本不支持）；当前主题（[theme.system](../theme/system.md)）；实测的外壳容器尺寸（不是 window 尺寸）；窗口是否绑定项目；视图的声明与交付状态（外壳二，[workbench.views](../workbench/views.md)）。
- 前置：工作台浏览器入口已激活；Storage 不可用时外壳仍按默认布局渲染，只是不能保存。
- 权限：无。外壳不读写领域数据。

## 输出与可观察行为

### 外壳一：外壳与布局

外壳一的输出 1–14 已实现。

1. **拓扑**：标题栏在顶、状态栏在底；ActivityBar 是主体左侧的通高列，主体（侧栏、编辑器、右栏、面板）永远在它右侧，任何面板位置与对齐都不跨过 ActivityBar。不出现双重边框、双重标题条或双重标签条。
2. **面板位置与对齐**：位置 `bottom`、`top`、`left`、`right`，默认 `bottom`；水平位置的跨度 `center`（只在编辑器下）、`left`（含侧栏）、`right`（含右栏）、`justify`（含左右侧栏），默认 `center`；`justify` 不跨 ActivityBar。左右位置忽略保存的对齐，改回水平位置时再生效。
3. **固定尺寸**：标题栏 36px、状态栏 22px、ActivityBar 宽 48px（卡片外壳里含左侧的缝，输出 38），不可调整、不可收起；可调整的边界在流内占 1px，命中区向两侧扩展。
4. **可调尺寸与夹取**：侧栏宽 160..560（默认 340）、右栏宽 160..max(360, 视口宽 × 0.45)（默认 400）、面板高至少 80（默认 200）、面板宽至少 160（默认 320），没有固定上限：拖到编辑器的最小尺寸为止，再往前越过 24px 即瞬时最大化（输出 7）；编辑器吸收余量，最小可用宽 272（底部与顶部的面板与它同宽，要放得下面板标题行：五个框架按钮与至少 96px 的导航）、高 120；左右面板窄到放不下导航时，标题行的导航换到第二行。面板高度与宽度分开记忆。拖过最小或最大值时停在边界、不弹回。
5. **装不下时只改呈现**：偏好装不下时先给编辑器所在的余量留出它的最小宽度，再按“偏好减最小值”的可缩空间同比压缩侧栏与面板（不写回偏好）；宽度连最小值都装不下时进入紧凑呈现；高度装不下时（分栏与紧凑呈现都一样）先给编辑器留出最小高度、把面板压进剩下的空间，面板的最小高度也放不下时才退到 32px 标题头，仍不够时编辑器取非负余量。每种降级给出诊断。所有几何非负且在容器内。
6. **紧凑呈现**：外壳容器宽 < 800 时，ActivityBar 仍是主体左侧通高列，其余主体 Part 纵向排布，面板强制底部两端对齐，没有可拖边界；位置、对齐、最大化命令不可用并给出原因。不覆盖保存的偏好，回到宽屏按偏好恢复。
7. **面板四种“消失”互不等价**：
   - **隐藏**：面板零占用；“显示面板”（状态栏按钮与 `set-panel-hidden` 为 false）同时清除隐藏、收起与拖到零，面板按记忆尺寸回来。面板拖到零时状态栏同样显示“显示面板”。
   - **32px 标题头收起**：只对水平位置有效；面板叶仍在树里，内容不重挂。
   - **拖到零**：保留节点与展开尺寸意图，内容 0px 且停放（不可交互、不进 Tab 顺序），相邻保留 1px 可拖边界；只写布尔偏好位，尺寸记录不写 0。侧栏与右栏同样可拖到零。
   - **瞬时最大化**：只在左右位置或水平居中可用；面板占满编辑器所在的列，侧栏、ActivityBar、标题栏、状态栏保留，编辑器内容停放（不卸载、不可交互、不进 Tab 顺序）。除按钮与命令外，把面板与编辑器之间的边界往编辑器那边拖、让编辑器小于它的最小尺寸 24px 以上，也是最大化；最大化时这条边界保留 1px，往回拖过编辑器的最小尺寸即还原，面板尺寸跟着指针并保存；面板仍守自己的最小尺寸，同一场手势继续往下越过 24px 就是拖到零。拖成最大化不改面板的尺寸记录。只在内存，不落盘；换位置、对齐、隐藏、收起，或进入紧凑呈现时清除，回到宽屏不复活。
8. **恢复与键盘**：从拖到零的边界用指针拉回时，在合法展开区跟随指针（按下边界加累计位移）；按钮、命令与 Enter 恢复记忆尺寸。边界上的 Enter 只恢复拖到零的侧栏、右栏与面板，不把编辑器拖到零。从拖到零或最大化往外拉时，内容在拖动中就出现，不等松手：里面的视图还没加载过时（例如刷新之后第一次拉出）在拖动中加载，视图的“可见”也跟着拖动中的几何；按着拖回零时内容回到停放区。拖动中不写拖到零的记录，落账时才写。边界的键盘操作沿用 [ui.nested-grid](nested-grid.md)：方向键 10px、Shift 1px、Home/End、Enter；Escape、pointercancel、失焦、容器尺寸或上下文变化取消整场手势，不提交。一次手势（含交汇处两根轴）只落账一次，松手后各记录各提交一次。
9. **Part 显隐**：`titlebar`、`activitybar`、`sidebar`、`auxiliarybar` 可隐藏（移出树、不留边界）；编辑器与状态栏始终在场。空着的右栏与面板缺省不显示，见输出 39。
10. **内容槽与停放**：七个 Part 的内容由稳定宿主渲染再搬到当前落点；隐藏、最大化、换位置、紧凑往返时内容停放（不可交互、不进读屏与 Tab 顺序）而不卸载，输入、滚动与焦点保留。焦点所在内容被隐藏时焦点移到状态栏“显示面板”，被最大化挤走时移到面板标题；焦点在外壳之外（菜单、对话框）时不抢。
11. **面板框架与状态栏**：面板 32px 标题头带位置、对齐、收起、最大化、隐藏按钮，经第 13 条的命令执行，不可用时禁用并有名称。状态栏显示当前项目名或“未打开项目”与面板显隐按钮；布局有记录保存失败时显示“布局未保存”与原因，带重试与放弃；读取失败时显示正在用默认布局。外壳自己不显示假数据（Git、行列号、通知计数）；条目由贡献方给出真实数据（输出 35）。
12. **标题栏与空 Part**：浏览器窗口渲染自绘标题栏，显示应用名与当前作品的显示名（书名，没有时是目录原名，[`runtime.projects`](../runtime/projects.md) 术语；外壳四起按输出 28）；未实现的菜单、搜索不以可操作的假入口呈现。外壳二之前 ActivityBar 只保留列，侧栏与右栏显示空状态说明，编辑器槽显示欢迎文字（语言跟随配置）。
13. **公开状态与面板命令**：工作台公开下列状态（[state.public-state](../state/public-state.md)），未就绪时布尔键为 `false`。布局记录未读完、呈现事实未到时，依赖几何的键保持 `false`。

    | 键 | 类型 | 未就绪时 | 含义 |
    |---|---|---|---|
    | `nbook.workbench/layoutReady` | 布尔 | `false` | 三条布局记录读取完成 |
    | `nbook.workbench/nonCompact` | 布尔 | `false` | 不在紧凑呈现 |
    | `nbook.workbench/panelHorizontal` | 布尔 | `false` | 面板保存的位置是底部或顶部（紧凑呈现临时放到底部的左右面板不算：收起与对齐对它不生效） |
    | `nbook.workbench/panelMaximizable` | 布尔 | `false` | 面板显示着、不在紧凑呈现，并在左右两侧或水平且居中 |
    | `nbook.workbench/panelVisible` | 布尔 | `false` | 面板显示中（隐藏或拖到零都不算） |
    | `nbook.workbench/panelMaximized` | 布尔 | `false` | 面板瞬时最大化中 |
    | `nbook.workbench/panelPosition` | 字符串 | `bottom` | 面板保存的位置（只供读取，不进 `when`） |
    | `nbook.workbench/panelAlignment` | 字符串 | `center` | 面板保存的对齐（同上） |
    | `nbook.workbench/focusedPart` | 字符串 | `editor` | 最近获得焦点的 Part（外壳二，见输出 27；同上） |

    五条面板命令的参数、条件与暴露见 [workbench.commands](../workbench/commands.md) 第二批；外壳框架按钮、状态栏按钮与命令面板走同一组命令。
14. **布局恢复**：主动调整与用户定制按各自记录保存；重新进入时恢复并按当前约束夹取。测量、夹取、临时显隐、拖动期间、呈现事实变化都不保存。

### 外壳二：容器与视图

外壳二的输出 15–18、24–27 已实现（视图合同见 [workbench.views](../workbench/views.md)）。

15. **ActivityBar 与 Switcher**：ActivityBar 上段只列当前位于 Sidebar 的容器，至多一项选中；点击非活动项切换 Sidebar 显示的容器并使其可见；点击当前项在 Sidebar 可见时收起它（隐藏，与“视图”菜单的侧栏开关同一个状态），在 Sidebar 被隐藏或拖到零时打开它，选择不变。底段的全局项来自贡献点 `workbench.activitybar-items`（输出 40），不参与选中。上段的条目放不下时，排在后面的收进上段末尾的“更多”（与第 34 条同一个预算），当前选中的总在外面；从“更多”选中的照常切换并回到外面。AuxiliaryBar 与 Panel 始终显示容器标签带。
16. **容器模式**：可见成员 0、1、多时分别为 empty、single、multiple；隐藏不计数，收起仍计数。single 不重复视图标题，视图动作上提到容器右上角，不单独收起视图；已有收起意图保留到 multiple 时重新应用。multiple 每个视图保留标题与动作，Sidebar 与 AuxiliaryBar 纵向、Panel 横向，与 Panel 外壳位置无关；全部可见成员同屏。横向收起为 32px 竖条、纵向为 32px 横标题，展开控件与名称始终可达；multiple 的视图标题行除动作区外整行点一下就收起或展开，按住移动是拖走视图（输出 19–23），不切换。Sidebar 在 single 时 32px 标题行左侧显示容器名，整行除动作区外可拖走该容器；multiple 不渲染容器标题行。
17. **动作顺序**：single 时依次为视图的贡献、容器管理、Part 框架；multiple 的视图动作在各自标题。切模式、容器、首个视图或代际时立即关闭旧菜单，过期点击拒绝。框架动作在空 Part 里仍可达。
18. **实例保留**：显隐、换轴、模式切换、容器在 Part 间移动都不重建视图实例；每个容器唯一的宿主在目标卸载或重新登记时退回常驻停放区，目标恢复后再搬回，不留在已脱离的旧落点。只有实际成员数归零才移除空容器与入口。搬动前后输入、滚动与焦点的规则与外壳一输出 6 相同：原节点仍可见时恢复；被停放时焦点到可见的框架控件；焦点在外壳外的菜单或对话框时不抢。
24. **移动到**：可移动的视图有“移动到”菜单（multiple 在视图标题，single 在上提的容器管理位）。目标是除当前容器外的全部有效容器，含同一 ToolPart 的，按 ToolPart 分组，标题与图标与 Switcher 同源；每个 ToolPart 一组的末尾是“新建容器（在 X）”：建一个只装这个视图的自建容器放到 X 的末尾并选中（外壳三）；视图不在默认位置时另有“重置位置”。菜单打开时记下视图、来源容器、容器模式、交付状态与视图代际，任一变化即关闭菜单，过期点击零写入。经 `nbook.view.move-view` 执行（[workbench.commands](../workbench/commands.md)）。
25. **Panel 标题行**：Panel 的 32px 标题行只有面板框架一个拥有者：左侧是容器标签带，右侧是第 11 条的框架按钮；标签带溢出时框架按钮保持可达，空 Panel 也保留框架按钮。Panel 与 AuxiliaryBar 的标签带放不下时逐级让位，不横向滚动：完整标题 → 每个标签最宽 96px、标题末尾省略 → 选中的保留标题、其余只显示图标（悬停与读屏仍是全名）→ 放不下的收进末尾的“更多 N”，从那里选中的回到标签带；选中的始终带标题。放宽一档要多出 16px 余量，宽度在临界值附近抖动时不来回切。拖动时插入线只在看得见的标签之间与末尾。
26. **起源声明消失**：隐式容器 `view:A` 的起源视图 A 的声明消失而容器仍有实际成员时，容器保留身份、成员与入口，标题回落到成员；没有有效的容器位置覆盖时，区域与顺序回落到首个实际成员的默认位置并诊断。
27. **焦点 Part**：`focusedPart` 是最近获得焦点的 Part；焦点移到外壳之外（菜单、对话框、页面空白处）时保持原值。

### 外壳三：拖放

19. **工作台拖放行为表**：

    | 拖动源 | 落点 | 释放动作 | 容器与尺寸结果 |
    |---|---|---|---|
    | 单个 View（从标题起拖） | Switcher 的标签插入位，包括已有标签上求得的插入位 | 创建一个容器并移入该 View，插入位出现新标签 | 不并入悬停标签的容器；源容器实际成员归零则移除 |
    | 容器标签或 ActivityBar 容器项 | 同一 Switcher 的插入位 | 整个容器换序 | 成员与内部排列不变；原位不提交 |
    | 容器标签或 ActivityBar 容器项 | 另一 Switcher 的插入位 | 整个容器迁到目标区域并选中 | 沿目标区域的轴排列，保持成员顺序 |
    | 单个 View | 目标内容窗格允许的边缘 | 移入目标容器并拆分命中窗格 | 视为 n=1 的边缘并入；不增加目标标签 |
    | 含 n 个 View 的容器 | 另一容器中某个内容窗格允许的边缘 | 原子并入全部成员，保持来源顺序 | 命中窗格保留一半，另一半按来源比例分给拖入 View；源空容器及标签移除 |
    | 单个 View 或容器 | 被禁用的方向 | 不接受，不改变状态 | 无落点提示；指针拖影仍可显示。内容窗格只沿允许轴分前后两半，侧栏的左右、Panel 的上下不形成拆分方向：指针在窗格里任何位置都按允许轴归前半或后半 |
    | 单个 View | 空 Switcher 内容区或空标签栏 | 创建容器并移入，出现且选中第一个标签 | 单个 View 填满内容区 |
    | 整个容器 | 空 Switcher 内容区或空标签栏 | 搬入并选中 | 不额外套一层容器，按目标轴排列 |
    | 任意内部拖动源 | 容器标题文字、工具按钮区（动作区、菜单按钮、收起开关，包括 Panel 标签带里的“移动到”）或外部遮挡区域 | 不接收 | 无有效落点反馈；multiple 里视图的标题行属于该视图的窗格，标题文字按窗格的前后半区接收 |

20. **方向与命中**：Sidebar 与 AuxiliaryBar 的视图窗格只接收上、下；Panel 的视图窗格只接收左、右（Panel 外壳停靠到左右也不改变内部横排）。展开内容窗格在允许轴的前后各 50% 接收，中点归后半，没有中央禁投区。收起的视图（竖条或 32px 标题行）不拆半区，按前后插入位接收：指针在它的前半插到它前面、后半插到它后面，预览是一条插入线，提示“放在“X”前／后”贴在线的末端；容器内可见视图全部收起时，标题之间与最后一个之后都是插入位，细条之后没被占用的剩余区等于插在最后。放下后拖入的视图在插入位展开，原有收起的保持收起；插入位挨着展开的窗格时按输出 21 与它平分，挨着的都收起时只插入，份额由网格按意图分（全部收起时就是剩余区）。无任何标签的 Switcher 内容区整区一个落点；标签栏与 ActivityBar 条目带只有前后插入位。拖动开始时，此刻没显示的侧栏、右栏、面板（空着缺省不显示、被隐藏、拖到零；紧凑呈现除外）按显示出来会在的位置与记住的尺寸各浮出一块预备区，几块一起按全部显示投影、彼此不重叠，叠在当前布局上、不改布局。预备区整区一个落点，语义同空 Part：单 View 建一个容器，整容器迁过来，Part 里已有容器时排在最后，容器本来就在这个 Part（侧栏拖到零时活动栏里的条目）时只选中它；指针在真实落点（含落点里的工具区）上时不算预备区。放下时同一次写入把这个 Part 显示出来（输出 39）。键盘拖动时预备区按侧栏、右栏、面板的顺序排在可见落点之后。容器从 Panel 移到侧栏自动横转纵，反向自动纵转横；不嵌套工具容器。
21. **半区分配与来源比例**（只用于跨容器边缘并入）：命中窗格原份额 S，原 View 保留 S/2，拖入成员合计 S/2，按来源相对份额 rᵢ 各取 `(S/2) × rᵢ / Σr`，保留顺序；其它目标成员的尺寸意图不变。拖入成员里收起的随归属迁移、不参与分配，展开记忆不变；拖入成员全部收起时只并入，不拆命中窗格。跨轴并入时来源比例用于目标轴的新增份额，不把旧像素宽度当作新高度。可测量来源用释放时当前轴几何，未活动容器用保存的当前轴展开意图；隐藏成员随归属迁移但不占当前分配。同一容器内拖到另一 View 的允许边缘只改顺序，尺寸意图不变；已紧贴目标侧为原位，不提交。插入位挨着展开窗格的前后插入（输出 20）按命中那个展开窗格的边缘并入分配。例：A、B、C、D 各 25%，等比 E、F 落到 D 后缘后 D 为 12.5%、E/F 各 6.25%；E:F 为 3:1 时 E 9.375%、F 3.125%。
22. **拖影与落点反馈**：容器标签与 ActivityBar 容器项起拖显示同一种“图标加文字”拖影；Switcher 插入只画一条插入线（首尾留 4px），不加拖放专用的标签高亮或底部横线；有效边缘只显示命中 View 的对应半区，同区前后两半切换时连续过渡；非法方向无区域、无线；空 Switcher 内容整块是落点，里面内缩的虚线框中央显示“将视图拖动到此处显示”。落点高亮的深浅与拖动边界悬停线的样子由主题 token 定（[`theme/system.md`](../theme/system.md)）：nbook 的高亮是 20% 的底加实色框，悬停线是 3px 强调色实线、不发光，碰到窗体或卡片边的一端缩进 16px，两条边界同时亮时交汇处连着；其余主题沿用 nb-ui 缺省（12% 的底、3px 实线贴满）。预备区是半透明的面板底加虚线框，中央一枚图标加 Part 名称，拖动开始时淡入、结束或取消时淡出；指针停在上面时换成落点高亮与“放到 X”。放下并提交后有一段收尾：高亮从松手时的落点（区域或插入线）滑到拖进去的视图或容器最终所在的位置，再淡出；新显示出来的 Part 从预备区滑到它最终的位置；系统减少动效时直接消失。源视图标题、容器标签与活动条目保持可见、尺寸不变，不插占位。共用 nb-ui 的拖放反馈皮肤（[nb-ui 拖放反馈规范](../../../packages/nb-layout/src/vue/DropFeedbackOverlay.md)）。
23. **键盘拖放**：与指针同一落点判定：空格拿起、方向键沿目标轴、Tab 切换目标区域、Enter 放下、Escape 取消；成员、可见成员、轴、活动内容变化时取消，焦点移到外壳之外（命令面板、对话框打开）时取消且焦点留在那边，失去锚点不降级为追加。拖动进行中这些键归拖动，指针拖动也一样：标签带的方向键不切换容器，收起开关与选择不生效；拿起时停在源自己的原位，直接 Enter 不移动；放下或取消后焦点回到拿起时的拖动源。视图标题、Sidebar single 的容器标题行、容器标签与活动条目都是可聚焦的拖动源：前两者的标题文字是可聚焦的把手，可访问名称写明“拖动 X”；标签与活动条目本身是按钮，保留原名称，以可访问描述说明“按空格拿起并拖动”。Tab 按 Sidebar、AuxiliaryBar、Panel 的顺序经过可见的落点区域，每个 Part 里先条目带、再内容区。AuxiliaryBar 与 Panel 没有容器时，标签带仍占着标题行里框架按钮之外的位置，作为空 Switcher 的条目带落点。手势按 [ui.layout-drag](layout-drag.md)：指针捕获由外壳根持有，失去捕获时取消，触摸拖动中页面不滚动；按下在冒泡阶段接收，分隔线命中带里的按下是调整大小，不起拖。

### 外壳四：标题栏、状态栏与条目

外壳四的输出 28–35 已实现。

28. **标题栏结构**：36px 一行，左组从左到右是品牌的横排标志（标志加字标，墨色跟随文字色）、项目切换（书本图标加显示名）、一道短分隔与应用菜单，中间是居中的命令搜索，右组是布局按钮（侧栏、面板、右栏）与条目区。左组放不进标题栏的一半时左栏按内容撑开、搜索往右让，不挤出界。
    - 命令搜索是按钮：点开命令面板，提示命令面板的快捷键，按平台写出修饰键（[workbench.commands](../workbench/commands.md) 的“快捷键的显示”）。
    - 项目切换显示当前项目的显示名，没有项目时显示“打开项目…”；点开至少有“打开项目…”（`nbook.project.open`）。作品列表随书架页的作品数据加入。
    - 布局按钮是切换按钮，按下态取输出 32 的公开键，经输出 32 的命令执行。
    - 浏览器里不画窗口控制。
29. **应用菜单**：四组（文件、编辑、视图、帮助）的标题与顺序由工作台定，条目来自贡献点 `workbench.titlebar-menu`：各插件给自己的命令贡献菜单项、声明所属的组；条目的显示、可用、标题、快捷键、勾选、排序与分隔线按 [`workbench.menus`](../workbench/menus.md)，执行一律经命令服务。
    - 一组里没有显示的条目时不画这一组。
    - 菜单的编辑项（撤销、重做）与命令面板一样作用于活动编辑器，不按焦点区分；焦点在原生输入框时菜单不代替它撤销。
    - 产品里的条目与贡献方（节之间是分隔线）：

      | 组 | 条目（命令与固定参数） | 贡献方 |
      |---|---|---|
      | 文件 | 打开项目（`nbook.project.open`）｜保存、全部保存、还原为磁盘版本（`nbook.editor.save`、`save-all`、`revert`）｜关闭编辑器、关闭其它编辑器（`nbook.editor.close`、`close-others`） | 作品、编辑器 |
      | 编辑 | 撤销、重做（`nbook.edit.undo`、`redo`） | 编辑器 |
      | 视图 | 命令面板（`nbook.quick-open.open-commands`）｜侧栏、右栏、活动栏（`nbook.view.set-part-hidden {part}`，勾选）、面板（`nbook.view.set-panel-hidden`，勾选）、面板位置（`set-panel-position`）、最大化面板（`toggle-panel-maximized`）｜向右拆分、向下拆分、用其它编辑器重新打开（`nbook.editor.split-right`、`split-down`、`reopen-with`）｜切换主题、明暗、界面语言（`nbook.settings.switch-theme`、`switch-appearance`、`switch-locale`）｜重新载入（`nbook.app.reload`） | 工作台、编辑器、设置 |
      | 帮助 | 欢迎（`nbook.help.welcome`）、文档（`nbook.help.documentation`） | 作品、工作台 |

    - 节名：文件 `1_open`、`2_save`、`3_close`；编辑 `1_undo`；视图 `1_palette`、`2_layout`、`3_editor`、`4_appearance`、`5_reload`；帮助 `1_help`（上表里以“｜”分开的就是这些节）。别的插件的条目写同样的节名就排进同一节，写别的名字就按名字另起一节。
    - 旧桌面菜单的 15 个 id 的去向见 [workbench.commands](../workbench/commands.md) 的“兼容与安全”。
30. **逐级让位**：按标题栏容器的实测宽度（不是窗口宽度）与各部件此刻的实测宽度，放不下就收下一项，不写死宽度边界，语言、项目名长短不同时切换点跟着变：
    - 依次是：横排标志换成单独的图形标志；菜单栏收成 ≡ 图标按钮，点开是“文件、编辑、视图、帮助”四行，悬停或方向键展开各自的子菜单；收起搜索里的快捷键提示；布局按钮收进 ≡ 的“视图”组（视图组本来就有对应的勾选项）；项目切换只留书本图标（悬停与读屏仍是全名）。
    - 搜索取中间剩下的宽度，最宽 560px、最窄 120px，到最后仍是一条带文字的长条。条目区照旧按第 34 条收进它自己的“更多”。
    - 往回展开要多出 40px，窗口宽在切换点附近来回拖时不跳。
    - 任何宽度下菜单入口都在；关键按钮不被遮挡、不被裁切。
31. **菜单键盘与焦点**：
    - Alt 或 F10 聚焦菜单入口（完整时是第一组，紧凑时是“菜单”按钮）；
    - 左右键在组之间移动，上下键在项之间移动并跳过分隔线，Home、End 到两端；禁用项可以停留，不能执行；
    - Enter 或空格执行；Escape 关闭菜单，焦点回到打开菜单之前的位置；
    - 菜单关闭后焦点不留在已卸载的元素上。
32. **Part 的可见与切换**：侧栏、右栏、活动栏“可见”指未隐藏且未拖到零。
    - 命令 `nbook.view.set-part-hidden {part?, hidden?}`：`part` 省略时经选择服务选择区域，取消无副作用；`hidden` 省略时按可见切换；“显示”同时清掉隐藏与拖到零，按记忆尺寸回来。写用户定制记录，按字段合成（与面板显隐相同）。
    - 公开状态增加下表三个键，未就绪时为 `false`：

      | 键 | 类型 | 未就绪时 | 含义 |
      |---|---|---|---|
      | `nbook.workbench/sidebarVisible` | 布尔 | `false` | 侧栏可见 |
      | `nbook.workbench/auxiliaryBarVisible` | 布尔 | `false` | 右栏可见 |
      | `nbook.workbench/activityBarVisible` | 布尔 | `false` | 活动栏可见 |

33. **条目贡献点**：`workbench.statusbar-items` 与 `workbench.titlebar-items`，写法与 `workbench.views` 相同。
    - 声明（静态数据，登记时校验）：`{title, alignment: "left" | "right", order, priority, command?: {id, args?}, when?}`。`title` 是条目的名字，用于“更多”菜单与读屏，是界面文字值（[ui.i18n](i18n.md)）；不写时登记时补成贡献方插件目录里的键：状态栏条目 `statusItems.<本地 id>.title`，标题栏条目 `titlebarItems.<本地 id>.title`（本地 id 是条目 id 去掉开头的 `<插件 id>.`，规则见 [ui.i18n](i18n.md) 的“约定键”）。标题栏条目只接受 `alignment: "right"`。
    - 实现（浏览器入口激活时交出）：`{text(): Text, tooltip?(): Text, state?(): "normal" | "warning" | "error"}`，响应式读取。数据由贡献方从自己的状态算出，外壳只渲染、不读领域状态。`text()` 与 `tooltip()` 返回文字值，外壳渲染时按窗口当前语言翻译：返回同一个文字引用时，切换语言后条目照样换文字。运行期的文字不经登记，引用要自己带命名空间（插件 SDK 的 `pluginText`，[runtime.plugin-api](../runtime/plugin-api.md)）。
    - 可见：只由 `when`（公开状态的布尔键，规则同命令）决定，不满足时不渲染；`text()` 不承担隐藏。
    - 排序：按 `alignment` 分两侧，同侧按 `order` 升序，再按条目 id。
    - 点击：有 `command` 的条目是按钮，经命令服务执行，命令不可用时禁用并以原因作提示；没有的是纯文字（`role="status"`）。
    - 冲突与撤回：同 id 的两条贡献一起拒绝并记诊断；贡献方入口开始停止时条目立即消失，之后不再调用它的实现（含打开着的“更多”菜单）；实现抛错的条目原位显示为不可用并记诊断，不影响别的条目。
34. **条目的溢出**：放不下时按优先级收进“更多”按钮，不让条目互相遮挡、不出现横向滚动。
    - 固定区先占：状态栏左侧的项目名与布局问题、右侧的“显示面板”；标题栏的品牌、菜单入口、搜索与布局按钮。
    - 全部放得下就全部显示。否则先为“更多”留出完整按钮位，再按 `priority` 降序、`order` 升序、id 依次放入，第一个放不下的和它之后的都收起：优先级高的总在优先级低的之前显示。被收起的条目按原来的显示顺序列在“更多”里；纯文字条目在那里也是不可执行的一行文字。
    - 条目文字、显示语言、可见性或容器宽度变化后重算。单个条目最宽 320px，超出时省略并以全文作提示；在“更多”里换行显示全文。
35. **状态栏**：左侧是项目名或“未打开项目”与布局问题（输出 11），之后是 `alignment: "left"` 的条目；右侧是 `alignment: "right"` 的条目，最右是“显示面板”。条目只显示贡献方给出的真实数据；编辑器提供的第一批条目见 [workbench.editor](../workbench/editor.md) 的“状态栏条目”。

### 无项目首页与第二页

随书架页实现。

36. **首页贡献点 `workbench.home`**：没有绑定项目的窗口打开 `/` 时，外壳换成首页贡献的内容；文档根（主题、语言）、命令宿主与通知视口（[workbench.notifications](../workbench/notifications.md)）照常挂着。
    - 声明 `{title}`（界面文字值，不写时补成约定键 `home.<本地 id>.title`，见 [ui.i18n](i18n.md) 的“约定键”），实现 `{load(): Promise<Component>}`，只接受浏览器入口的贡献。
    - 裁决按已接受的声明数量：0 个显示空工作台；1 个采用；多个全部不采用、按 id 排序记诊断。与登记顺序无关。
    - 每次渲染经当前句柄取实现；贡献撤回、入口停止或加载失败时退回空工作台并记诊断，入口恢复后再次采用。首页不占用布局（不取布局 store），直接打开首页的窗口不读产品布局记录。
    - 绑定了项目的窗口不受影响。
37. **`/workbench`**：工作台的第二个内置页面，不打开作品、直接进入空工作台（用户资产、命令面板与状态栏照常）。绑定由 `?project=` 决定、不看路径，所以 `/workbench?project=x` 与 `/?project=x` 相同。书架页不放它的入口，直接输入地址进入。

### 工作台打磨

打开作品之后那一页的外观与缺省显隐。

38. **卡片还是平铺由主题决定**：外壳读主题变量 `--shell-gap`、`--shell-ground`、`--shell-card-radius`、`--shell-card-shadow`、`--shell-chrome-surface`、`--shell-chrome-line`、`--shell-seam`、`--shell-join-divider`、`--shell-pane-divider`、`--shell-pane-divider-inset`（[`theme/system.md`](../theme/system.md)），缺省即平铺。
    - **卡片**（nbook）：活动栏、侧栏、编辑区、右栏与面板各是窗体底（`--bg-main`）上的一张圆角卡片（12px，不带外框，浅色一层淡投影、深色一圈淡外框）。贴着窗体、标题栏或状态栏的一边留整缝（4px），挨着别的部件的一边留半缝并扣掉两者之间边界占的一半，两张卡片之间合起来也是 4px；活动栏与通高的侧栏合成一张卡片，相接处不留缝、两角不圆，中间一条两端离顶底各 10px 的短线（侧栏隐藏、拖到零或面板跨到侧栏下方时不相连；相连与否按拖动中的宽度算：从零往外拉、往零拖时都不等松手）。标题栏与状态栏落在窗体底上、不画线；网格接缝不画，边界仍可拖。卡片里同一个容器的分栏之间仍画 1px 的 `--divider` 线，沿长轴两端各缩进 10px，不碰到卡片边（开放式分割线）。
    - **平铺**（macos）：部件贴着窗体，没有外框、圆角与外边距，外壳与各部件是同一块面板底色（`--panel-surface`）；可见的线只有标题栏底线、状态栏顶线与外壳网格边界上的 1px 接缝（默认布局里只有侧栏与编辑区之间一条竖线，显示右栏或面板时各多一条），以及容器里分栏之间贯穿的 1px 线。
    - 两种都一样：部件自己不画外框与圆角；工具区标题行、视图标题行、面板标题行与编辑器标签栏都不画底线；工具区、视图与面板的当前标签用加粗的正文色区分，编辑器标签栏的当前标签是与正文同色的一块（[`workbench/editor.md`](../workbench/editor.md) 输出 53）。工作台页占满视口、自己不滚动，页面根不预留滚动条位置。
39. **空着的右栏与面板缺省不显示**：“空着”指现在没有容器，也没有视图把它声明为默认位置。空着、用户也没主动显示过的右栏与面板不显示，也不为此写记录。用标题栏按钮、视图菜单、命令或状态栏“显示面板”显示后，照输出 7、9 保存与恢复：右栏记为“主动显示过”，之后再隐藏就撤掉这一笔；面板写显式的显隐。把声明在这里的视图都拖走，区域照常显示、仍是落点（输出 20）；经“移动到”把视图放进不显示的空区域时，区域随之显示。经拖放或“移动到”把视图、容器从别的区域放进收起成 32px 标题头的面板时，同一次写入清掉面板的收起；面板里自己换序不展开。落在拖动时浮出的预备区（输出 20）时，同一次写入把这个 Part 显示出来：隐藏位与拖到零都清掉，右栏记为主动显示过，面板也不收起。

### 活动栏底部条目与页面浮层

输出 40、41 已实现，随设置窗口（[settings.window](../settings/settings-window.md)）：工作台活动栏的设置齿轮与设置窗口本身经这两个贡献点接进工作台（书架右上角的齿轮是书架自己画的，见 [workbench.bookshelf](../workbench/bookshelf.md) 输出 1）。

40. **活动栏底部条目 `workbench.activitybar-items`**：底段的全局项（账号、设置这类）由插件贡献，写法与输出 33 的条目贡献点相同。
    - 声明（静态数据，登记时校验）：`{title, icon, order, command?: {id, args?}, when?, toggled?}`。`title` 是悬停提示与可访问名称，是界面文字值，不写时补成约定键 `activityItems.<本地 id>.title`（见 [ui.i18n](i18n.md) 的“约定键”）；`toggled` 是公开状态的布尔键。条目只有声明、没有实现，但只接受浏览器入口的贡献，随贡献方入口出现与消失：入口交空对象（内核要求入口贡献都给出实现）。id 规则同输出 33。
    - 排列：按 `order` 从上往下排在活动栏底部，同值按条目 id；上段容器多到放不下时上段滚动，底段不动。
    - 可见：只由 `when` 决定（规则同输出 33），不满足时不渲染。
    - 样子与点击：有 `command` 的条目是与上段容器项同样的图标按钮，经命令服务执行，命令不可用时禁用并以原因作提示；`toggled` 的键已就绪且为真时画成按下：灰底、图标正文色，不用强调色（强调色留给上段的当前容器）。没有 `command` 的条目不可点，是圆形、淡色的占位（同书架右上角的头像位），以 `title` 作提示。
    - 冲突与撤回：同 id 的两条贡献一起拒绝并记诊断；贡献方入口开始停止时条目消失。
    - 现有条目：`nbook.workbench` 贡献头像占位（`order: 900`，没有命令，提示“个人资料尚未开放”；账户插件迁回时由它贡献真正的头像并删去占位）；`nbook.settings` 贡献设置齿轮（`order: 1000`，命令 `nbook.settings.open`，`toggled: nbook.settings/windowOpen`），在最下面。
41. **页面浮层 `workbench.overlays`**：插件交一个组件，工作台在页面根上挂一份。书架是首页贡献、与工作台页用同一个页面根，所以首页、`/` 与 `/workbench` 都挂，每个浏览器页面一份，随页面卸载。
    - 声明 `{order?}`（挂载的先后，同值按 id），实现 `{load(): Promise<Component>}`，组件不收属性，要的数据由贡献方在 `load()` 里绑好；只接受浏览器入口的贡献，id 规则同视图。
    - 页面根挂上时就加载；贡献撤回、贡献方入口停止或工作台入口停止时卸下；同一个浮层重新交付时重新加载；加载结果回来时浮层已卸下就丢弃，不挂、也不记为失败。
    - `load()` 失败或组件渲染出错只让这一个浮层不显示并记诊断，别的浮层与页面照常；浮层不在页面里占位，没有原位呈现。
    - 现有浮层：`nbook.settings` 的设置窗口。

## 状态与转换

布局状态（[外壳设计稿](../../proposals/workbench-shell-abstractions.md) 第 6 节）：

| 层级 | 内容 | 记录与分区 |
|---|---|---|
| 侧栏尺寸 | Sidebar、AuxiliaryBar 宽度 | `layout-sizes-side`：窗口绑定项目时 project / local，否则 user / local |
| 面板尺寸 | Panel 高度与宽度 | `layout-sizes-panel`：同上 |
| 用户定制 | 面板位置、对齐、隐藏、收起；Part 显隐与拖到零（外壳一），主动显示过的空右栏（输出 39）；容器位置、顺序与各区域选中项、视图归属、顺序、尺寸、收起、自建容器、默认指纹（外壳二、三） | `views-customizations`：user / local |
| 只在内存 | 瞬时最大化、呈现事实（紧凑、生效的面板状态）、拖动预览、焦点 | 不保存 |
| 排除 | 领域数据、视图自己的状态 | 各自的拥有者；视图状态由所属插件用自己的 store 声明 |

三条记录经 `nbook.storage` 保存（[storage.persistence](../storage/persistence.md)），持久化字段的状态按 [state.store](../state/store.md)：读取分类、已确认值与 revision、当前显示、未保存意图与保存状态。同一客户端的多个窗口共用 `local` 记录。

| 初始状态 | 事件 | 下一状态 | 拒绝条件 |
|---|---|---|---|
| 记录未读完 | 打开外壳 | 默认布局显示，尺寸手势与依赖就绪的命令不可用 | 无 |
| 无记录 | 读取完成 | 默认布局，可调整 | 无 |
| 已恢复布局 | 用户定制或尺寸调整结束 | 按字段提交本次主动改变的值，确认后更新已确认值 | 同值、测量、临时夹取、拖动中 → 不产生保存 |
| 记录损坏或版本不支持 | 读取完成 | 默认布局 + 诊断，原件保留，普通保存不覆盖 | 不做部分恢复 |
| 恢复尺寸越界 | 读取完成 | 夹取到该叶的最小或最大值 + 诊断 | 不改写记录 |
| 快照引用未知容器或视图（外壳二） | 读取完成 | 呈现中忽略该条 + 诊断，其余照常 | 不删原件、不整份回默认 |
| 用户覆盖基于的默认指纹与当前默认不同（外壳二） | 读取完成或声明变化 | 该覆盖在呈现中失效，回到新默认 + 诊断 | 不删原件；下一次针对该项的意图才改写它 |
| 另一窗口保存了同一记录 | 收到订阅 | 只更新已确认值，本窗口当前显示不被强改 | 无 |
| 保存冲突 | 条件保存被拒 | 重读后只重放本次主动修改的字段，再保存一次 | 再失败 → 保留当前显示与未保存意图，提供重试与放弃 |
| 宽屏且瞬时最大化 | 呈现事实变为紧凑 | 清除内存最大化 | 不写任何记录 |

- 每个定制意图按字段合成：改面板位置只改 `panel.position`，改一个 Part 的显隐只增删这一个 Part；冲突重放时同一个修改作用在最新值上，另一个窗口改的其它字段保留。两个窗口改同一字段时，后保存的胜出。
- 一次尺寸手势按涉及的记录各提交一次（侧栏宽度与面板两轴可能同在一次交汇手势里）；两条记录不是事务，一条失败不回滚另一条，重试只补失败的那条。
- 容器选择归工作台，单个容器内不引入活动视图的权威（外壳二）。移动视图的意图带来源容器：执行时视图已不在来源容器则拒绝且零写入；已接纳的移动在保存冲突重放时按“同字段后保存胜出”作用在最新值上。一次边缘并入同时接纳成员归属、顺序、尺寸、目标选择与源空容器清理；任一成员不可移动、来源变化或命中窗格失效则整组拒绝（外壳三）。保存时（含冲突重放）对最新值求本次涉及的自建容器的实际成员：目标自建容器已被另一窗口清掉的，按本次捕获的身份重建；真的没有成员的才清除它的记录项与指向它的选中项。带半区的并入保存时核对目标容器仍在同一轴、命中窗格仍是它的成员，不成立则这次保存整条不写并记诊断（外壳三）。

## 副作用与数据

- 持久化：只写上表的三条记录；不写领域数据，不另建尺寸持久化。尺寸只记录主动变化的可保存叶（侧栏、右栏宽度与面板两轴）的正有限 CSS px；编辑器与嵌套分支只是余量，补偿值、降级值、0 都不进记录。
- 外壳二在 `views-customizations` 加三组可选字段，记录版本不变、旧记录仍合法：`containers`（容器 id → 位置、顺序、默认指纹）、`selected`（ToolPart → 选中容器 id）、`views`（视图 id → 所属容器、顺序、宽、高、收起、默认指纹）。id 至多 128 个字符，指纹是至多 64 个字符的稳定编码；按此估算，单条记录 64 KiB 的上限容得下数百个视图项。超出上限时 Storage 拒绝写入，走“失败与恢复”的保存失败路径。
- 工作台打磨在 `views-customizations` 加可选字段 `shownParts`（主动显示过的空区域，现在只记 `auxiliarybar`，输出 39），记录版本不变。
- 视图尺寸（外壳二、三）：只记录主动变化的当前轴；部分补丁逐字段合成，保留另一轴、收起位与未知字段；重复视图或非法条目整批拒绝，空补丁不创建记录。声明可给双轴 `minimumSize`/`maximumSize`；有效主轴最小值为 max(33, 声明值或 64)，最大值低于有效最小值时注册失败；默认意图 240 × 正的有效权重（否则 1）。
- 自建容器（外壳三）：单 View 拖到 Switcher、空 Part 或经“新建容器（在 X）”时生成一次稳定的 `custom:<UUID>` 身份，创建、归属、顺序、目标选择与源空容器清理同次保存；冲突重放复用该身份；自建容器实际搬空时清除其布局记录。记录项是 `containers[custom:…] = {location, order, origin}`（`origin` 是创建时的视图，标题回落的第 3 级）；隐式容器项是 `{location, order, fingerprint}`，两种项分别必有 `fingerprint` 或 `origin`。
- 半区并入（外壳三）写在尺寸意图里：命中窗格的意图 S（没记录过取 240）保留 S/2，拖入的可见成员合计 S/2 按来源相对比例分；只写命中窗格与拖入成员的当前轴，其它目标成员、收起成员的展开意图与另一轴都不变。全部可见视图收起时拖入剩余区，同次清掉拖入成员的收起。
- 视图只发出结构化意图；写入、保存与领域数据仍归各自的拥有者。

## 失败与恢复

- 布局记录损坏、版本不支持：回落默认布局、诊断可枚举，不阻塞外壳打开；原件保留，只有有效迁移或用户显式重置才替换。
- 读取失败：允许临时调整并明确显示“未保存”；记录之后恢复可读时按已确认值继续。
- 保存失败：确定失败（冲突重放后仍被拒、写入失败）与结果未知（`unknown-outcome`）都只暂停该条记录的保存，当前显示与未保存意图保留，状态栏给出原因与重试、放弃；放弃回到已确认值。别的记录照常保存。
- 呈现降级（紧凑、面板退到标题头、编辑器取 0）只影响当前呈现，诊断写在外壳根上，不触发保存。
- 视图实现加载失败、所属入口停止（外壳二）：按 `workbench/views.md`，不遮蔽其它视图、不拖垮外壳。
- 拖放失败（外壳三）：新容器创建、成员迁移或半区计算失败时保留原归属与布局，不留空标签、不丢视图；非法方向释放不生成保存意图；Escape、pointercancel、失去指针捕获、失焦、页面隐藏或目标失效结束拖放并清除反馈，不提交旧预览。
- 活动栏底部条目、页面浮层的声明不合规则（输出 40、41）：声明被拒，内核诊断写明原因，条目或浮层不出现。
- 页面浮层的 `load()` 失败或组件渲染出错（输出 41）：这一个浮层不显示，诊断 `workbench.overlays` 写明浮层 id 与原因；页面与别的浮层照常，刷新页面重新加载。

## 边界与兼容

- 归属：`nbook.workbench`；嵌套网格与手势原语的合同由 [ui.nested-grid](nested-grid.md) 提供，外壳负责消费接线。
- 主题与浮层：沿用 [theme.system](../theme/system.md) 与 nb-ui 现有 portal，不新增第二套。外壳与浮层颜色来自主题 token，四主题 × 双配色下不出现 `:root` 兜底底色。
- 公开合同：公开状态键（输出 13）与面板命令（[workbench.commands](../workbench/commands.md)）是对插件与 Agent 的合同；贡献点 `workbench.editor-area`、`workbench.statusbar-items`、`workbench.titlebar-items`、`workbench.activitybar-items`、`workbench.overlays` 与 `workbench.home` 是对插件的合同；布局记录的字段是 `nbook.workbench` 的内部合同，靠记录版本演进。
- 窄屏：`390 × 844` 与桌面共享同一模型，无页面级横向滚动。
- Lab：外壳的 Lab 场景用局部状态，不读写产品布局记录；直接打开 Lab 的窗口不打开、不订阅产品布局记录（[ui.component-lab](component-lab.md)）。

## 验收与 Smoke

### 外壳一

1. Given 1440×900 的外壳容器，When 依次把面板放到四个位置与四种水平对齐，Then ActivityBar 始终是主体左侧通高列、面板从不跨过它，`justify` 只跨左右侧栏，ActivityBar 底边与主体底边对齐；无双重边框、标题条或标签条。
2. Given 可调边界，When 拖过最小或最大值，Then 停在边界不弹回，松手后各记录只提交一次；When 刷新，Then 布局按记录恢复。When 用键盘调整、按 Escape 或在拖动中改变容器尺寸，Then 键盘按 nested-grid 的步长生效，取消与上下文变化不提交。
3. Given 侧栏与面板，When 拖到零，Then 内容 0px、保留 1px 边界、记录里没有 0，从边界拉回时跟随指针，按钮、命令与 Enter 恢复记忆尺寸。
4. Given 面板，When 分别隐藏、收起、最大化，Then 三种形态互不等价：隐藏零占用、状态栏“显示面板”同时清除隐藏与收起；最大化保留 ActivityBar、侧栏、标题栏、状态栏，还原回原尺寸；收起只留标题头；换位置、对齐、隐藏、收起后最大化清除且不写盘；同值操作不新增写入。Given 底部居中的面板，When 把面板上沿一直往上拖，Then 停在编辑器的最小高度，再往上越过 24px 即最大化，面板的尺寸记录不变；When 从最大化往下拖过编辑器的最小高度，Then 还原，面板高度跟着指针并保存；右侧面板往左拖同理。Given 1440×1400 的窗口，When 把面板拖到 1000px 再把窗口压到 900，Then 面板压到给编辑器留出最小高度，不退成标题头。
5. Given 外壳容器宽 390 与高 260，When 操作面板，Then 无页面级横向溢出、框架按钮与“显示面板”可达且未被裁切、编辑器取得非负余量；位置、对齐、最大化命令不可用并有原因；恢复宽屏后保存的位置与对齐不变。Given 宽屏下已最大化，When 进入紧凑再回到宽屏，Then 不再最大化，三条记录的 revision 不变。
6. Given 编辑器槽里有输入与滚动的内容，When 最大化、换位置、隐藏面板、紧凑往返，Then 内容实例不变（创建 1 次、卸载 0 次），输入、滚动与焦点保留；隐藏使焦点内容停放时焦点到“显示面板”，最大化时到面板标题；停放内容不进入 Tab 顺序；外部菜单或对话框的焦点不被抢。
7. Given 记录被写成损坏内容、不支持的版本与越界尺寸，When 打开外壳，Then 逐条诊断并按规则回落默认或夹取，原件不变，没有空白外壳或未捕获异常。
8. Given 同一客户端的两个窗口，When A 改面板位置、B 改对齐，Then 两项都保留；When 两个窗口各改一个 Part 的显隐，Then 两项都保留；When 两个窗口改同一字段，Then 后保存的胜出；另一窗口保存后本窗口当前显示不被强改。
9. Given 绑定项目 A 的窗口与未绑定的窗口，When 各自调整尺寸，Then 尺寸分别写在项目 A 的 project 分区与 user 分区，互不影响；面板与 Part 状态都在 user 分区。
10. Given 保存失败（写入失败、结果未知、读取失败后恢复），When 继续操作，Then 状态栏显示“布局未保存”与原因，重试只补失败的那条记录，放弃回到已确认值，别的记录照常保存。
11. Given 公开状态，When 面板位置、紧凑与就绪变化，Then 五条面板命令随之可用与不可用；带参数直接执行，省略参数时位置与对齐经选择、隐藏与收起切换，非法参数为 `invalid-args`；经命令面板执行能改变布局。
12. Given 四主题 nbook、macos、editorial、aurora × nbook-light、nbook-dark 的 Lab 外壳场景（1440×900 与 390×844），以及产品页 nbook 与 macos 的默认明暗，When 截图并读计算样式，Then 外壳根、面板、状态栏的背景、文字、边框等于对应 token 的解析值，结构边界只有一个绘制者。DPR 1.25、1.5、2 的线与热区单独验证，不声明未执行的组合。
13. Given 直接打开 `/lab` 的窗口，When 浏览外壳场景，Then 不打开、不订阅产品布局记录。

### 外壳二

14. Given ActivityBar 与侧栏，When 点击容器、再点当前项、或恢复隐藏、拖到零的 Sidebar，Then 容器选择互斥且能打开，再点当前项收起、再点又打开，显式恢复用记忆尺寸。
15. Given empty、single、multiple，When 可见成员 1→2→1 或首个视图变化，Then 标题与图标同源、动作上提正确、旧菜单失效，实例的输入、滚动与代际保持；single 不出现第二个标题或不可展开的空白。
16. Given 容器在 Part 之间切换或来源 Part 搬空，When 目标落点卸载或重新登记，Then 容器宿主退回停放区，目标恢复后搬回；来源 Part 显示空态。
17. Given 容器实际成员数为 1，When 最后一个视图移出，Then 源容器与标签一起消失；Given 成员仍在但全部隐藏，Then 容器不移除。
18. Given 记录引用未知容器或视图，When 打开外壳，Then 只在呈现中忽略该条并诊断，其余照常，原件不删。
26. Given 侧栏两个未分组的视图 A、B，When 经“移动到”把 B 移入 `view:A`、再把 A 移到另一个容器，Then 入口与选中随之变化，内容 single→multiple→single，B 的实例不变；之后操作 `view:A` 的菜单，B 不随 A 移动；重置 A、重置 B 后回到初始。
27. Given 打开的“移动到”菜单，When 视图被另一窗口或命令移走、容器切模式或视图重试换代，Then 菜单关闭，旧点击零写入；When 从命令面板执行“移动视图”，Then 依次选择视图与目标，取消任一步无写入。
28. Given multiple 的两个视图，When 收起 A、移出 B、再移回 B，Then A 在 single 时展开但记录不变，B 回来后 A 重新收起；Panel 横向的 32px 竖条可用键盘展开。
29. Given 侧栏纵向与 Panel 横向的 multiple 容器，When 拖动或用键盘调整视图之间的边界、按 Escape，Then 只提交主动叶的当前轴，Escape 不提交；收成 32px 后恢复记忆尺寸；降级与补偿不写盘。
30. Given 有输入与滚动的视图（`scroll` 与 `fill` 各一），When 可见成员 1→2→1、跨容器、跨 Part 移动、所在 Part 隐藏再显示，Then 每一步实例不重建，输入、滚动与焦点按输出 18 保留。
31. Given 390 × 844 的产品页，When 只用键盘切换 Panel 的容器、打开“移动到”、按 Escape 返回、最大化面板，Then 焦点落点可预期，单标签、长标签与五个框架按钮都可达，无页面级横向溢出。Given 面板里三个容器，When 窗口从 1920 逐步收窄到 860，Then 面板标签带依次经过完整、截断、只留图标、“更多 N”四档，选中的始终带标题，从“更多”选中的回到标签带；Given 侧栏六个容器，When 窗口高 300，Then 活动栏末尾的条目收进“更多”、不滚动，选中的在外面。

### 外壳三

19. Given 单 View 与整容器两类源，When 指针或键盘插入、并入、取消，Then 预览与动作一致，一次手势只接纳一次结果，隐藏成员不遗漏，非法成员或失效目标整组拒绝；非法方向零提交、零落点反馈，源拖影独立存在。
20. Given 三个 ToolPart 各自没有容器标签，When 单 View 或整容器分别拖到空内容区与真正的 Switcher 条目带，Then 四条路径都可接收；单 View 创建一个容器，整容器不额外嵌套，目标被选中且只提交一次；标题文字与工具按钮区仍拒绝。Given 右栏与面板都隐藏、或侧栏拖到零，When 拖动单 View 或整容器，Then 没显示的各浮出一块预备区（不改布局，紧凑呈现不浮出），指针在真实落点上时不算预备区；放到预备区，该 Part 显示出来并装着拖进来的视图或容器、选中它，与归属同一次写入；键盘拖动时 Tab 在可见落点之后经过预备区。
21. Given 40×40 的 ActivityBar 容器项与横向容器标签，When 分别起拖并经过 Switcher 插入位，Then 拖影都含图标和文字，只出现一条插入线，没有拖放专用的标签高亮或底部横线；结束后拖影与反馈释放。
22. Given 单 View 拖到已有标签上，When 按其前后插入位释放，Then 新容器与新标签出现在同一插入位，悬停标签的成员不变；实际搬空的源容器消失。
23. Given A、B、C、D 各占 25% 且空间满足最小尺寸，When 等比 E、F 落到 D 的允许后缘，Then A、B、C 保持 25%，D 为 12.5%，E、F 各 6.25%；E:F 为 3:1 时分别为 9.375% 与 3.125%；目标标签数不增加，所有视图同层可操作。
24. Given Panel 的横向多视图容器，When 搬入侧栏再搬回 Panel，Then 成员顺序保持并自动换轴；侧栏左右与 Panel 上下都不是有效落点；跨轴边缘并入仍按来源比例分配。
25. Given 展开的内容窗格，When 指针在前后两半之间移动并释放，Then 中点归后半、没有中央禁投区，反馈连续过渡；Given 全部可见视图收成细条，When 拖到两条标题之间或剩余区，Then 预览是一条插入线、提示“放在“X”前／后”，放下后拖入视图在插入位展开、原有视图保持收起；Given 一个展开、其余收起，When 拖到收起视图的前半或后半，Then 插在它前后、不拆细条，挨着展开窗格时与它平分。

### 外壳四

32. Given 1440×900 的产品页，When 读标题栏，Then 横排标志、项目切换、四组菜单依次在左，搜索居中，三个布局按钮与条目区在右，36px 一行里互不遮挡；状态栏仍为 22px。
33. Given 应用菜单，When 逐组打开，Then 只出现命令目录里有的项；不可用的项禁用且悬停与可访问描述里是原因；“打开文件”“设置”“退出”“剪切、复制、粘贴、全选”“缩放”“关于”都不出现；勾选项与公开状态一致。
34. Given 活动编辑器里改过正文，When 点开“编辑”执行“撤销”，Then 正文回退；When 用 Alt（或 F10）、方向键与 Enter 执行同一项，Then 结果相同，Escape 后焦点回到菜单打开前的位置；没有活动编辑器时撤销禁用并给出原因。
35. Given 中文界面与项目名，When 窗口从 1440 每次收窄 10px 到 390，Then 档位只增不减、依次收起横排标志、菜单栏、快捷键提示、布局按钮与项目名，搜索不窄于 120px，任何宽度都有可点的菜单入口；收成 ≡ 后点开是四组、悬停展开子菜单；从切换点往回放宽 30px 不变、60px 才展开；长项目名、英文界面与条目共存时关键按钮的可见矩形完整、互不重叠。
36. Given 侧栏分别处于隐藏、拖到零与紧凑往返之后，When 点标题栏的侧栏按钮、视图菜单的侧栏项与命令面板的“切换区域显隐”，Then 侧栏回到记忆尺寸，按钮的按下态、菜单勾选与实际可见一致；命令面板省略参数时先选区域，取消不写入。
37. Given 有未保存正文的窗口，When 执行“重新载入”并在离开确认里取消，Then 正文仍在；When 确认，Then 页面重新加载、地址的项目参数不变。When 执行“文档”，Then 文档站在新标签打开，原页面与正文仍在；新标签被拦截时命令说明原因。
38. Given 测试插件贡献的状态栏与标题栏条目，When 入口激活、同 id 的第二条贡献、入口停止，Then 条目出现、两条同 id 都被拒并诊断、停止开始时条目消失；When 收窄容器，Then 按 priority 收进“更多”（恰好装下、差一个“更多”的位、同优先级、全部收起、长文字各一例），点开“更多”能执行有命令的条目、纯文字不可执行；“更多”打开时入口停止，菜单里的该条消失。
39. Given 两个窗口，When 各自编辑不同的文档，Then 各自的状态栏条目只反映本窗口的数据。

### 无项目首页

40. Given 没有项目的窗口与书架插件，When 打开 `/`，Then 看到书架页而不是外壳，主题 token 与命令面板照常；When 打开 `/workbench`，Then 是空工作台；When 两个插件都贡献首页，Then 都不采用、回到空工作台并有诊断；When 贡献方入口停止，Then 页面退回空工作台，恢复后再次采用。

### 工作台打磨

41. Given 1440×900 的产品页（默认布局），When 读计算样式与截图（nbook、macos 各明暗两态），Then 活动栏、侧栏、右栏、工具区与视图标题行、面板标题行自己都没有边框与圆角，外壳根底色等于 `--shell-ground`，页面右缘没有空出的滚动条位置；nbook：活动栏卡片离窗体左缘与标题栏各 4px，活动栏与侧栏相连（相接两角为 0、之间是 `--divider` 的短线），侧栏与编辑区两张卡片之间 4px，卡片圆角 12px，标题栏底线与网格接缝透明；macos：部件贴着窗体，侧栏与编辑区之间只有 1px 接缝，标题栏底线与接缝是 `--divider`，没有短线。
42. Given 一个右栏与面板里都没有视图的新客户端，When 打开工作台，Then 右栏与面板不显示、不写记录；When 从标题栏显示右栏、从状态栏显示面板并刷新，Then 两处仍显示；When 再隐藏右栏，Then 记录撤掉“主动显示过”。Given 有视图声明在右栏与面板，When 把视图都拖走，Then 两处仍显示且可作落点；When 经“移动到”把视图放进不显示的空区域，Then 区域随之显示；Given 面板收成标题头，When 从侧栏把视图拖到面板的标签带，Then 面板展开并显示它，与归属同一次写入；面板里换序不展开。

### 活动栏底部条目与页面浮层

43. Given 测试插件贡献的活动栏底部条目（有命令、没有命令、带 `toggled`、带 `when`），When 入口激活、公开状态变化、命令变得不可用、同 id 的第二条贡献、入口停止，Then 条目按 `order` 排在底部，`when` 不满足时不显示，`toggled` 为真时按下，没有命令的不可点，命令不可用时禁用并以原因作提示，同 id 的两条都被拒并诊断，停止开始时条目消失。Given 产品页，Then 活动栏最下面头像占位在上、设置齿轮在下，设置窗口开着时齿轮按下。
44. Given 几个浮层贡献，其中一个 `load()` 失败、一个渲染出错，When 打开首页与工作台页，Then 两种页面都挂着浮层；失败的浮层不显示并记诊断，别的浮层与页面照常；When 贡献撤回，Then 浮层卸下，迟到的加载结果不挂、不记失败。
45. Given 测试插件贡献一个不写 `title` 的状态栏条目，实现的 `text()` 每次返回同一个文字引用，插件目录里有这两个键；When 入口激活、再切换界面语言；Then 条目的名字取约定键 `statusItems.<本地 id>.title`、显示文字取 `text()` 交回的引用，都是当前语言的文字；切换语言后两者都换成新语言的文字，插件不用重新交文字。

Smoke 入口：生产构建下打开 `/` 与 `/?project=…`（桌面与 `390 × 844` 各一次）；Lab 外壳场景（`lab:shot` 截图）；`e2e/workbench-shell.e2e.ts`、`e2e/workbench-views.e2e.ts`；`bun run --cwd packages/nb-ui test` 复核布局原语。

### 旧验收的去向

本 Spec 由旧应用口径改写为 v2（2026-10-08）。旧验收 24 条的去向：

| 旧编号 | 去向 |
|---|---|
| 1 区域等价 | 改写为外壳一 1 |
| 2 固定业务入口 | 删除：新应用没有旧的固定入口；各插件的入口随插件自己的 Spec |
| 3 主题与浮层 | 改写为外壳一 12；浮层主题沿用 theme.system |
| 4 活动栏与恢复 | 拆分：指针恢复与显式恢复归外壳一 3，容器选择归外壳二 14 |
| 5 尺寸夹取与恢复 | 外壳一 2 |
| 6 坏快照 | 拆分：外壳一 7（坏记录、越界），外壳二 18（未知引用） |
| 7 窄屏核心操作 | 外壳一 5；容器切换随外壳二 |
| 8 原语与验证台 | 改为 Lab 外壳场景与 `nb-ui` 测试（Smoke 入口）；旧 `/workbench-spike` 不在新应用 |
| 9 浏览器标题栏、菜单、打开项目 | 自绘标题栏归外壳一 12；应用菜单与平台窗口控制移出（非目标），菜单加入时键盘、Escape、点外关闭与不裁剪仍按 nb-ui 浮层规范 |
| 10 工作面与双窗口、失败 | 改写为外壳一 8、9、10；用户资产工作面与页内切换工作面删除 |
| 11 四位置 × 四对齐 | 外壳一 1 |
| 12 面板形态与同值 | 外壳一 4、5 |
| 13 empty/single/multiple | 外壳二 15；编辑器槽的焦点与滚动另见外壳一 6 |
| 14 紧凑与短容器 | 外壳一 5 |
| 15 两类源的拖放 | 外壳三 19；内容区判据改为前后各 50%、没有中央禁投（与 2026-09-22 的后续决定一致，旧文的“非空中央零提交”删除） |
| 16 容器停放与目标撤销 | 外壳二 16 |
| 17 四主题、双配色、短高度、DPR | 外壳一 12；DPR 单独验证 |
| 18 空 Switcher 两个入口 | 外壳三 20 |
| 19 同源拖影与唯一插线 | 外壳三 21 |
| 20 View 投标签建新容器 | 外壳三 22 |
| 21 半区来源比例 | 外壳三 23 |
| 22 换轴与禁投方向 | 外壳三 24 |
| 23 实际空与全隐藏 | 外壳二 17 |
| 24 文档标签拖放 | 移出：随编辑器插件 |

## 实现合同

- **几何一律 CSS px**：`Splitter` 受控 props 为 `sizesPx`（合计 = 面板空间，不含 sash）；面板配置 `{defaultSizePx, minSizePx, maxSizePx, sizing, collapse}`。
- **共享宿主**：外壳组件用 nb-layout 的 `useLayoutExtent` 测量承载盒（无 padding、border）、`useGridLayout` 落账与发布，不另写测量与落账。
- **一次手势一份会话**：一个 `NestedGrid` 独占一份 sash 会话，交汇处的两根轴属于同一场手势；松手把一次 `GridGestureCommit` 交给宿主，宿主先整批核对（含不可保存分支则整批拒绝），再经 `useGridLayout` 一次 `resizeBranches` 落账，落账后从这批提交算出补丁。
- **零值不进尺寸记录**：拖到零那一刻只写布尔偏好位，尺寸意图保持展开值。
- **保存只认直接主动的叶**：侧栏、右栏宽度与面板两轴进记录；`compensated` 不变成持久意图。
- **呈现事实只经 action 进 store**：外壳组件发布的模式与生效面板状态由工作台 store 的一个 action 接收，组件不直接写 store。
- **外壳二只经纯模型改定制**：落位、呈现与意图合成是纯函数（`views/placement.ts`、`presentation.ts`、`intents.ts`）；store 的 `applyView` 先按当前呈现合成一份按字段的补丁，保存冲突时同一份补丁作用在最新值上。
- **收尾在外壳里**：会话提交时交出整份判定（含松手时的预览），外壳先用那个矩形接住覆盖层，再每帧量最终位置（视图的分节、容器的宿主）直到连续两帧不变（最多 20 帧），之后才给覆盖层标记收尾、开始淡出；覆盖层淡完发 `settled`，减少动效或没有可画的区域时立即发。
- **预备区由会话持有**：拿起时向外壳要一次此刻没显示的 Part 显示出来会在的矩形（`shell/reveal.ts`，与外壳同一份投影），整场拖动不变；预备区不接指针，会话先按 DOM 命中真实落点，落空才按矩形找预备区，键盘把它当作排在最后的区域。提交带上要显示的 Part，由 store 的 `applyView` 与意图同一次写入。
- **拖放只有一个会话**：组件只写拖动源与落点的 DOM 标记（`data-drag-view`、`data-drag-container`、`data-switcher-band` 与其中的 `data-switcher-entry`、`data-container-host`、`data-empty-part`，以及既不起拖也不接收投递的工具区 `data-no-drag`），外壳根上是一个 [ui.layout-drag](layout-drag.md) 的会话，它负责指针与键盘手势和遮挡；`views/drag-session.ts` 只给来源、键盘区域，读可见几何交给纯函数 `views/drop.ts` 判定；预览与提交出自同一次判定，放下时只提交已显示过的动作。保存时前提不成立的并入作用在最新值上没有变化，store 以 `unchanged` 结算、不写（[`state/store.md`](../state/store.md) 输出 10）。
- **浮层挂在页面根、不占位**：`createWorkbenchPages` 的两页都渲染浮层宿主（`overlays.ts` 的 `createOverlayHost`）；宿主不包外层元素，页面根仍是外壳的承载盒。每个浮层一个框，各自加载、用 Vue 的错误边界各自接住渲染错误。
- **首页只换外壳**：`createHomePage` 在没有项目且有首页贡献时渲染贡献的组件，文档根与命令宿主不变；`/workbench` 与 `/` 共用同一页面组件，区别只是是否采用首页贡献。首页贡献点的声明与校验在 `shared/home.ts`。
- **页面自己加载首屏、自己标画出**：文档根的设置与外壳由 `createWorkbenchPages` 自己加载（`WorkbenchPageParts` 的 `document`、`shell` 给加载函数与渲染时取的属性），不经 `defineAsyncComponent` 包装，两页共用加载结果；文档根的设置与此刻的主体（外壳或首页贡献）都挂上之后，页面根才带 `data-page-rendered`（页面合同见 [PageOutlet](../../../packages/neuro-book/src/web/PageOutlet.md)），主体换了等新主体挂上再带。外壳或文档根加载失败记 `workbench.page` 诊断、页面根不带这个标记，再挂载页面时重新加载。编辑器槽的提供者组件加载期间，槽里是一句给读屏的“正在加载编辑器”（`role="status"`，这个容器带 `aria-busy="true"` 与 `data-workbench-editor-loading`），加载失败时换成失败原因（`role="alert"`），不再带 `aria-busy`（`editor-area.ts` 的 `editorAreaComponent`）。
- **三层 Teleport、一份记忆**：Part 内容、容器宿主、视图实例三层各自 Teleport 到落点，没有落点时退回各自的停放区（登记在共用的 `TeleportMemory`）；滚动位置随滚动事件记下、记录时不用读到的 0 覆盖，滚动盒归视图实例（`WorkbenchViewFrame`）而不归会重建的分节。

## 证据

- 实现入口：活动栏底部条目与页面浮层 [`shared/items.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/items.ts)、[`shared/overlays.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/overlays.ts)、[`web/items/activity-items.ts`](../../../packages/neuro-book/src/plugins/workbench/web/items/activity-items.ts)、[`web/overlays.ts`](../../../packages/neuro-book/src/plugins/workbench/web/overlays.ts)、[`components/WorkbenchActivityBar.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchActivityBar.vue)，设置齿轮与窗口浮层在 [`nbook.settings` 的窗口入口](../../../packages/neuro-book/src/plugins/settings/web/plugin.ts)；外壳四 [`titlebar/`](../../../packages/neuro-book/src/plugins/workbench/web/titlebar/)、[`items/`](../../../packages/neuro-book/src/plugins/workbench/web/items/)、[`components/WorkbenchTitleBar.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchTitleBar.vue)、[`components/WorkbenchItemStrip.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchItemStrip.vue)、[`shared/items.ts`](../../../packages/neuro-book/src/plugins/workbench/shared/items.ts)；外壳三 [`views/drop.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/drop.ts)、[`views/drop-dom.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/drop-dom.ts)、[`views/drag-session.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/drag-session.ts)、[`views/patch.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/patch.ts)、[`components/WorkbenchDragFeedback.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchDragFeedback.vue)；外壳二 [`plugins/workbench/web/views/`](../../../packages/neuro-book/src/plugins/workbench/web/views/)、[`commands/view-commands.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/view-commands.ts)、[`components/WorkbenchViewInstances.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchViewInstances.vue)、[`components/WorkbenchToolPartHost.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchToolPartHost.vue)；外壳一 [`plugins/workbench/web/shell/`](../../../packages/neuro-book/src/plugins/workbench/web/shell/)、[`state/layout-store.ts`](../../../packages/neuro-book/src/plugins/workbench/web/state/layout-store.ts)、[`state/public-state.ts`](../../../packages/neuro-book/src/plugins/workbench/web/state/public-state.ts)、[`commands/panel-commands.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/panel-commands.ts)、[`components/WorkbenchShellLayout.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShellLayout.vue)、[`components/WorkbenchShell.vue`](../../../packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShell.vue)
- 合同测试：活动栏底部条目 [`activity-items.test.ts`](../../../packages/neuro-book/src/plugins/workbench/activity-items.test.ts)（真实内核、公开状态与命令系统，验收 43）、组件测试 `WorkbenchShellParts.dom.test.ts` 的底段一例；页面浮层 [`web/overlays.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/overlays.test.ts)、组件测试 `overlays.dom.test.ts` 与 `home-page.dom.test.ts` 的浮层一例（验收 44）；分栏标题行整行点击 `WorkbenchShellParts.dom.test.ts` 的“标题整行点击切换收起”（输出 16）；悬停线两端 nb-ui `NestedGrid.test.ts` 的“悬停线的两端”与“每个分支的线两端”（输出 22）；收起的分栏当落点 `views/drop.test.ts` 的“收起的分栏当落点”一组与 nb-ui `DropFeedbackOverlay.test.ts` 的 `labelAt`、收尾（输出 20、21，验收 25），放进收起的面板 `layout-store.test.ts` 的“从别的区域放进收起成标题头的面板”（输出 39，验收 42）；预备区 `shell/reveal.test.ts`、`views/drop.test.ts` 的“预备区”一组与 `layout-store.test.ts` 的“落在预备区”（输出 20、39，验收 20）；标签带宽度适配 nb-ui `tabs-adapt.test.ts`（输出 25）；标题栏让位 `titlebar/yield.test.ts`（输出 30）；收拢菜单子菜单的键盘与指针 nb-ui `DropdownMenu.test.ts` 的“子菜单的键盘”（输出 30、31）；面板拖动手势 `layout.test.ts` 的“面板拖到顶即最大化”一组、`layout-store.test.ts` 的拖动补丁里的最大化一例与 nb-ui `NestedGrid.test.ts` 的“余量叶的收起”（输出 4、5、7、8，验收 4）；工作台打磨 `layout-store.test.ts` 的“空着的右栏与面板”一组（验收 42），[`shell/cards.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/shell/cards.test.ts)（输出 38 的卡片边：各种位置、隐藏、拖到零、最大化与紧凑呈现下每一边挨着什么、何时相连）；无项目首页 [`home-slot.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/home-slot.test.ts)、组件测试 `home-page.dom.test.ts`；外壳四 [`titlebar-menu.test.ts`](../../../packages/neuro-book/src/plugins/workbench/titlebar-menu.test.ts)（应用菜单的贡献：真实内核，组与节、贡献方入口停止、校验）、[`titlebar/menu-model.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/titlebar/menu-model.test.ts)、[`items/registry.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/items/registry.test.ts)（含验收 45：省略标题与固定的文字引用随语言切换）、[`items/item-strip.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/items/item-strip.test.ts)、[`commands/part-commands.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/part-commands.test.ts)、组件测试 `WorkbenchTitleBar`、`WorkbenchItemStrip` 的 `.dom.test.ts`；外壳三 [`views/drop.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/drop.test.ts)、[`views/dnd-model.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/dnd-model.test.ts)、`layout-store.test.ts` 的保存冲突两例、`view-commands.test.ts` 的 `newContainerIn`；外壳二 [`views/model.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/model.test.ts)、[`views/container-grid.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/views/container-grid.test.ts)、[`commands/view-commands.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/view-commands.test.ts)、`layout-store.test.ts` 的外壳二一组、组件测试 `WorkbenchShellParts.dom.test.ts`；外壳一 [`layout.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/shell/layout.test.ts)、[`layout-store.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/state/layout-store.test.ts)、[`panel-commands.test.ts`](../../../packages/neuro-book/src/plugins/workbench/web/commands/panel-commands.test.ts)；组件测试 `WorkbenchShellLayout`、`WorkbenchPanelSurface`、`WorkbenchStatusBar` 的 `.dom.test.ts`
- Smoke：活动栏底部条目与页面浮层 [`settings.e2e.ts`](../../../packages/neuro-book/e2e/settings.e2e.ts)（头像占位与齿轮的顺序、齿轮按下、首页与工作台页都挂着设置窗口，验收 43、44 的产品部分），Lab 场景 `WorkbenchActivityBar`；面板拖动手势 `workbench-shell.e2e.ts` 的“面板上沿拖过 600 不停……”一例（真实指针：拖过 600、拖到顶最大化且不写尺寸、刷新不复活、往下拖还原并保存、拖到零后拉出时内容在拖动中出现；验收 4）；工作台打磨 `workbench-views.e2e.ts` 的颜色与分隔方式一例（nbook 卡片与分栏之间两端缩进的分割线、切到 macos 平铺与贯穿的分栏线）、收起一例的点标题行收起（输出 16）、悬停线取主题 token 一例（nbook 自由端缩进、交汇处连着、不发光，主题把线芯设细时对齐接缝，macos 贴满；输出 22），`workbench-dnd.e2e.ts` 的全部收起（指针与键盘各一例）、一个展开其余收起、面板收成标题头（输出 20、21、39）与预备区两例（指针放到隐藏的右栏、侧栏拖到零后键盘 Tab 到预备区；输出 20、22、39，验收 20），放下后的收尾一例（滑到最终分节再消失、减少动效时同样消失；输出 22），`workbench-views.e2e.ts` 的面板标签带逐级让位与活动栏“更多”两例（输出 15、25，验收 31），`workbench-titlebar.e2e.ts` 的逐级让位一例与 `lab-item-strip.e2e.ts` 的标题栏一例（输出 30，验收 35）、`workbench-shell.e2e.ts` 的外壳根底色与面板标题行（验收 41），`workbench-dnd.e2e.ts` 的空落点（验收 42 的拖空），Lab 外壳场景截图；无项目首页 [`bookshelf.e2e.ts`](../../../packages/neuro-book/e2e/bookshelf.e2e.ts)（验收 40 的书架与 `/workbench`）；外壳四 [`workbench-titlebar.e2e.ts`](../../../packages/neuro-book/e2e/workbench-titlebar.e2e.ts)（验收 32–37）、[`lab-item-strip.e2e.ts`](../../../packages/neuro-book/e2e/lab-item-strip.e2e.ts)（验收 34 与 38 的几何、“更多”里的换行，在 Lab 场景上改容器宽度）、Lab 场景 `WorkbenchTitleBar`、`WorkbenchItemStrip`；外壳三 [`workbench-dnd.e2e.ts`](../../../packages/neuro-book/e2e/workbench-dnd.e2e.ts)（指针与键盘、三个 Part 的空落点、比例逐数）、Lab 外壳场景 `views` 的拖放；外壳二 [`workbench-views.e2e.ts`](../../../packages/neuro-book/e2e/workbench-views.e2e.ts)（测试插件 `test.sample-views`）、Lab 外壳场景的 `views`、`views-merged`；外壳一 [`workbench-shell.e2e.ts`](../../../packages/neuro-book/e2e/workbench-shell.e2e.ts)、[`settings.e2e.ts`](../../../packages/neuro-book/e2e/settings.e2e.ts)（外壳根的主题 token）
- 批准依据：活动栏底部条目与页面浮层（输出 40、41）为 t80 计划（记录在主工作区 master 的 `.agents/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/plan.md`）第 5 节，开发者 2026-10-12 批准（外壳设计稿原文“全局项以后可贡献，随账号、设置插件”）；分栏标题行整行点击与分栏之间的开放式分割线（输出 16、38），空区域的虚线框、落点高亮与悬停线的主题 token（输出 22），收起的分栏按前后插入、放进收起的面板时展开（输出 20、21、39），拖动时浮出预备区（输出 20、22、39）、放下后的收尾（输出 22）、标签带宽度适配与活动栏“更多”（输出 15、25）、标题栏逐级让位与收拢菜单的子菜单（输出 30）为 [t83](../../../.agents/works/w00017-application-runtime-architecture/tasks/t83-legacy-parity-dnd-titlebar/README.md) 第二、三轮的决定，开发者 2026-10-13 确认；面板拖动手势（输出 4、5、7、8 与验收 4 的拖动部分）为 [t82 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t82-panel-gestures/plan.md)，开发者 2026-10-13 确认去掉面板的固定上限、能最大化的位置都适用、阈值 24px；标题栏的标志与项目切换的位置（输出 28 与宽度三档、验收 32）为 t79 计划第二轮第 10 节，开发者 2026-10-12 选第十轮稿 L1；工作台打磨（输出 38、39）为 [t79 计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t79-workbench-polish/plan.md)，开发者 2026-10-12 确认；输出 38 当天经开发者手动审查改为“卡片还是平铺由主题决定、nbook 卡片”（计划第二轮第 9 节与第五到第八轮静态稿）；[外壳设计稿](../../proposals/workbench-shell-abstractions.md)（2026-10-07 `accepted`）第 2、6、7、9、10、11 节与“对 Spec 与提案的预期改动”；开发者 2026-10-08 确认旧应用的外壳已人工验证、作为参照（[v2 重建提案](../../proposals/neuro-book-v2-rebuild.md) 的决策记录）。本文由旧应用口径的同名 Spec（归档于 [`docs/archived/specs/ui/workbench-shell.md`](../../archived/specs/ui/workbench-shell.md)）改写，旧口径的依据为 [`workbench-view-host.md`](../../proposals/workbench-view-host.md)（2026-09-13 `accepted`）与 2026-09-20、2026-09-22 开发者对容器模式、分栏、拖放与内容区 50% 规则的确认。
