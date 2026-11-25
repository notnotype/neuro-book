/**
 * Tavily 客户端（docs/specs/web/tools.md 输出 1、3、5、12）：请求发往本机的假接口（真 HTTP）。重试、读取上限、重定向与遮盖是
 * 两家共用的 `postJson`，在 `deepseek.test.ts` 里测；这里测 Tavily 自己的请求形状、字段映射与错误响应。这里的密钥是假的，只发往
 * 本机。
 */

import {afterAll, afterEach, describe, expect, it} from "bun:test";

import {createTavilyProvider, MAX_QUERY_CODE_POINTS} from "./backend/providers/tavily";
import type {CallScope} from "./backend/providers/types";
import {fakeTavily, sampleTavilyHit, TAVILY_UNAUTHORIZED} from "./testing/fake-tavily";

const KEY = "tvly-web-test-not-real-0123456789abcdef";
const fake = fakeTavily();
let clock = 0;
const provider = createTavilyProvider(() => `${fake.baseUrl}/`, {
    fetch,
    now: () => clock,
    sleep: async (ms) => {
        clock += ms;
    },
});
const scope = (): CallScope => ({signal: new AbortController().signal, deadline: clock + 20_000});

afterEach(() => {
    fake.reset();
    clock = 0;
});
afterAll(() => fake.stop());

const search = (query: string, extra: Record<string, unknown> = {}) => provider.search({query, count: 5, ...extra}, KEY, scope());

describe("搜索的请求（输出 1）", () => {
    it("带上密钥；条数给 max_results，站点与日期给原生参数，查询去掉首尾空白、不拼操作符", async () => {
        expect((await search("  黄金三章 ", {sites: ["qidian.com", " ", "jjwxc.net"], after: "2026-01-01", before: "2026-11-01"})).ok).toBe(true);
        expect(fake.requests).toEqual([{path: "/search", authorization: `Bearer ${KEY}`, body: {
            query: "黄金三章", max_results: 5, search_depth: "basic", include_published_date: true, include_domains: ["qidian.com", "jjwxc.net"], start_date: "2026-01-01", end_date: "2026-11-01",
        }}]);
        expect((await search("不带过滤")).ok).toBe(true);
        expect(fake.requests.at(-1)?.body).toEqual({query: "不带过滤", max_results: 5, search_depth: "basic", include_published_date: true});
    });

    it("查询按码点数，超过 1,500 不发请求；正好 1,500 照发；日期写法不对、查询为空也不发", async () => {
        expect(provider.validateSearch({query: "𠀋".repeat(MAX_QUERY_CODE_POINTS + 1), count: 5})).toBe(`the query is longer than ${String(MAX_QUERY_CODE_POINTS)} characters`);
        expect(await search("𠀋".repeat(MAX_QUERY_CODE_POINTS + 1))).toMatchObject({ok: false, code: "invalid-request"});
        expect(await search("小说", {before: "20261101"})).toMatchObject({ok: false, code: "invalid-request", detail: "before must be a date written YYYY-MM-DD"});
        expect(await search("  ")).toMatchObject({ok: false, code: "invalid-request", detail: "query is empty"});
        expect(fake.requests).toHaveLength(0);
        expect((await search("𠀋".repeat(MAX_QUERY_CODE_POINTS))).ok).toBe(true);
        expect(fake.requests).toHaveLength(1);
    });
});

describe("搜索结果的整理（输出 3）", () => {
    it("摘要取 content，日期取 published_date 原样，分数取 score；非 http 网址丢掉，标题缺失用网址；没有站点", async () => {
        fake.script("/search", {json: {results: [
            {...sampleTavilyHit(0), url: "javascript:alert(1)"},
            {...sampleTavilyHit(1), title: "", score: 0.01},
            {url: "https://example.org/bare", published_date: null, score: "high"},
            null,
        ]}});
        expect(await search("小说")).toEqual({ok: true, value: [
            {title: "https://example.org/post-2", url: "https://example.org/post-2", summary: "Content 2: how to open a novel.", date: "Sun, 02 Aug 2026 16:00:00 GMT", score: 0.01},
            {title: "https://example.org/bare", url: "https://example.org/bare", summary: ""},
        ]});
    });

    it("成功响应没有 results 数组：bad-response", async () => {
        fake.script("/search", {json: {answer: "只有一段话"}});
        expect(await search("小说")).toMatchObject({ok: false, code: "bad-response"});
    });
});

