import {effectScope, nextTick, ref} from "vue";
import {describe, expect, it, vi} from "vitest";
import {
    AgentSessionLoadController,
    AgentSurfaceActivationController,
    AgentSurfaceOperationController,
    AgentSurfaceSupersededError,
    adoptInlineEditorRequest,
    forgetRememberedSession,
    readRememberedSession,
    projectAgentSessionLoad,
    projectAgentComposerAvailability,
    projectInlineEditorSelection,
    projectReconnectReady,
    runSessionLoadAttempt,
    tryWriteRememberedSession,
    registerReconnectRestoreWatcher,
    writeRememberedAfterStreamOpen,
    watchAgentSurfaceActivation,
    type AgentSessionLoadOwner,
    type AgentSurfaceActivationState,
} from "nbook/app/components/novel-ide/agent/agent-chat-surface-state";

function deferred<T>() {
    let resolve: (value: T) => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return {promise, resolve, reject};
}

describe("projectAgentSessionLoad", () => {
    it.each([
        ["loaded", true, {status: "commit"}],
        ["superseded", true, {status: "superseded"}],
        ["primary_missing", true, {status: "preserve", reason: "primary_missing"}],
        ["dependency_missing", true, {status: "preserve", reason: "dependency_missing"}],
        ["failed", true, {status: "preserve", reason: "failed"}],
        ["empty", true, {status: "preserve", reason: "empty"}],
        ["primary_missing", false, {status: "clear", reason: "primary_missing"}],
        ["dependency_missing", false, {status: "clear", reason: "failed"}],
        ["failed", false, {status: "clear", reason: "failed"}],
    ] as const)("%s + stable=%s 投影为 %o", (status, stable, expected) => {
        expect(projectAgentSessionLoad(status, stable)).toEqual(expected);
    });
});

