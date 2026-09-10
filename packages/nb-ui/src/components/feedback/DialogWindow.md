---
标签: [state:local, env:portal, env:global]
---

# DialogWindow

`DialogWindow` 是一个无遮罩、页面仍可交互的非模态浮动窗口，适合在查看或编辑工作区内容时并排保留主页面。它与模态 `Dialog` 的区别是：窗口外点击不会关闭窗口，也不会锁定背景滚动；标题栏可拖动，尺寸调整是可选能力。

## 布局

窗口由标题栏、可滚动 body 和可选 footer 组成。标题栏包含拖动区域、可选关闭按钮和一个 `DialogTitle`。标题**左对齐**，起点与标题栏内边距对齐，栏内不为居中放占位块（窗口标题习惯左起，与内容列左边缘同一条竖线）。栏高 `min-h-9`，关闭按钮用 `sm` 尺寸（26×26），上下留空隙并避开窗口圆角。body 占据剩余高度，内容超出时由 `bodyClass` 决定滚动归属；footer 固定在底部，不随 body 滚动。`maxHeight` 限制窗口高度，启用 `resizable` 后窗口至少保持 `minWidth` × `minHeight`。

`header` slot 用来把页面身份和上下文拼进同一个标题（例如 `设置 · 全局设定`）：整段仍是窗口的可访问名，
建议只让身份部分用 `--text-main`，分隔符与上下文降为 `--text-muted`。只传 `title` 时不涉及这一层。

窗口只提供一层 chrome：body 默认自带内边距，宿主可传 `bodyClass` 接管滚动与内边距，自己决定内部分栏（如导航轨 + 详情用一条分割线分隔），不要再在窗口内套一层带描边的卡片，否则会出现双层边框。窗口表面圆角小于面板卡片圆角，内容应使用控件级圆角。

打开时窗口居中：宽高都确定时落在视口正中；高度按内容自适应时先量一次实际高度再居中，量不到就回落到 64px 顶距。在 `390×844` 窄屏中，窗口宽度自动收敛到视口内侧并保留 12px 两侧间距；窗口不会制造页面级横向滚动，长内容继续在 body 内滚动。拖动或缩放后位置保留在本次组件实例内，下次打开仍居中。

尺寸可以传字面量 `size="sm" | "md" | "lg"`（见下表），显式传入的 `width` / `height` 覆盖对应维度。

## 交互

- 打开窗口后，Reka Dialog 语义为非模态：不渲染 Overlay、不困住焦点、不锁定背景指针事件；窗口外元素仍可点击和聚焦。
- 标题栏的标题区域可拖动。窗口至少保留一段可抓取区域在视口内，拖动不会改变页面滚动位置。
- `closable` 为 `true` 时显示关闭按钮；按钮带有“关闭”可访问名称。`closeOnEsc` 为 `true` 时按 Escape 请求关闭。`busy` 时关闭按钮、Escape 和 resize 均不生效。
- `resizable` 为 `true` 时提供六个可聚焦 resize 手柄：右、下两条边加四个角。拖左/上方向的手柄（`top-left`、`top-right`、`bottom-left`）时窗口的 `left` / `top` 跟着被拖动的那条边界走，触到 `minWidth` / `minHeight` 后位置不再漂移。鼠标拖动在 pointerup 时提交尺寸；方向键按 10px 调整，Shift + 方向键按 1px 调整，方向键语义是「移动那条边界」（例如在 `top-left` 上按 ArrowLeft 是变大），尺寸不会低于最小值。
- DialogWindow body 内的 nb-ui `FormSelect` 下拉会继承窗口专用浮层层级，显示在窗口表面之上；窗口外的 FormSelect 仍使用普通 popover 层级。
- 窗口可以叠窗口：从窗口里再开一个 `DialogWindow` 时，内层窗口按嵌套深度排在外层之上，内层窗口自己的下拉也跟着它——外层窗口 8990 / 外层下拉 8991 / 内层窗口 8992 / 内层下拉 8993，依此类推。整档压在模态 `Dialog`（9000）之下，总共容纳 5 层；再深的嵌套不该靠 z-index 解决，而是要重新想清楚那是不是两个窗口。Esc 由 Reka 的图层栈决定，只作用于最上面那个窗口。
- Reka 负责 Dialog 的角色、标题关联、Portal 和生命周期；窗口定位、拖动、resize、视口约束与窗口内浮层层级由本组件及其公共浮层上下文负责。组件不提供模态焦点陷阱。

## 数据

