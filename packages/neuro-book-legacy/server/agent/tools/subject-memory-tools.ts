import {mkdir, readFile, writeFile} from "node:fs/promises";
import {isAbsolute, join} from "node:path";
import {Type} from "typebox";
import type {Static} from "typebox";
import {
    authorizeFileOperation,
    type AuthorizedFileOperation,
    type ResolvedFileTarget,
} from "nbook/server/workspace-files/authorized-file-operation";
import {captureAgentWorkspaceWrite, recordAgentWorkspaceWrite} from "nbook/server/workspace-history/agent-file-recorder";
import type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
import type {NeuroAgentTool, ToolExecutionContext} from "nbook/server/agent/tools/types";
import {normalizeToolResultDetails} from "nbook/server/agent/messages/message-utils";
import {
    applySubjectMemoryPatch,
    parseSubjectMemory,
    parseSubjectEvent,
    parseSubjectEventsJsonl,
    parseSubjectMemoriesJsonl,
    serializeSubjectEventsJsonl,
    serializeSubjectMemoriesJsonl,
    type JsonPatchOperation,
    type SubjectEvent,
    type SubjectMemory,
} from "nbook/server/agent/tools/subject-memory";
import {
    markSubjectRagDirty,
    searchSubjectRag,
    type SubjectRagCandidate,
    type SubjectRagConfigTarget,
} from "nbook/server/agent/tools/subject-rag-index";

const SubjectEventAppendSchema = Type.Object({
    subjectPath: Type.String({description: "Subject directory path, relative to the current Project Workspace, e.g. simulation/subjects/erina."}),
    events: Type.Array(Type.Object({
        tick: Type.Optional(Type.String({description: "Optional system tick."})),
        time: Type.Optional(Type.String({description: "Optional story time the subject can understand."})),
        text: Type.String({description: "Self-contained subject-facing event text."}),
    }, {additionalProperties: false}), {minItems: 1}),
}, {additionalProperties: false});

const SubjectRagSearchSchema = Type.Object({
    subjectPath: Type.String({description: "Subject directory path, relative to the current Project Workspace, e.g. simulation/subjects/erina."}),
    query: Type.String({description: "Current actor-facing query or packet summary."}),
    sources: Type.Array(Type.Union([Type.Literal("events"), Type.Literal("memory")]), {minItems: 1, maxItems: 1, description: "Explicit single source filter. Callers must choose exactly one of events or memory; there is no implicit both-source default."}),
    limit: Type.Optional(Type.Integer({minimum: 1, maximum: 20, description: "Maximum text results to return. Defaults to 6 for events and 4 for memory."})),
}, {additionalProperties: false});

const SubjectMemoryUpdateSchema = Type.Object({
    subjectPath: Type.String({description: "Subject directory path, relative to the current Project Workspace, e.g. simulation/subjects/erina."}),
    facts: Type.Array(Type.String({description: "Subject-facing fact from this turn. Do not describe concrete file operations."}), {minItems: 1, description: "Subject-facing facts from this turn. Do not describe concrete file operations."}),
}, {additionalProperties: false});

type SubjectEventAppendInput = Static<typeof SubjectEventAppendSchema>;
type SubjectRagSearchInput = Static<typeof SubjectRagSearchSchema>;
type SubjectMemoryUpdateInput = Static<typeof SubjectMemoryUpdateSchema>;

type SubjectSourceType = "events" | "memory";

/**
 * 构造 subject memory / RAG 第一版内置工具。
 */
export function createSubjectMemoryTools(): NeuroAgentTool[] {
    return [
        createSubjectEventAppendTool(),
        createSubjectRagSearchTool(),
        createSubjectMemoryUpdateTool(),
    ];
}
function createSubjectEventAppendTool(): NeuroAgentTool {
    return {
        key: "subject_event_append",
        name: "subject_event_append",
        label: "Append Subject Events",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: "Append validated subject-facing events to simulation/subjects/{id}/events.jsonl and mark the subject RAG event source dirty.",
        parameters: SubjectEventAppendSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as SubjectEventAppendInput;
            const project = requireSubjectProject(context);
            const subject = await resolveSubjectPaths(context, project, input.subjectPath, {events: "write", ragState: "write"});
            const historyCapture = requireSubjectWriteCapture(subject.eventsTarget, project);
            const events = input.events.map((event, index) => parseSubjectEvent(event, `events[${index}]`));
            await historyCapture.fileIndex.mutate(async () => {
                await mkdir(subject.absolutePath, {recursive: true});
                const existing = await readTextIfExists(subject.eventsPath);
                const appended = appendJsonl(existing, serializeSubjectEventsJsonl(events));
                await writeFile(subject.eventsPath, appended, "utf-8");
                await recordAgentWorkspaceWrite({
                    sessionId: context.sessionId,
                    capture: historyCapture,
                    before: existing || null,
                    after: appended,
                });
                await markSubjectRagDirty(subject, "events", appended);
            });
            return {
                content: [{type: "text", text: `已追加 ${events.length} 条 subject event。`}],
                details: normalizeToolResultDetails({
                    subjectPath: input.subjectPath,
                    sourcePath: join(input.subjectPath, "events.jsonl").replaceAll("\\", "/"),
                    appended: events.length,
                    dirty: true,
                }),
            };
        },
        async execute() {
            throw new Error("subject_event_append 必须在 agent session workspace 内执行。");
        },
    };
}

