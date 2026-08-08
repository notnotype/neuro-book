import {mkdtemp, readFile, readdir, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";

import {TEST_RUNTIME_IMAGE_IDENTITY} from "#manager/fixtures/runtime-image";
import {
    applyJournaledApplicationMigrations,
    migrateCurrentApplicationState,
    planJournaledApplicationMigrations,
    startInstallationApplication,
} from "#manager/migration-operation";
import {mutateInstallation} from "#manager/installation-mutation";
import {writeInstallationManifest} from "#manager/manifest-store";
import {createOperation} from "#manager/operation";
import {currentProductPlatform} from "#manager/platform";
import {INSTALLATION_SCOPED_ROOT_LOCATORS} from "#manager/root-locators";
import type {ApplicationLaunchOptions} from "#manager/app-commands";
import type {InstallationManifest} from "#manager/types";
import {PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED} from "nbook/shared/product-runtime-contract";

const migrations = vi.hoisted(() => ({
    plan: vi.fn(),
    apply: vi.fn(),
    rollback: vi.fn(),
    launch: vi.fn(),
}));
const lifecycle = vi.hoisted(() => ({
    assertNativeStopped: vi.fn(),
    backupDatabase: vi.fn(),
    inspectDocker: vi.fn(),
    stopDocker: vi.fn(),
}));

vi.mock("#manager/app-commands", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/app-commands")>(),
    planApplicationStateMigration: migrations.plan,
    applyApplicationStateMigration: migrations.apply,
    rollbackApplicationStateMigration: migrations.rollback,
    launchApplication: migrations.launch,
}));
vi.mock("#manager/health", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/health")>(),
    assertNativeProductStopped: lifecycle.assertNativeStopped,
    backupApplicationDatabase: lifecycle.backupDatabase,
}));
vi.mock("#manager/docker", async (importOriginal) => ({
    ...await importOriginal<typeof import("#manager/docker")>(),
    inspectDockerApplication: lifecycle.inspectDocker,
    stopDocker: lifecycle.stopDocker,
}));

const roots: string[] = [];

beforeEach(() => {
    vi.clearAllMocks();
    lifecycle.assertNativeStopped.mockResolvedValue(undefined);
    lifecycle.backupDatabase.mockResolvedValue(null);
    lifecycle.inspectDocker.mockResolvedValue({configuredImage: "neuro-book-source:test"});
    lifecycle.stopDocker.mockResolvedValue(undefined);
    migrations.launch.mockResolvedValue({
        ready: Promise.resolve(),
        completion: Promise.resolve({code: 0, signal: null}),
        shutdown: vi.fn(),
        terminate: vi.fn(),
    });
});
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true}))));

