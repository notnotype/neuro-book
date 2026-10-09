/**
 * 一个方案根的变更事件（docs/specs/workspace/resources.md 的“变更事件”“订阅”）：经文件服务的保存立即以真实来源发出，
 * 文件监视发现的变化合并一批后以外部来源发出。
 *
 * - 监视按订阅持有：第一个订阅建立时开一个递归 `fs.watch`，最后一个释放时关掉。
 * - 外部变化只分两类：`fs.watch` 对新建、原子替换、改名都只给 `rename`，事后的 `lstat` 区分不了新建与替换，所以路径
 *   现在存在为 `changed`、不存在为 `deleted`，订阅方按当前状态核对。
 * - 自己写入与操作的回声：按真实路径登记预期状态，监视报来的路径符合就丢掉，不符合就作为外部变化发出并撤销登记。
 *   保存登记内容 hash（不靠修改时间与大小：保留时间戳的外部修改会被它吞掉）；新建、复制、移入登记目录项身份（dev、
 *   ino 与创建时间，删掉重建的同名项即使 inode 被复用也不同；文件与链接另比 ctime，外部改内容会改 ctime；目录不比
 *   ctime，往里加子项也会改它）；删除与移出登记
 *   “不存在”，覆盖后代（只在路径确实不存在时才符合，之后被外部重建仍会发出）。外部的真实修改总会让状态不符，所以登记
 *   的寿命只为回收内存，取 60 秒。自己的临时文件名带
 *   本实例的随机标记，报来的直接丢掉，不按点文件名或后缀忽略（会吞掉用户的真实文件）。
 * - 失同步：Bun 在 inotify 队列溢出时回调 `change` 且文件名为 null、根自身被移动时文件名为空，都不报 `error`。这时
 *   溢出期间新建的子目录没有加上监视，只让订阅方重列补不回来：先核对根还在，在就关掉旧监视器重建再推 `resync`，不在
 *   就以 `root-gone` 结束全部订阅。监视器的 `error` 同样处理；一批待处理路径过多、或编码后装不进一条 RPC 消息时
 *   只推 `resync`。
 */

import {randomUUID} from "node:crypto";
import {watch} from "node:fs";
import type {FSWatcher} from "node:fs";
import type {Stats} from "node:fs";
import {lstat, readdir, readFile} from "node:fs/promises";
import {basename, dirname, join, sep} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {TEXT_BUDGET_BYTES} from "../shared/contracts";
import type {ChangeSource, ChangesMessage, FileChange} from "../shared/contracts";
import {hashOf} from "./files-service";
import {isControlName} from "./rooted";
import type {RootedRoot} from "./rooted";

/** 原始事件攒多久再处理一批。 */
export const BATCH_DELAY_MS = 75;
/** 一批里待处理的路径超过这么多就不逐条核对，只推 `resync`；移动的目录后代超过这么多也不逐个登记回声。 */
export const MAX_BATCH_PATHS = 1000;
/** 回声登记的寿命：平台事件在几十毫秒内到达；过期的登记在下一次登记时清掉。 */
export const EXPECT_TTL_MS = 60_000;

export interface ChangeHubOptions {
    readonly root: RootedRoot;
    /** 项目根的控制目录（`.nbook/`）里的变化不发出：Storage 与锁在那里频繁写。 */
    readonly controlDirectory: boolean;
    readonly clock: RuntimeClock;
    readonly record: (level: "info" | "warn", event: string, message: string, data?: unknown, error?: unknown) => void;
}

export interface ChangeHub {
    /** 登记一个订阅：先收到 `ready`；监视器开不起来时抛错（订阅建立失败）。`signal` 触发即退订。 */
    subscribe(sink: (message: ChangesMessage) => void, signal: AbortSignal): void;
    /** 保存用的临时文件路径（同目录）；监视报来的这些路径不发出。 */
    temporaryPath(file: string): string;
    /** 经文件服务保存成功：立即以真实来源发出；经链接保存时真实路径也发一条。 */
    saved(change: {readonly path: string; readonly realPath: string; readonly bytes: Uint8Array}, source: ChangeSource): void;
    /** 经文件服务的操作完成：登记回声并立即以真实来源发出精确事件。路径都是相对根的真实路径。 */
    operated(change: OperationChange, source: ChangeSource): Promise<void>;
    /** 提供者入口停止：关监视器，不再发出。 */
    close(): void;
}

export interface OperationChange {
    readonly events: ReadonlyArray<OperationEvent>;
    /** 现在不存在的路径（删除、移出）；覆盖后代。 */
    readonly absent?: ReadonlyArray<string>;
    /** 新出现的目录项（新建、复制产生的每一项、移入的目标）：登记它们现在的身份。 */
    readonly present?: ReadonlyArray<string>;
    /** 移动过的目录：遍历目标子树登记后代的身份（监视会在新名字下报来全部后代）。 */
    readonly moved?: ReadonlyArray<string>;
    /** 写过的清单与它的字节。 */
    readonly written?: ReadonlyArray<{readonly path: string; readonly bytes: Uint8Array}>;
}

