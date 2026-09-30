---
标签: [state:local, env:portal, env:global]
---

# DropFeedbackOverlay

`DropFeedbackOverlay` 把宿主已经算好的拖放预览几何画在页面视口上，供编辑器与工作区等不同宿主共用。它只渲染形状、提示文案和一处礼貌播报区域；落点判断、业务种类、提交与文案翻译仍归宿主。

## 布局与交互

有效反馈以 Teleport 放到 `body` 下，覆盖整个 viewport，固定定位且 `pointer-events: none`，不会挡住拖放目标。半区、插入线和条目形状使用传入的 viewport client 坐标。半区四边按 `min(6px, 尺寸/4)` 内缩；插入线只沿长轴两端按 `min(2px, 长轴/4)` 内缩，厚度与插入边界保留原值。有效半区存在时不再绘制插入线，避免把一个落点读成两个；独立条目矩形不内缩。

非空标签放在有效几何旁：锚点优先级为半区、条目、插入线。足够大的半区中标签居中；否则先尝试放在锚点下方，空间不足时放到上方，并夹在 viewport 内侧 8px。标签尺寸由元素实测；文案、图标或视口变化会重新测量，纯坐标变化复用测量结果。`armed: false` 只把半区反馈淡化到 35%，不改变几何。形状出现时半区淡入，连续更换目标时半区与随行标签过渡；插入线即时定位。系统启用减少动效时取消这些过渡。

遮罩根内另有 `aria-live="polite"`、`aria-atomic="true"` 的隐藏区域，只播报 trim 后的标签文案，不随几何逐帧播报。焦点和拖放手势由宿主保持。

## 数据

```ts
import type {GridDropRect} from "./grid-drop";
import type {GridOrientation} from "./grid-types";

type DropFeedbackPreview = Readonly<{
    /** 内容落点半区或空容器内容盒；无此形状时为 null。 */
    readonly areaRect: GridDropRect | null;
    /** 切换器条目高亮盒；无此形状时为 null。 */
    readonly entryRect: GridDropRect | null;
    /** 插入线盒；无此形状时为 null。 */
    readonly indicator: GridDropRect | null;
    /** 目标容器主轴；决定插入线的长短轴。 */
    readonly orientation: GridOrientation;
    /** false 表示预览保留但当前不可提交；默认按可提交呈现。 */
    readonly armed?: boolean;
}>;

type DropFeedbackOverlayProps = {
    /** 当前几何预览；必填，null 或没有任何有效矩形时不渲染覆盖层。 */
    preview: DropFeedbackPreview | null;
    /** 提示与播报文案；必填。trim 为空时不显示标签并清空播报。 */
    label: string;
    /** 提示图标 CSS class；默认不渲染图标。 */
    iconClass?: string;
};

type DropFeedbackOverlayEmits = Record<never, never>;
type DropFeedbackOverlaySlots = Record<never, never>;
```

`GridDropRect` 为 `Readonly<{left: number; top: number; right: number; bottom: number}>`；`GridOrientation` 为 `"horizontal" | "vertical"`。组件没有插槽或 expose API。`inheritAttrs` 被关闭；`useAttrs()` 收集的 attrs 被显式透传到 Teleport 下的覆盖层根节点，包括调用方的 `data-*` 标记。根节点不存在时没有 attrs 挂载目标。

## 状态与边界

- `preview` 为 `null`、所有矩形均为零面积或含非有限坐标时不渲染覆盖层；每个有效矩形独立呈现，不会被另一个无效矩形连带隐藏。
- 视口尺寸为零时保留形状与播报，但不渲染提示标签；视口窄于标签时按零边距夹紧。
- 空白 `label` 不显示提示药丸，播报文本为空。
- 组件只读 props，不提交布局，也不读写业务数据或网络。

## 隐藏通道理由

- `state:local`：组件持有标签尺寸测量缓存、viewport 尺寸与最近播报文案，只服务本次覆盖层布局；卸载后丢弃。
- `env:portal`：预览坐标来自 viewport client 几何，且覆盖层必须避开祖先的 transform、backdrop-filter、contain 与裁切上下文，所以渲染到 `body`。Teleport 目标固定为 `body`，不由调用方改写；该目标缺失时沿用 Vue Teleport 的行为，不创建替代目标。
- `env:global`：读取 `window.innerWidth/innerHeight` 作为 viewport 边界，并通过 `ResizeObserver` 测量覆盖层根与提示标签的实际尺寸；观察目标随渲染切换重新同步，卸载时断开。该依赖只服务定位与防溢出，不用于业务状态。
