import {createHash} from "node:crypto";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {AttachmentStore} from "nbook/server/agent/attachments/attachment-store";
import {LocalAttachmentBlobAdapter} from "nbook/server/agent/attachments/local-attachment-blob-adapter";
import type {AttachmentBlobAdapter} from "nbook/server/agent/attachments/types";

describe("AttachmentStore", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
    });

    it("保存后可由重建的 Store 按内容引用读取原始 bytes", async () => {
        const root = await mkdtemp(testHostPath("nbook-attachments-"));
        roots.push(root);
        const bytes = new TextEncoder().encode("attachment body");
        const store = new AttachmentStore(new LocalAttachmentBlobAdapter(root));

        const ref = await store.save({
            bytes,
            mimeType: "text/plain",
        });
        const reloaded = await new AttachmentStore(new LocalAttachmentBlobAdapter(root)).load(ref);

        expect(ref).toEqual({
            id: "sha256:baebb75e3b75608ff9c4483c5c93ae00b989a63378a9d0831fecc26f8c75f90e",
            mimeType: "text/plain",
            bytes: 15,
        });
        expect([...reloaded]).toEqual([...bytes]);
    });

    it("非法引用在读取 Adapter 前以 invalid_reference 失败", async () => {
        let getCalls = 0;
        const adapter: AttachmentBlobAdapter = {
            async put() {},
            async get() {
                getCalls += 1;
                return null;
            },
        };
        const store = new AttachmentStore(adapter);

        await expect(store.load({
            id: "sha256:ABC" as `sha256:${string}`,
            mimeType: "image/png",
            bytes: 3,
        })).rejects.toMatchObject({code: "invalid_reference"});
        expect(getCalls).toBe(0);
    });

    it("引用合法但 blob 不存在时返回 not_found", async () => {
        const store = new AttachmentStore({
            async put() {},
            async get() {
                return null;
            },
        });

        await expect(store.load({
            id: `sha256:${"a".repeat(64)}`,
            mimeType: "image/png",
            bytes: 3,
        })).rejects.toMatchObject({code: "not_found"});
    });

    it("blob 长度相同但 hash 不匹配时返回 corrupt", async () => {
        const original = new Uint8Array([1, 2, 3]);
        const id = `sha256:${createHash("sha256").update(original).digest("hex")}` as const;
        const store = new AttachmentStore({
            async put() {},
            async get() {
                return new Uint8Array([1, 2, 4]);
            },
        });

        await expect(store.load({
            id,
            mimeType: "application/octet-stream",
            bytes: original.byteLength,
        })).rejects.toMatchObject({code: "corrupt"});
    });
});
