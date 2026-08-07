import {afterEach, describe, expect, it, vi} from "vitest";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";
import type {PreparedProjectOpen} from "nbook/server/workspace-files/project-lifecycle";
import {
    ProjectLockCompromisedError,
    ProjectLockReleaseFailedError,
    type ProjectOccupancyHandle,
} from "nbook/server/workspace-files/project-lock";
import {
    replaceProjectModulesForTest,
    projectModuleToken,
    type ProjectModule,
    type ProjectModuleHandle,
    type ProjectModuleName,
} from "nbook/server/workspace-files/project-module";
import {
    ProjectSessionCloseError,
    ProjectSessionExistsError,
    ProjectSessionOpenError,
    ProjectSessionRuntimeClosedError,
    ProjectSessionRuntime,
    ProjectNotReadyError,
} from "nbook/server/workspace-files/project-session-runtime";

describe("ProjectSessionRuntime", () => {
    const restores: Array<() => void> = [];

    afterEach(() => {
        while (restores.length > 0) {
            restores.pop()?.();
        }
    });

    it("全部required Module最低ready前不对strict-open可见，完成后原子发布ready", async () => {
        const database = deferredModule("database");
        const history = deferredModule("history");
        const fileIndex = deferredModule("file-index");
        restores.push(replaceProjectModulesForTest([database.module, history.module, fileIndex.module]));
        const occupancy = occupancyHandle();
        const prepared = preparedProject("atomic-ready", occupancy.handle);
        const runtime = new ProjectSessionRuntime();

        const opening = runtime.adoptPreparedProject(prepared, {kind: "user"});

        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
        database.resolve();
        history.resolve();
        await Promise.resolve();
        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);

        fileIndex.resolve();
        const ready = await opening;

        expect(runtime.requireReadyProject(prepared.workspace.key)).toBe(ready);
        expect(ready.workspace).toBe(prepared.workspace);
        expect(occupancy.release).not.toHaveBeenCalled();
    });

    it("首个ready失败立即abort，等全部settle后按依赖逆序回滚再释放Occupancy", async () => {
        const closeOrder: string[] = [];
        const database = controlledModule("database", closeOrder);
        const history = controlledModule("history", closeOrder);
        const fileIndex = controlledModule("file-index", closeOrder);
        restores.push(replaceProjectModulesForTest([database.module, history.module, fileIndex.module]));
        const occupancy = occupancyHandle(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("failed-ready", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const opening = runtime.adoptPreparedProject(prepared, {kind: "user"});
        const settled = vi.fn();
        void opening.then(settled, settled);
        const failure = new Error("history open failed");

        history.reject(failure);
        await Promise.resolve();

        expect(history.signal?.aborted).toBe(true);
        expect(database.signal).toBe(history.signal);
        expect(fileIndex.signal).toBe(history.signal);
        expect(settled).not.toHaveBeenCalled();
        expect(closeOrder).toEqual([]);

        database.resolve();
        fileIndex.resolve();

        await expect(opening).rejects.toMatchObject({
            code: "PROJECT_SESSION_OPEN_FAILED",
            projectRoot: "failed-ready",
            cause: failure,
        });
        expect(closeOrder).toEqual(["file-index", "history", "database", "occupancy"]);
        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
    });

    it("required Module同步启动失败时关闭已捕获handle并释放Occupancy", async () => {
        const closeOrder: string[] = [];
        const database = controlledModule("database", closeOrder);
        const startFailure = new Error("history start failed");
        const history: ProjectModule = {
            token: projectModuleToken("history", "required"),
            start: () => {
                throw startFailure;
            },
        };
        const fileIndex = immediateModule("file-index", closeOrder);
        restores.push(replaceProjectModulesForTest([database.module, history, fileIndex]));
        const occupancy = occupancyHandle(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("failed-start", occupancy.handle);
        const runtime = new ProjectSessionRuntime();

        const opening = runtime.adoptPreparedProject(prepared, {kind: "user"});
        const settled = vi.fn();
        void opening.then(settled, settled);

        await Promise.resolve();
        expect(database.signal?.aborted).toBe(true);
        expect(settled).not.toHaveBeenCalled();
        expect(closeOrder).toEqual([]);
        expect(occupancy.release).not.toHaveBeenCalled();

        database.resolve();
        await expect(opening).rejects.toMatchObject({
            code: "PROJECT_SESSION_OPEN_FAILED",
            projectRoot: "failed-start",
            cause: startFailure,
        });

        expect(closeOrder).toEqual(["database", "occupancy"]);
        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
    });

    it("registry raw failure在完整回滚后归一为ProjectSessionOpenError", async () => {
        const registryFailure = new Error("registry unavailable");
        const occupancy = occupancyHandle();
        const prepared = preparedProject("registry-failed", occupancy.handle);
        const runtime = new ProjectSessionRuntime({
            registryProvider: () => {
                throw registryFailure;
            },
        });

        const failure = await runtime.adoptPreparedProject(prepared, {kind: "user"})
            .catch((error: Error) => error);
        expect(failure).toBeInstanceOf(ProjectSessionOpenError);
        expect(failure).toMatchObject({
            code: "PROJECT_SESSION_OPEN_FAILED",
            statusCode: 500,
            projectRoot: "registry-failed",
            cause: registryFailure,
        });
        expect(occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("拒绝重复generation时释放尚未接管的新Occupancy", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            immediateModule("database", closeOrder),
            immediateModule("history", closeOrder),
            immediateModule("file-index", closeOrder),
        ]));
        const runtime = new ProjectSessionRuntime();
        const first = preparedProject("duplicate-generation", occupancyHandle().handle);
        await runtime.adoptPreparedProject(first, {kind: "user"});
        const rejectedOccupancy = occupancyHandle(() => closeOrder.push("rejected-occupancy"));
        const duplicate = preparedProject("duplicate-generation", rejectedOccupancy.handle);

        const existsFailure = await runtime.adoptPreparedProject(duplicate, {kind: "user"})
            .catch((error: Error) => error);
        expect(existsFailure).toBeInstanceOf(ProjectSessionExistsError);
        expect(existsFailure).toMatchObject({code: "PROJECT_SESSION_EXISTS", statusCode: 409});

        expect(rejectedOccupancy.release).toHaveBeenCalledTimes(1);
        expect(closeOrder).toEqual(["rejected-occupancy"]);
    });

    it("拒绝重复generation时raw Occupancy release失败以typed lock error为顶层", async () => {
        restores.push(replaceProjectModulesForTest(requiredModules()));
        const runtime = new ProjectSessionRuntime();
        const first = preparedProject("duplicate-release-failed", occupancyHandle().handle);
        await runtime.adoptPreparedProject(first, {kind: "user"});
        const rawReleaseFailure = new Error("raw release failure");
        const release = vi.fn(async () => {
            throw rawReleaseFailure;
        });
        const duplicate = preparedProject(
            "duplicate-release-failed",
            occupancyHandleWithRelease(release),
        );

        await expect(runtime.adoptPreparedProject(duplicate, {kind: "user"})).rejects.toMatchObject({
            code: "PROJECT_LOCK_RELEASE_FAILED",
            projectRoot: "duplicate-release-failed",
        });
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("ready generation开始close即从strict-open消失，按逆序关闭精确handles后释放Occupancy", async () => {
        const closeOrder: string[] = [];
        const database = immediateModule("database", closeOrder);
        const history = immediateModule("history", closeOrder);
        const fileIndex = immediateModule("file-index", closeOrder);
        restores.push(replaceProjectModulesForTest([database, history, fileIndex]));
        const occupancy = occupancyHandle(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("normal-close", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});

        const closing = runtime.closeProject(ready, "shutdown");

        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
        await closing;
        expect(closeOrder).toEqual(["file-index", "history", "database", "occupancy"]);
        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
    });

    it("close同步封住新数据面并等待已登记operation settle后才关闭Module与释放Occupancy", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            immediateModule("database", closeOrder),
            immediateModule("history", closeOrder),
            immediateModule("file-index", closeOrder),
        ]));
        const occupancy = occupancyHandle(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("operation-drain", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});
        let releaseOperation: () => void = () => undefined;
        const pause = new Promise<void>((resolve) => {
            releaseOperation = resolve;
        });
        const operationStarted = vi.fn();
        let operationSignal: AbortSignal | null = null;
        const operation = runtime.runProjectOperation(ready, async (signal) => {
            operationSignal = signal;
            operationStarted();
            await pause;
            closeOrder.push("operation");
            return "done";
        });

        const closing = runtime.closeProject(ready, "shutdown");
        const rejectedCallback = vi.fn();

        expect(operationStarted).toHaveBeenCalledOnce();
        expect(operationSignal?.aborted).toBe(true);
        await expect(runtime.runProjectOperation(ready, async () => {
            rejectedCallback();
        })).rejects.toBeInstanceOf(ProjectNotReadyError);
        expect(rejectedCallback).not.toHaveBeenCalled();
        expect(closeOrder).toEqual([]);
        expect(occupancy.release).not.toHaveBeenCalled();

        releaseOperation();
        await expect(operation).resolves.toBe("done");
        await closing;

        expect(closeOrder).toEqual(["operation", "file-index", "history", "database", "occupancy"]);
    });

    it("长生命周期start同步返回result并在close abort后以completion解除drain", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            immediateModule("database", closeOrder),
            immediateModule("history", closeOrder),
            immediateModule("file-index", closeOrder),
        ]));
        const occupancy = occupancyHandle(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("operation-terminal", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});
        let resolveTerminal: () => void = () => undefined;
        const terminal = new Promise<void>((resolve) => {
            resolveTerminal = resolve;
        });
        const start = vi.fn((signal: AbortSignal) => {
            signal.addEventListener("abort", () => {
                closeOrder.push("operation-abort");
                resolveTerminal();
            }, {once: true});
            return {result: 73, completion: terminal};
        });

        const runId = runtime.startProjectOperation(ready, start);
        const closing = runtime.closeProject(ready, "shutdown");

        expect(runId).toBe(73);
        expect(start).toHaveBeenCalledOnce();
        await closing;
        expect(closeOrder).toEqual([
            "operation-abort",
            "file-index",
            "history",
            "database",
            "occupancy",
        ]);

        const rejectedStart = vi.fn(() => ({result: 74, completion: Promise.resolve()}));
        expect(() => runtime.startProjectOperation(ready, rejectedStart)).toThrow(ProjectNotReadyError);
        expect(rejectedStart).not.toHaveBeenCalled();
    });

    it("同路径重开后旧ReadyProjectSessionRef不能把operation登记到latest generation", async () => {
        restores.push(replaceProjectModulesForTest(requiredModules()));
        const runtime = new ProjectSessionRuntime();
        const firstPrepared = preparedProject("operation-generation", occupancyHandle().handle);
        const first = await runtime.adoptPreparedProject(firstPrepared, {kind: "user"});
        await runtime.closeProject(first, "shutdown");
        const secondPrepared = preparedProject("operation-generation", occupancyHandle().handle);
        const second = await runtime.adoptPreparedProject(secondPrepared, {kind: "user"});
        const oldCallback = vi.fn();
        const currentCallback = vi.fn(async () => "current");

        await expect(runtime.runProjectOperation(first, async () => {
            oldCallback();
        })).rejects.toBeInstanceOf(ProjectNotReadyError);
        await expect(runtime.runProjectOperation(second, currentCallback)).resolves.toBe("current");

        expect(oldCallback).not.toHaveBeenCalled();
        expect(currentCallback).toHaveBeenCalledOnce();
        await runtime.closeProject(second, "shutdown");
    });

    it("close失败保留原generation，registry替换后只重试失败的旧handle", async () => {
        const attempts = new Map<ProjectModuleName, number>();
        let historyFails = true;
        const oldModules = [
            countedModule("database", attempts, () => false),
            countedModule("history", attempts, () => historyFails),
            countedModule("file-index", attempts, () => false),
        ];
        restores.push(replaceProjectModulesForTest(oldModules));
        const occupancy = occupancyHandle();
        const prepared = preparedProject("close-retry", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});

        await expect(runtime.closeProject(ready, "shutdown")).rejects.toBeInstanceOf(ProjectSessionCloseError);
        expect(attempts).toEqual(new Map<ProjectModuleName, number>([
            ["file-index", 1],
            ["history", 1],
            ["database", 1],
        ]));
        expect(occupancy.release).not.toHaveBeenCalled();

        const replacementAttempts = new Map<ProjectModuleName, number>();
        restores.push(replaceProjectModulesForTest([
            countedModule("database", replacementAttempts, () => false),
            countedModule("history", replacementAttempts, () => false),
            countedModule("file-index", replacementAttempts, () => false),
        ]));
        historyFails = false;

        await runtime.closeProject(ready, "shutdown");

        expect(attempts.get("database")).toBe(1);
        expect(attempts.get("file-index")).toBe(1);
        expect(attempts.get("history")).toBe(2);
        expect(replacementAttempts.size).toBe(0);
        expect(occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("lazy Module首次请求同步捕获handle，并发请求共享同一ready", async () => {
        const required = requiredModules();
        let resolveLazy: () => void = () => undefined;
        const lazyReady = new Promise<void>((resolve) => {
            resolveLazy = resolve;
        });
        const lazyHandle: TaggedModuleHandle = {
            tag: "plot-generation-1",
            ready: lazyReady,
            close: async () => undefined,
        };
        const lazyToken = projectModuleToken<TaggedModuleHandle>("plot-world", "lazy");
        const start = vi.fn(() => lazyHandle);
        restores.push(replaceProjectModulesForTest([
            ...required,
            {token: lazyToken, start},
        ]));
        const prepared = preparedProject("lazy-module", occupancyHandle().handle);
        const runtime = new ProjectSessionRuntime();
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});

        expect(() => runtime.requireProjectModuleHandle(ready, lazyToken)).toThrow(ProjectNotReadyError);
        const first = runtime.activateProjectModule(ready, lazyToken);
        const second = runtime.activateProjectModule(ready, lazyToken);

        expect(start).toHaveBeenCalledTimes(1);
        resolveLazy();
        await expect(first).resolves.toBe(lazyHandle);
        await expect(second).resolves.toBe(lazyHandle);
        expect(runtime.requireProjectModuleHandle(ready, lazyToken)).toBe(lazyHandle);
    });

    it("shutdown拒绝新generation，abort opening并等全部settle回滚后才完成", async () => {
        const closeOrder: string[] = [];
        const database = controlledModule("database", closeOrder);
        const history = controlledModule("history", closeOrder);
        const fileIndex = controlledModule("file-index", closeOrder);
        restores.push(replaceProjectModulesForTest([database.module, history.module, fileIndex.module]));
        const occupancy = occupancyHandle(() => closeOrder.push("opening-occupancy"));
        const prepared = preparedProject("shutdown-opening", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const opening = runtime.adoptPreparedProject(prepared, {kind: "user"});
        const openingObserved = opening.catch((error: Error) => error);

        const shutdown = runtime.closeAll();
        const rejectedOccupancy = occupancyHandle(() => closeOrder.push("rejected-occupancy"));
        const rejectedOpen = runtime.adoptPreparedProject(
            preparedProject("shutdown-rejected", rejectedOccupancy.handle),
            {kind: "user"},
        );

        expect(database.signal?.aborted).toBe(true);
        await expect(rejectedOpen).rejects.toBeInstanceOf(ProjectSessionRuntimeClosedError);
        expect(rejectedOccupancy.release).toHaveBeenCalledTimes(1);

        database.resolve();
        history.resolve();
        fileIndex.resolve();

        await expect(openingObserved).resolves.toBeInstanceOf(ProjectSessionRuntimeClosedError);
        await shutdown;
        expect(closeOrder).toEqual([
            "rejected-occupancy",
            "file-index",
            "history",
            "database",
            "opening-occupancy",
        ]);
    });

    it("opening期间Occupancy compromise保留既有typed错误，不包装为open failure", async () => {
        const closeOrder: string[] = [];
        const database = controlledModule("database", closeOrder);
        const history = controlledModule("history", closeOrder);
        const fileIndex = controlledModule("file-index", closeOrder);
        restores.push(replaceProjectModulesForTest([database.module, history.module, fileIndex.module]));
        const occupancy = compromisableOccupancy(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("opening-compromised", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const opening = runtime.adoptPreparedProject(prepared, {kind: "user"});
        const failure = new ProjectLockCompromisedError("occupancy lost", new Error("heartbeat failed"));

        occupancy.compromise(failure);
        await Promise.resolve();
        database.resolve();
        history.resolve();
        fileIndex.resolve();

        await expect(opening).rejects.toBe(failure);
        expect(closeOrder).toEqual(["file-index", "history", "database", "occupancy"]);
    });

    it("ready generation的Occupancy compromise会主动关闭并立即拒绝新数据面", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            immediateModule("database", closeOrder),
            immediateModule("history", closeOrder),
            immediateModule("file-index", closeOrder),
        ]));
        const occupancy = compromisableOccupancy(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("lock-compromised", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        await runtime.adoptPreparedProject(prepared, {kind: "user"});

        occupancy.compromise(new ProjectLockCompromisedError("occupancy lost", new Error("heartbeat failed")));
        await Promise.resolve();

        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
        await vi.waitFor(() => {
            expect(occupancy.release).toHaveBeenCalledTimes(1);
        });
        expect(closeOrder).toEqual(["file-index", "history", "database", "occupancy"]);
    });

    it("Occupancy release失败成为单次尝试的terminal状态，重试返回同一typed error", async () => {
        const attempts = new Map<ProjectModuleName, number>();
        restores.push(replaceProjectModulesForTest([
            countedModule("database", attempts, () => false),
            countedModule("history", attempts, () => false),
            countedModule("file-index", attempts, () => false),
        ]));
        const failure = new ProjectLockReleaseFailedError(
            {kind: "project-occupancy", projectRoot: "release-failed"},
            new Error("proper-lockfile release failed"),
        );
        const release = vi.fn(() => Promise.reject(failure));
        const occupancy = occupancyHandleWithRelease(release);
        const prepared = preparedProject("release-failed", occupancy);
        const runtime = new ProjectSessionRuntime();
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});

        await expect(runtime.closeProject(ready, "shutdown")).rejects.toBe(failure);
        await expect(runtime.closeProject(ready, "shutdown")).rejects.toBe(failure);

        expect(release).toHaveBeenCalledTimes(1);
        expect(attempts).toEqual(new Map<ProjectModuleName, number>([
            ["file-index", 1],
            ["history", 1],
            ["database", 1],
        ]));
        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
    });

    it("ready close遇到raw Occupancy release failure时包装typed error并sticky复用", async () => {
        restores.push(replaceProjectModulesForTest(requiredModules()));
        const rawReleaseFailure = new Error("raw ready release failure");
        const release = vi.fn(async () => {
            throw rawReleaseFailure;
        });
        const prepared = preparedProject(
            "raw-release-failed",
            occupancyHandleWithRelease(release),
        );
        const runtime = new ProjectSessionRuntime();
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});

        const firstFailure = await runtime.closeProject(ready, "shutdown").catch((error: Error) => error);
        expect(firstFailure).toMatchObject({
            code: "PROJECT_LOCK_RELEASE_FAILED",
            projectRoot: "raw-release-failed",
            cause: rawReleaseFailure,
        });
        await expect(runtime.closeProject(ready, "shutdown")).rejects.toBe(firstFailure);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("opening回滚Occupancy release失败优先返回typed lock error，已typed实例不重包", async () => {
        const openFailure = new Error("required ready failed");
        const typedReleaseFailure = new ProjectLockReleaseFailedError(
            {kind: "project-occupancy", projectRoot: "opening-release-failed"},
            new Error("proper-lockfile release failed"),
        );
        restores.push(replaceProjectModulesForTest([
            {
                token: projectModuleToken("database", "required"),
                start: () => ({ready: Promise.reject(openFailure), close: async () => undefined}),
            },
            immediateModule("history", []),
            immediateModule("file-index", []),
        ]));
        const release = vi.fn(async () => {
            throw typedReleaseFailure;
        });
        const prepared = preparedProject(
            "opening-release-failed",
            occupancyHandleWithRelease(release),
        );
        const runtime = new ProjectSessionRuntime();

        await expect(runtime.adoptPreparedProject(prepared, {kind: "user"}))
            .rejects.toBe(typedReleaseFailure);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("opening回滚close失败保留原handles，shutdown只重试未关闭handle再释放Occupancy", async () => {
        const closeOrder: string[] = [];
        const database = controlledModule("database", closeOrder);
        const history = controlledModule("history", closeOrder);
        let fileIndexFails = true;
        const fileIndex = controlledClosingModule("file-index", closeOrder, () => fileIndexFails);
        restores.push(replaceProjectModulesForTest([database.module, history.module, fileIndex.module]));
        const occupancy = occupancyHandle(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("opening-close-retry", occupancy.handle);
        const runtime = new ProjectSessionRuntime();
        const opening = runtime.adoptPreparedProject(prepared, {kind: "user"});
        const primary = new Error("history ready failed");

        history.reject(primary);
        database.resolve();
        fileIndex.resolve();

        const openingFailure = await opening.catch((error: Error) => error);
        expect(openingFailure).toBeInstanceOf(ProjectSessionCloseError);
        if (!(openingFailure instanceof ProjectSessionCloseError)) {
            throw new Error("测试预期opening rollback以ProjectSessionCloseError作为顶层");
        }
        expect(openingFailure.failures).toHaveLength(1);
        expect(closeOrder).toEqual(["file-index", "history", "database"]);
        expect(occupancy.release).not.toHaveBeenCalled();

        fileIndexFails = false;
        await runtime.closeAll();

        expect(closeOrder).toEqual(["file-index", "history", "database", "file-index", "occupancy"]);
        expect(occupancy.release).toHaveBeenCalledTimes(1);
    });

    it("用户presence归零进入grace，重连取消后再次到期才关闭同一generation", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            immediateModule("database", closeOrder),
            immediateModule("history", closeOrder),
            immediateModule("file-index", closeOrder),
        ]));
        let now = 1_000;
        const runtime = new ProjectSessionRuntime({
            now: () => now,
            graceMs: 100,
        });
        const occupancy = occupancyHandle(() => closeOrder.push("occupancy"));
        const prepared = preparedProject("presence-grace", occupancy.handle);
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});

        const releaseFirst = runtime.acquireUserPresence(ready);
        expect(runtime.projectPresence(ready)).toMatchObject({state: "open", userConnections: 1});
        releaseFirst();
        expect(runtime.projectPresence(ready)).toMatchObject({state: "grace", userConnections: 0});
        expect(runtime.requireReadyProject(prepared.workspace.key)).toBe(ready);

        now = 1_050;
        const releaseSecond = runtime.acquireUserPresence(ready);
        expect(runtime.projectPresence(ready)).toMatchObject({state: "open", userConnections: 1});
        releaseSecond();

        now = 1_151;
        await expect(runtime.sweepProjectSessions(now)).resolves.toEqual([ready]);
        expect(() => runtime.requireReadyProject(prepared.workspace.key)).toThrow(ProjectNotReadyError);
        expect(closeOrder).toEqual(["file-index", "history", "database", "occupancy"]);
    });

    it("Agent在场阻止grace，离场后开始计时且恢复时取消grace", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            immediateModule("database", closeOrder),
            immediateModule("history", closeOrder),
            immediateModule("file-index", closeOrder),
        ]));
        let now = 2_000;
        let agentActive = true;
        const runtime = new ProjectSessionRuntime({now: () => now, graceMs: 100});
        runtime.registerAgentPresenceProbe(() => agentActive);
        const prepared = preparedProject("agent-presence", occupancyHandle(() => closeOrder.push("occupancy")).handle);
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "agent", sessionId: 7});

        await expect(runtime.sweepProjectSessions(now)).resolves.toEqual([]);
        expect(runtime.projectPresence(ready)).toMatchObject({state: "open", agentActive: true});

        agentActive = false;
        await expect(runtime.sweepProjectSessions(now)).resolves.toEqual([]);
        expect(runtime.projectPresence(ready)).toMatchObject({state: "grace", agentActive: false});

        now = 2_200;
        agentActive = true;
        await expect(runtime.sweepProjectSessions(now)).resolves.toEqual([]);
        expect(runtime.projectPresence(ready)).toMatchObject({state: "open", agentActive: true});
        expect(closeOrder).toEqual([]);
    });

    it("复用当前ready generation只取消grace，不创建或替换generation", async () => {
        const closeOrder: string[] = [];
        restores.push(replaceProjectModulesForTest([
            immediateModule("database", closeOrder),
            immediateModule("history", closeOrder),
            immediateModule("file-index", closeOrder),
        ]));
        const runtime = new ProjectSessionRuntime();
        const prepared = preparedProject("reuse-ready", occupancyHandle(() => closeOrder.push("occupancy")).handle);
        const ready = await runtime.adoptPreparedProject(prepared, {kind: "user"});
        runtime.acquireUserPresence(ready)();
        expect(runtime.projectPresence(ready).state).toBe("grace");

        expect(runtime.resumeReadyProject(prepared.workspace.key)).toBe(ready);
        expect(runtime.projectPresence(ready)).toMatchObject({state: "open", userConnections: 0});
        expect(ready.generation).toBe(1);
        expect(closeOrder).toEqual([]);
    });
});

