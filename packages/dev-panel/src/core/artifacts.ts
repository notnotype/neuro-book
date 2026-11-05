import {createHash, randomBytes} from "node:crypto";
import {lstat, readdir, readFile} from "node:fs/promises";
import {join, posix, resolve} from "node:path";
import {NbdevError, systemErrorCode, type Warning} from "./errors.js";
import {gitOutput, splitNul} from "./git.js";
import {isIsoTime, isNullableString, isOtherSchemaVersion, isRecord, isStringArray} from "./json.js";
import {
    isEarlierPageQuestion,
    parseQuestionMarkup,
    QUESTION_ID_PATTERN,
    QUESTION_TYPES,
    scriptWritesQuestionMarkup,
    validateAnswerValue,
    type MarkupQuestion,
    type ParsedMarkup,
    type QuestionDefinition,
    type QuestionOption,
    type QuestionType,
} from "./questions.js";
import {cssReferences, scriptImports} from "./references.js";
import {readTitle} from "./frontmatter.js";
import {WORKS_ROOT} from "./repo.js";

/**
 * 产物、提问、答复与确认的入库文件：格式、读取与现算。写入在 artifact-ops.ts，经写事务完成。
 * 状态一律现算：题的结局写在最新一版的发布记录里，`answered` 与未确认由答复与确认的文件算出。格式见 docs/file-formats.md。
 */

export const ARTIFACT_VERSION_SCHEMA = "nbdev.artifact-version/v1";
export const ANSWER_SCHEMA = "nbdev.answer/v1";
export const ACK_SCHEMA = "nbdev.answer-ack/v1";
export const ARTIFACT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const MAX_ARTIFACT_ID_LENGTH = 48;
/** Task 的提问集（没有页面的产物）的保留名。 */
export const QUESTIONS_ARTIFACT = "questions";
export const PUBLISHABLE_KINDS = ["design", "report", "review"] as const;
export type ArtifactKind = (typeof PUBLISHABLE_KINDS)[number] | "questions";
export type VersionAction = "publish" | "close" | "ask" | "withdraw" | "supersede";
/** 答复与确认的 id：UTC 毫秒时间加 8 位 hex；在锁内单调生成，字典序就是落位的顺序。 */
export const RECORD_ID_PATTERN = /^([0-9]{8}T[0-9]{9}Z)-([0-9a-f]{8})$/u;
const VERSION_FILE_PATTERN = /^v([1-9][0-9]*)\.json$/u;
const ACK_PREFIX = "ack-";

/** `taskId` 为 null 的是 Work 级的产物（只索引，不能经命令行写）。 */
export type ArtifactRef = {workId: string; taskId: string | null; artifactId: string};
export type QuestionRef = {workId: string; taskId: string; artifactId: string; questionId: string};
export type QuestionOutcome =
    | null
    | {kind: "withdrawn"; in: number; reason: "explicit" | "closed"}
    | {kind: "superseded"; in: number; by: QuestionRef | null};
export type VersionQuestion = QuestionDefinition & {origin: "markup" | "ask"; page: string | null; about: string | null; since: number; outcome: QuestionOutcome};
export type ArtifactVersion = {
    schema: typeof ARTIFACT_VERSION_SCHEMA;
    workId: string;
    taskId: string | null;
    artifactId: string;
    version: number;
    supersedes: number | null;
    action: VersionAction;
    kind: ArtifactKind;
    title: string;
    state: "open" | "closed";
    entry: string | null;
    contentHash: string | null;
    /**
     * 这一版文件集里的路径（相对产物目录，UTF-8 字节序）；Task 的提问集为 null，旧记录没有这个字段时读成空清单。
     * 发布记录先落盘、`git add` 后执行：add 失败时 `--include` 的文件还没被跟踪，面板与下一次发布靠这份清单找回同一个文件集。
     */
    files: string[] | null;
    questions: VersionQuestion[];
    publishedAt: string;
};
export type SubmittedBy = {kind: "developer"; device: string} | {kind: "agent-transcribed"};
export type AnswerRecord = {
    schema: typeof ANSWER_SCHEMA;
    workId: string;
    taskId: string | null;
    artifactId: string;
    answerId: string;
    artifactVersion: number;
    contentHash: string | null;
    submittedAt: string;
    submittedBy: SubmittedBy;
    values: Record<string, unknown>;
    comments: Record<string, string>;
    note: string | null;
};
export type AckRecord = {
    schema: typeof ACK_SCHEMA;
    workId: string;
    taskId: string | null;
    artifactId: string;
    ackId: string;
    answers: string[];
    through: string;
    included: string[];
    ackedAt: string;
};

export function assertArtifactId(artifactId: string): void {
    if (!ARTIFACT_ID_PATTERN.test(artifactId) || artifactId.length > MAX_ARTIFACT_ID_LENGTH) {
        throw new NbdevError("invalid_artifact_id", `产物 id 只能用小写字母、数字与连字符，最长 ${MAX_ARTIFACT_ID_LENGTH} 个字符：${artifactId}`, {details: {artifactId}});
    }
}

export function artifactsRootPath(workId: string, taskId: string | null): string {
    return taskId === null ? `${WORKS_ROOT}/${workId}/artifacts` : `${WORKS_ROOT}/${workId}/tasks/${taskId}/artifacts`;
}

