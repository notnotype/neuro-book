import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import path from "node:path";
import {describe, expect, it, vi} from "vitest";
import {SnapshotClosedError} from "@notnotype/file-snapshot-cache";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import { testAbsoluteFsPath } from "@notnotype/neuro-book-test-support/test-path"
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import {
    PROJECT_FILE_INDEX_MODULE_TOKEN,
    ProjectFileIndexAdapter,
    projectFileIndexAdapter,
    projectFileIndexModule,
} from "nbook/server/workspace-files/project-file-index";
import "nbook/server/workspace-files/project-database-module";
import {projectModuleRegistry} from "nbook/server/workspace-files/project-module";
import {
    isIgnoredWorkspaceWatchPath,
    readWorkspaceTreeSnapshot,
    subscribeWorkspaceTreeIndex,
} from "nbook/server/workspace-files/project-workspace-index";

describe("ProjectFileIndexAdapter Project Module handle", () => {
    it("Project target缺少generation handle时fail closed，不降级为plain Workspace", async () => {
        const target = {
            kind: "project-workspace" as const,
            root: absoluteFsPath(testHostPath("missing-project-handle")),
            projectPath: "workspace/missing-project-handle",
        };

        await expect(readWorkspaceTreeSnapshot({target} as never))
            .rejects.toThrow("Project File Index读取缺少当前ReadyProjectSession generation handle");
        await expect(subscribeWorkspaceTreeIndex({target} as never, () => undefined))
            .rejects.toThrow("Project File Index订阅缺少当前ReadyProjectSession generation handle");
    });

    it("公开 required file-index Module token", () => {
        expect(PROJECT_FILE_INDEX_MODULE_TOKEN).toMatchObject({
            name: "file-index",
            kind: "required",
        });
        expect(projectModuleRegistry().required.find(
            (module) => module.token.name === "file-index",
        )).toBe(projectFileIndexModule);
    });

    it("最低 ready 只等待 watcher，完整树构建作为共享 warm-up 在后台运行", async () => {
        const workspaceRoot = absoluteFsPath(testHostPath("project-file-index-test"));
        const ref = projectWorkspaceRef("novel-a");
        const workspace = resolvedProjectWorkspace(
            ref,
            absoluteFsPath(path.join(workspaceRoot, ref.projectRoot)),
            createProjectWorkspaceKey(workspaceRoot, ref),
        );
        let releaseBuild: () => void = () => {};
        const buildGate = new Promise<void>((resolve) => {
            releaseBuild = resolve;
        });
        const build = vi.fn(async () => {
            await buildGate;
            return {nodes: [], issues: []};
        });
        const openWatcher = vi.fn(() => ({close: vi.fn()}));
        const adapter = new ProjectFileIndexAdapter({build, openWatcher});

        const handle = adapter.startProject({
            workspace,
            signal: new AbortController().signal,
            onRawEvents: vi.fn(),
        });

        await expect(handle.ready).resolves.toBeUndefined();
        expect(openWatcher).toHaveBeenCalledTimes(1);
        expect(build).toHaveBeenCalledTimes(1);
        releaseBuild();
        await expect(handle.read()).resolves.toMatchObject({nodes: [], issues: [], revision: 1});
        await handle.close();
    });

    it("Project mutation 与当前 generation build 串行，完成后 read 自动重建", async () => {
        const workspaceRoot = absoluteFsPath(testHostPath("project-file-index-mutation-test"));
        const ref = projectWorkspaceRef("novel-a");
        const workspace = resolvedProjectWorkspace(
            ref,
            absoluteFsPath(path.join(workspaceRoot, ref.projectRoot)),
            createProjectWorkspaceKey(workspaceRoot, ref),
        );
        let releaseBuild: () => void = () => undefined;
        const firstBuild = new Promise<void>((resolve) => {
            releaseBuild = resolve;
        });
        let buildCount = 0;
        const adapter = new ProjectFileIndexAdapter({
            build: async () => {
                buildCount += 1;
                if (buildCount === 1) {
                    await firstBuild;
                }
                return {nodes: [], issues: []};
            },
            openWatcher: () => ({close: () => undefined}),
        });
        const handle = adapter.startProject({
            workspace,
            signal: new AbortController().signal,
            onRawEvents: () => undefined,
        });
        await handle.ready;
        await vi.waitFor(() => expect(buildCount).toBe(1));
        let mutationStarted = false;

        const mutation = handle.mutate(async () => {
            mutationStarted = true;
            return "mutated";
        });
        await Promise.resolve();
        expect(mutationStarted).toBe(false);
        releaseBuild();

        await expect(mutation).resolves.toBe("mutated");
        await expect(handle.read()).resolves.toMatchObject({revision: 2});
        expect(buildCount).toBe(2);
        await handle.close();
    });

    it("watcher raw batch 在完整树重建前交给当前 generation 的 History seam", async () => {
        const workspaceRoot = absoluteFsPath(testHostPath("project-file-index-raw-test"));
        const ref = projectWorkspaceRef("novel-a");
        const workspace = resolvedProjectWorkspace(
            ref,
            absoluteFsPath(path.join(workspaceRoot, ref.projectRoot)),
            createProjectWorkspaceKey(workspaceRoot, ref),
        );
        const order: string[] = [];
        const rawBatches: Array<{events: readonly {kind: string; path: string}[]; droppedEventCount: number}> = [];
        const adapter = new ProjectFileIndexAdapter({
            build: async () => {
                order.push("build");
                return {nodes: [], issues: []};
            },
            openWatcher: ({onEvent}) => {
                onEvent({kind: "add", path: "manuscript/001.md"});
                return {close: vi.fn()};
            },
        });
        const handle = adapter.startProject({
            workspace,
            signal: new AbortController().signal,
            onRawEvents: (batch) => {
                order.push("raw");
                rawBatches.push(batch);
            },
        });

        await handle.ready;
        await handle.read();

        expect(order.slice(0, 2)).toEqual(["raw", "build"]);
        expect(rawBatches).toEqual([{
            events: [{kind: "add", path: "manuscript/001.md"}],
            droppedEventCount: 0,
        }]);
        await handle.close();
    });
});

