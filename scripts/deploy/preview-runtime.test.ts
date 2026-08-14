import {EventEmitter} from "node:events";
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {createServer, type Server} from "node:net";
import {afterEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    spawnOwnedProcess: vi.fn(),
    waitForApplicationReady: vi.fn(),
    shutdownNativeProduct: vi.fn(),
    spawn: vi.fn(),
}));

vi.mock("@notnotype/owned-process", () => ({
    spawnOwnedProcess: mocks.spawnOwnedProcess,
}));
vi.mock("nbook/shared/application-ready", () => ({
    waitForApplicationReady: mocks.waitForApplicationReady,
}));
vi.mock("nbook/shared/product-runtime-shutdown", () => ({
    shutdownNativeProduct: mocks.shutdownNativeProduct,
}));
vi.mock("node:child_process", () => ({
    spawn: mocks.spawn,
}));

import {
    PREVIEW_RUNTIME_SCHEMA,
    startPreviewRuntime,
} from "nbook/scripts/deploy/preview-runtime";

const roots: string[] = [];
const REPO_ROOT = resolve(".");

function installDefaults(): void {
    mocks.waitForApplicationReady.mockResolvedValue(undefined);
    mocks.shutdownNativeProduct.mockResolvedValue("graceful");
    mocks.spawnOwnedProcess.mockImplementation(() => ({
        completion: Promise.resolve({exitCode: 0, signal: null}),
        terminate: vi.fn().mockResolvedValue({exitCode: 0, signal: null, terminationReason: "shutdown"}),
    }));
    mocks.spawn.mockImplementation(() => migrationChild());
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    vi.clearAllMocks();
});

