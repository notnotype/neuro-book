/**
 * 插件页把拖入或选出的文件夹上传到服务端的上传暂存区（docs/specs/runtime/plugin-install.md 输出 11）：拼分帧的请求体、检查文件夹像
 * 不像一个插件、发出请求并把结果译成页面要用的几种。读文件夹本身是 `nbook/ui/dropped-folder`，帧格式与限额、路径规则是
 * `nbook/plugin-platform/shared/plugin-upload`（服务端用同一份）。
 *
 * 请求体是 `Blob`：由 `File` 拼成的 `Blob` 不把内容复制进内存，浏览器发送时才读。不用 `fetch` 的流式请求体：Chromium 只在
 * HTTP/2 以上才允许，本机回环是 HTTP/1.1。用 `XMLHttpRequest` 是为了有上传进度；`fetch` 看不到。
 */

import {encodeFrameHeader, frameBytes, UPLOAD_LIMITS, uploadPathProblem} from "nbook/plugin-platform/shared/plugin-upload";
import type {CollectedFolder, CollectOptions} from "nbook/shared/collected-folder";

/** 上传路由的地址（挂在 `/api/nbook.plugins/` 下）。 */
export const PLUGIN_UPLOAD_URL = "/api/nbook.plugins/uploads";

/** 任何深度的这两个目录不上传：安装时本来就排除。 */
export const UPLOAD_SKIPPED = new Set(["node_modules", ".git"]);

/** 收集文件夹时用的选项：上传的限额与路径规则，总量按分帧后的字节数计。 */
export const COLLECT_OPTIONS: CollectOptions = {
    limits: UPLOAD_LIMITS,
    skip: (name) => UPLOAD_SKIPPED.has(name),
    pathProblem: uploadPathProblem,
    cost: frameBytes,
};

/** 拼上传的请求体：每个文件一个帧头加内容。 */
export function buildUploadBody(folder: CollectedFolder): Blob {
    const parts: Array<Uint8Array | File> = [];
    for (const {path, file} of folder.files) parts.push(encodeFrameHeader(path, file.size), file);
    return new Blob(parts as ConstructorParameters<typeof Blob>[0]);
}

/**
 * 这个文件夹像不像一个插件：根目录要有 `package.json`。没有时如果恰有一个子目录有，说明用户多拖了一层（或少拖了一层）。
 * 像插件时交回 null。
 */
export function pluginFolderProblem(folder: CollectedFolder): {readonly kind: "no-manifest"} | {readonly kind: "nested"; readonly name: string} | null {
    const paths = folder.files.map((file) => file.path);
    if (paths.includes("package.json")) return null;
    const nested = new Set(paths.filter((path) => /^[^/]+\/package\.json$/u.test(path)).map((path) => path.split("/")[0]!));
    return nested.size === 1 ? {kind: "nested", name: [...nested][0]!} : {kind: "no-manifest"};
}

export type UploadFailureCode = "upload-too-large" | "upload-busy" | "upload-path-invalid" | "upload-malformed" | "upload-failed" | "unreachable";

export type UploadOutcome =
    | {readonly ok: true; readonly id: string; readonly files: number; readonly bytes: number}
    | {readonly ok: false; readonly code: UploadFailureCode; readonly detail: string};

/** 页面用的上传客户端：插件页收它当属性（可替换、可测），不自己伸出去发请求。 */
export interface FolderUploadClient {
    upload(folder: CollectedFolder, options?: {readonly signal?: AbortSignal; readonly onProgress?: (sent: number, total: number) => void}): Promise<UploadOutcome>;
    /** 删除一个上传；页面离开时用 `keepalive`（`fetch` 才有），不等结果，失败不报（服务端会清扫）。 */
    discard(id: string, options?: {readonly keepalive?: boolean}): Promise<void>;
}

const KNOWN: ReadonlySet<string> = new Set(["upload-too-large", "upload-busy", "upload-path-invalid", "upload-malformed", "upload-failed"]);

/** 服务端的失败体是 `{code, detail}`；nb-host 自己的拒绝（403、404、503）是 `{error: {code, message}}`，Bun 的超限 413 没有正文。 */
function failureOf(status: number, text: string): UploadOutcome & {ok: false} {
    try {
        const body: unknown = JSON.parse(text);
        if (typeof body === "object" && body !== null) {
            const record = body as {code?: unknown; detail?: unknown; error?: {code?: unknown; message?: unknown}};
            if (typeof record.code === "string" && KNOWN.has(record.code)) return {ok: false, code: record.code as UploadFailureCode, detail: typeof record.detail === "string" ? record.detail : ""};
            if (typeof record.error?.message === "string") return {ok: false, code: "upload-failed", detail: record.error.message};
        }
    } catch {
        // 不是 JSON：按状态码判断。
    }
    if (status === 413) return {ok: false, code: "upload-too-large", detail: ""};
    return {ok: false, code: "upload-failed", detail: `HTTP ${String(status)}`};
}

/** `XMLHttpRequest` 里用到的部分：后端的类型检查没有 DOM 库，这个模块（浏览器入口的一部分）也被它编译。 */
export interface UploadRequest {
    open(method: string, url: string): void;
    responseType: string;
    readonly status: number;
    readonly responseText: string;
    readonly upload: {onprogress: ((event: {readonly loaded: number}) => void) | null};
    onload: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    send(body: Blob): void;
    abort(): void;
}

const browserRequest = (): UploadRequest => new (globalThis as unknown as {XMLHttpRequest: new () => UploadRequest}).XMLHttpRequest();

export interface FolderUploadClientOptions {
    /** 缺省 `PLUGIN_UPLOAD_URL`。 */
    readonly url?: string;
    /** 缺省浏览器的 `XMLHttpRequest`；测试换成替身。 */
    readonly createRequest?: () => UploadRequest;
    /** 缺省 `globalThis.fetch`。 */
    readonly fetch?: typeof fetch;
}

export function createFolderUploadClient(options: FolderUploadClientOptions = {}): FolderUploadClient {
    const url = options.url ?? PLUGIN_UPLOAD_URL;
    return {
        upload(folder, call) {
            return new Promise<UploadOutcome>((resolve) => {
                const request = (options.createRequest ?? browserRequest)();
                const total = folder.bytes;
                request.open("POST", url);
                request.responseType = "text";
                request.upload.onprogress = (event) => call?.onProgress?.(Math.min(event.loaded, total), total);
                request.onload = () => resolve(request.status === 200 ? parseSuccess(request.responseText) : failureOf(request.status, request.responseText));
                request.onerror = () => resolve({ok: false, code: "unreachable", detail: ""});
                request.onabort = () => resolve({ok: false, code: "unreachable", detail: "aborted"});
                call?.signal?.addEventListener("abort", () => request.abort(), {once: true});
                if (call?.signal?.aborted === true) return resolve({ok: false, code: "unreachable", detail: "aborted"});
                request.send(buildUploadBody(folder));
            });
        },
        async discard(id, call) {
            await (options.fetch ?? globalThis.fetch)(`${url}/${encodeURIComponent(id)}`, {method: "DELETE", keepalive: call?.keepalive === true}).catch(() => undefined);
        },
    };
}

function parseSuccess(text: string): UploadOutcome {
    try {
        const body = JSON.parse(text) as {id?: unknown; files?: unknown; bytes?: unknown};
        if (typeof body.id === "string" && typeof body.files === "number" && typeof body.bytes === "number") return {ok: true, id: body.id, files: body.files, bytes: body.bytes};
    } catch {
        // 落到下面的失败。
    }
    return {ok: false, code: "upload-failed", detail: "服务端的应答不对"};
}
