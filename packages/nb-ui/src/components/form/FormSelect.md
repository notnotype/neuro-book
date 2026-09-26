---
标签: [state:local, state:inject, env:portal, env:global]
---

# FormSelect

`FormSelect` 是可主题化的单值下拉选择控件。它把选项的 label、描述、图标或状态点渲染到可滚动的 Reka Select 浮层中，支持受控字符串值、禁用选项、固定向上/向下或自动碰撞定位；与原生 `<select>` 不同，浮层内容属于组件库 DOM，可以统一应用 nb-ui 材质、尺寸和滚动条。

## 布局

触发器默认全宽，左侧显示当前选项的状态点/图标和 label，右侧显示旋转的下拉箭头。调用方传入 `class` 时，组件在类名层合并并让调用方的宽度覆盖默认 `w-full`；其他 attrs 也显式落到触发器。选项可以有第二行 description，右侧可显示选中勾选标记。

`size="default"` 使用标准 md 控件高度与字号，`size="sm"` 使用紧凑高度。浮层与触发器相距 7px，默认按触发器宽度设置最小/固定宽度；长列表在内部视口滚动，默认按尺寸露出约 6 项（紧凑尺寸约 5 项）及下一项的一部分，并在可滚动时显示可拖动的悬浮胶囊滑块。

`390×844` 下触发器仍是一行，label/description 在选项内截断；浮层通过 Popper 碰撞避让收进视口，不锁定页面背景指针事件，也不锁定 body 滚动。

## 交互

- 点击或使用上游 Select 键盘操作打开、漫游和关闭选项浮层。
- 选择可用项时发出 `update:modelValue`，payload 是选项的 `value` 字符串；未知或非字符串的上游值回退为空字符串。
- `dropdownDirection="up"` 固定从触发器上方打开，`"down"` 固定从下方打开，`"auto"`（默认）允许上游根据碰撞翻转。
- `disabled` 禁用触发器；选项自身的 `disabled` 禁止选择并降低不透明度。
- `hideCheckmark` 隐藏选项右侧的选中指示器，不改变选择行为。
- 触发器获得焦点时发出 `focus`；浮层关闭时组件阻止上游把焦点弹回造成的二次闪烁，完整焦点生命周期由上游 Select 管理。
- 浮层列表可滚动；拖动悬浮滑块时组件在手势期间监听窗口指针移动与释放，手势结束或销毁时解除监听。

## 数据

```ts
type FormSelectSize = "default" | "sm";
type FormSelectDirection = "auto" | "up" | "down";

type FormSelectOption = {
    /** 主标签；必填。 */
    label: string;
    /** 发给 update:modelValue 的值；必填且应在 options 中唯一。 */
    value: string;
    /** 选项第二行说明；默认 undefined。 */
    description?: string;
    /** i-lucide-* 图标 class；与 indicatorClass 互斥，indicatorClass 优先；默认 undefined。 */
    iconClass?: string;
    /** 状态色圆点 class；与 iconClass 互斥，indicatorClass 优先；默认 undefined。 */
    indicatorClass?: string;
    /** 禁止选择该项；默认 undefined/false。 */
    disabled?: boolean;
};

type FormSelectProps = {
    /** 当前选项 value；受控字符串，默认 ""。 */
    modelValue?: string;
    /** 选项列表；必填。 */
    options: FormSelectOption[];
    /** 触发器 id；空时优先使用 FormField 上下文 id，默认 ""。 */
    id?: string;
    /** 原生 name；空时不设置 name，默认 ""。 */
    name?: string;
    /** 没有匹配选项时的占位文字；默认 ""。 */
    placeholder?: string;
    /** 控件尺寸；默认 "default"。 */
    size?: FormSelectSize;
    /** 浮层方向；默认 "auto"。 */
    dropdownDirection?: FormSelectDirection;
    /** 禁止打开和选择；默认 false。 */
    disabled?: boolean;
    /** required 语义；默认 false，并与 FormField required 合并。 */
    required?: boolean;
    /** 是否隐藏选中勾选标记；默认 false。 */
    hideCheckmark?: boolean;
};

type FormSelectEmits = {
    /** 选择变化时发出；value 是字符串，非字符串上游值回退为 ""。 */
    (event: "update:modelValue", value: string): void;
    /** 触发器获得焦点时发出。 */
    (event: "focus", event: FocusEvent): void;
};

type FormSelectSlots = {
    /** 触发器左侧内容；selected 是当前匹配的 FormSelectOption 或 undefined。 */
    leading?: (props: {selected: FormSelectOption | undefined}) => unknown;
};
```

