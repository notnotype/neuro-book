import {readFileSync, statSync} from "node:fs";
import {readFile, readdir, rm, stat, writeFile} from "node:fs/promises";
import {basename, isAbsolute, join, relative, resolve} from "node:path";
import {createError} from "h3";
import {loadEffectiveConfigFromTarget} from "nbook/server/config/config-service";
import type {EffectiveConfig} from "nbook/server/config/types";
import {
    parseSubjectEvent,
    parseSubjectEventsJsonl,
    parseSubjectMemoriesJsonl,
    parseSubjectMemory,
    serializeSubjectEventsJsonl,
    serializeSubjectMemoriesJsonl,
    subjectMemorySourceHash,
    type SubjectEvent,
    type SubjectMemory,
} from "nbook/server/agent/tools/subject-memory";
import {
    markSubjectRagDirty,
    rebuildSubjectRag,
    searchSubjectRag,
    SUBJECT_RAG_SCHEMA_VERSION,
    type SubjectPaths,
    type SubjectRagSourceType,
} from "nbook/server/agent/tools/subject-rag-index";
import {parseMarkdownDocument} from "nbook/server/workspace-files/workspace-files";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import {
    openSqliteVecDatabase,
    type SqliteVecDatabase,
} from "nbook/server/rag/sqlite-vec-database";
import {collectReleasedSqliteHandles} from "nbook/server/workspace-files/sqlite-handle-release";
import {
    captureUserProjectFileWrite,
    recordUserProjectFileWrite,
    type UserProjectFileWriteCapture,
} from "nbook/server/workspace-history/user-file-recorder";
import type {
    ProjectRagEventDeleteRequestDto,
    ProjectRagEventReorderRequestDto,
    ProjectRagEventWriteRequestDto,
    ProjectRagDebugRequestDto,
    ProjectRagDebugResultDto,
    ProjectRagIndexStatusDto,
    ProjectRagInspectorDto,
    ProjectRagInspectorRequestDto,
    ProjectRagMemoryDeleteRequestDto,
    ProjectRagMemoryWriteRequestDto,
    ProjectRagOverviewDto,
    ProjectRagRebuildRequestDto,
    ProjectRagRebuildResultDto,
    ProjectRagSearchRequestDto,
    ProjectRagSearchResultDto,
    ProjectRagSourceStatusDto,
    ProjectRagSubjectDto,
    ProjectRagSubjectSummaryDto,
} from "nbook/shared/dto/project-rag.dto";

type SourceError = {
    source: SubjectRagSourceType;
    message: string;
};

/** HTTP 字符串 seam 完成一次生命周期解析后，RAG 数据面唯一接受的结构化目标。 */
export type ProjectRagTarget = Readonly<{
    workspaceRoot: AbsoluteFsPath;
    project: ReadyProjectSessionRef;
}>;

type ProjectRagWorkspace = Readonly<{
    projectRoot: string;
    root: AbsoluteFsPath;
}>;

const RAG_SOURCES: SubjectRagSourceType[] = ["events", "memory"];
const INSPECTOR_VECTOR_PREVIEW_DIMENSIONS = 8;
const DEFAULT_INSPECTOR_LIMIT = 200;

/**
 * 读取当前 Project 的 RAG subject 概览。
 */
export async function readProjectRagOverview(target: ProjectRagTarget): Promise<ProjectRagOverviewDto> {
    const project = projectWorkspace(target);
    const subjects = await listSubjectPaths(project.root);
    const summaries = await Promise.all(subjects.map((subjectPath) => readSubjectSummary(project, subjectPath)));
    return {
        projectRoot: project.projectRoot,
        subjects: summaries,
    };
}

/**
 * 读取单个 subject 的 events / memory 展示数据。
 */
export async function readProjectRagSubject(target: ProjectRagTarget, subjectPathInput: string): Promise<ProjectRagSubjectDto> {
    const project = projectWorkspace(target);
    const subject = resolveSubject(project, subjectPathInput);
    const [eventsResult, memoriesResult, sourceStatuses] = await Promise.all([
        readEvents(subject.paths.eventsPath),
        readMemories(subject.paths.memoryPath),
        readSourceStatuses(project.root, subject.paths),
    ]);
    return {
        projectRoot: project.projectRoot,
        subjectPath: subject.subjectPath,
        subjectId: subject.subjectId,
        events: eventsResult.events.map((event, index) => ({
            line: index + 1,
            ...event,
        })),
        memories: memoriesResult.memories.map((memory, index) => ({
            line: index + 1,
            ...memory,
        })),
        sourceStatuses,
        errors: [...eventsResult.errors, ...memoriesResult.errors],
    };
}

/**
 * 在当前 subject 上执行真实 RAG 搜索。
 */
export async function searchProjectSubjectRag(target: ProjectRagTarget, input: ProjectRagSearchRequestDto): Promise<ProjectRagSearchResultDto> {
    const project = projectWorkspace(target);
    const subject = resolveSubject(project, input.subjectPath);
    const config = await loadProjectRagConfig(target);
    ensureSubjectSourcesReadable(subject.paths, input.sources?.length ? input.sources : RAG_SOURCES);
    const candidates = await searchSubjectRag({
        embedding: config.embedding,
        subject: subject.paths,
        query: input.query,
        sources: input.sources?.length ? input.sources : RAG_SOURCES,
        limit: input.limit ?? 10,
    });
    return {
        projectRoot: project.projectRoot,
        subjectPath: subject.subjectPath,
        candidates,
    };
}

