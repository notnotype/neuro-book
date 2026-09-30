---
标签: [state:local, env:portal, env:global, env:timer]
---

# Tooltip

为任意触发内容提供非交互式提示气泡，支持默认右侧或下方定位，并在空间不足时翻转到对侧。提示随触发内容而显示，不替代触发元素自身的可访问名称或命令说明。

## 布局与交互

默认插槽是唯一触发内容；第一项 VNode 会克隆并附加测量引用，提示可见时还会附加 `aria-describedby`。悬停在组件区域后等待 `showDelay` 再显示；焦点进入时立即显示。鼠标离开等待 `hideDelay` 后隐藏，焦点离开或点击时立即隐藏。窗口滚动、任意位置的 pointerdown 或 resize 也会立即关闭提示。提示不接收指针事件，宽度最多 220px，长文案单行截断。

初始按 `placement` 放在右侧或下方；空间不足时分别翻转到左侧或上方，并把位置限制在视口内，距离边缘至少 8px。组件出现和消失不转移焦点，也不提供 Escape 关闭行为；原触发元素继续管理自己的键盘交互。

## 数据

```ts
type TooltipPlacement = "right" | "bottom";

interface TooltipProps {
    /** 提示文字；必填。trim 后为空时不显示提示。 */
    text: string;
    /** 首选方向；默认 "right"，可选 "bottom"。定位时可自动翻转。 */
    placement?: TooltipPlacement;
    /** 鼠标悬停显示延迟（毫秒）；默认 300。聚焦显示不等待。 */
    showDelay?: number;
    /** 鼠标离开隐藏延迟（毫秒）；默认 100。 */
    hideDelay?: number;
}

type TooltipEmits = {};
interface TooltipSlots {
    /** 触发内容；第一项 VNode 接收测量引用与可见时的 aria-describedby。 */
    default?: () => unknown;
}
```

组件不 expose 方法或属性。根部是 `display: contents` 的 `<span>`，未声明 attribute、`class` 和 `style` 按 Vue 默认规则 fallthrough；触发 VNode 只额外获得组件生成的 `ref` 与 `aria-describedby`。若 slot 为空、首项不是 VNode 或首项无法成为实际 DOM 元素，定位能力不作保证。

## 状态与边界

提示文字为空白时不显示浮层。显示与位置状态保存在组件内，卸载前清理尚未触发的延时器。组件没有 disabled、loading 或错误状态；要让禁用按钮也能接收悬停提示，调用方应提供可接收指针事件的包裹元素。

不支持交互式浮层、点击触发、用户自定义内容浮层或可配置的左/上首选方向。提示文案不能承载触发控件缺失的可访问名称。

## 隐藏通道理由

- `env:portal`：提示通过 Teleport 渲染到离触发组件最近的主题宿主；找不到宿主时落到 `body`，避免 fixed 浮层受局部裁剪，同时优先继承产品主题变量。
- `env:global`：组件监听 window 的 scroll、pointerdown 与 resize 以立即关闭浮层；通过 VueUse 生命周期作用域自动解除监听。
- `env:timer`：悬停显示与离开隐藏使用可取消的 `setTimeout`，用于区分鼠标意图与焦点意图；离开焦点、点击和卸载时清理待执行延时。
- `state:local`：持有可见性、定位结果和延时器句柄，只在当前实例有效。
