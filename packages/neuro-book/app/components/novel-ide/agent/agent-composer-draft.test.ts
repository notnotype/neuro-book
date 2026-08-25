import {describe, expect, it, vi} from "vitest";
import {
    AgentComposerDraftClientStore,
    AgentComposerDraftSession,
    legacyAgentComposerDraftKey,
    type AgentComposerDraftApi,
} from "nbook/app/components/novel-ide/agent/agent-composer-draft";
import type {
    AgentComposerDraftIdentity,
    AgentComposerDraftMigrationRecord,
    AgentComposerDraftSaveRequest,
} from "nbook/shared/dto/agent-composer-draft.dto";

describe("Agent Composer 草稿", () => {
    it("首次初始化把全部合法 localStorage 草稿迁到磁盘 Adapter 并删除旧 key", async () => {
        const legacy = new MemoryStorage();
        const firstKey = legacyAgentComposerDraftKey("project:a", 12);
        const secondKey = legacyAgentComposerDraftKey("workspace-root", 13);
        legacy.setItem(firstKey, JSON.stringify({version: 1, text: "项目草稿", updatedAt: 100}));
        legacy.setItem(secondKey, JSON.stringify({version: 1, text: "全局草稿", updatedAt: 101}));
        const api = new MemoryDraftApi();
        const store = new AgentComposerDraftClientStore(api, legacy);

        await store.initialize(102);

        expect(api.migrateComposerDrafts).toHaveBeenCalledTimes(1);
        await expect(store.load({scopeKey: "project:a", sessionId: 12})).resolves.toEqual({text: "项目草稿"});
        await expect(store.load({scopeKey: "workspace-root", sessionId: 13})).resolves.toEqual({text: "全局草稿"});
        expect(legacy.getItem(firstKey)).toBeNull();
        expect(legacy.getItem(secondKey)).toBeNull();
    });

    it("迁移请求失败时保留旧 key，后续初始化可以重试", async () => {
        const legacy = new MemoryStorage();
        const key = legacyAgentComposerDraftKey("project:a", 12);
        legacy.setItem(key, JSON.stringify({version: 1, text: "待迁移", updatedAt: 100}));
        const api = new MemoryDraftApi();
        api.migrateComposerDrafts.mockRejectedValueOnce(new Error("offline"));
        const store = new AgentComposerDraftClientStore(api, legacy);

        await expect(store.initialize(101)).rejects.toThrow("offline");
        expect(legacy.getItem(key)).not.toBeNull();
        await expect(store.initialize(101)).resolves.toBeUndefined();
        expect(legacy.getItem(key)).toBeNull();
    });

    it("旧记录最多迁移十条，并在客户端先清理过期、不安全和超大正文", async () => {
        const legacy = new MemoryStorage();
        const now = 31 * 24 * 60 * 60 * 1000;
        legacy.setItem(legacyAgentComposerDraftKey("project:a", 1), JSON.stringify({version: 1, text: "过期", updatedAt: 0}));
        legacy.setItem(legacyAgentComposerDraftKey("project:a", 2), JSON.stringify({version: 1, text: "![图](blob:http://local/id)", updatedAt: now}));
        legacy.setItem(legacyAgentComposerDraftKey("project:a", 3), JSON.stringify({version: 1, text: "x".repeat(256 * 1024 + 1), updatedAt: now}));
        for (let sessionId = 10; sessionId <= 20; sessionId += 1) {
            legacy.setItem(legacyAgentComposerDraftKey("project:a", sessionId), JSON.stringify({
                version: 1,
                text: `draft-${String(sessionId)}`,
                updatedAt: now + sessionId,
            }));
        }
        const api = new MemoryDraftApi();

        await new AgentComposerDraftClientStore(api, legacy).initialize(now + 21);

        const request = api.migrateComposerDrafts.mock.calls[0]?.[0];
        expect(request?.drafts).toHaveLength(10);
        expect(request?.drafts.map((draft) => draft.sessionId)).toEqual([20, 19, 18, 17, 16, 15, 14, 13, 12, 11]);
        expect(legacy.length).toBe(0);
    });

    it("切换 context 时把最后修改写回旧 Project/Session", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);

        await drafts.switchContext("project:a", 1);
        drafts.update("旧项目最后修改");
        await drafts.switchContext("project:b", 1);

        await expect(api.getComposerDraft({scopeKey: "project:a", sessionId: 1})).resolves.toEqual({text: "旧项目最后修改"});
        await expect(api.getComposerDraft({scopeKey: "project:b", sessionId: 1})).resolves.toEqual({text: ""});
        await drafts.dispose();
    });

    it("prepare 不改变当前 context，只有 activate 才提交目标草稿", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);

        await drafts.switchContext("project:a", 1);
        drafts.update("当前正文");
        await drafts.flush();
        await api.saveComposerDraft({scopeKey: "project:b", sessionId: 2, text: "目标正文"});

        const prepared = await drafts.prepareContext("project:b", 2);

        expect(drafts.capture("当前正文")).not.toBeNull();
        expect(prepared).toEqual({scopeKey: "project:b", sessionId: 2, text: "目标正文"});

        drafts.activateContext(prepared);

        expect(drafts.capture("当前正文")).toBeNull();
        expect(drafts.capture("目标正文")).toMatchObject({scopeKey: "project:b", sessionId: 2});
        await drafts.dispose();
    });

    it("进入 empty 前 clearContext 持久化正文并解除 active context", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);
        const initial = await drafts.switchContext("project:a", 3);
        drafts.update("跨实例切换前仍在编辑的正文");

        const generation = await drafts.clearContext();

        expect(generation).toBeGreaterThan(initial.generation);
        await expect(api.getComposerDraft({scopeKey: "project:a", sessionId: 3})).resolves.toEqual({
            text: "跨实例切换前仍在编辑的正文",
        });
        expect(drafts.capture("跨实例切换前仍在编辑的正文")).toBeNull();
    });

    it("acceptance 只清除提交 revision，不删除请求期间的新正文", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);
        await drafts.switchContext("project:a", 1);
        drafts.update("已提交正文");
        const submission = drafts.capture("已提交正文");
        expect(submission).not.toBeNull();

        drafts.update("请求期间的新正文");
        await expect(drafts.accept(submission!)).resolves.toEqual({clearEditor: false});
        await drafts.flush();
        await expect(api.getComposerDraft({scopeKey: "project:a", sessionId: 1})).resolves.toEqual({text: "请求期间的新正文"});
        await drafts.dispose();
    });

    it("迟到 acceptance 只清理原 context，不影响当前 Session 草稿", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);
        await drafts.switchContext("project:a", 1);
        drafts.update("已提交正文");
        const submission = drafts.capture("已提交正文")!;
        await drafts.switchContext("project:a", 2);
        drafts.update("另一个 Session 草稿");

        await expect(drafts.accept(submission)).resolves.toEqual({clearEditor: false});
        await expect(api.getComposerDraft({scopeKey: "project:a", sessionId: 1})).resolves.toEqual({text: ""});
        await drafts.flush();
        await expect(api.getComposerDraft({scopeKey: "project:a", sessionId: 2})).resolves.toEqual({text: "另一个 Session 草稿"});
        await drafts.dispose();
    });

    it("目标草稿读取失败时不伪造空正文，也不改变当前 context", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);
        await drafts.switchContext("project:a", 1);
        drafts.update("当前正文");
        const error = new Error("draft-read-failed");
        api.loadError = error;

        await expect(drafts.prepareContext("project:b", 2)).rejects.toBe(error);
        expect(drafts.capture("当前正文")).not.toBeNull();
    });

    it("草稿保存失败时 switch/clear 都保留当前 context 和正文", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);
        await drafts.switchContext("project:a", 1);
        drafts.update("不能丢失的正文");
        api.saveError = new Error("draft-save-failed");

        await expect(drafts.switchContext("project:b", 2)).rejects.toThrow("draft-save-failed");
        expect(drafts.capture("不能丢失的正文")).not.toBeNull();
        await expect(drafts.clearContext()).rejects.toThrow("draft-save-failed");
        expect(drafts.capture("不能丢失的正文")).not.toBeNull();
    });

    it("草稿清除失败时 acceptance 不清空内存正文", async () => {
        const api = new MemoryDraftApi();
        const drafts = session(api);
        await drafts.switchContext("project:a", 1);
        drafts.update("待确认正文");
        const submission = drafts.capture("待确认正文")!;
        api.clearError = new Error("draft-clear-failed");

        await expect(drafts.accept(submission)).rejects.toThrow("draft-clear-failed");
        expect(drafts.capture("待确认正文")).not.toBeNull();
    });
});