export function artifactDirPath(ref: ArtifactRef): string {
    return `${artifactsRootPath(ref.workId, ref.taskId)}/${ref.artifactId}`;
}

export function versionPath(ref: ArtifactRef, version: number): string {
    return `${artifactDirPath(ref)}/versions/v${version}.json`;
}

export function answerPath(ref: ArtifactRef, answerId: string): string {
    return `${artifactDirPath(ref)}/answers/${answerId}.json`;
}

export function ackPath(ref: ArtifactRef, ackId: string): string {
    return `${artifactDirPath(ref)}/answers/${ACK_PREFIX}${ackId}.json`;
}

export function sha256Hex(content: string | Buffer): string {
    return createHash("sha256").update(content).digest("hex");
}

// ---------- 文件格式的校验 ----------

type Parsed<T> = {record: T} | {problem: string; unsupported?: boolean};

function parseJson(text: string): {value: unknown} | {problem: string} {
    try {
        return {value: JSON.parse(text)};
    } catch (error) {
        return {problem: `不是合法 JSON：${error instanceof Error ? error.message : String(error)}`};
    }
}

function identityProblem(value: Record<string, unknown>, ref: ArtifactRef): string | null {
    if (value.workId !== ref.workId || value.taskId !== ref.taskId || value.artifactId !== ref.artifactId) return "workId、taskId、artifactId 与所在目录不一致";
    return null;
}

function parseOptions(value: unknown): QuestionOption[] | null {
    if (!Array.isArray(value)) return null;
    const options: QuestionOption[] = [];
    for (const entry of value) {
        if (!isRecord(entry) || typeof entry.value !== "string" || typeof entry.label !== "string") return null;
        options.push({value: entry.value, label: entry.label});
    }
    return options;
}

function parseQuestionRef(value: unknown): QuestionRef | null | undefined {
    if (value === null) return null;
    if (!isRecord(value) || typeof value.workId !== "string" || typeof value.taskId !== "string" || typeof value.artifactId !== "string" || typeof value.questionId !== "string") return undefined;
    return {workId: value.workId, taskId: value.taskId, artifactId: value.artifactId, questionId: value.questionId};
}

function parseOutcome(value: unknown): QuestionOutcome | undefined {
    if (value === null) return null;
    if (!isRecord(value) || !Number.isInteger(value.in) || (value.in as number) < 1) return undefined;
    if (value.kind === "withdrawn" && (value.reason === "explicit" || value.reason === "closed")) return {kind: "withdrawn", in: value.in as number, reason: value.reason};
    if (value.kind === "superseded") {
        const by = parseQuestionRef(value.by);
        return by === undefined ? undefined : {kind: "superseded", in: value.in as number, by};
    }
    return undefined;
}

function parseVersionQuestion(value: unknown): VersionQuestion | string {
    if (!isRecord(value) || typeof value.id !== "string" || !QUESTION_ID_PATTERN.test(value.id)) return "题的 id 不合格式";
    if (typeof value.type !== "string" || !(QUESTION_TYPES as readonly string[]).includes(value.type)) return `题 ${value.id} 的类型不合规`;
    const options = parseOptions(value.options);
    if (typeof value.label !== "string" || !options || typeof value.required !== "boolean" || !isStringArray(value.recommend)) return `题 ${value.id} 的 label、options、required、recommend 不合规`;
    if ((value.origin !== "markup" && value.origin !== "ask") || !isNullableString(value.page) || !isNullableString(value.about) || !Number.isInteger(value.since) || (value.since as number) < 1) {
        return `题 ${value.id} 的 origin、page、about、since 不合规`;
    }
    const outcome = parseOutcome(value.outcome);
    if (outcome === undefined) return `题 ${value.id} 的 outcome 不合规`;
    return {
        id: value.id,
        type: value.type as QuestionType,
        label: value.label,
        options,
        required: value.required,
        recommend: value.recommend,
        origin: value.origin,
        page: value.page,
        about: value.about,
        since: value.since as number,
        outcome,
    };
}

export function parseArtifactVersion(text: string, ref: ArtifactRef, version: number): Parsed<ArtifactVersion> {
    const json = parseJson(text);
    if ("problem" in json) return json;
    const value = json.value;
    if (!isRecord(value)) return {problem: "不是对象"};
    if (isOtherSchemaVersion(value.schema, ARTIFACT_VERSION_SCHEMA)) return {problem: `不认识的 schema：${String(value.schema)}`, unsupported: true};
    if (value.schema !== ARTIFACT_VERSION_SCHEMA) return {problem: `schema 不是 ${ARTIFACT_VERSION_SCHEMA}`};
    const identity = identityProblem(value, ref);
    if (identity) return {problem: identity};
    if (value.version !== version) return {problem: "version 与文件名不一致"};
    if (!(value.supersedes === null || (Number.isInteger(value.supersedes) && (value.supersedes as number) < version))) return {problem: "supersedes 不合规"};
    if (!["publish", "close", "ask", "withdraw", "supersede"].includes(value.action as string)) return {problem: "action 不合规"};
    if (![...PUBLISHABLE_KINDS, "questions"].includes(value.kind as string)) return {problem: "kind 不合规"};
    if (typeof value.title !== "string" || (value.state !== "open" && value.state !== "closed") || !isNullableString(value.entry) || !isNullableString(value.contentHash)) {
        return {problem: "title、state、entry、contentHash 不合规"};
    }
    const files = value.files === undefined ? (value.kind === "questions" ? null : []) : value.files;
    if (!(files === null || isStringArray(files))) return {problem: "files 不合规"};
    if (!isIsoTime(value.publishedAt) || !Array.isArray(value.questions)) return {problem: "publishedAt 或 questions 不合规"};
    const questions: VersionQuestion[] = [];
    const seen = new Set<string>();
    for (const entry of value.questions) {
        const question = parseVersionQuestion(entry);
        if (typeof question === "string") return {problem: question};
        if (seen.has(question.id)) return {problem: `题号重复：${question.id}`};
        seen.add(question.id);
        questions.push(question);
    }
    return {
        record: {
            schema: ARTIFACT_VERSION_SCHEMA,
            workId: ref.workId,
            taskId: ref.taskId,
            artifactId: ref.artifactId,
            version,
            supersedes: value.supersedes as number | null,
            action: value.action as VersionAction,
            kind: value.kind as ArtifactKind,
            title: value.title,
            state: value.state,
            entry: value.entry,
            contentHash: value.contentHash,
            files: files === null ? null : [...files],
            questions,
            publishedAt: value.publishedAt,
        },
    };
}

