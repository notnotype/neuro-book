---
标签: [state:inject]
---

# FormCheckbox

`FormCheckbox` 是带 nb-ui 视觉样式和表单语义连接的单个复选框。它用原生 checkbox 承担浏览器键盘与表单行为，再以 18px 的主题化 Squircle 视觉层呈现选中、未选中和半选状态；组件既可由 `label` 提供文字，也可用默认 slot 完全替换标签内容。

## 布局

根节点是可点击的 `label`，内部横向排列视觉 checkbox 和文字列。视觉 checkbox 固定为 18×18px，文字列包含标签和可选的 description；标签很长时文字列可以随父级宽度换行，复选框本身不会被压扁。`390×844` 下不改变结构，描述继续位于标签下方。

真实 `<input type="checkbox">` 是屏幕阅读器可见但视觉隐藏的 peer 元素。视觉层依据 `modelValue` 与 `indeterminate` 显示勾号或短横，并依据 `FormField` 上下文接收 id、required、invalid 和描述关联。

## 交互

- 点击整个 label 或使用原生 checkbox 的键盘操作切换选中状态，组件发出 `update:modelValue`。
- 当 `modelValue` 为 `"indeterminate"` 或 `indeterminate` 为 true 时显示半选短横，并把 `aria-checked` 设为 `mixed`。
- 获得原生 input 焦点时发出 `focus`，视觉层显示主题 focus ring。
- `disabled` 时原生 input 不可操作，label 显示禁止光标并降低不透明度。
- `required` 传给原生 input；若外层有 `FormField`，字段的 required 也会生效。

## 数据

```ts
type FormCheckboxProps = {
    /** 受控选中值；可用 "indeterminate" 表示半选，默认 false。 */
    modelValue?: boolean | "indeterminate";
    /** 强制显示半选；与 modelValue === "indeterminate" 取或，默认 false。 */
    indeterminate?: boolean;
    /** 无默认 slot 时的文字；默认空字符串。 */
    label?: string;
    /** 标签下方的说明文字；默认空字符串。 */
    description?: string;
    /** 原生 input id；空字符串时优先使用 FormField 提供的 id，默认空字符串。 */
    id?: string;
    /** 原生 input name；空字符串时不设置 name，默认空字符串。 */
    name?: string;
    /** 禁用原生 checkbox；默认 false。 */
    disabled?: boolean;
    /** 原生 required；也会与 FormField 的 required 合并，默认 false。 */
    required?: boolean;
};

type FormCheckboxEmits = {
    /** 原生 checkbox change 后发出；payload 始终是 boolean。 */
    (event: "update:modelValue", value: boolean): void;
    /** 原生 input 获得焦点时发出。 */
    (event: "focus", event: FocusEvent): void;
};

type FormCheckboxSlots = {
    /** 自定义标签内容；提供该 slot 后覆盖 label prop 的 fallback。 */
    default?: () => unknown;
};
```

`modelValue` 是受控值：组件根据它决定真实 input 的 `checked` 和视觉状态，不在内部保存选中值。组件不提供 expose API。未声明 attrs 会落到根 `label`，不是稳定的 input 属性透传合同；需要设置 input 的 id、name 或 required 应使用对应 props。

当 `indeterminate` 保持 true 时，点击事件仍只发出 boolean；父组件若要让控件离开半选态，需要自行更新 `indeterminate` 或传入新的 `modelValue`。

## 状态

- **默认/未选中**：显示空的视觉 checkbox；没有 label 和默认 slot 时，文字 fallback 为 `false`。
- **选中**：`modelValue === true` 且未处于半选时显示白色勾号；无自定义标签时文字 fallback 为 `true`。
- **半选**：显示短横并设置 `aria-checked="mixed"`；`indeterminate` prop 与字符串值任一成立即进入该状态。
- **禁用**：不可点击、视觉降低不透明度；父组件仍可改变受控值。
- **只读、加载中、出错、空数据**：组件没有这些专用状态；只读或校验提示由宿主控制。

## 不支持

- 不支持多选组管理、全选联动或数组值；这些逻辑应由父组件组合多个实例。
- 不提供自定义图标 slot、错误 slot 或 loading 状态。
- 不直接写入 store、浏览器存储或网络。

## 隐藏通道理由

`state:inject`：组件通过 `useFormFieldContext()` 可选读取外层 `FormField` 提供的 `inputId`、`required`、`aria-describedby` 和 `invalid`。这些值描述的是同一字段的语义关联，由字段容器集中生成并在树内传递；若改成要求每个 checkbox 重复接收一组 props，label、错误文案与原生 input 的关联容易分叉。没有 `FormField` 时 composable 返回 null，组件仍可独立使用；组件不读取共享 store。
