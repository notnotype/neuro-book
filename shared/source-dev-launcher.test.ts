import type {OwnedProcessCompletion, OwnedProcessLease} from "@notnotype/owned-process";
import {afterEach, describe, expect, it, vi} from "vitest";
import {PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT} from "nbook/shared/product-runtime-contract";

const mocks = vi.hoisted(() => ({
    spawnOwnedProcess: vi.fn(),
    shutdownNativeProduct: vi.fn(),
}));

vi.mock("@notnotype/owned-process", () => ({
    spawnOwnedProcess: mocks.spawnOwnedProcess,
}));
vi.mock("nbook/shared/product-runtime-shutdown", () => ({
    shutdownNativeProduct: mocks.shutdownNativeProduct,
}));

import {runSourceDev} from "nbook/scripts/cli/source-dev";

describe("Source Dev launcher", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("公开入口以Owned Process启动内部dev:runtime并传播自然退出码", async () => {
        mocks.spawnOwnedProcess.mockReturnValue(lease(Promise.resolve({exitCode: 7, signal: null})));

        await expect(runSourceDev({
            cwd: "C:/source-checkout",
            env: {PORT: "43130", SOURCE_DEV_MARKER: "kept"},
        })).resolves.toBe(7);

        expect(mocks.spawnOwnedProcess).toHaveBeenCalledWith(expect.objectContaining({
            command: process.execPath,
            args: ["--no-install", "run", "dev:runtime"],
            cwd: "C:/source-checkout",
            env: expect.objectContaining({
                PORT: "43130",
                SOURCE_DEV_MARKER: "kept",
                HOST: "127.0.0.1",
                NITRO_HOST: "127.0.0.1",
                [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
            }),
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        }));
    });

    it("首次信号只请求共享graceful shutdown并等待Product终态", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        const ownedLease = lease(terminal.promise);
        mocks.spawnOwnedProcess.mockReturnValue(ownedLease);
        mocks.shutdownNativeProduct.mockResolvedValue("graceful");
        const before = new Set(process.listeners("SIGINT"));
        const running = runSourceDev({env: {PORT: "43131"}});

        addedSignalListener("SIGINT", before)();
        terminal.resolve({exitCode: 0, signal: null});

        await expect(running).resolves.toBe(0);
        expect(mocks.shutdownNativeProduct).toHaveBeenCalledWith(expect.objectContaining({
            port: 43131,
            host: "127.0.0.1",
            completion: expect.any(Promise),
            forceTerminate: expect.any(Function),
        }));
        expect(ownedLease.terminate).not.toHaveBeenCalled();
    });

    it("显式localhost监听时graceful shutdown使用同一loopback地址", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        mocks.spawnOwnedProcess.mockReturnValue(lease(terminal.promise));
        mocks.shutdownNativeProduct.mockResolvedValue("graceful");
        const before = new Set(process.listeners("SIGINT"));
        const running = runSourceDev({env: {PORT: "43134", HOST: "localhost"}});

        addedSignalListener("SIGINT", before)();
        terminal.resolve({exitCode: 0, signal: null});

        await expect(running).resolves.toBe(0);
        expect(mocks.shutdownNativeProduct).toHaveBeenCalledWith(expect.objectContaining({host: "localhost"}));
    });

    it("第二次信号幂等地立即强制收口，不等待仍挂起的graceful请求", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        const graceful = deferred<"graceful" | "forced">();
        const ownedLease = lease(terminal.promise);
        vi.mocked(ownedLease.terminate).mockResolvedValue({
            exitCode: null,
            signal: "SIGTERM",
            terminationReason: "shutdown",
        });
        mocks.spawnOwnedProcess.mockReturnValue(ownedLease);
        mocks.shutdownNativeProduct.mockReturnValue(graceful.promise);
        const before = new Set(process.listeners("SIGINT"));
        const running = runSourceDev({env: {PORT: "43132"}});
        const signal = addedSignalListener("SIGINT", before);

        signal();
        signal();
        signal();
        terminal.resolve({exitCode: null, signal: "SIGTERM", terminationReason: "shutdown"});

        await expect(running).resolves.toBe(0);
        expect(ownedLease.terminate).toHaveBeenCalledTimes(1);
        expect(ownedLease.terminate).toHaveBeenCalledWith("shutdown");
    });

    it("graceful和force均失败时立即向CLI传播AggregateError", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        const failure = new AggregateError([new Error("graceful"), new Error("force")], "shutdown failed");
        mocks.spawnOwnedProcess.mockReturnValue(lease(terminal.promise));
        mocks.shutdownNativeProduct.mockRejectedValue(failure);
        const before = new Set(process.listeners("SIGTERM"));
        const running = runSourceDev({env: {PORT: "43133"}});

        addedSignalListener("SIGTERM", before)();

        await expect(running).rejects.toBe(failure);
    });
});

/** 构造测试用 Owned Process lease。 */
function lease(completion: Promise<OwnedProcessCompletion>): OwnedProcessLease & {terminate: ReturnType<typeof vi.fn>} {
    return {
        completion,
        terminate: vi.fn().mockResolvedValue({exitCode: 0, signal: null, terminationReason: "shutdown"}),
    };
}

/** 找出本次 runSourceDev 注册的信号监听器，避免向 Vitest 自身广播真实信号。 */
function addedSignalListener(signal: NodeJS.Signals, before: Set<(...args: never[]) => unknown>): () => void {
    const listener = process.listeners(signal)
        .find((candidate) => !before.has(candidate as (...args: never[]) => unknown)) as ((value: NodeJS.Signals) => void) | undefined;
    if (!listener) throw new Error(`Source Dev未注册${signal}监听器`);
    return () => listener(signal);
}

/** 创建可精确推进的 Promise。 */
function deferred<T>(): {promise: Promise<T>; resolve(value: T): void} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise;
    });
    return {promise, resolve};
}
