import {
    PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
    PRODUCT_SHUTDOWN_PATH,
    PRODUCT_SHUTDOWN_TIMEOUT_MS,
} from "@notnotype/neuro-book-contracts/product-runtime";
import type {NativeProductExit, NativeProductShutdownResult} from "@notnotype/neuro-book-contracts/product-runtime";


export type NativeProductShutdownOptions = {
    port: number;
    token: string;
    /** 只允许调用方从受限联合中选择loopback地址；Manager默认使用IPv4。 */
    host?: "127.0.0.1" | "localhost" | "[::1]";
    completion: Promise<NativeProductExit>;
    forceTerminate(): Promise<void>;
    /** 测试可缩短关闭窗口；生产始终使用 Product Runtime Contract。 */
    timeoutMs?: number;
};


/**
 * 先请求 Product 按领域顺序关闭；协议失败或超时后由 Owned Process 强制收口。
 * graceful 与 force 同时失败时保留两条错误链，调用方不得继续假定进程已经退出。
 */
export async function shutdownNativeProduct(
    options: NativeProductShutdownOptions,
): Promise<NativeProductShutdownResult> {
    let completionResult: NativeProductExit | null = null;
    void options.completion.then(
        (result) => completionResult = result,
        () => undefined,
    );
    // 给已经settled的completion一次microtask机会，避免已退出75的Product仍被请求shutdown。
    await Promise.resolve();
    if (isLeaseCompromisedExit(completionResult)) return "forced";

    const timeoutMs = options.timeoutMs ?? PRODUCT_SHUTDOWN_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const host = options.host ?? "127.0.0.1";
    let gracefulFailure: unknown;
    try {
        const response = await fetch(`http://${host}:${String(options.port)}${PRODUCT_SHUTDOWN_PATH}`, {
            method: "POST",
            headers: {authorization: `Bearer ${options.token}`},
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status !== 202) {
            throw new Error(`Product shutdown 返回 HTTP ${String(response.status)}`);
        }
        const result = await waitWithin(options.completion, Math.max(0, deadline - Date.now()), timeoutMs);
        if (isLeaseCompromisedExit(result)) return "forced";
        if (result.signal !== null || result.code !== 0) {
            throw new Error(`Product graceful shutdown 异常退出：${result.signal ?? result.code}`);
        }
        return "graceful";
    } catch (error) {
        gracefulFailure = error;
        console.warn(`Product graceful shutdown 失败，转为强制收口：${errorMessage(error)}`);
    }

    await Promise.resolve();
    if (isLeaseCompromisedExit(completionResult)) return "forced";

    try {
        await options.forceTerminate();
    } catch (forceFailure) {
        await Promise.resolve();
        if (isLeaseCompromisedExit(completionResult)) return "forced";
        throw new AggregateError(
            [asError(gracefulFailure), asError(forceFailure)],
            "Product graceful shutdown 与强制收口均失败",
        );
    }
    return "forced";
}

/** 已知Product因runtime lease失效退出时，退出码75优先于关闭路径的次生失败。 */
function isLeaseCompromisedExit(result: NativeProductExit | null): boolean {
    return result !== null
        && result.signal === null
        && result.code === PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED;
}

/** 在固定剩余窗口内等待 Product 进程终态。 */
function waitWithin<T>(promise: Promise<T>, timeoutMs: number, contractTimeoutMs: number): Promise<T> {
    return new Promise<T>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(
            () => rejectPromise(new Error(`Product shutdown 在 ${String(contractTimeoutMs)}ms 内未退出`)),
            timeoutMs,
        );
        void promise.then(
            (value) => {
                clearTimeout(timer);
                resolvePromise(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                rejectPromise(error);
            },
        );
    });
}

/** 将未知失败收窄为可聚合的 Error。 */
function asError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

/** 只输出错误摘要，避免把请求凭据带入日志。 */
function errorMessage(value: unknown): string {
    return value instanceof Error ? value.message : String(value);
}