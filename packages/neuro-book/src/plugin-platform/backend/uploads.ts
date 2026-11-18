/**
 * 插件文件夹的上传暂存区（docs/specs/runtime/plugin-install.md 输出 11）：页面把文件夹一次上传到 `<State Root>/plugin-uploads/<上传 id>/`，
 * 预览、安装把这个目录当作源文件夹。暂存区不在 `plugins/` 里，所以不会被当成安装目录或残留去回收。
 *
 * 状态：接收中 → 可用 → 使用中（预览或安装正在读它）→ 已删除。接收是一个请求，请求体读完、全部写好才登记成可用并交回 id；
 * 接收失败当场删掉已写的部分。所以没有“写到一半的上传”可被预览或删除：id 在接收结束前没有人知道，表里也不收接收中的项给
 * `use`、`discard` 用。使用中收到删除只记下，最后一个使用者用完再删。
 *
 * id 是服务端签发的 UUID，进来的 id 先查本次运行的表，查不到不拼路径：别的字符串碰不到文件系统。
 *
 * 清理：每 10 分钟删一次 1 小时没被用过的可用上传（使用中的不删）；第一次接收上传之前清空整个暂存区（上一次运行的残留；只做
 * 一次，接收都等它做完）。删除失败只记诊断，留给下次清空。同时存在的上传至多 8 个：满了先淘汰最久没被用过的可用上传。
 */

import {randomUUID} from "node:crypto";
import {mkdir, open, rm} from "node:fs/promises";
import {dirname, join} from "node:path";

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import {readUploadStream, UPLOAD_LIMITS, UploadError} from "nbook/plugin-platform/shared/plugin-upload";
import type {UploadFileSink, UploadLimits} from "nbook/plugin-platform/shared/plugin-upload";

/** 服务端这一侧的失败：同时在接收的上传已满（`upload-busy`）、写盘失败（`upload-failed`）。 */
export class UploadServerError extends Error {
    readonly code: "upload-busy" | "upload-failed";

    constructor(code: UploadServerError["code"], detail: string, options?: ErrorOptions) {
        super(detail, options);
        this.name = "UploadServerError";
        this.code = code;
    }
}

export interface PluginUploads {
    /** 读完一个上传请求体，交回新上传的 id。失败抛 `UploadError` 或 `UploadServerError`，已写的部分已删除。 */
    receive(body: ReadableStream<Uint8Array>): Promise<{readonly id: string; readonly files: number; readonly bytes: number}>;
    /**
     * 用这个上传的目录做一件事（预览、安装）。上传不存在、已删、已过期、还在接收中时 `{ok: false}`。`fn` 期间收到的删除请求
     * 等它结束再执行。
     */
    use<T>(id: string, fn: (directory: string) => Promise<T>): Promise<{readonly ok: true; readonly value: T} | {readonly ok: false}>;
    /** 删除；不存在算成功；使用中的等用完再删。 */
    discard(id: string): Promise<void>;
    /**
     * 宿主开始停止时调用：不再接纳新的接收、取消正在接收的（连还在等请求体的也立即结束）、撤销清扫的计时器，交回的 Promise 在
     * 这些接收都收尾（已写的部分已删）之后完成。幂等。
     */
    stop(): Promise<void>;
}

export const pluginUploadsKey: ServiceKey<PluginUploads> = defineServiceKey<PluginUploads>("plugin-platform/uploads");

export interface PluginUploadsOptions {
    /** 暂存区目录（`<State Root>/plugin-uploads`）。 */
    readonly root: string;
    readonly clock: RuntimeClock;
    readonly record: (record: {readonly level: "warn"; readonly event: string; readonly message: string; readonly error?: unknown; readonly data?: Record<string, unknown>}) => void;
    readonly limits?: UploadLimits;
    /** 多久没被用过的可用上传会被清扫；缺省 1 小时。 */
    readonly idleMs?: number;
    /** 清扫的间隔；缺省 10 分钟。 */
    readonly sweepEveryMs?: number;
    /** 同时存在的上传数；缺省 8。 */
    readonly maxUploads?: number;
}

