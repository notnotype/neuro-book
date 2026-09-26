---
标签: [state:inject]
---

# FormTextarea

`FormTextarea` 是受控的多行文本字段，适合输入较长文本；它保留原生 textarea 的可调高度与浏览器约束校验，并可选地接入 `FormField`，自动关联字段标签、说明和错误状态。它不维护自己的文本副本，输入只通过 `update:modelValue` 交还给父组件。

## 布局与交互

根节点是占满可用宽度的原生 `<textarea>`，默认显示 4 行并允许纵向拖动调整大小。没有响应式结构切换；窄屏宽度随父容器收缩。`rows` 控制初始行数，`minlength` 和 `maxlength` 映射到原生约束属性。

输入时立即发出 `update:modelValue`，但不会在组件内更新显示值；父组件需回写新值。原生键盘编辑、光标、选择、表单校验和只读/禁用行为由浏览器 textarea 提供。`disabled` 时不能编辑或聚焦；`readonly` 时不能修改但仍可聚焦；`required` 使用原生必填语义。

## 数据

```ts
interface FormTextareaProps {
    modelValue?: string; // 文本值；默认 ""。受控，输入后由父组件回写。
    id?: string;         // 显式 id；默认 ""，为空时回退到 FormField 提供的 id。
    name?: string;       // 原生表单字段名；默认 ""，为空时不设置 name。
    placeholder?: string; // 占位文本；默认 ""。
    disabled?: boolean;  // 禁止编辑和聚焦；默认 false。
    readonly?: boolean;  // 禁止修改但允许聚焦；默认 false。
    required?: boolean;  // 原生必填；默认 false，并与 FormField 的 required 做逻辑或。
    autofocus?: boolean; // 请求原生自动聚焦；默认 false。
    rows?: number;       // 初始可见行数；默认 4。
    minlength?: number;  // 原生最小字符数；默认 undefined。
    maxlength?: number;  // 原生最大字符数；默认 undefined。
}

interface FormTextareaEmits {
    (event: "update:modelValue", value: string): void; // 每次原生 input 事件时发出。
}

interface FormTextareaSlots {} // 不提供插槽。
```

组件不 expose 方法或属性。未声明的 attributes、`class` 与 `style` 按 Vue 单根组件的默认 fallthrough 落到原生 textarea。

## 状态

- 默认：以 `modelValue` 显示文本；空值显示为空字段，可显示 `placeholder`。
- 禁用或只读：分别映射原生 `disabled` 与 `readonly` 属性，使用原生不可编辑行为和视觉状态。
- 必填：`required` 为真，或父级 `FormField` 提供的 required 为真时，原生字段为必填。
- 字段错误：位于 `FormField` 内且提供 `error` 时，注入上下文提供 `aria-invalid` 与错误描述关联，并应用无效控件样式；组件自身不校验业务规则。
- 加载中、空数据与网络错误：组件没有这些状态，也不处理数据请求。

## 隐藏通道理由

`state:inject`：组件可从同一 nb-ui 的 `FormField` 读取字段 id、描述关联 id、必填和无效状态。这个上下文用于让多个字段控件自动共享父字段的标签与错误语义；若要求每个字段控件重复接收这些派生值为 props，组合 `FormField` 时就需要逐项转发并容易产生不一致。没有提供上下文时，组件只使用自身 props，不要求宿主注入。
