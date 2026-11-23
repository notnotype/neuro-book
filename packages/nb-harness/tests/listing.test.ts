/**
 * 模型列表请求（docs/specs/models/service.md“模型来源”）：用本机的假端点按各协议的真实形状回应，断言实收的地址与认证头、分类与
 * 完整性。假端点每个用例自己起、自己停。
 */

import {describe, expect, test} from "bun:test";

import {LISTING_LIMITS, listingFlavor, listingHeaders, listModels, type ListingFlavor} from "@notnotype/nb-harness/models";

interface Seen {
    readonly path: string;
    readonly search: string;
    readonly headers: Headers;
}

/** 起一个本机端点；`respond` 拿到这是第几次请求（从 1 起）与请求本身。 */
function serve(respond: (count: number, url: URL) => Response | Promise<Response>) {
    const seen: Seen[] = [];
    const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
            const url = new URL(request.url);
            seen.push({path: url.pathname, search: url.search, headers: request.headers});
            return respond(seen.length, url);
        },
    });
    return {base: `http://127.0.0.1:${String(server.port)}`, seen, stop: () => server.stop(true)};
}

const json = (body: unknown, status = 200) => Response.json(body, {status});
const list = (flavor: ListingFlavor, baseUrl: string, headers: Record<string, string> = {}, signal = new AbortController().signal) => listModels({flavor, baseUrl, headers, signal});

describe("网络出口", () => {
    test("每页发出前按完整地址选路；选不出路时以 proxy 失败，请求不发", async () => {
        const server = serve(() => json({object: "list", data: [{id: "house-chat"}]}));
        try {
            const asked: string[] = [];
            const ok = await listModels({flavor: "openai", baseUrl: `${server.base}/v1`, headers: {}, signal: new AbortController().signal, route: async (url) => {
                asked.push(url.href);
                return {ok: true, proxy: false};
            }});
            expect(ok.ok).toBe(true);
            expect(asked).toEqual([`${server.base}/v1/models`]);
            const refused = await listModels({flavor: "openai", baseUrl: `${server.base}/v1`, headers: {}, signal: new AbortController().signal, route: async () => ({ok: false, code: "proxy-invalid", message: "the custom proxy has no address"})});
            expect(refused).toEqual({ok: false, reason: "proxy", status: null, message: "the custom proxy has no address"});
            expect(server.seen).toHaveLength(1);
        } finally {
            server.stop();
        }
    });
});

