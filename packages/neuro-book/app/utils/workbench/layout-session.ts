/**
 * 主工作台布局会话：把外壳的 grid、t44 持久化宿主、t47 迁移门禁与 Vue 消费接成一条线。
 *
 * 分工（合同见 `docs/specs/storage/persistence.md`「布局投影与保存反馈」、
 * `docs/specs/ui/workbench-shell.md`、`packages/neuro-book/docs/migrations/storage-state.md`）：
 *
 * - **两条记录路径**：Project 内左右栏尺寸是 grid 布局记录（t44 宿主负责恢复、原件合成与手势结算）；
 *   未开项目/用户资产尺寸是 `workbench.layout` 的 user/local 记录（本模块的通用记录会话）。
 *   两条路径共用同一套可见行为：首读门禁、只提交主动字段、冲突重读重放一次、失败保留意图与重试/放弃。
 * - **工作面**：`idle` / `user-assets` / `project` 各用明确记录，不互相 fallback；切工作面先结束手势、
 *   提交已形成的旧目标意图并等待收口，再释放旧上下文。旧工作面已失效（Project 删除/断线）时不延迟切换。
 * - **迟到失败归属**：未保存意图与诊断都带工作面归属；旧工作面的迟到结果不会显示成新工作面的未保存状态。
 * - **迁移衔接**：迁移未完成时仍然只写新 authority（旧 writer 已在本增量退役），迁移自身的阻断
 *   用同一处反馈出口呈现，并给出 `retry()`（绑定 t47 的控制器）。
 *
 * 本模块不 import Pinia/Nuxt；Vue 反应式只用于把上面的状态交给组件消费。
 */
import {computed, onScopeDispose, readonly, ref, shallowRef, type ComputedRef, type Ref} from "vue";
import {
    axisOf,
    type Grid,
    type GridAxis,
    type GridExtent,
    type GridLayoutResult,
    type GridNode,
    type GridRefResolver,
} from "@notnotype/nb-ui/components";
import {workbenchBranchGesture} from "nbook/app/components/workbench/workbench-branch-layout";
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
    storageMigrationController,
    storageMigrationSnapshot,
    subscribeStorageMigration,
    type StorageMigrationBlockReason,
    type StorageMigrationPhase,
    type StorageMigrationSnapshot,
} from "nbook/app/utils/workbench/storage-migration";
import type {StorageCredential, StorageReadResult, StorageScope} from "nbook/shared/storage/contract";
import {isSafeStorageIdentifier, type DefinedStorageState} from "nbook/shared/storage/definition";
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

export type WorkbenchLayoutGesture = {
    /** 该 Splitter 对应的分支 id。 */
    readonly branchId: string;
    /** 手势开始时的完整面板百分比。 */
    readonly sizes: readonly number[];
};

export type WorkbenchLayoutGestureEnd = {
    readonly branchId: string;
    /** 主动改变尺寸的直接子节点 id（`SplitterGestureState.active`）。 */
    readonly active: readonly string[];
    /** 手势结束时的完整面板百分比。 */
    readonly sizes: readonly number[];
};

export type WorkbenchLayoutCommitStatus = "started" | "saved" | "unchanged" | "unsaved" | "rejected";

export type WorkbenchLayoutSessionOptions = {
    /** 外壳的布局树：宿主与记录会话都借用它，恢复与手势结算都发布到同一棵树。 */
    readonly grid: Grid<string>;
    /** 记录里的叶引用 → 当前约束。 */
    readonly resolveRef: GridRefResolver<string>;
    /** 已收起的叶；隐藏只改呈现，不产生保存。 */
    readonly hidden: () => readonly string[];
    /** 现有通知出口；`undefined` 时诊断只留在会话状态里。 */
    notify?: (notice: WorkbenchLayoutNotice) => void;
    /** 测试注入的 Storage 适配器。 */
    adapters?: WorkbenchStorageAdapters;
};

export type WorkbenchLayoutSession = {
    readonly state: Readonly<Ref<WorkbenchLayoutSessionState>>;
    /** 当前工作面的左右栏偏好（图上意图 + 未确认意图），外壳据此重算几何模型。 */
    readonly preferences: ComputedRef<{leftPanelWidth: number; agentPanelWidth: number}>;
    /**
     * 树上意图/显示被会话**重新发布**的次数（进入工作面恢复、放弃未确认调整）。
     *
     * 只在会话主动改写呈现时前进：自己的手势不在这里（手势已把呈现写进树，壳层要保持它）。
     * 壳层据此决定是否按产品模型重建，而不用猜"这次偏好变化是谁写的"。
     */
    readonly publication: Readonly<Ref<number>>;
    enterSurface(surface: WorkbenchLayoutSurface): Promise<void>;
    setContainer(extent: GridExtent): void;
    gestureStart(gesture: WorkbenchLayoutGesture): WorkbenchLayoutCommitStatus;
    gestureEnd(gesture: WorkbenchLayoutGestureEnd): Promise<WorkbenchLayoutCommitStatus>;
    gestureCancel(): void;
    retry(): Promise<void>;
    abandon(): void;
    retryMigration(): Promise<void>;
    release(): Promise<void>;
};

