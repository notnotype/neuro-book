import {mkdtemp, readFile, rm} from "node:fs/promises";
import { testHostPath } from "@notnotype/neuro-book-test-support/test-path"
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {AgentComposerDraftStore} from "nbook/server/agent/drafts/agent-composer-draft-store";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

describe("AgentComposerDraftStore", () => {
    it("在 Workspace Root .nbook 下用单个文件隔离保存草稿", async () => {
        const root = await fixture();
        const store = new AgentComposerDraftStore(root);

        await expect(store.save({scopeKey: "project:a", sessionId: 12}, "正文", 100)).resolves.toBe("saved");

        await expect(store.load({scopeKey: "project:a", sessionId: 12}, 101)).resolves.toEqual({text: "正文"});
        await expect(store.load({scopeKey: "project:a", sessionId: 13}, 101)).resolves.toEqual({text: ""});
        const file = JSON.parse(await readFile(join(root, "agent", "composer-drafts.json"), "utf8")) as {drafts: unknown[]};
        expect(file.drafts).toHaveLength(1);
    });

    it("拒绝 Blob/data 图片与超过 256 KiB 的正文，并保留同身份旧草稿", async () => {
        const store = new AgentComposerDraftStore(await fixture());
        const identity = {scopeKey: "project:a" as const, sessionId: 1};
        await store.save(identity, "旧正文", 1);

        await expect(store.save(identity, "![图](data:image/png;base64,AAAA)", 2)).resolves.toBe("unsafe");
        await expect(store.load(identity, 3)).resolves.toEqual({text: "旧正文"});
        await expect(store.save(identity, "![图](blob:http://localhost/id)", 4)).resolves.toBe("unsafe");
        await expect(store.save(identity, "x".repeat(256 * 1024 + 1), 5)).resolves.toBe("oversize");
    });

    it("最多保留最近十条，并在读取时清理三十天前的记录", async () => {
        const root = await fixture();
        const store = new AgentComposerDraftStore(root);
        for (let sessionId = 1; sessionId <= 11; sessionId += 1) {
            await store.save({scopeKey: "project:a", sessionId}, `draft-${String(sessionId)}`, sessionId);
        }

        await expect(store.load({scopeKey: "project:a", sessionId: 1}, 12)).resolves.toEqual({text: ""});
        await expect(store.load({scopeKey: "project:a", sessionId: 2}, 31 * 24 * 60 * 60 * 1000)).resolves.toEqual({text: ""});
        await expect(readFile(join(root, "agent", "composer-drafts.json"), "utf8")).rejects.toMatchObject({code: "ENOENT"});
    });

    it("迁移与现有磁盘草稿按 updatedAt 合并，不让旧 WebView 覆盖新正文", async () => {
        const store = new AgentComposerDraftStore(await fixture());
        const identity = {scopeKey: "project:a" as const, sessionId: 1};
        await store.save(identity, "磁盘较新", 200);

        await expect(store.migrate([
            {...identity, text: "WebView 较旧", updatedAt: 100},
            {scopeKey: "workspace-root", sessionId: 2, text: "迁移正文", updatedAt: 150},
        ], 201)).resolves.toEqual({migrated: 1});

        await expect(store.load(identity, 202)).resolves.toEqual({text: "磁盘较新"});
        await expect(store.load({scopeKey: "workspace-root", sessionId: 2}, 202)).resolves.toEqual({text: "迁移正文"});
    });

    it("并发保存由单文件锁串行，不丢任一身份", async () => {
        const store = new AgentComposerDraftStore(await fixture());

        await Promise.all(Array.from({length: 10}, (_, index) => store.save({
            scopeKey: "project:a",
            sessionId: index + 1,
        }, `draft-${String(index + 1)}`, index + 1)));

        for (let sessionId = 1; sessionId <= 10; sessionId += 1) {
            await expect(store.load({scopeKey: "project:a", sessionId}, 20)).resolves.toEqual({text: `draft-${String(sessionId)}`});
        }
    });
});

async function fixture(): Promise<string> {
    const root = await mkdtemp(testHostPath("nbook-composer-drafts-"));
    roots.push(root);
    return root;
}
