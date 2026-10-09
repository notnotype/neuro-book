/**
 * 加锁替换一个文件：配置层文件（docs/specs/settings/configuration.md 输出 14）与 Files 的条件保存
 * （docs/specs/workspace/files.md 的“读取与保存”）共用的提交。
 *
 * 取写入锁 → 读当前字节并记下文件身份 → 由调用方按当前字节决定写什么或就此结束 → 写同目录的临时文件 → 改名前核对仍持有锁、
 * 文件身份没变，身份变了就从新字节重做 → 改名替换 → 释放锁。
 * - 写入锁跨进程：两个服务端可以同时打开同一个项目（docs/specs/runtime/projects.md），同一个文件会有两个写入方，进程内的
 *   串行挡不住它们互相覆盖。锁是 proper-lockfile 的锁目录，只在读到改名之间持有；锁目录放在哪里由调用方定（配置层放在文件旁，
 *   Files 放进控制目录，免得出现在用户的目录里）。
 * - 锁被判为残留、被别的进程接管后，本次写入失去资格：proper-lockfile 接管时删掉锁目录再建，所以改名前比对锁目录的
 *   身份（连同 `onCompromised` 报告的失效）就能发现，此时放弃写入。核对与改名之间仍有一个很小的窗口。
 * - 外部编辑器不走锁，改名前的身份核对只能缩小窗口：核对与改名之间仍可能被写入。
 * - 改名替换会绕过文件的只读位，所以目标存在时先核对可写；临时文件沿用原文件的权限位。
 * - `file` 必须已解析到最终目标（不是符号链接）：对链接改名会把链接换成普通文件。
 */

import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {access, open, readFile, rename, stat, unlink} from "node:fs/promises";
import type {Stats} from "node:fs";
import {basename, dirname, join} from "node:path";

import {lock} from "proper-lockfile";

/** 锁目录 10 秒没有刷新视为残留，可被接管；所有 NeuroBook 进程必须一致。 */
const LOCK_STALE_MS = 10_000;
/** 等锁的退避：约 3 秒仍等不到为失败。 */
const LOCK_RETRIES = {retries: 12, factor: 1.5, minTimeout: 20, maxTimeout: 600} as const;
/** 改名前发现文件被别人改过时，从新字节重做的次数上限。 */
const MAX_ATTEMPTS = 3;

/** 持锁读到的当前文件；不存在为 `null`。 */
export type CurrentFile = {readonly stats: Stats; readonly bytes: Uint8Array} | null;

/** 调用方对当前文件的决定：写入这些字节（或文本，按 UTF-8 写），或不写、以 `done` 结束。必须是当前文件的纯函数：每次重做都会再调用。 */
export type ReplaceDecision<T, W extends Uint8Array | string> = {readonly write: W} | {readonly done: T};

/**
 * 替换失败：
 * - `read-only`：目标或所在目录不可写；
 * - `not-a-file`：目标存在但不是普通文件；
 * - `unstable`：每次改名前文件都被别的程序改过；
 * - `failed`：锁、读、写盘等其它失败。
 */
export type ReplaceFailure = {readonly ok: false; readonly reason: "read-only" | "not-a-file" | "unstable" | "failed"; readonly detail: string};

export type ReplaceResult<T, W extends Uint8Array | string> = {readonly ok: true; readonly done: T} | {readonly ok: true; readonly written: W} | ReplaceFailure;

export interface ReplaceOptions<T, W extends Uint8Array | string> {
    /** 锁目录的路径；它的父目录必须已存在。 */
    readonly lockPath: string;
    readonly decide: (current: CurrentFile) => ReplaceDecision<T, W>;
    /** 同目录临时文件的路径；缺省为 `.<文件名>.<随机>.tmp`。 */
    readonly temporaryPath?: (file: string) => string;
    /** 收尾时的次要错误（`lock.release-failed`、`temporary.cleanup-failed`）不改变结果，交给它记诊断；事件名由调用方加上自己的前缀。 */
    readonly report: (event: string, error: unknown) => void;
}

