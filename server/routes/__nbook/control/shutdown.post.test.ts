import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {EventEmitter} from "node:events";
import {PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT} from "nbook/shared/product-runtime-contract";

const mocks = vi.hoisted(() => ({requestProcessExit: vi.fn()}));
const originalHost = process.env.HOST;
const originalNitroHost = process.env.NITRO_HOST;

vi.mock("nbook/server/runtime/shutdown/product-shutdown", () => ({
    productShutdownController: {requestProcessExit: mocks.requestProcessExit},
}));

import shutdownHandler from "nbook/server/routes/__nbook/control/shutdown.post";

describe("POST /__nbook/control/shutdown", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        process.env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT] = "launch-secret";
    });

    afterEach(() => {
        delete process.env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT];
        restoreEnvironment("HOST", originalHost);
        restoreEnvironment("NITRO_HOST", originalNitroHost);
    });

    it("拒绝非 loopback 请求", async () => {
        expect(capture(() => shutdownHandler(event("192.168.1.20", "Bearer launch-secret") as never)))
            .toMatchObject({statusCode: 403});
        expect(mocks.requestProcessExit).not.toHaveBeenCalled();
    });

    it("socket 地址缺失时只接受明确的 loopback 监听", () => {
        process.env.NITRO_HOST = "127.0.0.1";
        const request = event(undefined, "Bearer launch-secret");

        expect(shutdownHandler(request as never)).toEqual({accepted: true});
        request.node.res.emit("finish");
        expect(mocks.requestProcessExit).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        process.env.NITRO_HOST = "0.0.0.0";
        expect(capture(() => shutdownHandler(event(undefined, "Bearer launch-secret") as never)))
            .toMatchObject({statusCode: 403});
        expect(mocks.requestProcessExit).not.toHaveBeenCalled();
    });

    it("拒绝缺失或错误 bearer token", async () => {
        expect(capture(() => shutdownHandler(event("127.0.0.1") as never)))
            .toMatchObject({statusCode: 401});
        expect(capture(() => shutdownHandler(event("127.0.0.1", "Bearer wrong-secret") as never)))
            .toMatchObject({statusCode: 401});
        expect(mocks.requestProcessExit).not.toHaveBeenCalled();
    });

    it("token 未注入时关闭控制面", async () => {
        delete process.env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT];

        expect(capture(() => shutdownHandler(event("127.0.0.1", "Bearer launch-secret") as never)))
            .toMatchObject({statusCode: 503});
    });

    it("正确 token 返回 202 并只请求 controller 退出", async () => {
        const request = event("::ffff:127.0.0.1", "bearer launch-secret");

        expect(shutdownHandler(request as never)).toEqual({accepted: true});

        expect(request.node.res.statusCode).toBe(202);
        expect(mocks.requestProcessExit).not.toHaveBeenCalled();
        request.node.res.emit("finish");
        request.node.res.emit("close");
        expect(mocks.requestProcessExit).toHaveBeenCalledTimes(1);
    });

    it("客户端先断开时也请求 controller 退出", async () => {
        const request = event("127.0.0.1", "Bearer launch-secret");

        expect(shutdownHandler(request as never)).toEqual({accepted: true});
        request.node.res.emit("close");

        expect(mocks.requestProcessExit).toHaveBeenCalledTimes(1);
    });
});

/** 构造 route 所需的最小 Node request/response。 */
function event(remoteAddress: string | undefined, authorization?: string) {
    const response = Object.assign(new EventEmitter(), {statusCode: 200});
    return {
        node: {
            req: {
                headers: authorization ? {authorization} : {},
                socket: {remoteAddress},
            },
            res: response,
        },
    };
}

function restoreEnvironment(name: "HOST" | "NITRO_HOST", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
    } else {
        process.env[name] = value;
    }
}

/** 捕获同步 H3 handler 抛出的结构化错误。 */
function capture(run: () => unknown): unknown {
    try {
        run();
        throw new Error("预期 shutdown route 拒绝请求");
    } catch (error) {
        return error;
    }
}
