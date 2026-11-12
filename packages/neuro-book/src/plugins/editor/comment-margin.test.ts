/**
 * 批注页边的开关记录（docs/specs/workbench/markdown-editing.md 输出 33 与“副作用与数据”）：真实 Storage 场地上绑定项目的窗口里，
 * 缺省关、切换写进项目分区的本机记录、另一个窗口读到同一份；没有绑定作品时只在这次运行里记着。
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
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {commentMarginOf, commentMarginStore, EDITOR_COMMENT_MARGIN_RECORD, memoryCommentMargin} from "./web/comment-margin-record";
import type {CommentMargin} from "./web/comment-margin-record";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-editor", "comment-margin");
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

interface Opened {
    readonly margin: CommentMargin;
    readonly store: ReturnType<typeof commentMarginStore.create>;
    readonly storage: StorageService;
}

/** 绑定项目 `book` 的窗口里建开关的 store（插件 id 与产品的编辑器一致），等记录读完。 */
async function open(w: StorageWorld, id: string): Promise<Opened> {
    const hosted: {current: Opened | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.editor",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                const store = commentMarginStore.create(context, {storage, diagnostics: context.services.require(diagnosticsKey)});
                hosted.current = {margin: commentMarginOf(store), store, storage};
                return {};
            },
        }],
    };
    await w.window(id, "c", [plugin], {bound: true});
    if (hosted.current === null) throw new Error("store 没有创建");
    const {store} = hosted.current;
    await waitUntil(`${id} 的开关读完`, () => store.state.margin.ready);
    return hosted.current;
}

async function stored(storage: StorageService): Promise<unknown> {
    const opened = await storage.open(EDITOR_COMMENT_MARGIN_RECORD);
    if (!opened.ok) throw new Error(`${opened.code} ${opened.detail}`);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value : snapshot.status;
}

describe("批注页边的开关记录（markdown-editing.md 输出 33）", () => {
    it("缺省关；切换写进记录，另一个窗口读到同一份；再切回关", async () => {
        const w = await world();
        const first = await open(w, "a");
        expect(first.margin.on.value).toBe(false);
        first.margin.toggle();
        expect(first.margin.on.value).toBe(true);
        await waitUntil("开关写完", () => first.store.state.margin.queue === 0);
        expect(await stored(first.storage)).toEqual({on: true});

        const second = await open(w, "b");
        expect(second.margin.on.value).toBe(true);
        second.margin.toggle();
        await waitUntil("开关写完", () => second.store.state.margin.queue === 0);
        expect(await stored(second.storage)).toEqual({on: false});
    });

    it("没有绑定作品时只在这次运行里记着", () => {
        const margin = memoryCommentMargin();
        expect(margin.on.value).toBe(false);
        margin.toggle();
        expect(margin.on.value).toBe(true);
        margin.toggle();
        expect(margin.on.value).toBe(false);
    });
});
