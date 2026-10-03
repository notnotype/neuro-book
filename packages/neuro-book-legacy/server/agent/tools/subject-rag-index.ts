import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {basename, dirname, join, relative, resolve} from "node:path";
import {appLogger} from "nbook/server/app-logs/logger";
import {loadEffectiveConfigFromTarget} from "nbook/server/config/config-service";
import type {EmbeddingServiceConfig, RuntimeConfigTarget} from "nbook/server/config/types";
import {
    openSqliteVecDatabase,
    type SqliteVecDatabase,
} from "nbook/server/rag/sqlite-vec-database";
import {
    parseSubjectEventsJsonl,
    parseSubjectMemoriesJsonl,
    subjectMemorySourceHash,
    type SubjectEvent,
    type SubjectMemory,
} from "nbook/server/agent/tools/subject-memory";

export type SubjectRagSourceType = "events" | "memory";

export type SubjectPaths = {
    absolutePath: string;
    eventsPath: string;
    memoryPath: string;
    ragStatePath: string;
};

export type SubjectRagCandidate = {
    source: SubjectRagSourceType;
    text: string;
    topic?: string;
    tick?: string;
    time?: string;
    rank: number;
    sourcePath: string;
};

export type SubjectRagConfigTarget = Extract<RuntimeConfigTarget, {scope: "project"}>;

/**
 * RAG embedding 配置来源。Agent 工具传播 invocation 已捕获的 Project config target；
 * Product 数据面可直接注入同 generation 的结构化 Config 快照。
 */
type SubjectRagEmbeddingSource = {
    configTarget: SubjectRagConfigTarget;
    embedding?: never;
} | {
    configTarget?: never;
    embedding: EmbeddingServiceConfig;
};

type RagEmbeddingModel = {
    key: string;
    providerConfigId: string;
    modelId: string;
    baseUrl: string;
    apiKey: string;
    dimensions: number;
    timeoutMs: number | null;
    requestOptions: Record<string, unknown>;
};

type RagChunk = {
    subjectId: string;
    subjectPath: string;
    sourceType: SubjectRagSourceType;
    sourceKey: string;
    chunkIndex: number;
    topic: string | null;
    tick: string | null;
    time: string | null;
    text: string;
    contentHash: string;
};

export const SUBJECT_RAG_SCHEMA_VERSION = "subject-rag-v3";
const MAX_MEMORY_CHUNK_CHARS = 1200;
const MAX_EMBED_BATCH = 32;
const INTERNAL_NORMALIZED_DISTANCE_CUTOFF = 1.15;
const INTERNAL_FETCH_MULTIPLIER = 4;
const INTERNAL_MAX_FETCH_LIMIT = 80;
const subjectRagDirtyWriteQueues = new Map<string, Promise<void>>();

/**
 * 检索当前 subject 的 events / memory RAG 候选。
 */
export async function searchSubjectRag(input: SubjectRagEmbeddingSource & {
    subject: SubjectPaths;
    query: string;
    sources: SubjectRagSourceType[];
    limit: number;
}): Promise<SubjectRagCandidate[]> {
    const embedding = await resolveSubjectRagEmbedding(input);
    const ragDbPath = resolveSubjectRagDbPath(input.subject);
    await mkdir(dirname(ragDbPath), {recursive: true});
    const db = await openSubjectRagDatabase(ragDbPath, embedding.dimensions);
    try {
        await ensureRagMeta(db, embedding);
        await syncSubjectSources(db, input.subject, input.sources, embedding);
        const queryEmbedding = (await embedTexts(embedding, [input.query.trim()]))[0];
        if (!queryEmbedding) {
            throw new Error("embedding provider 未返回查询向量。");
        }
        const fetchLimit = Math.min(Math.max(input.limit * INTERNAL_FETCH_MULTIPLIER, input.limit), INTERNAL_MAX_FETCH_LIMIT);
        const rows = input.sources.flatMap((source) => querySubjectRagSource(db, {
            queryEmbedding,
            subjectPath: input.subject.absolutePath,
            source,
            limit: fetchLimit,
        })).filter((row) => row.distance <= INTERNAL_NORMALIZED_DISTANCE_CUTOFF)
            .sort((left, right) => left.distance - right.distance)
            .slice(0, input.limit);

        return rows.map((row, index) => ({
            source: row.sourceType,
            text: row.text,
            ...(row.topic ? {topic: row.topic} : {}),
            ...(row.tick ? {tick: row.tick} : {}),
            ...(row.time ? {time: row.time} : {}),
            rank: index + 1,
            sourcePath: row.sourcePath,
        }));
    } finally {
        db.close();
    }
}