/**
 * 重建当前 subject 或当前 Project 的 RAG 索引。
 */
export async function rebuildProjectSubjectRag(target: ProjectRagTarget, input: ProjectRagRebuildRequestDto): Promise<ProjectRagRebuildResultDto> {
    const project = projectWorkspace(target);
    const config = await loadProjectRagConfig(target);
    const subjectPaths = input.subjectPath ? [input.subjectPath] : await listSubjectPaths(project.root);
    const results: ProjectRagRebuildResultDto["results"] = [];
    let rebuiltSubjects = 0;
    let skippedSubjects = 0;
    for (const subjectPath of subjectPaths) {
        try {
            const subject = resolveSubject(project, subjectPath);
            ensureSubjectSourcesReadable(subject.paths, RAG_SOURCES);
            await rebuildSubjectRag({
                embedding: config.embedding,
                subject: subject.paths,
                sources: RAG_SOURCES,
            });
            rebuiltSubjects += 1;
            results.push({subjectPath: subject.subjectPath, ok: true, message: null});
        } catch (error) {
            skippedSubjects += 1;
            results.push({
                subjectPath,
                ok: false,
                message: errorMessage(error),
            });
        }
    }
    return {
        projectRoot: project.projectRoot,
        rebuiltSubjects,
        skippedSubjects,
        results,
    };
}

/**
 * 读取 Project RAG Inspector 所需的索引、chunk 和向量预览信息。
 */
export async function readProjectRagInspector(target: ProjectRagTarget, input: ProjectRagInspectorRequestDto): Promise<ProjectRagInspectorDto> {
    const project = projectWorkspace(target);
    const sourceFilter = input.sources?.length ? uniqueSources(input.sources) : RAG_SOURCES;
    const limit = input.limit ?? DEFAULT_INSPECTOR_LIMIT;
    const subjects = await Promise.all((await listSubjectPaths(project.root)).map((subjectPath) => readSubjectSummary(project, subjectPath)));
    const selectedSubjectPath = resolveInspectorSubjectPath(subjects, input.subjectPath);
    const embedding = await readEmbeddingSnapshot(target);
    const dbPath = resolveRagDbPath(project.root);
    const dbExists = await fileExists(dbPath);
    const dbSnapshot = dbExists
        ? await readInspectorDbSnapshot(dbPath, selectedSubjectPath ? resolveSubject(project, selectedSubjectPath) : null, sourceFilter, limit)
        : createEmptyInspectorDbSnapshot();
    return {
        projectRoot: project.projectRoot,
        selectedSubjectPath,
        sourceFilter,
        limit,
        embedding,
        index: {
            ...dbSnapshot.index,
            dbExists,
            metaMatchesEffectiveConfig: resolveMetaMatchesEffectiveConfig(dbSnapshot.index, embedding),
        },
        subjects,
        selectedSubject: selectedSubjectPath
            ? {
                subjectPath: selectedSubjectPath,
                subjectId: basename(selectedSubjectPath),
                sourceStatuses: subjects.find((subject) => subject.subjectPath === selectedSubjectPath)?.sourceStatuses ?? [],
                chunkSourceCounts: dbSnapshot.chunkSourceCounts,
                chunks: dbSnapshot.chunks,
                chunksTruncated: dbSnapshot.chunksTruncated,
            }
            : null,
    };
}

/**
 * 执行 RAG Inspector 的调试操作。只影响可重建缓存或 dirty state。
 */
export async function debugProjectRag(target: ProjectRagTarget, input: ProjectRagDebugRequestDto): Promise<ProjectRagDebugResultDto> {
    const project = projectWorkspace(target);
    if (input.action === "mark-dirty") {
        const subjectPaths = input.subjectPath ? [input.subjectPath] : await listSubjectPaths(project.root);
        const sources = input.sources?.length ? uniqueSources(input.sources) : RAG_SOURCES;
        for (const subjectPath of subjectPaths) {
            const subject = resolveSubject(project, subjectPath);
            for (const source of sources) {
                await markSubjectRagDirty(subject.paths, source, readTextSync(source === "events" ? subject.paths.eventsPath : subject.paths.memoryPath));
            }
        }
        return {
            projectRoot: project.projectRoot,
            action: input.action,
            message: `已标记 ${String(subjectPaths.length)} 个 subject 的 ${sources.join(", ")} 待索引。`,
        };
    }

    if (input.action === "delete-subject-index") {
        const subject = resolveSubject(project, input.subjectPath);
        const deleted = await deleteSubjectIndexRows(resolveRagDbPath(project.root), subject.paths.absolutePath);
        return {
            projectRoot: project.projectRoot,
            action: input.action,
            message: `已删除 ${subject.subjectId} 的 ${String(deleted)} 条索引缓存行。`,
        };
    }

    if (input.action === "clear-index-cache") {
        await clearRagIndexCache(project.root);
        return {
            projectRoot: project.projectRoot,
            action: input.action,
            message: "已清空 RAG SQLite 缓存。索引不会自动恢复，请手动重建或执行搜索触发重建。",
        };
    }

    await clearRagIndexCache(project.root);
    const rebuild = await rebuildProjectSubjectRag(target, {subjectPath: input.subjectPath});
    return {
        projectRoot: project.projectRoot,
        action: input.action,
        message: "已清空 RAG SQLite 缓存并执行重建。",
        rebuild,
    };
}

