import {afterEach, describe, expect, it, vi} from "vitest";
import {
    createProjectSessionController,
    isProjectSessionSupersededError,
    type ProjectSessionNotificationAdapter,
    type ProjectSessionTransport,
} from "nbook/app/composables/useProjectSession";
import type {ProjectOpenResponseDto} from "nbook/shared/dto/project.dto";

describe("Project Session Controller", () => {
    afterEach(() => vi.useRealTimers());

    it("open 必须等到 presence_ready 才发布 ready", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const opening = controller.open("project-a");
        expect(controller.state.value).toEqual({
            status: "opening",
            phase: "opening-project",
            projectRoot: "project-a",
            ready: null,
        });
        await flushPromises();
        expect(controller.state.value).toEqual({
            status: "opening",
            phase: "connecting-presence",
            projectRoot: "project-a",
            ready: null,
        });

        transport.ready("project-a");
        await expect(opening).resolves.toEqual({projectRoot: "project-a", publicId: READY_ID, revision: 1});
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-a", publicId: READY_ID, revision: 1}});
        await controller.release();
    });

    it("presence_ready 携带不同 ready 标识时不发布 ready", async () => {
        const transport = controlledTransport();
        const notification = notifications();
        const controller = createProjectSessionController(transport, notification);

        const opening = controller.open("project-a");
        await flushPromises();
        // open 到 presence 之间服务端被 close/reopen 时，presence 会回报另一个代次的标识。
        transport.ready("project-a", "runtime-2:1");

        await expect(opening).rejects.toThrow("presence_ready");
        expect(controller.state.value).toEqual({status: "failed", projectRoot: "project-a", ready: null});
        expect(notification.openFailed).toHaveBeenCalledOnce();
    });

    it("同 root opening 复用一个 Promise 与一次 open", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        const second = controller.open("project-a");
        expect(second).toBe(first);
        await flushPromises();
        transport.ready("project-a");

        await expect(first).resolves.toEqual({projectRoot: "project-a", publicId: READY_ID, revision: 1});
        expect(transport.open).toHaveBeenCalledOnce();
        await controller.release();
    });

    it.each([undefined, "", 123])("open 缺少有效标识 %s 时不连接 presence", async (publicId) => {
        const transport = controlledTransport();
        vi.mocked(transport.open).mockResolvedValueOnce({...openResponse("project-a"), publicId});
        const notification = notifications();
        const controller = createProjectSessionController(transport, notification);

        await expect(controller.open("project-a")).rejects.toThrow();
        expect(controller.state.value).toEqual({status: "failed", projectRoot: "project-a", ready: null});
        expect(transport.stream).not.toHaveBeenCalled();
        expect(notification.openFailed).toHaveBeenCalledOnce();
        await controller.release();
    });

    it("open 回报另一个 Project 时不能用该标识连接请求的 Project", async () => {
        const transport = controlledTransport();
        vi.mocked(transport.open).mockResolvedValueOnce(openResponse("project-b"));
        const controller = createProjectSessionController(transport, notifications());

        await expect(controller.open("project-a")).rejects.toThrow("open 响应与请求的项目不匹配");
        expect(transport.stream).not.toHaveBeenCalled();
        expect(controller.state.value.status).toBe("failed");
        await controller.release();
    });

    it.each([undefined, "", 123])("presence 缺少有效标识 %s 时撤销 opening", async (publicId) => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());
        const opening = controller.open("project-a");
        await flushPromises();

        transport.emit("project-a", {type: "presence_ready", projectRoot: "project-a", publicId});

        await expect(opening).rejects.toThrow("presence_ready 响应不符合项目连接合同");
        expect(controller.state.value).toEqual({status: "failed", projectRoot: "project-a", ready: null});
        expect(transport.aborted).toContain("project-a");
        await controller.release();
    });

    it.each(["open", "stream"] as const)("%s 同步抛错也进入 failed，下一次打开可以成功", async (method) => {
        const transport = controlledTransport();
        const failure = new Error("同步连接异常");
        vi.mocked(transport[method]).mockImplementationOnce(() => { throw failure; });
        const notification = notifications();
        const controller = createProjectSessionController(transport, notification);

        await expect(controller.open("project-a")).rejects.toBe(failure);
        expect(controller.state.value).toEqual({status: "failed", projectRoot: "project-a", ready: null});
        expect(notification.openFailed).toHaveBeenCalledWith("project-a", failure);

        const retry = controller.open("project-a");
        await flushPromises();
        transport.ready("project-a");
        await expect(retry).resolves.toMatchObject({projectRoot: "project-a", publicId: READY_ID});
        await controller.release();
    });

    it("open 同一轮立即 release 不再启动已取消的传输", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());
        const opening = controller.open("project-a");
        const rejected = expect(opening).rejects.toSatisfy(isProjectSessionSupersededError);

        await controller.release();
        await rejected;
        expect(transport.open).not.toHaveBeenCalled();
        expect(controller.state.value).toEqual({status: "idle", ready: null});
    });

    it("manifest 修复只在 winning generation ready 后提示一次", async () => {
        const transport = controlledTransport();
        vi.mocked(transport.open).mockImplementationOnce(async (projectRoot) => openResponse(projectRoot, {
            change: "recovered",
            recoveryPath: projectRoot + "/.nbook/recovery/project-manifest-2026-07-31T12-00-00.000Z-123e4567-e89b-42d3-a456-426614174000.yaml",
        }));
        const notification = notifications();
        const controller = createProjectSessionController(transport, notification);

        const opening = controller.open("project-a");
        await flushPromises();
        expect(notification.manifestRecovered).not.toHaveBeenCalled();

        transport.ready("project-a");
        await opening;
        expect(notification.manifestRecovered).toHaveBeenCalledOnce();
        expect(notification.manifestRecovered).toHaveBeenCalledWith(
            "project-a",
            "project-a/.nbook/recovery/project-manifest-2026-07-31T12-00-00.000Z-123e4567-e89b-42d3-a456-426614174000.yaml",
        );
        await controller.release();
    });

    it("A 到 B 到 C 只允许最新目标发布 ready，旧 owner 只被取消", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        const second = controller.open("project-b");
        await flushPromises();
        const third = controller.open("project-c");
        await flushPromises();
        transport.ready("project-c");

        await expect(first).rejects.toSatisfy(isProjectSessionSupersededError);
        await expect(second).rejects.toSatisfy(isProjectSessionSupersededError);
        await expect(third).resolves.toEqual({projectRoot: "project-c", publicId: READY_ID, revision: 1});
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-c", publicId: READY_ID, revision: 1}});
        expect(transport.aborted).toEqual(expect.arrayContaining(["project-a", "project-b"]));
        await controller.release();
    });

    it("release 中止 opening 并等待本标签页 presence 退出", async () => {
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const opening = controller.open("project-a");
        await flushPromises();
        await controller.release();

        await expect(opening).rejects.toSatisfy(isProjectSessionSupersededError);
        expect(controller.state.value).toEqual({status: "idle", ready: null});
        expect(transport.aborted).toContain("project-a");
    });

    it("初次 open 失败进入 failed，不发布任何 ready Project", async () => {
        const transport = controlledTransport();
        vi.mocked(transport.open).mockRejectedValueOnce(new Error("open failed"));
        const notification = notifications();
        const controller = createProjectSessionController(transport, notification);

        await expect(controller.open("project-a")).rejects.toThrow("open failed");
        expect(controller.state.value).toEqual({status: "failed", projectRoot: "project-a", ready: null});
        expect(notification.openFailed).toHaveBeenCalledOnce();
    });

    it("ready 首帧与 release 同轮到达时，release 仍等待底层流退出", async () => {
        const transport = controlledTransport();
        const streamExit = Promise.withResolvers<void>();
        let publishReady: () => void = () => { throw new Error("stream 尚未启动"); };
        let streamAborted = false;
        vi.mocked(transport.stream).mockImplementationOnce((projectRoot, publicId, signal, onEvent) => {
            publishReady = () => onEvent({type: "presence_ready", projectRoot, publicId});
            signal.addEventListener("abort", () => { streamAborted = true; }, {once: true});
            return streamExit.promise;
        });
        const controller = createProjectSessionController(transport, notifications());
        const opening = controller.open("project-a");
        const rejected = expect(opening).rejects.toSatisfy(isProjectSessionSupersededError);
        await flushPromises();
        publishReady();

        let released = false;
        const releasing = controller.release().then(() => { released = true; });
        await flushPromises();
        expect(streamAborted).toBe(true);
        expect(released).toBe(false);
        expect(controller.state.value).toEqual({status: "idle", ready: null});

        streamExit.resolve();
        await releasing;
        await rejected;
        expect(released).toBe(true);
    });

    it("presence 断开立即撤销 ready；重连必须再次 open + presence_ready 并递增 revision", async () => {
        vi.useFakeTimers();
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        transport.ready("project-a");
        await first;
        transport.end("project-a");
        await flushPromises();
        expect(controller.state.value).toEqual({
            status: "reconnecting",
            phase: "waiting-reconnect",
            projectRoot: "project-a",
            ready: null,
        });

        const reconnectOpen = Promise.withResolvers<ProjectOpenResponseDto>();
        vi.mocked(transport.open).mockImplementationOnce(async () => await reconnectOpen.promise);
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(transport.open).toHaveBeenCalledTimes(2);
        expect(controller.state.value).toEqual({
            status: "reconnecting",
            phase: "opening-project",
            projectRoot: "project-a",
            ready: null,
        });

        reconnectOpen.resolve(openResponse("project-a"));
        await flushPromises();
        expect(controller.state.value).toEqual({
            status: "reconnecting",
            phase: "connecting-presence",
            projectRoot: "project-a",
            ready: null,
        });
        transport.ready("project-a");
        await flushPromises();
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-a", publicId: READY_ID, revision: 2}});
        await controller.release();
    });

    it("reconnect 打开失败后保持 reconnecting，并按 backoff 继续下一次 open", async () => {
        vi.useFakeTimers();
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        transport.ready("project-a");
        await first;
        transport.end("project-a");
        await flushPromises();

        vi.mocked(transport.open).mockRejectedValueOnce(new Error("restart in progress"));
        await vi.advanceTimersByTimeAsync(300);
        await flushPromises();
        expect(controller.state.value).toEqual({
            status: "reconnecting",
            phase: "waiting-reconnect",
            projectRoot: "project-a",
            ready: null,
        });
        expect(transport.open).toHaveBeenCalledTimes(2);

        await vi.advanceTimersByTimeAsync(800);
        await flushPromises();
        expect(transport.open).toHaveBeenCalledTimes(3);
        transport.ready("project-a");
        await flushPromises();
        expect(controller.state.value).toEqual({status: "ready", ready: {projectRoot: "project-a", publicId: READY_ID, revision: 2}});
        await controller.release();
    });

    it("release 或新目标会取消已安排的 reconnect", async () => {
        vi.useFakeTimers();
        const transport = controlledTransport();
        const controller = createProjectSessionController(transport, notifications());

        const first = controller.open("project-a");
        await flushPromises();
        transport.ready("project-a");
        await first;
        transport.end("project-a");
        await flushPromises();

        const next = controller.open("project-b");
        await flushPromises();
        transport.ready("project-b");
        await next;
        await vi.advanceTimersByTimeAsync(5000);
        expect(transport.open).toHaveBeenCalledTimes(2);

        await controller.release();
        await vi.advanceTimersByTimeAsync(5000);
        expect(transport.open).toHaveBeenCalledTimes(2);
    });
});

