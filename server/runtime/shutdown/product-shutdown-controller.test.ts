import {describe, expect, it, vi} from "vitest";
import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "nbook/shared/product-runtime-contract";
import {ProductShutdownController} from "nbook/server/runtime/shutdown/product-shutdown-controller";

describe("ProductShutdownController", () => {
    it("并发与完成后的重复关闭共享同一个 Promise 且每步只执行一次", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolvePromise) => {
            release = resolvePromise;
        });
        const first = vi.fn(async () => gate);
        const second = vi.fn(async () => undefined);
        const controller = new ProductShutdownController([
            {name: "first", close: first},
            {name: "second", close: second},
        ]);

        const left = controller.shutdown();
        const right = controller.shutdown();
        expect(right).toBe(left);
        await Promise.resolve();
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).not.toHaveBeenCalled();

        release();
        await left;

        expect(controller.shutdown()).toBe(left);
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
    });

    it("前序步骤失败仍执行剩余步骤并聚合带步骤名的错误", async () => {
        const firstFailure = new Error("first failed");
        const thirdFailure = new Error("third failed");
        const order: string[] = [];
        const controller = new ProductShutdownController([
            {name: "first", close: async () => { order.push("first"); throw firstFailure; }},
            {name: "second", close: async () => { order.push("second"); }},
            {name: "third", close: async () => { order.push("third"); throw thirdFailure; }},
        ]);

        const result = await controller.shutdown().catch((error: unknown) => error);

        expect(order).toEqual(["first", "second", "third"]);
        expect(result).toBeInstanceOf(AggregateError);
        const failures = (result as AggregateError).errors as Error[];
        expect(failures.map((error) => error.message)).toEqual([
            "Product shutdown step 失败：first",
            "Product shutdown step 失败：third",
        ]);
        expect(failures.map((error) => error.cause)).toEqual([firstFailure, thirdFailure]);
    });

    it("draining 拒绝新请求，并等待已进入请求释放后再关闭 owner", async () => {
        const order: string[] = [];
        const controller = new ProductShutdownController([
            {name: "owner", close: async () => { order.push("owner"); }},
        ]);
        const lease = controller.enterRequest();
        expect(lease).not.toBeNull();

        const shutdown = controller.shutdown();
        expect(controller.enterRequest()).toBeNull();
        await Promise.resolve();
        expect(order).toEqual([]);

        lease?.release();
        await shutdown;
        expect(order).toEqual(["owner"]);
    });

    it("进入 draining 时先 abort 已进入请求，再等待它们释放", async () => {
        const controller = new ProductShutdownController([
            {name: "owner", close: async () => undefined},
        ]);
        const lease = controller.enterRequest();
        expect(lease).not.toBeNull();
        expect(lease?.signal.aborted).toBe(false);

        const shutdown = controller.shutdown();
        expect(lease?.signal.aborted).toBe(true);

        lease?.release();
        await shutdown;
    });

    it("HTTP drain 超时后继续关闭 owner 并聚合 drain 错误", async () => {
        vi.useFakeTimers();
        const close = vi.fn(async () => undefined);
        const controller = new ProductShutdownController(
            [{name: "owner", close}],
            {drainTimeoutMs: 100},
        );
        const lease = controller.enterRequest();
        expect(lease).not.toBeNull();

        try {
            const shutdown = controller.shutdown();
            const observed = shutdown.catch((error: unknown) => error);
            await vi.advanceTimersByTimeAsync(100);
            const failure = await observed;

            expect(close).toHaveBeenCalledTimes(1);
            expect(failure).toBeInstanceOf(AggregateError);
            expect((failure as AggregateError).errors[0]).toMatchObject({
                message: "Product shutdown step 失败：http-drain",
            });
        } finally {
            vi.useRealTimers();
        }
    });

    it("进程退出请求幂等，并按关闭结果选择退出码", async () => {
        const exits: number[] = [];
        const scheduled: Array<() => void> = [];
        const controller = new ProductShutdownController(
            [{name: "close", close: async () => undefined}],
            {
                exit: (code) => exits.push(code),
                schedule: (task) => scheduled.push(task),
            },
        );

        controller.requestProcessExit();
        controller.requestProcessExit();
        expect(scheduled).toHaveLength(1);

        scheduled[0]!();
        await controller.shutdown();
        await Promise.resolve();
        expect(exits).toEqual([0]);
    });

    it("普通关闭失败时使用退出码1", async () => {
        const exits: number[] = [];
        const scheduled: Array<() => void> = [];
        const controller = new ProductShutdownController(
            [{name: "close", close: async () => { throw new Error("close failed"); }}],
            {
                exit: (code) => exits.push(code),
                schedule: (task) => scheduled.push(task),
            },
        );

        controller.requestProcessExit();
        scheduled[0]!();
        await expect(controller.shutdown()).rejects.toBeInstanceOf(AggregateError);
        await Promise.resolve();

        expect(exits).toEqual([1]);
    });

    it("compromised退出码立即进入draining且shutdown失败时仍保留专用退出码", async () => {
        const exits: number[] = [];
        const scheduled: Array<() => void> = [];
        const controller = new ProductShutdownController(
            [{name: "close", close: async () => { throw new Error("close failed"); }}],
            {
                exit: (code) => exits.push(code),
                schedule: (task) => scheduled.push(task),
            },
        );

        controller.requestProcessExit(PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED);
        expect(controller.enterRequest()).toBeNull();
        scheduled[0]!();
        await expect(controller.shutdown()).rejects.toBeInstanceOf(AggregateError);
        await Promise.resolve();

        expect(exits).toEqual([PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED]);
    });
});
