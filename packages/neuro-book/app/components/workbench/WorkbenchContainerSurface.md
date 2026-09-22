---
标签: []
别名: ["主侧边栏", "辅助侧边栏", "Primary Side Bar", "Secondary Side Bar"]
---

# WorkbenchContainerSurface

承载一块工作台容器的**卡片零件**：一条头部（图标 + 标题 + 动作区）加一块内容区。它是外壳与视图之间的那层承载——外壳决定卡片落在哪个叶、叶多宽、卡片四周留多少白；视图决定卡片里画什么。

除传统的单视图承载模式外，组件完整支持 **VS Code 式多 Section 侧栏模式**：通过 `sections` 属性声明区段集合，在容器内以 1px 细线垂直平铺各区段（搭配 `WorkbenchContainerSection.vue`），支持区段独立折叠、上下文标签、空态占位、以及头部「···」区段可见性浮层菜单。

卡片自己只画**面**：面 / 描边 / 圆角 / 阴影 / 间距全部取 nb-ui 的主题角色变量（`--panel-surface` / `--panel-outline` / `--radius-panel` / `--elevation-raised` / `--divider` / `--panel-p` / `--control-h-sm` / `--border-w`），与活动栏卡片同一套材质语言（取值口径见 `NovelIdeActivityBar.vue` 的 `.workbench-activity-bar`），换主题只换变量，组件里没有一处字面颜色。

它和「一个带标题的面板」的区别是**它不越权拥有宿主状态**：不拥有拖拽（叶的几何归外壳与 nb-ui `Splitter`）、不写死尺寸、不读 store、不做持久化、也不 import i18n。给它一个 descriptor 和一个已解析的标题就能渲染，不需要 store 桩，也不需要真实 Project。
## 与 descriptor 的对应

三处，都不在组件里另立一份取值域：

- `container` 是 `ContainerDescriptor`（`app/utils/workbench/descriptors.ts`）。`id` / `icon` 直接取用，`order` 是**同一落位内容器的排序**，与渲染无关，组件不读。
- `container.location` 经 `resolveLocationPart` 求值成承载它的 Part（`sidebar-left` → `left`、`sidebar-right` → `right`、`panel` → `panel`），作为 `data-container-part` 暴露。容器落在哪个叶由宿主槽位决定，这一项使「声明的位置与实际落位一致」可被核对；预留值 `window` 求值失败，此时属性为空串——组件不声称它落在某个 Part 上，也不把它当作既有位置放行。
- `title` 是**已解析**的标题。注册表只存 `titleKey`（`app/utils/workbench/containers.ts`），解析归宿主（`t(titleKey)`），组件不持有译文表。
- 内容区按 `layout` 的**组合合同**呈现（`resolveViewLayout`）：`scroll` = 外壳给内边距并拥有滚动，`fill` = 视图自己占满内容区、管理内部滚动。合同读 descriptor 的表，组件里不复制一份 mode → 行为的映射。
- Section 列表与 `ViewDescriptor`：在多视图容器中，区段项 `ContainerSectionItem` 对应容器内的各个 View。`canToggleVisibility` 映射 `ViewDescriptor.canToggleVisibility`（如大纲、时间线通常允许隐藏，核心视图不可隐藏时置置灰禁用）。

## 数据与接口

```ts
export type ContainerSectionItem = {
    id: string;
    title: string;
    contextLabel?: string;
    canToggleVisibility?: boolean;
    collapsible?: boolean;
    collapsed?: boolean;
    layout?: ViewLayoutMode;
    empty?: boolean;
    emptyText?: string;
};

type Props = {
    /** 容器的 descriptor：id / location / icon 三项各自有用途。 */
    container: ContainerDescriptor;
    /** 已解析的标题：注册表只存 key，解析归宿主。 */
    title: string;
    /** 单视图内容区排版合同；缺省 `scroll`。多区段模式由各 section 的 layout 独立决定。 */
    layout?: "scroll" | "fill";
    /** VS Code 式 section 列表声明；提供时进入多区段模式。 */
    sections?: readonly ContainerSectionItem[];
    /** 受控的可见 section id 集合；缺省由内部 state 维护全部可见。 */
    visibleSections?: readonly string[];
    /** 是否在头部展示「…」Section 可见性菜单；缺省有 sections 时展示。 */
    showVisibilityMenu?: boolean;
};

type Emits = {
    (e: "update:visibleSections", value: string[]): void;
    (e: "toggle-section-visibility", payload: {id: string; visible: boolean}): void;
    (e: "toggle-section-collapsed", payload: {id: string; collapsed: boolean}): void;
};

type Slots = {
    /** 覆盖头部内容（缺省：图标 + 标题）。 */
    head(): unknown;
    /** 头部尾部的动作区（位于可见性菜单之前）。 */
    actions(): unknown;
    /** 自定义可见性菜单浮层。 */
    visibilityMenu(): unknown;
    /** 单视图模式内容区。 */
    content(): unknown;
    /** 默认插槽：单视图模式 fallback 或宿主自定义 sections 内容。 */
    default(): unknown;
    /** 通用区段内容插槽（参数：{ section }）。 */
    section(props: {section: ContainerSectionItem}): unknown;
    /** 指定区段内容插槽：`section-<id>`（参数：{ section }）。 */
    [key: `section-${string}`]: (props: {section: ContainerSectionItem}) => unknown;
    /** 指定区段操作插槽：`section-actions-<id>`（参数：{ section }）。 */
    [key: `section-actions-${string}`]: (props: {section: ContainerSectionItem}) => unknown;
    /** 所有区段被隐藏时的容器级空态。 */
    empty(): unknown;
};
```

