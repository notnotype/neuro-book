import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "nbook/shared/product-runtime-contract";

export type ProductShutdownStep = {
    name: string;
    close(): Promise<void>;
};

export type ProductRequestLease = {
    signal: AbortSignal;
    release: () => void;
};

export type ProductShutdownControllerOptions = {
    /** 测试可替换退出动作；生产缺省退出当前 Product 进程。 */
    exit?: (code: number) => void;
    /** 测试可替换调度动作；生产在当前 HTTP 响应处理完成后开始关闭。 */
    schedule?: (task: () => void) => void;
    /** 退出码 1 前同步报告聚合错误。 */
    reportFailure?: (error: unknown) => void;
    /** HTTP drain 等待上限；超时后继续关闭其他 owner 并返回聚合错误。 */
    drainTimeoutMs?: number;
};

/**
 * 统一拥有 Product 进程级资源的关闭顺序。
 *
 * Nitro signal close 与 Manager 控制请求共享同一个幂等 Promise，避免两条关闭路径
 * 重复释放资源。每一步失败都不会阻止后续步骤，最终以带步骤名称的 AggregateError 报告。
 */
export class ProductShutdownController {
    private shutdownPromise: Promise<void> | null = null;
    private processExitRequested = false;
    private requestedExitCode = 0;
    private draining = false;
    private activeRequests = 0;
    private readonly requestAbortControllers = new Set<AbortController>();
    private drainWaiter: (() => void) | null = null;
    private readonly exit: (code: number) => void;
    private readonly schedule: (task: () => void) => void;
    private readonly reportFailure: (error: unknown) => void;
    private readonly drainTimeoutMs: number;

    constructor(
        private readonly steps: readonly ProductShutdownStep[],
        options: ProductShutdownControllerOptions = {},
    ) {
        this.exit = options.exit ?? ((code) => process.exit(code));
        this.schedule = options.schedule ?? ((task) => setImmediate(task));
        this.reportFailure = options.reportFailure ?? (() => undefined);
        this.drainTimeoutMs = options.drainTimeoutMs ?? 20_000;
    }

    /**
     * 为一个已进入的 HTTP 请求取得进程级 lease。
     * draining 后返回 null；成功时调用方必须在 response finish/close 时释放一次。
     */
    enterRequest(): ProductRequestLease | null {
        if (this.draining) return null;
        const abortController = new AbortController();
        this.requestAbortControllers.add(abortController);
        this.activeRequests += 1;
        let released = false;
        const release = (): void => {
            if (released) return;
            released = true;
            this.requestAbortControllers.delete(abortController);
            this.activeRequests -= 1;
            if (this.activeRequests === 0) {
                this.drainWaiter?.();
                this.drainWaiter = null;
            }
        };
        return {signal: abortController.signal, release};
    }

    /** 执行一次关闭；并发和完成后的重复调用返回同一个 Promise。 */
    shutdown(): Promise<void> {
        if (!this.shutdownPromise) {
            this.shutdownPromise = this.runSteps();
        }
        return this.shutdownPromise;
    }

    /** 在控制路由返回 202 后异步关闭资源并退出 Product 进程。 */
    requestProcessExit(exitCode = 0): void {
        if (exitCode === PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED
            || this.requestedExitCode !== PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED
            && exitCode !== 0) {
            this.requestedExitCode = exitCode;
        }
        // compromised 不依赖 HTTP 响应，调用方必须从本次调用返回后立即看到 draining。
        this.draining = true;
        if (this.processExitRequested) return;
        this.processExitRequested = true;
        this.schedule(() => {
            void this.shutdown().then(
                () => this.exit(this.requestedExitCode),
                (error: unknown) => {
                    this.reportFailure(error);
                    this.exit(this.requestedExitCode === 0 ? 1 : this.requestedExitCode);
                },
            );
        });
    }

    /** 按所有权顺序执行全部步骤，并保留每个失败步骤的身份。 */
    private async runSteps(): Promise<void> {
        const failures: Error[] = [];
        this.draining = true;
        for (const abortController of this.requestAbortControllers) {
            abortController.abort(new Error("Product 正在进入关闭流程。"));
        }
        try {
            await this.waitForRequests();
        } catch (error) {
            failures.push(new Error("Product shutdown step 失败：http-drain", {cause: error}));
        }
        for (const step of this.steps) {
            try {
                await step.close();
            } catch (error) {
                failures.push(new Error(`Product shutdown step 失败：${step.name}`, {cause: error}));
            }
        }
        if (failures.length > 0) {
            throw new AggregateError(failures, "Product runtime 关闭不完整");
        }
    }

    /** 等待当前请求 lease 归零；超时不阻止后续 owner 释放。 */
    private async waitForRequests(): Promise<void> {
        if (this.activeRequests === 0) return;
        await new Promise<void>((resolvePromise, rejectPromise) => {
            const timer = setTimeout(() => {
                this.drainWaiter = null;
                rejectPromise(new Error(`HTTP drain 超过 ${String(this.drainTimeoutMs)}ms`));
            }, this.drainTimeoutMs);
            this.drainWaiter = () => {
                clearTimeout(timer);
                resolvePromise();
            };
        });
    }
}
