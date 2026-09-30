---
标签: []
别名: ["面包屑", "Breadcrumb Navigation"]
---

# Breadcrumb

面包屑导航条：把当前所在的层级按从外到内的顺序排成一行路径，其中除最后一项外都可点击。和直接拼一串链接的差别是它自带导航语义（`nav` + 有序列表 + 当前项标记）与分隔符插槽，并且「哪一项是当前项」由数据声明而不是由位置推断。

组件是纯展示的：它不认识路由，也不会自己跳转。

## 数据

```ts
interface BreadcrumbItemData {
    /** 显示文字 */
    label: string;
    /** 链接目标；同时满足「有 href」与「不是 current」时才渲染成链接 */
    href?: string;
    /** 图标类名（如 i-lucide-*）；不传就没有图标 */
    iconClass?: string;
    /** 是否为当前所在项；为 true 时渲染成不可点击的当前项，并带上当前页语义 */
    current?: boolean;
}

type BreadcrumbProps = {
    /** 路径项，按从外到内的顺序；默认空数组 */
    items?: BreadcrumbItemData[];
    /** 分隔符图标类名；默认 "i-lucide-chevron-right" */
    separatorIcon?: string;
};

type BreadcrumbEmits = {
    /**
     * 点击可点击项时发出，携带该项与原始鼠标事件。
     * 组件不阻止默认行为——`href` 是真链接，会照常导航；
     * 想用路由接管跳转的调用方需要在事件里自行 preventDefault。
     */
    (e: "click", item: BreadcrumbItemData, event: MouseEvent): void;
};

type BreadcrumbSlots = {
    /** 整段替换分隔符（渲染在每两项之间，最后一项之后不渲染） */
    separator(): unknown;
};
```

没有 expose。未声明的 attribute 与 `class` / `style` 落在唯一根节点（`nav`）上；`attrs` 不会落到某一项上。

## 布局

一行 `flex-wrap` 的小字号路径：项与项之间、项内的图标与文字之间各留一个间距单位。**宽度不够时换成多行，不截断也不横向滚动**，`390×844` 下与桌面同构。分隔符固定尺寸、不参与换行判断。

当前项用强调文字与中等字重区分，可点击项在悬停时转为常规文字色并加下划线。图标都是装饰性的，不占可访问名称。

## 交互

- 点击带 `href` 且不是当前项的那一项：触发 `click` 事件并正常导航。
- 点击当前项没有行为（它不是链接）。
- 键盘：可点击项就是普通链接，Tab 可达、回车即跳转，焦点环由主题的聚焦样式给出；组件不注册任何快捷键。

## 状态与边界

- 空 `items`：渲染一个空的导航条（只有 `nav` 外壳），不显示占位文案。
- 只有一项：该项按自身是否 `current` 渲染，不出现分隔符。
- 没有禁用态、加载态与错误态：路径数据由调用方一次性给出。
- `current` 与 `href` 同时存在时按当前项渲染（不给链接、不发事件）。

## 不支持

- 不支持折叠或省略中间层级（例如「…」展开）：所有项都会渲染。
- 不支持下拉、二级菜单或拖拽排序。
- 不支持把点击拦在组件内部；跳转是否由路由接管由调用方决定。
