/**
 * 第三方插件的安装根与登记表（docs/specs/runtime/plugin-install.md 的“术语”“副作用与数据”）。
 *
 * 布局：`<State Root>/plugins/` 下有登记表 `plugins.json`、它的写入锁 `.plugins.json.lock`、准备中的复制
 * `.staging/<随机名>/`（各带自己的锁 `<随机名>.lock`），以及安装目录 `<插件 id>/<版本>/`。
 *
 * 一个状态根只跑一个服务端，但应用的命令行会在服务端运行时离线写登记表，所以登记表的读改写与版本目录的
 * 改名都在写入锁里做；锁是跨进程的（`@notnotype/nb-file-lock` 的 `holdLock`）。只读的列表不取锁：登记表
 * 用临时文件改名替换，读者只会读到完整的旧表或新表。
 */

import {randomUUID} from "node:crypto";
import {lstat, mkdir, open, readFile, rename, unlink} from "node:fs/promises";
import {join, resolve, sep} from "node:path";

import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import {errno, holdLock} from "@notnotype/nb-file-lock";
import type {HeldLock} from "@notnotype/nb-file-lock";
import {isPluginId} from "@notnotype/nb-runtime/plugin-manifest";

import type {PlatformProfile} from "nbook/plugin-platform/shared/profile";
import {npmVersions} from "nbook/plugin-platform/shared/versions";

export const RECORD_FILE = "plugins.json";
export const STAGING_DIR = ".staging";
const LOCK_NAME = `.${RECORD_FILE}.lock`;

const EntrySchema = Type.Object({
    version: Type.String({minLength: 1}),
    /** 下一次启动要切换到的版本；没有为 null。 */
    pendingVersion: Type.Union([Type.String({minLength: 1}), Type.Null()]),
    state: Type.Union([Type.Literal("enabled"), Type.Literal("disabled"), Type.Literal("uninstalling")]),
    /** 卸载时是否同时删除私有数据；本轮不提供删除的选项，总是 false。 */
    deleteData: Type.Boolean(),
}, {additionalProperties: false});

/** `schema` 的取值由平台档案给出（`registrySchema`），读时另行核对。 */
const RecordSchema = Type.Object({
    schema: Type.String(),
    plugins: Type.Record(Type.String(), EntrySchema),
}, {additionalProperties: false});

export type PluginRecord = Static<typeof RecordSchema>;
export type RecordEntry = PluginRecord["plugins"][string];

export function emptyRecord(profile: PlatformProfile): PluginRecord {
    return {schema: profile.registrySchema, plugins: {}};
}

export type RecordRead = {readonly ok: true; readonly record: PluginRecord} | {readonly ok: false; readonly detail: string};

/**
 * 登记表里每一项的 id 与版本都要能当安装目录的一段路径用：启动时要按它们删除与回收目录，坏掉或被手改的登记表
 * 不能让删除越出 `<State Root>/plugins/`。有一项不合格就整表不可用。
 */
function entryProblem(id: string, entry: RecordEntry, profile: PlatformProfile): string | null {
    if (!isPluginId(id) || profile.format.isBuiltinId(id)) return `插件 id 不合格：${id}`;
    if (!npmVersions.isVersion(entry.version)) return `${id} 的版本不合格：${entry.version}`;
    if (entry.pendingVersion !== null && !npmVersions.isVersion(entry.pendingVersion)) return `${id} 的待切换版本不合格：${entry.pendingVersion}`;
    return null;
}

/** 读登记表：不存在视为空表；不是合法 JSON 或结构不符时整体不可用，调用方不得覆盖它。 */
export async function readRecord(root: string, profile: PlatformProfile): Promise<RecordRead> {
    let text: string;
    try {
        text = await readFile(join(root, RECORD_FILE), "utf8");
    } catch (error) {
        if (errno(error) === "ENOENT") return {ok: true, record: emptyRecord(profile)};
        return {ok: false, detail: `读取插件登记表失败：${brief(error)}`};
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        return {ok: false, detail: "插件登记表不是合法 JSON"};
    }
    const schema = profile.registrySchema;
    if (!Value.Check(RecordSchema, parsed)) {
        const first = [...Value.Errors(RecordSchema, parsed)][0];
        return {ok: false, detail: `插件登记表不符合 ${schema}：${first === undefined ? "" : `${first.instancePath} ${first.message}`}`};
    }
    if (parsed.schema !== schema) return {ok: false, detail: `插件登记表不符合 ${schema}：模式标记是 ${parsed.schema}`};
    for (const [id, entry] of Object.entries(parsed.plugins)) {
        const problem = entryProblem(id, entry, profile);
        if (problem !== null) return {ok: false, detail: `插件登记表不符合 ${schema}：${problem}`};
    }
    return {ok: true, record: parsed};
}

