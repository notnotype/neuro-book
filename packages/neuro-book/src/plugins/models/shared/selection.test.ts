/**
 * 选用数据（docs/specs/models/settings-pages.md“选用数据”）：真实的服务端实例与远程合同链路（`modelsWorld`），读法由调用计数判定。
 */

import {afterAll, afterEach, beforeAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {modelsWorld} from "../testing/world";
import type {ModelsWorld} from "../testing/world";
import {createSelectionData} from "./selection";
import type {Cell, SelectionRemote} from "./selection";

let root = "";
let counter = 0;
const worlds: ModelsWorld[] = [];
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-models", "selection");
});
afterEach(async () => {
    for (const world of worlds.splice(0)) await world.close();
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

const ok = <T>(result: {ok: boolean; value?: T}): T => {
    if (!result.ok) throw new Error(`remote call failed: ${JSON.stringify(result)}`);
    return result.value as T;
};

/**
 * 记每次对服务端的调用与 `rows` 被换了几次的选用数据夹具。`hold` 给了时每次调用先等它交回的 Promise（测读到一半来了新快照、
 * 并发登记引用）；`fail` 给了时这家的读取交回这个失败码（在真实服务端前面注入故障）。
 */
async function fixture(options: {usable: boolean; lazy?: boolean; hold?: (method: string, input: unknown) => Promise<void> | undefined; fail?: (provider: string) => string | undefined}) {
    counter += 1;
    const w = await modelsWorld(join(root, `world-${String(counter)}`));
    worlds.push(w);
    const client = await w.window("w");
    const calls: Array<{method: string; input: unknown}> = [];
    const remote: SelectionRemote = {
        enabledModels: async (input) => {
            calls.push({method: "enabledModels", input});
            await options.hold?.("enabledModels", input);
            const failed = options.fail?.(input.providers?.[0] ?? "");
            if (failed !== undefined) return {ok: false, code: failed};
            return client.enabledModels(input) as ReturnType<SelectionRemote["enabledModels"]>;
        },
        modelsByReference: async (input) => {
            calls.push({method: "modelsByReference", input});
            await options.hold?.("modelsByReference", input);
            return client.modelsByReference(input) as ReturnType<SelectionRemote["modelsByReference"]>;
        },
    };
    const writes: Record<string, number> = {};
    const ref = <T>(initial: T): Cell<T> => {
        let value = initial;
        const id = String(Object.keys(writes).length);
        writes[id] = 0;
        return {get value() { return value; }, set value(next: T) { writes[id] = (writes[id] ?? 0) + 1; value = next; }};
    };
    const selection = createSelectionData({remote, ref, usable: options.usable, ...(options.lazy === undefined ? {} : {lazy: options.lazy})});
    let notified = 0;
    selection.subscribe(() => {
        notified += 1;
    });
    return {w, client, calls, selection, writes: () => Object.values(writes), notified: () => notified};
}

describe("选用数据", () => {
    test("只重读变了的那家：别家的版本没变就不再请求；整批到齐后 rows 只换一次；读完之后 ready", async () => {
        const f = await fixture({usable: false});
        const a = ok(await f.client.addProvider({template: "deepseek"})).id;
        const b = ok(await f.client.addProvider({template: "openrouter"})).id;
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("第一次读完", () => f.selection.ready.value);
        expect(new Set(f.selection.rows.value.map((row) => row.provider))).toEqual(new Set([a, b]));
        // 一家几百个模型：openrouter 分三页读，页大小 200。
        const openrouterCalls = f.calls.filter((call) => (call.input as {providers: string[]}).providers[0] === b);
        expect(openrouterCalls.length).toBe(Math.ceil(f.selection.rows.value.filter((row) => row.provider === b).length / 200));
        const swapsAfterFirst = f.writes()[0]!;

        f.calls.length = 0;
        ok(await f.client.updateProvider({id: a, patch: {name: "改了名"}}));
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("读到新版本", () => f.calls.length > 0);
        await waitUntil("换上新的 rows", () => f.writes()[0]! > swapsAfterFirst);
        expect(f.calls.every((call) => (call.input as {providers: string[]}).providers[0] === a)).toBe(true);
        expect(f.writes()[0]).toBe(swapsAfterFirst + 1);
    });

    test("usable 只留有凭据的服务商里可用的模型；给了密钥后这家的模型出现", async () => {
        const f = await fixture({usable: true});
        const a = ok(await f.client.addProvider({template: "deepseek"})).id;
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("第一次读完", () => f.selection.ready.value);
        expect(f.selection.rows.value).toEqual([]);
        ok(await f.client.setKey({provider: a, value: "sk-selection-0001"}));
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("有可选的模型", () => f.selection.rows.value.length > 0);
        expect(f.selection.rows.value.every((row) => row.provider === a && row.usable)).toBe(true);
    });

    test("按引用取：一次不超过上限，分批请求；服务商版本变了才重取；移出的模型是 null", async () => {
        const f = await fixture({usable: false});
        const id = ok(await f.client.addProvider({template: "openrouter"})).id;
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("第一次读完", () => f.selection.ready.value);
        const references = f.selection.rows.value.slice(0, 120).map((row) => `${row.provider}/${row.id}`);
        f.calls.length = 0;
        f.selection.want([...references, `${id}/no-such-model`, "gone/x"]);
        await waitUntil("取到了", () => f.selection.lookup.value.size === 122);
        expect(f.calls.filter((call) => call.method === "modelsByReference").map((call) => (call.input as {references: string[]}).references.length)).toEqual([50, 50, 22]);
        expect(f.selection.lookup.value.get(references[0]!)).toMatchObject({id: references[0]!.slice(id.length + 1)});
        expect(f.selection.lookup.value.get(`${id}/no-such-model`)).toBeNull();
        // 版本没变：再登记同样的引用不请求。
        f.calls.length = 0;
        f.selection.want(references);
        await Promise.resolve();
        expect(f.calls.filter((call) => call.method === "modelsByReference")).toEqual([]);
        // 移出一个：版本变了，重取之后这个引用是 null。
        const removed = f.selection.rows.value[0]!;
        ok(await f.client.setModels({provider: id, add: [], remove: [removed.id]}));
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("移出的取到 null", () => f.selection.lookup.value.get(`${id}/${removed.id}`) === null);
    });

    test("快照里各家的版本都没变（只改了角色）：不请求、不换 rows 与 lookup、不通知；attach 交回要不要重读", async () => {
        const f = await fixture({usable: false});
        const a = ok(await f.client.addProvider({template: "deepseek"})).id;
        expect(f.selection.attach(f.w.service.snapshot())).toBe(true);
        await waitUntil("第一次读完", () => f.selection.ready.value);
        const model = f.selection.rows.value[0]!;
        f.selection.want([`${a}/${model.id}`]);
        await waitUntil("取到引用", () => f.selection.lookup.value.size === 1);
        const rows = f.selection.rows.value;
        const lookup = f.selection.lookup.value;
        const notified = f.notified();
        f.calls.length = 0;
        ok(await f.client.setRole({id: "main", model: `${a}/${model.id}`}));
        expect(f.selection.attach(f.w.service.snapshot())).toBe(false);
        f.selection.want([`${a}/${model.id}`]);
        // 等这一轮走完：再登记一个新引用、等它取到，前面那轮必然已经结束。
        f.selection.want([`${a}/${model.id}`, `${a}/no-such-model`]);
        await waitUntil("新引用取到", () => f.selection.lookup.value.has(`${a}/no-such-model`));
        expect(f.calls.filter((call) => call.method === "enabledModels")).toEqual([]);
        expect(f.selection.rows.value).toBe(rows);
        expect(f.selection.lookup.value.get(`${a}/${model.id}`)).toBe(lookup.get(`${a}/${model.id}`));
        expect(f.notified()).toBe(notified + 1);
    });

    test("并发登记引用：先完成的那次不把后登记、还没取到的引用说成没有", async () => {
        const gates: Array<() => void> = [];
        const f = await fixture({usable: false, hold: (method) => (method === "modelsByReference" ? new Promise<void>((resolve) => gates.push(resolve)) : undefined)});
        const a = ok(await f.client.addProvider({template: "deepseek"})).id;
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("第一次读完", () => f.selection.ready.value);
        const [x, y] = f.selection.rows.value.map((row) => `${a}/${row.id}`);
        f.selection.want([x!]);
        await waitUntil("第一次登记在取", () => gates.length === 1);
        f.selection.want([x!, y!]);
        await waitUntil("第二次登记在取", () => gates.length === 2);
        gates[0]!();
        await waitUntil("第一次取完", () => f.calls.filter((call) => call.method === "modelsByReference").length === 2);
        expect(f.selection.lookup.value.get(y!)).not.toBeNull();
        gates[1]!();
        await waitUntil("两个都取到", () => f.selection.lookup.value.size === 2);
        expect(f.selection.lookup.value.get(y!)).toMatchObject({id: y!.slice(a.length + 1)});
    });

    test("快照来得比读取快：读完的那家记进缓存，新的一轮只读剩下的，最后到齐", async () => {
        const gates: Array<() => void> = [];
        const f = await fixture({usable: false, hold: (method) => (method === "enabledModels" ? new Promise<void>((resolve) => gates.push(resolve)) : undefined)});
        const a = ok(await f.client.addProvider({template: "deepseek"})).id;
        const b = ok(await f.client.addProvider({template: "moonshot"})).id;
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("两家都在读", () => gates.length === 2);
        // 第一家读完之前先来一份新快照（第二家改了名，版本变了）。
        ok(await f.client.updateProvider({id: b, patch: {name: "改名"}}));
        f.selection.attach(f.w.service.snapshot());
        gates.shift()!();
        gates.shift()!();
        await waitUntil("新一轮在读", () => gates.length > 0);
        // 新的一轮接着等第一轮在读的第一家，只给版本变了的第二家另发一次。
        expect(f.calls.slice(2).map((call) => (call.input as {providers: string[]}).providers[0])).toEqual([b]);
        while (!f.selection.ready.value) {
            gates.shift()?.();
            await Promise.resolve();
        }
        expect(new Set(f.selection.rows.value.map((row) => row.provider))).toEqual(new Set([a, b]));
    });

    test("一家读不到：其余的照样交出、ready 为真；lazy 时订阅之前不读", async () => {
        let broken = "";
        const f = await fixture({usable: false, fail: (provider) => (provider === broken ? "unavailable" : undefined)});
        const a = ok(await f.client.addProvider({template: "deepseek"})).id;
        broken = ok(await f.client.addProvider({template: "moonshot"})).id;
        f.selection.attach(f.w.service.snapshot());
        await waitUntil("第一次读完", () => f.selection.ready.value);
        expect(new Set(f.selection.rows.value.map((row) => row.provider))).toEqual(new Set([a]));

        const lazy = await fixture({usable: false, lazy: true});
        // 夹具里已经订阅了：另建一份没有订阅的看“订阅之前不读”。
        const quiet = createSelectionData({remote: {enabledModels: () => Promise.reject(new Error("should not read")), modelsByReference: () => Promise.reject(new Error("should not read"))}, ref: <T>(initial: T) => ({value: initial}), usable: false, lazy: true});
        ok(await lazy.client.addProvider({template: "deepseek"}));
        expect(quiet.attach(lazy.w.service.snapshot())).toBe(false);
        quiet.want(["deepseek/x"]);
        expect(quiet.ready.value).toBe(false);
        quiet.dispose();
        lazy.selection.attach(lazy.w.service.snapshot());
        await waitUntil("订阅过的 lazy 照常读", () => lazy.selection.ready.value);
    });
});