describe("Journaled application migration", () => {
    it("apply开始前已持久化固定runId，成功后推进applied", async () => {
        const {root, journal, manifest} = await fixture("migration-success");
        migrations.plan.mockResolvedValue({runId: "migration-success", status: "planned", steps: migrationSteps("migration-success")});
        migrations.apply.mockImplementation(async () => {
            const saved = await savedJournal(root, "migration-success");
            expect(saved.applicationStateMigration).toEqual({
                runId: "migration-success",
                state: "applying",
            });
            return {runId: "migration-success", steps: migrationSteps("migration-success")};
        });

        const planned = await planJournaledApplicationMigrations(root, manifest, journal);
        const result = await applyJournaledApplicationMigrations(root, manifest, planned.journal);

        expect(migrations.apply).toHaveBeenCalledWith(root, manifest, "migration-success", root);
        expect(result.applicationStateMigration?.state).toBe("applied");
        expect((await savedJournal(root, "migration-success")).applicationStateMigration?.state).toBe("applied");
    });

    it("apply中断时journal保留applying供统一恢复", async () => {
        const {root, journal, manifest} = await fixture("migration-failure");
        migrations.plan.mockResolvedValue({runId: "migration-failure", status: "planned", steps: migrationSteps("migration-failure")});
        migrations.apply.mockRejectedValue(new Error("apply interrupted"));

        const planned = await planJournaledApplicationMigrations(root, manifest, journal);
        await expect(applyJournaledApplicationMigrations(root, manifest, planned.journal)).rejects.toThrow("apply interrupted");

        expect((await savedJournal(root, "migration-failure")).applicationStateMigration).toEqual({
            runId: "migration-failure",
            state: "applying",
        });
    });

    it("Manager 不解释 Product catalog step，持久化 runId 后直接 apply", async () => {
        const {root, journal, manifest} = await fixture("migration-product-owned-catalog");
        migrations.plan.mockResolvedValue({runId: journal.id, status: "planned", steps: migrationSteps(journal.id)});
        migrations.apply.mockResolvedValue({runId: journal.id, steps: migrationSteps(journal.id)});

        const planned = await planJournaledApplicationMigrations(root, manifest, journal);
        const result = await applyJournaledApplicationMigrations(root, manifest, planned.journal);

        expect(migrations.apply).toHaveBeenCalledWith(root, manifest, journal.id, root);
        expect(result.effects).not.toContainEqual(expect.objectContaining({kind: "sqlite-backup"}));
    });

    it("动态manual preflight失败时数据库保持未修改", async () => {
        const {root, journal, manifest} = await fixture("migration-manual");
        migrations.plan.mockRejectedValue(new Error("manual_required"));

        await expect(planJournaledApplicationMigrations(root, manifest, journal)).rejects.toThrow("manual_required");

        expect(migrations.apply).not.toHaveBeenCalled();
    });

    it("dry-run无变化时不增加journal组件", async () => {
        const {root, journal, manifest} = await fixture("migration-noop");
        migrations.plan.mockResolvedValue({runId: journal.id, status: "already_current", steps: migrationSteps(journal.id)});

        const result = await planJournaledApplicationMigrations(root, manifest, journal);

        expect(result.journal.applicationStateMigration).toBeUndefined();
        expect(migrations.apply).not.toHaveBeenCalled();
    });

    it("同版本migration-only update先plan，already current时不创建Journal", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-migration-only-current-"));
        roots.push(root);
        const manifest = productManifest();
        migrations.plan.mockImplementation(async (_root, _manifest, runId) => ({
            runId,
            status: "already_current",
            steps: migrationSteps(runId),
        }));

        await expect(migrateCurrentApplicationState(root, manifest)).resolves.toBe(false);

        await expect(readdir(join(root, ".deploy", "operations"))).rejects.toMatchObject({code: "ENOENT"});
        expect(lifecycle.assertNativeStopped).not.toHaveBeenCalled();
        expect(migrations.launch).not.toHaveBeenCalled();
    });

    it("同版本migration-only update在plan后执行完整事务并关闭验证进程", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-migration-only-planned-"));
        roots.push(root);
        const manifest = productManifest();
        const shutdown = vi.fn().mockResolvedValue(undefined);
        migrations.plan.mockImplementation(async (_root, _manifest, runId) => {
            await expect(readdir(join(root, ".deploy", "operations"))).rejects.toMatchObject({code: "ENOENT"});
            return {runId, status: "planned", steps: migrationSteps(runId)};
        });
        migrations.apply.mockImplementation(async (_root, _manifest, runId) => ({
            runId,
            steps: migrationSteps(runId),
        }));
        migrations.launch.mockResolvedValue({
            ready: Promise.resolve(),
            completion: Promise.resolve({code: 0, signal: null}),
            shutdown,
            terminate: vi.fn(),
        });

        await expect(migrateCurrentApplicationState(root, manifest)).resolves.toBe(true);

        expect(lifecycle.assertNativeStopped).toHaveBeenCalledWith(join(root, "data"));
        expect(lifecycle.backupDatabase).toHaveBeenCalledOnce();
        expect(shutdown).toHaveBeenCalledOnce();
        await expect(readdir(join(root, ".deploy", "operations"))).resolves.toEqual([]);
    });

    it("migration验证进程丢失Session Store lease时不提交成功结果", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-migration-only-compromised-"));
        roots.push(root);
        const manifest = productManifest();
        migrations.plan.mockImplementation(async (_root, _manifest, runId) => ({
            runId,
            status: "planned",
            steps: migrationSteps(runId),
        }));
        migrations.apply.mockImplementation(async (_root, _manifest, runId) => ({
            runId,
            steps: migrationSteps(runId),
        }));
        const shutdown = vi.fn().mockResolvedValue(undefined);
        const terminate = vi.fn().mockResolvedValue(undefined);
        migrations.launch.mockResolvedValue({
            ready: Promise.resolve(),
            completion: Promise.resolve({
                code: PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED,
                signal: null,
            }),
            shutdown,
            terminate,
        });

        await expect(migrateCurrentApplicationState(root, manifest))
            .rejects.toThrow("不要手动删除 runtime.lease.lock");
        expect(shutdown).toHaveBeenCalledOnce();
        expect(terminate).toHaveBeenCalledOnce();
        await expect(readdir(join(root, ".deploy", "operations"))).resolves.toEqual([]);
    });

    it("start在maintenance journal提交后才运行前台应用", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-migration-"));
        roots.push(root);
        const manifest = productManifest();
        migrations.plan.mockResolvedValue({runId: "start-current", status: "already_current", steps: migrationSteps("start-current")});

        await startManagedApplication(root, manifest, {healthCheck: true});

        expect(migrations.launch).toHaveBeenCalledWith(root, manifest, expect.objectContaining({
            healthCheck: true,
            openBrowser: true,
            onContainerStarting: expect.any(Function),
            onContainerStarted: expect.any(Function),
            onContainerStopped: expect.any(Function),
        }));
        expect(migrations.launch.mock.invocationCallOrder[0]).toBeGreaterThan(migrations.plan.mock.invocationCallOrder[0]!);
        await expect(readdir(join(root, ".deploy", "operations"))).resolves.toEqual([]);
        expect(lifecycle.assertNativeStopped).toHaveBeenCalledWith(join(root, "data"));
    });

    it("native start 在 Application State apply 前持久化SQLite backup", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-native-backup-"));
        roots.push(root);
        const manifest = productManifest();
        const databasePath = join(root, "data", "app.sqlite");
        let backupPath = "";
        migrations.plan.mockResolvedValue({runId: "start-native", status: "planned", steps: migrationSteps("start-native")});
        lifecycle.backupDatabase.mockImplementation(async (stateRoot, backupRoot, onIntent) => {
            expect(stateRoot).toBe(join(root, "data"));
            expect(backupRoot).toMatch(new RegExp(`\\.deploy[\\\\/]backups[\\\\/][a-f0-9-]+$`, "u"));
            backupPath = join(backupRoot, "database", "app.sqlite");
            await onIntent?.({
                configuredUrl: "file:app.sqlite",
                databasePath,
                backupPath,
                stateRoot,
            });
            return {
                configuredUrl: "file:app.sqlite",
                databasePath,
                backupPath,
                checkpoint: {busy: 0, log: 0, checkpointed: 0},
            };
        });
        migrations.apply.mockImplementation(async () => {
            const saved = await onlyOperation(root);
            expect(saved.effects).toContainEqual(expect.objectContaining({
                kind: "sqlite-backup",
                state: "applied",
                hostPath: databasePath,
                backupPath,
            }));
            return {runId: "start-native", steps: migrationSteps("start-native")};
        });

        await startManagedApplication(root, manifest, {healthCheck: true});

        expect(lifecycle.assertNativeStopped.mock.invocationCallOrder[0])
            .toBeLessThan(lifecycle.backupDatabase.mock.invocationCallOrder[0]!);
        expect(lifecycle.backupDatabase.mock.invocationCallOrder[0])
            .toBeLessThan(migrations.apply.mock.invocationCallOrder[0]!);
    });

    it("container start 有迁移时先记录并停止running容器，再备份和apply", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-container-transaction-"));
        roots.push(root);
        const manifest = dockerManifest();
        const containerId = "e".repeat(64);
        migrations.plan.mockResolvedValue({runId: "start-container-transaction", status: "planned", steps: migrationSteps("start-container-transaction")});
        lifecycle.inspectDocker.mockResolvedValue({
            configuredImage: "neuro-book-source:test",
            containerId,
            actualImage: "neuro-book-source:test",
            status: "running",
            exitCode: 0,
        });
        lifecycle.backupDatabase.mockResolvedValue(null);
        migrations.apply.mockImplementation(async () => {
            const saved = await onlyOperation(root);
            expect(saved.effects).toContainEqual(expect.objectContaining({
                kind: "compose",
                state: "applied",
                previousState: "running",
                stopped: true,
            }));
            return {runId: "start-container-transaction", steps: migrationSteps("start-container-transaction")};
        });

        await startManagedApplication(root, manifest, {healthCheck: true});

        expect(lifecycle.assertNativeStopped).not.toHaveBeenCalled();
        expect(lifecycle.stopDocker).toHaveBeenCalledWith("docker", root, join(root, "data"));
        expect(lifecycle.stopDocker.mock.invocationCallOrder[0])
            .toBeLessThan(lifecycle.backupDatabase.mock.invocationCallOrder[0]!);
        expect(lifecycle.backupDatabase.mock.invocationCallOrder[0])
            .toBeLessThan(migrations.apply.mock.invocationCallOrder[0]!);
    });

    it("前台 Manager 收到 signal 时请求 graceful shutdown 并移除监听器", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-signal-"));
        roots.push(root);
        const manifest = productManifest();
        const terminal = deferred<{code: number | null; signal: string | null}>();
        const shutdown = vi.fn(async () => {
            terminal.resolve({code: 0, signal: null});
        });
        migrations.plan.mockResolvedValue({runId: "start-signal", status: "already_current", steps: migrationSteps("start-signal")});
        migrations.launch.mockResolvedValueOnce({
            ready: Promise.resolve(),
            completion: terminal.promise,
            shutdown,
            terminate: vi.fn(),
        });
        const previousSigint = new Set(process.listeners("SIGINT"));
        const previousSigterm = new Set(process.listeners("SIGTERM"));

        const running = startManagedApplication(root, manifest, {healthCheck: true});
        try {
            await vi.waitFor(() => {
                expect(process.listeners("SIGINT").some((listener) => !previousSigint.has(listener))).toBe(true);
                expect(process.listeners("SIGTERM").some((listener) => !previousSigterm.has(listener))).toBe(true);
            }, {timeout: 5_000});
            const handler = process.listeners("SIGINT").find((listener) => !previousSigint.has(listener));
            if (!handler) throw new Error("Manager 未注册 SIGINT shutdown listener");
            handler("SIGINT");

            await running;

            expect(shutdown).toHaveBeenCalledTimes(1);
            expect(process.listeners("SIGINT").filter((listener) => !previousSigint.has(listener))).toHaveLength(0);
            expect(process.listeners("SIGTERM").filter((listener) => !previousSigterm.has(listener))).toHaveLength(0);
        } finally {
            terminal.resolve({code: 0, signal: null});
            await running.catch(() => undefined);
        }
    });

    it("Desktop Supervisor 的动态端口会写入首次 State Root", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-dynamic-port-"));
        roots.push(root);
        const manifest = productManifest();
        const port = 43127;
        migrations.plan.mockResolvedValue({runId: "start-dynamic-port", status: "already_current", steps: migrationSteps("start-dynamic-port")});
        migrations.launch.mockImplementationOnce(async () => {
            const env = await readFile(join(root, "data", ".env"), "utf8");
            expect(env).toContain(`NUXT_PORT=${port}`);
            return {
                ready: Promise.resolve(),
                completion: Promise.resolve({code: 0, signal: null}),
                shutdown: vi.fn(),
                terminate: vi.fn(),
            };
        });

        await startManagedApplication(root, manifest, {healthCheck: true, port});
    });

    it("宿主 ready 回调只在 Installation lease 释放后触发", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-ready-after-lease-"));
        roots.push(root);
        const manifest = productManifest();
        const terminal = deferred<{code: number | null; signal: string | null}>();
        migrations.plan.mockResolvedValue({
            runId: "start-ready-after-lease",
            status: "already_current",
            steps: migrationSteps("start-ready-after-lease"),
        });
        migrations.launch.mockResolvedValueOnce({
            ready: Promise.resolve(),
            completion: terminal.promise,
            shutdown: vi.fn(),
            terminate: vi.fn(),
        });

        const onReady = vi.fn(async () => {
            await expect(mutateInstallation(root, async () => undefined)).resolves.toBeUndefined();
            terminal.resolve({code: 0, signal: null});
        });

        await startManagedApplication(root, manifest, {healthCheck: true, onReady});

        expect(onReady).toHaveBeenCalledOnce();
    });

    it("嵌入宿主关闭生命周期信号时请求 graceful shutdown 并等待 Product 终态", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-host-lifecycle-"));
        roots.push(root);
        const manifest = productManifest();
        const terminal = deferred<{code: number | null; signal: string | null}>();
        const controller = new AbortController();
        const shutdown = vi.fn(async () => {
            terminal.resolve({code: 0, signal: null});
        });
        migrations.plan.mockResolvedValue({runId: "start-host-lifecycle", status: "already_current", steps: migrationSteps("start-host-lifecycle")});
        migrations.launch.mockResolvedValueOnce({
            ready: Promise.resolve(),
            completion: terminal.promise,
            shutdown,
            terminate: vi.fn(),
        });

        const running = startManagedApplication(root, manifest, {
            healthCheck: true,
            shutdownSignal: controller.signal,
        });
        try {
            await vi.waitFor(() => expect(migrations.launch).toHaveBeenCalledOnce(), {timeout: 5_000});
            controller.abort();

            await running;

            expect(shutdown).toHaveBeenCalledTimes(1);
        } finally {
            terminal.resolve({code: 0, signal: null});
            await running.catch(() => undefined);
        }
    });

    it("容器start在健康检查前持久化候选身份并随Operation提交", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-container-"));
        roots.push(root);
        const manifest = dockerManifest();
        const containerId = "d".repeat(64);
        migrations.plan.mockResolvedValue({runId: "start-container", status: "already_current", steps: migrationSteps("start-container")});
        migrations.launch.mockImplementationOnce(async (
            _root: string,
            _manifest: InstallationManifest,
            options: ApplicationLaunchOptions,
        ) => {
            await options.onContainerStarting?.();
            const operationFile = (await readdir(join(root, ".deploy", "operations")))[0]!;
            const planned = JSON.parse(await readFile(join(root, ".deploy", "operations", operationFile), "utf8")) as {
                effects: Array<{kind: string; state: string; containerId?: string}>;
            };
            expect(planned.effects).toContainEqual({
                kind: "candidate-container",
                state: "planned",
                owner: "application",
                stopped: false,
            });
            await options.onContainerStarted?.(containerId);
            return {
                ready: Promise.resolve(),
                completion: Promise.resolve({code: 0, signal: null}),
                shutdown: vi.fn(),
                terminate: vi.fn(),
            };
        });

        await startManagedApplication(root, manifest, {healthCheck: true});

        await expect(readdir(join(root, ".deploy", "operations"))).resolves.toEqual([]);
    });

    it("ready 前失败会终止候选并回滚未提交 start operation", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-ready-failure-"));
        roots.push(root);
        const terminate = vi.fn().mockResolvedValue(undefined);
        migrations.plan.mockResolvedValue({runId: "start-current", status: "already_current", steps: migrationSteps("start-current")});
        migrations.launch.mockImplementationOnce(async () => ({
            ready: Promise.reject(new Error("health timeout")),
            completion: Promise.resolve({code: 1, signal: null}),
            shutdown: vi.fn(),
            terminate,
        }));

        await expect(startManagedApplication(root, productManifest(), {healthCheck: true})).rejects.toThrow("health timeout");

        expect(terminate).toHaveBeenCalledTimes(1);
        await expect(readdir(join(root, ".deploy", "operations"))).resolves.toEqual([]);
    });

    it("窗口 ready 后宿主完整复核失败仍终止候选并回滚 start operation", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-on-ready-failure-"));
        roots.push(root);
        const terminate = vi.fn().mockResolvedValue(undefined);
        migrations.plan.mockResolvedValue({runId: "start-on-ready-failure", status: "already_current", steps: migrationSteps("start-on-ready-failure")});
        migrations.launch.mockResolvedValueOnce({
            ready: Promise.resolve(),
            completion: Promise.resolve({code: 0, signal: null}),
            shutdown: vi.fn(),
            terminate,
        });

        await expect(startManagedApplication(root, productManifest(), {
            healthCheck: true,
            onReady: async () => {
                throw new Error("full verification failed");
            },
        })).rejects.toThrow("full verification failed");

        expect(terminate).toHaveBeenCalledTimes(1);
        await expect(readdir(join(root, ".deploy", "operations"))).resolves.toEqual([]);
    });

    it("ready后以Session Store lease compromised退出时返回专用提示", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-ready-compromised-"));
        roots.push(root);
        const manifest = productManifest();
        migrations.plan.mockResolvedValue({runId: "start-compromised", status: "already_current", steps: migrationSteps("start-compromised")});
        migrations.launch.mockResolvedValueOnce({
            ready: Promise.resolve(),
            completion: Promise.resolve({code: PRODUCT_RUNTIME_EXIT_CODE_AGENT_SESSION_STORE_LEASE_COMPROMISED, signal: null}),
            shutdown: vi.fn(),
            terminate: vi.fn(),
        });

        await expect(startManagedApplication(root, manifest, {healthCheck: true}))
            .rejects.toThrow("不要手动删除 runtime.lease.lock");
    });

    it("候选终止失败时保留未提交 Journal 并禁止状态回滚", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-terminate-failure-"));
        roots.push(root);
        const terminate = vi.fn().mockRejectedValue(new Error("container stop failed"));
        migrations.plan.mockResolvedValue({runId: "start-terminate-failure", status: "planned", steps: migrationSteps("start-terminate-failure")});
        migrations.apply.mockResolvedValue({runId: "start-terminate-failure", steps: migrationSteps("start-terminate-failure")});
        migrations.launch.mockImplementationOnce(async () => ({
            ready: Promise.reject(new Error("health timeout")),
            completion: Promise.resolve({code: 1, signal: null}),
            shutdown: vi.fn(),
            terminate,
        }));

        await expect(startManagedApplication(root, productManifest(), {healthCheck: true}))
            .rejects.toThrow("候选 Application 无法确认终止");

        expect(terminate).toHaveBeenCalledTimes(1);
        expect(migrations.rollback).not.toHaveBeenCalled();
        const files = await readdir(join(root, ".deploy", "operations"));
        const saved = JSON.parse(await readFile(join(root, ".deploy", "operations", files[0]!), "utf8")) as {
            phase: string;
            outcome?: string;
            applicationStateMigration?: {state: string};
        };
        expect(saved).toMatchObject({
            phase: "migrated",
            applicationStateMigration: {state: "applied"},
        });
        expect(saved.outcome).toBeUndefined();
    });

    it("非Windows Portable关闭健康检查时在迁移前拒绝", async () => {
        const root = await mkdtemp(join(tmpdir(), "manager-start-no-health-check-"));
        roots.push(root);
        const manifest = productManifest();

        await expect(startManagedApplication(root, manifest, {healthCheck: false}))
            .rejects.toThrow("--no-health-check仅支持Windows Portable");

        expect(migrations.plan).not.toHaveBeenCalled();
        expect(migrations.launch).not.toHaveBeenCalled();
    });
});

