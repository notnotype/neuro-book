import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/projects/presence", () => {
    afterEach(() => vi.useRealTimers());

    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        vi.stubGlobal("defineEventHandler", (handler: unknown) => handler);
    });

    it("先启动 SSE send 再等待 presence_ready push，避免 TransformStream 背压死锁", async () => {
        let resolvePush: () => void = () => undefined;
        let onClosed: (() => void) | null = null;
        const push = vi.fn(() => new Promise<void>((resolve) => {
            resolvePush = resolve;
        }));
        const send = vi.fn(async () => "sent");
        const close = vi.fn(async () => undefined);
        const presence = presenceLease();

        mockHandlerDependencies({
            push,
            send,
            close,
            presence,
            eventStream: {onClosed: (callback) => {
                onClosed = callback;
            }},
        });

        const {acquireUserPresence} = await import("nbook/server/workspace-files/project-session");
        const handler = (await import("nbook/server/api/projects/presence.get")).default;
        const handling = handler({} as never);

        await vi.waitFor(() => {
            expect(send).toHaveBeenCalledTimes(1);
        });
        // presence 必须按 open 发布的精确标识取得对应代次，而不是只凭 projectRoot 查当前 generation。
        expect(acquireUserPresence).toHaveBeenCalledWith({projectRoot: "novel-a"}, "runtime-1:3");
        expect(push).toHaveBeenCalledWith({
            event: "presence",
            data: JSON.stringify({type: "presence_ready", projectRoot: "novel-a", publicId: "runtime-1:3"}),
        });

        resolvePush();
        await Promise.resolve();
        onClosed?.();
        await expect(handling).resolves.toBe("sent");
        expect(presence.release).toHaveBeenCalledTimes(1);
    });

    it("presence_ready 推送失败时关闭流并释放本标签页 presence", async () => {
        const failure = new Error("initial push failed");
        const push = vi.fn(async () => {
            throw failure;
        });
        const send = vi.fn(async () => "sent");
        const close = vi.fn(async () => undefined);
        const presence = presenceLease();

        mockHandlerDependencies({
            push,
            send,
            close,
            presence,
            eventStream: {onClosed: vi.fn()},
        });

        const handler = (await import("nbook/server/api/projects/presence.get")).default;
        await expect(handler({} as never)).resolves.toBe("sent");
        await vi.waitFor(() => {
            expect(close).toHaveBeenCalledTimes(1);
            expect(presence.release).toHaveBeenCalledTimes(1);
        });
    });

    it("generation 终止时结束 SSE 并停止心跳，不再向已关闭的 ready 续命", async () => {
        vi.useFakeTimers();
        const push = vi.fn(async () => undefined);
        const send = vi.fn(async () => "sent");
        const close = vi.fn(async () => undefined);
        const presence = presenceLease();

        mockHandlerDependencies({push, send, close, presence});
        const handler = (await import("nbook/server/api/projects/presence.get")).default;
        const handling = handler({} as never);
        await vi.waitFor(() => {
            expect(push).toHaveBeenCalledTimes(1);
        });

        // 该精确代次被 close/reopen、root 替换或 shutdown：租约 abort 必须立刻结束这条 SSE。
        presence.abort();
        await vi.waitFor(() => {
            expect(close).toHaveBeenCalledTimes(1);
        });
        expect(presence.release).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(90_000);
        expect(push).toHaveBeenCalledTimes(1);
        await expect(handling).resolves.toBe("sent");
    });

    it("首帧之前 generation 已终止时返回空流，不发布不可消费的 ready", async () => {
        const push = vi.fn(async () => undefined);
        const send = vi.fn(async () => "sent");
        const close = vi.fn(async () => undefined);
        const presence = presenceLease();
        presence.abort();

        mockHandlerDependencies({push, send, close, presence});
        const handler = (await import("nbook/server/api/projects/presence.get")).default;

        await expect(handler({} as never)).resolves.toBe("sent");
        await vi.waitFor(() => {
            expect(close).toHaveBeenCalledTimes(1);
        });
        expect(push).not.toHaveBeenCalled();
        expect(presence.release).toHaveBeenCalledTimes(1);
    });
});

/** 记录 abort listener 的可控 presence 租约，模拟 Facade 在精确代次终止时 abort。 */
function presenceLease() {
    const controller = new AbortController();
    return {
        signal: controller.signal,
        release: vi.fn(),
        abort: () => controller.abort(new Error("generation closed")),
    };
}

/** 绑定 h3、控制面与 Facade 的 handler 依赖，使测试只观察 presence 路由自身行为。 */
function mockHandlerDependencies(input: {
    push: (payload: unknown) => Promise<void>;
    send: () => Promise<string>;
    close: () => Promise<void>;
    presence: ReturnType<typeof presenceLease>;
    eventStream?: {onClosed: (callback: () => void) => void};
}): void {
    vi.doMock("h3", () => ({
        createEventStream: vi.fn(() => ({
            push: input.push,
            send: input.send,
            close: input.close,
            onClosed: input.eventStream?.onClosed ?? vi.fn(),
        })),
    }));
    vi.doMock("nbook/server/api/projects/project-control-plane", () => ({
        requireProjectReadyQuery: vi.fn(async () => ({ref: {projectRoot: "novel-a"}, publicId: "runtime-1:3"})),
    }));
    vi.doMock("nbook/server/api/projects/project-http-error", () => ({
        withProjectHttpError: vi.fn(async (operation: () => unknown) => operation()),
    }));
    vi.doMock("nbook/server/workspace-files/project-session", () => ({
        acquireUserPresence: vi.fn(async () => input.presence),
    }));
    vi.doMock("nbook/server/utils/event-stream", () => ({
        isClosingEventStreamError: vi.fn(() => false),
    }));
}
