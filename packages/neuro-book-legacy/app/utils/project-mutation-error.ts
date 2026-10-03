import {FetchError} from "ofetch";

export type ProjectMutationCommitState = boolean | "unknown";

/** Store 已收到 mutation 成功响应，但无法重新取得完整 Catalog 时保留明确提交事实。 */
export class ProjectCatalogRefreshError extends Error {
    readonly committed = true;

    constructor(readonly operation: string, options: ErrorOptions) {
        super("Project 操作已经提交，但项目列表刷新失败", options);
        this.name = "ProjectCatalogRefreshError";
    }
}

type ApiErrorLike = {
    /** `$fetch` 解析后的响应正文；外部错误结构在运行时继续逐字段收窄。 */
    readonly data?: unknown;
    readonly response?: {
        /** ofetch 在部分调用链保留的响应正文。 */
        readonly _data?: unknown;
    };
};

/**
 * 从 Project mutation HTTP 错误中读取提交状态。
 *
 * 匹配 operation 的公开字段优先；ofetch 没有收到 HTTP response 时无法判断服务端
 * 是否已经提交，统一返回 unknown。畸形 HTTP 响应和其它 mutation 仍返回 null。
 */
export function resolveProjectMutationCommitState(
    error: unknown,
    expectedOperation: string,
): ProjectMutationCommitState | null {
    if (error instanceof ProjectCatalogRefreshError) {
        return error.operation === expectedOperation ? error.committed : null;
    }
    if (!isObject(error)) {
        return null;
    }
    const candidate = error as ApiErrorLike;
    const structured = commitState(candidate.data, expectedOperation)
        ?? commitState(candidate.response?._data, expectedOperation);
    if (structured !== null) {
        return structured;
    }
    return error instanceof FetchError && error.response === undefined ? "unknown" : null;
}

/** 从 H3 error envelope 或直接 data 中收窄 operation/committed。 */
function commitState(value: unknown, expectedOperation: string): ProjectMutationCommitState | null {
    if (!isObject(value)) {
        return null;
    }
    const payload = "data" in value ? value.data : value;
    if (!isObject(payload) || payload.operation !== expectedOperation) {
        return null;
    }
    if (payload.committed === true || payload.committed === false || payload.committed === "unknown") {
        return payload.committed;
    }
    return null;
}

/** 外部错误正文只在字段访问前收窄为对象。 */
function isObject(value: unknown): value is object & {[key: string]: unknown} {
    return typeof value === "object" && value !== null;
}