describe("各协议的地址、认证与分类", () => {
    test("OpenAI 兼容：`/models`、Bearer 与配置的请求头；只有 id 的行是类型不明，带窗口的照收", async () => {
        const server = serve(() => json({object: "list", data: [{id: "house-chat", context_length: 32_768}, {id: "text-embedding-x"}]}));
        try {
            const result = await list("openai", `${server.base}/v1/`, listingHeaders("openai", "sk-test", {"X-Team": "writing"}, false));
            expect(result).toEqual({ok: true, rows: [{id: "house-chat", kind: "unknown", contextWindow: 32_768}, {id: "text-embedding-x", kind: "unknown"}]});
            expect(server.seen.map((item) => item.path)).toEqual(["/v1/models"]);
            expect(server.seen[0]!.headers.get("authorization")).toBe("Bearer sk-test");
            expect(server.seen[0]!.headers.get("x-team")).toBe("writing");
        } finally {
            server.stop();
        }
    });

    test("OpenRouter：按输出模态分对话与其它，窗口、上限与看图取自列表；没有密钥时不带认证头", async () => {
        const server = serve(() => json({data: [
            {id: "vendor/chat", name: "Chat", context_length: 200_000, top_provider: {max_completion_tokens: 8192}, architecture: {input_modalities: ["text", "image"], output_modalities: ["text"]}},
            {id: "vendor/painter", architecture: {input_modalities: ["text"], output_modalities: ["image"]}},
            {id: "vendor/bare"},
        ]}));
        try {
            const result = await list("openrouter", `${server.base}/api/v1`, listingHeaders("openrouter", null, {}, true));
            expect(result).toEqual({ok: true, rows: [
                {id: "vendor/chat", name: "Chat", kind: "chat", contextWindow: 200_000, maxOutput: 8192, vision: true},
                {id: "vendor/painter", kind: "other", vision: false},
                {id: "vendor/bare", kind: "unknown"},
            ]});
            expect(server.seen[0]!.path).toBe("/api/v1/models");
            expect(server.seen[0]!.headers.get("authorization")).toBeNull();
        } finally {
            server.stop();
        }
    });

    test("Anthropic：跟随模板用 `x-api-key`、改了地址用 Bearer，都带版本头；按 `after_id` 读完每一页；地址带不带 `/v1` 都落在 `/v1/models`", async () => {
        const server = serve((count) => json(count % 2 === 1
            ? {data: [{id: "claude-a", display_name: "Claude A", type: "model"}], has_more: true, last_id: "claude-a"}
            : {data: [{id: "claude-b", type: "model"}], has_more: false, last_id: "claude-b"}));
        try {
            const following = await list("anthropic", server.base, listingHeaders("anthropic", "sk-ant", {}, true));
            expect(following).toEqual({ok: true, rows: [{id: "claude-a", name: "Claude A", kind: "chat"}, {id: "claude-b", kind: "chat"}]});
            const neutral = await list("anthropic", `${server.base}/v1`, listingHeaders("anthropic", "sk-ant", {}, false));
            expect(neutral.ok).toBe(true);
            expect(server.seen.map((item) => `${item.path}${item.search}`)).toEqual(["/v1/models?limit=1000", "/v1/models?limit=1000&after_id=claude-a", "/v1/models?limit=1000", "/v1/models?limit=1000&after_id=claude-a"]);
            expect(server.seen.slice(0, 2).map((item) => [item.headers.get("x-api-key"), item.headers.get("authorization")])).toEqual([["sk-ant", null], ["sk-ant", null]]);
            expect(server.seen.slice(2).map((item) => [item.headers.get("x-api-key"), item.headers.get("authorization")])).toEqual([[null, "Bearer sk-ant"], [null, "Bearer sk-ant"]]);
            expect(server.seen.every((item) => item.headers.get("anthropic-version") === "2023-06-01")).toBe(true);
        } finally {
            server.stop();
        }
    });

    test("Gemini：`x-goog-api-key`、按 `pageToken` 翻页；能生成内容的是对话模型，只能做向量的是其它；窗口与上限取自列表", async () => {
        const server = serve((count) => json(count === 1
            ? {models: [{name: "models/gemini-x", displayName: "Gemini X", inputTokenLimit: 1_048_576, outputTokenLimit: 65_536, supportedGenerationMethods: ["generateContent", "countTokens"]}], nextPageToken: "p2"}
            : {models: [{name: "models/embedding-x", supportedGenerationMethods: ["embedContent"]}]}));
        try {
            const result = await list("gemini", `${server.base}/v1beta`, listingHeaders("gemini", "g-key", {}, true));
            expect(result).toEqual({ok: true, rows: [{id: "gemini-x", name: "Gemini X", kind: "chat", contextWindow: 1_048_576, maxOutput: 65_536}, {id: "embedding-x", kind: "other"}]});
            expect(server.seen.map((item) => `${item.path}${item.search}`)).toEqual(["/v1beta/models?pageSize=1000", "/v1beta/models?pageSize=1000&pageToken=p2"]);
            expect(server.seen[0]!.headers.get("x-goog-api-key")).toBe("g-key");
            expect(server.seen[0]!.headers.get("authorization")).toBeNull();
        } finally {
            server.stop();
        }
    });

    test("配置的认证头盖过协议的缺省头（不分大小写），不会发出两份", async () => {
        const server = serve(() => json({data: []}));
        try {
            await list("openai", server.base, listingHeaders("openai", "sk-test", {Authorization: "Bearer team-token"}, false));
            expect(server.seen[0]!.headers.get("authorization")).toBe("Bearer team-token");
        } finally {
            server.stop();
        }
    });

    test("变体按协议定，OpenRouter 的模板用它自己的形状", () => {
        expect(listingFlavor("openai-responses", "openrouter")).toBe("openrouter");
        expect(listingFlavor("openai-completions", "deepseek")).toBe("openai");
        expect(listingFlavor("anthropic-messages", "openrouter")).toBe("anthropic");
        expect(listingFlavor("google-generative-ai", null)).toBe("gemini");
    });
});

