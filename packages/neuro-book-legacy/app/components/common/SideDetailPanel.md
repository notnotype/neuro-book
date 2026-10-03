---
标签: [state:local, env:global]
---

# SideDetailPanel

可由宿主控制显隐和高度的底部详情面板，提供统一标题栏、收起/展开、关闭与顶部拖拽调高能力。它只负责面板壳和高度手势，标题、操作区及详情内容均由调用方通过插槽填入。

## 布局与交互

面板沿宿主容器宽度铺开，由固定 44px 标题栏与可滚动正文组成；标题栏始终保留，正文占剩余高度并在内容超出时独立纵向滚动。顶部有横跨面板的拖拽手柄。最大高度为客户端视口高度的 90%；SSR 阶段的拖拽上限回退为 280px。390×844 下仍使用全宽面板，正文内部滚动，不设置固定最小宽度。

点击标题区域或收起按钮会在“44px 标题栏高度”和最近一次大于 44px 的展开高度之间切换；初始恢复高度为 280px。拖动顶部手柄调整面板高度，结束时发出新的高度。关闭按钮只发出 `close`，不会自行修改 `visible`。`visible` 为假时整个面板从 DOM 移除。

## 数据

```ts
interface SideDetailPanelProps {
    /** 是否渲染面板；必填，父级控制。 */
    visible: boolean;
    /** 当前面板高度；必填、受控，44px 及以下显示为 44px 标题栏。 */
    height: number;
    /** 面板根元素附加 class；默认空字符串。 */
    panelClass?: string;
    /** 可滚动正文区域附加 class；默认空字符串。 */
    bodyClass?: string;
}

interface SideDetailPanelEmits {
    /** 拖拽结束或点击展开/收起时发出建议高度；父级负责回写。 */
    (e: "update:height", value: number): void;
    /** 用户点击关闭按钮时发出。 */
    (e: "close"): void;
}

interface SideDetailPanelSlots {
    /** 正文内容；随面板高度滚动。 */
    default?: () => unknown;
    /** 标题栏左侧；点击该区域同样展开或收起。 */
    header?: () => unknown;
    /** 标题栏右侧的自定义操作。 */
    actions?: () => unknown;
}
```

组件持有拖拽中状态与最近展开高度，除此之外不持有业务数据。没有 expose API。未声明 attribute、`class` 和 `style` 按 Vue 单根元素默认 fallthrough；slots 内容不由组件解释。

## 状态与边界

- 默认：由宿主提供 `visible` 和 `height`；`height <= 44` 时正文隐藏，但标题栏仍在。
- 收起/展开：受控高度写回给宿主，父级更新 `height` 后面板呈现相应结果。
- 隐藏：`visible=false` 时不渲染，也不保留面板内 DOM；再次显示时最近展开高度仍由当前实例的本地记录决定。
- 禁用、只读、加载中、出错和空数据：组件没有这些业务状态，均由插槽内容呈现。

不支持自动保存高度、键盘拖拽调整、独立移动位置或为正文内容提供滚动状态事件。

## 隐藏通道理由

- `state:local`：本地记录拖拽中状态与最近一次展开高度，用于同一实例内收起后恢复，不写入共享状态或浏览器存储。
- `env:global`：拖拽尺寸通过 `useResizablePanel` / VueUse 指针手势跟踪完成；监听只服务进行中的拖拽，手势结束或作用域销毁后由依赖清理。
