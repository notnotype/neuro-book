import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {testAbsoluteFsPath} from "nbook/server/runtime/paths/test-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
    type ProjectWorkspaceRef,
} from "nbook/server/workspace-files/project-identity";
import {
    ProjectLifecycleError,
    type PreparedProjectOpen,
    type ProjectListEntry,
} from "nbook/server/workspace-files/project-lifecycle";
import {ProjectInUseError} from "nbook/server/workspace-files/project-lock";
import {
    projectModuleToken,
    type ProjectModule,
    type ProjectModuleName,
    type ProjectModuleRegistrySnapshot,
} from "nbook/server/workspace-files/project-module";
import {ProjectSessionRuntime} from "nbook/server/workspace-files/project-session-runtime";
import {
    ProjectSessionService,
    type ProjectControlLifecycle,
} from "nbook/server/workspace-files/project-session-service";

type ProjectSessionGlobalState = {
    lifecycle: ProjectControlLifecycle | null;
    service: ProjectSessionService | null;
    workspaceRoot: AbsoluteFsPath | null;
    agentProbe: null;
    maintenanceTimer: ReturnType<typeof setInterval> | null;
    sweepInFlight: boolean;
};

const globalForProjectSession = globalThis as typeof globalThis & {
    __nbookProjectSessionV2?: ProjectSessionGlobalState;
};

describe("project-session HMR boundaries", () => {
    afterEach(async () => {
        const state = globalForProjectSession.__nbookProjectSessionV2;
        if (state?.maintenanceTimer) {
            clearInterval(state.maintenanceTimer);
        }
        await state?.service?.closeAll().catch(() => undefined);
        delete globalForProjectSession.__nbookProjectSessionV2;
        vi.resetModules();
    });

    it("复用旧Service并由新mapper与guard识别旧typed errors，最终只关闭一次", async () => {
        const workspaceRoot = testAbsoluteFsPath("project-session-hmr", "workspace-root");
        const otherRoot = testAbsoluteFsPath("project-session-hmr", "other-root");
        const prepared = preparedProject(workspaceRoot, "alpha");
        const moduleClose = {
            database: vi.fn(async () => undefined),
            history: vi.fn(async () => undefined),
            "file-index": vi.fn(async () => undefined),
        };
        const registry = moduleRegistry(moduleClose);
        const lifecycle = controlLifecycle(prepared);
        const oldService = new ProjectSessionService(workspaceRoot, {
            lifecycle,
            runtime: new ProjectSessionRuntime({registryProvider: () => registry}),
        });

        let oldNotOpen: Error | null = null;
        try {
            oldService.requireReadyProject(projectWorkspaceRef("missing"));
        } catch (error) {
            oldNotOpen = requireError(error);
        }
        if (!oldNotOpen) {
            throw new Error("Expected ProjectNotOpenError");
        }

        const oldLifecycle = new ProjectLifecycleError("PROJECT_NOT_FOUND", "old lifecycle error");
        const lifecycleFailureService = new ProjectSessionService(workspaceRoot, {
            lifecycle: controlLifecycle(prepared, {
                readProjects: async () => {
                    throw oldLifecycle;
                },
            }),
        });
        await expect(lifecycleFailureService.listProjects()).rejects.toBe(oldLifecycle);
        await lifecycleFailureService.closeAll();

        const oldLock = new ProjectInUseError("alpha", new Error("occupied"));
        const lockFailureService = new ProjectSessionService(workspaceRoot, {
            lifecycle: controlLifecycle(prepared, {
                prepareOpen: async () => {
                    throw oldLock;
                },
            }),
        });
        await expect(lockFailureService.openProject(prepared.workspace.ref, {kind: "user"})).rejects.toBe(oldLock);
        await lockFailureService.closeAll();

        globalForProjectSession.__nbookProjectSessionV2 = {
            lifecycle,
            service: oldService,
            workspaceRoot,
            agentProbe: null,
            maintenanceTimer: null,
            sweepInFlight: false,
        };

        vi.resetModules();
        const facade = await import("nbook/server/workspace-files/project-session");
        const {createProjectHttpError} = await import("nbook/server/api/projects/project-http-error");
        const {withProjectHttpError} = await import("nbook/server/api/projects/project-http-error");

        const ref = projectWorkspaceRef("alpha");
        const first = await facade.openProject(ref, {kind: "user"}, workspaceRoot);
        const second = await facade.openProject(ref, {kind: "agent", sessionId: 7}, workspaceRoot);
        expect(second).toBe(first);
        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);

        await expect(facade.openProject(ref, {kind: "user"}, otherRoot))
            .rejects.toThrow("ProjectSession Service已经绑定到另一个Workspace Root");
        expect(lifecycle.prepareOpen).toHaveBeenCalledTimes(1);

        expect(createProjectHttpError(oldNotOpen)?.data).toEqual({
            code: "PROJECT_NOT_OPEN",
            projectRoot: "missing",
        });
        expect(createProjectHttpError(oldLifecycle)?.data).toEqual({code: "PROJECT_NOT_FOUND"});
        expect(createProjectHttpError(oldLock)?.data).toEqual({code: "PROJECT_IN_USE", projectRoot: "alpha"});
        await expect(withProjectHttpError(() => {
            throw oldNotOpen;
        })).rejects.toMatchObject({
            statusCode: 409,
            data: {code: "PROJECT_NOT_OPEN", projectRoot: "missing"},
        });

        await facade.closeAllProjects();
        let oldRuntimeClosed: Error | null = null;
        try {
            await oldService.openProject(prepared.workspace.ref, {kind: "user"});
        } catch (error) {
            oldRuntimeClosed = requireError(error);
        }
        if (!oldRuntimeClosed) {
            throw new Error("Expected ProjectSessionRuntimeClosedError");
        }
        expect(createProjectHttpError(oldRuntimeClosed)?.data).toEqual({
            code: "PROJECT_SESSION_RUNTIME_CLOSED",
        });

        await facade.closeAllProjects();
        expect(lifecycle.close).toHaveBeenCalledTimes(1);
        expect(prepared.occupancy.release).toHaveBeenCalledTimes(1);
        expect(moduleClose.database).toHaveBeenCalledTimes(1);
        expect(moduleClose.history).toHaveBeenCalledTimes(1);
        expect(moduleClose["file-index"]).toHaveBeenCalledTimes(1);
    }, 30_000);
});