describe("ProjectFileIndexAdapter plain Workspace", () => {
    it("host订阅不等待watcher ready，ready失败会释放当前consumer", async () => {
        const root = absoluteFsPath(testHostPath("plain-file-index-opening-subscribe-test"));
        const target = {kind: "workspace-root" as const, root};
        const unsubscribe = vi.fn();
        let rejectReady: (error: Error) => void = () => undefined;
        const ready = new Promise<void>((_resolve, reject) => {
            rejectReady = reject;
        });
        const subscribeSpy = vi.spyOn(projectFileIndexAdapter, "subscribePlain").mockReturnValue(unsubscribe);
        const readySpy = vi.spyOn(projectFileIndexAdapter, "waitPlainReady").mockReturnValue(ready);

        try {
            await expect(subscribeWorkspaceTreeIndex({target}, () => undefined)).resolves.toBe(unsubscribe);
            expect(unsubscribe).not.toHaveBeenCalled();

            rejectReady(new Error("watcher opening failed"));
            await vi.waitFor(() => {
                expect(unsubscribe).toHaveBeenCalledTimes(1);
            });
        } finally {
            subscribeSpy.mockRestore();
            readySpy.mockRestore();
        }
    });

    it("one-shot read 构建 snapshot 但不隐式打开 watcher", async () => {
        const root = absoluteFsPath(testHostPath("plain-file-index-test"));
        const build = vi.fn(async () => ({nodes: [], issues: []}));
        const openWatcher = vi.fn(() => ({close: vi.fn()}));
        const adapter = new ProjectFileIndexAdapter({build, openWatcher});

        await expect(adapter.readPlain({kind: "workspace-root", root})).resolves.toMatchObject({
            nodes: [],
            issues: [],
            revision: 1,
        });

        expect(build).toHaveBeenCalledTimes(1);
        expect(openWatcher).not.toHaveBeenCalled();
    });

    it("SSE 订阅引用计数持有同一 activation，最后一个消费者释放 watcher", async () => {
        const root = absoluteFsPath(testHostPath("plain-file-index-subscribe-test"));
        const closeWatcher = vi.fn(async () => {});
        const build = vi.fn(async () => ({nodes: [], issues: []}));
        const openWatcher = vi.fn(() => ({close: closeWatcher}));
        const adapter = new ProjectFileIndexAdapter({build, openWatcher});
        const target = {kind: "workspace-root" as const, root};
        const firstEvents: string[] = [];
        const secondEvents: string[] = [];

        const unsubscribeFirst = adapter.subscribePlain(target, (event) => {
            firstEvents.push(event.type);
        });
        const unsubscribeSecond = adapter.subscribePlain(target, (event) => {
            secondEvents.push(event.type);
        });

        await vi.waitFor(() => {
            expect(firstEvents).toContain("workspace_watch_ready");
            expect(secondEvents).toContain("workspace_watch_ready");
        });
        expect(openWatcher).toHaveBeenCalledTimes(1);
        expect(build).not.toHaveBeenCalled();

        unsubscribeFirst();
        await Promise.resolve();
        expect(closeWatcher).not.toHaveBeenCalled();
        unsubscribeSecond();
        await vi.waitFor(() => {
            expect(closeWatcher).toHaveBeenCalledTimes(1);
        });
    });

    it("watcher close 失败后保留精确 activation，显式 close 可重试同一 handle", async () => {
        const root = absoluteFsPath(testHostPath("plain-file-index-close-retry-test"));
        const closeWatcher = vi.fn()
            .mockRejectedValueOnce(new Error("close failed"))
            .mockResolvedValueOnce(undefined);
        const adapter = new ProjectFileIndexAdapter({
            build: async () => ({nodes: [], issues: []}),
            openWatcher: () => ({close: closeWatcher}),
        });
        const target = {kind: "workspace-root" as const, root};
        const events: string[] = [];

        const unsubscribe = adapter.subscribePlain(target, (event) => {
            events.push(event.type);
        });
        await vi.waitFor(() => {
            expect(events).toContain("workspace_watch_ready");
        });
        unsubscribe();
        await vi.waitFor(() => {
            expect(closeWatcher).toHaveBeenCalledTimes(1);
        });
        await Promise.resolve();

        await expect(adapter.closePlain(target)).resolves.toBeUndefined();
        expect(closeWatcher).toHaveBeenCalledTimes(2);
    });

    it("plain mutation 会等待关闭窗口，并在 watcher close 失败后重试精确 handle", async () => {
        const root = absoluteFsPath(testHostPath("plain-file-index-mutation-close-test"));
        const closeWatcher = vi.fn()
            .mockRejectedValueOnce(new Error("close failed"))
            .mockResolvedValueOnce(undefined);
        const adapter = new ProjectFileIndexAdapter({
            build: async () => ({nodes: [], issues: []}),
            openWatcher: () => ({close: closeWatcher}),
        });
        const target = {kind: "workspace-root" as const, root};
        const events: string[] = [];
        const unsubscribe = adapter.subscribePlain(target, (event) => {
            events.push(event.type);
        });
        await vi.waitFor(() => {
            expect(events).toContain("workspace_watch_ready");
        });
        unsubscribe();
        await vi.waitFor(() => {
            expect(closeWatcher).toHaveBeenCalledTimes(1);
        });
        await Promise.resolve();
        const operation = vi.fn(async () => "mutated");

        await expect(adapter.mutatePlain(target, operation)).resolves.toBe("mutated");

        expect(closeWatcher).toHaveBeenCalledTimes(2);
        expect(operation).toHaveBeenCalledOnce();
        await adapter.closePlain(target);
    });

    it("plain mutation callback 自己抛 SnapshotClosedError 时不会重放副作用", async () => {
        const adapter = new ProjectFileIndexAdapter({
            build: async () => ({nodes: [], issues: []}),
            openWatcher: () => ({close: () => undefined}),
        });
        const target = {
            kind: "workspace-root" as const,
            root: absoluteFsPath(testHostPath("plain-file-index-no-replay-test")),
        };
        const operation = vi.fn(async () => {
            throw new SnapshotClosedError("operation failed");
        });

        await expect(adapter.mutatePlain(target, operation)).rejects.toThrow("operation failed");

        expect(operation).toHaveBeenCalledOnce();
        await adapter.closePlain(target);
    });
});

describe("isIgnoredWorkspaceWatchPath", () => {
    it("忽略 .git/.nbook/.agent 段（任意深度、含反斜杠路径）", () => {
        expect(isIgnoredWorkspaceWatchPath(".git/HEAD")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath(".nbook/project.sqlite")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath(".nbook/history.sqlite-wal")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath(".agent/plan/draft.md")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath("sub\\.nbook\\config.json")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath("world-engine/.runtime-artifact-import-cache/world-engine-calendar/a.mjs")).toBe(true);
        expect(isIgnoredWorkspaceWatchPath("world-engine/.world-engine-calendar-0123456789abcdef.mjs")).toBe(true);
    });

    it("不误伤普通内容路径与形似名称", () => {
        expect(isIgnoredWorkspaceWatchPath("manuscript/001-chapter/index.md")).toBe(false);
        expect(isIgnoredWorkspaceWatchPath("lorebook/nbook-guide.md")).toBe(false);
        expect(isIgnoredWorkspaceWatchPath("notes/.nbook-backup.md")).toBe(false);
        expect(isIgnoredWorkspaceWatchPath("agents/leader.default/persona.md")).toBe(false);
    });
});
