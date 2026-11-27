/**
 * 复原工作台里放插图要的文件服务（w00056 t06 第 13 轮，第二幕“一张插图”）。Lab 的内存文件只有文本：不能上传，`rawUrl` 一律为空
 * （`fixtures/explorer-scene/memory-files.ts`，Lab 共用，不在这里改它）。这里在它外面包一层：
 * - 上传：先停一小会儿（像真的在写盘，编辑器的“正在上传”看得见），存放目录没有就先建，在内存文件里排他新建一个同名的空文件
 *   （资源管理器列得出；重名时照服务端的 `exists=rename` 加序号），字节另存成 Blob；
 * - `rawUrl`：存过的图给它的 object URL，插图卡片的缩略图与正文里的图都从这里取；别的照旧为空。
 *
 * 图存在页面给的 `DeskBlobs` 里，不在一台工作台里：换幕、关灯时工作台按记下的样子重新挂，记下的样子里只有正文与图的地址
 * （`DeskSnapshot.images`），新挂的一台按地址在内存文件里补回空文件，字节与 object URL 还是这一份。
 */
import type {FilesService} from "nbook/plugins/files/shared/contracts";
import type {UploadResult} from "nbook/plugins/files/shared/upload";

/** 重名时至多试到 `名字 100`（同服务端的 `UPLOAD_RENAME_LIMIT`）。 */
const RENAME_LIMIT = 100;

/**
 * 一次上传先等这么久（ms）。内存文件一下就存好，贴图时编辑器在正文里画的“正在上传 1 张图片”连一帧都留不下；真的写进磁盘也要
 * 一会儿，停这一下让它看得见（@designer 第 12 轮：一闪而过即可，约 0.3 秒，久了像在往云上传）。
 */
const UPLOAD_LATENCY_MS = 360;

const pause = (ms: number, signal: AbortSignal | undefined): Promise<void> => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        resolve();
    }, {once: true});
});

export interface DeskBlobs {
    /** 存过的图的 object URL；没存过为 null。 */
    urlOf(address: string): string | null;
    put(address: string, blob: Blob): void;
    /** 收回所有 object URL（页面卸载时）。 */
    dispose(): void;
}

export function createDeskBlobs(): DeskBlobs {
    const urls = new Map<string, string>();
    return {
        urlOf: (address) => urls.get(address) ?? null,
        put(address, blob) {
            const previous = urls.get(address);
            if (previous !== undefined) URL.revokeObjectURL(previous);
            urls.set(address, URL.createObjectURL(blob));
        },
        dispose() {
            for (const url of urls.values()) URL.revokeObjectURL(url);
            urls.clear();
        },
    };
}

/** `project://插图/名字.png` 的第 n 个候选：第 1 个是原名，之后是 `名字 n.png`（同服务端）。 */
function candidate(address: string, n: number): string {
    if (n === 1) return address;
    const slash = address.lastIndexOf("/");
    const dot = address.lastIndexOf(".");
    return dot > slash + 1 ? `${address.slice(0, dot)} ${String(n)}${address.slice(dot)}` : `${address} ${String(n)}`;
}

const parentOf = (address: string): string => address.slice(0, address.lastIndexOf("/"));

/**
 * 包上能上传、能取图片地址的文件服务。`onStored` 在一张图存下以后调用（工作台记下它，存盘的样子里带上它的地址）。
 * 只认 `project://`：用户目录里不放插图。
 */
export function withBlobs(base: FilesService, blobs: DeskBlobs, onStored: (address: string) => void): FilesService {
    async function upload(address: string, body: Blob | Uint8Array, options?: {readonly exists?: "fail" | "rename"; readonly signal?: AbortSignal}): Promise<UploadResult> {
        if (!address.startsWith("project://")) return {ok: false, code: "unavailable", detail: "插图只存进作品"};
        await pause(UPLOAD_LATENCY_MS, options?.signal);
        const parent = parentOf(address);
        if (parent !== "project:/") {
            const listed = await base.list(parent);
            if (!listed.ok) {
                if (listed.code !== "not-found") return {ok: false, code: "io-failed", detail: listed.detail};
                const made = await base.create(parent, "directory");
                if (!made.ok) return {ok: false, code: "io-failed", detail: made.detail};
            }
        }
        const tries = options?.exists === "rename" ? RENAME_LIMIT : 1;
        for (let n = 1; n <= tries; n += 1) {
            if (options?.signal?.aborted === true) return {ok: false, code: "cancelled", detail: "取消了"};
            const name = candidate(address, n);
            const made = await base.create(name, "file");
            if (made.ok) {
                // 字节先拷进自己的一份：`Blob` 只收底层是普通 `ArrayBuffer` 的视图（共享内存上的不收）。
                blobs.put(name, body instanceof Blob ? body : new Blob([new Uint8Array(body)]));
                onStored(name);
                return {ok: true, address: name, renamed: n > 1};
            }
            if (made.code !== "conflict") return {ok: false, code: "io-failed", detail: made.detail};
        }
        return {ok: false, code: "conflict", detail: `${address} 与它的序号名字都被占用`};
    }
    return {
        ...base,
        rawUrl: (address) => blobs.urlOf(address) ?? base.rawUrl(address),
        upload,
    };
}
