import {onScopeDispose, readonly, ref, type Ref} from "vue";
import {readSseStream} from "nbook/app/utils/http/read-sse";
import {resolveApiErrorCode, resolveApiErrorMessage} from "nbook/app/utils/api-error";
import {useNotification} from "nbook/app/composables/useNotification";
import {SseReconnectBackoff} from "nbook/app/utils/http/sse-reconnect-backoff";
import type {ProjectOpenResponseDto} from "nbook/shared/dto/project.dto";

/** 已完成 open 与匹配 presence_ready 的 Project generation。 */
export type ProjectSessionReady = {
    projectRoot: string;
    revision: number;
};

/** Project 打开期间前端能够真实观测的连接阶段。 */
export type ProjectSessionOpeningPhase = "opening-project" | "connecting-presence";

/** Project Session 的唯一公开状态机；ready 之外绝不允许挂载 Project 数据面。 */
export type ProjectSessionState =
    | {status: "idle"; ready: null}
    | {status: "opening"; phase: ProjectSessionOpeningPhase; projectRoot: string; ready: null}
    | {
        status: "reconnecting";
        phase: "waiting-reconnect" | ProjectSessionOpeningPhase;
        projectRoot: string;
        ready: null;
    }
    | {status: "ready"; ready: ProjectSessionReady}
    | {status: "failed"; projectRoot: string; ready: null};

/** 服务端 presence SSE 的稳定事件合同。 */
export type ProjectPresenceEventDto =
    | {type: "presence_ready"; projectRoot: string}
    | {type: "heartbeat"};

/** Project 激活事务的唯一前端 Interface。 */
export type ProjectSessionController = {
    readonly state: Readonly<Ref<ProjectSessionState>>;
    /** 显式打开 Project，并等待 open + presence_ready。 */
    open(projectRoot: string): Promise<ProjectSessionReady>;
    /** 普通离开只释放当前标签页 presence，不关闭全局 Project。 */
    release(): Promise<void>;
    /** Vue scope 销毁时禁止后续重连，并异步释放本标签页所有权。 */
    dispose(): void;
};

export type ProjectSessionTransport = {
    /** 幂等打开指定 Project；必须接受取消当前标签页意图的 signal。 */
    open(projectRoot: string, signal: AbortSignal): Promise<ProjectOpenResponseDto>;
    /** 订阅 presence，直到 EOF、异常或 signal 中止。 */
    stream(
        projectRoot: string,
        signal: AbortSignal,
        onEvent: (event: ProjectPresenceEventDto) => void,
    ): Promise<void>;
};

export type ProjectSessionNotificationAdapter = {
    interrupted(): void;
    openFailed(projectRoot: string, error: unknown): void;
    /** 只在对应 open 赢得 generation 并进入 ready 后提示一次。 */
    manifestRecovered(projectRoot: string, recoveryPath: string): void;
};

/** latest-wins 中被新目标或 release 取代的旧调用会收到此错误。 */
export class ProjectSessionSupersededError extends Error {
    constructor(readonly projectRoot: string) {
        super("Project Session 操作已被更新目标取代：" + projectRoot);
        this.name = "ProjectSessionSupersededError";
    }
}

/** 路由和 Preview 可用此守卫静默忽略过期 intent。 */
export function isProjectSessionSupersededError(error: unknown): error is ProjectSessionSupersededError {
    return error instanceof ProjectSessionSupersededError;
}

type PresenceConnection = {
    readonly projectRoot: string;
    readonly ready: Promise<void>;
    readonly completion: Promise<void>;
};

type Opening = {
    readonly projectRoot: string;
    readonly token: number;
    readonly abort: AbortController;
    readonly reconnecting: boolean;
    presence: PresenceConnection | null;
    promise: Promise<ProjectSessionReady>;
};

type ActivePresence = {
    readonly projectRoot: string;
    readonly token: number;
    readonly abort: AbortController;
    readonly presence: PresenceConnection;
};

const DISCONNECTED_AFTER_ATTEMPTS = 3;

/**
 * 创建 Project Session Controller。
 *
 * Controller 只拥有本标签页的 open/presence 所有权；它从不调用全局 Project close。
 * 调用方必须在提交 Current Project 前 await open，因此“URL 意图”和“ready Project”
 * 不能再被同一个响应式字段混淆。
 */
