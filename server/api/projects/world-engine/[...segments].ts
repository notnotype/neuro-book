import type {H3Event} from "h3";
import {readFile, stat, writeFile} from "node:fs/promises";
import {basename, isAbsolute, join, relative} from "node:path";
import {z} from "zod";
import {parseSubjectEvent, parseSubjectEventsJsonl, serializeSubjectEventsJsonl, type SubjectEvent} from "nbook/server/agent/tools/subject-memory";
import {markSubjectRagDirty, type SubjectPaths} from "nbook/server/agent/tools/subject-rag-index";
import {normalizeWorldKey, worldEngineFacadeForWorkspaceRoot, type WorldEngineFacade} from "nbook/server/world-engine";
import type {JsonValue, PatchInput, SliceInput, SliceListItem, WorldEngineWorldKey, WorldSliceSubjectFilterMode, WorldState} from "nbook/server/world-engine";
import {requireProjectPathQuery, validateBody} from "nbook/server/utils/novel-chapter";
import {assertProjectWorkspaceDirectory} from "nbook/server/workspace-files/project-workspace";
import {runtimePathsFromEnv} from "nbook/server/runtime/paths/runtime-paths";
import {resolveProjectWorkspaceRoot} from "nbook/server/workspace-files/project-path";
import type {AbsoluteFsPath} from "nbook/server/runtime/paths/file-path";
import {assertProjectOpen, ProjectNotOpenError} from "nbook/server/workspace-files/project-session";
import {createProjectNotOpenHttpError} from "nbook/server/workspace-files/project-open-guard";

const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
]));

