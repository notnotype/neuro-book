/**
 * 主工作台布局会话：把外壳的 grid、t44 持久化宿主、t47 迁移门禁与 Vue 消费接成一条线。
 *
 * 分工（合同见 `docs/specs/storage/persistence.md`「布局投影与保存反馈」、
 * `docs/specs/ui/workbench-shell.md`、`packages/neuro-book/docs/migrations/storage-state.md`）：
 *
 * - **记录路径**：Project 内左右栏尺寸是 grid 布局记录（t44 宿主负责恢复、原件合成与字段提交）；
 *   未开项目/用户资产尺寸是 `workbench.layout` 的 user/local 记录（本模块的通用记录会话）；
 *   面板尺寸（高度轴 + 宽度轴）是同一 owner 的独立记录（Project → `panel-size`，
 *   user 面 → `surface-panel-size`）。
 *   各路径共用同一套可见行为：首读门禁、只提交主动字段、冲突重读重放一次、失败保留意图与重试/放弃。
 * - **尺寸路由**：纯布局组件在自己的 renderGrid 上结算完整手势，只把落点 px 补丁交回来；本会话按
 *   字段拆路由——侧栏两个宽度进 Project grid（`commitFields`，落点是记录原件里的 `left`/`right` 叶）
 *   或 user 面的尺寸记录，面板两个轴进面板尺寸记录。一次补丁跨记录 owner 时拒绝，
 *   不实现未需求的多记录事务；补丁排队串行执行，同字段的后到意图覆盖先到意图。
 * - **工作面**：`idle` / `user-assets` / `project` 各用明确记录，不互相 fallback；切工作面先提交已接纳的
 *   尺寸意图并等待收口，再释放旧上下文。旧工作面已失效（Project 删除/断线）时不延迟切换。
 * - **迟到失败归属**：未保存意图与诊断都带工作面归属；旧工作面的迟到结果不会显示成新工作面的未保存状态。
 * - **迁移衔接**：迁移未完成时仍然只写新 authority（旧 writer 已在本增量退役），迁移自身的阻断
 *   用同一处反馈出口呈现，并给出 `retry()`（绑定 t47 的控制器）。
 *
 * 本模块不 import Pinia/Nuxt；Vue 反应式只用于把上面的状态交给组件消费。
 */
import {computed, onScopeDispose, readonly, ref, shallowRef, type ComputedRef, type Ref} from "vue";
import {
    type Grid,
    type GridAxis,
    type GridRefResolver,
} from "@notnotype/nb-ui/layout";
import {isStorageAdapterError} from "nbook/app/utils/storage/value-transport";
import type {StorageProjectContextTarget} from "nbook/app/utils/storage/host-context-client";
import {
    createWorkbenchStorageContext,
    type WorkbenchStorageAdapters,
    type WorkbenchStorageContext,
    type WorkbenchStorageOwnerHandle,
} from "nbook/app/utils/workbench/storage-context";
import {createGridLayoutHost, type GridLayoutHost} from "nbook/app/utils/workbench/storage-grid-host";
import {readShellPreferences, shellLayoutDefinition} from "nbook/app/utils/workbench/shell-layout";
import {
    clampPanelHeight,
    clampPanelWidth,
    SHELL_PANEL_DEFAULT_HEIGHT,
    SHELL_PANEL_DEFAULT_WIDTH,
    type ShellSizePatch,
    type ShellSizePreferences,
} from "nbook/app/utils/workbench/layout";
import {
    storageMigrationController,
    storageMigrationSnapshot,
    subscribeStorageMigration,
    type StorageMigrationBlockReason,
    type StorageMigrationPhase,
    type StorageMigrationSnapshot,
} from "nbook/app/utils/workbench/storage-migration";
import type {StorageCredential, StorageReadResult, StorageScope} from "nbook/shared/storage/contract";
import {isSafeStorageIdentifier, type DefinedStorageState} from "nbook/shared/storage/definition";
import {
    defineWorkbenchPanelSizeState,
    defineWorkbenchSurfacePanelSizeState,
    isWorkbenchPanelSizeValue,
    type WorkbenchPanelSize,
} from "nbook/shared/storage/workbench-panel-size";
import {projectStorageState, type StorageProjectedState} from "nbook/shared/storage/projection";
import {
    defineWorkbenchShelfModeState,
    defineWorkbenchSurfaceSizesState,
    isWorkbenchPanelWidth,
    WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH,
    WORKBENCH_LAYOUT_OWNER,
    WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH,
    type WorkbenchShelfMode,
    type WorkbenchSurfaceId,
    type WorkbenchSurfaceSizes,
} from "nbook/shared/storage/workbench-state";

/* -------------------------------------------------------------------------- */
/* 通用记录会话                                                                */
/* -------------------------------------------------------------------------- */

export type LayoutRecordPhase = "idle" | "loading" | "ready" | "invalidated" | "released";

/** 写入侧的结构化阻断原因；投影为 `confirmed` 但仍不可写时只有这里能表达。 */
export type LayoutRecordBlockReason = "unavailable" | "legacy-value" | "unsupported-version" | "corrupt" | "invalidated";

/** 一次本地意图的合成结果；`changed=false` 表示原件已经满足它，不写盘。 */
export type LayoutRecordIntent<T> = {
    readonly value: T;
    readonly changed: boolean;
    readonly diagnosis: string;
};

export type LayoutRecordPending<T> = {
    readonly value: T;
    readonly diagnosis: string;
    /** 上下文可用且记录可写时才可显式重试。 */
    readonly retryable: boolean;
};

export type LayoutRecordState<T> = {
    readonly phase: LayoutRecordPhase;
    readonly projection: StorageProjectedState<T> | null;
    /** 已确认值；缺失记录或不可读时是登记的默认值（只用于显示回落，不落盘）。 */
    readonly confirmed: T;
    /** 是否有已确认记录；缺失与删除标记都是 false（不补默认值记录）。 */
    readonly hasConfirmed: boolean;
    readonly writable: boolean;
    readonly blocked: LayoutRecordBlockReason | null;
    readonly pending: LayoutRecordPending<T> | null;
    readonly issues: readonly string[];
};

export type LayoutRecordCommitResult =
    | {readonly status: "saved"; readonly credential: StorageCredential}
    | {readonly status: "unchanged"; readonly diagnosis: string}
    | {readonly status: "unsaved"; readonly diagnosis: string}
    | {readonly status: "rejected"; readonly diagnosis: string};

export type LayoutRecordSessionOptions<T, I> = {
    /** 工作台借用的 owner 句柄；本模块不释放它，只借用 `read`/`save`/`subscribe`。 */
    readonly handle: WorkbenchStorageOwnerHandle;
    readonly definition: DefinedStorageState<T>;
    readonly resource?: string;
    /**
     * 把本地意图合成到已确认值上。
     *
     * `base` 为 `null` 表示**没有已确认记录**（缺失或删除标记）：此时只能写出本次主动的字段——
     * 把登记的默认值一起写成"已确认值"会让从未确认过的字段看起来有记录，也会挡住旧值迁移
     * （迁移的目标初始化是条件创建，先写默认值就等于宣称"用户已经定过这个字段"）。
     */
    compose: (base: T | null, intent: I) => LayoutRecordIntent<T>;
    /** 状态变化通知（含订阅更新）；调用方用它刷新可观察状态。 */
    onChange?: () => void;
};

export type LayoutRecordSession<T, I> = {
    readonly scope: StorageScope;
    state(): LayoutRecordState<T>;
    /** 当前显示 = 未确认意图优先，其次已确认值。 */
    display(): T;
    open(): Promise<LayoutRecordState<T>>;
    commit(intent: I): Promise<LayoutRecordCommitResult>;
    retry(): Promise<LayoutRecordCommitResult>;
    abandon(): void;
    release(): Promise<void>;
};

