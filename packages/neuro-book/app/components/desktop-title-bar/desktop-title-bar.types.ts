import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";
import type {TitleBarHostCapabilities, TitleBarMenuPresentation} from "nbook/app/utils/workbench-chrome";

/** 窗口按钮命令。属系统绘制物，不由主题决定。 */
export type TitleBarWindowCommand = "minimize" | "toggle-maximize" | "close";

export type TitleBarProject = Readonly<{
    projectRoot: string;
    title: string;
}>;

export type DesktopTitleBarProps = {
    /** 中心拖拽区的 tooltip 文案（窗口标题）。 */
    title?: string;
    /** 已打开的书架条目；空数组表示只有「我的书架」。 */
    projects?: readonly TitleBarProject[];
    /** 当前 Project；`null` 表示停在书架。 */
    currentProjectRoot?: string | null;
    /** 宿主真实能力：菜单 enabled / visible 由它映射，缺省即没有能力。 */
    capabilities?: TitleBarHostCapabilities;
    /**
     * 新标签打开使用的标准 Project URL（`null` 表示书架）。
     * `null` 表示宿主没有这个能力——整条入口不画，不做假链接。
     */
    projectUrl?: ((projectRoot: string | null) => string) | null;
    /** 宿主是否具备 Agent 面板能力（没有则不画按钮）。 */
    agentPanelAvailable?: boolean;
    agentPanelOpen?: boolean;
    /** 菜单由 renderer 画；false 表示菜单归操作系统（渲染进程一个菜单都不画）。 */
    rendererMenus?: boolean;
    /** 窗口按钮由 renderer 画；false 表示系统标题栏负责。 */
    customWindowControls?: boolean;
    /** 连接状态；`null` 表示还没有状态，不画状态点。 */
    connection?: "local" | "remote" | null;
    /** 展开的分组：菜单组名 / `compact` / `project`；`null` 表示都收起。 */
    openMenu?: string | null;
    /** 菜单表现形式（'full' 横向平铺一级菜单，'compact' 紧凑汉堡菜单，不传则自适应） */
    presentation?: TitleBarMenuPresentation;
    /** 当前激活的侧栏/面板状态（用于 VS Code 风格布局切换指示） */
    sidebarOpen?: boolean;
    bottomPanelOpen?: boolean;
};

export type DesktopTitleBarEmits = {
    (e: "update:openMenu", value: string | null): void;
    (e: "invoke-command", command: DesktopMenuCommandId): void;
    (e: "select-project", projectRoot: string | null): void;
    (e: "toggle-agent-panel"): void;
    (e: "window-command", command: TitleBarWindowCommand): void;
    (e: "open-command-palette"): void;
    (e: "toggle-sidebar"): void;
    (e: "toggle-bottom-panel"): void;
};
