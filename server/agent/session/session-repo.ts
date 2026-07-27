import {appendFile, mkdir, readFile, readdir, writeFile} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createInterface} from "node:readline";
import {dirname, join, resolve} from "node:path";
import {randomUUID} from "node:crypto";
import {consola} from "consola";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {StoredAgentMessage} from "nbook/server/agent/messages/stored-types";
import {parseStoredMessage, StoredMessageInvariantError} from "nbook/server/agent/messages/stored-message-codec";
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
import {reduceRelationLedger} from "nbook/server/agent/session/relation-ledger";
import {AttachmentMigrationGate} from "nbook/server/agent/session/attachment-migration-gate";
import {storedMessageText} from "nbook/server/agent/messages/stored-message-presentation";
import {normalizeWorkspaceRootRef, type WorkspaceRootRef} from "nbook/server/workspace-files/workspace-root-ref";
import {PUBLIC_TREE_TEXT_BYTES} from "nbook/server/agent/events/public-event-policy";
import {projectPublicToolName, textPreview} from "nbook/server/agent/events/public-tool-projection";
import {migrateSessionJsonlModels, parseDurableSessionModelRef} from "nbook/server/agent/session/session-model-redaction";

type CreateSessionInput = {
    profileKey: string;
    initial: JsonValue;
    workspaceRoot: WorkspaceRootRef;
    workspaceKey?: string;
    projectPath?: string;
    parentSessionId?: SessionId;
    systemRole?: SessionMetadata["systemRole"];
    title?: string;
};

type AppendEntryInput = SessionEntryDraft & {
    id?: SessionEntryId;
    parentId?: SessionEntryId | null;
    timestamp?: number;
};
type AppendBatchEntryInput = Exclude<AppendEntryInput, {type: "leaf"}>;

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

/**
 * JSONL session 仓库。所有状态变化都通过 append entry 表达。
 */
export class JsonlSessionRepository {
    readonly rootWorkspace: string;
    private readonly attachmentMigrationGate: AttachmentMigrationGate;
    /** 避免同一批损坏Session在每次列表刷新时重复淹没运行日志。 */
    private issueFingerprint = "";
    /** 每个 Session 独立执行旧模型脱敏；单文件失败不能阻断其他 Session。 */
    private readonly modelRedactionReady = new Map<SessionId, Promise<void>>();

    constructor(rootWorkspace: string) {
        this.rootWorkspace = rootWorkspace;
        this.attachmentMigrationGate = new AttachmentMigrationGate(rootWorkspace);
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
        await this.attachmentMigrationGate.assertWritable();
        const sessionId = await this.nextSessionId();
        const now = Date.now();
        const metadata: SessionMetadata = {
            sessionId,
            profileKey: input.profileKey,
            initial: input.initial,
            workspaceRoot: input.workspaceRoot,
            workspaceKey: input.workspaceKey ?? "global",
            projectPath: input.projectPath,
            parentSessionId: input.parentSessionId,
            systemRole: input.systemRole,
            createdAt: now,
            title: input.title,
        };
        const sessionPath = this.sessionPath(sessionId);
        await mkdir(dirname(sessionPath), {recursive: true});
        await this.attachmentMigrationGate.assertWritable();
        await writeFile(sessionPath, `${JSON.stringify({kind: "header", metadata} satisfies SessionFileRecord)}\n`, "utf8");
        await this.appendEntry(sessionId, {
            type: "leaf",
            leafId: null,
        }, metadata.workspaceKey);
        return this.readSession(sessionId, metadata.workspaceKey);
    }