**单根契约**：单根 `<section class="workbench-container">`，带四项可核对的事实属性：`data-container`、`data-container-location`、`data-container-part`、`data-container-layout` 以及 `aria-label`。
## 布局

一条 32px 高的头部（`--space-8`）加一块吸收余量的内容区，两段之间是头部自己的底缝（`--divider`）。

- 头部：图标（14px，`--text-muted`）+ 标题（`--text-xs`、`--weight-strong`，单行省略号）+ 尾部动作区（`margin-left: auto`，按 `--space-2` 排）+ 可选「···」可见性菜单。左右内边距与内容区的留白同一份（`--panel-p`）。
- 卡片：`height / width: 100%`，吃宿主给的确定高度。四周留白归外壳（`--workbench-container-gutter`，6px）。
- 单视图内容区：`scroll` 档给 `padding: var(--panel-p)` 并由组件滚动；`fill` 档不给留白与滚动，归视图自己。
- Section 列表内容区：各 Section 平铺垂直排布，相邻区段之间以 `1px`（`var(--border-w) solid var(--divider)`）分隔。**区段内部绝不嵌套卡片圆角或卡片外边框**，圆角和外边框始终只由外层容器拥有。
- 区段头部密度：紧凑行高（`var(--control-h-sm)`，约 22-24px），小字号（`--text-xs`），微型旋转 chevron 折叠指示器，右侧可选上下文计数标签（`--text-2xs`）与宿主动作按钮。
## 交互

在单视图模式下，组件本身保持无内部交互；在多 Section 模式下，组件提供开箱即用的折叠与可见性管理：
- 折叠展开：点击区段标题栏切换 `collapsed` 态，触发 chevron 旋转，内容平滑显隐并抛出 `toggle-section-collapsed` 事件。
- 可见性菜单：点击右上角「···」按钮弹出浮层，展示各区段多选勾选列表（`.nb-ui-popover-item`）。点击切换区段显隐并抛出 `update:visibleSections` / `toggle-section-visibility` 事件。若区段 `canToggleVisibility === false` 则禁用点击并置灰。
- 空态展示：当区段指定 `empty: true` 或 `emptyText` 时，呈现紧凑文字说明；当所有区段都被取消勾选隐藏时，容器居中呈现引导说明文字。

组件没有内部状态，视觉只随 props / 插槽变：

- `container.location` 求值失败（预留值 `window` 或未登记字符串）：`data-container-part` 为空串，其余照常渲染（承载它的叶仍由宿主决定）。
- `layout` 越界（只可能来自强制转型）：退回默认合同（`scroll`），不静默给一档观感、也不抛异常。
- `container.icon` 为空：头部只画标题，不占图标位。
- 没有 `actions` 插槽：动作盒不渲染（不留下一个空盒子）。
- 没有 `content` 也没有默认插槽：单视图模式内容区是空的。
- 多区段全部隐藏：展示容器级空态（`所有视图已被隐藏，可通过右上角 ··· 菜单重新显示` 或 `#empty` 插槽）。
- 标题过长：头部标题与区段标题均使用 `text-overflow: ellipsis` 省略号截断；动作区与折叠指示器不缩。

## 不支持

- 不拥有拖拽、尺寸、持久化：容器与分区的几何分配在外壳与视图调度器层。
- 不解析标题、不读 store：`titleKey` → 译文的解析归宿主，语言表不进组件。
- 区段内部不设卡片圆角：容器卡片内部保持纯平 1px 细线节律，严禁出现内嵌圆角卡片。
- 变量命名严禁私造：颜色全部消费 `--panel-surface`、`--divider`、`--text-main`、`--text-muted`、`--bg-hover` 等标准 nb-ui token。

## 注意事项

- **卡片是叶的内接盒**：调用方不要在外面再套一层卡片或加 margin，也不要给它 padding——四周留白由外壳加在叶上，加在这里会得到两层留白。
- **必须有确定高度**：`height: 100%` 只有在叶（或画布）给出确定高度后才成立；放进自动高度的容器里，两类 layout 的滚动与填充都无从判断。
- `--panel-p` 同时决定头部内边距与 `scroll` 档的内容留白，两者是同一个量，改一处两处一起动；头部高度是另一档（`--space-8`），改 `--panel-p` 不会改头高。
- 需要 `fill` 档的视图**自己**给内容留白并接滚动（例如内部再放一层 `p-[var(--panel-p)] overflow-y-auto`），否则内容会贴着卡片边缘、溢出部分被裁掉。
- 主题切换只需换变量：组件里除图标尺寸外没有字面值，颜色 / 圆角 / 描边宽 / 间距 / 字号字重全部取 nb-ui 变量。