const CONFLICT_CODE = "STORAGE_REVISION_CONFLICT";
const MAX_ISSUES = 32;

type LayoutFailureReading = {
    readonly terminal: boolean;
    readonly conflict: boolean;
    /** 提交事实：`true` 已提交、`false` 明确拒绝、`null` 未确认（超时/断线）。 */
    readonly committed: boolean | null;
    readonly diagnosis: string;
};

/** t40 facade 在上下文失效时抛出的错误形状（`unavailableFailure`）；与 t44 宿主的判定同源。 */
function isContextUnavailable(error: unknown): boolean {
    if (typeof error !== "object" || error === null || !("storageContextUnavailable" in error)) {
        return false;
    }
    const value = (error as {storageContextUnavailable?: unknown}).storageContextUnavailable;
    return typeof value === "object"
        && value !== null
        && (value as {status?: unknown}).status === "unavailable";
}

/**
 * 失败分类。
 *
 * 句柄失效（上下文撤销、授权拒绝）按终止处理：停止接纳新提交，只留显示与诊断。
 * 其余错误没有提交事实的按未确认处理，交给重读核对，不谎报任何一种结果。
 */
function classifyLayoutFailure(error: unknown): LayoutFailureReading {
    const message = error instanceof Error ? error.message : String(error);
    if (isContextUnavailable(error)) {
        return {terminal: true, conflict: false, committed: false, diagnosis: `Storage 句柄已失效，不再接受布局提交：${message}`};
    }
    if (isStorageAdapterError(error)) {
        return {
            terminal: error.status === 401 || error.status === 403,
            conflict: error.code === CONFLICT_CODE,
            committed: error.committed,
            diagnosis: error.message,
        };
    }
    return {terminal: false, conflict: false, committed: null, diagnosis: message};
}

/**
 * 一条普通记录的单一写者会话。
 *
 * 与 t44 宿主同一套可见语义：首读门禁（未读到分类前拒绝提交）、条件保存、冲突后重读并只重放本次意图一次、
 * 二次冲突或失败保留未确认意图并暴露 `retry()`/`abandon()`、订阅只更新已确认基线。
 */
