---
标签: [state:local, env:portal, env:global]
---

# DropFeedbackOverlay

`DropFeedbackOverlay` 把宿主已经算好的拖放预览几何画在页面视口上，供编辑器与工作区等不同宿主共用。它只渲染形状、提示文案和一处礼貌播报区域；落点判断、业务种类、提交与文案翻译仍归宿主。

## 布局与交互

有效反馈以 Teleport 放到 `body` 下，覆盖整个 viewport，固定定位且 `pointer-events: none`，不会挡住拖放目标。半区、插入线和条目形状使用传入的 viewport client 坐标。半区四边按 `min(6px, 尺寸/4)` 内缩；插入线只沿长轴两端按 `min(2px, 长轴/4)` 内缩，厚度与插入边界保留原值。有效半区存在时不再绘制插入线，避免把一个落点读成两个；独立条目矩形不内缩。内缩只进绘制盒，命中、序位与提交都用宿主给的原始矩形。

非空标签放在有效几何旁：锚点优先级为半区、条目、插入线。足够大的半区中标签居中；否则先尝试放在锚点下方，空间不足时放到上方，并夹在 viewport 内侧 8px。只有插入线、且 `labelAt` 为 `line-end` 时，标签的末端贴线的末端（横线的右端、竖线的下端），中线压在线上，不盖住线下方的一行。标签尺寸由元素实测；文案、图标或视口变化会重新测量，纯坐标变化复用测量结果。`armed: false` 只把半区反馈淡化到 35%，不改变几何。半区及其居中提示首次出现按 `--motion-fast`、`--ease-layout` 淡入。连续换区保留同一节点，半区的 left/top/width/height 与提示的 left/top 按 `--motion-base`、`--ease-layout` 过渡（比控件形变快：指针换了落点，反馈要跟得上），文案立即更新，不重放淡入。过渡只影响 fixed 装饰盒，不改变命中、提交或正文布局。插入线即时定位，取消时立即卸载，没有离场残留。系统启用减少动效时取消这些过渡。

区域和条目是 1px `--drop-area-border` 描边、`--drop-area-fill` 底色、`--radius-control` 圆角加 `--elevation-raised`，深浅由主题定。插入线是 `--accent-main` 实色，`--radius-pill` 圆角，带一圈同色光晕；线盒厚度由几何入口给出，是 2px，与 sash 装饰线的 3px 规则无关。

公共标记：覆盖层根是 `data-drop-feedback`，其下按形状分别带 `data-drop-feedback-area`（另有 `data-drop-armed`）、`-line`、`-entry`、`-label`、`-live`。attrs 透传到覆盖层根；落点种类、轴、并入数量一类业务语义由调用方写成 `data-*`。

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
    /** 只有插入线时标签放在哪：缺省 "below"（线的下方居中）；"line-end" 贴线的末端。 */
    readonly labelAt?: "below" | "line-end";
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

几何入口在 `@notnotype/nb-layout`，宿主用它们算出 `DropFeedbackPreview`：

- `resolveGridInsertion` 沿目标容器的主轴求落点。每个可见成员前、后各 20% 是插入带（`edgeRatio` 可改，须大于 0 且不超过 0.5；0.5 表示前后各一半，没有中央区，中点归后半），返回插入位、`targetId`（指针落在的那一叶）和 `halfRect`（该叶对应的半区）。中央返回 `keep`，只有整片叶的区域，没有锚点与插入线，释放时也不提交；是否呈现 `keep` 由宿主决定。叶间的间隙归后一叶，非末叶的后缘仍归它自己。
- `resolveListInsertion` 给列表的插入位，一个位置一条线：前一项的后半、间隙、后一项的前半都归同一个位置，线在间隙里居中，没有足够间隙时贴后一项的前缘。越过最后一个可用成员是追加，线贴它的后缘；空列表锚在内容盒前缘。可选 `edgeGap`（缺省 0）只给首个可见成员之前和末个之后留白，内部间隙不变，空列表不偏移；空间不足时夹紧，负数或非有限值按 0。
- `resolveGridEdgeDrop` 给四边与中心的落点。

`GridDropRect` 为 `Readonly<{left: number; top: number; right: number; bottom: number}>`；`GridOrientation` 为 `"horizontal" | "vertical"`。组件没有插槽或 expose API。`inheritAttrs` 被关闭；`useAttrs()` 收集的 attrs 被显式透传到 Teleport 下的覆盖层根节点，包括调用方的 `data-*` 标记。根节点不存在时没有 attrs 挂载目标。

## 状态与边界

- `preview` 为 `null`、所有矩形均为零面积或含非有限坐标时不渲染覆盖层；每个有效矩形独立呈现，不会被另一个无效矩形连带隐藏。
- 视口尺寸为零时保留形状与播报，但不渲染提示标签；视口窄于标签时按零边距夹紧。
- 空白 `label` 不显示提示药丸，播报文本为空。
- 组件只读 props，不提交布局，也不读写业务数据或网络。
- 宿主使用须知：
  - 接入合同是“显示落点、释放提交”：宿主先定义来源、目标与原子提交意图，纯解析器一次返回动作与预览，宿主只在释放时提交；不要用边拖边改 DOM 顺序的乐观排序代替。
  - 一场手势只发布一个落点、一份反馈；同一个插入位只有一个线坐标。指针停住时滚动或尺寸变化仍要重算；释放时按最终坐标再验证，只提交最后显示的同一个动作，失效的锚点不能悄悄退化成末尾。
  - 登记落点成员时用真实元素的可见 client 矩形，并检查浮层遮挡；拖动反馈与占位节点要过滤掉，不当作排序成员。
  - 区域框、线宽、提示标签和几何过渡都用本组件，不另写业务私有的；只需要一个静态提示药丸时直接用 `DropIndicatorLabel`。
  - 每个宿主自己定取消条件；手势停止、失焦、切换工作面、结构失效和卸载时，要清掉帧、监听与观察器。

## 隐藏通道理由

- `state:local`：组件持有标签尺寸测量缓存、viewport 尺寸与最近播报文案，只服务本次覆盖层布局；卸载后丢弃。
- `env:portal`：预览坐标来自 viewport client 几何，且覆盖层必须避开祖先的 transform、backdrop-filter、contain 与裁切上下文，所以渲染到 `body`。Teleport 目标固定为 `body`，不由调用方改写；该目标缺失时沿用 Vue Teleport 的行为，不创建替代目标。
- `env:global`：读取 `window.innerWidth/innerHeight` 作为 viewport 边界，并通过 `ResizeObserver` 测量覆盖层根与提示标签的实际尺寸；观察目标随渲染切换重新同步，卸载时断开。该依赖只服务定位与防溢出，不用于业务状态。
