/**
 * 接口层的核心（t10 计划 3.2）：发请求、把回答变成结果、按失败码做全站统一的处理。具体接口（`api.identity.login` 这类）建在它上面，
 * 各自声明路径、方法与“自己处理哪些码”；页面只拿 `Result`，不碰 `Response`。
 *
 * 不在浏览器里跑 TypeBox 的校验：成功的回答按调用方给的类型当作那个形状（同源、自家服务，契约由合同测试与真实冒烟兜底）；
 * 失败的回答只用一个手写的守卫认出 `{"error":{"code":…}}`（`site.accounts` 输出 22），认不出就是 `malformed`。
 */

/**
 * 一次调用的失败。`code` 是服务端给的稳定码；`network` 是 `fetch` 失败（没拿到回答）；`malformed` 是回答不是约定的形状。
 * `handled` 是统一处理接管了这次失败（跳转、清空当前账号）：页面不再显示它。没有这个标记的失败，哪怕码是统一处理认的那几个，
 * 也由页面自己显示（接口在 `handles` 里声明了它，或统一处理在当前页上不管它）。
 */
export type Failure =
    | {
        readonly kind: "code";
        readonly status: number;
        readonly code: string;
        readonly fields?: readonly string[];
        readonly retryAfterSeconds?: number;
        readonly handled?: true;
    }
    | {readonly kind: "network"}
    | {readonly kind: "malformed"; readonly status: number};

export type Result<T> = {readonly ok: true; readonly value: T} | {readonly ok: false; readonly failure: Failure};

/** 服务端要求等待、却没给出能读懂的 `Retry-After` 时按这么多秒算（计划 3.2）。合同说一定给，没给属于服务端缺陷。 */
export const RETRY_AFTER_FALLBACK_SECONDS = 30;

/**
 * 全站统一处理的三个码，由应用根注入（frontend.md“上报做成回调”）。回调只管跳转与当前账号，这次调用照常返回失败；
 * 回调回 `true` 表示接管了（失败带上 `handled`，页面不再显示），回 `false` 表示当前页上不管它，交给页面当普通失败。
 */
export interface FailureHandlers {
    /** 会话没了（`site.accounts` 输出 6）：清空当前账号，带着当前地址去登录。 */
    readonly onUnauthenticated: () => boolean;
    /** 同意门槛（`site.accounts` 输出 10）：去同意页，补交后回来。 */
    readonly onConsentRequired: () => boolean;
    /** 管理接口拒绝（`site.admin` 输出 1）：角色可能刚被改，重取身份再分派。 */
    readonly onForbidden: () => boolean;
}

/** 统一处理认的码。只认 `code`，不认 HTTP 状态：`invalid_credentials` 与 `unauthenticated` 同为 401，只有后者是会话没了。 */
const HANDLED_CODES = {
    unauthenticated: "onUnauthenticated",
    consent_required: "onConsentRequired",
    forbidden: "onForbidden",
} as const satisfies Record<string, keyof FailureHandlers>;

export type HandledCode = keyof typeof HANDLED_CODES;

/** 统一处理认的码。用 `Object.hasOwn`：码是服务端给的任意字符串，`constructor` 这类会从原型上取到东西。 */
function isHandledCode(code: string): code is HandledCode {
    return Object.hasOwn(HANDLED_CODES, code);
}

export interface ApiRequest {
    readonly method: "GET" | "POST" | "PATCH" | "DELETE";
    /** 站内的绝对路径（含模块前缀与查询串），由合同包的前缀与路径常量拼成。 */
    readonly path: string;
    /** 有请求体时按 JSON 发；不给就不带请求体。 */
    readonly body?: unknown;
    /**
     * 这个接口自己处理、统一处理要跳过的码。取身份的两个接口自己处理 `unauthenticated`，免得在路由守卫里再发起一次跳转。
     * 注册回的 `consent_required` 是“没勾同意”（`site.accounts` 输出 3），不是同意门槛：注册接口声明它；漏了也不出事，
     * 统一处理在访客页上不管这个码（`site.ts`）。
     */
    readonly handles?: readonly HandledCode[];
}

