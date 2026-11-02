/**
 * 把写入方写好的暂存文件提交成目标文件（docs/specs/workspace/resources.md 的“暂存与提交”）：Files 写入接口的提交。
 *
 * 与 `replaceLocked` 共用写入锁与身份核对，区别在于新内容已经在暂存文件里，提交只负责把它放到位：
 * 取写入锁 → 分块读目标、算哈希 → 调用方按当前状态决定 → 设权限位 → 改名前核对锁与目标身份，变了从读目标重做 →
 * 放到位 → 锁内成功阶段（`committed`）→ 释放锁。
 * - 暂存文件归写入方：这里只在放到位时消费它，冲突、身份一直在变、失败时都原样留下，由写入方决定删不删；重做不会丢内容。
 * - 目标已存在时 `rename` 替换（硬链接断开、新 inode）；要求“必须不存在”时用 `link` 放到位，目标被并发建出来时得
 *   `EEXIST` 而不覆盖它。文件系统不支持硬链接时退回 `open(目标, "wx")` 再拷入。
 * - 跨文件系统（`EXDEV`，包括 `dev` 相同的 bind mount）时在锁里把内容拷进目标目录的临时文件再放到位。
 * - `committed` 在放到位之后、释放锁之前调用：调用方在这里取替换后的状态登记回声、记账、发事件，外部在放锁之后的
 *   改写不会被算进这一次。它出错不撤回落盘，交给 `report`。
 * - 旧内容分块读，只在 `keepBytes` 以内留下字节：替换大文件时内存不随旧文件增长。
 */

import {createHash} from "node:crypto";
import {constants} from "node:fs";
import type {Stats} from "node:fs";
import {access, chmod, copyFile, link, lstat, open, rename, unlink} from "node:fs/promises";

import {describe, errno, holdLock, readOnly, sameFile, statOrNull} from "./locked-replace";

/** 目标现在的样子；不存在为 `null`。`bytes` 只在不超过 `keepBytes` 时给。 */
export type StagedCurrent = {readonly stats: Stats; readonly hash: string; readonly bytes: Uint8Array | null} | null;

export type StagedDecision<T> = {readonly proceed: true} | {readonly done: T};

/**
 * 失败：
 * - `read-only`：目标或所在目录不可写；
 * - `not-a-file`：目标存在但不是普通文件；
 * - `unstable`：每次放到位之前目标都被别的程序改过；
 * - `failed`：锁、读、写盘等其它失败。
 */
export type StagedFailure = {readonly ok: false; readonly reason: "read-only" | "not-a-file" | "unstable" | "failed"; readonly detail: string};

export type StagedResult<T> = {readonly ok: true; readonly done: T} | {readonly ok: true; readonly before: StagedCurrent; readonly after: Stats} | StagedFailure;

export interface StagedCommitOptions<T> {
    /** 目标文件的写入锁；它的父目录必须已存在。与 `replaceLocked` 对同一文件用同一路径，两者互斥。 */
    readonly lockPath: string;
    /** 写入方写好并已 `fsync` 的暂存文件。 */
    readonly staged: string;
    /** 按目标现在的样子决定放不放；每次重做都会再调用，必须是它的纯函数。 */
    readonly decide: (current: StagedCurrent) => StagedDecision<T>;
    /** 旧内容在这个字节数以内时连同字节交给 `decide` 与 `committed`。 */
    readonly keepBytes: number;
    /** 跨文件系统时，目标目录里临时文件的路径。 */
    readonly temporaryPath: (file: string) => string;
    /** 锁内成功阶段：`after` 是放到位之后目标的 `lstat`。 */
    readonly committed: (after: Stats, before: StagedCurrent) => Promise<void>;
    /** 收尾时的次要错误与 `committed` 的失败；事件名由调用方加上自己的前缀。 */
    readonly report: (event: string, error: unknown) => void;
}

const MAX_ATTEMPTS = 3;
const CHUNK = 1024 * 1024;

/** 提交 `options.staged` 到 `file`；`file` 必须已解析到最终目标（不是符号链接），所在目录必须已存在。 */
export async function commitStaged<T>(file: string, options: StagedCommitOptions<T>): Promise<StagedResult<T>> {
    const held = await holdLock(options.lockPath, options.report);
    if (!held.ok) return failure("failed", held.reason === "locked" ? "写入锁一直被别的进程占着" : held.detail);
    try {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const outcome = await commitOnce(file, options, () => held.lock.stillHeld());
            if (outcome !== "modified") return outcome;
        }
        return failure("unstable", "提交期间文件反复被别的程序改动");
    } finally {
        await held.lock.release();
    }
}

