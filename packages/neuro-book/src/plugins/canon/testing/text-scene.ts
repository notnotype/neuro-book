/**
 * 主文字的稿在“请求还在途”时的测试场地（text-drafts-link.test.ts 用）。项目子进程里的世界扣不住先后，所以这里把世界服务放在
 * 本进程：`WorldService`、文件锁、分段日志与远程入口 `remoteWorld` 都是真实的，Storage 是 `storageWorld` 的真实 SQLite，窗口
 * 装 `nbook.canon` 的浏览器入口，链路能断开、重连。能扣住先后的只有两处，都在输入输出的边界上：
 *
 * - 日志追加之前（`pauseAppend`、`failAppend`）：请求已经过了请求 id 与读取戳的检查，还没落盘；
 * - 路由发回窗口的回复帧（`holdReply`、`loseReply`）：请求已经执行完，回执还没到或丢了；
 * - 窗口发给路由的请求帧（`loseRequest`）：请求没到就断了，什么也没执行。
 *
 * 只由测试用，不含断言。
 */

import {createHash} from "node:crypto";
import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {buildRegistry} from "@notnotype/nb-canon";
import type {EntryOp, ReadPosition} from "@notnotype/nb-canon";
import {nodeFiles, WorldService} from "@notnotype/nb-canon/node";
import type {ServicePorts} from "@notnotype/nb-canon/node";
import {holdLock} from "@notnotype/nb-file-lock";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {Frame, RemoteLink, RequestFrame} from "@notnotype/nb-runtime/remote";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {remoteWorld} from "../backend/remote";
import type {WorldHost} from "../backend/world-host";
import {canonClientKey, canonWorldContract} from "../shared/contracts";
import type {CanonClient} from "../shared/contracts";
import {canonBrowserPlugin} from "../web/plugin";

const by = {kind: "author"} as const;

export interface SceneWindow {
    readonly canon: CanonClient;
    readonly storage: StorageService;
    /** 关掉当前链路（断线）。 */
    disconnect(): void;
    /** 换一条链路再握手，返回握手结果。 */
    reconnect(): Promise<unknown>;
}

export interface TextScene {
    readonly world: WorldService;
    /** 一个窗口；`client` 相同的窗口是同一份浏览器配置，读写同一条本机记录。 */
    window(id: string, client?: string): Promise<SceneWindow>;
    /** 下一次日志追加停在写之前，直到 `release()`；`entered` 在停住时完成。 */
    pauseAppend(): {readonly entered: Promise<void>; release(): void};
    /** 下一次日志追加在写之前失败（磁盘满）。 */
    failAppend(): void;
    /** 扣住下一条匹配的回复帧，直到 `release()`；`held` 在扣住时完成（请求已经执行完）。 */
    holdReply(match: (ask: RequestFrame) => boolean): {readonly held: Promise<void>; release(): void};
    /** 丢掉下一条匹配的回复帧并断开那条链路；`lost` 在丢掉时完成。 */
    loseReply(match: (ask: RequestFrame) => boolean): {readonly lost: Promise<void>};
    /** 丢掉下一条匹配的请求帧并断开那条链路：请求没有到达，什么也没执行；`lost` 在丢掉时完成。 */
    loseRequest(match: (ask: RequestFrame) => boolean): {readonly lost: Promise<void>};
    /** 换一章的正文并照宿主的做法通知世界（版本不变、读取戳变）。 */
    setChapterText(chapter: string, text: string): void;
    /** 直接在世界里建一个条目，返回它的 id。 */
    seed(text: readonly string[]): Promise<string>;
    /** 别处的一次写入（不经窗口）。 */
    edit(ops: EntryOp[], intent: "creative" | "story", position: ReadPosition): Promise<void>;
    /** 这个位置上各块的原文。 */
    sources(entry: string, position: ReadPosition): string[];
    /** 这个条目名下各条修订的标题，从旧到新。 */
    titles(entry: string): string[];
    close(): Promise<void>;
}

