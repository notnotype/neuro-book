import {EventEmitter} from "node:events";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";

const mocks = vi.hoisted(() => ({
    spawnOwnedProcess: vi.fn(),
    waitForApplicationReady: vi.fn(),
    shutdownNativeProduct: vi.fn(),
    spawn: vi.fn(),
}));

vi.mock("@notnotype/owned-process", () => ({spawnOwnedProcess: mocks.spawnOwnedProcess}));
vi.mock("nbook/shared/application-ready", () => ({waitForApplicationReady: mocks.waitForApplicationReady}));
vi.mock("nbook/shared/product-runtime-shutdown", () => ({shutdownNativeProduct: mocks.shutdownNativeProduct}));
vi.mock("node:child_process", () => ({spawn: mocks.spawn}));

import {startPreviewRuntime} from "nbook/scripts/deploy/preview-runtime";

const roots: string[] = [];
const repositoryRoot = resolve(".");

function installDefaults(): void {
    mocks.waitForApplicationReady.mockResolvedValue(undefined);
    mocks.shutdownNativeProduct.mockResolvedValue("graceful");
    mocks.spawnOwnedProcess.mockImplementation(() => ({
        completion: Promise.resolve({exitCode: 0, signal: null}),
        terminate: vi.fn().mockResolvedValue({exitCode: 0, signal: null, terminationReason: "shutdown"}),
    }));
    mocks.spawn.mockImplementation(() => migrationChild());
}

async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "nbook-preview-tutorial-"));
    roots.push(root);
    return root;
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    vi.clearAllMocks();
});

describe("Preview Runtime tutorial preparation", () => {
    it("迁移完成后仅向两个隔离 State Root 调用配置准备回调", async () => {
        installDefaults();
        const root = await tempRoot();
        const taskRoot = join(root, "run");
        const prepared: string[] = [];
        const handle = await startPreviewRuntime({
            repoRoot: repositoryRoot,
            taskRoot,
            operationId: "prepared-config",
            mode: "source-dev",
            port: 0,
            expectedVersion: "0.9.5-canary",
            stateRoot: join(taskRoot, "dev-state"),
            cacheRoot: join(taskRoot, "dev-cache"),
            browserMediaRoot: join(taskRoot, "media"),
            prepareStateRoot: async (stateRoot, mode) => {
                prepared.push(mode);
                await writeFile(join(stateRoot, "tutorial-config.json"), mode, "utf8");
            },
        });

        expect(prepared.sort()).toEqual(["product", "source-dev"]);
        await expect(readFile(join(taskRoot, "dev-state", "tutorial-config.json"), "utf8")).resolves.toBe("source-dev");
        await expect(readFile(join(taskRoot, "product-state", "tutorial-config.json"), "utf8")).resolves.toBe("product");
        await handle.stop();
    });

    it("隔离 auto 模式在无 verified Product image 时只 fallback 一次到 Source Dev", async () => {
        installDefaults();
        const root = await tempRoot();
        const repoRoot = join(root, "repo");
        await mkdir(join(repoRoot, ".output"), {recursive: true});
        const taskRoot = join(root, "run");
        const handle = await startPreviewRuntime({
            repoRoot,
            taskRoot,
            operationId: "tutorial-auto-fallback",
            mode: "auto",
            port: 0,
            expectedVersion: "0.9.5-canary",
            stateRoot: join(taskRoot, "product-state"),
            cacheRoot: join(taskRoot, "product-cache"),
            browserMediaRoot: join(taskRoot, "media"),
        });

        expect(handle.mode).toBe("source-dev");
        expect(handle.productAttempt).toBe("unavailable");
        expect(handle.fallbackReason).toContain("verified manifest");
        expect(mocks.spawnOwnedProcess).toHaveBeenCalledOnce();
        expect(mocks.spawnOwnedProcess.mock.calls[0]?.[0]).toMatchObject({
            args: ["--no-install", "run", "dev:runtime"],
        });

        await handle.stop();
    });

    it("隔离显式 Product 缺少 image 时失败且不启动 Source Dev", async () => {
        installDefaults();
        const root = await tempRoot();
        const repoRoot = join(root, "repo");
        await mkdir(join(repoRoot, ".output"), {recursive: true});
        const taskRoot = join(root, "run");

        await expect(startPreviewRuntime({
            repoRoot,
            taskRoot,
            operationId: "tutorial-product-only",
            mode: "product",
            port: 0,
            expectedVersion: "0.9.5-canary",
            stateRoot: join(taskRoot, "product-state"),
            cacheRoot: join(taskRoot, "product-cache"),
            browserMediaRoot: join(taskRoot, "media"),
        })).rejects.toMatchObject({kind: "product-unavailable"});
        expect(mocks.spawnOwnedProcess).not.toHaveBeenCalled();
    });
});

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
