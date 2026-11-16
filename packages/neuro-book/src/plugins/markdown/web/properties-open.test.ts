/**
 * 属性面板的展开状态（docs/specs/workbench/markdown-editing.md 输出 41 与“副作用与数据”的 `markdown.properties-open`）：列表的
 * 规则（最近的在前、不重复、至多 200 个、收起即去掉），与真实内核、真实 `nbook.storage` 与 SQLite 上的记录：几个窗口各改各的
 * 文件都记得住；记录坏了时展开与收起照样起作用、不覆盖原件。持久化字段的通用语义由 `src/shared/store/store.test.ts` 覆盖。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {Database} from "bun:sqlite";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";
import {fieldProblem} from "nbook/shared/store/problem";

import {MARKDOWN_PROPERTIES_OPEN_RECORD, nextOpen, PROPERTIES_OPEN_LIMIT, propertiesOpenPort, propertiesOpenStore} from "./properties-open";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-markdown", "properties-open");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(): Promise<StorageWorld> {
    counter += 1;
    const created = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(created);
    await created.project(1, []);
    return created;
}

/** 绑定作品的窗口里，以 `nbook.markdown` 的身份建这个 store（记录地址与产品一致）。 */
async function openWindow(target: StorageWorld, id: string, client: string) {
    const hosted: {current: {context: ActivationContext; storage: StorageService} | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.markdown",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                hosted.current = {context, storage: context.services.require(storageKey)};
                return {};
            },
        }],
    };
    await target.window(id, client, [plugin], {bound: true});
    if (hosted.current === null) throw new Error("测试入口没有激活");
    const {context, storage} = hosted.current;
    const store = propertiesOpenStore.create(context, {storage, diagnostics: context.services.require(diagnosticsKey)});
    await waitUntil(`${id} 的记录就绪`, () => store.state.files.ready);
    return {store, port: propertiesOpenPort(store), storage};
}

async function read(storage: StorageService): Promise<unknown> {
    const opened = await storage.open(MARKDOWN_PROPERTIES_OPEN_RECORD);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

describe("列表的规则", () => {
    it("展开的挪到最前、不重复；收起即去掉；至多 200 个，多出的去掉最旧的", () => {
        expect(nextOpen(["a", "b"], "b", true)).toEqual(["b", "a"]);
        expect(nextOpen(["a", "b"], "a", false)).toEqual(["b"]);
        expect(nextOpen(["a"], "c", false)).toEqual(["a"]);
        const full = Array.from({length: PROPERTIES_OPEN_LIMIT}, (_, index) => `f${String(index)}`);
        const next = nextOpen(full, "new", true);
        expect(next).toHaveLength(PROPERTIES_OPEN_LIMIT);
        expect([next[0], next.at(-1)]).toEqual(["new", `f${String(PROPERTIES_OPEN_LIMIT - 2)}`]);
    });
});

describe("记录", () => {
    it("同一台机器上的两个窗口同时展开不同的文件：两个都记下；另一个窗口收起其中一个只去掉它", async () => {
        const w = await world();
        // 本机记录按客户端分：同一台机器的几个窗口是同一个客户端。
        const a = await openWindow(w, "a", "c");
        const b = await openWindow(w, "b", "c");
        a.port.set("project://甲.md", true);
        b.port.set("project://乙.md", true);
        // 两边都以“记录不存在”为前提提交：后到的一方冲突，在新的记录上重放自己的那一个文件，记录里两个都在（已开着的窗口
        // 不承诺即时看到别的窗口的改动，下面新开的窗口读到）。
        await waitUntil("记录里两个文件都在", async () => {
            const stored = await read(a.storage) as {open?: string[]};
            return stored.open?.length === 2 && stored.open.includes("project://甲.md") && stored.open.includes("project://乙.md");
        });
        const c = await openWindow(w, "third", "c");
        expect(c.port.isOpen("project://甲.md") && c.port.isOpen("project://乙.md")).toBe(true);
        c.port.set("project://甲.md", false);
        await waitUntil("收起保存", () => c.store.state.files.queue === 0);
        expect(await read(c.storage)).toEqual({open: ["project://乙.md"]});
    });

    it("记录坏了：按收起显示；展开与收起照样起作用，只是不记，原件不被覆盖", async () => {
        const w = await world();
        const seed = await openWindow(w, "seed", "c");
        seed.port.set("project://甲.md", true);
        await waitUntil("保存", () => seed.store.state.files.queue === 0);
        const db = new Database(w.projectPath);
        db.query("UPDATE records SET value = ?1 WHERE owner = 'nbook.markdown' AND key = 'markdown.properties-open'").run("{坏的");
        db.close();

        const {store, port, storage} = await openWindow(w, "w", "c");
        expect(fieldProblem(store.state.files)).toEqual({kind: "protected", code: "corrupt"});
        expect(port.isOpen("project://甲.md")).toBe(false);
        port.set("project://乙.md", true);
        expect(port.isOpen("project://乙.md")).toBe(true);
        port.set("project://乙.md", false);
        expect(port.isOpen("project://乙.md")).toBe(false);
        await waitUntil("没有排着的保存", () => store.state.files.queue === 0);
        expect(await read(storage)).toBe("corrupt");
    });
});