/** 测试lazy token与具体generation handle的类型绑定。 */
interface TaggedModuleHandle extends ProjectModuleHandle {
    readonly tag: string;
}

/** 建立由测试显式推进ready的required Module。 */
function deferredModule(name: Extract<ProjectModuleName, "database" | "history" | "file-index">): {
    readonly module: ProjectModule;
    readonly resolve: () => void;
} {
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });
    return {
        module: {
            token: projectModuleToken(name, "required"),
            start: () => ({
                ready,
                close: async () => undefined,
            }),
        },
        resolve: resolveReady,
    };
}

/** 建立可分别resolve/reject并记录关闭顺序的required Module。 */
function controlledModule(
    name: Extract<ProjectModuleName, "database" | "history" | "file-index">,
    closeOrder: string[],
): {
    readonly module: ProjectModule;
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
    readonly signal: AbortSignal | null;
} {
    let resolveReady: () => void = () => undefined;
    let rejectReady: (error: Error) => void = () => undefined;
    let moduleSignal: AbortSignal | null = null;
    const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    const result = {
        module: {
            token: projectModuleToken(name, "required"),
            start: (context) => {
                moduleSignal = context.signal;
                return {
                    ready,
                    close: async () => {
                        closeOrder.push(name);
                    },
                };
            },
        },
        resolve: resolveReady,
        reject: rejectReady,
        get signal() {
            return moduleSignal;
        },
    } satisfies {
        readonly module: ProjectModule;
        readonly resolve: () => void;
        readonly reject: (error: Error) => void;
        readonly signal: AbortSignal | null;
    };
    return result;
}

