import {describe, expect, it, vi} from "vitest";
import {EventEmitter} from "node:events";
import {createHooks} from "hookable";
import {
    installDevelopmentMainProcessHost,
    installDevelopmentWorkerStopBridge,
} from "./development-process";
import type {DevelopmentProcessChannel} from "./development-process";

type ChannelMessage = Parameters<DevelopmentProcessChannel["postMessage"]>[0];

class TestChannel implements DevelopmentProcessChannel {
    onmessage: DevelopmentProcessChannel["onmessage"] = null;
    readonly messages: ChannelMessage[] = [];
    closed = false;

    postMessage(message: ChannelMessage): void {
        this.messages.push(message);
    }

    close(): void {
        this.closed = true;
    }

    emit(message: unknown): void {
        this.onmessage?.({data: message});
    }
}

class TestProcess {
    private readonly listeners = new Map<NodeJS.Signals, Set<() => void>>();

    on(signal: NodeJS.Signals, listener: () => void): this {
        const listeners = this.listeners.get(signal) ?? new Set<() => void>();
        listeners.add(listener);
        this.listeners.set(signal, listeners);
        return this;
    }

    off(signal: NodeJS.Signals, listener: () => void): this {
        this.listeners.get(signal)?.delete(listener);
        return this;
    }

    emit(signal: NodeJS.Signals): void {
        for (const listener of this.listeners.get(signal) ?? []) listener();
    }

    listenerCount(signal: NodeJS.Signals): number {
        return this.listeners.get(signal)?.size ?? 0;
    }
}

