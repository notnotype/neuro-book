/**
 * 安装级的更新状态与启动时换上（docs/specs/runtime/desktop-update.md 输出 7、8、9，“状态与转换”的时序）。不依赖 Electrobun：
 * 更新器经 `UpdaterPort` 交进来，锁用 nb-flock。设计与取舍见 w00046 t10 的计划“启动时换上”一节。
 *
 * 两个文件都放在更新器的通道根（`%LOCALAPPDATA%\<identifier>\<channel>\`），换上时整个被替换的 `app` 目录之外：
 *
 * - `nbook-install.lock`：在用这份安装的壳各持一把共享锁，到进程退出为止；发起换上要拿独占，有人在用就拿不到。锁文件建好就
 *   不删（nb-flock 锁的是文件，删了再建是另一把锁）。
 * - `nbook-update-state.json`：已下载的、发起过还没对账的、失败与被取代的、等着显示的通知。
 *
 * 状态文件只有一个写者（读改写之间没有锁）：只有 `auto` 模式的壳读写它，且只在两段时间里写——持有安装独占时
 * （`applyAtStartup`），持有缺省状态根的桌面锁时（`reconcileAtStartup` 与更新控制器，到控制器 `close()` 为止）。持桌面锁的壳
 * 一直持有共享锁，别人拿不到独占；缺省状态根的桌面锁同一时刻只有一个壳持有。所以两段互斥。
 */