export function createLayoutRecordSession<T, I>(options: LayoutRecordSessionOptions<T, I>): LayoutRecordSession<T, I> {
    const {handle, definition, compose} = options;
    const resource = options.resource;
    if (handle.owner !== definition.owner) {
        throw new TypeError(`布局记录会话的句柄绑定 owner ${handle.owner}，不能访问 ${definition.owner} 的记录`);
    }
    if (definition.records === "identified" && resource === undefined) {
        throw new TypeError("identified 记录必须给出稳定资源标识");
    }
    if (definition.records === "single" && resource !== undefined) {
        throw new TypeError("single 记录不接受资源标识");
    }
    if (resource !== undefined && !isSafeStorageIdentifier(resource)) {
        throw new TypeError(`布局资源标识不是安全逻辑标识（服务端同样拒绝）：${resource}`);
    }

    const address = resource === undefined ? {} : {resource};
    let phase: LayoutRecordPhase = "idle";
    let projection: StorageProjectedState<T> | null = null;
    let confirmed: T = definition.defaultValue;
    let hasConfirmed = false;
    let writable = false;
    let blocked: LayoutRecordBlockReason | null = null;
    let credential: StorageCredential | null = null;
    /** 未确认意图：可重放（重读后按本次意图再合成一次）或显式放弃。 */
    let pendingIntent: I | null = null;
    let pending: LayoutRecordPending<T> | null = null;
    let issues: string[] = [];
    let subscription: {close(): Promise<void>} | null = null;
    let accepting = true;
    let openPromise: Promise<LayoutRecordState<T>> | null = null;
    let releasePromise: Promise<void> | null = null;
    const inFlight = new Set<Promise<unknown>>();

    const changed = (): void => {
        options.onChange?.();
    };

    const pushIssue = (diagnosis: string): void => {
        issues.push(diagnosis);
        if (issues.length > MAX_ISSUES) {
            issues = issues.slice(issues.length - MAX_ISSUES);
        }
    };

    const track = <R>(operation: Promise<R>): Promise<R> => {
        inFlight.add(operation);
        void operation.then(() => inFlight.delete(operation), () => inFlight.delete(operation));
        return operation;
    };

    const stateSnapshot = (): LayoutRecordState<T> => Object.freeze({
        phase,
        projection,
        confirmed,
        hasConfirmed,
        writable: phase === "ready" && writable,
        blocked,
        pending,
        issues: Object.freeze([...issues]),
    });

    const block = (reason: LayoutRecordBlockReason, diagnosis: string): void => {
        writable = false;
        blocked = reason;
        credential = null;
        pushIssue(diagnosis);
    };

    const acceptBaseline = (value: T, nextCredential: StorageCredential, present: boolean): void => {
        confirmed = value;
        hasConfirmed = present;
        credential = nextCredential;
        writable = true;
        blocked = null;
    };

    function stopSubscription(): void {
        const closing = subscription;
        subscription = null;
        if (closing === null) {
            return;
        }
        track(closing.close().catch((error: unknown) => {
            pushIssue(`关闭 Storage 订阅失败：${error instanceof Error ? error.message : String(error)}`);
        }));
    }

    const invalidate = (diagnosis: string): void => {
        if (phase === "released" || phase === "invalidated") {
            return;
        }
        phase = "invalidated";
        accepting = false;
        writable = false;
        credential = null;
        blocked = "invalidated";
        stopSubscription();
        pushIssue(diagnosis);
    };

    const keepPending = (intent: I, value: T, diagnosis: string, retryable: boolean): void => {
        if (phase === "released") {
            return;
        }
        pendingIntent = intent;
        pending = Object.freeze({value, diagnosis, retryable});
    };

    const clearPending = (): void => {
        pendingIntent = null;
        pending = null;
    };

    /**
     * 读取分类 → 已确认基线与显示。
     *
     * `value` 取原件（含未知字段）；缺失与删除标记回落默认值但保留凭据（首次写入是**创建**，不是覆盖）；
     * 损坏与未知版本保留原件、禁止普通保存。
     */
    const applyRead = (snapshot: StorageReadResult<T>): void => {
        projection = projectStorageState(definition, snapshot);
        switch (snapshot.kind) {
            case "value":
                acceptBaseline(snapshot.value, snapshot.credential, true);
                break;
            case "missing":
            case "deleted":
                // 删除标记是"用户重置过"的证据：显示回落默认值，写入仍走创建（不复活旧值）。
                acceptBaseline(definition.defaultValue, snapshot.credential, false);
                break;
            case "legacy-value":
                block("legacy-value", `记录仍是旧 schemaVersion ${String(snapshot.schemaVersion)}，需要显式迁移：原记录保留，普通保存被禁止`);
                break;
            case "unsupported-version":
                block("unsupported-version", `记录版本不受支持（封装 ${String(snapshot.wrapperVersion)}，schema ${String(snapshot.schemaVersion)}）：原记录保留，普通保存被禁止`);
                break;
            case "corrupt":
                block("corrupt", `记录损坏：${snapshot.diagnosis}；原记录保留，普通保存被禁止`);
                break;
        }
    };

    const unsaved = (diagnosis: string): LayoutRecordCommitResult => {
        pushIssue(diagnosis);
        return {status: "unsaved", diagnosis};
    };

    const submit = async (
        expected: StorageCredential,
        value: T,
        intent: I,
        autoReplay: boolean,
    ): Promise<LayoutRecordCommitResult> => {
        try {
            const next = await track(handle.save(definition, {expected, value, ...address}));
            acceptBaseline(value, next, true);
            clearPending();
            changed();
            return {status: "saved", credential: next};
        } catch (error) {
            const failure = classifyLayoutFailure(error);
            if (failure.terminal) {
                invalidate(failure.diagnosis);
                keepPending(intent, value, failure.diagnosis, false);
                changed();
                return unsaved(failure.diagnosis);
            }
            if (failure.conflict && autoReplay) {
                return await rereadAfterFailure(intent, "replay", "条件冲突后重读");
            }
            if (failure.committed === null) {
                return await rereadAfterFailure(intent, "reconcile", `保存结果未确认（${failure.diagnosis}）`);
            }
            keepPending(intent, value, failure.diagnosis, true);
            changed();
            return unsaved(failure.diagnosis);
        }
    };

    /**
     * 冲突重放、显式重试与未确认核对共用的重读路径。
     *
     * - `replay`：重读后只重放本次意图，再条件提交一次；
     * - `reconcile`：结果未确认时核对是否已经落地，不自动再提交，也不谎报已保存/未写入。
     */
    const rereadAfterFailure = async (
        intent: I,
        mode: "replay" | "reconcile",
        diagnosis: string,
    ): Promise<LayoutRecordCommitResult> => {
        let snapshot: StorageReadResult<T>;
        try {
            snapshot = await track(handle.read(definition, address));
        } catch (error) {
            const failure = classifyLayoutFailure(error);
            if (failure.terminal) {
                invalidate(failure.diagnosis);
            }
            const unresolved = `${diagnosis}；重读核对失败：${failure.diagnosis}`;
            keepPending(intent, pending?.value ?? confirmed, unresolved, false);
            changed();
            return unsaved(unresolved);
        }
        applyRead(snapshot);
        if (!writable || credential === null) {
            const unresolved = `${diagnosis}；重读发现记录不可用（${blocked ?? "unavailable"}），未确认调整不再自动重放`;
            keepPending(intent, pending?.value ?? confirmed, unresolved, false);
            changed();
            return unsaved(unresolved);
        }
        const composed = compose(hasConfirmed ? confirmed : null, intent);
        if (!composed.changed) {
            // 每个字段都落点且值已相同：视为目标已达成，不伪造某次历史请求的回执。
            clearPending();
            changed();
            return {status: "saved", credential};
        }
        if (mode === "reconcile") {
            const unresolved = `${diagnosis}；重读核对显示记录尚未包含本次意图，等待显式重试或放弃`;
            keepPending(intent, composed.value, unresolved, true);
            changed();
            return unsaved(unresolved);
        }
        return await submit(credential, composed.value, intent, false);
    };

    const commit = async (intent: I): Promise<LayoutRecordCommitResult> => {
        if (phase === "released" || phase === "invalidated" || !accepting) {
            return {status: "rejected", diagnosis: "布局记录会话已释放或失效，不能接受新提交"};
        }
        // 首读门禁：读到分类之前不开放持久化提交（呈现仍按产品默认值）。
        if (phase !== "ready") {
            return {status: "rejected", diagnosis: "记录尚未完成首次读取，不能提交"};
        }
        const composed = compose(hasConfirmed ? confirmed : null, intent);
        if (!composed.changed) {
            return {status: "unchanged", diagnosis: composed.diagnosis};
        }
        if (!writable || credential === null || blocked !== null) {
            const diagnosis = composed.diagnosis.length > 0
                ? composed.diagnosis
                : `记录不可普通保存（${blocked ?? "unavailable"}）：当前调整只留在本窗口`;
            keepPending(intent, composed.value, diagnosis, false);
            changed();
            return unsaved(diagnosis);
        }
        return await submit(credential, composed.value, intent, true);
    };

    const runOpen = async (): Promise<LayoutRecordState<T>> => {
        if (!accepting || phase === "released" || phase === "invalidated") {
            return stateSnapshot();
        }
        phase = "loading";
        try {
            const snapshot = await track(handle.read(definition, address));
            if (!accepting) {
                return stateSnapshot();
            }
            applyRead(snapshot);
        } catch (error) {
            const failure = classifyLayoutFailure(error);
            if (failure.terminal) {
                invalidate(failure.diagnosis);
                changed();
                return stateSnapshot();
            }
            block("unavailable", `读取记录失败，当前呈现保持产品默认：${failure.diagnosis}`);
        }
        if (!accepting) {
            return stateSnapshot();
        }
        if (subscription === null) {
            try {
                const opened = await track(handle.subscribe(definition, {
                    ...address,
                    onUpdate: (snapshot) => {
                        if (!accepting) {
                            return;
                        }
                        // 外来确认只更新已确认基线：不改变当前呈现，也不清除未确认意图。
                        applyRead(snapshot);
                        changed();
                    },
                    onError: (error) => {
                        if (!accepting) {
                            return;
                        }
                        const failure = classifyLayoutFailure(error);
                        if (failure.terminal) {
                            invalidate(failure.diagnosis);
                        } else {
                            pushIssue(`Storage 订阅故障：${failure.diagnosis}`);
                        }
                        changed();
                    },
                }));
                if (!accepting) {
                    stopSubscription();
                    return stateSnapshot();
                }
                subscription = opened;
                applyRead(opened.snapshot);
            } catch (error) {
                const failure = classifyLayoutFailure(error);
                if (failure.terminal) {
                    invalidate(failure.diagnosis);
                    changed();
                    return stateSnapshot();
                }
                pushIssue(`建立 Storage 订阅失败：${failure.diagnosis}`);
            }
        }
        if (phase === "loading") {
            phase = "ready";
        }
        changed();
        return stateSnapshot();
    };

    return {
        scope: definition.scope,

        state: stateSnapshot,

        display(): T {
            return pending === null ? confirmed : pending.value;
        },

        open(): Promise<LayoutRecordState<T>> {
            if (!accepting || phase === "released" || phase === "invalidated") {
                return Promise.resolve(stateSnapshot());
            }
            // 一次调用保证「已读取并已订阅」；读取没拿到分类或订阅没建立时保留重试入口。
            openPromise ??= runOpen().then((state) => {
                if (phase === "ready" && (projection === null || subscription === null)) {
                    openPromise = null;
                }
                return state;
            });
            return openPromise;
        },

        commit,

        async retry(): Promise<LayoutRecordCommitResult> {
            if (phase === "released" || phase === "invalidated" || !accepting) {
                return {status: "rejected", diagnosis: "布局记录会话已释放或失效，不能重试"};
            }
            if (pendingIntent === null) {
                return {status: "unchanged", diagnosis: "没有未确认的本地意图"};
            }
            // 显式重试先重读：读取失败留下的意图在记录可读之后仍能重放，不必让用户重拖一次。
            return await rereadAfterFailure(pendingIntent, "replay", "显式重试");
        },

        abandon(): void {
            if (pendingIntent === null) {
                return;
            }
            clearPending();
            changed();
        },

        release(): Promise<void> {
            releasePromise ??= (async () => {
                phase = "released";
                accepting = false;
                clearPending();
                const closing = subscription;
                subscription = null;
                const accepted = [...inFlight];
                const errors: unknown[] = [];
                if (closing !== null) {
                    try {
                        await closing.close();
                    } catch (error) {
                        errors.push(error);
                    }
                }
                const settled = await Promise.allSettled(accepted);
                for (const result of settled) {
                    if (result.status === "rejected") {
                        errors.push(result.reason);
                    }
                }
                if (errors.length > 0) {
                    throw new AggregateError(errors, "释放布局记录会话失败");
                }
            })();
            return releasePromise;
        },
    };
}

/* -------------------------------------------------------------------------- */
/* 工作面尺寸与书架模式                                                        */
/* -------------------------------------------------------------------------- */

export type WorkbenchLayoutSurfaceKind = "idle" | "user-assets" | "project";

export type WorkbenchLayoutSurface =
    | {readonly kind: "idle"}
    | {readonly kind: "user-assets"}
    | {readonly kind: "project"; readonly ready: Readonly<StorageProjectContextTarget & {readonly revision?: number}>};