export interface ApiCoreOptions {
    /** 产品里传 `globalThis.fetch.bind(globalThis)`；测试传一个按请求返回 `Response` 的函数。 */
    readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
    /** 解析 HTTP 日期写法的 `Retry-After` 时用的当前时刻（毫秒）。 */
    readonly now: () => number;
    readonly handlers: FailureHandlers;
}

export interface ApiCore {
    request<T>(request: ApiRequest): Promise<Result<T>>;
}

/**
 * `Retry-After` 的秒数（RFC 9110 的 10.2.3）：整数秒，或 HTTP 日期（离现在还有几秒，向上取整，已过去的算 0）。
 * 都读不懂或没给时回 `undefined`，由调用方决定退路。
 *
 * 日期只认 IMF-fixdate（`Sun, 06 Nov 1994 08:49:37 GMT`，`Date.prototype.toUTCString` 的写法）：`Date.parse` 什么都肯解，
 * `-5` 会被当成公元前的年份、算出 0 秒。RFC 里另两种过时的日期写法按读不懂处理，走退路的秒数。
 */
const IMF_FIXDATE = /^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/u;

export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
    if (header === null) return undefined;
    const value = header.trim();
    if (/^\d+$/u.test(value)) return Number(value);
    if (!IMF_FIXDATE.test(value)) return undefined;
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    return Math.max(0, Math.ceil((date - nowMs) / 1000));
}

/** 失败的回答体的形状（`site.accounts` 输出 22）：`code` 是字符串；`fields` 若在，是字符串数组。别的键不看。 */
function errorOf(body: unknown): {readonly code: string; readonly fields?: readonly string[]} | undefined {
    if (typeof body !== "object" || body === null) return undefined;
    const error = (body as {error?: unknown}).error;
    if (typeof error !== "object" || error === null) return undefined;
    const {code, fields} = error as {code?: unknown; fields?: unknown};
    if (typeof code !== "string" || code === "") return undefined;
    if (fields === undefined) return {code};
    if (!Array.isArray(fields) || !fields.every((field) => typeof field === "string")) return undefined;
    return {code, fields};
}

async function jsonOf(response: Response): Promise<{readonly ok: true; readonly body: unknown} | {readonly ok: false}> {
    try {
        return {ok: true, body: await response.json()};
    } catch {
        // 回答体不是 JSON：这正是 `malformed` 的判据，由调用方变成失败结果，不是要另外上报的错误。
        return {ok: false};
    }
}

export function createApiCore(options: ApiCoreOptions): ApiCore {
    const failed = (failure: Failure): Result<never> => ({ok: false, failure});

    async function request<T>(request: ApiRequest): Promise<Result<T>> {
        const init: RequestInit = {method: request.method};
        if (request.body !== undefined) {
            init.headers = {"Content-Type": "application/json"};
            init.body = JSON.stringify(request.body);
        }
        let response: Response;
        try {
            response = await options.fetch(request.path, init);
        } catch (error) {
            console.warn(`请求 ${request.method} ${request.path} 没有拿到回答`, error);
            return failed({kind: "network"});
        }

        const parsed = await jsonOf(response);
        if (response.ok) return parsed.ok ? {ok: true, value: parsed.body as T} : failed({kind: "malformed", status: response.status});

        const error = parsed.ok ? errorOf(parsed.body) : undefined;
        if (error === undefined) return failed({kind: "malformed", status: response.status});

        let retryAfterSeconds: number | undefined;
        if (error.code === "rate_limited") {
            retryAfterSeconds = parseRetryAfter(response.headers.get("Retry-After"), options.now());
            if (retryAfterSeconds === undefined) {
                console.warn(`${request.method} ${request.path} 回了 rate_limited，Retry-After 缺失或读不懂（${String(response.headers.get("Retry-After"))}），按 ${RETRY_AFTER_FALLBACK_SECONDS} 秒处理`);
                retryAfterSeconds = RETRY_AFTER_FALLBACK_SECONDS;
            }
        }

        const handled = isHandledCode(error.code) && !(request.handles ?? []).includes(error.code) && options.handlers[HANDLED_CODES[error.code]]();

        return failed({
            kind: "code",
            status: response.status,
            code: error.code,
            ...(error.fields === undefined ? {} : {fields: error.fields}),
            ...(retryAfterSeconds === undefined ? {} : {retryAfterSeconds}),
            ...(handled ? {handled: true as const} : {}),
        });
    }

    return {request};
}