/** 建立完全内存化的旧 generation，避免 HMR 回归依赖文件系统。 */
function preparedProject(workspaceRoot: AbsoluteFsPath, projectRoot: string): PreparedProjectOpen {
    const ref = projectWorkspaceRef(projectRoot);
    const workspace = resolvedProjectWorkspace(
        ref,
        absoluteFsPath(`${workspaceRoot}/${projectRoot}`),
        createProjectWorkspaceKey(workspaceRoot, ref),
    );
    return {
        revision: 1,
        project: projectEntry(ref),
        change: "none",
        workspaceRoot,
        workspace,
        occupancy: {
            kind: "project-occupancy",
            compromised: new Promise<never>(() => undefined),
            assertHealthy: () => undefined,
            release: vi.fn(async () => undefined),
        },
    };
}

/** 建立只启动三个 required Module 的隔离 registry。 */
function moduleRegistry(close: {
    readonly database: () => Promise<void>;
    readonly history: () => Promise<void>;
    readonly "file-index": () => Promise<void>;
}): ProjectModuleRegistrySnapshot {
    const names: readonly Extract<ProjectModuleName, "database" | "history" | "file-index">[] = [
        "database",
        "history",
        "file-index",
    ];
    const required: ProjectModule[] = names.map((name) => ({
        token: projectModuleToken(name, "required"),
        start: () => ({ready: Promise.resolve(), close: close[name]}),
    }));
    return Object.freeze({required: Object.freeze(required), lazy: Object.freeze([])});
}

/** 建立可定制失败点的旧 Lifecycle port。 */
function controlLifecycle(
    prepared: PreparedProjectOpen,
    overrides: Partial<ProjectControlLifecycle> = {},
): ProjectControlLifecycle {
    return {
        readProjects: vi.fn(async () => ({revision: prepared.revision, projects: [prepared.project]})),
        readCandidates: vi.fn(async () => ({revision: prepared.revision, candidates: []})),
        create: vi.fn(async () => ({revision: prepared.revision, project: prepared.project})),
        updateMetadata: vi.fn(async () => ({revision: prepared.revision, project: prepared.project})),
        delete: vi.fn(async (ref) => ({revision: prepared.revision, projectRoot: ref.projectRoot})),
        prepareOpen: vi.fn(async () => prepared),
        observeWorkspace: vi.fn(() => () => undefined),
        close: vi.fn(async () => undefined),
        ...overrides,
    };
}

/** 建立控制面公开的最小 Project metadata。 */
function projectEntry(ref: ProjectWorkspaceRef): ProjectListEntry {
    return Object.freeze({...ref, kind: "novel", title: "Alpha", summary: ""});
}

/** 测试只接受真实 Error，避免类型断言掩盖非标准 rejection。 */
function requireError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }
    throw new Error(`Expected Error, received ${String(error)}`);
}
