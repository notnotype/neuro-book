/**
 * 模型来源（docs/specs/models/service.md“模型来源”）：服务商的列表、来源缓存、在线目录与自动更新经服务核心的远程方法与快照观察。
 * 列表与在线目录来自本机端点（真实 HTTP）；来源文件用内存实现（应用的文件实现另由它自己的测试核对）；时钟注入。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {chatModels, openCredentials} from "@notnotype/nb-harness/models";
import type {CredentialStore} from "@notnotype/nb-harness/models";
import {fail, ok} from "@notnotype/nb-runtime/remote";
import type {RemoteMethodContext, RemoteOutcome} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {Static} from "typebox";

import type {StoredProvider} from "../config/shapes";
import type {ModelsSettingsContract} from "../contract/settings-spec";
import type {ModelsSnapshot, SnapshotProvider} from "../contract/shapes";
import {memoryIconStore, memoryModelsConfig, memorySourceStore} from "../testing/memory-store";
import type {MemoryModelsConfig} from "../testing/memory-store";
import {createModelsCore} from "./core";
import type {ModelsCore} from "./core";
import {SOURCE_STALE_MS, sourceKeyOf} from "./sources";

type Methods = ModelsSettingsContract["methods"];
const CONSUMER: ConsumerIdentity = {instanceId: "browser-1", location: "browser", client: null, plugin: "acme.settings", entry: "browser", generation: null, via: null};
const HOUR = 60 * 60 * 1000;
const noCatalog = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: () => new Response("no catalog here", {status: 404})});
const NO_CATALOG = `http://127.0.0.1:${String(noCatalog.port)}/models.json.zstd`;

let tmp = "";
let sequence = 0;
const cleanup: Array<() => Promise<void> | void> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("nb-models", "sources");
});
afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) await step();
});
afterAll(async () => {
    noCatalog.stop(true);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 本机的列表端点：`respond` 决定回什么，可以换；`seen` 记下收到的路径与认证头。 */
function endpoint(initial: () => Response | Promise<Response> = () => Response.json({data: []})) {
    let respond = initial;
    const seen: Array<{path: string; authorization: string | null; team: string | null}> = [];
    const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: (request) => {
        seen.push({path: new URL(request.url).pathname, authorization: request.headers.get("authorization"), team: request.headers.get("x-team")});
        return respond();
    }});
    cleanup.push(() => server.stop(true));
    return {baseUrl: `http://127.0.0.1:${String(server.port)}/v1`, seen, set: (next: () => Response | Promise<Response>) => (respond = next)};
}
const models = (...rows: object[]) => () => Response.json({object: "list", data: rows});

interface Clock {
    now: number;
}

async function start(options: {config?: MemoryModelsConfig; sources?: ReturnType<typeof memorySourceStore>; clock?: Clock; catalogUrl?: string; started?: boolean; credentials?: CredentialStore} = {}) {
    sequence += 1;
    // 自动更新缺省开着（添加、设密钥之后才会跟着拉）；在线目录缺省指向一个总回 404 的本机端点，不出本机。
    const config = options.config ?? memoryModelsConfig({autoUpdate: true});
    const credentials = options.credentials ?? (await openCredentials(join(tmp, `credentials-${String(sequence)}.db`)));
    const sources = options.sources ?? memorySourceStore();
    const clock = options.clock ?? {now: 1_800_000_000_000};
    const events: string[] = [];
    const core: ModelsCore = createModelsCore({
        config, credentials, env: {}, secret: "sources-test-secret", icons: memoryIconStore(), sources, now: () => clock.now,
        catalogUrl: options.catalogUrl ?? NO_CATALOG,
        record: (_level, event) => void events.push(event),
    });
    let closed = false;
    const close = async () => {
        if (closed) return;
        closed = true;
        await core.close();
        if (options.credentials === undefined) credentials.close();
    };
    cleanup.push(close);
    if (options.started !== false) await core.start();
    const remote = core.remote(CONSUMER);
    const call = <Name extends keyof Methods>(name: Name, input: Static<Methods[Name]["input"]>) =>
        remote.methods[name](input as never, {signal: new AbortController().signal, ok, fail} as unknown as RemoteMethodContext<Methods[Name]>);
    const rows = async (provider: string, scope: "listed" | "available" = "listed") => {
        const page: RemoteOutcome<Methods["providerModels"]> = await call("providerModels", {provider, scope, offset: 0, limit: 200});
        if (!page.ok) throw new Error(`providerModels: ${page.code}`);
        return page.value.rows;
    };
    const provider = (id: string): SnapshotProvider => core.service.snapshot().providers.find((item) => item.id === id)!;
    /** 等快照满足条件（每次变化时看一次），最多 5 秒。 */
    const until = (predicate: (snapshot: ModelsSnapshot) => boolean): Promise<void> => new Promise((resolve, reject) => {
        if (predicate(core.service.snapshot())) return resolve();
        const timer = setTimeout(() => {
            off();
            reject(new Error(`timed out; last source states: ${JSON.stringify(core.service.snapshot().providers.map((item) => item.source))}`));
        }, 5000);
        const off = core.service.onChange(() => {
            if (!predicate(core.service.snapshot())) return;
            clearTimeout(timer);
            off();
            resolve();
        });
    });
    const settled = (id: string) => until((snapshot) => snapshot.providers.some((item) => item.id === id && !item.source.refreshing));
    return {core, config, credentials, sources, clock, events, call, rows, provider, until, settled, close};
}

