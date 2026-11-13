/**
 * 列目录（docs/specs/runtime/projects.md 输出第 20 条）：给“打开已有作品”与“更改作品目录”的选择器用，只列子目录，
 * 标出哪些是作品（有身份文件）、哪些已在书架上。隐藏目录（名字以 `.` 开头）不列。只读，不进登记表。
 */

import {readdir, readFile, realpath, stat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";

import {describe} from "@notnotype/nb-file-lock";

import type {ProjectDirectoryFailure, ProjectState} from "nbook/shared/projects";

import {PROJECT_ID_PATTERN} from "../shared/contracts";
import {expandHome} from "../shared/paths";

export interface BrowseEntry {
    readonly name: string;
    readonly path: string;
    /** `project`：有身份文件的作品目录；`registered`：已在书架上；`directory`：普通目录。 */
    readonly kind: "project" | "registered" | "directory";
    /** 作品的书名（身份文件里有才有）。 */
    readonly title: string | null;
}

export interface BrowseResult {
    readonly path: string;
    /** 上一级；已是根目录时为 null。 */
    readonly parent: string | null;
    readonly entries: BrowseEntry[];
}

export type BrowseOutcome = {readonly ok: true; readonly value: BrowseResult} | {readonly ok: false; readonly reason: ProjectDirectoryFailure; readonly detail: string};

function code(error: unknown): string | undefined {
    return (error as NodeJS.ErrnoException | null)?.code;
}

/** 身份文件里的书名；不是作品（没有文件、结构不符）为 undefined，是作品但没书名为 null。 */
async function projectTitle(path: string): Promise<string | null | undefined> {
    let text: string;
    try {
        text = await readFile(join(path, ".nbook", "project.json"), "utf8");
    } catch {
        return undefined;
    }
    try {
        const record = JSON.parse(text) as {schema?: unknown; id?: unknown; title?: unknown} | null;
        if (typeof record !== "object" || record === null || record.schema !== 1 || typeof record.id !== "string" || !PROJECT_ID_PATTERN.test(record.id)) return undefined;
        return typeof record.title === "string" && record.title.trim() !== "" ? record.title.trim() : null;
    } catch {
        return undefined;
    }
}

export async function browseDirectory(
    input: string,
    options: {readonly cwd: string; readonly home: string; readonly registered: ReadonlyArray<Pick<ProjectState, "path">>},
): Promise<BrowseOutcome> {
    if (input.trim() === "" || input.includes("\0")) return {ok: false, reason: "invalid-path", detail: "路径为空或含非法字符"};
    const literal = resolve(options.cwd, expandHome(input.trim(), options.home));
    let path: string;
    try {
        path = await realpath(literal);
    } catch (error) {
        if (code(error) === "ENOENT" || code(error) === "ENOTDIR") return {ok: false, reason: "invalid-path", detail: `目录不存在：${literal}`};
        throw error;
    }
    let names: Array<{readonly name: string; readonly isDirectory: () => boolean; readonly isSymbolicLink: () => boolean}>;
    try {
        names = await readdir(path, {withFileTypes: true});
    } catch (error) {
        if (code(error) === "ENOTDIR") return {ok: false, reason: "not-directory", detail: `不是目录：${path}`};
        if (code(error) === "EACCES" || code(error) === "EPERM") return {ok: false, reason: "not-accessible", detail: `目录不可读：${path}：${describe(error)}`};
        throw error;
    }
    const registeredPaths = new Set(options.registered.map((project) => project.path));
    const entries: BrowseEntry[] = [];
    for (const entry of names) {
        if (entry.name.startsWith(".")) continue;
        const child = join(path, entry.name);
        let isDirectory = entry.isDirectory();
        if (entry.isSymbolicLink()) {
            // 指向目录的链接也列出来；指向别处或悬空的不列。
            try {
                isDirectory = (await stat(child)).isDirectory();
            } catch {
                isDirectory = false;
            }
        }
        if (!isDirectory) continue;
        // 交出去的是真实路径：登记判定按它，选中后登记、再进一层列目录也都落在同一个路径上。stat 之后又解析不了（刚被删）的不列。
        let real: string;
        try {
            real = await realpath(child);
        } catch {
            continue;
        }
        const title = await projectTitle(real);
        const kind = registeredPaths.has(real) ? "registered" : title === undefined ? "directory" : "project";
        entries.push({name: entry.name, path: real, kind, title: title ?? null});
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: "base"}));
    const parent = dirname(path);
    return {ok: true, value: {path, parent: parent === path ? null : parent, entries}};
}
