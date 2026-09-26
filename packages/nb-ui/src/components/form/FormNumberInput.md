---
标签: [state:inject]
---

# FormNumberInput

`FormNumberInput` 是以字符串保存数字编辑过程的单行数字控件。它用 `text` input 加 `inputmode="decimal"` 保留空字符串、负号和小数点等中间态，同时提供不进入 Tab 顺序的上下步进按钮、边界钳制、方向键步进和 Enter 提交；它与只提供原生数字属性的 `FormInput type="number"` 不同。

## 布局

根节点是全宽、可收缩的控制容器：左侧为可伸缩的等宽字体输入区，右侧为上下排列的两个微型步进按钮，中间以竖线分隔。按钮固定在容器右侧，不参与正常 Tab 顺序；输入区可在 `390×844` 下收缩，长值不会把步进器推出控件。

`size="sm"` 使用紧凑高度与字号；`size="default"` 使用标准 md 高度。`title` 作用于根控制容器，不是原生 input 的独立 prop。

## 交互

- 用户输入任何字符串时立即发出 `update:modelValue`，不在输入阶段解析或拒绝中间态。
- 点击上/下按钮分别执行一次向上/向下步进；`ArrowUp` 与 `ArrowDown` 在 input 聚焦时执行同样逻辑并阻止浏览器默认动作。
- 步进以 `step` 为增量，结果按 `min`/`max` 钳制；当前值无法解析时，向上以 `min` 或 0 为基准，向下以 `max` 或 0 为基准。
- 步进后的字符串按 `step` 的小数位数格式化，避免常见浮点尾数；手动输入则原样上报。
- Enter 阻止默认提交并发出无 payload 的 `submit`。
- `disabled` 或 `readonly` 时输入和步进按钮不可修改值；原生 disabled 还阻止控件聚焦。只读 input 的 Enter 仍由键盘处理器触发 `submit`，当前实现没有额外的只读拦截。

## 数据

```ts
type NumberInputSize = "default" | "sm";

type FormNumberInputProps = {
    /** 受控字符串值；默认 ""，组件不把它转换为 number。 */
    modelValue?: string;
    /** 原生 input id；空时优先使用 FormField 上下文 id，默认 ""。 */
    id?: string;
    /** 原生 input name；空时不设置 name，默认 ""。 */
    name?: string;
    /** 原生占位文字；默认 ""。 */
    placeholder?: string;
    /** 禁止输入和步进；默认 false。 */
    disabled?: boolean;
    /** 只读输入并禁用步进；默认 false。 */
    readonly?: boolean;
    /** 原生 required；默认 false，并与 FormField required 合并。 */
    required?: boolean;
    /** 原生 autofocus；默认 false。 */
    autofocus?: boolean;
    /** 可解析的最小数值字符串；默认 undefined。 */
    min?: string;
    /** 可解析的最大数值字符串；默认 undefined。 */
    max?: string;
    /** 步进字符串；默认 "1"；无效或非正值步进回退为 1。 */
    step?: string;
    /** 控件尺寸；默认 "default"。 */
    size?: NumberInputSize;
    /** 根控制容器的 title；默认 undefined。 */
    title?: string;
};

type FormNumberInputEmits = {
    /** 手动输入或一次步进后的字符串值。 */
    (event: "update:modelValue", value: string): void;
    /** Enter 键提交；无 payload。 */
    (event: "submit"): void;
};

type FormNumberInputSlots = {
    /** 无插槽。 */
};
```

`modelValue` 是受控值：输入事件和步进事件只发出新字符串，不在组件内部保存模型副本。组件没有 expose API。根节点是单个控制容器，未声明 attrs、`class` 和 `style` 按 Vue 默认行为落到该容器；它们不会自动转发到原生 input。

组件通过 `useFormFieldContext()` 可选读取 input id、required、`aria-describedby` 和 invalid，并将这些语义属性应用到原生 input 或控制器样式。没有 FormField 时仍可独立使用。

## 状态

- **默认/空值**：输入区为空，步进仍可按 `step` 与 min/max 计算下一值。
- **受控**：父组件通过 `modelValue` 决定显示值；输入和步进结果必须由父组件回写才能持续显示。
- **禁用**：输入与两个步进按钮均 disabled，容器降低不透明度。
- **只读**：输入保留值但不允许修改，两个步进按钮禁用；Enter 提交行为见「交互」。
- **错误**：FormField 的 invalid 上下文使容器使用错误样式，并给 input 设置 `aria-invalid`。
- **加载中、空数据**：没有专用状态；宿主通过 disabled、placeholder 或外部文案表达。

## 不支持

- 不支持 number 类型模型、千分位格式化、货币格式化或按业务 schema 校验。
- 不支持自定义步进按钮 slot、按钮 Tab 顺序或单独的 increase/decrease 事件。
- 不支持异步提交、请求、持久化或自动修正手动输入字符串。

## 注意事项

`min`、`max` 和 `step` 只影响按钮与方向键产生的步进结果，不会在用户手动输入时自动钳制或验证。若父组件不回写 `update:modelValue`，组件会立即发出事件但界面仍由旧的受控值决定。

## 隐藏通道理由

`state:inject`：组件可选读取 `FormField` 的字段语义上下文，避免每个数字输入重复接收生成 id、required、错误关联和 invalid 状态。上下文缺失时回退到显式 props，组件不读取共享 store。
