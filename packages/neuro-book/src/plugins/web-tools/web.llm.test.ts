/**
 * 真实 DeepSeek 与 Tavily 接口（docs/specs/web/tools.md 验收 4、7）：直接用客户端调官方地址，核对两条接口的字段映射与几种错误的
 * 归类，也是假接口（`testing/fake-deepseek.ts`、`testing/fake-tavily.ts`）与真实接口对照的那一条。密钥只在内存里（`llmTestConfig`、
 * `llmTestKey` 从环境取），不写进任何文件。只在显式开启真实模型测试时运行；每次调用按次计费（Tavily 扣额度）。
 */

import {describe, expect, it} from "bun:test";

import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {llmTestConfig, llmTestKey} from "@notnotype/neuro-book-test-support/llm";

import {createDeepSeekProvider} from "./backend/providers/deepseek";
import {sleepOn} from "./backend/providers/http";
import {createTavilyProvider} from "./backend/providers/tavily";
import type {CallScope} from "./backend/providers/types";
import {DEFAULT_DEEPSEEK_BASE_URL, DEFAULT_TAVILY_BASE_URL} from "./shared/settings";

const config = llmTestConfig();
const provider = createDeepSeekProvider(() => DEFAULT_DEEPSEEK_BASE_URL, {fetch, now: Date.now, sleep: sleepOn(systemClock)});
const scope = (ms: number): CallScope => ({signal: AbortSignal.timeout(ms), deadline: Date.now() + ms});

describe.skipIf(config === null)("真实 DeepSeek 接口", () => {
    const key = config?.apiKey ?? "";

    it("搜索：结果都是 http 或 https 网址，带标题与摘要，分数是数", async () => {
        const result = await provider.search({query: "网文写作技巧 黄金三章", count: 3}, key, scope(30_000));
        if (!result.ok) throw new Error(`search failed: ${result.code} ${result.detail ?? ""}`);
        expect(result.value.length).toBeGreaterThan(0);
        for (const hit of result.value) {
            expect(hit.url).toMatch(/^https?:\/\//u);
            expect(hit.title.length).toBeGreaterThan(0);
            expect(hit.summary.length).toBeGreaterThan(0);
            expect(typeof hit.score).toBe("number");
            // 日期取 `date`、站点取 `site_name`：有的话是非空文字。
            for (const value of [hit.date, hit.site]) if (value !== undefined) expect(value.length).toBeGreaterThan(0);
        }
        expect(result.value.some((hit) => hit.date !== undefined || hit.site !== undefined)).toBe(true);
    }, 40_000);

    it("读取：交回标题与 Markdown 正文", async () => {
        const result = await provider.fetch("https://github.com/jina-ai/reader", key, scope(60_000));
        if (!result.ok) throw new Error(`fetch failed: ${result.code} ${result.detail ?? ""}`);
        expect(result.value.title.length).toBeGreaterThan(0);
        expect(result.value.markdown.length).toBeGreaterThan(100);
    }, 70_000);

    // 直接调客户端，所以 ftp 网址真的发到了服务：这里核对的是服务回 400、归为 invalid-request。工具在本地就拒收非 http 网址、不发
    // 请求，那一条在 web.test.ts。
    it("错误的归类：错的密钥得 auth，回环地址得 rejected，服务对非 http 网址回的 400 得 invalid-request；详情里没有密钥", async () => {
        const wrong = await provider.search({query: "测试", count: 1}, "sk-invalid-not-real-000000", scope(30_000));
        expect(wrong).toMatchObject({ok: false, code: "auth"});
        expect(JSON.stringify(wrong)).not.toContain("sk-invalid-not-real");
        expect(await provider.fetch("http://127.0.0.1:9/", key, scope(30_000))).toMatchObject({ok: false, code: "rejected"});
        expect(await provider.fetch("ftp://example.com/a", key, scope(30_000))).toMatchObject({ok: false, code: "invalid-request"});
    }, 100_000);
});

const tavilyKey = llmTestKey("TAVILY_API_KEY");
const tavily = createTavilyProvider(() => DEFAULT_TAVILY_BASE_URL, {fetch, now: Date.now, sleep: sleepOn(systemClock)});

describe.skipIf(tavilyKey === null)("真实 Tavily 接口", () => {
    const key = tavilyKey ?? "";

    it("搜索：结果都是 http 或 https 网址，带标题与摘要，分数是数；站点过滤生效", async () => {
        const result = await tavily.search({query: "Lumiscript", count: 3}, key, scope(30_000));
        if (!result.ok) throw new Error(`search failed: ${result.code} ${result.detail ?? ""}`);
        expect(result.value.length).toBeGreaterThan(0);
        for (const hit of result.value) {
            expect(hit.url).toMatch(/^https?:\/\//u);
            expect(hit.title.length).toBeGreaterThan(0);
            expect(hit.summary.length).toBeGreaterThan(0);
            expect(typeof hit.score).toBe("number");
            expect(hit.site).toBeUndefined();
            if (hit.date !== undefined) expect(hit.date.length).toBeGreaterThan(0);
        }
        const onSite = await tavily.search({query: "web search API", count: 3, sites: ["docs.tavily.com"]}, key, scope(30_000));
        if (!onSite.ok) throw new Error(`search failed: ${onSite.code} ${onSite.detail ?? ""}`);
        expect(onSite.value.length).toBeGreaterThan(0);
        for (const hit of onSite.value) expect(new URL(hit.url).hostname).toBe("docs.tavily.com");
    }, 70_000);

    it("读取：交回标题与 Markdown 正文；读不了的网址得 not-found", async () => {
        const result = await tavily.fetch("https://github.com/jina-ai/reader", key, scope(60_000));
        if (!result.ok) throw new Error(`fetch failed: ${result.code} ${result.detail ?? ""}`);
        expect(result.value.title.length).toBeGreaterThan(0);
        expect(result.value.markdown.length).toBeGreaterThan(100);
        expect(await tavily.fetch("https://nonexistent.invalid/x", key, scope(60_000))).toMatchObject({ok: false, code: "not-found"});
    }, 130_000);

    it("错的密钥得 auth，详情里没有密钥", async () => {
        const wrong = await tavily.search({query: "test", count: 1}, "tvly-invalid-not-real-000000", scope(30_000));
        expect(wrong).toMatchObject({ok: false, code: "auth"});
        expect(JSON.stringify(wrong)).not.toContain("tvly-invalid-not-real");
    }, 40_000);
});
