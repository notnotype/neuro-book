import {randomUUID} from "node:crypto";
import {BroadcastChannel, threadId} from "node:worker_threads";

export const DEVELOPMENT_PROCESS_CHANNEL = "nbook:development-process";
// 20 秒 HTTP 排空，加 25 秒插件释放与日志刷写；超时只报告失败，不触碰租约锁。
const WORKER_STOP_TIMEOUT_MS = 45_000;

type DevelopmentProcessMessage =
    | {readonly kind: "worker-ready"; readonly workerId: string}
    | {readonly kind: "worker-closed"; readonly workerId: string}
    | {readonly kind: "worker-stop-requested"; readonly workerId: string; readonly source: string}
    | {readonly kind: "stop-command"; readonly requestId: string; readonly source: string; readonly workers: readonly string[]}
    | {readonly kind: "worker-stop-complete"; readonly requestId: string; readonly workerId: string; readonly exitCode: number};

export type DevelopmentProcessChannel = {
    onmessage: ((event: {readonly data: unknown}) => void) | null;
    postMessage(message: DevelopmentProcessMessage): void;
    close(): void;
};

type DevelopmentSignalSource = {
    on(event: NodeJS.Signals, listener: () => void): unknown;
    off(event: NodeJS.Signals, listener: () => void): unknown;
    rawListeners?(event: NodeJS.Signals): Array<() => void>;
};

type DevelopmentHooks = {
    hook(name: string, handler: (...args: unknown[]) => unknown): unknown;
};

type DevelopmentNuxt = DevelopmentHooks & {
    close(): Promise<void>;
};

type DevelopmentListener = {
    close(): Promise<void> | void;
};

type DevelopmentMainProcessOptions = {
    readonly channel?: DevelopmentProcessChannel;
    readonly process?: DevelopmentSignalSource;
    readonly exit?: (code: number) => void;
    readonly report?: (error: unknown) => void;
    readonly listenerSignalBaseline?: ReadonlyMap<NodeJS.Signals, readonly (() => void)[]>;
};

type DevelopmentWorkerBridgeOptions = {
    readonly channel?: DevelopmentProcessChannel;
    readonly workerId?: string;
    readonly report?: (error: unknown) => void;
};

let workerProcessStop: ((source: string) => void) | null = null;
/** 配置求值早于 CLI listen；模块安装晚于 listen，差集只允许 listhen 的一对 once 退出监听。 */
export function captureDevelopmentSignalListeners(): ReadonlyMap<NodeJS.Signals, readonly (() => void)[]> {
    return new Map(["SIGINT", "SIGTERM"].map((signal) => [signal as NodeJS.Signals, process.rawListeners(signal)]));
}

export function createDevelopmentProcessChannel(): DevelopmentProcessChannel {
    return new BroadcastChannel(DEVELOPMENT_PROCESS_CHANNEL) as unknown as DevelopmentProcessChannel;
}

/** 由开发 worker 的控制路由通知主线程，不向生产进程发送进程级停止请求。 */
export function notifyDevelopmentProcessStop(source: string): void {
    workerProcessStop?.(source);
}