describe("开发进程协调器", () => {
    it("只替换配置加载后 CLI 新增的 once 退出监听，保留既有信号监听", async () => {
        const source = new EventEmitter();
        const existing = vi.fn();
        source.on("SIGTERM", existing);
        const baseline = new Map<NodeJS.Signals, readonly (() => void)[]>([
            ["SIGTERM", source.rawListeners("SIGTERM") as Array<() => void>],
            ["SIGINT", []],
        ]);
        const immediateExit = vi.fn();
        source.once("SIGINT", immediateExit);
        source.once("SIGTERM", immediateExit);
        const exit = vi.fn();
        installDevelopmentMainProcessHost({hook() {}, close: async () => undefined}, {
            channel: new TestChannel(), process: source, exit, listenerSignalBaseline: baseline,
        });
        source.emit("SIGTERM");
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
        expect(immediateExit).not.toHaveBeenCalled();
        expect(existing).toHaveBeenCalledOnce();
        expect(source.listeners("SIGTERM")).toEqual([existing]);
        expect(source.listenerCount("SIGINT")).toBe(0);
    });
    it("新增信号监听不符合 CLI once 形状时拒绝安装，不能删除用户监听", () => {
        const source = new EventEmitter();
        source.once("SIGINT", vi.fn());
        source.on("SIGTERM", vi.fn());
        const before = [source.rawListeners("SIGINT"), source.rawListeners("SIGTERM")];
        expect(() => installDevelopmentMainProcessHost({hook() {}, close: async () => undefined}, {
            channel: new TestChannel(), process: source, exit: vi.fn(),
            listenerSignalBaseline: new Map<NodeJS.Signals, readonly (() => void)[]>([["SIGINT", []], ["SIGTERM", []]]),
        })).toThrow("拒绝替换未知监听");
        expect([source.rawListeners("SIGINT"), source.rawListeners("SIGTERM")]).toEqual(before);
    });


    it("开发重载在 Nitro 结束旧线程前等待资源释放回执，CI 强制结束也不能跳过释放", async () => {
        const channel = new TestChannel();
        const hooks = createHooks();
        const nitroHooks = createHooks();
        const processSource = new TestProcess();
        installDevelopmentMainProcessHost({hook: hooks.hook, close: async () => undefined}, {
            channel, process: processSource, exit: vi.fn(),
        });
        await hooks.callHook("nitro:init", {hooks: nitroHooks});
        const terminated = vi.fn();
        nitroHooks.hook("dev:reload", terminated);
        channel.emit({kind: "worker-ready", workerId: "worker-1"});

        const reloading = nitroHooks.callHook("dev:reload");
        expect(terminated).not.toHaveBeenCalled();
        const command = channel.messages.find((message) => message.kind === "stop-command");
        expect(command).toMatchObject({source: "hmr:reload"});
        channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "worker-1", exitCode: 0});
        await reloading;
        expect(terminated).toHaveBeenCalledOnce();
        await hooks.callHook("close");
        expect(channel.closed).toBe(true);
    });

    it("热重载仅停止旧 worker，等待回执期间 ready 的替代 worker 保持可用", async () => {
        const channel = new TestChannel();
        const hooks = createHooks();
        const nitroHooks = createHooks();
        installDevelopmentMainProcessHost({hook: hooks.hook, close: async () => undefined}, {
            channel, process: new TestProcess(), exit: vi.fn(),
        });
        await hooks.callHook("nitro:init", {hooks: nitroHooks});
        channel.emit({kind: "worker-ready", workerId: "old-worker"});
        const reloading = nitroHooks.callHook("dev:reload");
        const command = channel.messages.find((message) => message.kind === "stop-command");
        channel.emit({kind: "worker-ready", workerId: "replacement-worker"});
        try {
            expect(channel.messages.filter((message) => message.kind === "stop-command")).toEqual([
                {kind: "stop-command", requestId: command!.requestId, source: "hmr:reload", workers: ["old-worker"]},
            ]);
        } finally {
            channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "old-worker", exitCode: 0});
            channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "replacement-worker", exitCode: 0});
            await reloading;
            channel.emit({kind: "worker-closed", workerId: "replacement-worker"});
            await hooks.callHook("close");
        }
    });

    it.each(["signal:SIGTERM", "control:http", "host:close"])("%s 停止期间 ready 的 worker 必须加入收口并等它回执", async (source) => {
        const channel = new TestChannel();
        const nuxt = {hook() {}, close: vi.fn(async () => undefined)};
        const exit = vi.fn();
        const host = installDevelopmentMainProcessHost(nuxt, {channel, process: new TestProcess(), exit});
        channel.emit({kind: "worker-ready", workerId: "old-worker"});
        const stopping = host.requestStop(source);
        const command = channel.messages.find((message) => message.kind === "stop-command");
        channel.emit({kind: "worker-ready", workerId: "late-worker"});
        expect(channel.messages).toContainEqual({kind: "stop-command", requestId: command!.requestId, source, workers: ["late-worker"]});
        channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "old-worker", exitCode: 0});
        await Promise.resolve();
        expect(nuxt.close).not.toHaveBeenCalled();
        channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "late-worker", exitCode: 0});
        await stopping;
        expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    });
    it("场景 5：SIGTERM 与 SIGINT 汇合，资源释放回执之前不关闭监听或退出，结算后移除监听", async () => {
        const channel = new TestChannel();
        const processSource = new TestProcess();
        const order: string[] = [];
        const listener = {close: vi.fn(async () => { order.push("listener-close"); })};
        const nuxt = {
            hook(name: string, handler: (...args: unknown[]) => unknown): void {
                if (name === "listen") handler({}, listener);
            },
            close: vi.fn(async () => { order.push("nuxt-close"); }),
        };
        const exit = vi.fn((code: number) => { order.push(`exit:${String(code)}`); });
        const host = installDevelopmentMainProcessHost(nuxt, {channel, process: processSource, exit});
        channel.emit({kind: "worker-ready", workerId: "worker-1"});

        processSource.emit("SIGTERM");
        processSource.emit("SIGINT");
        expect(host.requestStop("control:http")).toBe(host.requestStop("signal:SIGTERM"));
        await vi.waitFor(() => expect(channel.messages.some((message) => message.kind === "stop-command")).toBe(true));
        const command = channel.messages.find((message) => message.kind === "stop-command");
        expect(command).toMatchObject({kind: "stop-command", source: "signal:SIGTERM"});
        expect(nuxt.close).not.toHaveBeenCalled();

        channel.emit({
            kind: "worker-stop-complete",
            requestId: command!.requestId,
            workerId: "worker-1",
            exitCode: 0,
        });
        await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));

        expect(order).toEqual(["nuxt-close", "listener-close", "exit:0"]);
        expect(processSource.listenerCount("SIGINT")).toBe(0);
        expect(processSource.listenerCount("SIGTERM")).toBe(0);
        expect(channel.closed).toBe(true);
    });
    it("场景 6：控制路由通知主线程后等待有序停止回执再以 0 退出", async () => {
        const channel = new TestChannel();
        const exit = vi.fn();
        const nuxt = {hook() {}, close: vi.fn(async () => undefined)};
        installDevelopmentMainProcessHost(nuxt, {channel, process: new TestProcess(), exit});
        channel.emit({kind: "worker-stop-requested", workerId: "route-worker", source: "control:http"});
        const command = channel.messages.find((message) => message.kind === "stop-command");
        expect(command).toMatchObject({source: "control:http", workers: ["route-worker"]});
        expect(exit).not.toHaveBeenCalled();
        channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "route-worker", exitCode: 0});
        await vi.waitFor(() => expect(exit).toHaveBeenCalledExactlyOnceWith(0));
        expect(nuxt.close).toHaveBeenCalledOnce();
    });

    it("关闭不完整回执仍关闭 Nuxt 并以 1 退出", async () => {
        const channel = new TestChannel();
        const exit = vi.fn();
        const nuxt = {hook() {}, close: vi.fn(async () => undefined)};
        const host = installDevelopmentMainProcessHost(nuxt, {channel, process: new TestProcess(), exit});
        channel.emit({kind: "worker-ready", workerId: "worker"});
        const stopping = host.requestStop("signal:SIGTERM");
        const command = channel.messages.find((message) => message.kind === "stop-command");
        channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "worker", exitCode: 1});
        await stopping;
        expect(exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(nuxt.close).toHaveBeenCalledOnce();
    });


    it("worker桥接控制路由与主线程命令只调用一次stop并回传退出码", async () => {
        const channel = new TestChannel();
        const stopped = Promise.withResolvers<number>();
        const stop = vi.fn(() => stopped.promise);
        const bridge = installDevelopmentWorkerStopBridge(stop, {channel, workerId: "worker-1"});
        expect(channel.messages).toEqual([{kind: "worker-ready", workerId: "worker-1"}]);

        channel.emit({kind: "stop-command", requestId: "request-1", source: "signal:SIGTERM", workers: ["worker-1"]});
        channel.emit({kind: "stop-command", requestId: "request-1", source: "signal:SIGTERM", workers: ["worker-1"]});
        expect(stop).toHaveBeenCalledOnce();
        expect(stop).toHaveBeenCalledWith("signal:SIGTERM");

        bridge.notifyProcessStop("control:http");
        expect(channel.messages).toContainEqual({kind: "worker-stop-requested", workerId: "worker-1", source: "control:http"});
        stopped.resolve(75);
        await vi.waitFor(() => expect(channel.messages).toContainEqual({
            kind: "worker-stop-complete",
            requestId: "request-1",
            workerId: "worker-1",
            exitCode: 75,
        }));

        bridge.close();
        expect(channel.messages.at(-1)).toEqual({kind: "worker-closed", workerId: "worker-1"});
        expect(channel.closed).toBe(true);
    });

    it("worker回执使用专用lease失效退出码，旧request回执不能完成新请求", async () => {
        const channel = new TestChannel();
        const processSource = new TestProcess();
        const exit = vi.fn();
        const nuxt = {
            hook(): void {},
            close: vi.fn(async () => undefined),
        };
        const host = installDevelopmentMainProcessHost(nuxt, {channel, process: processSource, exit});
        channel.emit({kind: "worker-ready", workerId: "worker-1"});

        const stopping = host.requestStop("signal:SIGTERM");
        const command = channel.messages.find((message) => message.kind === "stop-command");
        channel.emit({kind: "worker-stop-complete", requestId: "stale", workerId: "worker-1", exitCode: 75});
        expect(nuxt.close).not.toHaveBeenCalled();
        channel.emit({kind: "worker-stop-complete", requestId: command!.requestId, workerId: "worker-1", exitCode: 75});
        await stopping;

        expect(exit).toHaveBeenCalledWith(75);
    });
    it("旧 worker 未回复时在 45 秒交接期限后报告失败，重载不无限挂起", async () => {
        vi.useFakeTimers();
        const hooks = createHooks();
        const nitroHooks = createHooks();
        const channel = new TestChannel();
        const report = vi.fn();
        try {
            installDevelopmentMainProcessHost({hook: hooks.hook, close: async () => undefined}, {
                channel, process: new TestProcess(), exit: vi.fn(), report,
            });
            await hooks.callHook("nitro:init", {hooks: nitroHooks});
            channel.emit({kind: "worker-ready", workerId: "slow-worker"});
            const completed = vi.fn();
            nitroHooks.hook("dev:reload", completed);
            const reloading = nitroHooks.callHook("dev:reload");
            await vi.advanceTimersByTimeAsync(44_999);
            expect(completed).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await reloading;
            expect(completed).toHaveBeenCalledOnce();
            expect(report).toHaveBeenCalledWith(expect.any(Error));
            channel.emit({kind: "worker-closed", workerId: "slow-worker"});
            await hooks.callHook("close");
        } finally {
            vi.useRealTimers();
        }
    });
});
