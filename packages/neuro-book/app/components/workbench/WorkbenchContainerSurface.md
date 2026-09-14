---
标签: []
---

# WorkbenchContainerSurface

承载一块工作台容器的**卡片零件**：一条头部（图标 + 标题 + 动作区）加一块内容区。它是外壳与视图之间的那层承载——外壳决定卡片落在哪个叶、叶多宽、卡片四周留多少白；视图决定卡片里画什么。

卡片自己只画**面**：面 / 描边 / 圆角 / 阴影 / 间距全部取 nb-ui 的主题角色变量（`--panel-surface` / `--panel-outline` / `--radius-panel` / `--elevation-raised` / `--divider` / `--panel-p`），与活动栏卡片同一套材质语言（取值口径见 `NovelIdeActivityBar.vue` 的 `.workbench-activity-bar`），所以换主题只换变量，组件里没有一处字面颜色。

它和「一个带标题的面板」的区别是**它什么都不拥有**：不拥有拖拽（叶的几何归外壳与 nb-ui `Splitter`）、不写尺寸、不读 store、不做持久化、也不 import i18n。这条分工是本组件能被 Lab 完整表达的原因——给它一个 descriptor 和一个已解析的标题就能渲染，不需要 store 桩，也不需要真实 Project。

## 与 descriptor 的对应

三处，都不在组件里另立一份取值域：

- `container` 是 `ContainerDescriptor`（`app/utils/workbench/descriptors.ts`）。`id` / `icon` 直接取用，`order` 是**同一落位内容器的排序**，与渲染无关，组件不读。
- `container.location` 经 `resolveLocationPart` 求值成承载它的 Part（`sidebar-left` → `left`、`sidebar-right` → `right`、`panel` → `panel`），作为 `data-container-part` 暴露。容器落在哪个叶由宿主槽位决定，这一项使「声明的位置与实际落位一致」可被核对；预留值 `window` 求值失败，此时属性为空串——组件不声称它落在某个 Part 上，也不把它当作既有位置放行。
- `title` 是**已解析**的标题。注册表只存 `titleKey`（`app/utils/workbench/containers.ts`），解析归宿主（`t(titleKey)`），组件不持有译文表。
- 内容区按 `layout` 的**组合合同**呈现（`resolveViewLayout`）：`scroll` = 外壳给内边距并拥有滚动，`fill` = 视图自己占满内容区、管理内部滚动。合同读 descriptor 的表，组件里不复制一份 mode → 行为的映射。

## 数据

```ts
type Props = {
    /** 容器的 descriptor：id / location / icon 三项各自有用途，见「与 descriptor 的对应」。 */
    container: ContainerDescriptor;
    /** 已解析的标题：注册表只存 key，解析归宿主。 */
    title: string;
    /** 内容区按哪一档呈现；缺省 `scroll`。取值越界时退回 `scroll` 的合同，不猜第二档语义。 */
    layout?: "scroll" | "fill";
};

type Slots = {
    /** 覆盖头部内容（缺省：图标 + 标题）。 */
    head(): unknown;
    /** 头部尾部的动作区；不提供时整个动作盒不渲染。 */
    actions(): unknown;
    /** 内容区。 */
    content(): unknown;
    /** 内容区的默认写法：`content` 未提供时渲染它。 */
    default(): unknown;
};
```

**扩展面**：没有 emits；没有 `expose`；`attrs` 透传到根元素（Lab 的 `data-lab-subject` 走这条）。

根元素是单根 `<section>`，带四项可核对的事实：`data-container`（容器 id）、`data-container-location`（descriptor 里声明的默认落位）、`data-container-part`（求值出的 Part，失败为空串）、`data-container-layout`（实际生效的合同 mode），以及 `aria-label`（= `title`）。

## 布局

一条 32px 高的头部（`--space-8`）加一块吸收余量的内容区，两段之间是头部自己的底缝（`--divider`）。

