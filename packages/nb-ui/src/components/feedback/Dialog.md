---
标签: [state:local, state:inject, env:portal, env:global]
---

# Dialog

`Dialog` 是受控的**模态对话框**（遮罩、居中、焦点锁定、背景不可交互）。没有遮罩、页面仍可交互、可拖动、可选缩放的**浮动窗口**是 [`FloatingWindow`](FloatingWindow.md)。两者共用同一个外框（内部零件 [`DialogSurface`](DialogSurface.md)）：面、标题、可滚动正文、页脚与滚动时才出现的分隔线只有这一份。宿主通过插槽呈现业务内容，可接管关闭请求或确认流程。它与 `AlertDialog` 的区别是可承载任意正文，页脚可自定义，也可点遮罩关闭。

## 与 FloatingWindow 的区别

| | `Dialog` | `FloatingWindow` |
| --- | --- | --- |
| 遮罩 | 有，按 `overlayType` 画；`transparent` 时也有，只是看不见 | 没有 |
| 位置 | 居中，不能拖动 | 打开时按容器居中；按住拖动区域可拖动，至少留一角在容器里 |
| 焦点 | 锁在面板里，Tab / Shift+Tab 在面板内循环 | 不锁，窗口外仍可点击与聚焦 |
| 背景 | 不可交互、不能滚动 | 可交互、可滚动 |
| 点外面 | 点遮罩请求关闭（`closeOnOverlay`） | 不关 |
| Escape | 只关最上层（`closeOnEsc`） | 同左 |
| 缩放 | 不适用 | `resizable` 时有六个手柄 |
| 圆角 | `--radius-dialog` | `--radius-window`（缺省等于 `--radius-dialog`） |
| 面 | `--dialog-surface`（缺省等于小浮层的 `--overlay-surface`） | 同左 |
| 叠放 | 同时打开的按打开顺序叠放 | 按嵌套深度叠放 |
| `request-close` 的原因 | `outside`、`cancel`、`close-button`、`escape` | `cancel`、`close-button`、`escape` |


## 布局

面板自上而下是标题区、正文与页脚。标题左对齐，可带 `header-extra` 内容与可选关闭按钮（`sm` 尺寸，贴右上、不贴圆角）；`showHeader=false` 时没有标题区，`closable` 的关闭按钮改贴面板右上角（离上、右两边各 `--space-4`），浮在正文之上，正文要自己给它让出位置：面板上的 CSS 变量 `--nb-dialog-close-room` 是它从面板右边、上边算起占的见方（含与内容的间隔）；正文占据剩余高度，内容溢出时自己滚动；页脚固定在底部、不随正文滚动。平时不画分隔线，正文滚离顶部时标题下方才出现一条，下方还有内容时页脚上方才出现一条。`bodyClass` 与 `headerClass` 追加到对应容器，用来接管内边距或滚动布局。

| `size` | 默认宽度 | 默认高度 | 最大高度 |
| --- | --- | --- | --- |
| `sm` | `min(360px, calc(100cqw - 32px))` | `auto` | `85cqh` |
| `default`（默认） | `min(420px, calc(100cqw - 32px))` | `auto` | `85cqh` |
| `md` | `min(560px, calc(100cqw - 32px))` | `auto` | `85cqh` |
| `lg` | `min(720px, calc(100cqw - 32px))` | `auto` | `calc(100cqh - 32px)` |
| `xl` | `min(1080px, calc(100cqw - 20px))` | `min(780px, calc(100cqh - 20px))` | `calc(100cqh - 20px)` |
| `full` | `calc(100cqw - 24px)` | `calc(100cqh - 24px)` | `calc(100cqh - 24px)` |

显式 `width`、`height`、`maxHeight` 覆盖预设的对应值。`width` 写成数字时按 `min(Npx, calc(100cqw - 32px))` 收窄，不会比容器宽；`height` 写成数字时是像素。尺寸用容器单位 `cqw`、`cqh`：宿主把传送目标设成尺寸容器时按目标大小计算，没有容器时按小视口单位（`svw`、`svh`）计算。各档在 `390px` 窄屏都保留左右各 `16px` 的间距。

