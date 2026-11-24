/**
 * 进程级的停止请求（`site.operations` 输出 8、9）。`runCli` 在解析命令之前装上，所以配置校验、迁移期间收到的信号也不丢：
 *
 * - 第一次 `SIGTERM` 或 `SIGINT`：请求停止，`signal` 随之 abort。命令在下一个检查点收手（迁移在两条之间，`serve` 在监听
 *   之前或排空时，模块命令在运行之前或自己看 `signal`）。
 * - 停止期间再来一次：强制，`serve` 立即断开在途请求、不再等模块收尾，模块命令不再等 `run()`。
 * - 请求之外的未捕获异常与未处理的 Promise 拒绝：写一行 `process.fatal`（只有错误类型），按停止的步骤收口，以 1 退出。
 *   再来一次同样当作强制。
 *
 * 信号处理函数是 JS 回调，只在事件循环转到它时执行；同步的长操作（一条迁移）做完之前它不会跑。
 */

import {errorType, type Logger} from "./log";

export interface StopState {
    /** 已请求停止（信号或致命错误）。 */
    readonly requested: boolean;
    /**
     * 请求停止的时刻，单调时钟（`performance.now()`）；还没请求时为 null。停止时限从这里算：墙钟会被 NTP 或虚拟机恢复
     * 往回拨，按墙钟算的截止时刻会跟着推后。
     */
    readonly requestedAt: number | null;
    /** 第一次请求停止时 abort；交给模块命令（`CommandContext.signal`）。 */
    readonly signal: AbortSignal;
    /** 停止期间又来了一次信号或致命错误。 */
    readonly forced: boolean;
    /** 出过致命错误：进程以 1 退出。 */
    readonly failed: boolean;
    /** 第一次请求停止时 resolve。 */
    readonly whenRequested: Promise<void>;
    /** 强制时 resolve。 */
    readonly whenForced: Promise<void>;
}

export interface ProcessLifecycle extends StopState {
    /** 摘掉装上的处理函数。 */
    dispose(): void;
}

const SIGNALS = ["SIGTERM", "SIGINT"] as const;

export function installProcessLifecycle(log: Logger): ProcessLifecycle {
    let requestedAt: number | null = null;
    let forced = false;
    let failed = false;
    const controller = new AbortController();
    let resolveRequested!: () => void;
    let resolveForced!: () => void;
    const whenRequested = new Promise<void>((resolve) => (resolveRequested = resolve));
    const whenForced = new Promise<void>((resolve) => (resolveForced = resolve));

    const request = (): void => {
        if (requestedAt === null) {
            requestedAt = performance.now();
            resolveRequested();
            controller.abort();
        } else if (!forced) {
            forced = true;
            resolveForced();
        }
    };
    const onSignal = (signal: NodeJS.Signals): void => {
        log.info("process.signal", "stop requested by signal", {signal, forced: requestedAt !== null});
        request();
    };
    const onFatal = (error: unknown): void => {
        failed = true;
        log.error("process.fatal", "unhandled error outside a request", {errorType: errorType(error)});
        request();
    };

    for (const signal of SIGNALS) process.on(signal, onSignal);
    process.on("uncaughtException", onFatal);
    process.on("unhandledRejection", onFatal);

    return {
        get requested() {
            return requestedAt !== null;
        },
        get requestedAt() {
            return requestedAt;
        },
        get forced() {
            return forced;
        },
        get failed() {
            return failed;
        },
        signal: controller.signal,
        whenRequested,
        whenForced,
        dispose() {
            for (const signal of SIGNALS) process.off(signal, onSignal);
            process.off("uncaughtException", onFatal);
            process.off("unhandledRejection", onFatal);
        },
    };
}
