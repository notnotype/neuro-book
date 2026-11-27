---
标签: [state:inject]
---

# Field

`Field` 是一层表单语义容器，负责把标签、描述或错误文案与一个字段控件放在同一结构中，并通过 Vue provide 将生成的 id、required、invalid 和 `aria-describedby` 关系传给树内的 nb-ui 表单控件。它不持有字段值，也不替父组件执行校验或提交。

## 布局

根节点是一个 block 级 `label`（组形态 `group` 时是 `div`），内部依次是可选字段标题、出错时视觉隐藏的错误元素、默认 slot 内容与可选描述文字。标题和描述各占一行，默认间距由 `space-y-1.5` 提供。`error` 不显示成文字：出错时字段的排版不变（控件的位置与字段的高度都不变），只有控件标红，原因放在视觉隐藏的元素里给读屏；这个元素排在 slot 之前，所以没有描述时控件仍是最后一个子元素，下面不多出间距；看得见的原因由宿主写在固定位置（对话框里是页脚左侧的状态行），规则见 [UI 开发规范](../../../docs/ui-development-spec.md) 的“表单与无障碍”。标题过长或辅助文案过长时由父级宽度决定换行，组件不设置固定宽度。

`390×844` 下布局仍是单列结构，字段控件由默认 slot 决定宽度；Field 自身不创建横向滚动区域，也不改变 slot 内容的尺寸。

## 交互

- 点击标题或 label 区域会按原生 `<label>` 语义把焦点交给关联控件；关联 id 来自 `for` prop 或组件生成的 id。
- **组形态**（`group`）：给单选组、复选组这类由几个控件组成的字段用。根是 `div`、带 `data-nb-field-group`，标题是带 id（`<id>-label`）的元素，不是 `<label for>`；组合控件读上下文的 `labelId` 写 `aria-labelledby`。点击标题不转移焦点。`<label>` 里放一组单选，读屏读不出组名，所以组合控件要用这个形态（docs/specs/ui/forms.md 输出 27）。组形态只给组合控件：单个控件（`Input`、`Select`、`Switch` 等）靠 `<label for>` 命名，放进组形态会没有名字，组件不检查这种误用。
- `required` 为 true 时标题后显示红色 `*`，并通过上下文让支持它的子控件设置原生 required 语义。
- `error` 为非空字符串时生成视觉隐藏的错误元素与 id，子控件收到 `aria-invalid`，`aria-describedby` 先列错误 id、再列描述 id（有描述时）。
- 组件本身没有键盘快捷键、提交动作或焦点事件；字段控件的键盘行为由 slot 内容负责。

## 数据

```ts
type FieldProps = {
    /** 字段标题；默认空字符串，空时不渲染标题。 */
    label?: string;
    /** 辅助描述；默认空字符串；有 error 时照常显示。 */
    description?: string;
    /** 错误原因；默认空字符串；只给读屏，字段据此标红。 */
    error?: string;
    /** 显式关联控件 id；默认空字符串；为空时生成 nb-field-* id。 */
    for?: string;
    /** 是否必填；默认 false。 */
    required?: boolean;
    /** 组形态：根是 div，标题带 id 供组合控件的 aria-labelledby 引用；默认 false。 */
    group?: boolean;
};

type FieldEmits = {
    /** 无 emits；组件不持有或修改字段值。 */
};

type FieldSlots = {
    /** 字段控件与自定义内容；slot props 是当前字段的可访问性上下文。 */
    default?: (props: {
        inputId: string;
        descriptionId: string | undefined;
        errorId: string | undefined;
        ariaDescribedby: string | undefined;
        invalid: boolean;
    }) => unknown;
};
```

组件生成的 id 形如 `nb-field-<Vue useId>`，只有 `for` prop 非空时才使用调用方给出的 id。组件不提供 expose API。未声明的 attrs、`class` 和 `style` 按 Vue 默认行为落到根 `label`，不应把它们当作内部控件属性透传入口。

Field 通过 `NB_FIELD_CONTEXT_KEY` provide 下列只读计算值给后代：`inputId`、`labelId`（有标题时）、`descriptionId`、`errorId`、`ariaDescribedby`、`required` 和 `invalid`。`Input`、`NumberInput`、`Textarea`、`Select`、`Checkbox`、`Switch`、`RadioGroup` 与 `CheckboxGroup` 会可选读取这份上下文（组合控件用 null 盖住它给子项的那份）；`useFieldContext`、`NB_FIELD_CONTEXT_KEY` 与类型 `FieldContext` 从 `@notnotype/nb-ui/components` 导出，别的包可以写读它的控件。其它默认 slot 内容不会自动获得原生属性。没有这些消费者时，provide 不产生额外副作用。

## 隐藏通道理由

`state:inject`：组件通过 `provide` 建立后代字段控件读取的上下文，包含 input id、说明/错误 id、描述关联、required 与 invalid；标签表示它参与 provide/inject 字段通道，不表示它从父级注入状态。

## 状态

- **默认**：按 `label`、slot 和 description 的组合渲染字段结构。
- **必填**：显示 `*`，并向支持上下文的子控件传递 required。
- **出错**：排版不变（描述照常显示），`invalid` 为 true，子控件据此标红并设 aria 属性；错误原因只在视觉隐藏的元素里。
- **空标签**：不渲染标题，但根 label 与上下文仍存在。
- **只读、禁用、加载中、空数据**：容器没有这些专用状态；由默认 slot 的字段控件表达。

## 不支持

- 不支持保存或校验字段值，不提供 `modelValue`、change 或 submit 事件。
- 不支持自动生成多字段布局、字段级 loading、错误列表或异步校验。
- 不支持跨组件树或跨表单共享这份上下文；上下文只对当前后代树有效。

## 组合边界

`Field` 是表单控件与可访问性文案之间的组合边界：它只生成并提供语义关系，不规定后代控件必须是 nb-ui 组件，也不替普通 slot 内容注入原生属性。实际值、校验、提交和禁用策略仍由父组件通过 props、emits 与 slot 内容控制。
