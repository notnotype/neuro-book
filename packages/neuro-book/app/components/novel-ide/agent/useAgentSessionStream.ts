import type {AgentSessionEventDto, AgentSessionEventsQueryDto, AgentSessionRecoveryDto, AgentSessionIdentity} from "nbook/shared/dto/agent-session.dto";
import type {AgentRecoveryApplyResult} from "nbook/app/components/novel-ide/agent/useAgentSession";
import type {Ref} from "vue";
import {ref} from "vue";
import {SseReconnectBackoff} from "nbook/app/utils/http/sse-reconnect-backoff";
import {resolveApiErrorCode} from "nbook/app/utils/api-error";

export type AgentSessionStreamRecoveryReason =
    | "initial_load"
    | "seq_gap"
    | "snapshot_required"
    | "event_epoch_changed"
    | "active_path_changed"
    | "invalid_history_cursor"
    | "linked_agent_changed"
    | "manual_refresh"
    | "invoke_error_fallback";

type AgentSessionStreamStore = {
    eventEpoch: Ref<string | null>;
    lastSeq: Ref<number>;
    needsRecovery: Ref<boolean>;
    recoveryReasons: Ref<string[]>;
    applyConnectionStatus(status: "idle" | "connecting" | "connected" | "reconnecting" | "recovering" | "disconnected"): void;
    applyEvent(event: AgentSessionEventDto): void;
    applyRecovery(recovery: AgentSessionRecoveryDto): AgentRecoveryApplyResult;
    clearRecoveryRequest(): void;
};

type AgentSessionStreamApi = {
    getSessionRecovery(sessionId: number): Promise<AgentSessionRecoveryDto>;
    subscribeSessionEvents(
        sessionId: number,
        cursor: AgentSessionEventsQueryDto,
        onEvent: (event: AgentSessionEventDto) => void | Promise<void>,
        signal?: AbortSignal,
        options?: {onOpen?: () => void},
    ): Promise<void>;
};

export type AgentSessionStreamOptions = {
    session: AgentSessionStreamStore;
    api: AgentSessionStreamApi;
    activeSessionId: Ref<number | null>;
    /** 可选的 Session 逻辑身份；存在时 SSE recovery 也必须匹配。 */
    activeSessionIdentity?: Ref<AgentSessionIdentity | null>;
    applyRecoverySideEffects?: (
        recovery: AgentSessionRecoveryDto,
        result: AgentRecoveryApplyResult,
        owner: AgentSessionStreamOwner,
    ) => void | Promise<void>;
    onEvent?: (event: AgentSessionEventDto, owner: AgentSessionStreamOwner) => void | Promise<void>;
    onSessionNotFound?: (
        error: unknown,
        owner: AgentSessionStreamOwner,
    ) => AgentSessionNotFoundHandling | void | Promise<AgentSessionNotFoundHandling | void>;
    onError?: (error: unknown, fallback: string) => void;
};

/** Session 缺失回调对 stream 错误出口的处理结果。 */
export type AgentSessionNotFoundHandling = "handled" | "deferred" | "ignored";

/** Session stream 回调的连接所有权；异步副作用提交前必须再次检查 isCurrent。 */
export type AgentSessionStreamOwner = Readonly<{
    sessionId: number;
    isCurrent: () => boolean;
}>;

type RuntimeI18n = {
    t: (key: string) => string;
};

type ConnectionReady = {
    promise: Promise<void>;
    readonly settled: boolean;
    resolve: () => void;
    reject: (error: unknown) => void;
};

const DISCONNECTED_AFTER_ATTEMPTS = 3;

/** 服务端迟迟不返回 SSE headers 时，不允许 Surface 永久停在 connecting/restoring。 */
const CONNECT_HANDSHAKE_TIMEOUT_MS = 15_000;

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

/**
 * SSE stream helper 会被普通 Vitest 直接实例化；这里不能依赖 setup-only 的 useI18n。
 */
function translate(key: string, fallback: string): string {
    try {
        const nuxtApp = useNuxtApp() as {$i18n?: RuntimeI18n};
        return nuxtApp.$i18n?.t(key) ?? fallback;
    } catch {
        return fallback;
    }
}

/**
 * 管理 Agent session SSE 连接、重连和 recovery single-flight。
 */
