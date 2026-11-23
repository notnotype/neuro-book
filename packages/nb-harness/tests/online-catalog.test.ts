/**
 * 在线目录的取、解析与目录视图（docs/specs/models/service.md“模型来源”）：本机端点回 zstd 压过的 models.dev 形状，断言条件请求、
 * 上限、价目按原文判断、打包目录里已有的行用打包的。
 */

import {describe, expect, test} from "bun:test";
import {zstdCompressSync} from "node:zlib";

import {createCatalogView, fetchOnlineCatalog, ONLINE_CATALOG_LIMITS, OnlineCatalogError, parseOnlineCatalog, wireApiOf} from "@notnotype/nb-harness/models";
import {getBundledModels} from "@oh-my-pi/pi-catalog";

/** 打包目录里 Anthropic 的第一个对话模型：在线目录给它另一个名字，看视图用的是哪个（窗口会被 `buildModel` 按已知型号修正，分不出来）。 */
const bundledAnthropic = (getBundledModels("anthropic") as Array<{id: string; name: string}>)[0]!;

const payload = {
    anthropic: {
        models: {
            "claude-brand-new": {id: "claude-brand-new", name: "Claude Brand New", tool_call: true, reasoning: true, limit: {context: 500_000, output: 64_000}, cost: {input: 3, output: 15}, modalities: {input: ["text", "image"], output: ["text"]}},
            "claude-free-new": {id: "claude-free-new", name: "Claude Free", tool_call: true, limit: {context: 100_000, output: 8000}, cost: {input: 0, output: 0}},
            "claude-unpriced-new": {id: "claude-unpriced-new", name: "Claude Unpriced", tool_call: true, limit: {context: 100_000, output: 8000}},
            [bundledAnthropic.id]: {id: bundledAnthropic.id, name: "Changed In Online Catalog", tool_call: true, limit: {context: 1234, output: 10}, cost: {input: 1, output: 1}},
        },
    },
};
const zstd = (value: unknown) => new Uint8Array(zstdCompressSync(Buffer.from(JSON.stringify(value))));

describe("解析与目录视图", () => {
    test("在线目录只补打包里没有的模型；同 id 的仍用打包的", () => {
        const view = createCatalogView(parseOnlineCatalog(zstd(payload)));
        const fresh = view.find("anthropic", "claude-brand-new");
        expect(fresh?.info).toMatchObject({id: "claude-brand-new", name: "Claude Brand New", contextWindow: 500_000, maxTokens: 64_000, images: true, chat: true});
        expect(wireApiOf(fresh!.model.api)).toBe("anthropic-messages");
        expect(view.chatModels("anthropic").map((model) => model.id)).toContain("claude-brand-new");
        expect(view.find("anthropic", bundledAnthropic.id)?.info.name).toBe(bundledAnthropic.name);
        // 没有在线目录的视图就是打包目录。
        expect(createCatalogView().find("anthropic", "claude-brand-new")).toBeUndefined();
    });

    test("坏行丢掉、其余照收：窗口不是整数、价目不是数字的不当成已知", () => {
        const view = createCatalogView(parseOnlineCatalog(zstd({anthropic: {models: {
            ...payload.anthropic.models,
            "claude-bad-window": {id: "claude-bad-window", name: "Bad Window", tool_call: true, limit: {context: 7.25, output: 10}, cost: {input: 1, output: 1}},
            "claude-bad-price": {id: "claude-bad-price", name: "Bad Price", tool_call: true, limit: {context: 100_000, output: 10}, cost: {input: "not-a-price", output: 1}},
        }}})));
        expect(view.find("anthropic", "claude-bad-window")).toBeUndefined();
        expect(view.find("anthropic", "claude-bad-price")).toBeUndefined();
        expect(view.find("anthropic", "claude-brand-new")).toBeDefined();
    });

    test("价目按原文：有 cost 且全为 0 是免费，没有 cost 是未知", () => {
        const view = createCatalogView(parseOnlineCatalog(zstd(payload)));
        expect(view.find("anthropic", "claude-brand-new")).toMatchObject({priceKnown: true, info: {price: {input: 3, output: 15}}});
        expect(view.find("anthropic", "claude-free-new")).toMatchObject({priceKnown: true, info: {price: {input: 0, output: 0}}});
        expect(view.find("anthropic", "claude-unpriced-new")).toMatchObject({priceKnown: false, info: {price: null}});
    });

    test("没压缩的 JSON 照样解析；解不开、不是 JSON、没有服务商、解压后超限：整份拒收", () => {
        expect(parseOnlineCatalog(new TextEncoder().encode(JSON.stringify(payload))).providers.get("anthropic")?.length).toBe(4);
        const rejected = (bytes: Uint8Array) => {
            try {
                parseOnlineCatalog(bytes);
                return null;
            } catch (error) {
                return error instanceof OnlineCatalogError ? error.reason : "other";
            }
        };
        const corrupt = zstd(payload).slice(0, 40);
        expect(rejected(corrupt)).toBe("malformed");
        expect(rejected(new TextEncoder().encode("not json"))).toBe("malformed");
        expect(rejected(zstd({unknown: {models: {}}}))).toBe("malformed");
        // 压缩后很小、解压后超过上限的一份。
        const bomb = new Uint8Array(zstdCompressSync(Buffer.alloc(ONLINE_CATALOG_LIMITS.decodedBytes + 1, 32)));
        expect(rejected(bomb)).toBe("too-large");
    });
});

