---
标签: [state:inject, env:portal]
---

# SidePanel

`SidePanel` 是贴窗口右边、全高的非模态面板：页面不压暗、照常可用，点外面不关，内容上没有拖动手势。给“边看页面边用”的面板用，例如书房里从右边滑出的聊天。要挡住页面、等用户做完一件事的用 `Dialog`；在移动端从边缘拖出拖回的用 `Drawer`（Reka 抽屉在内容上任何按下都会开始滑动关闭，放对话、表单时拖选文字或在输入框里拖动会把它拖走）。

## 布局与交互

- 内容传送出去（见“隐藏通道理由”），贴右边，上沿让出 `--nb-side-panel-inset-top`（缺省 0，宿主设，例如桌面窗口自己画的标题行），下沿到底；宽为 `width`，不超过传送目标宽度的 90%（容器单位 `cqw`，没有容器时按小视口单位）。
- 面与 `Drawer` 相同（`.nb-ui-popover-surface`、`.nb-ui-dialog-surface`、`.nb-ui-drawer-surface`）。正文没有内边距、自己不滚动，撑满面板；滚动与内边距由内容负责。
- 自右滑入、滑出；系统设了减少动画时即刻出现与消失。
- 不压暗，没有遮罩。点外面、焦点移出都不关；点触发器切换开关。
- Esc：焦点在面板里或触发器上时关；焦点在页面别处时 Esc 归那里，面板不关。输入法组字时按的、内层控件已经处理过的（`preventDefault`）不算。面板里再开的浮层先拿到 Esc。
- 焦点：打开时进入面板（Reka 的缺省：内容里第一个可聚焦元素，没有时面板本身），调用方可以之后再挪；关闭后回到触发器。Tab 在面板里循环（Reka 非模态照样循环），键盘离开面板靠 Esc 或调用方放在面板里的关闭按钮。
- 读屏：对话框角色，名字是 `label`（只给读屏的标题），没有描述。

## 数据

```ts
interface SidePanelProps {
    /** 是否打开；受控。 */
    open: boolean;
    /** 读屏名（对话框角色的名字），不画可见标题。 */
    label: string;
    /** 宽度（CSS 长度）；可选，缺省 "420px"。 */
    width?: string;
}

interface SidePanelEmits {
    /** 触发器切换、Esc 关闭时发出；宿主改 `open` 才生效。 */
    (event: "update:open", value: boolean): void;
    /** 关闭完成：内容已卸载、焦点栈已释放。 */
    (event: "closed"): void;
}

interface SidePanelSlots {
    /** 打开它的元素；按 Reka as-child 承载，只能是一个元素。得到 aria-expanded、aria-controls 与点击切换。 */
    trigger?: () => any;
    /** 正文。 */
    default?: () => any;
}
```

组件没有 `expose` API。根不是元素（Reka `DialogRoot` 只渲染插槽：触发器加一个传送占位），调用方要给它定位、加 class 时自己包一层。

## 状态与边界

- 打开态受控：宿主不接 `update:open` 时 Esc 与触发器都不起作用。
- 面板开着且是最上层时，页面上按的 Esc 都会被它标成已处理（`preventDefault`）：不标的话 Reka 会自己关掉面板。焦点在页面别处时面板不关，但那里按 `defaultPrevented` 判断要不要处理 Esc 的控件会当成已处理。
- 程序性关闭（宿主直接把 `open` 改成 false）时焦点同样回到触发器，即使焦点原本在页面别处：Reka 非模态在点外面没有关闭它时总是还焦点给触发器。
- 层级是 `sidePanel` 档（低于页面里的下拉），不进模态序列；向内容提供 `popover` 档的浮层层级，面板里的下拉、菜单压在面板上。页面里打开的下拉也压在面板上。

## 上游边界

Reka UI 负责打开状态、传送、焦点作用域、Esc 与点外面的判定。本组件承诺位置与尺寸、不关的情形、Esc 的条件、层级与事件；Reka 升级后的焦点细节不属于本组件合同。

## 隐藏通道理由

`env:portal`：内容经 Reka `DialogPortal` 传送，脱离宿主的裁剪与层叠上下文。目标同 `Drawer`：默认 `body`，宿主可用 `provideTeleportTarget(选择器)` 给更近的目标（例如组件 Lab 的画布）。

`state:inject`：向内容树提供浮层层级（`NB_POPOVER_Z_INDEX`），读宿主的传送目标（`useTeleportTarget`）。
