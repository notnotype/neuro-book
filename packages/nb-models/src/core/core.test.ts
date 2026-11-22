/**
 * 服务核心（docs/specs/models/service.md 输出 6、8、13、15）：内存配置存储（对过存储合同，见 `testing/memory-store.test.ts`）、
 * 真实的凭据库文件与本机的 OpenAI 兼容假端点。远程方法直接调核心交出的实现，经远程链路的调用由应用的测试覆盖。
 * 这里的密钥都是假的，只发往本机端点。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {CoreSettings, ModelQuery} from "@notnotype/nb-harness/kernel/contracts";
import {openCredentials} from "@notnotype/nb-harness/models";
import type {CredentialStore} from "@notnotype/nb-harness/models";
import {fail, ok} from "@notnotype/nb-runtime/remote";
import type {RemoteMethodContext} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {Static} from "typebox";

import {DEFAULT_ROLES, MODEL_ROLE_IDS} from "../config/shapes";
import type {ProviderConfig, RolesConfig} from "../config/shapes";
import type {ModelsSettingsContract} from "../contract/settings-spec";
import {startFakeOpenAiEndpoint} from "../testing/fake-endpoint";
import type {FakeOpenAiEndpoint} from "../testing/fake-endpoint";
import {memoryIconStore, memoryModelsConfig} from "../testing/memory-store";
import type {MemoryModelsConfig} from "../testing/memory-store";
import {createModelsCore} from "./core";
import type {ModelsCore} from "./core";
import type {ModelsConfigStore} from "./store";

type Methods = ModelsSettingsContract["methods"];

const KEY = "sk-nb-models-test-not-real-0001";
const CONSUMER: ConsumerIdentity = {instanceId: "browser-1", location: "browser", client: null, plugin: "acme.settings", entry: "browser", generation: null, via: null};
const CORE: CoreSettings = {model: null, effort: null, approvalMode: "ask", readOnly: false};
const query = (patch: Partial<ModelQuery> = {}): ModelQuery => ({settings: CORE, purpose: "turn", profile: "acme.writer", ...patch});

let tmp = "";
let sequence = 0;
let endpoint: FakeOpenAiEndpoint;
const opened: Array<{readonly core: ModelsCore; readonly credentials: CredentialStore}> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("nb-models", "core");
    endpoint = startFakeOpenAiEndpoint();
});
afterEach(async () => {
    for (const {core, credentials} of opened.splice(0)) {
        await core.close();
        credentials.close();
    }
});
afterAll(async () => {
    await endpoint.stop();
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const custom = (id: string, patch: Partial<ProviderConfig> = {}): ProviderConfig => ({id, uid: `uid-${id}`, template: "blank-openai", name: id, baseUrl: endpoint.baseUrl, api: "openai-completions", auth: "default", followSource: false, excluded: [], models: [{id: "qwen3:8b", enabled: true, contextWindow: 32_000, origin: "manual"}], ...patch});
const bound = (bindings: Readonly<Record<string, string>>): RolesConfig => ({items: DEFAULT_ROLES.items.map((role) => ({...role, model: bindings[role.id] ?? null}))});

async function start(config: ModelsConfigStore, env: Readonly<Record<string, string>> = {}) {
    sequence += 1;
    const credentials = await openCredentials(join(tmp, `credentials-${String(sequence)}.db`));
    const records: string[] = [];
    const core = createModelsCore({config, credentials, env, secret: "nb-models-test-secret", icons: memoryIconStore(), record: (_level, event) => void records.push(event)});
    opened.push({core, credentials});
    const remote = core.remote(CONSUMER);
    /** 像远程层那样给方法一个调用上下文。 */
    const call = <Name extends keyof Methods>(name: Name, input: Static<Methods[Name]["input"]>) =>
        remote.methods[name](input as never, {signal: new AbortController().signal, ok, fail} as unknown as RemoteMethodContext<Methods[Name]>);
    return {core, credentials, records, call};
}

/**
 * 每次写服务商之前，别处先往磁盘上加一家（`races` 次）：服务核心的写入因此撞上 `conflict`。服务等存储送来变化时视图跟上
 * 磁盘（真实存储里是文件变化的重读）。
 */
