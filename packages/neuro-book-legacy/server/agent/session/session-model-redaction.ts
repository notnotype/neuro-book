import {randomUUID} from "node:crypto";
import {mkdir, open, readFile, readdir, rename, rm} from "node:fs/promises";
import {basename, dirname, join} from "node:path";
import type {Api} from "@earendil-works/pi-ai";
import type {Model} from "nbook/server/agent/messages/types";

/** JSONL中允许持久化的模型选择身份。 */
export type DurableSessionModelRef = {
    providerConfigId: string;
    modelId: string;
};

export type SessionModelRedactionResult = {
    changed: boolean;
    modelChanges: number;
    /** 本次发现、需要清理或已经清理的敏感临时副本。 */
    artifacts: string[];
    /** 非dry-run时实际删除的敏感临时副本。 */
    removedArtifacts: string[];
    usedMappings: string[];
};

/** 人工确认的一条Session entry模型映射。 */
export type SessionModelEntryMapping = DurableSessionModelRef;

/** key固定为`<sessionId>:<entryId>`，禁止按Provider名称或model ID猜测。 */
export type SessionModelEntryMappings = Readonly<Record<string, SessionModelEntryMapping>>;

/** 将运行时模型投影为可迁移的持久化身份。 */
export function toDurableSessionModelRef(model: Model<Api> | null): DurableSessionModelRef | null {
    if (model === null) return null;
    const record = model as unknown as Record<string, unknown>;
    const providerConfigId = readNonEmptyString(record.providerConfigId);
    const modelId = readNonEmptyString(record.id);
    if (!providerConfigId || !modelId) {
        throw new Error("Session model缺少明确的providerConfigId或modelId，拒绝从Pi Provider身份猜测。");
    }
    return {providerConfigId, modelId};
}

/** 严格解析JSONL中已经脱敏的模型引用；旧完整Model不作为runtime fallback。 */
export function parseDurableSessionModelRef(value: unknown): DurableSessionModelRef | null {
    if (value === null) return null;
    if (!isRecord(value)) throw new Error("Session model引用不是对象。");
    const providerConfigId = readNonEmptyString(value.providerConfigId);
    const modelId = readNonEmptyString(value.modelId);
    if (!providerConfigId || !modelId || Object.keys(value).some((key) => key !== "providerConfigId" && key !== "modelId")) {
        throw new Error("Session model引用必须只包含providerConfigId和modelId。");
    }
    return {providerConfigId, modelId};
}

/**
 * 原子迁移单个Session JSONL中的model_change。
 *
 * 已明确providerConfigId的完整Model可直接脱敏；其他旧Model必须由sessionId + entryId
 * mapping证明。任一entry失败时不替换源文件，也不留下包含旧Model的backup。
 */
export async function migrateSessionJsonlModels(
    filePath: string,
    mappings: SessionModelEntryMappings = {},
    options: {dryRun?: boolean} = {},
): Promise<SessionModelRedactionResult> {
    const artifacts = await inspectSessionRedactionArtifacts(filePath);
    const removedArtifacts = options.dryRun ? [] : await cleanupSessionRedactionArtifacts(filePath, artifacts);
    const original = await readFile(filePath, "utf8");
    const parsed = parseJsonl(original);
    const sessionId = sessionIdentity(parsed.map((item) => item.record));
    let changed = false;
    let modelChanges = 0;
    const usedMappings = new Set<string>();
    const output = parsed.map((item) => {
        const record = redactSessionRecord(item.record, sessionId, mappings, usedMappings, () => {
            modelChanges += 1;
        });
        const text = JSON.stringify(record);
        changed = changed || text !== JSON.stringify(item.record);
        return `${text}${item.newline}`;
    }).join("");

    if (!changed) return {changed: false, modelChanges, artifacts, removedArtifacts, usedMappings: [...usedMappings]};
    if (options.dryRun) return {changed: true, modelChanges, artifacts, removedArtifacts, usedMappings: [...usedMappings]};

    const temporaryPath = `${filePath}.${randomUUID()}.redaction.tmp`;
    await mkdir(dirname(filePath), {recursive: true});
    const temporaryFile = await open(temporaryPath, "wx");
    try {
        await temporaryFile.writeFile(output, "utf8");
        await temporaryFile.sync();
    } finally {
        await temporaryFile.close();
    }
    try {
        await rename(temporaryPath, filePath);
    } catch (error) {
        await rm(temporaryPath, {force: true});
        throw new Error(`Session model脱敏迁移失败（${filePath}）：${error instanceof Error ? error.message : String(error)}`);
    }
    return {changed: true, modelChanges, artifacts, removedArtifacts, usedMappings: [...usedMappings]};
}