/** 主动尺寸字段；只含用户实际改变的叶。 */
export type WorkbenchSurfaceSizesPatch = {readonly leftPanelWidth?: number; readonly agentPanelWidth?: number};

/**
 * 主动字段合成到读取时的原件（含未知字段）：非法值与未变化值都不落盘。
 *
 * `base` 为 null（没有已确认记录）时只写本次主动字段：两个字段都可缺省，缺省就是产品默认显示。
 */
function composeSurfaceSizes(base: WorkbenchSurfaceSizes | null, patch: WorkbenchSurfaceSizesPatch): LayoutRecordIntent<WorkbenchSurfaceSizes> {
    const value: {leftPanelWidth?: number; agentPanelWidth?: number} = base === null ? {} : {...base};
    let changed = false;
    let invalid = false;
    for (const field of ["leftPanelWidth", "agentPanelWidth"] as const) {
        const next = patch[field];
        if (next === undefined) {
            continue;
        }
        if (!isWorkbenchPanelWidth(next)) {
            invalid = true;
            continue;
        }
        if (base !== null && base[field] === next) {
            continue;
        }
        value[field] = next;
        changed = true;
    }
    if (changed) {
        return {value, changed: true, diagnosis: ""};
    }
    return {
        value,
        changed: false,
        diagnosis: invalid
            ? "本次调整的尺寸不在合法范围（正有限数），未写盘"
            : "本次调整没有产生与已确认值不同的字段，未写盘",
    };
}

/** 书架模式是单值记录：与已确认值相同就不写盘；没有已确认记录时按默认显示比较。 */
function composeShelfMode(base: WorkbenchShelfMode | null, mode: WorkbenchShelfMode): LayoutRecordIntent<WorkbenchShelfMode> {
    return base === mode
        ? {value: mode, changed: false, diagnosis: "书架模式与已确认值相同，未写盘"}
        : {value: mode, changed: true, diagnosis: ""};
}

/** 主动尺寸字段：面板高度与宽度是两条独立的轴，一次只写本次真正改变的轴。 */
export type WorkbenchPanelSizePatch = {readonly height?: number; readonly width?: number};

/**
 * 面板尺寸意图合成到读取时的原件（含未知字段）：只写补丁里出现的轴，另一轴与未知字段原样保留。
 *
 * 值先按产品区间夹取再落盘（高度 80..600、宽度 160..600）——记录里的值就是**呈现的尺寸意图**，
 * 不让越界值在下次恢复时又变成"夹取诊断"。
 */
function composePanelSize(base: WorkbenchPanelSize | null, patch: WorkbenchPanelSizePatch): LayoutRecordIntent<WorkbenchPanelSize> {
    const value: {height?: number; width?: number} = base === null ? {} : {...base};
    let changed = false;
    let invalid = false;
    for (const field of ["height", "width"] as const) {
        const next = patch[field];
        if (next === undefined) {
            continue;
        }
        const clamped = field === "height" ? clampPanelHeight(next) : clampPanelWidth(next);
        if (!isWorkbenchPanelSizeValue(clamped)) {
            invalid = true;
            continue;
        }
        if (base !== null && base[field] === clamped) {
            continue;
        }
        value[field] = clamped;
        changed = true;
    }
    if (changed) {
        return {value, changed: true, diagnosis: ""};
    }
    return {
        value,
        changed: false,
        diagnosis: invalid
            ? `面板尺寸不是合法值（正有限数）：${String(patch.height ?? patch.width)}，未写盘`
            : "面板尺寸与已确认值相同，未写盘",
    };
}

/**
 * 提示与收口只关心这几件事：会话阶段、未确认意图、重试、放弃。
 *
 * 一个工作面可能同时有两条记录（Project 是 grid + 底部高度，user 面是尺寸 + 底部高度），
 * 这里的结构类型让两条记录能在同一处归档，不必为它们造共同基类。
 */
type WorkbenchRecordSessions = {
    readonly state: () => {
        readonly phase: LayoutRecordPhase;
        readonly pending: {readonly diagnosis: string; readonly retryable: boolean} | null;
    };
    readonly retry: () => Promise<{readonly status: string}>;
    readonly abandon: () => void;
};

export type WorkbenchShelfModeConsumer = {
    readonly mode: Readonly<Ref<WorkbenchShelfMode>>;
    readonly loading: Readonly<Ref<boolean>>;
    /** 保存失败/未确认时的诊断；`null` 表示当前没有未保存意图。 */
    readonly unsaved: Readonly<Ref<{readonly diagnosis: string; readonly retryable: boolean} | null>>;
    commit(mode: WorkbenchShelfMode): Promise<void>;
    retry(): Promise<void>;
    abandon(): void;
    release(): Promise<void>;
};

/**
 * 书架模式的 user/local 记录会话（`workbench.layout`/`shelf-mode`）。
 *
 * 与壳层会话各自持有 Storage 上下文：两条记录互不影响，卸载时各自释放订阅；同一记录仍然只有一个写者。
 */
export function useWorkbenchShelfMode(options: {readonly adapters?: WorkbenchStorageAdapters} = {}): WorkbenchShelfModeConsumer {
    const context = createWorkbenchStorageContext({...(options.adapters === undefined ? {} : {adapters: options.adapters})});
    const mode = ref<WorkbenchShelfMode>("grid");
    const loading = ref(true);
    const unsaved = ref<{readonly diagnosis: string; readonly retryable: boolean} | null>(null);
    const session = shallowRef<LayoutRecordSession<WorkbenchShelfMode, WorkbenchShelfMode> | null>(null);

    const publish = (): void => {
        const current = session.value;
        if (current === null) {
            return;
        }
        const state = current.state();
        mode.value = current.display();
        loading.value = state.phase === "loading" || state.phase === "idle";
        unsaved.value = state.pending === null
            ? null
            : {diagnosis: state.pending.diagnosis, retryable: state.pending.retryable};
    };

    let opening: Promise<void> | null = null;
    const open = (): Promise<void> => {
        opening ??= (async () => {
            await context.enterUserSurface("idle");
            const owned = await context.userOwner(WORKBENCH_LAYOUT_OWNER);
            if (owned.status !== "ready") {
                loading.value = false;
                unsaved.value = {diagnosis: owned.diagnosis, retryable: false};
                return;
            }
            const created = createLayoutRecordSession<WorkbenchShelfMode, WorkbenchShelfMode>({
                handle: owned.handle,
                definition: defineWorkbenchShelfModeState(),
                compose: composeShelfMode,
                onChange: publish,
            });
            session.value = created;
            await created.open();
            publish();
        })();
        return opening;
    };

    const consumer: WorkbenchShelfModeConsumer = {
        mode: readonly(mode),
        loading: readonly(loading),
        unsaved: readonly(unsaved),

        async commit(next: WorkbenchShelfMode): Promise<void> {
            await open();
            const current = session.value;
            if (current === null) {
                return;
            }
            await current.commit(next);
            publish();
        },

        async retry(): Promise<void> {
            await session.value?.retry();
            publish();
        },

        abandon(): void {
            session.value?.abandon();
            publish();
        },

        async release(): Promise<void> {
            await session.value?.release();
            await context.release();
            publish();
        },
    };

    onScopeDispose(() => {
        void consumer.release();
    });
    void open();
    return consumer;
}

/* -------------------------------------------------------------------------- */
/* 壳层会话                                                                    */
/* -------------------------------------------------------------------------- */

/** 提示归属：`unsaved` 当前工作面、`switch-blocked` 切换被旧工作面挡住、`migration-blocked` 迁移阻断。 */
export type WorkbenchLayoutNoticeKind = "unsaved" | "switch-blocked" | "migration-blocked";

