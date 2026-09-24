---
标签: [state:local, state:inject, env:global, env:portal]
---

# 表单下拉选择框（FormSelect）

`FormSelect` 根据字符串选项列表展示单选触发器和弹出选项菜单，支持富选项说明、图标或状态点。与原生 `<select>` 不同，它提供自定义菜单方向、行内前导插槽和独立滚动滑块，同时可与 `FormField` 的必填及错误语义联动。

## 布局与交互

触发器占满可用宽度，显示当前选项标签或占位文本、可选前导图标/状态点及展开指示。打开后选项按输入顺序纵向排列；选项过多时菜单视口滚动并出现可拖动的悬浮滑块。菜单宽度至少与触发器一致，按 `dropdownDirection` 自动翻转或固定出现在上/下方。窄屏宽度随父级收缩，菜单仍由上游浮层避让可视区域。

键盘聚焦、打开、选项导航和选择语义由 Reka UI Select 提供。选择后发出字符串更新，由父级回写。`disabled` 禁用整个控件；单项 `disabled` 禁止选择该项。触发器焦点时发出 `focus`。

## 数据

```ts
export type FormSelectSize = "default" | "sm";
export type FormSelectDirection = "auto" | "up" | "down";

export type FormSelectOption = {
    label: string;
    value: string;
    description?: string; // 可选次行说明。
    iconClass?: string; // 可选图标类；与 indicatorClass 同时存在时状态点优先。
    indicatorClass?: string; // 可选状态色圆点类；优先于 iconClass。
    disabled?: boolean; // 禁用此选项；默认不禁用。
};

interface FormSelectProps {
    modelValue?: string; // 当前选项 value；默认 ""。受控，选择后由父组件回写。
    options: FormSelectOption[]; // 选项数组；必填，无默认值。
    id?: string; // 触发器 id；默认 ""，为空时使用 FormField 注入 id。
    name?: string; // 原生表单字段名；默认 ""，为空时不设置。
    placeholder?: string; // 无匹配选项时的占位文本；默认 ""。
    size?: FormSelectSize; // 尺寸；默认 "default"。
    dropdownDirection?: FormSelectDirection; // 菜单方向；默认 "auto"，自动避让/翻转。
    disabled?: boolean; // 禁用整个选择器；默认 false。
    required?: boolean; // 必填；默认 false，并与 FormField required 逻辑或。
    hideCheckmark?: boolean; // 隐藏已选项对勾；默认 false。
}

interface FormSelectEmits {
    (event: "update:modelValue", value: string): void; // 选择选项时发出；非字符串上游值归为空字符串。
    (event: "focus", event: FocusEvent): void; // 触发器获得焦点时发出。
}

interface FormSelectSlots {
    leading?(props: {selected: FormSelectOption | undefined}): unknown; // 触发器值前的自定义内容；默认显示已选项状态点或图标。
}
```

组件不 expose 方法或属性。除 `class` 外，未声明 attributes 显式转发到 `SelectTrigger`；`class` 与触发器样式合并。组件管理的 `id`、`aria-describedby`、`aria-invalid` 优先用于字段关联。没有默认选项内容插槽，菜单行由 `options` 渲染。

## 状态与边界

- 空列表时菜单没有选项行，不显示自定义空状态；无匹配的 `modelValue` 时触发器显示占位文本。
- `required` 与 `FormField` 提供的 required 取逻辑或；字段错误通过 `aria-invalid`、`aria-describedby` 和错误样式体现。
- `dropdownDirection: "up"` 或 `"down"` 固定方向且不允许侧向翻转；`"auto"` 允许上游自动避让与翻转。
- 没有清除按钮、异步加载、搜索或创建选项能力；选项数据由父级传入。

## 上游边界

选中状态机、键盘与无障碍语义、菜单定位和 portal 行为来自 Reka UI Select；本包装额外承诺选项渲染、方向配置、尺寸、`leading` 插槽、字段上下文关联和滚动滑块交互。上游未由本包装公开的细节可能随 Reka UI 升级变化。

## 隐藏通道理由

- `state:inject`：读取 `FormField` 的 input id、required、invalid 与描述关联，让触发器获得字段语义；这些字段级状态由最近的表单字段容器统一维护，不由每个调用点重复传递。
- `env:portal`：`SelectPortal` 将菜单渲染到组件树外；本包装未指定自定义目标，目标及其缺失时的处理由 Reka UI 管理。
- `env:global`：菜单悬浮滑块拖动期间通过 `window` 监听 `mousemove` / `mouseup`，并在鼠标松开或组件卸载时移除；全局监听只用于把拖拽延续到菜单外部，避免拖动中断。