function racing(store: MemoryModelsConfig, races: number): ModelsConfigStore {
    let left = races;
    return {
        ...store,
        providers: {
            ...store.providers,
            write: async (next, expect) => {
                if (left > 0) {
                    left -= 1;
                    store.writeExternally("providers", [...store.providers.read(), custom(`outside-${String(left)}`, {models: []})]);
                }
                return store.providers.write(next, expect);
            },
        },
        onChange: (listener) => {
            const off = store.onChange(listener);
            // 订阅返回之后再跟上：存储不在 onChange 返回之前回调。
            queueMicrotask(() => store.catchUp());
            return off;
        },
    };
}

describe("串行写入与冲突（输出 6）", () => {
    it("写入撞上别处的改动：等存储跟上后在新值上再合并，别处的内容不丢", async () => {
        const store = memoryModelsConfig({providers: [custom("one")]});
        const {call} = await start(racing(store, 1));
        expect(await call("updateProvider", {id: "one", patch: {name: "第一家"}})).toEqual({ok: true, value: null});
        expect(store.providers.read().map((provider) => [provider.id, provider.name])).toEqual([["one", "第一家"], ["outside-0", "outside-0"]]);
    });

    it("连续三次都撞上别处的改动：交回 write-conflict，自己的改动没有写进去", async () => {
        const store = memoryModelsConfig({providers: [custom("one")]});
        const {call} = await start(racing(store, 3));
        expect(await call("updateProvider", {id: "one", patch: {name: "第一家"}})).toMatchObject({ok: false, code: "write-conflict"});
        store.catchUp();
        expect(store.providers.read().find((provider) => provider.id === "one")?.name).toBe("one");
    });

    it("可写那一层坏了或读不了：交回 settings-unavailable，带层的情况", async () => {
        const store = memoryModelsConfig({providers: [custom("one")]});
        const {call} = await start(store);
        store.setLayer("invalid");
        expect(await call("updateProvider", {id: "one", patch: {name: "x"}})).toEqual({ok: false, code: "settings-unavailable", detail: {detail: "the user settings layer is not writable", code: "layer-invalid"}});
        store.setLayer("unavailable");
        expect(await call("addRole", {name: "润色", description: ""})).toMatchObject({ok: false, code: "settings-unavailable", detail: {code: "unavailable"}});
    });
});

describe("删除时解绑（输出 15）", () => {
    it("删模型只解绑用它的角色；删服务商解绑用它的全部角色并清掉库里的密钥", async () => {
        const two = custom("two", {models: [{id: "a", enabled: true, contextWindow: 8_000}, {id: "b", enabled: true, contextWindow: 8_000}]});
        const store = memoryModelsConfig({providers: [custom("one"), two], roles: bound({main: "two/a", fast: "two/b", deep: "one/qwen3:8b"})});
        const {call, credentials} = await start(store);
        expect(await call("setKey", {provider: "two", value: KEY})).toEqual({ok: true, value: {kind: "stored"}});

        expect(await call("removeModel", {provider: "two", id: "a"})).toEqual({ok: true, value: null});
        expect(store.roles.read().items.filter((role) => role.model !== null).map((role) => [role.id, role.model])).toEqual([["fast", "two/b"], ["deep", "one/qwen3:8b"]]);

        expect(await call("removeProvider", {id: "two"})).toEqual({ok: true, value: null});
        expect(store.roles.read().items.filter((role) => role.model !== null).map((role) => role.id)).toEqual(["deep"]);
        expect(store.providers.read().map((provider) => provider.id)).toEqual(["one"]);
        expect(credentials.get("two")).toBeNull();
    });
});

