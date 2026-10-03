import {
    closeStorageContext,
    openStorageProjectContext,
    openStorageUserContext,
    type StorageAccessSession,
    type StorageContextUnavailable,
    type StorageProjectContextOpenResult,
    type StorageProjectContextTarget,
    type StorageUserContextOpenResult,
} from "nbook/app/utils/storage/host-context-client";
import {
    openStorageOwnerHandle,
    type StorageOwnerHandle,
    type StorageOwnerHandleOptions,
} from "nbook/app/utils/storage/owner-handle";

export type WorkbenchStorageUnavailableReason =
    | StorageContextUnavailable["reason"]
    | "project-unavailable"
    | "project-invalidated"
    | "workbench-released";

export type WorkbenchStorageUnavailable = {
    readonly status: "unavailable";
    readonly reason: WorkbenchStorageUnavailableReason;
    readonly diagnosis: string;
    readonly code: string | null;
    readonly statusCode: number | null;
};

/** 工作台拥有底层句柄生命周期；消费者不能提前释放同 owner 的共享句柄。 */
export type WorkbenchStorageOwnerHandle = Omit<StorageOwnerHandle, "release">;

export type WorkbenchStorageOwnerResult =
    | {readonly status: "ready"; readonly handle: WorkbenchStorageOwnerHandle}
    | WorkbenchStorageUnavailable;

export type ProjectMemoryResult<T> =
    | {readonly status: "ready"; readonly value: T}
    | WorkbenchStorageUnavailable;

export type ProjectSelectionMemory = {
    get(): ProjectMemoryResult<string | null>;
    set(value: string | null): ProjectMemoryResult<string | null>;
    subscribe(listener: (value: string | null) => void): () => void;
};

export type WorkbenchProjectMemory = {
    selection(owner: string): ProjectSelectionMemory;
};

export type WorkbenchProjectStorageContext = {
    readonly ready: Readonly<StorageProjectContextTarget & {readonly revision?: number}>;
    readonly memory: WorkbenchProjectMemory;
    readonly available: boolean;
    /** 总会反映句柄排空和 session 关闭失败；内部已登记 rejection handler，AbortSignal 不会产生未处理拒绝。 */
    readonly released: Promise<void>;
    owner(owner: string): Promise<WorkbenchStorageOwnerResult>;
    invalidate(): Promise<void>;
};

export type WorkbenchStorageTarget =
    | {readonly kind: "idle"}
    | {readonly kind: "user-assets"}
    | {readonly kind: "project"; readonly ready: Readonly<StorageProjectContextTarget & {readonly revision?: number}>};

export type WorkbenchStorageContext = {
    readonly target: WorkbenchStorageTarget;
    userOwner(owner: string): Promise<WorkbenchStorageOwnerResult>;
    projectOwner(owner: string): Promise<WorkbenchStorageOwnerResult>;
    enterUserSurface(surface: "idle" | "user-assets"): Promise<void>;
    enterProject(
        ready: StorageProjectContextTarget & {readonly revision?: number},
        options?: {readonly invalidation?: AbortSignal},
    ): Promise<WorkbenchProjectStorageContext>;
    release(): Promise<void>;
};

export type WorkbenchStorageAdapters = {
    readonly openUserContext: () => Promise<StorageUserContextOpenResult>;
    readonly openProjectContext: (target: StorageProjectContextTarget) => Promise<StorageProjectContextOpenResult>;
    readonly openOwnerHandle: (input: StorageOwnerHandleOptions) => Promise<StorageOwnerHandle>;
    readonly closeContext: (session: StorageAccessSession) => Promise<void>;
};

export type WorkbenchStorageContextOptions = {
    readonly adapters?: WorkbenchStorageAdapters;
};

type OwnerEntry = {
    readonly raw: StorageOwnerHandle;
    readonly facade: WorkbenchStorageOwnerHandle;
};

type ScopeAccess = {
    session: StorageAccessSession | null;
    sessionOpening: Promise<StorageUserContextOpenResult | StorageProjectContextOpenResult> | null;
    readonly handles: Map<string, OwnerEntry>;
    readonly handleOpenings: Map<string, Promise<OwnerEntry>>;
    accepting: boolean;
    releasePromise: Promise<void> | null;
};

