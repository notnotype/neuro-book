import type {StoredAgentMessage, StoredAttachmentContent, StoredContent} from "nbook/server/agent/messages/stored-types";
import type {JsonlSessionRepository, SessionFileSignature} from "nbook/server/agent/session/session-repo";
import type {SessionWriteEntryBatch} from "nbook/server/agent/session/write-plan";
import type {SessionEntry, SessionMetadata} from "nbook/server/agent/session/types";
import {AttachmentError} from "nbook/server/agent/attachments/types";
import {projectPublicAttachment} from "nbook/server/agent/events/public-tool-projection";
import {requireActiveReadyProject} from "nbook/server/runtime/product-project";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";
import {attachmentMarkdownTarget} from "nbook/shared/agent/agent-image-markdown";
import type {AttachmentId, AttachmentRef} from "nbook/shared/dto/agent-attachment.dto";
import type {
    AgentSessionAttachmentItemDto,
    AgentSessionAttachmentListQueryDto,
    AgentSessionAttachmentPageDto,
} from "nbook/shared/dto/agent-session.dto";

type AuthorityItem = {
    ref: AttachmentRef;
    name?: string;
    nameSeenAt: number;
    nameOrdinal: number;
    locator: AgentSessionAttachmentItemDto["locator"];
    locatorOrdinal: number;
    firstSeenAt: number;
    lastSeenAt: number;
    referenceCount: number;
};

type LocatorItem = {
    ref: AttachmentRef;
    name?: string;
};

type SessionAttachmentIndexState = {
    signature: SessionFileSignature;
    items: Map<AttachmentId, AuthorityItem>;
    locators: Map<string, LocatorItem>;
    processedEntryIds: Set<string>;
    nextOrdinal: number;
    corrupt?: AttachmentError;
};

type SessionAttachmentIndex = SessionAttachmentIndexState & {
    metadata: SessionMetadata;
};

/**
 * Session 附件授权 Authority。
 *
 * JSONL 始终是唯一持久化真相；本类只维护可丢弃、可按文件签名重建的内存索引。
 */
export class SessionAttachmentAuthority {
    private readonly indexes = new Map<number, SessionAttachmentIndex>();
    private readonly loads = new Map<number, Promise<SessionAttachmentIndex>>();
    private readonly pendingWrites = new Map<number, SessionEntry[]>();

    constructor(private readonly repo: JsonlSessionRepository) {}

    /** 返回搜索、排序和分页后的 Session 全分支附件目录。 */
    async list(sessionId: number, query: AgentSessionAttachmentListQueryDto): Promise<AgentSessionAttachmentPageDto> {
        const index = await this.index(sessionId);
        const search = query.search?.toLocaleLowerCase("zh-CN") ?? "";
        const items = [...index.items.values()]
            .filter((item) => !search || [item.name, item.ref.id, item.ref.mimeType]
                .some((value) => value?.toLocaleLowerCase("zh-CN").includes(search)))
            .sort((left, right) => right.lastSeenAt - left.lastSeenAt || left.ref.id.localeCompare(right.ref.id))
            .map((item) => this.publicItem(item));
        const page = items.slice(query.offset, query.offset + query.limit);
        const nextOffset = query.offset + page.length;
        return {
            items: page,
            total: items.length,
            offset: query.offset,
            limit: query.limit,
            hasMore: nextOffset < items.length,
            ...(nextOffset < items.length ? {nextOffset} : {}),
        };
    }

    /** 批量解析 canonical refs；空输入不触发 JSONL 或文件系统访问。 */
    async resolve(sessionId: number, ids: readonly AttachmentId[]): Promise<Map<AttachmentId, StoredAttachmentContent>> {
        if (ids.length === 0) {
            return new Map();
        }
        const index = await this.index(sessionId);
        return this.resolveFromIndex(index, ids);
    }

    /**
     * invocation admission专用：只验证Session JSONL中的durable ownership与metadata一致性。
     * 本入口不读取附件blob或Project文件，也不授权公开locator/provider hydration。
     */
    async resolveDurableOwnership(sessionId: number, ids: readonly AttachmentId[]): Promise<Map<AttachmentId, StoredAttachmentContent>> {
        if (ids.length === 0) {
            return new Map();
        }
        return this.resolveFromIndex(await this.durableIndex(sessionId), ids);
    }

