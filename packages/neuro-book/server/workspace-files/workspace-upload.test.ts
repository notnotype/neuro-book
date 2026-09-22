import fs from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {zipSync} from "fflate";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {WorkspaceFileTarget} from "nbook/server/workspace-files/workspace-file-target";
import {WorkspaceStorageBoundaryError} from "nbook/server/workspace-files/workspace-storage-boundary";
import {
    PROJECT_UPLOAD_LIMIT_BYTES,
    uploadWorkspaceFile,
    uploadWorkspaceProjectFiles,
    uploadWorkspaceProjectZip,
    WorkspaceUploadError,
} from "nbook/server/workspace-files/workspace-upload";

describe("workspace-upload", () => {
    let root: string;
    let target: WorkspaceFileTarget;

    beforeEach(async () => {
        root = testHostPath("workspace-upload-test", randomUUID());
        await fs.mkdir(root, {recursive: true});
        target = {kind: "workspace-root", root: absoluteFsPath(root)};
    });

    afterEach(async () => {
        await fs.rm(root, {recursive: true, force: true});
    });

    it("uploads a single file into upload/ and skips existing files", async () => {
        const first = await uploadWorkspaceFile(target, {
            fileName: "cover.jpg",
            data: Buffer.from([1, 2, 3]),
        });
        const second = await uploadWorkspaceFile(target, {
            fileName: "cover.jpg",
            data: Buffer.from([9, 9, 9]),
        });

        expect(first).toMatchObject({written: 1, skipped: 0});
        expect(second).toMatchObject({written: 0, skipped: 1});
        await expect(fs.readFile(path.join(root, "upload", "cover.jpg"))).resolves.toEqual(Buffer.from([1, 2, 3]));
    });

    it("preserves project directory relative paths", async () => {
        const result = await uploadWorkspaceProjectFiles(target, [
            {fileName: "index.md", relativePath: "manuscript/001/index.md", data: Buffer.from("# 1\n")},
            {fileName: "hero.png", relativePath: "assets/images/hero.png", data: Buffer.from([4, 5, 6])},
        ]);

        expect(result).toMatchObject({written: 2, skipped: 0});
        await expect(fs.readFile(path.join(root, "manuscript", "001", "index.md"), "utf-8")).resolves.toBe("# 1\n");
        await expect(fs.readFile(path.join(root, "assets", "images", "hero.png"))).resolves.toEqual(Buffer.from([4, 5, 6]));
    });

    it("preserves zip paths and skips existing files", async () => {
        await fs.mkdir(path.join(root, "project"), {recursive: true});
        await fs.writeFile(path.join(root, "project", "existing.md"), "old\n");
        const zip = zipSync({
            "project/existing.md": Buffer.from("new\n"),
            "project/new.md": Buffer.from("created\n"),
        });

        const result = await uploadWorkspaceProjectZip(target, {
            fileName: "project.zip",
            data: zip,
        });

        expect(result).toMatchObject({written: 1, skipped: 1});
        await expect(fs.readFile(path.join(root, "project", "existing.md"), "utf-8")).resolves.toBe("old\n");
        await expect(fs.readFile(path.join(root, "project", "new.md"), "utf-8")).resolves.toBe("created\n");
    });

    it("rejects unsafe relative paths", async () => {
        await expect(uploadWorkspaceProjectFiles(target, [
            {fileName: "evil.md", relativePath: "../evil.md", data: Buffer.from("x")},
        ])).rejects.toBeInstanceOf(WorkspaceUploadError);
    });

    it("enforces project upload size limit", async () => {
        await expect(uploadWorkspaceProjectFiles(target, [
            {fileName: "too-large.bin", relativePath: "too-large.bin", data: Buffer.alloc(PROJECT_UPLOAD_LIMIT_BYTES + 1)},
        ])).rejects.toMatchObject({
            statusCode: 413,
        });
    });

    it("workspace-root 上传单段名与普通目录同名时跳过，而不是按 Storage 拒绝", async () => {
        await fs.mkdir(path.join(root, "project"), {recursive: true});

        const result = await uploadWorkspaceProjectFiles(target, [
            {fileName: "project", relativePath: "project", data: Buffer.from("x")},
        ]);

        expect(result).toMatchObject({written: 0, skipped: 1});
        expect((await fs.stat(path.join(root, "project"))).isDirectory()).toBe(true);
    });

    it("zip 内的 Storage 记录不会被普通上传覆盖或创建", async () => {
        const storageRecord = path.join(root, ".nbook", "storage", "records", "shelf.json");
        await fs.mkdir(path.dirname(storageRecord), {recursive: true});
        await fs.writeFile(storageRecord, "{\"revision\":\"original\"}\n", "utf-8");
        const zip = zipSync({
            ".nbook/storage/records/shelf.json": Buffer.from("{\"revision\":\"attacker\"}\n"),
            ".nbook/storage/records/added.json": Buffer.from("{}\n"),
            "manuscript/001/index.md": Buffer.from("# 1\n"),
        });

        await expect(uploadWorkspaceProjectZip(target, {
            fileName: "project.zip",
            data: zip,
        })).rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);

        await expect(fs.readFile(storageRecord, "utf-8")).resolves.toBe("{\"revision\":\"original\"}\n");
        await expect(fs.access(path.join(root, ".nbook", "storage", "records", "added.json"))).rejects.toMatchObject({code: "ENOENT"});
        // 命中 Storage 的 entry 在写盘前失败：同批次的普通文件也不能被"部分写入"成半次上传的假象。
        await expect(fs.access(path.join(root, "manuscript", "001", "index.md"))).rejects.toMatchObject({code: "ENOENT"});
    });

    it("user-assets 根的 storage/ 不是普通上传入口", async () => {
        const userAssetsRoot = path.join(root, ".nbook");
        await fs.mkdir(userAssetsRoot, {recursive: true});
        const userAssetsTarget: WorkspaceFileTarget = {kind: "user-assets", root: absoluteFsPath(userAssetsRoot)};

        await expect(uploadWorkspaceProjectFiles(userAssetsTarget, [
            {fileName: "shelf.json", relativePath: "storage/records/shelf.json", data: Buffer.from("{}\n")},
        ])).rejects.toBeInstanceOf(WorkspaceStorageBoundaryError);

        await expect(fs.access(path.join(userAssetsRoot, "storage"))).rejects.toMatchObject({code: "ENOENT"});
    });
});
