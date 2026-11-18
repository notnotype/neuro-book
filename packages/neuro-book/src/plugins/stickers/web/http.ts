/**
 * 表情包页的三条 HTTP 路由的浏览器一侧（`stickers/backend/routes.ts`）：加图、导入 zip、导出。同源请求，不带凭据之外的东西；失败交回
 * 服务端的码（`error.code`），网络断开是 `unavailable`。导出拿到 zip 后经 `a.download` 保存，文件名取响应头。
 */

import {STICKERS_ROUTE_PREFIX} from "../shared/contracts";
import type {ImportConflictInfo, ImportChoice, ImportResponse, StickersHttp} from "./packs-page";
import type {UploadResponse} from "./upload-queue";

interface ErrorBody {
    readonly error?: {readonly code?: string; readonly message?: string; readonly reason?: string};
    readonly conflict?: ImportConflictInfo;
}

async function bodyOf(response: Response): Promise<ErrorBody> {
    return (await response.json().catch(() => ({}))) as ErrorBody;
}

/** 响应头里的文件名：`filename*=UTF-8''xxx.zip`。 */
export function downloadName(disposition: string | null, fallback: string): string {
    const match = /filename\*=UTF-8''([^;]+)/iu.exec(disposition ?? "");
    if (match?.[1] === undefined) return fallback;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return fallback;
    }
}

export interface HttpEnvironment {
    readonly fetch: typeof fetch;
    /** 把导出的字节交给浏览器保存。 */
    readonly save: (blob: Blob, name: string) => void;
}

/** 这个文件也由不带 DOM 类型的 tsc 检查，所以按需要的那几个取。 */
const browser = globalThis as unknown as {readonly document: {createElement(tag: "a"): {href: string; download: string; click(): void}}};

const browserSave = (blob: Blob, name: string): void => {
    const url = URL.createObjectURL(blob);
    const link = browser.document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
};

export function createStickersHttp(environment: Partial<HttpEnvironment> = {}): StickersHttp {
    const doFetch = environment.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    const save = environment.save ?? browserSave;
    return {
        async upload(packId, file): Promise<UploadResponse> {
            try {
                const response = await doFetch(`${STICKERS_ROUTE_PREFIX}/packs/${encodeURIComponent(packId)}/images/${encodeURIComponent(file.name)}`, {method: "PUT", body: file});
                if (response.ok) {
                    const body = (await response.json()) as {file: string; resized: boolean};
                    return {ok: true, file: body.file, resized: body.resized};
                }
                const body = await bodyOf(response);
                return {ok: false, code: body.error?.code ?? "unavailable", ...(body.error?.reason === undefined ? {} : {reason: body.error.reason})};
            } catch {
                return {ok: false, code: "unavailable"};
            }
        },
        async importZip(file, choice?: ImportChoice): Promise<ImportResponse> {
            const query = new URLSearchParams({name: file.name});
            if (choice !== undefined) {
                query.set("mode", choice.mode);
                if (choice.mode === "replace") query.set("token", choice.token);
            }
            try {
                const response = await doFetch(`${STICKERS_ROUTE_PREFIX}/import?${query.toString()}`, {method: "POST", body: file});
                if (response.ok) return {ok: true, id: ((await response.json()) as {id: string}).id};
                const body = await bodyOf(response);
                if (body.error?.code === "import-conflict" && body.conflict !== undefined) return {ok: false, code: "import-conflict", conflict: body.conflict};
                return {ok: false, code: body.error?.code ?? "unavailable", ...(body.error?.message === undefined ? {} : {reason: body.error.message})};
            } catch {
                return {ok: false, code: "unavailable"};
            }
        },
        async exportPack(packId) {
            try {
                const response = await doFetch(`${STICKERS_ROUTE_PREFIX}/export/${encodeURIComponent(packId)}`);
                if (!response.ok) return {ok: false, code: (await bodyOf(response)).error?.code ?? "unavailable"};
                save(await response.blob(), downloadName(response.headers.get("content-disposition"), `${packId}.zip`));
                return {ok: true};
            } catch {
                return {ok: false, code: "unavailable"};
            }
        },
    };
}
