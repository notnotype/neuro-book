/**
 * 项目身份与目录校验。身份写在项目目录的 `.nbook/project.json`，与路径分离：目录移动后再登记，按 id
 * 认出是同一项目。行为合同见 docs/specs/runtime/projects.md。
 */

import {constants} from "node:fs";
import {access, mkdir, readFile, realpath, stat, writeFile} from "node:fs/promises";
import {dirname, join, resolve, sep} from "node:path";

import type {ProjectRegisterFailure} from "nbook/shared/projects";

export const PROJECT_IDENTITY_FILE = join(".nbook", "project.json");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** 项目 id 的形状（UUID）；身份文件与登记表用同一个判据。 */
export function isProjectId(value: unknown): value is string {
    return typeof value === "string" && UUID.test(value);
}

export type ProjectIdentity = {readonly status: "found"; readonly id: string} | {readonly status: "missing"} | {readonly status: "invalid"; readonly detail: string};

export type DirectoryCheck = {readonly ok: true; readonly path: string} | {readonly ok: false; readonly reason: Extract<ProjectRegisterFailure, "invalid-path" | "not-directory" | "not-accessible" | "inside-state-root">; readonly detail: string};

function code(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | null)?.code;
}

/**
 * 校验要登记的目录：相对路径按 `cwd` 解析；必须存在、是目录、可读写、不在状态根之内。返回解析符号链接后的
 * 真实路径。
 */
export async function checkProjectDirectory(input: string, options: {readonly cwd: string; readonly stateRoot: string}): Promise<DirectoryCheck> {
    if (input.trim() === "" || input.includes("\0")) return {ok: false, reason: "invalid-path", detail: "路径为空或含非法字符"};
    let path: string;
    try {
        path = await realpath(resolve(options.cwd, input));
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return {ok: false, reason: "invalid-path", detail: `目录不存在：${input}`};
        throw error;
    }
    if (!(await stat(path)).isDirectory()) return {ok: false, reason: "not-directory", detail: `不是目录：${path}`};
    try {
        await access(path, constants.R_OK | constants.W_OK);
    } catch (error) {
        if (code(error) === "EACCES" || code(error) === "EPERM" || code(error) === "EROFS") return {ok: false, reason: "not-accessible", detail: `目录不可读写：${path}`};
        throw error;
    }
    // 状态根可能还不存在（首次启动前），这时按字面路径比较。
    const stateRoot = await realpath(options.stateRoot).catch((error: unknown) => {
        if (code(error) === "ENOENT") return resolve(options.stateRoot);
        throw error;
    });
    if (path === stateRoot || path.startsWith(stateRoot + sep)) return {ok: false, reason: "inside-state-root", detail: "不能登记应用的状态目录或它里面的目录"};
    return {ok: true, path};
}

/** 读项目身份；身份文件存在但无法解析或结构不符时为 `invalid`，调用方不得改写它。 */
export async function readProjectIdentity(projectPath: string): Promise<ProjectIdentity> {
    let text: string;
    try {
        text = await readFile(join(projectPath, PROJECT_IDENTITY_FILE), "utf8");
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return {status: "missing"};
        throw error;
    }
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return {status: "invalid", detail: `${PROJECT_IDENTITY_FILE} 不是合法的 JSON`};
    }
    const record = value as {readonly schema?: unknown; readonly id?: unknown} | null;
    if (typeof record !== "object" || record === null || record.schema !== 1 || !isProjectId(record.id)) {
        return {status: "invalid", detail: `${PROJECT_IDENTITY_FILE} 的结构不符（应为 {schema: 1, id: UUID}）`};
    }
    return {status: "found", id: record.id};
}

/**
 * 写入身份文件（含 `.nbook/` 目录）。以独占方式创建：别处刚好先写了一份时不覆盖，返回读回的那一份。
 */
export async function writeProjectIdentity(projectPath: string, id: string): Promise<ProjectIdentity> {
    const file = join(projectPath, PROJECT_IDENTITY_FILE);
    await mkdir(dirname(file), {recursive: true});
    try {
        await writeFile(file, `${JSON.stringify({schema: 1, id}, null, 2)}\n`, {flag: "wx"});
    } catch (error) {
        if (code(error) !== "EEXIST") throw error;
        return readProjectIdentity(projectPath);
    }
    return {status: "found", id};
}
