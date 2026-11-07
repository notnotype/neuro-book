import {mkdtemp, readFile, rm} from "node:fs/promises";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

import {afterEach, describe, expect, it} from "vitest";

import {spawnOwnedProcess} from "#owned-process/index";
import {spawnWindowsOwnedProcess} from "#owned-process/windows-adapter";
import {buildWindowsSupervisorSource} from "#owned-process/windows-supervisor-source";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Owned Process", () => {
    it("公共入口拒绝Windows ARM64而不进入平台Adapter", () => {
        const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform");
        const archDescriptor = Object.getOwnPropertyDescriptor(process, "arch");
        if (!platformDescriptor || !archDescriptor) throw new Error("process platform descriptor 不存在");
        Object.defineProperty(process, "platform", {...platformDescriptor, value: "win32"});
        Object.defineProperty(process, "arch", {...archDescriptor, value: "arm64"});

        try {
            expect(() => spawnOwnedProcess({command: "target"}))
                .toThrow("Windows Owned Process当前仅支持x64，实际为arm64。");
        } finally {
            Object.defineProperty(process, "platform", platformDescriptor);
            Object.defineProperty(process, "arch", archDescriptor);
        }
    });

    it("正常退出会返回真实退出码和输出", async () => {
        const lease = spawnOwnedProcess({
            command: process.execPath,
            args: ["-e", "console.log('owned-ok')"],
            stdout: "pipe",
            stderr: "pipe",
        });
        let output = "";
        lease.stdout?.on("data", (chunk) => output += chunk);

        await expect(lease.completion).resolves.toMatchObject({exitCode: 0});
        expect(output).toContain("owned-ok");
    });

    it("终止 lease 会清理完整孙进程并释放端口", async () => {
        const root = await mkdtemp(testHostPath("nbook-owned-process-"));
        roots.push(root);
        const statePath = join(root, "state.json");
        const lease = spawnFixture(statePath);
        const state = await waitForState(statePath);

        const startedAt = Date.now();
        const firstTermination = lease.terminate("timeout");
        expect(lease.terminate("abort")).toBe(firstTermination);
        await expect(firstTermination).resolves.toMatchObject({terminationReason: "timeout"});

        expect(Date.now() - startedAt).toBeLessThan(5_000);
        await expect(waitForProcessExit(state.pid)).resolves.toBeUndefined();
        await expect(bindPort(state.port)).resolves.toBeUndefined();
    });

    it.runIf(process.platform === "win32")("TerminateJobObject失败会报告Win32错误并通过关闭Job收口后代", async () => {
        const root = await mkdtemp(testHostPath("nbook-owned-terminate-failure-"));
        roots.push(root);
        const statePath = join(root, "state.json");
        const lease = spawnWindowsOwnedProcess({
            command: process.execPath,
            args: [fileURLToPath(new URL("./fixtures/owned-root.ts", import.meta.url))],
            env: {...process.env, OWNED_PROCESS_STATE_PATH: statePath},
            stdout: "pipe",
            stderr: "pipe",
            graceMs: 100,
            hardKillWaitMs: 2_000,
        }, {
            supervisorSource: buildWindowsSupervisorSource("invalid-terminate-handle"),
        });
        const state = await waitForState(statePath);

        await expect(lease.terminate("timeout")).rejects.toMatchObject({
            name: "OwnedProcessError",
            stage: "terminate-job",
            osError: expect.any(Number),
        });
        await expect(waitForProcessExit(state.pid)).resolves.toBeUndefined();
        await expect(waitForPortRelease(state.port)).resolves.toBeUndefined();
    });

    it("根进程自然退出也会清理仍持有stdio和端口的后台后代", async () => {
        const root = await mkdtemp(testHostPath("nbook-owned-natural-exit-"));
        roots.push(root);
        const statePath = join(root, "state.json");
        const lease = spawnOwnedProcess({
            command: process.execPath,
            args: [fileURLToPath(new URL("./fixtures/normal-exit-root.ts", import.meta.url))],
            env: {...process.env, OWNED_PROCESS_STATE_PATH: statePath},
            stdout: "pipe",
            stderr: "pipe",
            graceMs: 100,
            hardKillWaitMs: 2_000,
        });
        const state = await waitForState(statePath);

        await expect(lease.completion).resolves.toMatchObject({exitCode: 0});
        await expect(waitForProcessExit(state.pid)).resolves.toBeUndefined();
        await expect(waitForPortRelease(state.port)).resolves.toBeUndefined();
    });

    it("并发 lease 彼此隔离", async () => {
        const root = await mkdtemp(testHostPath("nbook-owned-isolation-"));
        roots.push(root);
        const leftPath = join(root, "left.json");
        const rightPath = join(root, "right.json");
        const left = spawnFixture(leftPath);
        const right = spawnFixture(rightPath);
        const [leftState, rightState] = await Promise.all([waitForState(leftPath), waitForState(rightPath)]);

        await left.terminate("cancel");

        await expect(waitForProcessExit(leftState.pid)).resolves.toBeUndefined();
        expect(processExists(rightState.pid)).toBe(true);
        await right.terminate("shutdown");
        await expect(waitForProcessExit(rightState.pid)).resolves.toBeUndefined();
    });

    it.runIf(process.platform === "win32")("监督IPC不会占用目标继承的stdin", async () => {
        const owner = fileURLToPath(new URL("./fixtures/inherited-stdin-owner.ts", import.meta.url));
        const target = fileURLToPath(new URL("./fixtures/inherited-stdin-target.ts", import.meta.url));
        const child = spawn(process.execPath, [owner, target], {stdio: ["pipe", "pipe", "pipe"]});
        let output = "";
        let errorOutput = "";
        child.stdout.on("data", (chunk: Buffer) => output += chunk.toString());
        child.stderr.on("data", (chunk: Buffer) => errorOutput += chunk.toString());
        child.stdin.end("portable-input\n");

        const exitCode = await new Promise<number | null>((resolvePromise, rejectPromise) => {
            child.once("error", rejectPromise);
            child.once("close", resolvePromise);
        });

        expect(exitCode, errorOutput).toBe(0);
        expect(output).toContain("target:portable-input");
    });

    it("宿主异常退出会通过监督IPC断连清理完整进程树", async () => {
        const root = await mkdtemp(testHostPath("nbook-owned-disconnect-"));
        roots.push(root);
        const statePath = join(root, "state.json");
        const owner = spawn(process.execPath, [
            fileURLToPath(new URL("./fixtures/abrupt-owner.ts", import.meta.url)),
            statePath,
        ], {stdio: "ignore", windowsHide: true});
        const state = await waitForState(statePath);

        owner.kill("SIGKILL");
        await new Promise<void>((resolvePromise, rejectPromise) => {
            owner.once("error", rejectPromise);
            owner.once("close", () => resolvePromise());
        });

        await expect(waitForProcessExit(state.pid)).resolves.toBeUndefined();
        await expect(waitForPortRelease(state.port)).resolves.toBeUndefined();
    });

    /**
     * 终端的 Ctrl+C 把 SIGINT 发给整个前台进程组，监督器也在组里；目标在自己的进程组里收不到。
     * 监督器先退出的话，宿主再也收不了口，目标成了孤儿（Source Dev 按 Ctrl+C 就是这样）。
     */
    it.runIf(process.platform !== "win32")("宿主所在进程组收到SIGINT时，监督器留给宿主收口", async () => {
        const root = await mkdtemp(testHostPath("nbook-owned-sigint-"));
        roots.push(root);
        const statePath = join(root, "state.json");
        const owner = spawn(process.execPath, [
            fileURLToPath(new URL("./fixtures/interrupted-owner.ts", import.meta.url)),
            statePath,
        ], {stdio: "ignore", detached: true});
        const state = await waitForState(statePath);
        const closed = new Promise<number | null>((resolvePromise, rejectPromise) => {
            owner.once("error", rejectPromise);
            owner.once("close", (code) => resolvePromise(code));
        });

        process.kill(-owner.pid!, "SIGINT");

        await expect(closed).resolves.toBe(0);
        const result = JSON.parse(await readFile(`${statePath}.result`, "utf8")) as Record<string, unknown>;
        expect(result).toMatchObject({terminationReason: "shutdown"});
        await expect(waitForProcessExit(state.pid)).resolves.toBeUndefined();
        await expect(waitForPortRelease(state.port)).resolves.toBeUndefined();
    });

    it.runIf(process.platform === "win32")("Portable Product外层Job终止会收口内层Agent Bash Job", async () => {
        const root = await mkdtemp(testHostPath("nbook-owned-nested-"));
        roots.push(root);
        const statePath = join(root, "state.json");
        const outer = spawnOwnedProcess({
            command: process.execPath,
            args: [fileURLToPath(new URL("./fixtures/nested-owned-root.ts", import.meta.url)), statePath],
            stdout: "pipe",
            stderr: "pipe",
            graceMs: 100,
            hardKillWaitMs: 2_000,
        });
        const state = await waitForState(statePath);

        await outer.terminate("host-disconnect");

        await expect(waitForProcessExit(state.pid)).resolves.toBeUndefined();
        await expect(waitForPortRelease(state.port)).resolves.toBeUndefined();
    });
});