/** 失去写入锁：锁被判为残留、由别的进程接管。之后不能再按手里的旧登记表改任何东西。 */
export class LockLost extends Error {
    constructor(detail: string) {
        super(detail);
        this.name = "LockLost";
    }
}

/** 删除、改名这类改共享目录的操作之前调用：失去锁时抛 `LockLost`。 */
export async function assertHeld(lock: HeldLock): Promise<void> {
    const lost = await lock.stillHeld();
    if (lost !== null) throw new LockLost(lost);
}

/**
 * 原子替换登记表：写同目录的临时文件、落盘，改名前再核对一次仍持有写入锁（同 `replaceLocked`），失去锁时抛 `LockLost`、
 * 不覆盖接管者写的表。
 */
export async function writeRecord(root: string, record: PluginRecord, lock: HeldLock): Promise<void> {
    const temporary = join(root, `.${RECORD_FILE}.${randomUUID()}.tmp`);
    try {
        const handle = await open(temporary, "wx", 0o644);
        try {
            await handle.writeFile(`${JSON.stringify(record, null, 4)}\n`, "utf8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await assertHeld(lock);
        await rename(temporary, join(root, RECORD_FILE));
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
}

export type LockedResult<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly detail: string};

/**
 * 持写入锁执行 `task`。`task` 在每一步删除、改名与写登记表之前用 `assertHeld` 核对仍持有锁：锁被判为残留、被别的
 * 进程接管之后，按旧登记表删改目录会毁掉接管者已提交的安装。核对与操作之间仍有一个很小的窗口。
 */
export async function withRecordLock<T>(root: string, report: (event: string, error: unknown) => void, task: (lock: HeldLock) => Promise<T>): Promise<LockedResult<T>> {
    try {
        await mkdir(root, {recursive: true});
    } catch (error) {
        return {ok: false, detail: `无法创建插件目录：${brief(error)}`};
    }
    const held = await holdLock(join(root, LOCK_NAME), report);
    if (!held.ok) return {ok: false, detail: `插件登记表的写入锁：${held.detail}`};
    try {
        return {ok: true, value: await task(held.lock)};
    } finally {
        await held.lock.release();
    }
}

/**
 * 发给窗口的错误说明只带错误码（`EACCES`），不带 Node 错误原文里的路径与内部细节；完整错误由调用方记进诊断。
 */
export function brief(error: unknown): string {
    return errno(error) ?? (error instanceof Error ? error.name : "未知错误");
}

/** 列表与诊断按 id 排序，同一输入得到同一结果。 */
export function byId<T extends {readonly id: string}>(left: T, right: T): number {
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * 安装根下的路径。各段来自已校验的登记表或目录名，这里再核对一次结果仍在安装根里：删除与回收只能动自己拥有的目录。
 */
export function ownedPath(root: string, ...segments: string[]): string {
    const path = resolve(root, ...segments);
    if (segments.length === 0 || !path.startsWith(`${resolve(root)}${sep}`)) throw new Error(`路径越出了插件目录：${segments.join("/")}`);
    return path;
}

/**
 * `path` 存在且是符号链接。安装根下的目录可能被换成指向别处的链接（例如插件开发者把源码目录链进来）：往它里面
 * 删改会越出安装根，`ownedPath` 只核对字面路径，看不出来。
 */
export async function isLink(path: string): Promise<boolean> {
    try {
        return (await lstat(path)).isSymbolicLink();
    } catch (error) {
        if (errno(error) === "ENOENT") return false;
        throw error;
    }
}

/** 写登记表时崩溃留下的临时文件；启动回收时删除。插件 id 不以 `.` 开头，安装根下以 `.` 开头的都不是插件目录。 */
export function isRecordTemporary(name: string): boolean {
    return name.startsWith(`.${RECORD_FILE}.`) && name.endsWith(".tmp");
}
