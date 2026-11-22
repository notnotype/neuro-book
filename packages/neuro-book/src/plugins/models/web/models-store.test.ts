/**
 * 设置页的数据模块（web/models-store.ts）接真实的服务端：配置场地里起 `nbook.models`，窗口经真实的远程合同调用；检测打到本机的
 * OpenAI 兼容端点（docs/specs/models/settings-pages.md 输出 8、15、16）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {modelsWorld} from "../testing/world";
import type {ModelsWorld} from "../testing/world";
import {checkKey, createModelsStore} from "./models-store";
import type {ModelsStore} from "./models-store";

/**
 * 模型 id 以 `hang` 开头的请求挂着不答，直到请求被中止（看检测的取消）；以 `slow` 开头的等测试放行才答（看并发）。
 */
const slowWaiting: Array<() => void> = [];
/** 到了端点的 `hang` 类请求（看取消之后不再发）。 */
const hangArrivals: string[] = [];
const releaseSlow = (): void => {
    for (const release of slowWaiting.splice(0)) release();
};
const endpoint = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const body = await request.json().catch(() => ({})) as {model?: string};
        if (body.model?.startsWith("hang") === true) {
            hangArrivals.push(body.model);
            await new Promise((resolve) => request.signal.addEventListener("abort", resolve));
            return new Response(null, {status: 499});
        }
        if (body.model?.startsWith("slow") === true) await new Promise<void>((resolve) => slowWaiting.push(resolve));
        if (body.model === "broken") return Response.json({error: {message: "model not found"}}, {status: 404});
        const chunk = (payload: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...payload})}\n\n`;
        return new Response(chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]}) + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]}) + "data: [DONE]\n\n", {headers: {"content-type": "text/event-stream"}});
    },
});
const BASE = `http://127.0.0.1:${endpoint.port}/v1`;