function parseSubmittedBy(value: unknown): SubmittedBy | null {
    if (!isRecord(value)) return null;
    if (value.kind === "developer" && typeof value.device === "string") return {kind: "developer", device: value.device};
    if (value.kind === "agent-transcribed") return {kind: "agent-transcribed"};
    return null;
}

export function parseAnswer(text: string, ref: ArtifactRef, answerId: string): Parsed<AnswerRecord> {
    const json = parseJson(text);
    if ("problem" in json) return json;
    const value = json.value;
    if (!isRecord(value)) return {problem: "不是对象"};
    if (isOtherSchemaVersion(value.schema, ANSWER_SCHEMA)) return {problem: `不认识的 schema：${String(value.schema)}`, unsupported: true};
    if (value.schema !== ANSWER_SCHEMA) return {problem: `schema 不是 ${ANSWER_SCHEMA}`};
    const identity = identityProblem(value, ref);
    if (identity) return {problem: identity};
    if (value.answerId !== answerId) return {problem: "answerId 与文件名不一致"};
    if (!Number.isInteger(value.artifactVersion) || (value.artifactVersion as number) < 1 || !isNullableString(value.contentHash)) return {problem: "artifactVersion 或 contentHash 不合规"};
    const submittedBy = parseSubmittedBy(value.submittedBy);
    if (!isIsoTime(value.submittedAt) || !submittedBy) return {problem: "submittedAt 或 submittedBy 不合规"};
    if (!isRecord(value.values) || !isNullableString(value.note)) return {problem: "values 或 note 不合规"};
    const comments = value.comments === undefined ? {} : value.comments;
    if (!isRecord(comments) || !Object.values(comments).every((entry) => typeof entry === "string")) return {problem: "comments 不合规"};
    return {
        record: {
            schema: ANSWER_SCHEMA,
            workId: ref.workId,
            taskId: ref.taskId,
            artifactId: ref.artifactId,
            answerId,
            artifactVersion: value.artifactVersion as number,
            contentHash: value.contentHash,
            submittedAt: value.submittedAt,
            submittedBy,
            values: {...value.values},
            comments: {...comments} as Record<string, string>,
            note: value.note,
        },
    };
}

export function parseAck(text: string, ref: ArtifactRef, ackId: string): Parsed<AckRecord> {
    const json = parseJson(text);
    if ("problem" in json) return json;
    const value = json.value;
    if (!isRecord(value)) return {problem: "不是对象"};
    if (isOtherSchemaVersion(value.schema, ACK_SCHEMA)) return {problem: `不认识的 schema：${String(value.schema)}`, unsupported: true};
    if (value.schema !== ACK_SCHEMA) return {problem: `schema 不是 ${ACK_SCHEMA}`};
    const identity = identityProblem(value, ref);
    if (identity) return {problem: identity};
    if (value.ackId !== ackId) return {problem: "ackId 与文件名不一致"};
    if (!isStringArray(value.answers) || value.answers.some((id) => !RECORD_ID_PATTERN.test(id)) || typeof value.through !== "string" || !isStringArray(value.included) || !isIsoTime(value.ackedAt)) {
        return {problem: "answers、through、included、ackedAt 不合规"};
    }
    return {record: {schema: ACK_SCHEMA, workId: ref.workId, taskId: ref.taskId, artifactId: ref.artifactId, ackId, answers: [...value.answers], through: value.through, included: [...value.included], ackedAt: value.ackedAt}};
}

// ---------- 读取 ----------

async function readDirectory(path: string): Promise<string[]> {
    try {
        return await readdir(path);
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return [];
        throw error;
    }
}

async function readTextOrNull(path: string): Promise<string | null> {
    try {
        return await readFile(path, "utf8");
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT") return null;
        throw error;
    }
}

function unreadable(path: string, parsed: {problem: string; unsupported?: boolean}): Warning {
    return parsed.unsupported
        ? {code: "schema_unsupported", message: `不认识的文件格式，已跳过：${path}（${parsed.problem}）`, details: {path}}
        : {code: "unreadable_artifact_record", message: `产物文件读不出，已跳过：${path}（${parsed.problem}）`, details: {path, problem: parsed.problem}};
}

