import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {afterEach, describe, expect, it} from "vitest";
import {absoluteFsPath, type AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {closeWorkspaceTreeIndex, readPlainWorkspaceTreeSnapshot} from "nbook/server/workspace-files/project-workspace-index";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {
    assertWorkspaceStorageBoundary,
    isWorkspaceStoragePath,
    WorkspaceStorageBoundaryError,
} from "nbook/server/workspace-files/workspace-storage-boundary";
import {USER_LOCAL_ACTOR, deleteWorkspacePathTracked, renameWorkspacePathTracked, writeWorkspaceTextFileTracked} from "nbook/server/workspace-history/tracked-workspace-files";

const createdRoots: AbsoluteFsPath[] = [];

/** 建立一次测试用的 Workspace Root，并登记关闭与清理。 */
async function createWorkspaceRoot(label: string): Promise<AbsoluteFsPath> {
    const root = absoluteFsPath(testHostPath("workspace-storage-boundary", `${label}-${randomUUID()}`));
    createdRoots.push(root);
    await fs.mkdir(root, {recursive: true});
    return root;
}

/** 写入一条带可比较字节的 Storage 记录，模拟模块正式落盘内容。 */
async function writeStorageRecord(storageRoot: string, name = "shelf.json"): Promise<string> {
    const recordPath = path.join(storageRoot, "records", name);
    await fs.mkdir(path.dirname(recordPath), {recursive: true});
    await fs.writeFile(recordPath, "{\"revision\":\"original\"}\n", "utf-8");
    return recordPath;
}

describe("WorkspaceStorageBoundary", () => {
    afterEach(async () => {
        await Promise.all(createdRoots.map((root) => closeWorkspaceTreeIndex(root)));
        await Promise.all(createdRoots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
    });

    it("project 目标拒绝 Storage 读写，但放行普通同名目录与 .nbook 其它文件", async () => {
        const root = await createWorkspaceRoot("project");
        const target: WorkspaceFileTarget = {
            kind: "project-workspace",
            root,
            projectRoot: projectWorkspaceRef("proj").projectRoot,
        };
        const storageRecord = await writeStorageRecord(path.join(root, ".nbook", "storage"));
        await fs.mkdir(path.join(root, "notes", "storage"), {recursive: true});
        await fs.writeFile(path.join(root, "notes", "storage", "note.md"), "普通目录\n", "utf-8");

        for (const access of ["read", "mutation"] as const) {
            await expect(assertWorkspaceStorageBoundary(target, ".nbook/storage/records/shelf.json", access))
                .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
            await expect(assertWorkspaceStorageBoundary(target, ".nbook/storage", access))
                .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
            await expect(assertWorkspaceStorageBoundary(target, "notes/storage/note.md", access))
                .resolves.toBeUndefined();
        }
        await expect(assertWorkspaceStorageBoundary(target, ".nbook/config.json", "read")).resolves.toBeUndefined();
        await expect(assertWorkspaceStorageBoundary(target, ".nbook", "mutation"))
            .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
        await expect(fs.readFile(storageRecord, "utf-8")).resolves.toBe("{\"revision\":\"original\"}\n");
    });

    it("user-assets 根只保护根级 storage/，不放行也不误伤同名子目录", async () => {
        const workspaceRoot = await createWorkspaceRoot("user-assets");
        const userAssetsRoot = path.join(workspaceRoot, ".nbook");
        await fs.mkdir(userAssetsRoot, {recursive: true});
        const target: WorkspaceFileTarget = {kind: "user-assets", root: absoluteFsPath(userAssetsRoot)};
        await writeStorageRecord(path.join(userAssetsRoot, "storage"));
        await fs.mkdir(path.join(userAssetsRoot, "notes", "storage"), {recursive: true});
        await fs.writeFile(path.join(userAssetsRoot, "notes", "storage", "note.md"), "普通目录\n", "utf-8");

        for (const access of ["read", "mutation"] as const) {
            await expect(assertWorkspaceStorageBoundary(target, "storage/records/shelf.json", access))
                .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
            await expect(assertWorkspaceStorageBoundary(target, "notes/storage/note.md", access))
                .resolves.toBeUndefined();
            // user-assets 根就是 `.nbook`，其下的 `.nbook/` 只是普通同名目录。
            await expect(assertWorkspaceStorageBoundary(target, ".nbook/storage/note.md", access))
                .resolves.toBeUndefined();
        }
    });

    it("workspace-root 保护 user 与每个 Project 的 Storage，不把 storage 当保留词", async () => {
        const root = await createWorkspaceRoot("workspace-root");
        const target: WorkspaceFileTarget = {kind: "workspace-root", root};
        await writeStorageRecord(path.join(root, ".nbook", "storage"));
        await writeStorageRecord(path.join(root, "proj", ".nbook", "storage"));
        await fs.writeFile(path.join(root, "proj", "manuscript.md"), "正文\n", "utf-8");
        await fs.writeFile(path.join(root, "note.md"), "普通文件\n", "utf-8");

        for (const relativePath of [
            ".nbook/storage/records/shelf.json",
            "proj/.nbook/storage/records/shelf.json",
        ]) {
            for (const access of ["read", "mutation"] as const) {
                await expect(assertWorkspaceStorageBoundary(target, relativePath, access))
                    .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
            }
        }
        for (const relativePath of ["proj/.nbook", "proj", ".nbook"]) {
            await expect(assertWorkspaceStorageBoundary(target, relativePath, "mutation"))
                .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
        }
        for (const relativePath of [
            "storage/notes.md",
            "note.md",
            "not-created-yet",
            "proj/manuscript.md",
            "proj/.nbook/config.json",
            "other/.nbook/note.md",
        ]) {
            await expect(assertWorkspaceStorageBoundary(target, relativePath, "read")).resolves.toBeUndefined();
            await expect(assertWorkspaceStorageBoundary(target, relativePath, "mutation")).resolves.toBeUndefined();
        }
    });

    it.runIf(process.platform === "win32")("Windows 上大小写与反斜线写法指向同一 Storage 根", async () => {
        const root = await createWorkspaceRoot("windows-case");
        const target: WorkspaceFileTarget = {kind: "workspace-root", root};
        await writeStorageRecord(path.join(root, ".nbook", "storage"));

        for (const relativePath of [".NBOOK/STORAGE/records/shelf.json", ".nbook\\storage\\records\\shelf.json"]) {
            await expect(assertWorkspaceStorageBoundary(target, relativePath, "mutation"))
                .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
            expect(isWorkspaceStoragePath(target, relativePath)).toBe(true);
        }
    });

    it("链接别名指进 Storage 也不能作为普通文件入口", async (context) => {
        const root = await createWorkspaceRoot("alias");
        const target: WorkspaceFileTarget = {
            kind: "project-workspace",
            root,
            projectRoot: projectWorkspaceRef("proj").projectRoot,
        };
        await writeStorageRecord(path.join(root, ".nbook", "storage"));
        try {
            await fs.symlink(
                path.join(root, ".nbook", "storage"),
                path.join(root, "alias"),
                process.platform === "win32" ? "junction" : "dir",
            );
        } catch {
            context.skip();
            return;
        }

        for (const access of ["read", "mutation"] as const) {
            await expect(assertWorkspaceStorageBoundary(target, "alias/records/shelf.json", access))
                .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
        }
    });

    it("workspace-root 只拦住真实承载 Storage 的一级目录，普通目录仍可改名与删除", async () => {
        const root = await createWorkspaceRoot("workspace-root-plain-dir");
        const target: WorkspaceFileTarget = {kind: "workspace-root", root};
        await fs.mkdir(path.join(root, "plain"), {recursive: true});
        await fs.writeFile(path.join(root, "plain", "note.md"), "普通文件", "utf-8");
        await writeStorageRecord(path.join(root, "proj", ".nbook", "storage"));

        await expect(assertWorkspaceStorageBoundary(target, "plain", "mutation")).resolves.toBeUndefined();
        await expect(assertWorkspaceStorageBoundary(target, "missing-dir", "mutation")).resolves.toBeUndefined();
        await expect(assertWorkspaceStorageBoundary(target, "proj", "mutation")).rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);

        await renameWorkspacePathTracked({target, fromPath: "plain", toPath: "renamed", actor: USER_LOCAL_ACTOR});
        await expect(fs.readFile(path.join(root, "renamed", "note.md"), "utf-8")).resolves.toBe("普通文件");
        await deleteWorkspacePathTracked({target, filePath: "renamed", recursive: true, actor: USER_LOCAL_ACTOR});
        await expect(fs.access(path.join(root, "renamed"))).rejects.toMatchObject({code: "ENOENT"});

        await expect(renameWorkspacePathTracked({target, fromPath: "proj", toPath: "moved", actor: USER_LOCAL_ACTOR}))
            .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
        await expect(fs.access(path.join(root, "proj", ".nbook", "storage", "records", "shelf.json"))).resolves.toBeUndefined();
    });

    it("普通 mutation 拒绝搬运 Storage，且磁盘记录与普通文件保持原样", async () => {
        const root = await createWorkspaceRoot("mutation");
        const target: WorkspaceFileTarget = {
            kind: "project-workspace",
            root,
            projectRoot: projectWorkspaceRef("proj").projectRoot,
        };
        const storageRecord = await writeStorageRecord(path.join(root, ".nbook", "storage"));

        await expect(writeWorkspaceTextFileTracked({
            target,
            filePath: ".nbook/storage/records/shelf.json",
            content: "{\"revision\":\"attacker\"}\n",
            actor: USER_LOCAL_ACTOR,
        })).rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
        await expect(deleteWorkspacePathTracked({
            target,
            filePath: ".nbook",
            recursive: true,
            actor: USER_LOCAL_ACTOR,
        })).rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
        await expect(renameWorkspacePathTracked({
            target,
            fromPath: ".nbook",
            toPath: "moved-nbook",
            actor: USER_LOCAL_ACTOR,
        })).rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);

        await expect(fs.readFile(storageRecord, "utf-8")).resolves.toBe("{\"revision\":\"original\"}\n");
        await expect(fs.access(path.join(root, "moved-nbook"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("根目录的普通删除明确拒绝，已存 Storage 字节保持不变", async () => {
        const root = await createWorkspaceRoot("root-mutation");
        const target: WorkspaceFileTarget = {kind: "user-assets", root};
        const record = await writeStorageRecord(path.join(root, "storage"));
        await expect(deleteWorkspacePathTracked({target, filePath: ".", recursive: true, actor: USER_LOCAL_ACTOR}))
            .rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);
        await expect(fs.readFile(record, "utf8")).resolves.toBe('{"revision":"original"}\n');
    });

    it("别名真实路径无法解析时直接拒绝，不把失败当成无 Storage", async () => {
        const root = await createWorkspaceRoot("unresolved-alias");
        const target: WorkspaceFileTarget = {kind: "user-assets", root};
        await fs.symlink(path.join(root, "missing"), path.join(root, "alias"), process.platform === "win32" ? "junction" : "dir");
        await expect(assertWorkspaceStorageBoundary(target, "alias/file.json", "mutation"))
            .rejects.toMatchObject({code: "ENOENT"});
    });

    it("普通 notes/storage 仍可正常写入", async () => {
        const root = await createWorkspaceRoot("plain-storage-name");
        const target: WorkspaceFileTarget = {kind: "workspace-root", root};

        await writeWorkspaceTextFileTracked({
            target,
            filePath: "notes/storage/note.md",
            content: "普通目录\n",
            actor: USER_LOCAL_ACTOR,
        });

        await expect(fs.readFile(path.join(root, "notes", "storage", "note.md"), "utf-8")).resolves.toBe("普通目录\n");
    });

    it("user-assets 文件树不出现 Storage 内部记录", async () => {
        const workspaceRoot = await createWorkspaceRoot("user-assets-tree");
        const userAssetsRoot = path.join(workspaceRoot, ".nbook");
        await fs.mkdir(path.join(userAssetsRoot, "notes"), {recursive: true});
        await fs.writeFile(path.join(userAssetsRoot, "notes", "note.md"), "普通文件\n", "utf-8");
        await writeStorageRecord(path.join(userAssetsRoot, "storage"));
        const target: WorkspaceFileTarget = {kind: "user-assets", root: absoluteFsPath(userAssetsRoot)};

        const snapshot = await readPlainWorkspaceTreeSnapshot({target});

        const paths = snapshot.nodes.map((node) => node.path);
        expect(paths).toContain("notes/note.md");
        expect(paths.some((nodePath) => nodePath.startsWith("storage"))).toBe(false);
    });
});