type MutableProjectContext = {
    readonly api: WorkbenchProjectStorageContext;
    readonly access: ScopeAccess;
    readonly generation: number;
    readonly selections: Map<string, MutableSelection>;
    abortCleanup(): void;
    releasePromise: Promise<void> | null;
    settleReleased: PromiseWithResolvers<void>;
};

type MutableSelection = {
    readonly api: ProjectSelectionMemory;
    readonly listeners: Set<(value: string | null) => void>;
};

const WORKBENCH_RELEASED = unavailable("workbench-released", "工作台 Storage 上下文已释放，不能接受新访问");
const PROJECT_UNAVAILABLE = unavailable("project-unavailable", "当前工作台没有已确认的 Project ready，不能访问 Project Storage");
const PROJECT_INVALIDATED = unavailable("project-invalidated", "Project Storage 上下文已失效，旧引用不能继续访问或复活");

const defaultAdapters: WorkbenchStorageAdapters = {
    openUserContext: openStorageUserContext,
    openProjectContext: openStorageProjectContext,
    openOwnerHandle: openStorageOwnerHandle,
    closeContext: closeStorageContext,
};

/**
 * 建立一个工作台实例拥有的 Storage 消费上下文。
 *
 * 切换序号在任何 await 前递增；资源清理串行，但只有最后一次明确目标可以发布 Project。
 * user session 保留到整个工作台释放，Project session 与内存服务按精确 ready 代次释放。
 */