describe("失败的分类与完整性", () => {
    test("401、403 是 auth，404、405 是 not-found，其余状态是 bad-response；空表是成功", async () => {
        const cases: Array<[number, string]> = [[401, "auth"], [403, "auth"], [404, "not-found"], [405, "not-found"], [500, "bad-response"], [429, "bad-response"]];
        for (const [status, reason] of cases) {
            const server = serve(() => json({error: {message: "nope"}}, status));
            try {
                expect(await list("openai", server.base)).toMatchObject({ok: false, reason, status});
            } finally {
                server.stop();
            }
        }
        const empty = serve(() => json({data: []}));
        try {
            expect(await list("openai", empty.base)).toEqual({ok: true, rows: []});
        } finally {
            empty.stop();
        }
    });

    test("分页中途 503：整次失败，不交回已读的那一页", async () => {
        const server = serve((count) => (count === 1 ? json({data: [{id: "claude-a"}], has_more: true, last_id: "claude-a"}) : json({error: "overloaded"}, 503)));
        try {
            expect(await list("anthropic", server.base)).toMatchObject({ok: false, reason: "bad-response", status: 503});
        } finally {
            server.stop();
        }
    });

    test("重复的游标、页数超限、说有下一页却不给游标：bad-response", async () => {
        const repeated = serve(() => json({models: [{name: "models/a", supportedGenerationMethods: ["generateContent"]}], nextPageToken: "same"}));
        const endless = serve((count) => json({models: [], nextPageToken: `p${String(count)}`}));
        const noCursor = serve(() => json({data: [], has_more: true}));
        try {
            expect(await list("gemini", repeated.base)).toMatchObject({ok: false, reason: "bad-response"});
            expect(repeated.seen).toHaveLength(2);
            expect(await list("gemini", endless.base)).toMatchObject({ok: false, reason: "bad-response"});
            expect(endless.seen).toHaveLength(LISTING_LIMITS.pages);
            expect(await list("anthropic", noCursor.base)).toMatchObject({ok: false, reason: "bad-response"});
        } finally {
            repeated.stop();
            endless.stop();
            noCursor.stop();
        }
    });

    test("重定向不跟随：bad-response，重定向的目标收不到请求", async () => {
        const target = serve(() => json({data: [{id: "elsewhere"}]}));
        const server = serve(() => new Response(null, {status: 302, headers: {location: `${target.base}/v1/models`}}));
        try {
            expect(await list("openai", server.base, {authorization: "Bearer sk-test"})).toMatchObject({ok: false, reason: "bad-response", status: 302});
            expect(target.seen).toHaveLength(0);
        } finally {
            server.stop();
            target.stop();
        }
    });

    test("不是 JSON、不是列表、行没有 id、单页超字节、行数超限：bad-response", async () => {
        const bodies: Array<() => Response> = [
            () => new Response("<html>login</html>", {status: 200}),
            () => json({object: "list"}),
            () => json({data: [{name: "no id"}]}),
            () => new Response(`{"data":[${'{"id":"x"},'.repeat(LISTING_LIMITS.pageBytes / 10)}{"id":"y"}]}`, {status: 200}),
            () => json({data: Array.from({length: LISTING_LIMITS.rows + 1}, (_, index) => ({id: `m-${String(index)}`}))}),
        ];
        for (const body of bodies) {
            const server = serve(body);
            try {
                expect(await list("openai", server.base)).toMatchObject({ok: false, reason: "bad-response"});
            } finally {
                server.stop();
            }
        }
    });

    test("连不上是 unreachable；响应体不结束时取消，交回 cancelled、不等它", async () => {
        const closed = serve(() => json({data: []}));
        const base = closed.base;
        closed.stop();
        expect(await list("openai", base)).toMatchObject({ok: false, reason: "unreachable"});

        let stall: ReadableStreamDefaultController<Uint8Array> | null = null;
        const slow = serve(() => new Response(new ReadableStream<Uint8Array>({start(controller) {
            stall = controller;
            controller.enqueue(new TextEncoder().encode('{"data":['));
        }}), {status: 200, headers: {"content-type": "application/json"}}));
        const controller = new AbortController();
        try {
            const pending = list("openai", slow.base, {}, controller.signal);
            // 等端点收到请求、发出半个响应体，再取消。
            while (stall === null) await Bun.sleep(5);
            controller.abort();
            expect(await pending).toMatchObject({ok: false, reason: "cancelled"});
        } finally {
            (stall as ReadableStreamDefaultController<Uint8Array> | null)?.close();
            slow.stop();
        }
    });
});

