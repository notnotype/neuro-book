/**
 * 文件访问的本机参考实现（docs/specs/harness/host-kit.md），经 `@notnotype/nb-harness/kit/files/local` 交出：方案名映射到本机目录，
 * 读写直接落在磁盘上。它是套件自己测试的真实依赖，也是没有文件服务的宿主的参考；不加写锁、不记来源、不分组，宿主要这些时
 * 自己实现 `SessionFiles`（可以包它）。
 *
 * 地址只认 `<方案>://<路径>`：路径按 `/` 分段，空段、`.`、`..` 都不合法，校验之后才拼接，不做去点段。经符号链接落到根外的
 * 读写按 `outside-root` 拒绝。
 */

import {randomUUID} from "node:crypto";
import {lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat} from "node:fs/promises";
import {basename, dirname, join, relative, sep} from "node:path";

import type {ArtifactStore, Baseline, DirectoryListing, FileCalls, FileFailure, FileResult, Located, SessionFiles, SessionLayout, WriteExpect} from "./index.js";

/** 读的上限，取宿主文件服务常用的正文上限（docs/specs/workspace/resources.md 的“写入接口的读”）。 */
const READ_LIMIT_BYTES = 32 * 1024 * 1024;

export interface LocalFilesOptions {
    /** 方案名 → 本机目录（绝对路径）。全局地址 `<方案>://<路径>` 落在这个目录下。 */
    readonly roots: Readonly<Record<string, string>>;
    /** 单数写法：方案名 → 它改写成的全局地址前缀（例如 `work` → `workspaces://bot-1`）。 */
    readonly aliases?: Readonly<Record<string, string>>;
    readonly layout: SessionLayout;
    /**
     * 写这个全局地址是放行、要另外问还是拒绝。必须给：缺省成放行会让 bot 在放行写入下改掉自己的规则与记忆。全文所在的根
     * 不经它，一律拒绝会话写入。
     */
    readonly classify: (address: string) => "allowed" | "ask" | "denied";
    /** 宿主写全文的位置（全局地址）。会话经 `SessionFiles` 写这里一律 `permission-denied`。 */
    readonly artifacts: string;
}

interface Parsed {
    readonly scheme: string;
    readonly segments: readonly string[];
}

const fail = (code: string, detail: string): FileFailure => ({ok: false, code, detail});

function parse(address: string): Parsed | FileFailure {
    const match = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/u.exec(address);
    if (match === null) return fail("invalid-address", `not an address: ${address}`);
    const path = match[2]!;
    const segments = path === "" ? [] : path.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes("\\") || segment.includes("\0"))) return fail("invalid-address", `invalid path in ${address}`);
    return {scheme: match[1]!, segments};
}

const format = (parsed: Parsed): string => `${parsed.scheme}://${parsed.segments.join("/")}`;
const isFailure = (value: unknown): value is FileFailure => typeof value === "object" && value !== null && (value as {ok?: unknown}).ok === false;
const inside = (address: string, root: string): boolean => address === root || address.startsWith(root.endsWith("/") ? root : `${root}/`);

async function baselineOf(bytes: Uint8Array): Promise<Baseline> {
    const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
    return {hash: [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")};
}

const errnoOf = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | null)?.code;

/** 合并几个可能没有的信号；一个都没有时为 undefined。 */
function merged(...signals: ReadonlyArray<AbortSignal | undefined>): AbortSignal | undefined {
    const present = signals.filter((signal): signal is AbortSignal => signal !== undefined);
    return present.length <= 1 ? present[0] : AbortSignal.any(present);
}

/** 文件系统的错误换成失败码；认不出的交 `io-failed`。 */
function failureOf(error: unknown, address: string): FileFailure {
    switch (errnoOf(error)) {
        case "ENOENT":
            return fail("not-found", `${address} does not exist`);
        case "EACCES":
        case "EPERM":
            return fail("permission-denied", `the system denied access to ${address}`);
        case "ENOTDIR":
            return fail("not-a-directory", `a parent of ${address} is not a directory`);
        case "EISDIR":
            return fail("not-a-file", `${address} is a directory`);
        default:
            // 系统错误的 message 带本机路径，不放进 detail（host-kit.md 输出 9）。
            return fail("io-failed", `${address}: ${errnoOf(error) ?? (error instanceof Error ? error.name : "unknown error")}`);
    }
}

/** `child` 在 `root` 之内（含相等）。两个都是真实路径。 */
const within = (root: string, child: string): boolean => {
    const rel = relative(root, child);
    return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && rel !== "..");
};