describe("forgetRememberedSession", () => {
    it("只删除仍指向失效 Session 的记忆", () => {
        const storage = new MemoryStorage();
        const main = {schema: 2 as const, sessionId: 3, sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000"};
        storage.setItem("main", JSON.stringify(main));
        storage.setItem("inline", JSON.stringify({...main, sessionId: 40}));

        expect(forgetRememberedSession(storage, "main", main)).toBe(true);
        expect(storage.getItem("main")).toBeNull();
        expect(forgetRememberedSession(storage, "inline", main)).toBe(false);
        expect(storage.getItem("inline")).toBe(JSON.stringify({...main, sessionId: 40}));
    });

    it("identity 轮换、记忆被替换或删除抛错时保留现值并返回 false", () => {
        const storage = new MemoryStorage();
        const staleIdentity = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
        const freshIdentity = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
        const remembered = {schema: 2 as const, sessionId: 3, sessionIdentity: staleIdentity};

        // 同 ID 但 identity 已轮换：不删除
        storage.setItem("agent:last-session:p", JSON.stringify({...remembered, sessionIdentity: freshIdentity}));
        expect(forgetRememberedSession(storage, "agent:last-session:p", remembered)).toBe(false);
        expect(JSON.parse(storage.getItem("agent:last-session:p")!).sessionIdentity).toBe(freshIdentity);

        // 记忆已被其它 Session 替换：保留新值
        storage.setItem("agent:inline-editor-session:p", JSON.stringify({schema: 2 as const, sessionId: 9, sessionIdentity: freshIdentity}));
        expect(forgetRememberedSession(storage, "agent:inline-editor-session:p", remembered)).toBe(false);
        expect(JSON.parse(storage.getItem("agent:inline-editor-session:p")!).sessionId).toBe(9);

        // removeItem 抛错只报告失败，不破坏现有记忆
        storage.setItem("agent:last-session:p", JSON.stringify(remembered));
        vi.spyOn(storage, "removeItem").mockImplementation(() => {
            throw new Error("quota exceeded");
        });
        expect(forgetRememberedSession(storage, "agent:last-session:p", remembered)).toBe(false);
        expect(JSON.parse(storage.getItem("agent:last-session:p")!).sessionId).toBe(3);
    });
});

describe("projectReconnectReady", () => {
    const base = {
        activationStatus: "error" as const,
        attemptScopeKey: "project:a",
        attemptRevision: 3,
        expectedScopeKey: "project:a",
        expectedRevision: 3,
        activeSessionId: 5,
        expectedSessionId: 5,
    };

    it("同一 attempt 且目标 Session 仍是当前会话时恢复 ready", () => {
        expect(projectReconnectReady(base)).toBe("restore_ready");
    });

    it("activation 已非 error（新 owner 接管）时不恢复", () => {
        expect(projectReconnectReady({...base, activationStatus: "ready"})).toBe("skip_not_error");
        expect(projectReconnectReady({...base, activationStatus: "loading"})).toBe("skip_not_error");
    });

    it("旧代次 attempt 被替换时不误标新 owner 状态", () => {
        expect(projectReconnectReady({...base, attemptRevision: 2})).toBe("skip_stale_owner");
        expect(projectReconnectReady({...base, attemptScopeKey: "project:b"})).toBe("skip_stale_owner");
    });

    it("目标 Session 已切换到其它会话时不恢复", () => {
        expect(projectReconnectReady({...base, activeSessionId: 9})).toBe("skip_wrong_session");
    });

    it("inactive（组件停用/卸载后）时静默丢弃，不访问 attempt 字段", () => {
        expect(projectReconnectReady({...base, activationStatus: "inactive"})).toBe("skip_not_error");
        expect(projectReconnectReady({...base, activationStatus: "unselected"})).toBe("skip_not_error");
        expect(projectReconnectReady({...base, activationStatus: "empty"})).toBe("skip_not_error");
    });
});


describe("registerReconnectRestoreWatcher", () => {
    it("注册时已 connected 且 stale：立即自停并移出注册表，不执行 onRestored", () => {
        const status = ref<string>("connected");
        const stops = new Set<() => void>();
        const onRestored = vi.fn();

        registerReconnectRestoreWatcher({
            connectionStatus: status,
            stops,
            shouldRestore: () => false,
            onRestored,
        });

        expect(stops.size).toBe(0);
        expect(onRestored).not.toHaveBeenCalled();
    });

    it("注册时已 connected 且守卫通过：同步恢复一次并自停", async () => {
        const status = ref<string>("connected");
        const stops = new Set<() => void>();
        const onRestored = vi.fn();

        registerReconnectRestoreWatcher({
            connectionStatus: status,
            stops,
            shouldRestore: () => true,
            onRestored,
        });

        expect(onRestored).toHaveBeenCalledOnce();
        expect(stops.size).toBe(0);
        status.value = "reconnecting";
        await nextTick();
        expect(onRestored).toHaveBeenCalledOnce();
    });

    it("pending 时挂起监听，connected 触发一次恢复并自停", async () => {
        const status = ref<string>("reconnecting");
        const stops = new Set<() => void>();
        const onRestored = vi.fn();

        registerReconnectRestoreWatcher({
            connectionStatus: status,
            stops,
            shouldRestore: () => true,
            onRestored,
        });

        expect(stops.size).toBe(1);
        status.value = "idle";
        await nextTick();
        expect(onRestored).not.toHaveBeenCalled();
        expect(stops.size).toBe(1);

        status.value = "connected";
        await nextTick();
        expect(onRestored).toHaveBeenCalledOnce();
        expect(stops.size).toBe(0);

        status.value = "reconnecting";
        await nextTick();
        expect(onRestored).toHaveBeenCalledOnce();
    });

    it("未 connected 期间 owner 失效即自停，之后 connected 不再触发", async () => {
        const status = ref<string>("reconnecting");
        const stops = new Set<() => void>();
        const onRestored = vi.fn();
        let valid = true;

        registerReconnectRestoreWatcher({
            connectionStatus: status,
            stops,
            shouldRestore: () => valid,
            onRestored,
        });

        expect(stops.size).toBe(1);
        valid = false;
        status.value = "disconnected";
        await nextTick();
        expect(stops.size).toBe(0);
        expect(onRestored).not.toHaveBeenCalled();

        valid = true;
        status.value = "connected";
        await nextTick();
        expect(onRestored).not.toHaveBeenCalled();
    });

    it("主/Inline 注册表隔离：一个 surface 的 stale 自停不影响另一个", async () => {
        const status = ref<string>("reconnecting");
        const mainStops = new Set<() => void>();
        const inlineStops = new Set<() => void>();
        const mainStale = vi.fn(() => false);
        const mainRestored = vi.fn();
        const inlineRestored = vi.fn();

        registerReconnectRestoreWatcher({connectionStatus: status, stops: mainStops, shouldRestore: mainStale, onRestored: mainRestored});
        registerReconnectRestoreWatcher({connectionStatus: status, stops: inlineStops, shouldRestore: () => true, onRestored: inlineRestored});
        // stale 主面板 watcher 在注册同步检查时即自停；Inline watcher 不受影响。
        expect(mainStops.size).toBe(0);
        expect(mainStale).toHaveBeenCalled();
        expect(inlineStops.size).toBe(1);

        status.value = "idle";
        await nextTick();
        expect(mainStops.size).toBe(0);
        expect(inlineStops.size).toBe(1); // Inline watcher 继续挂起

        status.value = "connected";
        await nextTick();
        expect(mainRestored).not.toHaveBeenCalled();
        expect(inlineRestored).toHaveBeenCalledOnce();
        expect(inlineStops.size).toBe(0);
    });
});

describe("writeRememberedAfterStreamOpen", () => {
    const identity = {schema: 2 as const, sessionId: 5, sessionIdentity: "sha256:2222222222222222222222222222222222222222222222222222222222222222"};

    it("主面板记忆：事件流 open 成功后才写入", async () => {
        const storage = new MemoryStorage();
        let resolveStart: () => void = () => undefined;
        const start = vi.fn(() => new Promise<void>((resolve) => {
            resolveStart = resolve;
        }));
        const outcomePromise = writeRememberedAfterStreamOpen({
            start,
            accepts: () => true,
            remember: () => {
                expect(tryWriteRememberedSession(storage, "agent:last-session:p", identity).status).toBe("saved");
            },
        });

        await Promise.resolve();
        expect(storage.getItem("agent:last-session:p")).toBeNull();
        resolveStart();

        expect(await outcomePromise).toEqual({status: "connected"});
        expect(JSON.parse(storage.getItem("agent:last-session:p")!)).toEqual(identity);
    });

    it("Inline 记忆：open 前连接失败不写入并报告 connect_failed", async () => {
        const storage = new MemoryStorage();
        const failure = new Error("event stream closed before open");
        const outcome = await writeRememberedAfterStreamOpen({
            start: vi.fn(async () => {
                throw failure;
            }),
            accepts: () => true,
            remember: () => storage.setItem("agent:inline-editor-session:p", JSON.stringify(identity)),
        });

        expect(outcome).toEqual({status: "connect_failed", error: failure});
        expect(storage.getItem("agent:inline-editor-session:p")).toBeNull();
    });

    it("open 前 owner 已失效时连接失败折叠为 superseded 且不写记忆", async () => {
        const storage = new MemoryStorage();
        const outcome = await writeRememberedAfterStreamOpen({
            start: vi.fn(async () => {
                throw new Error("aborted");
            }),
            accepts: () => false,
            remember: () => storage.setItem("agent:last-session:p", JSON.stringify(identity)),
        });

        expect(outcome.status).toBe("superseded");
        expect(storage.getItem("agent:last-session:p")).toBeNull();
    });

    it("open 成功但 owner 已失效时不写记忆", async () => {
        const storage = new MemoryStorage();
        const outcome = await writeRememberedAfterStreamOpen({
            start: async () => undefined,
            accepts: () => false,
            remember: () => storage.setItem("agent:inline-editor-session:p", JSON.stringify(identity)),
        });

        expect(outcome.status).toBe("superseded");
        expect(storage.getItem("agent:inline-editor-session:p")).toBeNull();
    });
});

describe("runSessionLoadAttempt", () => {
    const errorCode = (error: unknown): string | null => {
        if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
            return error.code;
        }
        return null;
    };

    it("只在读取成功且 owner 仍有效时提交目标状态", async () => {
        let accepted = true;
        const commit = vi.fn();

        await expect(runSessionLoadAttempt({
            read: async () => ({sessionId: 7}),
            commit,
            accepts: () => accepted,
            errorCode,
        })).resolves.toEqual({status: "loaded", value: {sessionId: 7}});
        expect(commit).toHaveBeenCalledWith({sessionId: 7});

        accepted = false;
        commit.mockClear();
        await expect(runSessionLoadAttempt({
            read: async () => ({sessionId: 8}),
            commit,
            accepts: () => accepted,
            errorCode,
        })).resolves.toEqual({status: "superseded"});
        expect(commit).not.toHaveBeenCalled();
    });

    it.each([
        ["SESSION_NOT_FOUND", {status: "primary_missing"}],
        ["SESSION_DEPENDENCY_NOT_FOUND", {status: "dependency_missing"}],
    ] as const)("保留生命周期错误分区：%s", async (code, expected) => {
        const error = Object.assign(new Error(code), {code});
        const commit = vi.fn();

        const result = await runSessionLoadAttempt({
            read: async () => {
                throw error;
            },
            commit,
            accepts: () => true,
            errorCode,
        });

        expect(result.status).toBe(expected.status);
        if (expected.status === "dependency_missing") {
            expect(result).toMatchObject({error});
        }
        expect(commit).not.toHaveBeenCalled();
    });

    it("普通读取错误和提交错误不被误判为 Session 缺失", async () => {
        const readError = new Error("read failed");
        await expect(runSessionLoadAttempt({
            read: async () => {
                throw readError;
            },
            commit: vi.fn(),
            accepts: () => true,
            errorCode,
        })).resolves.toEqual({status: "failed", error: readError});

        const commitError = new Error("commit failed");
        await expect(runSessionLoadAttempt({
            read: async () => 1,
            commit: async () => {
                throw commitError;
            },
            accepts: () => true,
            errorCode,
        })).resolves.toEqual({status: "failed", error: commitError});
    });

    it("提交期间 owner 失效时静默丢弃结果", async () => {
        let accepted = true;
        const commit = vi.fn(async () => {
            accepted = false;
        });

        await expect(runSessionLoadAttempt({
            read: async () => 1,
            commit,
            accepts: () => accepted,
            errorCode,
        })).resolves.toEqual({status: "superseded"});
        expect(commit).toHaveBeenCalledOnce();
    });
});