/** 建立ready可控、close可重试失败的required Module。 */
function controlledClosingModule(
    name: Extract<ProjectModuleName, "database" | "history" | "file-index">,
    closeOrder: string[],
    shouldFail: () => boolean,
): {
    readonly module: ProjectModule;
    readonly resolve: () => void;
} {
    let resolveReady: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
    });
    return {
        module: {
            token: projectModuleToken(name, "required"),
            start: () => ({
                ready,
                close: async () => {
                    closeOrder.push(name);
                    if (shouldFail()) {
                        throw new Error(`${name} close failed`);
                    }
                },
            }),
        },
        resolve: resolveReady,
    };
}

/** 建立立即ready且只记录自身精确close的required Module。 */
function immediateModule(
    name: Extract<ProjectModuleName, "database" | "history" | "file-index">,
    closeOrder: string[],
): ProjectModule {
    return {
        token: projectModuleToken(name, "required"),
        start: () => ({
            ready: Promise.resolve(),
            close: async () => {
                closeOrder.push(name);
            },
        }),
    };
}

/** 生成三个立即ready的required Module。 */
function requiredModules(): ProjectModule[] {
    const closeOrder: string[] = [];
    return [
        immediateModule("database", closeOrder),
        immediateModule("history", closeOrder),
        immediateModule("file-index", closeOrder),
    ];
}

