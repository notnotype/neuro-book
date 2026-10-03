import {randomUUID} from "node:crypto";
import {mkdir, rm, stat, writeFile} from "node:fs/promises";
import path from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {ProjectLifecycle, type PreparedProjectOpen} from "nbook/server/workspace-files/project-lifecycle";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import type {ProjectModuleContext} from "nbook/server/workspace-files/project-module";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {WorkspaceHistory} from "@notnotype/nb-history";
import {
    LOCAL_USER_ID,
    PROJECT_HISTORY_MODULE_TOKEN,
    projectHistoryModule,
    recordProjectWrite,
    resetWorkspaceHistoryForTest,
    setHistoryEnabledOverrideForTest,
    type ProjectHistoryHandle,
} from "nbook/server/workspace-history/project-history";

describe("History ProjectModule", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;
    let lifecycle: ProjectLifecycle;
    const opened: Array<{prepared: PreparedProjectOpen; handle: ProjectHistoryHandle}> = [];

    beforeEach(async () => {
        tempRoot = testHostPath(`neuro-book-history-module-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(path.join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        lifecycle = new ProjectLifecycle(workspaceRoot);
        setHistoryEnabledOverrideForTest(true);
    });

    afterEach(async () => {
        for (const item of opened.splice(0).reverse()) {
            await item.handle.close().catch(() => undefined);
            await item.prepared.occupancy.release().catch(() => undefined);
        }
        vi.restoreAllMocks();
        await lifecycle.close();
        await resetWorkspaceHistoryForTest();
        setHistoryEnabledOverrideForTest(null);
        collectReleasedSqliteHandles({force: true});
        await rm(tempRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    }, 60_000);

    it("required ready 在开库并完成必要路径 purge 后才兑现", async () => {
        await mkdir(path.join(workspaceRoot, "minimum-ready"));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("minimum-ready"));
        const databasePath = path.join(prepared.workspace.root, ".nbook", "history.sqlite");
        await mkdir(path.dirname(databasePath), {recursive: true});
        const stalePath = "world-engine/.runtime-artifact-import-cache/calendar/stale.mjs";
        const lifecycleTemp = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174003.tmp";
        const seeded = await WorkspaceHistory.open({
            databasePath,
            resolvePath: (relativePath) => path.join(prepared.workspace.root, ...relativePath.split("/")),
            config: {retentionFullDays: 30, keepDailyLastAfterWindow: true},
        });
        await seeded.performWrite({kind: "agent", sessionId: "seed"}, stalePath, "stale");
        await seeded.performWrite({kind: "agent", sessionId: "seed"}, lifecycleTemp, "transaction temp");
        await seeded.close();

        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});
        await handle.ready;

        expect(PROJECT_HISTORY_MODULE_TOKEN).toMatchObject({name: "history", kind: "required"});
        expect(projectHistoryModule.token).toBe(PROJECT_HISTORY_MODULE_TOKEN);
        const history = await handle.history;
        expect(history).not.toBeNull();
        expect(await history!.timeline(stalePath)).toEqual([]);
        expect(await history!.timeline(lifecycleTemp)).toEqual([]);
    });

    it("history关闭时返回ready no-op handle且不创建数据库", async () => {
        setHistoryEnabledOverrideForTest(false);
        await mkdir(path.join(workspaceRoot, "disabled"));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("disabled"));
        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});

        await expect(handle.ready).resolves.toBeUndefined();
        await expect(handle.history).resolves.toBeNull();
        await expect(handle.close()).resolves.toBeUndefined();
        await expect(handle.close()).resolves.toBeUndefined();
        await expect(stat(path.join(prepared.workspace.root, ".nbook", "history.sqlite")))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("close失败后保留同一generation实例并允许精确重试", async () => {
        await mkdir(path.join(workspaceRoot, "retry-close"));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("retry-close"));
        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});
        await handle.ready;
        const history = await handle.history;
        expect(history).not.toBeNull();

        const originalClose = history!.close.bind(history);
        const closeSpy = vi.spyOn(history!, "close")
            .mockRejectedValueOnce(new Error("injected close failure"))
            .mockImplementation(originalClose);

        await expect(handle.close()).rejects.toThrow("injected close failure");
        await expect(handle.history).resolves.toBe(history);
        await expect(handle.close()).resolves.toBeUndefined();
        expect(closeSpy).toHaveBeenCalledTimes(2);
    });

    it("D15 warm-up不阻塞ready且generation abort后停止后续扫描", async () => {
        await mkdir(path.join(workspaceRoot, "cancellable-warmup", "manuscript"), {recursive: true});
        await writeFile(path.join(workspaceRoot, "cancellable-warmup", "manuscript", "a.md"), "A", "utf8");
        await writeFile(path.join(workspaceRoot, "cancellable-warmup", "manuscript", "b.md"), "B", "utf8");
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("cancellable-warmup"));
        const controller = new AbortController();
        let releaseReconcile: () => void = () => undefined;
        const reconcileGate = new Promise<void>((resolve) => {
            releaseReconcile = resolve;
        });
        const originalReconcile = WorkspaceHistory.prototype.reconcile;
        const reconcileSpy = vi.spyOn(WorkspaceHistory.prototype, "reconcile")
            .mockImplementation(async function (
                this: WorkspaceHistory,
                relativePath: string,
                current: Uint8Array | null,
            ) {
                await reconcileGate;
                return originalReconcile.call(this, relativePath, current);
            });

        const handle = projectHistoryModule.start(moduleContext(prepared, controller.signal));
        opened.push({prepared, handle});
        await handle.ready;
        await vi.waitFor(() => {
            expect(reconcileSpy).toHaveBeenCalledTimes(1);
        });

        controller.abort(new Error("cancel history warm-up"));
        releaseReconcile();
        await handle.close();
        expect(reconcileSpy).toHaveBeenCalledTimes(1);
    });

    it("maintenance失败不推进水位且下一批消费者共享同一重试", async () => {
        await mkdir(path.join(workspaceRoot, "retry-maintenance"));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("retry-maintenance"));
        let releaseRetry: () => void = () => undefined;
        const retryGate = new Promise<void>((resolve) => {
            releaseRetry = resolve;
        });
        const originalPrune = WorkspaceHistory.prototype.prune;
        const pruneSpy = vi.spyOn(WorkspaceHistory.prototype, "prune")
            .mockRejectedValueOnce(new Error("injected maintenance failure"))
            .mockImplementation(async function (this: WorkspaceHistory) {
                await retryGate;
                return originalPrune.call(this);
            });

        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});
        await handle.ready;
        await vi.waitFor(() => {
            expect(handle.diagnostics().warmup).toMatchObject({
                state: "failed",
                phase: "maintenance",
                attemptCount: 1,
                lastFailure: {
                    phase: "maintenance",
                    message: "injected maintenance failure",
                },
            });
        });
        expect(pruneSpy).toHaveBeenCalledTimes(1);

        const firstConsumer = handle.waitForWarmup();
        const secondConsumer = handle.waitForWarmup();
        expect(secondConsumer).toBe(firstConsumer);
        await vi.waitFor(() => {
            expect(pruneSpy).toHaveBeenCalledTimes(2);
            expect(handle.diagnostics().warmup).toMatchObject({
                state: "running",
                phase: "maintenance",
                attemptCount: 2,
            });
        });

        releaseRetry();
        await expect(firstConsumer).resolves.toBeUndefined();
        expect(handle.waitForWarmup()).toBe(firstConsumer);
        expect(handle.diagnostics().warmup).toMatchObject({
            state: "ready",
            phase: null,
            attemptCount: 2,
            lastFailure: {
                phase: "maintenance",
                message: "injected maintenance failure",
            },
        });

        await handle.close();
        await prepared.occupancy.release();
        opened.pop();

        const reopenedPrepared = await lifecycle.prepareOpen(projectWorkspaceRef("retry-maintenance"));
        const reopened = projectHistoryModule.start(moduleContext(reopenedPrepared));
        opened.push({prepared: reopenedPrepared, handle: reopened});
        await reopened.ready;
        await reopened.waitForWarmup();
        expect(pruneSpy).toHaveBeenCalledTimes(2);
    });

    it("raw batch报告丢事件时执行完整reconcile补账", async () => {
        await mkdir(path.join(workspaceRoot, "dropped-events"));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("dropped-events"));
        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});
        await handle.ready;
        const history = await handle.history;
        expect(history).not.toBeNull();
        await vi.waitFor(async () => {
            expect(await history!.timeline("project.yaml")).toHaveLength(1);
        });

        await mkdir(path.join(prepared.workspace.root, "manuscript"));
        await writeFile(path.join(prepared.workspace.root, "manuscript", "missed.md"), "missed", "utf8");
        await handle.reconcileRawEvents({events: [], droppedEventCount: 1});

        const timeline = await history!.timeline("manuscript/missed.md");
        expect(timeline).toHaveLength(1);
        expect(timeline[0]!.entry.actor).toEqual({kind: "external"});
    });

    it("写入记账通过Project Path Policy精确排除Lifecycle temp", async () => {
        await mkdir(path.join(workspaceRoot, "write-policy"));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("write-policy"));
        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});
        await handle.ready;
        const history = await handle.history;
        expect(history).not.toBeNull();
        const lifecycleTemp = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174000.tmp";

        await recordProjectWrite(handle, {
            relativePath: lifecycleTemp,
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("transaction temp"),
        });
        await recordProjectWrite(handle, {
            relativePath: "manuscript/ordinary.tmp",
            actor: {kind: "user", userId: LOCAL_USER_ID},
            before: null,
            after: new TextEncoder().encode("ordinary content"),
        });

        expect(await history!.timeline(lifecycleTemp)).toEqual([]);
        expect(await history!.timeline("manuscript/ordinary.tmp")).toHaveLength(1);
    });

    it("D15完整reconcile统一忽略recovery、runtime与精确Lifecycle temp", async () => {
        const projectRoot = path.join(workspaceRoot, "full-scan-policy");
        const lifecycleTemp = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174001.tmp";
        await mkdir(path.join(projectRoot, ".nbook", "recovery"), {recursive: true});
        await mkdir(path.join(projectRoot, "world-engine", ".runtime-artifact-import-cache"), {recursive: true});
        await mkdir(path.join(projectRoot, "manuscript"), {recursive: true});
        await writeFile(path.join(projectRoot, lifecycleTemp), "transaction temp", "utf8");
        await writeFile(path.join(projectRoot, ".nbook", "recovery", "project-manifest-original.yaml"), "backup", "utf8");
        await writeFile(
            path.join(projectRoot, "world-engine", ".runtime-artifact-import-cache", "cache.mjs"),
            "cache",
            "utf8",
        );
        await writeFile(path.join(projectRoot, "manuscript", "ordinary.tmp"), "content", "utf8");
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("full-scan-policy"));
        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});
        await handle.ready;
        const history = await handle.history;
        expect(history).not.toBeNull();

        await vi.waitFor(async () => {
            expect(await history!.timeline("manuscript/ordinary.tmp")).toHaveLength(1);
        });
        expect(handle.pathPolicy(lifecycleTemp)).toEqual({category: "lifecycle-temp", disposition: "ignore"});
        expect(handle.pathPolicy(".nbook/recovery/project-manifest-original.yaml"))
            .toEqual({category: "recovery", disposition: "ignore"});
        expect(handle.pathPolicy("world-engine/.runtime-artifact-import-cache/cache.mjs"))
            .toEqual({category: "rebuildable-runtime", disposition: "ignore"});
        expect(await history!.timeline(lifecycleTemp)).toEqual([]);
        expect(await history!.timeline(".nbook/recovery/project-manifest-original.yaml")).toEqual([]);
        expect(await history!.timeline("world-engine/.runtime-artifact-import-cache/cache.mjs")).toEqual([]);
    });

    it("raw reconcile先执行统一Policy再保留History私有路径规则", async () => {
        const projectRoot = path.join(workspaceRoot, "raw-policy");
        await mkdir(projectRoot);
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("raw-policy"));
        const handle = projectHistoryModule.start(moduleContext(prepared));
        opened.push({prepared, handle});
        await handle.ready;
        const history = await handle.history;
        expect(history).not.toBeNull();
        await vi.waitFor(async () => {
            expect(await history!.timeline("project.yaml")).toHaveLength(1);
        });

        const lifecycleTemp = ".nbook-project-lifecycle-v1-123e4567-e89b-42d3-a456-426614174002.tmp";
        const paths = [
            lifecycleTemp,
            ".nbook/recovery/project-manifest-original.yaml",
            "world-engine/.runtime-artifact-import-cache/cache.mjs",
            ".nbook/private.db",
            ".git/HEAD",
            ".agent/plan.md",
            "agents/leader.default/persona.md",
            "manuscript/visible.md",
        ] as const;
        for (const relativePath of paths) {
            const absolutePath = path.join(projectRoot, ...relativePath.split("/"));
            await mkdir(path.dirname(absolutePath), {recursive: true});
            await writeFile(absolutePath, relativePath, "utf8");
        }

        await handle.reconcileRawEvents({
            events: paths.map((eventPath) => ({kind: "add" as const, path: eventPath})),
            droppedEventCount: 0,
        });

        for (const relativePath of paths.slice(0, -1)) {
            expect(await history!.timeline(relativePath)).toEqual([]);
        }
        const visible = await history!.timeline("manuscript/visible.md");
        expect(visible).toHaveLength(1);
        expect(visible[0]!.entry.actor).toEqual({kind: "external"});
    });
});

/** 构造只启动单个History Module的公开generation上下文。 */
function moduleContext(prepared: PreparedProjectOpen, signal = new AbortController().signal): ProjectModuleContext {
    return {
        prepared,
        opener: {kind: "job", source: "history-module-test"},
        signal,
        require: () => {
            throw new Error("History Module没有前置Module依赖");
        },
    };
}