let root = "";
let counter = 0;
const worlds: ModelsWorld[] = [];
const stores: ModelsStore[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-models-store", "store");
});
afterEach(async () => {
    for (const store of stores.splice(0)) store.dispose();
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    endpoint.stop(true);
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function setup(): Promise<{world: ModelsWorld; store: ModelsStore; other: Awaited<ReturnType<ModelsWorld["window"]>>}> {
    counter += 1;
    const world = await modelsWorld(join(root, `world-${String(counter)}`));
    worlds.push(world);
    const store = createModelsStore(await world.window("a"), () => 1_000);
    stores.push(store);
    return {world, store, other: await world.window("b")};
}

const ok = <T>(result: {ok: boolean; value?: T}): T => {
    if (!result.ok) throw new Error(`call failed: ${JSON.stringify(result)}`);
    return result.value as T;
};

describe("数据模块", () => {
    test("订阅后拿到快照；别的窗口改了即时跟上；写失败交回码与详情、不抛", async () => {
        const {store, other} = await setup();
        expect(store.snapshot.value).toBeNull();
        await store.start();
        await waitUntil("第一份快照", () => store.snapshot.value !== null);
        expect(store.available.value).toBe(true);

        ok(await other.addProvider({template: "blank-openai", name: "本地", baseUrl: BASE, api: "openai-completions"}));
        await waitUntil("另一个窗口加的服务商出现", () => store.snapshot.value?.providers.some((provider) => provider.id === "provider") === true);

        const failed = await store.call("updateProvider", {id: "missing", patch: {name: "x"}});
        expect(failed).toMatchObject({ok: false, failure: {code: "unknown-provider"}});
    });

    test("检测：进行中是 running，完成后记下结果与时间；失败带类别与原文；检测全部按模型记、只检确认过的那份", async () => {
        const {store} = await setup();
        await store.start();
        ok(await store.call("addProvider", {template: "blank-openai", name: "本地", baseUrl: BASE, api: "openai-completions"}));
        ok(await store.call("updateProvider", {id: "provider", patch: {auth: "none"}}));
        ok(await store.call("setModels", {provider: "provider", remove: [], add: [{id: "good", enabled: true, contextWindow: 8000}, {id: "broken", enabled: true, contextWindow: 8000}, {id: "hang", enabled: false, contextWindow: 8000}]}));
        await waitUntil("模型都在快照里", () => store.snapshot.value?.providers.find((provider) => provider.id === "provider")?.modelCount === 3);

        const running = store.check("provider", "good");
        expect(store.checks.get(checkKey("provider", "good"))).toEqual({status: "running"});
        await running;
        expect(store.checks.get(checkKey("provider", "good"))).toEqual({status: "done", at: 1_000, result: {ok: true}});

        await store.check("provider", "broken");
        const broken = store.checks.get(checkKey("provider", "broken"));
        expect(broken).toMatchObject({status: "done", result: {ok: false, kind: "provider"}});

        // 停用的模型不在“检测全部”里。
        const targets = await store.checkTargets("provider");
        expect([...targets].sort()).toEqual(["broken", "good"]);
        await store.checkAll("provider", ["good"]);
        expect(store.checks.get(checkKey("provider", "good"))).toMatchObject({status: "done", result: {ok: true}});
        expect(store.checks.get(checkKey("provider", "broken"))).toBe(broken);
        expect(store.checks.has(checkKey("provider", "hang"))).toBe(false);
    });

    test("检测全部在客户端逐个发、同时至多 4 个，只把在检测的标 running，进度按已结算的个数走；正在单独检测的跳过、两边各自结算", async () => {
        const {store} = await setup();
        await store.start();
        ok(await store.call("addProvider", {template: "blank-openai", name: "本地", baseUrl: BASE, api: "openai-completions"}));
        ok(await store.call("updateProvider", {id: "provider", patch: {auth: "none"}}));
        const ids = ["slow-1", "slow-2", "slow-3", "slow-4", "slow-5", "slow-6"];
        ok(await store.call("setModels", {provider: "provider", remove: [], add: ids.map((id) => ({id, enabled: true, contextWindow: 8000}))}));
        await waitUntil("模型都在快照里", () => store.snapshot.value?.providers[0]?.modelCount === 6);
        const targets = await store.checkTargets("provider");
        expect([...targets].sort()).toEqual(ids);

        const single = store.check("provider", "slow-1");
        await waitUntil("单独检测的请求到了端点", () => slowWaiting.length === 1);
        const all = store.checkAll("provider", targets);
        // 单独检测占着 slow-1：检测全部跳过它，另发 4 个。
        await waitUntil("四路请求到了端点", () => slowWaiting.length === 5);
        const running = () => ids.filter((id) => store.checks.get(checkKey("provider", id))?.status === "running");
        expect(running()).toHaveLength(5);
        expect(store.checkRuns.get("provider")).toEqual({done: 1, total: 6});
        releaseSlow();
        await waitUntil("剩下的一个发出", () => slowWaiting.length === 1);
        expect(running()).toHaveLength(1);
        expect(store.checkRuns.get("provider")).toEqual({done: 5, total: 6});
        releaseSlow();
        await Promise.all([all, single]);
        expect(ids.map((id) => store.checks.get(checkKey("provider", id))?.status)).toEqual(ids.map(() => "done"));
        expect(store.checkRuns.has("provider")).toBe(false);
    });

    test("检测全部进行中停用了还没领到的模型：读到的行里它已停用，就不再发，也算进进度", async () => {
        const {store} = await setup();
        await store.start();
        ok(await store.call("addProvider", {template: "blank-openai", name: "本地", baseUrl: BASE, api: "openai-completions"}));
        ok(await store.call("updateProvider", {id: "provider", patch: {auth: "none"}}));
        const ids = ["slow-1", "slow-2", "slow-3", "slow-4", "slow-5", "slow-6"];
        ok(await store.call("setModels", {provider: "provider", remove: [], add: ids.map((id) => ({id, enabled: true, contextWindow: 8000}))}));
        await waitUntil("模型都在快照里", () => store.snapshot.value?.providers[0]?.modelCount === 6);
        const all = store.checkAll("provider", await store.checkTargets("provider"));
        await waitUntil("四路请求到了端点", () => slowWaiting.length === 4);
        ok(await store.call("upsertModel", {provider: "provider", model: {id: "slow-6", enabled: false, contextWindow: 8000}}));
        await waitUntil("快照换了版本", () => store.snapshot.value?.providers[0]?.enabledCount === 5);
        await store.loadRows("provider");
        releaseSlow();
        await waitUntil("剩下的一个发出", () => slowWaiting.length === 1);
        releaseSlow();
        await all;
        expect(store.checks.has(checkKey("provider", "slow-6"))).toBe(false);
        expect(ids.slice(0, 5).map((id) => store.checks.get(checkKey("provider", id))?.status)).toEqual(ids.slice(0, 5).map(() => "done"));
        expect(store.checkRuns.has("provider")).toBe(false);
    });

    test("检测全部进行中取消：已发出的标 unknown，没领到的保持原样、不再发；单独检测取消也标 unknown", async () => {
        const {store} = await setup();
        await store.start();
        ok(await store.call("addProvider", {template: "blank-openai", name: "本地", baseUrl: BASE, api: "openai-completions"}));
        ok(await store.call("updateProvider", {id: "provider", patch: {auth: "none"}}));
        const hangs = ["hang-1", "hang-2", "hang-3", "hang-4", "hang-5"];
        ok(await store.call("setModels", {provider: "provider", remove: [], add: [...hangs, "good"].map((id) => ({id, enabled: true, contextWindow: 8000}))}));
        await waitUntil("模型都在快照里", () => store.snapshot.value?.providers[0]?.modelCount === 6);
        await store.check("provider", "good");
        const before = store.checks.get(checkKey("provider", "good"));
        expect(before).toMatchObject({status: "done"});

        hangArrivals.length = 0;
        const all = store.checkAll("provider", [...hangs, "good"]);
        await waitUntil("四路请求到了端点", () => hangArrivals.length === 4);
        store.cancel("provider");
        await all;
        expect(hangs.slice(0, 4).map((id) => store.checks.get(checkKey("provider", id)))).toEqual(hangs.slice(0, 4).map(() => ({status: "unknown", at: 1_000})));
        expect(store.checks.has(checkKey("provider", "hang-5"))).toBe(false);
        expect(store.checks.get(checkKey("provider", "good"))).toEqual(before);
        expect(hangArrivals).toHaveLength(4);
        expect(store.checkRuns.has("provider")).toBe(false);

        const single = store.check("provider", "hang-5");
        await waitUntil("单独检测开始", () => hangArrivals.length === 5);
        store.cancel("provider", "hang-5");
        await single;
        expect(store.checks.get(checkKey("provider", "hang-5"))).toEqual({status: "unknown", at: 1_000});
    });

    test("没检成（服务商不在了）记在服务商上、不算模型的检测失败；服务商删掉后它的检测结果清掉；释放后不再可用", async () => {
        const {store} = await setup();
        await store.start();
        await store.check("missing", "m");
        expect(store.checks.has(checkKey("missing", "m"))).toBe(false);
        expect(store.checkErrors.get("missing")).toMatchObject({code: "unknown-provider"});

        ok(await store.call("addProvider", {template: "blank-openai", name: "本地", baseUrl: BASE, api: "openai-completions"}));
        ok(await store.call("updateProvider", {id: "provider", patch: {auth: "none"}}));
        ok(await store.call("upsertModel", {provider: "provider", model: {id: "good", enabled: true, contextWindow: 8000}}));
        await waitUntil("模型在快照里", () => store.snapshot.value?.providers[0]?.modelCount === 1);
        await store.check("provider", "good");
        expect(store.checks.has(checkKey("provider", "good"))).toBe(true);
        ok(await store.call("removeProvider", {id: "provider"}));
        await waitUntil("服务商从快照里消失", () => store.snapshot.value?.providers.length === 0);
        expect(store.checks.has(checkKey("provider", "good"))).toBe(false);

        store.dispose();
        expect(store.available.value).toBe(false);
    });

    test("释放后不再跟着快照变", async () => {
        const {store, other} = await setup();
        await store.start();
        await waitUntil("第一份快照", () => store.snapshot.value !== null);
        store.dispose();
        ok(await other.addProvider({template: "blank-openai", name: "晚到", baseUrl: BASE, api: "openai-completions"}));
        // 另开一个数据模块确认写入已经广播出去，再看释放的那个没有收到。
        const witness = createModelsStore(other);
        stores.push(witness);
        await witness.start();
        await waitUntil("新的数据模块看到它", () => witness.snapshot.value?.providers.length === 1);
        expect(store.snapshot.value?.providers ?? []).toEqual([]);
    });
});
