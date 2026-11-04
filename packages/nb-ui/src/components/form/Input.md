---
标签: [state:inject]
---

# Input

`Input` 是单行文本输入控件，统一提供 nb-ui 的尺寸、主题、原生输入约束和可选的前后缀/图标/清除入口。它始终以字符串作为模型值，即使 `type="number"` 也不会把输入转换成数字；与 `NumberInput` 的区别是它不提供步进按钮或数字步进逻辑。

## 布局

没有前后缀、图标或清除能力时，组件渲染一个全宽原生 input；启用任一扩展能力时，组件渲染带边框的控制容器，内部依次放置图标、prefix slot、可伸缩 input、清除按钮和 suffix slot。输入区设置 `min-w-0`，因此长文本不会把扩展内容推出控制器。

`size="sm"` 使用紧凑高度和字号；`size="md"`（缺省）使用标准高度。`390×844` 下扩展控件保持单行，输入文本在可伸缩区域内处理溢出。

## 交互

- 输入或编辑原生 input 时发出 `update:modelValue`，payload 始终为字符串，保留用户输入的中间态。
- 原生 input 获得焦点时发出 `focus`。
- `clearable` 且当前字符串非空、未 disabled、未 readonly 时显示“清空输入”按钮；点击后先发出 `update:modelValue`（空字符串），再发出 `clear`。
- `disabled` 禁止输入并降低不透明度；`readonly` 保留值和焦点语义但不接受修改，同时隐藏清除按钮。
- `autofocus`、`autocomplete`、`inputmode`、`minlength`、`maxlength`、`step`、`min` 和 `max` 按原生 input 属性传入；组件不自行校验或转换这些约束。

## 数据

```ts
type InputType = "text" | "search" | "password" | "number";
type InputSize = "sm" | "md";

type InputProps = {
    /** 受控字符串值；默认 ""。 */
    modelValue?: string;
    /** 原生 input id；空时优先使用 Field 上下文 id，默认 ""。 */
    id?: string;
    /** 原生 input name；空时不设置 name，默认 ""。 */
    name?: string;
    /** 原生输入类型；默认 "text"。 */
    type?: InputType;
    /** 原生占位文字；默认 ""。 */
    placeholder?: string;
    /** 控件尺寸；默认 "md"。 */
    size?: InputSize;
    /** 禁止输入；默认 false。 */
    disabled?: boolean;
    /** 只读输入；默认 false。 */
    readonly?: boolean;
    /** 原生 required；默认 false，并与 Field required 合并。 */
    required?: boolean;
    /** 出错外观与 aria-invalid；默认 false，与 Field 上下文的出错取或。 */
    invalid?: boolean;
    /** 清空按钮的读屏名称；默认“清空输入”，按显示语言覆盖。 */
    clearLabel?: string;
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

type InputEmits = {
    /** 输入内容变化时发出；value 始终是字符串。 */
    (event: "update:modelValue", value: string): void;
    /** 原生 input 获得焦点时发出。 */
    (event: "focus", event: FocusEvent): void;
    /** 清空按钮触发时发出；紧跟在 update:modelValue("" ) 之后。 */
    (event: "clear"): void;
};

type InputSlots = {
    /** 输入区左侧内容；有内容时启用扩展容器。 */
    prefix?: () => unknown;
    /** 输入区右侧内容；有内容时启用扩展容器。 */
    suffix?: () => unknown;
};
```

`modelValue` 是受控值：组件用它设置原生 input 的 value，不在内部复制一份输入值。没有传入 `modelValue` 时使用默认空字符串。组件没有 expose API。

组件通过 `useFieldContext()` 可选读取外层 `Field` 的 input id、required、`aria-describedby` 和 invalid；显式 `id`、`required` 优先或合并到该上下文。有前缀、后缀、图标或清除入口时活动根节点是扩展容器，其他情况下根节点是原生 input；未声明 attrs 按 Vue 默认 fallthrough 到活动根节点，因此不能稳定地透传到 input，应使用上面声明的 props。

## 状态

- **默认/空值**：显示空 input 和 placeholder；`clearable` 在值为空时不显示按钮。
- **受控**：父组件通过 `modelValue` 决定输入值，输入事件只向外报告。
- **聚焦**：边框转 `--focus-outline`，外加 `--focus-ring` 光晕；悬停不改边框。只读和禁用时聚焦也不画这圈高亮。
- **禁用**：原生 input 不可编辑，视觉降低不透明度，清空入口隐藏。
- **只读**：原生 input 保留值但不接受编辑，清空入口隐藏。
- **错误**：从 Field 收到 `invalid` 时控制器使用错误样式并向 input 设置 `aria-invalid`、`aria-describedby`。
- **加载中、空数据**：没有专用状态；加载/业务校验由宿主表达。

## 不支持

- 不支持将 `type="number"` 的值转换为 number、步进或边界钳制；需要这些行为使用 `NumberInput`。
- 不提供 debounce、异步校验、搜索请求或浏览器存储。
- 不提供自定义 input 元素 slot；prefix/suffix 只扩展输入两侧内容。

## 隐藏通道理由

`state:inject`：组件可选读取 `Field` 提供的字段语义上下文，复用容器生成的 id、required、错误关联和 invalid 状态，使标签、文案与原生 input 保持同一份可访问性关系。没有 Field 时返回 null，所有显式 props 仍可独立工作；组件不读取共享 store。

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取清空按钮的缺省可访问名称，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `clearLabel` 时以属性为准，不读端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。
