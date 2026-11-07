/**
 * 标签记录（docs/specs/ui/workbench-layout.md“副作用与数据”）：真实 Storage 场地上绑定项目的窗口。几个窗口共用一条记录，按键合并：只写自己有的、只删自己确实关掉的；
 * 打开时读到、没有恢复的项是没主的，第一次保存时删掉。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {MARKDOWN_EDITOR} from "./shared/contracts";
import type {TabsSnapshot} from "./web/groups/groups";
import {EDITOR_TABS_RECORD, editorTabsStore} from "./web/tabs-record";
import type {EditorTabsStore} from "./web/tabs-record";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "tabs");
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

/** 绑定项目 `book` 的窗口里建标签的 store（插件 id 与产品的编辑器一致），等记录读完。两个窗口用同一个客户端 `c`：记录按客户端分行，它们才共用一条。 */
async function openTabs(w: StorageWorld, id: string): Promise<{store: EditorTabsStore; storage: StorageService; window: WorldWindow}> {
    const hosted: {current: {store: EditorTabsStore; storage: StorageService} | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.editor",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                hosted.current = {store: editorTabsStore.create(context, {storage, diagnostics: context.services.require(diagnosticsKey)}), storage};
                return {};
            },
        }],
    };
    const window = await w.window(id, "c", [plugin], {bound: true});
    if (hosted.current === null) throw new Error("store 没有创建");
    const {store} = hosted.current;
    await waitUntil(`${id} 的标签记录读完`, () => store.state.record.ready);
    return {...hosted.current, window};
}

async function stored(storage: StorageService): Promise<unknown> {
    const opened = await storage.open(EDITOR_TABS_RECORD);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? Object.keys(snapshot.value.tabs).sort() : snapshot.status;
}

const file = (name: string): TabsSnapshot["tabs"][string] => ({address: `project://${name}.md`, editor: MARKDOWN_EDITOR, preview: false});
const tabs = (...names: string[]): TabsSnapshot => ({tabs: Object.fromEntries(names.map((name) => [name, file(name)]))});

describe("Spec ui.workbench-layout 的 editor.tabs", () => {
    it("两个窗口各开各的：谁后写都留着对方的标签，自己关掉的才删", async () => {
        const w = await world();
        const left = await openTabs(w, "left");
        const right = await openTabs(w, "right");
        expect(await left.store.actions.saveBeforeLayout(tabs("a"))).toBe(true);
        expect(await right.store.actions.saveBeforeLayout(tabs("b"))).toBe(true);
        expect(await stored(left.storage)).toEqual(["a", "b"]);
        expect(await left.store.actions.saveBeforeLayout(tabs("a2"))).toBe(true);
        expect(await stored(left.storage)).toEqual(["a2", "b"]);
    });

    it("打开时读到、没有恢复的项是没主的：第一次保存时删掉；打开之后别的窗口写进来的不动", async () => {
        const w = await world();
        const first = await openTabs(w, "first");
        expect(await first.store.actions.saveBeforeLayout(tabs("orphan", "kept"))).toBe(true);

        const second = await openTabs(w, "second");
        const third = await openTabs(w, "third");
        expect(await third.store.actions.saveBeforeLayout(tabs("late", "kept"))).toBe(true);
        expect(await second.store.actions.saveBeforeLayout(tabs("kept"))).toBe(true);
        expect(await stored(second.storage)).toEqual(["kept", "late"]);
    });

    it("属性变了只写新增和修改；删除等布局存盘前才写：标签关掉到布局落盘之间刷新，不会出现“记录丢了”的占位", async () => {
        const w = await world();
        const {store, storage} = await openTabs(w, "a");
        expect(await store.actions.saveBeforeLayout(tabs("a", "b"))).toBe(true);
        store.actions.save(tabs("a"));
        await waitUntil("写完", () => store.state.record.queue === 0);
        expect(await stored(storage)).toEqual(["a", "b"]);
        expect(await store.actions.saveBeforeLayout(tabs("a"))).toBe(true);
        expect(await stored(storage)).toEqual(["a"]);
    });

    it("写失败之后：属性保存不排队，关卡不重试、直接返回假，只有 recover 才重试；通了写的是那一刻的全部", async () => {
        const w = await world();
        const {store, storage, window} = await openTabs(w, "a");
        window.disconnect();
        expect(await store.actions.saveBeforeLayout(tabs("a"))).toBe(false);
        const record = store.state.record;
        expect(["failed", "unknown"]).toContain(record.save.state);
        const queue = record.queue;
        store.actions.save(tabs("a", "b"));
        expect(record.queue).toBe(queue);
        expect(await store.actions.saveBeforeLayout(tabs("a", "b"))).toBe(false);

        expect(await store.actions.recover(tabs("a", "b"))).toBe(false);
        await window.reconnect();
        await waitUntil("恢复", async () => await store.actions.recover(tabs("a", "b", "c")));
        expect(await stored(storage)).toEqual(["a", "b", "c"]);
    });
});