export function createWorkbenchStorageContext(options: WorkbenchStorageContextOptions = {}): WorkbenchStorageContext {
    const adapters = options.adapters ?? defaultAdapters;
    const user = createScopeAccess();
    let target: WorkbenchStorageTarget = {kind: "idle"};
    let project: MutableProjectContext | null = null;
    let projectGeneration = 0;
    let transitionGeneration = 0;
    let transitionTail = Promise.resolve();
    let accepting = true;
    let releasePromise: Promise<void> | null = null;

    const queueProjectRelease = (value: MutableProjectContext | null): Promise<void> => {
        const operation = transitionTail.then(() => releaseProject(value, adapters));
        transitionTail = operation.catch(() => undefined);
        return operation;
    };

    const invalidateFromProject = (value: MutableProjectContext): Promise<void> => {
        if (project !== value) return releaseProject(value, adapters);
        transitionGeneration += 1;
        project = null;
        target = {kind: "idle"};
        return queueProjectRelease(value);
    };

    const userOwner = (owner: string): Promise<WorkbenchStorageOwnerResult> => {
        if (!accepting) return Promise.resolve(WORKBENCH_RELEASED);
        return borrowOwner(user, owner, () => adapters.openUserContext(), () => accepting ? null : WORKBENCH_RELEASED, adapters);
    };

    const projectOwner = (owner: string): Promise<WorkbenchStorageOwnerResult> => {
        if (!accepting) return Promise.resolve(WORKBENCH_RELEASED);
        return project?.api.owner(owner) ?? Promise.resolve(PROJECT_UNAVAILABLE);
    };

    const enterUserSurface = (surface: "idle" | "user-assets"): Promise<void> => {
        if (!accepting) return Promise.resolve();
        transitionGeneration += 1;
        const previous = project;
        project = null;
        target = {kind: surface};
        return queueProjectRelease(previous);
    };

    const enterProject = async (
        readyInput: StorageProjectContextTarget & {readonly revision?: number},
        enterOptions: {readonly invalidation?: AbortSignal} = {},
    ): Promise<WorkbenchProjectStorageContext> => {
        if (!accepting) return releasedProjectContext(readyInput, WORKBENCH_RELEASED);
        const transition = ++transitionGeneration;
        const ready = captureReady(readyInput);
        const previous = project;
        project = null;
        target = {kind: "project", ready};
        await queueProjectRelease(previous);
        if (!accepting) return releasedProjectContext(ready, WORKBENCH_RELEASED);
        if (transition !== transitionGeneration) return releasedProjectContext(ready, PROJECT_INVALIDATED);

        const generation = ++projectGeneration;
        const access = createScopeAccess();
        const selections = new Map<string, MutableSelection>();
        const settleReleased = Promise.withResolvers<void>();
        // AbortSignal 回调不能 await；预先登记 handler，错误仍通过公开 released Promise 可观察。
        void settleReleased.promise.catch(() => undefined);
        let mutable!: MutableProjectContext;

        const currentUnavailable = (): WorkbenchStorageUnavailable | null => {
            if (!accepting) return WORKBENCH_RELEASED;
            if (project !== mutable || !access.accepting) return PROJECT_INVALIDATED;
            return null;
        };
        const memory: WorkbenchProjectMemory = {
            selection(owner) {
                const existing = selections.get(owner);
                if (existing !== undefined) return existing.api;
                let value: string | null = null;
                const listeners = new Set<(value: string | null) => void>();
                const api: ProjectSelectionMemory = {
                    get() {
                        const blocked = currentUnavailable();
                        return blocked ?? {status: "ready", value};
                    },
                    set(nextValue) {
                        const blocked = currentUnavailable();
                        if (blocked !== null) return blocked;
                        if (nextValue !== value) {
                            value = nextValue;
                            for (const listener of listeners) {
                                try {
                                    listener(value);
                                } catch {
                                    // 一个消费者异常不能阻断同一 owner 的其它内存投影。
                                }
                            }
                        }
                        return {status: "ready", value};
                    },
                    subscribe(listener) {
                        if (currentUnavailable() !== null) return () => undefined;
                        listeners.add(listener);
                        return () => listeners.delete(listener);
                    },
                };
                selections.set(owner, {api, listeners});
                return api;
            },
        };
        const api: WorkbenchProjectStorageContext = {
            ready,
            memory,
            get available() {
                return currentUnavailable() === null;
            },
            released: settleReleased.promise,
            owner(owner) {
                const blocked = currentUnavailable();
                if (blocked !== null) return Promise.resolve(blocked);
                return borrowOwner(access, owner, () => adapters.openProjectContext(ready), currentUnavailable, adapters);
            },
            invalidate() {
                return invalidateFromProject(mutable);
            },
        };
        mutable = {
            api,
            access,
            generation,
            selections,
            abortCleanup: () => undefined,
            releasePromise: null,
            settleReleased,
        };
        project = mutable;

        const signal = enterOptions.invalidation;
        if (signal !== undefined) {
            const abort = () => {
                void invalidateFromProject(mutable);
            };
            if (signal.aborted) abort();
            else {
                signal.addEventListener("abort", abort, {once: true});
                mutable.abortCleanup = () => signal.removeEventListener("abort", abort);
            }
        }
        return api;
    };

    const release = (): Promise<void> => {
        if (releasePromise !== null) return releasePromise;
        accepting = false;
        transitionGeneration += 1;
        const previous = project;
        project = null;
        target = {kind: "idle"};
        releasePromise = Promise.allSettled([
            queueProjectRelease(previous),
            releaseScope(user, adapters),
        ]).then((results) => {
            const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected").map((result) => result.reason);
            if (errors.length > 0) throw new AggregateError(errors, "释放工作台 Storage 资源失败");
        });
        return releasePromise;
    };

    return {
        get target() {
            return target;
        },
        userOwner,
        projectOwner,
        enterUserSurface,
        enterProject,
        release,
    };
}

function createScopeAccess(): ScopeAccess {
    return {
        session: null,
        sessionOpening: null,
        handles: new Map(),
        handleOpenings: new Map(),
        accepting: true,
        releasePromise: null,
    };
}

