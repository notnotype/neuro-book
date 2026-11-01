/**
 * `nbook.models` 的服务端（docs/specs/models/service.md）：真实的服务端实例、设置文件与凭据库文件，窗口经真实的远程
 * 合同（JSON 编解码的链路）调用；模型请求发往本机起的 OpenAI 兼容端点。这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {CoreSettings, ModelQuery, ModelRequest} from "@notnotype/nb-harness/kernel/contracts";

import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";

import {modelsWorld} from "./testing/world";
import type {ModelsWorld} from "./testing/world";

const KEY = "sk-models-test-not-real-0001";
const seen: {path: string; authorization: string | null}[] = [];
let failNext = false;
const endpoint = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const path = new URL(request.url).pathname;
        seen.push({path, authorization: request.headers.get("authorization")});
        if (path.endsWith("/models")) return Response.json({object: "list", data: [{id: "qwen3:8b", object: "model"}, {id: "gemma3:12b", object: "model"}]});
        await request.text();
        if (failNext) {
            failNext = false;
            return Response.json({error: {message: `invalid key ${request.headers.get("authorization") ?? ""}`}}, {status: 401});
        }
        const chunk = (body: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...body})}\n\n`;
        return new Response(chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]}) + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]}) + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
    },
});
const BASE = `http://127.0.0.1:${endpoint.port}/v1`;

let root = "";
let counter = 0;
const worlds: ModelsWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-models", "service");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop(true);
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function world(env: Record<string, string> = {}): Promise<ModelsWorld> {
    counter += 1;
    const created = await modelsWorld(join(root, `world-${String(counter)}`), {env});
    worlds.push(created);
    return created;
}

const CORE: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};
const query = (patch: Partial<ModelQuery> = {}): ModelQuery => ({settings: CORE, purpose: "turn", profile: "test.profile", ...patch});
const request: ModelRequest = {purpose: "turn", model: "x", params: {maxTokens: 8}, headers: {}, system: [], messages: [{role: "user", content: [{kind: "text", text: "你好", origin: {kind: "fixed", by: "kernel"}}]}], tools: []};
const ok = <T>(result: {ok: boolean; value?: T; code?: string}): T => {
    if (!result.ok) throw new Error(`remote call failed: ${JSON.stringify(result)}`);
    return result.value as T;
};

/** 加一个指向本机端点的自定义服务商，带一个完整的模型。 */
async function addLocal(client: Awaited<ReturnType<ModelsWorld["window"]>>, name = "本地端点"): Promise<string> {
    const {id} = ok(await client.addProvider({source: {kind: "custom", name, baseUrl: BASE, api: "openai-completions"}}));
    ok(await client.upsertModel({provider: id, model: {id: "qwen3:8b", enabled: true, contextWindow: 32_000}}));
    return id;
}

describe("解析（输出 8）", () => {
    test("角色未绑定为 role-unbound；没密钥为 no-credentials；设了密钥后能用，请求带上它；会话选的模型与 Profile 默认先于角色", async () => {
        const w = await world();
        const client = await w.window("w");
        const port = w.service.port((profile) => (profile === "lab.writer" ? {role: "deep"} : profile === "lab.pinned" ? {model: "nope/model"} : {}));
        expect(port.resolve(query())).toEqual({ok: false, code: "role-unbound"});

        const id = await addLocal(client);
        expect(id).toBe("custom");
        ok(await client.setRole({id: "main", model: `${id}/qwen3:8b`}));
        expect(port.resolve(query())).toEqual({ok: false, code: "no-credentials"});

        expect(ok(await client.setKey({provider: id, value: KEY}))).toEqual({kind: "stored"});
        const resolution = port.resolve(query());
        if (!resolution.ok) throw new Error(resolution.code);
        expect(resolution.info.id).toBe(`${id}/qwen3:8b`);
        seen.length = 0;
        expect((await resolution.call(request, new AbortController().signal, () => undefined)).stopReason).toBe("stop");
        expect(seen[0]!.authorization).toBe(`Bearer ${KEY}`);

        expect(port.resolve(query({profile: "lab.writer"}))).toEqual({ok: false, code: "role-unbound"});
        expect(port.resolve(query({profile: "lab.pinned"}))).toEqual({ok: false, code: "unknown-model"});
        expect(port.resolve(query({settings: {...CORE, model: `${id}/qwen3:8b`}, profile: "lab.writer"})).ok).toBe(true);
        expect(port.resolve(query({purpose: "approval"}))).toEqual({ok: false, code: "role-unbound"});
        expect(port.resolve(query({purpose: "compaction", role: "main"})).ok).toBe(true);
    });

    test("第一次绑快速档时压缩跟着它（输出 14）；之后各改各的", async () => {
        const w = await world();
        const client = await w.window("w");
        const id = await addLocal(client);
        ok(await client.upsertModel({provider: id, model: {id: "gemma3:12b", enabled: true, contextWindow: 8_000}}));
        ok(await client.setRole({id: "fast", model: `${id}/qwen3:8b`}));
        const roles = () => Object.fromEntries(w.service.snapshot().roles.map((role) => [role.id, role.model]));
        expect(roles()).toMatchObject({fast: `${id}/qwen3:8b`, compaction: `${id}/qwen3:8b`});
        ok(await client.setRole({id: "fast", model: `${id}/gemma3:12b`}));
        expect(roles()).toMatchObject({fast: `${id}/gemma3:12b`, compaction: `${id}/qwen3:8b`});
    });
});