    /** 把已经校验健康的durable index投影为canonical attachment refs。 */
    private resolveFromIndex(index: SessionAttachmentIndex, ids: readonly AttachmentId[]): Map<AttachmentId, StoredAttachmentContent> {
        const result = new Map<AttachmentId, StoredAttachmentContent>();
        for (const id of new Set(ids)) {
            const item = index.items.get(id);
            if (!item) {
                throw new AttachmentError("invalid_reference", "图片附件不属于当前 Session。");
            }
            result.set(id, {
                type: "attachment",
                attachment: {...item.ref},
                ...(item.name === undefined ? {} : {name: item.name}),
            });
        }
        return result;
    }

    /** 按请求顺序返回公开 DTO；任一 ID 无权访问时整体失败。 */
    async resolveItems(sessionId: number, ids: readonly AttachmentId[]): Promise<AgentSessionAttachmentItemDto[]> {
        if (ids.length === 0) {
            return [];
        }
        const index = await this.index(sessionId);
        return ids.map((id) => {
            const item = index.items.get(id);
            if (!item) {
                throw new AttachmentError("invalid_reference", "图片附件不属于当前 Session。");
            }
            return this.publicItem(item);
        });
    }

    /** 强制构建并校验当前 Session 的完整附件投影。continue/rerun 也必须 fail closed。 */
    async validate(sessionId: number): Promise<void> {
        await this.index(sessionId);
    }

    /**
     * invocation admission专用：只重建并校验Session JSONL附件真相，不要求Project generation已open。
     * 真实blob读取、locator与provider hydration仍必须调用受Project门禁保护的公开入口。
     */
    async validateDurableOwnership(sessionId: number): Promise<void> {
        await this.durableIndex(sessionId);
    }

    /** 返回指定附件的公开目录项。 */
    async item(sessionId: number, id: AttachmentId): Promise<AgentSessionAttachmentItemDto> {
        const [item] = await this.resolveItems(sessionId, [id]);
        if (!item) {
            throw new AttachmentError("not_found", "Session Attachment 登记不存在。");
        }
        return item;
    }

    /** 按 entry/contentIndex 校验 locator，并返回 canonical metadata。 */
    async locator(sessionId: number, entryId: string, contentIndex: number): Promise<LocatorItem> {
        const index = await this.index(sessionId);
        const item = index.locators.get(locatorKey(entryId, contentIndex));
        if (!item) {
            throw new AttachmentError("not_found", "Attachment locator 不存在或已失效。");
        }
        return {
            ref: {...item.ref},
            ...(item.name === undefined ? {} : {name: item.name}),
        };
    }

    /** Provider hydration 前以 canonical ref 重建消息，metadata 不一致时 fail closed。 */
    async authorizeMessages(sessionId: number, messages: readonly StoredAgentMessage[]): Promise<StoredAgentMessage[]> {
        const ids = messages.flatMap((message) => message.role !== "assistant" && Array.isArray(message.content)
            ? message.content.flatMap((block) => block.type === "attachment" ? [block.attachment.id] : [])
            : []);
        await this.validate(sessionId);
        if (ids.length === 0) {
            return [...messages];
        }
        const authorized = await this.resolve(sessionId, ids);
        return messages.map((message): StoredAgentMessage => {
            if (message.role === "assistant" || !Array.isArray(message.content)) {
                return message;
            }
            const content = message.content.map((block): StoredContent => {
                if (block.type === "text") {
                    return {...block};
                }
                const canonical = authorized.get(block.attachment.id);
                if (!canonical
                    || canonical.attachment.mimeType !== block.attachment.mimeType
                    || canonical.attachment.bytes !== block.attachment.bytes) {
                    throw new AttachmentError("corrupt", "Session Attachment metadata 与 canonical ref 不一致。");
                }
                return {
                    type: "attachment",
                    attachment: {...canonical.attachment},
                    ...(block.name === undefined
                        ? canonical.name === undefined ? {} : {name: canonical.name}
                        : {name: block.name}),
                };
            });
            return {...message, content};
        });
    }

