/**
 * 发给服务的 HTTP 请求的公共部分（docs/specs/web/tools.md 输出 10 到 12、14）：按实际读到的字节限长读响应体、只在 429 时
 * 重试一次、错误详情先遮盖密钥再截短。
 */

import {EgressError} from "@notnotype/nb-host/network";
import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";

import type {ProviderFailureCode} from "../../shared/contracts";
import {clip} from "../clip";
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

/** 按宿主时钟等（ADR 0026：插件经宿主的时钟计时）。 */
export const sleepOn = (clock: RuntimeClock) => (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal.aborted) return resolve();
        let cancel = (): void => undefined;
        const done = (): void => {
            cancel();
            signal.removeEventListener("abort", done);
            resolve();
        };
        signal.addEventListener("abort", done, {once: true});
        cancel = clock.schedule(done, ms);
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

/**
 * 把 `secret` 与它里面任何不短于 8 个字符的片段换成 `***`：截短可能切在密钥中间，只换整串会漏掉前半截。
 *
 * 不逐个枚举片段（个数是密钥长度的平方，粘错一长串时要算几十秒，阻塞整个服务端）：密钥里每个 8 字窗口进一个集合，文字里
 * 命中的窗口标出来，相连或重叠的合成一段整体换掉。不短于 8 字的片段都由它的 8 字窗口拼成，所以该遮的都遮到了；文字里凡是
 * 与密钥共有 8 字的地方都会被遮，只多不少。
 */
export function redact(text: string, secret: string): string {
    if (secret.length < SECRET_FRAGMENT) return secret.length === 0 ? text : text.split(secret).join("***");
    const windows = new Set<string>();
    for (let start = 0; start + SECRET_FRAGMENT <= secret.length; start += 1) windows.add(secret.slice(start, start + SECRET_FRAGMENT));
    const parts: string[] = [];
    let copied = 0;
    let start = -1;
    let end = -1;
    for (let index = 0; index + SECRET_FRAGMENT <= text.length; index += 1) {
        if (!windows.has(text.slice(index, index + SECRET_FRAGMENT))) continue;
        if (start >= 0 && index <= end) {
            end = index + SECRET_FRAGMENT;
            continue;
        }
        if (start >= 0) {
            parts.push(text.slice(copied, start), "***");
            copied = end;
        }
        start = index;
        end = index + SECRET_FRAGMENT;
    }
    if (start < 0) return text;
    parts.push(text.slice(copied, start), "***", text.slice(end));
    return parts.join("");
}

/** 这段文字里有没有整把密钥；太短的密钥可能与正常文字撞上，不查（输出 14）。 */
export const containsSecret = (text: string, secret: string): boolean => secret.length >= SECRET_FRAGMENT && text.includes(secret);

/**
 * 解析后的 JSON 里有没有整把密钥（字符串值与对象键）。JSON 可以把任何字符写成 `\uXXXX`，只在原文里找会漏掉这种写法。用显式的栈，
 * 嵌套很深的响应不会撑爆调用栈。
 */
function jsonCarriesSecret(json: unknown, secret: string): boolean {
    const pending: unknown[] = [json];
    while (pending.length > 0) {
        const value = pending.pop();
        if (typeof value === "string") {
            if (value.includes(secret)) return true;
        } else if (Array.isArray(value)) {
            pending.push(...(value as unknown[]));
        } else if (typeof value === "object" && value !== null) {
            for (const [name, item] of Object.entries(value)) {
                if (name.includes(secret)) return true;
                pending.push(item);
            }
        }
    }
    return false;
}

/** 先遮盖再截短（截短后再遮盖会漏掉被切开的片段）。 */
export function safeDetail(text: string, secret: string): string {
    return clip(redact(text, secret), DETAIL_LIMIT);
}

const REQUEST_ID = /request_id:\s*([\w-]+)/u;

/**
 * 各家错误响应的不同之处（输出 12 与“失败与恢复”）：说明在响应体的哪里，以及通用表之外的状态码。
 */
export interface ServiceDialect {
    /** 错误响应体（已解析的 JSON）里给人看的那句说明；不是字符串就不给详情。 */
    readonly errorMessage: (body: unknown) => unknown;
    /** 补在通用表上的状态码，例如 Tavily 的 432、433 是额度用完。 */
    readonly statusCodes?: Readonly<Record<number, ProviderFailureCode>>;
}

