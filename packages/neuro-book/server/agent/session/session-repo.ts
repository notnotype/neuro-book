import {appendFile, mkdir, readFile, readdir, stat, writeFile} from "node:fs/promises";
import {createReadStream} from "node:fs";
import type {BigIntStats} from "node:fs";
import {createInterface} from "node:readline";
import {dirname, join} from "node:path";
import {randomUUID} from "node:crypto";
import {consola} from "consola";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {parseStoredAttachment, parseStoredMessage, StoredMessageInvariantError} from "nbook/server/agent/messages/stored-message-codec";
import {createStoredUserMessage, sumAssistantUsage} from "nbook/server/agent/messages/message-utils";
import type {
    CompactionSessionEntry,
    NeuroSessionContext,
    SessionEntry,
    SessionEntryId,
    SessionFileRecord,
    SessionId,
    SessionMetadata,
    SessionProjectionScope,
    SessionSnapshot,
    SessionTreeNode,
    SessionEntryDraft,
} from "nbook/server/agent/session/types";
import type {AgentSessionListQueryDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {AgentSessionIdentitySchema} from "nbook/shared/dto/agent-session.dto";
import {reduceRelationLedger} from "nbook/server/agent/session/relation-ledger";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import {PUBLIC_TREE_TEXT_BYTES} from "nbook/server/agent/events/public-event-policy";
import {projectPublicToolName, textPreview} from "nbook/server/agent/events/public-tool-projection";
import {chatEntryKind} from "nbook/server/agent/events/public-chat-entry-projection";
import {parseDurableSessionModelRef} from "nbook/server/agent/session/session-model-redaction";
import {ProjectRootDtoSchema} from "nbook/shared/dto/project.dto";
import {AgentSessionNotFoundError} from "nbook/server/agent/session/session-not-found-error";
import {resolveSessionIdentity, createSessionIdentity} from "nbook/server/agent/session/session-identity";

type CreateSessionInput = {
    profileKey: string;
    initial: JsonValue;
    currentProjectRoot?: string;
    parentSessionId?: SessionId;
    systemRole?: SessionMetadata["systemRole"];
    title?: string;
    /** Session 类别（Task 110 D15）；为空视为 chat。 */
    kind?: SessionMetadata["kind"];
    /** 寻址标签（Task 110 acquire）；为空视为无标签。 */
    tags?: string[];
};

type AppendEntryInput = SessionEntryDraft & {
    id?: SessionEntryId;
    parentId?: SessionEntryId | null;
    timestamp?: number;
};
type AppendBatchEntryInput = Exclude<AppendEntryInput, {type: "leaf"}>;

const CLIENT_MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type SessionListIssue = {
    sessionId: SessionId;
    fileName: string;
    message: string;
};

export type SessionListResult = {
    sessions: AgentSessionSummaryDto[];
    issues: SessionListIssue[];
};

/** 定点读取 entry 时同时返回其 durable Session 身份，供路由授权而不构造完整 snapshot。 */
export type SessionEntryContext = {
    metadata: SessionMetadata;
    entry: SessionEntry | null;
};

/** JSONL 外部修改检测使用的高精度文件签名。 */
export type SessionFileSignature = {
    identity: string;
    size: string;
    mtimeNs: string;
};

/**
 * JSONL session 仓库。所有状态变化都通过 append entry 表达。
 */
export class JsonlSessionRepository {
    readonly rootWorkspace: string;
    /** 避免同一批损坏Session在每次列表刷新时重复淹没运行日志。 */
    private issueFingerprint = "";

    constructor(rootWorkspace: string) {
        this.rootWorkspace = rootWorkspace;
    }

    /** Pi 请求 trace 的存储根目录。`.nbook/agent/*` 的布局知识统一收敛在本仓库类。 */
    get tracesRoot(): string {
        return join(this.rootWorkspace, ".nbook", "agent", "traces");
    }

    /** Workspace Root 级 Attachment 存储根；session/project 不改变其生命周期。 */
    get attachmentsRoot(): string {
        return join(this.rootWorkspace, ".nbook", "agent", "attachments");
    }

    /**
     * 创建一个空 session，只写 header 和初始 leaf。
     */
    async createSession(input: CreateSessionInput): Promise<SessionSnapshot> {
        const sessionId = await this.nextSessionId();
        const now = Date.now();
        const metadata: SessionMetadata = {
            schemaVersion: 2,
            sessionId,
            sessionIdentity: createSessionIdentity(),
            profileKey: input.profileKey,
            initial: input.initial,
            currentProjectRoot: input.currentProjectRoot,
            parentSessionId: input.parentSessionId,
            systemRole: input.systemRole,
            createdAt: now,
            title: input.title,
            kind: input.kind,
            tags: input.tags,
        };
        const sessionPath = this.sessionPath(sessionId);
        await mkdir(dirname(sessionPath), {recursive: true});
        await writeFile(sessionPath, `${JSON.stringify({kind: "header", metadata} satisfies SessionFileRecord)}\n`, "utf8");
        await this.appendEntry(sessionId, {
            type: "leaf",
            leafId: null,
        });
        return this.readSession(sessionId);
    }

    /** 读取并严格投影一个schema v2 Session。 */
    async readSession(sessionId: SessionId): Promise<SessionSnapshot> {
        const sessionPath = this.sessionPath(sessionId);
        let text: string;
        try {
            text = await readFile(sessionPath, "utf8");
        } catch (error) {
            throw this.sessionFileError(error, sessionId, sessionPath);
        }
        const records = text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SessionFileRecord);
        const header = records.find((record): record is Extract<SessionFileRecord, {kind: "header"}> => record.kind === "header");
        if (!header) {
            throw new Error(`session ${sessionId} 缺少 header`);
        }

        const entries = records.flatMap((record) => {
            if (record.kind === "entry") {
                return [record.entry];
            }
            if (record.kind === "batch") {
                return record.entries;
            }
            return [];
        });
        for (const entry of entries) {
            this.assertStoredEntry(entry);
        }
        return {
            metadata: this.effectiveMetadata(this.normalizeHeader(sessionId, header.metadata), entries),
            entries,
            leafId: this.resolveLeaf(entries),
        };
    }

    /**
     * 按 durable entry ID 定点读取。
     *
     * Attachment route 不需要构造完整 SessionSnapshot；逐行解析在命中后立即停止，
     * 避免每张图片都 reduce 整个长 session。该 seam 不建立额外索引，JSONL 仍是真相源。
     */
    async readEntry(sessionId: SessionId, entryId: SessionEntryId): Promise<SessionEntry | null> {
        return (await this.readEntryContext(sessionId, entryId)).entry;
    }

    /**
     * 单次顺序扫描读取 header 与目标 entry。
     *
     * 为保证append-only Current Project重绑生效，本入口扫描完整文件后再返回有效metadata。
     */
    async readEntryContext(sessionId: SessionId, entryId: SessionEntryId): Promise<SessionEntryContext> {
        const sessionPath = this.sessionPath(sessionId);
        const stream = createReadStream(sessionPath, {encoding: "utf8"});
        const lines = createInterface({input: stream, crlfDelay: Infinity});
        let metadata: SessionMetadata | null = null;
        let matchedEntry: SessionEntry | null = null;
        const entries: SessionEntry[] = [];
        try {
            for await (const line of lines) {
                if (!line) {
                    continue;
                }
                const record = JSON.parse(line) as SessionFileRecord;
                if (record.kind === "header") {
                    metadata = this.normalizeHeader(sessionId, record.metadata);
                    continue;
                }
                const recordEntries = record.kind === "entry"
                    ? [record.entry]
                    : record.kind === "batch" ? record.entries : [];
                for (const entry of recordEntries) {
                    this.assertStoredEntry(entry);
                    entries.push(entry);
                    if (entry.id === entryId) matchedEntry = entry;
                }
            }
            if (!metadata) {
                throw new Error(`session ${sessionId} 缺少 header`);
            }
            return {metadata: this.effectiveMetadata(metadata, entries), entry: matchedEntry};
        } catch (error) {
            throw this.sessionFileError(error, sessionId, sessionPath);
        } finally {
            lines.close();
            stream.destroy();
        }
    }

    /** 返回 Session JSONL 的文件 identity、大小与高精度修改时间。 */
    async sessionFileSignature(sessionId: SessionId): Promise<SessionFileSignature> {
        const sessionPath = this.sessionPath(sessionId);
        let file: BigIntStats;
        try {
            file = await stat(sessionPath, {bigint: true});
        } catch (error) {
            throw this.sessionFileError(error, sessionId, sessionPath);
        }
        return {
            identity: `${file.dev.toString()}:${file.ino.toString()}`,
            size: file.size.toString(),
            mtimeNs: file.mtimeNs.toString(),
        };
    }

    /**
     * 流式遍历 Session 的全部 entry，并返回规范化 metadata。
     *
     * 附件目录需要覆盖所有分支，但不能为分页查询反复把完整 JSONL 载入内存。
     */
    async scanEntries(sessionId: SessionId, visit: (entry: SessionEntry) => void | Promise<void>): Promise<SessionMetadata> {
        const sessionPath = this.sessionPath(sessionId);
        const stream = createReadStream(sessionPath, {encoding: "utf8"});
        const lines = createInterface({input: stream, crlfDelay: Infinity});
        let metadata: SessionMetadata | null = null;
        const entries: SessionEntry[] = [];
        try {
            for await (const line of lines) {
                if (!line) {
                    continue;
                }
                const record = JSON.parse(line) as SessionFileRecord;
                if (record.kind === "header") {
                    metadata = this.normalizeHeader(sessionId, record.metadata);
                    continue;
                }
                const recordEntries = record.kind === "entry"
                    ? [record.entry]
                    : record.kind === "batch"
                        ? record.entries
                        : [];
                for (const entry of recordEntries) {
                    this.assertStoredEntry(entry);
                    await visit(entry);
                }
                entries.push(...recordEntries);
            }
            if (!metadata) {
                throw new Error(`session ${sessionId} 缺少 header`);
            }
            return this.effectiveMetadata(metadata, entries);
        } catch (error) {
            throw this.sessionFileError(error, sessionId, sessionPath);
        } finally {
            lines.close();
            stream.destroy();
        }
    }

    /**
     * 列出指定 workspace 下的 session 摘要。默认隐藏 archived session。
     */
    async listSessions(input: AgentSessionListQueryDto = {}): Promise<AgentSessionSummaryDto[]> {
        const result = await this.listSessionsWithIssues(input);
        const fingerprint = result.issues
            .map((issue) => `${String(issue.sessionId)}\u0000${issue.fileName}\u0000${issue.message}`)
            .sort()
            .join("\u0001");
        if (fingerprint && fingerprint !== this.issueFingerprint) {
            consola.warn({
                count: result.issues.length,
                issues: result.issues.slice(0, 10),
                omitted: Math.max(0, result.issues.length - 10),
            }, "跳过无法读取的Agent session");
        }
        this.issueFingerprint = fingerprint;
        return result.sessions;
    }

    /**
     * 扫描session摘要并隔离单文件损坏。
     *
     * raw image属于未完成hard cut，不允许作为普通坏文件跳过；其他JSON、metadata或路径错误
     * 形成结构化issue，调用方仍可展示健康session且不会自动修改原文件。
     */
    async listSessionsWithIssues(input: AgentSessionListQueryDto = {}): Promise<SessionListResult> {
        const sessionsRoot = join(this.rootWorkspace, ".nbook", "agent", "sessions");
        const files = await readdir(sessionsRoot, {withFileTypes: true}).catch(() => []);
        const summaries: AgentSessionSummaryDto[] = [];
        const issues: SessionListIssue[] = [];

        for (const file of files) {
            if (!file.isFile() || !file.name.endsWith(".jsonl")) {
                continue;
            }
            const sessionId = Number(file.name.slice(0, -".jsonl".length));
            if (!Number.isInteger(sessionId) || sessionId <= 0) {
                continue;
            }
            let snapshot: SessionSnapshot;
            try {
                snapshot = await this.readSession(sessionId);
            } catch (error) {
                if (error instanceof StoredMessageInvariantError && error.code === "migration_required") {
                    throw error;
                }
                issues.push({
                    sessionId,
                    fileName: file.name,
                    message: error instanceof Error ? error.message : String(error),
                });
                continue;
            }
            const summary = this.summary(snapshot);
            if (!this.matchesSessionListFilter(summary, input)) {
                continue;
            }
            summaries.push(summary);
        }

        const sorted = summaries.sort((left, right) => right.updatedAt - left.updatedAt);
        const offset = input.offset ?? 0;
        const limited = input.limit ? sorted.slice(offset, offset + input.limit) : sorted.slice(offset);
        return {sessions: limited, issues};
    }

    /**
     * 判断 session 摘要是否符合列表查询筛选条件。
     */
    private matchesSessionListFilter(summary: AgentSessionSummaryDto, input: AgentSessionListQueryDto): boolean {
        if (!input.includeSystem && summary.systemRole) {
            return false;
        }
        if (!input.includeArchived && summary.archived) {
            return false;
        }
        if (input.profileKey && summary.profileKey !== input.profileKey) {
            return false;
        }
        if (input.profileGroup === "leader" && !this.isLeaderProfile(summary.profileKey)) {
            return false;
        }
        const scope = input.scope ?? "all";
        if (scope === "workspace-root" && summary.currentProjectRoot !== undefined) {
            return false;
        }
        if (scope === "project" && summary.currentProjectRoot !== input.projectRoot) return false;
        if (input.recovery === "required" && !summary.migrationReview) {
            return false;
        }
        if (input.relation === "top" && summary.parentSessionId) {
            return false;
        }
        if (input.relation === "child" && !summary.parentSessionId) {
            return false;
        }
        if (!this.matchesSearch(summary, input.search)) {
            return false;
        }
        if (!input.status || input.status === "all") {
            return true;
        }
        if (input.status === "running" || input.status === "waiting") {
            return false;
        }
        if (input.status === "active") {
            return !summary.archived;
        }
        return summary.status === input.status;
    }

    /**
     * 按 session 摘要字段做服务端搜索。搜索不读取完整 snapshot 之外的数据。
     */
    private matchesSearch(summary: AgentSessionSummaryDto, search?: string): boolean {
        const keyword = search?.trim().toLowerCase();
        if (!keyword) {
            return true;
        }
        return String(summary.sessionId).includes(keyword)
            || summary.profileKey.toLowerCase().includes(keyword)
            || Boolean(summary.title?.toLowerCase().includes(keyword))
            || Boolean(summary.summary?.toLowerCase().includes(keyword))
            || Boolean(summary.lastMessagePreview?.toLowerCase().includes(keyword));
    }

    /**
     * Leader profile 采用 profileKey 命名约定筛选。
     */
    private isLeaderProfile(profileKey: string): boolean {
        return profileKey === "leader.default"
            || profileKey === "leader.assets"
            || profileKey === "rp.leader"
            || profileKey === "simulator.leader"
            || profileKey.startsWith("leader.");
    }

    /**
     * 追加 entry，并在非 leaf entry 后自动移动 leaf。
     */
    async appendEntry(sessionId: SessionId, input: AppendEntryInput): Promise<SessionEntry> {
        const snapshot = await this.readSession(sessionId);
        const currentLeafId = this.resolveLeaf(snapshot.entries);
        const parentId = input.parentId === undefined ? currentLeafId : input.parentId;
        const entry = {
            ...input,
            id: input.id ?? this.createEntryId(),
            parentId,
            timestamp: input.timestamp ?? Date.now(),
        } as SessionEntry;
        const sessionPath = this.sessionPath(sessionId);

        this.assertStoredEntry(entry);
        await mkdir(dirname(sessionPath), {recursive: true});
        await this.appendLine(sessionPath, {kind: "entry", entry});
        if (entry.type !== "leaf") {
            await this.appendLine(sessionPath, {
                kind: "entry",
                entry: {
                    id: this.createEntryId(),
                    parentId: entry.id,
                    timestamp: Date.now(),
                    type: "leaf",
                    leafId: entry.id,
                    origin: "auto",
                },
            });
        }
        return entry;
    }

    /**
     * 追加投影型 entry，但不移动 active leaf。用于后台元数据，不改变用户当前分支。
     */
    async appendProjectionEntry(sessionId: SessionId, input: AppendEntryInput, projectionScope?: SessionProjectionScope): Promise<SessionEntry> {
        const snapshot = await this.readSession(sessionId);
        const currentLeafId = this.resolveLeaf(snapshot.entries);
        const entry = {
            ...input,
            origin: input.type === "custom" || input.type === "session_update" || input.type === "session_attachment" ? "projection" : undefined,
            projectionScope: input.type === "custom" || input.type === "session_update" ? projectionScope : undefined,
            id: input.id ?? this.createEntryId(),
            parentId: input.parentId === undefined ? currentLeafId : input.parentId,
            timestamp: input.timestamp ?? Date.now(),
        } as SessionEntry;
        const sessionPath = this.sessionPath(sessionId);

        this.assertStoredEntry(entry);
        await mkdir(dirname(sessionPath), {recursive: true});
        await this.appendLine(sessionPath, {kind: "entry", entry});
        return entry;
    }

    /**
     * 一次性追加多条 entry，并只在 batch 最后移动 leaf。
     * 用于普通 agent turn commit，避免 assistant/toolResult 之间出现可见半提交状态。
     */
    async appendEntries(sessionId: SessionId, inputs: AppendBatchEntryInput[]): Promise<SessionEntry[]> {
        if (inputs.length === 0) {
            return [];
        }
        const snapshot = await this.readSession(sessionId);
        const entries: SessionEntry[] = [];
        let currentParentId = this.resolveLeaf(snapshot.entries);

        for (const input of inputs) {
            const parentId = input.parentId === undefined ? currentParentId : input.parentId;
            const entry = {
                ...input,
                id: input.id ?? this.createEntryId(),
                parentId,
                timestamp: input.timestamp ?? Date.now(),
            } as SessionEntry;
            entries.push(entry);
            if (entry.type !== "leaf") {
                currentParentId = entry.id;
            }
        }

        const lastNonLeaf = [...entries].reverse().find((entry) => entry.type !== "leaf");
        if (lastNonLeaf) {
            entries.push({
                id: this.createEntryId(),
                parentId: lastNonLeaf.id,
                timestamp: Date.now(),
                type: "leaf",
                leafId: lastNonLeaf.id,
                origin: "auto",
            });
        }

        const sessionPath = this.sessionPath(sessionId);
        for (const entry of entries) {
            this.assertStoredEntry(entry);
        }
        await mkdir(dirname(sessionPath), {recursive: true});
        await this.appendLine(sessionPath, {kind: "batch", entries});
        return entries.filter((entry) => entry.type !== "leaf");
    }

    /**
     * 追加普通 message entry。
     */
    async appendMessage(sessionId: SessionId, message: StoredAgentMessage, origin?: "prompt" | "harness" | "manual" | "ingest" | "workflow"): Promise<SessionEntry> {
        if (message.role === "user") {
            return this.appendEntry(sessionId, {
                type: "message",
                message,
                clientMessageId: randomUUID(),
                intent: "normal",
                origin,
            });
        }
        return this.appendEntry(sessionId, {
            type: "message",
            message,
            origin,
        });
    }

    /**
     * 追加用户输入 message。
     */
    async appendUserMessage(sessionId: SessionId, text: string): Promise<SessionEntry> {
        return this.appendMessage(sessionId, createStoredUserMessage(text), "manual");
    }

    /**
     * 移动 active leaf，不删除任何历史。
     */
    async moveLeaf(sessionId: SessionId, leafId: SessionEntryId | null): Promise<SessionEntry> {
        return this.appendEntry(sessionId, {
            type: "leaf",
            leafId,
            origin: "move",
        });
    }

    /**
     * 返回最近一次显式 active path 重定位的 entry id。
     *
     * 普通 append 会自动移动 leaf，但不会改变这个 revision；前端只在显式
     * tree/edit/rollback 这类 active path 替换时用它触发 snapshot 重建。
     */
    activePathRevision(snapshot: SessionSnapshot): SessionEntryId | null {
        const movedLeaf = [...snapshot.entries].reverse().find((entry) => entry.type === "leaf" && entry.origin === "move");
        return movedLeaf?.id ?? null;
    }

    /**
     * 从当前 leaf 回溯到 root。
     */
    activePath(snapshot: SessionSnapshot): SessionEntry[] {
        if (!snapshot.leafId) {
            return [];
        }
        const byId = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
        const path: SessionEntry[] = [];
        let cursor: SessionEntryId | null = snapshot.leafId;

        while (cursor) {
            const entry = byId.get(cursor);
            if (!entry) {
                break;
            }
            if (entry.type !== "leaf") {
                path.push(entry);
            }
            cursor = entry.parentId;
        }

        return path.reverse();
    }

    /**
     * 将 active path reduce 成 harness context。
     */
    reduce(snapshot: SessionSnapshot): NeuroSessionContext {
        const path = this.activePath(snapshot);
        const pathIds = new Set(path.map((entry) => entry.id));
        const messages: StoredAgentMessage[] = [];
        const customState: Record<string, JsonValue> = {};
        let profileKey = snapshot.metadata.profileKey;
        let model: NeuroSessionContext["model"] = null;
        let thinkingLevel: NeuroSessionContext["thinkingLevel"] = null;
        let title = snapshot.metadata.title;
        let summary = snapshot.metadata.summary;
        let compaction: CompactionSessionEntry | null = null;
        let archived = false;
        let agentMode: NeuroSessionContext["agentMode"] = "normal";

        // archive / restore 是 Session 级事实，不随 active path 或 tree 分支回滚。
        for (const entry of snapshot.entries) {
            if (entry.type === "session_archived") {
                archived = true;
            } else if (entry.type === "session_restored") {
                archived = false;
            }
        }

        const reduceEntries = snapshot.entries.filter((entry) => {
            if (pathIds.has(entry.id)) {
                return true;
            }
            return (entry.type === "custom" || entry.type === "session_update")
                && entry.origin === "projection"
                && this.projectionApplies(entry.projectionScope, pathIds);
        });

        for (const entry of reduceEntries) {
            if (entry.type === "message") {
                messages.push(entry.message);
                continue;
            }
            if (entry.type === "custom_message" && entry.visibleToModel) {
                messages.push(entry.message);
                continue;
            }
            if (entry.type === "custom") {
                customState[entry.key] = entry.value;
                if (entry.origin !== "projection" && entry.key === "ui.agentMode") {
                    agentMode = entry.value === "discuss" || entry.value === "plan" ? entry.value : "normal";
                }
                continue;
            }
            if (entry.type === "session_update") {
                title = entry.updates.title ?? title;
                summary = entry.updates.summary ?? summary;
                continue;
            }
            if (entry.type === "model_change") {
                model = entry.model;
                continue;
            }
            if (entry.type === "thinking_level_change") {
                thinkingLevel = entry.thinkingLevel;
                continue;
            }
            if (entry.type === "profile_change") {
                profileKey = entry.profileKey;
                continue;
            }
            if (entry.type === "variable_patch") {
                customState[`variablePatch:${entry.namespace}.${entry.path}`] = {
                    operations: entry.operations,
                    source: entry.source,
                    invocationId: entry.invocationId ?? null,
                    toolCallId: entry.toolCallId ?? null,
                };
                continue;
            }
            if (entry.type === "compaction") {
                compaction = entry;
            }
        }

        const compactedMessages = compaction ? this.applyCompaction(path, compaction, messages) : messages;

        return {
            systemPrompt: "",
            messages: compactedMessages,
            model,
            thinkingLevel,
            profileKey,
            currentProjectRoot: snapshot.metadata.currentProjectRoot,
            customState,
            linkedAgents: reduceRelationLedger(snapshot.entries),
            title,
            summary,
            archived,
            agentMode,
        };
    }

    /**
     * 从 session active path 生成前端列表摘要。
     */
    summary(snapshot: SessionSnapshot): AgentSessionSummaryDto {
        const context = this.reduce(snapshot);
        const path = this.activePath(snapshot);
        const lastMessage = [...path].reverse().find((entry) => {
            if (entry.type !== "message") return false;
            return storedMessageText(entry.message, {stripThinking: true}).trim().length > 0;
        });
        const updatedAt = path.at(-1)?.timestamp ?? snapshot.metadata.createdAt;
        const interrupted = [...path].reverse().find((entry) => entry.type === "invocation_lifecycle");

        return {
            sessionId: snapshot.metadata.sessionId,
            sessionIdentity: resolveSessionIdentity(snapshot.metadata),
            profileKey: context.profileKey,
            currentProjectRoot: snapshot.metadata.currentProjectRoot,
            migrationReview: snapshot.metadata.migrationReview,
            parentSessionId: snapshot.metadata.parentSessionId,
            systemRole: snapshot.metadata.systemRole,
            title: context.title,
            summary: context.summary,
            status: context.archived
                ? "archived"
                : interrupted?.type === "invocation_lifecycle" && interrupted.status === "start" ? "interrupted" : "idle",
            updatedAt,
            archived: context.archived,
            lastMessagePreview: lastMessage?.type === "message" ? storedMessageText(lastMessage.message, {stripThinking: true}).trim().slice(0, 160) : undefined,
            usage: this.usage(snapshot),
        };
    }

    /**
     * 汇总 active path 中所有原始 assistant 调用的 provider usage。
     *
     * 注意不要从 reduce().messages 统计：compaction 会把早期历史替换成 summary message，
     * 但 session 总消耗必须保留压缩前已经发生的模型调用成本。
     */
    usage(snapshot: SessionSnapshot): AgentSessionSummaryDto["usage"] {
        const assistantMessages = this.activePath(snapshot)
            .flatMap((entry) => entry.type === "message" && entry.message.role === "assistant"
                ? [entry.message]
                : []);
        return sumAssistantUsage(assistantMessages);
    }

    /**
     * 返回树节点摘要，供 /tree 展示或测试断言。
     */
    tree(snapshot: SessionSnapshot): SessionTreeNode[] {
        const activeIds = new Set(this.activePath(snapshot).map((entry) => entry.id));
        const childCountByParentId = new Map<SessionEntryId | null, number>();
        const labelsByTargetId = new Map<SessionEntryId, string>();
        for (const entry of snapshot.entries) {
            if (entry.type === "leaf" || ("origin" in entry && entry.origin === "projection")) {
                continue;
            }
            childCountByParentId.set(entry.parentId, (childCountByParentId.get(entry.parentId) ?? 0) + 1);
            if (entry.type === "label") {
                labelsByTargetId.set(entry.targetEntryId, entry.label);
            }
        }
        return snapshot.entries
            .filter((entry) => entry.type !== "leaf" && (!("origin" in entry) || entry.origin !== "projection"))
            .map((entry) => ({
                id: entry.id,
                parentId: entry.parentId,
                type: entry.type,
                timestamp: entry.timestamp,
                active: activeIds.has(entry.id),
                terminal: !childCountByParentId.has(entry.id),
                childCount: childCountByParentId.get(entry.id) ?? 0,
                role: entry.type === "message" ? entry.message.role : entry.type === "custom_message" ? entry.message.role : undefined,
                chatEntry: chatEntryKind(entry) ?? undefined,
                preview: this.treeNodePreview(entry),
                toolName: entry.type === "message" && entry.message.role === "toolResult"
                    ? projectPublicToolName(entry.message.toolName)
                    : undefined,
                label: labelsByTargetId.has(entry.id)
                    ? textPreview(labelsByTargetId.get(entry.id) ?? "", PUBLIC_TREE_TEXT_BYTES).preview
                    : undefined,
            }));
    }

    /**
     * 生成 tree 面板用的短预览。只用于 UI 摘要，不参与 reduce。
     */
    private treeNodePreview(entry: SessionEntry): string | undefined {
        if (entry.type === "message") {
            return textPreview(
                storedMessageText(entry.message, {stripThinking: true}).replace(/\s+/g, " ").trim(),
                PUBLIC_TREE_TEXT_BYTES,
            ).preview || undefined;
        }
        if (entry.type === "custom_message") {
            return typeof entry.message.role === "string"
                ? textPreview(entry.message.role, PUBLIC_TREE_TEXT_BYTES).preview
                : undefined;
        }
        if (entry.type === "compaction") {
            return textPreview(entry.summary.replace(/\s+/g, " ").trim(), PUBLIC_TREE_TEXT_BYTES).preview || undefined;
        }
        if (entry.type === "branch_summary") {
            return textPreview(entry.summary.replace(/\s+/g, " ").trim(), PUBLIC_TREE_TEXT_BYTES).preview || undefined;
        }
        if (entry.type === "session_update") {
            const value = entry.updates.title || entry.updates.summary;
            return value ? textPreview(value, PUBLIC_TREE_TEXT_BYTES).preview : undefined;
        }
        if (entry.type === "label") {
            return textPreview(entry.label, PUBLIC_TREE_TEXT_BYTES).preview || undefined;
        }
        if (entry.type === "invocation_lifecycle") {
            return textPreview(`${entry.invocationId} ${entry.status}`, PUBLIC_TREE_TEXT_BYTES).preview;
        }
        if (entry.type === "custom") {
            return textPreview(entry.key, PUBLIC_TREE_TEXT_BYTES).preview || undefined;
        }
        return undefined;
    }

    /**
     * 从当前 session 分叉出一个新 session，只记录出处，不复制任何历史 entry。
     *
     * 刻意不设 `parentSessionId`：那个字段表达的是「子 Agent」关系，会话列表按它区分顶层与
     * 子 Agent（见 `matchesSessionFilter` 的 relation 过滤），fork 出来的会话若占用它会从顶层
     * 列表消失。出处改由 `fork.from` custom entry 承载。
     */
    async forkSession(sessionId: SessionId, entryId?: SessionEntryId): Promise<SessionSnapshot> {
        const snapshot = await this.readSession(sessionId);
        const fork = await this.createSession({
            profileKey: snapshot.metadata.profileKey,
            initial: snapshot.metadata.initial,
            currentProjectRoot: snapshot.metadata.currentProjectRoot,
            title: snapshot.metadata.title,
        });
        await this.appendEntry(fork.metadata.sessionId, {
            type: "custom",
            key: "fork.from",
            value: {
                sessionId,
                ...(entryId === undefined ? {} : {entryId}),
            },
        });
        return this.readSession(fork.metadata.sessionId);
    }

    private applyCompaction(path: SessionEntry[], compaction: CompactionSessionEntry, messages: StoredAgentMessage[]): StoredAgentMessage[] {
        const summaryMessage: StoredAgentMessage = {
            role: "user",
            content: [{
                type: "text",
                text: compaction.summary,
            }],
            timestamp: compaction.timestamp,
        };
        if (!compaction.firstKeptEntryId) {
            return [summaryMessage];
        }

        const keptEntryIds = new Set(path.slice(path.findIndex((entry) => entry.id === compaction.firstKeptEntryId)).map((entry) => entry.id));
        const keptMessages: StoredAgentMessage[] = [];
        for (const entry of path) {
            if (!keptEntryIds.has(entry.id)) {
                continue;
            }
            if (entry.type === "message") {
                keptMessages.push(entry.message);
            }
            if (entry.type === "custom_message" && entry.visibleToModel) {
                keptMessages.push(entry.message);
            }
        }
        return [summaryMessage, ...keptMessages.length ? keptMessages : messages.slice(-4)];
    }

    private projectionApplies(scope: SessionProjectionScope | undefined, activePathIds: Set<SessionEntryId>): boolean {
        if (!scope) {
            return true;
        }
        return scope.scope === "activeLeaf" && (scope.leafId === null ? activePathIds.size === 0 : activePathIds.has(scope.leafId));
    }

    /** sessionId 分配串行链：seq 文件是读改写，无互斥时并发 createSession 会拿到同一个 id（Task 110 workflow 并发建 session 踩出） */
    private sessionSeqChain: Promise<unknown> = Promise.resolve();

    private async nextSessionId(): Promise<SessionId> {
        const allocation = this.sessionSeqChain.then(async () => {
            const seqPath = join(this.rootWorkspace, ".nbook", "agent", "session-seq.json");
            await mkdir(dirname(seqPath), {recursive: true});
            let next = 1;
            try {
                const current = JSON.parse(await readFile(seqPath, "utf8")) as {next?: unknown};
                if (typeof current.next === "number" && Number.isInteger(current.next) && current.next > 0) {
                    next = current.next;
                }
            } catch {
                next = 1;
            }
            await writeFile(seqPath, JSON.stringify({next: next + 1}, null, 2), "utf8");
            return next;
        });
        // 失败不断链：下一次分配照常排队执行
        this.sessionSeqChain = allocation.catch(() => undefined);
        return allocation;
    }

    private resolveLeaf(entries: SessionEntry[]): SessionEntryId | null {
        let leafId: SessionEntryId | null = null;
        for (const entry of entries) {
            if (entry.type === "leaf") {
                leafId = entry.leafId;
            }
        }
        return leafId;
    }

    private sessionPath(sessionId: SessionId): string {
        return join(this.rootWorkspace, ".nbook", "agent", "sessions", `${sessionId}.jsonl`);
    }

    private createEntryId(): SessionEntryId {
        return randomUUID();
    }

    /** Repository 读写双侧拒绝尚未迁移的 Pi raw image。 */
    private assertStoredEntry(entry: SessionEntry): void {
        if (entry.type === "message" || entry.type === "custom_message") {
            parseStoredMessage(entry.message);
        }
        if (entry.type === "message" && entry.message.role === "user") {
            if (typeof entry.clientMessageId !== "string" || !CLIENT_MESSAGE_ID_PATTERN.test(entry.clientMessageId)) {
                throw new StoredMessageInvariantError("corrupt", "User message entry 缺少合法 clientMessageId。");
            }
            if (entry.intent !== "normal" && entry.intent !== "steer") {
                throw new StoredMessageInvariantError("corrupt", "User message entry 缺少明确 intent。");
            }
        }
        if (entry.type === "session_attachment") {
            if (entry.origin !== "projection" || (entry.source !== "upload" && entry.source !== "file_snapshot")) {
                throw new StoredMessageInvariantError("corrupt", "Session Attachment projection entry 非法。");
            }
            parseStoredAttachment({
                type: "attachment",
                attachment: entry.attachment,
                ...(entry.name === undefined ? {} : {name: entry.name}),
            });
        }
        if (entry.type === "model_change") {
            parseDurableSessionModelRef(entry.model);
        }
        if (entry.type === "current_project_change" && entry.projectRoot !== null) {
            ProjectRootDtoSchema.parse(entry.projectRoot);
        }
    }

    /** 只把当前目标 JSONL 的缺失转换为 Session 领域错误。 */
    private sessionFileError(error: unknown, sessionId: SessionId, sessionPath: string): Error {
        if (error instanceof Error
            && "code" in error
            && error.code === "ENOENT"
            && "path" in error
            && error.path === sessionPath) {
            return new AgentSessionNotFoundError(sessionId);
        }
        return error instanceof Error ? error : new Error(String(error));
    }

    /** Runtime只接受完整v2 metadata；旧格式解码只能存在于离线migration目录。 */
    private assertMetadata(metadata: SessionMetadata): SessionMetadata {
        const allowedKeys = new Set<keyof SessionMetadata>([
            "schemaVersion",
            "sessionId",
            "sessionIdentity",
            "profileKey",
            "initial",
            "currentProjectRoot",
            "migrationReview",
            "parentSessionId",
            "createdAt",
            "title",
            "summary",
            "systemRole",
            "kind",
            "tags",
        ]);
        const unknownKeys = Object.keys(metadata).filter((key) => !allowedKeys.has(key as keyof SessionMetadata));
        if (unknownKeys.length > 0) {
            throw new Error(`Agent Session schema v2 metadata包含已删除或未知字段：${unknownKeys.sort().join(", ")}`);
        }
        if (metadata.schemaVersion !== 2) throw new Error("Agent Session schema不是v2，请先运行应用状态迁移。");
        if (metadata.sessionIdentity !== undefined) {
            const parsedIdentity = AgentSessionIdentitySchema.safeParse(metadata.sessionIdentity);
            if (!parsedIdentity.success) throw new Error("Agent Session identity 格式非法。");
        }
        if (metadata.currentProjectRoot !== undefined) ProjectRootDtoSchema.parse(metadata.currentProjectRoot);
        if (metadata.migrationReview) {
            if (metadata.migrationReview.status !== "required"
                || metadata.migrationReview.reason !== "current_project_unresolved"
                || metadata.currentProjectRoot !== undefined) {
                throw new Error("Agent Session migrationReview非法。");
            }
        }
        return {...metadata};
    }

    /** 验证文件名/请求 ID，并把旧 header 归一化为带 identity 的运行时 metadata。 */
    private normalizeHeader(sessionId: SessionId, metadata: SessionMetadata): SessionMetadata {
        const header = this.assertMetadata(metadata);
        if (header.sessionId !== sessionId) {
            throw new Error(`session ${sessionId} 文件 header 与请求 ID 不一致`);
        }
        return {...header, sessionIdentity: resolveSessionIdentity(header)};
    }

    /** 将append-only重绑事实投影到本次读取的有效metadata。 */
    private effectiveMetadata(header: SessionMetadata, entries: readonly SessionEntry[]): SessionMetadata {
        const change = [...entries].reverse().find((entry) => entry.type === "current_project_change");
        if (!change || change.type !== "current_project_change") return header;
        const metadata = {...header};
        delete metadata.migrationReview;
        if (change.projectRoot === null) delete metadata.currentProjectRoot;
        else metadata.currentProjectRoot = change.projectRoot;
        return metadata;
    }

    private async appendLine(path: string, record: SessionFileRecord): Promise<void> {
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    }
}
