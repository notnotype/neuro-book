import {closeArtifact, submitAnswer, withdrawUnanswered} from "../core/artifact-ops.js";
import {QUESTIONS_ARTIFACT} from "../core/artifacts.js";
import {newActionId, readAuditStatus, type AuditAction, type AuditWriter} from "../core/audit.js";
import {editRecordFile} from "../core/edit-ops.js";
import {isNbdevError, NbdevError, type Warning} from "../core/errors.js";
import {PANEL_DEVELOPER} from "../core/identity.js";
import {createTask, createWork, previewCreateTask, previewCreateWork, setRecordStatus, setTaskStatus} from "../core/operations.js";
import {QUESTION_ID_PATTERN} from "../core/questions.js";
import type {CommitOutcome} from "../core/transaction.js";
import type {PanelState} from "./state.js";
import {NotReady, currentStatus} from "./views.js";

/**
 * 面板的写接口。到这里之前 `serve.ts` 已核过转发头、Host、登录 cookie、`Sec-Fetch-Site`、同源 Origin 与 CSRF；
 * 这里再核 `Content-Type`、请求体上限与字段，然后直接调命令行用的同一个核心函数（同一把锁、同一种路径限定的提交）。
 * 面板以开发者身份写（`PANEL_DEVELOPER`）：不取租约，提交信息标“面板”，登记表的 `by` 是开发者。合同见 docs/panel.md 的“写接口”。
 */

export type Envelope = (data: unknown, warnings: Warning[], error: {code: string; message: string; details?: unknown} | null, status?: number) => Response;
export type WriteDeps = {
    state: PanelState;
    envelope: Envelope;
    log: (message: string) => void;
    audit: AuditWriter;
    /** 写成功之后（通知要现算：第二份答复不改变记录缓存的指纹，不会经推送触发）。 */
    afterWrite: () => void;
};

const KIB = 1024;
/** 编辑的内容上限 1 MiB（核心再按字节核一次）；JSON 的转义与其余字段另留余量。 */
const LIMITS = {answer: 256 * KIB, create: 16 * KIB, status: 4 * KIB, edit: 2 * 1024 * KIB, preview: 16 * KIB};
const MAX_NOTE = 2000;

type FieldType = "string" | "number" | "boolean" | "object" | "nullable-string" | "nullable-number" | "string-array";
export type Schema = Record<string, {type: FieldType; required?: boolean}>;

export function usage(message: string, details: Record<string, unknown>): NbdevError {
    return new NbdevError("usage", message, {details});
}

/** 读请求体：声明的长度超了直接拒；边读边数，读到上限就停，不读完整个请求体。 */
async function readBody(req: Request, limit: number): Promise<string> {
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) throw new NbdevError("payload_too_large", `请求体超过 ${limit} 字节`, {details: {limit}});
    if (!req.body) return "";
    const reader = req.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
            await reader.cancel();
            throw new NbdevError("payload_too_large", `请求体超过 ${limit} 字节`, {details: {limit}});
        }
        chunks.push(value);
    }
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(Buffer.concat(chunks));
    } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw usage("请求体不是 UTF-8", {});
    }
}

function typeOk(value: unknown, type: FieldType): boolean {
    switch (type) {
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "object": return typeof value === "object" && value !== null && !Array.isArray(value);
    case "nullable-string": return value === null || typeof value === "string";
    case "nullable-number": return value === null || (typeof value === "number" && Number.isFinite(value));
    case "string-array": return Array.isArray(value) && value.every((entry) => typeof entry === "string");
    }
}

/** 顶层必须是对象；只收列出的字段（拼错的字段名不会被静默忽略），类型不对、缺必填都回 400。 */
export async function readFields(req: Request, limit: number, schema: Schema, preview = false): Promise<Record<string, unknown>> {
    const type = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") throw new NbdevError("unsupported_media_type", "写请求的 Content-Type 必须是 application/json", {details: {contentType: type}});
    const text = await readBody(req, limit);
    let body: unknown;
    try {
        body = JSON.parse(text);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw usage("请求体不是 JSON", {});
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw usage("请求体必须是 JSON 对象", {});
    const fields = body as Record<string, unknown>;
    for (const key of Object.keys(fields)) {
        if (!Object.hasOwn(schema, key)) throw usage(`不认识的字段：${key}`, {field: key, reason: "unknown_field"});
    }
    for (const [key, rule] of Object.entries(schema)) {
        if (!Object.hasOwn(fields, key) || fields[key] === undefined) {
            if (rule.required && !preview) throw usage(`缺少字段：${key}`, {field: key, reason: "missing"});
            continue;
        }
        if (!typeOk(fields[key], rule.type)) throw usage(`字段类型不对：${key}`, {field: key, reason: "type"});
    }
    return fields;
}

/** 题号做键的对象：键按题号格式校验，复制进无原型的对象（`__proto__` 之类的键不会改到原型）。 */
function questionMap<T>(value: unknown, field: string, check: (entry: unknown, key: string) => T): Record<string, T> {
    const result = Object.create(null) as Record<string, T>;
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (!QUESTION_ID_PATTERN.test(key)) throw usage(`题号格式不对：${key}`, {field: `${field}.${key}`, reason: "question_id"});
        result[key] = check(entry, key);
    }
    return result;
}