async function addBlank(call: Awaited<ReturnType<typeof start>>["call"], baseUrl: string, name = "Local"): Promise<string> {
    const result = await call("addProvider", {template: "blank-openai", name, baseUrl});
    if (!result.ok) throw new Error(`addProvider: ${result.code}`);
    return result.value.id;
}

describe("空白模板的列表（决定 27）", () => {
    it("设了密钥就拉列表；类型不明的有窗口自动启用，没有窗口的列出待补字段，像向量模型的只在可加的里", async () => {
        const local = endpoint(models({id: "house-chat", context_length: 32_000}, {id: "house-bare"}, {id: "text-embedding-small", context_length: 8192}));
        const {call, rows, provider, settled} = await start();
        const id = await addBlank(call, local.baseUrl);
        expect(provider(id).source).toMatchObject({state: "none"});
        expect(await call("setKey", {provider: id, value: "sk-local-0001"})).toMatchObject({ok: true});
        await settled(id);
        expect(provider(id).source).toMatchObject({state: "ok", error: null});
        expect(local.seen).toEqual([{path: "/v1/models", authorization: "Bearer sk-local-0001", team: null}]);
        expect((await rows(id)).map((row) => [row.id, row.kind, row.status, row.enabled]).sort()).toEqual([["house-bare", "unknown", "incomplete", false], ["house-chat", "unknown", "ok", true]]);
        expect((await rows(id, "available")).map((row) => row.id)).toEqual(["text-embedding-small"]);
    });

    it("服务商不再提供的条目标 missing；成功的空表是权威的：成员清空", async () => {
        const local = endpoint(models({id: "house-chat", context_length: 32_000}));
        const {call, rows, provider, settled, clock} = await start();
        const id = await addBlank(call, local.baseUrl);
        await call("setKey", {provider: id, value: "sk-local-0001"});
        await settled(id);
        clock.now += HOUR;
        // 用户改过这一行（有条目），之后服务商不再提供它。
        const row = (await rows(id))[0]!;
        expect(await call("upsertModel", {provider: id, model: {id: row.id, enabled: true, contextWindow: 64_000}})).toMatchObject({ok: true});
        local.set(models());
        const before = provider(id).source.checkedAt;
        expect(await call("refreshSource", {provider: id})).toMatchObject({ok: true});
        await settled(id);
        expect(provider(id).source.checkedAt).not.toBe(before);
        expect((await rows(id)).map((item) => [item.id, item.status])).toEqual([["house-chat", "missing"]]);
        await call("removeModel", {provider: id, id: "house-chat"});
        expect(await rows(id)).toEqual([]);
        expect(await rows(id, "available")).toEqual([]);
    });
});