export function createProjectSessionController(
    transport: ProjectSessionTransport,
    notifications: ProjectSessionNotificationAdapter,
): ProjectSessionController {
    const mutableState = ref<ProjectSessionState>({status: "idle", ready: null});
    const reconnectBackoff = new SseReconnectBackoff();
    let token = 0;
    let readyRevision = 0;
    let opening: Opening | null = null;
    let active: ActivePresence | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let interruptedNotified = false;
    let disposed = false;

    const clearReconnect = (): void => {
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    };

    const ownsOpening = (current: Opening): boolean => (
        !disposed && opening === current && current.token === token
    );

    /** 只在 matching presence_ready 后兑现 ready；EOF/错误在 ready 前均视为打开失败。 */
    const connectPresence = (projectRoot: string, signal: AbortSignal): PresenceConnection => {
        let settled = false;
        let resolveReady: () => void = () => undefined;
        let rejectReady: (error: unknown) => void = () => undefined;
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        const completion = transport.stream(projectRoot, signal, (event) => {
            if (settled || event.type !== "presence_ready") return;
            if (event.projectRoot !== projectRoot) {
                settled = true;
                rejectReady(new Error("presence_ready Project 不匹配：" + event.projectRoot));
                return;
            }
            settled = true;
            resolveReady();
        }).then(() => {
            if (!settled) {
                settled = true;
                rejectReady(new Error("presence 在 ready 前结束：" + projectRoot));
            }
        }).catch((error: unknown) => {
            if (!settled) {
                settled = true;
                rejectReady(error);
            }
            throw error;
        });
        // active observer 与 open await 会在不同微任务挂接；预先消费避免间隙 unhandled rejection。
        void completion.catch(() => undefined);
        return {projectRoot, ready, completion};
    };

    /** presence 断开立即撤销 ready，随后通过受控 reconnect 重建新 revision。 */
    const scheduleReconnect = (projectRoot: string, expectedToken: number): void => {
        if (disposed || expectedToken !== token || reconnectTimer || opening || active) return;
        const retry = reconnectBackoff.disconnected();
        mutableState.value = {status: "reconnecting", phase: "waiting-reconnect", projectRoot, ready: null};
        if (retry.wasStable) interruptedNotified = false;
        if (retry.failedAttempts >= DISCONNECTED_AFTER_ATTEMPTS && !interruptedNotified) {
            interruptedNotified = true;
            notifications.interrupted();
        }
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (disposed || expectedToken !== token || opening || active) return;
            if (mutableState.value.status !== "reconnecting" || mutableState.value.projectRoot !== projectRoot) return;
            void beginOpen(projectRoot, true).catch(() => undefined);
        }, retry.delayMs);
    };

    /** active stream 不再属于当前 generation 时，不得启动陈旧 Project 的 reconnect。 */
    const observeActive = (current: ActivePresence): void => {
        void current.presence.completion.then(
            () => {
                if (active !== current || current.token !== token) return;
                active = null;
                scheduleReconnect(current.projectRoot, current.token);
            },
            (error: unknown) => {
                if (active !== current || current.token !== token || isAbortError(error)) return;
                active = null;
                scheduleReconnect(current.projectRoot, current.token);
            },
        );
    };

    /**
     * 开启一个新 transport owner。
     *
     * open() 的新 root 会先取消旧 owner；正常主页面会在调用前 release 并清空
     * Project surface，这里仍执行取消以保证误用时不会出现双 presence。
     */
    const beginOpen = (projectRoot: string, reconnecting: boolean): Promise<ProjectSessionReady> => {
        if (opening?.projectRoot === projectRoot) return opening.promise;
        clearReconnect();
        token += 1;
        const currentToken = token;
        opening?.abort.abort();
        active?.abort.abort();
        active = null;
        const abort = new AbortController();
        const current: Opening = {
            projectRoot,
            token: currentToken,
            abort,
            reconnecting,
            presence: null,
            promise: Promise.resolve({projectRoot, revision: readyRevision}),
        };
        mutableState.value = {
            status: reconnecting ? "reconnecting" : "opening",
            phase: "opening-project",
            projectRoot,
            ready: null,
        };
        current.promise = (async () => {
            try {
                const publication = await transport.open(projectRoot, abort.signal);
                if (!ownsOpening(current)) throw new ProjectSessionSupersededError(projectRoot);
                mutableState.value = {
                    status: reconnecting ? "reconnecting" : "opening",
                    phase: "connecting-presence",
                    projectRoot,
                    ready: null,
                };
                const presence = connectPresence(projectRoot, abort.signal);
                current.presence = presence;
                await presence.ready;
                if (!ownsOpening(current)) throw new ProjectSessionSupersededError(projectRoot);

                reconnectBackoff.opened();
                interruptedNotified = false;
                const ready = {projectRoot, revision: ++readyRevision};
                const committed: ActivePresence = {projectRoot, token: currentToken, abort, presence};
                active = committed;
                opening = null;
                mutableState.value = {status: "ready", ready};
                observeActive(committed);
                if (publication.change === "normalized" || publication.change === "recovered") {
                    notifications.manifestRecovered(projectRoot, publication.recoveryPath);
                }
                return ready;
            } catch (error) {
                if (!ownsOpening(current)) {
                    throw new ProjectSessionSupersededError(projectRoot);
                }
                current.abort.abort();
                opening = null;
                if (current.reconnecting && !isProjectMissingError(error)) {
                    mutableState.value = {status: "reconnecting", phase: "waiting-reconnect", projectRoot, ready: null};
                    scheduleReconnect(projectRoot, currentToken);
                } else {
                    mutableState.value = {status: "failed", projectRoot, ready: null};
                    notifications.openFailed(projectRoot, error);
                }
                throw error;
            }
        })();
        opening = current;
        return current.promise;
    };

    /** 同 root opening single-flight；ready root 无副作用返回当前 generation。 */
    const open = (projectRoot: string): Promise<ProjectSessionReady> => {
        if (disposed) return Promise.reject(new Error("Project Session Controller 已销毁"));
        if (opening?.projectRoot === projectRoot) return opening.promise;
        if (mutableState.value.status === "ready" && mutableState.value.ready.projectRoot === projectRoot) {
            return Promise.resolve(mutableState.value.ready);
        }
        return beginOpen(projectRoot, mutableState.value.status === "reconnecting" && mutableState.value.projectRoot === projectRoot);
    };

    /** 释放本标签页 owner；显式等待 presence EOF，绝不发送全局 close。 */
    const release = async (): Promise<void> => {
        token += 1;
        clearReconnect();
        const pending = opening;
        const connected = active;
        opening = null;
        active = null;
        pending?.abort.abort();
        connected?.abort.abort();
        reconnectBackoff.reset();
        interruptedNotified = false;
        mutableState.value = {status: "idle", ready: null};
        await Promise.all([
            pending?.promise.catch(() => undefined),
            connected?.presence.completion.catch(() => undefined),
        ]);
    };

    const dispose = (): void => {
        disposed = true;
        void release();
    };

    return {
        state: readonly(mutableState),
        open,
        release,
        dispose,
    };
}