import {randomUUID} from "node:crypto";
import {lstat, opendir, readFile, rename, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {tryLock} from "@notnotype/nb-flock";
import type {FileLock} from "@notnotype/nb-flock";
import {Type} from "typebox";
import type {Static} from "typebox";
import {Value} from "typebox/value";

import {at} from "./deadline";
import type {DeadlineClock} from "./deadline";

export const INSTALL_LOCK_FILE = "nbook-install.lock";
export const UPDATE_STATE_FILE = "nbook-update-state.json";

/** 更新器认的一份包：换上与对账一律比哈希，版本只用于显示与只升不降（同版本可能有不同的包）。 */
export interface UpdateTarget {
    readonly version: string;
    readonly hash: string;
}

/** 更新器换上程序留下的结果（Electrobun 2.0.6 通道根里的 `.electrobun-update-<事务号>.result.json`，已校验过）。 */
export interface ApplyResult {
    readonly version: string;
    readonly hash: string;
    readonly success: boolean;
    readonly phase: string;
    /** 结果文件的修改时间（毫秒）。 */
    readonly modifiedAt: number;
}

export type CheckResult = {readonly ok: true; readonly version: string; readonly hash: string} | {readonly ok: false; readonly error: string};
export type DownloadResult = {readonly ok: true} | {readonly ok: false; readonly error: string};

/**
 * 更新器（适配层 `desktop/src/bun/index.ts` 接 Electrobun 的 `Updater`）。方法都不抛错：失败按返回值交回，文字只进日志。
 */
export interface UpdaterPort {
    /** 正在运行的这个构建。 */
    readonly local: UpdateTarget;
    /** 读更新清单。 */
    check(): Promise<CheckResult>;
    /** 下载并校验 `target`；成功只在更新器准备好的正是这个哈希时。 */
    download(target: UpdateTarget): Promise<DownloadResult>;
    /** 换上已下载的那份。`exiting`：更新器已开始结束这个进程，调用方什么都不再做。其余都是同步失败（被否决、没有可换的、发起不成）。 */
    apply(): Promise<"exiting" | {readonly failed: string}>;
    /** 通道根里全部合格的结果文件；目录读不了、条目太多时 null（按“还没有结果”处理）。 */
    results(): Promise<ReadonlyArray<ApplyResult> | null>;
    /** 换上程序（`electrobun-update-*.exe`）的进程还在不在；查不了时 null（按“还在”处理）。 */
    helperRunning(): Promise<boolean | null>;
}

const Hash = Type.String({minLength: 1});
const Target = Type.Object({version: Type.String({minLength: 1}), hash: Hash});
const UpdateStateSchema = Type.Object({
    downloaded: Type.Union([Target, Type.Null()]),
    /** 发起过换上、还没对账：`from` 是发起时本地的哈希，`at` 是发起时刻（毫秒，写在调 `apply()` 之前）。 */
    attempt: Type.Union([Type.Object({version: Type.String({minLength: 1}), hash: Hash, from: Hash, at: Type.Number()}), Type.Null()]),
    /** 换上失败的哈希：不再自动换上，直到用户明确重新下载并成功。 */
    failed: Type.Array(Hash),
    /** 被更高版本的下载取代的哈希：更新器准备新的之前就失败时旧文件可能还在，但不再换上（输出 7）。 */
    superseded: Type.Array(Hash),
    /** 等产品窗口显示的一次性通知；`forHash` 是该显示它的那个构建。 */
    pendingNotice: Type.Union([Type.Object({kind: Type.Union([Type.Literal("updated"), Type.Literal("update-failed")]), version: Type.String({minLength: 1}), forHash: Hash}), Type.Null()]),
});

export type UpdateState = Static<typeof UpdateStateSchema>;
export type ApplyAttempt = NonNullable<UpdateState["attempt"]>;
export type PendingNotice = NonNullable<UpdateState["pendingNotice"]>;

export const EMPTY_UPDATE_STATE: UpdateState = {downloaded: null, attempt: null, failed: [], superseded: [], pendingNotice: null};

/** 失败、被取代两个名单各留最近的几个。 */
const HASH_LIST_LIMIT = 8;

export function withHash(list: ReadonlyArray<string>, hash: string): string[] {
    return [...list.filter((item) => item !== hash), hash].slice(-HASH_LIST_LIMIT);
}

export function withoutHash(list: ReadonlyArray<string>, hash: string): string[] {
    return list.filter((item) => item !== hash);
}

/** 状态文件：整份读、整份原子替换。只由单写者（模块头）使用。 */
export interface UpdateStatePort {
    /** 文件不存在时是空状态；截断、坏 JSON、形状不对、读不了时也是空状态（“没有可换的”），并写日志。 */
    read(): Promise<UpdateState>;
    /** 写临时文件再改名替换；失败抛错（调用方决定这一步还做不做）。 */
    write(state: UpdateState): Promise<void>;
}

export function fileUpdateState(channelRoot: string, report: (event: string, error: unknown) => void): UpdateStatePort {
    const path = join(channelRoot, UPDATE_STATE_FILE);
    return {
        async read() {
            let text: string;
            try {
                text = await readFile(path, "utf8");
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") report("desktop.update.state-unreadable", error);
                return EMPTY_UPDATE_STATE;
            }
            try {
                const parsed: unknown = JSON.parse(text);
                if (Value.Check(UpdateStateSchema, parsed)) return parsed;
                report("desktop.update.state-invalid", new Error("update state file does not match the schema"));
            } catch (error) {
                report("desktop.update.state-invalid", error);
            }
            return EMPTY_UPDATE_STATE;
        },
        async write(state) {
            const temporary = `${path}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`);
                await rename(temporary, path);
            } catch (error) {
                await rm(temporary, {force: true});
                throw error;
            }
        },
    };
}

/**
 * 有没有可换的：已下载的那份不是正在运行的构建、不在失败与被取代名单里、版本高于本地。版本比较由调用方给（只升不降的判定
 * 在控制器里，这里不重复解析）。
 */
export function usableDownload(state: UpdateState, local: UpdateTarget, newer: (version: string, than: string) => boolean): UpdateTarget | null {
    const downloaded = state.downloaded;
    if (downloaded === null || downloaded.hash === local.hash) return null;
    if (state.failed.includes(downloaded.hash) || state.superseded.includes(downloaded.hash)) return null;
    return newer(downloaded.version, local.version) ? downloaded : null;
}

export interface ApplyAtStartupOptions {
    readonly channelRoot: string;
    readonly updater: Pick<UpdaterPort, "local" | "apply">;
    readonly state: UpdateStatePort;
    readonly newer: (version: string, than: string) => boolean;
    readonly now: () => number;
    /** 这次启动已作废（启动中关掉了启动页）：还没交给更新器就不再交，放下独占、不记失败。 */
    readonly cancelled: () => boolean;
    /** 拿到独占、确定要换时调用：启动页显示“正在更新到 <版本>”。 */
    readonly onApplying: (version: string) => void;
    readonly report: (event: string, error: unknown) => void;
}

