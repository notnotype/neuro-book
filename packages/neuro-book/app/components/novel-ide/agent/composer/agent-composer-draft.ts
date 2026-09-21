import {parseAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";
import {
    AgentComposerDraftIdentitySchema,
    AgentComposerDraftScopeKeySchema,
    type AgentComposerDraftIdentity,
    type AgentComposerDraftLoadResult,
    type AgentComposerDraftMigrationRecord,
    type AgentComposerDraftMigrationResult,
    type AgentComposerDraftSaveRequest,
    type AgentComposerDraftSaveResult,
} from "nbook/shared/dto/agent-composer-draft.dto";

export type {AgentComposerDraftSaveResult} from "nbook/shared/dto/agent-composer-draft.dto";

const LEGACY_DRAFT_PREFIX = "agent:composer-draft:v1:";
const LEGACY_DRAFT_VERSION = 1;
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_DRAFTS = 10;
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UTF8_ENCODER = new TextEncoder();

type LegacyAgentComposerDraft = {
    version: 1;
    text: string;
    updatedAt: number;
};

/** Composer Draft HTTP 能力的最小类型化边界。 */
export type AgentComposerDraftApi = {
    getComposerDraft(identity: AgentComposerDraftIdentity): Promise<AgentComposerDraftLoadResult>;
    saveComposerDraft(request: AgentComposerDraftSaveRequest): Promise<AgentComposerDraftSaveResult>;
    clearComposerDraft(identity: AgentComposerDraftIdentity): Promise<{cleared: true}>;
    migrateComposerDrafts(request: {drafts: AgentComposerDraftMigrationRecord[]}): Promise<AgentComposerDraftMigrationResult>;
};

export type AgentComposerDraftContext = AgentComposerDraftIdentity & {
    generation: number;
    revision: number;
    text: string;
};

/** 已从磁盘读取、但尚未成为当前 Composer context 的草稿快照。 */
export type AgentComposerDraftPreparedContext = Readonly<AgentComposerDraftIdentity & {
    text: string;
}>;

export type AgentComposerSubmission = Readonly<AgentComposerDraftContext>;

export type AgentComposerDraftSwitchResult = AgentComposerDraftLoadResult & {
    generation: number;
    /** false 表示另一次 context 切换已使本次异步 load 失效。 */
    active: boolean;
};

/** 当前正文无法安全持久化；切换/清理必须停在原 context。 */
export class AgentComposerDraftBlockedError extends Error {
    constructor(readonly result: Extract<AgentComposerDraftSaveResult, "oversize" | "unsafe">) {
        super(result === "oversize" ? "Composer 草稿超过允许大小" : "Composer 草稿包含不安全图片地址");
        this.name = "AgentComposerDraftBlockedError";
    }
}

function assertDraftPersisted(result: AgentComposerDraftSaveResult): void {
    if (result === "oversize" || result === "unsafe") {
        throw new AgentComposerDraftBlockedError(result);
    }
}

/** 前端只通过这个 Adapter 访问磁盘 Store；localStorage 只作为一次性迁移源。 */
export class AgentComposerDraftClientStore {
    private initialization: Promise<void> | null = null;

    constructor(
        private readonly api: AgentComposerDraftApi,
        private readonly legacyStorage: Storage,
    ) {}

    /** 首次调用迁移全部合法旧草稿；服务端确认后立即删除旧 key。 */
    async initialize(now = Date.now()): Promise<void> {
        this.initialization ??= this.migrateLegacy(now).catch((error) => {
            this.initialization = null;
            throw error;
        });
        await this.initialization;
    }

    async load(identity: AgentComposerDraftIdentity): Promise<AgentComposerDraftLoadResult> {
        await this.initialize();
        return await this.api.getComposerDraft(identity);
    }

    async save(context: AgentComposerDraftSaveRequest): Promise<AgentComposerDraftSaveResult> {
        await this.initialize();
        return await this.api.saveComposerDraft(context);
    }

    async clear(identity: AgentComposerDraftIdentity): Promise<void> {
        await this.initialize();
        await this.api.clearComposerDraft(identity);
    }

    private async migrateLegacy(now: number): Promise<void> {
        const migration = collectLegacyAgentComposerDrafts(this.legacyStorage, now);
        if (migration.drafts.length === 0) return;
        await this.api.migrateComposerDrafts({drafts: migration.drafts});
        migration.keys.forEach((key) => this.legacyStorage.removeItem(key));
    }
}

/**
 * 绑定 Workspace Root / Session 的异步草稿生命周期。
 *
 * 所有磁盘动作进入同一 Promise 队列，保证 debounce save、context switch 与
 * accepted clear 不会因 HTTP 完成顺序不同而覆盖彼此。
 */
export class AgentComposerDraftSession {
    private context: AgentComposerDraftContext | null = null;
    private generation = 0;
    private operationRevision = 0;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private queue: Promise<void> = Promise.resolve();

    constructor(
        private readonly store: AgentComposerDraftClientStore,
        private readonly onSave?: (result: AgentComposerDraftSaveResult, context: AgentComposerDraftContext) => void,
        private readonly onError?: (error: unknown) => void,
    ) {}

    /** 只读取目标草稿，不改变当前 context；调用方可在异步加载完成后再决定是否激活。 */
    async prepareContext(scopeKey: string, sessionId: number): Promise<AgentComposerDraftPreparedContext> {
        const identity = AgentComposerDraftIdentitySchema.parse({scopeKey, sessionId});
        const loaded = await this.enqueue(() => this.store.load(identity));
        return {...identity, text: loaded.text};
    }

    /** 在调用方完成 owner 检查后同步激活已读取的草稿快照。 */
    activateContext(prepared: AgentComposerDraftPreparedContext): number {
        const identity = AgentComposerDraftIdentitySchema.parse({
            scopeKey: prepared.scopeKey,
            sessionId: prepared.sessionId,
        });
        this.operationRevision += 1;
        this.cancelTimer();
        const generation = ++this.generation;
        this.context = {...identity, generation, revision: 0, text: prepared.text};
        return generation;
    }

    /** 保存旧 context 后加载新 Session；过时 load 不会成为当前 context。 */
    async switchContext(scopeKey: string, sessionId: number): Promise<AgentComposerDraftSwitchResult> {
        const parsedScopeKey = AgentComposerDraftScopeKeySchema.parse(scopeKey);
        const previous = this.context ? {...this.context} : null;
        const operationRevision = ++this.operationRevision;
        if (previous) {
            assertDraftPersisted(await this.persist(previous));
        }
        const loaded = await this.prepareContext(parsedScopeKey, sessionId);
        if (operationRevision !== this.operationRevision) {
            return {...loaded, generation: this.generation, active: false};
        }
        this.cancelTimer();
        const generation = ++this.generation;
        this.context = {scopeKey: parsedScopeKey, sessionId, generation, revision: 0, text: loaded.text};
        return {...loaded, generation, active: true};
    }

    /** 关闭当前 context；用于 Project Workspace 切换和组件销毁。 */
    async clearContext(): Promise<number> {
        const previous = this.context ? {...this.context} : null;
        const operationRevision = ++this.operationRevision;
        if (previous) {
            assertDraftPersisted(await this.persist(previous));
        }
        if (operationRevision !== this.operationRevision) return this.generation;
        this.cancelTimer();
        this.context = null;
        this.generation += 1;
        return this.generation;
    }

    /** 用户明确放弃当前无法保存的正文后，才允许无持久化地解除 context。 */
    discardContext(): number {
        this.operationRevision += 1;
        this.cancelTimer();
        this.context = null;
        this.generation += 1;
        return this.generation;
    }

    /** 更新内存正文，并捕获 generation 的 300ms 延迟保存。 */
    update(text: string): void {
        if (!this.context || this.context.text === text) return;
        this.context.text = text;
        this.context.revision += 1;
        const generation = this.context.generation;
        this.cancelTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            if (this.context?.generation === generation) {
                void this.flush().catch((error) => this.onError?.(error));
            }
        }, 300);
    }

    /** 立即把当前 context 排入持久化队列。 */
    async flush(): Promise<AgentComposerDraftSaveResult | null> {
        if (!this.context) return null;
        return await this.persist({...this.context});
    }

    /** 捕获一次发送对应的不可变 context/revision。 */
    capture(expectedText: string): AgentComposerSubmission | null {
        if (!this.context || this.context.text !== expectedText) return null;
        return Object.freeze({...this.context});
    }

    /** accepted 后 compare-and-clear；迟到 acceptance 不删除后来编辑的新正文。 */
    async accept(submission: AgentComposerSubmission): Promise<{clearEditor: boolean}> {
        const current = this.context;
        if (current && current.scopeKey === submission.scopeKey && current.sessionId === submission.sessionId) {
            if (current.generation !== submission.generation
                || current.revision !== submission.revision
                || current.text !== submission.text) {
                return {clearEditor: false};
            }
            await this.enqueue(() => this.store.clear(submission));
            if (current.generation !== submission.generation
                || current.revision !== submission.revision
                || current.text !== submission.text) {
                return {clearEditor: false};
            }
            this.cancelTimer();
            current.text = "";
            current.revision += 1;
            return {clearEditor: true};
        }

        const stored = await this.enqueue(() => this.store.load(submission));
        if (stored.text === submission.text) {
            await this.enqueue(() => this.store.clear(submission));
        }
        return {clearEditor: false};
    }

    async dispose(): Promise<void> {
        await this.clearContext();
    }

    private async persist(snapshot: AgentComposerDraftContext): Promise<AgentComposerDraftSaveResult> {
        const result = await this.enqueue(() => this.store.save(snapshot));
        this.onSave?.(result, snapshot);
        return result;
    }

    /** 失败不会毒化后续队列；调用方仍能观察本次错误。 */
    private async enqueue<TResult>(action: () => Promise<TResult>): Promise<TResult> {
        const operation = this.queue.then(action, action);
        this.queue = operation.then(() => undefined, () => undefined);
        return await operation;
    }

    private cancelTimer(): void {
        if (!this.timer) return;
        clearTimeout(this.timer);
        this.timer = null;
    }
}