/** 在 Vue scope 内创建显式 Project Session Controller。 */
export function useProjectSession(): ProjectSessionController {
    if (!import.meta.client) {
        const state = ref<ProjectSessionState>({status: "idle", ready: null});
        return {
            state: readonly(state),
            open: async (projectRoot) => ({projectRoot, revision: 0}),
            release: async () => undefined,
            dispose: () => undefined,
        };
    }

    const notification = useNotification();
    const projectRequest = $fetch as unknown as (
        path: string,
        options: {method: "POST"; body: {projectRoot: string}; signal: AbortSignal},
    ) => Promise<ProjectOpenResponseDto>;
    const lifecycle = createProjectSessionController({
        open: async (projectRoot, signal) => await projectRequest("/api/projects/open", {
            method: "POST",
            body: {projectRoot},
            signal,
        }),
        stream: async (projectRoot, signal, onEvent) => {
            const response = await fetch("/api/projects/presence?projectRoot=" + encodeURIComponent(projectRoot), {
                method: "GET",
                signal,
            });
            await readSseStream<ProjectPresenceEventDto>(response, onEvent);
        },
    }, {
        interrupted: () => notification.warning("项目在场连接中断，正在重新连接", {title: "项目连接中断"}),
        openFailed: (projectRoot, error) => notification.error(
            resolveApiErrorMessage(error, "项目不存在或已删除：" + projectRoot),
            {title: "项目打开失败"},
        ),
        manifestRecovered: (_projectRoot, recoveryPath) => notification.info(
            "项目配置已自动修复，原文件已备份到 " + recoveryPath,
            {title: "项目配置已修复"},
        ),
    });

    onScopeDispose(() => lifecycle.dispose());
    return lifecycle;
}

function isProjectMissingError(error: unknown): boolean {
    return resolveApiErrorCode(error) === "PROJECT_NOT_FOUND";
}

function isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
