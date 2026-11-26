/**
 * 模型网关：本机的假上游扮演中转。要等真实时长（长请求）与要另起进程（经不经代理）的用例在 `gateway.live.test.ts`。
 */

import {afterEach, describe, expect, test} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {EvalEnvError} from "../env";
import {startGateway} from "./gateway";
import type {Gateway, GatewayRoute} from "./gateway";
import {MODELS, assertNoProxyEnv, routesFor} from "./models";

const cleanups: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface Upstream {
    readonly url: string;
    readonly requests: Array<{readonly headers: Record<string, string>; readonly body: Record<string, unknown>}>;
}

/** 起一个假上游：记下收到的请求，回 `respond` 给的响应。 */
function upstream(respond: (body: Record<string, unknown>) => Response | Promise<Response>): Upstream {
    const requests: Upstream["requests"] = [];
    const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: async (request) => {
        const body = await request.json() as Record<string, unknown>;
        requests.push({headers: Object.fromEntries(request.headers), body});
        return respond(body);
    }});
    cleanups.push(() => server.stop(true));
    return {url: `http://127.0.0.1:${server.port}/v1`, requests};
}

function gateway(routes: GatewayRoute[], options: {upstreamTimeoutMs?: number; budget?: {requests: number; inputTokens: number}} = {}): Gateway {
    const started = startGateway({routes, ...options});
    cleanups.push(() => started.stop());
    return started;
}

const route = (url: string, extra: Partial<GatewayRoute> = {}): GatewayRoute => ({model: "m", upstreamModel: "m-upstream", baseUrl: url, apiKey: "real-key", proxy: null, ...extra});

const REQUEST = {model: "m", reasoning_effort: "medium", tools: [{type: "function"}, {type: "function"}, {type: "function"}], messages: [{role: "user", content: "hi"}, {role: "tool", content: [{type: "text", text: "x"}, {type: "image_url", image_url: {url: "data:image/png;base64,AA"}}]}]};

