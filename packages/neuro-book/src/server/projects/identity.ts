/**
 * 项目身份与目录校验。身份写在项目目录的 `.nbook/project.json`，与路径分离：目录移动后再登记，按 id
 * 认出是同一项目。身份文件另可带作品信息（书名、简介、主题色），只有修改作品信息会改写它；新建作品时由这里建目录
 * 并写出第一份身份文件。行为合同见 docs/specs/runtime/projects.md（输出第 1、13、14 条）。
 */

import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {access, lstat, mkdir, open, readFile, realpath, rmdir, stat, unlink, writeFile} from "node:fs/promises";
import {homedir} from "node:os";
import {dirname, join, resolve, sep} from "node:path";

import {describe, replaceLocked} from "@notnotype/nb-file-lock";

import {PROJECT_COLOR_PATTERN, PROJECT_DESCRIPTION_MAX_LENGTH, PROJECT_ID_PATTERN, PROJECT_TITLE_MAX_LENGTH} from "nbook/plugins/projects/shared/contracts";
import {normalizeProjectCoverPath} from "nbook/plugins/projects/shared/cover";
import {projectDirectoryName} from "nbook/plugins/projects/shared/directory-name";
import {expandHome} from "nbook/plugins/projects/shared/paths";
import type {
    ProjectDirectoryFailure,
    ProjectMetadata,
    ProjectMetadataField,
    ProjectMetadataInvalid,
    ProjectMetadataPatch,
    ProjectMetadataProblem,
    ProjectUpdateResult,
} from "nbook/shared/projects";

export const PROJECT_IDENTITY_FILE = join(".nbook", "project.json");
/** 修改身份文件的跨进程写入锁；与 Files 的 `.nbook/locks/files` 分开。 */
export const PROJECT_IDENTITY_LOCK = join(".nbook", "locks", "project.json.lock");

const METADATA_FIELDS: ReadonlyArray<ProjectMetadataField> = ["title", "description", "color", "cover"];

/** 目录校验与新建作品用到的位置：相对路径按 `cwd` 解析，`~` 按 `home` 展开（缺省为进程用户的主目录），状态根不能登记。 */
export interface ProjectPathOptions {
    readonly cwd: string;
    readonly stateRoot: string;
    readonly home?: string;
}

const homeOf = (options: ProjectPathOptions): string => options.home ?? homedir();

/** 项目 id 的形状（UUID）；身份文件与登记表用同一个判据。 */
export function isProjectId(value: unknown): value is string {
    return typeof value === "string" && PROJECT_ID_PATTERN.test(value);
}

export type ProjectIdentity =
    | {readonly status: "found"; readonly id: string; readonly metadata: ProjectMetadata; readonly problems: ReadonlyArray<ProjectMetadataProblem>}
    | {readonly status: "missing"}
    | {readonly status: "invalid"; readonly detail: string};

export type DirectoryCheck = {readonly ok: true; readonly path: string} | {readonly ok: false; readonly reason: ProjectDirectoryFailure; readonly detail: string};

function code(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | null)?.code;
}

/** 状态根的真实路径；状态根可能还不存在（首次启动前），这时按字面路径比较。 */
async function stateRootOf(options: ProjectPathOptions): Promise<string> {
    return realpath(options.stateRoot).catch((error: unknown) => {
        if (code(error) === "ENOENT") return resolve(options.stateRoot);
        throw error;
    });
}

/**
 * 校验要登记的目录：`~` 按主目录展开，相对路径按 `cwd` 解析；必须存在、是目录、可读写、不在状态根之内。返回解析符号链接后的
 * 真实路径。
 */
