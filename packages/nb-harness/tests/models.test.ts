/**
 * `@notnotype/nb-harness/models`（docs/specs/models/service.md）：真的凭据库文件、本机起的 OpenAI 兼容端点（真实 HTTP、
 * 真实 OMP），经公开入口调用。这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, stat, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ModelRequest, ModelWireAttempt} from "@notnotype/nb-harness/kernel";
import {buildResolution, chatModels, discoverModels, hasCredential, listCatalog, openCredentials, templateRoutes, unsendableReason, wireApiOf, wireGuard, type ProviderTarget} from "@notnotype/nb-harness/models";

let root = "";
const seen: {path: string; headers: Headers}[] = [];
const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const path = new URL(request.url).pathname;
        seen.push({path, headers: request.headers});
        if (path.endsWith("/models")) return Response.json({object: "list", data: [{id: "qwen3:8b", object: "model"}, {id: "gemma3:12b", object: "model"}]});
        await request.text();
        const chunk = (body: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
        const sse = chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]})
            + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]})
            + chunk({choices: [], usage: {prompt_tokens: 3, completion_tokens: 1, total_tokens: 4}})
            + "data: [DONE]\n\n";
        return new Response(sse, {headers: {"content-type": "text/event-stream"}});
    },
});
const BASE = `http://127.0.0.1:${server.port}/v1`;

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness", "models");
});
afterAll(async () => {
    server.stop(true);
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const request: ModelRequest = {purpose: "turn", model: "x", params: {maxTokens: 16}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "你好", origin: {kind: "fixed", by: "kernel"}}]}], tools: []};
const custom = (patch: Partial<ProviderTarget> = {}): ProviderTarget => ({id: "local", template: null, follows: false, baseUrl: BASE, api: "openai-completions", auth: "default", ...patch});
const KEY = "sk-local-not-a-real-key-0001";

async function send(provider: ProviderTarget, stored: string | null, env: Record<string, string> = {}, modelPatch: object = {}) {
    const built = buildResolution(provider, {id: "qwen3:8b", contextWindow: 32_000, ...modelPatch}, {stored: () => stored, env});
    if (!built.ok) throw new Error(built.code);
    seen.length = 0;
    const response = await built.resolution.call(request, new AbortController().signal, () => undefined);
    return {response, headers: seen[0]?.headers, requests: seen.length};
}

describe("请求全文的落盘", () => {
    test("400、413 之后磁盘上没有请求全文，错误文字不带路径；路径行不在末尾、正文很长时也一样", async () => {
        const home = join(root, "dump-home");
        await mkdir(home, {recursive: true});
        const victim = join(home, "别的目录/http-400-requests/笔记.txt");
        await mkdir(dirname(victim), {recursive: true});
        await writeFile(victim, "不该被删");
        // `pi-ai` 按这些变量决定日志目录，留着就看错了地方。
        const env: Record<string, string | undefined> = {...process.env, HOME: home, NB_TEST_VICTIM: victim};
        for (const name of ["XDG_STATE_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "PI_CONFIG_DIR", "PI_CODING_AGENT_DIR", "OMP_PROFILE", "PI_PROFILE"]) delete env[name];
        const child = Bun.spawn(["bun", join(import.meta.dir, "fixtures/request-dump.ts")], {env, stdout: "pipe", stderr: "pipe"});
        const [out, failure, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({code, failure}).toEqual({code: 0, failure: ""});
        const results = out.trim().split("\n").map((line) => JSON.parse(line) as {name: string; kind: string; message: string});
        expect(results.map((result) => result.name)).toEqual(["400", "413", "metadata", "long", "forged"]);
        for (const result of results) expect(result.message).not.toContain("raw-http-request");
        expect(results.find((result) => result.name === "metadata")!.message).toContain("provider diagnostic follows");
        // 目录这次确实被用过（否则这条断言什么也没证明），里面没有留下文件。
        const dumps = await readdir(join(home, ".omp/logs/http-400-requests"));
        expect(dumps).toEqual([]);
        expect(await readFile(victim, "utf8")).toBe("不该被删");
    }, 30_000);
});

describe("凭据库", () => {
    test("写入后立即可读、重开仍在；再写是替换（只剩一行）；清除后没有；变化通知；库文件只给本人读写", async () => {
        const path = join(root, "agent", "credentials.db");
        const store = await openCredentials(path);
        const changes: number[] = [];
        store.onChange(() => changes.push(1));
        expect(store.get("deepseek")).toBeNull();
        await store.set("deepseek", "sk-first-0000000000");
        expect(store.get("deepseek")).toBe("sk-first-0000000000");
        expect([...store.providers()]).toEqual(["deepseek"]);
        await store.set("deepseek", "sk-second-000000000");
        expect(store.get("deepseek")).toBe("sk-second-000000000");
        expect(changes.length).toBeGreaterThanOrEqual(2);
        store.close();

        const again = await openCredentials(path);
        expect(again.get("deepseek")).toBe("sk-second-000000000");
        await again.clear("deepseek");
        expect(again.get("deepseek")).toBeNull();
        expect(again.providers().size).toBe(0);
        again.close();
        if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
    });
});

describe("按配置建出解析结果", () => {
    test("自定义服务商：密钥取凭据库；apiKeyEnv 有值时盖过它；不要认证时不带密钥；bearer 另加 Authorization", async () => {
        const stored = await send(custom(), KEY);
        expect(stored.response.stopReason).toBe("stop");
        expect(stored.headers!.get("authorization")).toBe(`Bearer ${KEY}`);

        const fromEnv = await send(custom({apiKeyEnv: "NB_MODELS_TEST_KEY"}), KEY, {NB_MODELS_TEST_KEY: "sk-from-env-00000000"});
        expect(fromEnv.headers!.get("authorization")).toBe("Bearer sk-from-env-00000000");

        const none = await send(custom({auth: "none"}), null);
        expect(none.response.stopReason).toBe("stop");
        expect(none.headers!.get("authorization") ?? "").not.toContain(KEY);

        const anthropicStyle = buildResolution(custom({api: "anthropic-messages", auth: "bearer"}), {id: "m", contextWindow: 1000}, {stored: () => KEY, env: {}});
        expect(anthropicStyle.ok).toBe(true);
    });

    test("请求头随请求发出，值里的 env: 现取；变量没有值时不发请求，以 auth、missing-key 失败", async () => {
        const provider = custom({headers: {"X-Team": "writing", "X-Gateway": "env:NB_MODELS_GATEWAY"}});
        const ok = await send(provider, KEY, {NB_MODELS_GATEWAY: "gw-0000000000"}, {headers: {"X-Model": "m1"}});
        expect(ok.headers!.get("x-team")).toBe("writing");
        expect(ok.headers!.get("x-gateway")).toBe("gw-0000000000");
        expect(ok.headers!.get("x-model")).toBe("m1");

        const missing = await send(provider, KEY, {});
        expect(missing.response.error).toMatchObject({kind: "auth", code: "missing-key"});
        expect(missing.response.error!.message).toContain("NB_MODELS_GATEWAY");
        expect(missing.requests).toBe(0);

        const noKey = await send(custom(), null);
        expect(noKey.response.error).toMatchObject({kind: "auth", code: "missing-key"});
        expect(hasCredential(custom(), {stored: () => null, env: {}})).toBe(false);
        expect(hasCredential(custom({apiKeyEnv: "NB_MODELS_TEST_KEY"}), {stored: () => KEY, env: {}})).toBe(false);
        expect(hasCredential(custom({auth: "none"}), {stored: () => null, env: {}})).toBe(true);
    });

    test("自定义模型缺上下文窗口、目录里没有的模型或服务商：unknown-model", () => {
        const access = {stored: () => KEY, env: {}};
        expect(buildResolution(custom(), {id: "m"}, access)).toEqual({ok: false, code: "unknown-model"});
        expect(buildResolution({id: "deepseek", template: "deepseek", follows: true, auth: "default"}, {id: "no-such-model"}, access)).toEqual({ok: false, code: "unknown-model"});
        expect(buildResolution({id: "no-such-provider", template: "no-such-provider", follows: true, auth: "default"}, {id: "m"}, access)).toEqual({ok: false, code: "unknown-model"});
    });

    test("目录服务商：能力与单价按目录，地址可以覆盖（走中转站）；用户给的单价与压缩触发点叠加上去", async () => {
        const catalog: ProviderTarget = {id: "deepseek", template: "deepseek", follows: false, auth: "default", baseUrl: BASE};
        const built = buildResolution(catalog, {id: "deepseek-flash", compactAt: 50_000}, {stored: () => KEY, env: {}});
        if (!built.ok) throw new Error(built.code);
        expect(built.resolution.info).toMatchObject({id: "deepseek/deepseek-flash", compactAt: 50_000});
        expect(built.resolution.info.contextWindow).toBeGreaterThan(0);
        seen.length = 0;
        const response = await built.resolution.call(request, new AbortController().signal, () => undefined);
        expect(response.stopReason).toBe("stop");
        expect(seen[0]!.path).toBe("/v1/chat/completions");
        const unknownPrice = buildResolution(catalog, {id: "deepseek-flash", price: null}, {stored: () => KEY, env: {}});
        if (!unknownPrice.ok) throw new Error(unknownPrice.code);
        expect((await unknownPrice.resolution.call(request, new AbortController().signal, () => undefined)).usage.cost).toBeNull();
    });
});

describe("发现", () => {
    test("读 /models 时带上配置的请求头", async () => {
        seen.length = 0;
        const result = await discoverModels({api: "openai-completions", baseUrl: BASE, apiKey: KEY, headers: {"X-Team": "writing"}});
        expect(result.state).toBe("found");
        expect(seen[0]!.headers.get("x-team")).toBe("writing");
    });
});

describe("线上事实交给观察者（models.md 输出 20）", () => {
    // 按顺序回给每次 HTTP 请求的状态：429 带 `retry-after-ms: 0`，pi-ai 立刻重发；200 回一段文字。
    const plan: number[] = [];
    const wire = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        async fetch(incoming) {
            await incoming.text();
            const status = plan.shift() ?? 200;
            if (status === 429) return new Response(JSON.stringify({error: {message: "slow down"}}), {status, headers: {"content-type": "application/json", "retry-after-ms": "0", "x-ratelimit-remaining-requests": "0", "set-cookie": "s=1"}});
            if (status !== 200) return new Response(JSON.stringify({error: {message: "nope"}}), {status, headers: {"content-type": "application/json"}});
            const chunk = (body: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
            return new Response(chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]}) + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]}) + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
        },
    });
    afterAll(() => wire.stop(true));

    async function observe(statuses: number[]) {
        plan.splice(0, plan.length, ...statuses);
        const built = buildResolution(custom({baseUrl: `http://127.0.0.1:${wire.port}/v1`}), {id: "qwen3:8b", contextWindow: 32_000}, {stored: () => KEY, env: {}});
        if (!built.ok) throw new Error(built.code);
        const attempts: ModelWireAttempt[] = [];
        let firstContent = 0;
        const response = await built.resolution.call(request, new AbortController().signal, () => undefined, {observe: {attempt: (item) => void attempts.push(item), firstContent: () => void (firstContent += 1)}});
        return {response, attempts, firstContent};
    }

    test("每次 HTTP 尝试各交一次：地址、发出的头与体、响应状态与头；密钥原值已遮盖；第一块内容只报一次", async () => {
        const {response, attempts, firstContent} = await observe([429, 200]);
        expect(response.stopReason).toBe("stop");
        expect(attempts.map((item) => item.response?.status)).toEqual([429, 200]);
        expect(attempts[0]!.url).toEndWith("/chat/completions");
        expect(attempts[0]!.response!.headers["x-ratelimit-remaining-requests"]).toBe("0");
        expect(attempts[0]!.headers.authorization).toBe("Bearer [REDACTED]");
        expect(attempts[0]!.body).toContain("你好");
        expect(JSON.stringify(attempts)).not.toContain(KEY);
        expect(attempts.every((item) => item.endedAt >= item.startedAt)).toBe(true);
        expect(firstContent).toBe(1);
    });

    test("没有内容的失败：照样交尝试，不报第一块内容；不带观察者时照常请求", async () => {
        const failed = await observe([401]);
        expect(failed.response.stopReason).toBe("error");
        expect(failed.attempts.map((item) => item.response?.status)).toEqual([401]);
        expect(failed.firstContent).toBe(0);
        plan.splice(0, plan.length, 200);
        const built = buildResolution(custom({baseUrl: `http://127.0.0.1:${wire.port}/v1`}), {id: "qwen3:8b", contextWindow: 32_000}, {stored: () => KEY, env: {}});
        if (!built.ok) throw new Error(built.code);
        expect((await built.resolution.call(request, new AbortController().signal, () => undefined)).stopReason).toBe("stop");
    });
});

describe("模板的实例：身份、地址与发送前核对（models.md 输出 21）", () => {
    /** 跟随模板、只把地址指到本机端点（地区那样的“模板自己定的地址”）：发给 OMP 的身份是模板的 OMP id，专用处理照走。 */
    const follows = (patch: Partial<ProviderTarget> = {}): ProviderTarget => ({id: "moon", template: "moonshot", follows: true, auth: "default", baseUrl: BASE, ...patch});
    const model = chatModels("moonshot")[0]!.id;

    function resolved(provider: ProviderTarget, hooks: Parameters<typeof buildResolution>[3] = {}) {
        const built = buildResolution(provider, {id: model}, {stored: () => KEY, env: {}}, {transport: () => ({maxHttpAttempts: 1}), ...hooks});
        if (!built.ok) throw new Error(built.code);
        return built;
    }
    const sendOnce = async (built: ReturnType<typeof resolved>) => {
        seen.length = 0;
        return {response: await built.resolution.call(request, new AbortController().signal, () => undefined), paths: seen.map((item) => item.path)};
    };

    test("跟随模板时用模板的 OMP 身份与目录行；改了协议或地址的实例用中性身份、仍借目录里的能力字段；公开引用总是实例 id 加模型", () => {
        const following = resolved(follows());
        expect(following.model.provider).toBe("moonshot");
        expect(following.resolution.info.id).toBe(`moon/${model}`);
        const overridden = resolved(follows({follows: false, baseUrl: "https://gw.example.com/v1"}), {publicName: "gateway"});
        expect(overridden.model.provider).toBe("generic-endpoint");
        expect(overridden.resolution.info).toMatchObject({id: `gateway/${model}`, contextWindow: following.resolution.info.contextWindow});
        expect(overridden.baseUrl).toBe("https://gw.example.com/v1");
    });

    test("环境变量改写地址（连主机不变只改路径的也一样）：发出前被拦下，两个端点实收均为零，报 endpoint-mismatch", async () => {
        const built = resolved(follows());
        const original = process.env.MOONSHOT_BASE_URL;
        try {
            for (const rewritten of [`${BASE}/other`, `http://localhost:${server.port}/v1`]) {
                process.env.MOONSHOT_BASE_URL = rewritten;
                const {response, paths} = await sendOnce(built);
                expect(response.error).toMatchObject({kind: "local", code: "endpoint-mismatch"});
                expect(paths).toEqual([]);
            }
            delete process.env.MOONSHOT_BASE_URL;
            expect((await sendOnce(built)).paths).toEqual(["/v1/chat/completions"]);
        } finally {
            if (original === undefined) delete process.env.MOONSHOT_BASE_URL;
            else process.env.MOONSHOT_BASE_URL = original;
        }
    });

    test("解析之后实例被改了（stillCurrent 为假）：旧解析不再发请求", async () => {
        let current = true;
        const built = resolved(follows(), {stillCurrent: () => current});
        expect((await sendOnce(built)).paths).toEqual(["/v1/chat/completions"]);
        current = false;
        const stale = await sendOnce(built);
        expect(stale.response.error).toMatchObject({kind: "local", code: "endpoint-mismatch"});
        expect(stale.paths).toEqual([]);
    });

    test("免认证：请求里不带哨兵值的认证头；身份函数拿到有效协议、地址与密钥，签发身份写进回复的 origin", async () => {
        let effective: {api: string; baseUrl: string; key: string | null} | null = null;
        const built = resolved(follows({auth: "none"}), {identityOf: (value) => {
            effective = value;
            return {deployment: "d-1", legacyProvider: "moon"};
        }});
        seen.length = 0;
        const response = await built.resolution.call(request, new AbortController().signal, () => undefined);
        expect(seen[0]!.headers.get("authorization")).toBeNull();
        expect(effective).toMatchObject({api: "openai-completions", baseUrl: BASE});
        expect(response.origin).toMatchObject({provider: "moonshot", api: "openai-completions", deployment: "d-1"});
    });

    test("地址与协议按目录行：混合协议的模板各模型用各自的路由，换协议要有该协议的路由；OpenRouter 的复合协议换成显式的 Responses；没有这家或没有这个模型：unknown-model", () => {
        const zen = chatModels("opencode-zen");
        const byWire = (wire: string) => zen.find((item) => item.wire === wire)!;
        for (const wire of ["openai-completions", "anthropic-messages", "google-generative-ai", "openai-responses"] as const) {
            const built = buildResolution({id: "zen", template: "opencode-zen", follows: true, auth: "default"}, {id: byWire(wire).id}, {stored: () => KEY, env: {}});
            if (!built.ok) throw new Error(`${wire}: ${built.code}`);
            expect(built.api).toBe(wire);
            expect(built.baseUrl).toBe(byWire(wire).baseUrl);
        }
        const router = chatModels("openrouter")[0]!;
        const open = buildResolution({id: "or", template: "openrouter", follows: true, auth: "default"}, {id: router.id}, {stored: () => KEY, env: {}});
        if (!open.ok) throw new Error(open.code);
        expect(open.api).toBe("openai-responses");
        expect(open.model.api).toBe("openai-responses");
        expect(templateRoutes("opencode-zen").length).toBe(4);
        expect(buildResolution({id: "x", template: "moonshot", follows: false, api: "anthropic-messages", auth: "default"}, {id: model}, {stored: () => KEY, env: {}})).toEqual({ok: false, code: "unknown-model"});
        expect(buildResolution({id: "x", template: "moonshot", follows: true, auth: "default"}, {id: "no-such"}, {stored: () => KEY, env: {}})).toEqual({ok: false, code: "unknown-model"});
    });

    test("直连：进程环境设了 HTTP_PROXY 时模型请求照样直达端点，代理一次也没收到", async () => {
        let proxied = 0;
        const proxy = Bun.serve({port: 0, hostname: "127.0.0.1", fetch() {
            proxied += 1;
            return new Response("proxy", {status: 502});
        }});
        const names = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"] as const;
        const saved = new Map(names.map((name) => [name, process.env[name]] as const));
        try {
            for (const name of names.slice(0, 4)) process.env[name] = `http://127.0.0.1:${String(proxy.port)}`;
            // 空串而不是删掉：没设时运行时对回环地址可能自己就不走代理，测不出直连有没有生效。
            process.env.NO_PROXY = process.env.no_proxy = "";
            const {response, paths} = await sendOnce(resolved(follows()));
            expect(response.stopReason).toBe("stop");
            expect(paths).toEqual(["/v1/chat/completions"]);
            expect(proxied).toBe(0);
        } finally {
            for (const [name, value] of saved) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
            await proxy.stop(true);
        }
    });

    test("免认证只剥占位值：用户自己配的认证头（含同样的字符）照发", async () => {
        const built = resolved(follows({auth: "none", headers: {authorization: "Bearer team-N/A-token"}}));
        seen.length = 0;
        await built.resolution.call(request, new AbortController().signal, () => undefined);
        expect(seen[0]!.headers.get("authorization")).toBe("Bearer team-N/A-token");
    });

    test("OpenRouter 的复合协议按进程环境定：PI_OPENROUTER_RESPONSES 为 0 时是 Chat Completions，否则 Responses", () => {
        const saved = process.env.PI_OPENROUTER_RESPONSES;
        try {
            process.env.PI_OPENROUTER_RESPONSES = "0";
            expect(wireApiOf("openrouter")).toBe("openai-completions");
            delete process.env.PI_OPENROUTER_RESPONSES;
            expect(wireApiOf("openrouter")).toBe("openai-responses");
        } finally {
            if (saved === undefined) delete process.env.PI_OPENROUTER_RESPONSES;
            else process.env.PI_OPENROUTER_RESPONSES = saved;
        }
    });

    test("不能当对话模型发的目录行：图片生成等不进清单，解析得 transport-unsupported 并写明原因；不走 HTTP 的传输同样", () => {
        const image = listCatalog().find((item) => item.id === "google")!.models.find((row) => !row.chat)!;
        expect(chatModels("google").some((row) => row.id === image.id)).toBe(false);
        expect(unsendableReason("google", image.id)).toBe("not-chat");
        const google = {id: "g", template: "google", follows: true, auth: "default" as const};
        expect(buildResolution(google, {id: image.id}, {stored: () => KEY, env: {}})).toEqual({ok: false, code: "transport-unsupported", reason: "not-chat"});
        const bedrock = listCatalog().find((item) => item.id === "amazon-bedrock")!.models[0]!;
        expect(buildResolution({id: "b", template: "amazon-bedrock", follows: false, api: "openai-completions", baseUrl: BASE, auth: "default"}, {id: bedrock.id}, {stored: () => KEY, env: {}})).toEqual({ok: false, code: "transport-unsupported", reason: "transport"});
    });

    test("手加的模型不借目录行（目录后来有了同 id 的也一样），窗口要自己给；没覆盖协议时用模板的缺省协议", () => {
        const plain = follows({follows: false, defaultApi: "openai-completions"});
        expect(buildResolution(plain, {id: model, manual: true}, {stored: () => KEY, env: {}})).toEqual({ok: false, code: "unknown-model"});
        const manual = buildResolution(plain, {id: model, manual: true, contextWindow: 4096}, {stored: () => KEY, env: {}});
        if (!manual.ok) throw new Error(manual.code);
        expect(manual.resolution.info.contextWindow).toBe(4096);
        expect(manual.model.provider).toBe("generic-endpoint");
        const custom = buildResolution({id: "moon", template: "moonshot", follows: false, defaultApi: "openai-completions", baseUrl: BASE, auth: "default"}, {id: "my-local", manual: true, contextWindow: 8192}, {stored: () => KEY, env: {}});
        if (!custom.ok) throw new Error(custom.code);
        expect(custom.api).toBe("openai-completions");
    });

    test("wireGuard：各协议只放行自己会请求的完整地址（路径、查询、主机与端口都核对）", () => {
        const guard = (api: Parameters<typeof wireGuard>[0], base: string) => wireGuard(api, base);
        const allow = (check: ReturnType<typeof wireGuard>, url: string) => check(new URL(url)) === null;
        const completions = guard("openai-completions", "https://api.example.com/v1/");
        expect([allow(completions, "https://api.example.com/v1/chat/completions"), allow(completions, "https://api.example.com/other/v1/chat/completions"), allow(completions, "https://api.example.com/v1/chat/completions?x=1"), allow(completions, "http://api.example.com/v1/chat/completions"), allow(completions, "https://api.example.com:8443/v1/chat/completions"), allow(completions, "https://user:pw@api.example.com/v1/chat/completions"), allow(completions, "https://api.example.com/v1/responses")]).toEqual([true, false, false, false, false, false, false]);
        const anthropic = guard("anthropic-messages", "https://api.anthropic.com");
        expect([allow(anthropic, "https://api.anthropic.com/v1/messages"), allow(anthropic, "https://api.anthropic.com/v1/messages?beta=true"), allow(anthropic, "https://api.anthropic.com/v1/messages?foo=1"), allow(anthropic, "https://api.anthropic.com/v1/complete")]).toEqual([true, true, false, false]);
        const gemini = guard("google-generative-ai", "https://generativelanguage.googleapis.com/v1beta");
        expect([allow(gemini, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse"), allow(gemini, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent"), allow(gemini, "https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?key=SECRET"), allow(gemini, "https://generativelanguage.googleapis.com/v1/models/gemini-x:streamGenerateContent")]).toEqual([true, true, false, false]);
        expect(allow(guard("openai-responses", "https://x.example.com/api/v1"), "https://x.example.com/api/v1/responses")).toBe(true);
    });
});
