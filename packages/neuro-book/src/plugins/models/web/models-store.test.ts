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
 * 模型 id 是 `hang` 的请求挂着不答，直到请求被中止（看检测的取消）；`slow` 等测试放行才答（看并发：两路请求都到了再放）。
 */
const slowWaiting: Array<() => void> = [];
const releaseSlow = (): void => {
    for (const release of slowWaiting.splice(0)) release();
};
const endpoint = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
        const body = await request.json().catch(() => ({})) as {model?: string};
        if (body.model === "hang") {
            await new Promise((resolve) => request.signal.addEventListener("abort", resolve));
            return new Response(null, {status: 499});
        }
        if (body.model === "slow") await new Promise<void>((resolve) => slowWaiting.push(resolve));
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

        ok(await other.addProvider({source: {kind: "custom", name: "本地", baseUrl: BASE, api: "openai-completions"}}));
        await waitUntil("另一个窗口加的服务商出现", () => store.snapshot.value?.providers.some((provider) => provider.id === "custom") === true);

        const failed = await store.call("updateProvider", {id: "missing", patch: {name: "x"}});
        expect(failed).toMatchObject({ok: false, failure: {code: "unknown-provider"}});
    });

    test("检测：进行中是 running，完成后记下结果与时间；失败带类别与原文；检测全部按模型记；中止时回到原样", async () => {
        const {store} = await setup();
        await store.start();
        ok(await store.call("addProvider", {source: {kind: "custom", name: "本地", baseUrl: BASE, api: "openai-completions"}}));
        ok(await store.call("updateProvider", {id: "custom", patch: {auth: "none"}}));
        ok(await store.call("setModels", {provider: "custom", remove: [], add: [{id: "good", enabled: true, contextWindow: 8000}, {id: "broken", enabled: true, contextWindow: 8000}, {id: "hang", enabled: false, contextWindow: 8000}]}));
        await waitUntil("模型都在快照里", () => store.snapshot.value?.providers.find((provider) => provider.id === "custom")?.models.length === 3);

        const running = store.check("custom", "good");
        expect(store.checks.get(checkKey("custom", "good"))).toEqual({status: "running"});
        await running;
        expect(store.checks.get(checkKey("custom", "good"))).toEqual({status: "done", at: 1_000, result: {ok: true}});

        await store.check("custom", "broken");
        const broken = store.checks.get(checkKey("custom", "broken"));
        expect(broken).toMatchObject({status: "done", result: {ok: false, kind: "provider"}});

        await store.checkAll("custom");
        expect(store.checks.get(checkKey("custom", "good"))).toMatchObject({status: "done", result: {ok: true}});
        // 停用的模型不在“检测全部”里。
        expect(store.checks.has(checkKey("custom", "hang"))).toBe(false);

        ok(await store.call("upsertModel", {provider: "custom", model: {id: "hang", enabled: true, contextWindow: 8000}}));
        await waitUntil("hang 启用", () => store.snapshot.value?.providers[0]?.models.find((item) => item.id === "hang")?.enabled === true);
        const hang = store.check("custom", "hang");
        await waitUntil("检测开始", () => store.checks.get(checkKey("custom", "hang"))?.status === "running");
        store.cancel("custom", "hang");
        await hang;
        expect(store.checks.has(checkKey("custom", "hang"))).toBe(false);
    });

    test("单独检测与检测全部同时进行：检测全部不重标正在单独检测的模型，两边各自结算，不会留下永远转圈的；检测全部进行中取消，各自回到开始之前", async () => {
        const {store} = await setup();
        await store.start();
        ok(await store.call("addProvider", {source: {kind: "custom", name: "本地", baseUrl: BASE, api: "openai-completions"}}));
        ok(await store.call("updateProvider", {id: "custom", patch: {auth: "none"}}));
        ok(await store.call("setModels", {provider: "custom", remove: [], add: [{id: "good", enabled: true, contextWindow: 8000}, {id: "slow", enabled: true, contextWindow: 8000}]}));
        await waitUntil("模型都在快照里", () => store.snapshot.value?.providers[0]?.models.length === 2);

        const single = store.check("custom", "slow");
        await waitUntil("单独检测的请求到了端点", () => slowWaiting.length === 1);
        const everything = store.checkAll("custom");
        // 检测全部在服务端也检 slow：两路请求都到了再一起放行。
        await waitUntil("检测全部的请求也到了端点", () => slowWaiting.length === 2);
        releaseSlow();
        await Promise.all([everything, single]);
        expect(store.checks.get(checkKey("custom", "good"))).toMatchObject({status: "done", result: {ok: true}});
        expect(store.checks.get(checkKey("custom", "slow"))).toMatchObject({status: "done", result: {ok: true}});

        // 检测全部进行中取消：两个都回到开始之前（上一次的结果）。
        ok(await store.call("setModels", {provider: "custom", remove: ["slow"], add: [{id: "hang", enabled: true, contextWindow: 8000}]}));
        await waitUntil("hang 在快照里", () => store.snapshot.value?.providers[0]?.models.some((item) => item.id === "hang") === true);
        const before = JSON.stringify(store.checks.get(checkKey("custom", "good")));
        const all = store.checkAll("custom");
        await waitUntil("检测全部开始", () => store.checks.get(checkKey("custom", "hang"))?.status === "running");
        store.cancel("custom");
        await all;
        expect(JSON.stringify(store.checks.get(checkKey("custom", "good")))).toBe(before);
        expect(store.checks.has(checkKey("custom", "hang"))).toBe(false);
    });

    test("没检成（服务商不在了）记在服务商上、不算模型的检测失败；服务商删掉后它的检测结果清掉；释放后不再可用", async () => {
        const {store} = await setup();
        await store.start();
        await store.check("missing", "m");
        expect(store.checks.has(checkKey("missing", "m"))).toBe(false);
        expect(store.checkErrors.get("missing")).toMatchObject({code: "unknown-provider"});

        ok(await store.call("addProvider", {source: {kind: "custom", name: "本地", baseUrl: BASE, api: "openai-completions"}}));
        ok(await store.call("updateProvider", {id: "custom", patch: {auth: "none"}}));
        ok(await store.call("upsertModel", {provider: "custom", model: {id: "good", enabled: true, contextWindow: 8000}}));
        await waitUntil("模型在快照里", () => store.snapshot.value?.providers[0]?.models.length === 1);
        await store.check("custom", "good");
        expect(store.checks.has(checkKey("custom", "good"))).toBe(true);
        ok(await store.call("removeProvider", {id: "custom"}));
        await waitUntil("服务商从快照里消失", () => store.snapshot.value?.providers.length === 0);
        expect(store.checks.has(checkKey("custom", "good"))).toBe(false);

        store.dispose();
        expect(store.available.value).toBe(false);
    });

    test("释放后不再跟着快照变", async () => {
        const {store, other} = await setup();
        await store.start();
        await waitUntil("第一份快照", () => store.snapshot.value !== null);
        store.dispose();
        ok(await other.addProvider({source: {kind: "custom", name: "晚到", baseUrl: BASE, api: "openai-completions"}}));
        // 另开一个数据模块确认写入已经广播出去，再看释放的那个没有收到。
        const witness = createModelsStore(other);
        stores.push(witness);
        await witness.start();
        await waitUntil("新的数据模块看到它", () => witness.snapshot.value?.providers.length === 1);
        expect(store.snapshot.value?.providers ?? []).toEqual([]);
    });
});