describe("目录模板的列表", () => {
    const [known] = chatModels("deepseek");

    async function deepseek(local: ReturnType<typeof endpoint>) {
        const context = await start();
        const result = await context.call("addProvider", {template: "deepseek", baseUrl: local.baseUrl});
        if (!result.ok) throw new Error(result.code);
        const id = result.value.id;
        await context.call("setKey", {provider: id, value: "sk-deepseek-0001"});
        await context.settled(id);
        return {...context, id};
    }

    it("列表决定在供的成员：目录里有的用目录的能力，目录外的类型不明不自动启用，目录里有、列表里没有的不在", async () => {
        const local = endpoint(models({id: known!.id}, {id: "deepseek-account-only"}));
        const {id, rows} = await deepseek(local);
        expect((await rows(id)).map((row) => [row.id, row.kind, row.contextWindow])).toEqual([[known!.id, "chat", known!.contextWindow]]);
        expect((await rows(id, "available")).map((row) => [row.id, row.kind])).toEqual([["deepseek-account-only", "unknown"]]);
    });

    it("拉取失败沿用上一次的列表并写明原因；改了地址退回目录、不自动去新地址拉；改了认证头照用旧列表、标 changed，重新拉取后恢复", async () => {
        const local = endpoint(models({id: known!.id}));
        const {id, call, rows, provider, settled, config, until, clock} = await deepseek(local);
        local.set(() => Response.json({error: "overloaded"}, {status: 503}));
        await call("refreshSource", {provider: id});
        await settled(id);
        expect(provider(id).source).toMatchObject({state: "ok", error: {reason: "bad-response"}});
        expect((await rows(id)).map((row) => row.id)).toEqual([known!.id]);

        // 认证头：凭据变了，旧列表照用。
        local.set(models({id: known!.id}));
        await call("updateProvider", {id, patch: {headers: {"X-Team": "writing"}}});
        expect(provider(id).source.state).toBe("changed");
        expect((await rows(id)).map((row) => row.id)).toEqual([known!.id]);
        await call("refreshSource", {provider: id});
        await until((snapshot) => snapshot.providers.some((item) => item.id === id && item.source.state === "ok" && !item.source.refreshing));
        expect(local.seen.at(-1)).toMatchObject({team: "writing"});

        // 地址：另一个端点，旧列表不用、成员退回目录；自动更新开着也不自动去新地址拉。
        const other = endpoint(models());
        config.setAutoUpdate(true);
        await call("updateProvider", {id, patch: {baseUrl: other.baseUrl}});
        // 过了一天：同一部署的话就该自动重拉了。
        clock.now += SOURCE_STALE_MS + HOUR;
        config.setAutoUpdate(false);
        config.setAutoUpdate(true);
        // 拉取一受理快照里就是 refreshing（同步），所以这里能直接断言没有开始。
        expect(provider(id).source).toMatchObject({state: "changed", checkedAt: null, refreshing: false});
        expect((await rows(id)).length).toBe(chatModels("deepseek").length);
        expect(other.seen).toEqual([]);
    });

    it("拉取在途时认证换了：旧的结果到了也不提交", async () => {
        const local = endpoint(models({id: known!.id}));
        const {id, call, rows, provider, settled, sources} = await deepseek(local);
        let release: () => void = () => undefined;
        local.set(() => new Promise<Response>((resolve) => {
            release = () => resolve(Response.json({data: [{id: "late-model"}]}));
        }));
        await call("refreshSource", {provider: id});
        while (local.seen.length < 2) await Bun.sleep(5);
        await call("updateProvider", {id, patch: {headers: {"X-Team": "writing"}}});
        release();
        await settled(id);
        expect(provider(id).source.state).toBe("changed");
        expect((await rows(id)).map((row) => row.id)).toEqual([known!.id]);
        expect((await rows(id, "available")).map((row) => row.id)).not.toContain("late-model");
        // 也没有写盘：重启后不会把它当成旧凭据的列表读回来。
        expect(JSON.stringify([...sources.files.values()])).not.toContain("late-model");
    });
});

