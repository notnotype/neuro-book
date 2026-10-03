import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";
import type {ProjectMutationCommitState} from "nbook/app/utils/project-mutation-error";

export type ProjectPickerRecoveryEntry = Readonly<{
    attempt: number;
    commitState: Exclude<ProjectMutationCommitState, false>;
    /** snapshot 刷新失败详情；空字符串表示尚未失败。 */
    error: string;
}>;

export type ProjectPickerRecoveryState = Readonly<{
    create: ProjectPickerRecoveryEntry | null;
    deletes: ReadonlyMap<string, ProjectPickerRecoveryEntry>;
}>;

export type ProjectPickerRecoveryTarget =
    | Readonly<{kind: "create"}>
    | Readonly<{kind: "delete"; projectRoot: string}>;

export type ProjectPickerRecoverySettlement = Readonly<{
    state: ProjectPickerRecoveryState;
    create: "none" | "committed" | "unknown";
    deletes: readonly Readonly<{
        projectRoot: string;
        outcome: "missing" | "present";
    }>[];
}>;

/** 创建空的 Picker mutation 恢复状态。 */
export function emptyProjectPickerRecovery(): ProjectPickerRecoveryState {
    return {create: null, deletes: new Map()};
}

/** 开始一个带单调 attempt 的 create/delete 恢复门禁。 */
export function beginProjectPickerRecovery(
    state: ProjectPickerRecoveryState,
    target: ProjectPickerRecoveryTarget,
    entry: Omit<ProjectPickerRecoveryEntry, "error">,
): ProjectPickerRecoveryState {
    const recovery = {...entry, error: ""};
    if (target.kind === "create") {
        return {create: recovery, deletes: state.deletes};
    }
    const deletes = new Map(state.deletes);
    deletes.set(target.projectRoot, recovery);
    return {create: state.create, deletes};
}

/** 只把刷新失败写入仍匹配的 attempt，迟到错误不能覆盖新恢复记录。 */
export function failProjectPickerRecovery(
    state: ProjectPickerRecoveryState,
    target: ProjectPickerRecoveryTarget,
    attempt: number,
    error: string,
): ProjectPickerRecoveryState {
    if (target.kind === "create") {
        return state.create?.attempt === attempt
            ? {create: {...state.create, error}, deletes: state.deletes}
            : state;
    }
    const current = state.deletes.get(target.projectRoot);
    if (current?.attempt !== attempt) {
        return state;
    }
    const deletes = new Map(state.deletes);
    deletes.set(target.projectRoot, {...current, error});
    return {create: state.create, deletes};
}

/**
 * 用完整 snapshot 结算请求发起时已存在、且返回时 attempt 仍相同的恢复记录。
 * 新 mutation 产生的记录留在 state 中，不能被旧 snapshot 清除。
 */
export function settleProjectPickerRecoverySnapshot(input: Readonly<{
    state: ProjectPickerRecoveryState;
    capturedState: ProjectPickerRecoveryState;
    projects: readonly ProjectMetadataDto[];
}>): ProjectPickerRecoverySettlement {
    const projectRoots = new Set(input.projects.map((project) => project.projectRoot));
    let create = input.state.create;
    let createOutcome: ProjectPickerRecoverySettlement["create"] = "none";
    if (input.capturedState.create && create?.attempt === input.capturedState.create.attempt) {
        createOutcome = input.capturedState.create.commitState === true ? "committed" : "unknown";
        create = null;
    }

    const deletes = new Map(input.state.deletes);
    const deleteOutcomes: Array<{projectRoot: string; outcome: "missing" | "present"}> = [];
    for (const [projectRoot, captured] of input.capturedState.deletes) {
        if (deletes.get(projectRoot)?.attempt !== captured.attempt) {
            continue;
        }
        deletes.delete(projectRoot);
        deleteOutcomes.push({
            projectRoot,
            outcome: projectRoots.has(projectRoot) ? "present" : "missing",
        });
    }

    return {
        state: {create, deletes},
        create: createOutcome,
        deletes: deleteOutcomes,
    };
}
