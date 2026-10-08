---
标签: [state:local]
别名: ["容器宿主", "View Container Host"]
---

# WorkbenchViewContainerHost

一个视图容器的内部排列：每个可见视图一个 `WorkbenchViewSection`，侧栏与右栏纵向、Panel 横向，单轴网格可拖动视图之间的边界（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 16，验收 29）。它不创建视图内容：每个分节的内容区里有一个落点，组件把落点元素经 `target` 报给宿主，宿主把视图实例搬进去；分节因模式切换、成员变化而重建时，落点随之换新，宿主据此重新搬。

## 布局

填满父级。网格用 nb-ui 的 `useLayoutExtent` 测量承载盒、`useGridLayout` 落账，叶尺寸来自呈现模型：展开的视图按意图分配（没记录过取 240），收起的视图固定 32px。single 只有一个叶，没有边界；empty 时显示 `empty` 插槽。

## 交互

- 拖动或用键盘调整视图之间的边界：松手后只把主动、真实变化且没收起的视图的当前轴尺寸经 `resize` 报出；Escape、换轴（`axis` 变化）、`contextKey` 变化取消手势，不报。
- 分节的收起开关经 `toggle-collapsed` 报出。
- 键盘：边界按 nb-ui `GridRenderer` 的合同（方向键 10px、Shift 1px、Home/End、Escape）。

## 数据

```ts
import type {ContainerPresentation} from "../views/presentation";
import type {DisplayLocale} from "nbook/shared/localized-text";

type Props = {
    /** 呈现模型里这个容器的一份；受控。 */
    container: ContainerPresentation;
    /** 手势的上下文：容器换了 Part 或轴时宿主换一个值，进行中的手势作废。 */
    contextKey: string;
    /** 布局未就绪时禁用手势；默认 false。 */
    disabled?: boolean;
    /** 收起开关的可访问名称（已按当前语言取好）。 */
    collapseLabel: string;
    expandLabel: string;
    /** 视图标题按它取语言。 */
    locale: DisplayLocale;
};

type Emits = {
    (event: "resize", payload: {containerId: string; axis: "vertical" | "horizontal"; sizes: Record<string, number>}): void;
    (event: "toggle-collapsed", viewId: string, collapsed: boolean): void;
    /** 视图落点挂上（元素）或卸下（null）。 */
    (event: "target", viewId: string, element: HTMLElement | null): void;
};

type Slots = {
    /** multiple 时每个视图标题行的动作区。 */
    "view-actions"?(props: {viewId: string}): unknown;
    /** 没有可见视图时的内容。 */
    empty?(): unknown;
};
```

没有 expose；attrs 落在根元素上。根带 `data-container-host`（容器 id）、`data-container-mode` 与 `data-container-axis`。

## 状态

内部只有网格手势的预览与诊断（nb-ui 持有），组件销毁即丢。

## 不支持

不处理拖放（外壳三）、不写记录、不加载视图。
