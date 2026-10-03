import {access, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createRuntimePaths} from "nbook/server/runtime/paths/runtime-paths";
import {resolveNovelWorkspaceTarget} from "nbook/server/workspace-files/novel-workspace";
import {
    deleteWorkspacePath,
    readWorkspaceTextFile,
    scanWorkspaceTree,
    writeWorkspaceTextFile,
} from "nbook/server/workspace-files/workspace-files";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("Workspace文件操作真实路径范围", () => {
    it("读取、写入和扫描拒绝链接逃逸，但删除可清理链接目录项", async () => {
        const fixture = await fixtureRoot();
        const stateRoot = path.join(fixture, "state");
        const projectRoot = path.join(stateRoot, "workspace", "project-a");
        const outsideRoot = path.join(stateRoot, "workspace", "outside-project");
        const marker = path.join(outsideRoot, "marker.md");
        await Promise.all([mkdir(projectRoot, {recursive: true}), mkdir(outsideRoot, {recursive: true})]);
        await writeFile(marker, "outside", "utf8");
        await symlink(outsideRoot, path.join(projectRoot, "escape"), process.platform === "win32" ? "junction" : "dir");
        const root = absoluteFsPath(projectRoot);

        await expect(readWorkspaceTextFile(root, "escape/marker.md"))
            .rejects.toThrow("真实路径越过文件系统根");
        await expect(writeWorkspaceTextFile(root, "escape/new.md", "bad"))
            .rejects.toThrow("真实路径越过文件系统根");
        await expect(scanWorkspaceTree({root, targets: ["escape"]}))
            .rejects.toThrow("真实路径越过文件系统根");

        await deleteWorkspacePath(root, "escape", true);
        await access(marker);
        await expect(access(path.join(projectRoot, "escape"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Project Workspace根链接到State Root外时Target Adapter拒绝授权", async () => {
        const fixture = await fixtureRoot();
        const stateRoot = path.join(fixture, "state");
        const outsideRoot = path.join(fixture, "outside-state");
        await Promise.all([mkdir(path.join(stateRoot, "workspace"), {recursive: true}), mkdir(outsideRoot, {recursive: true})]);
        const projectRoot = path.join(stateRoot, "workspace", "project-a");
        await symlink(outsideRoot, projectRoot, process.platform === "win32" ? "junction" : "dir");
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(fixture),
            stateRoot: absoluteFsPath(stateRoot),
        });

        await expect(resolveNovelWorkspaceTarget(runtimePaths, "project-a"))
            .rejects.toThrow("不能是symlink或junction");
        await expect(access(path.join(outsideRoot, "new.md"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("Project Workspace根链接到Workspace Root内部时仍拒绝别名身份", async () => {
        const fixture = await fixtureRoot();
        const stateRoot = path.join(fixture, "state");
        const workspaceRoot = path.join(stateRoot, "workspace");
        const targetRoot = path.join(workspaceRoot, "project-target");
        await mkdir(targetRoot, {recursive: true});
        await symlink(targetRoot, path.join(workspaceRoot, "project-alias"), process.platform === "win32" ? "junction" : "dir");
        const runtimePaths = createRuntimePaths({
            applicationRoot: absoluteFsPath(fixture),
            stateRoot: absoluteFsPath(stateRoot),
        });

        await expect(resolveNovelWorkspaceTarget(runtimePaths, "project-alias"))
            .rejects.toThrow("不能是symlink或junction");
    });
});

/** 创建隔离Application Root。 */
async function fixtureRoot(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-workspace-containment-"));
    roots.push(root);
    return root;
}
