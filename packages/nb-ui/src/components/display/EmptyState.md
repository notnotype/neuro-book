---
标签: []
---

# EmptyState

`EmptyState` 是列表、查询或内容区域没有可展示数据时使用的居中占位提示；它把图标、短标题、补充说明和可选主操作集中到一个轻量布局里，避免各处重复拼装空态。

## 布局与交互

内容按纵向排列并横向居中，包含圆形浅底图标区、标题、可选说明和可选操作区，根节点提供左右与上下内边距。内容高度由自身内容和 padding 自然决定；外层容器若需要把整块空态垂直居中，应由调用方提供布局高度。它本身不处理焦点或键盘交互，主操作的行为由 `action` 插槽中的内容决定。

## 数据

```ts
type EmptyStateProps = {
    /** 图标 CSS class；默认 "i-lucide-inbox"。 */
    iconClass?: string;
    /** 空态标题；默认 "暂无数据"。 */
    title?: string;
    /** 补充说明；默认空字符串。 */
    description?: string;
};

type EmptyStateEmits = Record<never, never>;

type EmptyStateSlots = {
    /** 说明内容；提供时替代 description prop 的文本。可省略。 */
    default?(): unknown;
    /** 主操作区；只有提供时才渲染。可省略。 */
    action?(): unknown;
};
```

说明区在 `description` 非空或默认插槽存在时出现；若插槽提供内容，它优先于 `description`。无 expose API。根 `div` 接收未声明 attrs、`class` 与 `style`，遵循 Vue 默认透传。

## 状态与边界

默认显示收件箱图标和“暂无数据”，不显示说明或操作。空标题仍保留标题段落；空说明不渲染说明行。组件没有禁用、只读、加载或错误状态，错误和加载应由调用方选择其它内容呈现。

## 不支持

- 不提供自动查询、数据判断、重试或导航行为。
- 标题以普通段落呈现，不建立 heading 或 live region 语义；是否需要这些语义由调用方结合页面上下文处理。
