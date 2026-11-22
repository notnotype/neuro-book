/**
 * `nbook.models` 的服务端（docs/specs/models/service.md）：真实的服务端实例、设置文件与凭据库文件，窗口经真实的远程
 * 合同（JSON 编解码的链路）调用；模型请求发往本机起的 OpenAI 兼容端点。这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {readFileSync} from "node:fs";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import type {CoreSettings, ModelQuery, ModelRequest} from "@notnotype/nb-harness/kernel/contracts";

import {RELOAD_DELAY_MS} from "nbook/plugins/settings/backend/layer-owner";

import type {ModelRow} from "./shared/contracts";
import {modelsWorld} from "./testing/world";
import type {ModelsWorld} from "./testing/world";

const KEY = "sk-models-test-not-real-0001";
const seen: {path: string; authorization: string | null}[] = [];
let failNext = false;
let overloadedNext = false;
const endpoint = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const path = new URL(request.url).pathname;
        seen.push({path, authorization: request.headers.get("authorization")});
        if (path.endsWith("/models")) return Response.json({object: "list", data: [{id: "qwen3:8b", object: "model"}, {id: "gemma3:12b", object: "model"}]});
        await request.text();
        // 只会说 OpenAI Chat Completions：别的协议的路径一律 404（协议检测的那三行）。
        if (!path.endsWith("/chat/completions")) return Response.json({error: {message: `no route ${path}`}}, {status: 404});
        if (overloadedNext) {
            overloadedNext = false;
            return Response.json({error: {message: "Service overloaded"}}, {status: 503});
        }
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

type Client = Awaited<ReturnType<ModelsWorld["window"]>>;

/** 读一家的全部模型行（`providerModels` 按页读完）。 */
async function rowsOf(client: Client, provider: string, scope: "listed" | "available" = "listed") {
    const rows = [];
    let revision: string | undefined;
    for (let offset: number | null = 0; offset !== null;) {
        const page: {revision: string; nextOffset: number | null; rows: ModelRow[]} = ok(await client.providerModels({provider, scope, offset, limit: 200, ...(revision === undefined ? {} : {revision})}));
        revision = page.revision;
        rows.push(...page.rows);
        offset = page.nextOffset;
    }
    return rows;
}

/** 加一个指向本机端点的空白模板服务商，带一个完整的模型。 */
async function addLocal(client: Awaited<ReturnType<ModelsWorld["window"]>>, name = "本地端点"): Promise<string> {
    const {id} = ok(await client.addProvider({template: "blank-openai", name, baseUrl: BASE, api: "openai-completions"}));
    ok(await client.upsertModel({provider: id, model: {id: "qwen3:8b", enabled: true, contextWindow: 32_000}}));
    return id;
}

