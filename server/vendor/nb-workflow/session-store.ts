import type { EntryId, JsonValue, SessionEntry, SessionId, SessionMeta } from "./types";
import { SessionBusyError, type SessionPort, type WorkspacePort } from "./ports";

type SessionRecord = {
    meta: SessionMeta;
    entries: Map<EntryId, SessionEntry>;
    activeLeaf: EntryId | null;
};

/**
 * 内存版 SessionPort 实现（测试 / demo 用）。
 * 对应 NeuroBook 的 JsonlSessionRepository 适配器，语义合同见 ports.ts。
 */
export class MemorySessionStore implements SessionPort {
    private sessions = new Map<SessionId, SessionRecord>();
    private nextSessionId = 1;
    private nextEntryId = 1;
    /** 排它锁：sessionId -> 持有者标识（runId 或 "direct"） */
    private locks = new Map<SessionId, string>();

    async createSession(init: { profileKey: string; kind: SessionMeta["kind"]; tags: string[]; initial?: JsonValue; parentSessionId?: SessionId; title?: string }): Promise<SessionMeta> {
        const full: SessionMeta = {
            sessionId: this.nextSessionId++,
            profileKey: init.profileKey,
            kind: init.kind,
            tags: init.tags,
            parentSessionId: init.parentSessionId,
            title: init.title,
            archived: false,
        };
        this.sessions.set(full.sessionId, { meta: full, entries: new Map(), activeLeaf: null });
        return full;
    }

    async meta(sessionId: SessionId): Promise<SessionMeta> {
        return this.record(sessionId).meta;
    }

    async findByTag(profileKey: string, tag: string): Promise<SessionMeta | null> {
        for (const rec of this.sessions.values()) {
            if (!rec.meta.archived && rec.meta.profileKey === profileKey && rec.meta.tags.includes(tag)) return rec.meta;
        }
        return null;
    }

    /** 唯一的生长原语：落在显式 parent 上（parent 非端点时自然开叉），并自动移 active leaf */
    async append(sessionId: SessionId, parentId: EntryId | null, entry: {
        role: "user" | "assistant"; message?: string; input?: JsonValue; data?: JsonValue; origin: "workflow" | "direct";
    }): Promise<EntryId> {
        const rec = this.record(sessionId);
        if (parentId !== null && !rec.entries.has(parentId)) throw new Error(`entry ${parentId} 不存在`);
        const full: SessionEntry = { ...entry, type: "message", id: `e${this.nextEntryId++}`, parentId };
        rec.entries.set(full.id, full);
        rec.activeLeaf = full.id;
        return full.id;
    }

    async activeLeaf(sessionId: SessionId): Promise<EntryId | null> {
        return this.record(sessionId).activeLeaf;
    }

    /** 唯一的游标原语（= moveLeaf）：rewind / 切分支 / 恢复现场都是它 */
    async setActiveLeaf(sessionId: SessionId, entryId: EntryId): Promise<void> {
        const rec = this.record(sessionId);
        if (!rec.entries.has(entryId)) throw new Error(`entry ${entryId} 不存在`);
        rec.activeLeaf = entryId;
    }

    /** 从某 leaf 向根回溯的线性视图（时间正序） */
    async transcript(sessionId: SessionId, fromLeaf: EntryId | null): Promise<SessionEntry[]> {
        const rec = this.record(sessionId);
        const out: SessionEntry[] = [];
        let cursor = fromLeaf;
        while (cursor !== null) {
            const entry = rec.entries.get(cursor);
            if (!entry) break;
            out.push(entry);
            cursor = entry.parentId;
        }
        return out.reverse();
    }

    /** 全树 entry（投影 / 测试断言旁支存在性用；内存实现独有，不在端口上） */
    allEntries(sessionId: SessionId): SessionEntry[] {
        return [...this.record(sessionId).entries.values()];
    }

    async archive(sessionId: SessionId): Promise<void> {
        this.record(sessionId).meta.archived = true;
    }

    /** 尝试加锁；已被其他持有者占用则抛 SessionBusyError；同持有者重入幂等 */
    async lock(sessionId: SessionId, holder: string): Promise<void> {
        const current = this.locks.get(sessionId);
        if (current !== undefined && current !== holder) throw new SessionBusyError(sessionId, current);
        this.locks.set(sessionId, holder);
    }

    async releaseAll(holder: string): Promise<void> {
        for (const [sessionId, current] of this.locks) {
            if (current === holder) this.locks.delete(sessionId);
        }
    }

    private record(sessionId: SessionId): SessionRecord {
        const rec = this.sessions.get(sessionId);
        if (!rec) throw new Error(`session ${sessionId} 不存在`);
        return rec;
    }
}

/** 内存版 workspace 只读端口：从固定文件表取内容 */
export function createMemoryWorkspace(files: Record<string, string>): WorkspacePort {
    return {
        async read(path: string): Promise<string> {
            const content = files[path];
            if (content === undefined) throw new Error(`workspace 文件不存在: ${path}`);
            return content;
        },
    };
}