/**
 * 新增一条 subject event。
 */
export async function createProjectRagEvent(target: ProjectRagTarget, input: ProjectRagEventWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {subject} = resolveProjectSubject(target, input.subjectPath);
    const next = parseSubjectEvent(input.event, "event");
    const capture = captureSubjectWrite(target, subject, "events");
    await mutateEvents(subject.paths, capture, (events) => {
        events.push(next);
    });
    return readProjectRagSubject(target, subject.subjectPath);
}

/**
 * 修改一条 subject event。
 */
export async function updateProjectRagEvent(target: ProjectRagTarget, input: ProjectRagEventWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {subject} = resolveProjectSubject(target, input.subjectPath);
    const index = requireIndex(input.index, "index");
    const next = parseSubjectEvent(input.event, "event");
    const capture = captureSubjectWrite(target, subject, "events");
    await mutateEvents(subject.paths, capture, (events) => {
        assertArrayIndex(events, index, "event");
        events[index] = next;
    });
    return readProjectRagSubject(target, subject.subjectPath);
}

/**
 * 删除一条 subject event。
 */
export async function deleteProjectRagEvent(target: ProjectRagTarget, input: ProjectRagEventDeleteRequestDto): Promise<ProjectRagSubjectDto> {
    const {subject} = resolveProjectSubject(target, input.subjectPath);
    const capture = captureSubjectWrite(target, subject, "events");
    await mutateEvents(subject.paths, capture, (events) => {
        assertArrayIndex(events, input.index, "event");
        events.splice(input.index, 1);
    });
    return readProjectRagSubject(target, subject.subjectPath);
}

/**
 * 重排一条 subject event。
 */
export async function reorderProjectRagEvent(target: ProjectRagTarget, input: ProjectRagEventReorderRequestDto): Promise<ProjectRagSubjectDto> {
    const {subject} = resolveProjectSubject(target, input.subjectPath);
    const capture = captureSubjectWrite(target, subject, "events");
    await mutateEvents(subject.paths, capture, (events) => {
        assertArrayIndex(events, input.fromIndex, "event");
        assertArrayIndex(events, input.toIndex, "event");
        const [event] = events.splice(input.fromIndex, 1);
        if (event) {
            events.splice(input.toIndex, 0, event);
        }
    });
    return readProjectRagSubject(target, subject.subjectPath);
}

/**
 * 新增一条 subject memory。
 */
export async function createProjectRagMemory(target: ProjectRagTarget, input: ProjectRagMemoryWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {subject} = resolveProjectSubject(target, input.subjectPath);
    const next = parseSubjectMemory(input.memory, "memory");
    const capture = captureSubjectWrite(target, subject, "memory");
    await mutateMemories(subject.paths, capture, (memories) => {
        if (memories.some((memory) => memory.topic === next.topic)) {
            throwConflict(`memory topic 已存在：${next.topic}`);
        }
        memories.push(next);
    });
    return readProjectRagSubject(target, subject.subjectPath);
}

/**
 * 修改一条 subject memory。旧 topic 用于定位，memory.topic 可用于改名。
 */
export async function updateProjectRagMemory(target: ProjectRagTarget, input: ProjectRagMemoryWriteRequestDto): Promise<ProjectRagSubjectDto> {
    const {subject} = resolveProjectSubject(target, input.subjectPath);
    const topic = input.topic?.trim();
    if (!topic) {
        throwBadRequest("topic 不能为空");
    }
    const next = parseSubjectMemory(input.memory, "memory");
    const capture = captureSubjectWrite(target, subject, "memory");
    await mutateMemories(subject.paths, capture, (memories) => {
        const index = memories.findIndex((memory) => memory.topic === topic);
        if (index < 0) {
            throwConflict(`memory topic 不存在：${topic}`);
        }
        if (next.topic !== topic && memories.some((memory) => memory.topic === next.topic)) {
            throwConflict(`memory topic 已存在：${next.topic}`);
        }
        memories[index] = next;
    });
    return readProjectRagSubject(target, subject.subjectPath);
}

/**
 * 删除一条 subject memory。
 */
export async function deleteProjectRagMemory(target: ProjectRagTarget, input: ProjectRagMemoryDeleteRequestDto): Promise<ProjectRagSubjectDto> {
    const {subject} = resolveProjectSubject(target, input.subjectPath);
    const capture = captureSubjectWrite(target, subject, "memory");
    await mutateMemories(subject.paths, capture, (memories) => {
        const index = memories.findIndex((memory) => memory.topic === input.topic);
        if (index < 0) {
            throwConflict(`memory topic 不存在：${input.topic}`);
        }
        memories.splice(index, 1);
    });
    return readProjectRagSubject(target, subject.subjectPath);
}