- 头部：图标（14px，`--text-muted`，`container.icon` 为空时不画）+ 标题（`--text-xs`、`--weight-strong`，单行省略号）+ 尾部动作区（`margin-left: auto`，按 `--space-2` 排）。左右内边距与内容区的留白同一份（`--panel-p`），标题因此与内容左边缘对齐。
- 卡片：`height / width: 100%`，吃宿主给的确定高度——它不产生高度，只填满叶的内接盒。四周留白归外壳（`WorkbenchShell` 加在叶上，`--workbench-container-gutter`），组件不写宽度也不写 margin：内容区因此比叶窄 2 × 6px（这笔账在 `layout.ts` 的 `SHELL_CONTAINER_GUTTER_PX` 一处记）。
- 内容区：占满剩余高度、能缩（`min-height / min-width: 0`）；`scroll` 档给 `padding: var(--panel-p)` 并由组件 **滚动**（`overflow-y: auto`），`fill` 档两者都不给（只 `overflow: hidden`），留白与滚动归视图自己。
- `overflow: hidden` 是**圆角的承载者**：头部与内容区各自都是矩形，只有根裁切才能保证它们不盖住卡片圆角，内容区的滚动条也始终落在卡片内。视图里的浮层本来就出不去所在的叶（叶包装已带 `overflow-hidden`），这里不新增限制。

## 交互

组件本身**没有任何交互**：不监听指针与键盘、不发事件、没有内部状态。头部动作区里的按钮、内容区里的列表、以及「点组件外」这类判定都是宿主放进插槽的东西，行为归宿主；卡片不因悬停、聚焦或选中改变外观。

## 状态

组件没有内部状态，视觉只随 props / 插槽变：

- `container.location` 求值失败（预留值 `window` 或未登记字符串）：`data-container-part` 为空串，其余照常渲染（承载它的叶仍由宿主决定）。
- `layout` 越界（只可能来自强制转型）：退回默认合同（`scroll`），不静默给一档观感、也不抛异常。
- `container.icon` 为空：头部只画标题，不占图标位。
- 没有 `actions` 插槽：动作盒不渲染（不留下一个空盒子）。
- 没有 `content` 也没有默认插槽：内容区是空的（组件不画空态——空态是视图的事）。
- 标题过长：头部标题省略号截断；动作区不缩。

## 不支持

- 不拥有拖拽、尺寸、持久化、折叠：容器的宽度 / min / max 与「收起」都在外壳与叶那一层，组件不提供对应 props。
- 不解析标题、不读 store：`titleKey` → 译文的解析归宿主，配置文件与语言表都不进组件。
- 不做头部第二层标签条：头部就是这一条窄条 chrome，视图不得再渲染一条同名标题条（验收口径：不出现双重标签条）。
- 不提供滚动容器（不画滚动条样式、不包 `ScrollArea`）：`scroll` 档用的是内容区自己的 `overflow-y`，`fill` 档连这个也归视图。
- 不渲染视图清单、空态、加载态与错误态：这些是视图与宿主的事，卡片只提供位置。
- 不做浮层宿主：插槽内容要弹出浮层时，层级上下文由宿主（叶 / 窗口）给。

## 注意事项

- **卡片是叶的内接盒**：调用方不要在外面再套一层卡片或加 margin，也不要给它 padding——四周留白由外壳加在叶上，加在这里会得到两层留白。
- **必须有确定高度**：`height: 100%` 只有在叶（或画布）给出确定高度后才成立；放进自动高度的容器里，两类 layout 的滚动与填充都无从判断。
- `--panel-p` 同时决定头部内边距与 `scroll` 档的内容留白，两者是同一个量，改一处两处一起动；头部高度是另一档（`--space-8`），改 `--panel-p` 不会改头高。
- 需要 `fill` 档的视图**自己**给内容留白并接滚动（例如内部再放一层 `p-[var(--panel-p)] overflow-y-auto`），否则内容会贴着卡片边缘、溢出部分被裁掉。
- 主题切换只需换变量：组件里除图标尺寸外没有字面值，颜色 / 圆角 / 描边宽 / 间距 / 字号字重全部取 nb-ui 变量。