describe("Inline Editor 选择结果", () => {
    it.each([
        [{status: "current" as const}, {status: "current", value: undefined}],
        [{status: "superseded" as const}, {status: "superseded"}],
        [{status: "empty" as const}, {status: "empty"}],
        [{status: "failed" as const, message: "Inline AI Session 加载失败。"}, {status: "failed", message: "Inline AI Session 加载失败。"}],
    ])("只把 current 投影为绑定成功：%o", (result, expected) => {
        expect(projectInlineEditorSelection(result)).toEqual(expected);
    });

    it("恢复子请求成功后父刷新接纳 successor request，旧代次不能复活", () => {
        expect(adoptInlineEditorRequest(4, {status: "current", requestId: 5})).toEqual({status: "current", requestId: 5});
        expect(adoptInlineEditorRequest(4, {status: "empty", requestId: 5})).toEqual({status: "current", requestId: 5});
        expect(adoptInlineEditorRequest(4, {status: "failed", requestId: 5})).toEqual({status: "current", requestId: 5});
        expect(adoptInlineEditorRequest(4, {status: "current", requestId: 3})).toEqual({status: "superseded"});
        expect(adoptInlineEditorRequest(4, {status: "superseded"})).toEqual({status: "superseded"});
    });
});

describe("AgentSessionLoadController", () => {
    it("前台加载会立即使旧 recovery 失效，迟到 recovery 不能发布", async () => {
        const controller = new AgentSessionLoadController();
        const recoveryWork = deferred<string>();
        const recovery = controller.runRecovery("project:a", async (owner) => {
            await recoveryWork.promise;
            return controller.accepts(owner, "project:a") ? "recovered" : "superseded";
        });
        expect(recovery.status).toBe("started");
        const foreground = controller.beginForeground("project:a");
        expect(controller.accepts(foreground, "project:a")).toBe(true);
        recoveryWork.resolve("late");

        await expect(recovery.promise).resolves.toBe("superseded");
        expect(controller.accepts(foreground, "project:a")).toBe(true);
    });

    it("前台加载存在时延迟 recovery，同一 recovery 只复用一个 Promise", async () => {
        const controller = new AgentSessionLoadController();
        const foreground = controller.beginForeground("project:a");
        const deferredRequest = controller.runRecovery("project:a", async () => "blocked");
        expect(deferredRequest.status).toBe("deferred");
        await controller.finish(foreground);
        await expect(deferredRequest.promise).resolves.toBeUndefined();

        const recoveryWork = deferred<void>();
        const work = vi.fn(async () => {
            await recoveryWork.promise;
            return "ok";
        });
        const first = controller.runRecovery("project:a", work);
        const duplicate = controller.runRecovery("project:a", work);
        expect(duplicate.promise).toBe(first.promise);
        expect(work).toHaveBeenCalledOnce();
        recoveryWork.resolve();
        await expect(first.promise).resolves.toBe("ok");
    });

    it("旧 recovery reject 后的 finally 不能清理新的前台 owner", async () => {
        const controller = new AgentSessionLoadController();
        const recoveryWork = deferred<void>();
        const recovery = controller.runRecovery("project:a", async () => {
            await recoveryWork.promise;
            throw new Error("recovery failed");
        });
        const foreground = controller.beginForeground("project:a");
        recoveryWork.resolve();

        await expect(recovery.promise).rejects.toThrow("recovery failed");
        expect(controller.accepts(foreground, "project:a")).toBe(true);
    });

    it("前台失败时只 replay 一次 deferred recovery，成功时丢弃它", async () => {
        const controller = new AgentSessionLoadController();
        const foreground = controller.beginForeground("project:a");
        const recoveryWork = vi.fn(async (owner: AgentSessionLoadOwner) => {
            expect(controller.accepts(owner, "project:a")).toBe(true);
            return "recovered";
        });
        const deferredRecovery = controller.runRecovery("project:a", recoveryWork);
        expect(deferredRecovery.status).toBe("deferred");
        await controller.finish(foreground, true);
        await expect(deferredRecovery.promise).resolves.toBe("recovered");
        expect(recoveryWork).toHaveBeenCalledOnce();

        const nextForeground = controller.beginForeground("project:a");
        const discarded = controller.runRecovery("project:a", async () => "stale");
        expect(discarded.status).toBe("deferred");
        await controller.finish(nextForeground);
        await expect(discarded.promise).resolves.toBeUndefined();
    });

    it("scope 改变时收口旧 deferred，不让旧 SSE 回调悬挂", async () => {
        const controller = new AgentSessionLoadController();
        const first = controller.beginForeground("project:a");
        const deferredRequest = controller.runRecovery("project:a", async () => "stale");
        controller.beginForeground("project:b");

        await expect(deferredRequest.promise).resolves.toBeUndefined();
        await controller.finish(first);
    });

    it("前台下 runRecovery 换 scope 时先收口旧 deferred 再保存新 work", async () => {
        const controller = new AgentSessionLoadController();
        controller.beginForeground("project:a");
        const stale = controller.runRecovery("project:a", async () => "stale");
        expect(stale.status).toBe("deferred");

        const next = controller.runRecovery("project:b", async () => "next");
        expect(next.status).toBe("deferred");
        await expect(stale.promise).resolves.toBeUndefined();

        const nextForeground = controller.beginForeground("project:b");
        await controller.finish(nextForeground, true);
        await expect(next.promise).resolves.toBe("next");
    });

    it("deferred recovery work reject 时 deferredPromise reject，finish 自身正常 settle", async () => {
        const controller = new AgentSessionLoadController();
        const foreground = controller.beginForeground("project:a");
        const deferredRequest = controller.runRecovery("project:a", async () => {
            throw new Error("deferred work failed");
        });
        expect(deferredRequest.status).toBe("deferred");
        const rejection = expect(deferredRequest.promise).rejects.toThrow("deferred work failed");

        await controller.finish(foreground, true);
        await rejection;
    });

    it("不同 Surface 的 controller 互不撤销 owner，旧 finally 不能清理新前台加载", () => {
        const main = new AgentSessionLoadController();
        const inline = new AgentSessionLoadController();
        const mainOwner = main.beginForeground("project:a");
        const inlineOwner = inline.beginForeground("project:a");

        main.invalidate();

        expect(main.accepts(mainOwner, "project:a")).toBe(false);
        expect(inline.accepts(inlineOwner, "project:a")).toBe(true);
    });
});