export type WorkbenchLayoutNotice = {
    readonly kind: WorkbenchLayoutNoticeKind;
    /** 诊断绑定的工作面；旧工作面的迟到失败不会显示成新工作面的未保存状态。 */
    readonly surface: WorkbenchLayoutSurfaceKind;
    readonly diagnosis: string;
    readonly retryable: boolean;
};

export type WorkbenchLayoutMigrationState = {
    readonly phase: StorageMigrationPhase;
    readonly blocked: StorageMigrationBlockReason | null;
    readonly diagnosis: string | null;
    readonly retryable: boolean;
};

export type WorkbenchLayoutSessionState = {
    /** 已生效的工作面；切换被挡住时仍是旧工作面。 */
    readonly surface: WorkbenchLayoutSurfaceKind;
    /** 被未保存意图挡住的目标工作面；`null` 表示没有待完成的切换。 */
    readonly pendingSurface: WorkbenchLayoutSurfaceKind | null;
    /** 首读门禁：当前工作面的记录还没读到分类。 */
    readonly loading: boolean;
    readonly notice: WorkbenchLayoutNotice | null;
    readonly migration: WorkbenchLayoutMigrationState | null;
    /** 归档诊断（含切换时被丢掉的旧面调整）；不静默吞掉，也不冒充当前面的未保存状态。 */
    readonly issues: readonly string[];
};

/**
 * 一次尺寸提交的结果。
 *
 * 没有 `started`：外壳不再有"开始手势"这一步——纯布局组件在 renderGrid 上结算完整手势，
 * 只把落点 px 的补丁交回来，因此这里只有提交结果（含被拒绝）。
 */
export type WorkbenchLayoutCommitStatus = "saved" | "unchanged" | "unsaved" | "rejected";

export type WorkbenchLayoutSessionOptions = {
    /** 外壳的布局树：宿主与记录会话都借用它，恢复与已确认尺寸都发布到同一棵树。 */
    readonly grid: Grid<string>;
    /** 记录里的叶引用 → 当前约束。 */
    readonly resolveRef: GridRefResolver<string>;
    /** 现有通知出口；`undefined` 时诊断只留在会话状态里。 */
    notify?: (notice: WorkbenchLayoutNotice) => void;
    /** 测试注入的 Storage 适配器。 */
    readonly adapters?: WorkbenchStorageAdapters;
};

export type WorkbenchLayoutSession = {
    readonly state: Readonly<Ref<WorkbenchLayoutSessionState>>;
    /**
     * 当前工作面的**代际键**（Project 根 / 用户工作面 id）。
     *
     * 纯布局组件把它随 `resize` 回传，`commitSizes` 只接受当前代际的补丁：切面期间与切面之后
     * 到达的旧工作面尺寸都不落账。
     */
    readonly contextKey: ComputedRef<string>;
    /**
     * 当前工作面的左右栏偏好：记录基线（Project 读树上意图，user 面读尺寸记录）+ 本窗口已接纳的
     * 本地呈现。已接纳的意图立刻生效，不等回执，也不因失败回退。
     */
    readonly preferences: ComputedRef<{leftPanelWidth: number; agentPanelWidth: number}>;
    /**
     * 当前工作面的面板尺寸意图（高度轴与宽度轴各自独立记忆）。
     *
     * 这是**未夹取**的意图：收起呈 32、位置不适用、短视口降级与 80..600（高）/160..600（宽）的
     * 夹取都发生在 `projectShell` 的投影里，本值只回答"用户希望多大"。
     */
    readonly panelSize: ComputedRef<{height: number; width: number}>;
    /**
     * 树上意图/显示被会话**重新发布**的次数（进入工作面、放弃未确认调整）。
     *
     * 只在会话主动改写呈现时前进（自己的提交不在这里：提交已把呈现写进本地覆盖，壳层要保持它）。
     */
    readonly publication: Readonly<Ref<number>>;
    enterSurface(surface: WorkbenchLayoutSurface): Promise<void>;
    /**
     * 一次已经结算好的尺寸补丁：只含真正变化的轴，px 语义（手势落点）。
     *
     * 同一份补丁可以同时含侧栏宽度与面板两轴（交汇处一次手势同时改两根轴）：**先整份校验**，
     * 通过后一次性进入本窗口偏好（呈现立刻生效），再在同一个串行任务里按记录分项写入。
     * 这是明确的多记录**非原子持久化**取舍：任何一项校验失败整份不接纳，已接纳后某条记录
     * I/O 失败不回滚另一条成功记录——回执按记录分项返回，上层据此只重试未确认的 owner。
     */
    commitSizes(input: {readonly contextKey: string; readonly patch: ShellSizePatch}): Promise<WorkbenchLayoutCommitReceipt>;
    retry(): Promise<void>;
    abandon(): void;
    retryMigration(): Promise<void>;
    release(): Promise<void>;
};

type SurfaceSizesSession = LayoutRecordSession<WorkbenchSurfaceSizes, WorkbenchSurfaceSizesPatch>;

type PanelSizeSession = LayoutRecordSession<WorkbenchPanelSize, WorkbenchPanelSizePatch>;

/** 尺寸字段的固定读取顺序（不依赖对象键顺序，诊断与提交都按它走）。 */
const SHELL_SIZE_FIELDS = ["leftPanelWidth", "agentPanelWidth", "panelHeight", "panelWidth"] as const;

/** 侧栏宽度字段 → 记录里的叶 id（`commitFields` 的落点）。 */
const SHELL_WIDTH_LEAF_ID: Record<string, string> = {leftPanelWidth: "left", agentPanelWidth: "right"};

/** 一次补丁属于哪条记录：侧栏两条宽度共用一条，面板两轴共用另一条。 */
function sizeFieldOwner(field: keyof ShellSizePreferences): "widths" | "panel" {
    return field === "panelHeight" || field === "panelWidth" ? "panel" : "widths";
}

/** 一次补丁里的合法字段与值；未知键、非有限/非正值都返回结构化诊断。 */
function sizePatchEntries(patch: ShellSizePatch): {readonly entries: readonly {field: keyof ShellSizePreferences; value: number}[]} | {readonly problem: string} {
    for (const key of Object.keys(patch)) {
        if (key === "dragCollapsed") {
            // 拖收起属于定制记录（`setPartVisibility`），不能从这里悄悄写进尺寸记录。
            return {problem: "拖收起偏好必须经定制会话写入，尺寸提交不处理 dragCollapsed"};
        }
        if (!SHELL_SIZE_FIELDS.includes(key as keyof ShellSizePreferences)) {
            return {problem: `尺寸补丁含未知字段：${key}`};
        }
    }
    const entries: {field: keyof ShellSizePreferences; value: number}[] = [];
    for (const field of SHELL_SIZE_FIELDS) {
        const value = patch[field];
        if (value === undefined) {
            continue;
        }
        if (!Number.isFinite(value) || value <= 0) {
            return {problem: `尺寸不是有限正数：${field}=${String(value)}`};
        }
        entries.push({field, value});
    }
    return {entries};
}

function surfaceKey(surface: WorkbenchLayoutSurface): string {
    return surface.kind === "project" ? `project:${surface.ready.projectRoot}` : surface.kind;
}

function userSurfaceId(kind: WorkbenchLayoutSurfaceKind): WorkbenchSurfaceId | null {
    return kind === "idle" || kind === "user-assets" ? kind : null;
}

/**
 * 一次尺寸提交的分项回执：`status` 是聚合结论，`records` 说明具体是哪个 owner 没确认。
 *
 * 聚合只用于既有 UI 文案；重试与诊断读 `records`，不把「宽度已保存、面板待保存」压成一句
 * 「未保存」。
 */
