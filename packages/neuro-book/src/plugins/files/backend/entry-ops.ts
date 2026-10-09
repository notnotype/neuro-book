/**
 * 目录项上的写原语（docs/specs/workspace/files.md 的“文件操作”）：排他新建、排他改名、复制、删除。源与目标都已由
 * `RootedRoot.resolveEntry`、`resolveSlot` 解析过（包含、控制目录、根身份），这里只落到磁盘。
 *
 * - 提交本身就是检查：新建用 `wx` 与不递归的 `mkdir`，改名用 `renameNoReplace`，复制的每一项都排他创建；没有
 *   “先查目标再写”的分支，预检之后目标被占用仍得到冲突。
 * - 部分完成如实报告：目录复制中途失败把已产生的目标留在原处并报告为残留；递归删除遇到第一个失败就停，报告已删除的
 *   最外层路径。
 *
 * 结果里的路径都是相对根的真实路径。
 */

import {constants} from "node:fs";
import type {Stats} from "node:fs";
import {access, chmod, copyFile, lstat, mkdir, open, readdir, readlink, rmdir, symlink, unlink} from "node:fs/promises";
import {join, sep} from "node:path";

import {describe, errno} from "nbook/backend/locked-replace";

import type {FilesFailureCode} from "../shared/failures";
import {renameNoReplace} from "./exclusive";
import {fail} from "./rooted";
import type {ResolvedEntry, ResolvedSlot, RootedFailure} from "./rooted";

/** 部分完成的范围：`residual` 是复制留下的东西，`removed` 是删除已经删掉的东西。 */
export interface Partial {
    readonly removed?: ReadonlyArray<string>;
    readonly residual?: ReadonlyArray<string>;
}

export type EntryFailure = RootedFailure & {readonly partial?: Partial};
export type EntryResult = {readonly ok: true} | EntryFailure;

export interface CopyOptions {
    /** 单个文件先复制到这个临时名（同目录、带实例标记，监视不把它当外部变化），再排他改名到目标。 */
    readonly temporaryPath: (file: string) => string;
    /** 每产生一个目录项回调一次（目录在建好时，文件与链接在写完时）：回声登记用，中途失败时已产生的也都报过。 */
    readonly created?: (absolute: string, path: string) => void;
}

export async function createFile(slot: ResolvedSlot): Promise<EntryResult> {
    try {
        const handle = await open(slot.absolute, "wx");
        await handle.close();
        return {ok: true};
    } catch (error) {
        return failure(error, `新建 ${slot.path}`);
    }
}

export async function createDirectory(slot: ResolvedSlot): Promise<EntryResult> {
    try {
        await mkdir(slot.absolute);
        return {ok: true};
    } catch (error) {
        return failure(error, `新建 ${slot.path}`);
    }
}

/** 排他改名或移动目录项本身；目标已存在为 conflict，移到自身后代为 into-itself。 */
export function moveEntry(entry: ResolvedEntry, slot: ResolvedSlot): EntryResult {
    if (inside(entry, slot)) return fail("into-itself", `不能把 ${entry.path} 移到它自己里面`);
    const moved = renameNoReplace(entry.absolute, slot.absolute);
    if (moved.ok) return {ok: true};
    switch (moved.reason) {
        case "exists":
            return fail("conflict", `${slot.path} 已存在`);
        case "missing":
            return fail("not-found", `${entry.path} 不存在`);
        case "cross-device":
            return fail("unsupported", `${entry.path} 与 ${slot.path} 不在同一个设备上，不支持移动`);
        case "unsupported":
            return fail("unsupported", `文件系统不支持排他改名（${moved.code}）`);
        case "denied":
            return fail("permission-denied", `无权移动 ${entry.path}`, moved.code);
        case "failed":
            return fail("io-failed", `移动 ${entry.path} 失败`, moved.code);
    }
}