interface Entry {
    state: "receiving" | "ready";
    /** 正在用它的预览或安装个数。 */
    users: number;
    lastUsed: number;
    /** 使用中收到了删除：最后一个使用者用完再删。 */
    deleting: boolean;
}

const ID_FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function createPluginUploads(options: PluginUploadsOptions): PluginUploads {
    const limits = options.limits ?? UPLOAD_LIMITS;
    const idleMs = options.idleMs ?? 60 * 60 * 1000;
    const sweepEveryMs = options.sweepEveryMs ?? 10 * 60 * 1000;
    const maxUploads = options.maxUploads ?? 8;
    const entries = new Map<string, Entry>();
    let cleared: Promise<void> | null = null;
    let cancelSweep: (() => void) | null = null;
    let stopped = false;
    /** 正在接收的上传：停止时逐个取消，并等它们收尾。 */
    const receiving = new Set<{readonly abort: AbortController; readonly done: Promise<unknown>}>();

    const directoryOf = (id: string): string => join(options.root, id);

    /** 删除一个上传的目录；删不掉只记诊断（下次清空）。登记要先同步去掉（`entries.delete`），不然等磁盘时容量与登记对不上。 */
    async function purge(id: string): Promise<void> {
        await rm(directoryOf(id), {recursive: true, force: true}).catch((error: unknown) => {
            options.record({level: "warn", event: "plugins.upload.cleanup-failed", message: "删除上传暂存目录失败，下次清空", data: {id}, error});
        });
    }

    async function remove(id: string): Promise<void> {
        entries.delete(id);
        await purge(id);
    }

    function sweep(): void {
        cancelSweep = null;
        if (stopped) return;
        const now = options.clock.now();
        for (const [id, entry] of [...entries]) if (entry.state === "ready" && entry.users === 0 && now - entry.lastUsed >= idleMs) void remove(id);
        cancelSweep = options.clock.schedule(sweep, sweepEveryMs);
    }

    /** 第一次接收之前清空暂存区，只做一次；失败只记诊断，不挡上传。 */
    function ensureCleared(): Promise<void> {
        cleared ??= (async () => {
            await rm(options.root, {recursive: true, force: true}).catch((error: unknown) => {
                options.record({level: "warn", event: "plugins.upload.clear-failed", message: "清空上传暂存区失败，残留的上传留到下次", data: {root: options.root}, error});
            });
            // 建不出来也不挡：之后每次接收在建自己的目录时失败，得到 `upload-failed`。
            await mkdir(options.root, {recursive: true}).catch((error: unknown) => {
                options.record({level: "warn", event: "plugins.upload.root-failed", message: "无法建立上传暂存区", data: {root: options.root}, error});
            });
            if (!stopped) cancelSweep = options.clock.schedule(sweep, sweepEveryMs);
        })();
        return cleared;
    }

    /**
     * 占位：满了先淘汰最久没被用过的可用上传，都在接收或使用中才拒绝。检查、淘汰的登记与新项的登记在同一个同步段里做完，
     * 之后才等磁盘删旧目录：中间有 await 的话，另一个接收会看到空位、一起占位而超出个数上限。交回的 `evicted` 由调用方删目录。
     */
    function reserve(): {readonly id: string; readonly evicted: string | null} {
        let evicted: string | null = null;
        if (entries.size >= maxUploads) {
            for (const [id, entry] of entries) {
                if (entry.state !== "ready" || entry.users > 0) continue;
                if (evicted === null || entry.lastUsed < entries.get(evicted)!.lastUsed) evicted = id;
            }
            if (evicted === null) throw new UploadServerError("upload-busy", `同时在处理的上传已有 ${String(maxUploads)} 个，稍后再试`);
            entries.delete(evicted);
        }
        const id = randomUUID();
        entries.set(id, {state: "receiving", users: 0, lastUsed: options.clock.now(), deleting: false});
        return {id, evicted};
    }

    /** 往暂存目录里写一个文件：`wx` 独占新建，不写临时名再改名（交回之前没人读这个目录）。 */
    async function openFile(directory: string, path: string): Promise<UploadFileSink> {
        // 停止之后连没有内容的文件（零字节的帧）也不再收。
        if (stopped) throw new UploadServerError("upload-failed", "服务端正在停止");
        const target = join(directory, ...path.split("/"));
        await mkdir(dirname(target), {recursive: true});
        const handle = await open(target, "wx");
        return {
            write: async (chunk) => {
                if (stopped) throw new UploadServerError("upload-failed", "服务端正在停止");
                // 写可能只写了一部分（磁盘满、文件大小限制）：写满为止，一个字节也写不进就失败，不把截断的文件当成功。
                for (let offset = 0; offset < chunk.length;) {
                    const {bytesWritten} = await handle.write(chunk, offset);
                    if (bytesWritten === 0) throw new UploadServerError("upload-failed", "写不进更多的内容（磁盘满了或超出文件大小限制）");
                    offset += bytesWritten;
                }
            },
            end: () => handle.close(),
            abort: () => handle.close(),
        };
    }

    return {
        async receive(body) {
            if (stopped) throw new UploadServerError("upload-failed", "服务端正在停止");
            await ensureCleared();
            if (stopped) throw new UploadServerError("upload-failed", "服务端正在停止");
            const {id, evicted} = reserve();
            if (evicted !== null) void purge(evicted);
            const directory = directoryOf(id);
            const abort = new AbortController();
            const task = (async () => {
                try {
                    await mkdir(directory, {recursive: true});
                    const result = await readUploadStream(body, {limits, signal: abort.signal, open: (path) => openFile(directory, path)});
                    // 停止时取消读流，读到的结束被当成“在一帧中间结束”；结果是否算成功由 `stopped` 定。
                    if (stopped) throw new UploadServerError("upload-failed", "服务端正在停止");
                    const entry = entries.get(id);
                    if (entry === undefined) throw new UploadServerError("upload-failed", "上传在接收期间被清掉了");
                    entry.state = "ready";
                    entry.lastUsed = options.clock.now();
                    return {id, files: result.files, bytes: result.bytes};
                } catch (error) {
                    await remove(id);
                    if (stopped) throw new UploadServerError("upload-failed", "服务端正在停止", {cause: error});
                    if (error instanceof UploadError || error instanceof UploadServerError) throw error;
                    // 系统错误的文字带暂存目录的绝对路径：只进诊断，给页面的说明不带路径。
                    options.record({level: "warn", event: "plugins.upload.write-failed", message: "写上传暂存目录失败", data: {id}, error});
                    throw new UploadServerError("upload-failed", "服务端写上传暂存目录失败", {cause: error});
                }
            })();
            const tracked = {abort, done: task.catch(() => undefined)};
            receiving.add(tracked);
            try {
                return await task;
            } finally {
                receiving.delete(tracked);
            }
        },

        async use(id, fn) {
            const entry = ID_FORMAT.test(id) ? entries.get(id) : undefined;
            if (entry === undefined || entry.state !== "ready" || entry.deleting) return {ok: false};
            entry.users += 1;
            entry.lastUsed = options.clock.now();
            try {
                return {ok: true, value: await fn(directoryOf(id))};
            } finally {
                entry.users -= 1;
                entry.lastUsed = options.clock.now();
                if (entry.users === 0 && entry.deleting) await remove(id);
            }
        },

        async discard(id) {
            const entry = ID_FORMAT.test(id) ? entries.get(id) : undefined;
            // 接收中的上传没有人拿得到它的 id，不会走到这里；收到也当作不存在。
            if (entry === undefined || entry.state !== "ready") return;
            if (entry.users > 0) {
                entry.deleting = true;
                return;
            }
            await remove(id);
        },

        async stop() {
            stopped = true;
            cancelSweep?.();
            cancelSweep = null;
            const pending = [...receiving];
            for (const item of pending) item.abort.abort();
            await Promise.all(pending.map((item) => item.done));
        },
    };
}
