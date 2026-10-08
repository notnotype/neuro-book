/**
 * 一层配置文件的读与写（docs/specs/settings/configuration.md 输出 13、14，“副作用与数据”）。
 *
 * 写入：先不持锁读一次，新文本与当前相同就直接成功，不建目录、不取锁、不碰文件（删除不存在的键没有副作用）；否则取写入锁
 * → 读当前文本并记下文件身份 → 由调用方算出新文本（仍相同就不写）→ 写同目录的临时文件 → 改名前核对仍持有锁、文件身份
 * 没变，身份变了就从新文本重做 → 改名替换 → 释放锁。
 * - 写入锁：两个服务端可以同时打开同一个项目（docs/specs/runtime/projects.md），同一份项目层会有两个拥有者，进程内的
 *   串行挡不住它们互相覆盖对方改的键。锁是目标旁的 `<目标>.lock`（proper-lockfile，诊断插件也用它），只在读到改名之间持有。
 * - 锁被判为残留、被别的进程接管后，本次写入失去资格：proper-lockfile 接管时删掉锁目录再建，所以改名前比对锁目录的
 *   身份（连同 `onCompromised` 报告的失效）就能发现，此时放弃写入、返回 write-failed。核对与改名之间仍有一个很小的窗口。
 * - 外部编辑器不走锁，改名前的身份核对只能缩小窗口：核对与改名之间仍可能被写入。
 * - 改名替换会绕过文件的只读位，所以目标存在时先核对可写；临时文件沿用原文件的权限位。
 * - 符号链接解析到最终目标，替换目标、不动链接；链接悬空时不写，免得把链接换成普通文件。
 */

import {randomUUID} from "node:crypto";
import {constants} from "node:fs";
import {access, lstat, mkdir, open, readFile, realpath, rename, stat, unlink} from "node:fs/promises";
import type {Stats} from "node:fs";
import {basename, dirname, join} from "node:path";

import {lock} from "proper-lockfile";

/** 锁目录 10 秒没有刷新视为残留，可被接管；所有 NeuroBook 进程必须一致。 */
const LOCK_STALE_MS = 10_000;
/** 等锁的退避：约 3 秒仍等不到为 write-failed。 */
const LOCK_RETRIES = {retries: 12, factor: 1.5, minTimeout: 20, maxTimeout: 600} as const;
/** 改名前发现文件被别人改过时，从新文本重做的次数上限。 */
const MAX_ATTEMPTS = 3;

export type LayerTarget =
    | {readonly kind: "file" | "missing"; readonly target: string}
    /** 链接的最终目标存在。 */
    | {readonly kind: "link"; readonly target: string}
    | {readonly kind: "dangling"};

/** 配置文件路径的落点：普通文件、还不存在、符号链接（解析到最终目标）、悬空链接。 */
export async function resolveTarget(path: string): Promise<LayerTarget> {
    let info: Stats;
    try {
        info = await lstat(path);
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return {kind: "missing", target: path};
        throw error;
    }
    if (!info.isSymbolicLink()) return {kind: "file", target: path};
    try {
        return {kind: "link", target: await realpath(path)};
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return {kind: "dangling"};
        throw error;
    }
}

export type ReadLayer = {readonly ok: true; readonly text: string} | {readonly ok: false; readonly detail: string};

/** 读文件文本：不存在（含悬空链接）为空文本；其它读取错误给出原因，由拥有者把层记为无效。 */
export async function readLayerFile(path: string): Promise<ReadLayer> {
    try {
        return {ok: true, text: await readFile(path, "utf8")};
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return {ok: true, text: ""};
        return {ok: false, detail: `无法读取：${describe(error)}`};
    }
}

/** 由当前文本算出新文本；不能写时给出原因（例如文件当前无效），原样作为写入失败交回。 */
export type Transform = (current: string) => {readonly ok: true; readonly text: string} | {readonly ok: false; readonly code: string; readonly detail: string};

export type WriteLayer = {readonly ok: true; readonly text: string} | {readonly ok: false; readonly code: string; readonly detail: string};

/**
 * 写一层：`transform` 在取锁前调用一次，持锁后每次重做时再各调用一次，必须是当前文本的纯函数。失败码 `write-failed`
 * 由本模块给出，其余来自 `transform`。
 * 收尾时的次要错误（释放锁、删临时文件）不改变结果，交给 `report` 记诊断。
 */