describe("压缩的触发点（输出 17）", () => {
    /** 一个窗口 20 万的模型，绑在 main 上，交回端口与客户端。 */
    async function bound(compaction: Record<string, unknown> = {}): Promise<{w: ModelsWorld; client: Awaited<ReturnType<ModelsWorld["window"]>>; id: string; trigger: () => number | undefined}> {
        const w = await world();
        const client = await w.window("w");
        const {id} = ok(await client.addProvider({template: "blank-openai", name: "本地端点", baseUrl: BASE, api: "openai-completions"}));
        ok(await client.upsertModel({provider: id, model: {id: "big", enabled: true, contextWindow: 200_000, ...compaction}}));
        ok(await client.setRole({id: "main", model: `${id}/big`}));
        ok(await client.setKey({provider: id, value: KEY}));
        const port = w.service.port();
        return {w, client, id, trigger: () => {
            const resolution = port.resolve(query());
            if (!resolution.ok) throw new Error(resolution.code);
            return resolution.info.compactAt;
        }};
    }

    test("缺省不给触发点（内核按窗口留预留量）；按模型的配置算成 token 数交给内核；快照里也是新的形状", async () => {
        const plain = await bound();
        expect(plain.trigger()).toBeUndefined();
        const percent = await bound({compaction: {mode: "percent", value: 50}});
        expect(percent.trigger()).toBe(100_000);
        expect((await rowsOf(percent.client, percent.id))[0]!.compaction).toEqual({mode: "percent", value: 50});
        const reserve = await bound({compaction: {mode: "reserve", value: 100_000}});
        expect(reserve.trigger()).toBe(83_616);
    });

    test("旧配置的 compactAt 读作固定的触发点，快照给新形状；再保存时换成新的", async () => {
        const old = await bound({compactAt: 40_000});
        expect(old.trigger()).toBe(40_000);
        const snapshotModel = (await rowsOf(old.client, old.id))[0]!;
        expect(snapshotModel.compaction).toEqual({mode: "tokens", value: 40_000});
        ok(await old.client.upsertModel({provider: old.id, model: {id: "big", enabled: true, contextWindow: 200_000, compaction: snapshotModel.compaction!}}));
        const file = JSON.parse(readFileSync(old.w.settings.userFile, "utf8")) as {"nbook.models/providers": Array<{models: Array<Record<string, unknown>>}>};
        expect(file["nbook.models/providers"][0]!.models[0]).not.toHaveProperty("compactAt");
        expect(old.trigger()).toBe(40_000);
    });

    test("全局设置在没有按模型配置时生效，设置改了从下一次解析起跟着变；按模型的配置盖过全局", async () => {
        const world = await bound();
        const {w} = world;
        const setGlobal = async (value: unknown): Promise<void> => {
            const file = JSON.parse(await readFile(w.settings.userFile, "utf8")) as Record<string, unknown>;
            file["nbook.models/compaction"] = value;
            await writeFile(w.settings.userFile, JSON.stringify(file));
        };
        await setGlobal({mode: "percent", value: 25});
        await waitUntil("全局的触发点生效", () => {
            w.settings.clock.advance(RELOAD_DELAY_MS);
            return world.trigger() === 50_000;
        });
        const override = await bound({compaction: {mode: "tokens", value: 70_000}});
        const file = JSON.parse(await readFile(override.w.settings.userFile, "utf8")) as Record<string, unknown>;
        file["nbook.models/compaction"] = {mode: "percent", value: 25};
        await writeFile(override.w.settings.userFile, JSON.stringify(file));
        await waitUntil("全局设置已读到", () => {
            override.w.settings.clock.advance(RELOAD_DELAY_MS);
            return JSON.stringify(override.w.service.snapshot()).length > 0;
        });
        expect(override.trigger()).toBe(70_000);
    });
});

