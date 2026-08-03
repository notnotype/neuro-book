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
    | {status: "empty"; attempt: AgentSurfaceActivationAttempt}
    | {status: "error"; attempt: AgentSurfaceActivationAttempt; message: string};

/** 缺失目标恢复时，只从当前服务端列表选择一次有效 fallback。 */
export function resolveMissingSessionFallback(
    sessions: readonly {readonly sessionId: number}[],
    failedSessionId: number,
    previousSessionId: number | null,
): number | null {
    if (previousSessionId !== null
        && previousSessionId !== failedSessionId
        && sessions.some((session) => session.sessionId === previousSessionId)) {
        return previousSessionId;
    }
    return sessions.find((session) => session.sessionId !== failedSessionId)?.sessionId ?? null;
}

export type MissingSessionRecoveryResult =
    | {status: "superseded"}
    | {status: "empty"}
    | {status: "load_failed"; sessionId: number}
    | {status: "loaded"; sessionId: number};

/** 刷新一次并加载一次 fallback；调用方负责 UI 状态和提示。 */
export async function recoverMissingSessionSelection(input: {
    failedSessionId: number;
    previousSessionId: number | null;
    accepts: () => boolean;
    refresh: () => Promise<readonly {readonly sessionId: number}[]>;
    load: (sessionId: number) => Promise<boolean>;
}): Promise<MissingSessionRecoveryResult> {
    const sessions = await input.refresh();
    if (!input.accepts()) {
        return {status: "superseded"};
    }
    const fallbackSessionId = resolveMissingSessionFallback(sessions, input.failedSessionId, input.previousSessionId);
    if (fallbackSessionId === null) {
        return {status: "empty"};
    }
    const loaded = await input.load(fallbackSessionId);
    if (!input.accepts()) {
        return {status: "superseded"};
    }
    return loaded
        ? {status: "loaded", sessionId: fallbackSessionId}
        : {status: "load_failed", sessionId: fallbackSessionId};
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
    | ({status: "empty"} & ReadonlyAvailability)
    | ({status: "archived"; canRestore: boolean} & ReadonlyAvailability)
    | ({status: "profile-unavailable"; message: string} & ReadonlyAvailability)
    | ({status: "waiting-blocked"} & ReadonlyAvailability)
    | ({status: "load-error"; message: string} & ReadonlyAvailability)
    | ({status: "blocked"} & ReadonlyAvailability);

/** Composer 状态条允许请求的宿主动作。 */
export type AgentComposerAvailabilityAction = "create-session" | "retry-session" | "restore-session";

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