    /** SessionWriteExecutor after-write observer：增量更新热索引并通知调用方目录是否变化。 */
    async onEntriesWritten(batch: SessionWriteEntryBatch): Promise<boolean> {
        const attachmentEntries = batch.entries.filter((entry) => attachmentOccurrences(entry).length > 0);
        if (attachmentEntries.length === 0) {
            return false;
        }
        this.pendingWrites.get(batch.sessionId)?.push(...attachmentEntries);
        const cached = this.indexes.get(batch.sessionId);
        if (cached) {
            try {
                this.applyEntries(cached, attachmentEntries);
            } catch (error) {
                if (error instanceof AttachmentError) {
                    cached.corrupt = error;
                }
                throw error;
            } finally {
                cached.signature = await this.repo.sessionFileSignature(batch.sessionId);
            }
        }
        return true;
    }

    /** 返回经过 Project 数据面门禁的热索引；外部文件改写会触发重建。 */
    private async index(sessionId: number): Promise<SessionAttachmentIndex> {
        const index = await this.durableIndex(sessionId);
        if (index.metadata.currentProjectRoot) {
            requireActiveReadyProject(projectWorkspaceRef(index.metadata.currentProjectRoot));
        }
        return index;
    }

    /** 只读取并校验Session JSONL durable truth，不触碰Project generation资源。 */
    private async durableIndex(sessionId: number): Promise<SessionAttachmentIndex> {
        const signature = await this.repo.sessionFileSignature(sessionId);
        const cached = this.indexes.get(sessionId);
        if (cached && sameSignature(cached.signature, signature)) {
            this.assertHealthy(cached);
            return cached;
        }
        const loading = this.loads.get(sessionId);
        if (loading) {
            const index = await loading;
            this.assertHealthy(index);
            return index;
        }
        const load = this.rebuild(sessionId).finally(() => {
            if (this.loads.get(sessionId) === load) {
                this.loads.delete(sessionId);
            }
        });
        this.loads.set(sessionId, load);
        const index = await load;
        this.assertHealthy(index);
        return index;
    }

