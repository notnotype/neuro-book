import {
    getCurrentScope,
    onScopeDispose,
    readonly,
    ref,
    toValue,
    watch,
    type MaybeRefOrGetter,
    type Ref,
} from "vue";
import {AgentSessionIdentitySchema, type AgentSessionIdentity} from "nbook/shared/dto/agent-session.dto";

/** Agent Surface 某次激活恢复的所有权凭据。 */
export type AgentSurfaceActivationAttempt = Readonly<{
    scopeKey: string;
    revision: number;
}>;

/** Agent Surface 的最小激活状态；Session 业务状态由 Composer availability 单独投影。 */
export type AgentSurfaceActivationState =
    | {status: "inactive"}
    | {status: "loading"; attempt: AgentSurfaceActivationAttempt}
    | {status: "ready"; attempt: AgentSurfaceActivationAttempt}
    | {status: "unselected"; attempt: AgentSurfaceActivationAttempt}
    | {status: "empty"; attempt: AgentSurfaceActivationAttempt}
    | {status: "error"; attempt: AgentSurfaceActivationAttempt; message: string};

export type RememberedSessionWriteResult =
    | {status: "saved"}
    | {status: "failed"; error: unknown};

/** 浏览器记忆的版本化值；身份必须与 recovery summary 完全一致。 */
export type RememberedSession = Readonly<{
    schema: 2;
    sessionId: number;
    sessionIdentity: AgentSessionIdentity;
}>;

export type RememberedSessionReadResult =
    | {status: "missing"}
    | {status: "invalid"}
    | {status: "failed"; error: unknown}
    | {status: "valid"; value: RememberedSession};

/** 读取版本化 Session 记忆；损坏或旧数字值都视为未选择，不向调用方抛出。 */
export function readRememberedSession(storage: Storage, key: string): RememberedSessionReadResult {
    let raw: string | null;
    try {
        raw = storage.getItem(key);
    } catch (error) {
        return {status: "failed", error};
    }
    if (raw === null) return {status: "missing"};
    try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return {status: "invalid"};
        const value = parsed as Partial<RememberedSession>;
        if (value.schema !== 2
            || typeof value.sessionId !== "number"
            || !Number.isInteger(value.sessionId)
            || value.sessionId <= 0
            || !AgentSessionIdentitySchema.safeParse(value.sessionIdentity).success) {
            return {status: "invalid"};
        }
        return {
            status: "valid",
            value: {
                schema: 2,
                sessionId: value.sessionId,
                sessionIdentity: value.sessionIdentity as AgentSessionIdentity,
            },
        };
    } catch {
        return {status: "invalid"};
    }
}

/** 安全写入一次性 Session 记忆；失败不能影响已经提交的权威状态。 */
export function tryWriteRememberedSession(
    storage: Storage,
    key: string,
    value: RememberedSession,
): RememberedSessionWriteResult {
    try {
        storage.setItem(key, JSON.stringify(value));
        return {status: "saved"};
    } catch (error) {
        return {status: "failed", error};
    }
}

/** 仅删除仍指向同一个 Session 身份的记忆。 */
export function forgetRememberedSession(
    storage: Storage,
    key: string,
    expected: Pick<RememberedSession, "sessionId" | "sessionIdentity">,
): boolean {
    const current = readRememberedSession(storage, key);
    if (current.status !== "valid"
        || current.value.sessionId !== expected.sessionId
        || current.value.sessionIdentity !== expected.sessionIdentity) {
        return false;
    }
    try {
        storage.removeItem(key);
        return true;
    } catch {
        return false;
    }
}

export type StreamOpenRememberOutcome =
    | {status: "connected"}
    | {status: "connect_failed"; error: unknown}
    | {status: "superseded"};

/** 权威提交后等待事件流 open；只有 open 成功且 owner 仍有效时才写浏览器记忆（ADR 0018）。 */
export async function writeRememberedAfterStreamOpen(input: {
    start: () => Promise<void>;
    accepts: () => boolean;
    remember: () => void;
}): Promise<StreamOpenRememberOutcome> {
    try {
        await input.start();
    } catch (error) {
        return input.accepts() ? {status: "connect_failed", error} : {status: "superseded"};
    }
    if (!input.accepts()) {
        return {status: "superseded"};
    }
    input.remember();
    return {status: "connected"};
}
/**
 * 注册一个"重连恢复"watcher：任何连接状态变化先做 owner 守卫（shouldRestore 为
 * false 立即自停并移出注册表），守卫通过且状态为 connected 时执行一次 onRestored
 * 并自停，否则继续挂起监听。调用方负责把 watcher 登记到同步清理表——异步
 * continuation 中创建的 watcher 不绑定组件 effect scope。
 */