/** `root` 是调用方的临时目录（一个场地一个）。章是 `1`、`2`、`3`。 */
export async function textScene(root: string): Promise<TextScene> {
    const logDir = join(root, "log");
    await mkdir(logDir, {recursive: true});
    const texts = new Map([["1", "第一章的正文"], ["2", "第二章的正文"], ["3", "第三章的正文"]]);
    let paused: {enter(): void; readonly resume: Promise<void>} | null = null;
    let failing = false;
    /** 日志的两种写（接着写、开新段）之前都过这里。 */
    const beforeWrite = async (): Promise<void> => {
        const waiting = paused;
        paused = null;
        if (waiting !== null) {
            waiting.enter();
            await waiting.resume;
        }
        if (failing) {
            failing = false;
            throw Object.assign(new Error("ENOSPC: no space left on device"), {code: "ENOSPC"});
        }
    };
    const ports: ServicePorts = {
        files: {
            ...nodeFiles,
            append: async (path, bytes) => {
                await beforeWrite();
                return nodeFiles.append(path, bytes);
            },
            create: async (path, bytes) => {
                await beforeWrite();
                return nodeFiles.create(path, bytes);
            },
        },
        lock: {
            acquire: async () => {
                const held = await holdLock(join(root, "world.lock"), () => undefined);
                return held.ok ? {release: () => held.lock.release()} : "locked";
            },
        },
        logDir,
        sideDir: root,
        cachePath: join(root, "reductions.jsonl"),
        chapterText: (chapter) => texts.get(chapter),
        digest: (text) => createHash("sha256").update(text).digest("hex"),
        clock: () => Date.now(),
        now: () => new Date().toISOString(),
    };
    const world = await WorldService.open(ports, {chapters: ["1", "2", "3"], registry: buildRegistry([])});
    if ("code" in world) throw new Error(`世界打不开：${world.code}`);

    const field = await storageWorld(root, []);
    const taps: Array<{match(ask: RequestFrame): boolean; act(send: () => void, close: () => void): void}> = [];
    /** 要丢掉的请求帧。 */
    const drops: Array<{match(ask: RequestFrame): boolean; dropped(): void}> = [];
    // 窗口的链路都从这里接进路由：窗口发来的请求帧先给 `drops` 看，发回窗口的回复帧先给 `taps` 看。项目实例的链路（带
    // `options`）不动。
    const accept = field.router.accept.bind(field.router);
    field.router.accept = (link, options) => {
        if (options !== undefined) return accept(link, options);
        const asks = new Map<string, RequestFrame>();
        const tapped: RemoteLink = {
            ...link,
            onFrame: (listener) => link.onFrame((value) => {
                const frame = value as Frame;
                if (frame.type === "request") {
                    const index = drops.findIndex((drop) => drop.match(frame));
                    if (index >= 0) {
                        // 路由没看到这一帧：链路断开，请求没有执行。
                        const [drop] = drops.splice(index, 1);
                        link.close();
                        drop!.dropped();
                        return;
                    }
                    asks.set(frame.id, frame);
                }
                listener(value);
            }),
            send: (frame) => {
                if (frame.type === "result") {
                    const ask = asks.get(frame.id);
                    asks.delete(frame.id);
                    const index = ask === undefined ? -1 : taps.findIndex((tap) => tap.match(ask));
                    if (index >= 0) {
                        taps.splice(index, 1)[0]!.act(() => link.send(frame), () => link.close());
                        return;
                    }
                }
                link.send(frame);
            },
        };
        return accept(tapped);
    };

    const host: WorldHost = {
        ready: async () => world,
        setComponents: () => undefined,
        setMarks: () => undefined,
        setDiagnostics: () => undefined,
        registerDiagnostics: () => () => undefined,
        reportDataVersion: () => undefined,
        setTime: () => undefined,
        stop: async () => undefined,
    };
    await field.project(1, [{id: "test.canon-world", entries: [{id: "project", location: "project", activationEvents: ["onStartup"], remoteProvides: [canonWorldContract], activate: () => ({
        remote: [provideRemote(canonWorldContract, () => remoteWorld(host, {tokens: new Set(), views: new Set()}))],
    })}]}]);

    let sequence = 0;
    const blocks = (entry: string, position: ReadPosition) => {
        const read = world.textBlocks(entry, position);
        if (read === null || typeof read === "string") throw new Error(`读不到块：${String(read)}`);
        return read;
    };

    return {
        world,
        window: async (id, client = "profile-1") => {
            let canon: CanonClient | null = null;
            let storage: StorageService | null = null;
            const window = await field.window(id, client, [
                canonBrowserPlugin,
                {id: "test.desk", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], dependencies: [{key: canonClientKey}, {key: storageKey}], activate: (context) => {
                    canon = context.services.require(canonClientKey);
                    storage = context.services.require(storageKey);
                    return {};
                }}]},
            ]);
            return {canon: canon!, storage: storage!, disconnect: window.disconnect, reconnect: window.reconnect};
        },
        pauseAppend: () => {
            const entered = Promise.withResolvers<void>();
            const resume = Promise.withResolvers<void>();
            paused = {enter: entered.resolve, resume: resume.promise};
            return {entered: entered.promise, release: resume.resolve};
        },
        failAppend: () => {
            failing = true;
        },
        holdReply: (match) => {
            const held = Promise.withResolvers<void>();
            let release: () => void = () => undefined;
            let released = false;
            taps.push({match, act: (send) => {
                release = send;
                held.resolve();
                if (released) send();
            }});
            return {held: held.promise, release: () => {
                released = true;
                release();
            }};
        },
        loseReply: (match) => {
            const lost = Promise.withResolvers<void>();
            taps.push({match, act: (_send, close) => {
                close();
                lost.resolve();
            }});
            return {lost: lost.promise};
        },
        loseRequest: (match) => {
            const lost = Promise.withResolvers<void>();
            drops.push({match, dropped: lost.resolve});
            return {lost: lost.promise};
        },
        setChapterText: (chapter, text) => {
            texts.set(chapter, text);
            world.textChanged(chapter);
        },
        seed: async (text) => {
            const made = await world.editEntries({requestId: `seed-${String(++sequence)}`, by, what: "edit", title: "建条目", ops: [{op: "create", id: "tmp:e", entry: {name: `条目 ${String(sequence)}`, kind: "设定", text: [...text]}}]});
            if (!made.ok) throw new Error(JSON.stringify(made.failure));
            return made.ids["tmp:e"]!;
        },
        edit: async (ops, intent, position) => {
            const made = await world.editEntries({requestId: `elsewhere-${String(++sequence)}`, by, what: "edit", title: "别处的改动", baseVersion: world.status().version, intent, position, ops});
            if (!made.ok) throw new Error(JSON.stringify(made.failure));
        },
        sources: (entry, position) => blocks(entry, position).blocks.map((block) => block.source),
        titles: (entry) => {
            const page = world.revisions({entry}, undefined, 100);
            if (typeof page === "string") throw new Error(page);
            return page.items.map((item) => item.title).reverse();
        },
        close: async () => {
            paused = null;
            await field.close();
            await world.stop();
        },
    };
}
