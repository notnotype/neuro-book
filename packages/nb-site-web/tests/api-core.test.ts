/**
 * 接口层的核心（t10 计划 3.2）：回答变成结果、按码做统一处理、`Retry-After`。`fetch` 由测试注入，回真的 `Response`；
 * 统一处理的回调记下被调用的码，时刻由测试给定。
 */

import {describe, expect, it} from "bun:test";

import {createApiCore, parseRetryAfter, RETRY_AFTER_FALLBACK_SECONDS} from "../src/api/core";
import type {ApiCore, ApiRequest, Failure, FailureHandlers, Result} from "../src/api/core";

const NOW = Date.parse("2026-11-26T10:00:00Z");

interface Harness {
    readonly api: ApiCore;
    /** 统一处理被调用的顺序。 */
    readonly handled: string[];
    /** 发出去的请求。 */
    readonly sent: {readonly path: string; readonly init: RequestInit}[];
}

function harness(respond: (path: string, init: RequestInit) => Response | Promise<Response>): Harness {
    const handled: string[] = [];
    const sent: {path: string; init: RequestInit}[] = [];
    const handlers: FailureHandlers = {
        onUnauthenticated: () => handled.push("unauthenticated"),
        onConsentRequired: () => handled.push("consent_required"),
        onForbidden: () => handled.push("forbidden"),
    };
    const api = createApiCore({
        fetch: async (path, init) => {
            sent.push({path, init});
            return respond(path, init);
        },
        now: () => NOW,
        handlers,
    });
    return {api, handled, sent};
}

function errorResponse(status: number, error: Record<string, unknown>, headers: Record<string, string> = {}): Response {
    return Response.json({error}, {status, headers});
}

const GET: ApiRequest = {method: "GET", path: "/api/identity/v1/me"};

function failureOf(result: Result<unknown>): Failure {
    if (result.ok) throw new Error(`期望失败，实际成功：${JSON.stringify(result.value)}`);
    return result.failure;
}

describe("回答变成结果", () => {
    it("2xx 的 JSON 是成功的值；有请求体时按 JSON 发", async () => {
        const {api, sent} = harness(() => Response.json({id: "u1"}));
        expect(await api.request({method: "POST", path: "/api/identity/v1/login", body: {username: "a"}})).toEqual({ok: true, value: {id: "u1"}});
        expect(sent[0]!.init.method).toBe("POST");
        expect(sent[0]!.init.body).toBe('{"username":"a"}');
        expect(new Headers(sent[0]!.init.headers).get("Content-Type")).toBe("application/json");
    });

    it("没有请求体的请求不带请求体与 Content-Type", async () => {
        const {api, sent} = harness(() => Response.json({}));
        await api.request(GET);
        expect(sent[0]!.init.body).toBeUndefined();
        expect(new Headers(sent[0]!.init.headers).has("Content-Type")).toBe(false);
    });

    it("失败的回答体读出码与字段", async () => {
        const {api} = harness(() => errorResponse(400, {code: "invalid_input", fields: ["username", "password"]}));
        expect(failureOf(await api.request(GET))).toEqual({kind: "code", status: 400, code: "invalid_input", fields: ["username", "password"]});
    });

    it("没给字段的失败不带 fields；码以外的键不看", async () => {
        const {api} = harness(() => errorResponse(409, {code: "username_taken", message: "随便什么"}));
        expect(failureOf(await api.request(GET))).toEqual({kind: "code", status: 409, code: "username_taken"});
    });

    it("回答不是约定的形状时是 malformed，带着状态码", async () => {
        const bodies: [number, string | null][] = [
            [200, "<html>不是 JSON</html>"],
            [500, "<html>网关错误</html>"],
            [502, null],
            [400, JSON.stringify({message: "没有 error"})],
            [400, JSON.stringify({error: "字符串"})],
            [400, JSON.stringify({error: {code: 7}})],
            [400, JSON.stringify({error: {code: ""}})],
            [400, JSON.stringify({error: {code: "invalid_input", fields: "username"}})],
            [400, JSON.stringify({error: {code: "invalid_input", fields: [1]}})],
            [400, JSON.stringify(null)],
        ];
        for (const [status, body] of bodies) {
            const {api} = harness(() => new Response(body, {status}));
            expect({body, failure: failureOf(await api.request(GET))}).toEqual({body, failure: {kind: "malformed", status}});
        }
    });

    it("fetch 失败（没拿到回答）是 network", async () => {
        const {api, handled} = harness(() => Promise.reject(new TypeError("Failed to fetch")));
        expect(failureOf(await api.request(GET))).toEqual({kind: "network"});
        expect(handled).toEqual([]);
    });
});