describe("审查补的边界", () => {
    test("失败的说明只有状态码：正文里回显的认证头不带出来", async () => {
        const server = serve(() => new Response("invalid key sk-secret-echoed-0001", {status: 401}));
        try {
            const result = await list("openai", server.base, listingHeaders("openai", "sk-secret-echoed-0001", {}, false));
            expect(result).toMatchObject({ok: false, reason: "auth", status: 401});
            expect(JSON.stringify(result)).not.toContain("sk-secret");
        } finally {
            server.stop();
        }
    });

    test("不是列表的信封与坏分页标志不当成功：Gemini 的错误信封、无关对象、数字游标，Anthropic 的字符串 has_more", async () => {
        const cases: Array<[ListingFlavor, unknown]> = [
            ["gemini", {error: {code: 500, message: "boom"}}],
            ["gemini", {unrelated: true}],
            ["gemini", {models: [], nextPageToken: 123}],
            ["anthropic", {data: [{id: "claude-a"}], has_more: "true", last_id: "claude-a"}],
        ];
        for (const [flavor, body] of cases) {
            const server = serve(() => json(body));
            try {
                expect(await list(flavor, server.base)).toMatchObject({ok: false, reason: "bad-response"});
            } finally {
                server.stop();
            }
        }
        const empty = serve(() => json({}));
        try {
            expect(await list("gemini", empty.base)).toEqual({ok: true, rows: []});
        } finally {
            empty.stop();
        }
    });

    test("兼容服务的 `models` 信封照收；过长的名称截断；重复行也计入行数上限", async () => {
        const long = "名".repeat(LISTING_LIMITS.nameLength + 50);
        const envelope = serve(() => json({models: [{id: "compatible-model", name: long}]}));
        const duplicates = serve(() => json({data: Array.from({length: LISTING_LIMITS.rows + 1}, () => ({id: "same"}))}));
        try {
            const result = await list("openai", envelope.base);
            expect(result.ok && result.rows[0]!.id).toBe("compatible-model");
            expect(result.ok && [...result.rows[0]!.name!].length).toBe(LISTING_LIMITS.nameLength);
            expect(await list("openai", duplicates.base)).toMatchObject({ok: false, reason: "bad-response"});
        } finally {
            envelope.stop();
            duplicates.stop();
        }
    });

    test("翻页期间认证不再是当前的：下一页不发，整次 cancelled", async () => {
        let current = true;
        const server = serve(() => {
            current = false;
            return json({data: [{id: "claude-a"}], has_more: true, last_id: "claude-a"});
        });
        try {
            expect(await listModels({flavor: "anthropic", baseUrl: server.base, headers: {}, signal: new AbortController().signal, stillCurrent: () => current})).toMatchObject({ok: false, reason: "cancelled"});
            expect(server.seen).toHaveLength(1);
        } finally {
            server.stop();
        }
    });
});
