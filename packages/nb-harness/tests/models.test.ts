/**
 * `@notnotype/nb-harness/models`（docs/specs/models/service.md）：真的凭据库文件、本机起的 OpenAI 兼容端点（真实 HTTP、
 * 真实 OMP），经公开入口调用。这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readdir, readFile, stat, rm, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ModelRequest} from "@notnotype/nb-harness/kernel";
import {buildResolution, discoverModels, hasCredential, openCredentials, type ProviderTarget} from "@notnotype/nb-harness/models";

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
const custom = (patch: Partial<ProviderTarget> = {}): ProviderTarget => ({id: "local", kind: "custom", baseUrl: BASE, api: "openai-completions", auth: "default", ...patch});
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
        expect(buildResolution({id: "deepseek", kind: "catalog", auth: "default"}, {id: "no-such-model"}, access)).toEqual({ok: false, code: "unknown-model"});
        expect(buildResolution({id: "no-such-provider", kind: "catalog", auth: "default"}, {id: "m"}, access)).toEqual({ok: false, code: "unknown-model"});
    });

    test("目录服务商：能力与单价按目录，地址可以覆盖（走中转站）；用户给的单价与压缩触发点叠加上去", async () => {
        const catalog: ProviderTarget = {id: "deepseek", kind: "catalog", auth: "default", baseUrl: BASE};
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
