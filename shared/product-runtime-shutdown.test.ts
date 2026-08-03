import {afterEach, describe, expect, it, vi} from "vitest";
import {PRODUCT_SHUTDOWN_PATH} from "nbook/shared/product-runtime-contract";
import {shutdownNativeProduct} from "nbook/shared/product-runtime-shutdown";

describe("Product Runtime shutdown client", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it("认证请求返回202且Product正常退出时完成graceful shutdown", async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, {status: 202}));
        const forceTerminate = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(shutdownNativeProduct({
            port: 43120,
            token: "test-token",
            completion: Promise.resolve({code: 0, signal: null}),
            forceTerminate,
        })).resolves.toBe("graceful");

        expect(fetchMock).toHaveBeenCalledWith(
            `http://127.0.0.1:43120${PRODUCT_SHUTDOWN_PATH}`,
            expect.objectContaining({
                method: "POST",
                headers: {authorization: "Bearer test-token"},
            }),
        );
        expect(forceTerminate).not.toHaveBeenCalled();
    });

    it.each([
        ["未认证", vi.fn().mockResolvedValue(new Response(null, {status: 401}))],
        ["连接失败", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"))],
    ])("%s时转为Owned Process强制收口", async (_name, fetchMock) => {
        const forceTerminate = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("fetch", fetchMock);

        await expect(shutdownNativeProduct({
            port: 43121,
            token: "test-token",
            completion: new Promise(() => undefined),
            forceTerminate,
            timeoutMs: 20,
        })).resolves.toBe("forced");
        expect(forceTerminate).toHaveBeenCalledOnce();
    });

    it("202后等待退出超时会强制收口", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 202})));
        const forceTerminate = vi.fn().mockResolvedValue(undefined);
        const shutdown = shutdownNativeProduct({
            port: 43122,
            token: "test-token",
            completion: new Promise(() => undefined),
            forceTerminate,
            timeoutMs: 25,
        });

        await vi.advanceTimersByTimeAsync(25);

        await expect(shutdown).resolves.toBe("forced");
        expect(forceTerminate).toHaveBeenCalledOnce();
    });

    it("graceful非零退出会强制收口", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, {status: 202})));
        const forceTerminate = vi.fn().mockResolvedValue(undefined);

        await expect(shutdownNativeProduct({
            port: 43123,
            token: "test-token",
            completion: Promise.resolve({code: 2, signal: null}),
            forceTerminate,
        })).resolves.toBe("forced");
        expect(forceTerminate).toHaveBeenCalledOnce();
    });

    it("graceful与force同时失败时保留两条错误链", async () => {
        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("graceful failed")));
        const forceFailure = new Error("force failed");

        const failure = await shutdownNativeProduct({
            port: 43124,
            token: "test-token",
            completion: new Promise(() => undefined),
            forceTerminate: async () => {
                throw forceFailure;
            },
        }).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(AggregateError);
        expect((failure as AggregateError).errors).toEqual([
            expect.objectContaining({message: "graceful failed"}),
            forceFailure,
        ]);
    });
});