function resolveProjectSubject(target: ProjectRagTarget, subjectPathInput: string): {
    project: ProjectRagWorkspace;
    subject: ReturnType<typeof resolveSubject>;
} {
    const project = projectWorkspace(target);
    return {
        project,
        subject: resolveSubject(project, subjectPathInput),
    };
}

async function readEmbeddingSnapshot(target: ProjectRagTarget): Promise<ProjectRagInspectorDto["embedding"]> {
    const config = await loadProjectRagConfig(target);
    const embedding = config.embedding;
    return {
        enabled: embedding.enabled,
        provider: embedding.provider,
        model: embedding.model,
        dimensions: embedding.dimensions,
        baseURLConfigured: Boolean(embedding.baseURL.trim()),
        baseURLLabel: sanitizeBaseUrlLabel(embedding.baseURL),
        apiKeyConfigured: Boolean(embedding.apiKey.trim()),
    };
}

function sanitizeBaseUrlLabel(value: string): string | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    try {
        const parsed = new URL(trimmed);
        return parsed.origin;
    } catch {
        return trimmed.replace(/[?#].*$/u, "").replace(/\/+$/u, "") || null;
    }
}

function resolveInspectorSubjectPath(subjects: ProjectRagSubjectSummaryDto[], subjectPath: string | undefined): string | null {
    if (subjectPath && subjects.some((subject) => subject.subjectPath === subjectPath)) {
        return subjectPath;
    }
    return subjects.find((subject) => subject.errors.length === 0)?.subjectPath ?? subjects[0]?.subjectPath ?? null;
}

function uniqueSources(sources: SubjectRagSourceType[]): SubjectRagSourceType[] {
    return RAG_SOURCES.filter((source) => sources.includes(source));
}

/** 从 HTTP seam 已捕获的 Project generation 投影单段 root 与物理根。 */
function projectWorkspace(target: ProjectRagTarget): ProjectRagWorkspace {
    return Object.freeze({
        projectRoot: target.project.workspace.ref.projectRoot,
        root: target.project.workspace.root,
    });
}

/** 使用同 generation 的结构化 Project Config target 读取有效配置。 */
function loadProjectRagConfig(target: ProjectRagTarget): Promise<EffectiveConfig> {
    return loadEffectiveConfigFromTarget({
        scope: "project",
        workspaceRoot: target.workspaceRoot,
        project: target.project,
    });
}

function resolveSubject(project: ProjectRagWorkspace, subjectPathInput: string): {
    subjectPath: string;
    subjectId: string;
    paths: SubjectPaths;
} {
    const subjectPath = normalizeSubjectPath(subjectPathInput);
    const absolutePath = resolve(project.root, subjectPath);
    const relativePath = relative(project.root, absolutePath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        throwBadRequest("subjectPath 越界");
    }
    assertSubjectDirectoryExists(absolutePath);
    const subjectId = basename(subjectPath);
    return {
        subjectPath,
        subjectId,
        paths: {
            absolutePath,
            eventsPath: join(absolutePath, "events.jsonl"),
            memoryPath: join(absolutePath, "memory.jsonl"),
            ragStatePath: join(project.root, ".nbook", "subject-rag-dirty.json"),
        },
    };
}

/** 在源文件落盘前捕获同 generation 的用户记账与索引资源。 */
function captureSubjectWrite(
    target: ProjectRagTarget,
    subject: ReturnType<typeof resolveSubject>,
    source: SubjectRagSourceType,
): UserProjectFileWriteCapture {
    return captureUserProjectFileWrite(
        target.project,
        `${subject.subjectPath}/${source === "events" ? "events.jsonl" : "memory.jsonl"}`,
    );
}

function normalizeSubjectPath(value: string): string {
    const normalized = value.trim().replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== "simulation" || parts[1] !== "subjects" || !parts[2]) {
        throwBadRequest("subjectPath 必须形如 simulation/subjects/<subject-id>");
    }
    if (parts.some((part) => part === "." || part === "..")) {
        throwBadRequest("subjectPath 不能包含 . 或 ..");
    }
    return parts.join("/");
}

function resolveRagDbPath(projectRoot: string): string {
    return join(projectRoot, ".nbook", "subject-rag.sqlite");
}

function assertSubjectDirectoryExists(absolutePath: string): void {
    try {
        if (!statSync(absolutePath).isDirectory()) {
            throwNotFound("subject 不存在");
        }
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            throwNotFound("subject 不存在");
        }
        throw error;
    }
}

async function listSubjectPaths(projectRoot: string): Promise<string[]> {
    const subjectsRoot = join(projectRoot, "simulation", "subjects");
    const entries = await readdir(subjectsRoot, {withFileTypes: true}).catch((error) => {
        if (isNodeError(error, "ENOENT")) {
            return [];
        }
        throw error;
    });
    return entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => `simulation/subjects/${entry.name}`)
        .sort((left, right) => left.localeCompare(right));
}