/** 逐帧控制 transport，使测试覆盖真实 open/Abort/presence 时序。 */
function controlledTransport() {
    type Stream = {
        onEvent: (event: unknown) => void;
        resolve: () => void;
        reject: (error: unknown) => void;
    };
    const streams = new Map<string, Stream>();
    const aborted: string[] = [];
    const transport: ProjectSessionTransport & {
        readonly aborted: string[];
        ready(projectRoot: string, publicId?: string): void;
        emit(projectRoot: string, event: unknown): void;
        end(projectRoot: string): void;
    } = {
        open: vi.fn(async (projectRoot: string) => openResponse(projectRoot)),
        stream: vi.fn(async (projectRoot, publicId, signal, onEvent) => await new Promise<void>((resolve, reject) => {
            streams.set(projectRoot, {onEvent, resolve, reject});
            signal.addEventListener("abort", () => {
                aborted.push(projectRoot);
                const error = new Error("aborted");
                error.name = "AbortError";
                reject(error);
            }, {once: true});
        })),
        aborted,
        ready(projectRoot, publicId = READY_ID) {
            streams.get(projectRoot)?.onEvent({type: "presence_ready", projectRoot, publicId});
        },
        emit(projectRoot, event) {
            streams.get(projectRoot)?.onEvent(event);
        },
        end(projectRoot) {
            streams.get(projectRoot)?.resolve();
            streams.delete(projectRoot);
        },
    };
    return transport;
}

/** open 响应与 presence_ready 共享的 ready 标识；预设值便于断言不匹配路径。 */
const READY_ID = "runtime-1:1";

function notifications() {
    return {
        interrupted: vi.fn<() => void>(),
        openFailed: vi.fn<(projectRoot: string, error: unknown) => void>(),
        manifestRecovered: vi.fn<(projectRoot: string, recoveryPath: string) => void>(),
    } satisfies ProjectSessionNotificationAdapter;
}

/** 建立客户端 transport 使用的最终 Project publication。 */
function openResponse(
    projectRoot: string,
    change: {change: "none" | "created"} | {change: "normalized" | "recovered"; recoveryPath: string} = {change: "none"},
): ProjectOpenResponseDto {
    return {
        revision: 1,
        project: {
            projectRoot,
            kind: "novel",
            title: projectRoot,
            summary: "",
        },
        publicId: READY_ID,
        ...change,
    };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}