async function call(gw: Gateway, key: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(`${gw.url}/chat/completions`, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${key}`, ...headers}, body: JSON.stringify(body)});
}

describe("模型网关", () => {
    test("非流式：换上真实密钥与上游模型名转发，原样交回；记下实际发出的参数与用量（总输入含缓存读）", async () => {
        const up = upstream(() => Response.json({id: "r1", choices: [{message: {content: "ok"}}], usage: {prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: {cached_tokens: 100}}}));
        const gw = gateway([route(up.url)]);
        const reg = gw.register("m");
        const response = await call(gw, reg.key, REQUEST);
        expect(response.status).toBe(200);
        expect(((await response.json()) as {id: string}).id).toBe("r1");
        expect(up.requests[0]?.headers.authorization).toBe("Bearer real-key");
        expect(up.requests[0]?.headers["accept-encoding"]).toBe("identity");
        expect(up.requests[0]?.body.model).toBe("m-upstream");
        expect(reg.calls().map(({model, reasoningEffort, maxTokens, tools, images, messages, stream, upstream: status, usage}) => ({model, reasoningEffort, maxTokens, tools, images, messages, stream, status, usage}))).toEqual([{model: "m", reasoningEffort: "medium", maxTokens: null, tools: 3, images: 1, messages: 2, stream: false, status: 200, usage: {input: 120, cacheRead: 100, output: 30}}]);
        expect(gw.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/u);
    });

    test("流式：逐块原样转发，用量取最后一个带 usage 的块；没有用量时记为 null 而不是 0", async () => {
        const sse = (chunks: string[]) => new Response(chunks.map((chunk) => `data: ${chunk}\n\n`).join("") + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
        const up = upstream((body) => sse(body.withUsage === true ? ["{\"choices\":[{\"delta\":{\"content\":\"o\"}}]}", "{\"choices\":[],\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":2}}"] : ["{\"choices\":[{\"delta\":{\"content\":\"o\"}}]}"]));
        const gw = gateway([route(up.url)]);
        const reg = gw.register("m");
        const text = await (await call(gw, reg.key, {...REQUEST, stream: true, withUsage: true})).text();
        expect(text).toContain("\"prompt_tokens\":9");
        expect(text.endsWith("data: [DONE]\n\n")).toBe(true);
        await (await call(gw, reg.key, {...REQUEST, stream: true})).text();
        expect(reg.calls().map((c) => [c.stream, c.usage])).toEqual([[true, {input: 9, cacheRead: null, output: 2}], [true, null]]);
    });

    test("上游回 5xx：原样交回执行者，记下状态码", async () => {
        const up = upstream(() => Response.json({error: {message: "bad gateway"}}, {status: 502}));
        const gw = gateway([route(up.url)]);
        const reg = gw.register("m");
        expect((await call(gw, reg.key, REQUEST)).status).toBe(502);
        expect(reg.calls().map((c) => [c.upstream, c.usage])).toEqual([[502, null]]);
    });

    test("连不上、中途断开、超时：回 502，分别记成 connect-error、reset、timeout", async () => {
        const closed = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("x")});
        const closedUrl = `http://127.0.0.1:${closed.port}/v1`;
        await closed.stop(true);
        const resetter = Bun.listen({hostname: "127.0.0.1", port: 0, socket: {data: (socket) => socket.terminate(), open: () => undefined}});
        cleanups.push(() => resetter.stop(true));
        let release: () => void = () => undefined;
        const hanging = upstream(() => new Promise<Response>((resolve) => {
            release = () => resolve(new Response("late"));
        }));
        cleanups.push(() => release());
        const gw = gateway([route(closedUrl, {model: "closed"}), route(`http://127.0.0.1:${resetter.port}/v1`, {model: "reset"}), route(hanging.url, {model: "hang"})], {upstreamTimeoutMs: 100});
        const statuses = [];
        const recorded = [];
        for (const model of ["closed", "reset", "hang"]) {
            const reg = gw.register(model);
            statuses.push((await call(gw, reg.key, {...REQUEST, model})).status);
            recorded.push(...reg.calls().map((c) => [c.model, c.upstream]));
        }
        expect(statuses).toEqual([502, 502, 502]);
        expect(recorded).toEqual([["closed", "connect-error"], ["reset", "reset"], ["hang", "timeout"]]);
    });

    test("上游不顾要求回了 gzip：交给执行者的是解压后的正文，不带编码头，执行者读得出 JSON", async () => {
        const up = upstream(() => new Response(Bun.gzipSync(JSON.stringify({id: "gz", usage: {prompt_tokens: 1, completion_tokens: 1}})), {headers: {"content-type": "application/json", "content-encoding": "gzip"}}));
        const gw = gateway([route(up.url)]);
        const reg = gw.register("m");
        const response = await call(gw, reg.key, REQUEST, {"accept-encoding": "gzip, deflate"});
        expect(response.headers.get("content-encoding")).toBeNull();
        expect(((await response.json()) as {id: string}).id).toBe("gz");
    });

    test("没登记、已注销的假密钥回 401；假密钥绑一个模型，请求别的（哪怕网关认识）回 400 并记次数；都不转发", async () => {
        const up = upstream(() => Response.json({}));
        const gw = gateway([route(up.url), route(up.url, {model: "other"})]);
        expect((await call(gw, "made-up", REQUEST)).status).toBe(401);
        const reg = gw.register("m");
        expect((await call(gw, reg.key, {...REQUEST, model: "other"})).status).toBe(400);
        expect(reg.refused()).toBe(1);
        await reg.release();
        expect((await call(gw, reg.key, REQUEST)).status).toBe(401);
        expect(up.requests.length).toBe(0);
        expect(() => gw.register("unknown")).toThrow();
    });

    test("请求体不是对象、消息里夹着不是对象的项：回 400 或照常转发，不回带源码路径的 500", async () => {
        const up = upstream(() => Response.json({usage: {prompt_tokens: 1, completion_tokens: 1}}));
        const gw = gateway([route(up.url)]);
        const reg = gw.register("m");
        for (const body of [null, [], "text"]) {
            const response = await call(gw, reg.key, body);
            expect([response.status, ((await response.json()) as {error: {type: string}}).error.type]).toEqual([400, "invalid_request_error"]);
        }
        expect((await call(gw, reg.key, {model: "m", messages: [null, {role: "user", content: [null, {type: "image_url"}]}]})).status).toBe(200);
        expect(reg.calls().map((c) => [c.messages, c.images])).toEqual([[1, 1]]);
    });

    test("上游的错误正文里的真实密钥与 sk- 串换掉；上游的诊断头不交给执行者，内容类型与退避时间照留", async () => {
        const up = upstream(() => new Response(JSON.stringify({error: {message: "Incorrect API key provided: real-key; also sk-abcdefgh12345"}}), {status: 401, headers: {"content-type": "application/json", "retry-after": "3", "x-debug": "real-key"}}));
        const gw = gateway([route(up.url)]);
        const reg = gw.register("m");
        const response = await call(gw, reg.key, REQUEST);
        const text = await response.text();
        expect(response.status).toBe(401);
        expect(text).not.toContain("real-key");
        expect(text).not.toContain("sk-abcdefgh");
        expect([response.headers.get("x-debug"), response.headers.get("retry-after"), response.headers.get("content-type")]).toEqual([null, "3", "application/json"]);
    });

    test("注销时取消在途的上游请求，等它记成 cancelled 再交出记录；执行者自己断开的记成 client-abort", async () => {
        const pending: Array<() => void> = [];
        const up = upstream(() => new Promise<Response>((resolve) => pending.push(() => resolve(Response.json({})))));
        cleanups.push(() => pending.forEach((wake) => wake()));
        const gw = gateway([route(up.url)]);
        const reg = gw.register("m");
        const inFlight = call(gw, reg.key, REQUEST);
        await waitUntil("upstream got the request", () => up.requests.length === 1);
        await reg.release();
        expect(reg.calls().map((c) => c.upstream)).toEqual(["cancelled"]);
        expect((await inFlight).status).toBe(502);

        const other = gw.register("m");
        const controller = new AbortController();
        const aborted = fetch(`${gw.url}/chat/completions`, {method: "POST", headers: {"content-type": "application/json", authorization: `Bearer ${other.key}`}, body: JSON.stringify(REQUEST), signal: controller.signal}).catch(() => null);
        await waitUntil("upstream got the second request", () => up.requests.length === 2);
        controller.abort();
        await aborted;
        await waitUntil("client abort recorded", () => other.calls().length === 1);
        expect(other.calls().map((c) => c.upstream)).toEqual(["client-abort"]);
    });

    test("预算按“已记下的加在途的”算：一次请求还在途时，第二次就回 429", async () => {
        const pending: Array<() => void> = [];
        const up = upstream(() => new Promise<Response>((resolve) => pending.push(() => resolve(Response.json({usage: {prompt_tokens: 1, completion_tokens: 1}})))));
        const gw = gateway([route(up.url)], {budget: {requests: 1, inputTokens: 1_000}});
        const reg = gw.register("m");
        const first = call(gw, reg.key, REQUEST);
        await waitUntil("upstream got the request", () => up.requests.length === 1);
        expect((await call(gw, reg.key, REQUEST)).status).toBe(429);
        pending.forEach((wake) => wake());
        expect((await first).status).toBe(200);
        expect(up.requests.length).toBe(1);
    });

    test("单次运行的预算用完回 429 并记下，不再转发", async () => {
        const up = upstream(() => Response.json({usage: {prompt_tokens: 10, completion_tokens: 1}}));
        const gw = gateway([route(up.url)], {budget: {requests: 1, inputTokens: 1_000}});
        const reg = gw.register("m");
        expect((await call(gw, reg.key, REQUEST)).status).toBe(200);
        const exceeded = await call(gw, reg.key, REQUEST);
        expect([exceeded.status, ((await exceeded.json()) as {error: {type: string}}).error.type]).toEqual([429, "budget_exceeded"]);
        expect([reg.budgetExceeded(), up.requests.length]).toEqual([true, 1]);
    });
});

