/**
 * Product HTTP request context 的最小 shutdown 接口。
 *
 * Middleware 为每个已进入请求注入一个进程级 AbortSignal；长连接（SSE）必须在
 * draining 时主动结束自己的订阅和 response，普通短请求则继续自然完成。
 */
export type ProductHttpShutdownEvent = {
    context?: Record<string, unknown>;
};

const PRODUCT_SHUTDOWN_SIGNAL_KEY = "productShutdownSignal";

export function setProductShutdownSignal(event: ProductHttpShutdownEvent, signal: AbortSignal): void {
    event.context ??= {};
    event.context[PRODUCT_SHUTDOWN_SIGNAL_KEY] = signal;
}

export function readProductShutdownSignal(event: ProductHttpShutdownEvent): AbortSignal | undefined {
    const signal = event.context?.[PRODUCT_SHUTDOWN_SIGNAL_KEY];
    return signal instanceof AbortSignal ? signal : undefined;
}

export function clearProductShutdownSignal(event: ProductHttpShutdownEvent, signal: AbortSignal): void {
    if (event.context?.[PRODUCT_SHUTDOWN_SIGNAL_KEY] === signal) {
        delete event.context[PRODUCT_SHUTDOWN_SIGNAL_KEY];
    }
}

/**
 * 绑定一次性的 Product shutdown 回调，返回移除监听器的函数。
 * 已经 aborted 的 signal 立即执行回调，避免长连接在注册前错过关闭事件。
 */
export function bindProductShutdownSignal(signal: AbortSignal | undefined, onAbort: () => void): () => void {
    if (!signal) return () => undefined;
    if (signal.aborted) {
        onAbort();
        return () => undefined;
    }
    const listener = (): void => onAbort();
    signal.addEventListener("abort", listener, {once: true});
    return () => signal.removeEventListener("abort", listener);
}
