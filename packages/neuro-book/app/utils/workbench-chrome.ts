import type {DesktopMenuCommandId} from "@notnotype/neuro-book-contracts/desktop";

export type TitleBarMenuPresentation = "full" | "compact";

export type TitleBarMenuMeasurements = Readonly<{
    availableWidth: number;
    fullMenuWidth: number;
    titleWidth: number;
    controlsWidth: number;
}>;

export const MINIMUM_TITLE_BAR_DRAG_WIDTH = 120;

export type WorkbenchActivityItemId =
    | "home"
    | "files"
    | "characters"
    | "plot"
    | "world"
    | "trace"
    | "history"
    | "agent-panel"
    | "account"
    | "settings";

export type WorkbenchActivityItem = Readonly<{
    id: WorkbenchActivityItemId;
    disabled: boolean;
}>;

export type WorkbenchActivityContext = Readonly<{
    desktopAvailable: boolean;
    surfaceActive: boolean;
    userAssetsMode: boolean;
}>;

export type WorkbenchActivityItems = Readonly<{
    primary: WorkbenchActivityItem[];
    secondary: WorkbenchActivityItem[];
    agentPanel: WorkbenchActivityItem | null;
    footer: WorkbenchActivityItem[];
}>;

export type ActivityBarSecondaryMeasurements = Readonly<{
    availableHeight: number;
    fixedHeight: number;
    itemHeight: number;
    moreButtonHeight: number;
}>;

/** 保证完整菜单不会挤掉标题栏的最小可拖动区域。 */
export function resolveTitleBarMenuPresentation(
    measurements: TitleBarMenuMeasurements,
): TitleBarMenuPresentation {
    const requiredWidth = measurements.fullMenuWidth
        + measurements.titleWidth
        + measurements.controlsWidth
        + MINIMUM_TITLE_BAR_DRAG_WIDTH;
    return measurements.availableWidth >= requiredWidth ? "full" : "compact";
}

/** 返回各宿主共享的 Activity Bar 能力；组件只负责图标、文案和事件。 */
export function createWorkbenchActivityItems(
    context: WorkbenchActivityContext,
): WorkbenchActivityItems {
    const projectDisabled = !context.surfaceActive;
    const novelOnlyDisabled = projectDisabled || context.userAssetsMode;
    return {
        primary: [
            ...(!context.desktopAvailable ? [{id: "home" as const, disabled: false}] : []),
            {id: "files", disabled: projectDisabled},
            {id: "characters", disabled: novelOnlyDisabled},
            {id: "plot", disabled: novelOnlyDisabled},
            {id: "world", disabled: novelOnlyDisabled},
        ],
        secondary: [
            {id: "trace", disabled: projectDisabled},
            {id: "history", disabled: novelOnlyDisabled},
        ],
        agentPanel: context.desktopAvailable
            ? null
            : {id: "agent-panel", disabled: projectDisabled},
        footer: [
            {id: "account", disabled: false},
            {id: "settings", disabled: false},
        ],
    };
}

/**
 * 次要入口只在放不下时进入 More。只要存在 overflow，就先为 More 预留一个完整按钮位。
 */
export function resolveActivityBarSecondaryItems<T>(
    items: readonly T[],
    measurements: ActivityBarSecondaryMeasurements,
): {visible: T[]; overflow: T[]} {
    if (items.length === 0) {
        return {visible: [], overflow: []};
    }
    const itemHeight = Math.max(1, measurements.itemHeight);
    const remainingHeight = Math.max(0, measurements.availableHeight - measurements.fixedHeight);
    const fullCapacity = Math.floor(remainingHeight / itemHeight);
    if (fullCapacity >= items.length) {
        return {visible: [...items], overflow: []};
    }
    const visibleCapacity = Math.max(
        0,
        Math.floor((remainingHeight - measurements.moreButtonHeight) / itemHeight),
    );
    return {
        visible: items.slice(0, visibleCapacity),
        overflow: items.slice(visibleCapacity),
    };
}