describe("Preview Runtime supervisor", () => {
    it("Source Dev 启动后写入无秘密 owner marker，stop 幂等并删除隔离根", async () => {
        installDefaults();
        const root = await tempRoot();
        const taskRoot = join(root, "run");
        const handle = await startPreviewRuntime(options(taskRoot, "source-dev", "source-lifecycle"));
        const owner = JSON.parse(await readFile(join(taskRoot, "runtime-owner.json"), "utf8")) as Record<string, unknown>;

        expect(owner).toMatchObject({
            schema: PREVIEW_RUNTIME_SCHEMA,
            operationId: "source-lifecycle",
            mode: "source-dev",
            startupNoncePresent: true,
            shutdownTokenRef: "memory-only",
        });
        expect(JSON.stringify(owner)).not.toContain(handle.startupNonce);
        expect(JSON.stringify(owner)).not.toContain("NEURO_BOOK_SHUTDOWN_TOKEN");

        const firstStop = handle.stop();
        await expect(handle.stop()).resolves.toBeUndefined();
        await firstStop;

        expect(mocks.spawnOwnedProcess).toHaveBeenCalledOnce();
        expect(mocks.shutdownNativeProduct).toHaveBeenCalledOnce();
        await expect(stat(join(taskRoot, "dev-state"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(taskRoot, "dev-cache"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(taskRoot, "runtime-owner.json"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(taskRoot, "runtime.lease"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("auto 模式没有 verified Product image 时只 fallback 一次到 Source Dev", async () => {
        installDefaults();
        const root = await tempRoot();
        const handle = await startPreviewRuntime(options(join(root, "run"), "auto", "auto-fallback"));

        expect(handle.mode).toBe("source-dev");
        expect(handle.productAttempt).toBe("unavailable");
        expect(handle.fallbackReason).toContain("verified manifest");
        expect(mocks.spawnOwnedProcess).toHaveBeenCalledOnce();
        expect(mocks.spawnOwnedProcess.mock.calls[0]?.[0]).toMatchObject({args: ["--no-install", "run", "dev:runtime"]});

        await handle.stop();
    });

    it("显式 Product 缺少 image 时失败且不启动 Source Dev", async () => {
        installDefaults();
        const root = await tempRoot();
        const taskRoot = join(root, "run");

        await expect(startPreviewRuntime(options(taskRoot, "product", "product-only"))).rejects.toMatchObject({
            kind: "product-unavailable",
        });
        expect(mocks.spawnOwnedProcess).not.toHaveBeenCalled();
        await expect(stat(join(taskRoot, "product-state"))).rejects.toMatchObject({code: "ENOENT"});
        await expect(stat(join(taskRoot, "dev-state"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("graceful shutdown 失败后调用 Owned Process terminate 并记录 forced", async () => {
        installDefaults();
        const terminate = vi.fn().mockResolvedValue({exitCode: 0, signal: null, terminationReason: "shutdown"});
        mocks.shutdownNativeProduct.mockRejectedValue(new Error("graceful failed"));
        mocks.spawnOwnedProcess.mockReturnValue({
            completion: Promise.resolve({exitCode: 0, signal: null}),
            terminate,
        });
        const handle = await startPreviewRuntime(options(join(await tempRoot(), "run"), "source-dev", "forced-stop"));

        await handle.stop();

        expect(terminate).toHaveBeenCalledWith("shutdown");
        expect(handle.stopResult).toBe("forced");
    });

    it("端口仍可达时不删除 owner、lease 或隔离 State/Cache", async () => {
        installDefaults();
        const root = await tempRoot();
        const taskRoot = join(root, "run");
        const listener = await listen(0);
        const address = listener.address();
        if (!address || typeof address === "string") throw new Error("测试 listener 未取得端口");
        await listener.close();
        const handle = await startPreviewRuntime({...options(taskRoot, "source-dev", "port-held"), port: address.port});
        const held = await listen(handle.port);

        await expect(handle.stop()).rejects.toThrow("端口仍未释放");
        await expect(stat(join(taskRoot, "dev-state"))).resolves.toBeDefined();
        await expect(stat(join(taskRoot, "dev-cache"))).resolves.toBeDefined();
        await expect(stat(join(taskRoot, "runtime-owner.json"))).resolves.toBeDefined();
        await held.close();
    }, 10_000);

    it("只清理 heartbeat 超过 24 小时且 lease 已失效的自有任务根", async () => {
        installDefaults();
        const parent = await tempRoot();
        const stale = join(parent, "stale");
        const current = join(parent, "current");
        await mkdirForTest(stale);
        await Bun.write(join(stale, "runtime-owner.json"), `${JSON.stringify({
            schema: PREVIEW_RUNTIME_SCHEMA,
            heartbeatAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        })}\n`);

        const handle = await startPreviewRuntime(options(current, "source-dev", "stale-sweep"));

        await expect(stat(stale)).rejects.toMatchObject({code: "ENOENT"});
        await handle.stop();
    });
});

function options(taskRoot: string, mode: "auto" | "product" | "source-dev", operationId: string) {
    return {
        repoRoot: REPO_ROOT,
        taskRoot,
        operationId,
        mode,
        port: 0,
        expectedVersion: "0.9.5-canary",
        stateRoot: join(taskRoot, mode === "source-dev" ? "dev-state" : "product-state"),
        cacheRoot: join(taskRoot, mode === "source-dev" ? "dev-cache" : "product-cache"),
        browserMediaRoot: join(taskRoot, "media"),
    } as const;
}

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-preview-runtime-"));
    roots.push(root);
    return root;
}

async function mkdirForTest(path: string): Promise<void> {
    await mkdir(path, {recursive: true});
    await writeFile(join(path, ".keep"), "owned\n", "utf8");
}

function migrationChild(): EventEmitter & {stdout: EventEmitter; stderr: EventEmitter} {
    const child = new EventEmitter() as EventEmitter & {stdout: EventEmitter; stderr: EventEmitter};
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
        child.stdout.emit("data", `${JSON.stringify({status: "already_current"})}\n`);
        child.emit("exit", 0, null);
    });
    return child;
}

function listen(port: number): Promise<Server> {
    const server = createServer();
    return new Promise((resolvePromise, rejectPromise) => {
        server.once("error", rejectPromise);
        server.listen(port, "127.0.0.1", () => resolvePromise(server));
    });
}