const PatchSchema = z.object({
    subjectId: z.string().min(1, "subjectId 不能为空"),
    path: z.string().min(1, "path 不能为空").regex(/^\//, "path 必须是 JSON Pointer（以 / 开头）"),
    op: z.enum(["replace", "increment", "remove", "append"]),
    value: JsonValueSchema.optional(),
    summary: z.string().optional(),
    type: z.string().min(1, "type 不能为空").optional(),
    name: z.string().optional(),
}).strict().superRefine((patch, ctx) => {
    if (patch.op !== "remove" && patch.value === undefined) {
        ctx.addIssue({code: z.ZodIssueCode.custom, path: ["value"], message: `${patch.op} patch 必须提供 value`});
    }
});

const SliceBodySchema = z.object({
    time: z.string().min(1, "time 不能为空"),
    title: z.string().optional(),
    summary: z.string().optional(),
    kind: z.string().optional(),
    patches: z.array(PatchSchema).min(1, "patches 不能为空").max(100, "patches 不能超过 100 条"),
}).strict();

const QueryStateBodySchema = z.object({
    subjectIds: z.array(z.string().min(1, "subjectId 不能为空")).min(1).optional(),
    type: z.string().min(1, "type 不能为空").optional(),
    attrs: z.array(z.string().min(1, "attr 不能为空")).min(1).optional(),
    at: z.string().min(1, "at 不能为空").optional(),
    listLimit: z.number().int().min(1).max(100).optional(),
}).strict();

const CreateSubjectBodySchema = z.object({
    id: z.string().min(1, "id 不能为空"),
    type: z.string().min(1, "type 不能为空"),
    name: z.string().optional(),
    time: z.string().min(1, "time 不能为空"),
    attrs: z.record(z.string(), JsonValueSchema).optional(),
}).strict();

const SubjectEventInputSchema = z.object({
    tick: z.string().optional(),
    time: z.string().optional(),
    text: z.string().min(1, "text 不能为空"),
}).strict();

const SubjectFileEventCommitBodySchema = z.object({
    subjectId: z.string().min(1, "subjectId 不能为空"),
    subjectPath: z.string().min(1, "subjectPath 不能为空"),
    eventsPath: z.string().min(1, "eventsPath 不能为空"),
    sliceId: z.string().min(1, "sliceId 不能为空").optional(),
    event: SubjectEventInputSchema.optional(),
    eventJsonLine: z.string().min(1, "eventJsonLine 不能为空").optional(),
}).strict().refine((body) => Boolean(body.event || body.eventJsonLine), {
    message: "event 或 eventJsonLine 至少提供一个",
});

type SliceBody = z.infer<typeof SliceBodySchema>;
type QueryStateBody = z.infer<typeof QueryStateBodySchema>;
type CreateSubjectBody = z.infer<typeof CreateSubjectBodySchema>;
type SubjectFileEventCommitBody = z.infer<typeof SubjectFileEventCommitBodySchema>;

/**
 * World Engine Project API：所有时间入参和出参都使用项目日历字符串。
 */
export default defineEventHandler(async (event) => {
    try {
        return await handleWorldEngineApi(event);
    } catch (error) {
        if (error instanceof ProjectNotOpenError) {
            throw createProjectNotOpenHttpError(error);
        }
        throw error;
    }
});

/**
 * 处理 World Engine 数据面 API。先守卫 open，避免时间/schema 预处理在未 open 时绕过会话模型。
 */
async function handleWorldEngineApi(event: H3Event): Promise<unknown> {
    const workspaceRoot = runtimePathsFromEnv().workspaceRoot;
    const worldEngineFacade = worldEngineFacadeForWorkspaceRoot(workspaceRoot);
    const projectPath = await assertProjectWorkspaceDirectory(workspaceRoot, requireProjectPathQuery(event));
    const projectRoot = resolveProjectWorkspaceRoot(workspaceRoot, projectPath);
    assertProjectOpen(projectPath);
    const segments = readSegments(event);
    const method = event.method.toUpperCase();
    // 世界线维度：main = 写作模式（默认，配置根 world-engine/），rp = RP 模式独立世界线（配置根 rp/world-engine/，数据在 world-rp.sqlite）。两模式完全分离。
    const worldKey = normalizeWorldKey(readOptionalStringQuery(event, "worldKey"));

    if (method === "GET" && matchSegments(segments, ["status"])) {
        return worldEngineFacade.getWorldStatus(projectPath, worldKey);
    }
    if (method === "GET" && matchSegments(segments, ["schema"])) {
        return worldEngineFacade.getWorldSchema(projectPath, worldKey);
    }
    if (method === "GET" && matchSegments(segments, ["subjects"])) {
        return worldEngineFacade.listSubjects(projectPath, {type: readOptionalStringQuery(event, "type")}, worldKey);
    }
    if (method === "POST" && matchSegments(segments, ["subjects"])) {
        return createSubject(worldEngineFacade, projectPath, await validateBody<CreateSubjectBody>(event, CreateSubjectBodySchema), worldKey);
    }
    if (method === "GET" && matchSegments(segments, ["slices"])) {
        return listSlices(worldEngineFacade, projectPath, event, worldKey);
    }
    if (method === "GET" && segments.length === 2 && segments[0] === "slices") {
        return serializeSlice(worldEngineFacade, projectPath, await worldEngineFacade.getSlice(projectPath, requireSegment("sliceId", segments[1]), worldKey), worldKey);
    }
    if (method === "POST" && matchSegments(segments, ["slices"])) {
        return writeSlice(worldEngineFacade, projectPath, await validateBody<SliceBody>(event, SliceBodySchema), worldKey);
    }
    if (method === "POST" && segments.length === 3 && segments[0] === "slices" && segments[2] === "edit") {
        return editSlice(worldEngineFacade, projectPath, requireSegment("sliceId", segments[1]), await validateBody<SliceBody>(event, SliceBodySchema), worldKey);
    }
    if (method === "POST" && segments.length === 3 && segments[0] === "slices" && segments[2] === "delete") {
        return worldEngineFacade.deleteSlice(projectPath, requireSegment("sliceId", segments[1]), worldKey);
    }
    if (method === "DELETE" && segments.length === 2 && segments[0] === "slices") {
        return worldEngineFacade.deleteSlice(projectPath, requireSegment("sliceId", segments[1]), worldKey);
    }
    if (method === "GET" && matchSegments(segments, ["state"])) {
        return readFullState(worldEngineFacade, projectPath, event, worldKey);
    }
    if (method === "POST" && matchSegments(segments, ["state", "query"])) {
        return queryState(worldEngineFacade, projectPath, await validateBody<QueryStateBody>(event, QueryStateBodySchema), worldKey);
    }
    if (method === "POST" && matchSegments(segments, ["subject-file-proposals", "events", "commit"])) {
        return commitSubjectFileEvent(projectRoot, projectPath, await validateBody<SubjectFileEventCommitBody>(event, SubjectFileEventCommitBodySchema));
    }

    throw createError({statusCode: 404, message: "未知 World Engine API"});
}

async function createSubject(worldEngineFacade: WorldEngineFacade, projectPath: string, body: CreateSubjectBody, worldKey: WorldEngineWorldKey): Promise<unknown> {
    return worldEngineFacade.createSubject(projectPath, {
        id: body.id,
        type: body.type,
        name: body.name,
        at: await parsePublicTime(worldEngineFacade, projectPath, body.time, "time", worldKey),
        attrs: body.attrs,
    }, worldKey);
}

async function listSlices(worldEngineFacade: WorldEngineFacade, projectPath: string, event: H3Event, worldKey: WorldEngineWorldKey): Promise<unknown> {
    const slices = await worldEngineFacade.listSlices(projectPath, {
        limit: readPositiveIntQuery(event, "limit"),
        from: await readOptionalTimeQuery(worldEngineFacade, projectPath, event, "from", worldKey),
        to: await readOptionalTimeQuery(worldEngineFacade, projectPath, event, "to", worldKey),
        withPatches: readBooleanQuery(event, "withPatches"),
        subjectIds: readStringListQuery(event, "subjectIds"),
        subjectMode: readSubjectModeQuery(event),
    }, worldKey);
    return Promise.all(slices.map((slice) => serializeSlice(worldEngineFacade, projectPath, slice, worldKey)));
}

async function writeSlice(worldEngineFacade: WorldEngineFacade, projectPath: string, body: SliceBody, worldKey: WorldEngineWorldKey): Promise<unknown> {
    return worldEngineFacade.writeSlice(projectPath, await toSliceInput(worldEngineFacade, projectPath, body, worldKey), worldKey);
}

async function editSlice(worldEngineFacade: WorldEngineFacade, projectPath: string, sliceId: string, body: SliceBody, worldKey: WorldEngineWorldKey): Promise<unknown> {
    return worldEngineFacade.editSlice(projectPath, sliceId, await toSliceInput(worldEngineFacade, projectPath, body, worldKey), worldKey);
}

async function readFullState(worldEngineFacade: WorldEngineFacade, projectPath: string, event: H3Event, worldKey: WorldEngineWorldKey): Promise<unknown> {
    return serializeWorldState(worldEngineFacade, projectPath, await worldEngineFacade.queryState(projectPath, {
        at: await readOptionalTimeQuery(worldEngineFacade, projectPath, event, "at", worldKey),
    }, worldKey), worldKey);
}

async function queryState(worldEngineFacade: WorldEngineFacade, projectPath: string, body: QueryStateBody, worldKey: WorldEngineWorldKey): Promise<unknown> {
    if (!body.subjectIds?.length && !body.type) {
        throw createError({statusCode: 400, message: "state/query 必须提供 subjectIds 或 type"});
    }
    const result = await worldEngineFacade.queryState(projectPath, {
        subjectIds: body.subjectIds,
        type: body.type,
        attrs: body.attrs,
        at: body.at ? await parsePublicTime(worldEngineFacade, projectPath, body.at, "at", worldKey) : undefined,
        listLimit: body.listLimit,
    }, worldKey);
    return {subjects: result.subjects, issues: result.issues};
}

async function commitSubjectFileEvent(
    projectRoot: AbsoluteFsPath,
    projectPath: string,
    body: SubjectFileEventCommitBody,
): Promise<unknown> {
    const subjectPath = normalizeCommitSubjectPath(body.subjectPath);
    if (body.subjectId !== basename(subjectPath)) {
        throw createError({statusCode: 400, message: "subjectId 必须匹配 subjectPath 末段"});
    }
    const eventsPath = normalizeCommitFilePath(body.eventsPath, "eventsPath");
    const expectedEventsPath = `${subjectPath}/events.jsonl`;
    if (eventsPath !== expectedEventsPath) {
        throw createError({statusCode: 400, message: "eventsPath 必须匹配 subjectPath/events.jsonl"});
    }

    const absoluteSubjectPath = join(projectRoot, subjectPath);
    const relativeSubjectPath = relative(projectRoot, absoluteSubjectPath);
    if (relativeSubjectPath.startsWith("..") || isAbsolute(relativeSubjectPath)) {
        throw createError({statusCode: 400, message: "subjectPath 越界"});
    }
    await assertCommitSubjectDirectory(absoluteSubjectPath);

    const subject: SubjectPaths = {
        absolutePath: absoluteSubjectPath,
        eventsPath: join(absoluteSubjectPath, "events.jsonl"),
        memoryPath: join(absoluteSubjectPath, "memory.jsonl"),
        ragStatePath: join(projectRoot, ".nbook", "subject-rag-dirty.json"),
    };
    const currentText = await readCommitEventsText(subject.eventsPath);
    const events = parseCommitEvents(currentText, subject.eventsPath);
    const event = parseCommitEvent(body);
    const line = serializeSubjectEventsJsonl([event]);
    if (events.some((item) => item.text === event.text && (item.time ?? "") === (event.time ?? ""))) {
        return {
            status: "already-exists",
            subjectId: body.subjectId,
            subjectPath,
            eventsPath,
            ...(body.sliceId ? {sliceId: body.sliceId} : {}),
            event,
            line,
            dirty: false,
        };
    }

    const nextEvents = [...events, event];
    const serialized = serializeSubjectEventsJsonl(nextEvents);
    const nextText = serialized ? `${serialized}\n` : "";
    await writeFile(subject.eventsPath, nextText, "utf-8");
    await markSubjectRagDirty(subject, "events", nextText);
    return {
        status: "appended",
        subjectId: body.subjectId,
        subjectPath,
        eventsPath,
        ...(body.sliceId ? {sliceId: body.sliceId} : {}),
        event,
        line,
        dirty: true,
    };
}

async function toSliceInput(worldEngineFacade: WorldEngineFacade, projectPath: string, body: SliceBody, worldKey: WorldEngineWorldKey = "main"): Promise<SliceInput> {
    return {
        instant: await parsePublicTime(worldEngineFacade, projectPath, body.time, "time", worldKey),
        title: body.title,
        summary: body.summary,
        kind: body.kind,
        patches: body.patches.map((patch): PatchInput => ({
            subjectId: patch.subjectId,
            path: patch.path,
            op: patch.op,
            ...(patch.value === undefined ? {} : {value: patch.value}),
            ...(patch.summary ? {summary: patch.summary} : {}),
            ...(patch.type ? {type: patch.type} : {}),
            ...(patch.name ? {name: patch.name} : {}),
        })),
    };
}

async function serializeSlice(worldEngineFacade: WorldEngineFacade, projectPath: string, slice: SliceListItem, worldKey: WorldEngineWorldKey = "main"): Promise<unknown> {
    return {
        id: slice.id,
        time: await worldEngineFacade.formatTime(projectPath, slice.instant, worldKey),
        ...(slice.previousInstant !== undefined ? {previousTime: await worldEngineFacade.formatTime(projectPath, slice.previousInstant, worldKey)} : {}),
        title: slice.title,
        summary: slice.summary,
        kind: slice.kind,
        ...(slice.patches ? {patches: slice.patches} : {}),
        ...(slice.issues && slice.issues.length ? {issues: slice.issues} : {}),
    };
}

async function serializeWorldState(worldEngineFacade: WorldEngineFacade, projectPath: string, state: WorldState, worldKey: WorldEngineWorldKey = "main"): Promise<unknown> {
    return {
        time: await worldEngineFacade.formatTime(projectPath, state.instant, worldKey),
        subjects: state.subjects,
        issues: state.issues,
    };
}

async function readOptionalTimeQuery(
    worldEngineFacade: WorldEngineFacade,
    projectPath: string,
    event: H3Event,
    key: string,
    worldKey: WorldEngineWorldKey = "main",
): Promise<bigint | undefined> {
    const value = readOptionalStringQuery(event, key);
    if (!value) {
        return undefined;
    }
    if (value !== value.trim()) {
        throw createError({statusCode: 400, message: `${key} 不能包含前后空白：${value}`});
    }
    return parsePublicTime(worldEngineFacade, projectPath, value, key, worldKey);
}

function readOptionalStringQuery(event: H3Event, key: string): string | undefined {
    const value = getQuery(event)[key];
    if (Array.isArray(value)) {
        throw createError({statusCode: 400, message: `${key} 只能传一个值`});
    }
    if (typeof value !== "string") {
        return undefined;
    }
    return value === "" ? undefined : value;
}

function readPositiveIntQuery(event: H3Event, key: string): number | undefined {
    const text = readOptionalStringQuery(event, key);
    if (!text) {
        return undefined;
    }
    if (!/^\d+$/.test(text)) {
        throw createError({statusCode: 400, message: `${key} 必须是正整数`});
    }
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw createError({statusCode: 400, message: `${key} 必须是安全正整数`});
    }
    return value;
}