/** 一个产物目录（`artifacts/` 下）里的产物 id；只读这一层。 */
export async function listArtifactIds(root: string, workId: string, taskId: string | null): Promise<string[]> {
    const dir = resolve(root, artifactsRootPath(workId, taskId));
    let entries;
    try {
        entries = await readdir(dir, {withFileTypes: true});
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return [];
        throw error;
    }
    return entries.filter((entry) => entry.isDirectory() && ARTIFACT_ID_PATTERN.test(entry.name) && entry.name.length <= MAX_ARTIFACT_ID_LENGTH).map((entry) => entry.name).sort();
}

/** 一个产物已有的发布记录版本号（升序，含读不出的）。 */
export async function listVersionNumbers(root: string, ref: ArtifactRef): Promise<number[]> {
    const names = await readDirectory(resolve(root, artifactDirPath(ref), "versions"));
    return names.flatMap((name) => {
        const match = VERSION_FILE_PATTERN.exec(name);
        return match ? [Number(match[1])] : [];
    }).sort((left, right) => left - right);
}

export async function readArtifactVersion(root: string, ref: ArtifactRef, version: number, warnings: Warning[]): Promise<ArtifactVersion | null> {
    const path = versionPath(ref, version);
    const text = await readTextOrNull(resolve(root, path));
    if (text === null) return null;
    const parsed = parseArtifactVersion(text, ref, version);
    if ("record" in parsed) return parsed.record;
    warnings.push(unreadable(path, parsed));
    return null;
}

/** `answers/` 里的文件名（答复与确认的 id 都在这里）；`--wait` 每秒只做这一次 readdir。 */
export async function listAnswerFileNames(root: string, ref: ArtifactRef): Promise<string[]> {
    return (await readDirectory(resolve(root, artifactDirPath(ref), "answers"))).filter((name) => name.endsWith(".json")).sort();
}

export type ArtifactSnapshot = {
    ref: ArtifactRef;
    versions: number[];
    /** 最新的一份发布记录；最新那份读不出时为 null（并有警告），不退回更早的版本。 */
    latest: ArtifactVersion | null;
    /** `version` 指定的那一版（没指定时同 `latest`）。 */
    selected: ArtifactVersion | null;
    answers: AnswerRecord[];
    acks: AckRecord[];
    /** 答复针对的旧版本：只读取值按最新一版不合法的答复针对的那些，`questionStates` 用它区分 `stale_value` 与 `invalid_value`。 */
    answeredVersions: ReadonlyMap<number, ArtifactVersion>;
    warnings: Warning[];
};

/** 读一个产物：发布记录（最新一版或指定的一版）、全部答复与确认。答复与确认按 id 排序；读不出的给警告后跳过。 */
export async function readArtifact(root: string, ref: ArtifactRef, options: {version?: number} = {}): Promise<ArtifactSnapshot> {
    const warnings: Warning[] = [];
    const versions = await listVersionNumbers(root, ref);
    const newest = versions.at(-1);
    const latest = newest === undefined ? null : await readArtifactVersion(root, ref, newest, warnings);
    const selected = options.version === undefined || options.version === newest ? latest : await readArtifactVersion(root, ref, options.version, warnings);
    const answers: AnswerRecord[] = [];
    const acks: AckRecord[] = [];
    const dir = `${artifactDirPath(ref)}/answers`;
    for (const name of await listAnswerFileNames(root, ref)) {
        const stem = name.slice(0, -".json".length);
        const isAck = stem.startsWith(ACK_PREFIX);
        const id = isAck ? stem.slice(ACK_PREFIX.length) : stem;
        if (!RECORD_ID_PATTERN.test(id)) continue;
        const text = await readTextOrNull(resolve(root, dir, name));
        if (text === null) continue;
        if (isAck) {
            const parsed = parseAck(text, ref, id);
            if ("record" in parsed) acks.push(parsed.record);
            else warnings.push(unreadable(`${dir}/${name}`, parsed));
        } else {
            const parsed = parseAnswer(text, ref, id);
            if ("record" in parsed) answers.push(parsed.record);
            else warnings.push(unreadable(`${dir}/${name}`, parsed));
        }
    }
    const answeredVersions = new Map<number, ArtifactVersion>();
    for (const answer of answers) {
        const target = answer.artifactVersion;
        if (!latest || target === latest.version || answeredVersions.has(target) || !versions.includes(target)) continue;
        const invalidNow = Object.entries(answer.values).some(([questionId, value]) => {
            const definition = latest.questions.find((question) => question.id === questionId);
            return definition !== undefined && validateAnswerValue(definition, value) !== null;
        });
        if (!invalidNow) continue;
        const record = await readArtifactVersion(root, ref, target, warnings);
        if (record) answeredVersions.set(target, record);
    }
    return {ref, versions, latest, selected, answers, acks, answeredVersions, warnings};
}

// ---------- 现算 ----------