export interface LocalFiles {
    readonly files: SessionFiles;
    readonly artifacts: ArtifactStore;
}

export function localFiles(options: LocalFilesOptions): LocalFiles {
    const expand = (address: string): {readonly ok: true; readonly address: string} | FileFailure => {
        const parsed = parse(address);
        if (isFailure(parsed)) return parsed;
        const alias = options.aliases?.[parsed.scheme];
        if (alias === undefined) return {ok: true, address: format(parsed)};
        return {ok: true, address: parsed.segments.length === 0 ? alias : `${alias}/${parsed.segments.join("/")}`};
    };

    /** 全局地址 → 本机路径（还没解析链接）与方案根。 */
    const locate = (address: string): {readonly root: string; readonly path: string; readonly global: string} | FileFailure => {
        const expanded = expand(address);
        if (!expanded.ok) return expanded;
        const parsed = parse(expanded.address) as Parsed;
        const root = options.roots[parsed.scheme];
        if (root === undefined) return fail("unknown-scheme", `no scheme ${parsed.scheme}://`);
        return {root, path: join(root, ...parsed.segments), global: expanded.address};
    };

    /** 存在的路径解析链接之后仍在根内；不在交 `outside-root`。 */
    const confined = async (root: string, path: string, address: string): Promise<string | FileFailure> => {
        const [realRoot, real] = await Promise.all([realpath(root), realpath(path)]);
        return within(realRoot, real) ? real : fail("outside-root", `${address} resolves outside its root`);
    };

    const readPath = async (address: string): Promise<FileResult<Located>> => {
        const located = locate(address);
        if (isFailure(located)) return located;
        try {
            const real = await confined(located.root, located.path, located.global);
            if (isFailure(real)) return real;
            const info = await stat(real);
            return {ok: true, value: {path: real, kind: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other"}};
        } catch (error) {
            return failureOf(error, located.global);
        }
    };

    const read = async (address: string, signal?: AbortSignal): Promise<FileResult<{readonly bytes: Uint8Array; readonly baseline: Baseline}>> => {
        const found = await readPath(address);
        if (!found.ok) return found;
        if (found.value.kind !== "file") return fail("not-a-file", `${address} is not a regular file`);
        try {
            if ((await stat(found.value.path)).size > READ_LIMIT_BYTES) return fail("too-large", `${address} is larger than ${String(READ_LIMIT_BYTES)} bytes`);
            const bytes = new Uint8Array(await readFile(found.value.path, {signal}));
            return {ok: true, value: {bytes, baseline: await baselineOf(bytes)}};
        } catch (error) {
            if (signal?.aborted === true) return fail("cancelled", `reading ${address} was cancelled`);
            return failureOf(error, address);
        }
    };

    const list = async (address: string): Promise<FileResult<DirectoryListing>> => {
        const found = await readPath(address);
        if (!found.ok) return found;
        if (found.value.kind !== "directory") return fail("not-a-directory", `${address} is not a directory`);
        try {
            // readdir 的次序随文件系统而变（ext4 按哈希、btrfs 按索引）：按名字的码点排，同一个目录在哪台机器上列出来都一样。
            const entries = (await readdir(found.value.path, {withFileTypes: true})).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
            return {ok: true, value: {entries: entries.map((entry) => ({name: entry.name, kind: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : entry.isSymbolicLink() ? "link" : "other"}))}};
        } catch (error) {
            return failureOf(error, address);
        }
    };

    /** 当前内容的基线；不存在为 null。 */
    const current = async (path: string): Promise<Baseline | null> => {
        try {
            return await baselineOf(new Uint8Array(await readFile(path)));
        } catch (error) {
            if (errnoOf(error) === "ENOENT") return null;
            throw error;
        }
    };

    /** 写一份：核对期望，写同目录的临时文件再改名（原子替换）。`content` 交给 `fill` 写进打开的临时文件。 */
    const commit = async (address: string, fill: (handle: Awaited<ReturnType<typeof open>>) => Promise<void>, expect: WriteExpect, createParents: boolean, signal: AbortSignal | undefined, host: boolean): Promise<FileResult<{readonly baseline: Baseline}>> => {
        const located = locate(address);
        if (isFailure(located)) return located;
        if (!host) {
            if (inside(located.global, options.artifacts)) return fail("permission-denied", `${located.global} is written by the host only`);
            if (options.classify(located.global) === "denied") return fail("permission-denied", `writing ${located.global} is not allowed`);
        }
        if (located.path === located.root) return fail("permission-denied", `cannot write the root of ${located.global}`);
        const parent = dirname(located.path);
        // 每次现读：中途可能被中止（类型收窄会把前一次判断的结果当成定值）。
        const aborted = (): boolean => signal?.aborted === true;
        try {
            if (createParents) {
                try {
                    await mkdir(parent, {recursive: true});
                } catch (error) {
                    // 路上有一段是文件：与没有 createParents 时同一个结论。
                    if (errnoOf(error) === "EEXIST" || errnoOf(error) === "ENOTDIR") return fail("not-a-directory", `a parent of ${located.global} is not a directory`);
                    throw error;
                }
            }
            const realParent = await confined(located.root, parent, located.global);
            if (isFailure(realParent)) return realParent;
            const target = join(realParent, basename(located.path));
            // 目标本身是指向根外的链接：替换会改到根外。
            const existing = await lstat(target).catch((error: unknown) => (errnoOf(error) === "ENOENT" ? null : Promise.reject(error)));
            if (existing?.isSymbolicLink() === true) {
                const real = await confined(located.root, target, located.global);
                if (isFailure(real)) return real;
            }
            if (existing?.isDirectory() === true) return fail("not-a-file", `${located.global} is a directory`);
            const before = await current(target);
            if (expect === "absent" ? before !== null : expect !== "any" && before?.hash !== expect.hash) return fail("conflict", `${located.global} changed since it was read`);
            if (aborted()) return fail("cancelled", `writing ${located.global} was cancelled`);
            const temporary = join(realParent, `.${randomUUID()}.tmp`);
            const handle = await open(temporary, "wx");
            try {
                await fill(handle);
            } catch (error) {
                await handle.close();
                await rm(temporary, {force: true});
                throw error;
            }
            await handle.close();
            if (aborted()) {
                await rm(temporary, {force: true});
                return fail("cancelled", `writing ${located.global} was cancelled`);
            }
            await rename(temporary, target);
            return {ok: true, value: {baseline: await current(target) as Baseline}};
        } catch (error) {
            if (aborted()) return fail("cancelled", `writing ${located.global} was cancelled`);
            return failureOf(error, located.global);
        }
    };

    /** `signal` 是绑定的那次工具调用的信号，合进每次读写。 */
    const bound = (signal: AbortSignal | undefined): FileCalls => ({
        read: (address, readOptions) => read(address, merged(signal, readOptions?.signal)),
        write: (address, content, writeOptions) => {
            const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
            return commit(address, async (handle) => {
                await handle.writeFile(bytes);
            }, writeOptions.expect, writeOptions.createParents === true, merged(signal, writeOptions.signal), false);
        },
    });

    const files: SessionFiles = {
        layout: options.layout,
        expand,
        classify: (address) => {
            const expanded = expand(address);
            if (!expanded.ok) return expanded;
            const parsed = parse(expanded.address) as Parsed;
            if (options.roots[parsed.scheme] === undefined || inside(expanded.address, options.artifacts)) return {write: "denied"};
            return {write: options.classify(expanded.address)};
        },
        readPath: (address) => readPath(address),
        list: (address) => list(address),
        ...bound(undefined),
        call: (call) => bound(call.signal),
    };

    const artifacts: ArtifactStore = {
        save: async (label, fill) => {
            if (label === "" || label === "." || label === ".." || /[/\\]/u.test(label)) return fail("invalid-address", `artifact label must be a single segment: ${label}`);
            const address = `${options.artifacts}/${label}-${randomUUID()}.log`;
            const saved = await commit(address, async (handle) => {
                await fill({write: async (chunk) => {
                    await handle.write(chunk);
                }});
            }, "absent", true, undefined, true);
            return saved.ok ? {ok: true, value: {address}} : saved;
        },
    };

    return {files, artifacts};
}