/**
 * 启动时换上（输出 8，只在 `auto` 模式、取桌面锁之前调用）。交回 `exiting` 时更新器正在结束进程，调用方什么都不再做；
 * 交回 `continue` 时照常启动（没有可换的、有人在用、别人刚换过、同步失败都在这里）。之后由调用方取共享锁
 * （`acquireInstallUse`）。
 */
export async function applyAtStartup(options: ApplyAtStartupOptions): Promise<"exiting" | "continue"> {
    const local = options.updater.local;
    const before = await options.state.read();
    if (before.attempt !== null || usableDownload(before, local, options.newer) === null) return "continue";
    const lockPath = join(options.channelRoot, INSTALL_LOCK_FILE);
    let exclusive: FileLock | null;
    try {
        exclusive = tryLock(lockPath);
    } catch (error) {
        options.report("desktop.update.install-lock-failed", error);
        return "continue";
    }
    if (exclusive === null) {
        options.report("desktop.update.apply-skipped-in-use", new Error("another shell is using this installation"));
        return "continue";
    }
    // 拿到独占之后重读：别的壳可能在我们读和拿锁之间刚换过（输出 8 的“再核对一次”）。
    const state = await options.state.read();
    const target = state.attempt === null ? usableDownload(state, local, options.newer) : null;
    if (target === null) {
        exclusive.release();
        return "continue";
    }
    try {
        await options.state.write({...state, attempt: {version: target.version, hash: target.hash, from: local.hash, at: options.now()}});
    } catch (error) {
        // 记不下发起过就不发起：之后没法对账。
        options.report("desktop.update.attempt-write-failed", error);
        exclusive.release();
        return "continue";
    }
    // 取消只在交给更新器之前看一次：在这之前的几步都是很快的文件操作。
    if (options.cancelled()) {
        // 写了 attempt 却不发起：清掉它，免得下一次启动等一个不存在的换上程序。
        await options.state.write(state).catch((error: unknown) => options.report("desktop.update.state-write-failed", error));
        exclusive.release();
        return "continue";
    }
    options.onApplying(target.version);
    const outcome = await options.updater.apply();
    // 独占不放，到进程被结束由系统放掉（nb-flock 的锁跟着文件句柄走）：这之后到换上程序接手，没有别的壳能发起换上。
    if (outcome === "exiting") return "exiting";
    options.report("desktop.update.apply-failed", new Error(outcome.failed));
    try {
        await options.state.write({...state, attempt: null, failed: withHash(state.failed, target.hash), pendingNotice: {kind: "update-failed", version: target.version, forHash: local.hash}});
    } catch (error) {
        options.report("desktop.update.state-write-failed", error);
    }
    exclusive.release();
    return "continue";
}

export interface InstallUseOptions {
    readonly channelRoot: string;
    readonly clock: DeadlineClock;
    /** 拿不到时等多久（缺省 30 秒）；每秒重试一次。 */
    readonly waitMs?: number;
    readonly report: (event: string, error: unknown) => void;
}

/** 共享锁拿不到时的重试间隔与等待上限（输出 8；拿不到说明别人正持有独占在发起换上，它调完 `apply()` 就退出）。 */
const INSTALL_POLL_MS = 1_000;
export const INSTALL_WAIT_MS = 30_000;

/**
 * 登记“在用这份安装”：取共享锁，持有到进程退出。拿不到就每秒重试，到等待上限还拿不到交回 null，由调用方报启动错误
 * （不无锁启动：没有登记就启动的壳挡不住别人发起换上）。锁文件打不开等别的失败也交回 null 并写日志。
 */
export async function acquireInstallUse(options: InstallUseOptions): Promise<FileLock | null> {
    const lockPath = join(options.channelRoot, INSTALL_LOCK_FILE);
    const deadline = options.clock.now() + (options.waitMs ?? INSTALL_WAIT_MS);
    for (;;) {
        let lock: FileLock | null;
        try {
            lock = tryLock(lockPath, {shared: true});
        } catch (error) {
            options.report("desktop.update.install-lock-failed", error);
            return null;
        }
        if (lock !== null) return lock;
        if (options.clock.now() >= deadline) return null;
        await new Promise<void>((resolve) => at(options.clock, Math.min(deadline, options.clock.now() + INSTALL_POLL_MS), resolve));
    }
}