`header` 插槽只替换标题文字，仍包在对话框标题里作为可访问名称；可以把身份与上下文拼进同一个标题（例如 `设置 · 全局设定`），身份部分用 `--text-main`，分隔符与上下文降为 `--text-muted`。外框只给一层：正文默认带内边距，宿主传 `bodyClass` 接管后自己决定内部分栏，不在里面再套一层带描边的卡片。

## 交互

- **初始焦点**：给了 `initialFocus`（选择器）时在面板里找它，找不到就聚焦面板；没给时是第一个可聚焦元素，没有时聚焦面板。关闭后焦点还给打开前的元素。
- **点遮罩**：按下与松开都在遮罩上、同一个键（主键或右键）才算一次点击；从面板里按下拖到遮罩上松开不算。对话框里还开着下拉、取色面板这类浮层时，这一下只关浮层，不关对话框。
- **Escape**：只有最上层的对话框或窗口收到。输入法正在组字时按的、内层控件已经处理过（`preventDefault`）的 Escape 不算关闭。
- **关闭**：遮罩、取消按钮、关闭按钮与 Escape 一律先发 `request-close(reason)`；`closeOnRequest` 为真（缺省）时随即发 `update:open(false)`。打开态是受控的：组件只发事件、自己不翻转，宿主不接 `update:open` 时对话框保持打开。宿主要拦（脏表单、守卫、用取消按钮退回上一步）时传 `:close-on-request="false"`，在 `request-close` 里自己决定。行为不随宿主挂了哪些监听变化。默认页脚的确认按钮只发 `confirm`，关不关由宿主决定（与 `AlertDialog` 不同：它的确认与取消由 reka 直接关闭）。关闭完成、内容卸载并释放焦点之后发 `closed`。`busy` 时这些动作都不生效，默认页脚按钮与关闭按钮禁用。
- **页脚**：`sm`、`default` 的默认按钮等宽填满一行，其它尺寸靠右排列。自定义 `footer` 插槽时组件只提供 `confirm`、`cancel` 回调。
- **状态行**：按钮靠右排列时，按钮左边一直留着一行状态（空着也在）。平时显示 `status` 插槽里的中性状态（例如“已选 …”，淡色），`status` 非空时换成这条错误（危险色，带图标），按钮与正文都不动；一行放不下时截断，悬停看全文；读屏以礼貌方式播报。表单提交之后才知道的错误写在这里（[UI 开发规范](../../../docs/ui-development-spec.md) 的“表单与无障碍”第 8 条）。按钮平分整行的 `sm`、`default` 没有状态行。
- **可访问性**：面板是 `role="dialog"`，锁整页的模态带 `aria-modal="true"`（宿主声明 `contained` 时不带）；标题（或 `header` 插槽）经 `aria-labelledby` 作可访问名称，没有标题时用视觉隐藏的“对话框”。关闭按钮有可访问名称 `closeLabel`。

## 叠放与层级

层级规则见 [UI 开发规范](../../../docs/ui-development-spec.md) 的“叠放层级”一节，数值只在 `theme/z-index.ts`。

