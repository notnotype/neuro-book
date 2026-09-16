---
标签: [state:local, env:global]
---

# Splitter

`Splitter` 把一块容器按水平或垂直方向切成多栏，栏与栏之间是可拖拽、可键盘调整的 sash（分隔条），
每一栏的内容由宿主通过插槽提供。它是领域无关的布局原语：宿主给面板身份与尺寸约束，自己决定这份尺寸从哪里来、
存到哪里去。与其他分栏实现的区别在于它把事件分成两层——`layout` 说明**现在长什么样**（渲染与几何同步用），
`gesture-*` 说明**用户这次调整想要什么**（一次保存最终意图用）。两者不互相替代：程序改动、约束变化和视口重算
只发 `layout`，永远不冒充用户提交。

## 布局

组件由 Reka 的 `SplitterGroup` 承载，内部按传入的 `panels` 顺序交替渲染面板与 sash：`[面板 0][sash][面板 1][sash]…`。
每一栏是 flex 轨道，尺寸由 Reka 按约束分配，容器总尺寸守恒（含 1px 的分隔条占用）。
面板自身是 `overflow-auto` 的滚动容器，滚动归属在各栏内部，不产生页面级滚动。

`sash` 的主轴占用默认 1px，也可由宿主按边界传入实际像素；命中热区总宽 10px，即从中心向两侧各扩约 5px，
悬停、聚焦和拖拽中点亮品牌色胶囊指示器。零像素 sash 不占布局、不参与指针命中、不可键盘操作且退出 Tab 顺序。拖动过程不动态改变盒模型。

`390×844` 下结构与桌面一致：栏宽按传入约束压缩，三栏并排到无法阅读由宿主决定改成抽屉或单栏（组件不做响应式重排）。

## 交互

- 指针：在 sash 或其 10px 热区内按下即开始调整，移动过程中实时改变几何，松开指针结束。一次按下到松开算一次用户操作。
- 键盘：焦点落在 sash 上时，`ArrowLeft` / `ArrowRight` / `ArrowUp` / `ArrowDown` 按 10% 步长调整，`Home` / `End` 拉到两端，
  `Shift` + 方向键按 100% 幅度调整；可折叠面板用 `Enter` 折叠或恢复。`F6` / `Shift+F6` 在组内 sash 之间移动焦点，不属于调整。
  按键连发跨多次 `keydown` 仍是一次手势，`keyup` 或手柄失焦结束。
  调整进行中不重复触发 `Enter` 折叠；非可折叠面板按 `Enter` 会开始并以 `no-change` 取消空手势，不产生保存意图。
- 取消：调整过程中按 `Escape`、指针被系统取消（`pointercancel`）、指针调整时窗口失焦、组件卸载，或面板身份、约束、
  sash 几何、方向、禁用发生变化，都会结束手势且**不产生保存意图**；键盘调整失焦按正常结束收口。已经发生的几何变化留在原语里，由宿主决定是否回滚。用户碰了 sash 但布局没有变化时同样不提交。
- 焦点：sash 在正常 Tab 顺序内并可聚焦；组件出现与消失不主动搬动焦点。
- 禁用：`disabled` 时 sash 不接受指针与键盘调整，也不产生任何手势事件。

## 数据

```ts
type SplitterPanelConfig = {
    /** 面板稳定身份；缺省时按序号派生 panel-<index>。DOM id 会增加实例命名空间 */
    id?: string;
    /** 初始尺寸（百分比）；缺省由 Reka 均分剩余空间 */
    defaultSize?: number;
    /** 最小尺寸（百分比）；缺省 0 */
    minSize?: number;
    /** 最大尺寸（百分比）；缺省 100 */
    maxSize?: number;
    /** 触界时是否折叠 */
    collapsible?: boolean;
    /** 折叠后的尺寸（百分比）；缺省 0 */
    collapsedSize?: number;
};

type SplitterProps = {
    /** 分栏方向；默认 horizontal */
    direction?: "horizontal" | "vertical";
    /** 透传给 Reka 的 localStorage 自动保存键；默认不启用（本原语的手势合同不依赖它） */
    autoSaveId?: string;
    /** 禁用全部 sash 调整；默认 false */
    disabled?: boolean;
    /** 面板定义；默认空数组，此时渲染默认插槽 */
    panels?: SplitterPanelConfig[];
    /** 按面板间边界顺序声明 sash 主轴占用像素；缺项默认 1px */
    sashSizes?: readonly number[];
};

type SplitterGestureSource = "pointer" | "keyboard";

type SplitterGestureCancelReason =
    | "no-change"        // 正常结束但没有改变任何尺寸：没有可保存的意图
    | "escape"           // 用户按 Escape
    | "pointercancel"    // 指针被系统取消
    | "blur"             // 窗口在指针调整中失焦
    | "unmount"          // 组件卸载
    | "context-changed"; // 面板身份 / 约束 / sash 几何 / 方向 / 禁用变化使当前手势失效

type SplitterGestureState = {
    source: SplitterGestureSource;
    /** 主动操作的 sash 稳定 id，形如 outline~editor；只在当前 Splitter 实例内标识 */
    sash: string;
    /** sash 两侧相对 baseline 实际改变尺寸的面板；触界未变化的候选不在其中 */
    active: string[];
    /** 尺寸被动变化、且不在 sash 两侧的兄弟面板 */
    compensated: string[];
    /** 当前尺寸百分比，顺序与 layout 事件一致 */
    sizes: number[];
};

type SplitterGestureCancellation = {
    source: SplitterGestureSource;
    sash: string;
    reason: SplitterGestureCancelReason;
};

type SplitterEmits = {
    /** 布局发生变化（挂载注册、用户调整、约束变化、视口重算都会触发），携带按面板顺序的尺寸百分比 */
    (event: "layout", sizes: number[]): void;
    /** 用户开始调整：baseline 已捕获，携带开始时的尺寸 */
    (event: "gesture-start", state: SplitterGestureState): void;
    /** 调整过程中几何变化：可按帧渲染，但不要逐帧持久化 */
    (event: "gesture-update", state: SplitterGestureState): void;
    /** 调整正常结束且尺寸确实变了：这是唯一需要保存的最终意图 */
    (event: "gesture-end", state: SplitterGestureState): void;
    /** 调整被放弃或没有产生变化：不携带保存意图 */
    (event: "gesture-cancel", info: SplitterGestureCancellation): void;
};
```