`modelValue` 是受控值：组件把它传给 `SelectRoot`，选择后只发出 `update:modelValue`，不在组件内保存选中值。`options` 没有默认值且必须提供。组件不提供 `defaultValue`、`open` 或 `v-model:open`；浮层开关由上游 Select 内部维护。

组件没有 expose API，也没有默认 slot。组件显式关闭 attrs 自动继承：调用方的 `class` 经 `cn` 合并到触发器并可覆盖默认宽度，除 `class` 外的 attrs（例如 `aria-label`、`data-*`）转发到触发器；它们不会落到 Select 浮层或选项节点。`leading` slot 只替换触发器左侧状态点/图标区域，不替换选项列表。

## 状态

- **默认/空值**：触发器显示 placeholder；无匹配 `modelValue` 时也按空选择处理，选项列表仍可打开。
- **已选值**：显示匹配选项的 label，并按 `indicatorClass` 优先、否则 `iconClass` 显示前导标识；浮层中该项显示勾选标记（除非 hideCheckmark）。
- **禁用**：触发器不可操作；单个 disabled 选项保留在列表中但不可选。
- **错误**：FormField 的 invalid 上下文使触发器使用错误样式并设置 `aria-invalid`。
- **长列表**：浮层内部可滚动；内容超出视口时显示拖动滑块和渐隐提示。
- **只读、加载中、出错**：组件没有统一 readonly、loading 或请求错误状态；宿主应通过 disabled、options 或外围状态表达。

## 不支持

- 不支持多选、搜索输入、异步加载、分页或自由文本创建；需要这些能力时使用相应的 Combobox/Listbox 或宿主组合。
- 不支持父组件控制 open 状态或自定义 Portal 目标。
- 不支持选项级 slot、footer、empty 或 loading slot；`leading` 只作用于触发器。
- 选择事件不执行命令、不写 store、不发请求，也不替宿主修改业务数据。

## 上游边界

Reka UI 的 Select 原语负责 combobox/listbox 角色、键盘漫游、Escape/outside dismiss、焦点生命周期、受控选中生命周期与 Portal；`useDropdownFloating` 及其 composable 依赖负责 Popper 样式、碰撞参数、视口高度、渐隐和悬浮滚动条。本组件承诺选项数据映射、字符串模型事件、触发器 attrs/slot、方向设置、主题尺寸与浮层层级；上游未由本组件显式约束的定位、键盘和 aria 细节不属于稳定合同。

## 隐藏通道理由

- `state:local`：组件使用下拉浮层 composable 持有滚动条几何、滚动端点、拖拽状态与 ResizeObserver 观察结果。这些是本次浮层实例的临时呈现状态，组件销毁即丢失，不替代父组件的选中值。
- `state:inject`：浮层样式通过 `NB_POPOVER_Z_INDEX` 可选读取 `DialogWindow` 的窗口层级，使窗口内下拉菜单压在窗口表面之上；未注入时回退到公共 popover 层级。FormField 的字段语义上下文也通过 `useFormFieldContext` 可选读取，但不读取业务 store。
- `env:portal`：`SelectPortal` 将选项浮层移出触发器所在 stacking context，避免被表单或面板裁剪；组件不暴露自定义目标，目标与缺失目标行为遵循 Reka Portal。
- `env:global`：拖动悬浮滚动条需要在手势期间向 `window` 注册 `mousemove`/`mouseup`，以便指针离开滑块后仍能完成拖动；结束或卸载时解除监听，不是常驻全局快捷键。
