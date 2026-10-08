/**
 * 监视一层配置文件的外部修改（docs/specs/settings/configuration.md 输出 9）。
 *
 * 不直接监视文件：编辑器常以“写临时文件再改名替换”保存，替换后对旧文件的监视就收不到后续事件。改为监视路径上
 * 最近存在的那一级目录，只理会通往文件的下一级名字（以及没有文件名的事件、目录自己的事件）。路径上有符号链接时
 * （文件本身或任一级祖先目录），再监视每个链接所在的目录：链接改指在那里有事件。每次相关事件后静止 `delayMs` 再“协调”：重算要监视的目录、关掉不再需要的、
 * 建上新的，然后通知拥有者重读。这样覆盖首次没有目录、`.nbook` 被删后重建、链接改指、目标被删后重建。
 *
 * 已知限制：网络文件系统与部分容器挂载上 `fs.watch` 可能收不到事件，此时外部修改到下一次写入或重启才生效。
 */

import {watch} from "node:fs";
import type {FSWatcher} from "node:fs";
import {lstat, readlink, stat} from "node:fs/promises";
import {basename, dirname, join, parse, resolve, sep} from "node:path";

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {errno} from "./layer-file";

/** 解析一条路径最多经过几个符号链接（Linux 的 MAXSYMLINKS）；再多读文件也是 ELOOP，停止往下找。 */
const MAX_LINK_HOPS = 40;

export interface LayerWatchOptions {
    readonly path: string;
    readonly clock: RuntimeClock;
    readonly delayMs: number;
    /** 协调完成后调用；拥有者据此重读。 */
    readonly onChange: () => void;
    readonly report: (event: string, error: unknown) => void;
}

export interface LayerWatch {
    /** 建好第一批监视；之后的协调都由事件触发。 */
    readonly started: Promise<void>;
    close(): void;
}

export function watchLayer(options: LayerWatchOptions): LayerWatch {
    /**
     * 正在监视的目录 → 监视器、目录身份（设备与 inode）与这个目录里相关的名字。目录被删后在同一路径重建，旧监视器
     * 收不到新目录的事件，而且旧的不关时新建的监视器也收不到（Linux 上的 Bun 实测），所以身份变了就先关旧的再建。
     */
    const watched = new Map<string, {readonly watcher: FSWatcher; readonly identity: string; names: ReadonlySet<string>}>();
    let cancelTimer: (() => void) | null = null;
    let running = false;
    let again = false;
    let closed = false;

    const schedule = (): void => {
        if (closed) return;
        cancelTimer?.();
        cancelTimer = options.clock.schedule(() => {
            cancelTimer = null;
            void run();
        }, options.delayMs);
    };

    /** 协调串行：协调期间又来了事件，结束后再协调一次。 */
    const run = async (): Promise<void> => {
        if (running) {
            again = true;
            return;
        }
        running = true;
        try {
            do {
                again = false;
                await reconcile();
                if (!closed) options.onChange();
            } while (again && !closed);
        } catch (error) {
            options.report("settings.watch.reconcile-failed", error);
        } finally {
            running = false;
        }
    };

    const reconcile = async (): Promise<void> => {
        const desired = await desiredDirectories(options.path);
        if (closed) return;
        for (const [directory, entry] of watched) {
            if (desired.has(directory)) continue;
            entry.watcher.close();
            watched.delete(directory);
        }
        for (const [directory, {identity, names}] of desired) {
            const existing = watched.get(directory);
            if (existing !== undefined && existing.identity === identity) {
                existing.names = names;
                continue;
            }
            existing?.watcher.close();
            watched.delete(directory);
            try {
                const watcher = watch(directory, (_event, filename) => {
                    const entry = watched.get(directory);
                    if (entry === undefined || entry.watcher !== watcher) return;
                    if (filename === null || entry.names.has(String(filename))) schedule();
                });
                watcher.on("error", (error) => {
                    options.report("settings.watch.error", error);
                    schedule();
                });
                watched.set(directory, {watcher, identity, names});
            } catch (error) {
                // 目录在算出之后、监视之前消失：下一轮协调会改监视更上一级。
                if (errno(error) !== "ENOENT") options.report("settings.watch.failed", error);
                schedule();
            }
        }
    };

    const started = (async () => {
        try {
            await reconcile();
        } catch (error) {
            options.report("settings.watch.reconcile-failed", error);
        }
    })();

    return {
        started,
        close: () => {
            closed = true;
            cancelTimer?.();
            cancelTimer = null;
            for (const entry of watched.values()) entry.watcher.close();
            watched.clear();
        },
    };
}

interface Desired {
    readonly identity: string;
    readonly names: Set<string>;
}

/** 要监视的目录与各自相关的名字：途经的每个符号链接一条链，最终路径一条链。 */
async function desiredDirectories(path: string): Promise<Map<string, Desired>> {
    const desired = new Map<string, Desired>();
    const walked = await walkLinks(resolve(path));
    for (const link of walked.links) await addChain(desired, link);
    await addChain(desired, walked.final);
    return desired;
}

/**
 * 逐级解析路径（与内核解析文件路径同一语义），记下途经的每个符号链接的位置与最终路径。链接位置的父目录都是解析过的
 * 真实目录。某一级不存在时停在那里，最终路径带着没有解析的余下部分。
 */
async function walkLinks(path: string): Promise<{readonly links: ReadonlyArray<string>; readonly final: string}> {
    const links: string[] = [];
    let prefix = parse(path).root;
    let pending = components(path);
    while (pending.length > 0) {
        const [name, ...rest] = pending as [string, ...string[]];
        const candidate = join(prefix, name);
        let isLink: boolean;
        try {
            isLink = (await lstat(candidate)).isSymbolicLink();
        } catch (error) {
            if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return {links, final: join(candidate, ...rest)};
            throw error;
        }
        if (!isLink) {
            prefix = candidate;
            pending = rest;
            continue;
        }
        if (links.length >= MAX_LINK_HOPS) return {links, final: join(candidate, ...rest)};
        links.push(candidate);
        const target = resolve(prefix, await readlink(candidate));
        prefix = parse(target).root;
        pending = [...components(target), ...rest];
    }
    return {links, final: prefix};
}

function components(path: string): string[] {
    return path.slice(parse(path).root.length).split(sep).filter((part) => part !== "");
}

/** 路径上最近存在的那一级目录，相关的名字是通往路径的下一级名字与这个目录自己的名字。 */
async function addChain(desired: Map<string, Desired>, path: string): Promise<void> {
    let child = path;
    let directory = dirname(path);
    for (;;) {
        const identity = await directoryIdentity(directory);
        if (identity !== null) {
            const entry = desired.get(directory) ?? {identity, names: new Set<string>()};
            entry.names.add(basename(child));
            entry.names.add(basename(directory));
            desired.set(directory, entry);
            return;
        }
        const parent = dirname(directory);
        if (parent === directory) return;
        child = directory;
        directory = parent;
    }
}

/** 目录的设备与 inode；不存在或不是目录为 null。 */
async function directoryIdentity(path: string): Promise<string | null> {
    try {
        const info = await stat(path);
        return info.isDirectory() ? `${String(info.dev)}:${String(info.ino)}` : null;
    } catch (error) {
        if (errno(error) === "ENOENT" || errno(error) === "ENOTDIR") return null;
        throw error;
    }
}
