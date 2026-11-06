---
标签: [state:local, state:inject, env:portal, env:global]
---

# FloatingWindow

`FloatingWindow` 是受控的**浮动窗口**：没有遮罩，页面仍可交互，可拖动，可选缩放，点外面不关。外框与 [`Dialog`](Dialog.md) 共用（内部零件 [`DialogSurface`](DialogSurface.md)）：面、标题、可滚动正文、页脚、状态行与滚动时才出现的分隔线，以及尺寸预设、`header` 插槽与 `showHeader=false` 时角上的关闭按钮，都与 `Dialog` 的“布局”一节相同。两者的区别见 `Dialog.md` 的“与 FloatingWindow 的区别”。

## 交互

- **打开与关闭**：`open` 受控，组件只发 `update:open`、自己不翻转。Escape、关闭按钮与取消按钮先发 `request-close(reason)`（`escape`、`close-button`、`cancel`），`closeOnRequest` 为真（缺省）时随即发 `update:open(false)`；宿主要自己决定时传 `:close-on-request="false"`。点窗口外面不关。确认按钮只发 `confirm`。关闭完成、内容卸载并释放焦点之后发 `closed`。`busy` 时关闭、确认与缩放都不生效，缩放手柄退出 Tab 顺序。
- **Escape**：只有最上层的对话框或窗口收到。输入法正在组字时按的、内层控件已经处理过（`preventDefault`）的 Escape 不算关闭。
- **焦点**：不锁，窗口外仍可点击与聚焦；`initialFocus` 与 `Dialog` 相同。关闭后焦点还给打开前的元素。
- **位置**：打开时按容器居中（传送目标不是 `body` 时按目标的大小，否则按浏览器窗口）；拖动时至少留一角在容器里，顶上总能再抓住。容器变化时（通常是浏览器窗口）：这次打开后没拖过、没缩放过的窗口保持居中；拖过或缩放过的放得下就不动，放不下就推回完整可见、离边 8px；容器比窗口还小时窗口按容器收窄显示，宿主的尺寸不改，放大后恢复；容器放大时不回到推走之前的位置。
- **从触发点展开**：与 `Dialog` 相同（规则见 [`Dialog.md`](Dialog.md) 的“从触发点展开”）：点按钮、菜单项打开时窗口从触发点的方向展开、关闭时收回；找不到触发点时原地缩放淡入。位移在窗口居中完成后量一次，之后拖动或缩放不影响它。
- **拖动区域**：按住这几处能拖动窗口：面板自己的留白，以及正文不滚动时正文自己的留白（没有内容的地方）；整条标题区；正文里标了 `data-dialog-drag` 的元素（宿主用它把自己画的标题区、工具条的空白处标为可拖）。按下处是其中的按钮、输入控件、链接、`role="button"` 或 `[data-interactive]` 时不拖，照常操作；正文里没标的地方不拖。按下时不拦默认动作（输入框照常失焦提交），移动超过 3px 才开始拖、这时才捕获指针，不到就松开是一次普通的点击。拖动区域不起选字，只有标题文字那一块显示移动光标。
- **缩放**（`resizable`）：手柄是右、下两条边加四个角；拖左、上方向的手柄时窗口的 `left`、`top` 跟着那条边走，触到 `minWidth`、`minHeight` 后不再漂移。鼠标在松开时提交 `update:width`、`update:height`；方向键按 10px、Shift + 方向键按 1px 调整，语义是“移动那条边”（在 `top-left` 上按左键是变大）。拖动与鼠标缩放不改变页面滚动位置。拖动或缩放后的位置只留在本次组件实例里，下次打开重新居中。
- **可访问性**：面板是 `role="dialog"`，不带 `aria-modal`；标题经 `aria-labelledby` 作可访问名称，没有标题时用视觉隐藏的“对话框”。缩放手柄是 `role="separator"`，带方向与可访问名称（经翻译端口取）。

## 叠放与层级

- 按**嵌套深度**叠放：从窗口里开出的窗口压住外层，窗口自己的下拉压住自己。整条窗口层级带（8990 起）在模态对话框之下。
- **不要在模态对话框里打开窗口**：窗口会落在模态的遮罩之下，用不了。窗口里开模态（例如设置窗口里的确认框）没有问题。
- 互不嵌套的两个窗口深度相同、层级相同，没有“点哪个哪个在上”，谁在上取决于 DOM 顺序。
- 嵌套最多 5 层；更深的与第 5 层同档，并在控制台给一条诊断。
- 放在另一个 `Dialog`、`FloatingWindow` 或 `AlertDialog` 内容里时画二级的面（规则同 `Dialog` 的“叠放与层级”）。