async function borrowOwner(
    access: ScopeAccess,
    owner: string,
    openContext: () => Promise<StorageUserContextOpenResult | StorageProjectContextOpenResult>,
    unavailableNow: () => WorkbenchStorageUnavailable | null,
    adapters: WorkbenchStorageAdapters,
): Promise<WorkbenchStorageOwnerResult> {
    const blocked = unavailableNow();
    if (blocked !== null || !access.accepting) return blocked ?? PROJECT_INVALIDATED;
    const existing = access.handles.get(owner);
    if (existing !== undefined) return {status: "ready", handle: existing.facade};

    let opening = access.handleOpenings.get(owner);
    if (opening === undefined) {
        opening = openHandle(access, owner, openContext, adapters, unavailableNow);
        access.handleOpenings.set(owner, opening);
        void opening.finally(() => {
            if (access.handleOpenings.get(owner) === opening) access.handleOpenings.delete(owner);
        }).catch(() => undefined);
    }
    let entry: OwnerEntry;
    try {
        entry = await opening;
    } catch (error) {
        const blockedAfterFailure = unavailableNow();
        if (blockedAfterFailure !== null) return blockedAfterFailure;
        const failed = readUnavailableFailure(error);
        if (failed !== null) return failed;
        throw error;
    }

    const late = unavailableNow();
    if (late !== null || !access.accepting || access.handles.get(owner) !== entry) {
        await entry.raw.release();
        return late ?? PROJECT_INVALIDATED;
    }
    return {status: "ready", handle: entry.facade};
}

async function openHandle(
    access: ScopeAccess,
    owner: string,
    openContext: () => Promise<StorageUserContextOpenResult | StorageProjectContextOpenResult>,
    adapters: WorkbenchStorageAdapters,
    unavailableNow: () => WorkbenchStorageUnavailable | null,
): Promise<OwnerEntry> {
    const sessionResult = await ensureSession(access, openContext);
    if (sessionResult.status === "unavailable") throw unavailableFailure(sessionResult);
    const raw = await adapters.openOwnerHandle({session: sessionResult.session, owner});
    if (!access.accepting || unavailableNow() !== null) {
        await raw.release();
        throw unavailableFailure(unavailableNow() ?? PROJECT_INVALIDATED);
    }
    const entry = {raw, facade: ownerFacade(raw, unavailableNow)};
    access.handles.set(owner, entry);
    return entry;
}


async function ensureSession(
    access: ScopeAccess,
    openContext: () => Promise<StorageUserContextOpenResult | StorageProjectContextOpenResult>,
): Promise<StorageUserContextOpenResult | StorageProjectContextOpenResult> {
    if (access.session !== null) {
        return access.session.scope === "user"
            ? {status: "ready", session: access.session}
            : {status: "ready", session: access.session};
    }
    access.sessionOpening ??= openContext();
    const opening = access.sessionOpening;
    try {
        const result = await opening;
        if (result.status === "ready") access.session = result.session;
        return result;
    } finally {
        if (access.sessionOpening === opening) access.sessionOpening = null;
    }
}

function releaseScope(access: ScopeAccess, adapters: WorkbenchStorageAdapters): Promise<void> {
    if (access.releasePromise !== null) return access.releasePromise;
    access.accepting = false;
    const handleReleases = [...access.handles.values()].map(({raw}) => raw.release());
    access.releasePromise = (async () => {
        const errors: unknown[] = [];
        const [openings, handles] = await Promise.all([
            Promise.allSettled([...access.handleOpenings.values()]),
            Promise.allSettled(handleReleases),
        ]);
        for (const result of openings) {
            if (result.status === "rejected" && readUnavailableFailure(result.reason) === null) errors.push(result.reason);
        }
        access.handles.clear();
        for (const result of handles) if (result.status === "rejected") errors.push(result.reason);

        if (access.sessionOpening !== null) {
            const result = await Promise.allSettled([access.sessionOpening]);
            if (result[0]?.status === "rejected") errors.push(result[0].reason);
        }
        const session = access.session;
        access.session = null;
        if (session !== null) {
            try {
                await adapters.closeContext(session);
            } catch (error) {
                errors.push(error);
            }
        }
        if (errors.length > 0) throw new AggregateError(errors, "释放工作台 Storage 资源失败");
    })();
    return access.releasePromise;
}