describe("Retry-After", () => {
    it("整数秒原样读出", () => {
        expect(parseRetryAfter("120", NOW)).toBe(120);
        expect(parseRetryAfter(" 0 ", NOW)).toBe(0);
    });

    it("HTTP 日期按现在算剩几秒，向上取整，已过去的算 0", () => {
        expect(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW)).toBe(90);
        expect(parseRetryAfter(new Date(NOW + 90_000).toUTCString(), NOW + 500)).toBe(90);
        expect(parseRetryAfter(new Date(NOW - 5_000).toUTCString(), NOW)).toBe(0);
    });

    it("没给或读不懂时回 undefined", () => {
        for (const header of [null, "", "soon", "-5", "1.5", "2026-11-26", "Thu, 26 Nov 2026 10:00:00 +0000"]) expect({header, seconds: parseRetryAfter(header, NOW)}).toEqual({header, seconds: undefined});
    });

    it("rate_limited 的失败带着等待秒数，秒数与日期两种写法都认", async () => {
        const seconds = harness(() => errorResponse(429, {code: "rate_limited"}, {"Retry-After": "42"}));
        expect(failureOf(await seconds.api.request(GET))).toEqual({kind: "code", status: 429, code: "rate_limited", retryAfterSeconds: 42});
        const date = harness(() => errorResponse(429, {code: "rate_limited"}, {"Retry-After": new Date(NOW + 61_000).toUTCString()}));
        expect(failureOf(await date.api.request(GET))).toEqual({kind: "code", status: 429, code: "rate_limited", retryAfterSeconds: 61});
    });

    it("rate_limited 没带或带了读不懂的 Retry-After 时按退路的秒数", async () => {
        const headerSets: Record<string, string>[] = [{}, {"Retry-After": "soon"}];
        for (const headers of headerSets) {
            const {api} = harness(() => errorResponse(429, {code: "rate_limited"}, headers));
            expect(failureOf(await api.request(GET))).toEqual({kind: "code", status: 429, code: "rate_limited", retryAfterSeconds: RETRY_AFTER_FALLBACK_SECONDS});
        }
    });

    it("别的码不读 Retry-After", async () => {
        const {api} = harness(() => errorResponse(503, {code: "unavailable"}, {"Retry-After": "10"}));
        expect(failureOf(await api.request(GET))).toEqual({kind: "code", status: 503, code: "unavailable"});
    });
});

describe("按码统一处理", () => {
    it("unauthenticated、consent_required、forbidden 各调一次对应的处理，这次调用照常回失败", async () => {
        const cases: [number, string][] = [[401, "unauthenticated"], [403, "consent_required"], [403, "forbidden"]];
        for (const [status, code] of cases) {
            const {api, handled} = harness(() => errorResponse(status, {code}));
            expect(failureOf(await api.request(GET))).toEqual({kind: "code", status, code});
            expect({code, handled}).toEqual({code, handled: [code]});
        }
    });

    it("只认码不认状态：同为 401 的 invalid_credentials 不当作会话没了", async () => {
        const {api, handled} = harness(() => errorResponse(401, {code: "invalid_credentials"}));
        expect(failureOf(await api.request(GET))).toEqual({kind: "code", status: 401, code: "invalid_credentials"});
        expect(handled).toEqual([]);
    });

    it("接口声明自己处理的码，统一处理跳过；没声明的照常处理", async () => {
        const {api, handled} = harness(() => errorResponse(400, {code: "consent_required"}));
        await api.request({method: "POST", path: "/api/identity/v1/register", handles: ["consent_required"]});
        expect(handled).toEqual([]);
        await api.request({method: "POST", path: "/api/identity/v1/register", handles: ["unauthenticated"]});
        expect(handled).toEqual(["consent_required"]);
    });

    it("原型上的键名当作普通的码，不触发处理", async () => {
        for (const code of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
            const {api, handled} = harness(() => errorResponse(400, {code}));
            expect(failureOf(await api.request(GET))).toEqual({kind: "code", status: 400, code});
            expect({code, handled}).toEqual({code, handled: []});
        }
    });
});