describe("配置的校验与写入（输出 5、6）", () => {
    test("自定义服务商的 id 由名字生成并去重；自定义模型启用时缺上下文窗口得 model-incomplete；删模型、删服务商时绑着的角色解除绑定", async () => {
        const w = await world();
        const client = await w.window("w");
        expect(ok(await client.addProvider({source: {kind: "custom", name: "Relay One", baseUrl: BASE, api: "openai-completions"}}))).toEqual({id: "relay-one"});
        expect(ok(await client.addProvider({source: {kind: "custom", name: "Relay One", baseUrl: BASE, api: "openai-completions"}}))).toEqual({id: "relay-one-2"});
        expect(ok(await client.addProvider({source: {kind: "custom", name: "火山方舟", baseUrl: BASE, api: "openai-completions"}}))).toEqual({id: "custom"});
        expect(ok(await client.addProvider({source: {kind: "custom", name: "deepseek", baseUrl: BASE, api: "openai-completions"}}))).toEqual({id: "deepseek-2"});
        expect(await client.upsertModel({provider: "relay-one", model: {id: "m", enabled: true}})).toMatchObject({ok: false, code: "model-incomplete"});
        ok(await client.upsertModel({provider: "relay-one", model: {id: "m", enabled: false}}));
        expect(w.service.snapshot().providers.find((provider) => provider.id === "relay-one")!.models[0]).toMatchObject({id: "m", status: "incomplete", enabled: false});

        ok(await client.upsertModel({provider: "relay-one", model: {id: "m", enabled: true, contextWindow: 4096}}));
        ok(await client.setRole({id: "main", model: "relay-one/m"}));
        ok(await client.removeModel({provider: "relay-one", id: "m"}));
        expect(w.service.snapshot().roles.find((role) => role.id === "main")).toMatchObject({model: null, status: "unbound"});
        ok(await client.upsertModel({provider: "relay-one", model: {id: "m", enabled: true, contextWindow: 4096}}));
        ok(await client.setRole({id: "deep", model: "relay-one/m"}));
        ok(await client.removeProvider({id: "relay-one"}));
        expect(w.service.snapshot().roles.find((role) => role.id === "deep")).toMatchObject({model: null, status: "unbound"});
        expect(await client.removeRole({id: "main"})).toMatchObject({ok: false, code: "builtin-role"});
    });

    test("两个窗口同时改不同的服务商，两处都在；设置文件被别处改过时重读后再合并，别处的内容不丢", async () => {
        const w = await world();
        const a = await w.window("a");
        const b = await w.window("b");
        const first = ok(await a.addProvider({source: {kind: "custom", name: "one", baseUrl: BASE, api: "openai-completions"}})).id;
        const second = ok(await a.addProvider({source: {kind: "custom", name: "two", baseUrl: BASE, api: "openai-completions"}})).id;
        await Promise.all([a.updateProvider({id: first, patch: {name: "第一家"}}), b.updateProvider({id: second, patch: {name: "第二家"}})]);
        expect(w.service.snapshot().providers.map((provider) => provider.name)).toEqual(["第一家", "第二家"]);

        // 别处直接改了设置文件（同设置文件视图、外部编辑）：本实例的视图还没跟上时写入撞上 conflict，等视图跟上后在新值上再合并。
        const file = JSON.parse(await readFile(w.settings.userFile, "utf8")) as Record<string, unknown>;
        const providers = file["nbook.models/providers"] as Array<Record<string, unknown>>;
        providers.push({id: "outside", kind: "custom", name: "外面加的", baseUrl: BASE, api: "openai-completions", auth: "default", models: []});
        await writeFile(w.settings.userFile, JSON.stringify(file));
        const writing = a.updateProvider({id: first, patch: {name: "第一家（改）"}});
        // 文件变化的重读按设置场地的手动时钟合并；推着时钟走，让拥有者重读。
        await waitUntil("服务端看到别处加的服务商", () => {
            w.settings.clock.advance(RELOAD_DELAY_MS);
            return w.service.snapshot().providers.some((provider) => provider.id === "outside");
        });
        expect(await writing).toEqual({ok: true, value: null});
        expect(w.service.snapshot().providers.map((provider) => provider.name)).toEqual(["第一家（改）", "第二家", "外面加的"]);
    });
});

