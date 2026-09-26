---
标签: [state:local, state:inject]
---

# TagInput

`TagInput` 用一组可移除标签加一个文本框编辑字符串数组，适合关键词、分类或收件人等多值字段。输入草稿留在控件内部，父组件只接收已提交的去重标签数组；若放在 `FormField` 中，还会自动关联字段 id、说明和错误样式。

## 布局与交互

容器随内容换行排列标签和输入框，高度随行数增长。`size="default"` 对齐常规表单控件高度，`size="sm"` 使用紧凑尺寸；窄屏继续自然换行，不改变交互结构。标签文本最多显示 140px 并截断。

输入非空文本后按 Enter、逗号或离开输入框会提交：文本先 trim，若非空且数组中还没有完全相同的值，则在数组末尾新增；无效或重复草稿不发事件。输入框为空时按 Backspace 移除最后一个标签。标签上的移除按钮可删除对应标签；按钮提供包含标签文本的可访问名称。`disabled` 禁止文本输入并禁用移除按钮。

## 数据

```ts
type TagInputSize = "default" | "sm";
type TagInputTone = "default" | "accent";

interface TagInputProps {
    modelValue: string[]; // 当前标签数组；必填、受控。每次增删后由父组件回写。
    id?: string; // 输入框 id；默认 ""，为空时回退到 FormField 提供的 id。
    name?: string; // 原生表单字段名；默认 ""，为空时不设置 name。
    placeholder?: string; // 空数组时显示的占位文本；默认 ""。
    disabled?: boolean; // 禁止输入和移除；默认 false。
    tone?: TagInputTone; // 标签配色；默认 "default"，可选 "accent"。
    size?: TagInputSize; // 控件尺寸；默认 "default"。
}

interface TagInputEmits {
    (event: "update:modelValue", value: string[]): void; // 有效新增或移除标签时发出；提交空白/重复草稿不发出。
}

interface TagInputSlots {} // 不提供插槽。
```

组件不 expose 方法或属性。未声明 attributes、`class` 与 `style` 按 Vue 单根组件默认落在外层容器；`id`、`name` 则专门绑定到内部输入框。

## 状态

- 默认：显示受控标签和一个空草稿输入；没有标签时显示 placeholder。
- 禁用：输入框不可编辑、移除按钮禁用。
- 字段错误：位于 `FormField` 内且提供 `error` 时，注入上下文让外层容器呈现无效控件样式，并将错误描述和 `aria-invalid` 关联到输入框。
- 只读、加载、网络错误：没有独立状态。

## 隐藏通道理由

`state:local`：输入草稿只在当前编辑过程存在，按提交键、逗号或失焦后转为受控数组；组件卸载即丢弃未提交草稿。父级不需要追踪每个按键，也不会收到临时文本。

`state:inject`：组件从 `FormField` 读取输入 id、描述关联、无效状态和必填标记，以配合统一字段标签和错误呈现。必填仅影响 `aria-required`，组件本身没有用于它的 prop。该字段上下文用于组合字段的可访问性，避免宿主重复转发多个派生属性；不在 `FormField` 中时这些状态不存在，组件仍可独立工作。
