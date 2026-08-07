import {beforeEach, describe, expect, it, vi} from "vitest";

describe("GET /api/projects/presence", () => {
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
        const release = vi.fn();

        vi.doMock("h3", () => ({
            createEventStream: vi.fn(() => ({
                push,
                send,
                close,
                onClosed: vi.fn((callback: () => void) => {
                    onClosed = callback;
                }),
            })),
        }));
        vi.doMock("nbook/server/api/projects/project-control-plane", () => ({
            requireProjectRefQuery: vi.fn(async () => ({projectRoot: "novel-a"})),
        }));
        vi.doMock("nbook/server/api/projects/project-http-error", () => ({
            withProjectHttpError: vi.fn(async (operation: () => unknown) => operation()),
        }));
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            acquireUserPresence: vi.fn(async () => release),
        }));
        vi.doMock("nbook/server/utils/event-stream", () => ({
            isClosingEventStreamError: vi.fn(() => false),
        }));

        const handler = (await import("nbook/server/api/projects/presence.get")).default;
        const handling = handler({} as never);

        await vi.waitFor(() => {
            expect(send).toHaveBeenCalledTimes(1);
        });
        expect(push).toHaveBeenCalledWith({
            event: "presence",
            data: JSON.stringify({type: "presence_ready", projectRoot: "novel-a"}),
        });

        resolvePush();
        await Promise.resolve();
        onClosed?.();
        await expect(handling).resolves.toBe("sent");
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("presence_ready 推送失败时关闭流并释放本标签页 presence", async () => {
        const failure = new Error("initial push failed");
        const push = vi.fn(async () => {
            throw failure;
        });
        const send = vi.fn(async () => "sent");
        const close = vi.fn(async () => undefined);
        const release = vi.fn();

        vi.doMock("h3", () => ({
            createEventStream: vi.fn(() => ({
                push,
                send,
                close,
                onClosed: vi.fn(),
            })),
        }));
        vi.doMock("nbook/server/api/projects/project-control-plane", () => ({
            requireProjectRefQuery: vi.fn(async () => ({projectRoot: "novel-a"})),
        }));
        vi.doMock("nbook/server/api/projects/project-http-error", () => ({
            withProjectHttpError: vi.fn(async (operation: () => unknown) => operation()),
        }));
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            acquireUserPresence: vi.fn(async () => release),
        }));
        vi.doMock("nbook/server/utils/event-stream", () => ({
            isClosingEventStreamError: vi.fn(() => false),
        }));

        const handler = (await import("nbook/server/api/projects/presence.get")).default;
        await expect(handler({} as never)).resolves.toBe("sent");
        await vi.waitFor(() => {
            expect(close).toHaveBeenCalledTimes(1);
            expect(release).toHaveBeenCalledTimes(1);
        });
    });

    it("Product shutdown signal 会关闭 presence SSE 并释放 presence", async () => {
        const requestController = new AbortController();
        const push = vi.fn(async () => undefined);
        const send = vi.fn(async () => "sent");
        const close = vi.fn(async () => undefined);
        const release = vi.fn();

        vi.doMock("h3", () => ({
            createEventStream: vi.fn(() => ({
                push,
                send,
                close,
                onClosed: vi.fn(),
            })),
        }));
        vi.doMock("nbook/server/api/projects/project-control-plane", () => ({
            requireProjectRefQuery: vi.fn(async () => ({projectRoot: "novel-a"})),
        }));
        vi.doMock("nbook/server/api/projects/project-http-error", () => ({
            withProjectHttpError: vi.fn(async (operation: () => unknown) => operation()),
        }));
        vi.doMock("nbook/server/workspace-files/project-session", () => ({
            acquireUserPresence: vi.fn(async () => release),
        }));
        vi.doMock("nbook/server/utils/event-stream", () => ({
            isClosingEventStreamError: vi.fn(() => false),
        }));

        const handler = (await import("nbook/server/api/projects/presence.get")).default;
        await expect(handler({
            context: {productShutdownSignal: requestController.signal},
        } as never)).resolves.toBe("sent");

        requestController.abort();
        await vi.waitFor(() => {
            expect(close).toHaveBeenCalledTimes(1);
            expect(release).toHaveBeenCalledTimes(1);
        });
    });
});
