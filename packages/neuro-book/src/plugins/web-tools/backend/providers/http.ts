/**
 * 发给服务的 HTTP 请求的公共部分（docs/specs/web/tools.md 输出 10 到 12、14）：按实际读到的字节限长读响应体、只在 429 时
 * 重试一次、错误详情先遮盖密钥再截短。
 */

import type {ProviderFailureCode} from "../../shared/contracts";
import type {CallScope, ProviderFailure} from "./types";

/** 成功响应与错误响应的读取上限（输出 11）。 */
export const SUCCESS_BODY_LIMIT = 4 * 1024 * 1024;
export const ERROR_BODY_LIMIT = 16 * 1024;
/** 详情的长度上限（输出 12）。 */
export const DETAIL_LIMIT = 500;
/** 密钥里不短于这个长度的片段都遮盖（输出 12）。 */
const SECRET_FRAGMENT = 8;
const DEFAULT_RETRY_WAIT_MS = 1000;

export interface HttpOptions {
    readonly fetch: typeof fetch;
    readonly now: () => number;
    /** 等重试的间隔；中止时提前完成。测试注入它，不按固定时长等。 */
    readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
}

export const realSleep = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal.aborted) return resolve();
        const done = (): void => {
            clearTimeout(timer);
            signal.removeEventListener("abort", done);
            resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done, {once: true});
    });

type BodyRead = {readonly ok: true; readonly text: string} | {readonly ok: false; readonly code: "too-large" | "timeout" | "unreachable"};

/** 边读边计字节，超过上限就取消读取：不信 `Content-Length`，没有它的分块响应同样受限。 */
async function readBounded(response: Response, limit: number, signal: AbortSignal): Promise<BodyRead> {
    if (response.body === null) return {ok: true, text: ""};
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const {done, value} = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limit) {
                await reader.cancel().catch(() => undefined);
                return {ok: false, code: "too-large"};
            }
            chunks.push(value);
        }
    } catch {
        return {ok: false, code: signal.aborted ? "timeout" : "unreachable"};
    }
    return {ok: true, text: new TextDecoder().decode(Buffer.concat(chunks))};
}

/** 把 `secret` 与它里面任何不短于 8 个字符的片段换成 `***`：截短可能切在密钥中间，只换整串会漏掉前半截。 */
export function redact(text: string, secret: string): string {
    if (secret.length < SECRET_FRAGMENT) return secret.length === 0 ? text : text.split(secret).join("***");
    let out = text;
    for (let length = secret.length; length >= SECRET_FRAGMENT; length -= 1) {
        for (let start = 0; start + length <= secret.length; start += 1) {
            const fragment = secret.slice(start, start + length);
            if (out.includes(fragment)) out = out.split(fragment).join("***");
        }
    }
    return out;
}

/** 先遮盖再截短（截短后再遮盖会漏掉被切开的片段）。 */
export function safeDetail(text: string, secret: string): string {
    const redacted = redact(text, secret);
    return redacted.length > DETAIL_LIMIT ? redacted.slice(0, DETAIL_LIMIT) : redacted;
}

const REQUEST_ID = /request_id:\s*([\w-]+)/u;

/** 错误响应只取 `error.message`（输出 12）；不是这个形状就不给详情，不转抄原始响应体。 */
function errorInfo(body: string, secret: string): {readonly detail?: string; readonly requestId?: string} {
    let message: unknown;
    try {
        message = (JSON.parse(body) as {error?: {message?: unknown}} | null)?.error?.message;
    } catch {
        return {};
    }
    if (typeof message !== "string" || message === "") return {};
    const requestId = REQUEST_ID.exec(message)?.[1];
    return {detail: safeDetail(message, secret), ...(requestId === undefined ? {} : {requestId})};
}

const STATUS_CODES: Readonly<Record<number, ProviderFailureCode>> = {400: "invalid-request", 401: "auth", 402: "quota", 403: "rejected", 404: "not-found", 429: "rate-limited"};

function retryWait(response: Response): number {
    const header = response.headers.get("retry-after");
    const seconds = header === null ? Number.NaN : Number(header);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RETRY_WAIT_MS;
}

export type JsonOutcome = {readonly ok: true; readonly json: unknown} | ProviderFailure;

/**
 * POST 一个 JSON 请求、读 JSON 响应。只有 429 重试一次，等完会超过总截止就不重试；其它失败都不重发：服务可能已经执行并计费
 * （输出 10）。
 */
export async function postJson(url: string, body: unknown, key: string, scope: CallScope, options: HttpOptions): Promise<JsonOutcome> {
    for (let attempt = 0; ; attempt += 1) {
        if (scope.signal.aborted) return {ok: false, code: "timeout"};
        let response: Response;
        try {
            response = await options.fetch(url, {
                method: "POST",
                headers: {"authorization": `Bearer ${key}`, "content-type": "application/json"},
                body: JSON.stringify(body),
                signal: scope.signal,
            });
        } catch {
            return {ok: false, code: scope.signal.aborted ? "timeout" : "unreachable"};
        }
        if (response.ok) {
            const read = await readBounded(response, SUCCESS_BODY_LIMIT, scope.signal);
            if (!read.ok) return {ok: false, code: read.code, status: response.status};
            try {
                return {ok: true, json: JSON.parse(read.text)};
            } catch {
                return {ok: false, code: "bad-response", status: response.status};
            }
        }
        const read = await readBounded(response, ERROR_BODY_LIMIT, scope.signal);
        if (!read.ok) return {ok: false, code: read.code, status: response.status};
        if (response.status === 429 && attempt === 0 && scope.retry !== false) {
            const wait = retryWait(response);
            if (options.now() + wait < scope.deadline) {
                await options.sleep(wait, scope.signal);
                continue;
            }
        }
        return {ok: false, code: STATUS_CODES[response.status] ?? "failed", status: response.status, ...errorInfo(read.text, key)};
    }
}