export async function checkProjectDirectory(input: string, options: ProjectPathOptions): Promise<DirectoryCheck> {
    if (input.trim() === "" || input.includes("\0")) return {ok: false, reason: "invalid-path", detail: "路径为空或含非法字符"};
    const literal = resolve(options.cwd, expandHome(input.trim(), homeOf(options)));
    let path: string;
    try {
        path = await realpath(literal);
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return {ok: false, reason: "invalid-path", detail: `目录不存在：${literal}`};
        throw error;
    }
    if (!(await stat(path)).isDirectory()) return {ok: false, reason: "not-directory", detail: `不是目录：${path}`};
    try {
        await access(path, constants.R_OK | constants.W_OK);
    } catch (error) {
        if (code(error) === "EACCES" || code(error) === "EPERM" || code(error) === "EROFS") return {ok: false, reason: "not-accessible", detail: `目录不可读写：${path}`};
        throw error;
    }
    const stateRoot = await stateRootOf(options);
    if (path === stateRoot || path.startsWith(stateRoot + sep)) return {ok: false, reason: "inside-state-root", detail: "不能登记应用的状态目录或它里面的目录"};
    return {ok: true, path};
}

/**
 * 新建作品的父目录（输出第 14 条）：不存在就建出来（含中间目录），再按 `checkProjectDirectory` 校验。先按字面路径排除状态根，
 * 不在状态根里建目录；建不出来按 `not-accessible` 报，详情带解析后的路径。`signal` 已 abort 时不建目录，以 `signal.reason` reject。
 */
export async function ensureParentDirectory(input: string, options: ProjectPathOptions, signal?: AbortSignal): Promise<DirectoryCheck> {
    if (input.trim() === "" || input.includes("\0")) return {ok: false, reason: "invalid-path", detail: "路径为空或含非法字符"};
    const literal = resolve(options.cwd, expandHome(input.trim(), homeOf(options)));
    const stateRoot = await stateRootOf(options);
    signal?.throwIfAborted();
    if (literal === stateRoot || literal.startsWith(stateRoot + sep)) return {ok: false, reason: "inside-state-root", detail: "不能把作品放进应用的状态目录"};
    try {
        await mkdir(literal, {recursive: true});
    } catch (error) {
        if (code(error) === "EACCES" || code(error) === "EPERM" || code(error) === "EROFS") return {ok: false, reason: "not-accessible", detail: `无法创建目录 ${literal}：${describe(error)}`};
        if (code(error) === "EEXIST" || code(error) === "ENOTDIR") return {ok: false, reason: "not-directory", detail: `不是目录：${literal}`};
        return {ok: false, reason: "invalid-path", detail: `无法创建目录 ${literal}：${describe(error)}`};
    }
    return checkProjectDirectory(literal, options);
}

/** 字符数按 Unicode 码点计（与 JSON Schema 的 `maxLength` 一致），一个汉字或一个表情都算一个。 */
function length(text: string): number {
    return Array.from(text).length;
}

/** 某个作品信息字段的值不合规的原因；合规为 null。规则见输出第 13 条。 */
function metadataProblem(field: ProjectMetadataField, value: unknown): string | null {
    if (typeof value !== "string") return "不是字符串";
    switch (field) {
        case "title": {
            const size = length(value.trim());
            return size >= 1 && size <= PROJECT_TITLE_MAX_LENGTH ? null : `书名去掉首尾空白后须为 1 到 ${String(PROJECT_TITLE_MAX_LENGTH)} 个字符`;
        }
        case "description":
            return length(value) <= PROJECT_DESCRIPTION_MAX_LENGTH ? null : `简介至多 ${String(PROJECT_DESCRIPTION_MAX_LENGTH)} 个字符`;
        case "color":
            return PROJECT_COLOR_PATTERN.test(value) ? null : "主题色须为 #rrggbb（小写）";
        case "cover":
            return normalizeProjectCoverPath(value) === value ? null : "封面须是作品目录内的相对路径，扩展名 png、jpg、jpeg 或 webp";
    }
}

/** 写进身份文件的形式：书名去掉首尾空白，其余原样。 */
function normalized(field: ProjectMetadataField, value: string): string {
    return field === "title" ? value.trim() : value;
}

/** 修改或新建时先校验给出的字段；第一个不合规的字段带名字交回，什么都不写。 */
export function checkMetadataPatch(patch: ProjectMetadataPatch): ProjectMetadataInvalid | null {
    for (const field of METADATA_FIELDS) {
        const value = patch[field];
        if (value === undefined || value === null) continue;
        const problem = metadataProblem(field, value);
        if (problem !== null) return {ok: false, reason: "invalid-metadata", field, detail: problem};
    }
    return null;
}

