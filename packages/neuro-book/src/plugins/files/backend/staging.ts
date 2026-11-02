/**
 * 暂存目录与暂存文件的提交（docs/specs/workspace/resources.md 的“暂存与提交”“副作用与数据”）。
 *
 * 写入方（服务端的写入接口）在根的暂存目录里建 `<uuid>.stage`、写入、`fsync`，再请拥有根的进程提交；拥有根的进程
 * 核对暂存文件确实在本根的暂存目录里，按期望放到位，在锁里登记回声、发事件。
 * - 暂存文件归写入方：它从建之前起就持着 `<文件>.lock` 这把活性锁（跨进程，10 秒不刷新算残留），一直到提交结算；
 *   提交只在放到位时消费暂存，冲突与失败都原样留下，由写入方删。打开根时的清理只删取得到活性锁的（写入方已不在），
 *   同一本书在另一个实例里正在写的不删。
 * - 暂存目录与它的上级必须是真实目录：`.nbook` 或 `staging` 是链接时不跟随（否则写入与清理会落到根外）。
 */

import {randomUUID} from "node:crypto";
import type {Stats} from "node:fs";
import {lstat, mkdir, open, readdir, unlink} from "node:fs/promises";
import {join} from "node:path";

import {describe, errno, holdLock} from "nbook/backend/locked-replace";
import type {HeldLock} from "nbook/backend/locked-replace";

import {STAGE_NAME} from "../shared/contracts";
import type {Baseline, CommitExpect} from "../shared/contracts";
import {pathProblem} from "../shared/resource";
import type {ChangeHub, Origin} from "./changes";
import type {Outcome} from "./files-service";
import type {RootedFailure, RootedRoot} from "./rooted";

/** 旧内容在这个大小以内时连同字节交给记账（docs/specs/workspace/resources.md 的“记账槽”）。 */
export const KEEP_BYTES = 32 * 1024 * 1024;

const LOCK_SUFFIX = ".lock";

/**
 * 在 `base` 下按段建好暂存目录（不存在就建，`0o700`），每一段都必须是真实目录、不是链接。交回绝对路径；某一段是链接
 * 或别的东西时失败，不跟随。
 */
export async function ensureStagingDirectory(base: string, segments: readonly string[]): Promise<{readonly ok: true; readonly path: string} | {readonly ok: false; readonly detail: string}> {
    let current = base;
    for (const segment of segments) {
        current = join(current, segment);
        let info = await lstat(current).catch((error: unknown) => (errno(error) === "ENOENT" ? null : error));
        if (info === null) {
            try {
                await mkdir(current, {mode: 0o700});
            } catch (error) {
                if (errno(error) !== "EEXIST") return {ok: false, detail: `无法建立暂存目录：${describe(error)}`};
            }
            info = await lstat(current).catch((error: unknown) => error);
        }
        if (!isStats(info)) return {ok: false, detail: `无法查看暂存目录：${describe(info)}`};
        if (!info.isDirectory() || info.isSymbolicLink()) return {ok: false, detail: `暂存目录的 ${segment} 不是真实目录`};
    }
    return {ok: true, path: current};
}

function isStats(value: unknown): value is Stats {
    return typeof value === "object" && value !== null && "isDirectory" in value;
}

/** 写入方建的一个暂存文件：`release` 在提交结算后调用，`discard` 删掉它再放锁。 */
export interface Stage {
    readonly name: string;
    readonly path: string;
    /** 放活性锁，不删文件（提交已消费它，或结果不确定、留给拥有根的进程）。 */
    release(): Promise<void>;
    /** 删暂存再放锁（没提交、或提交得到确定的失败）。 */
    discard(): Promise<void>;
}

/** 写入方在暂存目录里建一个暂存文件：先取活性锁、再排他建文件，清理永远看不到“有文件、没人持锁”的新暂存。 */
export async function createStage(directory: string, report: (event: string, error: unknown) => void): Promise<{readonly ok: true; readonly stage: Stage} | {readonly ok: false; readonly detail: string}> {
    const name = `${randomUUID()}.stage`;
    const path = join(directory, name);
    const held = await holdLock(path + LOCK_SUFFIX, report);
    if (!held.ok) return {ok: false, detail: held.detail};
    try {
        const handle = await open(path, "wx", 0o600);
        await handle.close();
    } catch (error) {
        await held.lock.release();
        return {ok: false, detail: `无法建立暂存文件：${describe(error)}`};
    }
    const lock: HeldLock = held.lock;
    return {
        ok: true,
        stage: {
            name,
            path,
            release: () => lock.release(),
            discard: async () => {
                await unlink(path).catch((error: unknown) => {
                    if (errno(error) !== "ENOENT") report("stage.discard-failed", error);
                });
                await lock.release();
            },
        },
    };
}

