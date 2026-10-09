/**
 * 一个方案根上的文件服务：列出一层（三类文件夹的投影）、读取与按基线保存（docs/specs/workspace/resources.md、
 * folder-kinds.md、files.md）。落盘经 `rooted.ts`；这里只把磁盘事实整理成合同的形状。
 *
 * 列出不读任何正文：普通目录只 `readdir` 一次；内容树里另读一次所属内容根的 `content.xml`，并对每个子目录 `lstat`
 * 一次它的 `index.md`。清单每次列出都重新读，不跨请求缓存：没有监视时缓存无法知道它是否还对。
 */

import {createHash} from "node:crypto";
import {lstat} from "node:fs/promises";
import {join} from "node:path";

import type {Baseline, DirectoryEntry, FileText, Listing, ManifestState} from "../shared/contracts";
import {encodedTextBytes, TEXT_BUDGET_BYTES} from "../shared/contracts";
import type {FilesFailureCode} from "../shared/failures";
import {pathProblem} from "../shared/resource";
import {BODY_NAME, compareEntries, folderKindOf, itemsAt, MANIFEST_NAME, parseManifest} from "./folder-kinds";
import type {ManifestItem} from "./folder-kinds";
import type {RootedFailure, RootedRoot} from "./rooted";

/** 清单文件的读取上限。 */
const MANIFEST_MAX_BYTES = 1024 * 1024;

export type ProviderFailureCode = Exclude<FilesFailureCode, "unknown-scheme">;

export type Outcome<T> =
    | {readonly ok: true; readonly value: T}
    | {readonly ok: false; readonly code: ProviderFailureCode; readonly detail: {readonly detail: string} | {readonly detail: string; readonly current: Baseline}};

export interface FilesServiceOptions {
    readonly root: RootedRoot;
    /** 失败的操作系统原文（含绝对路径）只进诊断。 */
    readonly diagnose: (event: string, detail: string, cause: string) => void;
}

export interface SavedFile {
    readonly baseline: Baseline;
    /** 真实文件相对根的路径：经链接保存时与请求的路径不同。 */
    readonly realPath: string;
    /** 写入的字节：回声判断用它的 hash。 */
    readonly bytes: Uint8Array;
}

export interface FilesService {
    list(path: string): Promise<Outcome<Listing>>;
    read(path: string): Promise<Outcome<FileText>>;
    write(path: string, text: string, baseline: Baseline, temporaryPath?: (file: string) => string): Promise<Outcome<SavedFile>>;
}

export function hashOf(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}

/** 只接受 UTF-8；BOM 留在文本里（保存时原样写回），含 NUL 的视为二进制。 */
export function decodeText(bytes: Uint8Array): string | null {
    if (bytes.includes(0)) return null;
    try {
        return new TextDecoder("utf-8", {fatal: true, ignoreBOM: true}).decode(bytes);
    } catch {
        // 非法 UTF-8：TextDecoder 只给 TypeError，没有更多可记的信息。
        return null;
    }
}

