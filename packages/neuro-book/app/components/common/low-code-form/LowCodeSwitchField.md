---
标签: []
---

# LowCodeSwitchField

低代码表单里的布尔字段：把 `LowCodeFieldDto` 中一条 `switch` 字段渲染成一个 nb-ui `Switch`，只表达「开 / 关」两态。与 `LowCodeRadioField` 的差别是它只有真假两值、没有选项列表，也不占用整行版面。

## 数据

```ts
type LowCodeSwitchFieldProps = {
    /** 字段定义。本组件只用到 `label`，作为开关的可访问名称；`description`、`required` 由 LowCodeFieldShell 渲染。必填。 */
    field: LowCodeFieldDto;
    /** 当前值。受控；默认 `false`；只有严格等于 `true` 才算选中，其它任何值（`"true"`、`1`、`null`）都显示为关。 */
    modelValue?: LowCodeJsonValue;
    /** 是否禁用。默认 `false`；为 `true` 时开关真禁用：点不动、键盘也切不动，外观变淡。 */
    disabled?: boolean;
};

type LowCodeSwitchFieldEmits = {
    /** 用户切换开关时触发，携带切换后的布尔值，不会发出非布尔值。 */
    (e: "update:modelValue", value: LowCodeJsonValue): void;
};
```

无 slot，不暴露 `expose`。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到被包装的 nb-ui `Switch` 上。

## 状态

- 默认：`modelValue === true` 显示为开，其余显示为关；切换即上报，组件不缓冲、不回写。
- 禁用：控件真禁用，鼠标与键盘都改不动，外观变淡。
- 空值：`modelValue` 缺失或为 `null` 时显示为关，不区分「没设置过」和「显式关」——需要区分时用字段默认值表达。
- 出错：组件自身没有错误态；字段级报错由 `LowCodeFieldShell` 依据 issues 渲染。

## 注意事项

- 开关的可访问名称直接取 `field.label`，因此这个字段的读屏名称不依赖 `LowCodeFieldShell` 的标题关联（与同目录其它字段不同）。
- 值只在「恰好为布尔 `true`」时显示为开，与其它字段一样不做类型转换；数字 `1` 或字符串 `"true"` 都显示为关。
