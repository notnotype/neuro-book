/**
 * 安装时的复制范围（docs/specs/runtime/plugin-install.md 的“输入与前置条件”）。
 *
 * 有 `files` 时按 npm 的规则：每项是相对插件文件夹的 glob，命中目录时递归包含整个目录，`!` 开头的项排除；npm 总是包含
 * 的文件照样包含（`package.json`、根目录的 README、LICENSE 或 LICENCE、`main` 与 `bin` 指向的文件）。不支持 npm 的扩展
 * glob（`+(a|b)` 这类），写了时清单无效，免得静默少复制。没有 `files` 时复制整个文件夹。两种情况都排除 `node_modules`
 * 与 `.git`（npm 同样总是排除它们）。
 *
 * 复制范围内的任何路径，包括路径中间的目录，是符号链接时拒绝：逐段 `lstat`。被排除的路径不在范围内，遍历时先剪掉，
 * 里面的链接不影响安装。复制前对每个文件再核对一次它仍是普通文件、真实路径仍在源文件夹内，缩小检查与复制之间被
 * 替换的窗口。
 */

import {constants} from "node:fs";
import {copyFile, lstat, mkdir, readdir, realpath} from "node:fs/promises";
import {dirname, join, sep} from "node:path";

import {errno} from "@notnotype/nb-file-lock";

import {brief} from "./record";

const ALWAYS_EXCLUDED = new Set(["node_modules", ".git"]);
const GLOB_CHARACTERS = /[*?[\]{}]/u;
/** npm 的扩展 glob：`?(…)`、`*(…)`、`+(…)`、`@(…)`、`!(…)`，括号配对才算；没有配对的 `@(` 是文件名里的普通字符。 */
const EXTGLOB = /[?*+@!]\([^)]*\)/u;
/** npm 总是包含的根目录文件（不分大小写，可以带扩展名）。 */
const ALWAYS_INCLUDED = /^(?:readme|license|licence)(?:\..*)?$/iu;

export type RangeFailure = {readonly ok: false; readonly code: "path-rejected" | "copy-failed" | "manifest-invalid"; readonly detail: string};
export type RangeResult = {readonly ok: true; readonly files: ReadonlyArray<string>} | RangeFailure;

class Rejected extends Error {
    constructor(readonly code: RangeFailure["code"], detail: string) {
        super(detail);
    }
}

function rejectedPath(path: string): Rejected {
    return new Rejected("path-rejected", `复制范围内的路径是符号链接：${path}`);
}

/** 写成源文件夹内的相对路径（去掉 `./` 与结尾的 `/`）；越出源文件夹的写法为 null。 */
function relativeItem(item: string): string | null {
    let path = item.trim();
    while (path.startsWith("./")) path = path.slice(2);
    while (path.endsWith("/")) path = path.slice(0, -1);
    const segments = path.split("/");
    const outside = path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0") || segments.some((segment) => segment === ".." || segment === "." || segment === "");
    return outside ? null : path;
}

/**
 * `files` 的一项，返回去掉排除号后的相对路径：越出源文件夹与扩展 glob 的写法拒绝。扩展 glob 在去掉排除号之前判断：
 * `!(src)` 本身就是扩展 glob，不能当成“排除 `(src)`”。
 */
function normalizeItem(written: string): {readonly negated: boolean; readonly path: string} {
    const item = written.trim();
    if (EXTGLOB.test(item)) throw new Rejected("manifest-invalid", `files 不支持 npm 的扩展 glob：${written}`);
    const negated = item.startsWith("!");
    const path = relativeItem(negated ? item.slice(1) : item);
    if (path === null) throw new Rejected("path-rejected", `files 里的项必须是相对插件文件夹、不越出它的路径：${written}`);
    return {negated, path};
}

/** 复制范围的遍历：`skip` 为真的路径（排除项命中的、总排除的）连同其下的一切都不看。 */
interface Walk {
    readonly source: string;
    readonly into: Set<string>;
    skip(path: string): boolean;
}

/** 逐段核对 `path` 的每个祖先与它自己都不是符号链接；不存在时返回 null。 */
async function plainKind(source: string, path: string): Promise<"file" | "directory" | "other" | null> {
    const segments = path.split("/");
    for (let index = 1; index <= segments.length; index += 1) {
        const prefix = segments.slice(0, index).join("/");
        let info;
        try {
            info = await lstat(join(source, prefix));
        } catch (error) {
            if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return null;
            throw error;
        }
        if (info.isSymbolicLink()) throw rejectedPath(prefix);
        if (index === segments.length) return info.isFile() ? "file" : info.isDirectory() ? "directory" : "other";
    }
    return null;
}

/** 递归收集目录下的普通文件；遇到范围内的符号链接拒绝。 */
async function walk(context: Walk, prefix: string): Promise<void> {
    const entries = await readdir(prefix === "" ? context.source : join(context.source, prefix), {withFileTypes: true});
    for (const entry of entries) {
        const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
        if (context.skip(path)) continue;
        if (entry.isSymbolicLink()) throw rejectedPath(path);
        if (entry.isDirectory()) await walk(context, path);
        else if (entry.isFile()) context.into.add(path);
    }
}