function readBooleanQuery(event: H3Event, key: string): boolean | undefined {
    const text = readOptionalStringQuery(event, key);
    if (!text) {
        return undefined;
    }
    if (text === "true") {
        return true;
    }
    if (text === "false") {
        return false;
    }
    throw createError({statusCode: 400, message: `${key} 必须是 true 或 false`});
}

function readStringListQuery(event: H3Event, key: string): string[] | undefined {
    const text = readOptionalStringQuery(event, key);
    if (!text) {
        return undefined;
    }
    return text.split(",");
}

function readSubjectModeQuery(event: H3Event): WorldSliceSubjectFilterMode | undefined {
    const text = readOptionalStringQuery(event, "subjectMode");
    if (!text) {
        return undefined;
    }
    if (text === "any" || text === "all") {
        return text;
    }
    throw createError({statusCode: 400, message: "subjectMode 必须是 any 或 all"});
}

/** HTTP 公开边界只接受项目日历字符串；raw instant 仅保留给 facade/calendar 底层调试。 */
async function parsePublicTime(
    worldEngineFacade: WorldEngineFacade,
    projectPath: string,
    input: string,
    label: string,
    worldKey: WorldEngineWorldKey = "main",
): Promise<bigint> {
    if (input !== input.trim()) {
        throw createError({statusCode: 400, message: `${label} 不能包含前后空白：${input}`});
    }
    if (isRawInstantTime(input)) {
        throw createError({statusCode: 400, message: `${label} 必须使用项目日历字符串，不能使用 instant:<number>`});
    }
    return worldEngineFacade.parseTime(projectPath, input, worldKey);
}

