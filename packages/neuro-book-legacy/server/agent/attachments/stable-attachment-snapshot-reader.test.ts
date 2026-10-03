import {mkdtemp, mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {StableAttachmentSnapshotReader} from "nbook/server/agent/attachments/stable-attachment-snapshot-reader";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"

describe("StableAttachmentSnapshotReader", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("使用同一 FileHandle 读取不超过上限的稳定文件", async () => {
        const root = await mkdtemp(testHostPath("nbook-attachment-snapshot-"));
        roots.push(root);
        const attachmentRoot = join(root, "attachments");
        const source = join(root, "source.png");
        await mkdir(attachmentRoot, {recursive: true});
        await writeFile(source, new Uint8Array([1, 2, 3, 4]));

        const reader = new StableAttachmentSnapshotReader(absoluteFsPath(attachmentRoot), 4);
        const bytes = await reader.read(absoluteFsPath(source));
        expect([...bytes]).toEqual([1, 2, 3, 4]);
    });

    it("拒绝 Attachment Store 内路径与超过上限的源文件", async () => {
        const root = await mkdtemp(testHostPath("nbook-attachment-snapshot-"));
        roots.push(root);
        const attachmentRoot = join(root, "attachments");
        const stored = join(attachmentRoot, "stored.png");
        const oversized = join(root, "oversized.png");
        await mkdir(attachmentRoot, {recursive: true});
        await writeFile(stored, new Uint8Array([1]));
        await writeFile(oversized, new Uint8Array([1, 2, 3]));

        const reader = new StableAttachmentSnapshotReader(absoluteFsPath(attachmentRoot), 2);
        await expect(reader.read(absoluteFsPath(stored))).rejects.toThrow("不能从 Attachment Store");
        await expect(reader.read(absoluteFsPath(oversized))).rejects.toThrow("超过允许大小");
    });
});