describe("来源缓存", () => {
    it("重启后读缓存、不出站；缓存文件不合格时不用并写诊断；删服务商回收它的文件，同名重建不继承", async () => {
        const local = endpoint(models({id: "house-chat", context_length: 32_000}));
        const config = memoryModelsConfig({autoUpdate: true});
        const sources = memorySourceStore();
        const credentials = await openCredentials(join(tmp, "credentials-restart.db"));
        cleanup.push(() => credentials.close());
        const first = await start({config, sources, credentials});
        const id = await addBlank(first.call, local.baseUrl);
        await first.call("setKey", {provider: id, value: "sk-local-0001"});
        await first.settled(id);
        await first.close();
        const uid = (config.providers.read() as Array<StoredProvider & {uid: string}>)[0]!.uid;
        expect([...sources.files.keys()]).toEqual([sourceKeyOf(uid)]);

        const second = await start({config, sources, credentials, clock: {now: 1_800_000_000_000 + HOUR}});
        expect(second.provider(id).source).toMatchObject({state: "ok"});
        expect((await second.rows(id)).map((row) => row.id)).toEqual(["house-chat"]);
        expect(local.seen).toHaveLength(1);
        await second.close();

        sources.files.set(sourceKeyOf(uid), {...(sources.files.get(sourceKeyOf(uid)) as object), uid: "someone-else"});
        const third = await start({config, sources, credentials});
        expect(third.provider(id).source.state).toBe("none");
        expect(third.events).toContain("models.sources.invalid");

        await third.call("removeProvider", {id});
        expect(sources.files.size).toBe(0);
        const again = await addBlank(third.call, local.baseUrl);
        expect(again).toBe(id);
        expect(third.provider(again).source.state).toBe("none");
    });

    it("设置读不到时不回收孤立文件（分不清是删了还是暂时读不到）；读得到时回收", async () => {
        const config = memoryModelsConfig({autoUpdate: true});
        const sources = memorySourceStore();
        sources.files.set("orphan-uid", {version: 1});
        config.setLayer("invalid");
        const first = await start({config, sources});
        expect([...sources.files.keys()]).toEqual(["orphan-uid"]);
        await first.close();
        config.setLayer("ok");
        await start({config, sources});
        expect(sources.files.size).toBe(0);
    });

    it("写盘失败：不当成功，写明原因，列表不换", async () => {
        const local = endpoint(models({id: "house-chat", context_length: 32_000}));
        const sources = memorySourceStore();
        sources.failWrites = true;
        const {call, provider, settled, rows} = await start({sources});
        const id = await addBlank(call, local.baseUrl);
        await call("setKey", {provider: id, value: "sk-local-0001"});
        await settled(id);
        expect(provider(id).source).toMatchObject({state: "none", error: {reason: "storage"}});
        expect(await rows(id)).toEqual([]);
    });
});

describe("自动更新与停止", () => {
    async function seeded(ageMs: number, autoUpdate: boolean) {
        const local = endpoint(models({id: "house-chat", context_length: 32_000}));
        const config = memoryModelsConfig({autoUpdate: true});
        const sources = memorySourceStore();
        const credentials = await openCredentials(join(tmp, `credentials-auto-${String((sequence += 1))}.db`));
        cleanup.push(() => credentials.close());
        const first = await start({config, sources, credentials});
        const id = await addBlank(first.call, local.baseUrl);
        await first.call("setKey", {provider: id, value: "sk-local-0001"});
        await first.settled(id);
        await first.close();
        config.setAutoUpdate(autoUpdate);
        const later = await start({config, sources, credentials, clock: {now: 1_800_000_000_000 + ageMs}});
        return {local, later, id};
    }

    it("开着自动更新：超过一天的列表在启动时后台重拉，不到一天的不拉；关着时不出站", async () => {
        const old = await seeded(SOURCE_STALE_MS + HOUR, true);
        await old.later.until((snapshot) => snapshot.providers.some((item) => item.source.checkedAt === 1_800_000_000_000 + SOURCE_STALE_MS + HOUR));
        expect(old.local.seen).toHaveLength(2);

        const fresh = await seeded(HOUR, true);
        const off = await seeded(SOURCE_STALE_MS + HOUR, false);
        // 排一个看得见的动作走同一条路（手动拉一次另一家），等它完成后再看没有发生的后台拉取。
        const probe = endpoint(models());
        const id = await addBlank(fresh.later.call, probe.baseUrl, "Probe");
        await fresh.later.call("setKey", {provider: id, value: "sk-local-0002"});
        await fresh.later.settled(id);
        expect(fresh.local.seen).toHaveLength(1);
        expect(off.local.seen).toHaveLength(1);
    });

    it("停止时取消在途的拉取（响应体不结束），限时收尾，结果不提交", async () => {
        const local = endpoint(models());
        const {call, close, sources} = await start();
        const id = await addBlank(call, local.baseUrl);
        let stall: ReadableStreamDefaultController<Uint8Array> | null = null;
        local.set(() => new Response(new ReadableStream<Uint8Array>({start(controller) {
            stall = controller;
            controller.enqueue(new TextEncoder().encode('{"data":['));
        }}), {headers: {"content-type": "application/json"}}));
        await call("setKey", {provider: id, value: "sk-local-0001"});
        while (stall === null) await Bun.sleep(5);
        const began = performance.now();
        await close();
        expect(performance.now() - began).toBeLessThan(2500);
        expect(sources.files.size).toBe(0);
        (stall as ReadableStreamDefaultController<Uint8Array> | null)?.close();
    });
});