type ParsedIdentity = {readonly ok: true; readonly record: Record<string, unknown>; readonly id: string} | {readonly ok: false; readonly detail: string};

/** 解析身份文件的文本：只认 `schema` 与 `id`，其余字段原样留在 `record` 里。 */
function parseIdentity(text: string): ParsedIdentity {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return {ok: false, detail: `${PROJECT_IDENTITY_FILE} 不是合法的 JSON`};
    }
    const record = value as {readonly schema?: unknown; readonly id?: unknown} | null;
    if (typeof record !== "object" || record === null || Array.isArray(record) || record.schema !== 1 || !isProjectId(record.id)) {
        return {ok: false, detail: `${PROJECT_IDENTITY_FILE} 的结构不符（应为 {schema: 1, id: UUID}）`};
    }
    return {ok: true, record: record as Record<string, unknown>, id: record.id};
}

/** 从身份文件的记录取作品信息：没有的字段为 null，不合规的同样为 null 并列进 `problems`。 */
function metadataOf(record: Readonly<Record<string, unknown>>): {readonly metadata: ProjectMetadata; readonly problems: ReadonlyArray<ProjectMetadataProblem>} {
    const problems: ProjectMetadataProblem[] = [];
    const read = (field: ProjectMetadataField): string | null => {
        const value = record[field];
        if (value === undefined || value === null) return null;
        const problem = metadataProblem(field, value);
        if (problem === null) return normalized(field, value as string);
        problems.push({field, detail: problem});
        return null;
    };
    return {metadata: {title: read("title"), description: read("description"), color: read("color"), cover: read("cover")}, problems};
}

function identityFromText(text: string): ProjectIdentity {
    const parsed = parseIdentity(text);
    if (!parsed.ok) return {status: "invalid", detail: parsed.detail};
    return {status: "found", id: parsed.id, ...metadataOf(parsed.record)};
}

/**
 * 读项目身份；身份文件存在但无法解析或结构不符时为 `invalid`，调用方不得改写它。作品信息里不合规的字段当作没有，
 * 列在 `problems` 里，身份照常可用。
 */
export async function readProjectIdentity(projectPath: string): Promise<ProjectIdentity> {
    let text: string;
    try {
        text = await readFile(join(projectPath, PROJECT_IDENTITY_FILE), "utf8");
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return {status: "missing"};
        throw error;
    }
    return identityFromText(text);
}

function identityText(record: Readonly<Record<string, unknown>>): string {
    return `${JSON.stringify(record, null, 2)}\n`;
}

/**
 * 写入身份文件（含 `.nbook/` 目录）。以独占方式创建：别处刚好先写了一份时不覆盖，返回读回的那一份。
 * `signal` 已 abort 时不再开始下一次写入（建 `.nbook/`、写文件），以 `signal.reason` reject。
 */
export async function writeProjectIdentity(projectPath: string, id: string, signal?: AbortSignal): Promise<ProjectIdentity> {
    const file = join(projectPath, PROJECT_IDENTITY_FILE);
    signal?.throwIfAborted();
    await mkdir(dirname(file), {recursive: true});
    signal?.throwIfAborted();
    try {
        await writeFile(file, identityText({schema: 1, id}), {flag: "wx"});
    } catch (error) {
        if (code(error) !== "EEXIST") throw error;
        return readProjectIdentity(projectPath);
    }
    return {status: "found", id, metadata: {title: null, description: null, color: null, cover: null}, problems: []};
}

/** 身份文件的落点：符号链接解析到最终目标（替换目标、链接保留）；不存在与悬空链接分开。 */
async function identityTarget(projectPath: string): Promise<{readonly kind: "file"; readonly path: string} | {readonly kind: "missing"} | {readonly kind: "dangling"}> {
    const file = join(projectPath, PROJECT_IDENTITY_FILE);
    let info;
    try {
        info = await lstat(file);
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return {kind: "missing"};
        throw error;
    }
    if (!info.isSymbolicLink()) return {kind: "file", path: file};
    try {
        return {kind: "file", path: await realpath(file)};
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR" || code(error) === "ELOOP") return {kind: "dangling"};
        throw error;
    }
}