/**
 * 强制重建当前 subject 的指定 RAG source。JSONL 仍是事实源，SQLite 只做缓存。
 */
export async function rebuildSubjectRag(input: SubjectRagEmbeddingSource & {
    subject: SubjectPaths;
    sources: SubjectRagSourceType[];
}): Promise<void> {
    const embedding = await resolveSubjectRagEmbedding(input);
    const ragDbPath = resolveSubjectRagDbPath(input.subject);
    await mkdir(dirname(ragDbPath), {recursive: true});
    const db = await openSubjectRagDatabase(ragDbPath, embedding.dimensions);
    try {
        await ensureRagMeta(db, embedding);
        await syncSubjectSources(db, input.subject, input.sources, embedding, true);
    } finally {
        db.close();
    }
}

/**
 * 把 subject source 标记为 dirty。dirty state 是可重建辅助状态，维护失败只告警，
 * 不能让已经提交事实源的调用方误判失败后重试。
 */
export async function markSubjectRagDirty(subject: SubjectPaths, sourceType: SubjectRagSourceType, content: string): Promise<void> {
    try {
        await withSubjectRagDirtyWriteLock(subject.ragStatePath, async () => {
            const current = await readSubjectRagDirtyState(subject.ragStatePath);
            current[subject.absolutePath] = {
                ...(current[subject.absolutePath] ?? {}),
                [sourceType]: {
                    dirty: true,
                    sourceHash: subjectMemorySourceHash(content),
                    updatedAt: new Date().toISOString(),
                },
            };
            await writeJsonFile(subject.ragStatePath, current);
        });
    } catch (error) {
        void appLogger.warn("agent.subjectRag.dirtyStateMarkFailed", {
            ragStatePath: subject.ragStatePath,
            subjectPath: subject.absolutePath,
            sourceType,
            error: error instanceof Error ? error.message : String(error),
        }, "subject RAG dirty state 标记失败，事实源已保留并将在后续按 source hash 自愈");
    }
}

async function openSubjectRagDatabase(dbPath: string, dimensions: number): Promise<SqliteVecDatabase> {
    return openSqliteVecDatabase({
        path: dbPath,
        loadExtension: true,
        initialize(db) {
            createSchema(db, dimensions);
        },
    });
}

