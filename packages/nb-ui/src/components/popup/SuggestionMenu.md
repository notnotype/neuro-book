---
标签: [state:local, state:inject, env:portal, env:timer]
---

# SuggestionMenu

`SuggestionMenu` 是输入时弹出的候选菜单：Composer 的 `@`、`/`、`$`，编辑器的斜杠菜单。它不抢焦点：光标留在输入处，上下键、回车、Tab、Escape 由宿主处理，宿主告诉它哪一项是当前项（`activeId`），它报告指针的选择与悬停。与 `QuickPick`（自带输入框的命令面板）和 `DropdownMenu`（点按钮打开、焦点进菜单）不同，它只是贴在输入处旁边的一张列表。

## 布局

外框是弹出列表共用的外框（`.nb-ui-popover-surface .nb-ui-menu-surface`），项是共用的一行（`.nb-ui-menu-item`，行高 `--menu-item-h`、字号 `--menu-item-font`，缺省取 `--text-sm`）：左侧图标、名称、右侧次要文字（`hint`，放不下时先截它）。整个菜单（跨组）有一项带图标时，没有图标的项也留出图标列，名称左边对齐。分组按输入顺序排列，有标题的组画一行分组标题；顶部可以放 `header` 插槽（标题或搜索框），底部在加载时有一行加载提示，都不随列表滚动。没有按键提示的页脚。

列表在滚动视口里：项超过 8 个时截在第 9 项的中间，不超过时取自然高度；可滚动时显示悬浮滑块。

定位经 reka 的 Popover 原语（底下是 floating-ui），浮层传送到 `body`（`teleportTarget` 写明了就传送到那里）。外框不是对话框：Popover 写死的 `role="dialog"`、`aria-labelledby` 与 `tabindex` 在挂上后去掉，可访问的结构只有里面的 `listbox`。

- `anchor` 是元素（例如输入框外框）或虚拟锚点（例如光标的矩形）。打开期间每帧重新读一次锚点矩形，光标在同一个输入框里移动、输入框内滚动、窗口缩放时都跟得上；关闭或卸载后不再读。
- `side: "auto"`（缺省）时优先放在锚点下方；下方放不下 96px、上方更宽时翻到上方。`"top"`、`"bottom"` 固定方向、不翻转。
- 外框最高为这一侧的可用高度，最宽为可用宽度，左右夹进窗口（留 12px）；可用高度不足 96px 时照可用高度收矮，不越出窗口。
- `matchAnchorWidth` 时宽度取锚点宽度与可用宽度的较小者，名称与次要文字截断；否则宽度随内容，介于 220px 与 420px 之间。

层级在 `Dialog` 或浮动窗口里跟随它们注入的层级，不在里面时取普通页面的浮层层级。

## 交互

- 打开与关闭都不移动焦点；点外面不关闭，是否关闭由宿主决定。
- 在浮层里任何地方按下指针都不夺走输入处的焦点（项、内边距、标题、加载与空状态；`mousedown` 默认动作被阻止），只有能接收焦点的元素（例如 `header` 里的搜索框）照常接收焦点与指针，可以点进搜索框移动光标。点击可用项发出 `select`；禁用项不发。
- 指针在可用项上真的移动时发出 `highlight`；键盘滚动让静止的指针底下换了一项时不发，高亮不会被鼠标抢走。
- `activeId` 那一项挂高亮（`data-highlighted`）、`aria-selected="true"`；`activeId` 变化时把它滚进视口（只滚这个列表）。`activeId` 不在当前可选项里时不挂高亮，宿主应清掉 `aria-activedescendant`。
- 每个可选项的 DOM id 是 `suggestionOptionId(id, index)`，`index` 是跨组累计、只数可选项的位置，与 `suggestionMenuOptions(groups)` 的下标相同；宿主的 `aria-activedescendant` 用同一个函数。列表本身的 id 是 `id`，宿主的 `aria-controls` 指向它。