/**
 * 标题栏菜单的**能力模型**。
 *
 * 产品 IA 固定四组（File / Edit / View / Help），调用方只能接命令 id；**能不能执行由宿主真实能力决定**：
 * 没有桌面桥接就不是桌面（退出应用、桌面缩放不画），焦点不在可编辑处就没有编辑动作（不把 Studio 的
 * undo 冒充所有输入框的 undo），未接入的动作一律禁用并说明原因，不画成可用。
 */
export type TitleBarEditTarget = "none" | "native" | "editor";

/** 编辑组里的六条命令。 */
export const TITLE_BAR_EDIT_COMMANDS = [
    "edit.undo",
    "edit.redo",
    "edit.cut",
    "edit.copy",
    "edit.paste",
    "edit.select-all",
] as const;

export type TitleBarEditCommand = (typeof TITLE_BAR_EDIT_COMMANDS)[number];

/** 编辑命令的执行去处：Studio 会话 / 原生编辑命令 / 当前焦点接不住。 */
export type TitleBarEditRoute = "studio" | "native" | "unavailable";

export type TitleBarHostCapabilities = Readonly<{
    /** 桌面桥接在场：退出应用、窗口控制与系统缩放由宿主进程负责。 */
    desktop: boolean;
    /** 当前有打开的 Project 工作面（文件动作的前提）。 */
    surfaceActive: boolean;
    /** 焦点目前能承接的编辑目标。 */
    editTarget: TitleBarEditTarget;
}>;

export type TitleBarMenuItemModel = Readonly<{
    label: string;
    command: DesktopMenuCommandId;
    disabled: boolean;
    /** 禁用原因（画成 title）：禁用项必须能回答「为什么不能点」。 */
    disabledReason: string | null;
}>;

export type TitleBarMenuGroupModel = Readonly<{
    label: string;
    items: readonly TitleBarMenuItemModel[];
}>;

/** 编辑命令的成员判定：菜单模型按它决定走「编辑去处」还是普通命令语义。 */
export function isTitleBarEditCommand(command: DesktopMenuCommandId): command is TitleBarEditCommand {
    return (TITLE_BAR_EDIT_COMMANDS as readonly string[]).includes(command);
}

/**
 * 焦点事实 → 编辑目标。**判据只看真实焦点**，不看「哪个编辑器更常被用到」：
 *
 * - Studio 的 source / preview 编辑器在焦点上时归 `editor`（它的 undo 走会话，不是 execCommand）；
 * - 其它 input / textarea / select / contenteditable 归 `native`（原生编辑命令）；
 * - 焦点在按钮、正文或 body 上时归 `none`——这时没有编辑动作可执行。
 */
export function resolveTitleBarEditTarget(
    activeElement: Element | null,
    editorFocused: boolean,
): TitleBarEditTarget {
    if (editorFocused) {
        return "editor";
    }
    if (activeElement === null) {
        return "none";
    }
    const doc = activeElement.ownerDocument;
    if (activeElement === doc.body || activeElement === doc.documentElement) {
        return "none";
    }
    const tag = activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return "native";
    }
    // `isContentEditable` 是浏览器的权威判据；`closest` 兜住「焦点落在 contenteditable 的子节点上」
    // 与不实现该属性的 DOM 环境（jsdom）。
    if (activeElement instanceof HTMLElement && activeElement.isContentEditable) {
        return "native";
    }
    return activeElement.closest('[contenteditable="true"], [contenteditable=""]') !== null ? "native" : "none";
}

/** 编辑目标的最终判定：标题栏拿走焦点时沿用记忆值，否则用此刻的真实焦点。 */
export function resolveEffectiveTitleBarEditTarget(input: {
    liveTarget: TitleBarEditTarget;
    rememberedTarget: TitleBarEditTarget | null;
    titleBarOwnsFocus: boolean;
}): TitleBarEditTarget {
    if (input.liveTarget !== "none") {
        return input.liveTarget;
    }
    return input.titleBarOwnsFocus ? input.rememberedTarget ?? "none" : "none";
}

/** 标题栏 chrome 与它 Teleport 出去的下拉层：焦点落在这里时不该把编辑目标抹成 none。 */
export const TITLE_BAR_FOCUS_SELECTOR = ".desktop-title-bar, [data-titlebar-menu-panel]";