describe("密钥的两步写入（输出 13）", () => {
    it("env: 存成 apiKeyEnv 并清掉库里的密钥；原文写库并去掉 apiKeyEnv", async () => {
        const store = memoryModelsConfig({providers: [custom("one")]});
        const {call, credentials} = await start(store, {ACME_KEY: "from-env"});
        expect(await call("setKey", {provider: "one", value: KEY})).toEqual({ok: true, value: {kind: "stored"}});
        expect(await call("setKey", {provider: "one", value: "env:ACME_KEY"})).toEqual({ok: true, value: {kind: "env", name: "ACME_KEY", found: true}});
        expect(credentials.get("one")).toBeNull();
        expect(await call("setKey", {provider: "one", value: KEY})).toEqual({ok: true, value: {kind: "stored"}});
        expect(store.providers.read()[0]?.apiKeyEnv).toBeUndefined();
        expect(credentials.get("one")).toBe(KEY);
    });

    it("第二步失败：交回 partially-applied，带写后的密钥状态", async () => {
        const store = memoryModelsConfig({providers: [custom("one", {apiKeyEnv: "ACME_KEY"})]});
        const {call, credentials} = await start(store);
        store.setLayer("unavailable");
        const result = await call("setKey", {provider: "one", value: KEY});
        expect(result).toMatchObject({ok: false, code: "partially-applied", detail: {key: {kind: "env", name: "ACME_KEY", found: false}}});
        expect(credentials.get("one")).toBe(KEY);
        expect(JSON.stringify(result)).not.toContain(KEY);
    });
});