async function fixture(id: string) {
    const root = await mkdtemp(join(tmpdir(), "manager-migration-operation-"));
    roots.push(root);
    const manifest = productManifest();
    const journal = await createOperation({
        id,
        action: "update",
        root,
        containerEngine: manifest.containerEngine,
        backupRoot: join(root, ".deploy", "backups", id),
        previousManifest: manifest,
        nextManifest: manifest,
    });
    return {root, manifest, journal};
}

/** start 是高层 mutating command，测试必须提供锁内可重读的磁盘 Manifest。 */
async function startManagedApplication(
    root: string,
    manifest: InstallationManifest,
    options: Parameters<typeof startInstallationApplication>[1],
): Promise<void> {
    await writeInstallationManifest(join(root, ".deploy", "installation.json"), manifest);
    await startInstallationApplication(root, options);
}

async function savedJournal(root: string, id: string) {
    return JSON.parse(await readFile(join(root, ".deploy", "operations", `${id}.json`), "utf8")) as {
        applicationStateMigration?: {runId: string; state: string};
    };
}

async function savedOperation(root: string, id: string): Promise<{
    effects: Array<{kind: string; state: string; [key: string]: unknown}>;
}> {
    return JSON.parse(await readFile(join(root, ".deploy", "operations", `${id}.json`), "utf8")) as {
        effects: Array<{kind: string; state: string; [key: string]: unknown}>;
    };
}

