---
标签: [state:inject]
---

# Banner

`Banner` 是区域或页面顶部的一条常驻横幅：满宽、平铺、无投影，用 `info`、`success`、`warning` 或 `error` 色调呈现一件持续存在的事（已断开正在重连、有新版本要刷新、正在用默认布局）。它与 `Notification` 的区别是不进队列、不自动消失，什么时候出现与收起由宿主决定。

## 布局与状态

紧凑排版（12px 字、上下 6px），放在面板、编辑组、页面顶部都不抢正文。从左到右是图标、标题与正文、可选的动作区（`actions` 插槽，放一个或几个按钮）、可选关闭按钮。图标缺省按色调取，`iconClass` 可以换成说明具体事情的图标（例如“重启后生效”用刷新图标），颜色仍跟色调。

文字至少留 12em：一行放不下文字加动作区时，动作区整组换到下一行，文字不被挤成一列；动作区换行后仍放不下时，按钮在区内再换行，不超出横幅；正文过长时在自己的列里换行。只有一层底边线，没有圆角与投影：它是容器顶部的一节，不是浮在上面的卡片。几条横幅可以上下叠放，各自带底边线。

`error` 色调的根节点是 `role="alert"`（出现时读屏立刻播报），其余是 `role="status"`。组件没有禁用、加载或错误覆盖态。

## 数据

```ts
type BannerTone = "info" | "success" | "warning" | "danger";

interface BannerProps {
    /** 色调；默认 "info" */
    tone?: BannerTone;
    /** 标题；默认空字符串 */
    title?: string;
    /** 正文；默认空字符串 */
    message?: string;
    /** 换掉按色调取的图标；默认空字符串，即按色调取 */
    iconClass?: string;
    /** 是否显示关闭按钮；默认 false */
    dismissible?: boolean;
    /** 关闭按钮的可访问名称；缺省按界面语言取（中文 "关闭"） */
    closeLabel?: string;
}

interface BannerEmits {
    /** 点击关闭按钮；不会自行隐藏 */
    (event: "dismiss"): void;
}

interface BannerSlots {
    title?: () => any;
    default?: () => any;
    /** 动作区：放 nb-ui Button 等按钮；省略则没有动作区 */
    actions?: () => any;
}
```

插槽优先于对应文字。`dismiss` 只发事件，宿主负责收起横幅；动作区里的按钮由宿主自己接事件。没有 `expose` API；未声明的 attrs 落到根 `div`。

## 隐藏通道理由

`state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取关闭按钮的缺省可访问名称，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `closeLabel` 时以属性为准，不读端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。
