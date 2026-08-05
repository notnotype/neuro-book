import {EventEmitter} from "node:events";

import {afterEach, describe, expect, it, vi} from "vitest";

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("node:child_process");
});

describe("Windows Adapter protocol", () => {
    it("监督控制面不占用目标cwd，目标cwd只通过IPC下发", async () => {
        const supervisor = new FakeSupervisor();
        let spawnOptions: {cwd?: string} | undefined;
        const spawnWindowsOwnedProcess = await loadAdapter(supervisor, (_command, _args, options) => {
            spawnOptions = options;
        });
        spawnWindowsOwnedProcess({command: "target", cwd: "C:\\payload-root"});

        expect(spawnOptions).not.toHaveProperty("cwd");
    });

    it("把目标 stdout/stderr 策略传给监督器，避免 Product 日志污染宿主协议", async () => {
        const supervisor = new FakeSupervisor();
        const spawnWindowsOwnedProcess = await loadAdapter(supervisor);

        spawnWindowsOwnedProcess({command: "target", stdout: "ignore", stderr: "ignore"});

        expect(supervisor.messages[0]).toMatchObject({
            kind: "start",
            stdout: "ignore",
            stderr: "ignore",
        });
    });

    it("内部监督协议不根据测试宿主架构拒绝调用", async () => {
        const descriptor = Object.getOwnPropertyDescriptor(process, "arch");
        if (!descriptor) throw new Error("process.arch descriptor 不存在");
        Object.defineProperty(process, "arch", {...descriptor, value: "arm64"});

        try {
            const supervisor = new FakeSupervisor();
            const spawnWindowsOwnedProcess = await loadAdapter(supervisor);
            const lease = spawnWindowsOwnedProcess({command: "target", hardKillWaitMs: 20});
            supervisor.emit("message", {kind: "complete", exitCode: 0, signal: null});
            supervisor.connected = false;
            supervisor.emit("close", 0, null);

            await expect(lease.completion).resolves.toMatchObject({exitCode: 0});
        } finally {
            Object.defineProperty(process, "arch", descriptor);
        }
    });

    it("同步IPC断开后等待supervisor close并清理watchdog", async () => {
        vi.useFakeTimers();
        const supervisor = new FakeSupervisor();
        const spawnWindowsOwnedProcess = await loadAdapter(supervisor);
        const lease = spawnWindowsOwnedProcess({command: "target", graceMs: 10, hardKillWaitMs: 20});
        supervisor.connected = false;

        const termination = lease.terminate("timeout");
        let settled = false;
        void termination.then(
            () => { settled = true; },
            () => { settled = true; },
        );
        await Promise.resolve();
        expect(settled).toBe(false);

        supervisor.emit("close", 1, null);
        await expect(termination).rejects.toMatchObject({stage: "control-ipc"});
        expect(vi.getTimerCount()).toBe(0);
    });

    it("supervisor error消息只有在close后才提交失败终态", async () => {
        vi.useFakeTimers();
        const supervisor = new FakeSupervisor();
        const spawnWindowsOwnedProcess = await loadAdapter(supervisor);
        const lease = spawnWindowsOwnedProcess({command: "target", hardKillWaitMs: 20});
        let settled = false;
        void lease.completion.then(
            () => { settled = true; },
            () => { settled = true; },
        );

        supervisor.emit("message", {
            kind: "error",
            stage: "terminate-job",
            message: "TerminateJobObject失败",
            osError: 6,
        });
        await Promise.resolve();
        expect(settled).toBe(false);

        supervisor.connected = false;
        supervisor.emit("close", 1, null);
        await expect(lease.completion).rejects.toMatchObject({stage: "terminate-job", osError: 6});
        expect(vi.getTimerCount()).toBe(0);
    });

    it("supervisor进程error事件也只有在close后才提交失败终态", async () => {
        vi.useFakeTimers();
        const supervisor = new FakeSupervisor();
        const spawnWindowsOwnedProcess = await loadAdapter(supervisor);
        const lease = spawnWindowsOwnedProcess({command: "target", graceMs: 10, hardKillWaitMs: 20});
        let settled = false;
        void lease.completion.then(
            () => { settled = true; },
            () => { settled = true; },
        );

        supervisor.emit("error", new Error("spawn failed"));
        await Promise.resolve();
        expect(settled).toBe(false);

        supervisor.emit("close", 1, null);
        await expect(lease.completion).rejects.toMatchObject({stage: "supervisor-spawn"});
        expect(vi.getTimerCount()).toBe(0);
    });
});

/** 动态加载Adapter，让每个测试拥有独立的监督进程替身。 */
async function loadAdapter(
    supervisor: FakeSupervisor,
    onSpawn?: (_command: string, _args: string[], options: {cwd?: string}) => void,
) {
    vi.doMock("node:child_process", () => ({
        spawn: vi.fn((command: string, args: string[], options: {cwd?: string}) => {
            onSpawn?.(command, args, options);
            return supervisor;
        }),
    }));
    const module = await import("#owned-process/windows-adapter");
    return module.spawnWindowsOwnedProcess;
}

/** 仅实现Windows Adapter消费的ChildProcess协议表面。 */
class FakeSupervisor extends EventEmitter {
    connected = true;
    stdout = null;
    stderr = null;
    messages: object[] = [];

    send(message: object, callback?: (error: Error | null) => void): boolean {
        this.messages.push(message);
        callback?.(null);
        return true;
    }

    disconnect(): void {
        this.connected = false;
    }
}