export function registerReconnectRestoreWatcher<T extends string>(input: {
    connectionStatus: Ref<T>;
    stops: Set<() => void>;
    shouldRestore: () => boolean;
    onRestored: () => void;
}): void {
    let stop: (() => void) | undefined;
    const finish = (): void => {
        const current = stop;
        if (!current) return;
        stop = undefined;
        current();
        input.stops.delete(current);
    };
    const evaluate = (status: T): void => {
        // owner 守卫失败立即自停并移出注册表；守卫通过但连接未恢复则继续挂起。
        if (!input.shouldRestore()) {
            finish();
            return;
        }
        if (status !== "connected") {
            return;
        }
        finish();
        input.onRestored();
    };
    stop = watch(input.connectionStatus, evaluate);
    if (stop) {
        input.stops.add(stop);
        // 注册时连接可能已建立（旧 start 被 abort 后新连接先 open，
        // immediate:false 的 watcher 不会重放）；同步补一次检查（含 skip 自停）。
        evaluate(input.connectionStatus.value);
    }
}
export type ReconnectReadyDecision = "restore_ready" | "skip_stale_owner" | "skip_wrong_session" | "skip_not_error";

/**
 * 握手失败后后台重连成功时，判断当前 Surface 是否应恢复 ready 并补写记忆。
 * 纯投影：调用方负责把 decision 翻译成 markReady/saveLastSession 副作用。
 * - restore_ready：仍是同一 activation attempt 且目标 Session 是当前会话，应恢复。
 * - skip_*：旧代次、目标已被替换或 activation 已非 error（新 owner 已接管），不得误标。
 */
export function projectReconnectReady(input: {
    activationStatus: "inactive" | "loading" | "ready" | "error" | "unselected" | "empty" | "superseded";
    attemptScopeKey: string;
    attemptRevision: number;
    expectedScopeKey: string;
    expectedRevision: number;
    activeSessionId: number | null;
    expectedSessionId: number;
}): ReconnectReadyDecision {
    if (input.activationStatus !== "error") {
        return "skip_not_error";
    }
    if (input.attemptScopeKey !== input.expectedScopeKey || input.attemptRevision !== input.expectedRevision) {
        return "skip_stale_owner";
    }
    if (input.activeSessionId !== input.expectedSessionId) {
        return "skip_wrong_session";
    }
    return "restore_ready";
}

/** Session recovery 读取后提交的结果；dependency_missing 不得触发主资源 fallback。 */
export type SessionLoadAttemptResult<TResult> =
    | {status: "loaded"; value: TResult}
    | {status: "primary_missing"}
    | {status: "dependency_missing"; error: unknown}
    | {status: "failed"; error: unknown}
    | {status: "superseded"};

/** 主/Inline Session 加载向调用方报告的结果；只有 loaded 可以提交为成功。 */
export type AgentSessionLoadResult<TResult> =
    | {status: "loaded"; value: TResult}
    | {status: "empty"}
    | {status: "primary_missing"}
    | {status: "dependency_missing"; error: unknown}
    | {status: "failed"; error: unknown}
    | {status: "superseded"};

export type AgentSessionLoadStatus =
    | "loaded"
    | "primary_missing"
    | "dependency_missing"
    | "failed"
    | "empty"
    | "superseded";

/** 将 Session 读取结果投影成 Surface 可执行的最小副作用集合。 */
export type AgentSessionLoadProjection =
    | {status: "commit"}
    | {status: "preserve"; reason: "primary_missing" | "dependency_missing" | "failed" | "empty"}
    | {status: "clear"; reason: "primary_missing" | "failed" | "empty"}
    | {status: "superseded"};

