import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {parseAgentImageMarkdown} from "nbook/shared/agent/agent-image-markdown";
import type {
    AgentComposerDraftIdentity,
    AgentComposerDraftLoadResult,
    AgentComposerDraftMigrationRecord,
    AgentComposerDraftMigrationResult,
    AgentComposerDraftSaveResult,
} from "nbook/shared/dto/agent-composer-draft.dto";

const DRAFT_FILE_SCHEMA = 1;
const MAX_DRAFT_BYTES = 256 * 1024;
const MAX_DRAFTS = 10;
const MAX_DRAFT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const UTF8_ENCODER = new TextEncoder();
const locks = new Map<string, Promise<void>>();

type AgentComposerDraftRecord = AgentComposerDraftMigrationRecord;

type AgentComposerDraftFile = {
    schemaVersion: 1;
    drafts: AgentComposerDraftRecord[];
};

/**
 * Workspace Root `.nbook` 下的 Composer Draft Store。
 *
 * 单文件设计把文件数固定为 1；所有 mutation 经进程内锁串行并原子 rename，避免
 * 多个 WebView/请求互相覆盖。服务端始终重新执行容量与安全校验。
 */
export class AgentComposerDraftStore {
    private readonly filePath: string;

    /** `userNbookRoot` 必须是 RuntimePaths.userNbookRoot。 */
    constructor(userNbookRoot: string) {
        this.filePath = join(userNbookRoot, "agent", "composer-drafts.json");
    }

    /** 读取单个草稿；读取也会回收过期或非法记录。 */
    async load(identity: AgentComposerDraftIdentity, now = Date.now()): Promise<AgentComposerDraftLoadResult> {
        return await withFileLock(this.filePath, async () => {
            const current = await this.read();
            const drafts = recentDrafts(validDrafts(current.drafts, now));
            if (drafts.length !== current.drafts.length) {
                await this.write(drafts);
            }
            const draft = drafts.find((item) => sameIdentity(item, identity));
            return {text: draft?.text ?? ""};
        });
    }

    /** 保存正文；空正文等价于删除，非法正文会删除旧记录。 */
    async save(identity: AgentComposerDraftIdentity, text: string, now = Date.now()): Promise<AgentComposerDraftSaveResult> {
        return await withFileLock(this.filePath, async () => {
            const current = await this.read();
            const valid = validDrafts(current.drafts, now);
            const withoutCurrent = valid.filter((item) => !sameIdentity(item, identity));
            let result: AgentComposerDraftSaveResult = "saved";
            if (!text) {
                result = "cleared";
            } else if (UTF8_ENCODER.encode(text).byteLength > MAX_DRAFT_BYTES) {
                result = "oversize";
            } else if (hasUnsafeImageTarget(text)) {
                result = "unsafe";
            } else {
                withoutCurrent.push({...identity, text, updatedAt: now});
            }
            // 非法新正文不能删除旧的安全草稿；用户仍可返回编辑或明确放弃。
            await this.write(recentDrafts(result === "oversize" || result === "unsafe" ? valid : withoutCurrent));
            return result;
        });
    }

    /** 删除一个已发送成功的草稿。 */
    async clear(identity: AgentComposerDraftIdentity, now = Date.now()): Promise<void> {
        await withFileLock(this.filePath, async () => {
            const current = await this.read();
            await this.write(validDrafts(current.drafts, now).filter((item) => !sameIdentity(item, identity)));
        });
    }

    /** 合并首次加载时发现的旧 WebView 草稿；同一身份保留更新时间较新的版本。 */
    async migrate(records: AgentComposerDraftMigrationRecord[], now = Date.now()): Promise<AgentComposerDraftMigrationResult> {
        return await withFileLock(this.filePath, async () => {
            const current = validDrafts((await this.read()).drafts, now);
            const merged = new Map(current.map((draft) => [identityKey(draft), draft]));
            let migrated = 0;
            for (const record of validDrafts(records, now)) {
                const key = identityKey(record);
                const existing = merged.get(key);
                if (!existing || existing.updatedAt < record.updatedAt) {
                    merged.set(key, record);
                    migrated += 1;
                }
            }
            await this.write(recentDrafts([...merged.values()]));
            return {migrated};
        });
    }

    /** 缺失文件表示空 Store；文件级损坏直接报错，避免静默清空其它草稿。 */
    private async read(): Promise<AgentComposerDraftFile> {
        const text = await readFile(this.filePath, "utf8").catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
        });
        if (text === null) return {schemaVersion: DRAFT_FILE_SCHEMA, drafts: []};
        const parsed = JSON.parse(text) as Partial<AgentComposerDraftFile>;
        if (parsed.schemaVersion !== DRAFT_FILE_SCHEMA || !Array.isArray(parsed.drafts)) {
            throw new Error(`Composer Draft Store 格式非法：${this.filePath}`);
        }
        return {schemaVersion: DRAFT_FILE_SCHEMA, drafts: parsed.drafts};
    }

    /** 空 Store 删除数据文件；非空 Store 通过同目录临时文件原子发布。 */
    private async write(drafts: AgentComposerDraftRecord[]): Promise<void> {
        if (drafts.length === 0) {
            await rm(this.filePath, {force: true});
            return;
        }
        await mkdir(dirname(this.filePath), {recursive: true});
        const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
        try {
            const file: AgentComposerDraftFile = {schemaVersion: DRAFT_FILE_SCHEMA, drafts};
            await writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {encoding: "utf8", flag: "wx"});
            await rename(temporaryPath, this.filePath);
        } finally {
            await rm(temporaryPath, {force: true});
        }
    }
}

/** 严格筛掉过期、超限、不安全和结构损坏的记录。 */
function validDrafts(records: AgentComposerDraftRecord[], now: number): AgentComposerDraftRecord[] {
    return records.filter((record) => typeof record?.scopeKey === "string"
        && (record.scopeKey === "workspace-root" || /^project:[^/\\:]+$/u.test(record.scopeKey))
        && Number.isInteger(record.sessionId)
        && record.sessionId > 0
        && typeof record.text === "string"
        && Number.isFinite(record.updatedAt)
        && record.updatedAt >= 0
        && now - record.updatedAt <= MAX_DRAFT_AGE_MS
        && record.text.length > 0
        && UTF8_ENCODER.encode(record.text).byteLength <= MAX_DRAFT_BYTES
        && !hasUnsafeImageTarget(record.text));
}

function recentDrafts(drafts: AgentComposerDraftRecord[]): AgentComposerDraftRecord[] {
    return drafts.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_DRAFTS);
}

function sameIdentity(left: AgentComposerDraftIdentity, right: AgentComposerDraftIdentity): boolean {
    return left.scopeKey === right.scopeKey && left.sessionId === right.sessionId;
}

function identityKey(identity: AgentComposerDraftIdentity): string {
    return `${identity.scopeKey}:${String(identity.sessionId)}`;
}

function hasUnsafeImageTarget(text: string): boolean {
    return parseAgentImageMarkdown(text).some((part) => part.type === "image"
        && /^(?:data:|blob:)/iu.test(part.target.trim()));
}

/** 同一 Store 文件的进程内 mutation 队列。 */
async function withFileLock<TResult>(path: string, action: () => Promise<TResult>): Promise<TResult> {
    const previous = locks.get(path) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolveLock) => {
        release = resolveLock;
    });
    const tail = previous.then(() => current);
    locks.set(path, tail);
    try {
        await previous;
        return await action();
    } finally {
        release();
        if (locks.get(path) === tail) locks.delete(path);
    }
}