describe("解析（输出 8）", () => {
    test("角色未绑定为 role-unbound；没密钥为 no-credentials；设了密钥后能用，请求带上它；会话选的模型与 Profile 默认先于角色", async () => {
        const w = await world();
        const client = await w.window("w");
        const port = w.service.port((profile) => (profile === "lab.writer" ? {role: "deep"} : profile === "lab.pinned" ? {model: "nope/model"} : {}));
        // 失败带上走到的角色；没密钥时还带卡住的服务商（输出 8）。
        expect(port.resolve(query())).toEqual({ok: false, code: "role-unbound", role: "main"});

        const id = await addLocal(client);
        expect(id).toBe("provider");
        ok(await client.setRole({id: "main", model: `${id}/qwen3:8b`}));
        expect(port.resolve(query())).toEqual({ok: false, code: "no-credentials", role: "main", provider: id});

        expect(ok(await client.setKey({provider: id, value: KEY}))).toEqual({kind: "stored"});
        const resolution = port.resolve(query());
        if (!resolution.ok) throw new Error(resolution.code);
        expect(resolution.info.id).toBe(`${id}/qwen3:8b`);
        seen.length = 0;
        expect((await resolution.call(request, new AbortController().signal, () => undefined)).stopReason).toBe("stop");
        expect(seen[0]!.authorization).toBe(`Bearer ${KEY}`);

        expect(port.resolve(query({profile: "lab.writer"}))).toEqual({ok: false, code: "role-unbound", role: "deep"});
        expect(port.resolve(query({profile: "lab.pinned"}))).toEqual({ok: false, code: "unknown-model"});
        expect(port.resolve(query({settings: {...CORE, model: `${id}/qwen3:8b`}, profile: "lab.writer"})).ok).toBe(true);
        expect(port.resolve(query({purpose: "approval"}))).toEqual({ok: false, code: "role-unbound", role: "fast"});
        expect(port.resolve(query({purpose: "compaction", role: "main"})).ok).toBe(true);
    });

    test("会话选角色：跟着绑定走；没绑定是 role-unbound；角色不存在与空的是 unknown-model", async () => {
        const w = await world();
        const client = await w.window("w");
        const port = w.service.port();
        const choose = (model: string) => port.resolve(query({settings: {...CORE, model}}));
        expect(choose("role:deep")).toEqual({ok: false, code: "role-unbound", role: "deep"});
        expect(choose("role:没有这个角色")).toEqual({ok: false, code: "unknown-model"});
        expect(choose("role:")).toEqual({ok: false, code: "unknown-model"});

        const id = await addLocal(client);
        ok(await client.setKey({provider: id, value: KEY}));
        ok(await client.setRole({id: "deep", model: `${id}/qwen3:8b`}));
        const bound = choose("role:deep");
        if (!bound.ok) throw new Error(bound.code);
        expect(bound.info.id).toBe(`${id}/qwen3:8b`);
        // 用途指名的角色仍然优先：压缩不跟着会话选的走。
        expect(port.resolve(query({settings: {...CORE, model: "role:deep"}, purpose: "compaction"}))).toEqual({ok: false, code: "role-unbound", role: "compaction"});
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
    test("服务商的 id 由名字生成并去重；手加的模型启用时缺上下文窗口得 model-incomplete；删模型、删服务商时绑着的角色解除绑定", async () => {
        const w = await world();
        const client = await w.window("w");
        const blank = (name: string) => ({template: "blank-openai", name, baseUrl: BASE, api: "openai-completions"}) as const;
        expect(ok(await client.addProvider(blank("Relay One")))).toEqual({id: "relay-one"});
        expect(ok(await client.addProvider(blank("Relay One")))).toEqual({id: "relay-one-2"});
        expect(w.service.snapshot().providers.map((provider) => provider.name)).toEqual(["Relay One", "Relay One 2"]);
        expect(ok(await client.addProvider(blank("火山方舟")))).toEqual({id: "provider"});
        expect(ok(await client.addProvider(blank("deepseek")))).toEqual({id: "deepseek"});
        expect(await client.upsertModel({provider: "relay-one", model: {id: "m", enabled: true}})).toMatchObject({ok: false, code: "model-incomplete"});
        ok(await client.upsertModel({provider: "relay-one", model: {id: "m", enabled: false}}));
        expect((await rowsOf(client, "relay-one"))[0]).toMatchObject({id: "m", status: "incomplete", enabled: false, origin: "manual"});

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

    test("来源模型只存用户改过的：与目录相同的名字、推出来的系列、能力与单价、空的请求头都不写进设置；改过的字段行上标出，行照样合出目录的值", async () => {
        const w = await world();
        const client = await w.window("w");
        const {id} = ok(await client.addProvider({template: "deepseek"}));
        const row = (await rowsOf(client, id)).find((item) => item.id === "deepseek-flash")!;
        ok(await client.upsertModel({provider: id, model: {id: row.id, enabled: true, name: row.name, group: "deepseek", contextWindow: row.contextWindow!, vision: row.vision, price: row.price!, headers: {}}}));
        const stored = () => (JSON.parse(readFileSync(w.settings.userFile, "utf8")) as {"nbook.models/providers": Array<{id: string; models: unknown[]}>})["nbook.models/providers"].find((provider) => provider.id === id)!.models;
        // 与来源值相同的字段一个都不存；开着自动加入时只含启用的来源条目没有信息量，也不存。
        expect(stored()).toEqual([]);
        expect(await rowsOf(client, id)).toContainEqual(expect.objectContaining({id: "deepseek-flash", name: row.name, contextWindow: row.contextWindow, overridden: []}));

        ok(await client.upsertModel({provider: id, model: {id: "deepseek-flash", enabled: true, name: "快", group: "常用", compaction: {mode: "tokens", value: 50_000}, headers: {"X-Team": "writing"}}}));
        expect(stored()).toEqual([{id: "deepseek-flash", enabled: true, origin: "source", name: "快", group: "常用", compaction: {mode: "tokens", value: 50_000}, headers: {"X-Team": "writing"}}]);
        expect((await rowsOf(client, id)).find((item) => item.id === "deepseek-flash")).toMatchObject({name: "快", overridden: ["name"]});
    });

    test("两个窗口同时改不同的服务商，两处都在；设置文件被别处改过时重读后再合并，别处的内容不丢", async () => {
        const w = await world();
        const a = await w.window("a");
        const b = await w.window("b");
        const first = ok(await a.addProvider({template: "blank-openai", name: "one", baseUrl: BASE, api: "openai-completions"})).id;
        const second = ok(await a.addProvider({template: "blank-openai", name: "two", baseUrl: BASE, api: "openai-completions"})).id;
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

describe("v1 设置文件与图标路由（输入与前置条件、输出 21）", () => {
    test("真实设置文件里 v1 形状的服务商被设置的形状校验接受、按旧语义读；第一次写入整份换成 v2；没碰的目录服务商也一起换，旧运行时忽略的字段丢弃", async () => {
        const w = await world();
        const client = await w.window("w");
        const file = JSON.parse(await readFile(w.settings.userFile, "utf8").catch(() => "{}")) as Record<string, unknown>;
        file["nbook.models/providers"] = [
            {id: "deepseek", kind: "catalog", name: "DeepSeek", auth: "default", models: [{id: "deepseek-flash", enabled: true, contextWindow: 7, vision: true}]},
            {id: "local", kind: "custom", name: "本机", baseUrl: BASE, api: "openai-completions", auth: "none", models: [{id: "m", enabled: true, contextWindow: 32_000}]},
        ];
        await writeFile(w.settings.userFile, JSON.stringify(file));
        await waitUntil("服务端读到 v1 的两家", () => {
            w.settings.clock.advance(RELOAD_DELAY_MS);
            return w.service.snapshot().providers.length === 2;
        });
        expect(w.service.snapshot().providers.map((provider) => [provider.id, provider.template, provider.followSource, provider.modelCount])).toEqual([["deepseek", "deepseek", false, 1], ["local", "blank-openai", false, 1]]);
        ok(await client.setRole({id: "main", model: "local/m"}));
        expect(w.service.port().resolve(query()).ok).toBe(true);
        ok(await client.updateProvider({id: "local", patch: {name: "本机模型"}}));
        const written = (JSON.parse(readFileSync(w.settings.userFile, "utf8")) as {"nbook.models/providers": Array<Record<string, unknown>>})["nbook.models/providers"];
        expect(written.map((provider) => provider.uid)).toEqual(["legacy:deepseek", "legacy:local"]);
        expect(written.every((provider) => !("kind" in provider))).toBe(true);
        expect(written[0]!.models).toEqual([{id: "deepseek-flash", enabled: true, origin: "source"}]);
    });

    test("设置文件里服务商这一项不合形状（设置层拒收、原文还在）：添加服务商被拒，不把它当成空表整份盖掉", async () => {
        const w = await world();
        const client = await w.window("w");
        ok(await client.addProvider({template: "deepseek"}));
        const file = JSON.parse(await readFile(w.settings.userFile, "utf8")) as Record<string, unknown>;
        const broken = [{id: "Not A Valid Id!", name: "手改坏的"}];
        file["nbook.models/providers"] = broken;
        await writeFile(w.settings.userFile, JSON.stringify(file));
        await waitUntil("服务端读到被拒收的值", () => {
            w.settings.clock.advance(RELOAD_DELAY_MS);
            return w.service.snapshot().providers.length === 0;
        });
        const result = await client.addProvider({template: "moonshot"});
        expect(result).toMatchObject({ok: false, code: "settings-unavailable"});
        expect((JSON.parse(readFileSync(w.settings.userFile, "utf8")) as Record<string, unknown>)["nbook.models/providers"]).toEqual(broken);
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

describe("检测（输出 11、12）", () => {
    test("检测通过或给出失败的类别与遮盖过的原文", async () => {
        const w = await world();
        const client = await w.window("w");
        const id = await addLocal(client);
        ok(await client.setKey({provider: id, value: KEY}));
        expect(ok(await client.check({provider: id, model: "qwen3:8b"}))).toEqual({ok: true});
        failNext = true;
        const failed = ok(await client.check({provider: id, model: "qwen3:8b"}));
        expect(failed).toMatchObject({ok: false, kind: "auth"});
        expect(JSON.stringify(failed)).not.toContain(KEY);
        expect(ok(await client.templates({})).find((template) => template.id === "deepseek")).toMatchObject({addable: true});
    });
});

describe("协议检测（输出 26）", () => {
    test("四种协议各发一次，只有端点会说的那种通过；采纳交回那一行的连接版本，写进去的正是试过的配置，地址或密钥此后变过就拒绝", async () => {
        const w = await world();
        const client = await w.window("w");
        const id = await addLocal(client);
        expect(await client.detectApi({provider: id})).toMatchObject({ok: false, code: "no-credentials"});
        ok(await client.setKey({provider: id, value: KEY}));
        seen.length = 0;
        const detection = ok(await client.detectApi({provider: id}));
        expect(detection.model).toBe("qwen3:8b");
        expect(detection.connection).toBe(w.service.snapshot().providers.find((item) => item.id === id)!.connection);
        expect(detection.results.map((row) => [row.api, row.ok, row.status])).toEqual([
            ["openai-completions", true, 200],
            ["openai-responses", false, 404],
            ["anthropic-messages", false, 404],
            ["google-generative-ai", false, 404],
        ]);
        expect(detection.results.every((row) => row.baseUrl === BASE)).toBe(true);
        expect(detection.results[1]!.message).toContain("no route");
        // 每种协议恰好一次（OMP 对 Responses、Anthropic 的失败会在内层重发）。
        expect(seen.map((item) => item.path).sort()).toEqual(detection.results.map((row) => new URL(row.url!).pathname).sort());
        expect(seen).toHaveLength(4);
        expect(JSON.stringify(detection)).not.toContain(KEY);

        // 当前协议那一行的连接版本就是检测时的。
        expect(detection.results[0]!.connection).toBe(detection.connection);
        const responses = detection.results[1]!;
        ok(await client.adoptApi({provider: id, api: "openai-responses", connection: responses.connection}));
        const adopted = w.service.snapshot().providers.find((item) => item.id === id)!;
        expect(adopted).toMatchObject({api: "openai-responses", baseUrl: BASE, connection: responses.connection});
        // 同一次检测的别的行照样能采纳（改用它之后的配置没变）。
        ok(await client.adoptApi({provider: id, api: "openai-completions", connection: detection.results[0]!.connection}));
        expect(w.service.snapshot().providers.find((item) => item.id === id)!.connection).toBe(detection.connection);
        // 检测之后改了地址：试过的配置不在了，不写。
        ok(await client.updateProvider({id, patch: {baseUrl: `${BASE}/other`}}));
        expect(await client.adoptApi({provider: id, api: "openai-responses", connection: responses.connection})).toMatchObject({ok: false, code: "connection-changed"});
        // 换了密钥也一样（认证输入进连接版本）。
        ok(await client.updateProvider({id, patch: {baseUrl: BASE}}));
        const again = ok(await client.detectApi({provider: id}));
        ok(await client.setKey({provider: id, value: `${KEY}-2`}));
        expect(await client.adoptApi({provider: id, api: "openai-responses", connection: again.results[1]!.connection})).toMatchObject({ok: false, code: "connection-changed"});
        expect(w.service.snapshot().providers.find((item) => item.id === id)!.api).toBe("openai-completions");
    });

    test("没有可用的模型时为 no-model，给了模型 id（不在列表里的也行）照样检测；目录模板选回模板的协议恢复跟随", async () => {
        const w = await world();
        const client = await w.window("w");
        const {id} = ok(await client.addProvider({template: "blank-openai", name: "空的", baseUrl: BASE, api: "openai-completions"}));
        ok(await client.setKey({provider: id, value: KEY}));
        expect(await client.detectApi({provider: id})).toMatchObject({ok: false, code: "no-model"});
        const typed = ok(await client.detectApi({provider: id, model: "typed-model"}));
        expect(typed.model).toBe("typed-model");
        expect(typed.results[0]).toMatchObject({api: "openai-completions", ok: true});

        const {id: deepseek} = ok(await client.addProvider({template: "deepseek", baseUrl: BASE}));
        ok(await client.setKey({provider: deepseek, value: KEY}));
        const before = w.service.snapshot().providers.find((item) => item.id === deepseek)!;
        const first = ok(await client.detectApi({provider: deepseek}));
        expect(first.results.every((row) => row.baseUrl === BASE)).toBe(true);
        ok(await client.adoptApi({provider: deepseek, api: "openai-responses", connection: first.results[1]!.connection}));
        expect(w.service.snapshot().providers.find((item) => item.id === deepseek)!.api).toBe("openai-responses");
        const back = first.results.find((row) => row.api === before.templateApi)!;
        ok(await client.adoptApi({provider: deepseek, api: back.api, connection: back.connection}));
        const restored = w.service.snapshot().providers.find((item) => item.id === deepseek)!;
        expect(restored.api).toBe(before.templateApi);
        expect(restored.connection).toBe(before.connection);
    });

    test("混合协议的模板：每行发的就是那一行的协议，采纳模板的缺省协议也钉住；凭据按与发请求同一份合好的请求头预检；结果里的地址不带凭据", async () => {
        const w = await world({TENANT: "tenant-a"});
        const client = await w.window("w");
        // OpenCode Zen 没有覆盖时每个模型按目录各用各的协议（gemini-3-flash 用 Gemini）。
        const {id: zen} = ok(await client.addProvider({template: "opencode-zen", baseUrl: BASE}));
        ok(await client.setKey({provider: zen, value: KEY}));
        seen.length = 0;
        const mixed = ok(await client.detectApi({provider: zen, model: "gemini-3-flash"}));
        expect(seen.map((item) => item.path).sort()).toEqual(["/v1/chat/completions", "/v1/messages", "/v1/models/gemini-3-flash:streamGenerateContent", "/v1/responses"]);
        const completions = mixed.results.find((row) => row.api === "openai-completions")!;
        expect(completions.ok).toBe(true);
        ok(await client.adoptApi({provider: zen, api: "openai-completions", connection: completions.connection}));
        seen.length = 0;
        expect(ok(await client.check({provider: zen, model: "gemini-3-flash"}))).toEqual({ok: true});
        expect(seen.map((item) => item.path)).toEqual(["/v1/chat/completions"]);

        const local = await addLocal(client);
        ok(await client.setKey({provider: local, value: KEY}));
        const plain = w.service.snapshot().providers.find((item) => item.id === local)!.connection;
        ok(await client.updateProvider({id: local, patch: {headers: {"x-tenant": "env:ABSENT"}}}));
        // 引用的环境变量没有值也进连接版本：之前的检测结果对不上了。
        expect(w.service.snapshot().providers.find((item) => item.id === local)!.connection).not.toBe(plain);
        expect(await client.detectApi({provider: local})).toMatchObject({ok: false, code: "no-credentials"});
        // 模型级的同名头盖过服务商级的（输出 4）：发出去的有值，检测照常。
        ok(await client.upsertModel({provider: local, model: {id: "qwen3:8b", enabled: true, contextWindow: 32_000, headers: {"x-tenant": "env:TENANT"}}}));
        expect(ok(await client.detectApi({provider: local})).results[0]).toMatchObject({api: "openai-completions", ok: true});
        ok(await client.updateProvider({id: local, patch: {headers: {}}}));
        ok(await client.upsertModel({provider: local, model: {id: "qwen3:8b", enabled: true, contextWindow: 32_000, headers: {"x-tenant": "env:ABSENT"}}}));
        expect(await client.detectApi({provider: local})).toMatchObject({ok: false, code: "no-credentials"});

        ok(await client.upsertModel({provider: local, model: {id: "qwen3:8b", enabled: true, contextWindow: 32_000}}));
        const port = new URL(BASE).port;
        ok(await client.updateProvider({id: local, patch: {baseUrl: `http://fixture-user:fixture-pass@127.0.0.1:${port}/v1?token=fixture-query`}}));
        const shown = ok(await client.detectApi({provider: local}));
        expect(shown.results.every((row) => row.baseUrl === BASE)).toBe(true);
        expect(JSON.stringify(shown)).not.toMatch(/fixture-pass|fixture-query/u);
    });
});

describe("模型来源", () => {
    test("自动更新开着（真实设置）：设好密钥就去拉列表；关着时设密钥不出站", async () => {
        const on = await modelsWorld(join(root, "sources-auto-on"), {autoUpdate: true});
        worlds.push(on);
        const client = await on.window("w");
        const id = await addLocal(client);
        seen.length = 0;
        ok(await client.setKey({provider: id, value: KEY}));
        await waitUntil("the list arrives", () => on.service.snapshot().providers.find((item) => item.id === id)?.source.state === "ok" || undefined);
        expect(seen.filter((item) => item.path === "/v1/models")).toHaveLength(1);

        const off = await world();
        const quiet = await off.window("w");
        const other = await addLocal(quiet);
        seen.length = 0;
        ok(await quiet.setKey({provider: other, value: KEY}));
        // 排一个走同一个端点、看得见的动作（检测），等它完成后再看有没有列表请求。
        expect(ok(await quiet.check({provider: other, model: "qwen3:8b"}))).toEqual({ok: true});
        expect(seen.map((item) => item.path)).toEqual(["/v1/chat/completions"]);
    });

    test("重新拉取读服务商的列表，结果经快照交回；列表存在状态根，重启后不出站也在；没有密钥时不出站", async () => {
        const dir = join(root, "sources-restart");
        const first = await modelsWorld(dir);
        worlds.push(first);
        const client = await first.window("w");
        const id = await addLocal(client);
        expect(await client.refreshSource({provider: id})).toMatchObject({ok: false, code: "no-credentials"});
        ok(await client.setKey({provider: id, value: KEY}));
        seen.length = 0;
        expect(ok(await client.refreshSource({provider: id}))).toBeNull();
        await waitUntil("the list arrives", () => {
            const source = first.service.snapshot().providers.find((item) => item.id === id)?.source;
            return source?.state === "ok" && !source.refreshing ? source : undefined;
        });
        expect(seen).toEqual([{path: "/v1/models", authorization: `Bearer ${KEY}`}]);
        // 手加的 qwen3:8b 仍是手加的；列表里多出的 gemma3:12b 类型不明、没有窗口：列出、待补字段。
        const rows = await rowsOf(client, id);
        expect(rows.map((row) => [row.id, row.origin, row.status]).sort()).toEqual([["gemma3:12b", "source", "incomplete"], ["qwen3:8b", "manual", "ok"]]);
        await first.close();
        worlds.splice(worlds.indexOf(first), 1);

        seen.length = 0;
        const second = await modelsWorld(dir);
        worlds.push(second);
        const again = await second.window("w");
        expect((await rowsOf(again, id)).map((row) => row.id).sort()).toEqual(["gemma3:12b", "qwen3:8b"]);
        expect(seen).toEqual([]);
    });
});

describe("请求的传输（输出 16）", () => {
    test("重发归内核：服务商 503 时只发一次，失败交回可重发；检测也一样", async () => {
        const w = await world();
        const client = await w.window("w");
        const id = await addLocal(client);
        ok(await client.setKey({provider: id, value: KEY}));
        ok(await client.setRole({id: "main", model: `${id}/qwen3:8b`}));
        const resolution = w.service.port().resolve(query());
        if (!resolution.ok) throw new Error(resolution.code);
        seen.length = 0;
        overloadedNext = true;
        const response = await resolution.call(request, new AbortController().signal, () => undefined);
        expect(response.error).toMatchObject({kind: "network", retryable: true});
        expect(seen).toHaveLength(1);

        seen.length = 0;
        overloadedNext = true;
        expect(ok(await client.check({provider: id, model: "qwen3:8b"}))).toMatchObject({ok: false, kind: "network"});
        expect(seen).toHaveLength(1);
    });
});

describe("目录漂移（输出 9）", () => {
    test("设置里的目录模型不在目录里了：快照标 missing、绑着它的角色 unknown-model、写一条诊断", async () => {
        const w = await world();
        const client = await w.window("w");
        const {id} = ok(await client.addProvider({template: "deepseek"}));
        ok(await client.upsertModel({provider: id, model: {id: "deepseek-retired", enabled: true, origin: "source", contextWindow: 8_000}}));
        ok(await client.setRole({id: "main", model: `${id}/deepseek-retired`}));
        const snapshot = w.service.snapshot();
        expect((await rowsOf(client, id)).find((row) => row.id === "deepseek-retired")).toMatchObject({status: "missing", origin: "source"});
        expect(snapshot.roles.find((role) => role.id === "main")!.status).toBe("unknown-model");
        expect(w.service.port().resolve(query())).toEqual({ok: false, code: "unknown-model", role: "main"});
        expect(w.settings.diagnostics("hub").query({}).records.some((record) => record.event === "models.catalog.missing")).toBe(true);
    });
});
