---
标签: []
---

# SwitchField

`SwitchField` 把一个开关轨道与标签、可选说明组合成整行可点击控件，适合设置列表中的单个布尔选项。它与独立的 `Switch` 不同：交互目标覆盖整行，且标签和说明随控件一同提供；当前值由父组件完全控制。

## 布局

根节点是整行按钮，水平排列文字区与固定为 36×20px 的开关轨道。标签与说明组成可收缩文本列，轨道不收缩并靠右对齐；根按钮宽度占满父容器。标签使用主文字色，说明仅在非空时显示并使用较小的次级文字色。

在 `390×844` 下，文字列可收缩并换行，右侧开关保持固定宽度；长内容不会把整行撑出父容器。

## 交互

- 点击整行（包括标签和说明区域）发出 `update:modelValue`，值为当前 `modelValue` 的反值；组件不在内部修改该受控值。
- `disabled` 时根按钮使用原生 disabled，不响应点击并降低不透明度。
- 根节点使用 `role="switch"`、`aria-checked` 表示当前值，按钮可通过 `label` 获取可访问名称；可用时保留可见焦点环，Enter/Space 按原生按钮语义激活。
- 组件不注册快捷键，也不在出现或消失时主动移动焦点。

## 数据

```ts
type SwitchFieldProps = {
    /** 当前开关值；必填、受控 */
    modelValue: boolean;
    /** 可见标签，并作为按钮的可访问名称；必填 */
    label: string;
    /** 可选说明文字；默认空字符串 */
    description?: string;
    /** 是否禁用整行；默认 false */
    disabled?: boolean;
};

type SwitchFieldEmits = {
    /** 点击时发出 modelValue 的反值；父组件持有最终状态 */
    (event: "update:modelValue", value: boolean): void;
};

type SwitchFieldSlots = {};
```

组件没有 slot 或 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落在根 `<button>` 上；原生按钮事件可由调用方使用。组件不访问 store、浏览器存储或网络。

## 状态

- 默认：按 `modelValue` 显示开启或关闭轨道；`description` 为空时只显示标签。
- 禁用：整行不可交互并降低不透明度。
- 只读、加载、出错、空数据：没有统一的只读、加载或错误态；标签可以是空字符串，但调用方应提供可访问的有效名称。

## 不支持

- 不支持三态、表单 `name`、内置标签插槽或单独禁用文字区/轨道。
- 不支持异步保存、确认或持久化；事件只报告下一布尔值。