function isRawInstantTime(input: string): boolean {
    return input.trim().toLowerCase().startsWith("instant:");
}

function readSegments(event: H3Event): string[] {
    const rawSegments = event.context.params?.segments;
    const segments = Array.isArray(rawSegments) ? rawSegments : typeof rawSegments === "string" ? rawSegments.split("/") : [];
    return segments.map(decodeSegment).filter(Boolean);
}

function decodeSegment(segment: string): string {
    try {
        return decodeURIComponent(segment);
    } catch {
        throw createError({statusCode: 400, message: `API path 编码不合法：${segment}`});
    }
}

function matchSegments(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function requireSegment(label: string, value: string | undefined): string {
    const text = value ?? "";
    if (text.trim() === "") {
        throw createError({statusCode: 400, message: `${label} 不能为空`});
    }
    if (text !== text.trim()) {
        throw createError({statusCode: 400, message: `${label} 不能包含前后空白：${text}`});
    }
    return text;
}

function normalizeCommitSubjectPath(value: string): string {
    if (value !== value.trim()) {
        throw createError({statusCode: 400, message: `subjectPath 不能包含前后空白：${value}`});
    }
    const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const parts = normalized.split("/").filter(Boolean);
    if (parts.length !== 3 || parts[0] !== "simulation" || parts[1] !== "subjects" || !parts[2]) {
        throw createError({statusCode: 400, message: "subjectPath 必须形如 simulation/subjects/<subject-id>"});
    }
    if (parts.some((part) => part === "." || part === "..")) {
        throw createError({statusCode: 400, message: "subjectPath 不能包含 . 或 .."});
    }
    return parts.join("/");
}

function normalizeCommitFilePath(value: string, label: string): string {
    if (value !== value.trim()) {
        throw createError({statusCode: 400, message: `${label} 不能包含前后空白：${value}`});
    }
    const normalized = value.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!normalized || normalized.split("/").some((part) => part === "." || part === "..")) {
        throw createError({statusCode: 400, message: `${label} 不是合法 Project Workspace 相对路径`});
    }
    return normalized;
}

async function assertCommitSubjectDirectory(absolutePath: string): Promise<void> {
    try {
        const subjectStat = await stat(absolutePath);
        if (!subjectStat.isDirectory()) {
            throw createError({statusCode: 404, message: "subject 目录不存在"});
        }
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw createError({statusCode: 404, message: "subject 目录不存在"});
        }
        throw error;
    }
}

async function readCommitEventsText(filePath: string): Promise<string> {
    try {
        return await readFile(filePath, "utf-8");
    } catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
            throw createError({statusCode: 404, message: "events.jsonl 不存在"});
        }
        throw error;
    }
}

function parseCommitEvents(text: string, filePath: string): SubjectEvent[] {
    try {
        return parseSubjectEventsJsonl(text, filePath);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createError({statusCode: 409, message: `events.jsonl 无效，请先修复源文件：${message}`});
    }
}

function parseCommitEvent(body: SubjectFileEventCommitBody): SubjectEvent {
    if (body.event) {
        return parseSubjectEvent(body.event, "event");
    }
    try {
        return parseSubjectEvent(JSON.parse(body.eventJsonLine ?? ""), "eventJsonLine");
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw createError({statusCode: 400, message: `eventJsonLine 不是合法 subject event：${message}`});
    }
}