/** `files` 的一项命中的路径：目录递归包含。 */
async function include(context: Walk, path: string): Promise<void> {
    if (context.skip(path)) return;
    const kind = await plainKind(context.source, path);
    if (kind === "directory") await walk(context, path);
    else if (kind === "file") context.into.add(path);
}

/** npm 总是包含的一项：只包含普通文件，同名的目录不递归（npm 不打包它们）。 */
async function includeFile(context: Walk, path: string): Promise<void> {
    if (context.skip(path)) return;
    if ((await plainKind(context.source, path)) === "file") context.into.add(path);
}

/**
 * `main` 与 `bin` 指向的文件（npm 总是包含）。越出源文件夹或写法不对的不算进复制范围，也不使安装失败：它们不是
 * 插件的入口，入口文件另由清单的 `entries` 核对。
 */
function entryPoints(raw: unknown): string[] {
    if (typeof raw !== "object" || raw === null) return [];
    const record = raw as {readonly main?: unknown; readonly bin?: unknown};
    const bins = typeof record.bin === "string" ? [record.bin] : typeof record.bin === "object" && record.bin !== null ? Object.values(record.bin) : [];
    return [record.main, ...bins].flatMap((value) => (typeof value === "string" ? [relativeItem(value)].filter((path): path is string => path !== null) : []));
}

/**
 * 按 `files`（没有时为 null）算出要复制的普通文件，相对源文件夹、按码元排序。`source` 必须已是真实路径；`raw` 是
 * `package.json` 的内容，用来取 npm 总是包含的 `main` 与 `bin`。
 */
export async function collectCopyRange(source: string, files: ReadonlyArray<string> | null, raw: unknown): Promise<RangeResult> {
    const collected = new Set<string>();
    const excludedAlways = (path: string): boolean => path.split("/").some((segment) => ALWAYS_EXCLUDED.has(segment));
    try {
        if (files === null) {
            await walk({source, into: collected, skip: excludedAlways}, "");
        } else {
            const includes: string[] = [];
            const negations: Bun.Glob[] = [];
            for (const written of files) {
                const {negated, path} = normalizeItem(written);
                if (negated) negations.push(new Bun.Glob(path));
                else includes.push(path);
            }
            // 排除项命中路径本身或它的某个祖先目录。
            const excludedByFiles = (path: string): boolean => {
                const segments = path.split("/");
                return negations.some((glob) => segments.some((_, index) => glob.match(segments.slice(0, index + 1).join("/"))));
            };
            const context: Walk = {source, into: collected, skip: (path) => excludedAlways(path) || excludedByFiles(path)};
            for (const item of includes) {
                if (GLOB_CHARACTERS.test(item)) {
                    for await (const match of new Bun.Glob(item).scan({cwd: source, dot: true, onlyFiles: false, followSymlinks: false})) {
                        await include(context, match.split(sep).join("/"));
                    }
                } else {
                    // 不含通配的项直接逐段核对：glob 扫描不跟随符号链接，中间目录是链接时会静默地什么也匹配不到。
                    await include(context, item);
                }
            }
            const always: Walk = {source, into: collected, skip: excludedAlways};
            for (const entry of await readdir(source, {withFileTypes: true})) {
                if (ALWAYS_INCLUDED.test(entry.name)) await includeFile(always, entry.name);
            }
            for (const path of entryPoints(raw)) await includeFile(always, path);
        }
        await includeFile({source, into: collected, skip: () => false}, "package.json");
    } catch (error) {
        if (error instanceof Rejected) return {ok: false, code: error.code, detail: error.message};
        return {ok: false, code: "copy-failed", detail: `读取插件文件夹失败：${brief(error)}`};
    }
    return {ok: true, files: [...collected].sort()};
}

/** 把收集到的文件复制进 `target`（已存在的空目录）。失败时调用方删除整个 `target`。 */
export async function copyRange(source: string, target: string, files: ReadonlyArray<string>): Promise<{readonly ok: true} | RangeFailure> {
    for (const path of files) {
        const from = join(source, path);
        try {
            const kind = await plainKind(source, path);
            if (kind !== "file") return {ok: false, code: "copy-failed", detail: `复制期间文件被移走或换成了别的东西：${path}`};
            const real = await realpath(from);
            if (!real.startsWith(`${source}${sep}`)) throw rejectedPath(path);
            const to = join(target, path);
            await mkdir(dirname(to), {recursive: true});
            await copyFile(from, to, constants.COPYFILE_EXCL);
        } catch (error) {
            if (error instanceof Rejected) return {ok: false, code: error.code, detail: error.message};
            return {ok: false, code: "copy-failed", detail: `复制 ${path} 失败：${brief(error)}`};
        }
    }
    return {ok: true};
}