/** 复制目录项；源不变。链接复制为链接，设备、FIFO、套接字让这一项失败。 */
export async function copyEntry(entry: ResolvedEntry, slot: ResolvedSlot, options: CopyOptions): Promise<EntryResult> {
    if (inside(entry, slot)) return fail("into-itself", `不能把 ${entry.path} 复制到它自己里面`);
    if (entry.stats.isFile()) return copyFileAtomically(entry, slot, options);
    if (entry.stats.isSymbolicLink()) return copyLink(entry.absolute, slot.absolute, slot.path, options);
    if (!entry.stats.isDirectory()) return fail("unsupported", `${entry.path} 是特殊文件，不能复制`);
    try {
        await mkdir(slot.absolute);
    } catch (error) {
        return failure(error, `新建 ${slot.path}`);
    }
    options.created?.(slot.absolute, slot.path);
    const copied = await copyTree(entry.absolute, entry.stats, slot.absolute, slot.path, entry.path, options);
    if (copied.ok) return copied;
    // 目标目录是本次排他创建的，里面已有的东西都是这次复制产生的：留在原处，整棵报告为残留。
    return {...copied, partial: {residual: [slot.path]}};
}

/** 删除目录项本身；目录递归删除，遇到第一个失败就停。 */
export async function deleteEntry(entry: ResolvedEntry): Promise<EntryResult> {
    const removed: string[] = [];
    const outcome = await remove(entry.absolute, entry.stats, entry.path, removed);
    if (outcome === null) return {ok: true};
    return removed.length === 0 ? outcome : {...outcome, partial: {removed}};
}

/** 目标落在源目录自身或其后代里；源是链接时复制或移动的是链接本身，不会进到它指向的目录。 */
function inside(entry: ResolvedEntry, slot: ResolvedSlot): boolean {
    if (!entry.stats.isDirectory()) return false;
    return slot.parent.real === entry.absolute || slot.parent.real.startsWith(entry.absolute + sep);
}

async function copyFileAtomically(entry: ResolvedEntry, slot: ResolvedSlot, options: CopyOptions): Promise<EntryResult> {
    const temporary = options.temporaryPath(slot.absolute);
    try {
        // copyFile 带上源文件的权限位。
        await copyFile(entry.absolute, temporary, constants.COPYFILE_EXCL);
    } catch (error) {
        return cleanUp(temporary, slot, failure(error, `复制 ${entry.path}`));
    }
    const moved = renameNoReplace(temporary, slot.absolute);
    if (moved.ok) {
        options.created?.(slot.absolute, slot.path);
        return {ok: true};
    }
    const failed = moved.reason === "exists" ? fail("conflict", `${slot.path} 已存在`) : fail("io-failed", `复制 ${entry.path} 失败`, moved.code);
    return cleanUp(temporary, slot, failed);
}

/** 删掉复制用的临时文件；删不掉时报告为残留（临时名在目标目录里）。 */
async function cleanUp(temporary: string, slot: ResolvedSlot, failed: RootedFailure): Promise<EntryResult> {
    try {
        await unlink(temporary);
        return failed;
    } catch (error) {
        if (errno(error) === "ENOENT") return failed;
        const name = temporary.slice(temporary.lastIndexOf(sep) + 1);
        const parent = slot.parent.realPath;
        return {...failed, partial: {residual: [parent === "" ? name : `${parent}/${name}`]}};
    }
}

async function copyLink(source: string, target: string, path: string, options: CopyOptions): Promise<EntryResult> {
    try {
        // 链接原文照抄，不解析：相对链接搬到别的目录后可能指向别处，这是“复制链接”本身的含义。
        await symlink(await readlink(source), target);
        options.created?.(target, path);
        return {ok: true};
    } catch (error) {
        return failure(error, `复制链接 ${path}`);
    }
}

