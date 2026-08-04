import {createStoredUserMessage} from "nbook/server/agent/messages/message-utils";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import {SessionBusyError} from "nbook/server/vendor/nb-workflow/index";
import type {EntryId, JsonValue, SessionEntry, SessionId, SessionMeta, SessionPort} from "nbook/server/vendor/nb-workflow/index";
import type {JsonlSessionRepository} from "nbook/server/agent/session/session-repo";
import type {SessionSnapshot, SessionEntry as NbSessionEntry} from "nbook/server/agent/session/types";
import type {AssistantMessage} from "nbook/server/agent/messages/types";

/** demo mock profile 前缀：命中的 profileKey 走 mock responder 与直落 repo 的创建，不经 harness */
export const WORKFLOW_DEMO_PROFILE_PREFIX = "workflow.demo.";

/**
 * nb-workflow SessionPort 的 NeuroBook 实现：直接落在 JsonlSessionRepository 上。
 *
 * 语义映射（合同见 vendor ports.ts）：
 * - append(parentId) → repo.appendEntry({parentId}) 显式锚定（F2 游标），repo 自动移 leaf；
 * - setActiveLeaf → repo.moveLeaf；
 * - archive → 追加 session_archived entry（与 harness 归档同机制）；
 * - transcript → 从 fromLeaf 沿 parentId 回溯，只投影 message entry 为内核视图；
 * - 创建路由：mock 前缀 profile 直落 repo（无需真实 profile 存在）；真实 profile 走注入的
 *   createRealSession（= harness.createAgent，含 profile/initial 校验），kind/tags 暂不落真实创建面；
 * - 锁是进程内运行时态。已知边界：不拦真实聊天入口（harness 有自己的 per-session admission 队列，
 *   真实 invoke 天然串行；用户直聊与 workflow 的互斥要等正式接入时统一到 harness 层）。
 */
export class NeuroWorkflowSessionPort implements SessionPort {
    /** 排它锁：sessionId -> 持有者（runId 或 "direct"） */
    private locks = new Map<SessionId, string>();

    constructor(
        private repo: JsonlSessionRepository,
        /** 真实 profile 的创建入口；为空时真实 profile 创建直接报错。model 非空时实现负责把 session 模型设为该 key */
        private createRealSession?: (init: {profileKey: string; initial: JsonValue; parentSessionId?: SessionId; title?: string; model?: string; kind?: SessionMeta["kind"]; tags?: string[]}) => Promise<SessionId>,
    ) {}

    async createSession(init: {
        profileKey: string;
        kind: SessionMeta["kind"];
        tags: string[];
        initial?: JsonValue;
        parentSessionId?: SessionId;
        title?: string;
        model?: string;
    }): Promise<SessionMeta> {
        if (!init.profileKey.startsWith(WORKFLOW_DEMO_PROFILE_PREFIX)) {
            if (!this.createRealSession) throw new Error(`真实 profile ${init.profileKey} 的创建入口未注入`);
            const sessionId = await this.createRealSession({
                profileKey: init.profileKey,
                initial: init.initial ?? null,
                parentSessionId: init.parentSessionId,
                title: init.title,
                model: init.model,
                kind: init.kind,
                tags: init.tags,
            });
            return this.toMeta(await this.repo.readSession(sessionId));
        }
        const snapshot = await this.repo.createSession({
            profileKey: init.profileKey,
            initial: init.initial ?? null,
            parentSessionId: init.parentSessionId,
            title: init.title,
            kind: init.kind,
            tags: init.tags,
        });
        return this.toMeta(snapshot);
    }

    async meta(sessionId: SessionId): Promise<SessionMeta> {
        return this.toMeta(await this.repo.readSession(sessionId));
    }

    async findByTag(profileKey: string, tag: string): Promise<SessionMeta | null> {
        // listSessions 默认排除 archived；按 profileKey 先收窄再逐个读 tags
        const summaries = await this.repo.listSessions({profileKey});
        for (const summary of summaries) {
            const snapshot = await this.repo.readSession(summary.sessionId);
            if (snapshot.metadata.tags?.includes(tag)) {
                return this.toMeta(snapshot);
            }
        }
        return null;
    }