export async function writeLayerFile(path: string, transform: Transform, report: (event: string, error: unknown) => void): Promise<WriteLayer> {
    let target: LayerTarget;
    try {
        target = await resolveTarget(path);
    } catch (error) {
        return failed(`无法解析配置文件的位置：${describe(error)}`);
    }
    if (target.kind === "dangling") return failed(`${path} 是符号链接，目标不存在；不替换这个链接`);
    const file = target.target;
    // 不持锁的预读：新文本与当前相同时，这次写入在“读到的那一刻”已经完成，不必取锁。
    const unlocked = await readLayerFile(file);
    if (unlocked.ok) {
        const preview = transform(unlocked.text);
        if (!preview.ok) return preview;
        if (preview.text === unlocked.text) return {ok: true, text: unlocked.text};
    }
    try {
        await mkdir(dirname(file), {recursive: true});
    } catch (error) {
        return failed(`无法创建目录：${describe(error)}`);
    }
    const lockPath = `${file}.lock`;
    let release: () => Promise<void>;
    let compromised: unknown = null;
    let lost = false;
    try {
        release = await lock(file, {realpath: false, lockfilePath: lockPath, stale: LOCK_STALE_MS, retries: LOCK_RETRIES, onCompromised: (error) => {
            compromised = error;
        }});
    } catch (error) {
        return failed(errno(error) === "ELOCKED" ? "写入锁一直被别的进程占着" : `无法取得写入锁：${describe(error)}`);
    }
    try {
        let held: Stats;
        try {
            held = await stat(lockPath);
        } catch (error) {
            return failed(`无法核对写入锁：${describe(error)}`);
        }
        const stillHeld = async (): Promise<string | null> => {
            if (compromised !== null) return `写入锁在写入期间失效：${describe(compromised)}`;
            const now = await statOrNull(lockPath);
            if (now !== null && now.dev === held.dev && now.ino === held.ino) return null;
            lost = true;
            return "写入锁在写入期间被判为残留、已被别的进程接管";
        };
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
            const outcome = await writeOnce(file, transform, stillHeld, report);
            if (outcome !== "modified") return outcome;
        }
        return failed("写入期间文件反复被别的程序改动");
    } finally {
        // 锁已归别人时不释放：释放会删掉接管者的锁目录，proper-lockfile 的刷新计时器随后发现锁目录变了，自行停下。
        // 已报告失效的锁 proper-lockfile 已经放下，也不必释放。
        if (!lost && compromised === null) await releaseLock(release, report);
    }
}

async function releaseLock(release: () => Promise<void>, report: (event: string, error: unknown) => void): Promise<void> {
    try {
        await release();
    } catch (error) {
        report("settings.lock.release-failed", error);
    }
}

/** 一次读、算、写、核对、改名；改名前发现文件变了返回 `modified`，由调用方重做。 */
async function writeOnce(file: string, transform: Transform, stillHeld: () => Promise<string | null>, report: (event: string, error: unknown) => void): Promise<WriteLayer | "modified"> {
    let before: Stats | null;
    let current: string;
    try {
        before = await statOrNull(file);
        current = before === null ? "" : await readFile(file, "utf8");
    } catch (error) {
        return failed(`无法读取：${describe(error)}`);
    }
    const next = transform(current);
    if (!next.ok) return next;
    if (next.text === current) return {ok: true, text: current};
    if (before !== null) {
        try {
            await access(file, constants.W_OK);
        } catch (error) {
            return failed(errno(error) === "EACCES" || errno(error) === "EPERM" ? `${file} 是只读的` : `无法写入：${describe(error)}`);
        }
    }
    const temporary = join(dirname(file), `.${basename(file)}.${randomUUID()}.tmp`);
    try {
        const handle = await open(temporary, "wx", before === null ? 0o644 : before.mode & 0o777);
        try {
            await handle.writeFile(next.text, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        const lost = await stillHeld();
        if (lost !== null) {
            await unlink(temporary);
            return failed(lost);
        }
        if (!sameFile(before, await statOrNull(file))) {
            await unlink(temporary);
            return "modified";
        }
        await rename(temporary, file);
        return {ok: true, text: next.text};
    } catch (error) {
        await unlink(temporary).catch((cleanup: unknown) => {
            if (errno(cleanup) !== "ENOENT") report("settings.temporary.cleanup-failed", cleanup);
        });
        return failed(`写盘失败：${describe(error)}`);
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

function failed(detail: string): {readonly ok: false; readonly code: "write-failed"; readonly detail: string} {
    return {ok: false, code: "write-failed", detail};
}

export function errno(error: unknown): string | null {
    return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

function describe(error: unknown): string {
    const code = errno(error);
    const message = error instanceof Error ? error.message : String(error);
    return code === null ? message : `${code}（${message}）`;
}