/** 稳定当前 Session 时只保留旧内容；其余失败才允许清空 Surface。 */
export function projectAgentSessionLoad(
    status: AgentSessionLoadStatus,
    hasStableSession: boolean,
): AgentSessionLoadProjection {
    if (status === "loaded") {
        return {status: "commit"};
    }
    if (status === "superseded") {
        return {status: "superseded"};
    }
    if ((status === "primary_missing" || status === "dependency_missing" || status === "empty") && hasStableSession) {
        return {status: "preserve", reason: status};
    }
    if (status === "failed" && hasStableSession) {
        return {status: "preserve", reason: "failed"};
    }
    return {
        status: "clear",
        reason: status === "primary_missing" || status === "failed" || status === "empty"
            ? status
            : "failed",
    };
}

/** Session 目标加载的前台/recovery 发布权；两类 owner 共享同一 scope，但互相不会误认。 */
export type AgentSessionLoadOwner = Readonly<{
    scopeKey: string;
    revision: number;
    kind: "foreground" | "recovery";
}>;

type SessionRecoveryRequest = {
    owner: AgentSessionLoadOwner;
    promise: Promise<unknown>;
};

type DeferredSessionRecoveryRequest = {
    scopeKey: string;
    work: (owner: AgentSessionLoadOwner) => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
    promise: Promise<unknown>;
};

export type AgentSessionRecoveryStart<TResult> = Readonly<{
    status: "started" | "reused" | "deferred";
    promise: Promise<TResult>;
}>;

/**
 * 管理一个 Session Surface 内的目标加载竞争。
 *
 * 前台选择会立即撤销 recovery；recovery 只在没有前台加载时启动，并在同一代次内
 * single-flight。它不取消网络请求，只阻止迟到结果、错误和 finally 发布到新 owner。
 */
export class AgentSessionLoadController {
    private nextRevision = 0;
    private current: AgentSessionLoadOwner | null = null;
    private recoveryRequest: SessionRecoveryRequest | null = null;
    private deferredRecovery: DeferredSessionRecoveryRequest | null = null;

    /** 开始前台加载，并立即使旧 recovery 失效。 */
    beginForeground(scopeKey: string): AgentSessionLoadOwner {
        if (this.deferredRecovery && this.deferredRecovery.scopeKey !== scopeKey) {
            this.deferredRecovery.resolve(undefined);
            this.deferredRecovery = null;
        }
        const owner = Object.freeze({scopeKey, revision: ++this.nextRevision, kind: "foreground" as const});
        this.current = owner;
        return owner;
    }

    /** 启动、复用或延迟当前 scope 的 recovery；recovery work 负责检查 owner。 */
    runRecovery<TResult>(
        scopeKey: string,
        work: (owner: AgentSessionLoadOwner) => Promise<TResult>,
    ): AgentSessionRecoveryStart<TResult> {
        if (this.current?.kind === "foreground") {
            if (this.deferredRecovery && this.deferredRecovery.scopeKey === scopeKey) {
                return {
                    status: "deferred",
                    promise: this.deferredRecovery.promise as Promise<TResult>,
                };
            }
            if (this.deferredRecovery) {
                this.deferredRecovery.resolve(undefined);
                this.deferredRecovery = null;
            }
            let resolveDeferred!: (value: unknown) => void;
            let rejectDeferred!: (error: unknown) => void;
            const promise = new Promise<unknown>((resolve, reject) => {
                resolveDeferred = resolve;
                rejectDeferred = reject;
            });
            this.deferredRecovery = {
                scopeKey,
                work: work as (owner: AgentSessionLoadOwner) => Promise<unknown>,
                resolve: resolveDeferred,
                reject: rejectDeferred,
                promise,
            };
            return {status: "deferred", promise: promise as Promise<TResult>};
        }
        if (this.recoveryRequest
            && this.current?.revision === this.recoveryRequest.owner.revision
            && this.current.scopeKey === scopeKey
            && this.recoveryRequest.owner.scopeKey === scopeKey) {
            return {status: "reused", promise: this.recoveryRequest.promise as Promise<TResult>};
        }

        const owner = Object.freeze({scopeKey, revision: ++this.nextRevision, kind: "recovery" as const});
        this.current = owner;
        const request: SessionRecoveryRequest = {owner, promise: Promise.resolve()};
        const promise = (async () => {
            try {
                return await work(owner);
            } finally {
                if (this.current?.revision === owner.revision) {
                    this.current = null;
                }
                if (this.recoveryRequest === request) {
                    this.recoveryRequest = null;
                }
            }
        })();
        request.promise = promise;
        this.recoveryRequest = request;
        return {status: "started", promise: promise as Promise<TResult>};
    }