/** 按名字的码元次序逐项复制，结果可复现；目录的权限位在填完内容后再设（只读目录要先能往里写）。 */
async function copyTree(source: string, stats: Stats, target: string, path: string, sourcePath: string, options: CopyOptions): Promise<EntryResult> {
    let names: string[];
    try {
        names = (await readdir(source)).sort(byCodeUnit);
    } catch (error) {
        return failure(error, `列出 ${sourcePath}`);
    }
    for (const name of names) {
        const from = join(source, name);
        const to = join(target, name);
        const childPath = `${path}/${name}`;
        const childSource = `${sourcePath}/${name}`;
        let child: Stats;
        try {
            child = await lstat(from);
        } catch (error) {
            return failure(error, `复制 ${childSource}`);
        }
        let copied: EntryResult;
        if (child.isFile()) {
            try {
                await copyFile(from, to, constants.COPYFILE_EXCL);
                options.created?.(to, childPath);
                copied = {ok: true};
            } catch (error) {
                copied = failure(error, `复制 ${childSource}`);
            }
        } else if (child.isSymbolicLink()) {
            copied = await copyLink(from, to, childPath, options);
        } else if (child.isDirectory()) {
            try {
                await mkdir(to);
                options.created?.(to, childPath);
                copied = await copyTree(from, child, to, childPath, childSource, options);
            } catch (error) {
                copied = failure(error, `复制 ${childSource}`);
            }
        } else {
            copied = fail("unsupported", `${childSource} 是特殊文件，不能复制`);
        }
        if (!copied.ok) return copied;
    }
    try {
        await chmod(target, stats.mode & 0o7777);
    } catch (error) {
        return failure(error, `设置 ${path} 的权限`);
    }
    return {ok: true};
}

/** 删除一个目录项；成功返回 null。`removed` 收集已删掉的最外层路径（目录整棵删掉时只记目录本身）。 */
async function remove(absolute: string, stats: Stats, path: string, removed: string[]): Promise<RootedFailure | null> {
    if (stats.isDirectory()) {
        let names: string[];
        try {
            names = (await readdir(absolute)).sort(byCodeUnit);
        } catch (error) {
            return failure(error, `列出 ${path}`);
        }
        const before = removed.length;
        for (const name of names) {
            const child = join(absolute, name);
            let childStats: Stats;
            try {
                childStats = await lstat(child);
            } catch (error) {
                if (errno(error) === "ENOENT") continue;
                return failure(error, `删除 ${path}/${name}`);
            }
            const failed = await remove(child, childStats, `${path}/${name}`, removed);
            if (failed !== null) return failed;
        }
        try {
            await rmdir(absolute);
        } catch (error) {
            return failure(error, `删除 ${path}`);
        }
        // 整个目录删掉了：它的子项不再单独报告。
        removed.splice(before);
        removed.push(path);
        return null;
    }
    if (stats.isFile()) {
        // unlink 只看父目录的权限；显示为只读的文件要在这里拒绝（Spec 的“失败与恢复”）。
        try {
            await access(absolute, constants.W_OK);
        } catch (error) {
            if (errno(error) === "EACCES" || errno(error) === "EPERM" || errno(error) === "EROFS") return fail("permission-denied", `${path} 是只读的`, error);
            return failure(error, `删除 ${path}`);
        }
    }
    try {
        await unlink(absolute);
    } catch (error) {
        if (errno(error) === "ENOENT") return null;
        return failure(error, `删除 ${path}`);
    }
    removed.push(path);
    return null;
}

function byCodeUnit(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function failure(error: unknown, action: string): RootedFailure {
    const code = errno(error);
    const mapped: FilesFailureCode = code === "EEXIST" || code === "ENOTEMPTY" ? "conflict"
        : code === "ENOENT" || code === "ENOTDIR" ? "not-found"
            : code === "EACCES" || code === "EPERM" || code === "EROFS" ? "permission-denied"
                : code === "EXDEV" ? "unsupported"
                    : "io-failed";
    const detail = mapped === "conflict" ? `${action}：目标已存在` : mapped === "not-found" ? `${action}：不存在` : mapped === "permission-denied" ? `${action}：没有权限` : `${action}失败`;
    return fail(mapped, detail, describe(error));
}
