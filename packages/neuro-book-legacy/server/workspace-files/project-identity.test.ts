import {access, mkdir, mkdtemp, realpath, rename, rm, symlink} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it, vi} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Project identity", () => {
    it("稳定Workspace Root alias共享Project key与Occupancy identity", async () => {
        const containerRoot = await mkdtemp(testHostPath("nbook-workspace-alias-"));
        roots.push(containerRoot);
        const physicalWorkspaceRoot = path.join(containerRoot, "physical-workspace");
        const aliasWorkspaceRoot = path.join(containerRoot, "workspace-alias");
        const projectRoot = path.join(physicalWorkspaceRoot, "alpha");
        await mkdir(projectRoot, {recursive: true});
        await symlink(
            physicalWorkspaceRoot,
            aliasWorkspaceRoot,
            process.platform === "win32" ? "junction" : "dir",
        );
        const module = await import("nbook/server/workspace-files/project-lifecycle");
        const ref = module.projectWorkspaceRef("alpha");
        const physicalLifecycle = new module.ProjectLifecycle(absoluteFsPath(physicalWorkspaceRoot));
        const aliasLifecycle = new module.ProjectLifecycle(absoluteFsPath(aliasWorkspaceRoot));
        const physicalOpen = await physicalLifecycle.prepareOpen(ref);
        let aliasOpen: Awaited<ReturnType<typeof aliasLifecycle.prepareOpen>> | null = null;

        try {
            await expect(aliasLifecycle.prepareOpen(ref)).rejects.toMatchObject({
                code: "PROJECT_IN_USE",
                projectRoot: "alpha",
            });

            await physicalOpen.occupancy.release();
            aliasOpen = await aliasLifecycle.prepareOpen(ref);
            expect(aliasOpen.workspace.key).toBe(physicalOpen.workspace.key);
            expect(aliasOpen.workspace.root).toBe(await realpath(projectRoot));
        } finally {
            await aliasOpen?.occupancy.release();
            await physicalOpen.occupancy.release();
            await aliasLifecycle.close();
            await physicalLifecycle.close();
        }
    });

    it("Portable State Root关闭后移动时按projectRoot重建新Lifecycle identity", async () => {
        const containerRoot = await mkdtemp(testHostPath("nbook-portable-move-"));
        roots.push(containerRoot);
        const oldStateRoot = path.join(containerRoot, "state-a");
        const newStateRoot = path.join(containerRoot, "state-b");
        const oldWorkspaceRoot = path.join(oldStateRoot, "workspace");
        const oldProjectRoot = path.join(oldWorkspaceRoot, "alpha");
        await mkdir(oldProjectRoot, {recursive: true});
        const module = await import("nbook/server/workspace-files/project-lifecycle");
        const ref = module.projectWorkspaceRef("alpha");
        const oldLifecycle = new module.ProjectLifecycle(absoluteFsPath(oldWorkspaceRoot));
        const oldOpen = await oldLifecycle.prepareOpen(ref);
        const oldKey = oldOpen.workspace.key;
        await oldOpen.occupancy.release();
        await oldLifecycle.close();

        await rename(oldStateRoot, newStateRoot);
        const newWorkspaceRoot = path.join(newStateRoot, "workspace");
        const newProjectRoot = path.join(newWorkspaceRoot, "alpha");
        const newLifecycle = new module.ProjectLifecycle(absoluteFsPath(newWorkspaceRoot));
        let newOpen: Awaited<ReturnType<typeof newLifecycle.prepareOpen>> | null = null;

        try {
            newOpen = await newLifecycle.prepareOpen(ref);
            expect(newOpen.workspace.ref).toEqual(ref);
            expect(newOpen.workspace.root).toBe(await realpath(newProjectRoot));
            expect(newOpen.workspace.key).not.toBe(oldKey);
            await expect(access(oldStateRoot)).rejects.toMatchObject({code: "ENOENT"});
        } finally {
            await newOpen?.occupancy.release();
            await newLifecycle.close();
        }
    });

    it("连续HMR Lifecycle generation关闭旧浅watcher后不残留active handle", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-hmr-watcher-"));
        roots.push(workspaceRoot);
        let watcherOpenCount = 0;
        let watcherCloseCount = 0;
        let activeWatcherCount = 0;
        let maximumActiveWatcherCount = 0;
        const watcherAdapter = {
            open: () => {
                watcherOpenCount += 1;
                activeWatcherCount += 1;
                maximumActiveWatcherCount = Math.max(maximumActiveWatcherCount, activeWatcherCount);
                let closed = false;
                return {
                    ready: Promise.resolve(),
                    close: async () => {
                        if (closed) {
                            return;
                        }
                        closed = true;
                        watcherCloseCount += 1;
                        activeWatcherCount -= 1;
                    },
                };
            },
        };

        for (let generation = 0; generation < 3; generation += 1) {
            vi.resetModules();
            const module = await import("nbook/server/workspace-files/project-lifecycle");
            const lifecycle = new module.ProjectLifecycle(absoluteFsPath(workspaceRoot), {watcherAdapter});
            await lifecycle.readProjects();
            await Promise.resolve();
            expect(activeWatcherCount).toBe(1);
            await lifecycle.close();
            expect(activeWatcherCount).toBe(0);
        }

        expect(watcherOpenCount).toBe(3);
        expect(watcherCloseCount).toBe(3);
        expect(maximumActiveWatcherCount).toBe(1);
    });

    it("ProjectWorkspaceKey 在模块重新加载后仍是同一 symbol", async () => {
        const workspaceRoot = await mkdtemp(testHostPath("nbook-project-hmr-"));
        roots.push(workspaceRoot);
        await mkdir(path.join(workspaceRoot, "alpha"));

        vi.resetModules();
        const firstModule = await import("nbook/server/workspace-files/project-lifecycle");
        const firstLifecycle = new firstModule.ProjectLifecycle(absoluteFsPath(workspaceRoot));
        const firstOpen = await firstLifecycle.prepareOpen(firstModule.projectWorkspaceRef("alpha"));
        const firstKey = firstOpen.workspace.key;
        await firstOpen.occupancy.release();
        await firstLifecycle.close();

        vi.resetModules();
        const secondModule = await import("nbook/server/workspace-files/project-lifecycle");
        const secondLifecycle = new secondModule.ProjectLifecycle(absoluteFsPath(workspaceRoot));

        try {
            const secondOpen = await secondLifecycle.prepareOpen(secondModule.projectWorkspaceRef("alpha"));
            const secondKey = secondOpen.workspace.key;
            await secondOpen.occupancy.release();
            expect(secondKey).toBe(firstKey);
        } finally {
            await secondLifecycle.close();
        }
    });
});
