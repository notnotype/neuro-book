/**
 * 模型目录（docs/specs/agent/harness.md “模型目录”）：用仓库锁定的 OMP 目录，不发请求。
 *
 * 认证分类读 OMP 的编译元数据（通配导出的子路径），下面的快照在升级 OMP 时会报出变化：先核对新版本的元数据，
 * 再改快照。设置的密钥都是假的，只用来看“有没有值”，不发请求。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {clampEffort, discoverModels, listCatalog, MissingModelKeyError, providerKeyReady, resolveModel, suggestFromCatalog} from "../src";

const touched = new Set<string>();
function setEnv(name: string, value: string | undefined): void {
    touched.add(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
const original = new Map(["SAKANA_API_KEY", "FUGU_API_KEY", "ZENMUX_API_KEY"].map(name => [name, process.env[name]]));
afterEach(() => {
    for (const name of touched) setEnv(name, original.get(name));
    touched.clear();
});

function provider(id: string) {
    const found = listCatalog().find(item => item.id === id);
    if (found === undefined) throw new Error(`目录里没有 ${id}`);
    return found;
}

describe("服务商的认证分类", () => {
    test("OMP 18.14.0 的全部服务商：按顺序取第一个符合的分类", () => {
        const groups: Record<string, string[]> = {};
        for (const item of listCatalog()) (groups[item.access] ??= []).push(item.id);
        expect(listCatalog()).toHaveLength(79);
        expect(groups.keyless).toEqual(["commandcode", "google-vertex", "local", "web", "zenmux"]);
        // 会过期的登录令牌（刷新方式 request、hook），以及有登录方式但没有变量的。
        expect(groups.login).toEqual(["anthropic", "cursor", "github-copilot", "gitlab-duo", "gitlab-duo-agent", "google-antigravity", "google-gemini-cli", "kimi-code", "muse-code", "openai-codex", "snowflake", "xai-oauth"]);
        expect(groups.unsupported).toEqual(["amazon-bedrock", "minimax-cn"]);
        expect(groups.key).toHaveLength(60);
        // 登录结果就是 API key、刷新方式为 none 的算 key。
        expect(provider("openrouter").access).toBe("key");
        expect(provider("devin").access).toBe("key");
    });

    test("密钥变量按 OMP 查找的顺序列出", () => {
        expect(provider("moonshot").keyEnvs).toEqual(["MOONSHOT_API_KEY", "KIMI_API_KEY"]);
        expect(provider("anthropic").keyEnvs).toEqual(["ANTHROPIC_API_KEY"]);
        expect(provider("xai-oauth").keyEnvs).toEqual(["XAI_OAUTH_TOKEN", "XAI_API_KEY"]);
        expect(provider("amazon-bedrock").keyEnvs).toEqual([]);
        expect(provider("google-gemini-cli").keyEnvs).toEqual([]);
    });

    test("有没有值按 OMP 的取法：列表里任一个变量有值即可", () => {
        setEnv("SAKANA_API_KEY", undefined);
        setEnv("FUGU_API_KEY", undefined);
        expect(providerKeyReady("sakana")).toBe(false);
        setEnv("FUGU_API_KEY", "fake-key-for-test");
        expect(providerKeyReady("sakana")).toBe(true);
        setEnv("FUGU_API_KEY", "  ");
        expect(providerKeyReady("sakana")).toBe(false);
    });
});

describe("目录模型", () => {
    test("上下文、最大输出、推理档、图片与单价取自目录", () => {
        const model = provider("openai").models.find(item => item.id === "gpt-5.6-sol")!;
        expect(model).toMatchObject({api: "openai-responses", contextWindow: 1_050_000, maxTokens: 128_000, reasoning: true, efforts: ["low", "medium", "high", "xhigh", "max"]});
        expect(model.price).toMatchObject({currency: "USD"});
        expect(model.price!.input).toBeGreaterThan(0);
        expect(provider("deepseek").models.find(item => item.id === "deepseek-flash")!.efforts).toEqual(["low", "high", "max"]);
        const plain = provider("openai").models.find(item => item.id === "gpt-4")!;
        expect(plain.reasoning).toBe(false);
        expect(plain.efforts).toEqual([]);
    });

    test("单价全为 0 的当未知，不当免费", () => {
        const model = provider("openrouter").models.find(item => item.id === "arcee-ai/trinity-mini:free")!;
        expect(model.price).toBeNull();
        expect(resolveModel("openrouter/arcee-ai/trinity-mini:free").priceKnown).toBe(false);
        expect(resolveModel("openai/gpt-5.6-sol").priceKnown).toBe(true);
    });

    test("推理档夹到模型支持的档；不支持推理的模型不发", () => {
        const flash = resolveModel("deepseek/deepseek-flash").model;
        expect(clampEffort(flash, "medium")).toBe("low");
        expect(clampEffort(flash, "high")).toBe("high");
        expect(clampEffort(flash, undefined)).toBeUndefined();
        expect(clampEffort(resolveModel("openai/gpt-4").model, "high")).toBeUndefined();
    });

    test("按模型名找参照：认得的给出参数与出处，认不得的为 null", () => {
        expect(suggestFromCatalog("gpt-5.6-sol")).toEqual({from: "openai/gpt-5.6-sol", contextWindow: 1_050_000, maxTokens: 128_000, reasoning: true, images: true});
        expect(suggestFromCatalog("not-a-model-anywhere")).toBeNull();
    });
});

describe("目录模型的密钥", () => {
    test("缺失时错误列出全部可设的变量", () => {
        setEnv("SAKANA_API_KEY", undefined);
        setEnv("FUGU_API_KEY", undefined);
        const resolved = resolveModel(`sakana/${provider("sakana").models[0]!.id}`);
        expect(() => resolved.apiKey()).toThrow(MissingModelKeyError);
        expect(() => resolved.apiKey()).toThrow("SAKANA_API_KEY 或 FUGU_API_KEY");
    });

    test("不要认证的服务商没有值时不报错", () => {
        setEnv("ZENMUX_API_KEY", undefined);
        const resolved = resolveModel(`zenmux/${provider("zenmux").models[0]!.id}`);
        expect(() => resolved.apiKey()).not.toThrow();
    });
});

describe("读 /models", () => {
    /** 本机的 OpenAI 兼容服务：按路径给出固定的回应；记下收到的认证头。 */
    function serve(respond: () => Response) {
        const authorizations: (string | null)[] = [];
        const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(request) {
                authorizations.push(request.headers.get("authorization"));
                return new URL(request.url).pathname === "/v1/models" ? respond() : new Response("no", {status: 404});
            },
        });
        return {url: `http://127.0.0.1:${server.port}/v1`, authorizations, stop: () => server.stop(true)};
    }
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json"}});

    test("读到模型：带认证头；认得的模型名给出目录里的参照", async () => {
        const server = serve(() => json({data: [{id: "gpt-5.6-sol"}, {id: "house-model"}]}));
        try {
            const result = await discoverModels({api: "openai-completions", baseUrl: server.url, apiKey: "fake-key-for-test"});
            expect(result.state).toBe("found");
            const models = result.state === "found" ? result.models : [];
            expect(models.map(model => model.id)).toEqual(["gpt-5.6-sol", "house-model"]);
            expect(models[0]!.suggested).toMatchObject({from: "openai/gpt-5.6-sol", contextWindow: 1_050_000});
            expect(models[1]!.suggested).toBeNull();
            expect(server.authorizations).toEqual(["Bearer fake-key-for-test"]);
        } finally {
            server.stop();
        }
    });

    test("空列表、404、401、403、别的状态码与坏回应各自分开", async () => {
        const cases: [() => Response, string, number | null][] = [
            [() => json({data: []}), "empty", null],
            [() => new Response("missing", {status: 404}), "not_supported", 404],
            [() => new Response("denied", {status: 401}), "auth", 401],
            [() => new Response("denied", {status: 403}), "auth", 403],
            [() => new Response("boom", {status: 500}), "failed", 500],
            [() => new Response("not json", {status: 200}), "failed", 200],
        ];
        for (const [respond, state, status] of cases) {
            const server = serve(respond);
            try {
                const result = await discoverModels({api: "openai-completions", baseUrl: server.url});
                expect(result.state).toBe(state as never);
                if (status !== null) expect(result).toMatchObject({status});
            } finally {
                server.stop();
            }
        }
    });

    test("连不上，或者回了响应头、响应体超时没发完：unreachable", async () => {
        const server = serve(() => json({data: []}));
        const url = server.url;
        server.stop();
        expect((await discoverModels({api: "openai-completions", baseUrl: url})).state).toBe("unreachable");

        // 先发响应头与半个 JSON，之后不再发。
        let stall: ReadableStreamDefaultController<Uint8Array> | null = null;
        const slow = serve(() => new Response(new ReadableStream<Uint8Array>({start(controller) {
            stall = controller;
            controller.enqueue(new TextEncoder().encode('{"data":['));
        }}), {status: 200, headers: {"content-type": "application/json"}}));
        try {
            expect(await discoverModels({api: "openai-completions", baseUrl: slow.url, timeoutMs: 200})).toMatchObject({state: "unreachable"});
        } finally {
            (stall as ReadableStreamDefaultController<Uint8Array> | null)?.close();
            slow.stop();
        }
    });
});
