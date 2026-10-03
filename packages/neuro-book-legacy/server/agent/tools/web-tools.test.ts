import {describe, expect, it, vi} from "vitest";
import {Value} from "typebox/value";
import {createDefaultEffectiveConfig} from "nbook/server/config/normalizer";
import {createWebTools, fetchWeb, searchWeb} from "nbook/server/agent/tools/web-tools";
import type {EffectiveConfig} from "nbook/server/config/types";

describe("web tools", () => {
    it("web_search schema 不暴露 provider 参数", () => {
        const tool = createWebTools().find((item) => item.key === "web_search");

        expect(tool).toBeDefined();
        expect(Value.Check(tool!.parameters, {
            query: "NeuroBook web research",
            max_results: 3,
            allowed_domains: ["example.com"],
        })).toBe(true);
        expect(Value.Check(tool!.parameters, {
            query: "NeuroBook web research",
            provider: "brave",
        })).toBe(false);
        const querySchema = (tool!.parameters as {properties: {query?: {description?: string}}}).properties.query;
        expect(querySchema).toBeDefined();
        expect(querySchema?.description).toContain("preserve the user's wording");
        expect(querySchema?.description).toContain("instead of adding unverified domain guesses");
    });

    it("按配置顺序 fallback 到 Brave 并过滤 blocked domain", async () => {
        const config = createWebConfig();
        config.web.search.order = ["tavily", "brave"];
        config.web.search.providers.tavily = {
            enabled: true,
            apiKey: "tvly-test",
            timeoutMs: 1000,
        };
        config.web.search.providers.brave = {
            enabled: true,
            apiKey: "brave-test",
            country: "US",
            searchLang: "en",
            timeoutMs: 1000,
        };
        const fetchMock = vi.spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(new Response("temporary failure", {status: 500}))
            .mockResolvedValueOnce(Response.json({
                web: {
                    results: [
                        {title: "Keep", url: "https://docs.example.com/page", description: "kept"},
                        {title: "Drop", url: "https://blocked.example.com/page", description: "blocked"},
                    ],
                },
            }));

        const result = await searchWeb(config, {
            query: "test query",
            blocked_domains: ["blocked.example.com"],
            max_results: 5,
        });

        expect(result.provider).toBe("brave");
        expect(result.results).toEqual([expect.objectContaining({
            title: "Keep",
            url: "https://docs.example.com/page",
            snippet: "kept",
        })]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        fetchMock.mockRestore();
    });

    it("缺少可用 provider 时返回配置错误", async () => {
        await expect(searchWeb(createWebConfig(), {
            query: "test query",
        })).rejects.toThrow("workspace/.nbook/config.json");
    });

    it("web_fetch 拒绝非 HTTP URL", async () => {
        await expect(fetchWeb(createWebConfig(), {
            url: "file:///etc/passwd",
        })).rejects.toThrow("http:// 或 https://");
    });

    it("web_fetch 本地 text 抓取会截断", async () => {
        const config = createWebConfig();
        config.web.fetch.local.maxCharacters = 5;
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("hello world", {
            status: 200,
            headers: {"content-type": "text/plain; charset=utf-8"},
        }));

        const result = await fetchWeb(config, {
            url: "https://example.com/plain.txt",
        });

        expect(result).toMatchObject({
            provider: "local",
            content: "hello",
            contentFormat: "text",
            truncated: true,
        });
        fetchMock.mockRestore();
    });

    it("web_fetch 本地 HTML 抓取会转为 markdown", async () => {
        const config = createWebConfig();
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response([
            "<html><head><title>Doc Title</title></head>",
            "<body><article><h1>Doc Title</h1><p>Hello <strong>reader</strong>.</p></article></body></html>",
        ].join(""), {
            status: 200,
            headers: {"content-type": "text/html; charset=utf-8"},
        }));

        const result = await fetchWeb(config, {
            url: "https://example.com/doc",
        });

        expect(result.contentFormat).toBe("markdown");
        expect(result.content).toContain("Hello **reader**.");
        expect(result.truncated).toBe(false);
        fetchMock.mockRestore();
    }, 15_000);
});

function createWebConfig(): EffectiveConfig {
    return createDefaultEffectiveConfig();
}
