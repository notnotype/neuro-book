---
标签: [state:inject]
---

# FormInput

`FormInput` 是单行文本输入控件，统一提供 nb-ui 的尺寸、主题、原生输入约束和可选的前后缀/图标/清除入口。它始终以字符串作为模型值，即使 `type="number"` 也不会把输入转换成数字；与 `FormNumberInput` 的区别是它不提供步进按钮或数字步进逻辑。

## 布局

没有前后缀、图标或清除能力时，组件渲染一个全宽原生 input；启用任一扩展能力时，组件渲染带边框的控制容器，内部依次放置图标、prefix slot、可伸缩 input、清除按钮和 suffix slot。输入区设置 `min-w-0`，因此长文本不会把扩展内容推出控制器。

`size="sm"` 使用紧凑高度和字号；`size="default"` 与 `size="md"` 使用标准 md 高度，源码对两者采用同一视觉分支。`390×844` 下扩展控件保持单行，输入文本在可伸缩区域内处理溢出。

## 交互

- 输入或编辑原生 input 时发出 `update:modelValue`，payload 始终为字符串，保留用户输入的中间态。
- 原生 input 获得焦点时发出 `focus`。
- `clearable` 且当前字符串非空、未 disabled、未 readonly 时显示“清空输入”按钮；点击后先发出 `update:modelValue`（空字符串），再发出 `clear`。
- `disabled` 禁止输入并降低不透明度；`readonly` 保留值和焦点语义但不接受修改，同时隐藏清除按钮。
- `autofocus`、`autocomplete`、`inputmode`、`minlength`、`maxlength`、`step`、`min` 和 `max` 按原生 input 属性传入；组件不自行校验或转换这些约束。

## 数据

```ts
type FormInputType = "text" | "search" | "password" | "number";
type FormInputSize = "default" | "sm" | "md";

type FormInputProps = {
    /** 受控字符串值；默认 ""。 */
    modelValue?: string;
    /** 原生 input id；空时优先使用 FormField 上下文 id，默认 ""。 */
    id?: string;
    /** 原生 input name；空时不设置 name，默认 ""。 */
    name?: string;
    /** 原生输入类型；默认 "text"。 */
    type?: FormInputType;
    /** 原生占位文字；默认 ""。 */
    placeholder?: string;
    /** 控件尺寸；默认 "default"；"default" 与 "md" 采用同一标准尺寸。 */
    size?: FormInputSize;
    /** 禁止输入；默认 false。 */
    disabled?: boolean;
    /** 只读输入；默认 false。 */
    readonly?: boolean;
    /** 原生 required；默认 false，并与 FormField required 合并。 */
    required?: boolean;
    /** 原生 autofocus；默认 false。 */
    autofocus?: boolean;
    /** 原生 autocomplete；默认 ""，空值不设置属性。 */
    autocomplete?: string;
    /** 前置图标 class；默认 ""；非空时启用扩展容器。 */
    iconClass?: string;
    /** 是否显示清空按钮；默认 false。 */
    clearable?: boolean;
    /** 原生 inputmode；默认 undefined。 */
    inputmode?: "none" | "text" | "decimal" | "numeric" | "tel" | "search" | "email" | "url";
    /** 原生 minlength；默认 undefined。 */
    minlength?: number;
    /** 原生 maxlength；默认 undefined。 */
    maxlength?: number;
    /** 原生 step；默认 undefined。 */
    step?: string;
    /** 原生 min；默认 undefined。 */
    min?: string;
    /** 原生 max；默认 undefined。 */
    max?: string;
};

type FormInputEmits = {
    /** 输入内容变化时发出；value 始终是字符串。 */
    (event: "update:modelValue", value: string): void;
    /** 原生 input 获得焦点时发出。 */
    (event: "focus", event: FocusEvent): void;
    /** 清空按钮触发时发出；紧跟在 update:modelValue("" ) 之后。 */
    (event: "clear"): void;
};

type FormInputSlots = {
    /** 输入区左侧内容；有内容时启用扩展容器。 */
    prefix?: () => unknown;
    /** 输入区右侧内容；有内容时启用扩展容器。 */
    suffix?: () => unknown;
};
```

`modelValue` 是受控值：组件用它设置原生 input 的 value，不在内部复制一份输入值。没有传入 `modelValue` 时使用默认空字符串。组件没有 expose API。

组件通过 `useFormFieldContext()` 可选读取外层 `FormField` 的 input id、required、`aria-describedby` 和 invalid；显式 `id`、`required` 优先或合并到该上下文。组件有前缀/后缀时存在扩展容器与 input 两个根节点，没有这些能力时根节点直接是 input；因此未声明 attrs、`class` 和 `style` 不属于稳定的原生 input 透传合同，应使用上面声明的 props。

## 状态

- **默认/空值**：显示空 input 和 placeholder；`clearable` 在值为空时不显示按钮。
- **受控**：父组件通过 `modelValue` 决定输入值，输入事件只向外报告。
- **禁用**：原生 input 不可编辑，视觉降低不透明度，清空入口隐藏。
- **只读**：原生 input 保留值但不接受编辑，清空入口隐藏。
- **错误**：从 FormField 收到 `invalid` 时控制器使用错误样式并向 input 设置 `aria-invalid`。
- **加载中、空数据**：没有专用状态；加载/业务校验由宿主表达。

## 不支持

- 不支持将 `type="number"` 的值转换为 number、步进或边界钳制；需要这些行为使用 `FormNumberInput`。
- 不提供 debounce、异步校验、搜索请求或浏览器存储。
- 不提供自定义 input 元素 slot；prefix/suffix 只扩展输入两侧内容。

## 隐藏通道理由

`state:inject`：组件可选读取 `FormField` 提供的字段语义上下文，复用容器生成的 id、required、错误关联和 invalid 状态，使标签、文案与原生 input 保持同一份可访问性关系。没有 FormField 时返回 null，所有显式 props 仍可独立工作；组件不读取共享 store。