    /** 判断 owner 是否仍拥有当前 scope 的 Session 提交权。 */
    accepts(owner: AgentSessionLoadOwner, scopeKey: string): boolean {
        return this.current?.revision === owner.revision
            && this.current.scopeKey === owner.scopeKey
            && owner.scopeKey === scopeKey;
    }

    /** 完成前台加载；成功时丢弃 deferred，失败保留旧 Session 时 replay 一次。 */
    async finish(owner: AgentSessionLoadOwner, replayDeferred = false): Promise<void> {
        if (!this.accepts(owner, owner.scopeKey)) return;
        if (owner.kind !== "foreground") return;
        this.current = null;
        const deferred = this.deferredRecovery;
        this.deferredRecovery = null;
        if (!deferred) return;
        if (deferred.scopeKey !== owner.scopeKey) {
            deferred.resolve(undefined);
            return;
        }
        if (!replayDeferred) {
            deferred.resolve(undefined);
            return;
        }
        const recovery = this.runRecovery(deferred.scopeKey, deferred.work as (recoveryOwner: AgentSessionLoadOwner) => Promise<unknown>);
        recovery.promise.then(deferred.resolve, deferred.reject);
        await recovery.promise.catch(() => undefined);
    }

    /** 组件/Workspace 重置时立即撤销当前 owner。 */
    invalidate(): void {
        this.nextRevision += 1;
        this.current = null;
        const deferred = this.deferredRecovery;
        this.deferredRecovery = null;
        deferred?.resolve(undefined);
    }
}

/** 只在 recovery 读取成功且 owner 仍有效时提交目标 Session 状态。 */
export async function runSessionLoadAttempt<TResult>(input: {
    read: () => Promise<TResult>;
    commit: (value: TResult) => Promise<void> | void;
    accepts: () => boolean;
    errorCode: (error: unknown) => string | null;
}): Promise<SessionLoadAttemptResult<TResult>> {
    let value: TResult;
    try {
        value = await input.read();
    } catch (error) {
        if (!input.accepts()) {
            return {status: "superseded"};
        }
        const code = input.errorCode(error);
        if (code === "SESSION_NOT_FOUND") {
            return {status: "primary_missing"};
        }
        if (code === "SESSION_DEPENDENCY_NOT_FOUND") {
            return {status: "dependency_missing", error};
        }
        return {status: "failed", error};
    }
    if (!input.accepts()) {
        return {status: "superseded"};
    }
    try {
        await input.commit(value);
    } catch (error) {
        if (!input.accepts()) {
            return {status: "superseded"};
        }
        return {status: "failed", error};
    }
    return input.accepts()
        ? {status: "loaded", value}
        : {status: "superseded"};
}

/** 被新 scope、激活代次或组件销毁取代的请求。调用方应静默忽略。 */
export class AgentSurfaceSupersededError extends Error {
    constructor(readonly attempt: AgentSurfaceActivationAttempt) {
        super(`Agent Surface 请求已过期：${attempt.scopeKey}@${String(attempt.revision)}`);
        this.name = "AgentSurfaceSupersededError";
    }
}

/** 判断异步失败是否只是旧激活代次被取代。 */
export function isAgentSurfaceSupersededError(error: unknown): error is AgentSurfaceSupersededError {
    return error instanceof AgentSurfaceSupersededError;
}

type InFlightRequest = {
    attempt: AgentSurfaceActivationAttempt;
    promise: Promise<unknown>;
};

/**
 * 持有 Agent Surface 的激活代次与 recovery single-flight。
 *
 * Controller 不取消网络请求；它只保证旧结果、旧错误和旧 finally 都无法发布到新代次。
 */
export class AgentSurfaceActivationController {
    private readonly mutableState = ref<AgentSurfaceActivationState>({status: "inactive"});
    private nextRevision = 0;
    private current: AgentSurfaceActivationAttempt | null = null;
    private inFlight: InFlightRequest | null = null;
    private disposed = false;