const isReadOnly = (error: unknown): boolean => code(error) === "EACCES" || code(error) === "EPERM" || code(error) === "EROFS";

/**
 * 修改作品信息（输出第 13 条）：只改 `patch` 给出的字段，`null` 清除、省略不动，保留 `schema`、`id` 与不认识的字段。
 * 经 `.nbook/locks/project.json.lock` 加锁替换（`@notnotype/nb-file-lock`）：锁内按当前字节解析并核对文件里的 id
 * 是 `expectedId`，所以两个进程分别改不同字段时都保留。失败码不含 `unknown-project`、`registry-invalid`，它们由查登记表的
 * 调用方给出。`report` 收替换收尾时的次要错误（释放锁、删临时文件），事件名已带 `project.identity.` 前缀。
 */
export async function updateProjectMetadata(
    projectPath: string,
    expectedId: string,
    patch: ProjectMetadataPatch,
    options: {readonly report: (event: string, error: unknown) => void},
): Promise<ProjectUpdateResult> {
    const invalid = checkMetadataPatch(patch);
    if (invalid !== null) return invalid;
    let target;
    try {
        target = await identityTarget(projectPath);
    } catch (error) {
        return {ok: false, reason: "write-failed", detail: `无法定位身份文件：${describe(error)}`};
    }
    if (target.kind === "missing") return {ok: false, reason: "identity-invalid", detail: `${PROJECT_IDENTITY_FILE} 不存在`};
    if (target.kind === "dangling") return {ok: false, reason: "identity-invalid", detail: `${PROJECT_IDENTITY_FILE} 是符号链接，目标不存在；不替换这个链接`};
    const lockPath = join(projectPath, PROJECT_IDENTITY_LOCK);
    try {
        // replaceLocked 要求锁目录的父目录已存在。
        await mkdir(dirname(lockPath), {recursive: true});
    } catch (error) {
        return isReadOnly(error) ? {ok: false, reason: "read-only", detail: `无法创建 ${dirname(lockPath)}：${describe(error)}`} : {ok: false, reason: "write-failed", detail: `无法创建锁目录：${describe(error)}`};
    }
    const replaced = await replaceLocked<ProjectUpdateResult, string>(target.path, {
        lockPath,
        decide: (current) => {
            if (current === null) return {done: {ok: false, reason: "identity-invalid", detail: `${PROJECT_IDENTITY_FILE} 不存在`}};
            const text = Buffer.from(current.bytes).toString("utf8");
            const parsed = parseIdentity(text);
            if (!parsed.ok) return {done: {ok: false, reason: "identity-invalid", detail: parsed.detail}};
            if (parsed.id !== expectedId) return {done: {ok: false, reason: "identity-conflict", detail: `身份文件里的 id ${parsed.id} 与登记表里的 ${expectedId} 不一致`}};
            const next: Record<string, unknown> = {...parsed.record};
            for (const field of METADATA_FIELDS) {
                const value = patch[field];
                if (value === undefined) continue;
                if (value === null) delete next[field];
                else next[field] = normalized(field, value);
            }
            const written = identityText(next);
            if (written === text) return {done: {ok: true, metadata: metadataOf(next).metadata}};
            return {write: written};
        },
        report: (event, error) => options.report(`project.identity.${event}`, error),
    });
    if (!replaced.ok) {
        switch (replaced.reason) {
            case "read-only":
                return {ok: false, reason: "read-only", detail: replaced.detail};
            case "not-a-file":
                return {ok: false, reason: "identity-invalid", detail: replaced.detail};
            case "unstable":
            case "failed":
                return {ok: false, reason: "write-failed", detail: replaced.detail};
        }
    }
    if ("done" in replaced) return replaced.done;
    const written = identityFromText(replaced.written);
    if (written.status !== "found") throw new Error(`刚写入的身份文件读不回：${written.status}`);
    return {ok: true, metadata: written.metadata};
}