describe("错误响应（输出 12 与“失败与恢复”）", () => {
    it("说明取 detail.error（或 detail 字符串）；401 是 auth，422 是 invalid-request，432、433 是 quota，500 是 failed", async () => {
        fake.script("/search",
            {status: 401, json: TAVILY_UNAUTHORIZED},
            {status: 422, json: {detail: "max_results must be at most 20"}},
            {status: 432, json: {detail: {error: "plan limit"}}},
            {status: 433, json: {detail: {error: "pay-as-you-go limit"}}},
            {status: 500, json: {detail: [{msg: "数组不当说明"}]}},
        );
        expect(await search("a")).toEqual({ok: false, code: "auth", status: 401, detail: "Unauthorized: missing or invalid API key."});
        expect(await search("a")).toEqual({ok: false, code: "invalid-request", status: 422, detail: "max_results must be at most 20"});
        expect(await search("a")).toEqual({ok: false, code: "quota", status: 432, detail: "plan limit"});
        expect(await search("a")).toEqual({ok: false, code: "quota", status: 433, detail: "pay-as-you-go limit"});
        expect(await search("a")).toEqual({ok: false, code: "failed", status: 500});
    });

    it("说明里的密钥遮盖掉", async () => {
        fake.script("/search", {status: 401, json: {detail: {error: `invalid key ${KEY}`}}});
        const result = await search("a");
        expect(result).toEqual({ok: false, code: "auth", status: 401, detail: "invalid key ***"});
    });
});

describe("读取（输出 5）", () => {
    it("请求体是网址数组与 markdown 格式；正文取 raw_content，标题取 title，缺失时用网址", async () => {
        expect(await provider.fetch("https://example.org/a", KEY, scope())).toEqual({ok: true, value: {url: "https://example.org/a", title: "Sample page", markdown: "# Sample\n\nFirst paragraph."}});
        expect(fake.requests).toEqual([{path: "/extract", authorization: `Bearer ${KEY}`, body: {urls: ["https://example.org/a"], format: "markdown", extract_depth: "basic"}}]);
        fake.script("/extract", {json: {results: [{url: "https://example.org/b", raw_content: "正文"}], failed_results: []}});
        expect(await provider.fetch("https://example.org/b", KEY, scope())).toEqual({ok: true, value: {url: "https://example.org/b", title: "https://example.org/b", markdown: "正文"}});
    });

    it("网址在 failed_results 里得 not-found，详情取它的 error、遮盖密钥的片段（整把密钥按输出 14 不交出）；正文为空得 not-found；形状不对得 bad-response", async () => {
        fake.script("/extract",
            {json: {results: [], failed_results: [{url: "https://example.org/x", error: `Failed to fetch url with ${KEY.slice(0, 14)}`}]}},
            {json: {results: [], failed_results: [{url: "https://example.org/x", error: `Failed to fetch url with ${KEY}`}]}},
            {json: {results: [], failed_results: []}},
            {json: {results: [{url: "https://example.org/x", title: "空", raw_content: "  \n"}], failed_results: []}},
            {json: {results: "nope"}},
            {json: {results: [{url: "https://example.org/x", raw_content: 42}]}},
        );
        expect(await provider.fetch("https://example.org/x", KEY, scope())).toEqual({ok: false, code: "not-found", detail: "Failed to fetch url with ***"});
        expect(await provider.fetch("https://example.org/x", KEY, scope())).toEqual({ok: false, code: "bad-response", status: 200});
        expect(await provider.fetch("https://example.org/x", KEY, scope())).toEqual({ok: false, code: "not-found", detail: "the page has no readable content"});
        expect(await provider.fetch("https://example.org/x", KEY, scope())).toEqual({ok: false, code: "not-found", detail: "the page has no readable content"});
        expect(await provider.fetch("https://example.org/x", KEY, scope())).toEqual({ok: false, code: "bad-response"});
        expect(await provider.fetch("https://example.org/x", KEY, scope())).toEqual({ok: false, code: "bad-response"});
    });
});