export function createFilesService(options: FilesServiceOptions): FilesService {
    const {root} = options;

    const failed = (failure: RootedFailure, event: string): Outcome<never> => {
        if (failure.cause !== undefined) options.diagnose(event, failure.detail, failure.cause);
        return {ok: false, code: failure.code as ProviderFailureCode, detail: {detail: failure.detail}};
    };
    const invalid = (path: string): Outcome<never> | null => {
        const problem = pathProblem(path);
        return problem === null ? null : {ok: false, code: "invalid-address", detail: {detail: `${path}：${problem}`}};
    };

    const manifestOf = async (contentRoot: string): Promise<{readonly state: ManifestState; readonly items: ReadonlyArray<ManifestItem>}> => {
        const path = contentRoot === "" ? MANIFEST_NAME : `${contentRoot}/${MANIFEST_NAME}`;
        const read = await root.read(path, MANIFEST_MAX_BYTES);
        if (!("bytes" in read)) {
            if (read.code === "not-found") return {state: {status: "absent", detail: `${path} 不存在`}, items: []};
            if (read.cause !== undefined) options.diagnose("files.manifest.unreadable", read.detail, read.cause);
            return {state: {status: "unreadable", detail: read.detail}, items: []};
        }
        const text = decodeText(read.bytes);
        if (text === null) return {state: {status: "unreadable", detail: `${path} 不是 UTF-8 文本`}, items: []};
        const parsed = parseManifest(text);
        return parsed.ok ? {state: {status: "ok"}, items: parsed.items} : {state: {status: "invalid", detail: `${path}：${parsed.detail}`}, items: []};
    };

    return {
        list: async (path) => {
            const bad = invalid(path);
            if (bad !== null) return bad;
            const listed = await root.list(path);
            if (!listed.ok) return failed(listed, "files.list.failed");
            const segments = path === "" ? [] : path.split("/");
            const folder = segments.length === 0 ? "plain" : folderKindOf(segments[segments.length - 1] as string);
            const disk: DirectoryEntry[] = listed.entries.map((entry) => entry.kind === "directory" ? {name: entry.name, kind: entry.kind, folder: folderKindOf(entry.name)} : {name: entry.name, kind: entry.kind});
            let index = -1;
            for (let at = segments.length - 1; at >= 0; at -= 1) {
                if (folderKindOf(segments[at] as string) === "content") {
                    index = at;
                    break;
                }
            }
            if (folder === "binder" || index < 0) return {ok: true, value: {folder, contentRoot: null, entries: disk.sort(compareEntries)}};

            const contentRoot = segments.slice(0, index + 1).join("/");
            const atContentRoot = index === segments.length - 1;
            const marked = await Promise.all(disk.map(async (entry): Promise<DirectoryEntry> => {
                if (entry.kind === "directory") return {...entry, body: await hasBody(join(listed.resolved.real, entry.name))};
                if (entry.kind === "file" && atContentRoot && entry.name === MANIFEST_NAME) return {...entry, role: "manifest"};
                if (entry.kind === "file" && !atContentRoot && entry.name === BODY_NAME) return {...entry, role: "body"};
                return entry;
            }));
            const manifest = await manifestOf(contentRoot);
            if (manifest.state.status !== "ok") return {ok: true, value: {folder, contentRoot, manifest: manifest.state, entries: marked.sort(compareEntries)}};
            const level = itemsAt(manifest.items, segments.slice(index + 1)) ?? [];
            const byName = new Map(marked.map((entry) => [entry.name, entry]));
            const ordered: DirectoryEntry[] = level.map((item) => {
                const display = {...(item.title === undefined ? {} : {title: item.title}), ...(item.icon === undefined ? {} : {icon: item.icon})};
                const entry = byName.get(item.name);
                byName.delete(item.name);
                return entry === undefined ? {name: item.name, kind: "missing", ...display, listed: true} : {...entry, ...display, listed: true};
            });
            const unlisted = [...byName.values()].sort(compareEntries).map((entry): DirectoryEntry => ({...entry, listed: false}));
            return {ok: true, value: {folder, contentRoot, manifest: manifest.state, entries: [...ordered, ...unlisted]}};
        },

        read: async (path) => {
            const bad = invalid(path);
            if (bad !== null) return bad;
            // 编码后的正文至少有原字节那么长：原字节超过预算就不必读。
            const read = await root.read(path, TEXT_BUDGET_BYTES);
            if (!("bytes" in read)) return failed(read, "files.read.failed");
            const text = decodeText(read.bytes);
            if (text === null) return {ok: false, code: "not-text", detail: {detail: `${path} 不是 UTF-8 文本`}};
            if (encodedTextBytes(text) > TEXT_BUDGET_BYTES) return {ok: false, code: "too-large", detail: {detail: `${path} 超过正文上限`}};
            return {ok: true, value: {text, baseline: {hash: hashOf(read.bytes)}}};
        },

        write: async (path, text, baseline, temporaryPath) => {
            const bad = invalid(path);
            if (bad !== null) return bad;
            if (encodedTextBytes(text) > TEXT_BUDGET_BYTES) return {ok: false, code: "too-large", detail: {detail: `${path} 的正文超过上限`}};
            const bytes = new TextEncoder().encode(text);
            const replaced = await root.replace<Outcome<never>>(path, (current) => {
                if (current === null) return {done: {ok: false, code: "not-found", detail: {detail: `${path} 不存在`}}};
                const now = hashOf(current.bytes);
                return now === baseline.hash ? {write: bytes} : {done: {ok: false, code: "conflict", detail: {detail: `${path} 在读取后被修改过`, current: {hash: now}}}};
            }, temporaryPath);
            if (!replaced.ok) return failed(replaced, "files.write.failed");
            if ("done" in replaced) return replaced.done;
            return {ok: true, value: {baseline: {hash: hashOf(bytes)}, realPath: replaced.resolved.realPath, bytes}};
        },
    };
}

async function hasBody(directory: string): Promise<boolean> {
    try {
        return (await lstat(join(directory, BODY_NAME))).isFile();
    } catch {
        // 不存在或无权查看都按“没有正文”：只决定节点的点击行为，打开时读取会给出确切原因。
        return false;
    }
}