const str = (fields: Record<string, unknown>, key: string) => fields[key] as string | undefined;

/** `id` 只接受缓存里存在的值（与读接口相同），不存在回 404；核心在锁内还会再解析一次。 */
function knownWork(state: PanelState, workId: string): void {
    if (!currentStatus(state).status.works.some((work) => work.workId === workId)) throw new NbdevError("work_not_found", `找不到 Work：${workId}`, {details: {workId}});
}

function knownTask(state: PanelState, workId: string, taskId: string): void {
    const work = currentStatus(state).status.works.find((candidate) => candidate.workId === workId);
    if (!work?.tasks.some((task) => task.taskId === taskId)) throw new NbdevError("task_not_found", `找不到 Task：${workId}/${taskId}`, {details: {workId, taskId}});
}

function knownArtifact(state: PanelState, workId: string, taskId: string, artifactId: string): void {
    knownTask(state, workId, taskId);
    const task = currentStatus(state).status.works.find((work) => work.workId === workId)!.tasks.find((candidate) => candidate.taskId === taskId)!;
    if (!task.artifacts.some((artifact) => artifact.artifactId === artifactId)) throw new NbdevError("artifact_not_found", `找不到产物：${workId}/${taskId}/${artifactId}`, {details: {workId, taskId, artifactId}});
}

/** HTTP 状态：用法 400（体积 413、类型 415），冲突 409，找不到 404，等锁超时 503（确定什么都没写），其余 500。 */
export function statusOf(error: NbdevError): number {
    if (error.code === "payload_too_large") return 413;
    if (error.code === "unsupported_media_type") return 415;
    if (error.code === "lock_timeout" || error.code === "herdr_unavailable") return 503;
    if (error.exitCode === 2) return 400;
    if (error.exitCode === 3) return 409;
    if (error.exitCode === 5) return 404;
    return 500;
}

type WriteOutcome = {data: object; commit: CommitOutcome; warnings: Warning[]};

