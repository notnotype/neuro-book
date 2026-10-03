import {access, mkdir, mkdtemp, readdir, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {LocalAttachmentBlobAdapter} from "nbook/server/agent/attachments/local-attachment-blob-adapter";

describe("LocalAttachmentBlobAdapter", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("同一 key 已存在不同 bytes 时拒绝覆盖", async () => {
        const root = await mkdtemp(testHostPath("nbook-attachment-adapter-"));
        roots.push(root);
        const adapter = new LocalAttachmentBlobAdapter(root);
        await adapter.put("sha256/aa/blob", new Uint8Array([1, 2, 3]));

        await expect(adapter.put("sha256/aa/blob", new Uint8Array([1, 2, 4]))).rejects.toMatchObject({
            code: "corrupt",
        });
        await expect(adapter.get("sha256/aa/blob")).resolves.toEqual(Buffer.from([1, 2, 3]));
    });

    it("32 路相同内容并发只发布一个完整 blob 且不留下 temp", async () => {
        const root = await mkdtemp(testHostPath("nbook-attachment-adapter-"));
        roots.push(root);
        const adapter = new LocalAttachmentBlobAdapter(root);
        const bytes = new Uint8Array(2 * 1024 * 1024).fill(173);

        await Promise.all(Array.from({length: 32}, () => adapter.put("sha256/bb/blob", bytes)));

        await expect(adapter.get("sha256/bb/blob")).resolves.toEqual(Buffer.from(bytes));
        await expect(readdir(join(root, "sha256", "bb"))).resolves.toEqual(["blob"]);
    }, 10_000);

    it("两个 Adapter 并发发布不同 bytes 时不覆盖已发布目标", async () => {
        const root = await mkdtemp(testHostPath("nbook-attachment-adapter-"));
        roots.push(root);
        const first = new LocalAttachmentBlobAdapter(root);
        const second = new LocalAttachmentBlobAdapter(root);
        const attempts = await Promise.allSettled([
            first.put("sha256/cc/blob", new Uint8Array([1, 2, 3])),
            second.put("sha256/cc/blob", new Uint8Array([4, 5, 6])),
        ]);

        expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
        expect(attempts.filter((item) => item.status === "rejected")).toEqual([
            expect.objectContaining({reason: expect.objectContaining({code: "corrupt"})}),
        ]);
        const published = await first.get("sha256/cc/blob");
        expect([Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6])]).toContainEqual(published);
    });

    it("拒绝沿Store内部junction或symlink读写外部目录", async () => {
        const fixture = await mkdtemp(testHostPath("nbook-attachment-link-"));
        roots.push(fixture);
        const root = join(fixture, "store");
        const outside = join(fixture, "outside");
        await Promise.all([mkdir(join(root, "sha256"), {recursive: true}), mkdir(outside, {recursive: true})]);
        await symlink(outside, join(root, "sha256", "aa"), process.platform === "win32" ? "junction" : "dir");
        const adapter = new LocalAttachmentBlobAdapter(root);

        await expect(adapter.put("sha256/aa/blob", new Uint8Array([1, 2, 3])))
            .rejects.toMatchObject({code: "corrupt"});
        await expect(access(join(outside, "blob"))).rejects.toMatchObject({code: "ENOENT"});

        await writeFile(join(outside, "blob"), new Uint8Array([4, 5, 6]));
        await expect(adapter.get("sha256/aa/blob")).rejects.toMatchObject({code: "corrupt"});
    });

    it("拒绝Attachment Store根本身是链接目录", async () => {
        const fixture = await mkdtemp(testHostPath("nbook-attachment-root-link-"));
        roots.push(fixture);
        const outside = join(fixture, "outside");
        const root = join(fixture, "store");
        await mkdir(outside, {recursive: true});
        await symlink(outside, root, process.platform === "win32" ? "junction" : "dir");
        const adapter = new LocalAttachmentBlobAdapter(root);

        await expect(adapter.put("sha256/aa/blob", new Uint8Array([1])))
            .rejects.toMatchObject({code: "corrupt"});
        await expect(adapter.get("sha256/aa/blob")).rejects.toMatchObject({code: "corrupt"});
    });
});