/** 结果文件的规则照 Electrobun 2.0.6 `Updater.ts` 的 `scanNativeUpdateResults` 与 `validateNativeUpdateResult`。 */
const RESULT_FILE = /^\.electrobun-update-([a-f0-9]{32})\.result\.json$/u;
const RESULT_FIELDS = ["channel", "hash", "identifier", "message", "phase", "schema_version", "success", "transaction_id", "version"];
const RESULT_PHASES = new Set(["validating", "waiting_for_parent", "extracting", "validating_payload", "swapping", "integrating", "launching", "complete"]);
const RESULT_HASH = /^[a-z0-9]{1,13}$/u;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_DIRECTORY_ENTRIES = 1024;
const MAX_RESULT_FILES = 64;

/** 这份安装在更新器里的身份：结果文件里的 `identifier`、`channel` 要与它相同。 */
export interface UpdaterIdentity {
    readonly identifier: string;
    readonly channel: string;
}

/**
 * 读通道根里换上程序留下的结果文件（适配层的 `UpdaterPort.results` 用它）。这是对 Electrobun 2.0.6 私有文件格式的依赖，升级
 * Electrobun 时要重核：只认文件名 `.electrobun-update-<32 位十六进制>.result.json` 的普通文件（不跟符号链接、不超过 64 KiB），
 * 字段一个不多一个不少、`transaction_id` 与文件名相同、`success` 等于 `phase === "complete"`；不合格的跳过。不写、不删这些
 * 文件，也不写 SDK 的“已观察”标记（那是 SDK 自己的对账用的）。
 *
 * 交回全部合格的，不像 SDK 那样按当前构建挑一个：装回旧版之后要读到那次成功的结果。通道根不是规范的绝对路径、不是目录、
 * 读不了、条目或结果文件太多时交回 null；通道根不存在时交回空列表。
 */
export async function scanApplyResults(channelRoot: string, identity: UpdaterIdentity): Promise<ReadonlyArray<ApplyResult> | null> {
    if (resolve(channelRoot) !== channelRoot) return null;
    const rootStat = await lstat(channelRoot).catch((error: unknown) => ((error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null));
    if (rootStat === undefined) return [];
    if (rootStat === null || !rootStat.isDirectory()) return null;
    const names: Array<{name: string; transaction: string}> = [];
    try {
        let seen = 0;
        for await (const entry of await opendir(channelRoot)) {
            seen += 1;
            if (seen > MAX_DIRECTORY_ENTRIES) return null;
            const match = RESULT_FILE.exec(entry.name);
            if (match?.[1] === undefined) continue;
            names.push({name: entry.name, transaction: match[1]});
            if (names.length > MAX_RESULT_FILES) return null;
        }
    } catch {
        return null;
    }
    const results: ApplyResult[] = [];
    for (const {name, transaction} of names) {
        const path = join(channelRoot, name);
        const stat = await lstat(path).catch(() => null);
        if (stat === null || !stat.isFile() || stat.size <= 0 || stat.size > MAX_RESULT_BYTES) continue;
        let document: unknown;
        try {
            document = JSON.parse(await readFile(path, "utf8"));
        } catch {
            continue;
        }
        const result = validResult(document, transaction, identity);
        if (result !== null) results.push({...result, modifiedAt: Number.isFinite(stat.mtimeMs) ? stat.mtimeMs : 0});
    }
    return results;
}

function validResult(document: unknown, transaction: string, identity: UpdaterIdentity): Omit<ApplyResult, "modifiedAt"> | null {
    if (typeof document !== "object" || document === null || Array.isArray(document)) return null;
    const record = document as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== RESULT_FIELDS.length || keys.some((key, index) => key !== RESULT_FIELDS[index])) return null;
    const {schema_version: schemaVersion, transaction_id: transactionId, success, phase, message, identifier, channel, version, hash} = record;
    if (schemaVersion !== 1 || transactionId !== transaction || typeof success !== "boolean") return null;
    if (typeof phase !== "string" || !RESULT_PHASES.has(phase)) return null;
    if (typeof message !== "string" || message.length === 0 || message.length > 4096 || CONTROL_CHARACTER.test(message)) return null;
    if (identifier !== identity.identifier || channel !== identity.channel) return null;
    if (typeof version !== "string" || version.length === 0 || version.length > 256 || CONTROL_CHARACTER.test(version)) return null;
    if (typeof hash !== "string" || !RESULT_HASH.test(hash)) return null;
    if (success !== (phase === "complete")) return null;
    return {version, hash, success, phase};
}

