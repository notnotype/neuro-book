import {randomUUID} from "node:crypto";
import type {ProjectWorkspaceKey} from "nbook/server/workspace-files/project-identity";
import type {PreparedProjectOpen} from "nbook/server/workspace-files/project-lifecycle";
import type {RuntimeArtifactCompilerContext} from "nbook/server/utils/runtime-artifact-compiler-context";
import {
    isProjectDomainError,
    ProjectDomainError,
} from "nbook/server/workspace-files/project-domain-error";
import {
    isProjectLockCompromisedError,
    isProjectLockReleaseFailedError,
    ProjectLockCompromisedError,
    ProjectLockReleaseFailedError,
} from "nbook/server/workspace-files/project-lock";
import {
    projectModuleRegistry,
    type ProjectModule,
    type ProjectModuleHandle,
    type ProjectModuleRegistrySnapshot,
    type ProjectModuleToken,
} from "nbook/server/workspace-files/project-module";
import type {
    ProjectOpener,
    ReadyProjectSessionRef,
} from "nbook/server/workspace-files/project-session-types";

export type {ProjectOpener, ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";

/** strict-open数据面遇到opening、closing或不存在的Project时抛出。 */
export class ProjectNotReadyError extends ProjectDomainError {
    readonly code = "PROJECT_NOT_READY";
    readonly projectRoot: string;

    /** 保留稳定Project root供HTTP层映射，不泄漏绝对路径。 */
    constructor(projectRoot: string) {
        super("session-not-ready", `Project尚未达到最低ready：${projectRoot}`);
        this.name = "ProjectNotReadyError";
        this.projectRoot = projectRoot;
    }
}

/** HMR 后仍精确识别尚未发布 ready generation 的错误。 */
export function isProjectNotReadyError(error: unknown): error is ProjectNotReadyError {
    return isProjectDomainError(error, "session-not-ready");
}

/** 同一Project key已有opening/ready/closing generation时拒绝重复adopt。 */
export class ProjectSessionExistsError extends ProjectDomainError {
    readonly code = "PROJECT_SESSION_EXISTS";
    readonly statusCode = 409;
    readonly projectRoot: string;

    /** ProjectLifecycle正常应由Occupancy先阻止并发；此错误是进程内最终防线。 */
    constructor(projectRoot: string) {
        super("session-exists", `ProjectSession generation已经存在：${projectRoot}`);
        this.name = "ProjectSessionExistsError";
        this.projectRoot = projectRoot;
    }
}

/** HMR 后仍精确识别重复 Session generation。 */
export function isProjectSessionExistsError(error: unknown): error is ProjectSessionExistsError {
    return isProjectDomainError(error, "session-exists");
}

/** required Module或registry未能建立最低ready generation。 */
export class ProjectSessionOpenError extends ProjectDomainError {
    readonly code = "PROJECT_SESSION_OPEN_FAILED";
    readonly statusCode = 500;
    readonly projectRoot: string;
    override readonly cause: unknown;

    /** 包装没有稳定领域类型的Project Module启动失败。 */
    constructor(projectRoot: string, cause: unknown) {
        super("session-open", `ProjectSession启动失败：${projectRoot}`, {cause});
        this.name = "ProjectSessionOpenError";
        this.projectRoot = projectRoot;
        this.cause = cause;
    }
}

/** HMR 后仍精确识别 required Module 启动失败。 */
export function isProjectSessionOpenError(error: unknown): error is ProjectSessionOpenError {
    return isProjectDomainError(error, "session-open");
}

/** Module handle关闭不完整；Session保留原generation与Occupancy供精确重试。 */
export class ProjectSessionCloseError extends ProjectDomainError {
    readonly code = "PROJECT_SESSION_CLOSE_FAILED";
    readonly statusCode = 500;
    readonly projectRoot: string;
    readonly failures: readonly Error[];

    /** 保留全部handle failure，不用首错遮蔽后续关闭诊断。 */
    constructor(projectRoot: string, failures: readonly Error[]) {
        super("session-close", `ProjectSession Module关闭失败：${projectRoot}`, {
            cause: new AggregateError(failures),
        });
        this.name = "ProjectSessionCloseError";
        this.projectRoot = projectRoot;
        this.failures = Object.freeze([...failures]);
    }
}

/** HMR 后仍精确识别 Module/Occupancy 关闭不完整。 */
export function isProjectSessionCloseError(error: unknown): error is ProjectSessionCloseError {
    return isProjectDomainError(error, "session-close");
}

/** Runtime已进入shutdown gate，不再接受新ProjectSession generation。 */
export class ProjectSessionRuntimeClosedError extends ProjectDomainError {
    readonly code = "PROJECT_SESSION_RUNTIME_CLOSED";
    readonly statusCode = 503;

    /** closing与closed对新open共用同一fail-closed语义。 */
    constructor() {
        super("session-runtime-closed", "ProjectSession Runtime已关闭");
        this.name = "ProjectSessionRuntimeClosedError";
    }
}

/** HMR 后仍精确识别 Runtime shutdown gate。 */
export function isProjectSessionRuntimeClosedError(error: unknown): error is ProjectSessionRuntimeClosedError {
    return isProjectDomainError(error, "session-runtime-closed");
}

/** 用户与Agent均不在场后，ProjectSession继续持有Occupancy的默认宽限时间。 */
export const PROJECT_GRACE_MS = 5 * 60_000;

/** ready generation的只读presence状态；grace仍属于strict-open数据面。 */
export type ProjectSessionPresence = {
    readonly state: "open" | "grace";
    readonly userConnections: number;
    readonly agentActive: boolean;
    readonly openedAt: string;
    readonly lastActivityAt: string;
};

/**
 * 精确 ready generation 上的一路用户 presence。
 *
 * `signal` 在该 generation 进入终止关闭（close/reopen、root 替换、shutdown）时 abort；
 * presence 长连接必须据此结束，否则会在 ready 已经不可消费后继续心跳并让浏览器保留旧代次。
 */
export type ProjectUserPresence = {
    readonly signal: AbortSignal;
    /** 释放本标签 presence；幂等，且只影响签发它的 generation。 */
    readonly release: () => void;
};

/** ProjectSession Runtime的进程级依赖；测试可注入单调时间与缩短的grace。 */
export type ProjectSessionRuntimeOptions = {
    readonly registryProvider?: () => ProjectModuleRegistrySnapshot;
    readonly now?: () => number;
    readonly graceMs?: number;
    /** 由组合根预先决定的 Source/Product compiler context；不从 cwd 推导。 */
    readonly compilerContext?: Promise<RuntimeArtifactCompilerContext>;
};

/** 长生命周期数据面启动结果：result同步返回调用方，completion只在业务terminal时settle。 */
export type ProjectOperationStart<TResult> = Readonly<{
    result: TResult;
    completion: Promise<void>;
}>;

type ProjectModuleSlot = {
    readonly module: ProjectModule;
    readonly handle: ProjectModuleHandle;
    ready: boolean;
    closed: boolean;
};

type ProjectSessionRecord = {
    readonly prepared: PreparedProjectOpen;
    readonly opener: ProjectOpener;
    readonly generation: number;
    readonly controller: AbortController;
    readonly modules: ProjectModuleSlot[];
    /** 已同步登记、尚未settle的数据面操作；completion只负责drain，不传播业务失败。 */
    readonly dataOperations: Set<Promise<void>>;
    lazyModules: readonly ProjectModule[];
    state: "opening" | "ready" | "closing" | "closing_failed" | "release_failed";
    /**
     * 锁失效或根替换后写入目标不再有效；普通关闭（用户关闭、宽限到期、删除、关停）不置位，
     * 因此已接纳操作仍可在 Module close 之前排空。
     */
    targetInvalid: boolean;
    readyRef: ReadyProjectSessionRef | null;
    closePromise: Promise<void> | null;
    closeFailure: Error | null;
    openingPromise: Promise<ReadyProjectSessionRef> | null;
    presenceState: "open" | "grace";
    userConnections: number;
    graceDeadline: number | null;
    readonly openedAt: string;
    lastActivityAt: string;
};

/** ProjectSession主动关闭原因；grace与外部root变化将在同一Core Interface复用。 */
/**
 * `user` 是用户显式关闭当前 Project：它不走 grace 复检，直接进入关闭。
 * 其余原因均由运行时自身触发（宽限到期、删除、进程关停、root 被替换、锁失效）。
 */
export type ProjectSessionCloseReason = "user" | "grace-expired" | "delete" | "shutdown" | "root-replaced" | "lock-compromised";

/**
 * ProjectSession generation状态机。
 *
 * 本Module只通过PreparedProjectOpen接管Lifecycle已经提交的Occupancy；调用adopt后在返回Promise前同步保存
 * Occupancy与required handles。opening generation不会被strict-open数据面观察到。
 */
export class ProjectSessionRuntime {
    private readonly sessions = new Map<ProjectWorkspaceKey, ProjectSessionRecord>();
    /**
     * 本运行期的标识前缀：新 Runtime 即使 generation 从 1 重新开始，也无法解析旧运行期签发的 publicId。
     * HMR 复用同一 Runtime 对象时保持不变，旧标识继续精确对应原 ready 对象。
     */
    private readonly runtimeId = randomUUID();
    private readonly registryProvider: () => ProjectModuleRegistrySnapshot;
    private readonly now: () => number;
    private readonly graceMs: number;
    private readonly compilerContext?: Promise<RuntimeArtifactCompilerContext>;
    private agentPresenceProbe: ((session: ReadyProjectSessionRef) => boolean) | null = null;
    private generation = 0;
    private state: "running" | "closing" | "closed" = "running";
    private closeAllPromise: Promise<void> | null = null;

    /** registryProvider在每个新generation开始时捕获一次，HMR替换只影响后续generation。 */
    constructor(options: ProjectSessionRuntimeOptions = {}) {
        this.registryProvider = options.registryProvider ?? projectModuleRegistry;
        this.now = options.now ?? Date.now;
        this.graceMs = options.graceMs ?? PROJECT_GRACE_MS;
        this.compilerContext = options.compilerContext;
    }

    /**
     * 同步接管PreparedProjectOpen，再并行等待全部required Module最低ready。
     * Promise履行前Session一直不可见；履行即原子发布一个ReadyProjectSessionRef。
     */
    adoptPreparedProject(
        prepared: PreparedProjectOpen,
        opener: ProjectOpener,
    ): Promise<ReadyProjectSessionRef> {
        if (this.state !== "running") {
            const runtimeError = new ProjectSessionRuntimeClosedError();
            return prepared.occupancy.release().then(
                () => Promise.reject(runtimeError),
                (releaseError: unknown) => Promise.reject(projectOccupancyReleaseFailure(
                    prepared.workspace.ref.projectRoot,
                    releaseError,
                    runtimeError,
                )),
            );
        }
        const key = prepared.workspace.key;
        if (this.sessions.has(key)) {
            const existsError = new ProjectSessionExistsError(prepared.workspace.ref.projectRoot);
            return prepared.occupancy.release().then(
                () => Promise.reject(existsError),
                (releaseError: unknown) => Promise.reject(projectOccupancyReleaseFailure(
                    prepared.workspace.ref.projectRoot,
                    releaseError,
                    existsError,
                )),
            );
        }
        const openedAt = new Date(this.now()).toISOString();
        const record: ProjectSessionRecord = {
            prepared,
            opener,
            generation: ++this.generation,
            controller: new AbortController(),
            modules: [],
            dataOperations: new Set(),
            lazyModules: [],
            state: "opening",
            targetInvalid: false,
            readyRef: null,
            closePromise: null,
            closeFailure: null,
            openingPromise: null,
            presenceState: "open",
            userConnections: 0,
            graceDeadline: null,
            openedAt,
            lastActivityAt: openedAt,
        };
        // 该写入发生在任何await之前；从此Occupancy由本generation负责。
        this.sessions.set(key, record);

        let registry: ProjectModuleRegistrySnapshot;
        try {
            registry = this.registryProvider();
            record.lazyModules = registry.lazy;
            for (const module of registry.required) {
                this.startModule(record, module);
            }
        } catch (error) {
            const failure = error instanceof Error ? error : new Error(String(error));
            record.controller.abort(failure);
            const opening = this.publishWhenReady(record, failure);
            record.openingPromise = opening;
            return opening;
        }

        void prepared.occupancy.compromised.then((error) => {
            if (this.sessions.get(key) === record) {
                record.controller.abort(error);
                if (record.state === "ready" && record.readyRef) {
                    void this.closeProject(record.readyRef, "lock-compromised").catch(() => undefined);
                }
            }
        });
        const opening = this.publishWhenReady(record);
        record.openingPromise = opening;
        return opening;
    }

    /** strict-open accessor：只返回同key当前唯一ready generation。 */
    requireReadyProject(key: ProjectWorkspaceKey): ReadyProjectSessionRef {
        const record = this.sessions.get(key);
        if (!record || record.state !== "ready" || !record.readyRef) {
            throw new ProjectNotReadyError(record?.prepared.workspace.ref.projectRoot ?? "unknown");
        }
        record.prepared.occupancy.assertHealthy();
        return record.readyRef;
    }

    /**
     * 按公开标识解析本运行期已发布的精确 ready generation。
     *
     * 只遍历当前 live sessions，不建立脱离生命周期的永久映射；旧运行期、已关闭或已替换的代次都解析不到。
     */
    resolveReadyProject(publicId: string): ReadyProjectSessionRef | null {
        for (const record of this.sessions.values()) {
            if (record.state === "ready" && record.readyRef?.publicId === publicId) {
                return record.readyRef;
            }
        }
        return null;
    }

    /** 幂等open快速路径：复用当前ready generation并取消尚未到期的grace。 */
    resumeReadyProject(key: ProjectWorkspaceKey): ReadyProjectSessionRef {
        const readyRef = this.requireReadyProject(key);
        const record = this.requireExactReadyRecord(readyRef);
        record.presenceState = "open";
        record.graceDeadline = null;
        return readyRef;
    }

    /** Facade判断失败open是否仍保留精确generation；不暴露内部状态或handles。 */
    hasProjectGeneration(key: ProjectWorkspaceKey): boolean {
        return this.sessions.has(key);
    }

    /** 返回精确ready generation的presence快照；grace仍保持ready可见。 */
    projectPresence(session: ReadyProjectSessionRef): ProjectSessionPresence {
        const record = this.requireExactReadyRecord(session);
        return Object.freeze({
            state: record.presenceState,
            userConnections: record.userConnections,
            agentActive: this.isAgentActive(record),
            openedAt: record.openedAt,
            lastActivityAt: record.lastActivityAt,
        });
    }

    /**
     * 已接纳数据面操作在真实副作用前的写入目标核验。
     *
     * 只拒绝不再有效的目标：锁失效（Occupancy 不健康）与根替换都必须停写。用户关闭、宽限到期、
     * 删除与关停属于正常排空，因此这里不看 closing 状态，已接纳操作仍能在 Module close 之前收口。
     */
    assertProjectOperationTarget(session: ReadyProjectSessionRef): void {
        const record = this.sessions.get(session.workspace.key);
        if (!record || record.readyRef !== session || record.generation !== session.generation) {
            throw new ProjectNotReadyError(session.workspace.ref.projectRoot);
        }
        if (record.targetInvalid) {
            throw new ProjectNotReadyError(session.workspace.ref.projectRoot);
        }
        record.prepared.occupancy.assertHealthy();
    }

    /** 注册结构化Agent presence探针；单槽覆盖，null用于注销。 */
    registerAgentPresenceProbe(probe: ((session: ReadyProjectSessionRef) => boolean) | null): void {
        this.agentPresenceProbe = probe;
    }

    /**
     * 为精确ready generation取得一路用户presence。
     * release按record身份绑定；旧generation的迟到release不会扣减新generation。
     */
    acquireUserPresence(session: ReadyProjectSessionRef): ProjectUserPresence {
        const record = this.requireExactReadyRecord(session);
        record.userConnections += 1;
        record.presenceState = "open";
        record.graceDeadline = null;
        let released = false;
        return {
            // controller在terminal close、root替换与shutdown时abort：presence长连接与Module数据面共享同一终止边界。
            signal: record.controller.signal,
            release: () => {
                if (released) {
                    return;
                }
                released = true;
                if (this.sessions.get(session.workspace.key) !== record || record.state !== "ready") {
                    return;
                }
                record.userConnections = Math.max(0, record.userConnections - 1);
                if (record.userConnections === 0 && record.presenceState === "open" && !this.isAgentActive(record)) {
                    record.presenceState = "grace";
                    record.graceDeadline = this.now() + this.graceMs;
                }
            },
        };
    }

    /** 仅更新当前ready generation的最近活动时间；不参与presence生命周期判定。 */
    markProjectActivity(session: ReadyProjectSessionRef): void {
        const record = this.requireExactReadyRecord(session);
        record.lastActivityAt = new Date(this.now()).toISOString();
    }

    /** 扫描ready generation并关闭已到期grace；返回本轮实际关闭的精确引用。 */
    async sweepProjectSessions(now = this.now()): Promise<ReadyProjectSessionRef[]> {
        const closed: ReadyProjectSessionRef[] = [];
        for (const record of [...this.sessions.values()]) {
            if (record.state !== "ready" || !record.readyRef) {
                continue;
            }
            if (record.presenceState === "open") {
                if (record.userConnections === 0 && !this.isAgentActive(record)) {
                    record.presenceState = "grace";
                    record.graceDeadline = now + this.graceMs;
                }
                continue;
            }
            if (record.userConnections > 0 || this.isAgentActive(record)) {
                record.presenceState = "open";
                record.graceDeadline = null;
                continue;
            }
            if (record.graceDeadline !== null && record.graceDeadline <= now) {
                const readyRef = record.readyRef;
                await this.closeProjectAt(readyRef, "grace-expired", now);
                if (this.sessions.get(readyRef.workspace.key) !== record) {
                    closed.push(readyRef);
                }
            }
        }
        return closed;
    }

    /**
     * 返回ReadyProjectSessionRef绑定generation已经捕获的精确Module handle。
     * token把名称与具体handle类型绑定；HMR后的新descriptor不能改变旧handle。
     */
    requireProjectModuleHandle<THandle extends ProjectModuleHandle>(
        session: ReadyProjectSessionRef,
        token: ProjectModuleToken<THandle>,
    ): THandle {
        const record = this.sessions.get(session.workspace.key);
        if (!record || record.state !== "ready" || record.readyRef !== session || record.generation !== session.generation) {
            throw new ProjectNotReadyError(session.workspace.ref.projectRoot);
        }
        const slot = record.modules.find(({module}) => module.token.name === token.name);
        if (!slot || !slot.ready || slot.closed) {
            throw new ProjectNotReadyError(session.workspace.ref.projectRoot);
        }
        return slot.handle as THandle;
    }

    /**
     * 按需启动lazy Module。首次调用在返回Promise前同步捕获handle，并发调用共享同一ready。
     */
    activateProjectModule<THandle extends ProjectModuleHandle>(
        session: ReadyProjectSessionRef,
        token: ProjectModuleToken<THandle>,
    ): Promise<THandle> {
        const record = this.sessions.get(session.workspace.key);
        if (!record || record.state !== "ready" || record.readyRef !== session || record.generation !== session.generation) {
            return Promise.reject(new ProjectNotReadyError(session.workspace.ref.projectRoot));
        }
        let slot = record.modules.find(({module}) => module.token.name === token.name);
        if (!slot) {
            const module = record.lazyModules.find(({token: candidate}) => candidate.name === token.name);
            if (!module || module.token.kind !== "lazy") {
                return Promise.reject(new Error(`Project lazy Module未注册：${token.name}`));
            }
            try {
                slot = this.startModule(record, module);
            } catch (error) {
                return Promise.reject(error);
            }
        }
        const exactSlot = slot;
        return exactSlot.handle.ready.then(() => {
            const current = this.sessions.get(session.workspace.key);
            if (current !== record || record.state !== "ready" || record.readyRef !== session) {
                throw new ProjectNotReadyError(session.workspace.ref.projectRoot);
            }
            exactSlot.ready = true;
            return exactSlot.handle as THandle;
        });
    }

    /**
     * 在精确ready generation同步启动一次长生命周期数据面操作。
     *
     * 内部completion会在调用start前同步进入record，因此start即使立刻触发close，Module与Occupancy
     * 也必须等业务completion settle；generation开始closing后start不会执行。
     */
    startProjectOperation<TResult>(
        session: ReadyProjectSessionRef,
        start: (signal: AbortSignal, assertTarget: () => void) => ProjectOperationStart<TResult>,
    ): TResult {
        if (this.state !== "running") {
            throw new ProjectNotReadyError(session.workspace.ref.projectRoot);
        }
        const record = this.requireExactReadyRecord(session);

        let settleOperation: () => void = () => undefined;
        const completion = new Promise<void>((resolve) => {
            settleOperation = resolve;
        });
        record.dataOperations.add(completion);
        let settled = false;
        const settle = () => {
            if (settled) {
                return;
            }
            settled = true;
            record.dataOperations.delete(completion);
            settleOperation();
        };

        try {
            const started = start(record.controller.signal, () => this.assertProjectOperationTarget(session));
            void started.completion.then(settle, settle);
            return started.result;
        } catch (error) {
            settle();
            throw error;
        }
    }

    /** 在精确ready generation登记一个普通Promise操作；同步start语义由长生命周期内核保证。 */
    runProjectOperation<TResult>(
        session: ReadyProjectSessionRef,
        operation: (signal: AbortSignal, assertTarget: () => void) => Promise<TResult>,
    ): Promise<TResult> {
        try {
            return this.startProjectOperation(session, (signal, assertTarget) => {
                const result = Promise.resolve(operation(signal, assertTarget));
                return {
                    result,
                    completion: result.then(() => undefined, () => undefined),
                };
            });
        } catch (error) {
            return Promise.reject(error);
        }
    }

    /**
     * 关闭ReadyProjectSessionRef绑定的精确generation。
     * 方法在返回Promise前同步进入closing，因此新的strict-open请求不能与异步资源释放并发穿透。
     */
    closeProject(session: ReadyProjectSessionRef, reason: ProjectSessionCloseReason): Promise<void> {
        return this.closeProjectAt(session, reason, this.now());
    }

    /** 使用调用动作已经捕获的单一时钟值复检grace，避免同一次sweep混用两个clock source。 */
    private closeProjectAt(
        session: ReadyProjectSessionRef,
        reason: ProjectSessionCloseReason,
        evaluatedNow: number,
    ): Promise<void> {
        const record = this.sessions.get(session.workspace.key);
        if (!record) {
            return Promise.resolve();
        }
        if (record.readyRef !== session || record.generation !== session.generation) {
            return Promise.reject(new ProjectNotReadyError(session.workspace.ref.projectRoot));
        }
        if (reason === "grace-expired" && (
            record.presenceState !== "grace"
            || record.userConnections > 0
            || this.isAgentActive(record)
            || record.graceDeadline === null
            || record.graceDeadline > evaluatedNow
        )) {
            return Promise.resolve();
        }
        if (record.closePromise) {
            return record.closePromise;
        }
        if (record.state === "release_failed" && record.closeFailure) {
            return Promise.reject(record.closeFailure);
        }
        // 锁失效与根替换的目标立即失效：已接纳操作不能等到 Module close 才停写。
        if (reason === "root-replaced" || reason === "lock-compromised") {
            record.targetInvalid = true;
        }
        record.state = "closing";
        record.controller.abort(new Error(`ProjectSession已开始关闭：${reason}`));
        const task = this.closeReadyRecord(record).catch((error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            record.closeFailure = failure;
            throw failure;
        }).finally(() => {
            if (record.closePromise === task) {
                record.closePromise = null;
            }
        });
        record.closePromise = task;
        return task;
    }

    /**
     * 按结构化key关闭尚未发布ready ref的opening/closing_failed generation。
     * 供Lifecycle Facade在open回滚失败后执行targeted retry；不会从最新registry重建handle。
     */
    closeProjectGeneration(key: ProjectWorkspaceKey, reason: ProjectSessionCloseReason): Promise<void> {
        const record = this.sessions.get(key);
        if (!record) {
            return Promise.resolve();
        }
        if (record.readyRef) {
            return this.closeProject(record.readyRef, reason);
        }
        if (record.closePromise) {
            return record.closePromise;
        }
        if (record.state === "release_failed" && record.closeFailure) {
            return Promise.reject(record.closeFailure);
        }
        record.controller.abort(new Error(`ProjectSession已开始关闭：${reason}`));
        const task = this.closeNonReadyRecord(record).catch((error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            record.closeFailure = failure;
            throw failure;
        }).finally(() => {
            if (record.closePromise === task) {
                record.closePromise = null;
            }
        });
        record.closePromise = task;
        return task;
    }

    /**
     * Runtime shutdown gate：同步拒绝新generation并abort全部opening，再等待每个generation精确收口。
     * 任一close失败都保留原record并允许下次closeAll重试，不会清空资源证据。
     */
    closeAll(): Promise<void> {
        if (this.closeAllPromise) {
            return this.closeAllPromise;
        }
        if (this.state === "closed") {
            return Promise.resolve();
        }
        this.state = "closing";
        const shutdownError = new ProjectSessionRuntimeClosedError();
        const records = [...this.sessions.values()];
        for (const record of records) {
            record.controller.abort(shutdownError);
        }
        const task = this.closeRecordsForShutdown(records).catch((error: unknown) => {
            if (this.closeAllPromise === task) {
                this.closeAllPromise = null;
            }
            throw error;
        });
        this.closeAllPromise = task;
        return task;
    }

    /** 同步启动一个Module并在任何ready await前捕获handle。 */
    private startModule(record: ProjectSessionRecord, module: ProjectModule): ProjectModuleSlot {
        const handle = module.start({
            prepared: record.prepared,
            opener: record.opener,
            signal: record.controller.signal,
            compilerContext: this.compilerContext,
            require: <THandle extends ProjectModuleHandle>(token: ProjectModuleToken<THandle>): THandle => {
                const dependency = record.modules.find(({module: started}) => started.token.name === token.name);
                if (!dependency || dependency.closed) {
                    throw new Error(`Project Module依赖尚未start：${token.name}`);
                }
                return dependency.handle as THandle;
            },
        });
        const slot = {module, handle, ready: false, closed: false};
        record.modules.push(slot);
        return slot;
    }

    /** 解析并校验一个仍由Runtime发布的精确ready generation。 */
    private requireExactReadyRecord(session: ReadyProjectSessionRef): ProjectSessionRecord {
        const record = this.sessions.get(session.workspace.key);
        if (!record || record.state !== "ready" || record.readyRef !== session || record.generation !== session.generation) {
            throw new ProjectNotReadyError(session.workspace.ref.projectRoot);
        }
        record.prepared.occupancy.assertHealthy();
        return record;
    }

    /** Agent探针失败按不在场处理；generation handle仍由close的幂等合同保护。 */
    private isAgentActive(record: ProjectSessionRecord): boolean {
        if (!this.agentPresenceProbe || !record.readyRef) {
            return false;
        }
        try {
            return this.agentPresenceProbe(record.readyRef);
        } catch {
            return false;
        }
    }

    /** 等待全部required handle settle；成功原子发布，失败逆序回滚后释放Occupancy。 */
    private async publishWhenReady(
        record: ProjectSessionRecord,
        firstFailure: Error | null = null,
    ): Promise<ReadyProjectSessionRef> {
        await Promise.allSettled(record.modules.map(async (slot) => {
            try {
                await slot.handle.ready;
                slot.ready = true;
            } catch (error) {
                const failure = error instanceof Error ? error : new Error(String(error));
                if (!firstFailure) {
                    firstFailure = failure;
                    record.controller.abort(failure);
                }
                throw failure;
            }
        }));
        try {
            record.prepared.occupancy.assertHealthy();
        } catch (error) {
            if (!firstFailure) {
                firstFailure = error instanceof Error ? error : new Error(String(error));
            }
        }
        if (!firstFailure && record.controller.signal.aborted) {
            firstFailure = abortReason(record.controller.signal);
        }
        if (firstFailure) {
            const openFailure = projectSessionOpenFailure(
                record.prepared.workspace.ref.projectRoot,
                firstFailure,
            );
            await this.rollbackOpening(record);
            throw openFailure;
        }
        const readyRef = Object.freeze({
            workspace: record.prepared.workspace,
            publicId: `${this.runtimeId}:${record.generation}`,
            generation: record.generation,
        });
        record.readyRef = readyRef;
        record.state = "ready";
        return readyRef;
    }

    /** required open失败的固定回滚顺序：逆序Module handles，最后Occupancy。 */
    private async rollbackOpening(record: ProjectSessionRecord): Promise<void> {
        const cleanupErrors: Error[] = [];
        record.state = "closing";
        for (const slot of [...record.modules].reverse()) {
            if (slot.closed) {
                continue;
            }
            try {
                await slot.handle.close();
                slot.closed = true;
            } catch (error) {
                cleanupErrors.push(error instanceof Error ? error : new Error(String(error)));
            }
        }
        if (cleanupErrors.length > 0) {
            record.state = "closing_failed";
            const closeFailure = new ProjectSessionCloseError(
                record.prepared.workspace.ref.projectRoot,
                cleanupErrors,
            );
            record.closeFailure = closeFailure;
            throw closeFailure;
        }
        try {
            await record.prepared.occupancy.release();
        } catch (error) {
            const releaseFailure = projectOccupancyReleaseFailure(
                record.prepared.workspace.ref.projectRoot,
                error,
            );
            record.state = "release_failed";
            record.closeFailure = releaseFailure;
            throw releaseFailure;
        }
        this.sessions.delete(record.prepared.workspace.key);
    }

    /** Ready generation只关闭自身已捕获handles；成功handle不在重试时重复关闭。 */
    private async closeReadyRecord(record: ProjectSessionRecord): Promise<void> {
        await Promise.all([...record.dataOperations]);
        const failures: Error[] = [];
        for (const slot of [...record.modules].reverse()) {
            if (slot.closed) {
                continue;
            }
            try {
                await slot.handle.close();
                slot.closed = true;
            } catch (error) {
                failures.push(error instanceof Error ? error : new Error(String(error)));
            }
        }
        if (failures.length > 0) {
            record.state = "closing_failed";
            throw new ProjectSessionCloseError(record.prepared.workspace.ref.projectRoot, failures);
        }
        try {
            await record.prepared.occupancy.release();
        } catch (error) {
            const releaseFailure = projectOccupancyReleaseFailure(
                record.prepared.workspace.ref.projectRoot,
                error,
            );
            record.state = "release_failed";
            record.closeFailure = releaseFailure;
            throw releaseFailure;
        }
        this.sessions.delete(record.prepared.workspace.key);
    }

    /** 等待opening settle后，只用record已经捕获的handles完成targeted close。 */
    private async closeNonReadyRecord(record: ProjectSessionRecord): Promise<void> {
        if (record.openingPromise) {
            try {
                await record.openingPromise;
            } catch {
                // opening failure已经由publishWhenReady保存为closing_failed/release_failed或删除record。
            }
        }
        if (this.sessions.get(record.prepared.workspace.key) !== record) {
            return;
        }
        if (record.state === "release_failed") {
            throw record.closeFailure ?? new ProjectNotReadyError(record.prepared.workspace.ref.projectRoot);
        }
        if (record.readyRef) {
            record.state = "closing";
            await this.closeReadyRecord(record);
            return;
        }
        if (record.state !== "closing_failed") {
            throw new ProjectNotReadyError(record.prepared.workspace.ref.projectRoot);
        }
        record.state = "closing";
        await this.closeReadyRecord(record);
    }

    /** 等待opening自行收口；若回滚不完整，则重试同generation尚未关闭的精确handles。 */
    private async closeRecordsForShutdown(records: readonly ProjectSessionRecord[]): Promise<void> {
        const results = await Promise.allSettled(records.map(async (record) => {
            let openingFailure: Error | null = null;
            if (record.openingPromise && !record.readyRef) {
                try {
                    await record.openingPromise;
                } catch (error) {
                    openingFailure = error instanceof Error ? error : new Error(String(error));
                    if (this.sessions.get(record.prepared.workspace.key) !== record) {
                        return;
                    }
                }
            }
            if (this.sessions.get(record.prepared.workspace.key) !== record) {
                return;
            }
            if (record.state === "release_failed") {
                throw record.closeFailure ?? openingFailure ?? new ProjectNotReadyError(
                    record.prepared.workspace.ref.projectRoot,
                );
            }
            if (!record.readyRef && record.state === "closing_failed") {
                record.state = "closing";
                await this.closeReadyRecord(record);
                return;
            }
            if (!record.readyRef) {
                throw openingFailure ?? new ProjectNotReadyError(record.prepared.workspace.ref.projectRoot);
            }
            await this.closeProject(record.readyRef, "shutdown");
        }));
        const failures = results.flatMap((result) => result.status === "rejected"
            ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))]
            : []);
        if (failures.length > 0 || this.sessions.size > 0) {
            throw new AggregateError(failures, "ProjectSession Runtime关闭不完整");
        }
        this.state = "closed";
    }
}

