/**
 * DeepSeek 客户端（docs/specs/web/tools.md 输出 1、3、5、9 到 12）：请求发往本机的假接口（真 HTTP），重试的等待与时钟由测试
 * 注入，不按固定时长等。这里的密钥是假的，只发往本机。
 */

import {afterAll, afterEach, describe, expect, it} from "bun:test";

import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createDeepSeekProvider, MAX_QUERY_CODE_POINTS} from "./backend/providers/deepseek";
import {DETAIL_LIMIT, ERROR_BODY_LIMIT, redact, SUCCESS_BODY_LIMIT} from "./backend/providers/http";
import type {CallScope} from "./backend/providers/types";
import {fakeDeepSeek, sampleHit} from "./testing/fake-deepseek";

const KEY = "sk-web-test-not-real-0123456789abcdef";
const fake = fakeDeepSeek();
let clock = 0;
const waits: number[] = [];
const provider = createDeepSeekProvider(() => fake.baseUrl, {
    fetch,
    now: () => clock,
    sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
    },
});
const scope = (patch: Partial<CallScope> = {}): CallScope => ({signal: new AbortController().signal, deadline: clock + 20_000, ...patch});

afterEach(() => {
    fake.reset();
    waits.length = 0;
    clock = 0;
});
afterAll(() => fake.stop());

const search = (query: string, extra: Record<string, unknown> = {}, callScope = scope()) => provider.search({query, count: 5, ...extra}, KEY, callScope);

describe("搜索的请求（输出 1）", () => {
    it("带上密钥，请求体是查询与条数；站点与日期写进查询", async () => {
        expect((await search("黄金三章", {sites: ["qidian.com", "jjwxc.net"], after: "2026-01-01", before: "2026-11-01"})).ok).toBe(true);
        expect(fake.requests).toEqual([{path: "/v1/tools/search", authorization: `Bearer ${KEY}`, body: {query: "黄金三章 site:qidian.com OR site:jjwxc.net after:2026-01-01 before:2026-11-01", count: 5}}]);
    });

    it("拼好的查询按码点数，超过 128 不发请求；正好 128 照发", async () => {
        const astral = "𠀋".repeat(MAX_QUERY_CODE_POINTS - 15);
        const over = await search(astral, {sites: ["qidian.com"]});
        expect(over).toMatchObject({ok: false, code: "invalid-request"});
        expect(fake.requests).toHaveLength(0);
        const exact = await search("字".repeat(MAX_QUERY_CODE_POINTS));
        expect(exact.ok).toBe(true);
        expect(fake.requests).toHaveLength(1);
    });

    it("日期不是 YYYY-MM-DD、查询为空时不发请求", async () => {
        expect(await search("小说", {after: "2026/01/01"})).toMatchObject({ok: false, code: "invalid-request"});
        expect(await search("   ")).toMatchObject({ok: false, code: "invalid-request"});
        expect(fake.requests).toHaveLength(0);
    });
});

describe("搜索结果的整理（输出 3）", () => {
    it("非 http 网址丢掉；标题缺失用网址；摘要缺失用片段；分数取 rerank_score，低分照留", async () => {
        fake.script("/v1/tools/search", {json: {results: [
            {...sampleHit(0), url: "ftp://example.com/x"},
            {...sampleHit(1), title: "", summary: "", rerank_score: 0.1},
            {url: "https://example.com/bare"},
            "not an object",
        ]}});
        const result = await search("小说");
        expect(result).toEqual({ok: true, value: [
            {title: "https://example.com/article-2", url: "https://example.com/article-2", summary: "片段 2", date: "2026-08-02T16:00:00+00:00", site: "示例站", score: 0.1},
            {title: "https://example.com/bare", url: "https://example.com/bare", summary: ""},
        ]});
    });

    it("成功响应不是 JSON 或没有 results 数组：bad-response", async () => {
        fake.script("/v1/tools/search", {response: () => new Response("<html>oops</html>", {status: 200})}, {json: {results: "nope"}});
        expect(await search("小说")).toMatchObject({ok: false, code: "bad-response"});
        expect(await search("小说")).toMatchObject({ok: false, code: "bad-response"});
    });
});