async function onlyOperation(root: string): Promise<{
    effects: Array<{kind: string; state: string; [key: string]: unknown}>;
    phase?: string;
    outcome?: string;
}> {
    const files = await readdir(join(root, ".deploy", "operations"));
    if (files.length !== 1 || !files[0]) throw new Error("测试期望唯一 Operation Journal");
    return JSON.parse(await readFile(join(root, ".deploy", "operations", files[0]), "utf8")) as {
        effects: Array<{kind: string; state: string; [key: string]: unknown}>;
        phase?: string;
        outcome?: string;
    };
}

function productManifest(): InstallationManifest {
    const revision = "a".repeat(40);
    return {
        schemaVersion: 5,
        profile: "product-bun",
        containerEngine: null,
        managerVersion: "0.1.0",
        appVersion: "0.8.0-canary.1",
        channel: "canary",
        sourceRevision: revision,
        roots: INSTALLATION_SCOPED_ROOT_LOCATORS,
        components: {
            source: {
                provider: "release", buildId: `sha256:${"9".repeat(64)}`,
                version: "0.8.0-canary.1",
                revision,
                path: ".",
                archiveSha256: "a".repeat(64),
                sourceUrl: "https://example.com/neuro-book-source.zip",
                license: "AGPL-3.0-only",
                redistribution: "test fixture",
                files: ["package.json"],
            },
            product: {
                ...TEST_RUNTIME_IMAGE_IDENTITY,
                provider: "release", buildId: `sha256:${"9".repeat(64)}`,
                version: "0.8.0-canary.1",
                revision,
                platform: currentProductPlatform(),
                path: ".output",
                archiveSha256: "b".repeat(64),
                sourceUrl: "https://example.com/neuro-book-product-windows-x64.zip",
                license: "AGPL-3.0-only",
                redistribution: "test fixture",
            },
            manager: {provider: "managed", version: "0.1.0", path: ".runtime/manager/0.1.0/neuro-book.mjs", bundleSha256: "c".repeat(64)},
            managerRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            applicationRuntime: {provider: "system", version: "1.3.0", executable: "bun"},
            tools: {},
        },
        installedAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z",
    };
}

