import {spawn, type ChildProcess} from "node:child_process";
import {createServer} from "node:http";
import {mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {afterEach, describe, expect, it} from "vitest";
import {acquireAgentSessionStoreLease} from "nbook/server/agent/session/agent-session-store-lease";

describe("Source Dev launcher process lifecycle", () => {
    const roots: string[] = [];
    let launcher: ChildProcess | null = null;

    afterEach(async () => {
        if (launcher?.exitCode === null && launcher.signalCode === null) launcher.kill("SIGKILL");
        launcher = null;
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it.runIf(process.platform === "win32")(
        "宿主异常退出会收口持有TCP和Runtime lease的完整后代树",
        async () => {
            const root = await mkdtemp(join(tmpdir(), "nbook-source-dev-owner-"));
            roots.push(root);
            const sourceRoot = join(root, "source");
            const rootWorkspace = join(root, "workspace");
            const statePath = join(root, "state.json");
            const fixturePath = fileURLToPath(new URL("../test/fixtures/source-dev-runtime.ts", import.meta.url));
            const launcherPath = fileURLToPath(new URL("../../../scripts/cli/source-dev.ts", import.meta.url));
            const port = await availablePort();
            await mkdir(sourceRoot, {recursive: true});
            await writeFile(join(sourceRoot, "package.json"), `${JSON.stringify({
                private: true,
                type: "module",
                scripts: {"dev:runtime": `bun \"${fixturePath.replaceAll("\\", "/")}\"`},
            }, null, 2)}\n`, "utf8");

            launcher = spawn(process.platform === "win32" ? "bun.exe" : "bun", [launcherPath], {
                cwd: sourceRoot,
                env: {
                    ...process.env,
                    PORT: String(port),
                    SOURCE_DEV_FIXTURE_WORKSPACE_ROOT: rootWorkspace,
                    SOURCE_DEV_FIXTURE_STATE_PATH: statePath,
                },
                stdio: ["ignore", "pipe", "pipe"],
                windowsHide: true,
            });
            const state = await waitForState(statePath, launcher);

            launcher.kill("SIGKILL");
            await waitForChildExit(launcher);
            await waitForProcessExit(state.pid);
            await waitForPortRelease(state.port);
            const stoppedHeartbeat = (await stat(`${state.leasePath}.lock`)).mtimeMs;

            await new Promise((resolvePromise) => setTimeout(resolvePromise, 16_000));

            expect((await stat(`${state.leasePath}.lock`)).mtimeMs).toBe(stoppedHeartbeat);
            const staleTime = new Date(Date.now() - 31_000);
            await utimes(`${state.leasePath}.lock`, staleTime, staleTime);
            const release = await acquireAgentSessionStoreLease(rootWorkspace, "migration");
            await release();
        },
        30_000,
    );
});

type FixtureState = {pid: number; port: number; leasePath: string};

/** 获取当前可用loopback端口。 */
async function availablePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(0, "127.0.0.1", resolvePromise);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("无法分配Source Dev测试端口");
    await new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((error) => error ? rejectPromise(error) : resolvePromise());
    });
    return address.port;
}

/** 等待fixture完成lease与TCP初始化，失败时附带子进程stderr。 */
async function waitForState(path: string, child: ChildProcess): Promise<FixtureState> {
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => stderr += chunk.toString());
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
        try {
            return JSON.parse(await readFile(path, "utf8")) as FixtureState;
        } catch {
            if (child.exitCode !== null || child.signalCode !== null) {
                throw new Error(`Source Dev fixture提前退出：${stderr}`);
            }
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
    }
    throw new Error(`等待Source Dev fixture超时：${stderr}`);
}

/** 等待launcher进程终态。 */
async function waitForChildExit(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolvePromise, rejectPromise) => {
        child.once("error", rejectPromise);
        child.once("close", () => resolvePromise());
    });
}

/** 等待目标进程消失。 */
async function waitForProcessExit(pid: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        try {
            process.kill(pid, 0);
        } catch {
            return;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
    }
    throw new Error(`Source Dev后代进程仍存活：pid=${String(pid)}`);
}

/** 等待fixture TCP端口可再次绑定。 */
async function waitForPortRelease(port: number): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
        const server = createServer();
        try {
            await new Promise<void>((resolvePromise, rejectPromise) => {
                server.once("error", rejectPromise);
                server.listen(port, "127.0.0.1", resolvePromise);
            });
            await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
            return;
        } catch {
            server.close();
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
        }
    }
    throw new Error(`Source Dev端口未释放：${String(port)}`);
}
