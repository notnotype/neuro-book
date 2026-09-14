---
标签: [state:local]
---

# DesktopTitleBarChrome

自绘标题栏的 chrome 本体：品牌、窗口菜单、Project 切换、搜索占位、Agent 按钮与自绘窗口按钮。**它只把 chrome 画出来并发出意图，不接触任何平台边界**——桌面 bridge 状态、菜单命令的实际派发、外观上报、Project 切换都归宿主 `DesktopTitleBar.vue`。这条分工是本组件能被 Lab 完整表达的原因：给它一组内存数据就能渲染，不需要 bridge 桩，也不需要真实 Project。

它和「自绘一个菜单栏」的区别是**它已经把桌面两态收进 props**：菜单由渲染进程画还是归操作系统（`rendererMenus`）、窗口按钮由谁画（`customWindowControls`）、连接方式（`connection`）都从外面进来。少了任何一个，组件就得自己判断宿主是桌面还是浏览器——那样它就不能在 Lab 里跑。

打开的分组是**受控值**（`openMenu` + `update:openMenu`）：连「点组件外把菜单收起」也归宿主，组件不注册全局监听。

## 数据

```ts
type TitleBarMenuItem = Readonly<{
    label: string;
    /** 契约里的命令 id；组件只发 id，不执行。 */
    command: DesktopMenuCommandId;
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
    /** 有 Project surface 时 Agent 按钮才可点。 */
    surfaceActive: boolean;
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
    /** Project 项被选中；`null` 表示「我的书架」。 */
    (e: "select-project", projectRoot: string | null): void;
    (e: "toggle-agent-panel"): void;
    (e: "window-command", command: "minimize" | "toggle-maximize" | "close"): void;
};
```

**扩展面**：没有 slot；没有 `expose`；`attrs` 透传到根元素（Lab 的 `data-lab-subject` 走这条）。

## 交互

- 点菜单按钮开/关自己那一组；点 Project 按钮开/关书架切换；一次只开一组。
- 键盘：`ArrowDown` / `Enter` / `Space` 打开并聚焦首项，`ArrowUp` 打开并聚焦末项，组内 `ArrowUp` / `ArrowDown` 循环，`ArrowLeft` / `ArrowRight` 跨组切换，`Escape` 关闭并把焦点还给触发按钮。
- 点组件外收起菜单**不在这里**：宿主拿根元素接自己的 outside 判定，组件保持零全局监听。
- Agent 按钮在 `surfaceActive` 为假时禁用（title 说明原因），点击只在可用时发出 `toggle-agent-panel`。
- 窗口按钮只发意图，最小化 / 最大化 / 关闭的执行在桌面宿主。

## 状态

- 菜单三态：完整菜单、紧凑菜单（一条 `compact` 按钮，下拉里按组分节）、不画菜单（`rendererMenus === false`，菜单在操作系统手里）。
- 窗口按钮：`customWindowControls === false` 时不画任何窗口按钮。
- Agent 按钮：`agentPanelAvailable === false` 不画；`agentPanelOpen` 时高亮（`aria-pressed` 同步）；连接点在 `connection === null` 时不画，`remote` 用信息色、`local` 用成功色。
- 搜索占位常驻禁用（`disabled` + title / aria-label 说明「后续版本提供」），不代表任何可执行动作。

## 布局

一条 36px 高的横条，内部三块：`leading`（品牌 / 菜单 / Project 切换）、`center`（搜索占位，同时是窗口拖拽区）、`controls`（Agent 按钮，右端接自绘窗口按钮）。

- 伸缩顺序：`center` 是唯一吸收余量的块，两侧块固定；`leading` 里的品牌名最先让位，然后收 Project 标题与搜索框宽度，最后整块隐去搜索（`<= 960px` 与 `<= 720px` 两档）。
- 菜单是完整还是紧凑档由实测宽度决定（`resolveTitleBarMenuPresentation`）：组件里有三个 `aria-hidden` 的量测盒，量完整菜单、中心标题、右侧控件的宽度；量测盒的字号与内边距与真实控件同源，换主题换了密度也不会量错。
- 菜单下拉是绝对定位（`top: calc(100% + var(--space-2))`），贴着按钮展开、宽度自适应内容，Project 下拉上限 `min(360px, 100vw - 32px)`。
- 窗口高 36、窗口按钮 46 宽是**产品 IA 常量**（同源数字在 `app/utils/workbench/layout.ts`），不是主题 token。

## 不支持

- 不支持自定义菜单表：四组窗口菜单（File / Edit / View / Help）是产品 IA，调用方只能接命令 id。
- 不 Teleport 下拉：下拉在组件树内绝对定位（见「注意事项」的裁剪前提）。
- 不判断宿主形态：桌面/浏览器、菜单归谁、窗口按钮归谁全部由 props 决定，组件内不看任何全局对象。
- 不做窗口拖动本身：拖拽区只挂 `-webkit-app-region` / `data-tauri-drag-region`，真正的拖动由宿主环境完成。

## 注意事项

- 这是一条**固定高度的横向 chrome**：调用方不要给它外层 padding，也不要在它两侧加装饰线——它自己带一条底部缝（`--divider`）。
- 祖先链上任何 `overflow: hidden` / `auto` 都会把菜单下拉裁掉（它必须伸到 36px 之外）。主页面外壳的 titlebar 叶当前就有这个已知缺陷：DOM 里有下拉、命中区也在，但看不见。
- 宿主必须自己处理「点组件外收起菜单」，并且记住菜单的实际执行、外观上报、Project 切换都不在本组件里。
- 主题切换只需要换变量：组件里除窗口几何与量测占位外没有字面值，颜色/圆角/字号/字重/控件高/间距全部取 nb-ui 变量。