/** 错误响应只取服务给的那句说明（输出 12）；不是这个形状就不给详情，不转抄原始响应体。 */
function errorInfo(body: string, secret: string, dialect: ServiceDialect): {readonly detail?: string; readonly requestId?: string} {
    let message: unknown;
    try {
        message = dialect.errorMessage(JSON.parse(body));
    } catch {
        return {};
    }
    if (typeof message !== "string" || message === "") return {};
    // 请求 id 从遮盖过的文字里取：它进诊断，服务若把密钥写在那个位置也不带出去。
    const redacted = redact(message, secret);
    const requestId = REQUEST_ID.exec(redacted)?.[1];
    return {detail: clip(redacted, DETAIL_LIMIT), ...(requestId === undefined ? {} : {requestId})};
}

const STATUS_CODES: Readonly<Record<number, ProviderFailureCode>> = {400: "invalid-request", 401: "auth", 402: "quota", 403: "rejected", 404: "not-found", 429: "rate-limited"};

/** HTTP 日期的通行写法（RFC 9110 的 IMF-fixdate，如 `Thu, 19 Nov 2026 12:00:03 GMT`）。`Date.parse` 本身太宽，`1.5` 也当日期。 */
const HTTP_DATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

/** `Retry-After` 的两种写法（RFC 9110 的 10.2.3）：非负整数秒，或 HTTP 日期（已过的按 0）；都不是时按 1 秒。 */
function retryWait(response: Response, now: number): number {
    const header = response.headers.get("retry-after")?.trim() ?? "";
    if (/^\d+$/u.test(header)) return Number(header) * 1000;
    const at = HTTP_DATE.test(header) ? Date.parse(header) : Number.NaN;
    return Number.isNaN(at) ? DEFAULT_RETRY_WAIT_MS : Math.max(0, at - now);
}

export type JsonOutcome = {readonly ok: true; readonly json: unknown} | ProviderFailure;

/**
 * POST 一个 JSON 请求、读 JSON 响应。只有 429 重试一次，等完会超过总截止就不重试；其它失败都不重发：服务可能已经执行并计费
 * （输出 10）。不跟随重定向：跟随会把同一个带密钥的请求在新地址再发一次，绕过上面的重发规则；3xx 按失败交回。
 */
export async function postJson(url: string, body: unknown, key: string, scope: CallScope, options: HttpOptions, dialect: ServiceDialect): Promise<JsonOutcome> {
    for (let attempt = 0; ; attempt += 1) {
        if (scope.signal.aborted) return {ok: false, code: "timeout"};
        let response: Response;
        try {
            response = await options.fetch(url, {
                method: "POST",
                headers: {"authorization": `Bearer ${key}`, "content-type": "application/json"},
                body: JSON.stringify(body),
                signal: scope.signal,
                redirect: "manual",
            });
        } catch (error) {
            if (scope.signal.aborted) return {ok: false, code: "timeout"};
            // 网络出口选不出路（代理是 SOCKS 或自动配置脚本、地址不对、系统设置读不到）：请求没有发出，原因写进详情。
            if (error instanceof EgressError) return {ok: false, code: "unreachable", detail: clip(error.message, DETAIL_LIMIT)};
            return {ok: false, code: "unreachable"};
        }
        if (response.ok) {
            const read = await readBounded(response, SUCCESS_BODY_LIMIT, scope.signal);
            if (!read.ok) return {ok: false, code: read.code, status: response.status};
            // 服务把密钥原样带了回来（例如回显请求头）：这份响应不交出去，它会进工具结果与会话（输出 14）。原文与解析后的值都查：
            // 原文里找得到的不用解析就拒收，转义写法的要解析后才看得出来。
            if (containsSecret(read.text, key)) return {ok: false, code: "bad-response", status: response.status};
            let json: unknown;
            try {
                json = JSON.parse(read.text);
            } catch {
                return {ok: false, code: "bad-response", status: response.status};
            }
            if (key.length >= SECRET_FRAGMENT && jsonCarriesSecret(json, key)) return {ok: false, code: "bad-response", status: response.status};
            return {ok: true, json};
        }
        const read = await readBounded(response, ERROR_BODY_LIMIT, scope.signal);
        if (!read.ok) return {ok: false, code: read.code, status: response.status};
        if (response.status === 429 && attempt === 0 && scope.retry !== false) {
            const wait = retryWait(response, options.now());
            if (options.now() + wait < scope.deadline) {
                await options.sleep(wait, scope.signal);
                continue;
            }
        }
        return {ok: false, code: dialect.statusCodes?.[response.status] ?? STATUS_CODES[response.status] ?? "failed", status: response.status, ...errorInfo(read.text, key, dialect)};
    }
}
