---
标签: []
---

# FormInput

一行高的受控文本输入框，把值、类型、禁用、只读与数值边界原样交给原生 `<input>`，并提供一条「前置槽」，用来把图标或单位贴在输入框内侧左边。它不认识输入内容的语义——不整形、不校验、不做数字步进；那些分别属于 `FormNumberInput`（步进）与使用方（校验）。与 nb-ui 的 `FormInput` 相比，这里没有表单字段上下文（不做 `for` / `aria-invalid` / `aria-describedby` 关联），是紧凑尺寸的轻量版。

## 数据

```ts
interface FormInputProps {
    /** 输入值；必填、受控——组件不保存值，用户输入只通过 update:modelValue 报给父组件，父组件不回写则显示不变 */
    modelValue: string;
    /** 原生 input type；默认 "text"。number 会用浏览器原生 spinner，需要自绘步进按钮请用 FormNumberInput */
    type?: "text" | "search" | "password" | "number"; // 默认 "text"
    placeholder?: string;  // 默认 ""
    /** 只读：可选中、可复制，不可编辑 */
    readonly?: boolean;    // 默认 false
    /** 禁用：不可聚焦、不可编辑，视觉变淡 */
    disabled?: boolean;    // 默认 false
    /** 原样交给原生属性，只在数值类型上有意义 */
    step?: string;         // 默认 undefined
    /** 原样交给原生属性，只在数值类型上有意义 */
    min?: string;          // 默认 undefined
    /** 原样交给原生属性，只在数值类型上有意义 */
    max?: string;          // 默认 undefined
}

interface FormInputEmits {
    /** 每次 input 事件，携带此刻的原生输入值（不裁剪、不转换） */
    (event: "update:modelValue", value: string): void;
    /** 输入框获得焦点 */
    (event: "focus", event: FocusEvent): void;
}

interface FormInputSlots {
    /**
     * 前置内容。传了它才会切换到「容器 + 前缀 + 输入框」形态：
     * 容器自己带边框与聚焦态（focus-within），前缀贴在输入框内侧左边。
     */
    prefix?: void;
}
```

没有 expose。attrs（含 `class`、`style`）按 Vue 默认落到渲染出的根元素上：没有 `prefix` 槽时就是 `<input>` 本身，有 `prefix` 槽时是外层容器。

不支持：不做清除按钮、字数上限、字符计数、表单字段关联或错误态；`readonly` / `disabled` 的视觉区别只有「不可编辑」与原生行为，没有额外提示。
