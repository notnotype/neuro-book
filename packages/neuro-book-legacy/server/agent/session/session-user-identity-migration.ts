import {createHash, randomUUID} from "node:crypto";
import {mkdir, open, readFile, rename, rm} from "node:fs/promises";
import {dirname} from "node:path";
import {AGENT_FOLLOW_UP_QUEUE_STATE_KEY} from "nbook/server/agent/session/custom-state-keys";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const USER_STEER_PREFIX = "<user_steer>\n";
const USER_STEER_SUFFIX = "\n</user_steer>";

type JsonObject = Record<string, unknown>;

/** 一次性迁移结果；runtime 只消费迁移后的严格合同。 */
export type SessionUserIdentityMigrationResult = {
    changed: boolean;
    userEntries: number;
    queueItems: number;
};

export type SessionUserIdentityTextMigrationResult = SessionUserIdentityMigrationResult & {
    text: string;
};

/**
 * 原子补齐 durable user entry / follow-up queue 的 clientMessageId 与显式 intent。
 *
 * 旧 steer envelope 只在本迁移文件中识别；迁移完成后 runtime 不再通过正文猜测意图。
 */
export async function migrateSessionUserIdentities(filePath: string): Promise<SessionUserIdentityMigrationResult> {
    const original = await readFile(filePath, "utf8");
    const {text, ...result} = migrateSessionUserIdentityText(original);
    if (!result.changed) {
        return result;
    }

    const temporaryPath = `${filePath}.${randomUUID()}.user-identity.tmp`;
    await mkdir(dirname(filePath), {recursive: true});
    const temporaryFile = await open(temporaryPath, "wx");
    try {
        await temporaryFile.writeFile(text, "utf8");
        await temporaryFile.sync();
    } finally {
        await temporaryFile.close();
    }
    try {
        await rename(temporaryPath, filePath);
    } catch (error) {
        await rm(temporaryPath, {force: true});
        throw new Error(`Session 用户身份迁移失败（${filePath}）：${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
}

/** 纯内存迁移入口，供更早的 Attachment hard-cut migration 组合并一次发布。 */
export function migrateSessionUserIdentityText(original: string): SessionUserIdentityTextMigrationResult {
    const parsed = parseJsonl(original);
    const sessionId = sessionIdentity(parsed.map((item) => item.record));
    let changed = false;
    let userEntries = 0;
    let queueItems = 0;

    const output = parsed.map((item) => {
        const migrated = migrateRecord(item.record, sessionId);
        changed ||= migrated.changed;
        userEntries += migrated.userEntries;
        queueItems += migrated.queueItems;
        return `${JSON.stringify(migrated.record)}${item.newline}`;
    }).join("");

    return {text: output, changed, userEntries, queueItems};
}

function migrateRecord(record: unknown, sessionId: string): {
    record: unknown;
    changed: boolean;
    userEntries: number;
    queueItems: number;
} {
    if (!isObject(record)) {
        throw new Error("Session JSONL record 必须是对象。");
    }
    if (record.kind === "header") {
        return {record, changed: false, userEntries: 0, queueItems: 0};
    }
    if (record.kind === "entry") {
        const migrated = migrateEntry(record.entry, sessionId);
        return {
            record: migrated.changed ? {...record, entry: migrated.entry} : record,
            changed: migrated.changed,
            userEntries: migrated.userEntries,
            queueItems: migrated.queueItems,
        };
    }
    if (record.kind === "batch") {
        if (!Array.isArray(record.entries)) {
            throw new Error("Session JSONL batch.entries 必须是数组。");
        }
        let changed = false;
        let userEntries = 0;
        let queueItems = 0;
        const entries = record.entries.map((entry) => {
            const migrated = migrateEntry(entry, sessionId);
            changed ||= migrated.changed;
            userEntries += migrated.userEntries;
            queueItems += migrated.queueItems;
            return migrated.entry;
        });
        return {
            record: changed ? {...record, entries} : record,
            changed,
            userEntries,
            queueItems,
        };
    }
    throw new Error("Session JSONL record.kind 不受支持。");
}

function migrateEntry(entryValue: unknown, sessionId: string): {
    entry: unknown;
    changed: boolean;
    userEntries: number;
    queueItems: number;
} {
    if (!isObject(entryValue)) {
        throw new Error("Session entry 必须是对象。");
    }
    let entry = entryValue;
    let changed = false;
    let userEntries = 0;
    let queueItems = 0;

    if (entry.type === "message" && isObject(entry.message) && entry.message.role === "user") {
        const entryId = identity(entry.id, "用户 entry 缺少 id");
        const content = migrateUserContent(entry.message.content);
        const intent = migrateIntent(entry.intent, content);
        const clientMessageId = migrateClientMessageId(
            entry.clientMessageId,
            `session:${sessionId}:entry:${entryId}`,
            "用户 entry clientMessageId 非法",
        );
        const message = content === entry.message.content
            ? entry.message
            : {...entry.message, content};
        const next = {
            ...entry,
            message,
            clientMessageId,
            intent,
        };
        changed = JSON.stringify(next) !== JSON.stringify(entry);
        entry = next;
        userEntries = 1;
    }

    if (entry.type === "custom" && entry.key === AGENT_FOLLOW_UP_QUEUE_STATE_KEY) {
        const migrated = migrateQueue(entry.value, sessionId);
        if (migrated.changed) {
            entry = {...entry, value: migrated.value};
            changed = true;
        }
        queueItems += migrated.queueItems;
    }

    return {entry, changed, userEntries, queueItems};
}

function migrateQueue(value: unknown, sessionId: string): {value: unknown; changed: boolean; queueItems: number} {
    if (!isObject(value) || !Array.isArray(value.items)) {
        return {value, changed: false, queueItems: 0};
    }
    let changed = false;
    const items = value.items.map((itemValue) => {
        if (!isObject(itemValue)) {
            return itemValue;
        }
        const itemId = identity(itemValue.id, "follow-up queue item 缺少 id");
        const clientMessageId = migrateClientMessageId(
            itemValue.clientMessageId,
            `session:${sessionId}:queue:${itemId}`,
            "follow-up queue clientMessageId 非法",
        );
        const message = migrateQueuedMessage(itemValue.message);
        const item = {
            ...itemValue,
            clientMessageId,
            ...(message === undefined ? {} : {message}),
        };
        changed ||= JSON.stringify(item) !== JSON.stringify(itemValue);
        return item;
    });
    return {
        value: changed ? {...value, items} : value,
        changed,
        queueItems: items.length,
    };
}

/** attachment-v1 迁移后的旧 queue 形态只在这里转成有序 content。 */
function migrateQueuedMessage(value: unknown): unknown {
    if (value === undefined || !isObject(value) || Array.isArray(value.content)) {
        return value;
    }
    if (typeof value.text !== "string") {
        return value;
    }
    if (Array.isArray(value.images) && value.images.length > 0) {
        // raw image 必须先由 attachment-v1 migration 处理；本迁移不复制兼容 decoder。
        return value;
    }
    const attachments = Array.isArray(value.attachments) ? value.attachments : [];
    return {
        content: [
            ...(value.text ? [{type: "text", text: value.text}] : []),
            ...attachments,
        ],
    };
}

function migrateUserContent(value: unknown): unknown {
    if (typeof value === "string") {
        return [{type: "text", text: value}];
    }
    return value;
}

function migrateIntent(value: unknown, content: unknown): "normal" | "steer" {
    if (value === "normal" || value === "steer") {
        return value;
    }
    if (value !== undefined) {
        throw new Error("用户 entry intent 非法。");
    }
    return hasLegacySteerEnvelope(content) ? "steer" : "normal";
}

function hasLegacySteerEnvelope(content: unknown): boolean {
    if (typeof content === "string") {
        return content.startsWith(USER_STEER_PREFIX) && content.endsWith(USER_STEER_SUFFIX);
    }
    if (!Array.isArray(content) || content.length === 0) {
        return false;
    }
    const first = content[0];
    const last = content.at(-1);
    return isObject(first)
        && first.type === "text"
        && typeof first.text === "string"
        && first.text.startsWith(USER_STEER_PREFIX)
        && isObject(last)
        && last.type === "text"
        && typeof last.text === "string"
        && last.text.endsWith(USER_STEER_SUFFIX);
}

function migrateClientMessageId(value: unknown, seed: string, invalidMessage: string): string {
    if (value === undefined) {
        return deterministicUuid(seed);
    }
    if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
        throw new Error(invalidMessage);
    }
    return value;
}

function deterministicUuid(seed: string): string {
    const bytes = Buffer.from(createHash("sha256").update(`neurobook:client-message:${seed}`, "utf8").digest().subarray(0, 16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x50;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = bytes.toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseJsonl(source: string): Array<{record: unknown; newline: string}> {
    const lines = source.split(/(\r?\n)/u);
    const result: Array<{record: unknown; newline: string}> = [];
    for (let index = 0; index < lines.length; index += 2) {
        const line = lines[index] ?? "";
        const newline = lines[index + 1] ?? "";
        if (!line) {
            continue;
        }
        try {
            result.push({record: JSON.parse(line) as unknown, newline});
        } catch (error) {
            throw new Error(`Session JSONL 第${String(index / 2 + 1)}行不是有效 JSON：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return result;
}

function sessionIdentity(records: readonly unknown[]): string {
    for (const record of records) {
        if (!isObject(record) || record.kind !== "header" || !isObject(record.metadata)) {
            continue;
        }
        if (typeof record.metadata.sessionId === "number" && Number.isSafeInteger(record.metadata.sessionId)) {
            return String(record.metadata.sessionId);
        }
    }
    throw new Error("Session JSONL 缺少可验证的 header.metadata.sessionId。");
}

function identity(value: unknown, message: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new Error(message);
    }
    return value;
}

function isObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