describe("失败的归类与详情（输出 10、12）", () => {
    it.each([
        [400, "invalid-request"],
        [401, "auth"],
        [402, "quota"],
        [403, "rejected"],
        [404, "not-found"],
        [500, "failed"],
        [504, "failed"],
    ] as const)("HTTP %d 得 %s，只发一次，详情取 error.message", async (status, code) => {
        fake.script("/v1/tools/search", {status, json: {error: {message: `boom (request_id: req-${String(status)})`, type: "x"}}});
        expect(await search("小说")).toEqual({ok: false, code, status, detail: `boom (request_id: req-${String(status)})`, requestId: `req-${String(status)}`});
        expect(fake.requests).toHaveLength(1);
    });

    it("错误响应不是 error.message 的形状时不给详情，不转抄原始响应体", async () => {
        fake.script("/v1/tools/search", {status: 500, json: {message: "raw body with secret"}});
        expect(await search("小说")).toEqual({ok: false, code: "failed", status: 500});
    });

    it("详情先遮盖密钥再截短：整串、跨截断点的前半截与任何不短于 8 个字符的片段都不出现", async () => {
        const message = `${"甲".repeat(DETAIL_LIMIT - 10)}${KEY} and part ${KEY.slice(5, 17)}`;
        fake.script("/v1/tools/search", {status: 401, json: {error: {message}}});
        const result = await search("小说");
        if (result.ok || result.detail === undefined) throw new Error("expected a detail");
        expect(result.detail.length).toBeLessThanOrEqual(DETAIL_LIMIT);
        for (let length = 8; length <= KEY.length; length += 1) {
            for (let start = 0; start + length <= KEY.length; start += 1) expect(result.detail).not.toContain(KEY.slice(start, start + length));
        }
    });

    it("服务把密钥写在请求 id 的位置：请求 id 从遮盖过的文字里取，诊断里也没有密钥（输出 14）", async () => {
        fake.script("/v1/tools/search", {status: 401, json: {error: {message: `bad key (request_id: ${KEY})`}}});
        const result = await search("小说");
        expect(result).toEqual({ok: false, code: "auth", status: 401, detail: "bad key (request_id: ***)"});
    });

    it("长密钥按 8 字窗口遮盖：整串与不短于 8 字的片段换掉，短于 8 字的留着", () => {
        // 伪随机的 4,096 字密钥（线性同余），没有重复的 8 字窗口。
        let seed = 7;
        const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
        const long = Array.from({length: 4096}, () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return alphabet[seed % alphabet.length]!;
        }).join("");
        const short = long.slice(3000, 3007);
        expect(redact(`x ${long.slice(100, 120)} y ${long} z ${short}`, long)).toBe(`x *** y *** z ${short}`);
    });

    it("成功响应里带着密钥原文：bad-response，不交出结果；JSON 把其中一个字写成转义、或密钥出现在键名里也一样（输出 14）", async () => {
        fake.script("/v1/tools/search",
            {json: {results: [{...sampleHit(0), title: `echo Bearer ${KEY}`}]}},
            // 原文里没有整把密钥，解码后才有：`\u0073` 是 `s`。
            {response: () => new Response(`{"results":[{"url":"https://example.com/x","title":"a","summary":"\\u0073${KEY.slice(1)}"}]}`, {status: 200, headers: {"content-type": "application/json"}})},
            {response: () => new Response(`{"results":[{"url":"https://example.com/x","title":"a","\\u0073${KEY.slice(1)}":1}]}`, {status: 200, headers: {"content-type": "application/json"}})},
        );
        expect(await search("小说")).toEqual({ok: false, code: "bad-response", status: 200});
        expect(await search("小说")).toEqual({ok: false, code: "bad-response", status: 200});
        expect(await search("小说")).toEqual({ok: false, code: "bad-response", status: 200});
    });

    it("连不上服务：unreachable", async () => {
        // 先占一个端口再关掉，这个地址上就没有人听。
        const closed = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: () => new Response("")});
        const address = `http://127.0.0.1:${String(closed.port)}`;
        closed.stop(true);
        const offline = createDeepSeekProvider(() => address, {fetch, now: () => clock, sleep: async () => undefined});
        expect(await offline.search({query: "小说", count: 1}, KEY, scope())).toMatchObject({ok: false, code: "unreachable"});
    });

    it("不跟随重定向：307 只发一次，按失败交回（输出 10）", async () => {
        fake.script("/v1/tools/search", {status: 307, json: {}, headers: {location: "/v1/tools/search"}});
        expect(await search("小说")).toMatchObject({ok: false, code: "failed", status: 307});
        expect(fake.requests).toHaveLength(1);
    });
});