export type OperationEvent = {readonly type: "created" | "changed" | "deleted"; readonly path: string} | {readonly type: "renamed"; readonly path: string; readonly from: string};

type Expected = {readonly kind: "hash"; readonly hash: string} | {readonly kind: "absent"} | {readonly kind: "entry"; readonly dev: number; readonly ino: number; readonly birthtimeMs: number; readonly ctimeMs: number | null};

type Sink = (message: ChangesMessage) => void;

export function createChangeHub(options: ChangeHubOptions): ChangeHub {
    const {root, clock} = options;
    const token = randomUUID().slice(0, 8);
    // `s`：文件名可以含换行。
    const temporaryPattern = new RegExp(`^\\..*\\.nbook-${token}-[0-9a-f-]{36}\\.tmp$`, "su");
    const sinks = new Set<Sink>();
    /** 真实路径 → 预期状态与登记时间。只在监视期间记。 */
    const expected = new Map<string, {readonly state: Expected; readonly at: number}>();
    /** 有回声没能逐个登记（移动的子树太大）：下一批只推 `resync`。 */
    let overflowed = false;
    let watcher: FSWatcher | null = null;
    let pending = new Set<string>();
    /** 有变化可能漏掉（溢出、根事件、监视器出错）：下一批重建监视并推 `resync`。 */
    let lost = false;
    let cancelFlush: (() => void) | null = null;
    let flushing: Promise<void> = Promise.resolve();
    /** 监视轮次：每次关掉或重建监视器加一。处理中的一批完成时轮次已变，就不投给之后的订阅。 */
    let round = 0;
    let closed = false;

    const broadcast = (message: ChangesMessage): void => {
        for (const sink of [...sinks]) sink(message);
    };

    const startWatcher = (): void => {
        const created = watch(root.real, {recursive: true}, (_event, filename) => onRaw(filename));
        created.on("error", (error) => {
            options.record("warn", "files.watch.error", "文件监视出错，重建监视并通知订阅方重新核对", {root: root.real}, error);
            lost = true;
            schedule();
        });
        watcher = created;
    };

    const stopWatcher = (): void => {
        round += 1;
        watcher?.close();
        watcher = null;
        cancelFlush?.();
        cancelFlush = null;
        pending = new Set();
        lost = false;
        expected.clear();
        overflowed = false;
    };

    const onRaw = (filename: string | Buffer | null | undefined): void => {
        if (closed || watcher === null) return;
        const name = typeof filename === "string" ? filename : filename?.toString("utf8");
        if (name === undefined || name === "") {
            lost = true;
            schedule();
            return;
        }
        const path = sep === "/" ? name : name.split(sep).join("/");
        if (options.controlDirectory && isControlName(path.split("/")[0] as string)) return;
        if (temporaryPattern.test(basename(path))) return;
        pending.add(path);
        schedule();
    };

    const schedule = (): void => {
        if (cancelFlush !== null) return;
        cancelFlush = clock.schedule(() => {
            cancelFlush = null;
            flushing = flushing.then(flush).catch((error: unknown) => {
                options.record("warn", "files.watch.flush-failed", "处理一批文件变化时出错，通知订阅方重新核对", {root: root.real}, error);
                broadcast({kind: "resync"});
            });
        }, BATCH_DELAY_MS);
    };

    const flush = async (): Promise<void> => {
        const paths = pending;
        pending = new Set();
        const started = round;
        const current = (): boolean => !closed && watcher !== null && round === started;
        if (lost) {
            lost = false;
            const check = await root.resolve("");
            if (!current() || watcher === null) return;
            if ("ok" in check) {
                options.record("warn", "files.watch.root-gone", "监视的根目录已不在，结束订阅", {root: root.real, detail: check.detail});
                const ended = [...sinks];
                sinks.clear();
                stopWatcher();
                for (const sink of ended) sink({kind: "ended", reason: "root-gone"});
                return;
            }
            watcher.close();
            expected.clear();
            overflowed = false;
            round += 1;
            startWatcher();
            broadcast({kind: "resync"});
            return;
        }
        if (overflowed || paths.size > MAX_BATCH_PATHS) {
            overflowed = false;
            broadcast({kind: "resync"});
            return;
        }
        const events: FileChange[] = [];
        for (const path of paths) {
            const event = await classify(path);
            if (event !== null) events.push(event);
        }
        if (!current() || events.length === 0) return;
        // 一批要装进一条 RPC 消息：路径很长时 1000 条以内也可能超过，超过就只推 resync。
        if (new TextEncoder().encode(JSON.stringify(events)).length > TEXT_BUDGET_BYTES) {
            broadcast({kind: "resync"});
            return;
        }
        broadcast({kind: "batch", events});
    };

    /** 这个路径上仍有效的登记：自身的，或祖先的“不存在”。过期的顺手删掉。 */
    const registrationOf = (path: string): {readonly key: string; readonly state: Expected} | null => {
        const segments = path.split("/");
        for (let length = segments.length; length > 0; length -= 1) {
            const key = segments.slice(0, length).join("/");
            const found = expected.get(key);
            if (found === undefined) continue;
            if (clock.now() - found.at > EXPECT_TTL_MS) {
                expected.delete(key);
                continue;
            }
            if (length === segments.length || found.state.kind === "absent") return {key, state: found.state};
        }
        return null;
    };

    const classify = async (path: string): Promise<FileChange | null> => {
        const absolute = join(root.real, path);
        const registration = registrationOf(path);
        let info: Stats;
        try {
            info = await lstat(absolute);
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
            // 无从查看的路径报 changed：订阅方重列或重读时会得到确切原因。
            if (code !== "ENOENT" && code !== "ENOTDIR") return {type: "changed", path, source: {kind: "external"}};
            if (registration?.state.kind === "absent") return null;
            if (registration !== null) expected.delete(registration.key);
            return {type: "deleted", path, source: {kind: "external"}};
        }
        if (registration !== null && registration.key === path && (await matches(registration.state, absolute, info))) return null;
        if (registration !== null) expected.delete(registration.key);
        return {type: "changed", path, source: {kind: "external"}};
    };

    const matches = async (state: Expected, absolute: string, info: Stats): Promise<boolean> => {
        switch (state.kind) {
            case "absent":
                return false;
            case "hash":
                return (await readFile(absolute).then((bytes) => hashOf(bytes), () => null)) === state.hash;
            case "entry":
                return info.dev === state.dev && info.ino === state.ino && info.birthtimeMs === state.birthtimeMs && (state.ctimeMs === null || info.ctimeMs === state.ctimeMs);
        }
    };

    const expectEntry = async (path: string): Promise<void> => {
        const info = await lstat(join(root.real, path)).catch(() => null);
        // 已经又不在了：不登记，监视报来时按外部变化发出。
        if (info === null) return;
        expected.set(path, {state: {kind: "entry", dev: info.dev, ino: info.ino, birthtimeMs: info.birthtimeMs, ctimeMs: info.isDirectory() ? null : info.ctimeMs}, at: clock.now()});
    };

    /** 目录子树里的全部后代（相对根的路径）；超过上限返回 `null`。 */
    const descendants = async (path: string): Promise<string[] | null> => {
        const found: string[] = [];
        const queue = [path];
        while (queue.length > 0) {
            const directory = queue.shift() as string;
            const names = await readdir(join(root.real, directory), {withFileTypes: true}).catch(() => []);
            for (const entry of names) {
                const child = `${directory}/${entry.name}`;
                found.push(child);
                if (found.length > MAX_BATCH_PATHS) return null;
                if (entry.isDirectory()) queue.push(child);
            }
        }
        return found;
    };

    return {
        subscribe: (sink, signal) => {
            if (closed || signal.aborted) return;
            if (watcher === null) startWatcher();
            sinks.add(sink);
            signal.addEventListener("abort", () => {
                sinks.delete(sink);
                if (sinks.size === 0) stopWatcher();
            }, {once: true});
            sink({kind: "ready"});
        },
        temporaryPath: (file) => join(dirname(file), `.${basename(file)}.nbook-${token}-${randomUUID()}.tmp`),
        saved: (change, source) => {
            if (closed || watcher === null) return;
            expected.set(change.realPath, {state: {kind: "hash", hash: hashOf(change.bytes)}, at: clock.now()});
            const events: FileChange[] = [{type: "changed", path: change.path, source}];
            if (change.realPath !== change.path) events.push({type: "changed", path: change.realPath, source});
            broadcast({kind: "batch", events});
        },
        operated: async (change, source) => {
            if (closed || watcher === null) return;
            const started = round;
            for (const [path, entry] of expected) if (clock.now() - entry.at > EXPECT_TTL_MS) expected.delete(path);
            for (const path of change.absent ?? []) expected.set(path, {state: {kind: "absent"}, at: clock.now()});
            for (const {path, bytes} of change.written ?? []) expected.set(path, {state: {kind: "hash", hash: hashOf(bytes)}, at: clock.now()});
            for (const path of change.present ?? []) await expectEntry(path);
            for (const path of change.moved ?? []) {
                const below = await descendants(path);
                if (below === null) {
                    overflowed = true;
                    schedule();
                    continue;
                }
                for (const child of below) await expectEntry(child);
            }
            // 登记期间监视被关掉或重建：这一轮的订阅方已经不在或已收到 resync。
            if (closed || round !== started) return;
            const events: FileChange[] = change.events.map((event) => ({...event, source}));
            if (events.length === 0) return;
            broadcast(new TextEncoder().encode(JSON.stringify(events)).length > TEXT_BUDGET_BYTES ? {kind: "resync"} : {kind: "batch", events});
        },
        close: () => {
            closed = true;
            sinks.clear();
            stopWatcher();
        },
    };
}