/** 建立可按次数失败的close handle，用于证明generation精确重试。 */
function countedModule(
    name: Extract<ProjectModuleName, "database" | "history" | "file-index">,
    attempts: Map<ProjectModuleName, number>,
    shouldFail: () => boolean,
): ProjectModule {
    return {
        token: projectModuleToken(name, "required"),
        start: () => ({
            ready: Promise.resolve(),
            close: async () => {
                attempts.set(name, (attempts.get(name) ?? 0) + 1);
                if (shouldFail()) {
                    throw new Error(`${name} close failed`);
                }
            },
        }),
    };
}

/** 建立不主动compromise的Occupancy handle，并暴露release观测点。 */
function occupancyHandle(afterRelease: () => void = () => undefined): {readonly handle: ProjectOccupancyHandle; readonly release: ReturnType<typeof vi.fn>} {
    const release = vi.fn(async () => {
        afterRelease();
    });
    const compromised = new Promise<ProjectLockCompromisedError>(() => undefined);
    return {
        handle: {
            compromised,
            assertHealthy: () => undefined,
            release,
        },
        release,
    };
}

/** 建立sticky compromised信号的Occupancy handle。 */
function compromisableOccupancy(afterRelease: () => void): {
    readonly handle: ProjectOccupancyHandle;
    readonly release: ReturnType<typeof vi.fn>;
    readonly compromise: (error: ProjectLockCompromisedError) => void;
} {
    let resolveCompromise: (error: ProjectLockCompromisedError) => void = () => undefined;
    let failure: ProjectLockCompromisedError | null = null;
    const compromised = new Promise<ProjectLockCompromisedError>((resolve) => {
        resolveCompromise = resolve;
    });
    const release = vi.fn(async () => {
        afterRelease();
    });
    return {
        handle: {
            compromised,
            assertHealthy: () => {
                if (failure) {
                    throw failure;
                }
            },
            release,
        },
        release,
        compromise: (error) => {
            failure = error;
            resolveCompromise(error);
        },
    };
}

/** 建立使用指定terminal release closure的Occupancy handle。 */
function occupancyHandleWithRelease(release: () => Promise<void>): ProjectOccupancyHandle {
    return {
        compromised: new Promise<ProjectLockCompromisedError>(() => undefined),
        assertHealthy: () => undefined,
        release,
    };
}

/** 构造只包含Lifecycle公开字段的PreparedProjectOpen。 */
function preparedProject(projectRootInput: string, occupancy: ProjectOccupancyHandle): PreparedProjectOpen {
    const workspaceRoot = testAbsoluteFsPath("project-session-runtime", "workspace");
    const ref = projectWorkspaceRef(projectRootInput);
    const workspace = resolvedProjectWorkspace(
        ref,
        testAbsoluteFsPath("project-session-runtime", "workspace", projectRootInput),
        createProjectWorkspaceKey(workspaceRoot, ref),
    );
    return Object.freeze({
        revision: 1,
        project: {
            projectRoot: ref.projectRoot,
            kind: "novel",
            title: projectRootInput,
            summary: "",
        },
        change: "none",
        workspaceRoot,
        workspace,
        occupancy,
    });
}