export function useAgentSessionStream(options: AgentSessionStreamOptions) {
    const controller = ref<AbortController | null>(null);
    const sessionId = ref<number | null>(null);
    const reconnectAttempt = ref(0);
    const lastDisconnectReason = ref("");
    let ready: ConnectionReady | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let recoveryPromise: {sessionId: number; connectionGeneration: number; promise: Promise<boolean>} | null = null;
    let recoveryGeneration = 0;
    let connectionGeneration = 0;
    let automaticRecoveryConnectionGeneration = -1;
    let stopped = false;
    let backoffSessionId: number | null = null;
    const attemptedAutomaticRecoveryReasons = new Set<AgentSessionStreamRecoveryReason>();
    const reconnectBackoff = new SseReconnectBackoff();

    const resetAutomaticRecoveryAttempts = (generation = connectionGeneration): void => {
        automaticRecoveryConnectionGeneration = generation;
        attemptedAutomaticRecoveryReasons.clear();
    };



    const restoreConnectionStatusAfterRecoveryFailure = (targetSessionId: number): void => {
        const activeController = controller.value;
        const streamAlive = activeController !== null
            && !activeController.signal.aborted
            && sessionId.value === targetSessionId;
        options.session.applyConnectionStatus(streamAlive ? "connected" : "idle");
    };
    const clearReconnectTimer = (): void => {
        if (!reconnectTimer) {
            return;
        }
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    };

    const createConnectionReady = (): ConnectionReady => {
        let resolveReady!: () => void;
        let rejectReady!: (error: unknown) => void;
        let settled = false;
        const promise = new Promise<void>((resolve, reject) => {
            resolveReady = () => {
                if (settled) return;
                settled = true;
                resolve();
            };
            rejectReady = (error) => {
                if (settled) return;
                settled = true;
                reject(error);
            };
        });
        void promise.catch(() => {});
        return {
            promise,
            get settled() {
                return settled;
            },
            resolve: resolveReady,
            reject: rejectReady,
        };
    };

    const scheduleReconnect = (targetSessionId: number, reason: string): void => {
        if (targetSessionId !== options.activeSessionId.value || stopped) {
            return;
        }
        lastDisconnectReason.value = reason;
        const retry = reconnectBackoff.disconnected();
        reconnectAttempt.value = retry.failedAttempts;
        options.session.applyConnectionStatus(retry.failedAttempts >= DISCONNECTED_AFTER_ATTEMPTS ? "disconnected" : "reconnecting");
        reconnectTimer = setTimeout(() => {
            void start(targetSessionId).catch(() => {});
        }, retry.delayMs);
    };

    /** 终结一次 Session 生命周期 recovery，避免 409 后永久停在 recovering。 */
    const settleRecoveryFailure = (targetSessionId: number, isCurrent: () => boolean): void => {
        if (!isCurrent()) {
            return;
        }
        options.session.clearRecoveryRequest();
        const liveConnection = Boolean(controller.value)
            && sessionId.value === targetSessionId
            && !controller.value?.signal.aborted
            && !stopped;
        options.session.applyConnectionStatus(liveConnection ? "connected" : "idle");
    };

    const runRecovery = async (
        reason: AgentSessionStreamRecoveryReason,
        behavior: {force: boolean; reportError: boolean},
    ): Promise<boolean> => {
        const targetSessionId = options.activeSessionId.value;
        if (!targetSessionId) {
            return false;
        }
        const recoveryConnectionGeneration = connectionGeneration;
        if (!behavior.force
            && recoveryPromise?.sessionId === targetSessionId
            && recoveryPromise.connectionGeneration === recoveryConnectionGeneration) {
            return recoveryPromise.promise;
        }
        if (behavior.force) {
            recoveryGeneration += 1;
            recoveryPromise = null;
            resetAutomaticRecoveryAttempts();
        }
        const generation = recoveryGeneration;
        const isCurrent = (): boolean => generation === recoveryGeneration
            && recoveryConnectionGeneration === connectionGeneration
            && targetSessionId === options.activeSessionId.value;
        if (reason !== "manual_refresh" && reason !== "invoke_error_fallback") {
            options.session.applyConnectionStatus("recovering");
        }
        const request = {
            sessionId: targetSessionId,
            connectionGeneration: recoveryConnectionGeneration,
            promise: Promise.resolve(false),
        };
        const promise = (async () => {
            try {
                const recovery = await options.api.getSessionRecovery(targetSessionId);
                if (!isCurrent()) {
                    return false;
                }
                if (recovery.summary.sessionId !== targetSessionId) {
                    throw new Error(`Agent session recovery 身份不匹配：期望 ${String(targetSessionId)}，收到 ${String(recovery.summary.sessionId)}`);
                }
                if (options.activeSessionIdentity?.value !== null
                    && options.activeSessionIdentity?.value !== undefined
                    && recovery.summary.sessionIdentity !== options.activeSessionIdentity.value) {
                    throw new Error("Agent session recovery 身份与当前绑定不一致");
                }
                const applyResult = options.session.applyRecovery(recovery);
                options.session.clearRecoveryRequest();
                const owner = {sessionId: targetSessionId, isCurrent};
                await options.applyRecoverySideEffects?.(recovery, applyResult, owner);
                if (!isCurrent()) {
                    return false;
                }
                resetAutomaticRecoveryAttempts();
                reconnectBackoff.reset();
                reconnectAttempt.value = 0;
                const activeController = controller.value;
                if (activeController && sessionId.value === targetSessionId && isCurrent()) {
                    // recovery cursor 是新 subscription 的 replay 起点；旧连接不能继续沿用被重置前的读取位置。
                    clearReconnectTimer();
                    connectionGeneration += 1;
                    activeController.abort();
                    if (controller.value === activeController) {
                        controller.value = null;
                        sessionId.value = null;
                        ready = null;
                    }
                    await start(targetSessionId);
                }
                return true;
            } catch (error) {
                if (!isCurrent()) {
                    return false;
                }
                const errorCode = resolveApiErrorCode(error);
                if (errorCode === "SESSION_NOT_FOUND") {
                    options.session.clearRecoveryRequest();
                    if (options.onSessionNotFound) {
                        const handling = await options.onSessionNotFound(error, {sessionId: targetSessionId, isCurrent});
                        if (handling !== "ignored") {
                            settleRecoveryFailure(targetSessionId, isCurrent);
                            return true;
                        }
                        return false;
                    }
                    settleRecoveryFailure(targetSessionId, isCurrent);
                }
                if (errorCode === "SESSION_DEPENDENCY_NOT_FOUND") {
                    settleRecoveryFailure(targetSessionId, isCurrent);
                }
                // 其余错误（invalid cursor 等）也收口：清 recovery 请求并按连接存续恢复状态，
                // 不让单次 recovery 失败把会话永久钉在 recovering（master 行为）。
                options.session.clearRecoveryRequest();
                restoreConnectionStatusAfterRecoveryFailure(targetSessionId);                if (behavior.reportError) {
                    options.onError?.(error, translate("agent.chatSurface.syncSessionFailed", "同步 Agent session 失败"));
                    return false;
                }
                throw error;
            } finally {
                if (recoveryPromise === request) {
                    recoveryPromise = null;
                }
            }
        })();
        request.promise = promise;
        recoveryPromise = request;
        return promise;
    };

    /** 普通恢复共用当前 single-flight，当前错误由 stream 的错误出口处理。 */
    const syncRecovery = async (reason: AgentSessionStreamRecoveryReason): Promise<boolean> => {
        return runRecovery(reason, {force: false, reportError: true});
    };

    /**
     * SSE 自动恢复按连接代与原因限流。正在进行的 single-flight 可以继续复用，
     * 但一次真实失败后，同一连接不会被相同控制事件持续打回 recovery。
     */
    const syncAutomaticRecovery = async (
        reason: AgentSessionStreamRecoveryReason,
        generation: number,
    ): Promise<boolean> => {
        const targetSessionId = options.activeSessionId.value;
        if (!targetSessionId || generation !== connectionGeneration) {
            return false;
        }
        if (automaticRecoveryConnectionGeneration !== generation) {
            resetAutomaticRecoveryAttempts(generation);
        }
        if (recoveryPromise?.sessionId === targetSessionId) {
            return recoveryPromise.promise;
        }
        if (attemptedAutomaticRecoveryReasons.has(reason)) {
            options.session.clearRecoveryRequest();
            restoreConnectionStatusAfterRecoveryFailure(targetSessionId);
            return false;
        }
        attemptedAutomaticRecoveryReasons.add(reason);
        return runRecovery(reason, {force: false, reportError: true});
    };

    /** 配置刷新/显式重试强制开启新 recovery generation，并把当前错误交给调用方投影。 */
    const refreshRecovery = async (reason: AgentSessionStreamRecoveryReason): Promise<boolean> => {
        return runRecovery(reason, {force: true, reportError: false});
    };

    const handleEvent = async (
        targetSessionId: number,
        generation: number,
        event: AgentSessionEventDto,
    ): Promise<void> => {
        const isCurrent = (): boolean => generation === connectionGeneration
            && targetSessionId === options.activeSessionId.value;
        if (!isCurrent() || event.sessionId !== targetSessionId) {
            return;
        }
        await options.onEvent?.(event, {sessionId: targetSessionId, isCurrent});
        if (!isCurrent()) {
            return;
        }
        options.session.applyEvent(event);
        if (options.session.needsRecovery.value) {
            const reasons = options.session.recoveryReasons.value;
            let reason: AgentSessionStreamRecoveryReason = "seq_gap";
            if (reasons.includes("event_epoch_changed")) {
                reason = "event_epoch_changed";
            } else if (reasons.includes("snapshot_required")) {
                reason = "snapshot_required";
            } else if (reasons.includes("active_path_changed")) {
                reason = "active_path_changed";
            } else if (reasons.includes("invalid_history_cursor")) {
                reason = "invalid_history_cursor";
            } else if (reasons.includes("linked_agent_changed")) {
                reason = "linked_agent_changed";
            }
            await syncAutomaticRecovery(reason, generation);
        }
    };

    const start = async (targetSessionId: number): Promise<void> => {
        if (controller.value && sessionId.value === targetSessionId) {
            await ready?.promise;
            return;
        }
        clearReconnectTimer();
        if (backoffSessionId !== targetSessionId) {
            reconnectBackoff.reset();
            reconnectAttempt.value = 0;
            backoffSessionId = targetSessionId;
        }
        controller.value?.abort();
        const nextController = new AbortController();
        const nextConnectionGeneration = ++connectionGeneration;
        resetAutomaticRecoveryAttempts(nextConnectionGeneration);
        controller.value = nextController;
        sessionId.value = targetSessionId;
        stopped = false;
        const nextReady = createConnectionReady();
        ready = nextReady;
        nextController.signal.addEventListener("abort", () => {
            nextReady.reject(new DOMException("Agent session event stream aborted", "AbortError"));
        }, {once: true});
        // 握手超时：服务端迟迟不返回 SSE headers 时，先收口 ready，再 abort 当前 controller，
        // 并复用既有重连调度；timer 在所有出口（open/abort/错误/finally）统一清除。
        const handshakeTimer = setTimeout(() => {
            if (nextReady.settled || controller.value !== nextController) {
                return;
            }
            nextReady.reject(new Error("Agent session event stream connect timeout"));
            nextController.abort();
            if (targetSessionId === options.activeSessionId.value && !stopped) {
                scheduleReconnect(targetSessionId, "event stream connect timeout");
            }
        }, CONNECT_HANDSHAKE_TIMEOUT_MS);
        options.session.applyConnectionStatus(reconnectAttempt.value > 0 ? "reconnecting" : "connecting");

        void (async () => {
            try {
                await options.api.subscribeSessionEvents(targetSessionId, {
                    eventEpoch: options.session.eventEpoch.value ?? undefined,
                    after: options.session.lastSeq.value,
                }, async (event) => {
                    await handleEvent(targetSessionId, nextConnectionGeneration, event);
                }, nextController.signal, {
                    onOpen: () => {
                        if (controller.value !== nextController
                            || nextConnectionGeneration !== connectionGeneration
                            || nextController.signal.aborted) {
                            return;
                        }
                        clearTimeout(handshakeTimer);
                        reconnectBackoff.opened();
                        options.session.applyConnectionStatus("connected");
                        nextReady.resolve();
                    },
                });
                if (controller.value === nextController && !nextController.signal.aborted) {
                    if (!nextReady.settled) {
                        nextReady.reject(new Error("Agent session event stream closed before open"));
                    }
                    scheduleReconnect(targetSessionId, "event stream closed");
                }
            } catch (error) {
                if (controller.value === nextController) {
                    nextReady.reject(error);
                }
                if (controller.value === nextController
                    && targetSessionId === options.activeSessionId.value
                    && !isAbortError(error)
                    && !stopped) {
                    scheduleReconnect(targetSessionId, error instanceof Error ? error.message : String(error));
                }
            } finally {
                clearTimeout(handshakeTimer);
                if (controller.value === nextController) {
                    controller.value = null;
                    sessionId.value = null;
                    ready = null;
                }
            }
        })();
        await nextReady.promise;
    };

    const ensure = async (): Promise<void> => {
        if (!options.activeSessionId.value) {
            return;
        }
        await start(options.activeSessionId.value);
    };

    const reconnectNow = async (): Promise<void> => {
        if (!options.activeSessionId.value) {
            return;
        }
        clearReconnectTimer();
        reconnectBackoff.reset();
        reconnectAttempt.value = 0;
        connectionGeneration += 1;
        resetAutomaticRecoveryAttempts();
        controller.value?.abort();
        controller.value = null;
        sessionId.value = null;
        ready = null;
        await start(options.activeSessionId.value);
    };

    const stop = (): void => {
        stopped = true;
        clearReconnectTimer();
        connectionGeneration += 1;
        resetAutomaticRecoveryAttempts();
        controller.value?.abort();
        controller.value = null;
        sessionId.value = null;
        ready = null;
        recoveryGeneration += 1;
        recoveryPromise = null;
        options.session.clearRecoveryRequest();
        reconnectBackoff.reset();
        reconnectAttempt.value = 0;
        backoffSessionId = null;
        options.session.applyConnectionStatus("idle");
    };

    return {
        ensure,
        lastDisconnectReason,
        reconnectNow,
        reconnectAttempt,
        refreshRecovery,
        start,
        stop,
        syncRecovery,
    };
}