    /** 冷访问流式扫描；构建期间的 after-write 增量按 entry ID 去重补入。 */
    private async rebuild(sessionId: number): Promise<SessionAttachmentIndex> {
        this.indexes.delete(sessionId);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const before = await this.repo.sessionFileSignature(sessionId);
            const pending: SessionEntry[] = [];
            this.pendingWrites.set(sessionId, pending);
            const state: SessionAttachmentIndexState = {
                signature: before,
                items: new Map(),
                locators: new Map(),
                processedEntryIds: new Set(),
                nextOrdinal: 0,
            };
            try {
                const metadata = await this.repo.scanEntries(sessionId, (entry) => this.applyEntry(state, entry));
                const after = await this.repo.sessionFileSignature(sessionId);
                if (!sameSignature(before, after)) {
                    if (attempt === 0) {
                        continue;
                    }
                    throw new AttachmentError("corrupt", "Session JSONL 在附件索引构建期间持续变化。");
                }

                // signature 校验到 cache commit 之间不能 await；observer 增量与 candidate 在同一同步段合并。
                this.applyEntries(state, pending);
                state.signature = after;
                const index: SessionAttachmentIndex = {...state, metadata};
                this.indexes.set(sessionId, index);
                if (this.pendingWrites.get(sessionId) === pending) {
                    this.pendingWrites.delete(sessionId);
                }
                return index;
            } finally {
                if (this.pendingWrites.get(sessionId) === pending) {
                    this.pendingWrites.delete(sessionId);
                }
            }
        }
        throw new AttachmentError("corrupt", "Session JSONL 在附件索引构建期间持续变化。");
    }

    private applyEntries(index: SessionAttachmentIndexState, entries: readonly SessionEntry[]): void {
        for (const entry of entries) {
            this.applyEntry(index, entry);
        }
    }

    /** 将一个 durable entry 的全部附件 occurrence 合并入 canonical index。 */
    private applyEntry(index: SessionAttachmentIndexState, entry: SessionEntry): void {
        if (index.processedEntryIds.has(entry.id)) {
            return;
        }
        index.processedEntryIds.add(entry.id);
        for (const occurrence of attachmentOccurrences(entry)) {
            const ordinal = index.nextOrdinal;
            index.nextOrdinal += 1;
            const publicAttachment = projectPublicAttachment(occurrence.block.attachment, occurrence.block.name);
            if (!publicAttachment) {
                throw new AttachmentError("corrupt", "Session Attachment 引用损坏。");
            }
            const id = occurrence.block.attachment.id;
            const previous = index.items.get(id);
            if (previous && (previous.ref.mimeType !== occurrence.block.attachment.mimeType
                || previous.ref.bytes !== occurrence.block.attachment.bytes)) {
                throw new AttachmentError("corrupt", "同一 Attachment ID 的 MIME 或 bytes 不一致。");
            }
            const name = typeof occurrence.block.name === "string" && occurrence.block.name.trim()
                ? occurrence.block.name
                : undefined;
            index.locators.set(locatorKey(entry.id, occurrence.contentIndex), {
                ref: {...occurrence.block.attachment},
                ...(name === undefined ? {} : {name}),
            });
            if (!previous) {
                index.items.set(id, {
                    ref: {...occurrence.block.attachment},
                    ...(name === undefined ? {} : {name}),
                    nameSeenAt: name === undefined ? -1 : entry.timestamp,
                    nameOrdinal: name === undefined ? -1 : ordinal,
                    locator: {entryId: entry.id, contentIndex: occurrence.contentIndex},
                    locatorOrdinal: ordinal,
                    firstSeenAt: entry.timestamp,
                    lastSeenAt: entry.timestamp,
                    referenceCount: 1,
                });
                continue;
            }
            const previousLastSeenAt = previous.lastSeenAt;
            previous.firstSeenAt = Math.min(previous.firstSeenAt, entry.timestamp);
            previous.lastSeenAt = Math.max(previous.lastSeenAt, entry.timestamp);
            previous.referenceCount += 1;
            if (entry.timestamp > previousLastSeenAt
                || (entry.timestamp === previousLastSeenAt && ordinal >= previous.locatorOrdinal)) {
                previous.locator = {entryId: entry.id, contentIndex: occurrence.contentIndex};
                previous.locatorOrdinal = ordinal;
            }
            if (name !== undefined && (entry.timestamp > previous.nameSeenAt
                || (entry.timestamp === previous.nameSeenAt && ordinal >= previous.nameOrdinal))) {
                previous.name = name;
                previous.nameSeenAt = entry.timestamp;
                previous.nameOrdinal = ordinal;
            }
        }
    }

    private assertHealthy(index: SessionAttachmentIndexState): void {
        if (index.corrupt) {
            throw index.corrupt;
        }
    }

    private publicItem(item: AuthorityItem): AgentSessionAttachmentItemDto {
        const attachment = projectPublicAttachment(item.ref, item.name);
        if (!attachment) {
            throw new AttachmentError("corrupt", "Session Attachment 无法公开投影。");
        }
        return {
            attachment,
            target: attachmentMarkdownTarget(item.ref.id),
            locator: {...item.locator},
            firstSeenAt: item.firstSeenAt,
            lastSeenAt: item.lastSeenAt,
            referenceCount: item.referenceCount,
        };
    }
}

function sameSignature(left: SessionFileSignature, right: SessionFileSignature): boolean {
    return left.identity === right.identity && left.size === right.size && left.mtimeNs === right.mtimeNs;
}

function locatorKey(entryId: string, contentIndex: number): string {
    return `${entryId}:${String(contentIndex)}`;
}

function attachmentOccurrences(entry: SessionEntry): Array<{block: StoredAttachmentContent; contentIndex: number}> {
    if (entry.type === "session_attachment") {
        return [{
            block: {
                type: "attachment",
                attachment: entry.attachment,
                ...(entry.name === undefined ? {} : {name: entry.name}),
            },
            contentIndex: 0,
        }];
    }
    if (entry.type !== "message" && entry.type !== "custom_message") {
        return [];
    }
    const message = entry.message;
    if (message.role === "assistant" || !Array.isArray(message.content)) {
        return [];
    }
    return message.content.flatMap((block, contentIndex) => block.type === "attachment"
        ? [{block, contentIndex}]
        : []);
}