function createSubjectRagSearchTool(): NeuroAgentTool {
    return {
        key: "subject_rag_search",
        name: "subject_rag_search",
        label: "Search Subject RAG",
        executionMode: "parallel",
        description: "Search one selected current-subject RAG source. First implementation requires configured embedding model and fails explicitly when it is missing.",
        parameters: SubjectRagSearchSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as SubjectRagSearchInput;
            const sources = normalizeSearchSources(input.sources);
            const project = requireSubjectProject(context);
            const configTarget = subjectRagConfigTarget(context, project);
            const subject = await resolveSubjectPaths(context, project, input.subjectPath, {
                events: sources[0] === "events" ? "read" : undefined,
                memory: sources[0] === "memory" ? "read" : undefined,
                ragState: "write",
            });
            await ensureSubjectJsonlReadable(subject, sources);
            const candidates = await searchSubjectRag({
                configTarget,
                subject,
                query: input.query,
                sources,
                limit: input.limit ?? defaultSearchLimit(sources[0]),
            });
            return {
                content: [{type: "text", text: renderSubjectRagCandidates(candidates)}],
                details: normalizeToolResultDetails({
                    subjectPath: input.subjectPath,
                    source: sources[0],
                    count: candidates.length,
                }),
            };
        },
        async execute() {
            throw new Error("subject_rag_search 必须在 agent session workspace 内执行。");
        },
    };
}

/** 复用 invocation admission 捕获的 exact Project generation。 */
function requireSubjectProject(context: ToolExecutionContext): ReadyProjectSessionRef {
    const project = context.currentProject;
    if (!project) {
        throw new Error("subject工具只允许在当前Project Workspace中运行。");
    }
    return project;
}

/** 使用调用入口捕获的 exact Project 构造 RAG 配置目标。 */
function subjectRagConfigTarget(
    context: ToolExecutionContext,
    project: ReadyProjectSessionRef,
): SubjectRagConfigTarget {
    return {
        scope: "project",
        workspaceRoot: context.workspaceRoot,
        project,
    };
}

function defaultSearchLimit(source: SubjectSourceType): number {
    return source === "events" ? 6 : 4;
}

function normalizeSearchSources(sources: SubjectRagSearchInput["sources"]): [SubjectSourceType] {
    if (!Array.isArray(sources) || sources.length !== 1) {
        throw new Error("subject_rag_search 必须显式指定且只能指定一个 source：events 或 memory。需要两层记忆时请分别调用两次。");
    }
    const source = sources[0];
    if (source !== "events" && source !== "memory") {
        throw new Error("subject_rag_search sources 只允许 events 或 memory。");
    }
    return [source];
}