    readonly state: Readonly<Ref<AgentSurfaceActivationState>> = readonly(this.mutableState);

    /** 为指定 scope 开启一个新激活代次，并立即使旧异步链失效。 */
    begin(scopeKey: string): AgentSurfaceActivationAttempt {
        if (this.disposed) {
            throw new Error("Agent Surface 激活协调器已销毁");
        }
        const attempt = Object.freeze({scopeKey, revision: ++this.nextRevision});
        this.current = attempt;
        this.mutableState.value = {status: "loading", attempt};
        return attempt;
    }

    /** 停用 Surface；在途请求可结束，但不能再发布结果。 */
    deactivate(): void {
        this.nextRevision += 1;
        this.current = null;
        this.mutableState.value = {status: "inactive"};
    }

    /** 判断 attempt 是否仍同时拥有当前 scope 与激活代次。 */
    accepts(attempt: AgentSurfaceActivationAttempt, currentScopeKey: string): boolean {
        return !this.disposed
            && this.current?.revision === attempt.revision
            && this.current.scopeKey === attempt.scopeKey
            && currentScopeKey === attempt.scopeKey;
    }

    /** 同一 scope + revision 共用一次 recovery；新代次永不复用旧 Promise。 */
    run<TResult>(
        attempt: AgentSurfaceActivationAttempt,
        currentScopeKey: () => string,
        work: () => Promise<TResult>,
    ): Promise<TResult> {
        if (!this.accepts(attempt, currentScopeKey())) {
            return Promise.reject(new AgentSurfaceSupersededError(attempt));
        }
        if (this.inFlight
            && this.inFlight.attempt.revision === attempt.revision
            && this.inFlight.attempt.scopeKey === attempt.scopeKey) {
            return this.inFlight.promise as Promise<TResult>;
        }

        const request: InFlightRequest = {
            attempt,
            promise: Promise.resolve(),
        };
        const promise = (async () => {
            try {
                const result = await work();
                if (!this.accepts(attempt, currentScopeKey())) {
                    throw new AgentSurfaceSupersededError(attempt);
                }
                return result;
            } catch (error) {
                if (!this.accepts(attempt, currentScopeKey())) {
                    throw new AgentSurfaceSupersededError(attempt);
                }
                throw error;
            } finally {
                if (this.inFlight === request) {
                    this.inFlight = null;
                }
            }
        })();
        request.promise = promise;
        this.inFlight = request;
        return promise;
    }

    /** 当前代次已恢复出可展示的 Session。 */
    markReady(attempt: AgentSurfaceActivationAttempt, currentScopeKey: string): boolean {
        if (!this.accepts(attempt, currentScopeKey)) return false;
        this.mutableState.value = {status: "ready", attempt};
        return true;
    }

    /** 当前实例有可用 Session，但没有可信记忆可自动选择。 */
    markUnselected(attempt: AgentSurfaceActivationAttempt, currentScopeKey: string): boolean {
        if (!this.accepts(attempt, currentScopeKey)) return false;
        this.mutableState.value = {status: "unselected", attempt};
        return true;
    }

    /** 当前代次确认没有 Session；不会隐式创建。 */
    markEmpty(attempt: AgentSurfaceActivationAttempt, currentScopeKey: string): boolean {
        if (!this.accepts(attempt, currentScopeKey)) return false;
        this.mutableState.value = {status: "empty", attempt};
        return true;
    }

    /** 当前代次恢复失败；迟到错误不会覆盖新状态。 */
    markError(attempt: AgentSurfaceActivationAttempt, currentScopeKey: string, message: string): boolean {
        if (!this.accepts(attempt, currentScopeKey)) return false;
        this.mutableState.value = {status: "error", attempt, message};
        return true;
    }

    /** 组件销毁时永久失效当前代次。 */
    dispose(): void {
        this.deactivate();
        this.disposed = true;
    }
}

/** Project/Session 异步操作的发布结果；superseded 不是业务错误，不应通知用户。 */
export type AgentSurfaceOperationResult<TResult> =
    | {status: "current"; value: TResult}
    | {status: "superseded"};

/** 打开主 Agent 面板时，真实失败不能伪装成 superseded。 */
export type AgentSessionOpenResult<TResult> = AgentSurfaceOperationResult<TResult>
    | {status: "failed"; message: string};

