/**
 * 插件文件夹的上传路由（docs/specs/runtime/plugin-install.md 输出 11 与“边界与兼容”的上传接口）：`POST /api/nbook.plugins/uploads`
 * 接收整个文件夹（请求体是分帧的流，帧格式见 `nbook/plugin-platform/shared/plugin-upload`）并交回上传 id，`DELETE /api/nbook.plugins/uploads/<id>`
 * 删除一个上传。失败体是 `{code, detail}`。
 *
 * 不用 `bodyLimit`：它在没有 `Content-Length` 时会把整份请求体读进内存才判断；上限在流里数（`readUploadStream`）。声明了
 * `Content-Length` 且超限的当场拒绝，省得读。写请求的来源检查在 nb-host 的分发里（非安全方法带了不允许的 `Origin` 就 403）。
 */

import {Hono} from "hono";

import {rethrowRouteError} from "@notnotype/nb-host/http/contracts";
import type {HttpRouteEnv} from "@notnotype/nb-host/http/contracts";

import {UploadServerError} from "nbook/plugin-platform/backend/uploads";
import type {PluginUploads} from "nbook/plugin-platform/backend/uploads";
import {UPLOAD_LIMITS, UploadError} from "nbook/plugin-platform/shared/plugin-upload";
import type {UploadLimits} from "nbook/plugin-platform/shared/plugin-upload";

const STATUS = {"upload-too-large": 413, "upload-path-invalid": 400, "upload-malformed": 400, "upload-busy": 429, "upload-failed": 500} as const;

const failure = (code: keyof typeof STATUS, detail: string): Response => Response.json({code, detail}, {status: STATUS[code]});

export function createPluginUploadRoutes(uploads: PluginUploads, limits: UploadLimits = UPLOAD_LIMITS): Hono<{Bindings: HttpRouteEnv}> {
    return new Hono<{Bindings: HttpRouteEnv}>()
        .onError(rethrowRouteError)
        .post("/uploads", async (c) => {
            const declared = Number(c.req.header("content-length"));
            if (Number.isFinite(declared) && declared > limits.maxTotalBytes) return failure("upload-too-large", `上传超过 ${String(limits.maxTotalBytes)} 字节`);
            const body = c.req.raw.body;
            if (body === null) return failure("upload-malformed", "请求体是空的");
            try {
                return Response.json(await uploads.receive(body));
            } catch (error) {
                if (error instanceof UploadError || error instanceof UploadServerError) return failure(error.code, error.message);
                throw error;
            }
        })
        .delete("/uploads/:id", async (c) => {
            await uploads.discard(c.req.param("id"));
            return new Response(null, {status: 204});
        });
}
