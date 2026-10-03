---
标签: []
别名: ["多行输入框", "紧凑文本域"]
---

# FormTextarea

表单里的紧凑多行文本输入框。它只做一件事：把用户敲进 `<textarea>` 的文本原样交给父组件，自己不留任何状态。和单行输入的区别是行数与换行，和 `StructuredTextEditor` 的区别是它不做 Markdown 结构、不做工具栏、不做高度自适应——高度由 `rows` 定死，用户也不能拖动改变大小。

## 数据

```ts
interface FormTextareaProps {
    /** 当前文本；必填、受控——组件自身从不修改它，只把输入通过事件交回 */
    modelValue: string;
    /** 可见行数；默认 2；决定固定高度，内容超出后由输入框内部滚动 */
    rows?: number;
    /** 值为空时的占位提示；默认空字符串 */
    placeholder?: string;
    /** 禁用；默认 false；禁用时整体变淡、光标不再是文本光标，且不接收输入 */
    disabled?: boolean;
}

interface FormTextareaEmits {
    /** 每次输入后发出，携带输入框此刻的完整文本 */
    (event: "update:modelValue", value: string): void;
    /** 获得焦点时发出，携带原生 FocusEvent */
    (event: "focus", event: FocusEvent): void;
}
```

没有 slot，没有 `expose`。未声明的 attribute（`class`、`style`、`id`、`aria-*`、`data-*` 等）按 Vue 默认行为落到唯一的根元素 `<textarea>` 上，所以它是可扩展口子：需要标签关联或测试 id 时直接写在标签上即可。

宽度始终填满父容器；行数固定，内容变多时是输入框内部滚动而不是把外层撑高。窄屏下结构不变。
