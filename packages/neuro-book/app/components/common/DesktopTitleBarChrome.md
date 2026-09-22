---
标签: [state:local]
---

# DesktopTitleBarChrome

自绘标题栏的 chrome 本体：品牌、窗口菜单、Project 切换、搜索占位、Agent 按钮与自绘窗口按钮。**它只把 chrome 画出来并发出意图，不接触任何平台边界**——桌面 bridge 状态、菜单命令的实际派发、外观上报、Project 切换都归宿主 `DesktopTitleBar.vue`。这条分工是本组件能被 Lab 完整表达的原因：给它一组内存数据就能渲染，不需要 bridge 桩，也不需要真实 Project。

它和「自绘一个菜单栏」的区别是**它已经把宿主差异收进 props**：菜单由渲染进程画还是归操作系统（`rendererMenus`）、窗口按钮由谁画（`customWindowControls`）、连接方式（`connection`）、**宿主真实能力**（`capabilities`）都从外面进来。少了任何一个，组件就得自己判断宿主是桌面还是浏览器——那样它就不能在 Lab 里跑，也不该在浏览器里假装有桌面能力。

菜单的 enabled / visible **不由本组件拍**：`resolveTitleBarMenuGroups`（`app/utils/workbench-chrome.ts`）按 `capabilities` 生成——浏览器没有的桌面动作整条不画，焦点接不住的编辑动作画成禁用并写明原因，未接入的动作不会装成可用（搜索占位因此常驻禁用）。

打开的分组是**受控值**（`openMenu` + `update:openMenu`）；「点组件外收起」由本组件自己判定，因为下拉层被传送出了本组件的子树（见「布局」）。

## 数据

```ts
type TitleBarHostCapabilities = Readonly<{
    /** 桌面桥接在场：退出应用、窗口控制与系统缩放由宿主进程负责。 */
    desktop: boolean;
    /** 当前有打开的 Project 工作面。 */
    surfaceActive: boolean;
    /** 焦点目前能承接的编辑目标：`editor`（Studio 会话）/ `native`（原生编辑命令）/ `none`。 */
    editTarget: "none" | "native" | "editor";
}>;

type TitleBarProject = Readonly<{
    projectRoot: string;
    title: string;
}>;

type Props = {
    /** 中心拖拽区的 tooltip 文案（窗口标题）。 */
    title: string;
    /** 已打开的书架条目；空数组表示只剩「我的书架」一项。 */
    projects: readonly TitleBarProject[];
    /** 当前 Project；`null` 表示停在书架。 */
    currentProjectRoot: string | null;
    /** 宿主真实能力：菜单 enabled / visible 的唯一来源。 */
    capabilities: TitleBarHostCapabilities;
    /** 新标签打开用的标准 Project URL（`null` 表示书架）；传 `null` 表示宿主没有这条能力，入口整条不画。 */
    projectUrl: ((projectRoot: string | null) => string) | null;
    /** 宿主是否具备 Agent 面板能力；没有则整个按钮不画。 */
    agentPanelAvailable: boolean;
    agentPanelOpen: boolean;
    /** 菜单由渲染进程画；false 表示菜单归操作系统。 */
    rendererMenus: boolean;
    /** 窗口按钮由渲染进程画；false 表示交给系统标题栏。 */
    customWindowControls: boolean;
    /** 连接状态；`null` 表示还没有状态，不画状态点。 */
    connection: "local" | "remote" | null;
    /** 展开的分组：菜单组名 / `compact` / `project`；受控值，`null` 表示都收起。 */
    openMenu: string | null;
};

type Emits = {
    (e: "update:openMenu", value: string | null): void;
    /** 菜单项被选中（含键盘 Enter / Space）。 */
    (e: "invoke-command", command: DesktopMenuCommandId): void;
    /** Project 项被选中；`null` 表示「我的书架」。新标签打开不在这里——那是链接自己的事。 */
    (e: "select-project", projectRoot: string | null): void;
    (e: "toggle-agent-panel"): void;
    (e: "window-command", command: "minimize" | "toggle-maximize" | "close"): void;
};
```

**扩展面**：没有 slot；没有 `expose`；`attrs` 透传到根元素（Lab 的 `data-lab-subject` 走这条）。

## 交互

- 点菜单按钮开/关自己那一组；点 Project 按钮开/关书架切换；一次只开一组。
- 键盘：`ArrowDown` / `Enter` / `Space` 打开并聚焦首项，`ArrowUp` 打开并聚焦末项，组内 `ArrowUp` / `ArrowDown` 循环，`ArrowLeft` / `ArrowRight` 跨组切换（浮层跟着换锚点），`Escape` 关闭并把焦点还给触发按钮。
- **禁用项不进键盘遍历**：`ArrowDown` 从「复制」往下会落到「全选」，不会停在浏览器里禁用着的「粘贴」上；禁用项带 `title` 说明为什么不能点。
- 鼠标点开不抢焦点：触发按钮与菜单项都 `@mousedown.prevent`，底下输入框 / 编辑器的选区不会丢（否则「复制」这类动作会先把自己要复制的东西弄丢）。键盘激活（`click` 的 `detail === 0`）才把焦点还给触发按钮。
- 点组件外收起：面板与标题栏都不在事件路径上才算「外面」（面板传送到 body，单看标题栏根节点会把点菜单项误判成点外面）。
- Agent 按钮在 `capabilities.surfaceActive` 为假时禁用（title 说明原因），点击只在可用时发出 `toggle-agent-panel`。
- Project 行有两条打开路径：**本标签**是 `role="menuitem"` 的按钮，只发 `select-project`；**新标签**是带着标准 Project URL 的 `<a target="_blank" rel="noopener noreferrer">`，由浏览器自己开（中键 / Ctrl 点击同样成立），不触发当前标签的任何切换。
- 窗口按钮只发意图，最小化 / 最大化 / 关闭的执行在桌面宿主。