describe("密钥（输出 1、2、12、13）", () => {
    test("env: 存成 apiKeyEnv 并清掉库里的密钥，只认启动环境；原文写库并清掉 apiKeyEnv；密钥不出现在任何响应、事件与诊断里", async () => {
        const w = await world({NB_MODELS_KEY: "sk-from-startup-env-0001"});
        const client = await w.window("w");
        const id = await addLocal(client);
        const events: unknown[] = [];
        const subscribed = await client.events.changed.subscribe({}, (payload) => events.push(payload));
        expect(subscribed.ok).toBe(true);

        expect(ok(await client.setKey({provider: id, value: KEY}))).toEqual({kind: "stored"});
        expect(ok(await client.setKey({provider: id, value: "env:NB_MODELS_KEY"}))).toEqual({kind: "env", name: "NB_MODELS_KEY", found: true});
        expect(ok(await client.setKey({provider: id, value: "env:NB_NOT_SET"}))).toEqual({kind: "env", name: "NB_NOT_SET", found: false});
        expect(await client.setKey({provider: id, value: "env:1bad"})).toMatchObject({ok: false, code: "invalid-value"});
        expect(ok(await client.setKey({provider: id, value: KEY}))).toEqual({kind: "stored"});
        expect(ok(await client.clearKey({provider: id}))).toEqual({kind: "none"});
        expect(ok(await client.setKey({provider: id, value: KEY}))).toEqual({kind: "stored"});

        const settingsText = await readFile(w.settings.userFile, "utf8");
        const everything = JSON.stringify([ok(await client.snapshot({})), events, w.settings.diagnostics("hub").query({}).records]) + settingsText;
        expect(everything).not.toContain(KEY);
        expect(everything).not.toContain("sk-from-startup-env-0001");
        expect(events.length).toBeGreaterThan(1);
    });
});

describe("检测与发现（输出 11、12）", () => {
    test("检测通过或给出失败的类别与遮盖过的原文；拉取 /models 的结果带着；目录服务商与非 OpenAI 兼容的不支持拉取", async () => {
        const w = await world();
        const client = await w.window("w");
        const id = await addLocal(client);
        ok(await client.setKey({provider: id, value: KEY}));
        expect(ok(await client.check({provider: id, model: "qwen3:8b"}))).toEqual({ok: true});
        failNext = true;
        const failed = ok(await client.check({provider: id, model: "qwen3:8b"}));
        expect(failed).toMatchObject({ok: false, kind: "auth"});
        expect(JSON.stringify(failed)).not.toContain(KEY);
        expect(ok(await client.checkAll({provider: id}))).toEqual([{model: "qwen3:8b", result: {ok: true}}]);
        expect(ok(await client.discover({provider: id})).map((model) => model.id).sort()).toEqual(["gemma3:12b", "qwen3:8b"]);
        ok(await client.addProvider({source: {kind: "catalog", id: "deepseek"}}));
        expect(await client.discover({provider: "deepseek"})).toMatchObject({ok: false, code: "not-supported"});
        expect(ok(await client.catalogModels({provider: "deepseek"})).length).toBeGreaterThan(0);
        expect(ok(await client.catalogProviders({})).find((provider) => provider.id === "deepseek")).toMatchObject({added: true});
    });
});

describe("目录漂移（输出 9）", () => {
    test("设置里的目录模型不在目录里了：快照标 missing、绑着它的角色 unknown-model、写一条诊断", async () => {
        const w = await world();
        const client = await w.window("w");
        ok(await client.addProvider({source: {kind: "catalog", id: "deepseek"}}));
        ok(await client.upsertModel({provider: "deepseek", model: {id: "deepseek-retired", enabled: true}}));
        ok(await client.setRole({id: "main", model: "deepseek/deepseek-retired"}));
        const snapshot = w.service.snapshot();
        expect(snapshot.providers[0]!.models[0]).toMatchObject({id: "deepseek-retired", status: "missing"});
        expect(snapshot.roles.find((role) => role.id === "main")!.status).toBe("unknown-model");
        expect(w.service.port().resolve(query())).toEqual({ok: false, code: "unknown-model"});
        expect(w.settings.diagnostics("hub").query({}).records.some((record) => record.event === "models.catalog.missing")).toBe(true);
    });
});
