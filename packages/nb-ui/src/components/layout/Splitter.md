---
标签: [state:local, state:inject, env:global]
---

# Splitter

**冻结**：只给 nb-story、dev-panel 用，只修不加。新代码用 `@notnotype/nb-layout/vue` 的 `Splitter`，w00026 t14 迁移后删除这一份。

`Splitter` 把一组面板沿单一轴排列，并提供可拖动、可键盘调整的分隔线。它支持独立分配尺寸，也能作为 Grid 分支的受控呈现层；面板尺寸统一使用 CSS px，不在百分比与像素之间往返换算。

## 布局

根容器铺满父级并裁切溢出。`direction="horizontal"` 时面板沿宽度排列、分隔线为竖向；`vertical` 时沿高度排列、分隔线为横向。每块面板占满交叉轴并裁切自身溢出，内容由对应 `panel-<id>` 插槽提供。无面板时只呈现默认插槽。分隔线占用独立 sash 尺寸；静止可见接缝为 1 CSS px（颜色取 `--nb-splitter-seam`，缺省 `--divider`，宿主可在祖先上改，例如设成透明；沿长轴两端的缩进取 `--nb-splitter-seam-inset`，缺省 0，设了就是两端不碰到头的开放式分割线），交互装饰线不参与布局。静止接缝的近端边对齐设备像素，让 1px 线是实的；装饰线按设备像素对齐只改装饰层，不移动 separator 的命中盒，也不改面板布局。装饰带最厚 3px，按相邻面板与 sash 的可用空间夹紧：收起边界上相邻面板是 0px，装饰带贴边向内移，不会被祖先的裁切变细。窄屏不自动堆叠，宿主应提供适合方向与尺寸的承载空间。

## 交互

分隔线使用 `role="separator"`，提供与相邻面板关联的 `aria-controls`、方向、当前值、最小/最大值和像素文本。可聚焦分隔线响应主轴方向键，每步 10px，Shift 调整 1px；Home / End 移到可行范围端点，Enter 切换相邻可收起面板。按键抬起时提交该次键盘会话。Escape 取消会话；窗口失焦、浏览器夺走指针捕获、外部约束/身份/方向变化或卸载也会取消而不提交；分隔线失去焦点时结束键盘会话。一次手势的基线在开始时捕获，一次指针操作或一次键盘连发只结束一次。手势进行中宿主重发相同的尺寸或收起状态（预览每帧都会重发）不会取消手势，只有面板身份、上下界、分配策略或收起策略变化才作废它。

指针按下开始拖动后，移动预览随手势更新，松开后提交一次。细指针命中带外扩 5px，触摸粗指针为 15px；相交候选最多同时选一条宽度轴和一条高度轴，但独立 Splitter 只有一个方向。悬停、光标、按下和装饰线高亮读同一份命中结果。悬停命中立即改变 resize 光标，停留 250ms 后才显示装饰线，离开时淡出（时长 `--motion-fast`）；拖动或键盘聚焦时装饰线立即显示。减少动效时保留停留延迟，只去掉淡入淡出。装饰线的样子取主题 token：线芯颜色 `--sash-line-color`、厚度 `--sash-line-size`（缺省 3px 铺满装饰带；更细时对齐静止接缝）、圆角 `--sash-line-radius`、发光 `--sash-line-glow`；长轴两端按 `--sash-line-inset` 缩进，`sashLineEnds` 指到的那条外层线也亮着时这一端不缩、连着它。禁用状态与 0px sash 不可交互。`collapse` 配置允许边界拖动越过阈值后吸附至收起尺寸，并在反向越过恢复阈值时恢复；状态随 `panels` 配置输入，不由组件另存。拖动按“按下时的基线加累计位移”求出理想边界，吸附只改约束、不用记忆尺寸重新定位，所以同一个指针位置永远对应同一个状态：低于最小尺寸再往里一个阈值（缺省 24px）时吸附到 `collapsedSize`，回到 `max(最小尺寸, collapsedSize + 恢复阈值)` 且容量允许时展开。`restoreSize` 只服务 `Enter` 与按钮的显式恢复；恢复空间不足时保持收起并给诊断。`collapse.toggleable` 为 false 的面板只经拖动收起与展开，分隔条上的 `Enter` 跳过它。

## 数据

