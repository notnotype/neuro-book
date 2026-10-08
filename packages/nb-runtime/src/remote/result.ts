/**
 * 远程调用结果的取值（runtime/plugin-channel.md 输出第 1 条、验收 20）：客户端方法仍返回结构化结果，只想要值的
 * 调用方用 `orThrow` 把失败转成异常。
 */

import type {RemoteFailure, RemoteResult} from "./protocol";

/**
 * 远程调用失败。失败结果原样放在 `failure`，不放进 `cause`：`Error.cause` 的含义是“引起它的错误”，与远程失败的
 * `cause`（`timeout`、`disconnected` 等）同名会混淆。
 */
export class RemoteCallError extends Error {
    readonly failure: RemoteFailure<string>;

    constructor(failure: RemoteFailure<string>) {
        const cause = failure.cause === undefined ? "" : `（${failure.cause}）`;
        const detail = typeof failure.detail === "string" ? `：${failure.detail}` : "";
        super(`远程调用失败 ${failure.code}${cause}${detail}`);
        this.name = "RemoteCallError";
        this.failure = failure;
    }

    get code(): string {
        return this.failure.code;
    }
}

/**
 * 成功给值，失败抛 `RemoteCallError`。抛出不改变失败的含义：写请求的 `unknown-outcome` 被抛出后副作用仍可能已经
 * 发生，调用方不能把它当作确定失败去重试。
 */
export function orThrow<T, Code extends string>(result: RemoteResult<T, Code>): T {
    if (result.ok) return result.value;
    throw new RemoteCallError(result);
}
