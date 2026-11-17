/**
 * 写入图片（docs/specs/workspace/files.md 的“写入图片”）两端共用的部分：服务端路由（`backend/upload-route.ts`）与浏览器客户端
 * （`web/client.ts` 的 `upload`）。码表在这里写一份：路由按它给状态码，客户端按响应体的 `code` 判断、状态码只作兜底。
 * 失败码不加进 `FILES_FAILURES`：那是远程合同的业务失败码表，上传走 HTTP，加进去会改远程合同。
 */

import type {RasterImageType} from "nbook/shared/image-type";

/** 一次上传至多 32 MiB（同按地址读取字节的上限）。 */
export const UPLOAD_MAX_BYTES = 32 * 1024 * 1024;

/** 名字的扩展名（小写，不带点）对应的图片类型：JPEG 是 `jpg` 或 `jpeg`。 */
export const UPLOAD_EXTENSIONS: Readonly<Record<string, RasterImageType>> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
};

/** 重名时 `exists=rename` 至多试到 `名字 100`。 */
export const UPLOAD_RENAME_LIMIT = 100;

/** 服务端会回的失败码与状态码（Spec 的状态码表）。 */
export const UPLOAD_FAILURE_STATUS = {
    "invalid-address": 400,
    "permission-denied": 403,
    "cross-site": 403,
    "protected-path": 404,
    "outside-root": 404,
    "not-found": 404,
    "conflict": 409,
    "not-a-directory": 409,
    "generation-gone": 410,
    "root-gone": 410,
    "too-large": 413,
    "unsupported-type": 415,
    "extension-mismatch": 415,
    "io-failed": 500,
    "unknown-outcome": 502,
    "project-unavailable": 503,
} as const;

export type UploadServerFailure = keyof typeof UPLOAD_FAILURE_STATUS;

/** 客户端自己给的码：没有绑定项目或地址不是 `project://`（不发出）；调用方取消（图可能已写下）；请求发出前就失败。 */
export type UploadFailureCode = UploadServerFailure | "unavailable" | "cancelled" | "network";

export type UploadResult =
    | {readonly ok: true; readonly address: string; readonly renamed: boolean}
    | {readonly ok: false; readonly code: UploadFailureCode; readonly detail: string};

export const isUploadServerFailure = (code: unknown): code is UploadServerFailure => typeof code === "string" && Object.hasOwn(UPLOAD_FAILURE_STATUS, code);

/** `exists`：目标已存在时 `fail`（缺省，409）还是 `rename`（加序号）。 */
export type UploadExists = "fail" | "rename";