function createSchema(db: SqliteVecDatabase, dimensions: number): void {
    db.run("PRAGMA foreign_keys = ON");
    db.run(`
        CREATE TABLE IF NOT EXISTS subject_rag_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS subject_rag_sources (
            id INTEGER PRIMARY KEY,
            subject_id TEXT NOT NULL,
            subject_path TEXT NOT NULL,
            source_type TEXT NOT NULL CHECK (source_type IN ('events', 'memory')),
            source_path TEXT NOT NULL,
            source_hash TEXT NOT NULL,
            record_count INTEGER NOT NULL DEFAULT 0,
            dirty INTEGER NOT NULL DEFAULT 1,
            indexed_at TEXT,
            last_error TEXT,
            UNIQUE(subject_path, source_type)
        )
    `);
    db.run(`
        CREATE TABLE IF NOT EXISTS subject_rag_chunks (
            id INTEGER PRIMARY KEY,
            source_id INTEGER NOT NULL REFERENCES subject_rag_sources(id) ON DELETE CASCADE,
            subject_id TEXT NOT NULL,
            subject_path TEXT NOT NULL,
            source_type TEXT NOT NULL CHECK (source_type IN ('events', 'memory')),
            source_path TEXT NOT NULL,
            source_key TEXT NOT NULL,
            chunk_index INTEGER NOT NULL DEFAULT 0,
            topic TEXT,
            tick TEXT,
            time TEXT,
            text TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            embedding_provider TEXT NOT NULL,
            embedding_model TEXT NOT NULL,
            embedding_dimensions INTEGER NOT NULL,
            embedding_indexed_at TEXT NOT NULL,
            UNIQUE(source_id, source_key, chunk_index)
        )
    `);
    db.run("CREATE INDEX IF NOT EXISTS idx_subject_rag_chunks_subject ON subject_rag_chunks(subject_id, source_type)");
    db.run("CREATE INDEX IF NOT EXISTS idx_subject_rag_chunks_topic ON subject_rag_chunks(subject_id, topic)");
    db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS subject_rag_vec USING vec0(
        embedding float[${String(dimensions)}],
        subject_path TEXT partition key,
        source_type TEXT partition key
    )`);
}

function querySubjectRagSource(db: SqliteVecDatabase, input: {
    queryEmbedding: number[];
    subjectPath: string;
    source: SubjectRagSourceType;
    limit: number;
}): Array<{
    sourceType: SubjectRagSourceType;
    text: string;
    topic: string | null;
    tick: string | null;
    time: string | null;
    sourcePath: string;
    distance: number;
}> {
    return db.query(`
        SELECT
            c.source_type AS sourceType,
            c.text,
            c.topic,
            c.tick,
            c.time,
            c.source_path AS sourcePath,
            v.distance AS distance
        FROM subject_rag_vec v
        JOIN subject_rag_chunks c ON c.id = v.rowid
        WHERE v.embedding MATCH ?
          AND k = ?
          AND v.subject_path = ?
          AND v.source_type = ?
        ORDER BY v.distance
        LIMIT ?
    `).all(new Float32Array(input.queryEmbedding), input.limit, input.subjectPath, input.source, input.limit) as Array<{
        sourceType: SubjectRagSourceType;
        text: string;
        topic: string | null;
        tick: string | null;
        time: string | null;
        sourcePath: string;
        distance: number;
    }>;
}

async function ensureRagMeta(db: SqliteVecDatabase, embedding: RagEmbeddingModel): Promise<void> {
    const currentVersion = readMeta(db, "schemaVersion");
    const currentProvider = readMeta(db, "embedding.provider");
    const currentModel = readMeta(db, "embedding.model");
    const currentDimensions = readMeta(db, "embedding.dimensions");
    const currentNormalized = readMeta(db, "embedding.normalized");
    const next = {
        schemaVersion: SUBJECT_RAG_SCHEMA_VERSION,
        provider: embedding.providerConfigId,
        model: embedding.modelId,
        dimensions: String(embedding.dimensions),
    };
    const embeddingChanged = Boolean(currentVersion) && (
        currentProvider !== next.provider
        || currentModel !== next.model
        || currentDimensions !== next.dimensions
    );
    if (embeddingChanged) {
        throw new Error("subject RAG 索引的 embedding provider/model/dimensions 已变化，请删除 .nbook/subject-rag.sqlite 后重建。");
    }
    if (currentVersion && (currentVersion !== next.schemaVersion || currentNormalized !== "true")) {
        resetSubjectRagCache(db, embedding.dimensions);
    }
    writeMeta(db, "schemaVersion", next.schemaVersion);
    writeMeta(db, "embedding.provider", next.provider);
    writeMeta(db, "embedding.model", next.model);
    writeMeta(db, "embedding.dimensions", next.dimensions);
    writeMeta(db, "embedding.normalized", "true");
}

function resetSubjectRagCache(db: SqliteVecDatabase, dimensions: number): void {
    db.run("DROP TABLE IF EXISTS subject_rag_vec");
    db.run("DROP TABLE IF EXISTS subject_rag_chunks");
    db.run("DROP TABLE IF EXISTS subject_rag_sources");
    db.run("DROP TABLE IF EXISTS subject_rag_meta");
    createSchema(db, dimensions);
}

async function syncSubjectSources(
    db: SqliteVecDatabase,
    subject: SubjectPaths,
    sources: SubjectRagSourceType[],
    embedding: RagEmbeddingModel,
    force = false,
): Promise<void> {
    for (const sourceType of sources) {
        await syncSubjectSource(db, subject, sourceType, embedding, force);
    }
}

async function syncSubjectSource(
    db: SqliteVecDatabase,
    subject: SubjectPaths,
    sourceType: SubjectRagSourceType,
    embedding: RagEmbeddingModel,
    force = false,
): Promise<void> {
    const sourcePath = sourceType === "events" ? subject.eventsPath : subject.memoryPath;
    const sourceText = await readTextIfExists(sourcePath);
    const sourceHash = subjectMemorySourceHash(sourceText);
    const subjectId = basename(subject.absolutePath);
    const externalDirty = await readSubjectRagDirty(subject, sourceType, sourceHash);
    const existing = db.query("SELECT id, source_hash AS sourceHash, dirty FROM subject_rag_sources WHERE subject_path = ? AND source_type = ?")
        .get(subject.absolutePath, sourceType) as {id: number; sourceHash: string; dirty: number} | null;
    if (!force && existing && existing.sourceHash === sourceHash && existing.dirty === 0 && !externalDirty) {
        return;
    }

    const chunks = sourceType === "events"
        ? buildEventChunks(parseSubjectEventsJsonl(sourceText, sourcePath), subject, sourceHash)
        : buildMemoryChunks(parseSubjectMemoriesJsonl(sourceText, sourcePath), subject, sourceHash);
    const embeddings = chunks.length > 0 ? await embedTexts(embedding, chunks.map((chunk) => chunk.text)) : [];
    const run = db.transaction(() => {
        const sourceId = upsertSource(db, {
            existingId: existing?.id,
            subjectId,
            subjectPath: subject.absolutePath,
            sourceType,
            sourcePath,
            sourceHash,
            recordCount: chunks.length,
        });
        db.run("DELETE FROM subject_rag_vec WHERE rowid IN (SELECT id FROM subject_rag_chunks WHERE source_id = ?)", sourceId);
        db.run("DELETE FROM subject_rag_chunks WHERE source_id = ?", sourceId);
        const indexedAt = new Date().toISOString();
        chunks.forEach((chunk, index) => {
            const vector = embeddings[index];
            if (!vector) {
                throw new Error(`embedding provider 未返回第 ${String(index + 1)} 个 chunk 向量。`);
            }
            db.run(`
                INSERT INTO subject_rag_chunks (
                    source_id, subject_id, subject_path, source_type, source_path, source_key,
                    chunk_index, topic, tick, time, text, content_hash, created_at,
                    embedding_provider, embedding_model, embedding_dimensions, embedding_indexed_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, sourceId, chunk.subjectId, chunk.subjectPath, chunk.sourceType, resolveSourceRelativePath(subject, chunk.sourceType), chunk.sourceKey, chunk.chunkIndex, chunk.topic, chunk.tick, chunk.time, chunk.text, chunk.contentHash, indexedAt, embedding.providerConfigId, embedding.modelId, embedding.dimensions, indexedAt);
            const row = db.query("SELECT last_insert_rowid() AS id").get() as {id: number};
            db.run(
                "INSERT INTO subject_rag_vec(rowid, embedding, subject_path, source_type) VALUES (?, ?, ?, ?)",
                row.id,
                new Float32Array(vector),
                chunk.subjectPath,
                chunk.sourceType,
            );
        });
        db.run("UPDATE subject_rag_sources SET dirty = 0, indexed_at = ?, last_error = NULL WHERE id = ?", indexedAt, sourceId);
    });
    run();
    if (externalDirty) {
        await clearSubjectRagDirty(subject, sourceType, sourceHash);
    }
}