async function commitOnce<T>(file: string, options: StagedCommitOptions<T>, stillHeld: () => Promise<string | null>): Promise<StagedResult<T> | "modified"> {
    let current: StagedCurrent;
    try {
        const before = await statOrNull(file);
        if (before !== null && !before.isFile()) return failure("not-a-file", `${file} 不是普通文件`);
        const read = before === null ? null : await readCurrent(file, before, options.keepBytes);
        if (read === "modified") return "modified";
        current = read;
    } catch (error) {
        return failure("failed", `无法读取：${describe(error)}`);
    }
    const decision = options.decide(current);
    if ("done" in decision) return {ok: true, done: decision.done};
    try {
        if (current !== null) {
            try {
                await access(file, constants.W_OK);
            } catch (error) {
                return readOnly(error) ? failure("read-only", `${file} 是只读的`) : failure("failed", `无法写入：${describe(error)}`);
            }
        }
        // 暂存文件建成 0o600；放到位之后它就是目标，权限位要在这之前定：覆盖的沿用原文件，新建的与“新建文件”一样。
        await chmod(options.staged, current === null ? 0o666 & ~process.umask() : current.stats.mode & 0o7777);
        const lost = await stillHeld();
        if (lost !== null) return failure("failed", lost);
        if (!sameFile(current?.stats ?? null, await statOrNull(file))) return "modified";
        const placed = current === null ? await placeNew(file, options) : await placeOver(file, options);
        if (placed === "exists") return "modified";
        const after = await lstat(file);
        try {
            await options.committed(after, current);
        } catch (error) {
            options.report("committed.failed", error);
        }
        return {ok: true, before: current, after};
    } catch (error) {
        return readOnly(error) ? failure("read-only", `无法写入 ${file}：${describe(error)}`) : failure("failed", `提交失败：${describe(error)}`);
    }
}

/** 分块读目标并算哈希；读的过程中目标被换掉（身份变了）为 `modified`。 */
async function readCurrent(file: string, before: Stats, keepBytes: number): Promise<NonNullable<StagedCurrent> | "modified"> {
    const handle = await open(file, "r");
    try {
        const opened = await handle.stat();
        if (opened.dev !== before.dev || opened.ino !== before.ino) return "modified";
        const hasher = createHash("sha256");
        const keep = opened.size <= keepBytes ? new Uint8Array(opened.size) : null;
        const buffer = new Uint8Array(CHUNK);
        let offset = 0;
        for (;;) {
            const {bytesRead} = await handle.read(buffer, 0, CHUNK, offset);
            if (bytesRead === 0) break;
            const chunk = buffer.subarray(0, bytesRead);
            hasher.update(chunk);
            // 读的过程中被追加写到超过大小时不再留字节：留下的会与哈希对不上。
            if (keep !== null && offset + bytesRead <= keep.length) keep.set(chunk, offset);
            offset += bytesRead;
        }
        const bytes = keep !== null && offset === keep.length ? keep : null;
        return {stats: opened, hash: hasher.digest("hex"), bytes};
    } finally {
        await handle.close();
    }
}

/** 目标不存在：`link` 放到位，不覆盖并发建出来的同名文件。被抢先时为 `exists`，由调用方从读目标重做。 */
async function placeNew<T>(file: string, options: StagedCommitOptions<T>): Promise<"placed" | "exists"> {
    try {
        await link(options.staged, file);
    } catch (error) {
        const code = errno(error);
        if (code === "EEXIST") return "exists";
        if (code === "EXDEV") return placeCopy(file, options, "new");
        // 不支持硬链接的文件系统（FAT、部分网络盘）：排他新建再拷入，期间能读到不完整的内容。
        if (code === "EPERM" || code === "ENOTSUP" || code === "EOPNOTSUPP" || code === "ENOSYS") return exclusiveCopy(file, options);
        throw error;
    }
    await unlinkQuietly(options.staged, options.report);
    return "placed";
}

/** 目标已存在：`rename` 替换。 */
async function placeOver<T>(file: string, options: StagedCommitOptions<T>): Promise<"placed"> {
    try {
        await rename(options.staged, file);
        return "placed";
    } catch (error) {
        if (errno(error) !== "EXDEV") throw error;
        return (await placeCopy(file, options, "over")) as "placed";
    }
}

/** 跨文件系统：拷进目标目录的临时文件（权限位跟着拷），再按原来的方式放到位，最后删暂存。 */
async function placeCopy<T>(file: string, options: StagedCommitOptions<T>, how: "new" | "over"): Promise<"placed" | "exists"> {
    const temporary = options.temporaryPath(file);
    try {
        await copyFile(options.staged, temporary, constants.COPYFILE_EXCL);
        const copied = await open(temporary, "r+");
        try {
            await copied.sync();
        } finally {
            await copied.close();
        }
        if (how === "over") {
            await rename(temporary, file);
        } else {
            try {
                await link(temporary, file);
            } catch (error) {
                if (errno(error) === "EEXIST") return "exists";
                throw error;
            }
        }
    } finally {
        await unlinkQuietly(temporary, options.report);
    }
    await unlinkQuietly(options.staged, options.report);
    return "placed";
}

async function exclusiveCopy<T>(to: string, options: StagedCommitOptions<T>): Promise<"placed" | "exists"> {
    try {
        await copyFile(options.staged, to, constants.COPYFILE_EXCL);
    } catch (error) {
        if (errno(error) === "EEXIST") return "exists";
        throw error;
    }
    const handle = await open(to, "r+");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
    await unlinkQuietly(options.staged, options.report);
    return "placed";
}

/** 删掉已经用不上的文件；已被改名走（不存在）不算问题，别的失败交给 `report`。 */
async function unlinkQuietly(path: string, report: (event: string, error: unknown) => void): Promise<void> {
    await unlink(path).catch((error: unknown) => {
        if (errno(error) !== "ENOENT") report("staged.cleanup-failed", error);
    });
}

function failure(reason: StagedFailure["reason"], detail: string): StagedFailure {
    return {ok: false, reason, detail};
}
