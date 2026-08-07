/** SSE writer 消费的不可变帧最小表面。 */
export type AgentSseFrame = {
    readonly frame: Buffer;
};

/** 与 payload 类型无关的 SSE 订阅最小表面。 */
export type AgentSseSubscription<Event extends AgentSseFrame> = AsyncIterable<Event> & {
    readonly connected: Event;
    readonly signal: AbortSignal;
    close(reason?: "consumer_closed"): void;
};

/** Agent SSE writer 所需的最小 Node ServerResponse 表面，便于确定性测试。 */
export type AgentSseResponse = {
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

class AgentSseClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AgentSseClosedError";
    }
}

export type AgentSseWriterOptions = {
    /** Product 进程进入 draining 时主动收口该长连接。 */
    shutdownSignal?: AbortSignal;
};

/**
 * 以 Node response backpressure 写出 Agent SSE。任一时刻最多有一个 frame 进入
 * response；write(false) 后必须等 drain，subscription overflow 可立即打断等待。
 */
export async function writeAgentEventStream<Event extends AgentSseFrame>(
    response: AgentSseResponse,
    subscription: AgentSseSubscription<Event>,
    options: AgentSseWriterOptions = {},
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
    const abortFromProductShutdown = (): void => {
        subscription.close("consumer_closed");
        abortWriter();
    };
    response.once("close", closeFromResponse);
    response.once("error", errorFromResponse);
    subscription.signal.addEventListener("abort", abortWriter, {once: true});
    options.shutdownSignal?.addEventListener("abort", abortFromProductShutdown, {once: true});

    try {
        await writeFrame(response, subscription.connected, subscription.signal);
        for await (const event of subscription) {
            await writeFrame(response, event, subscription.signal);
        }
        if (!response.destroyed && !response.writableEnded) {
            response.end();
        }
    } catch (error) {
        if (!(error instanceof AgentSseClosedError)) {
            if (!response.destroyed && !response.writableEnded) {
                response.destroy(error instanceof Error ? error : new Error(String(error)));
            }
            throw error;
        }
    } finally {
        response.off("close", closeFromResponse);
        response.off("error", errorFromResponse);
        subscription.signal.removeEventListener("abort", abortWriter);
        options.shutdownSignal?.removeEventListener("abort", abortFromProductShutdown);
        if (!subscription.signal.aborted) {
            subscription.close("consumer_closed");
        }
    }
}

/** 写出一个 immutable frame，并在 Node highWaterMark 触发时等待 drain。 */
async function writeFrame(
    response: AgentSseResponse,
    event: AgentSseFrame,
    signal: AbortSignal,
): Promise<void> {
    if (signal.aborted || response.destroyed || response.writableEnded) {
        throw new AgentSseClosedError("Agent SSE 已关闭");
    }
    if (response.write(event.frame)) {
        return;
    }
    await waitForDrain(response, signal);
}

/** drain、socket close/error 与 subscription abort 竞争，完成后清理全部监听器。 */
function waitForDrain(response: AgentSseResponse, signal: AbortSignal): Promise<void> {
    if (signal.aborted || response.destroyed || response.writableEnded) {
        return Promise.reject(new AgentSseClosedError("Agent SSE 在等待 drain 前已关闭"));
    }
    return new Promise((resolve, reject) => {
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
            reject(new AgentSseClosedError("Agent SSE response 已关闭"));
        };
        const onError = (): void => {
            cleanup();
            reject(new AgentSseClosedError("Agent SSE response 写出失败"));
        };
        const onAbort = (): void => {
            cleanup();
            reject(new AgentSseClosedError("Agent SSE subscription 已中止"));
        };
        response.once("drain", onDrain);
        response.once("close", onClose);
        response.once("error", onError);
        signal.addEventListener("abort", onAbort, {once: true});
    });
}