/** 没有结果、换上程序也不在时，发起之后多久算它已经没了（计划任务可能还没把它拉起来）。 */
export const ATTEMPT_GRACE_MS = 2 * 60_000;

/** 一次换上的终态（计划“启动时换上”的对账表）。 */
export type AttemptOutcome =
    /** 本地就是目标：换上成功。 */
    | "updated"
    /** 换上程序留下了失败的结果，或没留结果就没了。 */
    | "failed"
    /** 换上成功之后又装回了旧的。 */
    | "reverted"
    /** 用户手动装了别的构建。 */
    | "replaced"
    /** 换上程序可能还在动安装目录：保留，稍后再判。 */
    | "in-progress";

/** 结果文件与换上程序的进程只在本地仍是发起时的构建时才去查（查进程要起一次 `tasklist`）。 */
export async function settleAttempt(attempt: ApplyAttempt, updater: Pick<UpdaterPort, "local" | "results" | "helperRunning">, now: number): Promise<AttemptOutcome> {
    const localHash = updater.local.hash;
    if (localHash === attempt.hash) return "updated";
    if (localHash !== attempt.from) return "replaced";
    let latest: ApplyResult | null = null;
    for (const result of (await updater.results()) ?? []) {
        if (result.hash !== attempt.hash || result.modifiedAt < attempt.at) continue;
        if (latest === null || result.modifiedAt > latest.modifiedAt) latest = result;
    }
    if (latest !== null) return latest.success ? "reverted" : "failed";
    // 进程查不了按“还在”：宁可多等，也不在它还在换目录时宣布失败、放开下一次换上。电脑睡眠时它被挂起，醒来接着换，所以不按墙钟。
    if (now - attempt.at < ATTEMPT_GRACE_MS || ((await updater.helperRunning()) ?? true)) return "in-progress";
    return "failed";
}

/**
 * 按终态改状态：除“进行中”外都清 `attempt`；成功记“已更新”的通知、清已下载；失败把哈希记进失败名单、记“没有完成”的通知；
 * 装回旧的与手动重装都清已下载（那份是对被替换前的安装准备的）、不通知。最后丢掉不该由这个构建显示的通知。
 */
export function applyOutcome(state: UpdateState, outcome: AttemptOutcome, localHash: string): UpdateState {
    const attempt = state.attempt;
    let next: UpdateState = state;
    if (attempt !== null && outcome !== "in-progress") {
        switch (outcome) {
            case "updated":
                next = {...state, attempt: null, downloaded: null, pendingNotice: {kind: "updated", version: attempt.version, forHash: localHash}};
                break;
            case "failed":
                next = {...state, attempt: null, failed: withHash(state.failed, attempt.hash), pendingNotice: {kind: "update-failed", version: attempt.version, forHash: localHash}};
                break;
            case "reverted":
            case "replaced":
                next = {...state, attempt: null, downloaded: null};
                break;
        }
    }
    if (next.pendingNotice !== null && next.pendingNotice.forHash !== localHash) next = {...next, pendingNotice: null};
    return next;
}

/** 按更新器的事实给 `attempt` 取一次终态，交回新状态（没有 `attempt` 时只清不该显示的通知）。不写文件。 */
export async function reconcile(state: UpdateState, updater: Pick<UpdaterPort, "local" | "results" | "helperRunning">, now: number): Promise<UpdateState> {
    const outcome = state.attempt === null ? "in-progress" : await settleAttempt(state.attempt, updater, now);
    return applyOutcome(state, outcome, updater.local.hash);
}

/**
 * 取到缺省状态根的桌面锁之后对账一次（只在 `auto` 模式）：有变化才写。写不了时写日志，交回内存里的新状态照常用
 * （下一次启动重新对账，结论相同）。
 */
export async function reconcileAtStartup(statePort: UpdateStatePort, updater: Pick<UpdaterPort, "local" | "results" | "helperRunning">, now: number, report: (event: string, error: unknown) => void): Promise<UpdateState> {
    const state = await statePort.read();
    const next = await reconcile(state, updater, now);
    if (next !== state) {
        try {
            await statePort.write(next);
        } catch (error) {
            report("desktop.update.state-write-failed", error);
        }
    }
    return next;
}