export type QuestionStateName = "open" | "answered" | "withdrawn" | "superseded";
export type AnswerUse = {answerId: string; value: unknown; artifactVersion: number; submittedAt: string; comment: string | null};
/** 旧答复为什么作废：`stale_value` 是按它针对的那一版合法、按最新一版不合法（选项后来改了）；`invalid_value` 是按它针对的那一版也不合法（手改坏的文件，或那一版读不出）。 */
export type StaleCode = "stale_value" | "invalid_value";
export type QuestionState = {
    question: VersionQuestion;
    state: QuestionStateName;
    /** 按最新一版的定义合法的最新取值；撤回或取代的题也照常给出，便于显示。 */
    answer: AnswerUse | null;
    /** 最新的取值按最新一版不合法：题回到 open，旧答复列在这里。 */
    stale: (AnswerUse & {reason: string; code: StaleCode}) | null;
};

/**
 * 每道题的状态：结局优先；否则看这道题最新的一份答复，取值按最新一版的题目定义校验，合法即 answered，
 * 不合法回到 open 并列出那份旧答复（不往前找更早的答复：开发者最后的意思已经作废）。
 * `answeredVersions` 是答复针对的旧版本（`ArtifactSnapshot.answeredVersions`），缺了某一版时那份答复记 `invalid_value`。
 */
export function questionStates(version: ArtifactVersion, answers: readonly AnswerRecord[], answeredVersions: ReadonlyMap<number, ArtifactVersion>): QuestionState[] {
    const ordered = [...answers].sort((left, right) => left.answerId.localeCompare(right.answerId));
    return version.questions.map((question) => {
        const latest = ordered.filter((answer) => Object.hasOwn(answer.values, question.id)).at(-1);
        const use: AnswerUse | null = latest
            ? {answerId: latest.answerId, value: latest.values[question.id], artifactVersion: latest.artifactVersion, submittedAt: latest.submittedAt, comment: latest.comments[question.id] ?? null}
            : null;
        const reason = use ? validateAnswerValue(question, use.value) : null;
        const answer = use && reason === null ? use : null;
        const stale = use && reason !== null ? {...use, reason, code: staleCode(question.id, use, version, answeredVersions)} : null;
        const state: QuestionStateName = question.outcome ? question.outcome.kind : answer ? "answered" : "open";
        return {question, state, answer, stale};
    });
}

/**
 * 等开发者答的题：open、属于这一版、开发者还没理过。之前几版留下的题（`isEarlierPageQuestion`）答复作废时也是 open，但它不再收答复，
 * 不能算待答。必答题答了才算理过；选答题（题的缺省）在它出现之后交过一次答复就算理过：开发者看过这块板，没答的是不想答，不再催
 * （开发者 11-05：评审默认选答）。一次也没交的板要关掉才离开收件箱。收件箱、产物的 `waiting`、`answers --pending` 与 Task 收尾的提醒共用这一条。
 */
export function waitingStates(states: readonly QuestionState[], answers: readonly AnswerRecord[]): QuestionState[] {
    const lastAnswered = answers.reduce((latest, answer) => Math.max(latest, answer.artifactVersion), 0);
    return states.filter((state) => state.state === "open" && !isEarlierPageQuestion(state.question) && (state.question.required || state.question.since > lastAnswered));
}

function staleCode(questionId: string, use: AnswerUse, latest: ArtifactVersion, answeredVersions: ReadonlyMap<number, ArtifactVersion>): StaleCode {
    const target = use.artifactVersion === latest.version ? latest : answeredVersions.get(use.artifactVersion);
    const definition = target?.questions.find((question) => question.id === questionId);
    return definition !== undefined && validateAnswerValue(definition, use.value) === null ? "stale_value" : "invalid_value";
}

/** 答复 id 不在任何一份确认的 `answers[]` 里，就算未确认（集合差；`through` 只用于显示）。 */
export function unackedAnswers(answers: readonly AnswerRecord[], acks: readonly AckRecord[]): AnswerRecord[] {
    const acked = new Set(acks.flatMap((ack) => ack.answers));
    return answers.filter((answer) => !acked.has(answer.answerId));
}

/** id 大于游标的答复（`--wait --since` 与 t11 的通知游标共用；id 在锁内单调生成，游标可靠）。 */
export function answersAfter(answers: readonly AnswerRecord[], cursor: string | null): AnswerRecord[] {
    return cursor === null ? [...answers] : answers.filter((answer) => answer.answerId > cursor);
}

export type Adoption = "none" | "waiting" | "adopted";

/** 采纳状态：有未确认的答复为“等会话采纳”，有答复且都已确认为“已采纳”。 */
export function adoptionOf(answers: readonly AnswerRecord[], acks: readonly AckRecord[]): Adoption {
    if (answers.length === 0) return "none";
    return unackedAnswers(answers, acks).length > 0 ? "waiting" : "adopted";
}

function compactUtc(ms: number): string {
    return new Date(ms).toISOString().replace(/[-:.]/gu, "");
}

function idTime(id: string): number | null {
    const match = RECORD_ID_PATTERN.exec(id.startsWith(ACK_PREFIX) ? id.slice(ACK_PREFIX.length) : id);
    if (!match) return null;
    const stamp = match[1]!;
    return Date.UTC(Number(stamp.slice(0, 4)), Number(stamp.slice(4, 6)) - 1, Number(stamp.slice(6, 8)), Number(stamp.slice(9, 11)), Number(stamp.slice(11, 13)), Number(stamp.slice(13, 15)), Number(stamp.slice(15, 18)));
}

