---
标签: [state:local, env:global]
---

# Combobox

可输入筛选的单值组合框：输入时按选项的标签或值做不区分大小写的子串筛选，也允许把当前输入作为新值提交。它与只能挑已有项的下拉框不同，不会把自由输入限制在选项集合内。

## 布局

输入框和展开按钮并列，选项面板锚定输入框下方，宽度与输入框一致，最高 12rem，选项过多时在面板内滚动。`size="sm"` 使用紧凑高度与间距。父容器需允许面板覆盖后续内容；面板不会 Teleport。

## 交互

聚焦或点击输入框会打开选项面板；输入文本立即发出 `update:modelValue`（空字符串转换为 `null`）并筛选选项。点击箭头切换面板，点击选项发出该选项 value 并关闭；点击组件外部关闭。支持键盘聚焦与文本输入；没有方向键/Enter 选项导航。DOM 使用原生 input、button 与普通 div，没有 combobox/listbox/option 的 ARIA 角色与关联属性；调用方须提供可访问名称。

## 数据

```ts
import type {SelectOption} from "./FormSelect.vue";

type ComboboxSize = "default" | "sm";

interface ComboboxProps {
    /** 当前文本或选中值；必填、受控。 */
    modelValue: string | null;
    /** 可搜索选项；必填。字符串按自身同时作为 value 和 label；对象使用 SelectOption。 */
    options: (string | SelectOption)[];
    /** 禁用输入、展开和选项点击；默认 false。 */
    disabled?: boolean;
    /** 输入为空时显示的提示；默认空字符串。 */
    placeholder?: string;
    /** 控件尺寸；默认 "default"。 */
    size?: ComboboxSize;
}

interface ComboboxEmits {
    /** 输入发生变化（清空时为 null）或用户选择选项时发出。 */
    (event: "update:modelValue", value: string | null): void;
}
```

`SelectOption` 来自 `FormSelect.vue`，含必填 `label`、`value` 以及可选说明、图标、状态指示与禁用标记。当前 Combobox 不读取 `disabled` 字段，传入的禁用选项仍可点击。没有 slots、没有 expose；未声明 `inheritAttrs: false`，attrs 落在根 `<div>` 上。

## 状态

默认启用且关闭。聚焦后仅在有匹配选项时显示面板；输入值为空时列出全部选项，非空时匹配 label 或 value。无匹配项时隐藏面板，不提供额外空态文案。禁用时输入与箭头不可操作，面板不显示。

## 不支持

不提供多选、创建选项、异步搜索、清除按钮、选项分组、面板 Teleport 或专用键盘选项导航。不会校验自由输入是否属于 options。

## 隐藏通道理由

- `state:local`：只保存展开/收起状态，值始终由受控 `modelValue` 提供。
- `env:global`：通过 VueUse `onClickOutside` 监听组件外部点击以收起面板；监听随组件生命周期清理。面板关闭属于控件自身行为，不要求每个调用方重复实现。
