---
标签: [state:local, state:inject, env:portal]
---

# ColorPicker

`ColorPicker` 将当前颜色预览、原生取色控件、文本颜色输入和可选预设色板放在一个弹出面板中。它同时保留原生取色器与直接输入颜色值两种路径，适合需要快速选色并保持可读颜色字符串的表单。当前值通过 `modelValue` 受控；`defaultValue` 只在未传 `modelValue` 时提供显示回退，选择后要使新颜色反映在控件中，父组件需更新模型值。

## 布局

触发器显示颜色方块与大写颜色值；默认尺寸为 `md`，另有紧凑 `sm`。点击后打开固定 224px 宽的浮层，包含原生颜色输入、文本输入、可选的五列预设色板和“完成”按钮。色板为空时隐藏色板区。浮层定位偏移 6px，并通过 portal 显示。

## 交互

- 点击色板色块、原生取色器或文本输入会发出 `update:modelValue`；文本输入仅在值非空时发出，且不在组件内验证颜色语法。
- 色板点击会在回调中检查 `disabled` 与 `readonly`；原生取色/文本输入在这两种状态下都通过自身 `disabled` 属性禁止交互。
- 点击“完成”关闭面板。颜色变化不会自动关闭面板。
- 触发器是带 `aria-disabled` 的 `div`，没有原生 disabled 属性；当前实现下 `disabled` 并未阻止通过触发器打开面板，键盘触发支持未核实。

## 数据

```ts
interface ColorPickerProps {
    /** 当前颜色；传入时受控，默认 undefined。 */
    modelValue?: string;
    /** modelValue 缺省时显示的回退颜色；默认 "#3B82F6"，不是组件内部会更新的初值。 */
    defaultValue?: string;
    /** 禁用颜色修改；当前不阻止打开面板，见已知偏差。默认 false。 */
    disabled?: boolean;
    /** 允许打开查看但禁止修改；默认 false。 */
    readonly?: boolean;
    /** 预设色值列表；默认 ["#3B82F6", "#6366F1", "#8B5CF6", "#EC4899", "#EF4444", "#F59E0B", "#10B981", "#06B6D4", "#64748B", "#1E293B"]。 */
    swatches?: string[];
    /** 是否显示文本/取色输入面板；源码该字段未被模板消费，见已知偏差。默认 true。 */
    showInput?: boolean;
    /** 触发器尺寸；默认 "md"。 */
    size?: "sm" | "md";
}

interface ColorPickerEmits {
    /** 输入控件当前提供的非空值或所选色板值；组件不另行校验或规范化。父组件应更新 modelValue 反映选择。 */
    (event: "update:modelValue", value: string): void;
}

interface ColorPickerSlots {}
```

组件没有 expose API。未声明 attrs 按 Vue 默认行为继承到根 PopoverRoot；该根节点并非触发器，故不要依赖 attrs 透传到可见控件。

## 状态与边界

- `modelValue` 优先于 `defaultValue` 显示；均未显式提供时回退到默认蓝色。`defaultValue` 不构成组件内部可变模型。
- `disabled` 与 `readonly` 均阻止颜色更新；readonly 仍可展开查看。当前 `disabled` 不阻止触发器打开，见已知偏差。

## 不支持

- 不解析或规范化颜色字符串，不提供透明度/alpha 通道。
- 不提供自定义输入、色板或触发器插槽；`showInput` 当前不能关闭输入面板（见已知偏差）。

## 上游边界

Reka UI Popover 管理展开、触发器和 Portal 生命周期，浏览器原生 color input 提供取色界面。本组件只承诺在有效用户输入/色板选择时发出原始字符串；具体原生控件外观、可接受颜色格式与上游焦点行为随平台或依赖变化。

## 隐藏通道理由

`state:local`：组件实例持有 Popover 的开合状态；颜色值本身不在组件内更新，而由父级通过 `modelValue` 回写。

`state:inject`：读取可选的 `NB_POPOVER_Z_INDEX`，让窗口内部的颜色面板显示在所属 `DialogWindow` 上方；没有窗口提供者时使用公共 popover 层级。该值是宿主窗口栈上下文，不属于颜色字段数据。

`env:portal`：面板使用 Reka Popover Portal 脱离表单祖先的裁剪与 stacking context。Portal 目标由上游默认管理，本组件未提供覆盖目标；目标不可用时的具体行为遵循 Reka UI。

## 已知偏差

- `disabled` 只被色板回调与输入控件检查，触发器没有传入 PopoverRoot 或原生禁用属性，禁用时仍可能打开面板。
- `showInput` prop 有默认值和公开类型，但模板没有读取它；无论传 true 或 false，取色器和文本输入面板都会显示。上述状态描述按当前实现记录，不代表 prop 已生效。
- 色板按钮没有显式可访问名称；读屏用户无法仅从按钮名称识别其对应色值。
