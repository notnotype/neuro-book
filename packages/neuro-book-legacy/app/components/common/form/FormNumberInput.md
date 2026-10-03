---
标签: []
---

# FormNumberInput

数值输入框，用自绘的上下步进小按钮替代浏览器原生 spinner。与 `FormInput` 的区别是它认识数字：按 `step` 步进、按 `min` / `max` 夹取、按 `step` 的小数位数格式化结果；用户直接敲进来的文本则原样上报，不夹取也不整形。值仍然是字符串受控——这样空的、`-`、`1.` 这类「还没写完」的中间态也能留在框里，不会被组件吞掉或改写成数字。

## 数据

```ts
type FormNumberInputSize = "default" | "sm";

interface FormNumberInputProps {
    /** 当前值；必填、受控。是字符串而非 number，以容纳中间态 */
    modelValue: string;
    /** 步进量；默认 "1"。解析不出数字或不大于 0 时按 1 处理；小数位数决定步进结果的输出精度 */
    step?: string;
    /** 下界；默认不限制。解析不出数字时不生效（不会当成 0） */
    min?: string;
    /** 上界；默认不限制。解析不出数字时不生效 */
    max?: string;
    placeholder?: string;      // 默认 ""
    /** 只读：不可编辑，步进按钮一并禁用 */
    readonly?: boolean;        // 默认 false
    /** 禁用：不可聚焦、不可编辑，步进按钮一并禁用 */
    disabled?: boolean;        // 默认 false
    /** 语义尺寸；两档高度都是 28px，只差左右内边距（sm 更紧） */
    size?: FormNumberInputSize; // 默认 "default"
    /** 整个字段的悬停提示（容器的原生 title） */
    title?: string;            // 默认 undefined
}

interface FormNumberInputEmits {
    /** 每次输入，原样携带用户文本（不校验、不夹取、不格式化） */
    (event: "update:modelValue", value: string): void;
    /** 焦点在输入框里按下回车 */
    (event: "submit"): void;
}
```

没有 slots，没有 expose。attrs 透传到根容器；`class` 写在它上面可以控制宽度。

交互：

- 输入框 `inputmode="decimal"`，文案用等宽字体；用户输入的每一次变化都直接上报，不做任何加工。
- ArrowUp / ArrowDown 触发一次步进（并阻止默认行为，避免光标或页面跟着动）；Enter 发 `submit` 并阻止默认行为。
- 步进以当前值的数字部分为基准；当前值解析不出数字（空串、`-`、`1.`）时，向上以 `min`、向下以 `max` 为基准，两者都没有则用 `0`。结果先夹进 `min` / `max`，再按 `step` 的小数位数去尾（避免浮点尾巴），最后以字符串上报。
- 两个步进按钮是 20×16 的小控件，分别带「增加」「减少」的悬停提示；`readonly` 或 `disabled` 时按钮不可点（视觉变淡），容器整体也变淡且光标不再是可编辑样式。

不支持：不做单位后缀、千分位、范围提示或错误态；不显示步进按钮的长按连击；不替使用方校验「必填」。
