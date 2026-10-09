/**
 * 浏览器里的文件客户端（`filesKey` 的门面，docs/specs/workspace/resources.md）：按资源地址的方案选合同，以原调用方的
 * 身份（`context.remote.on(调用方)`）经代理发出，提供者据此确定写入来源。结果原样带码：业务失败与路由层失败
 * （目标不在、项目代次结束、写请求结果未知等）都不转成空结果。
 */

import type {ActivationContext} from "@notnotype/nb-runtime/plugins";
import type {RemoteFailure, RemoteFailureCode} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {encodedTextBytes, FILES_FAILURES, parseResource, projectFilesContract, TEXT_BUDGET_BYTES, userFilesContract} from "../shared/contracts";
import type {Baseline, FilesFailureCode, FilesResult, FilesService, Scheme} from "../shared/contracts";

type Remote = ActivationContext["remote"];

export function createFilesClient(remote: Remote, consumer: ConsumerIdentity): Omit<FilesService, "watch"> {
    // 两份合同的方法相同；按方案分开取，客户端类型才精确。
    const client = (scheme: Scheme) => (scheme === "project" ? remote.on(consumer).use(projectFilesContract) : remote.on(consumer).use(userFilesContract));
    return {
        list: async (address, options) => {
            const parsed = parseResource(address);
            if (!parsed.ok) return parsed;
            const result = await client(parsed.resource.scheme).list({path: parsed.resource.path}, options?.signal === undefined ? {} : {signal: options.signal});
            return result.ok ? result : fromRemote(result);
        },
        read: async (address, options) => {
            const parsed = parseResource(address);
            if (!parsed.ok) return parsed;
            const result = await client(parsed.resource.scheme).read({path: parsed.resource.path}, options?.signal === undefined ? {} : {signal: options.signal});
            return result.ok ? result : fromRemote(result);
        },
        write: async (address, text, baseline) => {
            const parsed = parseResource(address);
            if (!parsed.ok) return parsed;
            // 超过一条 RPC 消息的保存会被断开连接、成为结果未知：在发出前拒绝。
            if (encodedTextBytes(text) > TEXT_BUDGET_BYTES) return {ok: false, code: "too-large", detail: `${address} 的正文超过上限`};
            const result = await client(parsed.resource.scheme).write({path: parsed.resource.path, text, baseline});
            return result.ok ? result : fromRemote(result);
        },
    };
}

const BUSINESS: ReadonlySet<string> = new Set(FILES_FAILURES);

/** 业务失败的详情已由内核按合同的 schema 校验过（`{detail}`，冲突另带 `current`）。 */
function fromRemote(failure: RemoteFailure<RemoteFailureCode | FilesFailureCode>): FilesResult<never> {
    if (BUSINESS.has(failure.code)) {
        const detail = failure.detail as {readonly detail: string; readonly current?: Baseline};
        return {ok: false, code: failure.code, detail: detail.detail, ...(detail.current === undefined ? {} : {current: detail.current})};
    }
    const reason = typeof failure.detail === "string" ? failure.detail : failure.cause === undefined ? failure.code : `${failure.code}（${failure.cause}）`;
    return {ok: false, code: failure.code, detail: reason};
}