describe("重试（输出 10）", () => {
    it("429 等 Retry-After 给的秒数重试一次，第二次成功", async () => {
        fake.script("/v1/tools/search", {status: 429, json: {error: {message: "slow down"}}, headers: {"retry-after": "2"}});
        expect((await search("小说")).ok).toBe(true);
        expect(fake.requests).toHaveLength(2);
        expect(waits).toEqual([2000]);
    });

    it("没有 Retry-After 时等 1 秒；连着两次 429 得 rate-limited，不再发第三次", async () => {
        fake.script("/v1/tools/search", {status: 429, json: {error: {message: "a"}}}, {status: 429, json: {error: {message: "b"}}});
        expect(await search("小说")).toMatchObject({ok: false, code: "rate-limited", detail: "b"});
        expect(fake.requests).toHaveLength(2);
        expect(waits).toEqual([1000]);
    });

    it("Retry-After 写成 HTTP 日期：按日期减现在等；已过的不等；不认识的写法按 1 秒；等完超过截止就不重试", async () => {
        const at = (ms: number): string => new Date(ms).toUTCString();
        const cases: Array<[header: string, waits: number[], requests: number]> = [];
        clock = Date.parse("2026-11-19T12:00:00Z");
        cases.push([at(clock + 3000), [3000], 2], [at(clock - 60_000), [0], 2], ["1.5", [1000], 2], ["", [1000], 2], [at(clock + 60_000), [], 1]);
        for (const [header, expectedWaits, requests] of cases) {
            fake.reset();
            waits.length = 0;
            fake.script("/v1/tools/search", {status: 429, json: {error: {message: "slow"}}, headers: {"retry-after": header}});
            const result = await search("小说");
            expect({header, waits: [...waits], requests: fake.requests.length, ok: result.ok}).toEqual({header, waits: expectedWaits, requests, ok: requests === 2});
        }
    });

    it("等完会超过总截止就不重试", async () => {
        fake.script("/v1/tools/search", {status: 429, json: {error: {message: "a"}}, headers: {"retry-after": "30"}});
        expect(await search("小说")).toMatchObject({ok: false, code: "rate-limited"});
        expect(fake.requests).toHaveLength(1);
        expect(waits).toEqual([]);
    });

    it("检测关掉重试时 429 也只发一次（输出 19）", async () => {
        fake.script("/v1/tools/search", {status: 429, json: {error: {message: "a"}}});
        expect(await search("小说", {}, scope({retry: false}))).toMatchObject({ok: false, code: "rate-limited"});
        expect(fake.requests).toHaveLength(1);
    });
});

describe("截止与中止（输出 9）", () => {
    it("开始前已中止：不发请求，得 timeout", async () => {
        const controller = new AbortController();
        controller.abort();
        expect(await search("小说", {}, scope({signal: controller.signal}))).toMatchObject({ok: false, code: "timeout"});
        expect(fake.requests).toHaveLength(0);
    });

    it("请求途中中止：得 timeout，不再发第二次", async () => {
        const controller = new AbortController();
        fake.script("/v1/tools/search", {hang: true});
        const pending = search("小说", {}, scope({signal: controller.signal}));
        await waitUntil("the request reached the endpoint", () => fake.requests.length > 0 || undefined);
        controller.abort();
        expect(await pending).toMatchObject({ok: false, code: "timeout"});
        expect(fake.requests).toHaveLength(1);
    });
});

describe("读取上限（输出 11）", () => {
    const stream = (bytes: number, status = 200) => () => new Response(new ReadableStream({
        start(controller) {
            const chunk = new Uint8Array(64 * 1024).fill(0x61);
            for (let sent = 0; sent < bytes; sent += chunk.byteLength) controller.enqueue(chunk);
            controller.close();
        },
    }), {status});

    it("不带长度的成功响应越过 4 MiB：too-large", async () => {
        fake.script("/v1/tools/search", {response: stream(SUCCESS_BODY_LIMIT + 128 * 1024)});
        expect(await search("小说")).toMatchObject({ok: false, code: "too-large"});
    });

    it("错误响应越过 16 KiB：too-large，不重试", async () => {
        fake.script("/v1/tools/search", {response: stream(ERROR_BODY_LIMIT * 8, 429)});
        expect(await search("小说")).toMatchObject({ok: false, code: "too-large"});
        expect(fake.requests).toHaveLength(1);
    });
});

describe("读取（输出 5）", () => {
    const read = (url: string) => provider.fetch(url, KEY, scope());

    it("请求体是网址；正文取 content，标题取 title", async () => {
        fake.script("/v1/tools/fetch", {json: {title: "月票榜", content: "- 1\n\n## 神宠供应商"}});
        expect(await read("https://www.qidian.com/rank/yuepiao/")).toEqual({ok: true, value: {url: "https://www.qidian.com/rank/yuepiao/", title: "月票榜", markdown: "- 1\n\n## 神宠供应商"}});
        expect(fake.requests).toEqual([{path: "/v1/tools/fetch", authorization: `Bearer ${KEY}`, body: {url: "https://www.qidian.com/rank/yuepiao/"}}]);
    });

    it("标题缺失用网址；正文为空得 not-found；正文不是字符串得 bad-response", async () => {
        fake.script("/v1/tools/fetch", {json: {title: "", content: "正文"}}, {json: {title: "x", content: "  \n"}}, {json: {title: "x", content: 42}});
        expect(await read("https://example.com/a")).toEqual({ok: true, value: {url: "https://example.com/a", title: "https://example.com/a", markdown: "正文"}});
        expect(await read("https://example.com/b")).toMatchObject({ok: false, code: "not-found"});
        expect(await read("https://example.com/c")).toMatchObject({ok: false, code: "bad-response"});
    });
});
