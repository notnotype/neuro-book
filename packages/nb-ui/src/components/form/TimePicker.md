---
标签: [state:inject]
---

# TimePicker

可由当前主题替换呈现方式的时间选择器入口。与直接使用某个主题实现不同，它按 `time-picker` 主题键解析实现，并在没有覆盖时回退到 nb-ui 默认实现；调用方只依赖一份稳定的 `HH:mm` 与键盘合同。

## 数据

```ts
type TimePickerProps = {
    /** 24 小时制、补零的 "HH:mm"；undefined 表示未选择，默认 undefined；作为受控值 */
    modelValue?: string;
    /** 可选时间下界，含；格式 "HH:mm"；默认 "00:00" */
    min?: string;
    /** 可选时间上界，含；格式 "HH:mm"；默认 "23:59" */
    max?: string;
    /** 步进分钟数，同时决定候选项间隔与方向键增量；默认 30 */
    step?: number;
    /** 禁用选择器；默认 false */
    disabled?: boolean;
    /** 标记输入值无效；默认 false */
    invalid?: boolean;
    /** 未选择时的输入提示；默认 "--:--" */
    placeholder?: string;
    /** 输入框 id，可关联外部 label；默认 undefined，具体实现可从 FormField 取得 id */
    id?: string;
};

type TimePickerEmits = {
    /** 用户提交或调整时间时发出；受控用法由父组件回写 */
    "update:modelValue": [value: string | undefined];
};

type TimePickerSlots = {};
```

没有 expose，也没有 slots。props 与 emits 转发给当前解析出的实现。未声明的 attributes、`class` 与 `style` 随 Vue 单根组件透传到该实现；实际 DOM 落点取决于实现，不是稳定合同。

`state:inject` 的理由：组件通过主题组件注册表注入读取当前主题的 `time-picker` 实现。此解析是主题覆盖能力的边界；未提供覆盖时仍使用库默认实现，不要求调用方提供注入值。

## 行为与边界

时间值只采用补零的 24 小时制 `"HH:mm"`。组件不提供 slot，以免把布局形态锁进公共契约；不同主题可使用不同交互形态，但必须保持 props、emits、无障碍角色和键盘行为一致。默认实现的具体交互见 [TimePickerDefault](./TimePickerDefault.md)。

## 上游边界

主题实现由 nb-ui 的主题组件注册表选择，默认实现为 `TimePickerDefault`。主题实现应遵守 `time-picker@1` 契约；本解析壳只负责选择实现并转发 props/emits，不承诺某一实现的 DOM、样式或额外能力。