/** Inline Editor 选择结果；空列表和恢复失败都不能被投影为已绑定。 */
export type InlineEditorSelectionResult =
    | AgentSurfaceOperationResult<void>
    | {status: "empty"}
    | {status: "failed"; message: string};

/** 将 Inline Editor 加载结果投影给 PromptBar，只有 current 才是成功。 */
export function projectInlineEditorSelection(
    result: {status: "current" | "superseded" | "empty" | "failed"; message?: string},
): InlineEditorSelectionResult {
    switch (result.status) {
        case "current":
            return {status: "current", value: undefined};
        case "superseded":
            return {status: "superseded"};
        case "empty":
            return {status: "empty"};
        case "failed":
            return {status: "failed", message: result.message ?? "Inline AI Session 加载失败。"};
    }
}

/** 父级 Inline 列表请求接纳恢复子请求的最新代次。 */
export function adoptInlineEditorRequest(
    parentRequestId: number,
    result: {status: "current" | "superseded" | "empty" | "failed"; requestId?: number},
): {status: "current"; requestId: number} | {status: "superseded"} {
    if (result.status === "superseded"
        || result.requestId === undefined
        || result.requestId < parentRequestId) {
        return {status: "superseded"};
    }
    return {status: "current", requestId: result.requestId};
}

/**
 * Surface 局部异步操作所有权。
 *
 * 它不取消已经提交的 HTTP 请求，只阻止旧 Project generation 的结果、错误和 finally
 * 回填当前界面。每次 Project generation、重置或显式换代都必须调用 begin/invalidate。
 */
export class AgentSurfaceOperationController {
    private nextRevision = 0;
    private current: AgentSurfaceActivationAttempt | null = null;
    private disposed = false;

    /** 开启新代次，并立即撤销旧操作的发布权。 */
    begin(scopeKey: string): AgentSurfaceActivationAttempt {
        if (this.disposed) {
            throw new Error("Agent Surface 操作协调器已销毁");
        }
        const owner = Object.freeze({scopeKey, revision: ++this.nextRevision});
        this.current = owner;
        return owner;
    }

    /** 返回当前 owner；未激活或 scope 不匹配时返回 null。 */
    capture(currentScopeKey: string): AgentSurfaceActivationAttempt | null {
        if (!this.current || !this.accepts(this.current, currentScopeKey)) {
            return null;
        }
        return this.current;
    }

    /** 判断 owner 是否仍拥有当前 scope 的发布权。 */
    accepts(owner: AgentSurfaceActivationAttempt, currentScopeKey: string): boolean {
        return !this.disposed
            && this.current?.revision === owner.revision
            && this.current.scopeKey === owner.scopeKey
            && currentScopeKey === owner.scopeKey;
    }

    /** 运行操作并把迟到成功/错误统一投影为 superseded。 */
    async run<TResult>(
        owner: AgentSurfaceActivationAttempt,
        currentScopeKey: () => string,
        work: () => Promise<TResult>,
    ): Promise<AgentSurfaceOperationResult<TResult>> {
        if (!this.accepts(owner, currentScopeKey())) {
            return {status: "superseded"};
        }
        try {
            const value = await work();
            return this.accepts(owner, currentScopeKey())
                ? {status: "current", value}
                : {status: "superseded"};
        } catch (error) {
            if (!this.accepts(owner, currentScopeKey())) {
                return {status: "superseded"};
            }
            throw error;
        }
    }

    /** 立即撤销当前操作的发布权。 */
    invalidate(): void {
        this.nextRevision += 1;
        this.current = null;
    }

    /** 组件销毁后永久拒绝新操作。 */
    dispose(): void {
        this.invalidate();
        this.disposed = true;
    }
}

export type AgentSurfaceActivationWatchContext = Readonly<{
    initial: boolean;
    reactivated: boolean;
    scopeChanged: boolean;
}>;

export type AgentSurfaceActivationWatchOptions = {
    active: MaybeRefOrGetter<boolean>;
    scopeKey: MaybeRefOrGetter<string>;
    controller: AgentSurfaceActivationController;
    activate: (attempt: AgentSurfaceActivationAttempt, context: AgentSurfaceActivationWatchContext) => void | Promise<void>;
    deactivate?: (context: AgentSurfaceActivationWatchContext) => void | Promise<void>;
};

