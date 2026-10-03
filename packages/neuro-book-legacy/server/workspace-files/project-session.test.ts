import {randomUUID} from "node:crypto";
import {mkdir, rename, rm, stat, writeFile} from "node:fs/promises";
import {join} from "node:path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {consola} from "consola";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {PROJECT_DATABASE_MODULE_TOKEN} from "nbook/server/workspace-files/project-database-module";
import {projectWorkspaceRef, type ProjectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {
    projectModuleToken,
    replaceProjectModulesForTest,
    type ProjectModuleName,
} from "nbook/server/workspace-files/project-module";
import {
    PROJECT_GRACE_MS,
    ProjectNotOpenError,
    acquireUserPresence,
    assertProjectOpen,
    closeAllProjects,
    closeProject,
    createProject,
    deleteProject,
    isProjectOpen,
    listOpenProjects,
    listProjectCandidates,
    listProjects,
    markProjectActivity,
    openProject,
    openProjectControl,
    projectOccupancy,
    registerAgentPresenceProbe,
    requireReadyModuleHandle,
    resetProjectSessionsForTest,
    sweepProjectSessions,
    updateProjectMetadata,
    runReadyProjectOperation,
} from "nbook/server/runtime/product-project";
import {writeProjectManifest} from "nbook/server/workspace-files/project-workspace";
import {setWorkspaceRuntimeRootContextForTest} from "nbook/server/workspace-files/workspace-runtime-root";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";

describe("Application-owned project generations", () => {
    let tempRoot: string;
    let workspaceRoot: AbsoluteFsPath;

    beforeEach(async () => {
        resetProjectSessionsForTest();
        tempRoot = testHostPath(`neuro-book-project-session-test-${randomUUID()}`);
        workspaceRoot = absoluteFsPath(join(tempRoot, "workspace"));
        await mkdir(workspaceRoot, {recursive: true});
        setWorkspaceRuntimeRootContextForTest({workspaceRoot});
    });

    afterEach(async () => {
        await closeAllProjects().catch(() => undefined);
        resetProjectSessionsForTest();
        setWorkspaceRuntimeRootContextForTest(null);
        collectReleasedSqliteHandles({force: true});
        await removeTempRootBestEffort(tempRoot);
    }, 60_000);

    /** 在临时Workspace Root建立具备合法manifest的Project。 */
    async function createTempProject(projectRoot: string): Promise<ProjectWorkspaceRef> {
        const ref = projectWorkspaceRef(projectRoot);
        await writeProjectManifest(workspaceRoot, ref, {
            kind: "novel",
            title: projectRoot,
            summary: "",
        });
        return ref;
    }

    it("并发open单飞并发布required Module typed handles", async () => {
        await expect(openProject(projectWorkspaceRef("does-not-exist"), {kind: "user"}, workspaceRoot))
            .rejects.toMatchObject({statusCode: 404});

        const ref = await createTempProject("open-book");
        const [first, second] = await Promise.all([
            openProject(ref, {kind: "user"}, workspaceRoot),
            openProject(ref, {kind: "agent", sessionId: 1}, workspaceRoot),
        ]);
        const reused = await openProject(ref, {kind: "job", source: "test"}, workspaceRoot);

        expect(first).toBe(second);
        expect(reused).toBe(first);
        expect(listOpenProjects()).toEqual([
            expect.objectContaining({
                projectRoot: "open-book",
                state: "open",
                userConnections: 0,
                agentActive: false,
            }),
        ]);

        const database = requireReadyModuleHandle(
            first,
            PROJECT_DATABASE_MODULE_TOKEN,
        );
        await expect(database.databasePath).resolves.toBe(
            absoluteFsPath(join(first.workspace.root, ".nbook", "project.sqlite")),
        );
        expect((await stat(join(workspaceRoot, "open-book", ".nbook", "project.sqlite"))).isFile()).toBe(true);
    });

    it("唯一控制面Lifecycle贯穿candidates、create、open、metadata与显式close后delete", async () => {
        await mkdir(join(workspaceRoot, "candidate-book"));
        await expect(listProjectCandidates()).resolves.toEqual(expect.objectContaining({
            candidates: [projectWorkspaceRef("candidate-book")],
        }));

        const ref = projectWorkspaceRef("control-book");
        const created = await createProject({ref, title: "Control Book", summary: "Before"});
        expect(created.project).toMatchObject({
            projectRoot: "control-book",
            kind: "novel",
            title: "Control Book",
            summary: "Before",
        });
        await expect(listProjects()).resolves.toEqual(expect.objectContaining({
            projects: [expect.objectContaining({projectRoot: "control-book"})],
        }));

        const opened = await openProjectControl(ref, {kind: "user"});
        expect(opened.publication).toMatchObject({
            change: "none",
            project: {projectRoot: "control-book", title: "Control Book"},
        });
        const updated = await updateProjectMetadata({ref, title: "Updated Book", summary: "After"});
        expect(updated.project).toMatchObject({title: "Updated Book", summary: "After"});

        await expect(deleteProject(ref)).rejects.toMatchObject({code: "PROJECT_IN_USE"});
        expect(isProjectOpen(ref)).toBe(true);
        await closeProject(ref, "delete");
        await expect(deleteProject(ref)).resolves.toMatchObject({projectRoot: "control-book"});
        await expect(listProjects()).resolves.toEqual(expect.objectContaining({projects: []}));
    }, 60_000);

    it("外部替换根时封住旧代open，收口Scope后才允许新代ready", async () => {
        const ref = await createTempProject("replacement-book");
        let releaseClose!: () => void;
        const closeGate = new Promise<void>((resolve) => { releaseClose = resolve; });
        let closingStarted = false;
        let closeCount = 0;
        const restoreModules = replaceProjectModulesForTest(
            (["database", "history", "file-index"] as const).map((name) => ({
                token: projectModuleToken(name, "required"),
                start: () => ({
                    ready: Promise.resolve(),
                    close: async () => {
                        if (name === "file-index" && closeCount++ === 0) {
                            closingStarted = true;
                            await closeGate;
                        }
                    },
                }),
            })),
        );
        try {
            const old = await openProject(ref, {kind: "user"}, workspaceRoot);
            await rename(join(workspaceRoot, ref.projectRoot), join(workspaceRoot, "replacement-book-original"));
            await createTempProject(ref.projectRoot);
            await vi.waitFor(() => expect(closingStarted).toBe(true), {timeout: 5_000});

            await expect(openProject(ref, {kind: "user"}, workspaceRoot)).rejects.toMatchObject({name: "ProjectSessionRuntimeClosedError"});
            releaseClose();
            await vi.waitFor(async () => {
                const current = await openProject(ref, {kind: "user"}, workspaceRoot);
                expect(current).not.toBe(old);
                expect(current.generation).not.toBe(old.generation);
                expect(() => requireReadyModuleHandle(old, PROJECT_DATABASE_MODULE_TOKEN)).toThrow();
            }, {timeout: 5_000});
        } finally {
            releaseClose();
            restoreModules();
        }
    }, 20_000);

    it("连续100次列表读取只消费浅层snapshot且不启动Project数据面", async () => {
        const starts = new Map<ProjectModuleName, number>();
        const restoreModules = replaceProjectModulesForTest(
            (["database", "history", "file-index"] as const).map((name) => ({
                token: projectModuleToken(name, "required"),
                start: () => {
                    starts.set(name, (starts.get(name) ?? 0) + 1);
                    return {ready: Promise.resolve(), close: async () => undefined};
                },
            })),
        );
        try {
            for (const projectRoot of ["list-book-a", "list-book-b"] as const) {
                await createTempProject(projectRoot);
                const manuscriptRoot = join(workspaceRoot, projectRoot, "manuscript");
                await mkdir(manuscriptRoot, {recursive: true});
                await writeFile(join(manuscriptRoot, "chapter.md"), `# ${projectRoot}\n\n正文内容`);
            }

            for (let index = 0; index < 100; index += 1) {
                const snapshot = await listProjects();
                expect(snapshot.projects.map((project) => project.projectRoot).sort())
                    .toEqual(["list-book-a", "list-book-b"]);
            }

            expect(starts.size).toBe(0);
            expect(listOpenProjects()).toEqual([]);
            for (const projectRoot of ["list-book-a", "list-book-b"] as const) {
                await expect(stat(join(workspaceRoot, projectRoot, ".nbook", "project.sqlite")))
                    .rejects.toMatchObject({code: "ENOENT"});
                await expect(stat(join(workspaceRoot, projectRoot, ".nbook", "history.sqlite")))
                    .rejects.toMatchObject({code: "ENOENT"});
            }
        } finally {
            restoreModules();
        }
    });

    it("用户presence归零进入grace，重连恢复且release幂等", async () => {
        expect(() => acquireUserPresence(projectWorkspaceRef("never-open"), "stale")).toThrow(ProjectNotOpenError);
        const ref = await createTempProject("presence-book");
        const ready = await openProject(ref, {kind: "user"}, workspaceRoot);

        const releaseFirst = acquireUserPresence(ref, ready.publicId).release;
        const releaseSecond = acquireUserPresence(ref, ready.publicId).release;
        expect(projectOccupancy(ref)).toEqual({
            state: "open",
            userConnections: 2,
            agentActive: false,
        });

        releaseFirst();
        releaseFirst();
        expect(projectOccupancy(ref)?.userConnections).toBe(1);
        releaseSecond();
        expect(projectOccupancy(ref)?.state).toBe("grace");
        expect(() => assertProjectOpen(ref)).not.toThrow();

        const releaseReconnected = acquireUserPresence(ref, ready.publicId).release;
        expect(projectOccupancy(ref)).toEqual({
            state: "open",
            userConnections: 1,
            agentActive: false,
        });
        releaseReconnected();
    });

    it("close/reopen 后旧 ready 标识不能取得新 generation 的presence", async () => {
        const ref = await createTempProject("presence-generation-book");
        const first = await openProject(ref, {kind: "user"}, workspaceRoot);
        acquireUserPresence(ref, first.publicId).release();

        await closeProject(ref, "shutdown");
        const second = await openProject(ref, {kind: "user"}, workspaceRoot);

        expect(second.publicId).not.toBe(first.publicId);
        expect(() => acquireUserPresence(ref, first.publicId)).toThrow(ProjectNotOpenError);
        // 另一个 Project 的标识同样不能解析成本 Project 的当前代次。
        expect(() => acquireUserPresence(ref, "unknown-ready-id")).toThrow(ProjectNotOpenError);
        const releaseSecond = acquireUserPresence(ref, second.publicId).release;
        expect(projectOccupancy(ref)?.userConnections).toBe(1);
        releaseSecond();
        expect(projectOccupancy(ref)?.state).toBe("grace");
    });

    it("closing中拒绝同路径reopen，已接纳操作完成后只关闭旧generation", async () => {
        const ref = await createTempProject("closing-generation-book");
        const first = await openProject(ref, {kind: "user"}, workspaceRoot);
        const finish = Promise.withResolvers<void>();
        const operation = runReadyProjectOperation(first, async () => { await finish.promise; });
        const closing = closeProject(ref, "shutdown");
        await expect(openProject(ref, {kind: "user"}, workspaceRoot)).rejects.toMatchObject({code: "PROJECT_SESSION_RUNTIME_CLOSED"});
        finish.resolve();
        await operation;
        await closing;
        const second = await openProject(ref, {kind: "user"}, workspaceRoot);
        expect(second.publicId).not.toBe(first.publicId);
        expect(() => acquireUserPresence(ref, first.publicId)).toThrow(ProjectNotOpenError);
        expect(projectOccupancy(ref)).toMatchObject({state: "open"});
    });

    it("opening期间close等待原代次并拒绝同时reopen", async () => {
        const ref = await createTempProject("opening-generation-book");
        const started = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const restore = replaceProjectModulesForTest(
            (["database", "history", "file-index"] as const).map((name) => ({
                token: projectModuleToken(name, "required"),
                start: () => {
                    if (name === "database") started.resolve();
                    return {ready: name === "database" ? release.promise : Promise.resolve(), close: async () => undefined};
                },
            })),
        );
        try {
            const opening = openProject(ref, {kind: "user"}, workspaceRoot);
            await started.promise;
            const closing = closeProject(ref, "shutdown");
            await expect(openProject(ref, {kind: "user"}, workspaceRoot)).rejects.toMatchObject({code: "PROJECT_SESSION_RUNTIME_CLOSED"});
            release.resolve();
            await opening.catch(() => undefined);
            await closing;
            const reopened = await openProject(ref, {kind: "user"}, workspaceRoot);
            expect(reopened.publicId).toEqual(expect.any(String));
        } finally {
            release.resolve();
            restore();
        }
    });

    it("owner关闭后新建owner承接最新Agent presence probe", async () => {
        const ref = await createTempProject("probe-owner-reset-book");
        const firstProbe = vi.fn(() => false);
        const secondProbe = vi.fn(() => true);

        registerAgentPresenceProbe(firstProbe);
        const first = await openProject(ref, {kind: "user"}, workspaceRoot);
        expect(projectOccupancy(ref)?.agentActive).toBe(false);

        await closeAllProjects();
        registerAgentPresenceProbe(secondProbe);

        const second = await openProject(ref, {kind: "user"}, workspaceRoot);
        expect(second).not.toBe(first);
        expect(projectOccupancy(ref)?.agentActive).toBe(true);
        expect(secondProbe).toHaveBeenCalledWith(second);
    });

    it("Agent在场阻止grace，离场后到期关闭当前generation", async () => {
        const ref = await createTempProject("agent-book");
        const ready = await openProject(ref, {kind: "agent", sessionId: 7}, workspaceRoot);
        let agentRunning = true;
        registerAgentPresenceProbe((candidate) => candidate === ready && agentRunning);

        acquireUserPresence(ref, ready.publicId).release();
        const base = Date.now();
        await expect(sweepProjectSessions(base)).resolves.toEqual([]);
        expect(projectOccupancy(ref)).toEqual({
            state: "open",
            userConnections: 0,
            agentActive: true,
        });

        agentRunning = false;
        await expect(sweepProjectSessions(base)).resolves.toEqual([]);
        expect(projectOccupancy(ref)?.state).toBe("grace");
        await expect(sweepProjectSessions(base + PROJECT_GRACE_MS + 1)).resolves.toEqual([ref.projectRoot]);
        expect(isProjectOpen(ref)).toBe(false);
    });

    it("旧generation的Agent presence不会占用close/reopen后的新generation", async () => {
        const ref = await createTempProject("agent-generation-book");
        const staleReady = await openProject(ref, {kind: "agent", sessionId: 8}, workspaceRoot);
        registerAgentPresenceProbe((candidate) => candidate === staleReady);

        expect(projectOccupancy(ref)?.agentActive).toBe(true);
        await closeProject(ref, "shutdown");
        const currentReady = await openProject(ref, {kind: "job", source: "presence-reopen-test"}, workspaceRoot);

        expect(currentReady.generation).not.toBe(staleReady.generation);
        expect(projectOccupancy(ref)?.agentActive).toBe(false);
    });

    it("旧generation迟到release不会扣减重开后的presence", async () => {
        const ref = await createTempProject("generation-book");
        const first = await openProject(ref, {kind: "user"}, workspaceRoot);
        const staleRelease = acquireUserPresence(ref, first.publicId).release;

        await closeProject(ref, "shutdown");
        const second = await openProject(ref, {kind: "user"}, workspaceRoot);
        const currentRelease = acquireUserPresence(ref, second.publicId).release;
        staleRelease();

        expect(projectOccupancy(ref)).toEqual({
            state: "open",
            userConnections: 1,
            agentActive: false,
        });
        currentRelease();
    });

    it("grace-expired close会复检状态，open generation保持可用", async () => {
        const ref = await createTempProject("recheck-book");
        await openProject(ref, {kind: "user"}, workspaceRoot);

        await closeProject(ref, "grace-expired");

        expect(isProjectOpen(ref)).toBe(true);
        expect(projectOccupancy(ref)?.state).toBe("open");
    });

    it("activity只刷新ready generation，closeAll完成后数据面立即拒绝", async () => {
        markProjectActivity(projectWorkspaceRef("never-open"));
        expect(listOpenProjects()).toEqual([]);

        const ref = await createTempProject("shutdown-book");
        await openProject(ref, {kind: "user"}, workspaceRoot);
        const before = listOpenProjects()[0];
        await new Promise((resolve) => setTimeout(resolve, 15));
        markProjectActivity(ref);
        const after = listOpenProjects()[0];
        expect(after && before && after.lastActivityAt > before.lastActivityAt).toBe(true);

        await closeAllProjects();

        expect(listOpenProjects()).toEqual([]);
        expect(isProjectOpen(ref)).toBe(false);
        expect(() => assertProjectOpen(ref)).toThrow(ProjectNotOpenError);
    });
});

/** Windows下libSQL句柄释放可能稍有延迟，测试清理允许系统级短暂占用。 */
async function removeTempRootBestEffort(target: string): Promise<void> {
    try {
        collectReleasedSqliteHandles({force: true});
        await rm(target, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error
            && (error.code === "EBUSY" || error.code === "EPERM" || error.code === "ENOTEMPTY")) {
            consola.warn({target, error}, "清理临时Project目录失败，忽略");
            return;
        }
        throw error;
    }
}
