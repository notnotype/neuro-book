/**
 * Storage 宿主身份与访问上下文的跨端协议。
 *
 * 浏览器只在宿主存储里保留一份定位凭证，服务端从它导出分区用的 clientId；凭证不承载状态值，
 * 也不代替用户鉴权——主体始终由服务端核验。一次访问上下文是服务端按运行期签发的可撤销标识，
 * 与定位凭证分开：后端重启撤销旧上下文，但保留的浏览器身份仍能重新定位原 local 分区。
 * 状态内容、身份域与分区地址仍在 data 内，由 `server/storage` 拥有。
 */

/** 客户端定位凭证的请求头；由宿主适配器保存与提供，不作为可自由改写的业务字段。 */
export const STORAGE_CLIENT_CREDENTIAL_HEADER = "x-nbook-storage-client";

/** 访问上下文的请求头；每次请求都要重新核验，不能只凭签发时的事实。 */
export const STORAGE_ACCESS_CONTEXT_HEADER = "x-nbook-storage-context";

/** 定位凭证与上下文标识都用 32 字节随机值，落成 64 位小写十六进制不透明标识。 */
export const STORAGE_OPAQUE_TOKEN_BYTES = 32;

/** 不透明标识的字符长度；服务端按固定长度校验，不接受任意长度或自报标识。 */
export const STORAGE_OPAQUE_TOKEN_LENGTH = STORAGE_OPAQUE_TOKEN_BYTES * 2;

const STORAGE_OPAQUE_TOKEN_PATTERN = /^[0-9a-f]{64}$/u;

/** 判断客户端定位凭证是否为本合同的不透明标识。 */
export function isStorageClientCredential(value: string): boolean {
    return STORAGE_OPAQUE_TOKEN_PATTERN.test(value);
}

/** 判断访问上下文标识是否为本合同的不透明标识。 */
export function isStorageAccessContextId(value: string): boolean {
    return STORAGE_OPAQUE_TOKEN_PATTERN.test(value);
}

/** user 访问上下文的初始化结果；contextId 只在签发它的后端运行期有效。 */
export type StorageUserContextDto = {
    readonly contextId: string;
};

/** 释放结果；`false` 表示该上下文已不存在，属于幂等成功。 */
export type StorageContextReleaseDto = {
    readonly released: boolean;
};