export type ProjectDirectoryCreated =
    | {readonly ok: true; readonly path: string; readonly id: string}
    | ProjectMetadataInvalid
    | {readonly ok: false; readonly reason: "invalid-parent"; readonly cause: ProjectDirectoryFailure; readonly detail: string}
    | {readonly ok: false; readonly reason: "exists"; readonly path: string; readonly detail: string}
    | {readonly ok: false; readonly reason: "write-failed"; readonly detail: string};

/**
 * 新建作品的前两个阶段（输出第 14 条）：父目录不存在就建出来，在它下面排他新建由书名生成的目录，再写身份文件（新 id、书名与简介）。
 * 登记是第三个阶段，由登记表做。写身份文件失败时只撤掉本次建的东西：本次建的文件删掉，目录只在空了时删掉（`rmdir`），
 * 别人同时放进去的东西不会被删。
 *
 * `signal` 已 abort 时不再开始下一次写入，以 `signal.reason` reject：建父目录、建作品目录、写身份文件各是一步，写身份文件
 * 这一步（建 `.nbook/` 与写文件）开始了就做完，免得为取消再走一遍撤销。作品目录建好、身份文件还没写时取消，留下的空目录
 * 再新建同一书名时按 `exists` 报出，可以登记接回。
 */
export async function createProjectDirectory(
    input: {readonly title: string; readonly description?: string; readonly parent: string},
    options: ProjectPathOptions,
    signal?: AbortSignal,
): Promise<ProjectDirectoryCreated> {
    const invalid = checkMetadataPatch({title: input.title, ...(input.description === undefined ? {} : {description: input.description})});
    if (invalid !== null) return invalid;
    const parent = await ensureParentDirectory(input.parent, options, signal);
    signal?.throwIfAborted();
    if (!parent.ok) return {ok: false, reason: "invalid-parent", cause: parent.reason, detail: parent.detail};
    const path = join(parent.path, projectDirectoryName(input.title));
    try {
        await mkdir(path);
    } catch (error) {
        if (code(error) === "EEXIST") return {ok: false, reason: "exists", path, detail: `目录已存在：${path}`};
        return {ok: false, reason: "write-failed", detail: `无法创建目录 ${path}：${describe(error)}`};
    }
    signal?.throwIfAborted();
    const id = randomUUID();
    const record = {schema: 1, id, title: normalized("title", input.title), ...(input.description === undefined ? {} : {description: input.description})};
    const control = join(path, dirname(PROJECT_IDENTITY_FILE));
    const file = join(path, PROJECT_IDENTITY_FILE);
    let controlCreated = false;
    let fileCreated = false;
    try {
        await mkdir(control);
        controlCreated = true;
        const handle = await open(file, "wx");
        fileCreated = true;
        try {
            await handle.writeFile(identityText(record));
            await handle.sync();
        } finally {
            await handle.close();
        }
    } catch (error) {
        const kept = await undoCreated([...(fileCreated ? [{path: file, kind: "file" as const}] : []), ...(controlCreated ? [{path: control, kind: "directory" as const}] : []), {path, kind: "directory"}]);
        return {ok: false, reason: "write-failed", detail: `写入身份文件失败：${describe(error)}${kept.length === 0 ? "；已删掉新建的目录" : `；${kept.join("、")} 没有删掉`}`};
    }
    return {ok: true, path, id};
}

/** 按给出的顺序撤掉本次建的文件与目录；目录不空（别人放了东西）或删不掉就留着。返回留下的路径与原因。 */
async function undoCreated(items: ReadonlyArray<{readonly path: string; readonly kind: "file" | "directory"}>): Promise<string[]> {
    const kept: string[] = [];
    for (const item of items) {
        try {
            if (item.kind === "file") await unlink(item.path);
            else await rmdir(item.path);
        } catch (error) {
            if (code(error) !== "ENOENT") kept.push(`${item.path}（${describe(error)}）`);
        }
    }
    return kept;
}
