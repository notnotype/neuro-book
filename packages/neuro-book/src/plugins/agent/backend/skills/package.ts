/**
 * 读一个 Skill 包（docs/specs/agent/skills.md 的“输入与前置条件”与输出 2、4）：`SKILL.md` 的 frontmatter、无效的原因、
 * 外部依赖的检测。只读文件，不缓存：目录每次重扫都现读。
 */

import {lstat, readdir, readFile} from "node:fs/promises";
import {join} from "node:path";

import {parse as parseYaml} from "yaml";

import type {SkillExternal, SkillProblem} from "../../shared/skills";

export const SKILL_FILE = "SKILL.md";

/** `name` 的写法：小写字母、数字与单个连字符，不以连字符开头或结尾。 */
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1024;
const COMPATIBILITY_MAX = 500;

export interface SkillManifest {
    readonly name: string;
    readonly description: string;
    readonly whenToUse?: string;
    readonly license?: string;
    readonly compatibility?: string;
    readonly metadata?: Readonly<Record<string, string>>;
}

export type SkillPackageRead =
    | {readonly ok: true; readonly manifest: SkillManifest; readonly body: string; readonly ignored: readonly string[]}
    | {readonly ok: false; readonly problem: SkillProblem};

const length = (text: string): number => [...text].length;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

/** 分出 frontmatter 与正文；没有 frontmatter 为 null。开头的 BOM 与 CRLF 都认。 */
function splitFrontmatter(text: string): {readonly yaml: string; readonly body: string} | null {
    const normalized = text.replace(/^﻿/u, "").replace(/\r\n/gu, "\n");
    if (!normalized.startsWith("---\n")) return null;
    const close = normalized.indexOf("\n---", 3);
    if (close < 0) return null;
    const after = normalized.indexOf("\n", close + 4);
    if (after >= 0 && normalized.slice(close + 4, after).trim() !== "") return null;
    return {yaml: normalized.slice(4, close + 1), body: after < 0 ? "" : normalized.slice(after + 1)};
}

/**
 * 读 `directory`（文件夹名 `folder`）下的 Skill 包。无效的交回原因；可选字段不合规的忽略那个字段，名字列在 `ignored` 里，
 * 由调用方写诊断。
 */
export async function readSkillPackage(directory: string, folder: string): Promise<SkillPackageRead> {
    const stats = await lstat(directory);
    if (stats.isSymbolicLink()) return {ok: false, problem: {code: "symlink"}};
    let text: string;
    try {
        text = await readFile(join(directory, SKILL_FILE), "utf8");
    } catch (error) {
        if (!missing(error)) throw error;
        const nested = await nestedSkill(directory);
        return {ok: false, problem: nested === null ? {code: "skill-md-missing"} : {code: "nested", directory: nested}};
    }
    const split = splitFrontmatter(text);
    if (split === null) return {ok: false, problem: {code: "frontmatter-unreadable", detail: "SKILL.md does not start with a --- frontmatter block"}};
    let data: unknown;
    try {
        data = parseYaml(split.yaml);
    } catch (error) {
        return {ok: false, problem: {code: "frontmatter-unreadable", detail: error instanceof Error ? error.message : String(error)}};
    }
    if (!isRecord(data)) return {ok: false, problem: {code: "frontmatter-unreadable", detail: "frontmatter is not a mapping"}};
    const name = data.name;
    if (name === undefined || name === null || name === "") return {ok: false, problem: {code: "field-missing", field: "name"}};
    if (typeof name !== "string" || name.length > NAME_MAX || !NAME_PATTERN.test(name)) return {ok: false, problem: {code: "field-invalid", field: "name"}};
    if (name !== folder) return {ok: false, problem: {code: "name-mismatch", name}};
    const description = data.description;
    if (description === undefined || description === null || description === "") return {ok: false, problem: {code: "field-missing", field: "description"}};
    if (typeof description !== "string" || length(description) > DESCRIPTION_MAX) return {ok: false, problem: {code: "field-invalid", field: "description"}};

    const ignored: string[] = [];
    const optionalText = (key: string, max = Number.POSITIVE_INFINITY): string | undefined => {
        const value = data[key];
        if (value === undefined || value === null) return undefined;
        if (typeof value === "string" && length(value) <= max) return value;
        ignored.push(key);
        return undefined;
    };
    const metadata = ((): Readonly<Record<string, string>> | undefined => {
        const value = data.metadata;
        if (value === undefined || value === null) return undefined;
        if (isRecord(value) && Object.values(value).every((item) => typeof item === "string")) return value as Record<string, string>;
        ignored.push("metadata");
        return undefined;
    })();
    const allowedTools = data["allowed-tools"];
    if (allowedTools !== undefined && allowedTools !== null && typeof allowedTools !== "string" && !(Array.isArray(allowedTools) && allowedTools.every((item) => typeof item === "string"))) ignored.push("allowed-tools");
    const whenToUse = optionalText("when-to-use") ?? optionalText("when_to_use");
    const license = optionalText("license");
    const compatibility = optionalText("compatibility", COMPATIBILITY_MAX);
    return {
        ok: true,
        manifest: {name, description, ...(whenToUse === undefined ? {} : {whenToUse}), ...(license === undefined ? {} : {license}), ...(compatibility === undefined ? {} : {compatibility}), ...(metadata === undefined ? {} : {metadata})},
        body: split.body,
        ignored,
    };
}

/** 下一层有 `SKILL.md` 的子目录名（“可能多套了一层文件夹”）；没有为 null。 */
async function nestedSkill(directory: string): Promise<string | null> {
    const children = await readdir(directory, {withFileTypes: true}).catch(() => []);
    for (const child of children) {
        if (!child.isDirectory() || child.name.startsWith(".")) continue;
        if (await lstat(join(directory, child.name, SKILL_FILE)).then((stats) => stats.isFile(), () => false)) return child.name;
    }
    return null;
}

const PYTHON_MARKERS = ["pyproject.toml", "requirements.txt", "uv.lock"];
/** PEP 723 的内联依赖块。 */
const INLINE_SCRIPT = /^# \/\/\/ script$/mu;

/**
 * 外部依赖（skills.md 输出 4）：Python 依赖看标记文件与两层以内带内联依赖的 `.py`；`which` 找 `uv`。只读不改，不跟随链接，
 * 跳过 `node_modules` 与以点开头的目录。
 */
export async function detectExternal(directory: string, compatibility: string | undefined, which: (command: string) => string | null): Promise<SkillExternal | undefined> {
    const top = await readdir(directory, {withFileTypes: true}).catch(() => []);
    let python = top.some((entry) => entry.isFile() && PYTHON_MARKERS.includes(entry.name));
    const scripts = top.filter((entry) => entry.isFile() && entry.name.endsWith(".py")).map((entry) => join(directory, entry.name));
    for (const entry of top) {
        if (python) break;
        if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const inner = await readdir(join(directory, entry.name), {withFileTypes: true}).catch(() => []);
        scripts.push(...inner.filter((child) => child.isFile() && child.name.endsWith(".py")).map((child) => join(directory, entry.name, child.name)));
    }
    for (const script of scripts) {
        if (python) break;
        python = INLINE_SCRIPT.test(await readFile(script, "utf8").catch(() => ""));
    }
    const external: SkillExternal = {
        ...(python ? {python: true} : {}),
        ...(python && which("uv") === null ? {uvMissing: true} : {}),
        ...(compatibility === undefined ? {} : {compatibility}),
    };
    return Object.keys(external).length === 0 ? undefined : external;
}