function releaseProject(value: MutableProjectContext | null, adapters: WorkbenchStorageAdapters): Promise<void> {
    if (value === null) return Promise.resolve();
    if (value.releasePromise !== null) return value.releasePromise;
    value.abortCleanup();
    value.releasePromise = releaseScope(value.access, adapters).finally(() => {
        for (const selection of value.selections.values()) selection.listeners.clear();
        value.selections.clear();
    });
    value.releasePromise.then(value.settleReleased.resolve, value.settleReleased.reject);
    return value.releasePromise;
}

function ownerFacade(handle: StorageOwnerHandle, unavailableNow: () => WorkbenchStorageUnavailable | null): WorkbenchStorageOwnerHandle {
    const ensureAvailable = () => {
        const blocked = unavailableNow();
        if (blocked !== null) throw unavailableFailure(blocked);
    };
    const facade: WorkbenchStorageOwnerHandle = {
        owner: handle.owner,
        binding: handle.binding,
        async read(definition, options) {
            ensureAvailable();
            return handle.read(definition, options);
        },
        async save(definition, input) {
            ensureAvailable();
            return handle.save(definition, input);
        },
        async remove(definition, input) {
            ensureAvailable();
            return handle.remove(definition, input);
        },
        async migrate(definition, input) {
            ensureAvailable();
            return handle.migrate(definition, input);
        },
        async repair(definition, input) {
            ensureAvailable();
            return handle.repair(definition, input);
        },
        async reclaim(definition, input) {
            ensureAvailable();
            return handle.reclaim(definition, input);
        },
        async subscribe(definition, options) {
            ensureAvailable();
            return handle.subscribe(definition, options);
        },
    };
    return Object.freeze(facade);
}

function unavailableFailure(value: StorageContextUnavailable | WorkbenchStorageUnavailable): Error {
    return Object.assign(new Error(value.diagnosis), {storageContextUnavailable: value});
}

function readUnavailableFailure(error: unknown): StorageContextUnavailable | WorkbenchStorageUnavailable | null {
    if (typeof error !== "object" || error === null || !("storageContextUnavailable" in error)) return null;
    const value = error.storageContextUnavailable;
    if (typeof value !== "object" || value === null
        || !("status" in value) || value.status !== "unavailable"
        || !("reason" in value) || typeof value.reason !== "string"
        || !("diagnosis" in value) || typeof value.diagnosis !== "string"
        || !("code" in value) || (value.code !== null && typeof value.code !== "string")
        || !("statusCode" in value) || (value.statusCode !== null && typeof value.statusCode !== "number")) {
        return null;
    }
    if (!isWorkbenchUnavailableReason(value.reason)) return null;
    return {status: "unavailable", reason: value.reason, diagnosis: value.diagnosis, code: value.code, statusCode: value.statusCode};
}

function isWorkbenchUnavailableReason(value: string): value is WorkbenchStorageUnavailableReason {
    return value === "identity-unrecoverable" || value === "backend-rejected" || value === "backend-unreachable"
        || value === "target-invalid" || value === "project-unavailable" || value === "project-invalidated"
        || value === "workbench-released";
}

function captureReady(
    ready: StorageProjectContextTarget & {readonly revision?: number},
): Readonly<StorageProjectContextTarget & {readonly revision?: number}> {
    return Object.freeze({
        projectRoot: ready.projectRoot,
        publicId: ready.publicId,
        ...(ready.revision === undefined ? {} : {revision: ready.revision}),
    });
}

function releasedProjectContext(
    readyInput: StorageProjectContextTarget & {readonly revision?: number},
    reason: WorkbenchStorageUnavailable,
): WorkbenchProjectStorageContext {
    const ready = captureReady(readyInput);
    return {
        ready,
        memory: {selection: () => ({get: () => reason, set: () => reason, subscribe: () => () => undefined})},
        available: false,
        released: Promise.resolve(),
        owner: () => Promise.resolve(reason),
        invalidate: () => Promise.resolve(),
    };
}

function unavailable(reason: WorkbenchStorageUnavailableReason, diagnosis: string): WorkbenchStorageUnavailable {
    return Object.freeze({status: "unavailable", reason, diagnosis, code: null, statusCode: null});
}