/** 打开根时清理：只删取得到活性锁的暂存文件与残留的锁目录。 */
export async function sweepStaging(directory: string, report: (event: string, error: unknown) => void): Promise<void> {
    let names: string[];
    try {
        names = await readdir(directory);
    } catch (error) {
        if (errno(error) !== "ENOENT") report("staging.sweep-failed", error);
        return;
    }
    const stages = new Set<string>();
    for (const name of names) {
        const stage = name.endsWith(LOCK_SUFFIX) ? name.slice(0, -LOCK_SUFFIX.length) : name;
        if (STAGE_NAME.test(stage)) stages.add(stage);
    }
    for (const stage of stages) {
        const path = join(directory, stage);
        const held = await holdLock(path + LOCK_SUFFIX, report, {wait: false});
        if (!held.ok) continue;
        try {
            const info = await lstat(path).catch(() => null);
            if (info !== null && info.isFile()) await unlink(path);
        } catch (error) {
            report("staging.sweep-failed", error);
        } finally {
            await held.lock.release();
        }
    }
}

export interface CommitInput {
    readonly stage: string;
    /** 写入方边写边算的新内容哈希：成功时作为新基线交回。 */
    readonly hash: string;
    readonly path: string;
    readonly expect: CommitExpect;
    readonly createParents?: boolean;
}

export interface StagingCommitterOptions {
    readonly root: RootedRoot;
    /** 本根的暂存目录（`ensureStagingDirectory` 的结果）。 */
    readonly directory: string;
    readonly changes: ChangeHub;
    readonly report: (event: string, error: unknown) => void;
}

export type StagingCommit = (input: CommitInput, origin: Origin) => Promise<Outcome<{readonly baseline: Baseline}>>;

/** 拥有根的一侧：提交暂存目录里的一个暂存文件。 */
export function createStagingCommitter(options: StagingCommitterOptions): StagingCommit {
    const {root, directory, changes} = options;
    const failed = (failure: RootedFailure): Outcome<never> => ({ok: false, code: failure.code as Exclude<RootedFailure["code"], "unknown-scheme">, detail: {detail: failure.detail}});

    /** 按段建缺的父目录；每一段都按根的规则解析（控制目录、根外链接照旧拒绝），新建的发 `created`。 */
    const ensureParents = async (path: string, origin: Origin): Promise<RootedFailure | null> => {
        const segments = path.split("/").slice(0, -1);
        for (let at = 1; at <= segments.length; at += 1) {
            const prefix = segments.slice(0, at).join("/");
            const resolved = await root.resolve(prefix);
            if (!("ok" in resolved)) {
                if (!resolved.stats.isDirectory()) return {ok: false, code: "not-a-directory", detail: `${prefix} 不是目录`};
                continue;
            }
            if (resolved.code !== "not-found") return resolved;
            const slot = await root.resolveSlot(prefix);
            if ("ok" in slot) return slot;
            try {
                await mkdir(slot.absolute);
            } catch (error) {
                if (errno(error) !== "EEXIST") return {ok: false, code: "io-failed", detail: `无法建立 ${prefix}`, cause: describe(error)};
                // 别人刚建了同名的：再解析一次，是目录就接着用（悬空链接这类仍解析不出的照常失败）。
                const again = await root.resolve(prefix);
                if ("ok" in again) return again;
                if (!again.stats.isDirectory()) return {ok: false, code: "not-a-directory", detail: `${prefix} 不是目录`};
                continue;
            }
            await changes.expect({present: [slot.path]});
            changes.emit([{type: "created", path: slot.path}], origin);
        }
        return null;
    };

    return async (input, origin) => {
        if (!STAGE_NAME.test(input.stage)) return {ok: false, code: "invalid-address", detail: {detail: "暂存文件的名字不合格式"}};
        const problem = pathProblem(input.path);
        if (problem !== null || input.path === "") return {ok: false, code: "invalid-address", detail: {detail: `${input.path}：${problem ?? "根目录本身不能写"}`}};
        const staged = join(directory, input.stage);
        const info = await lstat(staged).catch(() => null);
        if (info === null || !info.isFile()) return {ok: false, code: "io-failed", detail: {detail: "暂存文件不在本根的暂存目录里"}};
        if (input.createParents === true) {
            const parents = await ensureParents(input.path, origin);
            if (parents !== null) return failed(parents);
        }
        const {expect} = input;
        const committed = await root.commit<Outcome<never>>(input.path, {
            staged,
            keepBytes: KEEP_BYTES,
            temporaryPath: changes.temporaryPath,
            report: options.report,
            decide: (current) => {
                if (expect === "any") return {proceed: true};
                if (expect === "absent") return current === null ? {proceed: true} : {done: {ok: false, code: "conflict", detail: {detail: `${input.path} 已存在`, current: {hash: current.hash}}}};
                if (current === null) return {done: {ok: false, code: "not-found", detail: {detail: `${input.path} 不存在`}}};
                return current.hash === expect.hash ? {proceed: true} : {done: {ok: false, code: "conflict", detail: {detail: `${input.path} 在读取后被修改过`, current: {hash: current.hash}}}};
            },
            committed: async ({realPath, after, before}) => {
                changes.placed({path: input.path, realPath, after, created: before === null}, origin);
            },
        });
        if (!committed.ok) return failed(committed);
        if ("done" in committed) return committed.done;
        return {ok: true, value: {baseline: {hash: input.hash}}};
    };
}
