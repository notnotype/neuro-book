---
标签: [state:local]
---

# Listbox

`Listbox` 是常驻页面中的单选或多选列表，适合在选项需要描述、图标、徽标或分组时替代原生下拉框。它将筛选、分组和批量选择放在同一列表中；列表本身不会打开浮层，也不读取业务 store 或发起请求。

## 布局与交互

组件纵向排列可选筛选栏、可滚动选项区和可选操作栏。`maxHeight` 只限制选项区，溢出在列表内滚动。`variant="compact"` 使用紧凑行，`variant="card"` 为每项增加卡片式图标与选中指示；选项标题、描述会截断以避免撑宽。窄屏沿用相同结构，容器占满父级宽度；没有单独的断点布局。

选项来自 `groups` 或 `options`。非空 `groups` 优先，未提供非空分组时才使用 `options`；`options` 中任一项有 `group` 时按该字段分组，缺少分组名的项目归入“其他”，否则列表扁平显示。显式分组的空组选项和筛选后无选项的组不显示。筛选会去除首尾空白并转小写，对选项的 `label`、`description`、`badge`、`value` 做包含匹配。

单选每次选择一个字符串，多选维护字符串数组。启用筛选时，可用筛选框和清空按钮；操作栏显示时，单选可清除已有选择，多选可全选、反选或清空，分组标题还提供该组的切换全选。批量选择和反选仅包含当前筛选结果中的可用选项；被禁用选项不会被批量加入。整体 `disabled` 只传给选项项，不会禁用筛选框、组级切换按钮或操作栏按钮。键盘焦点移动、选择语义和无障碍角色由 Reka UI Listbox 实现提供。

## 数据

```ts
type ListboxVariant = "compact" | "card";
type ListboxSize = "sm" | "md" | "lg";

interface ListboxOptionData {
    value: string;
    label: string;
    description?: string;
    iconClass?: string;
    badge?: string;
    badgeTone?: "accent" | "success" | "warning" | "danger" | "neutral";
    disabled?: boolean;
    group?: string;
}

interface ListboxGroupData {
    id: string;
    label: string;
    options: ListboxOptionData[];
}

interface ListboxProps {
    modelValue?: string | string[]; // 当前选择；默认 undefined。提供时为受控值；单选传字符串，多选传数组。
    defaultValue?: string | string[]; // 非受控初值；默认 undefined，类型形态应与 multiple 匹配。
    options?: ListboxOptionData[]; // 扁平选项；默认 []。非空 groups 优先。
    groups?: ListboxGroupData[]; // 显式分组；默认 undefined。仅非空时优先于 options。
    variant?: ListboxVariant; // 选项外观；默认 "compact"。
    size?: ListboxSize; // 行尺寸；默认 "md"。
    multiple?: boolean; // 多选模式；默认 false。
    disabled?: boolean; // 禁用选项；默认 false。
    showFilter?: boolean; // 显示本地筛选输入；默认 false。
    filterPlaceholder?: string; // 筛选输入占位文本；默认 "搜索选项..."。
    showActionBar?: boolean; // 显示计数和选择操作；默认 false。
    maxHeight?: string; // 选项滚动区最大高度 CSS 值；默认 "280px"。
    emptyText?: string; // 无匹配项文本；默认 "未找到匹配选项"。
}

interface ListboxEmits {
    (event: "update:modelValue", value: any): void; // 用户选择、清除或批量操作时发出。实际值按模式为 string、string[]；单选清除发出 undefined。
}

interface ListboxSlots {} // 不提供插槽。
```

`modelValue` 存在时由父组件控制；省略时由 Reka UI 按 `defaultValue` 维护选择状态。源码的 emit 类型是 `any`，没有按 `multiple` 建立重载；调用方应按当前模式接收上述实际值形态。组件不 expose 方法或属性。未声明 attributes 按 Vue 根组件默认 fallthrough；没有手动透传或筛选 attrs 的逻辑。

## 状态

- 默认：没有选择时显示全部可用选项；空列表显示 `emptyText`。
- 已选择：选中项显示对应指示器；计数使用 `modelValue ?? defaultValue` 计算。非受控选择虽然由上游维护，但操作栏显示的数量与批量操作基于传入的 `defaultValue`，不会读取上游内部选择状态。
- 禁用：`disabled` 或单项 `disabled` 会禁用该列表项。筛选框和操作栏按钮没有绑定此禁用状态，仍可操作。
- 空筛选结果：选项区显示 `emptyText`；操作栏总项数随筛选结果变化。
- 加载、错误、只读：组件没有这些状态；数据准备和错误展示由调用方负责。

## 上游边界

Reka UI Listbox 负责选项根节点的选择状态、键盘导航、焦点和基础无障碍语义。本组件承诺选项数据的分组/筛选规则、呈现结构和批量操作；其余依赖 Reka UI 的键盘细节与 DOM/ARIA 实现不属于稳定承诺，升级后可能变化。
