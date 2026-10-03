import {mkdir, mkdtemp, rename, rm, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {ProjectLifecycle, type ProjectLifecycleWatcherAdapter} from "nbook/server/workspace-files/project-lifecycle";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {ProjectLockModule} from "nbook/server/workspace-files/project-lock";
import {
    projectModuleToken,
    replaceProjectModulesForTest,
    type ProjectModule,
    type ProjectModuleName,
} from "nbook/server/workspace-files/project-module";
import {ProjectSessionRuntime} from "nbook/server/workspace-files/project-session-runtime";
import {ProjectNotOpenError, ProjectSessionService} from "nbook/server/workspace-files/project-session-service";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("ProjectLifecycle production shallow watcher", () => {
    it("真实chokidar ready后把一级Project事件收敛为完整浅重扫", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-lifecycle-watch-"));
        roots.push(workspaceRoot);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot));

        try {
            const initial = await lifecycle.readProjects();
            await vi.waitFor(() => {
                expect(lifecycle.diagnostics.watcher.state).toBe("ready");
            }, {timeout: 5_000});

            const projectRoot = path.join(workspaceRoot, "real-watcher-project");
            await mkdir(projectRoot);
            await writeFile(
                path.join(projectRoot, "project.yaml"),
                "kind: novel\ntitle: Real Watcher Project\nsummary: \"\"\n",
                "utf8",
            );

            await vi.waitFor(async () => {
                expect(lifecycle.diagnostics.revision).toBeGreaterThan(initial.revision);
                expect((await lifecycle.readProjects()).projects).toMatchObject([{
                    projectRoot: "real-watcher-project",
                    title: "Real Watcher Project",
                }]);
            }, {timeout: 5_000});
        } finally {
            await lifecycle.close();
        }

        expect(lifecycle.diagnostics.watcher.state).toBe("closed");
    });

    it("watcher ready前发生rename时，ready复核仍关闭被替换Session", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-root-replaced-before-ready-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "open-project");
        const movedRoot = path.join(workspaceRoot, "open-project-moved");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: Original Project\nsummary: \"\"\n",
            "utf8",
        );
        const readyGate = Promise.withResolvers<void>();
        const closeOrder: string[] = [];
        const watcherAdapter: ProjectLifecycleWatcherAdapter = {
            open: () => ({
                ready: readyGate.promise,
                close: async () => undefined,
            }),
        };
        const restoreModules = replaceProjectModulesForTest([
            recordingModule("database", closeOrder),
            recordingModule("history", closeOrder),
            recordingModule("file-index", closeOrder),
        ]);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {watcherAdapter, watchDebounceMs: 10});
        const service = new ProjectSessionService(absoluteFsPath(workspaceRoot), {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("open-project");

        try {
            const ready = await service.openProject(ref, {kind: "user"});
            await rename(projectRoot, movedRoot);
            await mkdir(projectRoot);
            await writeFile(
                path.join(projectRoot, "project.yaml"),
                "kind: novel\ntitle: Replacement Project\nsummary: \"\"\n",
                "utf8",
            );

            readyGate.resolve();

            await vi.waitFor(() => {
                expect(() => service.requireReadyProject(ref)).toThrow(ProjectNotOpenError);
                expect(ready.workspace.ref).toEqual(ref);
                expect(closeOrder).toEqual(["file-index", "history", "database"]);
            }, {timeout: 5_000});
        } finally {
            await service.closeAll().catch(() => undefined);
            restoreModules();
        }
    });

    it("真实浅watcher识别同路径ABA replacement并关闭已打开Session", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-root-replaced-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "open-project");
        const movedRoot = path.join(workspaceRoot, "open-project-moved");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: Original Project\nsummary: \"\"\n",
            "utf8",
        );
        const closeOrder: string[] = [];
        const restoreModules = replaceProjectModulesForTest([
            recordingModule("database", closeOrder),
            recordingModule("history", closeOrder),
            recordingModule("file-index", closeOrder),
        ]);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {watchDebounceMs: 10});
        const service = new ProjectSessionService(absoluteFsPath(workspaceRoot), {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const ref = projectWorkspaceRef("open-project");

        try {
            const ready = await service.openProject(ref, {kind: "user"});
            await vi.waitFor(() => {
                expect(lifecycle.diagnostics.watcher.state).toBe("ready");
            }, {timeout: 5_000});

            await rename(projectRoot, movedRoot);
            await mkdir(projectRoot);
            await writeFile(
                path.join(projectRoot, "project.yaml"),
                "kind: novel\ntitle: Replacement Project\nsummary: \"\"\n",
                "utf8",
            );

            await vi.waitFor(() => {
                expect(() => service.requireReadyProject(ref)).toThrow();
                expect(ready.workspace.ref).toEqual(ref);
                expect(closeOrder).toEqual(["file-index", "history", "database"]);
            }, {timeout: 5_000});
        } finally {
            await service.closeAll().catch(() => undefined);
            restoreModules();
        }
    });

    it("真实外部删除Project root后关闭Session并释放Occupancy", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-root-removed-"));
        roots.push(workspaceRoot);
        const projectRoot = path.join(workspaceRoot, "open-project");
        await mkdir(projectRoot);
        await writeFile(
            path.join(projectRoot, "project.yaml"),
            "kind: novel\ntitle: Open Project\nsummary: \"\"\n",
            "utf8",
        );
        const closeOrder: string[] = [];
        const restoreModules = replaceProjectModulesForTest([
            recordingModule("database", closeOrder),
            recordingModule("history", closeOrder),
            recordingModule("file-index", closeOrder),
        ]);
        const lifecycle = new ProjectLifecycle(absoluteFsPath(workspaceRoot), {watchDebounceMs: 10});
        const service = new ProjectSessionService(absoluteFsPath(workspaceRoot), {
            lifecycle,
            runtime: new ProjectSessionRuntime(),
        });
        const competitor = new ProjectLockModule(absoluteFsPath(workspaceRoot));
        const ref = projectWorkspaceRef("open-project");
        let competitorHandle: Awaited<ReturnType<ProjectLockModule["acquireOccupancy"]>> | null = null;

        try {
            await service.openProject(ref, {kind: "user"});
            await vi.waitFor(() => {
                expect(lifecycle.diagnostics.watcher.state).toBe("ready");
            }, {timeout: 5_000});
            await expect(competitor.acquireOccupancy(ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
                projectRoot: "open-project",
            });

            await rm(projectRoot, {recursive: true, force: true});

            await vi.waitFor(() => {
                expect(() => service.requireReadyProject(ref)).toThrow(ProjectNotOpenError);
                expect(closeOrder).toEqual(["file-index", "history", "database"]);
            }, {timeout: 5_000});
            await vi.waitFor(async () => {
                competitorHandle = await competitor.acquireOccupancy(ref);
            }, {timeout: 5_000});

            expect(service.listOpenProjects()).toEqual([]);
        } finally {
            await competitorHandle?.release();
            await service.closeAll().catch(() => undefined);
            restoreModules();
        }
    });
});

/** 建立只记录关闭顺序的required Module，隔离真实数据库与File Index资源。 */
function recordingModule(
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
