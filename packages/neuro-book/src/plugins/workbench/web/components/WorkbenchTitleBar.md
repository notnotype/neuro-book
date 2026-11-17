---
标签: [state:inject, env:global, env:portal]
别名: ["标题栏", "Title Bar"]
---

# WorkbenchTitleBar

工作台顶部 36px 的标题栏（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳四输出 28–31）：品牌标志、项目切换、应用菜单、居中的命令搜索、三个布局按钮与条目区。组件只呈现给定的菜单与条目、发出动作；菜单的条目来自贡献点 `workbench.titlebar-menu`，由 [`titlebar/titlebar-source.ts`](../titlebar/titlebar-source.ts) 按菜单项的共同规则（[`workbench/menus.md`](../../../../../../../docs/specs/workbench/menus.md)）算好交来，执行由外壳经命令服务完成。

## 布局

- 一行 36px，左右留 8px；面取 `--shell-chrome-surface`（缺省 `--bg-panel`），底部分隔线取 `--shell-chrome-line`（缺省 `--divider`）：卡片外壳的主题把两者设成透明，标题栏落在窗体底上（[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 输出 38）。左组依次是横排标志（`NeuroBookLockup`，高 17px，墨色跟随文字色）、项目切换（书本图标加显示名，下拉从左边展开）、一道 16px 高的短分隔与菜单入口；中间是搜索按钮（最宽 560px）；右组是布局按钮与条目区。左右两栏等分时搜索在正中；左组放不进一半时左栏按内容撑开、搜索往右让。
- 逐级让位按根元素的实测宽度与各部件的实测宽度（`titlebar/yield.ts`，[`ui/workbench-shell.md`](../../../../../../../docs/specs/ui/workbench-shell.md) 外壳四输出 30），放不下就收下一项、往回展开多留 40px：横排标志换成图形标志（`NeuroBookMark`，18px）；完整菜单栏（nb-ui `Menubar`，`variant="flat"`）收成 ≡ 图标按钮，点开一组一行、悬停或方向键展开子菜单；收起搜索里的快捷键提示；布局按钮不画（视图菜单里有对应的勾选项）；项目切换只留书本图标。各部件的宽度从一层不可见、不占位、`inert` 的测量层量（复本：两种标志、两种项目切换、菜单栏、≡、快捷键提示、布局按钮），语言、项目名与快捷键变了随之重算。根上带 `data-titlebar-level`（0 到 5）。搜索取中间剩下的宽度，最宽 560px、最窄 120px。
- 桌面窗口里（没有系统标题栏）它就是窗口的拖动区域（[`runtime.browser-host`](../../../../../../../docs/specs/runtime/browser-host.md) 的“窗口外框”）：根带 `data-desktop-titlebar`，向宿主声明“页面自己画了标题栏”，宿主据此不画后备标题栏；这是宿主的合同，`data-workbench-titlebar` 是工作台自己的钩子，两者并存。空白处 `app-region: drag`，有点击或悬停行为的一切（按钮、链接、输入框、菜单栏与菜单触发器、可聚焦元素、条目）`no-drag`；这组规则写在非 scoped 的样式块里，才命中得了 nb-ui `Menubar` 内部渲染的触发器。右栏末尾留出窗口按钮的宽度（`--nb-window-controls-width`，普通浏览器里是 0），逐级让位把它算进 `chrome`；三栏仍左右等分，两侧够宽时搜索在窗口正中。双击空白处最大化由系统做，组件不处理。
- 菜单项禁用时以原因作提示（`title` 与 `aria-description`）；勾选项显示勾。
- 项目名过长时截断，提示里有全文。
- 标志：给了 `shelf`（“回到书架”命令的标题）时是一个按钮，名字与悬停提示是它，带焦点环、是普通的 Tab 停靠点（在项目切换之前）；悬停与按下是标题栏按钮同样的底色，标志墨色不变。没给时只是图案。两种都包在同一个盒子（`.workbench-titlebar__brand-box`）里，盒子的左右内边距之和等于测量层复本的左右外边距之和，让位的切换点不受影响。桌面窗口里它是按钮、不是拖动区域：标志这一块不能拖窗口（开发者要标志可点，接受这个代价）。

## 交互

- 菜单会话：Alt（单独按下再松开）或 F10 聚焦菜单入口（完整时是第一组，否则是“菜单”按钮），或任一菜单打开，都开始一次会话，记下标题栏之外的上一个焦点。菜单关闭后焦点落回入口（Escape、选中一项）时，焦点回到那个位置；焦点在菜单入口上、菜单都关着时按 Escape 也是。用户点了别处、或把焦点挪到搜索与布局按钮再按 Escape，不还焦点。
- 会话开始时焦点在原生输入框里（`input`、`textarea`；编辑器区里的除外）：菜单里的撤销、重做禁用并说明原因，根上带 `data-titlebar-native-editing`。
- 菜单里的键盘由 nb-ui `Menubar`、`DropdownMenu` 负责（上下键、Home、End、Enter、Escape）。
- 搜索按钮发 `search`；布局按钮发 `toggle-part`；项目切换在有项目时点开列出“打开项目…”与（给了 `shelf` 时）“回到书架”，没有项目时直接发 `open-project`。
- 标志按钮发 `back-to-shelf`；按下后指针移动超过 4px 再松开不算点击（想拖窗口却按在了标志上），键盘触发的照常。

## 数据

```ts
type LayoutButton = {pressed: boolean; disabled: boolean};
type Props = {
    /** 当前项目的显示名；没有绑定项目为 null。 */
    project: string | null;
    menus: MenuGroup[];
    /** 命令面板的快捷键，按平台写好；没有为 null。 */
    searchShortcut: string | null;
    layout: {sidebar: LayoutButton; panel: LayoutButton; auxiliarybar: LayoutButton};
    items: StripEntry[];
    /** “回到书架”命令的标题；命令不在目录里（没装书架插件）时为 null 或不给：作品下拉没有这一项，标志不可点。 */
    shelf?: string | null;
};
type Emits = {
    run: [command: string, args: Readonly<Record<string, unknown>>];
    search: [];
    "toggle-part": [part: "sidebar" | "panel" | "auxiliarybar"];
    "open-project": [];
    "run-item": [itemId: string];
    "back-to-shelf": [];
};
```

## 隐藏通道理由

- `env:global`：Alt 与 F10 在窗口上监听：快捷键要在焦点在编辑器、侧栏等任何地方时都生效；`focusin` 在文档上监听：菜单用指针点开时，打开前的焦点已经不在 `activeElement` 上，只能事先记下。组件卸载时都摘下。
- `env:portal`：菜单与下拉经 nb-ui 的 Portal 渲染。
- `state:inject`：经 `useText()` 取宿主注入的翻译端口，搜索、布局按钮、菜单入口、项目切换等界面文字都在本插件的目录（命名空间 `nbook.workbench`，`../../locales/`）；语言随端口响应式切换，组件没有语言属性。没有宿主注入时得到 nb-ui 的缺省端口，那里没有本插件的目录，只显示键名，所以测试与 Lab 场景要注入登记了本插件目录的宿主引擎端口。
