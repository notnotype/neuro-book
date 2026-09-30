---
标签: [state:local, state:inject, env:global, env:portal]
---

# FormSelect

NeuroBook 表单目录中的单选下拉代理：把项目既有的 `SelectOption` / `SelectSize` 类型与受控值接口接到 nb-ui `FormSelect`，供旧表单调用点继续使用同一套下拉控件。选项带说明、图标或状态色时仍由底层控件呈现；下拉内容由控件放到触发器之外，长列表也在浮层内滚动。

## 布局与交互

默认宽度随父容器，触发器显示已选项标签和可选的次行说明；无匹配值时显示 `placeholder`。展开后按 `options` 顺序显示列表，可通过鼠标或键盘选择；选择结果经 `update:modelValue` 交回宿主，禁用项不可选。`dropdownDirection` 可固定向上或向下，`auto` 允许底层定位避让视口边缘。长列表限制在下拉视口内滚动，选择列表不会撑开页面；390px 窄屏下沿用触发器宽度与浮层避让行为，组件没有独立的窄屏布局变体。

获得焦点时发出 `focus` 并携带原生 `FocusEvent`。关闭浮层后的焦点归还和键盘导航由 nb-ui / Reka Select 提供；本包装器不另行管理焦点或快捷键。

## 数据

```ts
import type {
    FormSelectDirection,
    FormSelectOption,
} from "@notnotype/nb-ui/components";

/** common wrapper 保留的兼容类型别名。 */
type SelectSize = "default" | "sm";
type SelectOption = FormSelectOption;

interface FormSelectProps {
    /** 当前选项 value；受控，默认空字符串。 */
    modelValue?: string;
    /** 可选项，必填；每项至少有 label / value，可带 description、iconClass、indicatorClass、disabled。 */
    options: SelectOption[];
    /** 触发器 id；默认空字符串，空值不传给底层控件。 */
    id?: string;
    /** 原生表单 name；默认空字符串，空值不传给底层控件。 */
    name?: string;
    /** 未选中时的占位文字；默认空字符串。 */
    placeholder?: string;
    /** 尺寸；默认 "default"，"sm" 用于紧凑表单。 */
    size?: SelectSize;
    /** 下拉方向；默认 "auto"，也可固定 "up" 或 "down"。 */
    dropdownDirection?: FormSelectDirection;
    /** 禁用触发器与选项选择；默认 false。 */
    disabled?: boolean;
    /** 必填标记；默认 false，可与可选的字段上下文 required 合并。 */
    required?: boolean;
    /** 隐藏选中项勾选标记；默认 false。 */
    hideCheckmark?: boolean;
}

interface FormSelectEmits {
    /** 选择项变化时发出其字符串 value；受控，父组件负责更新 modelValue。 */
    (event: "update:modelValue", value: string): void;
    /** 触发器获得焦点时发出原生 FocusEvent。 */
    (event: "focus", event: FocusEvent): void;
}
```

组件没有 slots，也没有 `expose` API；底层 nb-ui 的 `leading` slot 不由这个包装器转发。未声明的 attrs（包括 `class`、`style` 和 `aria-*`）显式传给 nb-ui 选择器，并由它应用到触发器；`class` 与触发器基础样式合并。

## 状态与边界

- 默认：空值显示 placeholder，启用状态可以展开；选中值与父组件传入值一致。
- 禁用：触发器不可用，不能打开或更改选项。
- 空选项：不提供自定义空态；没有可选择内容时由底层选择器呈现其空列表行为。
- 已选值不在选项中：不回写或自动选择其它项；触发器没有匹配标签时显示 placeholder。
- 错误与加载：本组件不发起加载，也没有独立的加载或错误 UI；处于 nb-ui `FormField` 上下文时，字段提供的 invalid 状态可用于触发器错误样式与 ARIA 描述关联。

## 不支持

- 不支持搜索输入、异步选项、选项分组、清除按钮或自定义下拉条目插槽。
- 不支持未声明的底层控件 slots 或 `expose` 方法。
- 不读写 store、浏览器存储或剪贴板，也不发起请求。

## 上游边界

Reka Select 负责选择器角色、键盘导航、开合与焦点归还；nb-ui `FormSelect` 负责选项呈现、浮层定位、滚动视口及主题材质。本包装器承诺的是这里列出的 props、两个事件与兼容类型；上游未声明的细节不作为本组件合同，升级 nb-ui / Reka 后可能变化。

## 隐藏通道理由

- `state:local`：底层选择器持有浮层开合与当前键盘活动项等短暂交互状态；受控选中值仍由 `modelValue` 提供。
- `state:inject`：nb-ui 选择器会读取可选的 `NB_FORM_FIELD_CONTEXT_KEY`，复用上层字段的 id、required、invalid 和描述关联；浮层材质还会读取可选的 `NB_POPOVER_Z_INDEX`，使嵌套窗口内的下拉保持在窗口之上。未提供上下文时分别回退到自身 props 与系统 popover 层级。
- `env:portal`：选项内容由底层 `SelectPortal` 放到触发器树之外，避免被祖先裁切；目标沿用 Reka Portal 默认目标，本组件不接受 portal target。
- `env:global`：底层下拉滚动条拖动期间监听 `window` 的 `mousemove` / `mouseup`，拖动结束或组件卸载时移除监听；滚动视口通过 `ResizeObserver` 更新滚动条几何。
