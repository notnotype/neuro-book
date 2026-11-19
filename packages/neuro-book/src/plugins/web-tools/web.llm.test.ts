/**
 * 真实 DeepSeek 接口（docs/specs/web/tools.md 验收 4）：直接用客户端调官方地址，核对两条接口的字段映射与几种错误的归类，
 * 也是假接口（`testing/fake-deepseek.ts`）与真实接口对照的那一条。密钥只在内存里（`llmTestConfig` 从环境取），不写进任何文件。
 * 只在显式开启真实模型测试时运行；每次调用按次计费。
 */

import {describe, expect, it} from "bun:test";

import {llmTestConfig} from "@notnotype/neuro-book-test-support/llm";

import {createDeepSeekProvider} from "./backend/providers/deepseek";
import {realSleep} from "./backend/providers/http";
import type {CallScope} from "./backend/providers/types";
import {DEFAULT_DEEPSEEK_BASE_URL} from "./shared/settings";

const config = llmTestConfig();
const provider = createDeepSeekProvider(() => DEFAULT_DEEPSEEK_BASE_URL, {fetch, now: Date.now, sleep: realSleep});
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
        }
    }, 40_000);

    it("读取：交回标题与 Markdown 正文", async () => {
        const result = await provider.fetch("https://github.com/jina-ai/reader", key, scope(60_000));
        if (!result.ok) throw new Error(`fetch failed: ${result.code} ${result.detail ?? ""}`);
        expect(result.value.title.length).toBeGreaterThan(0);
        expect(result.value.markdown.length).toBeGreaterThan(100);
    }, 70_000);

    it("错误的归类：错的密钥得 auth，回环地址得 rejected，非 http 网址得 invalid-request；详情里没有密钥", async () => {
        const wrong = await provider.search({query: "测试", count: 1}, "sk-invalid-not-real-000000", scope(30_000));
        expect(wrong).toMatchObject({ok: false, code: "auth"});
        expect(JSON.stringify(wrong)).not.toContain("sk-invalid-not-real");
        expect(await provider.fetch("http://127.0.0.1:9/", key, scope(30_000))).toMatchObject({ok: false, code: "rejected"});
        expect(await provider.fetch("ftp://example.com/a", key, scope(30_000))).toMatchObject({ok: false, code: "invalid-request"});
    }, 100_000);
});
