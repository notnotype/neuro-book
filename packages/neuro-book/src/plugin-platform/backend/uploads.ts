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
    /** 撤销清扫的计时器；之后的接收照样能做，只是不再定时清理（宿主停止时调用）。 */
    stop(): void;
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

    const directoryOf = (id: string): string => join(options.root, id);

    /** 删除一个上传的目录与登记；目录删不掉只记诊断（下次清空），登记照样去掉。 */
    async function remove(id: string): Promise<void> {
        entries.delete(id);
        await rm(directoryOf(id), {recursive: true, force: true}).catch((error: unknown) => {
            options.record({level: "warn", event: "plugins.upload.cleanup-failed", message: "删除上传暂存目录失败，下次清空", data: {id}, error});
        });
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

    /** 占位：满了先淘汰最久没被用过的可用上传，都在接收或使用中才拒绝。 */
    async function reserve(): Promise<string> {
        if (entries.size >= maxUploads) {
            let oldest: string | null = null;
            for (const [id, entry] of entries) {
                if (entry.state !== "ready" || entry.users > 0) continue;
                if (oldest === null || entry.lastUsed < entries.get(oldest)!.lastUsed) oldest = id;
            }
            if (oldest === null) throw new UploadServerError("upload-busy", `同时在处理的上传已有 ${String(maxUploads)} 个，稍后再试`);
            await remove(oldest);
        }
        const id = randomUUID();
        entries.set(id, {state: "receiving", users: 0, lastUsed: options.clock.now(), deleting: false});
        return id;
    }

    /** 往暂存目录里写一个文件：`wx` 独占新建，不写临时名再改名（交回之前没人读这个目录）。 */
    async function openFile(directory: string, path: string): Promise<UploadFileSink> {
        const target = join(directory, ...path.split("/"));
        await mkdir(dirname(target), {recursive: true});
        const handle = await open(target, "wx");
        return {
            write: async (chunk) => {
                if (stopped) throw new UploadServerError("upload-failed", "服务端正在停止");
                await handle.write(chunk);
            },
            end: () => handle.close(),
            abort: () => handle.close(),
        };
    }

    return {
        async receive(body) {
            await ensureCleared();
            const id = await reserve();
            const directory = directoryOf(id);
            try {
                await mkdir(directory, {recursive: true});
                const result = await readUploadStream(body, {limits, open: (path) => openFile(directory, path)});
                const entry = entries.get(id);
                if (entry === undefined) throw new UploadServerError("upload-failed", "上传在接收期间被清掉了");
                entry.state = "ready";
                entry.lastUsed = options.clock.now();
                return {id, files: result.files, bytes: result.bytes};
            } catch (error) {
                await remove(id);
                if (error instanceof UploadError || error instanceof UploadServerError) throw error;
                throw new UploadServerError("upload-failed", `写上传暂存目录失败：${error instanceof Error ? error.message : String(error)}`, {cause: error});
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

        stop() {
            stopped = true;
            cancelSweep?.();
            cancelSweep = null;
        },
    };
}