type SurfaceSizesSession = LayoutRecordSession<WorkbenchSurfaceSizes, WorkbenchSurfaceSizesPatch>;

/** user 工作面的手势基线：外壳的树由壳层按偏好重建，这里只记分支与当时的呈现。 */
type UserGestureCapture = {
    readonly branchId: string;
    readonly axis: GridAxis;
    readonly children: readonly GridNode<string>[];
    readonly layout: GridLayoutResult;
    readonly container: GridExtent;
};

function surfaceKey(surface: WorkbenchLayoutSurface): string {
    return surface.kind === "project" ? `project:${surface.ready.projectRoot}` : surface.kind;
}

function userSurfaceId(kind: WorkbenchLayoutSurfaceKind): WorkbenchSurfaceId | null {
    return kind === "idle" || kind === "user-assets" ? kind : null;
}

function findBranch(grid: Grid<string>, branchId: string): {children: readonly GridNode<string>[]; axis: GridAxis} | null {
    const root = grid.root();
    if (root === null || root.kind === "leaf") {
        return null;
    }
    const branch = root.children.find((child) => child.id === branchId);
    if (!branch || branch.kind !== "branch") {
        return null;
    }
    return {children: branch.children, axis: axisOf(branch.orientation)};
}

/** 手势开始：只接受当前容器里可结算的分支（外壳只保存横向偏好）。 */
function captureUserGesture(grid: Grid<string>, container: GridExtent | null, gesture: WorkbenchLayoutGesture): UserGestureCapture | null {
    if (container === null) {
        return null;
    }
    const branch = findBranch(grid, gesture.branchId);
    if (branch === null || branch.axis !== "width" || gesture.sizes.length !== branch.children.length) {
        return null;
    }
    return {
        branchId: gesture.branchId,
        axis: branch.axis,
        children: branch.children,
        layout: grid.layout(container),
        container: {width: container.width, height: container.height},
    };
}

