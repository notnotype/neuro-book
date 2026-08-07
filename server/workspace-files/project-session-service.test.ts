import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {
    PreparedProjectOpen,
    ProjectListEntry,
} from "nbook/server/workspace-files/project-lifecycle";
import type {ProjectOccupancyHandle} from "nbook/server/workspace-files/project-lock";
import {
    projectModuleToken,
    replaceProjectModulesForTest,
    type ProjectModule,
    type ProjectModuleHandle,
    type ProjectModuleName,
} from "nbook/server/workspace-files/project-module";
import {
    ProjectNotReadyError,
    ProjectSessionCloseError,
    ProjectSessionRuntime,
} from "nbook/server/workspace-files/project-session-runtime";
import {
    ProjectNotOpenError,
    ProjectSessionService,
    type ProjectControlLifecycle,
} from "nbook/server/workspace-files/project-session-service";

describe("ProjectSessionService", () => {
    const restores: Array<() => void> = [];

    afterEach(() => {
        while (restores.length > 0) {
            restores.pop()?.();
        }
    });

    it("并发open共享一次Lifecycle handoff，后续幂等open复用ready generation", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "shared-open");
        const lifecycle = controlLifecycle(prepared);
        const runtime = new ProjectSessionRuntime();
        const service = new ProjectSessionService(workspaceRoot, {lifecycle, runtime});
        const ref = projectWorkspaceRef("shared-open");

        const [first, second] = await Promise.all([
            service.openProject(ref, {kind: "user"}),
            service.openProject(ref, {kind: "agent", sessionId: 1}),
        ]);
        expect(first).toBe(second);
        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);

        runtime.acquireUserPresence(first)();
        expect(runtime.projectPresence(first).state).toBe("grace");
        const reused = await service.openProject(ref, {kind: "user"});

        expect(reused).toBe(first);
        expect(reused.generation).toBe(1);
        expect(runtime.projectPresence(first).state).toBe("open");
        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);
    });

    it("控制面open只发布metadata，ready快速复用稳定降为change none", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = {...preparedProject(workspaceRoot, "control-open"), change: "created" as const};
        const lifecycle = controlLifecycle(prepared);
        const runtime = new ProjectSessionRuntime();
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime,
        });
        const ref = projectWorkspaceRef("control-open");

        const first = await service.openProjectControl(ref, {kind: "user"});
        expect(first.publication).toEqual({
            revision: 1,
            project: prepared.project,
            change: "created",
        });
        expect(first.publication).not.toHaveProperty("workspace");
        expect(first.publication).not.toHaveProperty("occupancy");

        const reused = await service.openProjectControl(ref, {kind: "user"});
        expect(reused.ready).toBe(first.ready);
        expect(reused.publication).toEqual({
            revision: 1,
            project: prepared.project,
            change: "none",
        });
        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);

        vi.spyOn(runtime, "resumeReadyProject").mockImplementationOnce(() => {
            throw new ProjectNotReadyError(ref.projectRoot);
        });
        await expect(service.openProjectControl(ref, {kind: "user"}))
            .rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("控制面意图只代理唯一Lifecycle，delete不会隐式关闭ready Session", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "control-intents");
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("control-intents");
        const unopenedRef = projectWorkspaceRef("unopened-delete");

        await expect(service.listProjects()).resolves.toEqual({
            revision: 1,
            projects: [prepared.project],
        });
        await expect(service.listCandidates()).resolves.toEqual({revision: 1, candidates: []});
        await expect(service.createProject({ref, title: "Control"})).resolves.toEqual({
            revision: 1,
            project: prepared.project,
        });
        await expect(service.deleteProject(unopenedRef)).resolves.toMatchObject({
            projectRoot: "unopened-delete",
        });
        expect(lifecycle.delete).toHaveBeenCalledWith(unopenedRef);
        vi.mocked(lifecycle.delete).mockClear();
        await service.openProject(ref, {kind: "user"});

        await expect(service.deleteProject(ref)).rejects.toMatchObject({code: "PROJECT_IN_USE"});
        expect(service.requireReadyProject(ref).workspace).toBe(prepared.workspace);
        expect(prepared.occupancy.release).not.toHaveBeenCalled();
        expect(lifecycle.readProjects).toHaveBeenCalledTimes(1);
        expect(lifecycle.readCandidates).toHaveBeenCalledTimes(1);
        expect(lifecycle.create).toHaveBeenCalledWith({ref, title: "Control"});
        expect(lifecycle.delete).not.toHaveBeenCalled();
    });

    it("metadata update对ready generation借用Occupancy，未运行Project才请求acquire", async () => {
        const fileIndexMutations = vi.fn();
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index", fileIndexMutations),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "metadata-running");
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const runningRef = projectWorkspaceRef("metadata-running");
        await service.openProject(runningRef, {kind: "user"});

        await service.updateProjectMetadata({ref: runningRef, title: "Updated"});
        const borrowed = vi.mocked(lifecycle.updateMetadata).mock.calls[0]?.[1];
        expect(borrowed?.kind).toBe("borrowed");
        if (!borrowed || borrowed.kind !== "borrowed") {
            throw new Error("测试预期ready Project使用borrowed metadata access");
        }
        expect(borrowed.workspace).toBe(prepared.workspace);
        expect(() => borrowed.assertActive()).not.toThrow();
        expect(fileIndexMutations).toHaveBeenCalledOnce();

        await service.closeProject(runningRef, "shutdown");
        expect(() => borrowed.assertActive()).toThrow(ProjectNotOpenError);
        const stoppedRef = projectWorkspaceRef("metadata-stopped");
        await service.updateProjectMetadata({ref: stoppedRef, summary: "Stopped"});
        expect(vi.mocked(lifecycle.updateMetadata).mock.calls[1]?.[1]).toEqual({kind: "acquire"});
    });

    it("close同步封住新控制写，并等待同generation borrowed metadata settle后才释放Occupancy", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "metadata-close-race");
        let notifyEntered: (() => void) | null = null;
        const entered = new Promise<void>((resolve) => {
            notifyEntered = resolve;
        });
        let releaseUpdate: (() => void) | null = null;
        const updateGate = new Promise<void>((resolve) => {
            releaseUpdate = resolve;
        });
        const lifecycle = controlLifecycle(prepared, {
            updateMetadata: vi.fn(async (input, access) => {
                if (!access || access.kind !== "borrowed") {
                    throw new Error("测试预期运行中metadata借用Occupancy");
                }
                access.assertActive();
                notifyEntered?.();
                await updateGate;
                access.assertActive();
                return {
                    revision: 2,
                    project: projectEntry(input.ref, input.title ?? "Updated"),
                };
            }),
        });
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("metadata-close-race");
        await service.openProject(ref, {kind: "user"});

        const updating = service.updateProjectMetadata({ref, title: "Updated"});
        await entered;
        const closing = service.closeProject(ref, "shutdown");

        await expect(service.updateProjectMetadata({ref, summary: "Too late"}))
            .rejects.toBeInstanceOf(ProjectNotOpenError);
        await expect(service.openProjectControl(ref, {kind: "user"}))
            .rejects.toBeInstanceOf(ProjectNotOpenError);
        expect(() => service.requireReadyProject(ref)).toThrow(ProjectNotOpenError);
        expect(service.projectOccupancy(ref)).toBeNull();
        expect(service.listOpenProjects()).toEqual([]);
        expect(prepared.occupancy.release).not.toHaveBeenCalled();

        releaseUpdate?.();
        await expect(updating).resolves.toMatchObject({revision: 2});
        await closing;
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("迟到旧list snapshot不能回退ready generation的publication revision", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "publication-order");
        const ref = prepared.workspace.ref;
        const listEntered = deferred<void>();
        const releaseList = deferred<void>();
        const lifecycle = controlLifecycle(prepared, {
            readProjects: vi.fn(async () => {
                listEntered.resolve(undefined);
                await releaseList.promise;
                return {
                    revision: 2,
                    projects: [projectEntry(ref, "Older")],
                };
            }),
            updateMetadata: vi.fn(async () => ({
                revision: 3,
                project: projectEntry(ref, "Newest"),
            })),
        });
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        await service.openProject(ref, {kind: "user"});

        const lateList = service.listProjects();
        await listEntered.promise;
        await service.updateProjectMetadata({ref, title: "Newest"});
        releaseList.resolve(undefined);
        await lateList;

        await expect(service.openProjectControl(ref, {kind: "user"})).resolves.toMatchObject({
            publication: {
                revision: 3,
                change: "none",
                project: {title: "Newest"},
            },
        });
    });

    it("shutdown先启动Lifecycle abort，再等待borrowed metadata并释放Runtime Occupancy", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "shutdown-abort");
        const updateEntered = deferred<void>();
        const abortUpdate = deferred<void>();
        const lifecycle = controlLifecycle(prepared, {
            updateMetadata: vi.fn(async () => {
                updateEntered.resolve(undefined);
                await abortUpdate.promise;
                throw new Error("Lifecycle已取消metadata写入");
            }),
            close: vi.fn(async () => {
                abortUpdate.resolve(undefined);
            }),
        });
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = prepared.workspace.ref;
        await service.openProject(ref, {kind: "user"});
        const updating = service.updateProjectMetadata({ref, title: "Never committed"});
        await updateEntered.promise;

        const closing = service.closeAll();
        expect(lifecycle.close).toHaveBeenCalledTimes(1);
        await expect(updating).rejects.toThrow("Lifecycle已取消metadata写入");
        await closing;
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("opening required Module等待AbortSignal时，显式close从handoff直接取消generation", async () => {
        const moduleStarted = deferred<void>();
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            {
                token: projectModuleToken("history", "required"),
                start: ({signal}) => ({
                    ready: new Promise<void>((_resolve, reject) => {
                        const rejectAborted = () => reject(
                            signal.reason instanceof Error ? signal.reason : new Error("ProjectSession已取消"),
                        );
                        if (signal.aborted) {
                            rejectAborted();
                            return;
                        }
                        signal.addEventListener("abort", rejectAborted, {once: true});
                        moduleStarted.resolve(undefined);
                    }),
                    close: async () => undefined,
                }),
            },
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "opening-abort");
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = prepared.workspace.ref;

        const opening = service.openProject(ref, {kind: "user"});
        await moduleStarted.promise;
        const updating = service.updateProjectMetadata({ref, title: "Must not write"});
        const closing = service.closeProject(ref, "shutdown");

        await expect(opening).rejects.toThrow();
        await expect(updating).rejects.toBeInstanceOf(ProjectNotOpenError);
        await closing;
        expect(lifecycle.updateMetadata).not.toHaveBeenCalled();
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
        expect(() => service.requireReadyProject(ref)).toThrow(ProjectNotOpenError);
    });

    it("sweep局部失败仍清除已经释放的早先generation，允许该Project重新open", async () => {
        let failSecondClose = true;
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            {
                token: projectModuleToken("file-index", "required"),
                start: ({prepared}) => ({
                    ready: Promise.resolve(),
                    close: async () => {
                        if (prepared.workspace.ref.projectRoot === "sweep-b" && failSecondClose) {
                            throw new Error("sweep-b close failed");
                        }
                    },
                }),
            },
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const seed = preparedProject(workspaceRoot, "sweep-a");
        const lifecycle = controlLifecycle(seed, {
            prepareOpen: vi.fn(async (ref) => preparedProject(workspaceRoot, ref.projectRoot)),
        });
        let now = 1_000;
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime({now: () => now, graceMs: 100}),
        });
        const firstRef = projectWorkspaceRef("sweep-a");
        const secondRef = projectWorkspaceRef("sweep-b");
        const firstGeneration = await service.openProject(firstRef, {kind: "user"});
        await service.openProject(secondRef, {kind: "user"});
        await service.sweepProjectSessions(now);

        now += 101;
        await expect(service.sweepProjectSessions(now)).rejects.toThrow("Module关闭失败");
        expect(() => service.requireReadyProject(firstRef)).toThrow(ProjectNotOpenError);
        const reopened = await service.openProject(firstRef, {kind: "user"});
        expect(reopened.generation).toBeGreaterThan(firstGeneration.generation);

        failSecondClose = false;
        await service.closeProject(firstRef, "shutdown");
        await service.closeProject(secondRef, "shutdown");
    });

    it("maintenance sweep gate不隐藏ready数据面，结束后只释放自己的token", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "maintenance-data-plane");
        const runtime = new ProjectSessionRuntime();
        const updateEntered = deferred<void>();
        const releaseUpdate = deferred<void>();
        const sweepEntered = deferred<void>();
        const releaseSweep = deferred<void>();
        const lifecycle = controlLifecycle(prepared, {
            updateMetadata: vi.fn(async (input, access) => {
                if (!access || access.kind !== "borrowed") {
                    throw new Error("测试预期maintenance期间保留borrowed access");
                }
                access.assertActive();
                updateEntered.resolve(undefined);
                await releaseUpdate.promise;
                access.assertActive();
                return {revision: 2, project: projectEntry(input.ref, input.title ?? "Updated")};
            }),
        });
        vi.spyOn(runtime, "sweepProjectSessions").mockImplementationOnce(async () => {
            sweepEntered.resolve(undefined);
            await releaseSweep.promise;
            return [];
        });
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime,
        });
        const ref = prepared.workspace.ref;
        const ready = await service.openProject(ref, {kind: "user"});

        const updating = service.updateProjectMetadata({ref, title: "Updated"});
        await updateEntered.promise;
        const sweeping = service.sweepProjectSessions();
        await expect(service.updateProjectMetadata({ref, summary: "Too late"}))
            .rejects.toBeInstanceOf(ProjectNotOpenError);
        expect(service.requireReadyProject(ref)).toBe(ready);
        await expect(service.openProjectControl(ref, {kind: "user"})).resolves.toMatchObject({ready});

        releaseUpdate.resolve(undefined);
        await expect(updating).resolves.toMatchObject({revision: 2});
        await sweepEntered.promise;
        expect(service.requireReadyProject(ref)).toBe(ready);
        await expect(service.openProjectControl(ref, {kind: "user"})).resolves.toMatchObject({ready});

        releaseSweep.resolve(undefined);
        await sweeping;
        expect(service.requireReadyProject(ref)).toBe(ready);
    });

    it("sweep只释放自己的临时gate，不会覆盖并发显式close的generation gate", async () => {
        let notifyCloseEntered: (() => void) | null = null;
        const closeEntered = new Promise<void>((resolve) => {
            notifyCloseEntered = resolve;
        });
        let releaseClose: (() => void) | null = null;
        const closeGate = new Promise<void>((resolve) => {
            releaseClose = resolve;
        });
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            {
                token: projectModuleToken("file-index", "required"),
                start: () => ({
                    ready: Promise.resolve(),
                    close: async () => {
                        notifyCloseEntered?.();
                        await closeGate;
                    },
                }),
            },
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "sweep-close-race");
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle: controlLifecycle(prepared),
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("sweep-close-race");
        await service.openProject(ref, {kind: "user"});

        const closing = service.closeProject(ref, "shutdown");
        await closeEntered;
        await expect(service.sweepProjectSessions()).resolves.toEqual([]);
        await expect(service.openProjectControl(ref, {kind: "user"}))
            .rejects.toBeInstanceOf(ProjectNotOpenError);

        releaseClose?.();
        await closing;
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("ready数据面通过Service取得精确presence，close成功后才移除entry", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "close-entry");
        const lifecycle = controlLifecycle(prepared);
        const runtime = new ProjectSessionRuntime();
        const service = new ProjectSessionService(workspaceRoot, {lifecycle, runtime});
        const ref = projectWorkspaceRef("close-entry");
        const ready = await service.openProject(ref, {kind: "user"});

        const release = service.acquireUserPresence(ref);
        expect(service.projectPresence(ref)).toMatchObject({state: "open", userConnections: 1});
        release();
        expect(service.projectPresence(ref).state).toBe("grace");

        await service.closeProject(ref, "shutdown");
        expect(() => service.requireReadyProject(ref)).toThrow();
        expect(() => runtime.requireReadyProject(ready.workspace.key)).toThrow();
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("root replacement先封门并等待已登记数据面operation后关闭同一generation", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            recordingModule("database", closeOrder),
            recordingModule("history", closeOrder),
            recordingModule("file-index", closeOrder),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "externally-replaced");
        let notifyReplaced: (() => void) | null = null;
        const stopObservation = vi.fn();
        const lifecycle = controlLifecycle(prepared, {
            observeWorkspace: vi.fn((_workspace, listener) => {
                notifyReplaced = listener;
                return stopObservation;
            }),
        });
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("externally-replaced");
        const ready = await service.openProject(ref, {kind: "user"});
        let releaseOperation: () => void = () => undefined;
        const pause = new Promise<void>((resolve) => {
            releaseOperation = resolve;
        });
        const operation = service.runReadyProjectOperation(ready, async () => {
            await pause;
            closeOrder.push("operation");
        });

        notifyReplaced?.();

        const rejectedCallback = vi.fn();
        await expect(service.runReadyProjectOperation(ready, async () => {
            rejectedCallback();
        })).rejects.toMatchObject({code: "PROJECT_NOT_OPEN"});
        expect(rejectedCallback).not.toHaveBeenCalled();
        expect(prepared.occupancy.release).not.toHaveBeenCalled();
        expect(closeOrder).toEqual([]);

        releaseOperation();
        await operation;

        await vi.waitFor(() => {
            expect(() => service.requireReadyProject(ref)).toThrow();
            expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
        });
        expect(closeOrder).toEqual(["operation", "file-index", "history", "database"]);
        expect(stopObservation).toHaveBeenCalledTimes(1);
    });

    it("close失败保留Facade entry并阻止重开，重试命中原handle", async () => {
        let closeFails = true;
        const close = vi.fn(async () => {
            if (closeFails) {
                throw new Error("file-index close failed");
            }
        });
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            {
                token: projectModuleToken("file-index", "required"),
                start: () => ({ready: Promise.resolve(), close}),
            },
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "close-retry");
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("close-retry");
        await service.openProject(ref, {kind: "user"});

        await expect(service.closeProject(ref, "shutdown")).rejects.toThrow("Module关闭失败");
        await expect(service.openProject(ref, {kind: "user"})).rejects.toThrow();
        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);

        closeFails = false;
        await service.closeProject(ref, "shutdown");
        expect(close).toHaveBeenCalledTimes(2);
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("Occupancy release失败后delete由Facade fail closed，不进入Lifecycle删除事务", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "release-failed-delete");
        vi.mocked(prepared.occupancy.release).mockRejectedValueOnce(new Error("occupancy release failed"));
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = prepared.workspace.ref;
        await service.openProject(ref, {kind: "user"});

        await expect(service.closeProject(ref, "delete")).rejects.toMatchObject({
            code: "PROJECT_LOCK_RELEASE_FAILED",
            projectRoot: "release-failed-delete",
        });
        await expect(service.deleteProject(ref)).rejects.toMatchObject({code: "PROJECT_IN_USE"});
        expect(lifecycle.delete).not.toHaveBeenCalled();
        await expect(service.openProject(ref, {kind: "user"})).rejects.toBeInstanceOf(ProjectNotOpenError);
    });

    it("shutdown同步拒绝新open，关闭Runtime与Lifecycle后幂等完成", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "shutdown-service");
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("shutdown-service");
        await service.openProject(ref, {kind: "user"});

        const shutdown = service.closeAll();
        await expect(service.openProject(projectWorkspaceRef("late-open"), {kind: "user"})).rejects.toThrow("Runtime已关闭");
        await shutdown;
        await service.closeAll();

        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);
        expect(lifecycle.close).toHaveBeenCalledTimes(1);
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("closeAll重试只重关失败Module，Lifecycle close与Occupancy release各执行一次", async () => {
        let historyCloseFails = true;
        const databaseClose = vi.fn(async () => undefined);
        const historyClose = vi.fn(async () => {
            if (historyCloseFails) {
                throw new Error("history close failed");
            }
        });
        const fileIndexClose = vi.fn(async () => undefined);
        restores.push(replaceProjectModulesForTest([
            {
                token: projectModuleToken("database", "required"),
                start: () => ({ready: Promise.resolve(), close: databaseClose}),
            },
            {
                token: projectModuleToken("history", "required"),
                start: () => ({ready: Promise.resolve(), close: historyClose}),
            },
            {
                token: projectModuleToken("file-index", "required"),
                start: () => ({ready: Promise.resolve(), close: fileIndexClose}),
            },
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "shutdown-retry");
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        await service.openProject(prepared.workspace.ref, {kind: "user"});

        await expect(service.closeAll()).rejects.toBeInstanceOf(AggregateError);
        expect(prepared.occupancy.release).not.toHaveBeenCalled();
        historyCloseFails = false;
        await service.closeAll();

        expect(fileIndexClose).toHaveBeenCalledTimes(1);
        expect(historyClose).toHaveBeenCalledTimes(2);
        expect(databaseClose).toHaveBeenCalledTimes(1);
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
        expect(lifecycle.close).toHaveBeenCalledTimes(1);
    });

    it("Module数据面按exact ready generation取得required handle并单飞激活lazy handle", async () => {
        interface TaggedHandle extends ProjectModuleHandle {
            readonly tag: string;
        }
        const databaseToken = projectModuleToken<TaggedHandle>("database", "required");
        const lazyToken = projectModuleToken<TaggedHandle>("agent-sql", "lazy");
        const databaseHandle: TaggedHandle = {
            tag: "database-generation",
            ready: Promise.resolve(),
            close: async () => undefined,
        };
        const lazyClose = vi.fn(async () => undefined);
        const lazyHandle: TaggedHandle = {
            tag: "agent-sql-generation",
            ready: Promise.resolve(),
            close: lazyClose,
        };
        const lazyStart = vi.fn(() => lazyHandle);
        restores.push(replaceProjectModulesForTest([
            {token: databaseToken, start: () => databaseHandle},
            immediateModule("history"),
            immediateModule("file-index"),
            {token: lazyToken, start: lazyStart},
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "module-data-plane");
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle: controlLifecycle(prepared),
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("module-data-plane");
        const ready = await service.openProject(ref, {kind: "user"});

        expect(service.requireReadyModuleHandle(ready, databaseToken)).toBe(databaseHandle);
        const [first, second] = await Promise.all([
            service.activateReadyProjectModule(ready, lazyToken),
            service.activateReadyProjectModule(ready, lazyToken),
        ]);
        expect(first).toBe(lazyHandle);
        expect(second).toBe(lazyHandle);
        expect(lazyStart).toHaveBeenCalledTimes(1);

        await service.closeProject(ref, "shutdown");
        expect(lazyClose).toHaveBeenCalledTimes(1);
    });

    it("opening回滚失败保留Facade locator，targeted close重试原handle后释放Occupancy", async () => {
        let fileIndexCloseFails = true;
        const fileIndexClose = vi.fn(async () => {
            if (fileIndexCloseFails) {
                throw new Error("file-index close failed");
            }
        });
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            {
                token: projectModuleToken("history", "required"),
                start: () => ({
                    ready: Promise.reject(new Error("history ready failed")),
                    close: async () => undefined,
                }),
            },
            {
                token: projectModuleToken("file-index", "required"),
                start: () => ({ready: Promise.resolve(), close: fileIndexClose}),
            },
        ]));
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "opening-cleanup");
        const lifecycle = controlLifecycle(prepared);
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("opening-cleanup");

        await expect(service.openProject(ref, {kind: "user"})).rejects.toBeInstanceOf(ProjectSessionCloseError);
        expect(fileIndexClose).toHaveBeenCalledTimes(1);
        expect(prepared.occupancy.release).not.toHaveBeenCalled();

        fileIndexCloseFails = false;
        await service.closeProject(ref, "shutdown");
        expect(fileIndexClose).toHaveBeenCalledTimes(2);
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);
    });

    it("list与sweep只投影Runtime presence，grace关闭后同步移除Facade entry", async () => {
        restores.push(replaceProjectModulesForTest([
            immediateModule("database"),
            immediateModule("history"),
            immediateModule("file-index"),
        ]));
        let now = 3_000;
        let agentActive = true;
        const workspaceRoot = testAbsoluteFsPath("project-session-service", "workspace-root");
        const prepared = preparedProject(workspaceRoot, "service-sweep");
        const runtime = new ProjectSessionRuntime({now: () => now, graceMs: 100});
        const service = new ProjectSessionService(workspaceRoot, {
            lifecycle: controlLifecycle(prepared),
            runtime,
        });
        const ref = projectWorkspaceRef("service-sweep");
        const ready = await service.openProject(ref, {kind: "agent", sessionId: 3});
        service.registerAgentPresenceProbe((candidate) => candidate === ready && agentActive);

        expect(service.listOpenProjects()).toEqual([{
            ref,
            state: "open",
            userConnections: 0,
            agentActive: true,
            openedAt: new Date(3_000).toISOString(),
            lastActivityAt: new Date(3_000).toISOString(),
        }]);

        now = 3_010;
        service.markProjectActivity(ref);
        agentActive = false;
        await expect(service.sweepProjectSessions(now)).resolves.toEqual([]);
        expect(service.projectOccupancy(ref)).toMatchObject({state: "grace", agentActive: false});

        now = 3_111;
        await expect(service.sweepProjectSessions(now)).resolves.toEqual([ref]);
        expect(service.projectOccupancy(ref)).toBeNull();
        expect(service.listOpenProjects()).toEqual([]);
    });
});

