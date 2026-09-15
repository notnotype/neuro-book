/**
 * 值动作的请求解析与核心执行。
 *
 * 这是 HTTP 与 Storage 核心之间唯一的动作边界：请求体在这里有界读取并按共享 DTO 解析，
 * 逻辑地址在这里解析为注册定义，动作只调用句柄持有的核心能力。
 * 因此外部输入不能提交自己的 scope、locality、root、主体或校验规则，本模块也不复制核心算法。
 */

import {createError, getHeader, type H3Event} from "h3";
import getRawBody from "raw-body";
import {
    StorageActionRequestSchema,
    type StorageActionRequest,
    type StorageActionResponse,
} from "nbook/shared/storage/action";
import {isSafeStorageIdentifier, type DefinedStorageState, type StorageStateRegistry} from "nbook/shared/storage/definition";
import {
    StorageAddressInvalidError,
    StorageRequestInvalidError,
} from "nbook/shared/storage/storage-errors";
import type {StorageHandle} from "nbook/server/storage/storage-service";

/** 请求体超过传输上限；与其它上传入口一致，按平台级 413 报告，不占用领域错误码。 */
const REQUEST_BODY_TOO_LARGE = "REQUEST_BODY_TOO_LARGE" as const;

/** 动作地址的三个逻辑标识；只有注册边界能判定它们是否存在与可用。 */
export type StorageActionAddress = {
    readonly owner: string;
    readonly key: string;
    readonly resource?: string;
};

/**
 * 有界读取一次动作请求，并按共享 DTO 解析。
 *
 * 先核对 Content-Length、再在读取过程中执行硬字节上限，因此无长度声明的流式请求也不能让内存无界增长。
 */
export async function readStorageActionRequest(event: H3Event, maxBytes: number): Promise<StorageActionRequest> {
    const declaredLength = getHeader(event, "content-length");
    if (declaredLength !== undefined && Number(declaredLength) > maxBytes) {
        throw bodyTooLarge(Number(declaredLength), maxBytes);
    }
    let raw: string;
    try {
        raw = await getRawBody(event.node.req, {length: declaredLength, limit: maxBytes, encoding: "utf8"});
    } catch (error) {
        const bytes = oversizedBytes(error);
        if (bytes !== null) {
            throw bodyTooLarge(bytes, maxBytes);
        }
        throw error;
    }
    let body: unknown;
    try {
        body = JSON.parse(raw) as unknown;
    } catch {
        throw new StorageRequestInvalidError("body", "Storage 动作请求体必须是有效 JSON");
    }
    return parseStorageActionRequest(body);
}

/** 解析动作请求：形状、动作名与边界值不合法时在触碰任何记录或注册定义之前拒绝。 */
export function parseStorageActionRequest(body: unknown): StorageActionRequest {
    const parsed = StorageActionRequestSchema.safeParse(body);
    if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new StorageRequestInvalidError(
            "action",
            `Storage 动作请求不合法：${issue === undefined ? "未知字段" : `${issue.path.join(".")} ${issue.message}`}`,
        );
    }
    return parsed.data;
}

/**
 * 解析动作的逻辑地址并取回注册定义。
 *
 * 字符集在这里判定，注册状态与寻址方式由注册表判定；两者都不接受调用方提交的策略。
 */
export function requireStorageActionState(
    registry: StorageStateRegistry,
    action: StorageActionRequest,
): DefinedStorageState<unknown> {
    assertSafeAddress({owner: action.owner, key: action.key, resource: action.resource});
    return registry.resolveAddress(action.owner, action.key);
}

/** 执行动作；条件凭据、容量、原子替换与失败分类都由句柄背后的核心拥有。 */
export async function runStorageAction(input: {
    readonly handle: StorageHandle;
    readonly state: DefinedStorageState<unknown>;
    readonly action: StorageActionRequest;
}): Promise<StorageActionResponse> {
    const {handle, state, action} = input;
    switch (action.kind) {
        case "read": {
            const result = await handle.read(state, {resource: action.resource});
            // 解析器错误可能引用原始内容，HTTP 只公开分类；服务端直接读取仍保留详细诊断。
            if (result.kind === "corrupt") return {kind: "read", result: {...result, diagnosis: "记录内容无效，需要显式修复"}};
            if (result.kind === "unsupported-version") return {kind: "read", result: {...result, diagnosis: "记录版本高于当前支持版本"}};
            return {kind: "read", result};
        }
        case "save":
            return {kind: "save", credential: await handle.save(state, {expected: action.expected, value: action.value, resource: action.resource})};
        case "remove":
            return {kind: "remove", credential: await handle.remove(state, {expected: action.expected, resource: action.resource})};
        case "migrate":
            return {kind: "migrate", credential: await handle.migrate(state, {expected: action.expected, value: action.value, resource: action.resource})};
        case "repair":
            return {kind: "repair", credential: await handle.repair(state, {expected: action.expected, value: action.value, resource: action.resource})};
        case "reclaim":
            return {kind: "reclaim", result: await handle.reclaim(state, {targets: action.targets.map((target) => ({resource: target.resource}))})};
    }
}

function assertSafeAddress(address: StorageActionAddress): void {
    if (!isSafeStorageIdentifier(address.owner)) {
        throw new StorageAddressInvalidError("owner", `Storage owner 不是安全逻辑标识：${address.owner}`);
    }
    if (!isSafeStorageIdentifier(address.key)) {
        throw new StorageAddressInvalidError("key", `Storage key 不是安全逻辑标识：${address.key}`);
    }
    if (address.resource !== undefined && !isSafeStorageIdentifier(address.resource)) {
        throw new StorageAddressInvalidError("resource", `Storage 资源标识不是安全逻辑标识：${address.resource}`);
    }
}

function bodyTooLarge(bytes: number, maxBytes: number): Error {
    return createError({
        statusCode: 413,
        message: "Storage 动作请求体超过允许大小",
        data: {code: REQUEST_BODY_TOO_LARGE, bytes, maxBytes},
    });
}

/** 读取过程中触发上限时的实际字节数；早期长度检查只有声明长度。 */
function oversizedBytes(error: unknown): number | null {
    if (typeof error !== "object" || error === null || (error as {type?: unknown}).type !== "entity.too.large") {
        return null;
    }
    const candidate = error as {readonly received?: unknown; readonly expected?: unknown};
    for (const value of [candidate.received, candidate.expected]) {
        if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
            return value;
        }
    }
    return null;
}
