---
标签: [state:local]
别名: ["工具区宿主", "Tool Part Host"]
验证入口: WorkbenchShellLayout
---

# WorkbenchToolPartHost

一个工具区域（Sidebar、AuxiliaryBar 或 Panel）里的框：选中容器的挂载落点，加上这个区域自己的标题行（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 15–17、25）。容器宿主不由它创建：落点元素经 `target` 报给宿主，宿主把选中容器的宿主搬进去。三个区域的标题行不同：

- Sidebar：容器切换在 ActivityBar 上，这里只在 single 时画 32px 容器标题行（标题加上提的动作）；multiple 不画，每个视图有自己的标题。
- AuxiliaryBar：32px 标题行是容器标签带（nb-ui `Tabs`，只有一个容器也保留），右侧是 single 时上提的动作。
- Panel：没有自己的标题行——面板框架 `WorkbenchPanelSurface` 是 Panel 32px 标题行唯一的拥有者，标签带由宿主放进它的导航槽；这里只有落点。

## 布局

Sidebar 与 AuxiliaryBar 画卡片（`--panel-surface`、`--panel-outline`、`--radius-panel`），四周留白归外壳的叶；Panel 不画卡片，填满面板框架的内容区。标题行固定 32px，标签带横向滚动、动作区不让位。区域里没有容器时落点不出现，显示 `emptyText`。

## 交互

- 标签带：点击或方向键切换发 `select`；roving tabindex，Tab 一次进入。
- 动作区由宿主经 `actions` 插槽放（产品里是“移动到”菜单）。

## 数据

```ts
import type {ContainerPresentation, PartPresentation} from "../views/presentation";
import type {DisplayLocale} from "nbook/shared/localized-text";

type Props = {
    part: "sidebar" | "auxiliarybar" | "panel";
    /** 呈现模型里这个区域的一份（标签带条目与选中项）；受控。 */
    presentation: PartPresentation;
    /** 选中的容器；区域里没有容器为 null。 */
    selected: ContainerPresentation | null;
    locale: DisplayLocale;
    /** 区域的可访问名称（已按当前语言取好）。 */
    label: string;
    /** 区域里没有容器时的说明。 */
    emptyText: string;
};

type Emits = {
    (event: "select", containerId: string): void;
    /** 选中容器的落点挂上（元素）或卸下（null）。 */
    (event: "target", element: HTMLElement | null): void;
};

type Slots = {
    /** single 时上提的动作（视图动作、容器管理），放在 Sidebar 的容器标题行或 AuxiliaryBar 的标签带右侧。 */
    actions?(props: {container: ContainerPresentation}): unknown;
};
```

没有 expose；attrs 落在根上。根带 `data-tool-part`（区域）；落点带 `data-container-target`。

## 不支持

不处理拖放（外壳三），不读写状态；Panel 的标签带与框架按钮不在这里。