/** 建立同步ready且无持久资源的required Module。 */
function immediateModule(
    name: Extract<ProjectModuleName, "database" | "history" | "file-index">,
    onMutation?: () => void,
): ProjectModule {
    return {
        token: projectModuleToken(name, "required"),
        start: () => ({
            ready: Promise.resolve(),
            close: async () => undefined,
            mutate: async <TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> => {
                onMutation?.();
                return operation();
            },
        }),
    };
}

/** 建立同步ready并记录精确handle关闭顺序的required Module。 */
function recordingModule(
    name: Extract<ProjectModuleName, "database" | "history" | "file-index">,
    closeOrder: string[],
): ProjectModule {
    return {
        token: projectModuleToken(name, "required"),
        start: () => ({
            ready: Promise.resolve(),
            mutate: async <TResult>(operation: () => TResult | Promise<TResult>): Promise<TResult> => operation(),
            close: async () => {
                closeOrder.push(name);
            },
        }),
    };
}

/** 建立无需真实文件系统与proper-lockfile的Lifecycle handoff。 */
function preparedProject(workspaceRoot: ReturnType<typeof absoluteFsPath>, projectRoot: string): PreparedProjectOpen {
    const ref = projectWorkspaceRef(projectRoot);
    const workspace = resolvedProjectWorkspace(
        ref,
        absoluteFsPath(`${workspaceRoot}/${projectRoot}`),
        createProjectWorkspaceKey(workspaceRoot, ref),
    );
    const occupancy: ProjectOccupancyHandle = {
        kind: "project-occupancy",
        compromised: new Promise<never>(() => undefined),
        assertHealthy: () => undefined,
        release: vi.fn(async () => undefined),
    };
    return {
        revision: 1,
        project: projectEntry(ref, projectRoot),
        change: "none",
        workspaceRoot,
        workspace,
        occupancy,
    };
}

