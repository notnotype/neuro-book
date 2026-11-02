/**
 * 受根约束的文件原语（docs/specs/workspace/files.md 的“读取与保存”；包含与链接规则沿 docs/specs/platform/files.md）：
 * Files 的读、列出、保存都经这里落到磁盘，包含校验、控制目录与根身份只在这一处判定。
 *
 * - 根在打开时 `realpath` 一次，记下设备号与 inode；每个请求先核对根还是那个目录，不重新解析（根被移走后原路径上的
 *   新目录或链接不是这个项目）。
 * - 相对路径逐段 `lstat`；遇到符号链接 `realpath` 它，落在根外拒绝；之后的段在链接目标下继续。请求的词法路径与解析后的
 *   真实路径都按控制目录检查，根内的链接别名也进不了 `.nbook/`。
 * - 检查与使用之间目录项被换掉的竞态只能缩小：读用打开的句柄核对身份，保存在锁内重读并在改名前核对身份；不能证明
 *   安全的操作拒绝。
 *
 * 失败的 `detail` 只用根内相对路径，可以交给调用方；`cause` 带操作系统的原文（含绝对路径），只进诊断。
 */

import {createHash} from "node:crypto";
import type {Dirent, Stats} from "node:fs";
import {lstat, mkdir, open, readdir, realpath, stat} from "node:fs/promises";
import {join, relative, sep} from "node:path";

import {describe, errno, holdLock, replaceLocked} from "nbook/backend/locked-replace";
import type {CurrentFile, HeldLock, ReplaceDecision} from "nbook/backend/locked-replace";
import {commitStaged} from "nbook/backend/staged-commit";
import type {StagedCommitOptions, StagedCurrent} from "nbook/backend/staged-commit";

import type {FilesFailureCode} from "../shared/failures";
import {pathProblem} from "../shared/resource";

export type RootedFailure = {readonly ok: false; readonly code: FilesFailureCode; readonly detail: string; readonly cause?: string};

export interface RootOptions {
    /** 根下第一段名字（不区分大小写）为 `.nbook` 的目录是控制目录：不列出、不可读写。项目根为 true，用户资产根为 false。 */
    readonly controlDirectory: boolean;
    /** 保存用的锁目录放在这里（按真实相对路径的 hash 命名）；不存在时创建。 */
    readonly lockDirectory: string;
    /** 收尾时的次要错误（释放锁、删临时文件）。 */
    readonly report: (event: string, error: unknown) => void;
}

/** 解析到的资源：真实路径（已解析全部符号链接）、相对根的真实路径与它的状态。 */
export interface Resolved {
    readonly real: string;
    /** 相对根、用 `/` 分隔；根本身为空字符串。 */
    readonly realPath: string;
    readonly stats: Stats;
    /** 最后一段本身是符号链接（祖先目录经链接解析不算）：替换的是链接的目标，不是这个目录项。 */
    readonly viaLink: boolean;
}

export type DirectoryEntry = {readonly name: string; readonly kind: "file" | "directory" | "link" | "other"};

/** 将要出现的位置：父目录已解析，名字是合法单段。 */
export interface ResolvedSlot {
    readonly parent: Resolved;
    readonly name: string;
    readonly absolute: string;
    /** 相对根的真实路径（父目录的真实路径加名字）。 */
    readonly path: string;
}

/** 已存在的目录项：最后一段不跟随符号链接，`stats` 是 `lstat` 的结果。 */
export interface ResolvedEntry extends ResolvedSlot {
    readonly stats: Stats;
}

/**
 * 目录项身份令牌：冻结一次操作意图的源（docs/specs/workspace/files.md 的“文件操作”）。设备号、inode、创建时间与类型的
 * 摘要，不含宿主路径；inode 被回收再分配时创建时间不同。
 */
export function entryToken(stats: Stats): string {
    const kind = stats.isFile() ? "file" : stats.isDirectory() ? "directory" : stats.isSymbolicLink() ? "link" : "other";
    return createHash("sha256").update(`${String(stats.dev)}:${String(stats.ino)}:${String(stats.birthtimeMs)}:${kind}`).digest("hex").slice(0, 32);
}

