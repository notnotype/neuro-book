import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "nbook/shared/product-runtime-contract";

export type ApplicationReadyCompletion = Promise<{code: number | null; signal: string | null}>;

/** 等待 loopback 版本接口与启动 nonce 就绪；ready 前任何进程终态都算启动失败。 */
export async function waitForApplicationReady(
    port: number,
    expectedVersion: string,
    completion: ApplicationReadyCompletion,
    timeoutMs: number,
    expectedStartupNonce?: string,
): Promise<void> {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Application 端口非法：${String(port)}`);
    const completionState: {
        terminal?: {code: number | null; signal: string | null};
        error?: unknown;
    } = {};
    void completion.then(
        (result) => completionState.terminal = result,
        (error: unknown) => completionState.error = error,
    );
    const deadline = Date.now() + timeoutMs;
    let lastError = "服务尚未响应";
    let nextProgressAt = Date.now() + 10_000;
    while (Date.now() < deadline) {
        if (completionState.error) throw completionState.error;
        if (completionState.terminal) {
            throw new Error(productExitErrorMessage(completionState.terminal, "Product 在 ready 前退出"));
        }
        try {
            const response = await fetch(`http://127.0.0.1:${String(port)}/api/app/version`, {
                signal: AbortSignal.timeout(1_000),
                ...(expectedStartupNonce ? {headers: {"x-neuro-book-startup-nonce": expectedStartupNonce}} : {}),
            });
            if (response.ok) {
                const value = await response.json() as {versionLabel?: string; startupNonce?: string};
                const expected = expectedVersion.startsWith("v") ? expectedVersion : `v${expectedVersion}`;
                if (value.versionLabel !== expected) {
                    throw new Error(`Product 版本接口返回 ${value.versionLabel ?? "<missing>"}，期望 ${expected}。`);
                }
                if (expectedStartupNonce && value.startupNonce !== expectedStartupNonce) {
                    throw new Error("Product 启动 nonce 与本次候选不一致。");
                }
                return;
            }
            lastError = `HTTP ${String(response.status)}`;
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        if (Date.now() >= nextProgressAt) {
            console.error(`Product健康检查仍在等待：${lastError}`);
            nextProgressAt = Date.now() + 10_000;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    }
    throw new Error(`Product HTTP 健康检查超时：${lastError}`);
}

function productExitErrorMessage(
    result: {code: number | null; signal: string | null},
    fallback: string,
): string {
    if (result.signal === null && result.code === PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED) {
        return "NeuroBook 服务因运行租约失去所有权而退出。";
    }
    return `${fallback}：${result.signal ?? result.code}`;
}
