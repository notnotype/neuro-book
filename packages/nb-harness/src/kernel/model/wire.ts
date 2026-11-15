/**
 * 把适配器拿得到的线上事实交给调用说明里的观察者（docs/specs/harness/models.md 输出 20）。
 *
 * 取在 `fetch` 这一层，不取 pi-ai 的 `onResponse`：anthropic、bedrock、gemini-cli、ollama 的实现都不调它，而 anthropic 把
 * `options.fetch` 一路传给 SDK；pi-ai 与 SDK 内部的 HTTP 重试也都经过这一层，所以每次尝试各交一次。
 * 交出之前用错误文字的同一个函数遮盖配置密钥原值（`redactText`）：观察者会把这些落盘。
 *
 * 观察者的错由它自己处理（宿主的记录器在回调里接住并写诊断）；这里只保证它抛错时请求照常进行。
 */

import type {ModelWireAttempt, ModelWireObserver} from "../api/index.js";
import {redactText} from "./redact.js";

/** 观察者的回调抛错时不影响请求：错误由观察者自己负责报告（见模块头）。 */
export function notify(callback: () => void): void {
    try {
        callback();
    } catch {
        // 观察者自己的失败不能拖垮模型请求；记录器在回调里已经接住并写了诊断。
    }
}

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

/** 发出的地址、头与体：`Request` 上的头在前，`init.headers` 叠在后面，与 `fetch` 实际发的一致。 */
function sentOf(input: FetchInput, init: FetchInit, secrets: readonly string[]): Pick<ModelWireAttempt, "url" | "headers" | "body"> {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init?.headers !== undefined) new Headers(init.headers).forEach((value, name) => headers.set(name, value));
    return {url: redactText(url, secrets), headers: headersOf(headers, secrets), body: typeof init?.body === "string" ? redactText(init.body, secrets) : null};
}

function headersOf(headers: Headers, secrets: readonly string[]): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    headers.forEach((value, name) => {
        result[name] = redactText(value, secrets);
    });
    return result;
}

/** 包一层 `fetch`：每次尝试结束（拿到响应头或抛错）交一次 `attempt`。没有观察者时原样调用。 */
export function observedFetch(base: typeof fetch, observer: ModelWireObserver | undefined, secrets: readonly string[]): typeof fetch {
    const attempt = observer?.attempt;
    if (attempt === undefined) return base;
    return (async (input: FetchInput, init?: FetchInit) => {
        const startedAt = Date.now();
        const sent = sentOf(input, init, secrets);
        let response: Response;
        try {
            response = await base(input, init);
        } catch (error) {
            const message = redactText(error instanceof Error ? error.message : String(error), secrets);
            notify(() => attempt.call(observer, {...sent, startedAt, endedAt: Date.now(), error: message}));
            throw error;
        }
        notify(() => attempt.call(observer, {...sent, startedAt, endedAt: Date.now(), response: {status: response.status, headers: headersOf(response.headers, secrets)}}));
        return response;
    }) as typeof fetch;
}
