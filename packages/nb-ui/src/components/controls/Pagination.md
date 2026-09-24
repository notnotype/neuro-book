---
标签: []
---

# Pagination

`Pagination` 用一组紧凑页码按钮在分页数据中导航，固定呈现首页/末页、当前页附近页码和必要的省略号，并提供上一页/下一页操作。它是纯受控控件：组件只报告目标页，不请求数据，也不自行保存当前页。

## 布局

根节点是带可访问名称的分页导航，内部按「上一页、页码与省略号、下一页」水平排列。页码按钮最小宽度为控件高度，步进按钮为正方形；省略号占较窄的固定宽度。当前页以强调色显示并标记 `aria-current="page"`。页码数量增加时仅显示邻近区间，不会随总页数线性扩展。

在 `390×844` 下控件保持单行；组件不提供横向滚动或换行，父级需为所需页码导航留出空间。当前页两侧显示数量由 `siblingCount` 控制。

## 交互

- 点击上一页、下一页或页码按钮时，目标页被限制在 `1` 到 `pageCount` 范围；只有目标值不同于当前 `page` 时才发出 `update:page`。
- 上一页在 `page <= 1` 时禁用，下一页在 `page >= pageCount` 时禁用。
- 当前页按钮带 `aria-current="page"`；省略号是非交互文本，不是跳转按钮。
- 每个按钮可通过 Tab 聚焦，Enter/Space 按原生按钮语义激活。切换后焦点留在被按下的按钮上；组件不主动转移焦点。

## 数据

```ts
type PaginationProps = {
    /** 当前页，从 1 开始；必填、受控 */
    page: number;
    /** 总页数；必填 */
    pageCount: number;
    /** 当前页两侧各显示的相邻页数；默认 1 */
    siblingCount?: number;
    /** nav 的可访问名称；默认 "分页" */
    ariaLabel?: string;
    /** 上一页按钮的可见提示、title 与 aria-label；默认 "上一页" */
    prevLabel?: string;
    /** 下一页按钮的可见提示、title 与 aria-label；默认 "下一页" */
    nextLabel?: string;
};

type PaginationEmits = {
    /** 用户请求切换到被限制在有效页范围内的页码 */
    (event: "update:page", value: number): void;
};

type PaginationSlots = {};
```

页码序列由组件根据输入计算：总页数为 0 或更小时不生成数字按钮；总页数不超过 `2 * siblingCount + 5` 时完整显示，否则固定显示首页、末页、当前页附近的 `siblingCount` 页，并用省略号折叠远端区间。`page` 和 `pageCount` 应提供有效的 1 起始分页数据，`siblingCount` 应为非负整数。

组件没有 slot 或 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落在根 `<nav>` 上；原生按钮事件可由调用方通过标准 attribute/listener 使用。

## 状态

- 默认：显示由 `page` 与 `pageCount` 推导的页码序列。
- 边界页：第一页禁用上一页，末页禁用下一页；页码按钮的禁用样式与普通页区分。
- 空数据：`pageCount <= 0` 时不显示页码或省略号；上一页和下一页仍按输入边界禁用规则渲染。
- 禁用、只读、加载、错误：没有整控件级的禁用、只读、加载或错误状态；父级可以隐藏控件或管理数据加载。

## 不支持

- 不支持页码内部状态、数据获取、总记录数换算或跳转输入框。
- 不支持省略号直接跳转；它只提示中间页码被折叠。
- 不支持无限滚动或游标式分页。