const CONTROL = ".nbook";

export function isControlName(name: string): boolean {
    return name.toLowerCase() === CONTROL;
}

/** Windows 上不接受的名字：含 `:`（备用数据流），或以点、空格结尾（打开时会被去掉，指向另一个名字）。 */
function windowsNameProblem(name: string): string | null {
    if (name.includes(":")) return "Windows 上的名字不能含 :";
    if (/[. ]$/u.test(name)) return "Windows 上的名字不能以点或空格结尾";
    return null;
}

/** 读路径的解析结果：最终目标的绝对路径（可能在根外）与它的类型。 */
export interface ReadTarget {
    readonly absolute: string;
    readonly kind: "file" | "directory" | "other";
}

/** 提交暂存文件的参数：`lockPath` 由根按目标算出，其余同 `commitStaged`。 */
export type RootCommitOptions<T> = Omit<StagedCommitOptions<T>, "lockPath" | "committed"> & {
    /** 锁内成功阶段；`realPath` 是目标相对根的真实路径。 */
    readonly committed: (placed: {readonly realPath: string; readonly after: Stats; readonly before: StagedCurrent}) => Promise<void>;
};

/** 操作锁在锁目录里的名字。 */
export const OPERATIONS_LOCK = "operations.lock";

export interface RootedRoot {
    /** 根的真实路径。 */
    readonly real: string;
    resolve(path: string): Promise<Resolved | RootedFailure>;
    /** 改名、移动、删除、复制的源：作用于目录项本身，链接不跟随。根本身与控制目录（含指向它的链接）拒绝。 */
    resolveEntry(path: string): Promise<ResolvedEntry | RootedFailure>;
    /** 新建、移动、复制的目标位置；不核对它是否已存在（排他提交时才核对）。 */
    resolveSlot(path: string): Promise<ResolvedSlot | RootedFailure>;
    /**
     * 这个根的操作锁（docs/specs/workspace/folder-kinds.md 的“操作锁”），跨进程有效。整根一把：搬动目录会连带搬走其中的
     * 内容根，按内容根分锁时要找出子树里的全部内容根才能锁全。等不到为 `busy`。
     */
    lockOperations(): Promise<{readonly ok: true; readonly lock: HeldLock} | RootedFailure>;
    list(path: string): Promise<{readonly ok: true; readonly entries: ReadonlyArray<DirectoryEntry>; readonly resolved: Resolved} | RootedFailure>;
    /** 读普通文件的全部字节；超过 `maxBytes` 为 too-large，不读内容。 */
    read(path: string, maxBytes: number): Promise<{readonly ok: true; readonly bytes: Uint8Array; readonly resolved: Resolved} | RootedFailure>;
    /**
     * 写入接口的读路径（docs/specs/workspace/resources.md 的“写入接口的读”）：词法路径照旧核对控制目录与根身份，逐段解析时
     * 遇到链接跟到最终目标，目标在根外也接受；目标在根内时再按名字与 inode 别名核对控制目录。只用来读，写不经它。
     */
    resolveForRead(path: string): Promise<ReadTarget | RootedFailure>;
    /**
     * 提交写入方的暂存文件：目标已存在时替换它的最终目标（链接保留），不存在时在位置上新建（父目录必须已存在）。
     * 与 `replace` 对同一文件用同一把写入锁。
     */
    commit<T>(path: string, options: RootCommitOptions<T>): Promise<{readonly ok: true; readonly done: T} | {readonly ok: true; readonly realPath: string; readonly after: Stats; readonly before: StagedCurrent} | RootedFailure>;
    /** 在锁内按当前字节决定是否替换；路径是链接时替换最终目标、链接保留。目标不存在时 `decide` 收到 `null`。 */
    replace<T>(path: string, decide: (current: CurrentFile) => ReplaceDecision<T, Uint8Array | string>, temporaryPath?: (file: string) => string): Promise<{readonly ok: true; readonly done: T} | {readonly ok: true; readonly written: Uint8Array | string; readonly resolved: Resolved; readonly before: Stats | null; readonly after: Stats} | RootedFailure>;
}