/** 加锁替换 `file`；`file` 所在目录必须已存在。 */
export async function replaceLocked<T, W extends Uint8Array | string>(file: string, options: ReplaceOptions<T, W>): Promise<ReplaceResult<T, W>> {
    let release: () => Promise<void>;
    let compromised: unknown = null;
    let lost = false;
    try {
        release = await lock(file, {realpath: false, lockfilePath: options.lockPath, stale: LOCK_STALE_MS, retries: LOCK_RETRIES, onCompromised: (error) => {
            compromised = error;
        }});
    } catch (error) {
        return failure("failed", errno(error) === "ELOCKED" ? "写入锁一直被别的进程占着" : `无法取得写入锁：${describe(error)}`);
    }
    try {
        let held: Stats;
        try {
            held = await stat(options.lockPath);
        } catch (error) {
            return failure("failed", `无法核对写入锁：${describe(error)}`);
        }
        const stillHeld = async (): Promise<string | null> => {
            if (compromised !== null) return `写入锁在写入期间失效：${describe(compromised)}`;
            const now = await statOrNull(options.lockPath);
            if (now !== null && now.dev === held.dev && now.ino === held.ino) return null;
            lost = true;
            return "写入锁在写入期间被判为残留、已被别的进程接管";
        };
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const outcome = await replaceOnce(file, options, stillHeld);
            if (outcome !== "modified") return outcome;
        }
        return failure("unstable", "写入期间文件反复被别的程序改动");
    } finally {
        // 锁已归别人时不释放：释放会删掉接管者的锁目录，proper-lockfile 的刷新计时器随后发现锁目录变了，自行停下。
        // 已报告失效的锁 proper-lockfile 已经放下，也不必释放。
        if (!lost && compromised === null) await releaseLock(release, options.report);
    }
}

async function releaseLock(release: () => Promise<void>, report: (event: string, error: unknown) => void): Promise<void> {
    try {
        await release();
    } catch (error) {
        report("lock.release-failed", error);
    }
}

/** 一次读、决定、写、核对、改名；改名前发现文件变了返回 `modified`，由调用方重做。 */
async function replaceOnce<T, W extends Uint8Array | string>(file: string, options: ReplaceOptions<T, W>, stillHeld: () => Promise<string | null>): Promise<ReplaceResult<T, W> | "modified"> {
    let before: Stats | null;
    let current: CurrentFile;
    try {
        before = await statOrNull(file);
        if (before !== null && !before.isFile()) return failure("not-a-file", `${file} 不是普通文件`);
        current = before === null ? null : {stats: before, bytes: await readFile(file)};
    } catch (error) {
        return failure("failed", `无法读取：${describe(error)}`);
    }
    const decision = options.decide(current);
    if ("done" in decision) return {ok: true, done: decision.done};
    if (before !== null) {
        try {
            await access(file, constants.W_OK);
        } catch (error) {
            return readOnly(error) ? failure("read-only", `${file} 是只读的`) : failure("failed", `无法写入：${describe(error)}`);
        }
    }
    const temporary = options.temporaryPath?.(file) ?? join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
    try {
        const handle = await open(temporary, "wx", before === null ? 0o644 : before.mode & 0o777);
        try {
            await handle.writeFile(decision.write);
            await handle.sync();
        } finally {
            await handle.close();
        }
        const lostLock = await stillHeld();
        if (lostLock !== null) {
            await unlink(temporary);
            return failure("failed", lostLock);
        }
        if (!sameFile(before, await statOrNull(file))) {
            await unlink(temporary);
            return "modified";
        }
        await rename(temporary, file);
        return {ok: true, written: decision.write};
    } catch (error) {
        await unlink(temporary).catch((cleanup: unknown) => {
            if (errno(cleanup) !== "ENOENT") options.report("temporary.cleanup-failed", cleanup);
        });
        return readOnly(error) ? failure("read-only", `无法写入 ${dirname(file)}：${describe(error)}`) : failure("failed", `写盘失败：${describe(error)}`);
    }
}

async function statOrNull(file: string): Promise<Stats | null> {
    try {
        return await stat(file);
    } catch (error) {
        if (errno(error) === "ENOENT") return null;
        throw error;
    }
}

/** 文件身份：设备、inode、大小、修改时间；原来不存在、现在被创建也算变了。 */
function sameFile(left: Stats | null, right: Stats | null): boolean {
    if (left === null || right === null) return left === right;
    return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function readOnly(error: unknown): boolean {
    return errno(error) === "EACCES" || errno(error) === "EPERM" || errno(error) === "EROFS";
}

function failure(reason: ReplaceFailure["reason"], detail: string): ReplaceFailure {
    return {ok: false, reason, detail};
}

export function errno(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

export function describe(error: unknown): string {
    const code = errno(error);
    const message = error instanceof Error ? error.message : String(error);
    return code === null ? message : `${code}（${message}）`;
}