`gesture-start` 与 `gesture-end | gesture-cancel` 一一对应，顺序固定；宿主只按这一配对维护「用户正在调整」的临时状态，
并且只在 `gesture-end` 写回。`active` 只包含 sash 两侧**实际变化**的面板，`compensated` 是被动让位的远端兄弟；
宿主应以 `active` 合成字段级偏好，不能用整份 `sizes` 覆盖 Storage，否则触界补偿也会被误存为用户偏好。

`sashSizes[index]` 对应 `panels[index]` 与 `panels[index + 1]` 之间的边界。有限非负值直接形成真实主轴布局占用；
`0` 表示该边界无占用且不参与指针命中或键盘操作。负值或非有限值会输出明确诊断并回退为 `1px`，超出边界数量的尾项被诊断后忽略。
未提供的边界保持历史 `1px` 行为。进行中的手势遇到归一化后 sash 几何值变化会取消；仅数组身份变化不会取消。

插槽是 `panel-<id>`（面板未声明 `id` 时为 `panel-<index>`），作用域参数为 `{panel, index}`；`panels` 为空时使用默认插槽。
组件不提供 `expose` API。attrs 透传到 Reka 的分组根节点（模板单根），因此 `class` / `id` / `data-*` 挂在组件上会落在这一层。

## 状态

- 默认：按 `defaultSize` 分配；只在首次挂载时使用一次。
- 调整中：几何随指针或按键变化，`gesture-update` 连续发出，但不产生保存意图。
- 禁用：sash 不响应指针与键盘，`disabled` 期间也不再有进行中的手势。
- 触界：只消耗可用空间，不制造负值或超过父容器的累积尺寸；无法同时满足约束时保留上一份合法布局。
- 空数据：`panels` 为空时只渲染默认插槽，不渲染 sash。

## 不支持

- 不做持久化：组件不写任何存储；`autoSaveId` 只是透传 Reka 的既有能力，产品的尺寸保存由宿主按 `gesture-end` 自行落盘。
- 不解释业务：不做节点结构编辑、跨栏拖动、栏的增删，也不认识面板内容的语义。
- 不支持像素单位面板、面板 `order`、`keyboardResizeBy` 与自定义 `storage`：这些 Reka 能力未在本组件开放，需要时先在原语层设计合同。
- 不做响应式重排：窄屏如何改单栏由宿主决定。

## 上游边界

Reka UI 负责分栏几何、约束求解、命中热区与键盘调整的实现，以及 sash 的 `separator` 角色与 `data-*` 状态。
本组件承诺的是上面这套 props/emits/slots 合同与手势边界语义（开始、更新、结束、取消，以及主动与补偿的划分）；
Reka 其余的 DOM 结构与未声明行为不属本组件合同，升级可能变化。

## 注意事项

- `gesture-update` 按帧发出，宿主不要在里面写盘；`gesture-end` 才是一次用户操作的收口。
- 一次手势期间宿主如果改了 `panels` 的身份或约束、归一化后的 `sashSizes`、方向或禁用状态，当前手势会以
  `context-changed` 取消：baseline 已经失去意义，继续提交会把旧结构或旧约束下的尺寸写到新上下文。仅用字段等值的新数组重渲染不会取消。
- 指针取消、窗口失焦和卸载会同时复位 Reka 的 mouse/touch 拖动状态；后续无按键移动不会继续改变布局，下一次指针或键盘调整可正常开始。

## 隐藏通道理由

`state:local`：组件内部持有正在进行的用户手势（来源、sash、baseline），组件销毁即丢失，不越出实例。

`env:global`：手势进行中需要 `document` 上的 `keydown`（Escape 取消）、`window` 的 `blur`（结束键盘手势）与
`window` 的 `pointercancel`（取消指针手势，Reka 自己只监听 mouse/touch）。这三条只在手势进行中存在，
手势结束、被取消或组件卸载时立即解绑；不是常驻快捷键，也不注册任何全局状态。
