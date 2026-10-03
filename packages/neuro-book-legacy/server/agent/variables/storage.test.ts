import {access, mkdir, mkdtemp, readFile, rm, symlink} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
    pendingVariableFileLockCountForTest,
    VariableFileStorage,
} from "nbook/server/agent/variables/storage";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {
    createProjectWorkspaceKey,
    projectWorkspaceRef,
    resolvedProjectWorkspace,
    type ResolvedProjectWorkspace,
} from "nbook/server/workspace-files/project-identity";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("VariableFileStorage文件范围", () => {
    it("同一路径串行写入且不同路径完成后都会释放队列", async () => {
        const fixture = await fixtureRoot();
        const workspaceRoot = absoluteFsPath(path.join(fixture, "workspace"));
        const projectRoot = absoluteFsPath(path.join(workspaceRoot, "project-a"));
        await mkdir(projectRoot, {recursive: true});
        const storage = new VariableFileStorage(workspaceRoot, projectWorkspace(workspaceRoot, projectRoot));

        await Promise.all([
            storage.patch("global", "first", [{op: "replace", path: "", value: 1}]),
            storage.patch("global", "second", [{op: "replace", path: "", value: 2}]),
            storage.patch("project", "third", [{op: "replace", path: "", value: 3}]),
        ]);

        await expect(storage.read("global")).resolves.toEqual({first: 1, second: 2});
        await expect(storage.read("project")).resolves.toEqual({third: 3});
        expect(pendingVariableFileLockCountForTest()).toBe(0);
    });

    it("Project变量只使用构造时绑定的Resolved Project Workspace", async () => {
        const fixture = await fixtureRoot();
        const workspaceRoot = absoluteFsPath(path.join(fixture, "workspace"));
        const projectRoot = absoluteFsPath(path.join(workspaceRoot, "project-a"));
        await mkdir(projectRoot, {recursive: true});
        const storage = new VariableFileStorage(workspaceRoot, projectWorkspace(workspaceRoot, projectRoot));

        await storage.patch("project", "preferences", [{op: "replace", path: "", value: {theme: "dark"}}]);

        const storedPath = path.join(workspaceRoot, "project-a", ".nbook", "agent", "variables.json");
        await expect(access(storedPath)).resolves.toBeUndefined();
        await expect(readFile(storedPath, "utf8")).resolves.toContain('"theme": "dark"');
    });

    it("Global变量拒绝通过junction或symlink写到Runtime Workspace Root外", async () => {
        const fixture = await fixtureRoot();
        const workspaceRoot = absoluteFsPath(path.join(fixture, "workspace"));
        const outsideRoot = path.join(fixture, "outside");
        await Promise.all([mkdir(workspaceRoot, {recursive: true}), mkdir(outsideRoot, {recursive: true})]);
        await symlink(outsideRoot, path.join(workspaceRoot, ".nbook"), process.platform === "win32" ? "junction" : "dir");
        const storage = new VariableFileStorage(workspaceRoot);

        await expect(storage.read("global")).rejects.toThrow("真实路径越过文件系统根");
        await expect(storage.patch("global", "preferences", [{op: "replace", path: "", value: {theme: "dark"}}]))
            .rejects.toThrow("真实路径越过文件系统根");
        await expect(access(path.join(outsideRoot, "agent", "variables.json"))).rejects.toMatchObject({code: "ENOENT"});

        expect(pendingVariableFileLockCountForTest()).toBe(0);
        await rm(path.join(workspaceRoot, ".nbook"), {recursive: true, force: true});
        await storage.patch("global", "recovered", [{op: "replace", path: "", value: true}]);
        await expect(storage.read("global")).resolves.toEqual({recovered: true});
        expect(pendingVariableFileLockCountForTest()).toBe(0);
    });
});

/** 创建隔离Runtime根。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-variable-storage-"));
    roots.push(root);
    return root;
}

/** 为Variable storage测试构造Lifecycle已经验证过的Project Workspace。 */
function projectWorkspace(workspaceRoot: ReturnType<typeof absoluteFsPath>, projectRoot: ReturnType<typeof absoluteFsPath>): ResolvedProjectWorkspace {
    const ref = projectWorkspaceRef(path.basename(projectRoot));
    return resolvedProjectWorkspace(ref, projectRoot, createProjectWorkspaceKey(workspaceRoot, ref));
}
