---
标签: []
---

# LowCodeSelectField

低代码表单里的下拉单选字段：把 `LowCodeFieldDto` 中一条 `select` 字段渲染成 nb-ui `FormSelect`，选项收进浮层，只在触发器上显示当前项。它与 `LowCodeRadioField` 的差别是不摊开选项、不占版面；与 `LowCodeComboboxField` 的差别是不能输入、只能从给定选项里挑。

## 数据

```ts
type LowCodeSelectFieldProps = {
    /** 字段定义。本组件用到 `options`（`value`/`label`/`description`/`disabled`）与 `placeholder`。必填。 */
    field: LowCodeFieldDto;
    /** 当前值。受控；默认 `null`；与任何选项的 `value` 都不相等时视为未选中，触发器显示 `field.placeholder`（未提供即空白）。 */
    modelValue?: LowCodeJsonValue;
    /** 禁用。默认 `false`；只挡住指针交互（见「已知偏差」）。 */
    disabled?: boolean;
};

type LowCodeSelectFieldEmits = {
    /** 选中可用选项时触发，携带该选项 DTO 里的原始 `value`。 */
    (e: "update:modelValue", value: LowCodeJsonValue): void;
};
```

无 slot，不暴露 `expose`。未声明的 attribute、`class` 与 `style` 落到本组件自己的外层包裹元素上（禁用态靠这层容器实现），不会进到下拉控件。

## 状态

- 默认：触发器显示当前选项的标签与说明；展开后按选项顺序列出，带 `description` 的选项在标签下列一行说明。
- 未选中：值不在选项中时触发器显示 `field.placeholder`；组件不自动回落到第一项，也不提示值已失效。
- 禁用：指针事件被外层容器吃掉、整体变淡（见「已知偏差」）。
- 选项自身 `disabled`：下拉里照常显示、照常可点，选择结果被忽略且不下发事件，外观与可用项一致（见「已知偏差」）。
- 空选项：`field.options` 为空时是一个点不开的空下拉，没有空状态文案。
- 出错：组件自身没有错误态；字段级报错由 `LowCodeFieldShell` 依据 issues 渲染。

## 注意事项

- 选项的 `value` 可以是字符串、数字或布尔，类型参与比较：`1`、`"1"` 与 `true` 是三个互不相同的选项，上报时也保留原始类型。
- 下拉浮层由 nb-ui `FormSelect` 自行渲染在本组件的组件树之外，本组件没有指定落点的参数；父容器的 `overflow` 不会裁剪浮层。
- 组件不设置可访问名称：字段标题由 `LowCodeFieldShell` 渲染且未与控件建立 `for`/`id` 关联，触发器也没有 `aria-label`，因此读屏软件读不出这个字段叫什么。

## 已知偏差

- 「禁用」只挡指针：`disabled` 没有传给 nb-ui `FormSelect`，只是在外层容器上加了 `pointer-events-none` 与降透明度，因此用键盘仍可聚焦触发器、展开浮层并改值——选择结果照常上报。要按「禁用后值不可变」验收需先改实现。
- 选项的 `disabled` 没有传给 `FormSelect`：禁用选项与可用选项在下拉里长得一样，点它不产生任何变化，也没有任何提示。