export function createWriteHandler(deps: WriteDeps) {
    const {state, envelope, log} = deps;
    const options = (req: Request) => ({caller: PANEL_DEVELOPER, signal: req.signal});

    /**
     * 写成功后等记录与活动各重算一次（这次重算在写入之后才开始）再回应：回应里的 revisions 已包含这次写入，
     * 前端拿到回应就能跳到新建的 Work，不会因为缓存还没算到它而 404。
     */
    async function respond(outcome: WriteOutcome, action: AuditAction, target: Record<string, unknown>): Promise<Response> {
        await state.records.run();
        await state.activity.run();
        const {commit} = outcome;
        const data = {changed: true, ...outcome.data, commit};
        const warnings = [...outcome.warnings, ...await auditWrite(action, target, commit)];
        deps.afterWrite();
        if (!commit.committed && commit.reason !== "nothing_to_commit") {
            return envelope(data, warnings, {code: "commit_failed", message: `已写入、没有提交（${commit.reason}）：${commit.writtenPaths.join("、")}；手动提交这些路径`, details: {reason: commit.reason, writtenPaths: commit.writtenPaths, detail: commit.detail}}, 500);
        }
        return envelope(data, warnings, null);
    }

    /**
     * 写仓库之后补一行审计结果（S7）：审计没初始化时跳过（面板照常写，`/api/meta` 标着审计未开启）；
     * 初始化过却写不进去（权限、属主不对）只给警告——仓库已经改了，git 历史也记着，回错会让开发者以为没写成。
     */
    async function auditWrite(action: AuditAction, target: Record<string, unknown>, commit: CommitOutcome): Promise<Warning[]> {
        const status = await readAuditStatus(deps.audit.paths);
        if (!status.enabled && status.reason === "not_initialized") return [];
        try {
            await deps.audit.append({actionId: newActionId(), phase: "result", action, device: PANEL_DEVELOPER.device, target, detail: commit.committed
                ? {committed: true, sha: commit.sha, paths: commit.paths}
                : {committed: false, reason: commit.reason, paths: commit.reason === "nothing_to_commit" ? commit.paths : commit.writtenPaths}});
            return [];
        } catch (error) {
            if (!(error instanceof Error)) throw error;
            log(`写审计失败（${action}）：${error.message}`);
            return [{code: "audit_write_failed", message: `已写入，但审计没记上：${error.message}`, details: {action}}];
        }
    }

    async function answers(req: Request): Promise<Response> {
        const fields = await readFields(req, LIMITS.answer, {
            workId: {type: "string", required: true}, taskId: {type: "string", required: true}, artifactId: {type: "string", required: true},
            version: {type: "number", required: true}, values: {type: "object", required: true}, comments: {type: "object"}, note: {type: "nullable-string"},
        });
        const [workId, taskId, artifactId] = [str(fields, "workId")!, str(fields, "taskId")!, str(fields, "artifactId")!];
        knownArtifact(state, workId, taskId, artifactId);
        const version = fields.version as number;
        if (!Number.isInteger(version) || version < 1) throw usage("version 必须是正整数", {field: "version", reason: "type"});
        const values = questionMap(fields.values, "values", (entry) => entry);
        const comments = fields.comments === undefined ? undefined : questionMap(fields.comments, "comments", (entry, key) => {
            if (typeof entry !== "string") throw usage(`说明必须是文字：${key}`, {field: `comments.${key}`, reason: "type"});
            if (entry.length > MAX_NOTE) throw usage(`说明超过 ${MAX_NOTE} 字：${key}`, {field: `comments.${key}`, reason: "too_long"});
            return entry;
        });
        const note = fields.note as string | null | undefined;
        if (typeof note === "string" && note.length > MAX_NOTE) throw usage(`备注超过 ${MAX_NOTE} 字`, {field: "note", reason: "too_long"});
        const outcome = await submitAnswer(state.context, {
            workRef: workId, taskRef: taskId, artifactId, values, comments, note: note ?? null,
            artifactVersion: version, requireLatest: true,
            submittedBy: {kind: "developer", device: PANEL_DEVELOPER.device},
            submittedAt: new Date().toISOString(),
        }, options(req));
        return respond(outcome, "answer", {workId, taskId, artifactId});
    }

    /** 开发者自己结束一块评审：普通产物关闭；Task 的提问集不能关闭（见 `closeArtifact`），改成把没答的题一次撤回。 */
    async function closeReview(req: Request): Promise<Response> {
        const fields = await readFields(req, LIMITS.status, {workId: {type: "string", required: true}, taskId: {type: "string", required: true}, artifactId: {type: "string", required: true}});
        const [workId, taskId, artifactId] = [str(fields, "workId")!, str(fields, "taskId")!, str(fields, "artifactId")!];
        knownArtifact(state, workId, taskId, artifactId);
        const input = {workRef: workId, taskRef: taskId, artifactId};
        const outcome = await (artifactId === QUESTIONS_ARTIFACT ? withdrawUnanswered : closeArtifact)(state.context, input, options(req));
        return respond(outcome, "close_artifact", {workId, taskId, artifactId});
    }

    const WORK_FIELDS: Schema = {
        slug: {type: "string", required: true}, title: {type: "string", required: true}, goal: {type: "string", required: true},
        issue: {type: "nullable-number"}, taskSlug: {type: "string", required: true}, taskTitle: {type: "nullable-string"}, taskStatus: {type: "string"},
    };
    const TASK_FIELDS: Schema = {slug: {type: "string", required: true}, title: {type: "string", required: true}, goal: {type: "nullable-string"}, status: {type: "string"}};
    const PREVIEW_TASK_FIELDS: Schema = {workId: {type: "string", required: true}, ...TASK_FIELDS};

    const workInput = (fields: Record<string, unknown>) => ({
        slug: str(fields, "slug") ?? "", title: str(fields, "title") ?? "", goal: str(fields, "goal") ?? "", taskSlug: str(fields, "taskSlug") ?? "",
        taskTitle: (fields.taskTitle as string | null | undefined) || undefined,
        issueNumber: (fields.issue as number | null | undefined) ?? undefined,
        taskStatus: str(fields, "taskStatus"),
    });
    const taskInput = (workId: string, fields: Record<string, unknown>) => ({
        workRef: workId, slug: str(fields, "slug") ?? "", title: str(fields, "title") ?? "",
        goal: (fields.goal as string | null | undefined) || undefined, status: str(fields, "status"),
    });

    async function works(req: Request): Promise<Response> {
        const fields = await readFields(req, LIMITS.create, WORK_FIELDS);
        return respond(await createWork(state.context, workInput(fields), options(req)), "create_work", {slug: str(fields, "slug")});
    }

    async function tasks(req: Request, workId: string): Promise<Response> {
        knownWork(state, workId);
        const fields = await readFields(req, LIMITS.create, TASK_FIELDS);
        return respond(await createTask(state.context, taskInput(workId, fields), options(req)), "create_task", {workId, slug: str(fields, "slug")});
    }

    async function status(req: Request, workId: string, taskId: string | null): Promise<Response> {
        if (taskId === null) knownWork(state, workId);
        else knownTask(state, workId, taskId);
        const fields = await readFields(req, LIMITS.status, {status: {type: "string", required: true}, expectedHash: {type: "string", required: true}, includeUncommitted: {type: "boolean"}});
        const input = {workRef: workId, status: str(fields, "status")!, expectedHash: str(fields, "expectedHash")!, includeUncommitted: fields.includeUncommitted === true};
        const outcome = taskId === null
            ? await setRecordStatus(state.context, input, options(req))
            : await setTaskStatus(state.context, {...input, taskRef: taskId}, options(req));
        return respond(outcome, "status", {workId, taskId, status: input.status});
    }

    async function edit(req: Request, url: URL): Promise<Response> {
        const path = url.searchParams.get("path");
        if (path === null) throw usage("缺少 path", {field: "path", reason: "missing"});
        const fields = await readFields(req, LIMITS.edit, {content: {type: "string", required: true}, baseHash: {type: "string", required: true}, includeUncommitted: {type: "boolean"}});
        return respond(await editRecordFile(state.context, {path, content: str(fields, "content")!, baseHash: str(fields, "baseHash")!, includeUncommitted: fields.includeUncommitted === true}, options(req)), "edit", {path});
    }

    /** 预览与写接口走同一套校验，只是不取锁、不写文件；字段可以不全（表单还在填）。 */
    async function preview(req: Request, kind: string): Promise<Response> {
        if (kind === "work") {
            const fields = await readFields(req, LIMITS.preview, WORK_FIELDS, true);
            return envelope(await previewCreateWork(state.context, workInput(fields), {caller: PANEL_DEVELOPER}), [], null);
        }
        const fields = await readFields(req, LIMITS.preview, PREVIEW_TASK_FIELDS, true);
        const workId = str(fields, "workId") ?? "";
        return envelope(await previewCreateTask(state.context, taskInput(workId, fields), {caller: PANEL_DEVELOPER}), [], null);
    }

    /** 路由：没有对应的写路由时回 405（与 t09 的只读面板相同）。 */
    function route(req: Request, segments: readonly string[], url: URL): Promise<Response> | null {
        const [, first, second, third, fourth, fifth, ...extra] = segments;
        if (extra.length > 0) return null;
        if (req.method === "POST") {
            if (first === "answers" && second === undefined) return answers(req);
            if (first === "artifact-close" && second === undefined) return closeReview(req);
            if (first === "works" && second === undefined) return works(req);
            if (first === "works" && second !== undefined && third === "tasks" && fourth === undefined) return tasks(req, second);
            if (first === "works" && second !== undefined && third === "status" && fourth === undefined) return status(req, second, null);
            if (first === "works" && second !== undefined && third === "tasks" && fourth !== undefined && fifth === "status") return status(req, second, fourth);
            if (first === "preview" && (second === "work" || second === "task") && third === undefined) return preview(req, second);
        }
        if (req.method === "PUT" && first === "files" && second === undefined) return edit(req, url);
        return null;
    }

    return async function handleWrite(req: Request, segments: readonly string[], url: URL): Promise<Response> {
        try {
            const handled = route(req, segments, url);
            if (!handled) return envelope(null, [], {code: "method_not_allowed", message: "没有这个写接口"}, 405);
            return await handled;
        } catch (error) {
            if (error instanceof NotReady) return envelope(null, [], {code: "warming_up", message: error.message}, 503);
            if (isNbdevError(error)) {
                if (error.code === "request_aborted") log(`写请求 ${req.method} ${url.pathname} 的客户端在写之前断开，什么都没写`);
                return envelope(null, [], {code: error.code, message: error.message, details: error.details}, statusOf(error));
            }
            log(`写接口 ${req.method} ${url.pathname} 失败：${error instanceof Error ? error.stack ?? error.message : String(error)}`);
            return envelope(null, [], {code: "internal", message: "面板内部错误，详见面板的日志"}, 500);
        }
    };
}