```ts
import type {SashCollapseState} from "./grid-types";
import type {SplitterGestureCancellation, SplitterGestureState} from "./splitter-gesture";

type SplitterPanelConfig = {
    /** 面板身份；省略时按顺序生成 panel-<index>。 */
    id?: string;
    /** 初始主轴 CSS px；独立未受控分配时使用。 */
    defaultSizePx?: number;
    /** 主轴最小 CSS px；默认 0。 */
    minSizePx?: number;
    /** 主轴最大 CSS px；默认不限制（仍受容器容量限制）。 */
    maxSizePx?: number;
    /** 分配策略；默认 "weight"，按比例分配余量；"fixed" 优先保留该配置的像素目标。 */
    sizing?: "fixed" | "weight";
    /** 收起策略与当前状态；省略时不可收起。 */
    collapse?: SashCollapseState;
};

type SplitterProps = {
    /** 排列方向；默认 "horizontal"（左右分栏）。 */
    direction?: "horizontal" | "vertical";
    /** 禁止手势；默认 false。 */
    disabled?: boolean;
    /** 面板配置，顺序决定面板与插槽顺序；默认空数组。 */
    panels?: SplitterPanelConfig[];
    /** 每条边界主轴占用 CSS px；缺项默认 1px，多余项忽略。 */
    sashSizes?: readonly number[];
    /** 受控呈现尺寸，须与 panels 等长，单位 CSS px 且不含 sash；默认未提供，本地按 defaultSizePx 分配。 */
    sizesPx?: readonly number[];
    /** 所属 Grid 的分支 id；独立使用时省略。用于分隔线身份；默认 "panels"。 */
    branchId?: string;
    /**
     * Grid 内部用：分隔线沿长轴两端挨着的外层分隔线键（`<branchId>:<index>`），挨着容器边缘为 null；默认两端都是 null。
     * 那条线也亮着时这一端连着（T 形交汇），否则按 `--sash-line-inset` 缩进。
     */
    sashLineEnds?: {start: string | null; end: string | null};
};

type SplitterEmits = {
    /** 独立未受控模式下，本地分配尺寸发生变化时发出；受控模式不发。 */
    (event: "layout", sizesPx: readonly number[]): void;
    /** 一次指针或键盘会话开始时发出。 */
    (event: "gesture-start", state: SplitterGestureState): void;
    /** 手势预览尺寸变化时发出。 */
    (event: "gesture-update", state: SplitterGestureState): void;
    /** 有真实变化的会话提交时发出最终尺寸；无变化不发。 */
    (event: "gesture-end", state: SplitterGestureState): void;
    /** 取消会话时发出来源、分隔线 id 与取消原因。 */
    (event: "gesture-cancel", info: SplitterGestureCancellation): void;
};

type SplitterSlots = {
    /** 按 panel id 提供 panel-<id> 插槽；id 省略时使用 panel-<index>，作用域提供当前配置与序号。 */
    [name: `panel-${string}`]: (props: {panel: SplitterPanelConfig; index: number}) => unknown;
    /** 只有 panels 为空数组时显示。 */
    default(): unknown;
};
```

`SplitterGestureState` 包含 `source: "pointer" | "keyboard"`、活动 sash 标识、主动与补偿面板 id 列表、按 `panels` 顺序的 `sizesPx` 和发生变化的 `collapsed` 状态映射。取消原因是 `"no-change" | "escape" | "pointercancel" | "blur" | "unmount" | "context-changed"`。

`sizesPx` 存在且长度与 `panels` 一致时为受控呈现；尺寸由宿主传入，手势期间发出的新尺寸只作为事件，不回写 prop。否则组件自行分配并在本地更新手势预览；结束后通过 `gesture-end` 报告最终尺寸，宿主如需持久化须更新尺寸 prop。`layout` 事件在本地尺寸因承载盒或配置重新分配时发出。

每个面板插槽作用域为 `{panel, index}`。没有插槽或 expose API；未声明 attrs 按 Vue 默认行为落到根 Splitter 容器。

## 状态与边界

- 默认 `horizontal`、启用交互、空 `panels`；没有 panels 时显示默认插槽。
- 每条 sash 默认 1px；非有限或负数尺寸会警告并回退 1px，多余尺寸会警告并忽略。0px sash 仍表示布局边界，但没有命中、Tab 停靠或装饰线。
- 本地分配按默认尺寸、min/max 与 fixed/weight 策略分配面板空间；sash 占用不计入 `sizesPx`。发布的受控尺寸长度不匹配时走本地分配路径。
- 禁用时不进入手势且 separator 不可聚焦；面板内容状态完全由宿主负责。
- 组件不写任何存储，没有按 id 自动保存尺寸的能力；要持久化，宿主据 `gesture-end` 的结果自己存。
- 手势状态里的 `active` 只含 sash 两侧相对基线真正改变尺寸的面板；相邻面板触界而没变时不算主动。被推着让出空间、不在 sash 两侧的远端兄弟记在 `compensated`。
- 空面板由默认插槽承担；组件不提供加载或错误状态。

## 隐藏通道理由

- `state:local`：独立模式的当前分配、拖动预览、折叠过渡与手势 scope 属于本实例；卸载即丢弃。Grid 受控模式的布局事实仍在宿主。
- `state:inject`：可选读取外层 `NestedGrid` 提供的 sash scope，使 Grid 内各 Splitter 共用一场跨分支手势；没有提供方时回退为本地 scope。由树级 scope 仲裁交叉命中并一次提交，比各分支独立提交能保持同一手势的几何一致。
- `env:global`：手势 composable 在窗口和文档监听 blur、scroll、resize 与 Escape，并在手势根监听指针捕获事件；窗口尺寸/滚动还会触发设备像素对齐重算。手势结束或组件卸载时均解除监听，不留下常驻监听。
- `state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取分隔线的可访问名称与取值文字（“已收起”“N 像素”），语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。这两项没有对应的属性，固定走端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。

## 上游边界

本组件负责单轴面板分配呈现、separator 无障碍属性及 `layout`/`gesture-*` 事件。拖动求解、边界命中、嵌套 scope 仲裁与取消时序由共享的 sash gesture 与 splitter session 模块提供。组件不负责 Grid 树意图或宿主持久化。
