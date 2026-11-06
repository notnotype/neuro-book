/**
 * 主题素材的上传（docs/specs/theme/editor.md 的“写场景素材”“写图标素材”）：位图与图标各一条路由。不碰画布与文档，所以测试能直接用。
 */

import {THEME_ASSET_UPLOAD_URL, THEME_ICON_MAX_BYTES, THEME_ICON_UPLOAD_URL} from "nbook/plugins/files/shared/contracts";

export type UploadResult = {readonly ok: true; readonly name: string} | {readonly ok: false; readonly reason: string};

async function put(url: string, blob: Blob): Promise<UploadResult> {
    let response: Response;
    try {
        response = await fetch(url, {method: "PUT", body: blob});
    } catch (error) {
        return {ok: false, reason: error instanceof Error ? error.message : String(error)};
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null) as {code?: string; detail?: string} | null;
        return {ok: false, reason: body?.detail ?? body?.code ?? `${String(response.status)} ${response.statusText}`};
    }
    const body = await response.json() as {address?: string};
    const name = body.address?.split("/").pop();
    return name === undefined || name === "" ? {ok: false, reason: "路由没有给出地址"} : {ok: true, name};
}

/** 上传一张图，成功返回素材文件名（`<sha256>.<扩展名>`）；失败返回路由给的原因。 */
export const uploadScene = (blob: Blob): Promise<UploadResult> => put(THEME_ASSET_UPLOAD_URL, blob);

/**
 * 上传一个图标 SVG，原样不转码；成功返回素材文件名（`<sha256>.svg`）。超过上限的不发请求：路由会断开太大的请求，页面拿不到原因。
 * SVG 是否合格由路由检查（编辑器只拦体积）。
 */
export async function uploadIcon(blob: Blob): Promise<UploadResult> {
    if (blob.size > THEME_ICON_MAX_BYTES) return {ok: false, reason: `图标 ${String(blob.size)} 字节，超过 ${String(THEME_ICON_MAX_BYTES)}`};
    return put(THEME_ICON_UPLOAD_URL, blob);
}