## 数据

```ts
import type {SuggestionMenuAnchor, SuggestionMenuGroup, SuggestionMenuItem, SuggestionSide} from "./suggestion-menu";

type SuggestionMenuProps = {
    /** 分组与项；组按顺序渲染，不合并不重排；项的 id 在整个菜单里唯一 */
    groups: readonly SuggestionMenuGroup[];
    /** 当前项；null 时不挂高亮 */
    activeId: string | null;
    /** 锚点元素或虚拟锚点；缺省 null，为 null 时不显示 */
    anchor?: SuggestionMenuAnchor | null;
    /** 列表的 DOM id；缺省自动生成 */
    id?: string;
    /** 无障碍名称 */
    label?: string;
    /** 名字来源的元素 id，写成列表的 aria-labelledby；给了 label 时不用它 */
    labelledby?: string;
    /** 加载中：已有项照常显示，底部加一行加载提示；默认 false */
    loading?: boolean;
    loadingText?: string;
    /** 没有任何项、也不在加载时显示 */
    emptyText?: string;
    /** 默认 "auto" */
    side?: SuggestionSide;
    /** 宽度跟锚点；默认 false */
    matchAnchorWidth?: boolean;
    /** 与锚点的间距（px）；默认 6 */
    sideOffset?: number;
    /** 传送目标（CSS 选择器）；缺省 body */
    teleportTarget?: string;
};

type SuggestionMenuItem = {
    id: string;
    label: string;
    iconClass?: string;
    /** 右侧次要文字：快捷键、路径或一句说明 */
    hint?: string;
    disabled?: boolean;
    /** 当前值：行尾画一个勾（SearchSelect 用它标出已选项）；与高亮无关 */
    checked?: boolean;
};

type SuggestionMenuGroup = {
    id: string;
    /** 分组标题；缺省不画标题行 */
    label?: string;
    items: readonly SuggestionMenuItem[];
};

type SuggestionMenuEmits = {
    /** 点击了一个可用项 */
    (event: "select", id: string): void;
    /** 指针在一个可用项上真的移动了 */
    (event: "highlight", id: string): void;
};

type SuggestionMenuSlots = {
    /** 列表上方的固定区：标题或搜索框，可以接收焦点 */
    header?: () => unknown;
};

type SuggestionMenuExpose = {
    /** 节点是否在浮层里；浮层传送出去了，不在宿主的 DOM 里，宿主判断失焦时要把它算进去 */
    contains(node: Node | null): boolean;
};

/** 第 index 个可选项的 DOM id */
function suggestionOptionId(menuId: string, index: number): string;
/** 按显示顺序排开的可选项（不含禁用项） */
function suggestionMenuOptions(groups: readonly SuggestionMenuGroup[]): SuggestionMenuItem[];
```

## 状态

- 有项：按分组显示，`activeId` 那一项高亮。
- 加载中：已有项照常显示，底部一行 `loadingText` 与转圈；没有项时只显示这一行。
- 没有结果：没有任何项、也不在加载时显示 `emptyText`。
- 禁用项：降透明度，不发 `select` 与 `highlight`，没有选项 id。

## 状态与环境

- `state:local`：滚动视口的截断高度、滑块几何与拖动状态，以及 `side: "auto"` 时这一刻放在哪一侧。
- `state:inject`：读取 `Dialog` 注入的浮层层级。
- `env:portal`：浮层经 reka 的 `PopoverPortal` 传送到 `body` 或 `teleportTarget`，并登记为浮层层（模态 `Dialog` 里也能接收指针；Escape 与外部点击不由它关闭）。
- `env:timer`：打开期间每帧读一次锚点矩形（floating-ui 的逐帧更新，以及 `"auto"` 时选择上下哪一侧）；关闭或卸载时停止。

## 不支持

- 不处理键盘：上下键、回车、Tab、Escape 由宿主在输入处处理。
- 不过滤、不排序候选，也不决定什么时候打开。
