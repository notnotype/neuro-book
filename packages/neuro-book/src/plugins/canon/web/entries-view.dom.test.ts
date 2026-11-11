/**
 * “设定”视图的宿主（entries-view.ts；docs/specs/canon/author-ui.md 输出 1 到 3、5、27）接在进程内的真实世界服务上：分组、
 * 展开时才读那一层、别处发布后原地更新且展开状态保留、点了打开条目、没绑定项目、世界断开。
 */

import {rm} from "node:fs/promises";

import {mount} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it} from "vitest";

import type {Entry, WriteRequest} from "@notnotype/nb-canon";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {provideText, testTextPort} from "nbook/shared/testing/text-port";

import type {CanonClient} from "../shared/contracts";
import {countedClient} from "../testing/counted-client";
import {canonNodeWorld} from "../testing/node-world";
import type {CanonNodeWindow, CanonNodeWorld} from "../testing/node-world";
import EntryTree from "./components/EntryTree.vue";
import {createEntriesViewHost, entriesViewState} from "./entries-view";
import type {EntriesViewState} from "./entries-view";
import {canonCatalogs} from "./text";
import {createCanonWorld} from "./world";
import type {CanonWorld} from "./world";

const port = testTextPort("zh-CN", {"nbook.canon": canonCatalogs});

let tmp: string;
let venue: CanonNodeWorld | null = null;
const cleanups: Array<() => void> = [];

beforeEach(async () => {
    tmp = await createTestTmpRoot("neuro-book-canon", "entries-view");
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    await venue?.close();
    venue = null;
    await rm(tmp, {recursive: true, force: true});
    document.body.innerHTML = "";
});

let sequence = 0;
function person(name: string, extra: Partial<Entry> = {}): Entry {
    return {id: `tmp:${String(++sequence)}`, type: "nbook.canon.person", parent: null, folder: "人物", order: sequence, init: {name, aliases: [], summary: "", text: [], data: {character: {type: "nbook.canon.person", version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}}}}, ...extra};
}

async function publish(canon: CanonClient, entries: Entry[]): Promise<Record<string, string>> {
    const status = await canon.call("status", {});
    if (!status.ok) throw new Error(JSON.stringify(status.failure));
    const request: WriteRequest = {requestId: `req-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "写入", baseVersion: status.value.version, puts: entries.map((entry) => ({ref: {kind: "entry", id: entry.id}, after: entry}))};
    const result = await canon.publish(request);
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.value.ids;
}

async function setup(): Promise<{world: CanonWorld; other: CanonNodeWindow; state: EntriesViewState; opened: string[]; parents: () => Array<string | null>; view: () => ReturnType<typeof mount>}> {
    venue = await canonNodeWorld(tmp);
    const mine = await venue.window("mine");
    const other = await venue.window("other");
    const {client, calls} = countedClient(mine.canon);
    /** `tree` 读取各读了哪个父条目。 */
    const parents = (): Array<string | null> => calls.filter((call) => call.method === "tree").map((call) => (call.input as {parent: string | null}).parent);
    const world = createCanonWorld(client);
    cleanups.push(() => world.dispose());
    const state = entriesViewState();
    const opened: string[] = [];
    const host = createEntriesViewHost(EntryTree, {world, state, open: (id) => opened.push(id)});
    return {
        world, other, state, opened, parents,
        view: () => {
            const wrapper = mount(host, {global: {provide: provideText(port)}, attachTo: document.body});
            cleanups.push(() => wrapper.unmount());
            return wrapper;
        },
    };
}

const rowTexts = (wrapper: ReturnType<typeof mount>): string[] => wrapper.findAll("[role='treeitem']").map((row) => row.text());

describe("设定视图", () => {
    it("根下按分组列出；有子条目的展开时才读那一层；别处发布以后原地更新，展开状态还在", async () => {
        const {other, state, parents, view} = await setup();
        const star = person("星瑕");
        const ids = await publish(other.canon, [star, person("学院", {folder: "地点"})]);
        await publish(other.canon, [person("哥哥", {parent: ids[star.id]!})]);

        const wrapper = view();
        await waitUntil("根这一层", () => rowTexts(wrapper).join("|") === "人物|地点");
        state.expanded.value = ["folder:人物", "folder:地点"];
        await waitUntil("分组展开", () => rowTexts(wrapper).join("|") === "人物|星瑕|地点|学院");
        expect(parents()).not.toContain(ids[star.id]);

        state.expanded.value = [...state.expanded.value, ids[star.id]!];
        await waitUntil("读到星瑕下面那一层", () => rowTexts(wrapper).join("|") === "人物|星瑕|哥哥|地点|学院");
        expect(parents()).toContain(ids[star.id]);

        await publish(other.canon, [person("白灵")]);
        await waitUntil("新条目出现在人物下", () => rowTexts(wrapper).join("|") === "人物|星瑕|哥哥|白灵|地点|学院");
        expect(state.expanded.value).toContain(ids[star.id]);
    });

    it("点条目打开它的条目页，并成为选中项", async () => {
        const {other, state, opened, view} = await setup();
        const star = person("星瑕");
        const ids = await publish(other.canon, [star]);
        state.expanded.value = ["folder:人物"];
        const wrapper = view();
        await waitUntil("条目出现", () => rowTexts(wrapper).includes("星瑕"));
        await wrapper.get(`[data-tree-id="${ids[star.id]!}"]`).trigger("click");
        expect(opened).toEqual([ids[star.id]]);
        await waitUntil("选中", () => wrapper.get(`[data-tree-id="${ids[star.id]!}"]`).attributes("aria-selected") === "true");
    });

    it("项目实例停止：树上面有“世界已断开”与“重试”，树留着", async () => {
        const {other, state, view} = await setup();
        await publish(other.canon, [person("星瑕")]);
        state.expanded.value = ["folder:人物"];
        const wrapper = view();
        await waitUntil("条目出现", () => rowTexts(wrapper).includes("星瑕"));
        await venue!.endProject();
        await waitUntil("横幅", () => wrapper.text().includes("世界已断开"), {timeoutMs: 10_000});
        expect(wrapper.find("button").text()).toBe("重试");
        expect(rowTexts(wrapper)).toContain("星瑕");
    });

    it("窗口没有绑定项目：只有一句“打开作品后可用”", () => {
        const host = createEntriesViewHost(EntryTree, {world: null, state: entriesViewState(), open: () => undefined});
        const wrapper = mount(host, {global: {provide: provideText(port)}});
        cleanups.push(() => wrapper.unmount());
        expect(wrapper.text()).toBe("打开作品后可用");
    });
});
