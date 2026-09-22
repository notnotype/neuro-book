/** SSE writer 消费的不可变帧最小表面。 */
export type SseFrame = {
    readonly frame: Buffer;
};

/** 与 payload 类型无关的 SSE 订阅最小表面。 */
export type SseSubscription<Event extends SseFrame> = AsyncIterable<Event> & {
    readonly connected: Event;
    readonly signal: AbortSignal;
    close(reason?: "consumer_closed"): void;
};

/** Writer 所需的最小 Node ServerResponse 表面，便于确定性测试。 */
export type SseResponse = {
    readonly destroyed: boolean;
    readonly writableEnded: boolean;
    setHeader(name: string, value: string): void;
    flushHeaders?(): void;
    write(frame: Buffer): boolean;
    end(): void;
    destroy(error?: Error): unknown;
    once(event: "drain" | "close" | "error", listener: (...args: unknown[]) => void): unknown;
    off(event: "drain" | "close" | "error", listener: (...args: unknown[]) => void): unknown;
};

class SseClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "SseClosedError";
    }
}

/**
 * 以 Node response backpressure 写出 SSE 事件流：任一时刻最多一个 frame 在途，
 * `write(false)` 后等待 `drain`；response 的 close/error 与 subscription 的中止都会结束写出。
 */
export async function writeSseStream<Event extends SseFrame>(
    response: SseResponse,
    subscription: SseSubscription<Event>,
): Promise<void> {
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.setHeader("x-accel-buffering", "no");
    response.flushHeaders?.();

    const closeFromResponse = (): void => {
        subscription.close("consumer_closed");
    };
    const errorFromResponse = (): void => {
        subscription.close("consumer_closed");
    };
    const abortWriter = (): void => {
        if (!response.destroyed && !response.writableEnded) {
            response.destroy();
        }
    };
    response.once("close", closeFromResponse);
    response.once("error", errorFromResponse);
    subscription.signal.addEventListener("abort", abortWriter, {once: true});

    try {
        await writeFrame(response, subscription.connected, subscription.signal);
        for await (const event of subscription) {
            await writeFrame(response, event, subscription.signal);
        }
        if (!response.destroyed && !response.writableEnded) {
            response.end();
        }
    } catch (error) {
        if (!(error instanceof SseClosedError)) {
            if (!response.destroyed && !response.writableEnded) {
                response.destroy(error instanceof Error ? error : new Error(String(error)));
            }
            throw error;
        }
    } finally {
        response.off("close", closeFromResponse);
        response.off("error", errorFromResponse);
        subscription.signal.removeEventListener("abort", abortWriter);
        if (!subscription.signal.aborted) {
            subscription.close("consumer_closed");
        }
    }
}

/** 写出一个不可变 frame，并在 Node highWaterMark 触发时等待 drain。 */
async function writeFrame(response: SseResponse, event: SseFrame, signal: AbortSignal): Promise<void> {
    if (signal.aborted || response.destroyed || response.writableEnded) {
        throw new SseClosedError("SSE 已关闭");
    }
    if (response.write(event.frame)) {
        return;
    }
    await waitForDrain(response, signal);
}

/** drain、socket close/error 与 subscription abort 竞争，完成后清理全部监听器。 */
function waitForDrain(response: SseResponse, signal: AbortSignal): Promise<void> {
    if (signal.aborted || response.destroyed || response.writableEnded) {
        return Promise.reject(new SseClosedError("SSE 在等待 drain 前已关闭"));
    }
    const {promise, resolve, reject} = Promise.withResolvers<void>();
    const cleanup = (): void => {
        response.off("drain", onDrain);
        response.off("close", onClose);
        response.off("error", onError);
        signal.removeEventListener("abort", onAbort);
    };
    const onDrain = (): void => {
        cleanup();
        resolve();
    };
    const onClose = (): void => {
        cleanup();
        reject(new SseClosedError("SSE response 已关闭"));
    };
    const onError = (): void => {
        cleanup();
        reject(new SseClosedError("SSE response 写出失败"));
    };
    const onAbort = (): void => {
        cleanup();
        reject(new SseClosedError("SSE subscription 已中止"));
    };
    response.once("drain", onDrain);
    response.once("close", onClose);
    response.once("error", onError);
    signal.addEventListener("abort", onAbort, {once: true});
    return promise;
}