async function readSubjectSummary(project: ProjectRagWorkspace, subjectPath: string): Promise<ProjectRagSubjectSummaryDto> {
    const subject = resolveSubject(project, subjectPath);
    const [eventsResult, memoriesResult, sourceStatuses, subjectFileText, soulFileExists, mindFileExists, stateFileExists] = await Promise.all([
        readEvents(subject.paths.eventsPath),
        readMemories(subject.paths.memoryPath),
        readSourceStatuses(project.root, subject.paths),
        readTextIfExists(join(subject.paths.absolutePath, "subject.md")),
        fileExists(join(subject.paths.absolutePath, "soul.md")),
        fileExists(join(subject.paths.absolutePath, "mind.md")),
        fileExists(join(subject.paths.absolutePath, "state.md")),
    ]);
    const metadata = readSubjectMetadata(subjectFileText);
    return {
        subjectPath: subject.subjectPath,
        subjectId: subject.subjectId,
        metadata,
        eventCount: eventsResult.events.length,
        memoryCount: memoriesResult.memories.length,
        subjectFileExists: subjectFileText.length > 0,
        soulFileExists,
        mindFileExists,
        stateFileExists,
        sourceStatuses,
        errors: [...eventsResult.errors, ...memoriesResult.errors],
    };
}

function readSubjectMetadata(subjectFileText: string): ProjectRagSubjectSummaryDto["metadata"] {
    if (!subjectFileText) {
        return emptySubjectMetadata(null);
    }
    const parsed = parseMarkdownDocument(subjectFileText);
    return {
        id: stringFrontmatterValue(parsed.frontmatter.id),
        name: stringFrontmatterValue(parsed.frontmatter.name),
        kind: stringFrontmatterValue(parsed.frontmatter.kind),
        profile: stringFrontmatterValue(parsed.frontmatter.profile),
        controlledBy: stringFrontmatterValue(parsed.frontmatter.controlledBy),
        canonicalSource: stringFrontmatterValue(parsed.frontmatter.canonicalSource),
        frontmatterError: parsed.error,
    };
}

function emptySubjectMetadata(frontmatterError: string | null): ProjectRagSubjectSummaryDto["metadata"] {
    return {
        id: null,
        name: null,
        kind: null,
        profile: null,
        controlledBy: null,
        canonicalSource: null,
        frontmatterError,
    };
}

function stringFrontmatterValue(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readEvents(filePath: string): Promise<{events: SubjectEvent[]; errors: SourceError[]}> {
    const text = await readTextIfExists(filePath);
    try {
        return {
            events: parseSubjectEventsJsonl(text, filePath),
            errors: [],
        };
    } catch (error) {
        return {
            events: [],
            errors: [{source: "events", message: errorMessage(error)}],
        };
    }
}

async function readMemories(filePath: string): Promise<{memories: SubjectMemory[]; errors: SourceError[]}> {
    const text = await readTextIfExists(filePath);
    try {
        return {
            memories: parseSubjectMemoriesJsonl(text, filePath),
            errors: [],
        };
    } catch (error) {
        return {
            memories: [],
            errors: [{source: "memory", message: errorMessage(error)}],
        };
    }
}

function readEventsForWrite(filePath: string): {before: Uint8Array | null; events: SubjectEvent[]} {
    const source = readSourceForWrite(filePath);
    try {
        return {
            before: source.before,
            events: parseSubjectEventsJsonl(source.text, filePath),
        };
    } catch (error) {
        throwConflict(`events.jsonl 无效，请先修复源文件：${errorMessage(error)}`);
    }
}

function readMemoriesForWrite(filePath: string): {before: Uint8Array | null; memories: SubjectMemory[]} {
    const source = readSourceForWrite(filePath);
    try {
        return {
            before: source.before,
            memories: parseSubjectMemoriesJsonl(source.text, filePath),
        };
    } catch (error) {
        throwConflict(`memory.jsonl 无效，请先修复源文件：${errorMessage(error)}`);
    }
}

/** 同一次读盘同时提供解析文本与 History before 快照。 */
function readSourceForWrite(filePath: string): {before: Uint8Array | null; text: string} {
    try {
        const before = readFileSync(filePath);
        return {before, text: before.toString("utf-8")};
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return {before: null, text: ""};
        }
        throw error;
    }
}

function ensureSubjectSourcesReadable(subject: SubjectPaths, sources: SubjectRagSourceType[]): void {
    for (const source of sources) {
        if (source === "events") {
            readEventsForWrite(subject.eventsPath);
        } else {
            readMemoriesForWrite(subject.memoryPath);
        }
    }
}

async function mutateEvents(
    subject: SubjectPaths,
    capture: UserProjectFileWriteCapture,
    operation: (events: SubjectEvent[]) => void,
): Promise<void> {
    await capture.fileIndex.mutate(async () => {
        const {before, events} = readEventsForWrite(subject.eventsPath);
        operation(events);
        const text = serializeSubjectEventsJsonl(events);
        const nextText = text ? `${text}\n` : "";
        await writeFile(subject.eventsPath, nextText, "utf-8");
        await recordUserProjectFileWrite({capture, before, after: nextText});
        await markSubjectRagDirty(subject, "events", nextText);
    });
}

async function mutateMemories(
    subject: SubjectPaths,
    capture: UserProjectFileWriteCapture,
    operation: (memories: SubjectMemory[]) => void,
): Promise<void> {
    await capture.fileIndex.mutate(async () => {
        const {before, memories} = readMemoriesForWrite(subject.memoryPath);
        operation(memories);
        const text = serializeSubjectMemoriesJsonl(memories);
        const nextText = text ? `${text}\n` : "";
        await writeFile(subject.memoryPath, nextText, "utf-8");
        await recordUserProjectFileWrite({capture, before, after: nextText});
        await markSubjectRagDirty(subject, "memory", nextText);
    });
}