## 数据

```ts
type FloatingWindowCloseReason = "escape" | "close-button" | "cancel"; // OverlayCloseReason 的子集

interface FloatingWindowProps {
    /** 是否打开；必填、受控（组件只发 update:open，自己不翻转） */
    open: boolean;
    /** 尺寸预设；默认 "default"（与 Dialog 同一套） */
    size?: DialogSize;
    /** 标题；默认空字符串，此时用视觉隐藏的标题 */
    title?: string;
    /** 是否显示关闭按钮；默认 false */
    closable?: boolean;
    /** 是否显示标题区；默认 true */
    showHeader?: boolean;
    /** Escape 是否请求关闭；默认 true */
    closeOnEsc?: boolean;
    /** 请求关闭后随即发 update:open(false)；默认 true */
    closeOnRequest?: boolean;
    /** CSS 宽度，或像素数字（按容器收窄）；默认由 size 决定 */
    width?: string | number;
    /** CSS 高度，或像素数字；默认由 size 决定 */
    height?: string | number;
    /** CSS 最大高度；默认由 size 决定 */
    maxHeight?: string;
    /** 初始焦点的选择器；默认第一个可聚焦元素 */
    initialFocus?: string;
    /** 是否可缩放；默认 false */
    resizable?: boolean;
    /** 缩放的最小宽度（px）；默认 320 */
    minWidth?: number;
    /** 缩放的最小高度（px）；默认 240 */
    minHeight?: number;
    /** Teleport 选择器；缺省用宿主提供的目标或 "body"；false 不传送，就地渲染 */
    teleportTarget?: string | false;
    /** 默认页脚是否显示取消按钮；默认 false */
    showCancel?: boolean;
    /** 是否显示页脚；默认 true */
    showFooter?: boolean;
    /** 是否阻止关闭、确认与缩放；默认 false */
    busy?: boolean;
    /** 页脚左侧状态行的错误原因；只在 md 及以上尺寸有 */
    status?: string;
    bodyClass?: string;
    headerClass?: string;
    cancelLabel?: string;
    confirmLabel?: string;
    closeLabel?: string;
}

interface FloatingWindowEmits {
    (event: "update:open", value: boolean): void;
    (event: "confirm"): void;
    (event: "request-close", reason: FloatingWindowCloseReason): void;
    (event: "closed"): void;
    /** 缩放后提交的宽度（px） */
    (event: "update:width", value: number): void;
    /** 缩放后提交的高度（px） */
    (event: "update:height", value: number): void;
}
```

插槽与 `Dialog` 相同（`default`、`header`、`header-extra`、`status`、`footer`）。没有 `expose` API。没有声明为 props 的 attrs 落在面板上。

## 不支持

- 把位置或尺寸存进浏览器存储；需要时由宿主经 `update:width`、`update:height` 自己保存。
- 遮罩与焦点锁定：用 `Dialog`。

## 隐藏通道理由

- `env:portal`：面板要脱离宿主的裁剪与层叠上下文；默认传送到 `body`，宿主可用 `provideTeleportTarget(选择器)` 给一个更近的目标；`false` 时就地渲染。
- `env:global`：另有与 `Dialog` 共用的一个 `document` 捕获阶段 `pointerdown` 监听，记最近一次按下用于“从触发点展开”（见 `Dialog.md`）。拖动期间在 `window` 上监听指针移动与松开（开始拖动后捕获在面板上，期间拦住 `document` 的 `selectstart`），缩放期间捕获在手柄上、在手柄上监听，手势结束或卸载时解除。
- `state:inject`：读宿主提供的传送目标与外层窗口的嵌套深度；向内容树提供嵌套深度、嵌套层数与局部浮层层级（`useOverlayLayer`）。
- `state:inject`（翻译端口）：取取消、确认、关闭按钮的缺省文案、无标题时的读屏标题与缩放手柄的可访问名称；显式传属性时以属性为准，缩放手柄的名称固定走端口。

## 上游边界

reka 负责对话框的角色、标题关联、Portal 与焦点归还。本组件以非模态方式挂载 reka 的 Dialog，拦下它自己的外部点击与 Escape 关闭，改由上面的规则判定并经 `request-close` 发出；reka 其余实现细节及升级后的未声明行为不属于本组件合同。