/** 清理旧实现中断后留下、可能包含完整模型信息的临时副本，并返回被删除文件名。 */
export async function cleanupSessionRedactionArtifacts(filePath: string, knownArtifacts?: string[]): Promise<string[]> {
    const names = knownArtifacts ?? await inspectSessionRedactionArtifacts(filePath);
    const directory = dirname(filePath);
    await Promise.all(names.map((name) => rm(join(directory, name), {force: true})));
    return names;
}

/** 只读列出旧实现可能遗留的敏感临时副本。 */
export async function inspectSessionRedactionArtifacts(filePath: string): Promise<string[]> {
    const directory = dirname(filePath);
    const prefix = `${basename(filePath)}.`;
    return (await readdir(directory).catch(() => []))
        .filter((name) => name.startsWith(prefix) && (name.endsWith(".redaction.tmp") || name.endsWith(".redaction.bak")));
}

function parseJsonl(source: string): Array<{record: unknown; newline: string}> {
    const lines = source.split(/(\r?\n)/u);
    const result: Array<{record: unknown; newline: string}> = [];
    for (let index = 0; index < lines.length; index += 2) {
        const line = lines[index] ?? "";
        const newline = lines[index + 1] ?? "";
        if (!line) continue;
        try {
            result.push({record: JSON.parse(line) as unknown, newline});
        } catch (error) {
            throw new Error(`Session JSONL第${String(index / 2 + 1)}行不是有效JSON：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return result;
}

function sessionIdentity(records: unknown[]): string {
    for (const record of records) {
        if (!isRecord(record) || record.kind !== "header" || !isRecord(record.metadata)) continue;
        const sessionId = readIdentity(record.metadata.sessionId);
        if (sessionId) return sessionId;
    }
    throw new Error("Session JSONL缺少可验证的header.metadata.sessionId。");
}

function redactSessionRecord(
    record: unknown,
    sessionId: string,
    mappings: SessionModelEntryMappings,
    usedMappings: Set<string>,
    onModelChange: () => void,
): unknown {
    if (!isRecord(record)) throw new Error("Session JSONL record必须是对象。");
    if (record.kind === "entry") return {...record, entry: redactSessionEntry(record.entry, sessionId, mappings, usedMappings, onModelChange)};
    if (record.kind === "batch") {
        if (!Array.isArray(record.entries)) throw new Error("Session JSONL batch.entries必须是数组。");
        return {...record, entries: record.entries.map((entry) => redactSessionEntry(entry, sessionId, mappings, usedMappings, onModelChange))};
    }
    if (record.kind === "header") return record;
    throw new Error("Session JSONL record.kind不受支持。");
}

function redactSessionEntry(
    entry: unknown,
    sessionId: string,
    mappings: SessionModelEntryMappings,
    usedMappings: Set<string>,
    onModelChange: () => void,
): unknown {
    if (!isRecord(entry) || entry.type !== "model_change") return entry;
    const entryId = readIdentity(entry.id);
    const model = parseLegacyOrDurableModel(entry.model, sessionId, entryId, mappings, usedMappings);
    onModelChange();
    return {...entry, model};
}

function parseLegacyOrDurableModel(
    value: unknown,
    sessionId: string,
    entryId: string | null,
    mappings: SessionModelEntryMappings,
    usedMappings: Set<string>,
): DurableSessionModelRef | null {
    if (value === null) return null;
    if (isRecord(value) && Object.hasOwn(value, "providerConfigId") && Object.hasOwn(value, "modelId")) {
        return parseDurableSessionModelRef(value);
    }
    if (!isRecord(value)) throw new Error("旧Session model不是可识别的Pi Model对象。");
    const explicitProviderConfigId = readNonEmptyString(value.providerConfigId);
    const modelId = readNonEmptyString(value.modelId) ?? readNonEmptyString(value.id);
    if (!modelId) throw new Error("旧Session model缺少model ID，拒绝猜测身份。");
    if (explicitProviderConfigId) return {providerConfigId: explicitProviderConfigId, modelId};
    if (!entryId) throw new Error(`Session ${sessionId}的旧model_change缺少entryId，无法应用显式映射。`);
    const key = `${sessionId}:${entryId}`;
    const mapping = mappings[key];
    if (!mapping) throw new Error(`旧Session model缺少可证明的Provider Config ID；请显式映射${key}。`);
    const mapped = parseDurableSessionModelRef(mapping);
    if (!mapped || mapped.modelId !== modelId) {
        throw new Error(`Session model映射${key}的modelId与原entry不一致：${mapping.modelId} / ${modelId}`);
    }
    usedMappings.add(key);
    return mapped;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readIdentity(value: unknown): string | null {
    if (typeof value === "number" && Number.isInteger(value)) return String(value);
    return readNonEmptyString(value);
}
