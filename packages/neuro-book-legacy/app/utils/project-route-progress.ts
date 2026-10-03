import type {ProjectSessionState} from "nbook/app/composables/useProjectSession";

/** Project 冷切换的用户可见阶段，顺序同时代表确定进度的步骤顺序。 */
export const PROJECT_ROUTE_PROGRESS_PHASES = [
    "preparing",
    "opening-project",
    "connecting-presence",
    "syncing-project",
    "loading-tree",
    "restoring-content",
] as const;

export type ProjectRouteProgressPhase = typeof PROJECT_ROUTE_PROGRESS_PHASES[number];

export type ProjectRouteProgress =
    | Readonly<{kind: "project"; revision: number; phase: ProjectRouteProgressPhase}>
    | Readonly<{kind: "other"; revision: number}>;

export type ProjectRouteProgressAction =
    | Readonly<{type: "start"; revision: number; kind: "project" | "other"}>
    | Readonly<{type: "advance"; revision: number; phase: ProjectRouteProgressPhase}>
    | Readonly<{type: "clear"; revision: number}>
    | Readonly<{type: "clear-through"; revision: number}>;

export type ProjectLoadingTitleKey = "openingTitle" | "switchingTitle";

export type ProjectLoadingLabelKey =
    | "switching"
    | "preparing"
    | "openingProject"
    | "connectingPresence"
    | "syncingProject"
    | "loadingTree"
    | "restoringContent"
    | "reconnectWaiting"
    | "reconnectOpening"
    | "reconnectConnecting";

export type ProjectLoadingDeterminateLabelKey = Exclude<
    ProjectLoadingLabelKey,
    "switching" | "reconnectWaiting" | "reconnectOpening" | "reconnectConnecting"
>;

export type ProjectRouteProgressView =
    | Readonly<{
        mode: "determinate";
        titleKey: "openingTitle";
        labelKey: ProjectLoadingDeterminateLabelKey;
        current: number;
        total: typeof PROJECT_ROUTE_PROGRESS_PHASES["length"];
    }>
    | Readonly<{
        mode: "indeterminate";
        titleKey: ProjectLoadingTitleKey;
        labelKey: ProjectLoadingLabelKey;
    }>;

/** 返回阶段对应的确定进度步骤，步骤从 1 开始。 */
export function projectRouteProgressStep(phase: ProjectRouteProgressPhase): number {
    return PROJECT_ROUTE_PROGRESS_PHASES.indexOf(phase) + 1;
}

/** 以 latest-wins 和阶段单调递增规则维护 Project route progress。 */
export function reduceProjectRouteProgress(
    state: ProjectRouteProgress | null,
    action: ProjectRouteProgressAction,
): ProjectRouteProgress | null {
    if (action.type === "start") {
        if (state && state.revision >= action.revision) return state;
        return action.kind === "project"
            ? {kind: "project", revision: action.revision, phase: "preparing"}
            : {kind: "other", revision: action.revision};
    }

    if (!state) return state;
    if (action.type === "clear-through") {
        return state.revision <= action.revision ? null : state;
    }
    if (state.revision !== action.revision) return state;
    if (action.type === "clear") return null;
    if (state.kind !== "project") return state;
    if (projectRouteProgressStep(action.phase) <= projectRouteProgressStep(state.phase)) return state;
    return {...state, phase: action.phase};
}

/** 把 Session 状态与已提交的 route phase 投影成遮罩显示状态。 */
export function projectRouteProgressView(input: Readonly<{
    sessionState: ProjectSessionState;
    progress: ProjectRouteProgress | null;
    currentRevision: number;
}>): ProjectRouteProgressView {
    const sessionState = input.sessionState;
    if (sessionState.status === "reconnecting") {
        const labelKey = sessionState.phase === "waiting-reconnect"
            ? "reconnectWaiting"
            : sessionState.phase === "opening-project"
                ? "reconnectOpening"
                : "reconnectConnecting";
        return {mode: "indeterminate", titleKey: "openingTitle", labelKey};
    }

    const progress = input.progress;
    if (!progress || progress.kind !== "project" || progress.revision !== input.currentRevision) {
        return sessionState.status === "opening"
            ? {
                mode: "indeterminate",
                titleKey: "openingTitle",
                labelKey: sessionState.phase === "opening-project" ? "openingProject" : "connectingPresence",
            }
            : {mode: "indeterminate", titleKey: "switchingTitle", labelKey: "switching"};
    }

    const labelByPhase: Record<ProjectRouteProgressPhase, ProjectLoadingDeterminateLabelKey> = {
        preparing: "preparing",
        "opening-project": "openingProject",
        "connecting-presence": "connectingPresence",
        "syncing-project": "syncingProject",
        "loading-tree": "loadingTree",
        "restoring-content": "restoringContent",
    };
    return {
        mode: "determinate",
        titleKey: "openingTitle",
        labelKey: labelByPhase[progress.phase],
        current: projectRouteProgressStep(progress.phase),
        total: PROJECT_ROUTE_PROGRESS_PHASES.length,
    };
}