describe("模型路由", () => {
    const env = new Map([["JIJI_LUNA_BASE_URL", "https://luna.example/v1/"], ["JIJI_LUNA_API_KEY", "k1"], ["EXTREMELYCAT_BASE_URL", "https://cat.example/v1"], ["EXTREMELYCAT_API_KEY", "k2"]]);

    test("luna 直连，两个 Gemini 经给的代理；没给代理时报 model-proxy-missing", () => {
        const routes = routesFor(MODELS, env, "test.env", "http://127.0.0.1:7890");
        expect(routes.map((r) => [r.model, r.baseUrl, r.proxy])).toEqual([["gpt-6-luna", "https://luna.example/v1", null], ["gemini-4-hydrogen", "https://cat.example/v1", "http://127.0.0.1:7890"], ["gemini-4-neon", "https://cat.example/v1", "http://127.0.0.1:7890"]]);
        expect(() => routesFor(MODELS, env, "test.env", null)).toThrow(EvalEnvError);
        expect(routesFor(MODELS.slice(0, 1), env, "test.env", null).length).toBe(1);
    });

    test("进程环境里有任何大小写的代理变量都拒绝启动", () => {
        expect(() => assertNoProxyEnv({PATH: "/bin"})).not.toThrow();
        for (const name of ["http_proxy", "HTTPS_PROXY", "all_proxy"]) {
            let caught: unknown;
            try {
                assertNoProxyEnv({[name]: "http://127.0.0.1:1"});
            } catch (error) {
                caught = error;
            }
            expect((caught as EvalEnvError).code).toBe("proxy-env-present");
        }
    });
});