function session(api: MemoryDraftApi): AgentComposerDraftSession {
    return new AgentComposerDraftSession(new AgentComposerDraftClientStore(api, new MemoryStorage()));
}

class MemoryDraftApi implements AgentComposerDraftApi {
    private readonly drafts = new Map<string, AgentComposerDraftMigrationRecord>();
    loadError: Error | null = null;
    saveError: Error | null = null;
    clearError: Error | null = null;

    readonly migrateComposerDrafts = vi.fn(async ({drafts}: {drafts: AgentComposerDraftMigrationRecord[]}) => {
        drafts.forEach((draft) => this.drafts.set(keyOf(draft), draft));
        return {migrated: drafts.length};
    });

    async getComposerDraft(identity: AgentComposerDraftIdentity): Promise<{text: string}> {
        if (this.loadError) throw this.loadError;
        return {text: this.drafts.get(keyOf(identity))?.text ?? ""};
    }

    async saveComposerDraft(request: AgentComposerDraftSaveRequest): Promise<"saved" | "cleared" | "oversize" | "unsafe"> {
        if (this.saveError) throw this.saveError;
        if (!request.text) {
            this.drafts.delete(keyOf(request));
            return "cleared";
        }
        this.drafts.set(keyOf(request), {...request, updatedAt: Date.now()});
        return "saved";
    }

    async clearComposerDraft(identity: AgentComposerDraftIdentity): Promise<{cleared: true}> {
        if (this.clearError) throw this.clearError;
        this.drafts.delete(keyOf(identity));
        return {cleared: true};
    }
}

function keyOf(identity: AgentComposerDraftIdentity): string {
    return `${identity.scopeKey}:${String(identity.sessionId)}`;
}

class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>();

    get length(): number {
        return this.values.size;
    }

    clear(): void {
        this.values.clear();
    }

    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    key(index: number): string | null {
        return [...this.values.keys()][index] ?? null;
    }

    removeItem(key: string): void {
        this.values.delete(key);
    }

    setItem(key: string, value: string): void {
        this.values.set(key, value);
    }
}