export type WorkbenchLayoutCommitReceipt = {
    readonly status: WorkbenchLayoutCommitStatus;
    readonly records: {
        readonly widths?: WorkbenchLayoutCommitStatus;
        readonly panel?: WorkbenchLayoutCommitStatus;
    };
};

const unchangedReceipt: WorkbenchLayoutCommitReceipt = {status: "unchanged", records: {widths: "unchanged", panel: "unchanged"}};
const rejectedReceipt: WorkbenchLayoutCommitReceipt = {status: "rejected", records: {widths: "rejected", panel: "rejected"}};

/** 收口语义：任一条记录没确认或拒绝，就以它为准；两条都干净才算收口完成。 */
function mergeCommitStatus(left: WorkbenchLayoutCommitStatus, right: WorkbenchLayoutCommitStatus): WorkbenchLayoutCommitStatus {
    if (left === "unsaved" || left === "rejected") {
        return left;
    }
    if (right === "unsaved" || right === "rejected") {
        return right;
    }
    return left === "saved" || right === "saved" ? "saved" : "unchanged";
}

export function createWorkbenchLayoutSession(options: WorkbenchLayoutSessionOptions): WorkbenchLayoutSession {
    const {grid} = options;
    const context: WorkbenchStorageContext = createWorkbenchStorageContext({
        ...(options.adapters === undefined ? {} : {adapters: options.adapters}),
    });

    /** 版本戳：树上意图是普通对象（不是 Vue 状态），任何一次发布都由它触发重算。 */
    const revision = ref(0);
    /** 会话主动改写呈现的次数（见 `publication` 的说明）。 */
    const publication = ref(0);
    const kind = ref<WorkbenchLayoutSurfaceKind>("idle");
    const blockedSwitch = ref<WorkbenchLayoutSurface | null>(null);
    const loading = ref(true);
    const notice = ref<WorkbenchLayoutNotice | null>(null);
    const migration = ref<WorkbenchLayoutMigrationState | null>(null);
    const issues = ref<readonly string[]>([]);

    let host: GridLayoutHost<string> | null = null;
    let sizes: SurfaceSizesSession | null = null;
    let panelSize: PanelSizeSession | null = null;
    let currentKey = "";
    /**
     * 本地呈现覆盖：本工作面内**已接纳**的尺寸意图（含未确认的），进入工作面与放弃时清除。
     *
     * 已接纳的意图不等回执就生效（拖动结束后不闪回旧尺寸），失败也不回退——记录基线仍在下面，
     * 远端订阅只更新基线，不抢当前呈现。
     */
    let presentation: ShellSizePatch = {};
    /** 本地意图序号：同字段的后到意图覆盖先到意图，旧回执不越过新意图改回呈现。 */
    let intentSeq = 0;
    let latestSeq: Record<string, number> = {};
    let transition: Promise<void> = Promise.resolve();
    let releasePromise: Promise<void> | null = null;
    let archived: string[] = [];
    let noticeKey = "";

    const bump = (): void => {
        revision.value += 1;
    };

    const migrationState = (snapshot: StorageMigrationSnapshot): WorkbenchLayoutMigrationState => ({
        phase: snapshot.phase,
        blocked: snapshot.blocked,
        diagnosis: snapshot.diagnosis,
        retryable: snapshot.retryable,
    });

    /**
     * 当前工作面的普通记录会话（底部高度总是其中之一）。
     *
     * Project 面的 grid 走 t44 宿主，没有 record session；`host` 之外的未确认意图与重试/放弃
     * 都由这张表兜住，两条记录不会各写一套收口逻辑。
     */
    function currentRecordSessions(): WorkbenchRecordSessions[] {
        const records: WorkbenchRecordSessions[] = [];
        if (sizes !== null) {
            records.push(sizes);
        }
        if (panelSize !== null) {
            records.push(panelSize);
        }
        return records;
    }

    /** 当前工作面的未确认意图（宿主或记录会话）；没有工作面记录时为 null。 */
    function currentPending(): {readonly diagnosis: string; readonly retryable: boolean} | null {
        if (host !== null) {
            const pending = host.state.pending;
            if (pending !== null) {
                return {diagnosis: pending.diagnosis, retryable: pending.retryable};
            }
        }
        for (const record of currentRecordSessions()) {
            const pending = record.state().pending;
            if (pending !== null) {
                return {diagnosis: pending.diagnosis, retryable: pending.retryable};
            }
        }
        return null;
    }

    /**
     * 当前工作面是否还能提交：只有**持有未确认意图**的记录才算数。
     *
     * 它已经失效（Project 删除/断线、授权撤销）就不再等待，而是归档后放行——否则切换会被
     * 一条再也写不动的记录永久挡住；反过来，只要持有意图的那条还能写，就值得先重试一次。
     */
    function currentAccepting(): boolean {
        const owners: (string | null)[] = [];
        if (host !== null && host.state.pending !== null) {
            owners.push(host.state.phase);
        }
        for (const record of currentRecordSessions()) {
            const state = record.state();
            if (state.pending !== null) {
                owners.push(state.phase ?? null);
            }
        }
        return owners.length === 0 || owners.some((phase) => phase === "ready" || phase === "loading");
    }

    /**
     * 提示出口：切换被挡 > 当前工作面未保存 > 迁移阻断。
     *
     * 同一份诊断只通知一次（状态戳仍然前进），避免每次重读/订阅刷新都弹一条通知；
     * 旧工作面的诊断带着旧工作面的归属，不会冒充新工作面的未保存状态。
     */
    function publishNotice(): void {
        const next: WorkbenchLayoutNotice | null = blockedSwitch.value !== null
            ? {
                kind: "switch-blocked",
                surface: kind.value,
                diagnosis: blockedSwitchDiagnosis(),
                retryable: true,
            }
            : noticeForCurrentSurface();
        const key = next === null ? "" : `${next.kind}\u0000${next.surface}\u0000${next.diagnosis}`;
        notice.value = next;
        if (next !== null && key !== noticeKey) {
            options.notify?.(next);
        }
        noticeKey = key;
        bump();
    }

    /** 当前工作面的未保存意图优先；没有它时才轮到迁移阻断。 */
    function noticeForCurrentSurface(): WorkbenchLayoutNotice | null {
        const pending = currentPending();
        if (pending !== null) {
            return {kind: "unsaved", surface: kind.value, diagnosis: pending.diagnosis, retryable: pending.retryable};
        }
        const migrationNow = migration.value;
        if (migrationNow !== null && migrationNow.blocked !== null) {
            return {
                kind: "migration-blocked",
                surface: kind.value,
                diagnosis: migrationNow.diagnosis ?? `迁移阻断：${migrationNow.blocked}`,
                retryable: migrationNow.retryable,
            };
        }
        return null;
    }

    function blockedSwitchDiagnosis(): string {
        return currentPending()?.diagnosis ?? "旧工作面的布局调整未保存";
    }

    const archive = (diagnosis: string): void => {
        archived.push(diagnosis);
        if (archived.length > MAX_ISSUES) {
            archived = archived.slice(archived.length - MAX_ISSUES);
        }
        issues.value = Object.freeze([...archived]);
    };

    const queue = (task: () => Promise<void>): Promise<void> => {
        const next = transition.then(task, task);
        transition = next.catch(() => undefined);
        return next;
    };

    /** 重试当前工作面的未确认意图（grid 宿主与普通记录一起）；返回值决定切换能否继续。 */
    const retryCurrent = async (): Promise<WorkbenchLayoutCommitStatus> => {
        let status: WorkbenchLayoutCommitStatus = "unchanged";
        if (host !== null) {
            const result = await host.retry();
            status = mergeCommitStatus(status, result.status === "saved" ? "saved" : result.status);
        }
        for (const record of currentRecordSessions()) {
            const result = await record.retry();
            status = mergeCommitStatus(status, result.status === "saved" ? "saved" : result.status as WorkbenchLayoutCommitStatus);
        }
        return status;
    };

    /**
     * 切换前的收口：提交已接纳的尺寸意图并等待 → 才能释放旧上下文。
     *
     * 旧工作面已失效（Project 删除/断线、上下文撤销）时不重试也不延迟：诊断归档后立刻放行。
     */
    const settleCurrentSurface = async (): Promise<{readonly ok: true} | {readonly ok: false; readonly diagnosis: string}> => {
        const pending = currentPending();
        if (pending === null) {
            return {ok: true};
        }
        if (!currentAccepting()) {
            archive(`旧工作面已失效，未保存的布局调整不再提交：${pending.diagnosis}`);
            return {ok: true};
        }
        const status = await retryCurrent();
        if (status === "saved" || status === "unchanged") {
            return {ok: true};
        }
        if (!currentAccepting()) {
            archive(`旧工作面在收口过程中失效，未保存的布局调整不再提交：${currentPending()?.diagnosis ?? pending.diagnosis}`);
            return {ok: true};
        }
        return {ok: false, diagnosis: currentPending()?.diagnosis ?? pending.diagnosis};
    };

    const releaseCurrentRecords = async (): Promise<void> => {
        const currentHost = host;
        const currentSizes = sizes;
        const currentPanel = panelSize;
        host = null;
        sizes = null;
        panelSize = null;
        currentKey = "";
        if (currentHost !== null) {
            await currentHost.release();
        }
        if (currentSizes !== null) {
            await currentSizes.release();
        }
        if (currentPanel !== null) {
            await currentPanel.release();
        }
    };

    /**
     * 面板尺寸记录会话：Project 面写 `panel-size`（project/local 单例），user 面写
     * `surface-panel-size`（user/local，资源是工作面 id）。两条定义分属两个工作面，互不 fallback——
     * 用户资产不会继承 Project 的面板尺寸，Project 也不会拿用户资产记录当失败回退。
     */
    function createPanelSizeSession(handle: WorkbenchStorageOwnerHandle, surfaceId: WorkbenchSurfaceId | undefined): PanelSizeSession {
        return createLayoutRecordSession<WorkbenchPanelSize, WorkbenchPanelSizePatch>({
            handle,
            definition: surfaceId === undefined ? defineWorkbenchPanelSizeState() : defineWorkbenchSurfacePanelSizeState(),
            ...(surfaceId === undefined ? {} : {resource: surfaceId}),
            compose: composePanelSize,
            onChange: publishNotice,
        });
    }

    const openSurface = async (surface: WorkbenchLayoutSurface): Promise<void> => {
        kind.value = surface.kind;
        currentKey = surfaceKey(surface);
        // 新工作面按自己的记录呈现：不继承上一个工作面的本地覆盖（旧意图的序号也不再参与结算）。
        presentation = {};
        latestSeq = {};
        loading.value = true;
        if (surface.kind === "project") {
            // Project 句柄绑定精确 ready 代次；上下文自身负责旧代次释放与失效。
            await context.enterProject(surface.ready);
            const owned = await context.projectOwner(WORKBENCH_LAYOUT_OWNER);
            if (owned.status !== "ready") {
                loading.value = false;
                archive(`Project 布局记录不可用：${owned.diagnosis}`);
                publishNotice();
                return;
            }
            const created = createGridLayoutHost<string>({
                grid,
                handle: owned.handle,
                definition: shellLayoutDefinition,
                resolveRef: options.resolveRef,
            });
            host = created;
            const hostState = await created.open();
            if (hostState.projection?.status === "default") {
                // 记录缺失或已被重置：把**产品默认布局**发布进树。树上意图是"当前工作面的显示"，
                // 不能让它继承上一个工作面（A→B、Project→用户资产）遗留的尺寸。
                const restored = grid.restore(shellLayoutDefinition.defaultValue, options.resolveRef);
                if (!restored.ok) {
                    archive(`产品默认外壳布局无法发布：${restored.reason ?? "未知结构"}`);
                }
            }
            // 面板尺寸是独立记录（`workbench.layout/panel-size`）：同 owner 同分区，与 grid 各自一个写者。
            const createdPanel = createPanelSizeSession(owned.handle, undefined);
            panelSize = createdPanel;
            const panelState = await createdPanel.open();
            loading.value = hostState.phase === "loading" || panelState.phase === "loading";
            publication.value += 1;
            publishNotice();
            return;
        }
        const surfaceId = userSurfaceId(surface.kind);
        if (surfaceId === null) {
            loading.value = false;
            publishNotice();
            return;
        }
        await context.enterUserSurface(surfaceId);
        const owned = await context.userOwner(WORKBENCH_LAYOUT_OWNER);
        if (owned.status !== "ready") {
            loading.value = false;
            archive(`工作面尺寸记录不可用：${owned.diagnosis}`);
            publishNotice();
            return;
        }
        const created = createLayoutRecordSession<WorkbenchSurfaceSizes, WorkbenchSurfaceSizesPatch>({
            handle: owned.handle,
            definition: defineWorkbenchSurfaceSizesState(),
            resource: surfaceId,
            compose: composeSurfaceSizes,
            onChange: publishNotice,
        });
        sizes = created;
        const recordState = await created.open();
        const createdPanel = createPanelSizeSession(owned.handle, surfaceId);
        panelSize = createdPanel;
        const panelState = await createdPanel.open();
        loading.value = recordState.phase === "loading" || panelState.phase === "loading";
        publication.value += 1;
        publishNotice();
    };

    /**
     * 完成一次被挡住的切换：释放旧工作面的记录与会话，再打开目标工作面。
     *
     * 目标工作面在调用时确定：用户在这期间又切到别处时以最后那个为准。
     */
    const completeBlockedSwitch = async (target: WorkbenchLayoutSurface): Promise<void> => {
        await queue(async () => {
            await releaseCurrentRecords();
            await openSurface(target);
        });
    };

    const stopMigrationFeed = subscribeStorageMigration((snapshot) => {
        migration.value = migrationState(snapshot);
        publishNotice();
    });
    migration.value = migrationState(storageMigrationSnapshot());

    /** 记录基线里的左右栏宽度（Project 读树上意图，user 面读尺寸记录显示值）。 */
    function baseWidths(): {leftPanelWidth: number; agentPanelWidth: number} {
        const display = sizes?.display() ?? null;
        if (kind.value === "project" || display === null) {
            return readShellPreferences(grid);
        }
        return {
            leftPanelWidth: display.leftPanelWidth ?? WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH,
            agentPanelWidth: display.agentPanelWidth ?? WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH,
        };
    }

    /**
     * 把一次已结算的补丁写进它所属的记录。
     *
     * - Project 的左右宽度 → grid 记录（`commitFields`，落点是记录原件里的 `left`/`right` 叶）；
     * - user 面的左右宽度 → `surface-sizes` 会话；
     * - 面板两个轴 → `panel-size` 会话。
     *
     * 记录不可用时归档诊断并返回 rejected —— 不把尺寸悄悄丢掉，也不退回另一条记录。
     */
    async function writeSizeFields(
        owner: "widths" | "panel",
        fields: readonly {readonly field: keyof ShellSizePreferences; readonly value: number}[],
    ): Promise<WorkbenchLayoutCommitStatus> {
        if (owner === "panel") {
            const current = panelSize;
            if (current === null) {
                archive("面板尺寸记录不可用，本次尺寸调整没有落账");
                return "rejected";
            }
            const patch: {height?: number; width?: number} = {};
            for (const entry of fields) {
                if (entry.field === "panelHeight") {
                    patch.height = entry.value;
                } else if (entry.field === "panelWidth") {
                    patch.width = entry.value;
                }
            }
            const result = await current.commit(patch);
            publishNotice();
            return result.status;
        }
        if (kind.value === "project") {
            const current = host;
            if (current === null) {
                archive("Project 布局记录不可用，本次尺寸调整没有落账");
                return "rejected";
            }
            const result = await current.commitFields(fields.map((entry) => ({
                id: SHELL_WIDTH_LEAF_ID[entry.field] ?? entry.field,
                axis: "width" as GridAxis,
                value: entry.value,
            })));
            publishNotice();
            if (result.status === "unsaved" || result.status === "rejected") {
                archive(`Project 宽度未保存（${result.status}）：${result.diagnosis}`);
            }
            return result.status;
        }
        const current = sizes;
        if (current === null) {
            archive("工作面尺寸记录不可用，本次宽度调整没有落账");
            return "rejected";
        }
        const patch: {leftPanelWidth?: number; agentPanelWidth?: number} = {};
        for (const entry of fields) {
            if (entry.field === "leftPanelWidth") {
                patch.leftPanelWidth = entry.value;
            } else if (entry.field === "agentPanelWidth") {
                patch.agentPanelWidth = entry.value;
            }
        }
        const result = await current.commit(patch);
        publishNotice();
        return result.status;
    }

    /**
     * 一次尺寸补丁的完整提交路径：校验代际与形状 → 记录归属 → 串行写。
     *
     * 补丁在**接受时**就进入本地呈现（拖动结束不闪回旧尺寸），执行时再按序号过滤：同一字段上
     * 已经有更新的意图时，旧调用不再写盘，也不会把呈现改回去。
     */
    async function commitSizes(input: {readonly contextKey: string; readonly patch: ShellSizePatch}): Promise<WorkbenchLayoutCommitReceipt> {
        const parsed = sizePatchEntries(input.patch);
        if ("problem" in parsed) {
            archive(`尺寸补丁被拒绝：${parsed.problem}`);
            return rejectedReceipt;
        }
        const entries = parsed.entries;
        if (entries.length === 0) {
            return unchangedReceipt;
        }
        if (input.contextKey !== currentKey) {
            archive(`尺寸提交的工作面代际已过期（${input.contextKey || "空"} ≠ ${currentKey || "空"}）：本次调整没有落账`);
            return rejectedReceipt;
        }
        if (loading.value) {
            archive("布局记录尚未完成首次读取，本次尺寸调整没有落账");
            return rejectedReceipt;
        }
        const seq = ++intentSeq;
        const accepted: {leftPanelWidth?: number; agentPanelWidth?: number; panelHeight?: number; panelWidth?: number} = {};
        for (const entry of entries) {
            latestSeq[entry.field] = seq;
            if (entry.field === "leftPanelWidth") {
                accepted.leftPanelWidth = entry.value;
            } else if (entry.field === "agentPanelWidth") {
                accepted.agentPanelWidth = entry.value;
            } else if (entry.field === "panelHeight") {
                accepted.panelHeight = entry.value;
            } else {
                accepted.panelWidth = entry.value;
            }
        }
        presentation = {...presentation, ...accepted};
        bump();
        const records: {widths?: WorkbenchLayoutCommitStatus; panel?: WorkbenchLayoutCommitStatus} = {};
        await queue(async () => {
            // 执行时再核一次代际：排队期间工作面可能已经切换（那时补丁属于旧工作面，不能写进新记录）。
            if (input.contextKey !== currentKey || loading.value) {
                archive(`尺寸提交的工作面代际已过期（${input.contextKey || "空"} ≠ ${currentKey || "空"}）：本次调整没有落账`);
                records.widths = "rejected";
                records.panel = "rejected";
                return;
            }
            const fresh = entries.filter((entry) => latestSeq[entry.field] === seq);
            if (fresh.length === 0) {
                records.widths = "unchanged";
                records.panel = "unchanged";
                return;
            }
            // 分项写入：任一 owner 失败不回滚另一个已成功写入的记录（非原子持久化，回执按项说明）。
            const widthEntries = fresh.filter((entry) => sizeFieldOwner(entry.field) === "widths");
            const panelEntries = fresh.filter((entry) => sizeFieldOwner(entry.field) === "panel");
            if (widthEntries.length > 0) {
                records.widths = await writeSizeFields("widths", widthEntries);
            }
            if (panelEntries.length > 0) {
                records.panel = await writeSizeFields("panel", panelEntries);
            }
        });
        return {status: mergeCommitStatus(records.widths ?? "unchanged", records.panel ?? "unchanged"), records};
    }

    const session: WorkbenchLayoutSession = {
        state: readonly(computed<WorkbenchLayoutSessionState>(() => ({
            surface: kind.value,
            pendingSurface: blockedSwitch.value === null ? null : blockedSwitch.value.kind,
            loading: loading.value,
            notice: notice.value,
            migration: migration.value,
            issues: issues.value,
        }))),

        contextKey: computed(() => {
            revision.value;
            return currentKey;
        }),

        preferences: computed(() => {
            revision.value;
            const base = baseWidths();
            return {
                leftPanelWidth: presentation.leftPanelWidth ?? base.leftPanelWidth,
                agentPanelWidth: presentation.agentPanelWidth ?? base.agentPanelWidth,
            };
        }),

        panelSize: computed(() => {
            revision.value;
            const record = panelSize?.display();
            const height = record?.height;
            const width = record?.width;
            return {
                height: presentation.panelHeight
                    ?? (height !== undefined && isWorkbenchPanelSizeValue(height) ? height : SHELL_PANEL_DEFAULT_HEIGHT),
                width: presentation.panelWidth
                    ?? (width !== undefined && isWorkbenchPanelSizeValue(width) ? width : SHELL_PANEL_DEFAULT_WIDTH),
            };
        }),

        publication: readonly(publication),

        async enterSurface(surface: WorkbenchLayoutSurface): Promise<void> {
            const key = surfaceKey(surface);
            if (key === currentKey) {
                return;
            }
            if (blockedSwitch.value !== null) {
                // 已经有一个待完成的切换：以最后一个目标为准，等 retry/abandon 收口。
                if (surfaceKey(blockedSwitch.value) !== key) {
                    blockedSwitch.value = surface;
                    publishNotice();
                }
                return;
            }
            await queue(async () => {
                if (key === currentKey) {
                    return;
                }
                const settled = await settleCurrentSurface();
                if (!settled.ok) {
                    blockedSwitch.value = surface;
                    publishNotice();
                    return;
                }
                await releaseCurrentRecords();
                await openSurface(surface);
            });
        },

        commitSizes,

        async retry(): Promise<void> {
            const blocked = blockedSwitch.value;
            if (blocked !== null) {
                const status = await retryCurrent();
                publishNotice();
                if (status === "saved" || status === "unchanged") {
                    blockedSwitch.value = null;
                    await completeBlockedSwitch(blocked);
                }
                return;
            }
            // 当前工作面的每一条记录都要重试：只重试一条会把另一条的未确认意图留在无人收口的状态。
            await retryCurrent();
            publishNotice();
        },

        abandon(): void {
            host?.abandon();
            for (const record of currentRecordSessions()) {
                record.abandon();
            }
            // 放弃采用当前已确认值：本地覆盖一并清掉，呈现跟着回到已确认布局；挡路的未保存调整也不再存在。
            presentation = {};
            latestSeq = {};
            publication.value += 1;
            const blocked = blockedSwitch.value;
            blockedSwitch.value = null;
            publishNotice();
            if (blocked !== null) {
                void completeBlockedSwitch(blocked);
            }
        },

        async retryMigration(): Promise<void> {
            migration.value = migrationState(await storageMigrationController().retry());
            publishNotice();
        },

        release(): Promise<void> {
            releasePromise ??= (async () => {
                stopMigrationFeed();
                await queue(releaseCurrentRecords);
                await transition;
                await context.release();
            })();
            return releasePromise;
        },
    };

    return session;
}
