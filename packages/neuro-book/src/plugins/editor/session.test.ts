/**
 * 一个窗口里的编辑器（docs/specs/ui/workbench-layout.md 输出 34、“失败与恢复”）：真实 Storage 场地上的标签记录与真实编辑器区，布局文档放内存。
 * 编辑器区等布局文档和标签记录都读完才建；标签记录写失败时只亮一次，不自己重试（重试是用户点状态栏）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createMemoryFiles} from "nbook/plugins/lab/web/fixtures/explorer-scene/memory-files";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld, WorldWindow} from "nbook/plugins/storage/testing/world";
import type {EditorSaveGate} from "nbook/plugins/workbench/shared/contracts";
import {createMemoryEditorPanels} from "nbook/plugins/workbench/shared/editor-panels";

import {createEditorSession} from "./web/session";
import type {EditorSession} from "./web/session";
import {editorTabsStore} from "./web/tabs-record";
import type {EditorTabsStore} from "./web/tabs-record";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];
const cleanups: Array<() => void> = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "session");
});

afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Opened {
    readonly session: EditorSession;
    readonly window: WorldWindow;
    readonly ready: ReturnType<typeof shallowRef<boolean>>;
    /** 工作台的 `flush`：布局走一次保存，也就是走一次关卡。 */
    flushes(): number;
    gate(): EditorSaveGate | null;
}

async function open(layoutReady = true): Promise<Opened> {
    counter += 1;
    const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(w);
    await w.project(1, []);
    const hosted: {store: EditorTabsStore | null} = {store: null};
    const plugin: PluginDefinition = {
        id: "nbook.editor",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                hosted.store = editorTabsStore.create(context, {storage: context.services.require(storageKey), diagnostics: context.services.require(diagnosticsKey)});
                return {};
            },
        }],
    };
    const window = await w.window("a", "c", [plugin], {bound: true});
    const store = hosted.store as EditorTabsStore | null;
    if (store === null) throw new Error("store 没有创建");

    const ready = shallowRef(layoutReady);
    let gate: EditorSaveGate | null = null;
    let flushes = 0;
    const memory = createMemoryFiles({project: [["a.md", "A"]], user: []});
    const session = createEditorSession({
        files: memory.files,
        clock: new ManualClock(),
        panels: {
            ...createMemoryEditorPanels(),
            ready,
            acceptSaveGate: (next) => {
                gate = next;
            },
            // 和工作台一样：布局走一次保存，先过关卡。
            flush: () => {
                flushes += 1;
                void gate?.pass();
            },
        },
        project: {id: "book", generation: 1},
        createStore: () => store,
        createRecentStore: null,
        report: (error) => {
            throw error;
        },
    });
    cleanups.push(() => session.dispose(), () => memory.dispose());
    return {session, window, ready, flushes: () => flushes, gate: () => gate};
}

/** 让出事件循环几轮：有无间隔的循环时这里根本回不来，测试按超时失败。 */
async function settle(): Promise<void> {
    for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

describe("Spec ui.workbench-layout 编辑器与布局文档", () => {
    it("布局文档读完才建编辑器区：外壳没挂的窗口（Lab）不打开布局，也就没有编辑器区", async () => {
        const at = await open(false);
        await settle();
        expect(at.session.area.value).toBeNull();
        at.ready.value = true;
        await waitUntil("编辑器区建好", () => at.session.area.value !== null);
        expect(at.gate()).not.toBeNull();
    });

    it("标签记录写失败只亮一次，不自己重试：断线期间事件循环不被占满；用户重试时才再试，通了就写得下去", async () => {
        const at = await open();
        await waitUntil("编辑器区建好", () => at.session.area.value !== null);
        const area = at.session.area.value;
        if (area === null) throw new Error("没有编辑器区");
        at.window.disconnect();
        expect(area.open("project://a.md", {mode: "permanent"})).toMatchObject({ok: true});
        await waitUntil("亮出来", () => at.flushes() > 0);
        await settle();
        expect(at.flushes()).toBe(1);

        // 用户点“重试”，还断着：再亮一次，不循环。
        expect(await at.gate()?.recover()).toBe(false);
        await settle();
        expect(at.flushes()).toBe(2);

        await at.window.reconnect();
        await waitUntil("通了", async () => (await at.gate()?.recover()) === true);
        expect(await at.gate()?.pass()).toBe(true);
    });

    it("释放时撤下关卡：布局不再去写已经没有的编辑器", async () => {
        const at = await open();
        await waitUntil("编辑器区建好", () => at.session.area.value !== null);
        at.session.dispose();
        expect(at.gate()).toBeNull();
    });
});