    async activeLeaf(sessionId: SessionId): Promise<EntryId | null> {
        return (await this.repo.readSession(sessionId)).leafId;
    }

    async setActiveLeaf(sessionId: SessionId, entryId: EntryId): Promise<void> {
        await this.repo.moveLeaf(sessionId, entryId);
    }

    async append(sessionId: SessionId, parentId: EntryId | null, entry: {
        role: "user" | "assistant";
        message?: string;
        input?: JsonValue;
        data?: JsonValue;
        origin: "workflow" | "direct";
    }): Promise<EntryId> {
        const text = renderEntryText(entry);
        const origin = entry.origin === "workflow" ? "workflow" : "manual";
        const appended = entry.role === "user"
            ? await this.repo.appendEntry(sessionId, {
                type: "message",
                message: createStoredUserMessage(text),
                clientMessageId: randomUUID(),
                intent: "normal",
                origin,
                parentId,
            })
            : await this.repo.appendEntry(sessionId, {
                type: "message",
                message: mockAssistantMessage(text),
                origin,
                parentId,
            });
        return appended.id;
    }

    async transcript(sessionId: SessionId, fromLeaf: EntryId | null): Promise<SessionEntry[]> {
        const snapshot = await this.repo.readSession(sessionId);
        const byId = new Map(snapshot.entries.map((e) => [e.id, e]));
        const picked: NbSessionEntry[] = [];
        let cursor = fromLeaf;
        while (cursor !== null) {
            const current = byId.get(cursor);
            if (!current) break;
            if (current.type === "message" && (current.message.role === "user" || current.message.role === "assistant")) {
                picked.push(current);
            }
            cursor = current.parentId;
        }
        picked.reverse();
        // parentId 重连成"消息链"视图：内核只关心顺序与内容，非消息 entry 不进视图
        const out: SessionEntry[] = [];
        let prevId: EntryId | null = null;
        for (const entry of picked) {
            if (entry.type !== "message") continue;
            out.push({
                id: entry.id,
                parentId: prevId,
                type: "message",
                role: entry.message.role as "user" | "assistant",
                message: storedMessageText(entry.message),
                origin: entry.origin === "workflow" ? "workflow" : "direct",
            });
            prevId = entry.id;
        }
        return out;
    }

    async archive(sessionId: SessionId): Promise<void> {
        await this.repo.appendEntry(sessionId, {
            type: "session_archived",
            reason: "workflow ephemeral 参与者，run 成功后归档",
        });
    }

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

    private toMeta(snapshot: SessionSnapshot): SessionMeta {
        const context = this.repo.reduce(snapshot);
        return {
            sessionId: snapshot.metadata.sessionId,
            profileKey: snapshot.metadata.profileKey,
            kind: snapshot.metadata.kind ?? "chat",
            tags: snapshot.metadata.tags ?? [],
            parentSessionId: snapshot.metadata.parentSessionId,
            title: context.title ?? snapshot.metadata.title,
            archived: context.archived,
        };
    }
}

/** 内核 entry 的展示文本：message 正文 + input/data 以 JSON 代码块拼接（结构化值不做往返，仅展示） */
function renderEntryText(entry: {message?: string; input?: JsonValue; data?: JsonValue}): string {
    const parts: string[] = [];
    if (entry.message !== undefined) parts.push(entry.message);
    if (entry.input !== undefined && entry.input !== null) parts.push(`\`\`\`json input\n${JSON.stringify(entry.input, null, 2)}\n\`\`\``);
    if (entry.data !== undefined && entry.data !== null) parts.push(`\`\`\`json data\n${JSON.stringify(entry.data, null, 2)}\n\`\`\``);
    return parts.join("\n\n") || "(空)";
}

/** mock responder 输出的合法 AssistantMessage：provider/model 显式标注为 mock，usage 全零 */
function mockAssistantMessage(text: string): AssistantMessage {
    return {
        role: "assistant",
        content: [{type: "text", text}],
        api: "nb-workflow-mock",
        provider: "nb-workflow",
        model: "mock-responder",
        usage: {
            input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0},
        },
        stopReason: "stop",
        timestamp: Date.now(),
    };
}
import {randomUUID} from "node:crypto";