function upsertSource(db: SqliteVecDatabase, input: {
    existingId?: number;
    subjectId: string;
    subjectPath: string;
    sourceType: SubjectRagSourceType;
    sourcePath: string;
    sourceHash: string;
    recordCount: number;
}): number {
    if (input.existingId) {
        db.run(`
            UPDATE subject_rag_sources
            SET subject_id = ?, source_path = ?, source_hash = ?, record_count = ?, dirty = 1
            WHERE id = ?
        `, input.subjectId, input.sourcePath, input.sourceHash, input.recordCount, input.existingId);
        return input.existingId;
    }
    db.run(`
        INSERT INTO subject_rag_sources (subject_id, subject_path, source_type, source_path, source_hash, record_count, dirty)
        VALUES (?, ?, ?, ?, ?, ?, 1)
    `, input.subjectId, input.subjectPath, input.sourceType, input.sourcePath, input.sourceHash, input.recordCount);
    return (db.query("SELECT last_insert_rowid() AS id").get() as {id: number}).id;
}

function buildEventChunks(events: SubjectEvent[], subject: SubjectPaths, sourceHash: string): RagChunk[] {
    const subjectId = basename(subject.absolutePath);
    return events.map((event, index) => ({
        subjectId,
        subjectPath: subject.absolutePath,
        sourceType: "events",
        sourceKey: `${String(index + 1).padStart(6, "0")}:${subjectMemorySourceHash(JSON.stringify(event)).slice(0, 16)}`,
        chunkIndex: 0,
        topic: null,
        tick: event.tick ?? null,
        time: event.time ?? null,
        text: event.text,
        contentHash: subjectMemorySourceHash(`${sourceHash}:${index}:${event.text}`),
    }));
}