/** 启动会派生持有TCP端口孙进程的真实fixture。 */
function spawnFixture(statePath: string) {
    return spawnOwnedProcess({
        command: process.execPath,
        args: [fileURLToPath(new URL("./fixtures/owned-root.ts", import.meta.url))],
        env: {...process.env, OWNED_PROCESS_STATE_PATH: statePath},
        stdout: "pipe",
        stderr: "pipe",
        graceMs: 100,
        hardKillWaitMs: 2_000,
    });
}

/** 等待孙进程写出PID与监听端口。 */
async function waitForState(path: string): Promise<{pid: number; port: number}> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        try {
            return JSON.parse(await readFile(path, "utf8")) as {pid: number; port: number};
        } catch {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
    }
    throw new Error("等待Owned Process fixture超时");
}

/** 等待目标PID消失。 */
async function waitForProcessExit(pid: number): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        if (!processExists(pid)) return;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    throw new Error(`进程仍存活：${pid}`);
}

/** 只读探测PID是否仍存在。 */
function processExists(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

/** 证明原监听端口已经可以立即复用。 */
async function bindPort(port: number): Promise<void> {
    await new Promise<void>((resolvePromise, rejectPromise) => {
        const server = createServer();
        server.once("error", rejectPromise);
        server.listen(port, "127.0.0.1", () => server.close(() => resolvePromise()));
    });
}

/** 宿主强杀时Windows端口表可能略晚于PID消失，要求在有界窗口内完成资源收口。 */
async function waitForPortRelease(port: number): Promise<void> {
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
        try {
            await bindPort(port);
            return;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "EADDRINUSE") throw error;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
    }
    throw new Error(`宿主断连后端口仍未释放：${port}`);
}
