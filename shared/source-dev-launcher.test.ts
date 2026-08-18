import type {OwnedProcessCompletion, OwnedProcessLease} from "@notnotype/owned-process";
import {resolve} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
    PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
} from "nbook/shared/product-runtime-contract";

const mocks = vi.hoisted(() => ({
    spawnOwnedProcess: vi.fn(),
}));

vi.mock("@notnotype/owned-process", () => ({
    spawnOwnedProcess: mocks.spawnOwnedProcess,
}));

import {runSourceDev} from "nbook/scripts/cli/source-dev";

describe("Source Dev launcher", () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it("公开入口以Owned Process启动内部dev:runtime并传播自然退出码", async () => {
        mocks.spawnOwnedProcess.mockReturnValue(lease(Promise.resolve({exitCode: 7, signal: null})));
        const sourceCheckout = process.cwd();

        await expect(runSourceDev({
            cwd: sourceCheckout,
            env: {PORT: "43130", SOURCE_DEV_MARKER: "kept"},
        })).resolves.toBe(7);

        expect(mocks.spawnOwnedProcess).toHaveBeenCalledWith(expect.objectContaining({
            command: process.execPath,
            args: ["--no-install", "run", "dev:runtime"],
            cwd: sourceCheckout,
            env: expect.objectContaining({
                PORT: "43130",
                SOURCE_DEV_MARKER: "kept",
                HOST: "127.0.0.1",
                NITRO_HOST: "127.0.0.1",
                NEURO_BOOK_CACHE_ROOT: resolve(sourceCheckout, ".agent", "cache"),
                [PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT]: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
            }),
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
        }));
    });

    it("显式Cache Root保持原值，不由Source Dev launcher重写", async () => {
        mocks.spawnOwnedProcess.mockReturnValue(lease(Promise.resolve({exitCode: 0, signal: null})));

        await expect(runSourceDev({
            cwd: process.cwd(),
            env: {
                NEURO_BOOK_CACHE_ROOT: "C:/custom-cache",
            },
        })).resolves.toBe(0);

        expect(mocks.spawnOwnedProcess).toHaveBeenCalledWith(expect.objectContaining({
            env: expect.objectContaining({
                NEURO_BOOK_CACHE_ROOT: "C:/custom-cache",
            }),
        }));
    });

    it("首次信号直接调用lease.terminate，不尝试HTTP graceful", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        const ownedLease = lease(terminal.promise);
        mocks.spawnOwnedProcess.mockReturnValue(ownedLease);
        const before = new Set(process.listeners("SIGINT"));
        const running = runSourceDev({env: {PORT: "43131"}});

        addedSignalListener("SIGINT", before)();
        terminal.resolve({exitCode: 0, signal: null});

        await expect(running).resolves.toBe(0);
        expect(ownedLease.terminate).toHaveBeenCalledWith("shutdown");
    });

    it("首次信号后租约已终止时，第二次信号保持幂等", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        const ownedLease = lease(terminal.promise);
        mocks.spawnOwnedProcess.mockReturnValue(ownedLease);
        const before = new Set(process.listeners("SIGINT"));
        const running = runSourceDev({env: {PORT: "43132"}});
        const signal = addedSignalListener("SIGINT", before);

        signal();
        signal();
        signal();
        terminal.resolve({exitCode: 0, signal: null});

        await expect(running).resolves.toBe(0);
        expect(ownedLease.terminate).toHaveBeenCalledTimes(1);
        expect(ownedLease.terminate).toHaveBeenCalledWith("shutdown");
    });

    it("shutdown竞态中Product以75退出时保留专用退出码", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        mocks.spawnOwnedProcess.mockReturnValue(lease(terminal.promise));
        const before = new Set(process.listeners("SIGINT"));
        const running = runSourceDev({env: {PORT: "43135"}});

        addedSignalListener("SIGINT", before)();
        terminal.resolve({
            exitCode: PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
            signal: null,
        });

        await expect(running).resolves.toBe(PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED);
    });

    it("lease.terminate失败时直接向CLI传播错误", async () => {
        const terminal = deferred<OwnedProcessCompletion>();
        const failure = new Error("terminate failed");
        const ownedLease = lease(terminal.promise);
        vi.mocked(ownedLease.terminate).mockRejectedValue(failure);
        mocks.spawnOwnedProcess.mockReturnValue(ownedLease);
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
