/**
 * 一个方案根的变更事件（docs/specs/workspace/resources.md 的“变更事件”“订阅”）：经文件服务的保存立即以真实来源发出，
 * 文件监视发现的变化合并一批后以外部来源发出。
 *
 * - 监视按订阅持有：第一个订阅建立时开一个递归 `fs.watch`，最后一个释放时关掉。
 * - 外部变化只分两类：`fs.watch` 对新建、原子替换、改名都只给 `rename`，事后的 `lstat` 区分不了新建与替换，所以路径
 *   现在存在为 `changed`、不存在为 `deleted`，订阅方按当前状态核对。
 * - 自己写入的回声：按真实路径记下本服务最近一次写入的内容 hash，监视报来的同一路径读出来 hash 相同就丢掉；不靠修改
 *   时间与大小（保留时间戳的外部修改会被它吞掉）。自己的临时文件名带本实例的随机标记，报来的直接丢掉，不按点文件名
 *   或后缀忽略（会吞掉用户的真实文件）。
 * - 失同步：Bun 在 inotify 队列溢出时回调 `change` 且文件名为 null、根自身被移动时文件名为空，都不报 `error`。这时
 *   溢出期间新建的子目录没有加上监视，只让订阅方重列补不回来：先核对根还在，在就关掉旧监视器重建再推 `resync`，不在
 *   就以 `root-gone` 结束全部订阅。监视器的 `error` 同样处理；一批待处理路径过多只推 `resync`。
 */

import {randomUUID} from "node:crypto";
import {watch} from "node:fs";
import type {FSWatcher} from "node:fs";
import {lstat, readFile} from "node:fs/promises";
import {basename, dirname, join, sep} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {ChangeSource, ChangesMessage, FileChange} from "../shared/contracts";
import {hashOf} from "./files-service";
import {isControlName} from "./rooted";
import type {RootedRoot} from "./rooted";

/** 原始事件攒多久再处理一批。 */
export const BATCH_DELAY_MS = 75;
/** 一批里待处理的路径超过这么多就不逐条核对，只推 `resync`。 */
export const MAX_BATCH_PATHS = 1000;

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
    /** 提供者入口停止：关监视器，不再发出。 */
    close(): void;
}

type Sink = (message: ChangesMessage) => void;

export function createChangeHub(options: ChangeHubOptions): ChangeHub {
    const {root, clock} = options;
    const token = randomUUID().slice(0, 8);
    const temporaryPattern = new RegExp(`^\\..*\\.nbook-${token}-[0-9a-f-]{36}\\.tmp$`, "u");
    const sinks = new Set<Sink>();
    /** 真实路径 → 本服务最近一次写入的内容 hash。只在监视期间记。 */
    const own = new Map<string, string>();
    let watcher: FSWatcher | null = null;
    let pending = new Set<string>();
    /** 有变化可能漏掉（溢出、根事件、监视器出错）：下一批重建监视并推 `resync`。 */
    let lost = false;
    let cancelFlush: (() => void) | null = null;
    let flushing: Promise<void> = Promise.resolve();
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
        watcher?.close();
        watcher = null;
        cancelFlush?.();
        cancelFlush = null;
        pending = new Set();
        lost = false;
        own.clear();
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
        if (lost) {
            lost = false;
            const check = await root.resolve("");
            if (closed || watcher === null) return;
            if ("ok" in check) {
                options.record("warn", "files.watch.root-gone", "监视的根目录已不在，结束订阅", {root: root.real, detail: check.detail});
                const ended = [...sinks];
                sinks.clear();
                stopWatcher();
                for (const sink of ended) sink({kind: "ended", reason: "root-gone"});
                return;
            }
            watcher.close();
            own.clear();
            startWatcher();
            broadcast({kind: "resync"});
            return;
        }
        if (paths.size > MAX_BATCH_PATHS) {
            broadcast({kind: "resync"});
            return;
        }
        const events: FileChange[] = [];
        for (const path of paths) {
            const event = await classify(path);
            if (event !== null) events.push(event);
        }
        if (closed || watcher === null || events.length === 0) return;
        broadcast({kind: "batch", events});
    };

    const classify = async (path: string): Promise<FileChange | null> => {
        const absolute = join(root.real, path);
        try {
            await lstat(absolute);
        } catch (error) {
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
            // 无从查看的路径报 changed：订阅方重列或重读时会得到确切原因。
            if (code !== "ENOENT" && code !== "ENOTDIR") return {type: "changed", path, source: {kind: "external"}};
            own.delete(path);
            return {type: "deleted", path, source: {kind: "external"}};
        }
        const written = own.get(path);
        if (written !== undefined) {
            const now = await readFile(absolute).then((bytes) => hashOf(bytes), () => null);
            if (now === written) return null;
            own.delete(path);
        }
        return {type: "changed", path, source: {kind: "external"}};
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
            own.set(change.realPath, hashOf(change.bytes));
            const events: FileChange[] = [{type: "changed", path: change.path, source}];
            if (change.realPath !== change.path) events.push({type: "changed", path: change.realPath, source});
            broadcast({kind: "batch", events});
        },
        close: () => {
            closed = true;
            sinks.clear();
            stopWatcher();
        },
    };
}