async function readSourceStatuses(projectRoot: string, subject: SubjectPaths): Promise<ProjectRagSourceStatusDto[]> {
    const dbPath = resolveRagDbPath(projectRoot);
    const rows = await readRagSourceRows(dbPath, subject.absolutePath);
    const dirtyState = await readDirtyState(subject.ragStatePath);
    return RAG_SOURCES.map((source) => {
        const row = rows.find((item) => item.sourceType === source);
        const dirty = dirtyState[subject.absolutePath]?.[source];
        const sourcePath = source === "events" ? subject.eventsPath : subject.memoryPath;
        const sourceHash = subjectMemorySourceHash(readTextSync(sourcePath));
        const dirtyHashMatches = isDirtyRecord(dirty) && (typeof dirty.sourceHash !== "string" || dirty.sourceHash === sourceHash);
        const sourceChanged = Boolean(row && row.sourceHash !== sourceHash);
        const status = resolveIndexStatus(row, dirtyHashMatches || sourceChanged);
        return {
            source,
            status,
            recordCount: row?.recordCount ?? 0,
            indexedAt: row?.indexedAt ?? null,
            lastError: row?.lastError ?? null,
        };
    });
}

function createEmptyInspectorDbSnapshot(): {
    index: Omit<ProjectRagInspectorDto["index"], "dbExists" | "metaMatchesEffectiveConfig">;
    chunkSourceCounts: NonNullable<ProjectRagInspectorDto["selectedSubject"]>["chunkSourceCounts"];
    chunks: NonNullable<ProjectRagInspectorDto["selectedSubject"]>["chunks"];
    chunksTruncated: boolean;
} {
    return {
        index: {
            schemaVersion: null,
            embeddingProvider: null,
            embeddingModel: null,
            embeddingDimensions: null,
            readError: null,
            sourceCount: 0,
            chunkCount: 0,
            vectorCount: 0,
        },
        chunkSourceCounts: {events: 0, memory: 0},
        chunks: [],
        chunksTruncated: false,
    };
}

async function readInspectorDbSnapshot(
    dbPath: string,
    subject: ReturnType<typeof resolveSubject> | null,
    sources: SubjectRagSourceType[],
    limit: 100 | 200 | 500,
): Promise<ReturnType<typeof createEmptyInspectorDbSnapshot>> {
    let db: SqliteVecDatabase | null = null;
    try {
        db = await openProjectRagSqliteDatabase(dbPath, {readonly: true, loadVec: true});
        const index = {
            schemaVersion: readMetaValue(db, "schemaVersion"),
            embeddingProvider: readMetaValue(db, "embedding.provider"),
            embeddingModel: readMetaValue(db, "embedding.model"),
            embeddingDimensions: toPositiveIntegerOrNull(readMetaValue(db, "embedding.dimensions")),
            sourceCount: readCount(db, "SELECT COUNT(*) AS count FROM subject_rag_sources"),
            chunkCount: readCount(db, "SELECT COUNT(*) AS count FROM subject_rag_chunks"),
            vectorCount: readCount(db, "SELECT COUNT(*) AS count FROM subject_rag_vec"),
            readError: null,
        };
        if (!subject) {
            return {
                index,
                chunkSourceCounts: {events: 0, memory: 0},
                chunks: [],
                chunksTruncated: false,
            };
        }
        const chunkSourceCounts = safeReadInspectorChunkSourceCounts(db, subject.paths.absolutePath);
        const rows = safeReadInspectorChunkRows(db, subject.paths.absolutePath, sources, limit + 1);
        return {
            index,
            chunkSourceCounts,
            chunks: rows.slice(0, limit).map((row) => toInspectorChunk(row)),
            chunksTruncated: rows.length > limit,
        };
    } catch (error) {
        const snapshot = createEmptyInspectorDbSnapshot();
        return {
            ...snapshot,
            index: {
                ...snapshot.index,
                readError: errorMessage(error),
            },
        };
    } finally {
        db?.close();
    }
}

function safeReadInspectorChunkSourceCounts(
    db: SqliteVecDatabase,
    subjectPath: string,
): NonNullable<ProjectRagInspectorDto["selectedSubject"]>["chunkSourceCounts"] {
    try {
        const rows = db.query(`
            SELECT source_type AS source, COUNT(*) AS count
            FROM subject_rag_chunks
            WHERE subject_path = ?
            GROUP BY source_type
        `).all(subjectPath) as Array<{source: SubjectRagSourceType; count: number | bigint}>;
        return rows.reduce<NonNullable<ProjectRagInspectorDto["selectedSubject"]>["chunkSourceCounts"]>((counts, row) => ({
            ...counts,
            [row.source]: Number(row.count),
        }), {events: 0, memory: 0});
    } catch {
        return {events: 0, memory: 0};
    }
}

function safeReadInspectorChunkRows(
    db: SqliteVecDatabase,
    subjectPath: string,
    sources: SubjectRagSourceType[],
    limit: number,
): InspectorChunkRow[] {
    try {
        return readInspectorChunkRows(db, subjectPath, sources, limit, readSubjectRagChunkColumns(db));
    } catch {
        return [];
    }
}

