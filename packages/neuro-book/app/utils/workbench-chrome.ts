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
            {id: "home" as const, disabled: false},
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
