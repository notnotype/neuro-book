/**
 * Storage 请求期限。
 *
 * ofetch 在提供 signal 时忽略自己的 timeout，且它自带的计时器只覆盖响应头；上下文初始化/释放与
 * 值动作都需要覆盖完整响应体读取的同一期限，因此把这段语义放在一个共享位置。
 */

/** 一次 Storage HTTP 请求的期限；从发起请求起算，覆盖响应头与完整响应体。 */
export const STORAGE_REQUEST_TIMEOUT_MS = 15_000;

/** 每次请求独占计时器和监听器；外部取消不拥有写队列，也不替代请求期限。 */
export function createRequestCancellation(signal: AbortSignal | undefined): {readonly signal: AbortSignal; dispose(): void} {
    const controller = new AbortController();
    const cancel = (): void => controller.abort(signal?.reason);
    if (signal?.aborted) cancel();
    else signal?.addEventListener("abort", cancel, {once: true});
    const timeout = setTimeout(() => controller.abort(new DOMException("Storage 请求超时", "TimeoutError")), STORAGE_REQUEST_TIMEOUT_MS);
    return {
        signal: controller.signal,
        dispose() {
            clearTimeout(timeout);
            signal?.removeEventListener("abort", cancel);
        },
    };
}
