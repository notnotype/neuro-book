import type {ProjectMutationCommitState} from "nbook/app/utils/project-mutation-error";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

export type ProjectCoverRecoveryEntry = Readonly<{
    attempt: number;
    commitState: Exclude<ProjectMutationCommitState, false>;
    /** 最近一次 snapshot 刷新失败详情；空字符串表示尚未失败。 */
    error: string;
}>;

export type ProjectCoverRecoveryState = ReadonlyMap<string, ProjectCoverRecoveryEntry>;

export type ProjectCoverRecoveryAction =
    | Readonly<{
        type: "begin";
        projectRoot: string;
        attempt: number;
        commitState: Exclude<ProjectMutationCommitState, false>;
    }>
    | Readonly<{
        type: "failure";
        projectRoot: string;
        attempt: number;
        error: string;
    }>
    | Readonly<{type: "clear-all"}>;

export type ProjectCoverRecoveryFocus =
    | Readonly<{kind: "none"}>
    | Readonly<{kind: "missing"; projectRoot: string}>
    | Readonly<{kind: "committed"; project: ProjectMetadataDto}>
    | Readonly<{kind: "unknown"; project: ProjectMetadataDto}>;

export type ProjectCoverRecoverySettlement = Readonly<{
    state: ProjectCoverRecoveryState;
    cacheBustRoots: readonly string[];
    focused: ProjectCoverRecoveryFocus;
}>;

/**
 * 以不可变 Map 维护 Project 级封面恢复门禁。
 * 完整 Project snapshot 是全部记录的共同恢复事实，因此 clear-all 一次清空。
 */
export function reduceProjectCoverRecovery(
    state: ProjectCoverRecoveryState,
    action: ProjectCoverRecoveryAction,
): ProjectCoverRecoveryState {
    if (action.type === "clear-all") {
        return new Map();
    }
    const next = new Map(state);
    if (action.type === "begin") {
        next.set(action.projectRoot, {attempt: action.attempt, commitState: action.commitState, error: ""});
        return next;
    }
    const current = next.get(action.projectRoot);
    if (current?.attempt === action.attempt) {
        next.set(action.projectRoot, {...current, error: action.error});
    }
    return next;
}

/**
 * 用完整 Project snapshot 一次结算全部封面恢复门禁。
 * requestedProjectRoot 是请求发起时捕获的目标；activeProjectRoot 用于阻止迟到结果串入其它 Dialog。
 */
export function settleProjectCoverRecoverySnapshot(input: Readonly<{
    /** snapshot 返回时的最新恢复记录。 */
    state: ProjectCoverRecoveryState;
    /** snapshot 请求发起时捕获的恢复记录。 */
    capturedState: ProjectCoverRecoveryState;
    projects: readonly ProjectMetadataDto[];
    requestedProjectRoot?: string;
    activeProjectRoot?: string;
}>): ProjectCoverRecoverySettlement {
    const projectsByRoot = new Map(input.projects.map((project) => [project.projectRoot, project]));
    const nextState = new Map(input.state);
    const cacheBustRoots: string[] = [];
    for (const [projectRoot, captured] of input.capturedState) {
        if (nextState.get(projectRoot)?.attempt !== captured.attempt) {
            continue;
        }
        nextState.delete(projectRoot);
        if (projectsByRoot.has(projectRoot)) {
            cacheBustRoots.push(projectRoot);
        }
    }
    const requestedProjectRoot = input.requestedProjectRoot;
    if (!requestedProjectRoot || requestedProjectRoot !== input.activeProjectRoot) {
        return {state: nextState, cacheBustRoots, focused: {kind: "none"}};
    }
    const recovery = input.capturedState.get(requestedProjectRoot);
    if (!recovery || input.state.get(requestedProjectRoot)?.attempt !== recovery.attempt) {
        return {state: nextState, cacheBustRoots, focused: {kind: "none"}};
    }
    const project = projectsByRoot.get(requestedProjectRoot);
    if (!project) {
        return {
            state: nextState,
            cacheBustRoots,
            focused: {kind: "missing", projectRoot: requestedProjectRoot},
        };
    }
    return {
        state: nextState,
        cacheBustRoots,
        focused: recovery.commitState === true
            ? {kind: "committed", project}
            : {kind: "unknown", project},
    };
}