/** 焦点是否在标题栏（含下拉层）里。 */
export function isTitleBarFocusOwner(activeElement: Element | null): boolean {
    if (activeElement === null || typeof activeElement.closest !== "function") {
        return false;
    }
    return activeElement.closest(TITLE_BAR_FOCUS_SELECTOR) !== null;
}

/** 一条编辑命令现在该往哪里执行；`unavailable` 表示菜单项必须禁用。 */
export function resolveTitleBarEditRoute(
    command: TitleBarEditCommand,
    capabilities: TitleBarHostCapabilities,
): TitleBarEditRoute {
    if (capabilities.editTarget === "none") {
        return "unavailable";
    }
    if (command === "edit.undo" || command === "edit.redo") {
        return capabilities.editTarget === "editor" ? "studio" : "native";
    }
    if (command === "edit.paste") {
        // 浏览器不允许页面代替用户读剪贴板：这条动作只有桌面宿主能真正执行。
        return capabilities.desktop ? "native" : "unavailable";
    }
    return "native";
}

type TitleBarMenuDefinition = Readonly<{
    label: string;
    items: readonly Readonly<{
        command: DesktopMenuCommandId;
        label: string;
        /** 只有桌面桥接能执行：浏览器里整条不画。 */
        desktopOnly?: boolean;
        /** 需要打开的 Project 才可执行：没工作面时画成禁用。 */
        requiresSurface?: boolean;
    }>[];
}>;

/** 四组窗口菜单的**固定 IA**：调用方给不了别的表，只能按能力裁剪 enabled / visible。 */
const TITLE_BAR_MENU_IA: readonly TitleBarMenuDefinition[] = [
    {
        label: "File",
        items: [
            {command: "file.open", label: "打开文件", requiresSurface: true},
            {command: "file.settings", label: "设置"},
            {command: "file.quit", label: "退出应用", desktopOnly: true},
        ],
    },
    {
        label: "Edit",
        items: [
            {command: "edit.undo", label: "撤销"},
            {command: "edit.redo", label: "重做"},
            {command: "edit.cut", label: "剪切"},
            {command: "edit.copy", label: "复制"},
            {command: "edit.paste", label: "粘贴"},
            {command: "edit.select-all", label: "全选"},
        ],
    },
    {
        label: "View",
        items: [
            {command: "view.reload", label: "重新载入"},
            {command: "view.zoom-in", label: "放大", desktopOnly: true},
            {command: "view.zoom-out", label: "缩小", desktopOnly: true},
            {command: "view.zoom-reset", label: "重置缩放", desktopOnly: true},
        ],
    },
    {
        label: "Help",
        items: [
            {command: "help.documentation", label: "文档"},
            {command: "help.about", label: "关于 NeuroBook"},
        ],
    },
];

/** 按宿主能力生成菜单：不可执行的动作要么不画（宿主根本没有这个能力），要么禁用并说明原因。 */
export function resolveTitleBarMenuGroups(
    capabilities: TitleBarHostCapabilities,
): readonly TitleBarMenuGroupModel[] {
    return TITLE_BAR_MENU_IA.map((group) => ({
        label: group.label,
        items: group.items.flatMap<TitleBarMenuItemModel>((item) => {
            if (item.desktopOnly === true && !capabilities.desktop) {
                return [];
            }
            if (isTitleBarEditCommand(item.command)) {
                const available = resolveTitleBarEditRoute(item.command, capabilities) !== "unavailable";
                // 禁用原因要区分「焦点不在可编辑处」与「浏览器执行不了」：两种情况用户的下一步不同。
                const pasteBlockedByBrowser = item.command === "edit.paste" && !capabilities.desktop;
                return [{
                    label: item.label,
                    command: item.command,
                    disabled: !available,
                    disabledReason: available
                        ? null
                        : pasteBlockedByBrowser
                            ? "浏览器不允许页面代替你粘贴，请用 Ctrl+V"
                            : "请先把光标放进编辑器或输入框",
                }];
            }
            const disabled = item.requiresSurface === true && !capabilities.surfaceActive;
            return [{
                label: item.label,
                command: item.command,
                disabled,
                disabledReason: disabled ? "请先打开一个 Project" : null,
            }];
        }),
    }));
}