/**
 * 新的答复或确认 id：时间取 `max(now, 目录里最大的 id 的时间 + 1 毫秒)`。必须在写事务的锁内、用锁内重读的时钟调用：
 * 锁之前读的时钟可能早于先拿到锁的别人，按字典序会排到前面，游标就漏掉它。
 */
export function nextRecordId(existing: readonly string[], now: Date, suffix: string = randomBytes(4).toString("hex")): string {
    const latest = Math.max(-Infinity, ...existing.map(idTime).filter((time): time is number => time !== null));
    return `${compactUtc(Math.max(now.getTime(), latest + 1))}-${suffix}`;
}

export type NextQuestionsInput = {
    previous: ArtifactVersion | null;
    markup: readonly MarkupQuestion[];
    version: number;
    keep: readonly string[];
    /** 上一版里已答（`answered`）的题。 */
    answeredIds: ReadonlySet<string>;
};
export type NextQuestionsResult = {
    questions: VersionQuestion[];
    /** 页面里没有了、还没答、被本版取代的题。 */
    dropped: string[];
    /** 已撤回或已取代、又出现在页面里的题（不复活）。 */
    retiredInPage: string[];
    /** 产物重新打开时恢复的题：因关闭而撤回、页面里还在的，以及 `ask` 登记的。 */
    restored: string[];
    problems: Array<{code: string; message: string; questionId: string}>;
};

/**
 * 发布时由上一版与页面标记生成新的题表。顺序：上一版的题保持原位，新题按页面顺序接在后面。
 * 只有还没答的题会因“页面里没有了”被取代；已答的题保留、`page` 记 null（审查报告进入下一轮时删掉已处理的条目是常态）。
 */
export function nextQuestions(input: NextQuestionsInput): NextQuestionsResult {
    const {previous, version} = input;
    const reopen = previous?.state === "closed";
    const result: NextQuestionsResult = {questions: [], dropped: [], retiredInPage: [], restored: [], problems: []};
    const markupById = new Map(input.markup.map((question) => [question.id, question]));
    const fromMarkup = (question: MarkupQuestion): Pick<VersionQuestion, "id" | "type" | "label" | "options" | "required" | "recommend" | "page"> => ({
        id: question.id, type: question.type, label: question.label, options: question.options, required: question.required, recommend: question.recommend, page: question.page,
    });
    const handled = new Set<string>();
    for (const prior of previous?.questions ?? []) {
        const current = markupById.get(prior.id);
        if (current && prior.origin === "ask") {
            result.problems.push({code: "duplicate_question", questionId: prior.id, message: `题号 ${prior.id} 已由 nbdev ask 登记，页面里不能再用`});
            result.questions.push(prior);
        } else if (current && prior.outcome) {
            if (reopen && prior.outcome.kind === "withdrawn" && prior.outcome.reason === "closed") {
                result.questions.push({...prior, ...fromMarkup(current), outcome: null});
                result.restored.push(prior.id);
            } else {
                result.questions.push(prior);
                result.retiredInPage.push(prior.id);
            }
        } else if (current) {
            result.questions.push({...prior, ...fromMarkup(current), origin: "markup"});
        } else if (reopen && prior.origin === "ask" && prior.outcome?.kind === "withdrawn" && prior.outcome.reason === "closed") {
            // `ask` 登记的题不在页面里（Markdown 入口的产物只有这种题）：因关闭而撤回的随重新打开一并恢复，否则题号作废、也不能再登记。
            result.questions.push({...prior, outcome: null});
            result.restored.push(prior.id);
        } else if (prior.origin === "ask" || prior.outcome || input.keep.includes(prior.id)) {
            result.questions.push(prior);
        } else if (input.answeredIds.has(prior.id)) {
            result.questions.push({...prior, page: null});
        } else {
            result.questions.push({...prior, outcome: {kind: "superseded", in: version, by: null}});
            result.dropped.push(prior.id);
        }
        handled.add(prior.id);
    }
    for (const question of input.markup) {
        if (handled.has(question.id)) continue;
        result.questions.push({...fromMarkup(question), origin: "markup", about: null, since: version, outcome: null});
    }
    for (const id of input.keep) {
        const prior = previous?.questions.find((question) => question.id === id);
        if (prior && !prior.outcome && isEarlierPageQuestion(prior) && !markupById.has(id)) {
            // --keep 只是原样保留，留不回页面：之前几版的题保留下来仍不收答复，开发者会以为它又能答了。
            result.problems.push({code: "keep_not_applicable", questionId: id, message: `--keep ${id} 不适用：它是之前几版的题（已答、页面上早就没有了），保留了也不能再答；要重新问，就把它放回页面`});
        } else if (!prior || prior.outcome || prior.origin !== "markup" || markupById.has(id)) {
            result.problems.push({code: "keep_not_applicable", questionId: id, message: `--keep ${id} 不适用：只能保留上一版来自页面、还活着、这次页面里没有的题`});
        }
    }
    return result;
}

/** 关闭产物：`open` 的题记成因关闭而撤回；已答的题不动。 */
export function closeQuestions(previous: ArtifactVersion, answeredIds: ReadonlySet<string>, version: number): {questions: VersionQuestion[]; withdrawn: string[]} {
    const withdrawn: string[] = [];
    const questions = previous.questions.map((question): VersionQuestion => {
        if (question.outcome || answeredIds.has(question.id)) return question;
        withdrawn.push(question.id);
        return {...question, outcome: {kind: "withdrawn", in: version, reason: "closed"}};
    });
    return {questions, withdrawn};
}