/** 标准AbortSignal.reason在极旧runtime缺失时提供稳定错误。 */
function abortReason(signal: AbortSignal): Error {
    return signal.reason instanceof Error
        ? signal.reason
        : new Error("ProjectSession generation已取消");
}

/** required open只包装无稳定领域类型的原始Module/registry失败。 */
function projectSessionOpenFailure(projectRoot: string, error: Error): Error {
    if (
        isProjectSessionOpenError(error)
        || isProjectSessionRuntimeClosedError(error)
        || isProjectLockCompromisedError(error)
    ) {
        return error;
    }
    return new ProjectSessionOpenError(projectRoot, error);
}

/** Occupancy release失败始终以稳定锁错误作为顶层，raw cause保留供内部日志。 */
function projectOccupancyReleaseFailure(
    projectRoot: string,
    error: unknown,
    precedingFailure?: Error,
): ProjectLockReleaseFailedError {
    if (isProjectLockReleaseFailedError(error)) {
        return error;
    }
    const releaseFailure = error instanceof Error ? error : new Error(String(error));
    const cause = precedingFailure
        ? new AggregateError([precedingFailure, releaseFailure], "ProjectSession失败且Occupancy释放不确定")
        : releaseFailure;
    return new ProjectLockReleaseFailedError({kind: "project-occupancy", projectRoot}, cause);
}
