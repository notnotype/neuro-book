/**
 * 服务商是模板的实例（docs/specs/models/service.md 输出 1、5、9、12）：模板表、添加与复制、v1 设置的读法、自动加入与冻结、
 * 模型行的分页读、图标。用内存配置存储、真实的凭据库文件与 OMP 的打包目录；远程方法直接调核心交出的实现。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {CoreSettings, ModelQuery} from "@notnotype/nb-harness/kernel/contracts";
import {openCredentials} from "@notnotype/nb-harness/models";
import type {CredentialStore} from "@notnotype/nb-harness/models";
import {fail, ok} from "@notnotype/nb-runtime/remote";
import type {RemoteMethodContext, RemoteOutcome} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {Static} from "typebox";

import {DEFAULT_ROLES} from "../config/shapes";
import type {ProviderConfig, RolesConfig, StoredProvider} from "../config/shapes";
import type {ModelsSettingsContract} from "../contract/settings-spec";
import {memoryIconStore, memoryModelsConfig} from "../testing/memory-store";
import type {MemoryModelsConfig} from "../testing/memory-store";
import {createModelsCore} from "./core";
import type {ModelsCore} from "./core";
import {listTemplates} from "./templates";

type Methods = ModelsSettingsContract["methods"];

const CONSUMER: ConsumerIdentity = {instanceId: "browser-1", location: "browser", client: null, plugin: "acme.settings", entry: "browser", generation: null, via: null};
const CORE: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};
const query = (patch: Partial<ModelQuery> = {}): ModelQuery => ({settings: CORE, purpose: "turn", profile: "acme.writer", ...patch});
/** 1×1 的 PNG：能真正解码。 */
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let tmp = "";
let sequence = 0;
const opened: Array<{readonly core: ModelsCore; readonly credentials: CredentialStore}> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("nb-models", "providers");
});
afterEach(async () => {
    for (const {core, credentials} of opened.splice(0)) {
        await core.close();
        credentials.close();
    }
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function start(store: MemoryModelsConfig = memoryModelsConfig({}), env: Readonly<Record<string, string>> = {}) {
    sequence += 1;
    const credentials = await openCredentials(join(tmp, `credentials-${String(sequence)}.db`));
    const icons = memoryIconStore();
    const core = createModelsCore({config: store, credentials, env, secret: "providers-test-secret", icons, record: () => undefined});
    opened.push({core, credentials});
    const remote = core.remote(CONSUMER);
    const call = <Name extends keyof Methods>(name: Name, input: Static<Methods[Name]["input"]>) =>
        remote.methods[name](input as never, {signal: new AbortController().signal, ok, fail} as unknown as RemoteMethodContext<Methods[Name]>);
    /** 读完一家的全部行（按页）。 */
    const allRows = async (provider: string, scope: "listed" | "available" = "listed") => {
        const rows = [];
        let revision: string | undefined;
        for (let offset: number | null = 0; offset !== null;) {
            const page: RemoteOutcome<Methods["providerModels"]> = await call("providerModels", {provider, scope, offset, limit: 200, ...(revision === undefined ? {} : {revision})});
            if (!page.ok) throw new Error(`providerModels: ${page.code}`);
            revision = page.value.revision;
            rows.push(...page.value.rows);
            offset = page.value.nextOffset;
        }
        return rows;
    };
    return {core, credentials, icons, call, store, allRows};
}

const bound = (bindings: Readonly<Record<string, string>>): RolesConfig => ({items: DEFAULT_ROLES.items.map((role) => ({...role, model: bindings[role.id] ?? null}))});
const stored = (store: MemoryModelsConfig): ProviderConfig[] => store.providers.read() as ProviderConfig[];
const added = async (call: Awaited<ReturnType<typeof start>>["call"], input: Static<Methods["addProvider"]["input"]>): Promise<string> => {
    const result = await call("addProvider", input);
    if (!result.ok) throw new Error(`addProvider: ${result.code}`);
    return result.value.id;
};

describe("模板表（输出 1）", () => {
    it("目录里的服务商与三个空白模板：能添加的带路由与模型数，登录类、地址带占位的、非 HTTP 传输的写明原因；地区只给登记过的", () => {
        const templates = new Map(listTemplates().map((template) => [template.id, template]));
        expect(templates.get("openrouter")).toMatchObject({addable: true, reason: null, group: "gateway", logo: "openrouter", routes: [{api: "openai-responses", baseUrl: "https://openrouter.ai/api/v1"}]});
        expect(templates.get("openrouter")!.modelCount).toBeGreaterThan(500);
        expect(templates.get("moonshot")!.regions.map((region) => region.id)).toEqual(["global", "cn"]);
        expect(templates.get("anthropic")).toMatchObject({addable: false, reason: "login", access: "login"});
        expect(templates.get("cloudflare-ai-gateway")).toMatchObject({addable: false, reason: "needs-address"});
        expect(templates.get("cursor")).toMatchObject({addable: false, reason: "login"});
        expect(templates.get("amazon-bedrock")!.addable).toBe(false);
        // 混合协议的模板各协议各一条路由。
        expect(templates.get("opencode-zen")!.routes.map((route) => route.api).sort()).toEqual(["anthropic-messages", "google-generative-ai", "openai-completions", "openai-responses"]);
        for (const id of ["blank-openai", "blank-anthropic", "blank-gemini"]) expect(templates.get(id)).toMatchObject({blank: true, addable: true, group: "custom", logo: null, modelCount: 0});
        // 没有对话模型也没登记要列出的服务商（检索、语音）不在表里。
        expect(templates.has("web")).toBe(false);
    });
});

describe("按模板添加与复制（输出 5）", () => {
    it("目录模板：添加即带全部对话模型，设置里一条模型条目都不存；同一个模板可以添加多份，名称与 id 都不重复，uid 各不相同", async () => {
        const {call, store, allRows} = await start();
        const first = await added(call, {template: "moonshot"});
        const second = await added(call, {template: "moonshot"});
        expect(first).not.toBe(second);
        const [one, two] = stored(store);
        expect(one).toMatchObject({template: "moonshot", followSource: true, excluded: [], models: []});
        expect(two!.name).toBe(`${one!.name} 2`);
        expect(one!.uid).not.toBe(two!.uid);
        expect(one!.uid).toMatch(/^[a-f0-9]{32}$/u);
        const rows = await allRows(first);
        expect(rows.length).toBe(listTemplates().find((template) => template.id === "moonshot")!.modelCount);
        expect(rows.every((row) => row.enabled && row.origin === "source" && row.status === "ok")).toBe(true);
    });

    it("空白模板必须给名称与地址；登录类与不存在的模板被拒；地区要是模板登记过的", async () => {
        const {call} = await start();
        expect(await call("addProvider", {template: "blank-openai"})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await call("addProvider", {template: "blank-openai", name: "本机", baseUrl: "ftp://x"})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await call("addProvider", {template: "anthropic"})).toMatchObject({ok: false, code: "template-unavailable"});
        expect(await call("addProvider", {template: "no-such"})).toMatchObject({ok: false, code: "unknown-template"});
        expect(await call("addProvider", {template: "moonshot", region: "mars"})).toMatchObject({ok: false, code: "invalid-value"});
        const id = await added(call, {template: "blank-anthropic", name: "My Gateway", baseUrl: "https://gw.example.com/v1"});
        expect(id).toBe("my-gateway");
    });

    it("复制：新 uid、名称加 2、模型与移出记录一并复制，库里的密钥复制一行，环境变量引用随配置复制", async () => {
        const store = memoryModelsConfig({});
        const {call, credentials} = await start(store);
        const id = await added(call, {template: "moonshot"});
        await call("setModels", {provider: id, add: [], remove: [(await call("providerModels", {provider: id, offset: 0, limit: 1}) as {value: {rows: Array<{id: string}>}}).value.rows[0]!.id]});
        await call("setKey", {provider: id, value: "sk-copy-test-0001"});
        const copied = await call("duplicateProvider", {id});
        if (!copied.ok) throw new Error(copied.code);
        const [original, copy] = stored(store);
        expect(copy).toMatchObject({template: "moonshot", name: `${original!.name} 2`, excluded: original!.excluded});
        expect(copy!.uid).not.toBe(original!.uid);
        expect(credentials.get(copied.value.id)).toBe("sk-copy-test-0001");
        await call("setKey", {provider: id, value: "env:SOME_VAR"});
        const second = await call("duplicateProvider", {id});
        if (!second.ok) throw new Error(second.code);
        expect(stored(store).find((provider) => provider.id === second.value.id)!.apiKeyEnv).toBe("SOME_VAR");
        expect(credentials.get(second.value.id)).toBeNull();
    });

    it("改名重名返回 invalid-value；地区、协议、地址按补丁改，null 清除；空白模板不能清掉地址", async () => {
        const {call, store} = await start();
        const one = await added(call, {template: "moonshot"});
        const two = await added(call, {template: "moonshot"});
        expect(await call("updateProvider", {id: two, patch: {name: stored(store)[0]!.name.toUpperCase()}})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await call("updateProvider", {id: one, patch: {region: "cn"}})).toEqual({ok: true, value: null});
        expect(stored(store)[0]!.region).toBe("cn");
        expect(await call("updateProvider", {id: one, patch: {region: "mars"}})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await call("updateProvider", {id: one, patch: {region: null}})).toEqual({ok: true, value: null});
        expect("region" in stored(store)[0]!).toBe(false);
        // 目录模板换协议要有这个协议的地址：moonshot 只有 OpenAI 兼容一条路由。
        expect(await call("updateProvider", {id: one, patch: {api: "anthropic-messages"}})).toMatchObject({ok: false, code: "invalid-value"});
        expect(await call("updateProvider", {id: one, patch: {api: "anthropic-messages", baseUrl: "https://gw.example.com/anthropic"}})).toEqual({ok: true, value: null});
        const blank = await added(call, {template: "blank-openai", name: "本机", baseUrl: "http://127.0.0.1:1/v1"});
        expect(await call("updateProvider", {id: blank, patch: {baseUrl: null}})).toMatchObject({ok: false, code: "invalid-value"});
    });
});

describe("v1 设置的读法（输出 2、3）", () => {
    const legacyCatalog = {id: "deepseek", kind: "catalog", name: "DeepSeek", auth: "default", models: [{id: "deepseek-flash", enabled: true, contextWindow: 5, vision: true}, {id: "deepseek-pro", enabled: false}]} as StoredProvider;
    const legacyCustom = {id: "local", kind: "custom", name: "本机", baseUrl: "http://127.0.0.1:9/v1", api: "anthropic-messages", auth: "bearer", models: [{id: "m", enabled: true, contextWindow: 8_000}]} as StoredProvider;

    it("目录服务商按旧语义读：不跟随来源、条目是来源模型、旧运行时忽略的字段不进来；自定义服务商映射到空白模板；解析与角色状态不变", async () => {
        const store = memoryModelsConfig({providers: [legacyCatalog, legacyCustom], roles: bound({main: "deepseek/deepseek-flash", fast: "local/m"})});
        const {core, call, allRows} = await start(store);
        const snapshot = core.service.snapshot();
        expect(snapshot.providers.map((provider) => [provider.id, provider.template, provider.followSource, provider.modelCount])).toEqual([["deepseek", "deepseek", false, 2], ["local", "blank-anthropic", false, 1]]);
        expect(snapshot.providers[1]).toMatchObject({api: "anthropic-messages", baseUrl: "http://127.0.0.1:9/v1", auth: "bearer"});
        const rows = await allRows("deepseek");
        expect(rows.map((row) => [row.id, row.origin, row.enabled])).toEqual(expect.arrayContaining([["deepseek-flash", "source", true], ["deepseek-pro", "source", false]]));
        // v1 的 contextWindow、vision 对目录模型没有作用：目录值生效。
        expect(rows.find((row) => row.id === "deepseek-flash")!.contextWindow).toBeGreaterThan(5);
        expect(core.service.snapshot().roles.find((role) => role.id === "main")!.status).toBe("no-credentials");
        await call("setKey", {provider: "deepseek", value: "sk-0001"});
        expect(core.service.port().resolve(query())).toMatchObject({ok: true, info: {id: "deepseek/deepseek-flash"}});
    });

    it("第一次写入整份换成新形状：旧运行时忽略的字段丢弃，v1 行的 uid 保持确定，没有碰的服务商也一起换", async () => {
        const store = memoryModelsConfig({providers: [legacyCatalog, legacyCustom]});
        const {call} = await start(store);
        expect(await call("updateProvider", {id: "local", patch: {name: "本机模型"}})).toEqual({ok: true, value: null});
        const [catalog, custom] = stored(store);
        expect(catalog).toMatchObject({id: "deepseek", uid: "legacy:deepseek", template: "deepseek", followSource: false, excluded: []});
        expect("kind" in catalog!).toBe(false);
        expect(catalog!.models).toEqual([{id: "deepseek-flash", enabled: true, origin: "source"}, {id: "deepseek-pro", enabled: false, origin: "source"}]);
        expect(custom).toMatchObject({uid: "legacy:local", template: "blank-anthropic", name: "本机模型", models: [{id: "m", enabled: true, contextWindow: 8_000, origin: "manual"}]});
    });

    it("首写前外部改了文件：补丁的 expect 用磁盘上的原值，冲突后重读再合并，别处加的一家不丢", async () => {
        const store = memoryModelsConfig({providers: [legacyCustom]});
        const {call} = await start(store);
        store.writeExternally("providers", [legacyCustom, {...legacyCustom, id: "outside", name: "outside"}]);
        // 视图还没跟上：第一次写撞上 conflict，等到跟上后在新值上重来。
        queueMicrotask(() => store.catchUp());
        expect(await call("updateProvider", {id: "local", patch: {name: "改过"}})).toEqual({ok: true, value: null});
        expect(stored(store).map((provider) => [provider.id, provider.name])).toEqual([["local", "改过"], ["outside", "outside"]]);
    });
});

describe("自动加入、冻结与移出（输出 5、9）", () => {
    it("关掉自动加入：给此刻的每个来源成员补一条冻结条目；再打开：只删仍是纯冻结的，用户改过的去掉冻结标记保留", async () => {
        const {call, store, allRows} = await start();
        const id = await added(call, {template: "deepseek"});
        const before = await allRows(id);
        expect(await call("updateProvider", {id, patch: {followSource: false}})).toEqual({ok: true, value: null});
        const frozen = stored(store)[0]!.models;
        expect(frozen.length).toBe(before.length);
        expect(frozen.every((entry) => entry.frozen === true && entry.origin === "source" && entry.enabled)).toBe(true);
        expect((await allRows(id)).map((row) => row.id)).toEqual(before.map((row) => row.id));
        // 用户停用其中一个：这条不再是纯冻结，重新打开后仍然在。
        const target = before[0]!.id;
        expect(await call("upsertModel", {provider: id, model: {id: target, enabled: false}})).toEqual({ok: true, value: null});
        expect(await call("updateProvider", {id, patch: {followSource: true}})).toEqual({ok: true, value: null});
        expect(stored(store)[0]!.models).toEqual([{id: target, enabled: false, origin: "source"}]);
        expect((await allRows(id)).find((row) => row.id === target)!.enabled).toBe(false);
    });

    it("移出来源模型进 excluded 并解除角色绑定，在“可加入”里找得回；加回来取消移出；手加的模型整条存、可删", async () => {
        const store = memoryModelsConfig({});
        const {call, allRows} = await start(store);
        const id = await added(call, {template: "deepseek"});
        const [first, second] = await allRows(id);
        await call("setRole", {id: "main", model: `${id}/${first!.id}`});
        expect(await call("setModels", {provider: id, add: [], remove: [first!.id]})).toEqual({ok: true, value: null});
        expect(stored(store)[0]!.excluded).toEqual([first!.id]);
        expect(store.roles.read().items.find((role) => role.id === "main")!.model).toBeNull();
        expect((await allRows(id)).some((row) => row.id === first!.id)).toBe(false);
        expect((await allRows(id, "available")).map((row) => row.id)).toEqual([first!.id]);
        expect(await call("setModels", {provider: id, add: [{id: first!.id, enabled: true}, {id: "my-model", enabled: true, contextWindow: 4_000, name: "我的"}], remove: []})).toEqual({ok: true, value: null});
        expect(stored(store)[0]!.excluded).toEqual([]);
        expect(stored(store)[0]!.models).toEqual([{id: "my-model", enabled: true, contextWindow: 4_000, name: "我的", origin: "manual"}]);
        const manual = (await allRows(id)).find((row) => row.id === "my-model")!;
        expect(manual).toMatchObject({origin: "manual", name: "我的", overridden: []});
        // 手加的模型缺窗口不能启用；删掉它不进 excluded。
        expect(await call("upsertModel", {provider: id, model: {id: "no-window", enabled: true}})).toMatchObject({ok: false, code: "model-incomplete"});
        expect(await call("removeModel", {provider: id, id: "my-model"})).toEqual({ok: true, value: null});
        expect(stored(store)[0]!.excluded).toEqual([]);
        expect(second).toBeDefined();
    });

    it("来源模型的覆盖只存与来源值不同的字段，行上标“已改”；改回来源值就不再存", async () => {
        const {call, store, allRows} = await start();
        const id = await added(call, {template: "deepseek"});
        const row = (await allRows(id))[0]!;
        expect(await call("upsertModel", {provider: id, model: {id: row.id, enabled: true, name: "自己的名字", contextWindow: row.contextWindow!, maxOutput: 777}})).toEqual({ok: true, value: null});
        expect(stored(store)[0]!.models).toEqual([{id: row.id, enabled: true, origin: "source", name: "自己的名字", maxOutput: 777}]);
        expect((await allRows(id)).find((item) => item.id === row.id)).toMatchObject({name: "自己的名字", maxOutput: 777, overridden: ["name", "maxOutput"]});
        expect(await call("upsertModel", {provider: id, model: {id: row.id, enabled: true}})).toEqual({ok: true, value: null});
        expect(stored(store)[0]!.models).toEqual([]);
    });
});

describe("模型行的分页读（输出 10、12）", () => {
    it("一家几百个模型：按页读完、顺序稳定、每个 id 只出现一次；后续页带首页的 revision，期间这家变了得 revision-changed", async () => {
        const {call} = await start();
        const id = await added(call, {template: "openrouter"});
        const first = await call("providerModels", {provider: id, offset: 0, limit: 200});
        if (!first.ok) throw new Error(first.code);
        expect(first.value.rows.length).toBe(200);
        expect(first.value.nextOffset).toBe(200);
        expect(first.value.total).toBeGreaterThan(500);
        const ids = new Set(first.value.rows.map((row) => row.id));
        for (let offset: number | null = first.value.nextOffset; offset !== null;) {
            const page = await call("providerModels", {provider: id, offset, limit: 200, revision: first.value.revision});
            if (!page.ok) throw new Error(page.code);
            for (const row of page.value.rows) ids.add(row.id);
            offset = page.value.nextOffset;
        }
        expect(ids.size).toBe(first.value.total);
        await call("updateProvider", {id, patch: {name: "改名也换版本吗"}});
        // 改名不动模型行的内容，但版本按这家整份配置算：后续页必须重读。
        expect(await call("providerModels", {provider: id, offset: 200, limit: 200, revision: first.value.revision})).toMatchObject({ok: false, code: "revision-changed"});
        expect(await call("providerModels", {provider: "no-such", offset: 0, limit: 10})).toMatchObject({ok: false, code: "unknown-provider"});
    });

    it("enabledModels 的 usable 只留有凭据的服务商里可用的模型；modelsByReference 取得到未启用的行，找不到的给 null，一次不超过上限", async () => {
        const {call} = await start();
        const a = await added(call, {template: "deepseek"});
        const b = await added(call, {template: "mistral"});
        await call("setKey", {provider: a, value: "sk-a-0001"});
        const usable = await call("enabledModels", {usable: true, offset: 0, limit: 200});
        if (!usable.ok) throw new Error(usable.code);
        expect(new Set(usable.value.rows.map((row) => row.provider))).toEqual(new Set([a]));
        const everything = await call("enabledModels", {providers: [b], offset: 0, limit: 5});
        if (!everything.ok) throw new Error(everything.code);
        expect(everything.value.rows.length).toBe(5);
        expect(everything.value.rows.every((row) => row.usable === false)).toBe(true);
        const disabled = usable.value.rows[0]!;
        await call("upsertModel", {provider: a, model: {id: disabled.id, enabled: false}});
        const lookup = await call("modelsByReference", {references: [`${a}/${disabled.id}`, `${a}/no-such-model`, "no-such/x", "garbage"]});
        if (!lookup.ok) throw new Error("modelsByReference failed");
        expect(lookup.value.map((item) => [item.provider, item.row === null ? null : item.row.enabled])).toEqual([[a, false], [a, null], [null, null], [null, null]]);
    });
});

describe("图标（输出 12）", () => {
    it("上传：存成按内容命名的文件、设置里存引用；换一张删旧文件；恢复模板的图标后文件被收走；内置与首字母只改设置", async () => {
        const store = memoryModelsConfig({});
        const {call, icons} = await start(store);
        const id = await added(call, {template: "deepseek"});
        expect(await call("setIcon", {provider: id, icon: {kind: "upload", png: PNG_1X1}})).toEqual({ok: true, value: null});
        const icon = stored(store)[0]!.icon;
        expect(icon).toMatchObject({kind: "file"});
        expect([...icons.files.keys()]).toEqual([(icon as {name: string}).name]);
        expect(await call("setIcon", {provider: id, icon: {kind: "builtin", key: "openai"}})).toEqual({ok: true, value: null});
        expect(icons.files.size).toBe(0);
        expect(stored(store)[0]!.icon).toEqual({kind: "builtin", key: "openai"});
        expect(await call("setIcon", {provider: id, icon: {kind: "initial"}})).toEqual({ok: true, value: null});
        expect(await call("setIcon", {provider: id, icon: null})).toEqual({ok: true, value: null});
        expect("icon" in stored(store)[0]!).toBe(false);
    });

    it("拒收：不是 base64 或不是 PNG、边长超限、动图、解码不了；失败后设置与文件都没有变化；删服务商时文件被收走", async () => {
        const store = memoryModelsConfig({});
        const {call, icons} = await start(store);
        const id = await added(call, {template: "deepseek"});
        const header = (width: number, extra: Uint8Array = new Uint8Array()) => {
            const bytes = new Uint8Array(33 + extra.length);
            bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
            new DataView(bytes.buffer).setUint32(16, width);
            new DataView(bytes.buffer).setUint32(20, 1);
            bytes.set(extra, 33);
            return Buffer.from(bytes).toString("base64");
        };
        const reasons = async (png: string) => {
            const result = await call("setIcon", {provider: id, icon: {kind: "upload", png}});
            return result.ok ? "ok" : (result.detail as {reason: string}).reason;
        };
        expect(await reasons("not base64!")).toBe("not-png");
        expect(await reasons(Buffer.from("GIF89a-not-a-png-just-some-bytes-xxxxxxxxxx").toString("base64"))).toBe("not-png");
        expect(await reasons(header(300))).toBe("too-large");
        expect(await reasons(header(16, new Uint8Array([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])))).toBe("animated");
        expect(await reasons(header(16))).toBe("undecodable");
        expect("icon" in stored(store)[0]!).toBe(false);
        expect(icons.files.size).toBe(0);
        await call("setIcon", {provider: id, icon: {kind: "upload", png: PNG_1X1}});
        expect(icons.files.size).toBe(1);
        await call("removeProvider", {id});
        expect(icons.files.size).toBe(0);
    });
});

describe("身份（输出 8）", () => {
    it("同一个模板的两个实例各有自己的公开引用：解析出的模型 id 带实例 id", async () => {
        const store = memoryModelsConfig({});
        const {core, call, allRows} = await start(store);
        const one = await added(call, {template: "deepseek"});
        const two = await added(call, {template: "deepseek"});
        const model = (await allRows(one))[0]!.id;
        await call("setKey", {provider: one, value: "sk-one-0001"});
        await call("setKey", {provider: two, value: "sk-two-0001"});
        const port = core.service.port();
        expect(port.resolve(query({settings: {...CORE, model: `${one}/${model}`}}))).toMatchObject({ok: true, info: {id: `${one}/${model}`}});
        expect(port.resolve(query({settings: {...CORE, model: `${two}/${model}`}}))).toMatchObject({ok: true, info: {id: `${two}/${model}`}});
    });
});
