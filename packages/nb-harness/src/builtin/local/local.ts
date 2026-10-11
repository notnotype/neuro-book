/**
 * 本地文件访问（docs/specs/harness/builtin-tools.md 输出 1）：一个已存在的目录当根，所有路径都是根内相对路径；作为目录型提供者登记到方案上。
 * 越界判两次：先按字面规范化，再按真实路径（符号链接指向根外也算越界）。
 */

import {mkdirSync, statSync} from "node:fs";
import {lstat, mkdir, readdir, readFile, realpath, rm, stat, writeFile} from "node:fs/promises";
import {dirname, isAbsolute, normalize, relative, resolve, sep} from "node:path";
import {join} from "node:path";
import type {DirectoryProvider, FileKind, FilesFailure, FilesResult, SchemeContext} from "../types";

const fail = <T>(code: FilesFailure, detail: string): FilesResult<T> => ({ok: false, code, detail});
const errorCode = (error: unknown): string => (error as {code?: string}).code ?? (error instanceof Error ? error.message : String(error));

/** 越界看的是父目录组件 `..`，不是以两个点开头的文件名（`..foo` 是合法的根内名字）。 */
function insideRoot(root: string, absolute: string): boolean {
    const rel = relative(root, absolute);
    return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function createLocalFileAccess(options: {root: string; readonly?: boolean}): DirectoryProvider {
    if (!isAbsolute(options.root)) throw new TypeError(`根必须是绝对路径：${options.root}`);
    const normalized = normalize(options.root);
    // 文件系统的根本身就是一个分隔符，去尾部分隔符时要留住它
    const root = normalized.length > 1 ? normalized.replace(/[\\/]+$/u, "") : normalized;
    let rootInfo;
    try {
        rootInfo = statSync(root);
    } catch {
        throw new TypeError(`根目录不存在：${root}`);
    }
    if (!rootInfo.isDirectory()) throw new TypeError(`根不是目录：${root}`);
    const resolvePath = (path: string): FilesResult<string> => {
        if (typeof path !== "string" || path === "" || isAbsolute(path) || path.includes("\0")) return fail("outside-root", `路径必须是根内相对路径：${path}`);
        const absolute = resolve(root, path);
        if (!insideRoot(root, absolute)) return fail("outside-root", `路径不在根内：${path}`);
        return {ok: true, value: absolute};
    };
    /**
     * 真实路径再判一次：目标或它的某级父目录是指向根外的符号链接时拒绝；不存在的目标按最近存在的父目录判，
     * 但那一级若是目标不存在的符号链接（悬空链接）也拒绝——写入会跟着它落到根外，而我们证明不了它在根内。
     */
    const realInsideRoot = async (absolute: string): Promise<FilesResult<string>> => {
        let probe = absolute;
        for (;;) {
            try {
                const real = await realpath(probe);
                const rootReal = await realpath(root);
                if (!insideRoot(rootReal, real)) return fail("outside-root", `路径经符号链接指向根外：${absolute}`);
                return {ok: true, value: absolute};
            } catch (error) {
                if (errorCode(error) !== "ENOENT") return fail("io-failed", errorCode(error));
                const dangling = await lstat(probe).then((info) => info.isSymbolicLink(), () => false);
                if (dangling) return fail("outside-root", `符号链接的目标不存在，无法证明在根内：${absolute}`);
                const parent = dirname(probe);
                if (parent === probe) return {ok: true, value: absolute};
                probe = parent;
            }
        }
    };
    const locate = async (path: string): Promise<FilesResult<string>> => {
        const resolved = resolvePath(path);
        return resolved.ok ? realInsideRoot(resolved.value) : resolved;
    };

    const readonly = options.readonly === true;
    return {
        kind: "directory",
        readonly,
        root,
        resolve: resolvePath,
        locate,
        async stat(path) {
            const target = await locate(path);
            if (!target.ok) return target;
            try {
                const info = await stat(target.value);
                const kind: FileKind = info.isDirectory() ? "directory" : "file";
                return {ok: true, value: {kind, bytes: info.size}};
            } catch (error) {
                return errorCode(error) === "ENOENT" ? fail("not-found", `不存在：${path}`) : fail("io-failed", errorCode(error));
            }
        },
        async readBytes(path) {
            const target = await locate(path);
            if (!target.ok) return target;
            try {
                return {ok: true, value: new Uint8Array(await readFile(target.value))};
            } catch (error) {
                const code = errorCode(error);
                if (code === "ENOENT") return fail("not-found", `不存在：${path}`);
                if (code === "EISDIR") return fail("not-a-file", `是目录：${path}`);
                return fail("io-failed", code);
            }
        },
        async list(path) {
            const target = await locate(path);
            if (!target.ok) return target;
            try {
                const entries = await readdir(target.value, {withFileTypes: true});
                const listed: {name: string; kind: FileKind}[] = [];
                for (const entry of entries) {
                    // 符号链接按它指向的东西算（指向根外的在读它时才拒绝）
                    const isDirectory = entry.isSymbolicLink() ? await stat(resolve(target.value, entry.name)).then((info) => info.isDirectory(), () => false) : entry.isDirectory();
                    listed.push({name: entry.name, kind: isDirectory ? "directory" : "file"});
                }
                listed.sort((left, right) => left.name.localeCompare(right.name));
                return {ok: true, value: listed};
            } catch (error) {
                const code = errorCode(error);
                if (code === "ENOENT") return fail("not-found", `不存在：${path}`);
                if (code === "ENOTDIR") return fail("not-a-directory", `不是目录：${path}`);
                return fail("io-failed", code);
            }
        },
        async write(path, content) {
            if (readonly) return fail("read-only", `只读方案，不能写入：${path}`);
            const target = await locate(path);
            if (!target.ok) return target;
            try {
                await mkdir(dirname(target.value), {recursive: true});
                await writeFile(target.value, content, "utf8");
                return {ok: true, value: undefined};
            } catch (error) {
                const code = errorCode(error);
                return code === "EISDIR" ? fail("not-a-file", `是目录：${path}`) : fail("io-failed", code);
            }
        },
        async remove(path) {
            if (readonly) return fail("read-only", `只读方案，不能删除：${path}`);
            const target = await locate(path);
            if (!target.ok) return target;
            try {
                const info = await stat(target.value);
                if (info.isDirectory()) return fail("not-a-file", `是目录：${path}`);
                await rm(target.value);
                return {ok: true, value: undefined};
            } catch (error) {
                const code = errorCode(error);
                return code === "ENOENT" ? fail("not-found", `不存在：${path}`) : fail("io-failed", code);
            }
        },
    };
}

/**
 * 按会话各一个目录的提供者工厂（`local://` 用）：`root/<会话 id>`，第一次打开时创建。会话 id 里不是 `[A-Za-z0-9_.-]` 的字符换成 `_`。
 * 目录不随会话结束删除：里面是会话的工作文件，由使用方按自己的规则清理。
 */
export function createSessionDirectories(options: {root: string}): (context: SchemeContext) => DirectoryProvider {
    if (!isAbsolute(options.root)) throw new TypeError(`根必须是绝对路径：${options.root}`);
    return (context) => {
        const safe = context.sessionId.replace(/[^A-Za-z0-9_.-]/gu, "_");
        const directory = join(options.root, safe === "" ? "session" : safe);
        mkdirSync(directory, {recursive: true});
        return createLocalFileAccess({root: directory});
    };
}
