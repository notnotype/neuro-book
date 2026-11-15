/**
 * 把模型端口包一层，让经它发出的请求都进记录器（docs/specs/agent/request-trace.md 输出 1）。宿主把会话表、标题、子代理用的
 * 端口都换成包过的这一个。
 */

import type {ModelCallMeta, ModelPort, ModelResponse, ModelWireObserver} from "../../kernel/contracts.js";
import type {RequestRecorder, TracedCallMeta} from "./recorder.js";

/** 内核给了会话、请求序号与哈希的调用才记：`complete()` 与插件自己的探测没有说明。 */
function tracedMeta(meta: ModelCallMeta | undefined): TracedCallMeta | null {
    if (meta?.session === undefined || meta.request === undefined || meta.hash === undefined) return null;
    return meta as TracedCallMeta;
}

/** 记录器的观察者在前：它从不抛错，所以外层观察者抛错（适配器接住）不会让记录漏掉这一次尝试。 */
function combine(recorder: ModelWireObserver, outer: ModelWireObserver | undefined): ModelWireObserver {
    if (outer === undefined) return recorder;
    return {
        attempt: (wire) => {
            recorder.attempt?.(wire);
            outer.attempt?.(wire);
        },
        payload: (body) => {
            recorder.payload?.(body);
            outer.payload?.(body);
        },
        firstContent: () => {
            recorder.firstContent?.();
            outer.firstContent?.();
        },
    };
}

export function traceModelPort(port: ModelPort, recorder: RequestRecorder): ModelPort {
    return {
        resolve(query) {
            const resolution = port.resolve(query);
            if (!resolution.ok) return resolution;
            return {
                ...resolution,
                call: async (request, signal, onDelta, meta) => {
                    const traced = tracedMeta(meta);
                    const handle = traced === null || !recorder.enabled() ? null : await recorder.start(traced, request);
                    if (handle === null) return resolution.call(request, signal, onDelta, meta);
                    let response: ModelResponse;
                    try {
                        response = await resolution.call(request, signal, onDelta, {...meta, observe: combine(handle.observer, meta?.observe)});
                    } catch (error) {
                        handle.fail(error, signal.aborted);
                        throw error;
                    }
                    handle.finish(response);
                    return response;
                },
            };
        },
    };
}
