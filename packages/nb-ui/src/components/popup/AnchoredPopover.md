---
标签: [state:inject, env:portal]
---

# AnchoredPopover

`AnchoredPopover` 是贴在任意锚点（元素或一段选区的矩形）旁边的浮层，不抢焦点：打开、关闭都不移动焦点，点外面也不关闭，开关由宿主决定。选区浮动菜单这类“跟着光标或选区、用户还在别处输入”的界面用它。与 `Popover`（点触发器打开、焦点进入）和 `SuggestionMenu`（候选列表）不同，它只给外框，内容由默认插槽提供。

## 布局

外框是浮层共用的 `.nb-ui-popover-surface`，宽高随内容，不给内边距。定位经 reka 的 Popover 原语（底下是 floating-ui），传送到 `body`，碰到窗口边时翻到另一侧并夹进窗口（留 8px）。打开期间每帧重新读一次锚点矩形，选区移动、容器滚动、窗口缩放都跟得上；关闭或卸载后不再读。

层级在 `Dialog` 或浮动窗口里跟随它们注入的层级，不在里面时取普通页面的浮层层级（`state:inject`）。

## 交互

- 在浮层里按下指针不夺走焦点（`mousedown` 默认动作被阻止），只有能接收焦点的元素（输入框等）照常接收。
- 不处理 Escape 与点外面，由宿主决定。外框没有 `role`：角色由插槽内容决定（例如 `Toolbar`）。

## 数据

```ts
type AnchoredPopoverProps = {
    open: boolean;
    /** 元素，或 `{getBoundingClientRect, contextElement?}`；为 null 时不显示。 */
    anchor: Element | {getBoundingClientRect: () => DOMRect; contextElement?: Element} | null;
    /** 偏好的一侧；缺省 "top"。放不下时翻到另一侧。 */
    side?: "top" | "bottom";
    /** 与锚点的距离；缺省 8。 */
    sideOffset?: number;
};

type AnchoredPopoverSlots = {
    default?: () => unknown;
};
```

外露方法 `contains(node)`：节点是否在浮层里（浮层传送出去了，不在宿主的 DOM 里）。

## 状态

只有开与关。`open` 为真且 `anchor` 不为 null 时显示。

## 不支持

不管理开关；没有箭头；不限制宽高，内容过宽由宿主处理。