/**
 * 把 Vue active/scope 生命周期绑定到激活协调器。
 * immediate 保证组件初次以 active=true 挂载时也会进入恢复流程。
 */
export function watchAgentSurfaceActivation(options: AgentSurfaceActivationWatchOptions): () => void {
    let observed = false;
    const stop = watch(
        [() => toValue(options.active), () => toValue(options.scopeKey)] as const,
        ([active, scopeKey], previous) => {
            const initial = !observed;
            observed = true;
            const previousActive = previous?.[0] ?? false;
            const previousScopeKey = previous?.[1];
            const context = {
                initial,
                reactivated: !initial && active && !previousActive,
                scopeChanged: previousScopeKey !== undefined && previousScopeKey !== scopeKey,
            };
            if (!active) {
                options.controller.deactivate();
                void options.deactivate?.(context);
                return;
            }
            const attempt = options.controller.begin(scopeKey);
            void options.activate(attempt, context);
        },
        {immediate: true},
    );

    if (getCurrentScope()) {
        onScopeDispose(() => {
            stop();
            options.controller.dispose();
        });
    }
    return stop;
}

type ReadonlyAvailability = {
    readonly: true;
    /** 只读运行仍可从发送位终止时为 true。 */
    canStop: boolean;
};

/** Composer 的单一可用性合同，避免 readonly 与 reason 组合出矛盾状态。 */
export type AgentComposerAvailability =
    | {status: "ready"; readonly: false; canStop: false}
    | ({status: "restoring"} & ReadonlyAvailability)
    | ({status: "unselected"} & ReadonlyAvailability)
    | ({status: "empty"} & ReadonlyAvailability)
    | ({status: "archived"; canRestore: boolean} & ReadonlyAvailability)
    | ({status: "profile-unavailable"; message: string} & ReadonlyAvailability)
    | ({status: "waiting-blocked"} & ReadonlyAvailability)
    | ({status: "load-error"; message: string} & ReadonlyAvailability)
    | ({status: "blocked"} & ReadonlyAvailability);

/** Composer 状态条允许请求的宿主动作。 */
export type AgentComposerAvailabilityAction = "create-session" | "retry-session" | "restore-session" | "choose-session";

export type AgentComposerAvailabilityInput = {
    activation: AgentSurfaceActivationState;
    summary: null | {
        archived: boolean;
        profileAvailability: string;
        /** Profile 无法加载时的服务端原因；loaded 时通常为空。 */
        profileIssueMessage?: string | null;
    };
    pendingUserInput: boolean;
    running: boolean;
    interaction: {
        canInvoke: boolean;
        canResolveUserInput: boolean;
        canRestore: boolean;
        canAbort: boolean;
    };
};

/** 将激活、Session 与 interaction policy 投影为 Composer 唯一状态。 */
export function projectAgentComposerAvailability(input: AgentComposerAvailabilityInput): AgentComposerAvailability {
    const canStop = input.running && input.interaction.canAbort;
    if (input.activation.status === "loading" || input.activation.status === "inactive") {
        return {status: "restoring", readonly: true, canStop};
    }
    if (input.activation.status === "error") {
        return {status: "load-error", readonly: true, canStop, message: input.activation.message};
    }

    if (input.activation.status === "unselected") {
        return {status: "unselected", readonly: true, canStop};
    }
    if (input.activation.status === "empty") {
        return {status: "empty", readonly: true, canStop};
    }
    if (!input.summary) {
        return {status: "blocked", readonly: true, canStop};
    }
    if (input.summary.archived) {
        return {
            status: "archived",
            readonly: true,
            canStop,
            canRestore: input.interaction.canRestore,
        };
    }
    if (input.summary.profileAvailability !== "loaded") {
        return {
            status: "profile-unavailable",
            readonly: true,
            canStop,
            message: input.summary.profileIssueMessage?.trim() ?? "",
        };
    }
    if (input.pendingUserInput && !input.interaction.canResolveUserInput) {
        return {status: "waiting-blocked", readonly: true, canStop};
    }
    if (!input.interaction.canInvoke) {
        return {status: "blocked", readonly: true, canStop};
    }
    return {status: "ready", readonly: false, canStop: false};
}
