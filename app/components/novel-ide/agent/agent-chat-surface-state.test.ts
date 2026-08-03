import {effectScope, nextTick, ref} from "vue";
import {describe, expect, it, vi} from "vitest";
import {
    AgentSurfaceActivationController,
    AgentSurfaceOperationController,
    AgentSurfaceSupersededError,
    projectAgentComposerAvailability,
    recoverMissingSessionSelection,
    resolveMissingSessionFallback,
    watchAgentSurfaceActivation,
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

describe("resolveMissingSessionFallback", () => {
    const sessions = [{sessionId: 39}, {sessionId: 40}, {sessionId: 41}];

    it("优先保留列表中仍有效的原 Session", () => {
        expect(resolveMissingSessionFallback(sessions, 3, 40)).toBe(40);
    });

    it("原 Session 不可用时选择第一个非失败 Session", () => {
        expect(resolveMissingSessionFallback(sessions, 3, 3)).toBe(39);
        expect(resolveMissingSessionFallback(sessions, 3, 99)).toBe(39);
    });

    it("排除失败 ID 且空列表返回 null", () => {
        expect(resolveMissingSessionFallback([{sessionId: 3}, {sessionId: 40}], 3, null)).toBe(40);
        expect(resolveMissingSessionFallback([{sessionId: 3}], 3, null)).toBeNull();
        expect(resolveMissingSessionFallback([], 3, null)).toBeNull();
    });
});

describe("recoverMissingSessionSelection", () => {
    it("只刷新和加载一次，并优先恢复原有效 Session", async () => {
        const refresh = vi.fn(async () => [{sessionId: 39}, {sessionId: 40}]);
        const load = vi.fn(async () => true);

        await expect(recoverMissingSessionSelection({
            failedSessionId: 3,
            previousSessionId: 40,
            accepts: () => true,
            refresh,
            load,
        })).resolves.toEqual({status: "loaded", sessionId: 40});
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledTimes(1);
        expect(load).toHaveBeenCalledWith(40);
    });

    it("空列表不加载，fallback 失败也不递归重试", async () => {
        const emptyLoad = vi.fn(async () => true);
        await expect(recoverMissingSessionSelection({
            failedSessionId: 3,
            previousSessionId: null,
            accepts: () => true,
            refresh: async () => [],
            load: emptyLoad,
        })).resolves.toEqual({status: "empty"});
        expect(emptyLoad).not.toHaveBeenCalled();

        const failedLoad = vi.fn(async () => false);
        await expect(recoverMissingSessionSelection({
            failedSessionId: 3,
            previousSessionId: null,
            accepts: () => true,
            refresh: async () => [{sessionId: 39}, {sessionId: 40}],
            load: failedLoad,
        })).resolves.toEqual({status: "load_failed", sessionId: 39});
        expect(failedLoad).toHaveBeenCalledTimes(1);
    });

    it("刷新或加载后 ownership 失效时不发布旧结果", async () => {
        let accepted = false;
        const load = vi.fn(async () => true);
        await expect(recoverMissingSessionSelection({
            failedSessionId: 3,
            previousSessionId: null,
            accepts: () => accepted,
            refresh: async () => [{sessionId: 39}],
            load,
        })).resolves.toEqual({status: "superseded"});
        expect(load).not.toHaveBeenCalled();

        accepted = true;
        await expect(recoverMissingSessionSelection({
            failedSessionId: 3,
            previousSessionId: null,
            accepts: () => accepted,
            refresh: async () => [{sessionId: 39}],
            load: async () => {
                accepted = false;
                return true;
            },
        })).resolves.toEqual({status: "superseded"});
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
