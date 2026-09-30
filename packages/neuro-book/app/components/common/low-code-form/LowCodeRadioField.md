---
标签: []
---

# LowCodeRadioField

低代码表单里的单选字段，选项少而固定、需要一眼看全时用它。它按选项形态自动挑控件：**任意一个选项带 `description` 时用 nb-ui `RadioGroup`**（竖排单选，每项可带一行说明），否则用 nb-ui `SegmentedControl`（横向满宽分段，适合「二选一 / 三选一」这种等权选项）。与 `LowCodeSelectField` 的差别是选项全部摊开、不展开浮层。

## 数据

```ts
type LowCodeRadioFieldProps = {
    /** 字段定义。本组件用到 `options`（`value`/`label`/`description`/`disabled`）。必填。 */
    field: LowCodeFieldDto;
    /** 当前值。受控；默认 `null`；与任何选项的 `value` 都不相等时所有选项都不选中。 */
    modelValue?: LowCodeJsonValue;
    /** 是否禁用。默认 `false`；`true` 时整组禁不动，并与每个选项自身的 `disabled` 合并生效。 */
    disabled?: boolean;
};

type LowCodeRadioFieldEmits = {
    /** 切换到另一个可用选项时触发，携带该选项 DTO 里的原始 `value`。 */
    (e: "update:modelValue", value: LowCodeJsonValue): void;
};
```

无 slot，不暴露 `expose`。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到当前渲染出的那个控件根节点上——走 `RadioGroup` 还是 `SegmentedControl` 由选项是否带 `description` 决定，落点随分支变化。

## 状态

- 默认（无 `description`）：横向满宽分段，当前项高亮；键盘方向键（左右上下）在可用项之间直接切换并同步移动焦点，Home / End 跳到首尾，可用项只有一个时键盘不做任何事。
- 默认（有 `description`）：竖排单选列表，每项下面显示说明文字。
- 未选中：值与所有选项都不相等时不选中任何一项，也不自动回落到第一项。
- 禁用：分组控件与每个选项都带 `disabled`，鼠标与键盘都改不动，外观变淡。
- 选项自身 `disabled`：该项变淡、不可选，键盘移动会跳过它；选择结果不会上报。
- 空选项：`field.options` 为空时是一片空白区域，没有空状态文案。
- 出错：组件自身没有错误态；字段级报错由 `LowCodeFieldShell` 依据 issues 渲染。

## 注意事项

- 选项的 `value` 可以是字符串、数字或布尔，类型参与比较：`1`、`"1"` 与 `true` 是三个互不相同的选项，上报时也保留原始类型。
- **有 `description` 就用竖排列表，没有就用分段控件**：给某个选项补上一句说明会连带整组换一种形态；如果只想让说明出现在悬停提示里，别用 `description`。
- 组件不提供分组级的可访问名称，也不设置表单字段名：字段标题由 `LowCodeFieldShell` 渲染且未与控件建立 `for`/`id` 关联，两个分支都没有 `aria-label`，因此读屏软件读不出这一组叫什么。