describe("AgentSurfaceActivationController", () => {
    it("组件初次以 active=true 挂载时立即激活", () => {
        const scope = effectScope();
        const active = ref(true);
        const scopeKey = ref("project:a");
        const activate = vi.fn();

        scope.run(() => watchAgentSurfaceActivation({
            active,
            scopeKey,
            controller: new AgentSurfaceActivationController(),
            activate,
        }));

        expect(activate).toHaveBeenCalledOnce();
        expect(activate.mock.calls[0]?.[0]).toMatchObject({scopeKey: "project:a", revision: 1});
        expect(activate.mock.calls[0]?.[1]).toEqual({initial: true, reactivated: false, scopeChanged: false});
        scope.stop();
    });

    it("false 到 true、A 到 B 到 A 都开启新 revision", async () => {
        const scope = effectScope();
        const active = ref(false);
        const scopeKey = ref("project:a");
        const attempts: string[] = [];
        scope.run(() => watchAgentSurfaceActivation({
            active,
            scopeKey,
            controller: new AgentSurfaceActivationController(),
            activate: (attempt) => {
                attempts.push(`${attempt.scopeKey}@${String(attempt.revision)}`);
            },
        }));

        active.value = true;
        await nextTick();
        scopeKey.value = "project:b";
        await nextTick();
        scopeKey.value = "project:a";
        await nextTick();

        expect(attempts).toEqual(["project:a@2", "project:b@3", "project:a@4"]);
        scope.stop();
    });

    it("同 scope 新 revision 拒绝旧结果和旧错误", async () => {
        const controller = new AgentSurfaceActivationController();
        const scopeKey = () => "project:a";
        const oldResult = deferred<string>();
        const first = controller.begin(scopeKey());
        const firstPromise = controller.run(first, scopeKey, () => oldResult.promise);
        const second = controller.begin(scopeKey());
        oldResult.resolve("stale");

        await expect(firstPromise).rejects.toBeInstanceOf(AgentSurfaceSupersededError);
        expect(controller.state.value).toEqual({status: "loading", attempt: second});

        const oldError = deferred<string>();
        const secondPromise = controller.run(second, scopeKey, () => oldError.promise);
        const third = controller.begin(scopeKey());
        oldError.reject(new Error("stale failure"));

        await expect(secondPromise).rejects.toBeInstanceOf(AgentSurfaceSupersededError);
        expect(controller.state.value).toEqual({status: "loading", attempt: third});
    });

    it("single-flight 只在同 scope 和 revision 内复用，旧 finally 不清新请求", async () => {
        const controller = new AgentSurfaceActivationController();
        const currentScope = ref("project:a");
        const firstDeferred = deferred<string>();
        const secondDeferred = deferred<string>();
        const firstWork = vi.fn(() => firstDeferred.promise);
        const secondWork = vi.fn(() => secondDeferred.promise);
        const first = controller.begin(currentScope.value);
        const firstPromise = controller.run(first, () => currentScope.value, firstWork);
        const duplicate = controller.run(first, () => currentScope.value, firstWork);
        expect(duplicate).toBe(firstPromise);
        expect(firstWork).toHaveBeenCalledOnce();

        currentScope.value = "project:b";
        const second = controller.begin(currentScope.value);
        const secondPromise = controller.run(second, () => currentScope.value, secondWork);
        firstDeferred.resolve("old");
        await expect(firstPromise).rejects.toBeInstanceOf(AgentSurfaceSupersededError);

        const secondDuplicate = controller.run(second, () => currentScope.value, secondWork);
        expect(secondDuplicate).toBe(secondPromise);
        expect(secondWork).toHaveBeenCalledOnce();
        secondDeferred.resolve("new");
        await expect(secondPromise).resolves.toBe("new");
    });

    it("scope 销毁后立即拒绝在途结果", async () => {
        const scope = effectScope();
        const request = deferred<string>();
        let promise: Promise<string> | null = null;
        scope.run(() => {
            const controller = new AgentSurfaceActivationController();
            watchAgentSurfaceActivation({
                active: ref(true),
                scopeKey: ref("project:a"),
                controller,
                activate: (attempt) => {
                    promise = controller.run(attempt, () => "project:a", () => request.promise);
                },
            });
        });

        scope.stop();
        request.resolve("late");
        await expect(promise).rejects.toBeInstanceOf(AgentSurfaceSupersededError);
    });
});

