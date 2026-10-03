import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {testHostPath} from "@notnotype/neuro-book-test-support/test-path";
import {absoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {createWorkspaceFilesService} from "./service";

const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, {recursive: true, force: true})));
});

describe("已绑定 Files 数据面", () => {
    it("按实际磁盘版本拒绝覆盖并保留外部正文", async () => {
        const root = testHostPath("workspace-files-service", randomUUID());
        roots.push(root);
        await fs.mkdir(root, {recursive: true});
        await fs.writeFile(path.join(root, "note.md"), "共同基线\n");
        const files = createWorkspaceFilesService({
            target: {kind: "user-assets", root: absoluteFsPath(root)},
            handles: undefined,
        });
        const initial = await files.read("note.md");
        expect(initial.content).toBe("共同基线\n");
        const node = await files.write({path: "note.md", content: "已保存\n", baseContent: initial.content, expectedMtimeMs: initial.mtimeMs});
        expect(await fs.readFile(path.join(root, "note.md"), "utf8")).toBe("已保存\n");
        expect((await files.read("note.md")).mtimeMs).toBe(node.mtimeMs);

        await fs.writeFile(path.join(root, "note.md"), "外部改写\n");
        await fs.utimes(path.join(root, "note.md"), new Date(), new Date(initial.mtimeMs + 5_000));
        await expect(files.write({path: "note.md", content: "过期输入\n", baseContent: initial.content, expectedMtimeMs: initial.mtimeMs})).rejects.toMatchObject({
            statusCode: 409,
            data: expect.objectContaining({kind: "workspace_write_conflict", remoteContent: "外部改写\n"}),
        });
        expect(await fs.readFile(path.join(root, "note.md"), "utf8")).toBe("外部改写\n");
    });

    it("stat 返回实际磁盘来源身份，原地编辑保留同一身份", async () => {
        const root = testHostPath("workspace-files-identity", randomUUID());
        roots.push(root);
        await fs.mkdir(root, {recursive: true});
        await fs.writeFile(path.join(root, "note.md"), "original");
        const files = createWorkspaceFilesService({target: {kind: "user-assets", root: absoluteFsPath(root)}, handles: undefined});
        const before = await files.stat("note.md");
        const source = await fs.stat(path.join(root, "note.md"));
        if (source.ino === 0) {
            expect("sourceIdentity" in before).toBe(false);
            return;
        }
        expect(before).toMatchObject({sourceIdentity: {dev: source.dev, ino: source.ino, birthtimeMs: source.birthtimeMs,
            mtimeMs: source.mtimeMs, size: source.size}});
        await fs.writeFile(path.join(root, "note.md"), "edited in place");
        const after = await files.stat("note.md");
        expect(after).toMatchObject({sourceIdentity: {dev: source.dev, ino: source.ino, birthtimeMs: source.birthtimeMs}});
    });

    it("stat 缺失目标明确返回 404 供用户核对未知写入", async () => {
        const root = testHostPath("workspace-files-missing", randomUUID());
        roots.push(root);
        await fs.mkdir(root, {recursive: true});
        const files = createWorkspaceFilesService({target: {kind: "user-assets", root: absoluteFsPath(root)}, handles: undefined});
        await expect(files.stat("missing.md")).rejects.toMatchObject({statusCode: 404, data: {code: "ENOENT"}});
    });
});