/** 手势结束：结算主动字段为尺寸补丁；程序布局与未主动改变的兄弟都不进补丁。 */
function userGesturePatch(
    grid: Grid<string>,
    container: GridExtent | null,
    captured: UserGestureCapture,
    gesture: WorkbenchLayoutGestureEnd,
): WorkbenchSurfaceSizesPatch | null {
    if (container === null
        || gesture.branchId !== captured.branchId
        || container.width !== captured.container.width
        || container.height !== captured.container.height) {
        return null;
    }
    const conversion = workbenchBranchGesture(captured.children, captured.layout, captured.axis, gesture.sizes);
    if (conversion === null) {
        return null;
    }
    const resized = grid.resizeBranch(captured.branchId, captured.axis, conversion.baseline, conversion.target);
    if (!resized.ok) {
        return null;
    }
    const known: Record<string, true> = Object.fromEntries(captured.children.map((child) => [child.id, true]));
    const patch: {leftPanelWidth?: number; agentPanelWidth?: number} = {};
    for (const id of gesture.active) {
        if (known[id] !== true) {
            return null;
        }
        const value = resized.sizes[id];
        if (value === undefined) {
            return null;
        }
        // 主动改变的叶必须是侧栏才有可保存的偏好；编辑器吸收余量，不进记录。
        if (id === "left") {
            patch.leftPanelWidth = value;
        } else if (id === "right") {
            patch.agentPanelWidth = value;
        }
    }
    return Object.keys(patch).length === 0 ? null : patch;
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
    let currentKey = "";
    let container: GridExtent | null = null;
    let gestureCapture: UserGestureCapture | null = null;
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

    /** 当前工作面的未确认意图（宿主或记录会话）；没有工作面记录时为 null。 */
    function currentPending(): {readonly diagnosis: string; readonly retryable: boolean} | null {
        if (host !== null) {
            const pending = host.state.pending;
            return pending === null ? null : {diagnosis: pending.diagnosis, retryable: pending.retryable};
        }
        const recordPending = sizes?.state().pending ?? null;
        return recordPending === null ? null : {diagnosis: recordPending.diagnosis, retryable: recordPending.retryable};
    }

    /** 当前工作面是否还能提交：上下文失效（Project 删除/断线）后不再等待，也不补写。 */
    function currentAccepting(): boolean {
        if (host !== null) {
            const phase = host.state.phase;
            return phase === "ready" || phase === "loading";
        }
        if (sizes !== null) {
            const phase = sizes.state().phase;
            return phase === "ready" || phase === "loading";
        }
        return false;
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

    /** 重试当前工作面的未确认意图；返回值决定切换能否继续。 */
    const retryCurrent = async (): Promise<WorkbenchLayoutCommitStatus> => {
        if (host !== null) {
            const result = await host.retry();
            return result.status === "saved" ? "saved" : result.status;
        }
        if (sizes !== null) {
            const result = await sizes.retry();
            return result.status === "saved" ? "saved" : result.status;
        }
        return "unchanged";
    };

    /**
     * 切换前的收口：结束手势 → 提交已形成的旧目标意图并等待 → 才能释放旧上下文。
     *
     * 旧工作面已失效（Project 删除/断线、上下文撤销）时不重试也不延迟：诊断归档后立刻放行。
     */
    const settleCurrentSurface = async (): Promise<{readonly ok: true} | {readonly ok: false; readonly diagnosis: string}> => {
        gestureCapture = null;
        host?.gestureCancel();
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
        host = null;
        sizes = null;
        currentKey = "";
        gestureCapture = null;
        if (currentHost !== null) {
            await currentHost.release();
        }
        if (currentSizes !== null) {
            await currentSizes.release();
        }
    };

    const openSurface = async (surface: WorkbenchLayoutSurface): Promise<void> => {
        kind.value = surface.kind;
        currentKey = surfaceKey(surface);
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
            // 宿主接手前测得的容器不能丢：手势基线要求宿主先知道当前容器（壳层在挂载时就测量过一次）。
            if (container !== null) {
                created.setContainer(container);
            }
            const hostState = await created.open();
            if (hostState.projection?.status === "default") {
                // 记录缺失或已被重置：把**产品默认布局**发布进树。树上意图是"当前工作面的显示"，
                // 不能让它继承上一个工作面（A→B、Project→用户资产）遗留的尺寸。
                const restored = grid.restore(shellLayoutDefinition.defaultValue, options.resolveRef);
                if (!restored.ok) {
                    archive(`产品默认外壳布局无法发布：${restored.reason ?? "未知结构"}`);
                }
            }
            loading.value = hostState.phase === "loading";
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
        loading.value = recordState.phase === "loading";
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

    const session: WorkbenchLayoutSession = {
        state: readonly(computed<WorkbenchLayoutSessionState>(() => ({
            surface: kind.value,
            pendingSurface: blockedSwitch.value === null ? null : blockedSwitch.value.kind,
            loading: loading.value,
            notice: notice.value,
            migration: migration.value,
            issues: issues.value,
        }))),

        preferences: computed(() => {
            revision.value;
            const display = sizes?.display() ?? null;
            if (kind.value === "project" || display === null) {
                return readShellPreferences(grid);
            }
            return {
                leftPanelWidth: display.leftPanelWidth ?? WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH,
                agentPanelWidth: display.agentPanelWidth ?? WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH,
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

        setContainer(extent: GridExtent): void {
            // 容器变化取消进行中的手势（与 t44 宿主同一口径）：基线已经失去意义。
            if (gestureCapture !== null && (extent.width !== gestureCapture.container.width || extent.height !== gestureCapture.container.height)) {
                gestureCapture = null;
            }
            container = extent;
            host?.setContainer(extent);
        },

        gestureStart(gesture: WorkbenchLayoutGesture): WorkbenchLayoutCommitStatus {
            if (host !== null) {
                const ack = host.gestureStart(gesture);
                if (!ack.ok) {
                    archive(`手势未被接纳：${ack.diagnosis}`);
                }
                return ack.ok ? "started" : "rejected";
            }
            const captured = captureUserGesture(grid, container, gesture);
            gestureCapture = captured;
            return captured === null ? "rejected" : "started";
        },

        async gestureEnd(gesture: WorkbenchLayoutGestureEnd): Promise<WorkbenchLayoutCommitStatus> {
            if (host !== null) {
                const result = await host.gestureEnd(gesture);
                if (result.status !== "saved") {
                    // 手势没落盘的原因必须可见：宿主返回的 unchanged/rejected/unsaved 都带诊断。
                    archive(`布局手势未保存（${result.status}）：${result.diagnosis}`);
                }
                publishNotice();
                return result.status === "saved" ? "saved" : result.status;
            }
            const captured = gestureCapture;
            gestureCapture = null;
            const current = sizes;
            if (captured === null || current === null) {
                return "rejected";
            }
            const patch = userGesturePatch(grid, container, captured, gesture);
            if (patch === null) {
                return "rejected";
            }
            const result = await current.commit(patch);
            publishNotice();
            return result.status === "saved" ? "saved" : result.status;
        },

        gestureCancel(): void {
            gestureCapture = null;
            host?.gestureCancel();
        },

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
            if (host !== null) {
                await host.retry();
            } else {
                await sizes?.retry();
            }
            publishNotice();
        },

        abandon(): void {
            if (host !== null) {
                host.abandon();
            } else {
                sizes?.abandon();
            }
            // 放弃采用当前已确认值：呈现要跟着回到已确认布局；挡路的未保存调整也不再存在。
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
                gestureCapture = null;
                host?.gestureCancel();
                await queue(releaseCurrentRecords);
                await transition;
                await context.release();
            })();
            return releasePromise;
        },
    };

    return session;
}