function createSubjectMemoryUpdateTool(): NeuroAgentTool {
    return {
        key: "subject_memory_update",
        name: "subject_memory_update",
        label: "Curate Subject Memory",
        executionMode: "sequential",
        mutatesWorkspace: true,
        description: "Report subject-facing facts to the memory curator. The tool owns merge/update/delete logic for memory.jsonl.",
        parameters: SubjectMemoryUpdateSchema,
        async executeWithContext(context, _toolCallId, params: unknown) {
            const input = params as SubjectMemoryUpdateInput;
            const project = requireSubjectProject(context);
            const subject = await resolveSubjectPaths(context, project, input.subjectPath, {memory: "edit", ragState: "write"});
            const historyCapture = requireSubjectWriteCapture(subject.memoryTarget, project);
            const currentText = await readTextIfExists(subject.memoryPath);
            const currentMemories = parseSubjectMemoriesJsonl(currentText, subject.memoryPath);
            const result = await runMemoryCurator(context, input, currentMemories);
            if (result.status === "needs_review") {
                return {
                    content: [{type: "text", text: `subject_memory_update 未写入 memory.jsonl：${result.reason}`}],
                    details: normalizeToolResultDetails({
                        status: "needs_review",
                        reason: result.reason,
                        attempts: result.attempts,
                        summary: result.summary,
                    }),
                };
            }

            if (result.updated.length === 0 && currentMemories.length === 0 || JSON.stringify(result.updated) === JSON.stringify(currentMemories)) {
                return {
                    content: [{type: "text", text: "subject_memory_update 完成：memory.jsonl 无需更新。"}],
                    details: normalizeToolResultDetails({
                        status: "unchanged",
                        attempts: result.attempts,
                        summary: result.summary,
                    }),
                };
            }

            const serialized = serializeSubjectMemoriesJsonl(result.updated);
            const nextText = serialized ? `${serialized}\n` : "";
            await historyCapture.fileIndex.mutate(async () => {
                const latestText = await readTextIfExists(subject.memoryPath);
                if (latestText !== currentText) {
                    throw new Error("memory.jsonl 在整理期间已变化，请重试本次更新。");
                }
                await mkdir(subject.absolutePath, {recursive: true});
                await writeFile(subject.memoryPath, nextText, "utf-8");
                await recordAgentWorkspaceWrite({
                    sessionId: context.sessionId,
                    capture: historyCapture,
                    before: currentText || null,
                    after: nextText,
                });
                await markSubjectRagDirty(subject, "memory", nextText);
            });
            return {
                content: [{type: "text", text: `subject_memory_update 已更新 memory.jsonl：${result.summary}`}],
                details: normalizeToolResultDetails({
                    status: "updated",
                    attempts: result.attempts,
                    summary: result.summary,
                    memoryCount: result.updated.length,
                    dirty: true,
                }),
            };
        },
        async execute() {
            throw new Error("subject_memory_update 必须在 agent session workspace 内执行。");
        },
    };
}

async function runMemoryCurator(context: ToolExecutionContext, input: SubjectMemoryUpdateInput, currentMemories: SubjectMemory[]): Promise<{
    status: "updated";
    updated: SubjectMemory[];
    attempts: number;
    summary: string;
} | {
    status: "needs_review";
    reason: string;
    attempts: number;
    summary: string;
}> {
    let lastError = "";
    let lastSummary = "";
    let sessionId: number | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            if (sessionId === null) {
                const created = await context.harness.createAgent({
                    profileKey: "memory.curator",
                    initial: {
                        subjectPath: input.subjectPath,
                        facts: input.facts,
                        currentMemories,
                    },
                    currentProjectRoot: context.currentProject?.workspace.ref.projectRoot,
                });
                sessionId = created.sessionId;
            }
            const result = await context.harness.invokeAgent({
                sessionId,
                mode: "prompt",
                message: {
                    text: attempt === 1
                        ? "请根据 facts 和 currentMemories 生成 memory.jsonl 的 JSON Patch。"
                        : `上次 JSON Patch 应用或校验失败：${lastError}\n请重新生成可应用到原始 currentMemories 的完整 JSON Patch。`,
                },
                caller: {
                    kind: "system",
                    sessionId: context.sessionId,
                    profileKey: context.profileKey,
                },
                messageIdentity: "system",
            });
            if (result.status !== "completed") {
                lastError = result.error ?? result.finalMessage ?? "memory.curator 未完成。";
                continue;
            }
            const curator = parseMemoryCuratorData(result.reportResult?.data);
            lastSummary = result.reportResult?.result ?? "";
            const updated = applySubjectMemoryPatch(currentMemories, curator.patch);
            return {
                status: "updated",
                updated,
                attempts: attempt,
                summary: lastSummary,
            };
        } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
        }
    }
    return {
        status: "needs_review",
        reason: lastError || "memory.curator 没有返回可用 patch。",
        attempts: 2,
        summary: lastSummary,
    };
}

function parseMemoryCuratorData(value: unknown): {patch: JsonPatchOperation[]} {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("memory.curator 必须通过 report_result.data 返回 object。");
    }
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.patch)) {
        throw new Error("memory.curator report_result.data.patch 必须是 array。");
    }
    return {
        patch: record.patch.map(parseJsonPatchOperation),
    };
}

function parseJsonPatchOperation(value: unknown): JsonPatchOperation {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error("JSON Patch operation 必须是 object。");
    }
    const record = value as Record<string, unknown>;
    if (typeof record.op !== "string") {
        throw new Error("JSON Patch operation.op 必须是 string。");
    }
    if (typeof record.path !== "string") {
        throw new Error("JSON Patch operation.path 必须是 string。");
    }
    switch (record.op) {
        case "add":
        case "replace":
        case "test":
            return {
                op: record.op,
                path: record.path,
                value: parseJsonPatchValue(record.value),
            } as JsonPatchOperation;
        case "remove":
            return {
                op: "remove",
                path: record.path,
            };
        case "move":
        case "copy":
            if (typeof record.from !== "string") {
                throw new Error(`JSON Patch ${record.op}.from 必须是 string。`);
            }
            return {
                op: record.op,
                from: record.from,
                path: record.path,
            } as JsonPatchOperation;
        default:
            throw new Error(`不支持的 JSON Patch op：${record.op}`);
    }
}

