---
标签: [state:local]
别名: ["桌面标题栏", "Title Bar", "Header", "Command Center"]
---

# DesktopTitleBarChrome

自绘标题栏的 chrome 本体：品牌、窗口菜单、书架直达、Project 切换、VS Code 风格居中命令搜索中心、布局控制工具组、Agent 按钮与自绘窗口按钮。**它只把 chrome 画出来并发出意图，不接触任何平台边界**——桌面 bridge 状态、菜单命令的实际派发、外观上报、Project 切换都归宿主 `DesktopTitleBar.vue`。这条分工是本组件能被 Lab 完整表达的原因：给它一组内存数据就能渲染，不需要 bridge 桩，也不需要真实 Project。

它和「自绘一个菜单栏」的区别是**它已经把宿主差异收进 props**：菜单由渲染进程画还是归操作系统（`rendererMenus`）、窗口按钮由谁画（`customWindowControls`）、连接方式（`connection`）、**宿主真实能力**（`capabilities`）都从外面进来。少了任何一个，组件就得自己判断宿主是桌面还是浏览器——那样它就不能在 Lab 里跑，也不该在浏览器里假装有桌面能力。

菜单的 enabled / visible **不由本组件拍**：`resolveTitleBarMenuGroups`（`app/utils/workbench-chrome.ts`）按 `capabilities` 生成——浏览器没有的桌面动作整条不画，焦点接不住的编辑动作画成禁用并写明原因，未接入的动作不会装成可用。

打开的分组是**受控值**（`openMenu` + `update:openMenu`）；「点组件外收起」由各浮层配合判定，因为下拉层被传送出了本组件的子树（见「布局」）。

## 架构与子模块拆分

为保持高内聚低耦合，组件拆分为以下位于 `app/components/desktop-title-bar/` 的独立子零件：

- **DesktopTitleBarBrand**: 品牌标识（羽毛笔徽标）与应用标题，具备窗口可拖拽表面（`data-tauri-drag-region`）；
- **DesktopTitleBarMenus**: 系统级菜单栏（File / Edit / View / Help），支持自动自适应降级为紧凑汉堡菜单（`compact`）；
- **DesktopTitleBarProjectSwitcher**: 包含**直达书架独立按钮**（一键返回书架）与**工程下拉切换器**（对标 FormSelect 视觉规范，同时提供当前标签切换和新标签打开复合动作）；
- **DesktopTitleBarCommandCenter**: 参考 VS Code 的 Command Center 居中命令搜索胶囊，实时显示当前上下文与快捷键徽标（`Ctrl P` / `⌘P`），点击一键激活 `WorkbenchCommandPalette`；
- **DesktopTitleBarActions**: 右侧工具栏，包含布局控制工具组（主侧栏/底部面板切换）与 Agent 侧栏开关 + 连接状态指示灯（本地绿 / 远程蓝）；
- **DesktopTitleBarWindowControls**: 46px 满高 Windows 系统绘制自绘窗口控制按钮（最小化 / 最大化 / 关闭）。

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

type DesktopTitleBarProps = {
    /** 中心拖拽区的 tooltip 文案（窗口标题）。 */
    title?: string;
    /** 已打开的书架条目；空数组表示只剩「我的书架」一项。 */
    projects?: readonly TitleBarProject[];
    /** 当前 Project；`null` 表示停在书架。 */
    currentProjectRoot?: string | null;
    /** 宿主真实能力：菜单 enabled / visible 的唯一来源。 */
    capabilities?: TitleBarHostCapabilities;
    /** 新标签打开用的标准 Project URL（`null` 表示书架）；传 `null` 表示宿主没有这条能力，入口整条不画。 */
    projectUrl?: ((projectRoot: string | null) => string) | null;
    /** 宿主是否具备 Agent 面板能力；没有则整个按钮不画。 */
    agentPanelAvailable?: boolean;
    agentPanelOpen?: boolean;
    /** 菜单由渲染进程画；false 表示菜单归操作系统。 */
    rendererMenus?: boolean;
    /** 窗口按钮由渲染进程画；false 表示交给系统标题栏。 */
    customWindowControls?: boolean;
    /** 连接状态；`null` 表示还没有状态，不画状态点。 */
    connection?: "local" | "remote" | null;
    /** 展开的分组：菜单组名 / `compact` / `project`；受控值，`null` 表示都收起。 */
    openMenu?: string | null;
    /** 布局控制：主侧栏与底部面板开关状态 */
    sidebarOpen?: boolean;
    bottomPanelOpen?: boolean;
};

type DesktopTitleBarEmits = {
    (e: "update:openMenu", value: string | null): void;
    (e: "invoke-command", command: DesktopMenuCommandId): void;
    (e: "select-project", projectRoot: string | null): void;
    (e: "toggle-agent-panel"): void;
    (e: "window-command", command: "minimize" | "toggle-maximize" | "close"): void;
    (e: "open-command-palette"): void;
    (e: "toggle-sidebar"): void;
    (e: "toggle-bottom-panel"): void;
};
```

## 交互与无障碍

- **书架直达**：点击左侧独立书架按钮一键触发 `select-project: null`，无需展开下拉菜单。
- **工程切换**：点击工程按钮展开浮层；支持键盘上下键循环选择、Enter / Space 激活；点击外部或按下 Escape 自动收起并把焦点归还给触发器。
- **新标签打开**：每条工程行右侧提供带有标准 Project URL 的 `<a target="_blank" rel="noopener noreferrer">` 链接，支持中键或右键在新标签页独立打开。
- **命令中心**：居中搜索胶囊点击后发出 `open-command-palette` 意图，自动呼出工作台全局命令面板并聚焦输入框。
- **菜单导航**：`ArrowDown` / `Enter` / `Space` 打开并聚焦首项，组内循环遍历并自动跳过所有禁用项；`ArrowLeft` / `ArrowRight` 跨组切换；所有禁用项提供清晰 title 解释不可用原因。
- **防选区丢失**：触发按钮与菜单项均挂载 `@mousedown.prevent`，鼠标交互时底层编辑器选区不被破坏。

## 布局与 UI 设计规范

- **高度**：标准 36px 高度横条（由产品几何常量 `SHELL_TITLEBAR_HEIGHT` 驱动，绑定 `--workbench-titlebar-height`）。
- **控件尺寸与圆角**：
  - 内部按钮与选择器遵循主题 `--control-h-sm`（24px）；
  - 控件圆角统一使用主题 `--radius-control`（6px）；
  - 底部状态栏对齐 VS Code 极简风格，使用 2px 微圆角与容器 0 圆角；
  - Windows 系统控制按钮采用 46px 满高标准规范。
- **响应式伸缩**：
  - 居中 Command Center 吸收多余空间；
  - 屏幕宽度 <= 960px 时隐藏品牌文字、压缩工程选择器与搜索框宽度；
  - 屏幕宽度 <= 720px 时隐藏搜索胶囊，并将全量菜单栏自适应折叠为单汉堡紧凑菜单。
- **浮层体系**：所有下拉菜单均通过 `<Teleport to="body">` 挂载，彻底摆脱祖先链 `overflow: hidden` 裁剪；样式统一消费 `.nb-ui-popover-surface` 与 `.nb-ui-menu-surface`，内边距严格保持 `--nb-popover-pad`（6px）。
