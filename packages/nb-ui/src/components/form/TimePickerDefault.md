---
标签: [state:local, state:inject, env:portal, env:global]
---

# TimePickerDefault

`TimePicker` 的库默认实现：可编辑的时间输入框加候选时间下拉列表。它实现 `time-picker@1` 的值、键盘与无障碍合同；通常应使用主题解析入口 [TimePicker](./TimePicker.md)，只有明确需要固定使用库默认外观时才直接使用本组件。

## 布局与交互

输入框是 `role="combobox"`，下拉列表是传送到 `body` 的 `role="listbox"`。候选值从 `min` 起按 `step` 分钟递增，直到不超过 `max`；打开时会将当前选项滚入列表可视区域。浮层优先显示在输入框下方，空间不足且上方放得下时翻到上方，并保持在视口左右边距内。输入框尺寸由 nb-ui 控件 token 决定。

- 点击输入框或按 Enter 打开；打开后再按 Enter 关闭并将焦点还给输入框。
- 选择候选项或在文本框中输入合法 `HH:mm` 并提交时，发出 `update:modelValue`。提交的时间会限制在 `min` 与 `max` 内；无法解析的文本会还原为当前 prop 值，不发出更新。
- ArrowUp / ArrowDown 按 `step` 增减并立即发出更新；当前没有可解析值时从 `min` 起步。
- Escape 恢复输入框获得焦点时记录的值，关闭列表并将焦点还给输入框。
- 点击浮层外部会关闭列表，但不回滚值，也不把焦点抢回输入框。Tab 不被拦截，按浏览器顺序移焦。

## 数据

```ts
type TimePickerProps = {
    /** 补零的 24 小时制 "HH:mm"；undefined 表示未选择，默认 undefined；受控值 */
    modelValue?: string;
    /** 可选范围下界，含；默认 "00:00" */
    min?: string;
    /** 可选范围上界，含；默认 "23:59" */
    max?: string;
    /** 候选步进与方向键增量，单位分钟；默认 30 */
    step?: number;
    /** 禁用输入与选择；默认 false */
    disabled?: boolean;
    /** 无效态标记；默认 false，也会合并 FormField 注入的 invalid 状态 */
    invalid?: boolean;
    /** 输入框占位文本；默认 "--:--" */
    placeholder?: string;
    /** 输入框 id；默认 undefined，未传时尝试使用 FormField 提供的 id */
    id?: string;
};

type TimePickerEmits = {
    /** 用户提交或调整时间后发出；受控用法由父组件回写 */
    "update:modelValue": [value: string | undefined];
};

type TimePickerSlots = {};
```

没有 expose，也没有 slots。未声明 attributes、`class` 与 `style` 落在根 `div`，不会自动应用到内部输入框；要让外部 label 关联输入框，应使用 `id` prop。

`state:local`：浮层开合、编辑草稿和 Escape 回滚锚点在组件实例内暂存，卸载即丢失。`state:inject` 的理由：可选读取 `FormField` 的输入 id、无效状态与描述关联，并读取窗口提供的浮层层级；缺少这些提供方时，id 回退到组件默认值、无效态只看 prop、浮层层级回退到页面默认值。

`env:portal` 的理由：下拉浮层传送到 `body`，避免被祖先的 `overflow` 裁切并脱离局部 stacking context；目标固定为 `body`，没有可配置目标，也没有隐式目标创建。`env:global` 的理由：浮层打开时需要捕获窗口滚动与 resize 以更新位置，并监听外部点击以关闭；定位监听在关闭或组件销毁时解除，外部点击监听随组件作用域清理。

## 状态与边界

- `disabled` 禁用输入，键盘处理不生效；`invalid` 及父级 `FormField` 的无效状态用于输入框无效语义与样式。
- 空值显示占位提示；候选列表仍按 `min`、`max`、`step` 生成。
- 不提供只读 prop、清除按钮、用户自定义候选列表或 slot。

## 上游边界

本组件自行实现输入解析、候选值生成、键盘行为、焦点回归与定位策略；表单上下文来自 nb-ui `FormField`，浮层层级可由 `DialogWindow` 提供。浮层定位只处理下方空间不足时翻转到上方及左右视口边距，不提供箭头、完整边缘翻转或其它自动定位能力。Vue Teleport、VueUse 外部点击监听及浏览器焦点行为的其他细节不属于组件合同。