function readMetaValue(db: SqliteVecDatabase, key: string): string | null {
    const row = db.query("SELECT value FROM subject_rag_meta WHERE key = ?").get(key) as {value: string} | null;
    return row?.value ?? null;
}

function readCount(db: SqliteVecDatabase, sql: string): number {
    const row = db.query(sql).get() as {count: number | bigint} | null;
    return Number(row?.count ?? 0);
}

type InspectorChunkRow = {
    id: number;
    source: SubjectRagSourceType;
    sourcePath: string;
    sourceKey: string;
    chunkIndex: number;
    topic: string | null;
    tick: string | null;
    time: string | null;
    text: string;
    contentHash: string;
    createdAt: string;
    embeddingProvider: string | null;
    embeddingModel: string | null;
    embeddingDimensions: number | null;
    embeddingIndexedAt: string | null;
    vectorJson: string | null;
};

type SubjectRagChunkColumns = {
    embeddingProvider: boolean;
    embeddingModel: boolean;
    embeddingDimensions: boolean;
    embeddingIndexedAt: boolean;
};

function readSubjectRagChunkColumns(db: SqliteVecDatabase): SubjectRagChunkColumns {
    const rows = db.query("PRAGMA table_info(subject_rag_chunks)").all() as Array<{name: string}>;
    const names = new Set(rows.map((row) => row.name));
    return {
        embeddingProvider: names.has("embedding_provider"),
        embeddingModel: names.has("embedding_model"),
        embeddingDimensions: names.has("embedding_dimensions"),
        embeddingIndexedAt: names.has("embedding_indexed_at"),
    };
}

function readInspectorChunkRows(
    db: SqliteVecDatabase,
    subjectPath: string,
    sources: SubjectRagSourceType[],
    limit: number,
    columns: SubjectRagChunkColumns,
): InspectorChunkRow[] {
    const placeholders = sources.map(() => "?").join(", ");
    return db.query(`
        SELECT
            c.id,
            c.source_type AS source,
            c.source_path AS sourcePath,
            c.source_key AS sourceKey,
            c.chunk_index AS chunkIndex,
            c.topic,
            c.tick,
            c.time,
            c.text,
            c.content_hash AS contentHash,
            c.created_at AS createdAt,
            ${columns.embeddingProvider ? "c.embedding_provider" : "NULL"} AS embeddingProvider,
            ${columns.embeddingModel ? "c.embedding_model" : "NULL"} AS embeddingModel,
            ${columns.embeddingDimensions ? "c.embedding_dimensions" : "NULL"} AS embeddingDimensions,
            ${columns.embeddingIndexedAt ? "c.embedding_indexed_at" : "NULL"} AS embeddingIndexedAt,
            vec_to_json(v.embedding) AS vectorJson
        FROM subject_rag_chunks c
        LEFT JOIN subject_rag_vec v ON v.rowid = c.id
        WHERE c.subject_path = ?
          AND c.source_type IN (${placeholders})
        ORDER BY c.source_type, c.source_key, c.chunk_index, c.id
        LIMIT ?
    `).all(subjectPath, ...sources, limit) as InspectorChunkRow[];
}

function toInspectorChunk(row: InspectorChunkRow): NonNullable<ProjectRagInspectorDto["selectedSubject"]>["chunks"][number] {
    const vector = parseVectorPreview(row.vectorJson);
    return {
        id: Number(row.id),
        source: row.source,
        sourcePath: row.sourcePath,
        sourceKey: row.sourceKey,
        chunkIndex: Number(row.chunkIndex),
        topic: row.topic,
        tick: row.tick,
        time: row.time,
        text: row.text,
        contentHash: row.contentHash,
        createdAt: row.createdAt,
        vector: {
            exists: Boolean(row.vectorJson),
            dimensions: vector.dimensions,
            preview: vector.preview,
            previewDimensions: vector.preview.length,
            embeddingProvider: row.embeddingProvider,
            embeddingModel: row.embeddingModel,
            embeddingDimensions: row.embeddingDimensions === null ? null : Number(row.embeddingDimensions),
            embeddingIndexedAt: row.embeddingIndexedAt,
        },
    };
}

function parseVectorPreview(value: string | null): {dimensions: number | null; preview: number[]} {
    if (!value) {
        return {dimensions: null, preview: []};
    }
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!Array.isArray(parsed)) {
            return {dimensions: null, preview: []};
        }
        const numbers = parsed.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
        return {
            dimensions: numbers.length,
            preview: numbers.slice(0, INSPECTOR_VECTOR_PREVIEW_DIMENSIONS),
        };
    } catch {
        return {dimensions: null, preview: []};
    }
}

function resolveMetaMatchesEffectiveConfig(
    index: Omit<ProjectRagInspectorDto["index"], "dbExists" | "metaMatchesEffectiveConfig">,
    embedding: ProjectRagInspectorDto["embedding"],
): boolean | null {
    if (!index.schemaVersion || !index.embeddingProvider || !index.embeddingModel || !index.embeddingDimensions) {
        return null;
    }
    if (!embedding.enabled || !embedding.model || !embedding.dimensions) {
        return false;
    }
    return index.schemaVersion === SUBJECT_RAG_SCHEMA_VERSION
        && index.embeddingProvider === embedding.provider
        && index.embeddingModel === embedding.model
        && index.embeddingDimensions === embedding.dimensions;
}