function migrationSteps(runId: string) {
    return [
        {id: "app-sqlite", runId: `${runId}-app-sqlite`, status: "planned", changedItems: 1, reviewItems: 0},
        {id: "agent-attachment-v1", runId: `${runId}-attachment`, status: "planned", changedItems: 1, reviewItems: 0},
        {id: "agent-session-v2", runId: `${runId}-session`, status: "planned", changedItems: 1, reviewItems: 0},
        {id: "agent-session-v2-review-repair", runId: `${runId}-session-review-repair`, status: "planned", changedItems: 1, reviewItems: 0},
    ];
}

function dockerManifest(): InstallationManifest {
    const manifest = productManifest();
    return {
        ...manifest,
        profile: "source-docker",
        containerEngine: "docker",
        components: {
            source: {
                provider: "git",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                path: ".",
                repository: "https://github.com/notnotype/neuro-book.git",
                branch: "master",
            },
            product: {
                provider: "container",
                version: manifest.appVersion,
                revision: manifest.sourceRevision,
                image: "neuro-book-source:test",
                containerImageId: `sha256:${"8".repeat(64)}`,
            },
            manager: manifest.components.manager,
            managerRuntime: manifest.components.managerRuntime,
            applicationRuntime: {provider: "container", version: manifest.appVersion},
            tools: {
                rg: {provider: "container", version: "source-docker"},
                git: {provider: "container", version: "source-docker"},
                python: {provider: "container", version: "source-docker"},
            },
        },
    };
}

/** 创建可由测试精确推进的 Promise。 */
function deferred<T>(): {promise: Promise<T>; resolve(value: T): void} {
    let settled = false;
    let resolvePromise!: (value: T) => void;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve(value) {
            if (settled) return;
            settled = true;
            resolvePromise(value);
        },
    };
}