/** 打开一个根；路径不存在或不是目录为 root-gone。 */
export async function openRoot(path: string, options: RootOptions): Promise<RootedRoot | RootedFailure> {
    let real: string;
    let identity: Stats;
    try {
        real = await realpath(path);
        identity = await stat(real);
    } catch (error) {
        return fail("root-gone", "根目录不存在", error);
    }
    if (!identity.isDirectory()) return fail("root-gone", "根不是目录");
    return new Root(real, identity, options);
}

class Root implements RootedRoot {
    readonly real: string;
    readonly #identity: Stats;
    readonly #options: RootOptions;

    constructor(real: string, identity: Stats, options: RootOptions) {
        this.real = real;
        this.#identity = identity;
        this.#options = options;
    }

    async resolve(path: string): Promise<Resolved | RootedFailure> {
        // 原语自己核对路径形状：后端插件可以绕过文件服务直接用它，`..` 一类的段会在逐段解析前就退到根外。
        const problem = pathProblem(path);
        if (problem !== null) return fail("invalid-address", `${path}：${problem}`);
        const gone = await this.#checkRoot();
        if (gone !== null) return gone;
        const segments = path === "" ? [] : path.split("/");
        if (this.#options.controlDirectory && segments.length > 0 && isControlName(segments[0] as string)) return fail("protected-path", `${path} 在项目控制目录里`);
        if (process.platform === "win32") {
            const bad = segments.find((segment) => windowsNameProblem(segment) !== null);
            if (bad !== undefined) return fail("invalid-address", `${path}：${windowsNameProblem(bad) ?? ""}`);
        }
        let current = this.real;
        let viaLink = false;
        for (const [index, segment] of segments.entries()) {
            const next = join(current, segment);
            let info: Stats;
            try {
                info = await lstat(next);
            } catch (error) {
                return missing(error, path);
            }
            if (index === 0 && (await this.#isControlEntry(info))) return fail("protected-path", `${path} 在项目控制目录里`);
            viaLink = info.isSymbolicLink();
            if (!viaLink) {
                current = next;
                continue;
            }
            let target: string;
            try {
                target = await realpath(next);
            } catch (error) {
                // 悬空链接与链接环都当作不存在：不把它当作可以新建的位置。
                return errno(error) === "ENOENT" || errno(error) === "ELOOP" || errno(error) === "ENOTDIR" ? fail("not-found", `${path} 指向不存在的目标`, error) : fail("io-failed", `无法解析 ${path}`, error);
            }
            if (target !== this.real && !target.startsWith(this.real + sep)) return fail("outside-root", `${path} 经符号链接指向根外`);
            current = target;
        }
        const realPath = relative(this.real, current).split(sep).join("/");
        if (this.#options.controlDirectory && realPath !== "" && isControlName(realPath.split("/")[0] as string)) return fail("protected-path", `${path} 经符号链接指向项目控制目录`);
        try {
            return {real: current, realPath, stats: await stat(current), viaLink};
        } catch (error) {
            return missing(error, path);
        }
    }

    async resolveForRead(path: string): Promise<ReadTarget | RootedFailure> {
        const problem = pathProblem(path);
        if (problem !== null) return fail("invalid-address", `${path}：${problem}`);
        const gone = await this.#checkRoot();
        if (gone !== null) return gone;
        const segments = path === "" ? [] : path.split("/");
        if (this.#options.controlDirectory && segments.length > 0 && isControlName(segments[0] as string)) return fail("protected-path", `${path} 在项目控制目录里`);
        if (segments.length > 0) {
            const first = await lstat(join(this.real, segments[0] as string)).catch(() => null);
            if (first !== null && (await this.#isControlEntry(first))) return fail("protected-path", `${path} 在项目控制目录里`);
        }
        let target: string;
        try {
            target = await realpath(join(this.real, ...segments));
        } catch (error) {
            return errno(error) === "ENOENT" || errno(error) === "ELOOP" || errno(error) === "ENOTDIR" ? fail("not-found", `${display(path)} 不存在`, error) : missing(error, path);
        }
        const inside = target === this.real || target.startsWith(this.real + sep);
        if (inside && this.#options.controlDirectory) {
            const first = relative(this.real, target).split(sep)[0] as string;
            if (first !== "" && isControlName(first)) return fail("protected-path", `${path} 经符号链接指向项目控制目录`);
            const head = await lstat(join(this.real, first)).catch(() => null);
            if (first !== "" && head !== null && (await this.#isControlEntry(head))) return fail("protected-path", `${path} 经符号链接指向项目控制目录`);
        }
        let info: Stats;
        try {
            info = await stat(target);
        } catch (error) {
            return missing(error, path);
        }
        return {absolute: target, kind: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other"};
    }

    async resolveSlot(path: string): Promise<ResolvedSlot | RootedFailure> {
        const problem = pathProblem(path);
        if (problem !== null) return fail("invalid-address", `${path}：${problem}`);
        if (path === "") return fail("invalid-address", "根目录本身不能作为新建、改名、移动、复制、删除或转换的对象");
        const at = path.lastIndexOf("/");
        const name = path.slice(at + 1);
        if (process.platform === "win32" && windowsNameProblem(name) !== null) return fail("invalid-address", `${path}：${windowsNameProblem(name) ?? ""}`);
        const parent = await this.resolve(at < 0 ? "" : path.slice(0, at));
        if ("ok" in parent) return parent;
        if (!parent.stats.isDirectory()) return fail("not-a-directory", `${path} 的父路径不是目录`);
        // 父目录的解析已挡住控制目录里面的路径；`.nbook` 本身的父目录是根，要按名字再挡一次（父路径经链接别名落在根上
        // 时同样）。
        if (this.#options.controlDirectory && parent.realPath === "" && isControlName(name)) return fail("protected-path", `${path} 是项目控制目录`);
        return {parent, name, absolute: join(parent.real, name), path: parent.realPath === "" ? name : `${parent.realPath}/${name}`};
    }

    async resolveEntry(path: string): Promise<ResolvedEntry | RootedFailure> {
        const slot = await this.resolveSlot(path);
        if ("ok" in slot) return slot;
        let stats: Stats;
        try {
            stats = await lstat(slot.absolute);
        } catch (error) {
            return missing(error, path);
        }
        if (stats.isSymbolicLink() && this.#options.controlDirectory && (await this.#pointsIntoControl(slot.absolute))) return fail("protected-path", `${path} 指向项目控制目录`);
        if (slot.parent.realPath === "" && (await this.#isControlEntry(stats))) return fail("protected-path", `${path} 是项目控制目录`);
        return {...slot, stats};
    }

    async lockOperations(): Promise<{readonly ok: true; readonly lock: HeldLock} | RootedFailure> {
        try {
            await mkdir(this.#options.lockDirectory, {recursive: true});
        } catch (error) {
            return fail("io-failed", "无法建立锁目录", error);
        }
        const held = await holdLock(join(this.#options.lockDirectory, OPERATIONS_LOCK), this.#options.report);
        if (!held.ok) return held.reason === "locked" ? fail("busy", "有别的文件操作正在进行") : fail("io-failed", "无法取得操作锁", held.detail);
        return {ok: true, lock: held.lock};
    }

    async list(path: string): Promise<{readonly ok: true; readonly entries: ReadonlyArray<DirectoryEntry>; readonly resolved: Resolved} | RootedFailure> {
        const resolved = await this.resolve(path);
        if ("ok" in resolved) return resolved;
        if (!resolved.stats.isDirectory()) return fail("not-a-directory", `${path} 不是目录`);
        let entries: Dirent[];
        try {
            entries = await readdir(resolved.real, {withFileTypes: true});
        } catch (error) {
            return errno(error) === "EACCES" || errno(error) === "EPERM" ? fail("permission-denied", `无权列出 ${display(path)}`, error) : missing(error, path);
        }
        const hidden = resolved.realPath === "" && this.#options.controlDirectory ? await this.#controlAliases(resolved.real, entries) : new Set<string>();
        return {
            ok: true,
            resolved,
            entries: entries.filter((entry) => !hidden.has(entry.name)).map((entry) => ({name: entry.name, kind: kindOf(entry)})),
        };
    }

    async read(path: string, maxBytes: number): Promise<{readonly ok: true; readonly bytes: Uint8Array; readonly resolved: Resolved} | RootedFailure> {
        const resolved = await this.resolve(path);
        if ("ok" in resolved) return resolved;
        if (!resolved.stats.isFile()) return fail("not-a-file", `${path} 不是普通文件`);
        let handle;
        try {
            handle = await open(resolved.real, "r");
        } catch (error) {
            return errno(error) === "EACCES" || errno(error) === "EPERM" ? fail("permission-denied", `无权读取 ${path}`, error) : missing(error, path);
        }
        try {
            const opened = await handle.stat();
            // 解析与打开之间目录项被换掉：读到的不是校验过的那个文件。
            if (opened.dev !== resolved.stats.dev || opened.ino !== resolved.stats.ino) return fail("io-failed", `读取 ${path} 时文件被替换，请重试`);
            if (opened.size > maxBytes) return fail("too-large", `${path} 有 ${String(opened.size)} 字节，超过上限`);
            const bytes = new Uint8Array(await handle.readFile());
            return {ok: true, bytes, resolved: {...resolved, stats: opened}};
        } catch (error) {
            return fail("io-failed", `读取 ${path} 失败`, error);
        } finally {
            await handle.close();
        }
    }

    async replace<T>(path: string, decide: (current: CurrentFile) => ReplaceDecision<T, Uint8Array | string>, temporaryPath?: (file: string) => string): Promise<{readonly ok: true; readonly done: T} | {readonly ok: true; readonly written: Uint8Array | string; readonly resolved: Resolved; readonly before: Stats | null; readonly after: Stats} | RootedFailure> {
        const resolved = await this.resolve(path);
        if ("ok" in resolved) return resolved;
        if (!resolved.stats.isFile()) return fail("not-a-file", `${path} 不是普通文件`);
        // 同一个真实文件经不同的链接别名也拿同一把锁。
        const lockPath = join(this.#options.lockDirectory, `${createHash("sha256").update(resolved.realPath).digest("hex")}.lock`);
        try {
            await mkdir(this.#options.lockDirectory, {recursive: true});
        } catch (error) {
            return fail("io-failed", "无法建立写入锁的目录", error);
        }
        const replaced = await replaceLocked(resolved.real, {lockPath, decide, report: this.#options.report, ...(temporaryPath === undefined ? {} : {temporaryPath})});
        if (replaced.ok) return "done" in replaced ? replaced : {ok: true, written: replaced.written, resolved, before: replaced.before, after: replaced.after};
        switch (replaced.reason) {
            case "read-only":
                return fail("permission-denied", `${path} 是只读的`, replaced.detail);
            case "not-a-file":
                return fail("not-a-file", `${path} 不是普通文件`);
            case "unstable":
                return fail("io-failed", `保存 ${path} 期间文件反复被别的程序改动`);
            case "failed":
                return fail("io-failed", `保存 ${path} 失败`, replaced.detail);
        }
    }

    async commit<T>(path: string, options: RootCommitOptions<T>): Promise<{readonly ok: true; readonly done: T} | {readonly ok: true; readonly realPath: string; readonly after: Stats; readonly before: StagedCurrent} | RootedFailure> {
        // 已存在的（含经链接的）替换最终目标；不存在的在位置上新建。悬空链接按不存在报出，不在链接的名字上建文件。
        const existing = await this.resolve(path);
        let file: string;
        let realPath: string;
        if (!("ok" in existing)) {
            if (!existing.stats.isFile()) return fail("not-a-file", `${path} 不是普通文件`);
            file = existing.real;
            realPath = existing.realPath;
        } else if (existing.code === "not-found") {
            const slot = await this.resolveSlot(path);
            if ("ok" in slot) return slot;
            const there = await lstat(slot.absolute).catch(() => null);
            if (there !== null) return fail("not-found", `${path} 指向不存在的目标`);
            file = slot.absolute;
            realPath = slot.path;
        } else {
            return existing;
        }
        const lockPath = join(this.#options.lockDirectory, `${createHash("sha256").update(realPath).digest("hex")}.lock`);
        try {
            await mkdir(this.#options.lockDirectory, {recursive: true});
        } catch (error) {
            return fail("io-failed", "无法建立写入锁的目录", error);
        }
        const committed = await commitStaged(file, {...options, lockPath, committed: (after, before) => options.committed({realPath, after, before})});
        if (committed.ok) return "done" in committed ? committed : {ok: true, realPath, after: committed.after, before: committed.before};
        switch (committed.reason) {
            case "read-only":
                return fail("permission-denied", `${path} 是只读的`, committed.detail);
            case "not-a-file":
                return fail("not-a-file", `${path} 不是普通文件`);
            case "unstable":
                return fail("io-failed", `提交 ${path} 期间文件反复被别的程序改动`);
            case "failed":
                return fail("io-failed", `提交 ${path} 失败`, committed.detail);
        }
    }

    /** 根下不列出的目录项：控制目录本身，以及解析后指向控制目录里的符号链接。解析不了的链接照常列出。 */
    async #controlAliases(real: string, entries: ReadonlyArray<Dirent>): Promise<Set<string>> {
        const hidden = new Set<string>();
        for (const entry of entries) {
            if (isControlName(entry.name)) {
                hidden.add(entry.name);
                continue;
            }
            if (entry.isSymbolicLink() && (await this.#pointsIntoControl(join(real, entry.name)))) hidden.add(entry.name);
        }
        return hidden;
    }

    /**
     * 根下的这个目录项就是控制目录，不论用什么名字找到它。按名字比只认得 `.nbook` 的大小写变体；Windows 上段尾的点与
     * 空格会被去掉、8.3 短名（`NBOOK~1`）也指向它，所以按设备号与 inode 比。拿不到 inode（为 0）的文件系统上不比，
     * 否则根下每个目录都会被当成控制目录。
     */
    async #isControlEntry(info: Stats): Promise<boolean> {
        if (!this.#options.controlDirectory || !info.isDirectory()) return false;
        const control = await lstat(join(this.real, CONTROL)).catch(() => null);
        return control !== null && control.ino !== 0 && control.dev === info.dev && control.ino === info.ino;
    }

    /** 链接解析后落在控制目录里；解析不了的链接不算。 */
    async #pointsIntoControl(link: string): Promise<boolean> {
        const target = await realpath(link).catch(() => null);
        if (target === null || (target !== this.real && !target.startsWith(this.real + sep))) return false;
        return isControlName(relative(this.real, target).split(sep)[0] as string);
    }

    async #checkRoot(): Promise<RootedFailure | null> {
        let now: Stats;
        try {
            now = await lstat(this.real);
        } catch (error) {
            return fail("root-gone", "根目录已不在", error);
        }
        if (!now.isDirectory() || now.dev !== this.#identity.dev || now.ino !== this.#identity.ino) return fail("root-gone", "根目录被移走或替换");
        return null;
    }
}

function kindOf(entry: Dirent): DirectoryEntry["kind"] {
    if (entry.isFile()) return "file";
    if (entry.isDirectory()) return "directory";
    if (entry.isSymbolicLink()) return "link";
    return "other";
}

function missing(error: unknown, path: string): RootedFailure {
    const code = errno(error);
    if (code === "ENOENT" || code === "ENOTDIR") return fail("not-found", `${display(path)} 不存在`, error);
    if (code === "EACCES" || code === "EPERM") return fail("permission-denied", `无权访问 ${display(path)}`, error);
    return fail("io-failed", `访问 ${display(path)} 失败`, error);
}

function display(path: string): string {
    return path === "" ? "根目录" : path;
}

export function fail(code: FilesFailureCode, detail: string, cause?: unknown): RootedFailure {
    return cause === undefined ? {ok: false, code, detail} : {ok: false, code, detail, cause: typeof cause === "string" ? cause : describe(cause)};
}