function toPositiveIntegerOrNull(value: string | null): number | null {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function readRagSourceRows(dbPath: string, subjectPath: string): Promise<Array<{
    sourceType: SubjectRagSourceType;
    sourceHash: string;
    recordCount: number;
    dirty: number;
    indexedAt: string | null;
    lastError: string | null;
}>> {
    try {
        await stat(dbPath);
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return [];
        }
        throw error;
    }
    const db = await openProjectRagSqliteDatabase(dbPath, {readonly: true, loadVec: false});
    try {
        return db.query(`
            SELECT
                source_type AS sourceType,
                source_hash AS sourceHash,
                record_count AS recordCount,
                dirty,
                indexed_at AS indexedAt,
                last_error AS lastError
            FROM subject_rag_sources
            WHERE subject_path = ?
        `).all(subjectPath) as Array<{
            sourceType: SubjectRagSourceType;
            sourceHash: string;
            recordCount: number;
            dirty: number;
            indexedAt: string | null;
            lastError: string | null;
        }>;
    } catch {
        return [];
    } finally {
        db.close();
    }
}

async function deleteSubjectIndexRows(dbPath: string, subjectPath: string): Promise<number> {
    if (!await fileExists(dbPath)) {
        return 0;
    }
    const db = await openProjectRagSqliteDatabase(dbPath, {readonly: false, loadVec: true});
    try {
        const sourceRows = db.query("SELECT id FROM subject_rag_sources WHERE subject_path = ?").all(subjectPath) as Array<{id: number}>;
        for (const row of sourceRows) {
            db.run("DELETE FROM subject_rag_vec WHERE rowid IN (SELECT id FROM subject_rag_chunks WHERE source_id = ?)", row.id);
            db.run("DELETE FROM subject_rag_chunks WHERE source_id = ?", row.id);
            db.run("DELETE FROM subject_rag_sources WHERE id = ?", row.id);
        }
        return sourceRows.length;
    } finally {
        db.close();
    }
}

async function clearRagIndexCache(projectRoot: string): Promise<void> {
    const dbPath = resolveRagDbPath(projectRoot);
    // Windows libsql statement finalizer 晚于 close；删除边界只重试句柄占用错误。
    for (let attempt = 0; attempt < 20; attempt += 1) {
        collectReleasedSqliteHandles({force: true});
        try {
            await Promise.all([
                rm(dbPath, {force: true}),
                rm(`${dbPath}-wal`, {force: true}),
                rm(`${dbPath}-shm`, {force: true}),
            ]);
            return;
        } catch (error) {
            const retryable = error instanceof Error
                && "code" in error
                && (error.code === "EBUSY" || error.code === "EPERM");
            if (!retryable || attempt === 19) throw error;
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
    }
}

async function openProjectRagSqliteDatabase(dbPath: string, options: {readonly: boolean; loadVec: boolean}): Promise<SqliteVecDatabase> {
    return openSqliteVecDatabase({
        path: dbPath,
        readonly: options.readonly,
        loadExtension: options.loadVec,
    });
}

function resolveIndexStatus(row: Awaited<ReturnType<typeof readRagSourceRows>>[number] | undefined, dirty: boolean): ProjectRagIndexStatusDto {
    if (row?.lastError) {
        return "error";
    }
    if (dirty || row?.dirty === 1) {
        return "dirty";
    }
    if (row?.indexedAt) {
        return "synced";
    }
    if (row) {
        return "not_indexed";
    }
    return "unknown";
}

async function readDirtyState(filePath: string): Promise<Record<string, Record<string, unknown>>> {
    const text = await readTextIfExists(filePath);
    if (!text.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(text) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, Record<string, unknown>>
            : {};
    } catch {
        return {};
    }
}

function isDirtyRecord(value: unknown): value is {dirty?: unknown; sourceHash?: unknown} {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as {dirty?: unknown}).dirty === true);
}

function readTextSync(filePath: string): string {
    try {
        return readFileSync(filePath, "utf-8");
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return "";
        }
        throw error;
    }
}

async function readTextIfExists(filePath: string): Promise<string> {
    try {
        return await readFile(filePath, "utf-8");
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return "";
        }
        throw error;
    }
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        return (await stat(filePath)).isFile();
    } catch (error) {
        if (isNodeError(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

function requireIndex(value: number | undefined, label: string): number {
    if (value === undefined) {
        throwBadRequest(`${label} 不能为空`);
    }
    return value;
}

function assertArrayIndex(values: unknown[], index: number, label: string): void {
    if (index < 0 || index >= values.length) {
        throwConflict(`${label} index 不存在，请刷新后重试`);
    }
}

function throwBadRequest(message: string): never {
    throw createError({statusCode: 400, message});
}

function throwConflict(message: string): never {
    throw createError({statusCode: 409, message});
}

function throwNotFound(message: string): never {
    throw createError({statusCode: 404, message});
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): boolean {
    return Boolean(typeof error === "object" && error !== null && "code" in error && error.code === code);
}
