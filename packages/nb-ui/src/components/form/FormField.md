---
标签: [state:inject]
---

# 表单字段容器（FormField）

`FormField` 为一个表单控件提供标签、说明或错误文案，并通过字段上下文把生成的 input id、必填与无效状态交给内部字段控件。与单纯包裹布局的容器不同，它建立可访问名称和描述之间的关联，且错误文案优先于说明文案。

## 布局与交互

组件按纵向排列可选标签、默认插槽内容以及一条辅助文案。`error` 非空时显示错误并隐藏 `description`；否则有 `description` 时显示说明。`required` 为真时标签旁显示必填标记。没有响应式结构切换，窄屏宽度由父级控制。

`for` 非空时作为控件 id；为空时生成唯一 id。插槽接收这些 id 和状态，供自定义控件显式绑定；同一作用域内的字段控件也可直接注入上下文。组件不负责提交、校验或聚焦。

## 数据

```ts
interface FormFieldProps {
    label?: string; // 标签文本；默认 ""，空时不渲染标签文字。
    description?: string; // 辅助说明；默认 ""，仅无错误时显示。
    error?: string; // 错误文本；默认 ""，非空时显示并优先于 description。
    for?: string; // 控件 id；默认 ""，为空时生成唯一 id。
    required?: boolean; // 必填状态；默认 false。
}

interface FormFieldEmits {} // 不发出事件。

interface FormFieldSlots {
    default?(props: {
        inputId: string;
        descriptionId: string | undefined;
        errorId: string | undefined;
        ariaDescribedby: string | undefined;
        invalid: boolean;
    }): unknown; // 控件内容；提供关联 id 与当前错误状态。
}
```

组件不 expose 方法或属性。未声明的 attributes 按单根组件默认 fallthrough 到外层 `<label>`；不会转发至插槽中的控件。`for` 生成的 id 与注入上下文关联到后代控件，不由容器直接改写插槽内容。

## 状态与边界

- 没有显式 `for` 时生成 `nb-field-<Vue useId>`；显式 `for` 优先于生成值。
- `error` 非空时 `invalid` 为真，提供 `errorId` 和 `ariaDescribedby`，并隐藏说明；否则有说明才提供 `descriptionId` 和描述关联。
- 没有标签时不渲染标签文本；容器仍可提供字段上下文。组件不持有表单值，不执行必填或其他校验，也没有加载状态。

## 隐藏通道理由

`state:inject`：组件通过 `provide` 建立后代字段控件读取的上下文，包含 input id、说明/错误 id、描述关联、required 与 invalid。该依赖注入通道用于让 `FormInput`、`FormCheckbox` 等控件自动对齐同一字段的无障碍与错误状态；若移除该通道，调用方需逐个把这些派生字段转发给每个控件。此处标签声明的是组件参与 provide/inject 字段通道，不表示它从父级注入状态。