/** 建立完整控制面port，测试只覆盖需要定制的Lifecycle意图。 */
function controlLifecycle(
    prepared: PreparedProjectOpen,
    overrides: Partial<ProjectControlLifecycle> = {},
): ProjectControlLifecycle {
    return {
        readProjects: vi.fn(async () => ({
            revision: prepared.revision,
            projects: Object.freeze([prepared.project]),
        })),
        readCandidates: vi.fn(async () => ({revision: prepared.revision, candidates: Object.freeze([])})),
        create: vi.fn(async () => ({revision: prepared.revision, project: prepared.project})),
        updateMetadata: vi.fn(async (input) => ({
            revision: prepared.revision + 1,
            project: projectEntry(input.ref, input.title ?? prepared.project.title, input.summary ?? prepared.project.summary),
        })),
        delete: vi.fn(async (ref) => ({revision: prepared.revision + 1, projectRoot: ref.projectRoot})),
        prepareOpen: vi.fn(async () => prepared),
        observeWorkspace: vi.fn(() => () => undefined),
        close: vi.fn(async () => undefined),
        ...overrides,
    };
}

/** 建立轻量Project metadata fixture。 */
function projectEntry(
    ref: ReturnType<typeof projectWorkspaceRef>,
    title: string,
    summary = "",
): ProjectListEntry {
    return Object.freeze({...ref, kind: "novel", title, summary});
}

/** 建立可由测试精确推进的Promise门。 */
function deferred<T>(): {promise: Promise<T>; resolve(value: T): void} {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((promiseResolve) => {
        resolve = promiseResolve;
    });
    return {promise, resolve};
}
