import {execFile} from "node:child_process";
import {access, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {promisify} from "node:util";
import {lock as acquireFileLock} from "proper-lockfile";
import {afterEach, describe, expect, expectTypeOf, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    ProjectLifecycle,
    isProjectLifecycleTempName,
    projectWorkspaceRef,
    type ProjectImportMaterializeInput,
    type ProjectManifestAdapter,
    type ProjectLifecycleWatchEvent,
    type ProjectLifecycleWatcherAdapter,
    type ProjectTemplateAdapter,
    type ProjectTemplateMaterializeInput,
    type ProjectWorkspaceKey,
} from "nbook/server/workspace-files/project-lifecycle";
import {
    ProjectLockModule,
    ProjectLockReleaseFailedError,
    type ProjectLockAdapter,
} from "nbook/server/workspace-files/project-lock";

vi.mock("chokidar", () => ({
    watch: () => {
        const watcher = {
            on: () => watcher,
            once: (eventName: string, listener: () => void) => {
                if (eventName === "ready") {
                    queueMicrotask(listener);
                }
                return watcher;
            },
            close: async () => undefined,
        };
        return watcher;
    },
}));

type PersistedJson = null | boolean | number | string | PersistedJson[] | {[key: string]: PersistedJson};

const roots: string[] = [];
const execFileAsync = promisify(execFile);

/** 为纯TTL测试隔离真实文件系统事件，只保留可正常关闭的已ready watcher。 */
function inertProjectLifecycleWatcher(): ProjectLifecycleWatcherAdapter {
    return {
        open: () => ({
            ready: Promise.resolve(),
            close: async () => undefined,
        }),
    };
}

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("ProjectLifecycle", () => {
    it("ProjectWorkspaceKey 在类型层不能进入 JSON 持久化边界", () => {
        expectTypeOf<ProjectWorkspaceKey>().not.toMatchTypeOf<PersistedJson>();
    });

    it("ProjectLifecycle不公开通用resolve接口", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));

        try {
            expect(lifecycle).not.toHaveProperty("resolve");
        } finally {
            await lifecycle.close();
        }
    });

    it("同一 Project locator 的 key 跨 Lifecycle 实例稳定且不泄漏裸路径", async () => {
        const firstWorkspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-key-"));
        const secondWorkspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-key-"));
        roots.push(firstWorkspaceRoot, secondWorkspaceRoot);
        await Promise.all([
            mkdir(path.join(firstWorkspaceRoot, "alpha")),
            mkdir(path.join(secondWorkspaceRoot, "alpha")),
        ]);
        const firstGeneration = new ProjectLifecycle(absoluteFsPath(firstWorkspaceRoot));
        const secondGeneration = new ProjectLifecycle(absoluteFsPath(firstWorkspaceRoot));
        const otherWorkspace = new ProjectLifecycle(absoluteFsPath(secondWorkspaceRoot));

        try {
            const firstOpen = await firstGeneration.prepareOpen(projectWorkspaceRef("alpha"));
            const first = firstOpen.workspace;
            await firstOpen.occupancy.release();
            const secondOpen = await secondGeneration.prepareOpen(projectWorkspaceRef("alpha"));
            const second = secondOpen.workspace;
            await secondOpen.occupancy.release();
            const otherOpen = await otherWorkspace.prepareOpen(projectWorkspaceRef("alpha"));
            const other = otherOpen.workspace;
            await otherOpen.occupancy.release();

            expect(second.key).toBe(first.key);
            expect(other.key).not.toBe(first.key);
            const registryKey = Symbol.keyFor(first.key);
            expect(registryKey).toMatch(/^nbook\.project-workspace\.v1:[0-9a-f]{64}$/u);
            expect(registryKey).not.toContain(firstWorkspaceRoot.toLocaleLowerCase("en-US"));
        } finally {
            await Promise.all([
                firstGeneration.close(),
                secondGeneration.close(),
                otherWorkspace.close(),
            ]);
        }
    });

    it("从同一次浅扫描发布合法 Project 与候选目录，并在 ensure 后同步发布新 revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);

        const alphaRoot = path.join(workspaceRoot, "alpha");
        const draftRoot = path.join(workspaceRoot, "draft");
        const brokenRoot = path.join(workspaceRoot, "broken");
        const aliasTarget = path.join(workspaceRoot, "alias-target");
        await Promise.all([
            mkdir(alphaRoot),
            mkdir(draftRoot),
            mkdir(brokenRoot),
            mkdir(aliasTarget),
            mkdir(path.join(workspaceRoot, ".nbook")),
        ]);
        await writeFile(path.join(alphaRoot, "project.yaml"), "kind: novel\ntitle: Alpha\nsummary: 第一部\n", "utf8");
        const brokenManifest = "kind: [novel\ntitle: Broken\n";
        await writeFile(path.join(brokenRoot, "project.yaml"), brokenManifest, "utf8");
        await writeFile(path.join(workspaceRoot, "ordinary.txt"), "不是目录", "utf8");
        await symlink(aliasTarget, path.join(workspaceRoot, "alias"), process.platform === "win32" ? "junction" : "dir");

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const projects = await lifecycle.readProjects();
            const candidates = await lifecycle.readCandidates();

            expect(projects.revision).toBe(candidates.revision);
            expect(projects.projects).toEqual([
                {
                    projectRoot: "alpha",
                    kind: "novel",
                    title: "Alpha",
                    summary: "第一部",
                    manifestUpdatedAt: expect.any(String),
                },
            ]);
            expect(candidates.candidates).toEqual([
                {projectRoot: "alias-target"},
                {projectRoot: "broken"},
                {projectRoot: "draft"},
            ]);
            expect(await readFile(path.join(brokenRoot, "project.yaml"), "utf8")).toBe(brokenManifest);

            await lifecycle.ensure(projectWorkspaceRef("draft"));

            const nextProjects = await lifecycle.readProjects();
            const nextCandidates = await lifecycle.readCandidates();
            expect(nextProjects.revision).toBeGreaterThan(projects.revision);
            expect(nextProjects.revision).toBe(nextCandidates.revision);
            expect(nextProjects.projects.map((project) => project.projectRoot).sort()).toEqual(["alpha", "draft"]);
            expect(nextCandidates.candidates).toEqual([
                {projectRoot: "alias-target"},
                {projectRoot: "broken"},
            ]);
            await expect(access(path.join(draftRoot, ".nbook", "project.sqlite"))).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await lifecycle.close();
        }
    });

    it("snapshot TTL从成功发布时间计算且普通读取不续期", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let now = 10_000;
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            snapshotTtlMs: 5_000,
            now: () => now,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const initial = await lifecycle.readProjects();
            expect(initial.projects).toEqual([]);

            const externalRoot = path.join(workspaceRoot, "external-after-cache");
            await mkdir(externalRoot);
            await writeFile(
                path.join(externalRoot, "project.yaml"),
                "kind: novel\ntitle: External After Cache\nsummary: \"\"\n",
                "utf8",
            );

            now = 14_000;
            const cached = await lifecycle.readProjects();
            expect(cached).toEqual(initial);

            now = 15_000;
            const refreshed = await lifecycle.readProjects();
            expect(refreshed.revision).toBeGreaterThan(initial.revision);
            expect(refreshed.projects).toMatchObject([{
                projectRoot: "external-after-cache",
                title: "External After Cache",
            }]);
        } finally {
            await lifecycle.close();
        }
    });

    it("snapshot TTL到期后的并发Project与candidate读取共享同一次浅扫描", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "ttl-shared-refresh");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: TTL Shared Refresh\nsummary: \"\"\n",
            "utf8",
        );
        let now = 0;
        let manifestReadCount = 0;
        let blockRefresh = false;
        let announceRefreshStarted: (() => void) | null = null;
        const refreshStarted = new Promise<void>((resolve) => {
            announceRefreshStarted = resolve;
        });
        let releaseRefresh: (() => void) | null = null;
        const refreshGate = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
        });
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (path.basename(filePath) === "project.yaml") {
                    manifestReadCount += 1;
                    if (blockRefresh) {
                        announceRefreshStarted?.();
                        await refreshGate;
                    }
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            now: () => now,
            snapshotTtlMs: 5_000,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const initial = await lifecycle.readProjects();
            expect(manifestReadCount).toBe(1);

            now = 5_000;
            blockRefresh = true;
            const projectsPromise = lifecycle.readProjects();
            await refreshStarted;
            const candidatesPromise = lifecycle.readCandidates();
            releaseRefresh?.();

            const [projects, candidates] = await Promise.all([projectsPromise, candidatesPromise]);
            expect(projects.revision).toBeGreaterThan(initial.revision);
            expect(candidates.revision).toBe(projects.revision);
            expect(manifestReadCount).toBe(2);
        } finally {
            releaseRefresh?.();
            await lifecycle.close();
        }
    });

    it("唯一浅watcher收到一级目录事件后防抖执行完整重扫", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let emitEvent: ((event: ProjectLifecycleWatchEvent) => void) | null = null;
        let watcherOpenCount = 0;
        let watcherCloseCount = 0;
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: (input) => {
                watcherOpenCount += 1;
                emitEvent = input.onEvent;
                return {
                    ready: Promise.resolve(),
                    close: async () => {
                        watcherCloseCount += 1;
                    },
                };
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watchDebounceMs: 5,
            watcherAdapter,
        });

        try {
            const initial = await lifecycle.readProjects();
            await lifecycle.readCandidates();
            expect(watcherOpenCount).toBe(1);
            expect(emitEvent).not.toBeNull();

            const externalRoot = path.join(workspaceRoot, "watcher-created");
            await mkdir(externalRoot);
            await writeFile(
                path.join(externalRoot, "project.yaml"),
                "kind: novel\ntitle: Watcher Created\nsummary: \"\"\n",
                "utf8",
            );
            emitEvent?.({kind: "addDir", path: externalRoot});

            await vi.waitFor(() => {
                expect(lifecycle.diagnostics.revision).toBeGreaterThan(initial.revision);
            });
            expect((await lifecycle.readProjects()).projects).toMatchObject([{
                projectRoot: "watcher-created",
                title: "Watcher Created",
            }]);
        } finally {
            await lifecycle.close();
            expect(watcherCloseCount).toBe(1);
        }
    });

    it("watcher失败时TTL前保留cache且每个TTL窗口最多重试一次", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let now = 0;
        let watcherOpenCount = 0;
        let watcherCloseCount = 0;
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: () => {
                watcherOpenCount += 1;
                return {
                    ready: Promise.reject(new Error(`injected watcher failure ${String(watcherOpenCount)}`)),
                    close: async () => {
                        watcherCloseCount += 1;
                    },
                };
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            now: () => now,
            snapshotTtlMs: 5_000,
            watcherAdapter,
        });

        try {
            const initial = await lifecycle.readProjects();
            await Promise.resolve();
            expect(watcherOpenCount).toBe(1);

            const externalRoot = path.join(workspaceRoot, "ttl-watcher-fallback");
            await mkdir(externalRoot);
            await writeFile(
                path.join(externalRoot, "project.yaml"),
                "kind: novel\ntitle: TTL Watcher Fallback\nsummary: \"\"\n",
                "utf8",
            );

            now = 4_999;
            expect(await lifecycle.readProjects()).toEqual(initial);
            expect(watcherOpenCount).toBe(1);

            now = 5_000;
            const refreshed = await lifecycle.readProjects();
            await Promise.resolve();
            expect(refreshed.revision).toBeGreaterThan(initial.revision);
            expect(refreshed.projects).toMatchObject([{
                projectRoot: "ttl-watcher-fallback",
                title: "TTL Watcher Fallback",
            }]);
            expect(watcherOpenCount).toBe(2);

            await lifecycle.readCandidates();
            expect(watcherOpenCount).toBe(2);
            expect(watcherCloseCount).toBe(2);
        } finally {
            await lifecycle.close();
        }
    });

    it("watcher运行时失败且close拒绝时保留句柄并禁止启动replacement", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let now = 0;
        let watcherOpenCount = 0;
        let watcherCloseCount = 0;
        let emitWatcherError: ((error: unknown) => void) | null = null;
        let emitWatcherEvent: ((event: ProjectLifecycleWatchEvent) => void) | null = null;
        let notifyCloseAttempted: () => void = () => undefined;
        const closeAttempted = new Promise<void>((resolve) => {
            notifyCloseAttempted = resolve;
        });
        const runtimeFailure = Object.assign(new Error("测试注入的watcher运行时失败"), {code: "EIO"});
        const closeFailure = Object.assign(new Error("测试注入的watcher close失败"), {code: "EBUSY"});
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: (input) => {
                watcherOpenCount += 1;
                emitWatcherError = input.onError;
                emitWatcherEvent = input.onEvent;
                return {
                    ready: Promise.resolve(),
                    close: async () => {
                        watcherCloseCount += 1;
                        notifyCloseAttempted();
                        throw closeFailure;
                    },
                };
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            now: () => now,
            snapshotTtlMs: 5_000,
            watchDebounceMs: 5,
            watcherAdapter,
        });

        try {
            const initial = await lifecycle.readProjects();
            await Promise.resolve();
            expect(watcherOpenCount).toBe(1);

            emitWatcherError?.(runtimeFailure);
            await closeAttempted;
            await Promise.resolve();
            expect(lifecycle.diagnostics.watcher).toMatchObject({
                state: "failed",
                error: {
                    code: "EBUSY",
                    message: closeFailure.message,
                },
            });

            const externalRoot = path.join(workspaceRoot, "failed-watcher-event");
            await mkdir(externalRoot);
            await writeFile(
                path.join(externalRoot, "project.yaml"),
                'kind: novel\ntitle: Failed Watcher Event\nsummary: ""\n',
                "utf8",
            );
            emitWatcherEvent?.({kind: "addDir", path: externalRoot});
            const beforeTtl = await lifecycle.readProjects();
            expect(beforeTtl).toEqual(initial);
            expect(lifecycle.diagnostics.revision).toBe(initial.revision);

            now = 5_000;
            const refreshed = await lifecycle.readProjects();
            expect(refreshed.revision).toBeGreaterThan(initial.revision);
            expect(refreshed.projects).toMatchObject([{
                projectRoot: "failed-watcher-event",
                title: "Failed Watcher Event",
            }]);
            expect(watcherOpenCount).toBe(1);
            expect(watcherCloseCount).toBe(1);

            const firstClose = lifecycle.close();
            const secondClose = lifecycle.close();
            expect(secondClose).toBe(firstClose);
            const lifecycleCloseFailure = await firstClose.catch((error: unknown) => error);
            const repeatedCloseFailure = await secondClose.catch((error: unknown) => error);
            expect(lifecycleCloseFailure).toBe(closeFailure);
            expect(repeatedCloseFailure).toBe(closeFailure);
            expect(watcherCloseCount).toBe(1);
            expect(lifecycle.diagnostics.watcher).toMatchObject({
                state: "failed",
                error: {
                    code: "EBUSY",
                    message: closeFailure.message,
                },
            });
        } finally {
            await lifecycle.close().catch(() => undefined);
        }
    });

    it("diagnostics同步投影cache时效、刷新元数据与watcher状态", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let now = 100;
        let resolveReady: (() => void) | null = null;
        const watcherReady = new Promise<void>((resolve) => {
            resolveReady = resolve;
        });
        let reportWatcherError: ((error: unknown) => void) | null = null;
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: (input) => {
                reportWatcherError = input.onError;
                return {
                    ready: watcherReady,
                    close: async () => undefined,
                };
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            now: () => now,
            snapshotTtlMs: 5_000,
            watcherAdapter,
        });

        expect(lifecycle.diagnostics).toMatchObject({
            revision: 0,
            cache: {
                state: "empty",
                publishedAt: null,
                lastRefreshReason: null,
                lastRefreshAt: null,
                lastRefreshError: null,
            },
            watcher: {
                state: "idle",
                lastAttemptAt: null,
                error: null,
            },
        });

        try {
            const snapshot = await lifecycle.readProjects();
            expect(lifecycle.diagnostics).toMatchObject({
                revision: snapshot.revision,
                cache: {
                    state: "fresh",
                    publishedAt: 100,
                    lastRefreshReason: "initial-read",
                    lastRefreshAt: 100,
                    lastRefreshError: null,
                },
                watcher: {
                    state: "starting",
                    lastAttemptAt: 100,
                    error: null,
                },
            });

            now = 5_100;
            expect(lifecycle.diagnostics.cache.state).toBe("expired");

            resolveReady?.();
            await vi.waitFor(() => {
                expect(lifecycle.diagnostics.watcher.state).toBe("ready");
            });

            reportWatcherError?.(Object.assign(new Error("injected runtime watcher failure"), {code: "EIO"}));
            await vi.waitFor(() => {
                expect(lifecycle.diagnostics.watcher).toEqual({
                    state: "failed",
                    lastAttemptAt: 100,
                    error: {
                        code: "EIO",
                        message: "injected runtime watcher failure",
                    },
                });
            });
            expect(Object.isFrozen(lifecycle.diagnostics.cache)).toBe(true);
            expect(Object.isFrozen(lifecycle.diagnostics.watcher)).toBe(true);
        } finally {
            await lifecycle.close();
            expect(lifecycle.diagnostics.watcher.state).toBe("closed");
        }
    });

    it("TTL刷新失败时保留旧revision并记录typed refresh error", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "ttl-refresh-error");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: TTL Refresh Error\nsummary: \"\"\n",
            "utf8",
        );
        let now = 0;
        let failRootInspection = false;
        const inspectionFailure = Object.assign(new Error("injected TTL root inspection failure"), {code: "EACCES"});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            now: () => now,
            rootIdentityOptions: {
                reparseDetector: async () => {
                    if (failRootInspection) {
                        throw inspectionFailure;
                    }
                    return false;
                },
            },
            snapshotTtlMs: 5_000,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const initial = await lifecycle.readProjects();
            now = 5_000;
            failRootInspection = true;

            await expect(lifecycle.readProjects()).rejects.toMatchObject({
                code: "PROJECT_ROOT_IO",
                cause: inspectionFailure,
            });
            expect(lifecycle.diagnostics).toMatchObject({
                revision: initial.revision,
                cache: {
                    state: "expired",
                    publishedAt: 0,
                    lastRefreshReason: "ttl",
                    lastRefreshAt: 5_000,
                    lastRefreshError: {
                        code: "PROJECT_ROOT_IO",
                        message: "无法读取Project Workspace root平台属性",
                    },
                },
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("readProjects发布snapshot后mutation release失败时保留fresh cache与terminal diagnostics", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const releaseFailure = Object.assign(new Error("测试注入的snapshot mutation release失败"), {code: "EIO"});
        let adapterReleaseCalls = 0;
        let handleReleaseCalls = 0;
        let firstTypedReleaseFailure: unknown = null;
        const lockAdapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                return async () => {
                    adapterReleaseCalls += 1;
                    await release();
                    throw releaseFailure;
                };
            },
        };
        class TrackingProjectLocks extends ProjectLockModule {
            override async acquireMutation() {
                const handle = await super.acquireMutation();
                return {
                    ...handle,
                    release: async () => {
                        handleReleaseCalls += 1;
                        try {
                            await handle.release();
                        } catch (error) {
                            firstTypedReleaseFailure ??= error;
                            throw error;
                        }
                    },
                };
            }
        }
        const lockModule = new TrackingProjectLocks(absoluteFsPath(workspaceRoot), {adapter: lockAdapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            lockModule,
            now: () => 100,
            snapshotTtlMs: 5_000,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const failure = await lifecycle.readProjects().catch((error: unknown) => error);

            expect(firstTypedReleaseFailure).toBeInstanceOf(ProjectLockReleaseFailedError);
            expect(failure).toBe(firstTypedReleaseFailure);
            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                kind: "workspace-mutation",
            });
            expect(handleReleaseCalls).toBe(1);
            expect(adapterReleaseCalls).toBe(1);
            expect(lifecycle.diagnostics).toMatchObject({
                revision: 1,
                cache: {
                    state: "fresh",
                    publishedAt: 100,
                    lastRefreshReason: "initial-read",
                    lastRefreshAt: 100,
                    lastRefreshError: {
                        code: "PROJECT_LOCK_RELEASE_FAILED",
                        message: (failure as Error).message,
                    },
                },
            });

            const cached = await lifecycle.readProjects();
            expect(cached.revision).toBe(1);
            expect(handleReleaseCalls).toBe(1);
            expect(lifecycle.diagnostics.cache.lastRefreshError).not.toBeNull();
        } finally {
            await lifecycle.close();
        }
    });

    it("readProjects取得mutation失败时记录initial refresh diagnostics", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const acquireFailure = Object.assign(new Error("测试注入的snapshot mutation acquire失败"), {code: "EIO"});
        class FailingProjectLocks extends ProjectLockModule {
            override async acquireMutation(): Promise<never> {
                throw acquireFailure;
            }
        }
        const lockModule = new FailingProjectLocks(absoluteFsPath(workspaceRoot));
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            lockModule,
            now: () => 100,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const failure = await lifecycle.readProjects().catch((error: unknown) => error);

            expect(failure).toBe(acquireFailure);
            expect(lifecycle.diagnostics).toMatchObject({
                revision: 0,
                cache: {
                    state: "empty",
                    publishedAt: null,
                    lastRefreshReason: "initial-read",
                    lastRefreshAt: 100,
                    lastRefreshError: {
                        code: "EIO",
                        message: acquireFailure.message,
                    },
                },
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("close清除watcher debounce并拒绝迟到ready与event发布revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let emitEvent: ((event: ProjectLifecycleWatchEvent) => void) | null = null;
        let resolveReady: (() => void) | null = null;
        const ready = new Promise<void>((resolve) => {
            resolveReady = resolve;
        });
        let watcherCloseCount = 0;
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: (input) => {
                emitEvent = input.onEvent;
                return {
                    ready,
                    close: async () => {
                        watcherCloseCount += 1;
                    },
                };
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watchDebounceMs: 30,
            watcherAdapter,
        });

        const initial = await lifecycle.readProjects();
        const externalRoot = path.join(workspaceRoot, "late-watcher-event");
        await mkdir(externalRoot);
        await writeFile(
            path.join(externalRoot, "project.yaml"),
            "kind: novel\ntitle: Late Watcher Event\nsummary: \"\"\n",
            "utf8",
        );
        emitEvent?.({kind: "addDir", path: externalRoot});

        await lifecycle.close();
        resolveReady?.();
        emitEvent?.({kind: "change", path: path.join(externalRoot, "project.yaml")});
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(watcherCloseCount).toBe(1);
        expect(lifecycle.diagnostics.revision).toBe(initial.revision);
        expect(lifecycle.diagnostics.watcher.state).toBe("closed");
        await expect(lifecycle.readProjects()).rejects.toMatchObject({
            code: "PROJECT_LIFECYCLE_CLOSED",
        });
    });

    it("浅watcher忽略正文与深层事件并把连续manifest事件合并为一次重扫", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let emitEvent: ((event: ProjectLifecycleWatchEvent) => void) | null = null;
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: (input) => {
                emitEvent = input.onEvent;
                return {
                    ready: Promise.resolve(),
                    close: async () => undefined,
                };
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            watchDebounceMs: 5,
            watcherAdapter,
        });

        try {
            const initial = await lifecycle.readProjects();
            const projectRoot = path.join(workspaceRoot, "watch-filter");
            await mkdir(path.join(projectRoot, "manuscript"), {recursive: true});
            await writeFile(
                path.join(projectRoot, "project.yaml"),
                "kind: novel\ntitle: Watch Filter\nsummary: \"\"\n",
                "utf8",
            );

            emitEvent?.({kind: "change", path: path.join(projectRoot, "chapter.md")});
            emitEvent?.({kind: "change", path: path.join(projectRoot, "manuscript", "chapter.md")});
            emitEvent?.({kind: "addDir", path: path.join(workspaceRoot, ".nbook")});
            await new Promise((resolve) => setTimeout(resolve, 15));
            expect((await lifecycle.readProjects()).revision).toBe(initial.revision);

            const manifestPath = path.join(projectRoot, "project.yaml");
            emitEvent?.({kind: "add", path: manifestPath});
            emitEvent?.({kind: "change", path: manifestPath});
            emitEvent?.({kind: "change", path: manifestPath});
            await vi.waitFor(() => {
                expect(lifecycle.diagnostics.revision).toBe(initial.revision + 1);
            });
            expect((await lifecycle.readProjects()).projects).toMatchObject([{
                projectRoot: "watch-filter",
                title: "Watch Filter",
            }]);
        } finally {
            await lifecycle.close();
        }
    });

    it("watcher事件发生在浅扫描期间时当前读取丢弃旧generation并重扫", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "watch-scan-race");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        await writeFile(
            manifestPath,
            "kind: novel\ntitle: Before Event\nsummary: \"\"\n",
            "utf8",
        );
        let emitEvent: ((event: ProjectLifecycleWatchEvent) => void) | null = null;
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: (input) => {
                emitEvent = input.onEvent;
                return {
                    ready: Promise.resolve(),
                    close: async () => undefined,
                };
            },
        };
        let now = 0;
        let blockNextRead = false;
        let blockedRead = false;
        let announceOldBytesRead: (() => void) | null = null;
        const oldBytesRead = new Promise<void>((resolve) => {
            announceOldBytesRead = resolve;
        });
        let releaseOldRead: (() => void) | null = null;
        const oldReadGate = new Promise<void>((resolve) => {
            releaseOldRead = resolve;
        });
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (path.basename(filePath) === "project.yaml" && blockNextRead && !blockedRead) {
                    blockedRead = true;
                    const oldBytes = await readFile(filePath);
                    announceOldBytesRead?.();
                    await oldReadGate;
                    return oldBytes;
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            now: () => now,
            snapshotTtlMs: 5_000,
            watchDebounceMs: 5,
            watcherAdapter,
        });

        try {
            const initial = await lifecycle.readProjects();
            expect(initial.projects[0]?.title).toBe("Before Event");

            now = 5_000;
            blockNextRead = true;
            const refreshPromise = lifecycle.readProjects();
            await oldBytesRead;
            await writeFile(
                manifestPath,
                "kind: novel\ntitle: After Event\nsummary: \"\"\n",
                "utf8",
            );
            emitEvent?.({kind: "change", path: manifestPath});
            releaseOldRead?.();

            const refreshed = await refreshPromise;
            expect(refreshed.revision).toBe(initial.revision + 1);
            expect(refreshed.projects[0]?.title).toBe("After Event");
        } finally {
            releaseOldRead?.();
            await lifecycle.close();
        }
    });

    it("ensure对缺失root使用私有staging发布最小Project并释放锁", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("created-by-ensure");
        let competingHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const before = await lifecycle.readProjects();
            const result = await lifecycle.ensure(ref);

            expect(result.change).toBe("created");
            expect(result.project).toMatchObject({
                projectRoot: "created-by-ensure",
                kind: "novel",
                title: "created-by-ensure",
                summary: "",
            });
            expect(await readFile(path.join(workspaceRoot, "created-by-ensure", "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: created-by-ensure\nsummary: ""\n');
            await expect(access(path.join(workspaceRoot, "created-by-ensure", ".nbook", "project.sqlite")))
                .rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect((await lifecycle.readProjects()).revision).toBeGreaterThan(before.revision);

            competingHandle = await competitor.acquireOccupancy(ref);
        } finally {
            await competingHandle?.release();
            await lifecycle.close();
        }
    });

    it("ensure最终发布preflight看到同名外部目录时转入静默修复且保留内容", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectName = "ensure-final-preflight";
        const projectRoot = path.join(workspaceRoot, projectName);
        const externalSentinel = path.join(projectRoot, "external.txt");
        let directoryReadCount = 0;
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            rootIdentityOptions: {
                readDirectoryNames: async () => {
                    directoryReadCount += 1;
                    if (directoryReadCount === 4) {
                        await mkdir(projectRoot);
                        await writeFile(externalSentinel, "external owner", "utf8");
                    }
                    return (await readdir(workspaceRoot, {withFileTypes: true}))
                        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
                        .map((entry) => entry.name);
                },
            },
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const result = await lifecycle.ensure(projectWorkspaceRef(projectName));

            expect(directoryReadCount).toBeGreaterThanOrEqual(4);
            expect(result).toMatchObject({
                change: "created",
                project: {projectRoot: projectName, title: projectName},
            });
            expect(await readFile(externalSentinel, "utf8")).toBe("external owner");
            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8"))
                .toBe(`kind: novel\ntitle: ${projectName}\nsummary: ""\n`);
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it("普通ensure结果不泄漏进程内workspace identity", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));

        try {
            const ensured = await lifecycle.ensure(projectWorkspaceRef("ensure-public-result"));

            expect(ensured).not.toHaveProperty("workspace");
            expect(ensured).not.toHaveProperty("root");
            expect(ensured).not.toHaveProperty("key");
            expect(JSON.stringify(ensured)).not.toContain(workspaceRoot);
        } finally {
            await lifecycle.close();
        }
    });

    it("ensure缺失root在snapshot失败时回滚root并保留旧revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "rollback-ensure");
        const scanFailure = Object.assign(new Error("injected snapshot read failure"), {code: "EIO"});
        let failPublishedManifestRead = true;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (
                    failPublishedManifestRead
                    && path.basename(path.dirname(filePath)).toLocaleLowerCase("en-US") === "rollback-ensure"
                ) {
                    failPublishedManifestRead = false;
                    throw scanFailure;
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("rollback-ensure");
        let competingHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.ensure(ref)).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "ensure",
                phase: "publish-snapshot",
                committed: false,
                cause: expect.objectContaining({
                    code: "PROJECT_MANIFEST_IO",
                    cause: scanFailure,
                }),
            });

            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
            competingHandle = await competitor.acquireOccupancy(ref);
        } finally {
            await competingHandle?.release();
            await lifecycle.close();
        }
    });

    it("ensure回滚前发现target已被外部替换时不移动replacement", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "rollback-owner-check");
        const movedPublishedRoot = path.join(workspaceRoot, "rollback-owner-check-moved");
        const externalMarker = path.join(projectRoot, "external-owner.txt");
        const scanFailure = Object.assign(new Error("injected failure after external replacement"), {code: "EIO"});
        let replaced = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (!replaced && path.basename(path.dirname(filePath)) === "rollback-owner-check") {
                    replaced = true;
                    await rename(projectRoot, movedPublishedRoot);
                    await mkdir(projectRoot);
                    await writeFile(externalMarker, "external replacement", "utf8");
                    throw scanFailure;
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("rollback-owner-check");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.ensure(ref)).rejects.toMatchObject({
                code: "PROJECT_ROLLBACK_FAILED",
                operation: "ensure",
                phase: "rollback",
                committed: "unknown",
                cause: expect.any(AggregateError),
            });

            expect(await readFile(externalMarker, "utf8")).toBe("external replacement");
            expect(await readFile(path.join(movedPublishedRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: rollback-owner-check\nsummary: ""\n');
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("staging rename返回前target被换入合法replacement时不得提交replacement", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "publish-return-replacement");
        const movedPublishedRoot = path.join(workspaceRoot, "publish-return-replacement-moved");
        let replaced = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                await rename(oldPath, newPath);
                if (!replaced && path.basename(newPath) === "publish-return-replacement") {
                    replaced = true;
                    await rename(newPath, movedPublishedRoot);
                    await mkdir(newPath);
                    await writeFile(
                        path.join(newPath, "project.yaml"),
                        'kind: novel\ntitle: External Replacement\nsummary: ""\n',
                        "utf8",
                    );
                }
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("publish-return-replacement");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.ensure(ref)).rejects.toMatchObject({
                code: "PROJECT_ROLLBACK_FAILED",
                operation: "ensure",
                phase: "rollback",
                committed: "unknown",
            });

            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: External Replacement\nsummary: ""\n');
            expect(await readFile(path.join(movedPublishedRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: publish-return-replacement\nsummary: ""\n');
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("staging rename物理成功但Promise失败时按physical token安全回滚", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "publish-rename-threw-after-move");
        const renameFailure = Object.assign(new Error("rename threw after physical move"), {code: "EIO"});
        let injected = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                await rename(oldPath, newPath);
                if (!injected && path.basename(newPath) === "publish-rename-threw-after-move") {
                    injected = true;
                    throw renameFailure;
                }
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("publish-rename-threw-after-move");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.ensure(ref)).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "ensure",
                phase: "publish-root",
                committed: false,
                cause: renameFailure,
            });
            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("未提交root的snapshot refresh与并发健康ensure串行", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "snapshot-publish-lane");
        const scanFailure = Object.assign(new Error("injected provisional snapshot failure"), {code: "EIO"});
        let notifyFirstScan: () => void = () => undefined;
        let releaseFirstScan: () => void = () => undefined;
        const firstScanEntered = new Promise<void>((resolve) => {
            notifyFirstScan = resolve;
        });
        const firstScanRelease = new Promise<void>((resolve) => {
            releaseFirstScan = resolve;
        });
        let projectManifestReads = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (path.basename(path.dirname(filePath)) === "snapshot-publish-lane") {
                    projectManifestReads += 1;
                    if (projectManifestReads === 1) {
                        notifyFirstScan();
                        await firstScanRelease;
                        throw scanFailure;
                    }
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("snapshot-publish-lane");
        const publishing = lifecycle.ensure(ref);
        await firstScanEntered;
        let concurrentCommittedBeforeRollback = false;
        const concurrentEnsure = lifecycle.ensure(ref);
        void concurrentEnsure.then(
            () => {
                concurrentCommittedBeforeRollback = true;
                releaseFirstScan();
            },
            () => undefined,
        );
        const fallback = setTimeout(releaseFirstScan, 250);

        try {
            await expect(publishing).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "ensure",
                phase: "publish-snapshot",
                committed: false,
            });
            await expect(concurrentEnsure).rejects.toMatchObject({code: "PROJECT_ROOT_REPLACED"});
            expect(concurrentCommittedBeforeRollback).toBe(false);
            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect((await lifecycle.readProjects()).projects).toEqual([]);
        } finally {
            clearTimeout(fallback);
            releaseFirstScan();
            await Promise.allSettled([publishing, concurrentEnsure]);
            await lifecycle.close();
        }
    });

    it("ensure已经发布snapshot并释放锁后遇到close仍返回已提交结果", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let lifecycle: ProjectLifecycle;
        class CloseAfterCommittedEnsureLocks extends ProjectLockModule {
            override async acquireMutation() {
                const handle = await super.acquireMutation();
                return {
                    ...handle,
                    release: async () => {
                        await handle.release();
                        queueMicrotask(() => {
                            queueMicrotask(() => {
                                queueMicrotask(() => {
                                    void lifecycle.close();
                                });
                            });
                        });
                    },
                };
            }
        }
        const lifecycleLocks = new CloseAfterCommittedEnsureLocks(absoluteFsPath(workspaceRoot));
        lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const ref = projectWorkspaceRef("ensure-committed-before-close");

        try {
            const result = await lifecycle.ensure(ref);

            expect(result).toMatchObject({
                revision: expect.any(Number),
                change: "created",
                project: {projectRoot: "ensure-committed-before-close"},
            });
            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: ensure-committed-before-close\nsummary: ""\n');
        } finally {
            await lifecycle.close();
        }
    });

    it("ensure提交后锁释放失败保留typed code并标记committed true", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const releaseFailure = Object.assign(new Error("injected ensure release failure"), {code: "EIO"});
        let mutationReleaseCalls = 0;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    mutationReleaseCalls += 1;
                    await release();
                    throw releaseFailure;
                };
            },
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const ref = projectWorkspaceRef("ensure-committed-release-failure");

        try {
            const failure = await lifecycle.ensure(ref).catch((error: unknown) => error);

            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                operation: "ensure",
                phase: "release",
                committed: true,
            });
            expect(failure).toBeInstanceOf(ProjectLockReleaseFailedError);
            expect(mutationReleaseCalls).toBe(1);
            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: ensure-committed-release-failure\nsummary: ""\n');
        } finally {
            await lifecycle.close();
        }
    });

    it("create只在私有staging物化模板并由Lifecycle写入manifest后发布", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const materialize = vi.fn(async (input: ProjectTemplateMaterializeInput) => {
            const {stagingRoot} = input;
            await mkdir(path.join(stagingRoot, "lorebook"), {recursive: true});
            await writeFile(path.join(stagingRoot, "lorebook", "index.md"), "# Template\n", "utf8");
        });
        const templateAdapter: ProjectTemplateAdapter = {materialize};
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {templateAdapter});
        const ref = projectWorkspaceRef("created-project");

        try {
            const result = await lifecycle.create({
                ref,
                title: "创建标题",
                summary: "创建摘要",
            });

            expect(materialize).toHaveBeenCalledTimes(1);
            const materializeInput = materialize.mock.calls[0]![0];
            const {stagingRoot} = materializeInput;
            expect(materializeInput.template).toBe("default");
            expect(materializeInput.signal).toBeInstanceOf(AbortSignal);
            expect(path.relative(workspaceRoot, stagingRoot).replaceAll(path.sep, "/"))
                .toMatch(/^\.nbook\/lifecycle\/staging\/v1-[0-9a-f-]+$/u);
            await expect(access(stagingRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect(await readFile(path.join(workspaceRoot, "created-project", "lorebook", "index.md"), "utf8"))
                .toBe("# Template\n");
            expect(await readFile(path.join(workspaceRoot, "created-project", "project.yaml"), "utf8"))
                .toBe("kind: novel\ntitle: 创建标题\nsummary: 创建摘要\n");
            await expect(access(path.join(workspaceRoot, "created-project", ".nbook", "project.sqlite")))
                .rejects.toMatchObject({code: "ENOENT"});
            expect(result).toMatchObject({
                project: {
                    projectRoot: "created-project",
                    title: "创建标题",
                    summary: "创建摘要",
                },
            });
            expect(result.revision).toBe((await lifecycle.readProjects()).revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("两个Lifecycle并发create同一locator时只线性化一个Project发布", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let stagedCount = 0;
        let notifyBothStaged: () => void = () => undefined;
        let releaseStaging: () => void = () => undefined;
        const bothStaged = new Promise<void>((resolve) => {
            notifyBothStaged = resolve;
        });
        const stagingReleased = new Promise<void>((resolve) => {
            releaseStaging = resolve;
        });
        const templateAdapter = (marker: string): ProjectTemplateAdapter => ({
            materialize: async ({stagingRoot}) => {
                await writeFile(path.join(stagingRoot, `${marker}.txt`), marker, "utf8");
                stagedCount += 1;
                if (stagedCount === 2) {
                    notifyBothStaged();
                }
                await stagingReleased;
            },
        });
        const firstLifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            templateAdapter: templateAdapter("first"),
        });
        const secondLifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            templateAdapter: templateAdapter("second"),
        });
        const ref = projectWorkspaceRef("concurrent-create");
        const firstCreate = firstLifecycle.create({ref, title: "First"}).then(
            (value) => ({status: "fulfilled" as const, value}),
            (reason: unknown) => ({status: "rejected" as const, reason}),
        );
        const secondCreate = secondLifecycle.create({ref, title: "Second"}).then(
            (value) => ({status: "fulfilled" as const, value}),
            (reason: unknown) => ({status: "rejected" as const, reason}),
        );
        const createResults = Promise.all([firstCreate, secondCreate]);

        try {
            await bothStaged;
            releaseStaging();
            const results = await createResults;
            const fulfilled = results.filter(
                (result): result is Extract<(typeof results)[number], {readonly status: "fulfilled"}> => (
                    result.status === "fulfilled"
                ),
            );
            const rejected = results.filter(
                (result): result is Extract<(typeof results)[number], {readonly status: "rejected"}> => (
                    result.status === "rejected"
                ),
            );

            expect(fulfilled).toHaveLength(1);
            expect(rejected).toHaveLength(1);
            expect(rejected[0]?.reason).toMatchObject({
                code: "PROJECT_EXISTS",
                operation: "create",
                phase: "publish-root",
                committed: false,
            });
            const winner = fulfilled[0]!.value;
            expect(winner.project.title === "First" || winner.project.title === "Second").toBe(true);
            expect(await readFile(
                path.join(workspaceRoot, ref.projectRoot, winner.project.title === "First" ? "first.txt" : "second.txt"),
                "utf8",
            )).toBe(winner.project.title.toLocaleLowerCase("en-US"));
            expect((await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging")))).toEqual([]);

            const inspector = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
                watcherAdapter: inertProjectLifecycleWatcher(),
            });
            try {
                expect((await inspector.readProjects()).projects).toEqual([winner.project]);
            } finally {
                await inspector.close();
            }
        } finally {
            releaseStaging();
            await createResults;
            await firstLifecycle.close();
            await secondLifecycle.close();
        }
    });

    it("create从公开Interface在snapshot失败时回滚已发布root", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "create-snapshot-rollback");
        const scanFailure = Object.assign(new Error("测试注入的create snapshot失败"), {code: "EIO"});
        let failPublishedManifestRead = true;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (
                    failPublishedManifestRead
                    && path.basename(path.dirname(filePath)) === "create-snapshot-rollback"
                ) {
                    failPublishedManifestRead = false;
                    throw scanFailure;
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            templateAdapter: {materialize: async () => undefined},
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.create({
                ref: projectWorkspaceRef("create-snapshot-rollback"),
                title: "Create Snapshot Rollback",
            })).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "create",
                phase: "publish-snapshot",
                committed: false,
                cause: expect.objectContaining({
                    code: "PROJECT_MANIFEST_IO",
                    cause: scanFailure,
                }),
            });

            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("create最终发布preflight看到同名外部目录时返回PROJECT_EXISTS且不覆盖", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectName = "create-final-preflight";
        const projectRoot = path.join(workspaceRoot, projectName);
        const externalSentinel = path.join(projectRoot, "external.txt");
        let directoryReadCount = 0;
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            rootIdentityOptions: {
                readDirectoryNames: async () => {
                    directoryReadCount += 1;
                    if (directoryReadCount === 2) {
                        await mkdir(projectRoot);
                        await writeFile(externalSentinel, "external owner", "utf8");
                    }
                    return (await readdir(workspaceRoot, {withFileTypes: true}))
                        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
                        .map((entry) => entry.name);
                },
            },
            templateAdapter: {
                materialize: async ({stagingRoot}) => {
                    await writeFile(path.join(stagingRoot, "template.txt"), "owned staging", "utf8");
                },
            },
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            await expect(lifecycle.create({
                ref: projectWorkspaceRef(projectName),
                title: "Create Final Preflight",
            })).rejects.toMatchObject({
                code: "PROJECT_EXISTS",
                operation: "create",
                phase: "publish-root",
                committed: false,
            });

            expect(directoryReadCount).toBe(2);
            expect(await readFile(externalSentinel, "utf8")).toBe("external owner");
            await expect(access(path.join(projectRoot, "template.txt"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(access(path.join(projectRoot, "project.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it("create最终发布preflight看到case variant时拒绝发布并保留外部目录", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectName = "Create-Final-Case";
        const externalName = "create-final-case";
        const projectRoot = path.join(workspaceRoot, projectName);
        const externalRoot = path.join(workspaceRoot, externalName);
        const externalSentinel = path.join(externalRoot, "external.txt");
        let directoryReadCount = 0;
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            rootIdentityOptions: {
                caseMode: "insensitive",
                readDirectoryNames: async () => {
                    directoryReadCount += 1;
                    if (directoryReadCount === 2) {
                        await mkdir(externalRoot);
                        await writeFile(externalSentinel, "external owner", "utf8");
                    }
                    return (await readdir(workspaceRoot, {withFileTypes: true}))
                        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
                        .map((entry) => entry.name);
                },
            },
            templateAdapter: {materialize: async () => undefined},
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            await expect(lifecycle.create({
                ref: projectWorkspaceRef(projectName),
                title: "Create Final Case",
            })).rejects.toMatchObject({
                code: "PROJECT_EXISTS",
                operation: "create",
                phase: "publish-root",
                committed: false,
            });

            expect(directoryReadCount).toBe(2);
            expect(await readFile(externalSentinel, "utf8")).toBe("external owner");
            expect(await readdir(workspaceRoot)).toContain(externalName);
            expect(await readdir(workspaceRoot)).not.toContain(projectName);
            await expect(access(path.join(externalRoot, "project.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it("create最终preflight后出现非空同名目录时发布失败且保留外部内容", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectName = "create-nonempty-publish-race";
        const projectRoot = path.join(workspaceRoot, projectName);
        const externalSentinel = path.join(projectRoot, "external.txt");
        let injected = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                if (!injected && newPath === projectRoot) {
                    injected = true;
                    await mkdir(projectRoot);
                    await writeFile(externalSentinel, "external owner", "utf8");
                }
                await rename(oldPath, newPath);
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            templateAdapter: {
                materialize: async ({stagingRoot}) => {
                    await writeFile(path.join(stagingRoot, "template.txt"), "owned staging", "utf8");
                },
            },
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            await expect(lifecycle.create({
                ref: projectWorkspaceRef(projectName),
                title: "Create Nonempty Publish Race",
            })).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "create",
                phase: "publish-root",
                committed: false,
            });

            expect(injected).toBe(true);
            expect(await readFile(externalSentinel, "utf8")).toBe("external owner");
            await expect(access(path.join(projectRoot, "template.txt"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(access(path.join(projectRoot, "project.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it.skipIf(process.platform === "win32")(
        "POSIX best-effort边界：最终preflight后出现空同名目录时portable rename可能替换它",
        async () => {
            const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
            roots.push(workspaceRoot);
            const projectName = "create-empty-publish-race";
            const projectRoot = path.join(workspaceRoot, projectName);
            let externalRootIdentity: {dev: bigint; ino: bigint} | null = null;
            const manifestAdapter: ProjectManifestAdapter = {
                access,
                mkdir,
                open,
                readFile,
                rename: async (oldPath, newPath) => {
                    if (!externalRootIdentity && newPath === projectRoot) {
                        await mkdir(projectRoot);
                        const externalRootStat = await stat(projectRoot, {bigint: true});
                        externalRootIdentity = {dev: externalRootStat.dev, ino: externalRootStat.ino};
                    }
                    await rename(oldPath, newPath);
                },
                rm,
            };
            const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
                manifestAdapter,
                templateAdapter: {
                    materialize: async ({stagingRoot}) => {
                        await writeFile(path.join(stagingRoot, "template.txt"), "owned staging", "utf8");
                    },
                },
                watcherAdapter: inertProjectLifecycleWatcher(),
            });

            try {
                const result = await lifecycle.create({
                    ref: projectWorkspaceRef(projectName),
                    title: "Create Empty Publish Race",
                });
                const publishedRootStat = await stat(projectRoot, {bigint: true});

                expect(externalRootIdentity).not.toBeNull();
                expect({dev: publishedRootStat.dev, ino: publishedRootStat.ino}).not.toEqual(externalRootIdentity);
                expect(await readFile(path.join(projectRoot, "template.txt"), "utf8")).toBe("owned staging");
                expect(result.project).toMatchObject({projectRoot: projectName, title: "Create Empty Publish Race"});
            } finally {
                await lifecycle.close();
            }
        },
    );

    it("create发布窗口出现case variant目录时回滚自己的target且保留外部目录", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        if (process.platform === "win32") {
            await execFileAsync(
                "fsutil",
                ["file", "setCaseSensitiveInfo", workspaceRoot, "enable"],
                {windowsHide: true},
            );
        }
        const projectName = "Create-Publish-Race";
        const externalName = "create-publish-race";
        const projectRoot = path.join(workspaceRoot, projectName);
        const externalRoot = path.join(workspaceRoot, externalName);
        const externalSentinel = path.join(externalRoot, "external.txt");
        let injected = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                if (!injected && newPath === projectRoot) {
                    injected = true;
                    await mkdir(externalRoot);
                    await writeFile(externalSentinel, "external owner", "utf8");
                }
                await rename(oldPath, newPath);
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            rootIdentityOptions: {caseMode: "insensitive"},
            templateAdapter: {
                materialize: async ({stagingRoot}) => {
                    await writeFile(path.join(stagingRoot, "template.txt"), "owned staging", "utf8");
                },
            },
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.create({
                ref: projectWorkspaceRef(projectName),
                title: "Create Publish Race",
            })).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "create",
                phase: "resolve-root",
                committed: false,
                cause: {
                    code: "PROJECT_ROOT_CASE_COLLISION",
                    projectRoots: [projectName, externalName],
                },
            });

            expect(injected).toBe(true);
            expect(await readdir(workspaceRoot)).toContain(externalName);
            expect(await readdir(workspaceRoot)).not.toContain(projectName);
            expect(await readFile(externalSentinel, "utf8")).toBe("external owner");
            await expect(access(path.join(externalRoot, "template.txt"))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect(await lifecycle.readProjects()).toEqual(before);
            expect(lifecycle.diagnostics.revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("importProject在私有staging物化内容并由Lifecycle发布源manifest", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const sourceManifest = Buffer.from([
            "# archive source",
            "custom:",
            "  origin: archive",
            "kind: novel",
            "title: 源标题",
            "summary: 源摘要",
            "",
        ].join("\n"), "utf8");
        const materialize = vi.fn(async (input: ProjectImportMaterializeInput) => {
            input.signal.throwIfAborted();
            await mkdir(path.join(input.stagingRoot, "manuscript"), {recursive: true});
            await writeFile(path.join(input.stagingRoot, "manuscript", "chapter.md"), "# Imported\n", "utf8");
            return {manifestBytes: sourceManifest};
        });
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("imported-project");

        try {
            const result = await lifecycle.importProject({
                ref,
                source: {materialize},
            });

            expect(materialize).toHaveBeenCalledTimes(1);
            const materializeInput = materialize.mock.calls[0]![0];
            expect(materializeInput.signal).toBeInstanceOf(AbortSignal);
            expect(path.relative(workspaceRoot, materializeInput.stagingRoot).replaceAll(path.sep, "/"))
                .toMatch(/^\.nbook\/lifecycle\/staging\/v1-[0-9a-f-]+$/u);
            await expect(access(materializeInput.stagingRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "manuscript", "chapter.md"), "utf8"))
                .toBe("# Imported\n");
            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "project.yaml")))
                .toEqual(sourceManifest);
            expect(result).toMatchObject({
                project: {
                    projectRoot: "imported-project",
                    title: "源标题",
                    summary: "源摘要",
                },
            });
            expect(result.revision).toBe((await lifecycle.readProjects()).revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("importProject从公开Interface在snapshot失败时回滚已发布root", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "import-snapshot-rollback");
        const scanFailure = Object.assign(new Error("测试注入的import snapshot失败"), {code: "EIO"});
        let failPublishedManifestRead = true;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (
                    failPublishedManifestRead
                    && path.basename(path.dirname(filePath)) === "import-snapshot-rollback"
                ) {
                    failPublishedManifestRead = false;
                    throw scanFailure;
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        const sourceManifest = Buffer.from(
            'kind: novel\ntitle: Import Snapshot Rollback\nsummary: ""\n',
            "utf8",
        );

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.importProject({
                ref: projectWorkspaceRef("import-snapshot-rollback"),
                source: {
                    materialize: async ({stagingRoot}) => {
                        await writeFile(path.join(stagingRoot, "imported.txt"), "imported", "utf8");
                        return {manifestBytes: sourceManifest};
                    },
                },
            })).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "import",
                phase: "publish-snapshot",
                committed: false,
                cause: expect.objectContaining({
                    code: "PROJECT_MANIFEST_IO",
                    cause: scanFailure,
                }),
            });

            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("importProject最终发布preflight看到同名外部目录时返回PROJECT_EXISTS且不合并", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectName = "import-final-preflight";
        const projectRoot = path.join(workspaceRoot, projectName);
        const externalSentinel = path.join(projectRoot, "external.txt");
        let directoryReadCount = 0;
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            rootIdentityOptions: {
                readDirectoryNames: async () => {
                    directoryReadCount += 1;
                    if (directoryReadCount === 2) {
                        await mkdir(projectRoot);
                        await writeFile(externalSentinel, "external owner", "utf8");
                    }
                    return (await readdir(workspaceRoot, {withFileTypes: true}))
                        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
                        .map((entry) => entry.name);
                },
            },
            watcherAdapter: inertProjectLifecycleWatcher(),
        });

        try {
            await expect(lifecycle.importProject({
                ref: projectWorkspaceRef(projectName),
                source: {
                    materialize: async ({stagingRoot}) => {
                        await writeFile(path.join(stagingRoot, "imported.txt"), "owned import", "utf8");
                        return {
                            manifestBytes: Buffer.from(
                                'kind: novel\ntitle: Import Final Preflight\nsummary: ""\n',
                                "utf8",
                            ),
                        };
                    },
                },
            })).rejects.toMatchObject({
                code: "PROJECT_EXISTS",
                operation: "import",
                phase: "publish-root",
                committed: false,
            });

            expect(directoryReadCount).toBe(2);
            expect(await readFile(externalSentinel, "utf8")).toBe("external owner");
            await expect(access(path.join(projectRoot, "imported.txt"))).rejects.toMatchObject({code: "ENOENT"});
            await expect(access(path.join(projectRoot, "project.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it("importProject发布窗口出现case variant目录时回滚自己的target且保留外部目录", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        if (process.platform === "win32") {
            await execFileAsync(
                "fsutil",
                ["file", "setCaseSensitiveInfo", workspaceRoot, "enable"],
                {windowsHide: true},
            );
        }
        const projectName = "Import-Publish-Race";
        const externalName = "import-publish-race";
        const projectRoot = path.join(workspaceRoot, projectName);
        const externalRoot = path.join(workspaceRoot, externalName);
        const externalSentinel = path.join(externalRoot, "external.txt");
        let injected = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                if (!injected && newPath === projectRoot) {
                    injected = true;
                    await mkdir(externalRoot);
                    await writeFile(externalSentinel, "external owner", "utf8");
                }
                await rename(oldPath, newPath);
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            rootIdentityOptions: {caseMode: "insensitive"},
            watcherAdapter: inertProjectLifecycleWatcher(),
        });
        const sourceManifest = Buffer.from(
            'kind: novel\ntitle: Import Publish Race\nsummary: ""\n',
            "utf8",
        );

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.importProject({
                ref: projectWorkspaceRef(projectName),
                source: {
                    materialize: async ({stagingRoot}) => {
                        await writeFile(path.join(stagingRoot, "imported.txt"), "owned staging", "utf8");
                        return {manifestBytes: sourceManifest};
                    },
                },
            })).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "import",
                phase: "resolve-root",
                committed: false,
                cause: {
                    code: "PROJECT_ROOT_CASE_COLLISION",
                    projectRoots: [projectName, externalName],
                },
            });

            expect(injected).toBe(true);
            expect(await readdir(workspaceRoot)).toContain(externalName);
            expect(await readdir(workspaceRoot)).not.toContain(projectName);
            expect(await readFile(externalSentinel, "utf8")).toBe("external owner");
            await expect(access(path.join(externalRoot, "imported.txt"))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect(await lifecycle.readProjects()).toEqual(before);
            expect(lifecycle.diagnostics.revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("importProject拒绝source直接写入project.yaml且不发布root或revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("import-source-owned-manifest");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.importProject({
                ref,
                source: {
                    materialize: async ({stagingRoot}) => {
                        await writeFile(
                            path.join(stagingRoot, "project.yaml"),
                            'kind: novel\ntitle: Source Owned\nsummary: ""\n',
                            "utf8",
                        );
                        return {};
                    },
                },
            })).rejects.toMatchObject({
                code: "PROJECT_IMPORT_FAILED",
                operation: "import",
                phase: "materialize",
                committed: false,
            });
            await expect(access(path.join(workspaceRoot, ref.projectRoot))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("importProject在source缺少manifest时静默创建最小manifest", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("import-without-manifest");

        try {
            const result = await lifecycle.importProject({
                ref,
                source: {
                    materialize: async ({stagingRoot}) => {
                        await mkdir(path.join(stagingRoot, "lorebook"));
                        await writeFile(path.join(stagingRoot, "lorebook", "index.md"), "# Imported\n", "utf8");
                        return {};
                    },
                },
            });

            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: import-without-manifest\nsummary: ""\n');
            expect(result).toMatchObject({
                project: {
                    projectRoot: "import-without-manifest",
                    title: "import-without-manifest",
                    summary: "",
                },
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("importProject静默恢复损坏manifest并把原始bytes随Project发布", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const corruptManifest = Buffer.from("broken: [\n", "utf8");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("import-corrupt-manifest");

        try {
            const result = await lifecycle.importProject({
                ref,
                source: {
                    materialize: async () => ({manifestBytes: corruptManifest}),
                },
            });

            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: import-corrupt-manifest\nsummary: ""\n');
            const recoveryRoot = path.join(workspaceRoot, ref.projectRoot, ".nbook", "recovery");
            const recoveryFiles = await readdir(recoveryRoot);
            expect(recoveryFiles).toHaveLength(1);
            expect(await readFile(path.join(recoveryRoot, recoveryFiles[0]!))).toEqual(corruptManifest);
            expect(result.project).toMatchObject({
                projectRoot: "import-corrupt-manifest",
                title: "import-corrupt-manifest",
                summary: "",
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("create拒绝模板携带project.yaml且不发布root或revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const templateAdapter: ProjectTemplateAdapter = {
            materialize: async ({stagingRoot}) => {
                await writeFile(
                    path.join(stagingRoot, "project.yaml"),
                    'kind: novel\ntitle: Template Owned\nsummary: ""\n',
                    "utf8",
                );
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {templateAdapter});
        const ref = projectWorkspaceRef("template-owned-manifest");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.create({ref, title: "Requested Title"})).rejects.toMatchObject({
                code: "PROJECT_TEMPLATE_FAILED",
                operation: "create",
                phase: "materialize",
                committed: false,
            });
            await expect(access(path.join(workspaceRoot, ref.projectRoot))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging"))).toEqual([]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("create已经发布snapshot并释放锁后遇到close仍返回已提交结果", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let lifecycle: ProjectLifecycle;
        class CloseAfterCommittedCreateLocks extends ProjectLockModule {
            override async acquireMutation() {
                const handle = await super.acquireMutation();
                return {
                    ...handle,
                    release: async () => {
                        await handle.release();
                        queueMicrotask(() => {
                            queueMicrotask(() => {
                                queueMicrotask(() => {
                                    void lifecycle.close();
                                });
                            });
                        });
                    },
                };
            }
        }
        const lifecycleLocks = new CloseAfterCommittedCreateLocks(absoluteFsPath(workspaceRoot));
        lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            lockModule: lifecycleLocks,
            templateAdapter: {materialize: async () => undefined},
        });

        try {
            const result = await lifecycle.create({
                ref: projectWorkspaceRef("committed-before-close"),
                title: "Committed Before Close",
            });

            expect(result).toMatchObject({
                revision: expect.any(Number),
                project: {
                    projectRoot: "committed-before-close",
                    title: "Committed Before Close",
                },
            });
            expect(await readFile(path.join(workspaceRoot, "committed-before-close", "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: Committed Before Close\nsummary: ""\n');
        } finally {
            await lifecycle.close();
        }
    });

    it("create提交后锁释放失败保留typed code并标记committed true", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const releaseFailure = Object.assign(new Error("injected committed release failure"), {code: "EIO"});
        let mutationReleaseCalls = 0;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    mutationReleaseCalls += 1;
                    await release();
                    throw releaseFailure;
                };
            },
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            lockModule: lifecycleLocks,
            templateAdapter: {materialize: async () => undefined},
        });
        const ref = projectWorkspaceRef("committed-release-failure");

        try {
            const failure = await lifecycle.create({ref, title: "Committed Release Failure"})
                .catch((error: unknown) => error);

            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                operation: "create",
                phase: "release",
                committed: true,
            });
            expect(failure).toBeInstanceOf(ProjectLockReleaseFailedError);
            expect(mutationReleaseCalls).toBe(1);
            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: Committed Release Failure\nsummary: ""\n');
        } finally {
            await lifecycle.close();
        }
    });

    it("create提交后不对已经移动的staging owner路径执行递归cleanup", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const cleanupFailure = Object.assign(new Error("injected staging cleanup failure"), {code: "EIO"});
        let stagingCleanupCalls = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename,
            rm: async (filePath, options) => {
                const normalized = filePath.replaceAll("\\", "/");
                if (normalized.includes("/.nbook/lifecycle/staging/v1-")) {
                    stagingCleanupCalls += 1;
                    throw cleanupFailure;
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            templateAdapter: {materialize: async () => undefined},
        });
        const ref = projectWorkspaceRef("cleanup-after-commit");

        try {
            const result = await lifecycle.create({ref, title: "Cleanup After Commit"});

            expect(result).toMatchObject({
                revision: expect.any(Number),
                project: {projectRoot: "cleanup-after-commit"},
            });
            expect(stagingCleanupCalls).toBe(0);
            expect(lifecycle.diagnostics.cleanupIssues).toEqual([]);
            expect(await readFile(path.join(workspaceRoot, ref.projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: Cleanup After Commit\nsummary: ""\n');
        } finally {
            await lifecycle.close();
        }
    });

    it("create失败时保留主错误并把owned staging清理失败记录进diagnostics", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const materializeFailure = new Error("injected template materialize failure");
        const cleanupFailure = Object.assign(new Error("injected staging cleanup failure"), {code: "EIO"});
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename,
            rm: async (filePath, options) => {
                if (filePath.replaceAll("\\", "/").includes("/.nbook/lifecycle/staging/v1-")) {
                    throw cleanupFailure;
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            templateAdapter: {
                materialize: async () => {
                    throw materializeFailure;
                },
            },
        });

        try {
            await expect(lifecycle.create({
                ref: projectWorkspaceRef("cleanup-diagnostic"),
                title: "Cleanup Diagnostic",
            })).rejects.toMatchObject({
                code: "PROJECT_TEMPLATE_FAILED",
                cause: materializeFailure,
            });
            expect(lifecycle.diagnostics).toMatchObject({
                revision: 0,
                cleanupIssues: [{
                    kind: "transaction-cleanup",
                    operation: "create",
                    target: "staging",
                    phase: "remove",
                    path: expect.stringMatching(/^\.nbook\/lifecycle\/staging\/v1-[0-9a-f-]+$/u),
                    code: "PROJECT_ROOT_IO",
                    systemCode: "EIO",
                }],
                omittedCleanupIssueCount: 0,
            });
            expect(Object.isFrozen(lifecycle.diagnostics.cleanupIssues)).toBe(true);
        } finally {
            await lifecycle.close();
        }
    });

    it("cleanup diagnostics只保留最近64条并累计淘汰数量", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const cleanupPaths: string[] = [];
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename,
            rm: async (filePath, options) => {
                const normalized = filePath.replaceAll("\\", "/");
                if (normalized.includes("/.nbook/lifecycle/staging/v1-")) {
                    cleanupPaths.push(path.relative(workspaceRoot, filePath).replaceAll("\\", "/"));
                    throw Object.assign(new Error("injected bounded cleanup failure"), {code: "EIO"});
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            templateAdapter: {
                materialize: async () => {
                    throw new Error("injected bounded materialize failure");
                },
            },
        });

        try {
            for (let index = 0; index < 65; index += 1) {
                await lifecycle.create({
                    ref: projectWorkspaceRef(`cleanup-bounded-${String(index)}`),
                    title: `Cleanup Bounded ${String(index)}`,
                }).catch(() => undefined);
            }

            expect(cleanupPaths).toHaveLength(65);
            expect(lifecycle.diagnostics.cleanupIssues).toHaveLength(64);
            expect(lifecycle.diagnostics.cleanupIssues.map((issue) => issue.path))
                .toEqual(cleanupPaths.slice(1));
            expect(lifecycle.diagnostics.omittedCleanupIssueCount).toBe(1);
        } finally {
            await lifecycle.close();
        }
    });

    it("create成功后不清理被外部替换的staging token路径", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        let externalMarker: string | null = null;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                await rename(oldPath, newPath);
                if (path.basename(newPath) === "staging-cleanup-owner-check") {
                    await mkdir(oldPath);
                    externalMarker = path.join(oldPath, "external-owner.txt");
                    await writeFile(externalMarker, "external replacement", "utf8");
                }
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            templateAdapter: {materialize: async () => undefined},
        });

        try {
            const result = await lifecycle.create({
                ref: projectWorkspaceRef("staging-cleanup-owner-check"),
                title: "Staging Cleanup Owner Check",
            });

            expect(result.project.projectRoot).toBe("staging-cleanup-owner-check");
            expect(externalMarker).not.toBeNull();
            expect(await readFile(externalMarker!, "utf8")).toBe("external replacement");
            expect(lifecycle.diagnostics.cleanupIssues).toEqual([{
                kind: "transaction-cleanup",
                operation: "create",
                target: "staging",
                phase: "ownership-check",
                path: expect.stringMatching(/^\.nbook\/lifecycle\/staging\/v1-[0-9a-f-]+$/u),
                code: "PROJECT_ROOT_REPLACED",
            }]);
        } finally {
            await lifecycle.close();
        }
    });

    it("staging mkdir未成功返回时Lifecycle不清理未取得所有权的token路径", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const mkdirFailure = Object.assign(new Error("injected staging ownership failure"), {code: "EEXIST"});
        let foreignMarker: string | null = null;
        let stagingCleanupCalls = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir: async (filePath, options) => {
                if (path.basename(filePath).startsWith("v1-")) {
                    await mkdir(filePath, options);
                    foreignMarker = path.join(filePath, "foreign-owner.txt");
                    await writeFile(foreignMarker, "foreign owner", "utf8");
                    throw mkdirFailure;
                }
                return mkdir(filePath, options);
            },
            open,
            readFile,
            rename,
            rm: async (filePath, options) => {
                if (path.basename(filePath).startsWith("v1-")) {
                    stagingCleanupCalls += 1;
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});

        try {
            await expect(lifecycle.create({
                ref: projectWorkspaceRef("staging-owner-check"),
                title: "Staging Owner Check",
            }))
                .rejects.toBe(mkdirFailure);
            expect(foreignMarker).not.toBeNull();
            expect(stagingCleanupCalls).toBe(0);
            expect(await readFile(foreignMarker!, "utf8")).toBe("foreign owner");
        } finally {
            await lifecycle.close();
        }
    });

    it("staging physical token捕获失败时不执行无token递归删除并记录ownership诊断", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const inspectionFailure = Object.assign(new Error("injected staging physical inspection failure"), {
            code: "EACCES",
        });
        let stagingCleanupCalls = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename,
            rm: async (filePath, options) => {
                if (filePath.replaceAll("\\", "/").includes("/.nbook/lifecycle/staging/v1-")) {
                    stagingCleanupCalls += 1;
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            rootIdentityOptions: {
                reparseDetector: async (root) => {
                    if (root.replaceAll("\\", "/").includes("/.nbook/lifecycle/staging/v1-")) {
                        throw inspectionFailure;
                    }
                    return false;
                },
            },
            templateAdapter: {materialize: async () => undefined},
        });

        try {
            await expect(lifecycle.create({
                ref: projectWorkspaceRef("staging-token-capture-failure"),
                title: "Staging Token Capture Failure",
            })).rejects.toMatchObject({
                code: "PROJECT_ROOT_IO",
                cause: inspectionFailure,
            });
            expect(stagingCleanupCalls).toBe(0);
            expect(await readdir(path.join(workspaceRoot, ".nbook", "lifecycle", "staging")))
                .toHaveLength(1);
            expect(lifecycle.diagnostics.cleanupIssues).toEqual([{
                kind: "transaction-cleanup",
                operation: "create",
                target: "staging",
                phase: "ownership-check",
                path: expect.stringMatching(/^\.nbook\/lifecycle\/staging\/v1-[0-9a-f-]+$/u),
                code: "PROJECT_ROOT_IO",
                systemCode: "EACCES",
            }]);
        } finally {
            await lifecycle.close();
        }
    });

    it("delete把已关闭Project移入tokenized tombstone并发布absence revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "delete-project");
        await mkdir(path.join(projectRoot, "manuscript"), {recursive: true});
        await writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: Delete\nsummary: \"\"\n", "utf8");
        await writeFile(path.join(projectRoot, "manuscript", "chapter.md"), "# Chapter\n", "utf8");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("delete-project");
        let competingHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const before = await lifecycle.readProjects();
            const result = await lifecycle.delete(ref);

            expect(result).toEqual({
                revision: expect.any(Number),
                projectRoot: "delete-project",
            });
            expect(result.revision).toBeGreaterThan(before.revision);
            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
            expect((await lifecycle.readProjects()).projects).toEqual([]);
            expect((await lifecycle.readCandidates()).candidates).toEqual([]);
            competingHandle = await competitor.acquireOccupancy(ref);
        } finally {
            await competingHandle?.release();
            await lifecycle.close();
        }
    });

    it("delete不等待tombstone清理但close会等待并保留后台cleanup诊断", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "delete-cleanup-diagnostic");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: Delete Cleanup Diagnostic\nsummary: \"\"\n",
            "utf8",
        );
        const cleanupFailure = Object.assign(new Error("injected tombstone cleanup failure"), {code: "EIO"});
        let announceCleanupStarted: (() => void) | null = null;
        const cleanupStarted = new Promise<void>((resolve) => {
            announceCleanupStarted = resolve;
        });
        let releaseCleanup: (() => void) | null = null;
        const cleanupGate = new Promise<void>((resolve) => {
            releaseCleanup = resolve;
        });
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename,
            rm: async (filePath, options) => {
                if (filePath.replaceAll("\\", "/").includes("/.nbook/deleted-projects/v1-")) {
                    announceCleanupStarted?.();
                    await cleanupGate;
                    throw cleanupFailure;
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});

        try {
            const result = await lifecycle.delete(projectWorkspaceRef("delete-cleanup-diagnostic"));
            expect(result.projectRoot).toBe("delete-cleanup-diagnostic");
            await cleanupStarted;

            let closeSettled = false;
            const closePromise = lifecycle.close().then(() => {
                closeSettled = true;
            });
            await Promise.resolve();
            expect(closeSettled).toBe(false);

            releaseCleanup?.();
            await closePromise;
            expect(lifecycle.diagnostics.cleanupIssues).toEqual([{
                kind: "transaction-cleanup",
                operation: "delete",
                target: "tombstone",
                phase: "remove",
                path: expect.stringMatching(/^\.nbook\/deleted-projects\/v1-[0-9a-f-]+$/u),
                code: "PROJECT_ROOT_IO",
                systemCode: "EIO",
            }]);
        } finally {
            releaseCleanup?.();
            await lifecycle.close();
        }
    });

    it("delete已经发布absence并释放锁后遇到close仍返回已提交结果", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "delete-committed-before-close");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            'kind: novel\ntitle: Delete Committed Before Close\nsummary: ""\n',
            "utf8",
        );
        let lifecycle: ProjectLifecycle;
        class CloseAfterCommittedDeleteLocks extends ProjectLockModule {
            override async acquireMutation() {
                const handle = await super.acquireMutation();
                return {
                    ...handle,
                    release: async () => {
                        await handle.release();
                        queueMicrotask(() => {
                            queueMicrotask(() => {
                                queueMicrotask(() => {
                                    void lifecycle.close();
                                });
                            });
                        });
                    },
                };
            }
        }
        const lifecycleLocks = new CloseAfterCommittedDeleteLocks(absoluteFsPath(workspaceRoot));
        lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});

        try {
            const result = await lifecycle.delete(projectWorkspaceRef("delete-committed-before-close"));

            expect(result).toMatchObject({
                revision: expect.any(Number),
                projectRoot: "delete-committed-before-close",
            });
            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await lifecycle.close();
        }
    });

    it("delete提交后锁释放失败保留typed code并标记committed true", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "delete-committed-release-failure");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            'kind: novel\ntitle: Delete Committed Release Failure\nsummary: ""\n',
            "utf8",
        );
        const releaseFailure = Object.assign(new Error("injected delete release failure"), {code: "EIO"});
        let mutationReleaseCalls = 0;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    mutationReleaseCalls += 1;
                    await release();
                    throw releaseFailure;
                };
            },
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const ref = projectWorkspaceRef("delete-committed-release-failure");

        try {
            const failure = await lifecycle.delete(ref).catch((error: unknown) => error);

            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                operation: "delete",
                phase: "release",
                committed: true,
            });
            expect(failure).toBeInstanceOf(ProjectLockReleaseFailedError);
            expect(mutationReleaseCalls).toBe(1);
            await expect(access(projectRoot)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await lifecycle.close();
        }
    });

    it("delete回滚前发现原路径已被外部替换时不覆盖replacement", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "delete-rollback-owner-check");
        const sentinelRoot = path.join(workspaceRoot, "delete-rollback-sentinel");
        const externalMarker = path.join(projectRoot, "external-owner.txt");
        await Promise.all([mkdir(projectRoot), mkdir(sentinelRoot)]);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            'kind: novel\ntitle: Delete Rollback Owner Check\nsummary: ""\n',
            "utf8",
        );
        await writeFile(
            path.join(sentinelRoot, "project.yaml"),
            'kind: novel\ntitle: Delete Rollback Sentinel\nsummary: ""\n',
            "utf8",
        );
        const scanFailure = Object.assign(new Error("injected delete snapshot failure"), {code: "EIO"});
        let tombstonePublished = false;
        let replacementCreated = false;
        let rollbackRenameCalls = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (
                    tombstonePublished
                    && !replacementCreated
                    && path.basename(path.dirname(filePath)) === "delete-rollback-sentinel"
                ) {
                    replacementCreated = true;
                    await mkdir(projectRoot);
                    await writeFile(externalMarker, "external replacement", "utf8");
                    throw scanFailure;
                }
                return readFile(filePath);
            },
            rename: async (oldPath, newPath) => {
                if (path.basename(oldPath) === "delete-rollback-owner-check") {
                    await rename(oldPath, newPath);
                    tombstonePublished = true;
                    return;
                }
                if (tombstonePublished && path.basename(newPath) === "delete-rollback-owner-check") {
                    rollbackRenameCalls += 1;
                    await rm(newPath, {recursive: true, force: true});
                }
                await rename(oldPath, newPath);
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("delete-rollback-owner-check");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.delete(ref)).rejects.toMatchObject({
                code: "PROJECT_ROLLBACK_FAILED",
                operation: "delete",
                phase: "rollback",
                committed: "unknown",
                cause: expect.any(AggregateError),
            });

            expect(rollbackRenameCalls).toBe(0);
            expect(await readFile(externalMarker, "utf8")).toBe("external replacement");
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("delete rename返回前tombstone被替换时不得提交absence或清理replacement", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "delete-tombstone-replacement");
        const movedTombstone = path.join(workspaceRoot, ".nbook", "deleted-projects", "external-moved-original");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            'kind: novel\ntitle: Delete Tombstone Replacement\nsummary: ""\n',
            "utf8",
        );
        let replacementMarker: string | null = null;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                await rename(oldPath, newPath);
                if (
                    path.basename(oldPath) === "delete-tombstone-replacement"
                    && path.basename(path.dirname(newPath)) === "deleted-projects"
                ) {
                    await rename(newPath, movedTombstone);
                    await mkdir(newPath);
                    replacementMarker = path.join(newPath, "external-owner.txt");
                    await writeFile(replacementMarker, "external replacement", "utf8");
                }
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("delete-tombstone-replacement");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.delete(ref)).rejects.toMatchObject({
                code: "PROJECT_ROLLBACK_FAILED",
                operation: "delete",
                phase: "rollback",
                committed: "unknown",
            });

            expect(replacementMarker).not.toBeNull();
            expect(await readFile(replacementMarker!, "utf8")).toBe("external replacement");
            expect(await readFile(path.join(movedTombstone, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: Delete Tombstone Replacement\nsummary: ""\n');
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("delete rename物理成功但Promise失败时按physical token恢复原root", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "delete-rename-threw-after-move");
        const manifest = 'kind: novel\ntitle: Delete Rename Threw After Move\nsummary: ""\n';
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), manifest, "utf8");
        const renameFailure = Object.assign(new Error("delete rename threw after physical move"), {code: "EIO"});
        let injected = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                await rename(oldPath, newPath);
                if (
                    !injected
                    && path.basename(oldPath) === "delete-rename-threw-after-move"
                    && path.basename(path.dirname(newPath)) === "deleted-projects"
                ) {
                    injected = true;
                    throw renameFailure;
                }
            },
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("delete-rename-threw-after-move");

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.delete(ref)).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "delete",
                phase: "publish-root",
                committed: false,
                cause: renameFailure,
            });
            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toBe(manifest);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("浅扫描不把真实root I/O失败吞成空列表", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "root-io");
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: Root IO\nsummary: \"\"\n", "utf8");
        const rootFailure = Object.assign(new Error("injected root attributes failure"), {code: "EACCES"});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            rootIdentityOptions: {
                reparseDetector: async () => {
                    throw rootFailure;
                },
            },
        });

        try {
            await expect(lifecycle.readProjects()).rejects.toMatchObject({
                code: "PROJECT_ROOT_IO",
                cause: rootFailure,
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("浅扫描的case collision membership只统计一级物理目录", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        if (process.platform === "win32") {
            await execFileAsync(
                "fsutil",
                ["file", "setCaseSensitiveInfo", workspaceRoot, "enable"],
                {windowsHide: true},
            );
        }
        const projectRoot = path.join(workspaceRoot, "Alpha");
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: Alpha\nsummary: \"\"\n", "utf8");
        await writeFile(path.join(workspaceRoot, "alpha"), "ordinary file", "utf8");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            rootIdentityOptions: {caseMode: "insensitive"},
        });

        try {
            const projects = await lifecycle.readProjects();
            expect(projects.projects).toMatchObject([{projectRoot: "Alpha", title: "Alpha"}]);
            expect(lifecycle.diagnostics.discoveryIssues).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it("浅扫描把case collision去重为一条diagnostic并排除全部成员", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        if (process.platform === "win32") {
            await execFileAsync(
                "fsutil",
                ["file", "setCaseSensitiveInfo", workspaceRoot, "enable"],
                {windowsHide: true},
            );
        }
        await mkdir(path.join(workspaceRoot, "Alpha"));
        await mkdir(path.join(workspaceRoot, "alpha"));
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            rootIdentityOptions: {caseMode: "insensitive"},
        });

        try {
            const projects = await lifecycle.readProjects();
            expect(projects.projects).toEqual([]);
            expect((await lifecycle.readCandidates()).candidates).toEqual([]);
            expect(lifecycle.diagnostics).toMatchObject({
                revision: projects.revision,
                discoveryIssues: [{
                    kind: "case-collision",
                    projectRoots: ["Alpha", "alpha"],
                    code: "PROJECT_ROOT_CASE_COLLISION",
                }],
                omittedDiscoveryIssueCount: 0,
                cleanupIssues: [],
                omittedCleanupIssueCount: 0,
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("ensure 归一化可解析 manifest 时保留未知 YAML 内容并先备份原始 bytes", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "repairable");
        await mkdir(projectRoot);
        const originalManifest = [
            "# 用户维护的顶层注释",
            "custom:",
            "  enabled: true",
            "kind: draft # 保留行尾注释",
            "title: 42",
            "",
        ].join("\n");
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest, "utf8");

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const before = await lifecycle.readProjects();
            expect(before.projects).toEqual([]);

            const result = await lifecycle.ensure(projectWorkspaceRef("repairable"));

            expect(result.change).toBe("normalized");
            expect(result.recoveryPath).toMatch(/^repairable\/.nbook\/recovery\/project-manifest-.+\.yaml$/u);
            expect(await readFile(path.join(workspaceRoot, result.recoveryPath!), "utf8")).toBe(originalManifest);
            const repairedManifest = await readFile(path.join(projectRoot, "project.yaml"), "utf8");
            expect(repairedManifest).toContain("# 用户维护的顶层注释");
            expect(repairedManifest).toContain("custom:\n  enabled: true");
            expect(repairedManifest).toContain("kind: novel # 保留行尾注释");
            expect(repairedManifest).toContain("title: repairable");
            expect(repairedManifest).toContain('summary: ""');
            expect(result.project).toMatchObject({
                projectRoot: "repairable",
                kind: "novel",
                title: "repairable",
                summary: "",
            });
            expect((await lifecycle.readProjects()).revision).toBeGreaterThan(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("ensure 恢复无法解析的 manifest 时逐字节备份原文件", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "corrupt");
        await mkdir(projectRoot);
        const originalManifest = Buffer.from([0xff, 0xfe, 0x6b, 0x69, 0x6e, 0x64, 0x3a, 0x20, 0x5b]);
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest);

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const result = await lifecycle.ensure(projectWorkspaceRef("corrupt"));

            expect(result.change).toBe("recovered");
            expect(result.recoveryPath).toBeDefined();
            expect(await readFile(path.join(workspaceRoot, result.recoveryPath!))).toEqual(originalManifest);
            expect(result.project).toMatchObject({
                projectRoot: "corrupt",
                kind: "novel",
                title: "corrupt",
                summary: "",
            });
        } finally {
            await lifecycle.close();
        }
    });

    it("manifest 原子替换失败时保留原文件与旧 revision，并清理临时文件", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "atomic-failure");
        await mkdir(projectRoot);
        const originalManifest = "kind: draft\ntitle: Atomic Failure\n";
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest, "utf8");
        const renameFailure = Object.assign(new Error("测试注入的 rename 失败"), {code: "EACCES"});
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => readFile(filePath),
            rename: vi.fn(async (oldPath, newPath) => {
                if (path.basename(newPath) === "project.yaml") {
                    throw renameFailure;
                }
                await rename(oldPath, newPath);
            }),
            rm,
        };

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        try {
            const before = await lifecycle.readProjects();

            await expect(lifecycle.ensure(projectWorkspaceRef("atomic-failure"))).rejects.toMatchObject({
                code: "PROJECT_MANIFEST_IO",
                cause: renameFailure,
            });

            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toBe(originalManifest);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
            const recoveryEntries = await readdir(path.join(projectRoot, ".nbook", "recovery"));
            expect(recoveryEntries).toHaveLength(1);
            expect(await readFile(path.join(projectRoot, ".nbook", "recovery", recoveryEntries[0]), "utf8"))
                .toBe(originalManifest);
            expect((await readdir(projectRoot)).filter(isProjectLifecycleTempName)).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it("manifest原子替换与temp清理同时失败时保留主错误并记录cleanup诊断", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "manifest-cleanup-double-failure");
        await mkdir(projectRoot);
        const renameFailure = Object.assign(new Error("测试注入的manifest rename失败"), {code: "EACCES"});
        const cleanupFailure = Object.assign(new Error("测试注入的manifest temp清理失败"), {code: "EIO"});
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                if (path.basename(newPath) === "project.yaml") {
                    throw renameFailure;
                }
                await rename(oldPath, newPath);
            },
            rm: async (filePath, options) => {
                if (
                    path.basename(path.dirname(filePath)) === "manifest-cleanup-double-failure"
                    && isProjectLifecycleTempName(path.basename(filePath))
                ) {
                    throw cleanupFailure;
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});

        try {
            const before = await lifecycle.readProjects();
            const failure = await lifecycle.ensure(projectWorkspaceRef("manifest-cleanup-double-failure"))
                .catch((error: unknown) => error);

            expect(failure).toMatchObject({code: "PROJECT_MANIFEST_IO"});
            expect((failure as {readonly cause?: unknown}).cause).toBe(renameFailure);

            expect(lifecycle.diagnostics.cleanupIssues).toEqual([
                {
                    kind: "transaction-cleanup",
                    operation: "ensure",
                    target: "manifest-temp",
                    phase: "remove",
                    path: expect.stringMatching(
                        /^manifest-cleanup-double-failure\/\.nbook-project-lifecycle-v1-.+\.tmp$/u,
                    ),
                    code: "PROJECT_ROOT_IO",
                    systemCode: "EIO",
                },
            ]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
            expect((await readdir(projectRoot)).filter(isProjectLifecycleTempName)).toHaveLength(1);
        } finally {
            await lifecycle.close();
        }
    });

    it("manifest在ensure期间被外部修改时返回typed conflict且不覆盖", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "manifest-conflict");
        const manifestPath = path.join(projectRoot, "project.yaml");
        const originalManifest = "kind: draft\ntitle: Original\nsummary: \"\"\n";
        const externalManifest = "kind: novel\ntitle: External\nsummary: kept\n";
        await mkdir(projectRoot);
        await writeFile(manifestPath, originalManifest, "utf8");
        let manifestReadCount = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                if (path.basename(filePath) === "project.yaml") {
                    manifestReadCount += 1;
                    if (manifestReadCount === 3) {
                        await writeFile(filePath, externalManifest, "utf8");
                    }
                }
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});

        try {
            await expect(lifecycle.ensure(projectWorkspaceRef("manifest-conflict"))).rejects.toMatchObject({
                code: "PROJECT_MANIFEST_CONFLICT",
            });
            expect(await readFile(manifestPath, "utf8")).toBe(externalManifest);
            expect((await readdir(projectRoot)).filter(isProjectLifecycleTempName)).toEqual([]);
        } finally {
            await lifecycle.close();
        }
    });

    it("recovery 备份写入失败时禁止进入 manifest replace", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "backup-failure");
        await mkdir(projectRoot);
        const originalManifest = "kind: draft\ntitle: Backup Failure\nsummary: \"\"\n";
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest, "utf8");
        const backupFailure = Object.assign(new Error("测试注入的 backup open 失败"), {code: "ENOSPC"});
        const renameSpy = vi.fn(rename);
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open: async (filePath, flags) => {
                if (path.basename(path.dirname(filePath)) === "recovery" && isProjectLifecycleTempName(path.basename(filePath))) {
                    throw backupFailure;
                }
                return open(filePath, flags);
            },
            readFile: async (filePath) => readFile(filePath),
            rename: renameSpy,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.ensure(projectWorkspaceRef("backup-failure"))).rejects.toMatchObject({
                code: "PROJECT_MANIFEST_IO",
                cause: backupFailure,
            });
            expect(renameSpy).not.toHaveBeenCalled();
            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toBe(originalManifest);
            expect(await readdir(path.join(projectRoot, ".nbook", "recovery"))).toEqual([]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("recovery发布与temp清理同时失败时保留备份主错误并记录cleanup诊断", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "recovery-cleanup-double-failure");
        const manifestPath = path.join(projectRoot, "project.yaml");
        const originalManifest = "kind: draft\ntitle: Recovery Cleanup Failure\nsummary: \"\"\n";
        await mkdir(projectRoot);
        await writeFile(manifestPath, originalManifest, "utf8");
        const backupFailure = Object.assign(new Error("测试注入的recovery rename失败"), {code: "EACCES"});
        const cleanupFailure = Object.assign(new Error("测试注入的recovery temp清理失败"), {code: "EIO"});
        let manifestReplaceCalls = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                if (path.basename(path.dirname(newPath)) === "recovery") {
                    throw backupFailure;
                }
                if (path.basename(newPath) === "project.yaml") {
                    manifestReplaceCalls += 1;
                }
                await rename(oldPath, newPath);
            },
            rm: async (filePath, options) => {
                if (
                    path.basename(path.dirname(filePath)) === "recovery"
                    && isProjectLifecycleTempName(path.basename(filePath))
                ) {
                    throw cleanupFailure;
                }
                await rm(filePath, options);
            },
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});

        try {
            const before = await lifecycle.readProjects();
            const failure = await lifecycle.ensure(projectWorkspaceRef("recovery-cleanup-double-failure"))
                .catch((error: unknown) => error);

            expect(failure).toMatchObject({code: "PROJECT_MANIFEST_IO"});
            expect((failure as {readonly cause?: unknown}).cause).toBe(backupFailure);
            expect(manifestReplaceCalls).toBe(0);
            expect(await readFile(manifestPath, "utf8")).toBe(originalManifest);
            expect(lifecycle.diagnostics.cleanupIssues).toEqual([
                {
                    kind: "transaction-cleanup",
                    operation: "ensure",
                    target: "recovery-temp",
                    phase: "remove",
                    path: expect.stringMatching(
                        /^recovery-cleanup-double-failure\/\.nbook\/recovery\/\.nbook-project-lifecycle-v1-.+\.tmp$/u,
                    ),
                    code: "PROJECT_ROOT_IO",
                    systemCode: "EIO",
                },
            ]);
            expect((await lifecycle.readProjects()).revision).toBe(before.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("prepareOpen只接受一级物理目录，并把canonical identity与进程内key留在DTO之外", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const physicalRoot = path.join(workspaceRoot, "physical");
        await mkdir(physicalRoot);
        await writeFile(path.join(physicalRoot, "project.yaml"), "kind: novel\ntitle: Physical\nsummary: \"\"\n", "utf8");
        await symlink(physicalRoot, path.join(workspaceRoot, "alias"), process.platform === "win32" ? "junction" : "dir");

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        let opened: Awaited<ReturnType<ProjectLifecycle["prepareOpen"]>> | null = null;
        let canonicalSpelling: Awaited<ReturnType<ProjectLifecycle["prepareOpen"]>> | null = null;
        try {
            opened = await lifecycle.prepareOpen(projectWorkspaceRef("physical"));
            const resolved = opened.workspace;
            await opened.occupancy.release();
            opened = null;
            expect(resolved).toMatchObject({
                ref: {projectRoot: "physical"},
                root: expect.any(String),
            });
            expect(resolved.root).toBe(absoluteFsPath(await realpath(physicalRoot)));
            expect(typeof resolved.key).toBe("symbol");
            expect(JSON.stringify(resolved)).not.toContain("key");
            const projects = await lifecycle.readProjects();
            expect(JSON.stringify(projects.projects)).not.toContain("canonicalRoot");
            expect(lifecycle.diagnostics).toMatchObject({
                revision: projects.revision,
                discoveryIssues: [{
                    kind: "unsafe-root",
                    projectRoot: "alias",
                    code: "PROJECT_ROOT_LINK_UNSUPPORTED",
                }],
            });

            await expect(lifecycle.validate(projectWorkspaceRef("alias"))).rejects.toMatchObject({
                code: "PROJECT_ROOT_LINK_UNSUPPORTED",
            });
            expect(() => projectWorkspaceRef("nested/project")).toThrow(expect.objectContaining({
                code: "INVALID_PROJECT_ROOT",
            }));
            expect(() => projectWorkspaceRef(".NBOOK")).toThrow(expect.objectContaining({
                code: "INVALID_PROJECT_ROOT",
            }));
            if (process.platform === "win32") {
                canonicalSpelling = await lifecycle.prepareOpen(projectWorkspaceRef("PHYSICAL"));
                expect(canonicalSpelling.workspace.ref.projectRoot).toBe("physical");
            }
        } finally {
            await canonicalSpelling?.occupancy.release();
            await opened?.occupancy.release();
            await lifecycle.close();
        }
    });

    it("manifest gate 不跟随指向 Workspace Root 外部的文件 symlink", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        const outsideRoot = await mkdtemp(testHostPath("nbook-project-manifest-outside-"));
        roots.push(workspaceRoot, outsideRoot);
        const projectRoot = path.join(workspaceRoot, "linked-manifest");
        const outsideManifest = path.join(outsideRoot, "project.yaml");
        await mkdir(projectRoot);
        await writeFile(outsideManifest, "kind: novel\ntitle: Outside\nsummary: \"\"\n", "utf8");
        await symlink(outsideManifest, path.join(projectRoot, "project.yaml"), "file");

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const projects = await lifecycle.readProjects();
            expect(projects.projects).toEqual([]);
            expect((await lifecycle.readCandidates()).candidates).toEqual([]);
            expect(lifecycle.diagnostics).toMatchObject({
                revision: projects.revision,
                discoveryIssues: [{
                    kind: "unsafe-manifest",
                    projectRoot: "linked-manifest",
                    code: "PROJECT_MANIFEST_IO",
                }],
                omittedDiscoveryIssueCount: 0,
                cleanupIssues: [],
                omittedCleanupIssueCount: 0,
            });
            expect(Object.isFrozen(lifecycle.diagnostics)).toBe(true);
            expect(Object.isFrozen(lifecycle.diagnostics.discoveryIssues)).toBe(true);
            await expect(lifecycle.ensure(projectWorkspaceRef("linked-manifest"))).rejects.toMatchObject({
                code: "PROJECT_MANIFEST_IO",
            });
            expect(await readFile(outsideManifest, "utf8")).toBe("kind: novel\ntitle: Outside\nsummary: \"\"\n");
        } finally {
            await lifecycle.close();
        }
    });

    it("健康 ensure 即使不改写 manifest 也会发布当前磁盘事实的新 revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "externally-created");
        await mkdir(projectRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const before = await lifecycle.readProjects();
            expect(before.projects).toEqual([]);
            expect((await lifecycle.readCandidates()).candidates).toEqual([
                {projectRoot: "externally-created"},
            ]);

            const manifest = "kind: novel\ntitle: External\nsummary: Current disk fact\n";
            await writeFile(path.join(projectRoot, "project.yaml"), manifest, "utf8");
            const result = await lifecycle.ensure(projectWorkspaceRef("externally-created"));

            expect(result.change).toBe("none");
            expect(result.project).toMatchObject({projectRoot: "externally-created", title: "External"});
            const after = await lifecycle.readProjects();
            expect(after.revision).toBeGreaterThan(before.revision);
            expect(after.projects).toEqual([result.project]);
            expect((await lifecycle.readCandidates()).candidates).toEqual([]);
            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toBe(manifest);
        } finally {
            await lifecycle.close();
        }
    });

    it("冷扫描持有mutation期间ensure等待，随后发布新的snapshot revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "scan-race");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        await writeFile(manifestPath, "kind: draft\ntitle: Race\nsummary: \"\"\n", "utf8");

        let notifyFirstRead: () => void = () => undefined;
        let releaseFirstRead: () => void = () => undefined;
        const firstReadEntered = new Promise<void>((resolve) => {
            notifyFirstRead = resolve;
        });
        const firstReadRelease = new Promise<void>((resolve) => {
            releaseFirstRead = resolve;
        });
        let readCount = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                const bytes = await readFile(filePath);
                readCount += 1;
                if (readCount === 1) {
                    notifyFirstRead();
                    await firstReadRelease;
                }
                return bytes;
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        try {
            const staleRead = lifecycle.readProjects();
            await firstReadEntered;
            const ensurePromise = lifecycle.ensure(projectWorkspaceRef("scan-race"));
            releaseFirstRead();

            const firstResult = await staleRead;
            const result = await ensurePromise;
            const current = await lifecycle.readProjects();
            expect(result.change).toBe("normalized");
            expect(firstResult.revision).toBeLessThan(current.revision);
            expect(firstResult.projects).toEqual([]);
            expect(current.projects).toEqual([result.project]);
            expect((await lifecycle.readCandidates()).candidates).toEqual([]);
        } finally {
            releaseFirstRead();
            await lifecycle.close();
        }
    });

    it("close 进入 closing 后拒绝新操作，并等待已开始的浅扫描收口", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "close-scan");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        await writeFile(manifestPath, "kind: novel\ntitle: Close Scan\nsummary: \"\"\n", "utf8");
        let notifyReadEntered: () => void = () => undefined;
        let releaseRead: () => void = () => undefined;
        const readEntered = new Promise<void>((resolve) => {
            notifyReadEntered = resolve;
        });
        const readRelease = new Promise<void>((resolve) => {
            releaseRead = resolve;
        });
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                notifyReadEntered();
                await readRelease;
                return readFile(filePath);
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const ref = projectWorkspaceRef("close-scan");
        const staleRead = lifecycle.readProjects();
        await readEntered;
        let closeFinished = false;
        const closing = lifecycle.close().then(() => {
            closeFinished = true;
        });

        try {
            await Promise.resolve();
            expect(closeFinished).toBe(false);
            await expect(lifecycle.readProjects()).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
            await expect(lifecycle.readCandidates()).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
            await expect(lifecycle.validate(ref)).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
            await expect(lifecycle.ensure(ref)).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
            await expect(lifecycle.prepareOpen(ref)).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});

            releaseRead();
            await expect(staleRead).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
            await closing;
            await expect(lifecycle.readProjects()).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
        } finally {
            releaseRead();
            await closing;
            await lifecycle.close();
        }
    });

    it("可解析 manifest 只修复非法核心字段并保留其余合法值", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "field-merge");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: draft\ntitle: 用户标题\nsummary: 用户摘要\n",
            "utf8",
        );

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const result = await lifecycle.ensure(projectWorkspaceRef("field-merge"));

            expect(result.change).toBe("normalized");
            expect(result.project).toMatchObject({
                kind: "novel",
                title: "用户标题",
                summary: "用户摘要",
            });
            const repaired = await readFile(path.join(projectRoot, "project.yaml"), "utf8");
            expect(repaired).toContain("kind: novel");
            expect(repaired).toContain("title: 用户标题");
            expect(repaired).toContain("summary: 用户摘要");
        } finally {
            await lifecycle.close();
        }
    });

    it("validate报告可修复字段且不加锁、不写入、不推进revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "validate-field");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        const originalManifest = [
            "custom:",
            "  enabled: true",
            "kind: draft",
            "title: 用户标题",
            "summary: 用户摘要",
            "",
        ].join("\n");
        await writeFile(manifestPath, originalManifest, "utf8");

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const beforeSnapshot = await lifecycle.readCandidates();
            const beforeStat = await stat(manifestPath, {bigint: true});
            const lockRoot = path.join(workspaceRoot, ".nbook", "locks");
            const beforeLocks = await readdir(lockRoot);

            const result = await lifecycle.validate(projectWorkspaceRef("validate-field"));

            expect(result).toEqual({
                status: "repairable",
                projectRoot: "validate-field",
                proposedManifest: {
                    kind: "novel",
                    title: "用户标题",
                    summary: "用户摘要",
                },
                issues: [{
                    code: "PROJECT_MANIFEST_FIELD_INVALID",
                    file: "project.yaml",
                    field: "kind",
                }],
            });
            expect(await readFile(manifestPath, "utf8")).toBe(originalManifest);
            expect((await stat(manifestPath, {bigint: true})).mtimeNs).toBe(beforeStat.mtimeNs);
            expect(await readdir(lockRoot)).toEqual(beforeLocks);
            expect((await lifecycle.readCandidates()).revision).toBe(beforeSnapshot.revision);
        } finally {
            await lifecycle.close();
        }
    });

    it("validate把真实manifest读取失败收口为typed I/O error", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "validate-io");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        await writeFile(manifestPath, "kind: novel\ntitle: Validate IO\nsummary: \"\"\n", "utf8");
        const readFailure = Object.assign(new Error("injected read failure"), {code: "EACCES"});
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async () => {
                throw readFailure;
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});

        try {
            await expect(lifecycle.validate(projectWorkspaceRef("validate-io"))).rejects.toMatchObject({
                code: "PROJECT_MANIFEST_IO",
                cause: readFailure,
            });
            await expect(access(path.join(workspaceRoot, ".nbook", "locks")))
                .rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await lifecycle.close();
        }
    });

    it("Project 与 candidate snapshot 不能被调用方修改后污染 cache", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "immutable");
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: Immutable\nsummary: \"\"\n", "utf8");

        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        try {
            const projects = await lifecycle.readProjects();
            const candidates = await lifecycle.readCandidates();
            expect(Object.isFrozen(projects)).toBe(true);
            expect(Object.isFrozen(projects.projects)).toBe(true);
            expect(Object.isFrozen(projects.projects[0])).toBe(true);
            expect(Object.isFrozen(candidates)).toBe(true);
            expect(Object.isFrozen(candidates.candidates)).toBe(true);
            expect((await lifecycle.readProjects()).projects).toEqual(projects.projects);
        } finally {
            await lifecycle.close();
        }
    });

    it("prepareOpen 按锁序 ensure 并把同一 Occupancy handle 移交给调用方", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "prepare-open");
        await mkdir(projectRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        let releasePrepared: (() => Promise<void>) | null = null;
        let releaseCompetitor: (() => Promise<void>) | null = null;

        try {
            const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("prepare-open"));
            releasePrepared = () => prepared.occupancy.release();
            expect(prepared.change).toBe("created");
            expect(prepared.project.projectRoot).toBe("prepare-open");
            expect((await lifecycle.readProjects()).projects).toEqual([prepared.project]);
            await expect(competitor.acquireOccupancy(prepared.workspace.ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
            });

            await prepared.occupancy.release();
            releasePrepared = null;
            const competitorHandle = await competitor.acquireOccupancy(prepared.workspace.ref);
            releaseCompetitor = () => competitorHandle.release();
            await expect(access(path.join(projectRoot, ".nbook", "project.sqlite"))).rejects.toMatchObject({
                code: "ENOENT",
            });
        } finally {
            await releaseCompetitor?.();
            await releasePrepared?.();
            await lifecycle.close();
        }
    });

    it("Lifecycle关闭后仍可只读复核已捕获的Project物理root", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "revalidate-after-close");
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), "kind: novel\ntitle: AfterClose\nsummary: \"\"\n", "utf8");
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("revalidate-after-close"));
        await prepared.occupancy.release();
        await lifecycle.close();
        // 新操作继续被 runOperation 的 close gate 拒绝。
        await expect(async () => lifecycle.readProjects()).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
        // 只读物理复核不取得锁、不写盘，close 后仍供已接纳访问在副作用前确认原 root。
        await expect(lifecycle.revalidateWorkspace(prepared.workspace)).resolves.toBeUndefined();
    });

    it("运行中metadata update借用prepareOpen的Occupancy并发布新revision", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "metadata-borrowed-occupancy");
        const originalManifest = Buffer.from([
            "# metadata source",
            "custom:",
            "  keep: true",
            "kind: novel",
            "title: 旧标题",
            "summary: 旧摘要",
            "",
        ].join("\n"), "utf8");
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        let prepared: Awaited<ReturnType<ProjectLifecycle["prepareOpen"]>> | null = null;
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            prepared = await lifecycle.prepareOpen(projectWorkspaceRef("metadata-borrowed-occupancy"));
            const opened = prepared;
            const result = await lifecycle.updateMetadata(
                {ref: opened.workspace.ref, title: "新标题"},
                {
                    kind: "borrowed",
                    workspace: opened.workspace,
                    assertActive: () => opened.occupancy.assertHealthy(),
                },
            );

            expect(result.revision).toBeGreaterThan(opened.revision);
            expect(result).toMatchObject({
                project: {
                    projectRoot: "metadata-borrowed-occupancy",
                    title: "新标题",
                    summary: "旧摘要",
                },
            });
            expect((await lifecycle.readProjects()).revision).toBe(result.revision);
            const updatedManifest = await readFile(path.join(projectRoot, "project.yaml"), "utf8");
            expect(updatedManifest).toContain("# metadata source");
            expect(updatedManifest).toContain("custom:\n  keep: true");
            expect(updatedManifest).toContain("title: 新标题");
            expect(updatedManifest).toContain("summary: 旧摘要");
            const recoveryRoot = path.join(projectRoot, ".nbook", "recovery");
            const recoveryFiles = await readdir(recoveryRoot);
            expect(recoveryFiles).toHaveLength(1);
            expect(await readFile(path.join(recoveryRoot, recoveryFiles[0]!))).toEqual(originalManifest);
            await expect(competitor.acquireOccupancy(opened.workspace.ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
            });

            await opened.occupancy.release();
            prepared = null;
            competitorHandle = await competitor.acquireOccupancy(opened.workspace.ref);
        } finally {
            await competitorHandle?.release();
            await prepared?.occupancy.release();
            await lifecycle.close();
        }
    });

    it("metadata读取后root被替换时不向replacement写入recovery", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "metadata-root-replaced");
        const movedOriginalRoot = path.join(workspaceRoot, "metadata-root-replaced-original");
        const originalManifest = 'kind: novel\ntitle: Before\nsummary: ""\n';
        const replacementManifest = 'kind: novel\ntitle: External Replacement\nsummary: ""\n';
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest, "utf8");
        let replaceOnRead = false;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                const raw = await readFile(filePath);
                if (
                    replaceOnRead
                    && path.basename(filePath) === "project.yaml"
                    && path.basename(path.dirname(filePath)) === "metadata-root-replaced"
                ) {
                    replaceOnRead = false;
                    await rename(projectRoot, movedOriginalRoot);
                    await mkdir(projectRoot);
                    await writeFile(path.join(projectRoot, "project.yaml"), replacementManifest, "utf8");
                }
                return raw;
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("metadata-root-replaced"));

        try {
            replaceOnRead = true;
            await expect(lifecycle.updateMetadata(
                {ref: prepared.workspace.ref, title: "After"},
                {
                    kind: "borrowed",
                    workspace: prepared.workspace,
                    assertActive: () => prepared.occupancy.assertHealthy(),
                },
            )).rejects.toMatchObject({code: "PROJECT_ROOT_REPLACED"});

            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toBe(replacementManifest);
            await expect(access(path.join(projectRoot, ".nbook"))).rejects.toMatchObject({code: "ENOENT"});
            expect(await readFile(path.join(movedOriginalRoot, "project.yaml"), "utf8")).toBe(originalManifest);
        } finally {
            await prepared.occupancy.release();
            await lifecycle.close();
        }
    });

    it("metadata写入前失败且锁释放失败时保留operation与committed false", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "metadata-release-failure");
        const originalManifest = 'kind: novel\ntitle: Before\nsummary: ""\n';
        await mkdir(projectRoot);
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest, "utf8");
        const manifestFailure = Object.assign(new Error("injected metadata rename failure"), {code: "EIO"});
        const releaseFailure = Object.assign(new Error("injected metadata release failure"), {code: "EIO"});
        let mutationReleaseCalls = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                if (path.basename(newPath) === "project.yaml") {
                    throw manifestFailure;
                }
                await rename(oldPath, newPath);
            },
            rm,
        };
        const lockAdapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    mutationReleaseCalls += 1;
                    await release();
                    throw releaseFailure;
                };
            },
        };
        const lockModule = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter: lockAdapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter, lockModule});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("metadata-release-failure");
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const failure = await lifecycle.updateMetadata({ref, title: "After"})
                .catch((error: unknown) => error);

            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                operation: "metadata-update",
                phase: "release",
                committed: false,
            });
            expect(failure).toBeInstanceOf(ProjectLockReleaseFailedError);
            expect(mutationReleaseCalls).toBe(1);
            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toBe(originalManifest);
            competitorHandle = await competitor.acquireOccupancy(ref);
        } finally {
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("prepareOpen 在目标缺失时先竞争 prospective Occupancy", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const ref = projectWorkspaceRef("future-project");
        const holder = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const occupied = await holder.acquireOccupancy(ref);

        try {
            await expect(lifecycle.prepareOpen(ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
                projectRoot: "future-project",
            });
            await expect(access(path.join(workspaceRoot, "future-project"))).rejects.toMatchObject({
                code: "ENOENT",
            });
        } finally {
            await occupied.release();
            await lifecycle.close();
        }
    });

    it("prepareOpen Promise 履行后 Occupancy 只归调用方", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "handoff-owner"));
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const prepared = await lifecycle.prepareOpen(projectWorkspaceRef("handoff-owner"));
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await lifecycle.close();
            await expect(competitor.acquireOccupancy(prepared.workspace.ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
            });

            await prepared.occupancy.release();
            competitorHandle = await competitor.acquireOccupancy(prepared.workspace.ref);
        } finally {
            await competitorHandle?.release();
            await prepared.occupancy.release();
            await lifecycle.close();
        }
    });

    it("prepareOpen在mutation release期间root被替换时拒绝handoff并释放Occupancy", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "replace-during-release");
        const movedRoot = path.join(workspaceRoot, "replace-during-release-moved");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            'kind: novel\ntitle: Original Root\nsummary: ""\n',
            "utf8",
        );
        let notifyMutationRelease: () => void = () => undefined;
        let allowMutationRelease: () => void = () => undefined;
        const mutationReleaseEntered = new Promise<void>((resolve) => {
            notifyMutationRelease = resolve;
        });
        const mutationReleaseAllowed = new Promise<void>((resolve) => {
            allowMutationRelease = resolve;
        });
        const lockAdapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    notifyMutationRelease();
                    await mutationReleaseAllowed;
                    await release();
                };
            },
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter: lockAdapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("replace-during-release");
        const opening = lifecycle.prepareOpen(ref);
        await mutationReleaseEntered;
        await rename(projectRoot, movedRoot);
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            'kind: novel\ntitle: Replacement Root\nsummary: ""\n',
            "utf8",
        );
        allowMutationRelease();
        let unexpectedPrepared: Awaited<ReturnType<ProjectLifecycle["prepareOpen"]>> | null = null;
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const outcome = await opening.then(
                (prepared) => {
                    unexpectedPrepared = prepared;
                    return prepared;
                },
                (error: unknown) => error,
            );

            expect(outcome).toMatchObject({code: "PROJECT_ROOT_REPLACED"});
            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8"))
                .toBe('kind: novel\ntitle: Replacement Root\nsummary: ""\n');
            competitorHandle = await competitor.acquireOccupancy(ref);
        } finally {
            allowMutationRelease();
            await unexpectedPrepared?.occupancy.release();
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("prepareOpen的mutation release失败时不重复release并释放未移交Occupancy", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "prepare-open-release-failure");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            'kind: novel\ntitle: Release Failure\nsummary: ""\n',
            "utf8",
        );
        const releaseFailure = Object.assign(new Error("测试注入的prepareOpen mutation release失败"), {code: "EIO"});
        let adapterReleaseCalls = 0;
        let handleReleaseCalls = 0;
        let firstTypedReleaseFailure: unknown = null;
        const lockAdapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    adapterReleaseCalls += 1;
                    await release();
                    throw releaseFailure;
                };
            },
        };
        class TrackingProjectLocks extends ProjectLockModule {
            override async acquireMutation() {
                const handle = await super.acquireMutation();
                return {
                    ...handle,
                    release: async () => {
                        handleReleaseCalls += 1;
                        try {
                            await handle.release();
                        } catch (error) {
                            firstTypedReleaseFailure ??= error;
                            throw error;
                        }
                    },
                };
            }
        }
        const lifecycleLocks = new TrackingProjectLocks(absoluteFsPath(workspaceRoot), {adapter: lockAdapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("prepare-open-release-failure");
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const failure = await lifecycle.prepareOpen(ref).catch((error: unknown) => error);

            expect(firstTypedReleaseFailure).toBeInstanceOf(ProjectLockReleaseFailedError);
            expect(failure).toBe(firstTypedReleaseFailure);
            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                kind: "workspace-mutation",
            });
            expect(handleReleaseCalls).toBe(1);
            expect(adapterReleaseCalls).toBe(1);
            competitorHandle = await competitor.acquireOccupancy(ref);
        } finally {
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("close 在 prepareOpen 最终 mutation release 期间阻止 Occupancy handoff", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "close-handoff"));
        let notifyMutationRelease: () => void = () => undefined;
        let allowMutationRelease: () => void = () => undefined;
        const mutationReleaseEntered = new Promise<void>((resolve) => {
            notifyMutationRelease = resolve;
        });
        const mutationReleaseAllowed = new Promise<void>((resolve) => {
            allowMutationRelease = resolve;
        });
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    notifyMutationRelease();
                    await mutationReleaseAllowed;
                    await release();
                };
            },
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const opening = lifecycle.prepareOpen(projectWorkspaceRef("close-handoff"));
        await mutationReleaseEntered;
        let closeFinished = false;
        const closing = lifecycle.close().then(() => {
            closeFinished = true;
        });
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await Promise.resolve();
            expect(closeFinished).toBe(false);
            allowMutationRelease();
            await expect(opening).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
            await closing;
            competitorHandle = await competitor.acquireOccupancy(projectWorkspaceRef("close-handoff"));
        } finally {
            allowMutationRelease();
            await opening.catch(() => undefined);
            await closing;
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("close 插入 prepareOpen 内层完成与公开 Promise 履行之间时释放未移交的 Occupancy", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "close-before-fulfillment"));
        let lifecycle: ProjectLifecycle;
        class CloseBeforeFulfillmentLocks extends ProjectLockModule {
            override async acquireMutation() {
                const handle = await super.acquireMutation();
                return {
                    ...handle,
                    release: async () => {
                        await handle.release();
                        queueMicrotask(() => {
                            queueMicrotask(() => {
                                void lifecycle.close();
                            });
                        });
                    },
                };
            }
        }
        const lifecycleLocks = new CloseBeforeFulfillmentLocks(absoluteFsPath(workspaceRoot));
        lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("close-before-fulfillment");
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await expect(lifecycle.prepareOpen(ref)).rejects.toMatchObject({code: "PROJECT_LIFECYCLE_CLOSED"});
            await lifecycle.close();
            competitorHandle = await competitor.acquireOccupancy(ref);
        } finally {
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("prepareOpen 检测同路径root替换，不写入replacement且不移交Occupancy", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "replace-root");
        const movedRoot = path.join(workspaceRoot, "replace-root-moved");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        await writeFile(manifestPath, "kind: novel\ntitle: Replace Root\nsummary: \"\"\n", "utf8");
        let notifyManifestRead: () => void = () => undefined;
        let releaseManifestRead: () => void = () => undefined;
        const manifestRead = new Promise<void>((resolve) => {
            notifyManifestRead = resolve;
        });
        const manifestReadRelease = new Promise<void>((resolve) => {
            releaseManifestRead = resolve;
        });
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                const bytes = await readFile(filePath);
                notifyManifestRead();
                await manifestReadRelease;
                return bytes;
            },
            rename,
            rm,
        };
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {manifestAdapter});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const opening = lifecycle.prepareOpen(projectWorkspaceRef("replace-root"));
        await manifestRead;
        await rename(projectRoot, movedRoot);
        await mkdir(projectRoot);
        releaseManifestRead();
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await expect(opening).rejects.toMatchObject({code: "PROJECT_ROOT_REPLACED"});
            await expect(access(path.join(projectRoot, "project.yaml"))).rejects.toMatchObject({code: "ENOENT"});
            competitorHandle = await competitor.acquireOccupancy(projectWorkspaceRef("replace-root"));
        } finally {
            releaseManifestRead();
            await opening.catch(() => undefined);
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("Occupancy compromised 在 manifest rename 前关闭提交门禁", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "compromised-commit");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        let compromiseOccupancy: ((error: Error) => void) | null = null;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    compromiseOccupancy = options.onCompromised;
                }
                return acquireFileLock(file, options);
            },
        };
        const manifestAdapter: ProjectManifestAdapter = {
            access: async (filePath) => {
                try {
                    await access(filePath);
                } catch (error) {
                    if (path.basename(filePath) === "project.yaml") {
                        compromiseOccupancy?.(new Error("heartbeat lost before manifest commit"));
                    }
                    throw error;
                }
            },
            mkdir,
            open,
            readFile,
            rename,
            rm,
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            lockModule: lifecycleLocks,
        });
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await expect(lifecycle.prepareOpen(projectWorkspaceRef("compromised-commit"))).rejects.toMatchObject({
                code: "PROJECT_LOCK_COMPROMISED",
            });
            await expect(access(manifestPath)).rejects.toMatchObject({code: "ENOENT"});
            competitorHandle = await competitor.acquireOccupancy(projectWorkspaceRef("compromised-commit"));
        } finally {
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("manifest rename成功后门禁失败返回部分提交的transaction error", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "manifest-post-rename-gate");
        const manifestPath = path.join(projectRoot, "project.yaml");
        await mkdir(projectRoot);
        let compromiseOccupancy: ((error: Error) => void) | null = null;
        const lockAdapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    compromiseOccupancy = options.onCompromised;
                }
                return acquireFileLock(file, options);
            },
        };
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile,
            rename: async (oldPath, newPath) => {
                await rename(oldPath, newPath);
                if (path.basename(newPath) === "project.yaml") {
                    compromiseOccupancy?.(new Error("heartbeat lost after manifest rename"));
                }
            },
            rm,
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter: lockAdapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            lockModule: lifecycleLocks,
            manifestAdapter,
        });
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("manifest-post-rename-gate");
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const before = await lifecycle.readProjects();
            await expect(lifecycle.ensure(ref)).rejects.toMatchObject({
                code: "PROJECT_PUBLISH_FAILED",
                operation: "ensure",
                phase: "publish-manifest",
                committed: "unknown",
                cause: expect.objectContaining({
                    committed: true,
                    cause: expect.objectContaining({code: "PROJECT_LOCK_COMPROMISED"}),
                }),
            });

            expect(await readFile(manifestPath, "utf8"))
                .toBe('kind: novel\ntitle: manifest-post-rename-gate\nsummary: ""\n');
            const after = await lifecycle.readProjects();
            expect(after.revision).toBe(before.revision);
            expect(after.projects).toEqual([]);
            competitorHandle = await competitor.acquireOccupancy(ref);
        } finally {
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("Occupancy compromised 在 shallow snapshot commit 前阻止revision发布", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "compromised-snapshot");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: Compromised Snapshot\nsummary: \"\"\n",
            "utf8",
        );
        let compromiseOccupancy: ((error: Error) => void) | null = null;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    compromiseOccupancy = options.onCompromised;
                }
                return acquireFileLock(file, options);
            },
        };
        let manifestReadCount = 0;
        const manifestAdapter: ProjectManifestAdapter = {
            access,
            mkdir,
            open,
            readFile: async (filePath) => {
                const bytes = await readFile(filePath);
                manifestReadCount += 1;
                if (manifestReadCount === 2) {
                    compromiseOccupancy?.(new Error("heartbeat lost before snapshot commit"));
                }
                return bytes;
            },
            rename,
            rm,
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {
            manifestAdapter,
            lockModule: lifecycleLocks,
        });

        try {
            await expect(lifecycle.prepareOpen(projectWorkspaceRef("compromised-snapshot"))).rejects.toMatchObject({
                code: "PROJECT_LOCK_COMPROMISED",
            });
            expect(manifestReadCount).toBe(2);
            expect((await lifecycle.readProjects()).projects).toHaveLength(1);
            expect(manifestReadCount).toBe(3);
        } finally {
            await lifecycle.close();
        }
    });

    it("Occupancy compromised 在 mutation release 后阻止最终handoff", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "compromised-handoff");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: Compromised Handoff\nsummary: \"\"\n",
            "utf8",
        );
        let compromiseOccupancy: ((error: Error) => void) | null = null;
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (!options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    compromiseOccupancy = options.onCompromised;
                    return release;
                }
                return async () => {
                    await release();
                    compromiseOccupancy?.(new Error("heartbeat lost before handoff"));
                };
            },
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await expect(lifecycle.prepareOpen(projectWorkspaceRef("compromised-handoff"))).rejects.toMatchObject({
                code: "PROJECT_LOCK_COMPROMISED",
            });
            competitorHandle = await competitor.acquireOccupancy(projectWorkspaceRef("compromised-handoff"));
        } finally {
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("prepareOpen失败且锁释放不完整时保留PROJECT_LOCK_RELEASE_FAILED顶层code", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const adapter: ProjectLockAdapter = {
            acquire: async (file, options) => {
                const release = await acquireFileLock(file, options);
                if (options.lockfilePath.endsWith("workspace-mutation.lock")) {
                    return release;
                }
                return async () => {
                    await release();
                    throw Object.assign(new Error("injected release failure"), {code: "EIO"});
                };
            },
        };
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot), {adapter});
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            const failure = await lifecycle.prepareOpen(projectWorkspaceRef("missing-release-failure"))
                .catch((error: unknown) => error);
            expect(failure).toMatchObject({
                code: "PROJECT_LOCK_RELEASE_FAILED",
                kind: "project-occupancy",
                projectRoot: "missing-release-failure",
            });
            expect(failure).toBeInstanceOf(ProjectLockReleaseFailedError);
            if (!(failure instanceof ProjectLockReleaseFailedError)) {
                throw new Error("期望ProjectLockReleaseFailedError");
            }
            expect(failure.cause).toBeInstanceOf(AggregateError);
            competitorHandle = await competitor.acquireOccupancy(projectWorkspaceRef("missing-release-failure"));
        } finally {
            await competitorHandle?.release();
            await lifecycle.close();
        }
    });

    it("Occupancy fail-fast 时不改写 manifest，并立即释放先取得的 mutation lock", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "lock-order");
        await mkdir(projectRoot);
        const originalManifest = "kind: draft\ntitle: Lock Order\nsummary: \"\"\n";
        await writeFile(path.join(projectRoot, "project.yaml"), originalManifest, "utf8");
        const lockHolder = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const lifecycleLocks = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {lockModule: lifecycleLocks});
        const ref = projectWorkspaceRef("lock-order");
        const occupied = await lockHolder.acquireOccupancy(ref);
        let mutationAfterFailure: Awaited<ReturnType<ProjectLockModule["acquireMutation"]>> | null = null;

        try {
            await expect(lifecycle.ensure(ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
            });
            expect(await readFile(path.join(projectRoot, "project.yaml"), "utf8")).toBe(originalManifest);

            mutationAfterFailure = await lockHolder.acquireMutation();
        } finally {
            await mutationAfterFailure?.release();
            await occupied.release();
            await lifecycle.close();
        }
    });
});