function buildMemoryChunks(memories: SubjectMemory[], subject: SubjectPaths, sourceHash: string): RagChunk[] {
    const subjectId = basename(subject.absolutePath);
    return memories.flatMap((memory) => splitMemoryView(memory.view).map((text, index) => ({
        subjectId,
        subjectPath: subject.absolutePath,
        sourceType: "memory" as const,
        sourceKey: memory.topic,
        chunkIndex: index,
        topic: memory.topic,
        tick: null,
        time: null,
        text: index === 0 ? `${memory.topic}: ${text}` : `${memory.topic} (续): ${text}`,
        contentHash: subjectMemorySourceHash(`${sourceHash}:${memory.topic}:${index}:${text}`),
    })));
}

function splitMemoryView(view: string): string[] {
    const paragraphs = view.split(/\n{2,}/u).map((item) => item.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = "";
    for (const paragraph of paragraphs.length ? paragraphs : [view]) {
        if (!current) {
            current = paragraph;
            continue;
        }
        if (`${current}\n\n${paragraph}`.length <= MAX_MEMORY_CHUNK_CHARS) {
            current = `${current}\n\n${paragraph}`;
        } else {
            chunks.push(current);
            current = paragraph;
        }
    }
    if (current) {
        chunks.push(current);
    }
    return chunks.flatMap(splitLongText);
}

function splitLongText(text: string): string[] {
    if (text.length <= MAX_MEMORY_CHUNK_CHARS) {
        return [text];
    }
    const chunks: string[] = [];
    for (let index = 0; index < text.length; index += MAX_MEMORY_CHUNK_CHARS) {
        chunks.push(text.slice(index, index + MAX_MEMORY_CHUNK_CHARS));
    }
    return chunks;
}

async function resolveSubjectRagEmbedding(source: SubjectRagEmbeddingSource): Promise<RagEmbeddingModel> {
    const embedding = source.embedding ?? (await loadEffectiveConfigFromTarget(source.configTarget)).embedding;
    if (!embedding.enabled) {
        throw new Error("subject_rag_search 尚未启用 embedding 服务，因此不会执行关键词 fallback。请在 Embedding 设置中启用嵌入服务。");
    }
    if (embedding.provider !== "openai-compatible") {
        throw new Error(`subject_rag_search 暂不支持 embedding provider：${embedding.provider}`);
    }
    if (!embedding.model) {
        throw new Error("subject_rag_search 缺少 embedding model。请在 Embedding 设置中配置模型名。");
    }
    if (!embedding.dimensions) {
        throw new Error("subject_rag_search 缺少 embedding dimensions。请在 Embedding 设置中配置嵌入维度。");
    }
    const apiKey = embedding.apiKey.trim();
    if (!apiKey) {
        throw new Error("embedding 服务缺少 API Key。");
    }
    const baseUrl = embedding.baseURL.trim();
    if (!baseUrl) {
        throw new Error("embedding 服务缺少 API Base。");
    }
    return {
        key: `${embedding.provider}/${embedding.model}`,
        providerConfigId: embedding.provider,
        modelId: embedding.model,
        baseUrl,
        apiKey,
        dimensions: embedding.dimensions,
        timeoutMs: embedding.timeoutMs ?? 30_000,
        requestOptions: embeddingRequestOptions(embedding),
    };
}

async function embedTexts(model: RagEmbeddingModel, texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (let index = 0; index < texts.length; index += MAX_EMBED_BATCH) {
        embeddings.push(...await embedTextBatch(model, texts.slice(index, index + MAX_EMBED_BATCH)));
    }
    return embeddings;
}

async function embedTextBatch(model: RagEmbeddingModel, texts: string[]): Promise<number[][]> {
    const controller = model.timeoutMs ? new AbortController() : null;
    const timeout = model.timeoutMs
        ? globalThis.setTimeout(() => controller?.abort(), model.timeoutMs ?? 0)
        : null;
    const url = `${model.baseUrl.replace(/\/+$/u, "")}/embeddings`;
    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${model.apiKey}`,
            },
            signal: controller?.signal,
            body: JSON.stringify({
                model: model.modelId,
                input: texts,
                dimensions: model.dimensions,
                ...model.requestOptions,
            }),
        });
    } catch (error) {
        if (isAbortError(error)) {
            throw new Error(`embedding 请求超时：model=${model.modelId} timeoutMs=${String(model.timeoutMs ?? 0)} url=${url}`);
        }
        throw error;
    } finally {
        if (timeout) {
            globalThis.clearTimeout(timeout);
        }
    }
    if (!response.ok) {
        throw new Error(`embedding 请求失败：HTTP ${String(response.status)} ${sanitizeProviderError(await response.text().catch(() => response.statusText))}`);
    }
    const payload = await response.json() as {data?: Array<{embedding?: unknown}>};
    const vectors = payload.data?.map((item, index) => parseEmbedding(item.embedding, `${model.key}[${String(index)}]`)) ?? [];
    if (vectors.length !== texts.length) {
        throw new Error(`embedding 返回数量异常：expected=${String(texts.length)} actual=${String(vectors.length)}`);
    }
    for (const vector of vectors) {
        if (vector.length !== model.dimensions) {
            throw new Error(`embedding 维度不匹配：expected=${String(model.dimensions)} actual=${String(vector.length)}`);
        }
    }
    return vectors.map((vector, index) => normalizeEmbeddingVector(vector, `${model.key}[${String(index)}]`));
}

function embeddingRequestOptions(config: EmbeddingServiceConfig): Record<string, unknown> {
    const blockedKeys = new Set(["model", "input", "dimensions"]);
    return Object.fromEntries(
        Object.entries(config.requestOptions).filter(([key]) => !blockedKeys.has(key)),
    );
}

function isAbortError(error: unknown): boolean {
    return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function parseEmbedding(value: unknown, label: string): number[] {
    if (!Array.isArray(value)) {
        throw new Error(`${label} embedding 必须是 number[]。`);
    }
    return value.map((item, index) => {
        if (typeof item !== "number" || !Number.isFinite(item)) {
            throw new Error(`${label}.embedding[${String(index)}] 必须是有限 number。`);
        }
        return item;
    });
}

function normalizeEmbeddingVector(vector: number[], label: string): number[] {
    let sumSquares = 0;
    for (const value of vector) {
        sumSquares += value * value;
    }
    const magnitude = Math.sqrt(sumSquares);
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
        throw new Error(`${label} embedding 不能是零向量。`);
    }
    return vector.map((value) => value / magnitude);
}

function readMeta(db: SqliteVecDatabase, key: string): string | null {
    const row = db.query("SELECT value FROM subject_rag_meta WHERE key = ?").get(key) as {value: string} | null;
    return row?.value ?? null;
}

function writeMeta(db: SqliteVecDatabase, key: string, value: string): void {
    db.run("INSERT INTO subject_rag_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, value);
}

function resolveSubjectRagDbPath(subject: SubjectPaths): string {
    return join(dirname(subject.ragStatePath), "subject-rag.sqlite");
}

function resolveSourceRelativePath(subject: SubjectPaths, sourceType: SubjectRagSourceType): string {
    return relative(dirname(subject.ragStatePath), sourceType === "events" ? subject.eventsPath : subject.memoryPath).replaceAll("\\", "/");
}

async function readTextIfExists(filePath: string): Promise<string> {
    try {
        return await readFile(filePath, "utf-8");
    } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
            return "";
        }
        throw error;
    }
}

async function readSubjectRagDirty(subject: SubjectPaths, sourceType: SubjectRagSourceType, currentHash: string): Promise<boolean> {
    const state = await readSubjectRagDirtyState(subject.ragStatePath);
    const sourceState = state[subject.absolutePath]?.[sourceType];
    if (!sourceState || typeof sourceState !== "object" || Array.isArray(sourceState)) {
        return false;
    }
    const record = sourceState as Record<string, unknown>;
    return record.dirty === true && (typeof record.sourceHash !== "string" || record.sourceHash === currentHash);
}

/**
 * 清理已经完成索引的精确 source hash；若并发 mark 已写入更新 hash，则保留新 dirty 标记。
 */
export async function clearSubjectRagDirty(
    subject: SubjectPaths,
    sourceType: SubjectRagSourceType,
    indexedSourceHash: string,
): Promise<void> {
    try {
        await withSubjectRagDirtyWriteLock(subject.ragStatePath, async () => {
            const state = await readSubjectRagDirtyState(subject.ragStatePath);
            const subjectState = state[subject.absolutePath];
            const sourceState = subjectState?.[sourceType];
            if (!sourceState || typeof sourceState !== "object" || Array.isArray(sourceState)) {
                return;
            }
            const sourceHash = (sourceState as Record<string, unknown>).sourceHash;
            if (sourceHash !== indexedSourceHash) {
                return;
            }
            delete subjectState[sourceType];
            if (Object.keys(subjectState).length === 0) {
                delete state[subject.absolutePath];
            }
            await writeJsonFile(subject.ragStatePath, state);
        });
    } catch (error) {
        void appLogger.warn("agent.subjectRag.dirtyStateClearFailed", {
            ragStatePath: subject.ragStatePath,
            subjectPath: subject.absolutePath,
            sourceType,
            error: error instanceof Error ? error.message : String(error),
        }, "subject RAG dirty state 清理失败，保留标记供后续重建");
    }
}

async function readSubjectRagDirtyState(filePath: string): Promise<Record<string, Record<string, unknown>>> {
    try {
        const currentText = await readFile(filePath, "utf-8");
        if (!currentText.trim()) {
            return {};
        }
        const parsed = JSON.parse(currentText) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            return parsed as Record<string, Record<string, unknown>>;
        }
        void appLogger.warn("agent.subjectRag.dirtyStateInvalid", {ragStatePath: filePath}, "subject RAG dirty state 顶层结构损坏，按空的可重建状态处理");
        return {};
    } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") {
            return {};
        }
        void appLogger.warn("agent.subjectRag.dirtyStateReadFailed", {
            ragStatePath: filePath,
            error: error instanceof Error ? error.message : String(error),
        }, "subject RAG dirty state 不可读取，按空的可重建状态处理");
        return {};
    }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const directory = dirname(filePath);
    const temporaryPath = join(
        directory,
        `.${basename(filePath)}.${String(process.pid)}.${randomUUID()}.tmp`,
    );
    await mkdir(directory, {recursive: true});
    try {
        await writeFile(temporaryPath, text, {encoding: "utf-8", flag: "wx"});
        await rename(temporaryPath, filePath);
    } finally {
        await rm(temporaryPath, {force: true}).catch(() => undefined);
    }
}

/** 同一个 dirty state 文件的完整读改写按调用顺序串行，且失败不会污染后续队列。 */
async function withSubjectRagDirtyWriteLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
    const lockKey = resolve(filePath);
    const previous = subjectRagDirtyWriteQueues.get(lockKey) ?? Promise.resolve();
    let release: () => void = () => {};
    const current = new Promise<void>((resolvePromise) => {
        release = resolvePromise;
    });
    const queued = previous.catch(() => undefined).then(() => current);
    subjectRagDirtyWriteQueues.set(lockKey, queued);

    await previous.catch(() => undefined);
    try {
        return await action();
    } finally {
        release();
        if (subjectRagDirtyWriteQueues.get(lockKey) === queued) {
            subjectRagDirtyWriteQueues.delete(lockKey);
        }
    }
}

function sanitizeProviderError(message: string): string {
    const normalized = message
        .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
        .replace(/sk-[A-Za-z0-9._-]{8,}/giu, "sk-[redacted]")
        .trim();
    return normalized.length > 320 ? `${normalized.slice(0, 320)}...` : normalized;
}