/** 扫描旧 localStorage；非法/过期/超额记录就地删除，合法记录等待迁移确认。 */
export function collectLegacyAgentComposerDrafts(storage: Storage, now = Date.now()): {
    drafts: AgentComposerDraftMigrationRecord[];
    keys: string[];
} {
    const candidates: Array<{key: string; draft: AgentComposerDraftMigrationRecord}> = [];
    const keys = Array.from({length: storage.length}, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key));
    for (const key of keys) {
        if (!key.startsWith(LEGACY_DRAFT_PREFIX)) continue;
        const identity = legacyIdentity(key);
        const raw = storage.getItem(key);
        try {
            const value = raw ? JSON.parse(raw) as Partial<LegacyAgentComposerDraft> : null;
            if (!identity
                || !value
                || value.version !== LEGACY_DRAFT_VERSION
                || typeof value.text !== "string"
                || typeof value.updatedAt !== "number"
                || !Number.isFinite(value.updatedAt)
                || value.updatedAt < 0
                || now - value.updatedAt > MAX_DRAFT_AGE_MS
                || UTF8_ENCODER.encode(value.text).byteLength > MAX_DRAFT_BYTES
                || hasUnsafeImageTarget(value.text)) {
                storage.removeItem(key);
                continue;
            }
            candidates.push({key, draft: {...identity, text: value.text, updatedAt: value.updatedAt}});
        } catch {
            storage.removeItem(key);
        }
    }
    candidates.sort((left, right) => right.draft.updatedAt - left.draft.updatedAt);
    candidates.slice(MAX_DRAFTS).forEach(({key}) => storage.removeItem(key));
    const retained = candidates.slice(0, MAX_DRAFTS);
    return {drafts: retained.map(({draft}) => draft), keys: retained.map(({key}) => key)};
}

/** 仅用于识别旧 localStorage key；新磁盘 Store 不使用字符串拼接 identity。 */
export function legacyAgentComposerDraftKey(scopeKey: string, sessionId: number): string {
    return `${LEGACY_DRAFT_PREFIX}${scopeKey}:${String(sessionId)}`;
}

function legacyIdentity(key: string): AgentComposerDraftIdentity | null {
    const suffix = key.slice(LEGACY_DRAFT_PREFIX.length);
    const separator = suffix.lastIndexOf(":");
    if (separator <= 0) return null;
    const parsed = {
        scopeKey: suffix.slice(0, separator),
        sessionId: Number(suffix.slice(separator + 1)),
    };
    const result = AgentComposerDraftScopeKeySchema.safeParse(parsed.scopeKey);
    return result.success && Number.isInteger(parsed.sessionId) && parsed.sessionId > 0
        ? {scopeKey: result.data, sessionId: parsed.sessionId}
        : null;
}

function hasUnsafeImageTarget(text: string): boolean {
    return parseAgentImageMarkdown(text).some((part) => part.type === "image"
        && /^(?:data:|blob:)/iu.test(part.target.trim()));
}