describe("AgentSurfaceOperationController", () => {
    it("旧 Project 操作只能返回 superseded，不能伪装成当前共享值", async () => {
        const controller = new AgentSurfaceOperationController();
        const scopeKey = ref("project:a@ready:1");
        const oldWork = deferred<string>();
        const owner = controller.begin(scopeKey.value);
        const result = controller.run(owner, () => scopeKey.value, () => oldWork.promise);

        scopeKey.value = "project:b@ready:2";
        controller.begin(scopeKey.value);
        oldWork.resolve("project-a-result");

        await expect(result).resolves.toEqual({status: "superseded"});
    });

    it("同 scope 新代次使旧 finally 无权清理新操作", async () => {
        const controller = new AgentSurfaceOperationController();
        const scopeKey = () => "project:a@ready:1";
        const oldWork = deferred<string>();
        const nextWork = deferred<string>();
        const oldOwner = controller.begin(scopeKey());
        const oldResult = controller.run(oldOwner, scopeKey, () => oldWork.promise);
        const nextOwner = controller.begin(scopeKey());
        const nextResult = controller.run(nextOwner, scopeKey, () => nextWork.promise);

        oldWork.resolve("old");
        await expect(oldResult).resolves.toEqual({status: "superseded"});
        expect(controller.accepts(nextOwner, scopeKey())).toBe(true);

        nextWork.resolve("next");
        await expect(nextResult).resolves.toEqual({status: "current", value: "next"});
    });
});