/** 主线程只协调真实 worker；worker 的 stop 回执后才关闭 Nuxt，避免先断开请求再排空。 */
export function installDevelopmentMainProcessHost(
    nuxt: DevelopmentNuxt,
    options: DevelopmentMainProcessOptions = {},
): {requestStop(source: string): Promise<void>} {
    const processSource = options.process ?? process;
    const exit = options.exit ?? ((code: number) => { process.exit(code); });
    const report = options.report ?? ((error: unknown) => { console.error("开发进程停止失败", error); });
    if (options.listenerSignalBaseline) {
        const replacements: Array<readonly [NodeJS.Signals, () => void]> = [];
        for (const [signal, baseline] of options.listenerSignalBaseline) {
            const added = (processSource.rawListeners?.(signal) ?? []).filter((listener) => !baseline.includes(listener));
            if (added.length > 1 || added.some((listener) => !("listener" in listener))) {
                throw new Error(`Nuxt CLI ${signal} 自动退出监听发生变化，开发宿主拒绝替换未知监听。`);
            }
            for (const listener of added) replacements.push([signal, listener]);
        }
        for (const [signal, listener] of replacements) processSource.off(signal, listener);
    }
    const channel = options.channel ?? createDevelopmentProcessChannel();
    const activeWorkers = new Set<string>();
    let devListener: DevelopmentListener | undefined;
    let stopping: Promise<void> | null = null;
    let cleaned = false;
    let exitCalled = false;
    let pending: PendingWorkerStop | null = null;

    const onMessage = (event: {readonly data: unknown}): void => {
        const message = parseMessage(event.data);
        if (!message) return;
        if (message.kind === "worker-ready") {
            activeWorkers.add(message.workerId);
            if (pending && pending.source !== "hmr:reload" && !pending.targets.has(message.workerId)) {
                pending.targets.add(message.workerId);
                channel.postMessage({kind: "stop-command", requestId: pending.requestId, source: pending.source, workers: [message.workerId]});
            } else if (stopping && !pending) {
                void requestWorkers("host:closing");
            }
            return;
        }
        if (message.kind === "worker-stop-requested") {
            activeWorkers.add(message.workerId);
            void requestStop(message.source);
            return;
        }
        if (message.kind === "worker-closed") {
            activeWorkers.delete(message.workerId);
            settleWorker(message.workerId, 1);
            return;
        }
        if (message.kind === "worker-stop-complete") {
            settleWorker(message.workerId, message.exitCode, message.requestId);
        }
    };
    channel.onmessage = onMessage;

    const signalHandlers: ReadonlyArray<readonly [NodeJS.Signals, () => void]> = [
        ["SIGINT", () => { void requestStop("signal:SIGINT"); }],
        ["SIGTERM", () => { void requestStop("signal:SIGTERM"); }],
    ];
    for (const [signal, listener] of signalHandlers) processSource.on(signal, listener);

    nuxt.hook("listen", (_server, listener) => {
        if (isDevelopmentListener(listener)) devListener = listener;
    });
    // Nitro 在 CI 下不等 worker 的 close 钩子；必须在它开始重载或终止线程之前拿到 Product 回执。
    nuxt.hook("nitro:init", (nitro) => {
        if (!isDevelopmentNitro(nitro)) throw new TypeError("开发宿主没有取得 Nitro 生命周期钩子。");
        nitro.hooks.hook("dev:reload", () => stopForReload());
    });
    nuxt.hook("close", async () => {
        await requestWorkers("host:close");
        cleanup();
    });

    function requestStop(source: string): Promise<void> {
        if (stopping) return stopping;
        stopping = stop(source).catch((error: unknown) => {
            report(error);
            cleanup();
            finishExit(1);
        });
        return stopping;
    }

    async function stop(source: string): Promise<void> {
        const workerExitCode = await requestWorkers(source);
        const failedWorkerCode = workerExitCode !== 0;
        const failureExitCode = workerExitCode === 75 ? 75 : 1;
        const results = await Promise.allSettled([
            nuxt.close(),
            devListener ? Promise.resolve(devListener.close()) : Promise.resolve(),
        ]);
        let failedClose = false;
        for (const result of results) {
            if (result.status === "rejected") {
                failedClose = true;
                report(result.reason);
            }
        }
        cleanup();
        finishExit(failedWorkerCode || failedClose ? failureExitCode : 0);
    }

    async function stopForReload(): Promise<void> {
        const code = await requestWorkers("hmr:reload");
        if (code !== 0) report(new Error(`开发热重载的旧实例关闭不完整：exitCode=${String(code)}`));
    }

    function requestWorkers(source: string): Promise<number> {
        if (pending) return pending.promise;
        const targets = new Set(activeWorkers);
        if (targets.size === 0) return Promise.resolve(0);
        const requestId = randomUUID();
        const completion = Promise.withResolvers<number>();
        const timer = setTimeout(() => {
            const unfinished = pending;
            if (!unfinished || unfinished.requestId !== requestId) return;
            pending = null;
            report(new Error(`开发旧实例未在${String(WORKER_STOP_TIMEOUT_MS)}ms内停止：${[...unfinished.targets].filter((worker) => !unfinished.completed.has(worker)).join(",")}`));
            unfinished.resolve(unfinished.exitCode === 75 ? 75 : 1);
        }, WORKER_STOP_TIMEOUT_MS);
        pending = {requestId, source, targets, completed: new Set(), exitCode: 0, timer, resolve: completion.resolve, promise: completion.promise};
        channel.postMessage({kind: "stop-command", requestId, source, workers: [...targets]});
        return completion.promise;
    }

    function settleWorker(workerId: string, exitCode: number, requestId?: string): void {
        if (!pending || !pending.targets.has(workerId) || (requestId !== undefined && pending.requestId !== requestId)) return;
        activeWorkers.delete(workerId);
        pending.completed.add(workerId);
        pending.exitCode = Math.max(pending.exitCode, exitCode);
        if (pending.completed.size === pending.targets.size) {
            const finished = pending;
            pending = null;
            clearTimeout(finished.timer);
            finished.resolve(finished.exitCode);
        }
    }

    function finishExit(code: number): void {
        if (exitCalled) return;
        exitCalled = true;
        exit(code);
    }

    function cleanup(): void {
        if (cleaned) return;
        cleaned = true;
        for (const [signal, listener] of signalHandlers) processSource.off(signal, listener);
        channel.onmessage = null;
        channel.close();
    }

    return {requestStop};
}