- 同时打开的模态（`Dialog` 与 `AlertDialog`）按**打开顺序**叠放，后打开的在上面，与 DOM 顺序无关；最多 5 层，再多的都落在第 5 层。
- 浮动窗口（`FloatingWindow`）按**嵌套深度**叠放，整档在模态之下。
- **二级对话框**：放在另一个 `Dialog`、`FloatingWindow` 或 `AlertDialog` 内容里的 `Dialog`、`AlertDialog`，面取 `--dialog-surface-nested`，圆角收到不大于 `--radius-window`（修饰类 `.nb-ui-dialog-surface--nested`）。按组件树数层数，在组件建立时取定。它传送到 `body`，不是外层面板的后代，模糊采得到外层与页面，仍是玻璃；`teleportTarget` 为 `false` 时它成了外层面板的后代，模糊只采到外层面板之内（[设计语言](../../../docs/design-language.md) 第二节边界 4），不要这样用。
- 向内容树提供局部浮层层级（`NB_POPOVER_Z_INDEX`），里面的下拉、提示、取色面板显示在面板之上：一个高于所有模态层的固定值。叠放与二级的判断由 `useOverlayLayer` 统一处理。
- **宿主声明 `contained`**（`provideTeleportTarget(选择器, {contained: true})`，组件 Lab 的画布就是这样）时，模态只在传送目标里画遮罩并居中，以非模态方式挂载：不锁整页、不把目标外的界面设为读屏不可见、不锁焦点。点遮罩与 Escape 的判定不变。

## 数据

```ts
type DialogSize = "sm" | "default" | "md" | "lg" | "xl" | "full";
type DialogCloseReason = "escape" | "outside" | "close-button" | "cancel"; // OverlayCloseReason 的子集

interface DialogProps {
    /** 是否打开；必填、受控（组件只发 update:open，自己不翻转） */
    open: boolean;
    /** 尺寸预设；默认 "default" */
    size?: DialogSize;
    /** 标题；默认空字符串，此时用视觉隐藏的标题 */
    title?: string;
    /** 是否显示关闭按钮；默认 false（出口是有名字的页脚按钮） */
    closable?: boolean;
    /** 是否显示标题区；默认 true */
    showHeader?: boolean;
    /** 点遮罩是否请求关闭；默认 true */
    closeOnOverlay?: boolean;
    /** Escape 是否请求关闭；默认 true */
    closeOnEsc?: boolean;
    /** CSS 宽度，或像素数字（按容器收窄）；默认由 size 决定 */
    width?: string | number;
    /** CSS 高度，或像素数字；默认由 size 决定 */
    height?: string | number;
    /** CSS 最大高度；默认由 size 决定 */
    maxHeight?: string;
    /** 初始焦点的选择器；默认第一个可聚焦元素 */
    initialFocus?: string;
    /** Teleport 选择器；缺省用宿主提供的目标或 "body"；false 禁用 Teleport */
    teleportTarget?: string | false;
    /** 遮罩样式；默认 "opaque" */
    overlayType?: "transparent" | "blur" | "opaque";
    /** 默认页脚是否显示取消按钮；默认 false */
    showCancel?: boolean;
    /** 是否显示页脚；默认 true */
    showFooter?: boolean;
    /** 是否阻止关闭与确认；默认 false */
    busy?: boolean;
    /** 页脚左侧状态行的错误原因；默认空字符串；非空时替下 status 插槽；只在 md 及以上尺寸有 */
    status?: string;
    /** 正文附加 class；默认空字符串 */
    bodyClass?: string;
    /** 标题区附加 class；默认空字符串 */
    headerClass?: string;
    /** 默认取消按钮文字；缺省按界面语言取（中文 "取消"） */
    cancelLabel?: string;
    /** 默认确认按钮文字；缺省按界面语言取（中文 "确认"） */
    confirmLabel?: string;
    /** 关闭按钮的可访问名称与 title；缺省按界面语言取（中文 "关闭"） */
    closeLabel?: string;
    /** 请求关闭后随即发 update:open(false)；默认 true；宿主自己决定关不关时传 false */
    closeOnRequest?: boolean;
}

interface DialogEmits {
    /** closeOnRequest 为真时，紧跟 request-close 发出 false */
    (event: "update:open", value: boolean): void;
    /** 默认确认按钮触发；不关闭 */
    (event: "confirm"): void;
    /** 请求关闭及原因 */
    (event: "request-close", reason: DialogCloseReason): void;
    /** 关闭完成：内容已卸载、焦点栈已释放 */
    (event: "closed"): void;
}

interface DialogSlots {
    /** 正文 */
    default?: () => any;
    /** 替换标题文字；仍作为可访问名称 */
    header?: () => any;
    /** 标题右侧、关闭按钮之前的附加内容 */
    "header-extra"?: () => any;
    /** 状态行平时的中性状态（status 为空时显示）；只在 md 及以上尺寸有 */
    status?: () => any;
    /** 替换默认页脚按钮；接收确认与取消回调 */
    footer?: (props: {confirm: () => void; cancel: () => void}) => any;
}
```