## 状态

- 菜单按能力生成：`file.quit`、`view.zoom-in|out|reset` 只在 `capabilities.desktop` 时出现；`file.open` 在 `!capabilities.surfaceActive` 时禁用（「请先打开一个 Project」）；编辑六条按 `editTarget` 决定（粘贴在浏览器里禁用并提示改用 Ctrl+V）。
- 菜单三态：完整菜单、紧凑菜单（一条 `compact` 按钮，下拉里按组分节）、不画菜单（`rendererMenus === false`，菜单在操作系统手里）。
- 窗口按钮：`customWindowControls === false` 时不画任何窗口按钮（浏览器就是这一档）。
- Agent 按钮：`agentPanelAvailable === false` 不画；`agentPanelOpen` 时高亮（`aria-pressed` 同步）；连接点在 `connection === null` 时不画，`remote` 用信息色、`local` 用成功色。
- 搜索占位常驻禁用（`disabled` + title / aria-label 说明「后续版本提供」），不代表任何可执行动作。

## 布局

一条 36px 高的横条，内部三块：`leading`（品牌 / 菜单 / Project 切换）、`center`（搜索占位，同时是窗口拖拽区）、`controls`（Agent 按钮，右端接自绘窗口按钮）。

- **高度来自产品几何常量**：根元素的 `--workbench-titlebar-height` 由 `SHELL_TITLEBAR_HEIGHT`（`app/utils/workbench/layout.ts`）喂出，CSS 里只用这个变量；外壳的垂直分配与窄屏叶包装读的是同一个常量，没有第二份 36。
- 伸缩顺序：`center` 是唯一吸收余量的块，两侧块固定；`leading` 里的品牌名最先让位，然后收 Project 标题与搜索框宽度，最后整块隐去搜索（`<= 960px` 与 `<= 720px` 两档）。
- 菜单是完整还是紧凑档由实测宽度决定（`resolveTitleBarMenuPresentation`）：组件里有三个 `aria-hidden` 的量测盒，量完整菜单、中心标题、右侧控件的宽度；量测盒的字号与内边距与真实控件同源，换主题换了密度也不会量错。
- **下拉层 `<Teleport to="body">`**：标题栏的祖先链上有 `overflow: hidden`（外壳与叶包装），留在原地的浮层只有命中区没有画面。传送出去后浮层拿不到祖先的相对定位，所以自带 `position: fixed` 坐标（贴着触发按钮下沿、右边缘不够就左移），最大高度按「视口剩余高度」与 320 取小，超出就在面板里滚——菜单永远不被视口切掉。主题变量写在 `<html>` 上，body 平级的浮层照样继承。
  > 没有用 `useFloatingPanelLayout`：它的 `clippingBounds` 按**锚点的祖先**算可用空间，而面板已经传送出去不在那条链上，实测把 `max-height` 算成 `minHeight`（96px，内容 384px）；nb-ui 的 `useAnchoredPopup` 也没有重锚 API（组间切换要换锚点），见 `tasks/t50-browser-titlebar/walkthroughs/implementation.md` 的偏差记录。
- 面 / 描边 / 圆角 / 阴影 / 磨砂由 nb-ui 浮层基座负责（`.nb-ui-popover-surface` + `.nb-ui-menu-surface`），内边距等于基座的 `--nb-popover-pad`；浮层层级 1001 与标题栏的 1000 一起登记在这里——nb-ui 明确「z-index 不是主题语义」。

## 不支持

- 不支持自定义菜单表：四组窗口菜单（File / Edit / View / Help）是产品 IA，调用方只能接命令 id，能改的只有 `capabilities` 与 `projectUrl`。
- 不判断宿主形态：桌面 / 浏览器、菜单归谁、窗口按钮归谁全部由 props 决定，组件内不看任何全局对象（既不读 bridge，也不嗅探 UA）。
- 不做窗口拖动本身：拖拽区只挂 `-webkit-app-region` / `data-tauri-drag-region`，真正的拖动由宿主环境完成。
- 不做命令执行：只发 `invoke-command` / `select-project`，跑什么由宿主与页面决定。

## 注意事项

- 这是一条**固定高度的横向 chrome**：调用方不要给它外层 padding，也不要在它两侧加装饰线——它自己带一条底部缝（`--divider`）。
- 浮层传送到 body 后不在本组件的子树里，**outside 判定、键盘遍历与焦点归还都按节点亲缘自己判**（`data-titlebar-menu-panel` 是它们的锚点）。
- 宿主仍然负责菜单命令的实际执行、外观上报与 Project 切换；浏览器没有桌面宿主时，命令走页面登记的回调（`WorkbenchChromeRegistration.invokeMenuCommand`）。
- 主题切换只需要换变量：组件里除窗口几何与量测占位外没有字面值，颜色 / 圆角 / 字号 / 字重 / 控件高 / 间距全部取 nb-ui 变量。