describe("projectAgentComposerAvailability", () => {
    const readyActivation: AgentSurfaceActivationState = {
        status: "ready",
        attempt: {scopeKey: "project:a", revision: 1},
    };
    const loadedSummary = {archived: false, profileAvailability: "loaded"};
    const interaction = {
        canInvoke: true,
        canResolveUserInput: true,
        canRestore: false,
        canAbort: false,
    };

    it("activeSummary=null 不再被解释为 Profile 缺失", () => {
        expect(projectAgentComposerAvailability({
            activation: readyActivation,
            summary: null,
            pendingUserInput: false,
            running: false,
            interaction,
        })).toEqual({status: "blocked", readonly: true, canStop: false});
    });

    it.each([
        [{status: "loading", attempt: {scopeKey: "project:a", revision: 1}}, null, "restoring"],
        [{status: "empty", attempt: {scopeKey: "project:a", revision: 1}}, null, "empty"],
        [{status: "error", attempt: {scopeKey: "project:a", revision: 1}, message: "boom"}, null, "load-error"],
    ] as const)("投影激活状态 %s", (activation, summary, status) => {
        expect(projectAgentComposerAvailability({
            activation,
            summary,
            pendingUserInput: false,
            running: false,
            interaction,
        }).status).toBe(status);
    });

    it("覆盖归档、Profile 不可用、等待阻塞与保守阻塞", () => {
        expect(projectAgentComposerAvailability({
            activation: readyActivation,
            summary: {...loadedSummary, archived: true},
            pendingUserInput: false,
            running: false,
            interaction: {...interaction, canRestore: true},
        })).toMatchObject({status: "archived", canRestore: true});
        expect(projectAgentComposerAvailability({
            activation: readyActivation,
            summary: {archived: false, profileAvailability: "missing", profileIssueMessage: "Profile 文件不存在"},
            pendingUserInput: false,
            running: false,
            interaction,
        })).toMatchObject({status: "profile-unavailable", message: "Profile 文件不存在"});
        expect(projectAgentComposerAvailability({
            activation: readyActivation,
            summary: loadedSummary,
            pendingUserInput: true,
            running: false,
            interaction: {...interaction, canResolveUserInput: false},
        }).status).toBe("waiting-blocked");
        expect(projectAgentComposerAvailability({
            activation: readyActivation,
            summary: loadedSummary,
            pendingUserInput: false,
            running: false,
            interaction: {...interaction, canInvoke: false},
        }).status).toBe("blocked");
    });

    it("只读运行仍可终止", () => {
        expect(projectAgentComposerAvailability({
            activation: readyActivation,
            summary: loadedSummary,
            pendingUserInput: true,
            running: true,
            interaction: {...interaction, canResolveUserInput: false, canAbort: true},
        })).toEqual({status: "waiting-blocked", readonly: true, canStop: true});
    });
});