describe("在线目录", () => {
    const payload = {moonshotai: {models: {"kimi-online-only": {id: "kimi-online-only", name: "Kimi Online", tool_call: true, limit: {context: 256_000, output: 32_000}, cost: {input: 1, output: 4}}}}};

    it("自动更新开着时取在线目录，打包里没有的模型出现在跟随模板的服务商里；存下来，下次启动不出站也有；过期后带 ETag 重取，304 只刷新时间", async () => {
        const seen: Array<string | null> = [];
        const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: (request) => {
            seen.push(request.headers.get("if-none-match"));
            return request.headers.get("if-none-match") === '"v1"' ? new Response(null, {status: 304}) : new Response(JSON.stringify(payload), {headers: {etag: '"v1"'}});
        }});
        cleanup.push(() => server.stop(true));
        const catalogUrl = `http://127.0.0.1:${String(server.port)}/models.json.zstd`;
        const config = memoryModelsConfig({autoUpdate: true});
        const sources = memorySourceStore();
        const first = await start({config, sources, catalogUrl});
        const added = await first.call("addProvider", {template: "moonshot"});
        if (!added.ok) throw new Error(added.code);
        const id = added.value.id;
        const bundled = chatModels("moonshot").length;
        await first.until((snapshot) => snapshot.providers.some((item) => item.id === id && item.modelCount === bundled + 1));
        expect((await first.rows(id)).find((row) => row.id === "kimi-online-only")).toMatchObject({kind: "chat", contextWindow: 256_000, maxOutput: 32_000, price: [1, 4, 0, 0], status: "ok"});
        await first.close();
        expect(sources.catalog).toMatchObject({version: 1, etag: '"v1"', fetchedAt: 1_800_000_000_000});

        config.setAutoUpdate(false);
        const second = await start({config, sources, catalogUrl});
        expect(second.provider(id).modelCount).toBe(bundled + 1);
        expect(seen).toEqual([null]);
        await second.close();

        config.setAutoUpdate(true);
        const third = await start({config, sources, catalogUrl, clock: {now: 1_800_000_000_000 + SOURCE_STALE_MS + HOUR}});
        while ((sources.catalog as {fetchedAt: number}).fetchedAt !== 1_800_000_000_000 + SOURCE_STALE_MS + HOUR) await Bun.sleep(5);
        await third.close();
        expect(seen).toEqual([null, '"v1"']);
        expect(sources.catalog).toMatchObject({etag: '"v1"'});
    });

    it("坏的在线目录被拒收：写诊断，成员不变，本地那份不被覆盖", async () => {
        const server = Bun.serve({port: 0, hostname: "127.0.0.1", fetch: () => new Response("not a catalog")});
        cleanup.push(() => server.stop(true));
        const sources = memorySourceStore();
        const {events, close} = await start({config: memoryModelsConfig({autoUpdate: true}), sources, catalogUrl: `http://127.0.0.1:${String(server.port)}/c`});
        while (!events.includes("models.catalog.rejected")) await Bun.sleep(5);
        await close();
        expect(sources.catalog).toBeNull();
    });
});

