---
标签: [state:inject]
---

# LowCodeCheckboxField

低代码表单里的多选字段：把 `LowCodeFieldDto` 的选项映射为一组横向复选框，并将所选选项的原始字符串或数字值作为数组交还宿主。它与开关的区别是可以同时选多个选项；与通用复选框组的区别是会根据低代码字段 DTO 处理不可用选项与历史值。

## 数据

```ts
import type {LowCodeFieldDto, LowCodeJsonValue} from "nbook/shared/dto/low-code-form.dto";

interface LowCodeCheckboxFieldProps {
    /** 字段 DTO；必填。本组件读取 options 的 value、label、description、disabled。 */
    field: LowCodeFieldDto;
    /** 当前 JSON 值；受控，默认 []。仅数组被视为已选值；其它值呈现为空选中集。 */
    modelValue?: LowCodeJsonValue;
    /** 是否禁用整组；默认 false。 */
    disabled?: boolean;
}

interface LowCodeCheckboxFieldEmits {
    /** 用户更改可操作选项时发出新数组，元素保留 DTO 的原始 string / number 类型。 */
    (event: "update:modelValue", value: LowCodeJsonValue): void;
}
```

无 slots、无 `expose`。未声明 attrs 按 Vue 默认落到根复选框组元素。选项名和说明由底层 CheckboxGroup / FormCheckbox 呈现；每项通过标签关联其复选框输入。

## 交互与状态

- 默认横向排列，窄屏空间不足时选项换行；选项自身描述显示在标签下方。
- 勾选或取消单个可用项时发出完整的新选择数组，不修改 prop。
- 整组 `disabled` 时所有输入不可操作；DTO 中单项 `disabled` 仅禁用对应项。
- 非数组 `modelValue` 显示为空选中集。模型里的值若已经不在选项列表中，或属于当前禁用项，用户更改其它选项时会保留这些值，不会静默丢失；可操作选项的新选择排在这些保留值之前。
- 空选项列表显示为空组；组件没有独立加载、错误或字段校验提示，字段级 issues 由 `LowCodeFieldShell` 呈现。

## 不支持

- 不提供垂直排列配置、分组、全选/清空动作或自定义选项插槽。
- 不发起请求、不写 store 或存储，也不在组件内校验表单。

## 已知偏差

- `LowCodeFieldOptionValueDto` schema 允许布尔值，但组件源码注释将 checkbox 语义限定为 string/number；当前实现会把 DTO 原始值映射进数组，却没有拒绝 boolean。现有 `LowCodeCheckboxField.test.ts` 未覆盖布尔选项，具体应否支持尚未核实，宿主不应依赖这一类型边界。

## 上游边界

复选框组的原生键盘与焦点行为、控件外观和表单字段 ARIA 关联由 nb-ui `CheckboxGroup` / `FormCheckbox` 提供。本组件负责 DTO 值与稳定选项 key 的映射、当前选中集合，以及切换时保留未知和禁用历史值；上游未声明行为不作为本组件合同。

## 隐藏通道理由

`state:inject`：底层 `FormCheckbox` 会可选读取 `NB_FORM_FIELD_CONTEXT_KEY`，以继承外层 nb-ui 字段的输入 id、必填、错误和描述关系。低代码字段本身不要求这个上下文；没有提供方时复选框照常使用自身 props 和选项标签。
