---
标签: [state:local]
别名: ["视图框", "View Frame"]
---

# WorkbenchViewFrame

一个视图实例在分节里的全部可见形态：视图所属入口还没交付、受阻、启动失败或已停止时原位显示原因；交付了在加载时显示占位；`load()` 失败给“重新加载”，组件渲染出错给“重试”；正常时渲染视图组件并把 `context` 交给它（[`workbench/views.md`](../../../../../../../docs/specs/workbench/views.md) 输出 2–6）。三种失败各有各的按钮，互不顶替。

它把视图组件包在一个错误边界里：边界只接住 Vue 调用路径上的错误，接住后发 `render-error`，不让错误冒到外壳；组件自己发起的异步错误归它所属的插件。

## 布局

填满分节的内容区。状态说明居中、可换行。视图组件按声明的 `layout`：`scroll` 包在 nb-ui `ScrollArea` 里并留内边距（滚动由这里负责），`fill` 占满、自己滚动。滚动盒在这里而不在分节：视图移动时分节会在新容器里重建，滚动盒随实例一起搬动，滚动位置才留得住。

## 交互

- `entry-failed` 的“重试”发 `retry-entry`；“重新加载”发 `reload`；“重试”（渲染出错）发 `retry-render`。按钮在 `busy` 时禁用，避免重复发起。
- 视图组件以 `generation` 作 key：宿主给了新代际就卸掉旧实例、建新实例。

## 数据

```ts
import type {Component} from "vue";
import type {ViewContext} from "../contracts";
import type {ViewDelivery} from "../views/registry";
import type {DisplayLocale} from "nbook/shared/localized-text";

type ViewFrameStatus = "waiting" | "loading" | "ready" | "load-failed" | "render-failed";

type Props = {
    viewId: string;
    locale: DisplayLocale;
    /** 视图声明的内容布局。 */
    layout: "scroll" | "fill";
    /** 交付状态；不是 available 时只显示它，不看 status。 */
    delivery: ViewDelivery;
    status: ViewFrameStatus;
    /** 加载或渲染失败的摘要；没有失败为 null。 */
    error: string | null;
    /** status 为 ready 时的组件定义。 */
    component: Component | null;
    /** status 为 ready 时交给组件的上下文。 */
    context: ViewContext | null;
    generation: number;
    /** 一次重试进行中；默认 false。 */
    busy?: boolean;
};

type Emits = {
    (event: "retry-entry"): void;
    (event: "reload"): void;
    (event: "retry-render"): void;
    /** 错误边界接住了组件的渲染错误；带上出错实例的代际，宿主据此丢弃过期的报告。 */
    (event: "render-error", generation: number, message: string): void;
};
```

没有 slot、没有 expose；attrs 落在根上。根带 `data-view-frame`（视图 id）、`data-view-state`（交付状态或实例状态）、`data-view-generation` 与 `data-view-layout`。

## 状态

见上：七种形态由 `delivery` 与 `status` 决定。内部状态只有错误边界。

## 不支持

不加载组件、不决定代际、不读写任何状态；组件的异步错误不接。
