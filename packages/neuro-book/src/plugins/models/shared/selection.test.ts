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

/** 记每次对服务端的调用与 `rows` 被换了几次的选用数据夹具。 */
async function fixture(options: {usable: boolean}) {
    counter += 1;
    const w = await modelsWorld(join(root, `world-${String(counter)}`));
    worlds.push(w);
    const client = await w.window("w");
    const calls: Array<{method: string; input: unknown}> = [];
    const remote: SelectionRemote = {
        enabledModels: (input) => {
            calls.push({method: "enabledModels", input});
            return client.enabledModels(input) as ReturnType<SelectionRemote["enabledModels"]>;
        },
        modelsByReference: (input) => {
            calls.push({method: "modelsByReference", input});
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
    const selection = createSelectionData({remote, ref, usable: options.usable});
    return {w, client, calls, selection, writes: () => Object.values(writes)};
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
});
