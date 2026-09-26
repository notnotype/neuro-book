---
标签: [state:local, env:portal]
---

# Drawer

`Drawer` 是从屏幕边缘滑入的模态或非模态侧栏，支持四个方向、触发器、标题区、可滚动内容和可选页脚；与居中的 `Dialog` 相比，它保留主页面的空间方向关系，并可通过手势关闭。

## 布局与交互

内容通过 Reka Portal 呈现并带遮罩。`left`、`right` 方向占满视口高度，宽度为 380px 且最多为视口宽度的 90%；`top`、`bottom` 占满视口宽度，最大高度为 `85vh`。正文独立纵向滚动。提供 `title` 或 `header` 插槽时显示标题区；有 `footer` 插槽时显示底部操作区。`handle=true` 时在内容顶部显示拖动手柄。

`trigger` 插槽作为打开触发器。打开状态变化通过 `update:open` 通知父组件。关闭按钮只在标题区实际渲染时出现：既未传非空 `title`，也未提供 `header` 插槽时，组件不显示该按钮。拖动关闭、Escape、遮罩与焦点等交互由 Reka Drawer 管理；`modal=false` 时使用上游的非模态模式。

## 数据

```ts
type DrawerDirection = "top" | "bottom" | "left" | "right";

interface DrawerProps {
    /** 是否打开；可选，传入后为受控值；默认 undefined（非受控） */
    open?: boolean;
    /** 非受控模式的初始打开值；可选，默认 false */
    defaultOpen?: boolean;
    /** 滑入方向；可选，默认 "right" */
    direction?: DrawerDirection;
    /** 标题；可选，默认空字符串 */
    title?: string;
    /** 描述；可选，默认空字符串 */
    description?: string;
    /** 是否模态；可选，默认 true */
    modal?: boolean;
    /** 是否显示拖动手柄；可选，默认 false */
    handle?: boolean;
    /** 内容面板附加 class；可选，默认空字符串 */
    contentClass?: string;
}

interface DrawerEmits {
    /** Reka open 状态变化时发出 */
    (event: "update:open", value: boolean): void;
}

interface DrawerSlots {
    /** 可选触发器；按 Reka as-child 方式承载 */
    trigger?: () => any;
    /** 正文内容 */
    default?: () => any;
    /** 替换标题区内容；提供后仍显示标题区的关闭按钮 */
    header?: () => any;
    /** 可选页脚操作区 */
    footer?: () => any;
}
```

`open` 未提供时由 Reka 内部持有状态，`defaultOpen` 只决定初始值；`open` 提供后由父组件持有。组件没有 `expose` API。attrs 不属于稳定公共合同：唯一根是 Reka `DrawerRoot`，最终 DOM 落点由上游决定，不应依赖其透传位置。`contentClass` 是附加到 Drawer 内容面板的显式样式入口。

## 状态与边界

`modal` 默认开启，`handle` 默认关闭。即使 `title`、`description` 未传，正文仍可显示；空 `footer` 插槽不生成页脚。自定义 `header` 替换默认的标题与描述内容，调用方应自行提供适当的可访问标题语义。关闭图标当前没有显式 `aria-label`，使用时应确保宿主另有明确关闭途径。

## 上游边界

Reka UI 负责 Drawer 的打开状态、模态语义、Portal、遮罩、焦点与手势关闭。本组件承诺方向映射、面板尺寸、插槽结构和 `update:open` 事件；其余交互细节及 Reka 升级后的行为不属于本组件合同。

## 隐藏通道理由

`env:portal`：Drawer 内容与遮罩通过 Reka `DrawerPortal` 渲染，以脱离宿主的局部裁剪和层叠上下文。组件没有目标选择 prop；目标位置及目标缺失时的表现由 Reka 决定，当前组件及测试未核实其细节。