describe("模型端口按选择顺序解析（输出 8）", () => {
    it("审批取快速档、压缩取压缩角色；没绑定是 role-unbound；绑定的模型有密钥才能用；失败带上走到的角色与卡住的服务商", async () => {
        const store = memoryModelsConfig({providers: [custom("one")], roles: bound({fast: "one/qwen3:8b"})});
        const {core, call} = await start(store);
        const port = core.service.port();
        expect(port.resolve(query({purpose: "approval"}))).toEqual({ok: false, code: "no-credentials", role: MODEL_ROLE_IDS.fast, provider: "one"});
        expect(port.resolve(query({purpose: "compaction"}))).toEqual({ok: false, code: "role-unbound", role: MODEL_ROLE_IDS.compaction});
        // 会话直接选了模型（不经角色）：只带服务商。
        expect(port.resolve(query({settings: {...CORE, model: "one/qwen3:8b"}}))).toEqual({ok: false, code: "no-credentials", provider: "one"});
        expect(await call("setKey", {provider: "one", value: KEY})).toEqual({ok: true, value: {kind: "stored"}});
        expect(port.resolve(query({purpose: "approval"}))).toMatchObject({ok: true, info: {id: "one/qwen3:8b"}});
        expect(port.resolve(query())).toEqual({ok: false, code: "role-unbound", role: MODEL_ROLE_IDS.main});
    });

    it("第一次绑快速档时压缩跟着它（输出 14）", async () => {
        const store = memoryModelsConfig({providers: [custom("one")]});
        const {call} = await start(store);
        expect(await call("setRole", {id: "fast", model: "one/qwen3:8b"})).toEqual({ok: true, value: null});
        expect(store.roles.read().items.find((role) => role.id === "compaction")?.model).toBe("one/qwen3:8b");
    });

    it("只改档或图标不动绑定：省略的字段不改，null 清除；第一次绑定才让压缩跟着", async () => {
        const store = memoryModelsConfig({providers: [custom("one")], roles: bound({main: "one/qwen3:8b"})});
        const {call} = await start(store);
        const role = (id: string) => store.roles.read().items.find((item) => item.id === id)!;
        expect(await call("setRole", {id: "main", effort: "high"})).toEqual({ok: true, value: null});
        expect(role("main")).toMatchObject({model: "one/qwen3:8b", effort: "high"});
        expect(await call("setRole", {id: "main", icon: "bolt"})).toEqual({ok: true, value: null});
        expect(role("main")).toMatchObject({model: "one/qwen3:8b", effort: "high", icon: "bolt"});
        // 只改档不会带出模型：未绑定的快速档设档，压缩仍然不跟着。
        expect(await call("setRole", {id: "fast", effort: "off"})).toEqual({ok: true, value: null});
        expect(role("fast")).toMatchObject({model: null, effort: "off"});
        expect(role("compaction").model).toBeNull();
        expect(await call("setRole", {id: "main", effort: null, icon: null})).toEqual({ok: true, value: null});
        expect("effort" in role("main")).toBe(false);
        expect("icon" in role("main")).toBe(false);
        expect(role("main").model).toBe("one/qwen3:8b");
        expect(await call("setRole", {id: "main", model: null})).toEqual({ok: true, value: null});
        expect(role("main").model).toBeNull();
    });

    it("角色的默认档是这次解析的属性：同一个模型绑给两个角色，各用各的；会话选的档在内核里优先", async () => {
        const store = memoryModelsConfig({providers: [custom("one")], roles: bound({main: "one/qwen3:8b", fast: "one/qwen3:8b"})});
        const {core, call} = await start(store);
        await call("setKey", {provider: "one", value: KEY});
        await call("setRole", {id: "main", effort: "high"});
        const port = core.service.port();
        expect(port.resolve(query())).toMatchObject({ok: true, defaultEffort: "high"});
        expect(port.resolve(query({purpose: "approval"})).ok).toBe(true);
        expect("defaultEffort" in port.resolve(query({purpose: "approval"}))).toBe(false);
        // 直接选模型（不经角色）没有角色默认档。
        expect("defaultEffort" in port.resolve(query({settings: {...CORE, model: "one/qwen3:8b"}}))).toBe(false);
        // 解析带着走的是哪个角色（界面说“用主力的默认”）；直接选模型时没有角色。
        expect(port.resolve(query())).toMatchObject({ok: true, role: "main"});
        expect("role" in port.resolve(query({settings: {...CORE, model: "one/qwen3:8b"}}))).toBe(false);
    });

    it("快照带角色的档与图标，以及每个模型的推理能力（绑定的模型没启用时角色页也能取到）", async () => {
        const store = memoryModelsConfig({providers: [custom("one", {models: [{id: "qwen3:8b", enabled: false, contextWindow: 32_000, reasoning: true}, {id: "plain", enabled: true, contextWindow: 32_000}]})], roles: bound({main: "one/qwen3:8b"})});
        const {core, call} = await start(store);
        await call("setRole", {id: "main", effort: "low", icon: "bolt"});
        const snapshot = core.service.snapshot();
        expect(snapshot.roles.find((item) => item.id === "main")).toMatchObject({effort: "low", icon: "bolt"});
        expect(snapshot.roles.find((item) => item.id === "fast")).toMatchObject({effort: null, icon: null});
        // 自定义模型声明了会推理：档位按 OMP 对这个 id 与协议的判断（Qwen 系可以关）；没声明的不推理。
        const page = await call("providerModels", {provider: "one", offset: 0, limit: 10});
        if (!page.ok) throw new Error("providerModels failed");
        expect(page.value.rows.find((row) => row.id === "qwen3:8b")!.thinking).toMatchObject({kind: "levels", off: "disable"});
        expect(page.value.rows.find((row) => row.id === "plain")!.thinking).toEqual({kind: "none"});
    });

    it("不合法的档与图标键被拒收", async () => {
        const store = memoryModelsConfig({providers: [custom("one")], roles: bound({main: "one/qwen3:8b"})});
        const {call} = await start(store);
        expect(await call("setRole", {id: "main", effort: "ultra" as never})).toMatchObject({ok: false});
    });
});

describe("检测（输出 11）", () => {
    it("检测通过，或给出失败的类别；原文里没有密钥", async () => {
        const store = memoryModelsConfig({providers: [custom("one")]});
        const {call} = await start(store);
        expect(await call("setKey", {provider: "one", value: KEY})).toEqual({ok: true, value: {kind: "stored"}});
        expect(await call("check", {provider: "one", model: "qwen3:8b"})).toEqual({ok: true, value: {ok: true}});
        endpoint.failNext("unauthorized");
        const failed = await call("check", {provider: "one", model: "qwen3:8b"});
        expect(failed).toMatchObject({ok: true, value: {ok: false, kind: "auth"}});
        expect(JSON.stringify(failed)).not.toContain(KEY);
    });
});