    /**
     * 读取 session。workspaceKey 仅为旧调用点保留，不参与路径定位。
     */
    async readSession(sessionId: SessionId, workspaceKey?: string): Promise<SessionSnapshot> {
        await this.ensureSessionModelRedaction(sessionId);
        const sessionPath = this.sessionPath(sessionId);
        const text = await readFile(sessionPath, "utf8");
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
            metadata: {
                ...header.metadata,
                workspaceRoot: normalizeWorkspaceRootRef(header.metadata.workspaceRoot, header.metadata.projectPath),
            },
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
     * Attachment route 需要 Project Path 执行数据面 open gate；这个 Interface 保留
     * JSONL 流式读取的 locality，同时避免调用方从物理 blob 路径反推 Project 身份。
     */
    async readEntryContext(sessionId: SessionId, entryId: SessionEntryId): Promise<SessionEntryContext> {
        await this.ensureSessionModelRedaction(sessionId);
        const stream = createReadStream(this.sessionPath(sessionId), {encoding: "utf8"});
        const lines = createInterface({input: stream, crlfDelay: Infinity});
        let metadata: SessionMetadata | null = null;
        try {
            for await (const line of lines) {
                if (!line) {
                    continue;
                }
                const record = JSON.parse(line) as SessionFileRecord;
                if (record.kind === "header") {
                    metadata = {
                        ...record.metadata,
                        workspaceRoot: normalizeWorkspaceRootRef(record.metadata.workspaceRoot, record.metadata.projectPath),
                    };
                    continue;
                }
                const entry = record.kind === "entry"
                    ? record.entry
                    : record.kind === "batch"
                        ? record.entries.find((candidate) => candidate.id === entryId)
                        : undefined;
                if (entry?.id !== entryId) {
                    continue;
                }
                this.assertStoredEntry(entry);
                if (!metadata) {
                    throw new Error(`session ${sessionId} 缺少 header`);
                }
                return {metadata, entry};
            }
            if (!metadata) {
                throw new Error(`session ${sessionId} 缺少 header`);
            }
            return {metadata, entry: null};
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
        if (input.workspaceKey && summary.workspaceKey !== input.workspaceKey) {
            return false;
        }
        if (input.projectPath && summary.projectPath !== input.projectPath) {
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
     * 只包含写作模式 leader（leader.*）；rp.leader / simulator.leader 属于 RP/模拟专用界面，
     * 不混入 Agent 页面的写作会话列表（RP 界面按 profileKey 精确过滤自己的会话）。
     */
    private isLeaderProfile(profileKey: string): boolean {
        return profileKey.startsWith("leader.");
    }

    /**
     * 追加 entry，并在非 leaf entry 后自动移动 leaf。
     */
    async appendEntry(sessionId: SessionId, input: AppendEntryInput, workspaceKey?: string): Promise<SessionEntry> {
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
    async appendProjectionEntry(sessionId: SessionId, input: AppendEntryInput, projectionScope?: SessionProjectionScope, workspaceKey?: string): Promise<SessionEntry> {
        const snapshot = await this.readSession(sessionId);
        const currentLeafId = this.resolveLeaf(snapshot.entries);
        const entry = {
            ...input,
            origin: input.type === "custom" || input.type === "session_update" ? "projection" : undefined,
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
    async appendEntries(sessionId: SessionId, inputs: AppendBatchEntryInput[], workspaceKey?: string): Promise<SessionEntry[]> {
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
    async appendMessage(sessionId: SessionId, message: StoredAgentMessage, workspaceKey?: string, origin?: "prompt" | "harness" | "manual" | "ingest"): Promise<SessionEntry> {
        return this.appendEntry(sessionId, {
            type: "message",
            message,
            origin,
        }, workspaceKey);
    }

    /**
     * 追加用户输入 message。
     */
    async appendUserMessage(sessionId: SessionId, text: string, workspaceKey?: string): Promise<SessionEntry> {
        return this.appendMessage(sessionId, createStoredUserMessage(text), workspaceKey, "manual");
    }

    /**
     * 移动 active leaf，不删除任何历史。
     */
    async moveLeaf(sessionId: SessionId, leafId: SessionEntryId | null, workspaceKey?: string): Promise<SessionEntry> {
        return this.appendEntry(sessionId, {
            type: "leaf",
            leafId,
            origin: "move",
        }, workspaceKey);
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
        let archived = snapshot.entries.some((entry) => entry.type === "session_archived");
        let agentMode: NeuroSessionContext["agentMode"] = "normal";

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
            if (entry.type === "session_archived") {
                archived = true;
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
            workspaceRoot: snapshot.metadata.workspaceRoot,
            projectPath: snapshot.metadata.projectPath,
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
            profileKey: context.profileKey,
            workspaceKey: snapshot.metadata.workspaceKey,
            workspaceRoot: context.workspaceRoot,
            projectPath: snapshot.metadata.projectPath,
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
                messageId: entry.type === "message" || entry.type === "custom_message" ? entry.id : undefined,
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
     * 创建新 session，并从指定 entry 附带 parent session 信息。
     */
    async forkSession(sessionId: SessionId, entryId?: SessionEntryId): Promise<SessionSnapshot> {
        const snapshot = await this.readSession(sessionId);
        const fork = await this.createSession({
            profileKey: snapshot.metadata.profileKey,
            initial: snapshot.metadata.initial,
            workspaceRoot: snapshot.metadata.workspaceRoot,
            workspaceKey: snapshot.metadata.workspaceKey,
            projectPath: snapshot.metadata.projectPath,
            parentSessionId: sessionId,
            title: snapshot.metadata.title,
        });
        if (entryId) {
            await this.appendEntry(fork.metadata.sessionId, {
                type: "custom",
                key: "fork.fromEntryId",
                value: entryId,
            }, fork.metadata.workspaceKey);
        }
        return this.readSession(fork.metadata.sessionId, fork.metadata.workspaceKey);
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

    private async nextSessionId(): Promise<SessionId> {
        await this.attachmentMigrationGate.assertWritable();
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
        await this.attachmentMigrationGate.assertWritable();
        await writeFile(seqPath, JSON.stringify({next: next + 1}, null, 2), "utf8");
        return next;
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
        if (entry.type === "model_change") {
            parseDurableSessionModelRef(entry.model);
        }
    }

    /** 在任何现有Session进入runtime前原子脱敏完整Pi Model。 */
    private async ensureSessionModelRedaction(sessionId: SessionId): Promise<void> {
        let ready = this.modelRedactionReady.get(sessionId);
        if (!ready) {
            ready = migrateSessionJsonlModels(this.sessionPath(sessionId)).then(() => undefined);
            this.modelRedactionReady.set(sessionId, ready);
        }
        await ready;
    }

    private async appendLine(path: string, record: SessionFileRecord): Promise<void> {
        await this.attachmentMigrationGate.assertWritable();
        await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
    }
}