describe("审查补的边界", () => {
    const [known] = chatModels("deepseek");

    it("目录模板里类型不明、列表给了窗口的模型：在管理模型里加入就进列表、启用、可用（决定 27 的一键启用）", async () => {
        const local = endpoint(models({id: known!.id}, {id: "deepseek-account-only", context_length: 32_000}));
        const {call, rows, settled} = await start();
        const added = await call("addProvider", {template: "deepseek", baseUrl: local.baseUrl});
        if (!added.ok) throw new Error(added.code);
        const id = added.value.id;
        await call("setKey", {provider: id, value: "sk-deepseek-0001"});
        await settled(id);
        expect((await rows(id, "available")).map((row) => row.id)).toEqual(["deepseek-account-only"]);
        expect(await call("setModels", {provider: id, add: [{id: "deepseek-account-only", enabled: true}], remove: []})).toMatchObject({ok: true});
        expect((await rows(id)).find((row) => row.id === "deepseek-account-only")).toMatchObject({kind: "unknown", enabled: true, usable: true});
    });

    it("关掉自动加入：缺窗口、没启用的照样记成没启用；再打开时这条纯冻结的条目删掉", async () => {
        const local = endpoint(models({id: "house-bare"}));
        const {call, rows, settled, store} = await start({config: memoryModelsConfig({autoUpdate: true})}).then((context) => ({...context, store: context.config}));
        const id = await addBlank(call, local.baseUrl);
        await call("setKey", {provider: id, value: "sk-local-0001"});
        await settled(id);
        await call("updateProvider", {id, patch: {followSource: false}});
        expect((await rows(id)).map((row) => [row.id, row.enabled])).toEqual([["house-bare", false]]);
        await call("updateProvider", {id, patch: {followSource: true}});
        expect((store.providers.read() as Array<{models: unknown[]}>)[0]!.models).toEqual([]);
    });

    it("第一次拉取失败后改了地址：过了一天也不在后台带着原来的密钥去新地址", async () => {
        const first = endpoint(() => Response.json({error: "overloaded"}, {status: 503}));
        const other = endpoint(models({id: "elsewhere"}));
        const {call, provider, settled, config, clock} = await start();
        const id = await addBlank(call, first.baseUrl);
        await call("setKey", {provider: id, value: "sk-local-0001"});
        await settled(id);
        expect(provider(id).source.error).toMatchObject({reason: "bad-response"});
        await call("updateProvider", {id, patch: {baseUrl: other.baseUrl}});
        clock.now += SOURCE_STALE_MS + HOUR;
        config.setAutoUpdate(false);
        config.setAutoUpdate(true);
        expect(provider(id).source.refreshing).toBe(false);
        expect(other.seen).toEqual([]);
    });

    it("设置读不到时不出站：重新拉取得 settings-unavailable", async () => {
        const local = endpoint(models({id: "house-chat", context_length: 32_000}));
        const {call, config, settled} = await start();
        const id = await addBlank(call, local.baseUrl);
        await call("setKey", {provider: id, value: "sk-local-0001"});
        await settled(id);
        const before = local.seen.length;
        config.setLayer("invalid");
        expect(await call("refreshSource", {provider: id})).toMatchObject({ok: false, code: "settings-unavailable"});
        expect(local.seen).toHaveLength(before);
    });

    it("目录说不是对话模型的，列表说能生成内容也不收（Gemini 的图片模型）", async () => {
        const local = endpoint(() => Response.json({models: [
            {name: "models/gemini-2.5-flash-image", supportedGenerationMethods: ["generateContent"]},
            {name: "models/house-gemini", supportedGenerationMethods: ["generateContent"], inputTokenLimit: 100_000},
        ]}));
        const {call, rows, settled} = await start();
        const added = await call("addProvider", {template: "google", baseUrl: `${local.baseUrl}beta`});
        if (!added.ok) throw new Error(added.code);
        const id = added.value.id;
        await call("setKey", {provider: id, value: "g-key-0001"});
        await settled(id);
        const all = [...await rows(id), ...await rows(id, "available")].map((row) => row.id);
        expect(all).toEqual(["house-gemini"]);
    });

    it("翻页时清了密钥：在途的拉取立刻停，下一页不发", async () => {
        let release: () => void = () => undefined;
        const local = endpoint(() => new Promise<Response>((resolve) => {
            release = () => resolve(Response.json({data: [{id: "claude-a"}], has_more: true, last_id: "claude-a"}));
        }));
        const {call, settled, provider} = await start();
        const added = await call("addProvider", {template: "blank-anthropic", name: "Relay", baseUrl: local.baseUrl});
        if (!added.ok) throw new Error(added.code);
        const id = added.value.id;
        await call("setKey", {provider: id, value: "sk-relay-0001"});
        while (local.seen.length < 1) await Bun.sleep(5);
        await call("clearKey", {provider: id});
        release();
        await settled(id);
        expect(local.seen).toHaveLength(1);
        expect(provider(id).source.state).toBe("none");
    });
});