function parseJsonPatchValue(value: unknown): SubjectMemory | string | string[] {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => {
            if (typeof item !== "string") {
                throw new Error(`JSON Patch string[] value[${index}] 必须是 string。`);
            }
            return item;
        });
    }
    return parseSubjectMemory(value, "JSON Patch value");
}

async function resolveSubjectPaths(
    context: ToolExecutionContext,
    project: ReadyProjectSessionRef,
    subjectPath: string,
    access: Readonly<{
        events?: AuthorizedFileOperation;
        memory?: AuthorizedFileOperation;
        ragState: AuthorizedFileOperation;
    }>,
): Promise<{
    absolutePath: string;
    eventsPath: string;
    memoryPath: string;
    ragStatePath: string;
    eventsTarget: ResolvedFileTarget;
    memoryTarget: ResolvedFileTarget;
}> {
    if (context.currentProject !== project) {
        throw new Error("subject工具的Current Project与invocation generation不一致");
    }
    const normalized = subjectPath.trim().replaceAll("\\", "/");
    const segments = normalized.split("/");
    if (isAbsolute(subjectPath) || segments.length !== 3 || segments[0] !== "simulation" || segments[1] !== "subjects" || !segments[2] || segments[2] === "." || segments[2] === "..") {
        throw new Error("subjectPath必须是当前Project内的simulation/subjects/<id>");
    }
    const eventsTarget = (await authorizeFileOperation(context, `${normalized}/events.jsonl`, access.events ?? "read")).target;
    const memoryTarget = (await authorizeFileOperation(context, `${normalized}/memory.jsonl`, access.memory ?? "read")).target;
    const ragStateTarget = (await authorizeFileOperation(context, ".nbook/subject-rag-dirty.json", access.ragState)).target;
    return {
        absolutePath: join(project.workspace.root, ...segments),
        eventsPath: eventsTarget.absolutePath,
        memoryPath: memoryTarget.absolutePath,
        ragStatePath: ragStateTarget.absolutePath,
        eventsTarget,
        memoryTarget,
    };
}

/** Subject写入必须同时捕获当前generation的History与File Index，缺失时在落盘前失败。 */
function requireSubjectWriteCapture(
    target: ResolvedFileTarget,
    project: ReadyProjectSessionRef,
): NonNullable<ReturnType<typeof captureAgentWorkspaceWrite>> {
    if (target.project !== project) {
        throw new Error("subject写入目标与Current Project generation不一致。");
    }
    const capture = captureAgentWorkspaceWrite(target);
    if (!capture) {
        throw new Error("subject写入无法捕获Current Project generation资源。");
    }
    return capture;
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

function appendJsonl(existing: string, next: string): string {
    const normalizedExisting = existing.trimEnd();
    const normalizedNext = next.trimEnd();
    if (!normalizedExisting) {
        return normalizedNext ? `${normalizedNext}\n` : "";
    }
    return normalizedNext ? `${normalizedExisting}\n${normalizedNext}\n` : `${normalizedExisting}\n`;
}

async function ensureSubjectJsonlReadable(subject: Awaited<ReturnType<typeof resolveSubjectPaths>>, sources: SubjectSourceType[]): Promise<void> {
    for (const source of sources) {
        if (source === "events") {
            parseSubjectEventsJsonl(await readTextIfExists(subject.eventsPath), subject.eventsPath);
        } else {
            parseSubjectMemoriesJsonl(await readTextIfExists(subject.memoryPath), subject.memoryPath);
        }
    }
}

function renderSubjectRagCandidates(candidates: SubjectRagCandidate[]): string {
    if (candidates.length === 0) {
        return "subject_rag_search 没有召回候选。";
    }
    return [
        `subject_rag_search candidates=${String(candidates.length)}`,
        ...candidates.map((candidate) => [
            `${String(candidate.rank)}. ${candidate.source}${candidate.topic ? ` topic=${candidate.topic}` : ""}${candidate.tick ? ` tick=${candidate.tick}` : ""}${candidate.time ? ` time=${candidate.time}` : ""}`,
            candidate.text,
        ].join("\n")),
    ].join("\n\n");
}
