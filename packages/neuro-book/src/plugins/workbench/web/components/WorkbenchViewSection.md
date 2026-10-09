---
标签: []
别名: ["视图分节", "View Section"]
---

# WorkbenchViewSection

容器里一个视图的外框：multiple 时有 32px 标题行（收起开关、图标、标题、动作区），single 时没有标题行、只有内容区（标题与动作由宿主上提，[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳二输出 16、17）。

视图内容不由它创建：宿主把视图实例搬进默认插槽里的落点，切模式、收起都不卸载内容。内容区不滚动、不加内边距：视图移动时外框会在新容器里重建，滚动盒放在这里就会随之换新、丢掉滚动位置，所以按 `layout` 给的滚动与内边距归随实例一起搬动的 [`WorkbenchViewFrame`](WorkbenchViewFrame.md)。

## 布局

- 纵向容器（Sidebar、AuxiliaryBar）：标题行在上，内容在下。收起时只剩 32px 标题行。
- 横向容器（Panel）：标题行同样在上；收起时整个分节是 32px 宽的竖条，标题竖排，展开按钮在顶部，名称与展开控件始终可达。
- 收起时内容区隐藏（`v-show`），不卸载。分节的尺寸由宿主的网格叶决定，这里只填满叶。
- 标题放不下时截断，动作区不让位。

## 交互

- 标题行的收起开关是一个按钮，`aria-expanded` 表示展开；点了发 `toggle-collapsed`，值是点了之后应有的收起状态。键盘用 Tab 到开关后按 Enter 或空格。
- 动作区由宿主经 `actions` 插槽放（产品里是“移动到”菜单）。
- 标题行是这个视图的拖动源（外壳三输出 19–23）：指针按住标题行（含收起开关，不含动作区）移动起拖；标题文字是可聚焦的把手（`role="button"`，名称是 `dragLabel`），聚焦后按空格拿起。收起开关保留自己的 Enter 与空格。拖动本身由外壳的拖放会话处理。
- 整个分节是 `role="region"`，名称是视图标题。

## 数据

```ts
type Props = {
    viewId: string;
    /** 视图标题（已按当前语言取好）。 */
    title: string;
    icon: string;
    /** 容器的排列轴：vertical 是侧栏与右栏，horizontal 是 Panel。 */
    axis: "vertical" | "horizontal";
    /** multiple 为 true：画标题行；single 为 false：只有内容区。 */
    chrome: boolean;
    /** 生效的收起（single 时宿主给 false）。受控。 */
    collapsed: boolean;
    /** 收起开关的可访问名称：展开时与收起时各一份，已按当前语言取好。 */
    collapseLabel: string;
    expandLabel: string;
    /** 标题文字这个键盘拖动把手的可访问名称，例如“拖动 资源管理器”。 */
    dragLabel: string;
};

type Emits = {
    (event: "toggle-collapsed", collapsed: boolean): void;
};

type Slots = {
    /** 标题行右侧的动作区；没有标题行时不渲染。 */
    actions?(): unknown;
    /** 内容区；收起时隐藏不卸载。 */
    default?(): unknown;
};
```

没有 expose；attrs 落在根 `<section>` 上。根上带 `data-view-section`（视图 id）与 `data-view-collapsed`，供宿主、拖放会话与测试定位。标题行带 `data-drag-view`（视图的拖动源），收起开关与动作区带 `data-no-drag`（工具区：不起拖、不接收投递），标题文字是 `data-drag-handle` 把手。

## 不支持

不处理拖放手势（外壳的拖放会话按标记处理）；不处理尺寸手势；不读写任何状态。
