import {randomUUID} from "node:crypto";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createProjectHttpError} from "nbook/server/api/projects/project-http-error";
import {ProjectLifecycle} from "nbook/server/workspace-files/project-lifecycle";
import {projectWorkspaceRef, type ProjectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectSessionRuntime, ProjectSessionRuntimeClosedError} from "nbook/server/workspace-files/project-session-runtime";
import {ProjectSessionService} from "nbook/server/workspace-files/project-session-service";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";

/** 升级前的槽形状：只保留排空旧 owner 与承接探针所需的字段。 */
type PreviousProjectSessionState = {
    service: {closeAll(): Promise<void>} | null;
    agentProbe: ((session: ReadyProjectSessionRef) => boolean) | null;
    maintenanceTimer: ReturnType<typeof setInterval> | null;
};

type CurrentProjectSessionState = {
    service: {closeAll(): Promise<void>} | null;
    maintenanceTimer: ReturnType<typeof setInterval> | null;
};

const globalForProjectSession = globalThis as typeof globalThis & {
    __nbookProjectSessionV2?: PreviousProjectSessionState;
    __nbookProjectSessionV3?: CurrentProjectSessionState;
};

describe("project-session HMR boundaries", () => {
    let tempRoot: string;

    beforeEach(async () => {
        const current = globalForProjectSession.__nbookProjectSessionV3;
        if (current?.maintenanceTimer) clearInterval(current.maintenanceTimer);
        await current?.service?.closeAll();
        delete globalForProjectSession.__nbookProjectSessionV2;
        delete globalForProjectSession.__nbookProjectSessionV3;
        vi.resetModules();
    });

    afterEach(async () => {
        try {
            const facade = await import("nbook/server/workspace-files/project-session");
            await facade.closeAllProjects();
        } catch {
            // 旧 owner 关闭失败用例仍须通过 Facade 观察同一失败，不能在 teardown 启用新 owner。
        }
        for (const state of [globalForProjectSession.__nbookProjectSessionV2, globalForProjectSession.__nbookProjectSessionV3]) {
            if (state?.maintenanceTimer) {
                clearInterval(state.maintenanceTimer);
            }
            try {
                await state?.service?.closeAll();
            } catch {
                // 失败交接用例故意注入旧 owner 的 sticky close failure，没有真实待释放资源。
            }
        }
        delete globalForProjectSession.__nbookProjectSessionV2;
        delete globalForProjectSession.__nbookProjectSessionV3;
        setWorkspaceRuntimeRootContextForTest(null);
        collectReleasedSqliteHandles({force: true});
        if (tempRoot) {
            await rm(tempRoot, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
        }
        vi.resetModules();
    }, 30_000);

    it("升级先排空旧 owner，再让新 owner 取得同一 Project 的 Occupancy", async () => {
        const {workspaceRoot, ref} = await createProjectFixture("handoff-barrier");
        const closeGate = Promise.withResolvers<void>();
        const closeStarted = Promise.withResolvers<void>();
        let closeAllCalls = 0;
        globalForProjectSession.__nbookProjectSessionV2 = {
            service: {
                closeAll: async () => {
                    closeAllCalls += 1;
                    closeStarted.resolve();
                    await closeGate.promise;
                },
            },
            agentProbe: null,
            maintenanceTimer: null,
        };

        vi.resetModules();
        const facade = await import("nbook/server/workspace-files/project-session");
        const opened = facade.openProject(ref, {kind: "user"}, workspaceRoot);
        await closeStarted.promise;

        // 旧 owner 尚未排空时，新 owner 不能开始同一 Project 的 open（否则两代同时争抢同一把锁）。
        let settled = false;
        void opened.then(() => {
            settled = true;
        }, () => {
            settled = true;
        });
        try {
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(settled).toBe(false);
        } finally {
            closeGate.resolve();
        }
        await expect(opened).resolves.toMatchObject({publicId: expect.any(String)});
        expect(closeAllCalls).toBe(1);
        expect(facade.isProjectOpen(ref)).toBe(true);
    }, 30_000);

    it.each([false, true])("旧 owner 关闭失败后阻止新 owner，同步抛错=%s", async (synchronous) => {
        const {workspaceRoot, ref} = await createProjectFixture("failed-handoff");
        const failure = new Error("old occupancy release failed");
        globalForProjectSession.__nbookProjectSessionV2 = {
            service: {closeAll: () => {
                if (synchronous) throw failure;
                return Promise.reject(failure);
            }},
            agentProbe: null,
            maintenanceTimer: null,
        };
        const facade = await import("nbook/server/workspace-files/project-session");

        await expect(facade.openProject(ref, {kind: "user"}, workspaceRoot)).rejects.toBe(failure);
        expect(globalForProjectSession.__nbookProjectSessionV3?.service).toBeNull();
        await expect(facade.closeAllProjects()).rejects.toBe(failure);
        await expect(facade.openProject(ref, {kind: "user"}, workspaceRoot)).rejects.toBe(failure);
    });

    it("交接期间 shutdown 等待旧 owner，待交接请求不能在关闭后复活", async () => {
        const {workspaceRoot, ref} = await createProjectFixture("shutdown-handoff");
        const gate = Promise.withResolvers<void>();
        globalForProjectSession.__nbookProjectSessionV2 = {
            service: {closeAll: () => gate.promise}, agentProbe: null, maintenanceTimer: null,
        };
        const facade = await import("nbook/server/workspace-files/project-session");
        const opening = facade.openProject(ref, {kind: "user"}, workspaceRoot);
        const rejected = expect(opening).rejects.toMatchObject({code: "PROJECT_SESSION_RUNTIME_CLOSED"});
        let closed = false;
        const closing = facade.closeAllProjects().then(() => { closed = true; });
        try {
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(closed).toBe(false);
            await expect(facade.openProject(ref, {kind: "user"}, workspaceRoot))
                .rejects.toMatchObject({code: "PROJECT_SESSION_RUNTIME_CLOSED"});
        } finally {
            gate.resolve();
        }
        await closing;
        await rejected;
        expect(globalForProjectSession.__nbookProjectSessionV3?.service).toBeNull();
    });

    it("同版 HMR 保留 ready 对象与 presence owner，不重新打开项目", async () => {
        const {workspaceRoot, ref} = await createProjectFixture("same-version");
        const firstFacade = await import("nbook/server/workspace-files/project-session");
        const firstReady = await firstFacade.openProject(ref, {kind: "user"}, workspaceRoot);
        const firstPresence = firstFacade.acquireUserPresence(ref, firstReady.publicId);
        const owner = globalForProjectSession.__nbookProjectSessionV3;
        vi.resetModules();
        const reloaded = await import("nbook/server/workspace-files/project-session");
        const secondReady = await reloaded.openProject(ref, {kind: "user"}, workspaceRoot);
        expect(globalForProjectSession.__nbookProjectSessionV3).toBe(owner);
        expect(secondReady).toBe(firstReady);
        const secondPresence = reloaded.acquireUserPresence(ref, secondReady.publicId);
        firstPresence.release();
        expect(reloaded.projectOccupancy(ref)?.userConnections).toBe(1);
        await reloaded.closeAllProjects();
        expect(secondPresence.signal.aborted).toBe(true);
        expect(reloaded.isProjectOpen(ref)).toBe(false);
    }, 30_000);

    it("排空真实旧 Service：旧实例 fail closed，旧 ready 标识在新 owner 中不解析", async () => {
        const {workspaceRoot, ref} = await createProjectFixture("handoff-stale-id");
        const oldService = new ProjectSessionService(workspaceRoot, {
            lifecycle: new ProjectLifecycle(workspaceRoot),
            // 旧 owner 的 Module 资源不是本用例的观察对象；内存 registry 让排空只依赖真实 Lifecycle/Occupancy。
            runtime: new ProjectSessionRuntime({
                registryProvider: () => Object.freeze({required: Object.freeze([]), lazy: Object.freeze([])}),
            }),
        });
        const staleReady = await oldService.openProject(ref, {kind: "user"});
        globalForProjectSession.__nbookProjectSessionV2 = {
            service: oldService,
            agentProbe: null,
            maintenanceTimer: null,
        };

        vi.resetModules();
        const facade = await import("nbook/server/workspace-files/project-session");
        // 旧 owner 仍持有真实 Project Occupancy；排空必须先于新 owner 取得同一 Project 的锁。
        const opened = await facade.openProject(ref, {kind: "user"}, workspaceRoot);

        expect(opened.publicId).not.toBe(staleReady.publicId);
        expect(() => facade.acquireUserPresence(ref, staleReady.publicId)).toThrow(facade.ProjectNotOpenError);
        facade.acquireUserPresence(ref, opened.publicId).release();

        let staleOpenError: unknown = null;
        await oldService.openProject(ref, {kind: "user"}).catch((error: unknown) => {
            staleOpenError = error;
        });
        expect(staleOpenError).toBeInstanceOf(ProjectSessionRuntimeClosedError);
        // 旧实例抛出的 typed error 仍要被新 HTTP mapper 识别，不能因为换代变成 500。
        expect(createProjectHttpError(staleOpenError)?.data).toEqual({code: "PROJECT_SESSION_RUNTIME_CLOSED"});
    });

    it("换代保留 Agent 在场探针，避免运行中的 invocation 被 grace 误回收", async () => {
        const {workspaceRoot, ref} = await createProjectFixture("handoff-agent-probe");
        const probe = vi.fn<(session: ReadyProjectSessionRef) => boolean>(() => true);
        globalForProjectSession.__nbookProjectSessionV2 = {
            service: null,
            agentProbe: probe,
            maintenanceTimer: null,
        };

        vi.resetModules();
        const facade = await import("nbook/server/workspace-files/project-session");
        await facade.openProject(ref, {kind: "agent", sessionId: 7}, workspaceRoot);

        expect(facade.projectOccupancy(ref)).toMatchObject({agentActive: true});
        expect(probe).toHaveBeenCalled();
    });

    /** 建立带 manifest 的隔离 Workspace Root，使新旧 owner 都能真实取得同一个 Project 的 Occupancy。 */
    async function createProjectFixture(projectRoot: string): Promise<{
        readonly workspaceRoot: AbsoluteFsPath;
        readonly ref: ProjectWorkspaceRef;
    }> {
        tempRoot = testHostPath(`project-session-hmr-${randomUUID()}`);
        const workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
        const ref = projectWorkspaceRef(projectRoot);
        await writeProjectManifest(workspaceRoot, ref, {kind: "novel", title: "Alpha", summary: ""});
        return {workspaceRoot, ref};
    }
});
