---
标签: []
---

# Button

`Button` 是 nb-ui 的通用操作按钮，统一承载主操作、次操作、轻量操作和危险操作的视觉层级。它保留原生 `<button>` 的提交语义，同时提供尺寸、满宽、图标与加载态；与 `IconButton` 不同，它的主要信息来自默认插槽文字。

## 布局

按钮是 `inline-flex`，内容水平居中并保持单行。`sm`、`md`、`lg` 的固定高度分别为 26px、32px、38px；按钮内的图标和文字按间距排列。`block` 为 `true` 时按钮占满父容器宽度，否则宽度由插槽和图标内容决定。内容变长时按钮不会换行，父级负责提供可用宽度；组件自身不提供横向滚动。

在 `390×844` 的窄屏中，按钮仍保持所选尺寸和单行结构；需要全宽操作时使用 `block`，不要依赖按钮自动换行。

## 交互

- 点击按原生按钮语义触发；`type` 决定它是普通按钮、提交按钮还是重置按钮。
- `variant` 只改变材质与语义颜色：`primary` 为主操作，`secondary` 为次操作，`subtle` 为低强调操作，`danger` 为危险操作，`ghost` 为透明背景操作。
- `loading` 显示旋转加载图标，并把按钮置为原生 disabled；加载时不显示 `iconClass` 图标，也不接受点击。加载时根节点带 `aria-busy="true"`。
- `disabled` 或 `loading` 时显示禁用样式、不可聚焦操作；两者都为假时保留可见焦点环和按下反馈。
- 键盘行为由原生 `<button>` 提供：聚焦后可用 Enter 或 Space 触发。组件出现或消失不主动移动焦点。

## 数据

```ts
export type ButtonVariant = "primary" | "secondary" | "subtle" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonProps = {
    /** 视觉变体；默认 "primary" */
    variant?: ButtonVariant;
    /** 尺寸；默认 "md" */
    size?: ButtonSize;
    /** 是否占满父容器宽度；默认 false */
    block?: boolean;
    /** 是否禁用原生按钮；默认 false；与 loading 任一为 true 时不可操作 */
    disabled?: boolean;
    /** 是否显示加载态并禁用按钮；默认 false */
    loading?: boolean;
    /** 图标 CSS class；默认空字符串 */
    iconClass?: string;
    /** 原生 button type；默认 "button" */
    type?: "button" | "submit" | "reset";
};

type ButtonEmits = {};

type ButtonSlots = {
    /** 按钮的文字或自定义内容；可选 */
    default?: () => unknown;
};
```

组件没有声明 Vue emits；点击、键盘等原生事件通过根 `<button>` 的原生事件与 attribute 使用。没有 `expose` API。未声明的 attribute、`class` 与 `style` 按 Vue 默认行为落到根 `<button>` 上；slot 只有默认插槽，没有具名扩展口。

## 状态

- 默认：按 `variant`、`size` 渲染，可聚焦和点击。
- 禁用：`disabled` 为真时原生 disabled，降低透明度，不触发点击。
- 加载：显示 spinner，`aria-busy` 为 `true`，同时按禁用态处理；默认插槽文字仍保留，因此加载按钮仍有可读名称。
- 只读、出错、空数据：按钮没有统一的只读、出错或空数据状态；业务状态由父组件通过文字、`variant` 或 `disabled` 表达。

## 不支持

- 不支持内置确认、请求、表单校验或异步任务管理；`loading` 只是外观与交互锁定，不会自动完成或取消任何任务。
- 不支持自动生成可访问名称。若默认插槽为空且没有其它可用名称，调用方必须自行提供合适的内容或 attribute。
- 不支持同时显示加载 spinner 与 `iconClass`；加载态会优先使用 spinner。
