---
标签: []
---

# IconButton

`IconButton` 是紧凑的图标动作按钮，统一提供两档固定尺寸、默认与危险动作悬停色，以及原生禁用语义。图标和动作内容由调用方通过默认插槽提供；它不解释点击代表的业务动作。

## 布局与交互

`sm` 为 24×24px，`md` 为 28×28px（默认）。按钮不可收缩；悬停时默认变为主文字色与 hover 底色，`danger` 变为危险状态色。`disabled=true` 使用原生 button 禁用并降低不透明度，不接收点击。元素是 `type="button"`，不会在表单中隐式提交。

组件不管理焦点顺序或快捷键。图标按钮必须通过 `title` 或调用方传入的 `aria-label` 提供可访问名称；没有图标 slot 内容时按钮仍存在但没有可见动作内容。

## 数据

```ts
interface IconButtonProps {
    /** 原生 title 提示；默认空字符串。建议为纯图标按钮提供可访问名称。 */
    title?: string;
    /** 悬停样式；默认 "default"。 */
    variant?: "default" | "danger";
    /** 固定尺寸；默认 "md"。 */
    size?: "sm" | "md";
    /** 原生禁用状态；默认 false。 */
    disabled?: boolean;
}
```

只有默认插槽，用于图标或其它按钮内容；没有具名插槽、expose API 或组件自定义 emits。click 是原生 button DOM 事件，不是 `defineEmits` 声明的自定义事件。Vue 默认 attrs（包括 `aria-label`、`class`、`style` 与原生事件监听）落到 button 根元素。

## 状态与边界

- 默认：显示默认图标色，悬停时采用通用 hover 色。
- `variant="danger"`：悬停时采用危险底色与危险文字色；不表示组件会执行破坏性动作。
- `disabled=true`：原生禁用，不响应激活。
- 无独立加载、只读、空数据或错误态。
- 不支持图标解析、标签生成、动作分派、tooltip 组件或图标布局之外的子状态。