/** worker 把控制路由和主线程信号统一翻译为同一个宿主 stop 入口。 */
export function installDevelopmentWorkerStopBridge(
    stop: (source: string) => Promise<number>,
    options: DevelopmentWorkerBridgeOptions = {},
): {
    notifyProcessStop(source: string): void;
    close(): void;
} {
    const channel = options.channel ?? createDevelopmentProcessChannel();
    const workerId = options.workerId ?? process.env.NITRO_DEV_WORKER_ID?.trim() ?? `thread:${String(threadId)}`;
    const report = options.report ?? ((error: unknown) => { console.error("开发 worker 停止失败", error); });
    let stopping: Promise<number> | null = null;
    const handled = new Set<string>();
    let closed = false;
    const notify = (source: string): void => {
        if (!closed) channel.postMessage({kind: "worker-stop-requested", workerId, source});
    };

    channel.onmessage = (event) => {
        const message = parseMessage(event.data);
        if (!message || message.kind !== "stop-command" || !message.workers.includes(workerId) || handled.has(message.requestId)) return;
        handled.add(message.requestId);
        stopping ??= stop(message.source);
        void stopping.then((exitCode) => {
            if (!closed) channel.postMessage({kind: "worker-stop-complete", requestId: message.requestId, workerId, exitCode});
        }).catch((error: unknown) => {
            report(error);
            if (!closed) channel.postMessage({kind: "worker-stop-complete", requestId: message.requestId, workerId, exitCode: 1});
        });
    };
    workerProcessStop = notify;
    channel.postMessage({kind: "worker-ready", workerId});

    return {
        notifyProcessStop: notify,
        close() {
            if (closed) return;
            closed = true;
            if (workerProcessStop === notify) workerProcessStop = null;
            channel.postMessage({kind: "worker-closed", workerId});
            channel.onmessage = null;
            channel.close();
        },
    };
}

function isDevelopmentListener(value: unknown): value is DevelopmentListener {
    return typeof value === "object"
        && value !== null
        && "close" in value
        && typeof value.close === "function";
}

function isDevelopmentNitro(value: unknown): value is {hooks: DevelopmentHooks} {
    return typeof value === "object" && value !== null && "hooks" in value
        && typeof value.hooks === "object" && value.hooks !== null && "hook" in value.hooks
        && typeof value.hooks.hook === "function";
}

type PendingWorkerStop = {
    readonly requestId: string;
    readonly source: string;
    readonly promise: Promise<number>;
    readonly timer: NodeJS.Timeout;
    readonly targets: Set<string>;
    readonly completed: Set<string>;
    exitCode: number;
    readonly resolve: (exitCode: number) => void;
};

function parseMessage(value: unknown): DevelopmentProcessMessage | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    if (typeof record.kind !== "string") return null;
    if (record.kind === "worker-ready" || record.kind === "worker-closed") {
        return typeof record.workerId === "string" ? record as DevelopmentProcessMessage : null;
    }
    if (record.kind === "worker-stop-requested") {
        return typeof record.workerId === "string" && typeof record.source === "string"
            ? record as DevelopmentProcessMessage
            : null;
    }
    if (record.kind === "stop-command") {
        return typeof record.requestId === "string" && typeof record.source === "string"
            && Array.isArray(record.workers) && record.workers.every((worker) => typeof worker === "string")
            ? record as DevelopmentProcessMessage
            : null;
    }
    if (record.kind === "worker-stop-complete") {
        return typeof record.requestId === "string"
            && typeof record.workerId === "string"
            && (record.exitCode === 0 || record.exitCode === 1 || record.exitCode === 75)
            ? record as DevelopmentProcessMessage
            : null;
    }
    return null;
}