describe("取在线目录", () => {
    function serve(respond: (request: Request) => Response) {
        const seen: Request[] = [];
        const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: (request) => {
            seen.push(request);
            return respond(request);
        }});
        return {url: `http://127.0.0.1:${String(server.port)}/models.json.zstd`, seen, stop: () => server.stop(true)};
    }
    const signal = () => new AbortController().signal;

    test("200 交回字节与 ETag；带了 ETag 时发条件请求，304 才成立；没带 ETag 的 304 是坏回应", async () => {
        const body = zstd(payload);
        const server = serve((request) => (request.headers.get("if-none-match") === '"v1"' ? new Response(null, {status: 304}) : new Response(body, {headers: {etag: '"v1"'}})));
        try {
            const first = await fetchOnlineCatalog({etag: null, signal: signal(), url: server.url});
            expect(first).toMatchObject({status: 200, etag: '"v1"'});
            expect(first.status === 200 ? [...first.bytes] : null).toEqual([...body]);
            expect(await fetchOnlineCatalog({etag: '"v1"', signal: signal(), url: server.url})).toEqual({status: 304});
            expect(server.seen.map((request) => request.headers.get("if-none-match"))).toEqual([null, '"v1"']);
        } finally {
            server.stop();
        }
        const stray = serve(() => new Response(null, {status: 304}));
        try {
            expect(await fetchOnlineCatalog({etag: null, signal: signal(), url: stray.url})).toMatchObject({status: "failed", reason: "bad-response"});
        } finally {
            stray.stop();
        }
    });

    test("传输超过上限、重定向、连不上、取消：各自失败，不跟随重定向", async () => {
        const huge = serve(() => new Response(new Uint8Array(ONLINE_CATALOG_LIMITS.transferBytes + 1)));
        const target = serve(() => new Response(zstd(payload)));
        const moved = serve(() => new Response(null, {status: 301, headers: {location: target.url}}));
        try {
            expect(await fetchOnlineCatalog({etag: null, signal: signal(), url: huge.url})).toMatchObject({status: "failed", reason: "too-large"});
            expect(await fetchOnlineCatalog({etag: null, signal: signal(), url: moved.url})).toMatchObject({status: "failed", reason: "bad-response"});
            expect(target.seen).toHaveLength(0);
        } finally {
            huge.stop();
            target.stop();
            moved.stop();
        }
        const gone = serve(() => new Response(""));
        const url = gone.url;
        gone.stop();
        expect(await fetchOnlineCatalog({etag: null, signal: signal(), url})).toMatchObject({status: "failed", reason: "unreachable"});
        const aborted = new AbortController();
        aborted.abort();
        expect(await fetchOnlineCatalog({etag: null, signal: aborted.signal, url})).toMatchObject({status: "failed", reason: "cancelled"});
    });

    test("网络出口选不出路：以 proxy 失败，请求不发", async () => {
        const server = serve(() => new Response(zstd(payload)));
        try {
            const result = await fetchOnlineCatalog({etag: null, signal: signal(), url: server.url, route: async () => ({ok: false, code: "proxy-unreadable", message: "reg exited with 1"})});
            expect(result).toEqual({status: "failed", reason: "proxy", message: "reg exited with 1"});
            expect(server.seen).toHaveLength(0);
        } finally {
            server.stop();
        }
    });
});