// ---------- 页面文件、文件集与 contentHash ----------

export type ArtifactFile = {path: string; size: number};

export const PAGE_PATTERN = /\.html?$/iu;
export const STYLE_PATTERN = /\.css$/iu;
export const SCRIPT_PATTERN = /\.m?js$/iu;

function byUtf8(left: string, right: string): number {
    return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/**
 * 产物目录里 Git 会跟踪的页面文件（已跟踪的加上没被忽略的新文件，只算磁盘上还在的），路径相对产物目录、按 UTF-8 字节序排列；
 * 不含 `versions/` 与 `answers/`。这是文件集的候选，文件集只从这里取。遇到符号链接就拒绝：链接指向的内容不在产物里，哈希与提交都会对不上。
 */
export async function listArtifactFiles(mainRoot: string, ref: ArtifactRef): Promise<ArtifactFile[]> {
    const dir = artifactDirPath(ref);
    const listed = splitNul(await gitOutput(mainRoot, ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", `${dir}/`], {readOnly: true}));
    const files: ArtifactFile[] = [];
    for (const repoPath of new Set(listed)) {
        const path = repoPath.slice(dir.length + 1);
        if (path.startsWith("versions/") || path.startsWith("answers/")) continue;
        let stats;
        try {
            stats = await lstat(resolve(mainRoot, repoPath));
        } catch (error) {
            if (systemErrorCode(error) === "ENOENT") continue;
            throw error;
        }
        if (stats.isSymbolicLink()) throw new NbdevError("unsafe_path", `产物目录里有符号链接，不能发布：${repoPath}`, {details: {path: repoPath}});
        if (stats.isFile()) files.push({path, size: stats.size});
    }
    return files.sort((left, right) => byUtf8(left.path, right.path));
}

function decodeURIComponentSafe(path: string): string {
    try {
        return decodeURIComponent(path);
    } catch (error) {
        // 不是合法的百分号编码：按字面路径判断。
        if (!(error instanceof URIError)) throw error;
        return path;
    }
}

/** 一处引用归一化之后：`external` 是带协议的、`//` 开头的与页内锚点，不归产物管；`outside` 是 `/` 开头的或指出了产物目录。 */
export type ResolvedReference = {kind: "external"} | {kind: "outside"} | {kind: "local"; path: string};

/** 把 `from`（相对产物目录的文件）里写的引用归一化：去掉 `?…`、`#…`，百分号解码（解码失败按字面），按 `from` 所在目录解析。 */
export function resolveReference(from: string, target: string): ResolvedReference {
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target) || target.startsWith("//") || target.startsWith("#")) return {kind: "external"};
    const path = target.replace(/[?#].*$/u, "");
    if (path === "") return {kind: "external"};
    if (path.startsWith("/")) return {kind: "outside"};
    const resolved = posix.normalize(posix.join(posix.dirname(from), decodeURIComponentSafe(path)));
    if (resolved === ".." || resolved.startsWith("../")) return {kind: "outside"};
    return {kind: "local", path: resolved};
}

/** 文件集里的文件写下的一处引用；`path` 为 null 表示指向产物目录之外。带协议的等不归产物管的引用不列。 */
export type ArtifactReference = {page: string; line: number | null; target: string; path: string | null};

export type ArtifactFileSet = {
    /** 文件集，路径相对产物目录、按 UTF-8 字节序排列。 */
    files: ArtifactFile[];
    /** 候选里不在文件集里的文件（都没被跟踪），仓库根相对路径。 */
    unreferenced: string[];
    /** 文件集里的页面与解析结果，按路径排列。 */
    pages: Array<{page: string; markup: ParsedMarkup}>;
    /** 文件集里各文件写下的引用；文件集的闭包与引用检查共用这一份。 */
    references: ArtifactReference[];
    /** 文件集里的页面（内联脚本、模板）或脚本文件写了提问标记。 */
    scriptMarkers: boolean;
};

/**
 * 产物的文件集：从种子出发、沿引用做广度遍历直到不再增长，只取 `listArtifactFiles` 的候选。种子是入口、已跟踪的文件（`git ls-files --cached`）
 * 与调用方给的 `seeds`（上一版的 `files` 与题所在的页面见 `versionSeeds`，再加 `--include`）；种子本身引用的文件同样追进来，
 * 已经发布过的内容不会因为页面不再链接它而从哈希、提交与题表里掉出去。规则见 docs/file-formats.md 的“发布记录”。
 * 页面经 `parseQuestionMarkup` 解析（按需加载 parse5），所以只在发布与面板的产物页上调用，`status` 不走这里。
 */
export async function artifactFileSet(root: string, ref: ArtifactRef, input: {entry: string | null; seeds: readonly string[]}): Promise<ArtifactFileSet> {
    const dir = artifactDirPath(ref);
    const candidates = new Map((await listArtifactFiles(root, ref)).map((file) => [file.path, file]));
    const tracked = splitNul(await gitOutput(root, ["ls-files", "-z", "--cached", "--", `${dir}/`], {readOnly: true})).map((path) => path.slice(dir.length + 1));
    const included = new Set<string>();
    const queue: string[] = [];
    const add = (path: string) => {
        if (!candidates.has(path) || included.has(path)) return;
        included.add(path);
        queue.push(path);
    };
    if (input.entry !== null) add(input.entry);
    for (const path of [...tracked, ...input.seeds]) add(path);

    const pages: ArtifactFileSet["pages"] = [];
    const references: ArtifactReference[] = [];
    let scriptMarkers = false;
    while (queue.length > 0) {
        const path = queue.shift()!;
        const found: Array<{target: string; line: number | null}> = [];
        const read = () => readFile(resolve(root, dir, path), "utf8");
        if (PAGE_PATTERN.test(path)) {
            const markup = await parseQuestionMarkup(await read(), path);
            pages.push({page: path, markup});
            found.push(...markup.references);
            scriptMarkers ||= markup.scriptMarkers;
        } else if (STYLE_PATTERN.test(path)) {
            found.push(...cssReferences(await read()).map(({target, lineOffset}) => ({target, line: lineOffset + 1})));
        } else if (SCRIPT_PATTERN.test(path)) {
            const text = await read();
            scriptMarkers ||= scriptWritesQuestionMarkup(text);
            found.push(...scriptImports(text).map(({target, lineOffset}) => ({target, line: lineOffset + 1})));
        }
        for (const {target, line} of found) {
            const resolved = resolveReference(path, target);
            if (resolved.kind === "external") continue;
            references.push({page: path, line, target, path: resolved.kind === "local" ? resolved.path : null});
            if (resolved.kind === "local") add(resolved.path);
        }
    }
    const order = (left: {page: string}, right: {page: string}) => byUtf8(left.page, right.page);
    return {
        files: [...included].sort(byUtf8).map((path) => candidates.get(path)!),
        unreferenced: [...candidates.keys()].filter((path) => !included.has(path)).map((path) => `${dir}/${path}`),
        pages: pages.sort(order),
        // 稳定排序：同一个文件里的引用保持出现的先后。
        references: references.sort(order),
        scriptMarkers,
    };
}

/** 一版发布记录留给下一次发布与面板的种子：这一版的 `files`，以及题表里题所在的页面（没被链接、但有题的页面不会被当作删了）。 */
export function versionSeeds(version: ArtifactVersion | null): string[] {
    if (!version) return [];
    return [...(version.files ?? []), ...version.questions.flatMap((question) => (question.page === null ? [] : [question.page]))];
}

/** 产物内容的哈希：对文件集里每个文件的“路径、NUL、文件 sha256、换行”逐行求 sha256。t09 用它判断发布之后页面有没有被改过。 */
export async function artifactContentHash(root: string, ref: ArtifactRef, files: readonly ArtifactFile[]): Promise<string> {
    const hash = createHash("sha256");
    const dir = artifactDirPath(ref);
    for (const file of files) {
        hash.update(`${file.path}\0${sha256Hex(await readFile(resolve(root, dir, file.path)))}\n`);
    }
    return hash.digest("hex");
}

/**
 * 按最新一版的种子重算磁盘上的哈希（面板的“发布后有改动”）；种子与发布时相同，`--include` 已经记在 `files` 里。
 * 没有页面的版本（Task 的提问集）返回 null。产物目录里有符号链接时抛 `unsafe_path`。
 */
export async function currentContentHash(root: string, ref: ArtifactRef, latest: ArtifactVersion): Promise<string | null> {
    if (latest.entry === null || latest.contentHash === null) return null;
    const set = await artifactFileSet(root, ref, {entry: latest.entry, seeds: versionSeeds(latest)});
    return artifactContentHash(root, ref, set.files);
}

// ---------- 文档类产物 ----------

export type DocumentEntry = {path: string; title: string | null};

/** 目录第一层除 README.md 外的 Markdown：文档类产物，按文件索引，没有发布记录。`dir` 相对 `root`。 */
export async function listDocuments(root: string, dir: string): Promise<DocumentEntry[]> {
    let entries;
    try {
        entries = await readdir(resolve(root, dir), {withFileTypes: true});
    } catch (error) {
        if (systemErrorCode(error) === "ENOENT" || systemErrorCode(error) === "ENOTDIR") return [];
        throw error;
    }
    const documents: DocumentEntry[] = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".md") && candidate.name !== "README.md").sort((left, right) => left.name.localeCompare(right.name))) {
        const text = await readTextOrNull(join(resolve(root, dir), entry.name));
        documents.push({path: `${dir}/${entry.name}`, title: text === null ? null : readTitle(text)});
    }
    return documents;
}

/** 一个 Task 的产物里还在等开发者答的题（`task status … done` 的提醒）。 */
export async function waitingQuestionsOfTask(root: string, workId: string, taskId: string, warnings: Warning[] = []): Promise<Array<{artifactId: string; version: number; question: VersionQuestion}>> {
    const open: Array<{artifactId: string; version: number; question: VersionQuestion}> = [];
    for (const artifactId of await listArtifactIds(root, workId, taskId)) {
        const snapshot = await readArtifact(root, {workId, taskId, artifactId});
        warnings.push(...snapshot.warnings);
        if (!snapshot.latest) continue;
        for (const state of waitingStates(questionStates(snapshot.latest, snapshot.answers, snapshot.answeredVersions), snapshot.answers)) {
            open.push({artifactId, version: snapshot.latest.version, question: state.question});
        }
    }
    return open;
}