```ts
type DialogWindowSizePreset = "sm" | "md" | "lg";

type DialogWindowProps = {
    /** 是否显示；必填、受控，默认由宿主持有 */
    modelValue: boolean;
    /** 尺寸字面量；默认 md；显式 width / height 覆盖对应维度 */
    size?: DialogWindowSizePreset;
    /** 标题文字；默认空字符串；无 header 时为空则使用视觉隐藏标题 */
    title?: string;
    /** 宽度（px）；默认取 size 预设；窄屏显示宽度会收敛到视口 */
    width?: number;
    /** 高度 CSS 值或 px 数值；默认取 size 预设，传 auto 时按内容自适应 */
    height?: string | number;
    /** 最大高度 CSS 值；默认 calc(100dvh - 80px) */
    maxHeight?: string;
    /** 是否启用 resize；默认 false */
    resizable?: boolean;
    /** 最小宽度（px）；默认 320 */
    minWidth?: number;
    /** 最小高度（px）；默认 240 */
    minHeight?: number;
    /** 是否显示关闭按钮；默认 true */
    closable?: boolean;
    /** 是否响应 Escape；默认 true */
    closeOnEsc?: boolean;
    /** 忙碌时阻止关闭与 resize；默认 false */
    busy?: boolean;
    /** body 容器 class；默认 overflow-y-auto px-4 py-3 */
    bodyClass?: string;
    /** Portal 目标；默认 body；传 false 关闭 Teleport */
    teleportTarget?: string | boolean;
};

type DialogWindowEmits = {
    /** Reka open 状态变化或无 request-close 监听器时的默认关闭事件 */
    (event: "update:modelValue", value: boolean): void;
    /** 关闭按钮或 Escape 请求关闭；原因分别为 close-button / esc */
    (event: "request-close", reason: "close-button" | "esc"): void;
    /** resize 鼠标提交或键盘调整后的宽度（px） */
    (event: "update:width", value: number): void;
    /** resize 鼠标提交或键盘调整后的高度（px） */
    (event: "update:height", value: number): void;
};
```

尺寸字面量（宽度 × 高度，px）：

| size | 宽度 | 高度 |
| --- | --- | --- |
| `sm` | 420 | 420 |
| `md`（默认） | 720 | 640 |
| `lg` | 1100 | 820 |

插槽合同：默认插槽是 body 内容；`header` 替换标题栏文字并仍包在 `DialogTitle` 中；`footer` 渲染底部操作区。组件不暴露 `expose` API；attrs 不是稳定公共合同，不应依赖内部 Reka 节点的透传位置。组件不提供业务数据、请求、store 或持久化能力。

`env:portal` 的理由：浮动窗口必须脱离宿主的局部 stacking context 才能稳定覆盖工作区；`teleportTarget` 明确指定目标，默认公共目标为 `body`。产品主题宿主（例如 NeuroBook 的 `.novel-ide-theme`）必须由消费者显式传入，不能由公共包硬编码。目标不存在时保持 Vue/ ReKa Portal 的原有 Teleport 行为，不创建隐式目标。

`env:global` 的理由：标题栏拖动和 pointer resize 需要在一次手势持续期间监听指针移动与释放事件；组件销毁或手势结束时解除监听。该监听不是常驻全局快捷键。

## 状态与边界

- 默认：显示标题栏、body 和可选 footer；窗口打开状态完全由 `modelValue` 控制。
- 禁用/只读：组件没有统一 disabled 或 readonly 状态；宿主应通过 `busy` 阻止关闭与 resize，并在 body 控制业务字段状态。
- 忙碌：关闭按钮不可用、Escape 不关闭、resize 手柄不进入 Tab 顺序，也不发出 resize 事件。
- 出错、空数据：组件不解释 body 数据；宿主通过默认插槽呈现错误或空状态。
- 没有标题：组件使用视觉隐藏的 `DialogTitle`，仍为 Dialog 提供可访问名称。
- 空 footer：未提供 `footer` 插槽时不渲染 footer 区域。

## 不支持

- 不支持 Overlay、模态焦点陷阱、背景指针事件锁定或背景滚动锁定。
- 不支持自动保存位置或尺寸到浏览器存储；宿主如需持久化必须通过受控 props/emits 自行实现。
- 不支持替代 `Dialog` 或 `AlertDialog` 承担确认流程；需要破坏性确认时使用对应模态组件。

## 上游边界

Reka UI 负责 Dialog 的角色、`aria-labelledby` 关联、Portal、Escape/outside 事件和非模态生命周期。本组件承诺阻止 outside dismiss、保留页面交互并将 Escape 转换为 `request-close`；Reka 其余实现细节及升级后的未声明行为不属于本组件合同。