组件没有 `expose` API。没有声明为 props 的 attrs（`data-*`、`class` 等）落在面板上。`showHeader=false` 时不显示标题区，标题仍作视觉隐藏的可访问名称，`closable=true` 的关闭按钮在面板右上角；`showFooter=false` 时不显示默认或自定义页脚。

## 状态与边界

`busy` 只阻止本组件提供的确认、关闭与缩放，不替正文控件设置 disabled。组件不定义正文的加载、错误或空数据外观，由默认插槽负责。

## 不支持

- 自动保存、异步确认的锁定与错误提示、业务数据管理；自定义页脚回调只触发组件动作，不替宿主等待异步任务。
- 拖动与缩放：用 `FloatingWindow`。
- 替代 `AlertDialog` 做破坏性二次确认。

## 已知限制

- 模态开着时，reka 会把面板以外的界面设为读屏不可见，通知视口也在其中：读屏不播报这段时间里的新通知。
- 二级对话框按组件树判定：不在外层对话框内容里的对话框，视觉上压在别的对话框上也算一级，面与圆角按一级画。例如从应用根上的服务打开的对话框，或两个并排的组件靠共享状态先后打开的两个 `Dialog`（Lab 的 `stacked` 场景就是这样）。要画成二级，把内层放进外层的内容里。
- 模态给内容的浮层层级是固定值：下层对话框里的浮层在上层对话框打开时还开着，会盖住上层。点上层的入口按钮时外部点击已经把浮层关掉了，正常操作碰不到。

## 隐藏通道理由

- `env:portal`：遮罩与面板要脱离宿主的裁剪与层叠上下文；默认传送到 `body`，宿主可用 `provideTeleportTarget(选择器)` 在组件树上给一个更近的目标；组件自己写明的 `teleportTarget` 优先，目标查不到时回退 `body`。`false` 时禁用 Teleport。
- `env:global`：模态打开期间由 reka 在 `document` 处理 Escape 与焦点、锁定页面滚动。另有全应用一份的已打开模态列表（按打开顺序）：打开时登记、关闭或卸载时移除，用它算自己叠在第几层。它和 reka 自己的图层栈一样只做叠放协调、不承载数据，所以不算 store；层级取决于别的对话框什么时候打开，父组件给不出来。
- `state:inject`：读宿主提供的传送目标与 `contained`、外层窗口的嵌套深度；向内容树提供嵌套深度与局部浮层层级。
- `state:inject`（翻译端口）：读宿主注入的翻译端口（`useUiText()`，`TEXT_PORT_KEY`）取取消、确认、关闭按钮的缺省文案，无标题时的屏幕阅读器标题，语言跟着端口走，换语言不重新挂载；没有宿主注入时用 nb-ui 的缺省端口（`zh-CN`，自带目录 `@notnotype/nb-ui/locales`）。调用方显式传 `cancelLabel`、`confirmLabel`、`closeLabel` 时以属性为准，不读端口。这类读屏名称与空态文案每个调用方都要有，逐处传属性不现实，所以由组件自己经端口取。

## 上游边界

reka 负责对话框的角色、标题关联、Portal、焦点锁定与归还、背景不可交互、Escape 与外部事件的分发。本组件承诺拦下 reka 自己的外部点击与 Escape 关闭，改由上面的规则判定并经 `request-close` 发出；reka 其余实现细节及升级后的未声明行为不属于本组件合同。