describe("tryWriteRememberedSession", () => {
    it("写入成功返回 saved", () => {
        const storage = new MemoryStorage();

        const value = {schema: 2 as const, sessionId: 7, sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000"};
        expect(tryWriteRememberedSession(storage, "session", value)).toEqual({status: "saved"});
        expect(storage.getItem("session")).toBe(JSON.stringify(value));
    });

    it("Storage 写入失败只返回 failed，不影响已有记忆", () => {
        const storage = new MemoryStorage();
        const old = {schema: 2 as const, sessionId: 3, sessionIdentity: "sha256:0000000000000000000000000000000000000000000000000000000000000000"};
        storage.setItem("session", JSON.stringify(old));
        const error = new Error("quota");
        storage.setItem = () => {
            throw error;
        };

        const next = {...old, sessionId: 7};
        expect(tryWriteRememberedSession(storage, "session", next)).toEqual({status: "failed", error});
        expect(storage.getItem("session")).toBe(JSON.stringify(old));
    });

    it("旧数字值、损坏 JSON 和 identity 缺失都进入 unselected 输入", () => {
        const storage = new MemoryStorage();
        storage.setItem("legacy", "3");
        storage.setItem("broken", "{");
        storage.setItem("missing-identity", JSON.stringify({schema: 2, sessionId: 3}));

        expect(readRememberedSession(storage, "legacy")).toEqual({status: "invalid"});
        expect(readRememberedSession(storage, "broken")).toEqual({status: "invalid"});
        expect(readRememberedSession(storage, "missing-identity")).toEqual({status: "invalid"});
    });
});

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}
