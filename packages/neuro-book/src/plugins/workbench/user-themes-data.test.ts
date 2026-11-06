/**
 * 我的主题的数据层（docs/specs/theme/editor.md 的“失败与恢复”与“输入与前置条件”）：真实 Storage 与 SQLite 上，保存失败撤回、坏条目隔离、
 * 多窗口并发后一致、动作发起时定下明暗、复制保留素材、导入一个提交点。这些是后端审查给出的反例。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {effectScope, watch} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageService} from "nbook/shared/storage";

import {USER_THEMES_RECORD, validUserThemes} from "./shared/user-themes";
import type {UserTheme} from "./shared/user-themes";
import {SAVE_FAILED, ThemeEditorModel} from "./web/components/theme-editor/theme-editor-model";
import {ThemeCatalog} from "./web/themes";
import {userThemesStore} from "./web/user-themes-store";
import type {UserThemesStore} from "./web/user-themes-store";

const BASES: Record<string, Record<string, string>> = {light: {"--bg-main": "#f3ead8"}, dark: {"--bg-main": "#241c15"}};
const HASH_A = `${"a".repeat(64)}.webp`;
const HASH_B = `${"b".repeat(64)}.png`;
const id = (n: number): string => `user:00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const good = (n: number, extra: Partial<UserTheme["declaration"]> = {}): UserTheme => ({id: id(n), declaration: {title: {"zh-CN": `主题${String(n)}`, "en-US": `Theme ${String(n)}`}, base: "nbook", light: {}, dark: {}, ...extra}});

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "user-themes-data");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function newWorld(): Promise<StorageWorld> {
    counter += 1;
    const created = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(created);
    return created;
}

/** 一个窗口：它的 store 与 Storage 服务，主题目录里的 watch 与入口里一样（base 与 queue 一变就试着采纳）。 */
async function openWindow(w: StorageWorld, windowId: string): Promise<{store: UserThemesStore; storage: StorageService; model: () => ThemeEditorModel; catalog: ThemeCatalog}> {
    const hosted: {store: UserThemesStore | null; storage: StorageService | null} = {store: null, storage: null};
    const plugin: PluginDefinition = {
        id: "nbook.workbench",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                const storage = context.services.require(storageKey);
                hosted.storage = storage;
                hosted.store = userThemesStore.create(context, {storage, diagnostics: context.services.require(diagnosticsKey)});
                return {};
            },
        }],
    };
    await w.window(windowId, "c", [plugin], {bound: false});
    const {store, storage} = hosted;
    if (store === null || storage === null) throw new Error("窗口没有建起来");
    await waitUntil(`${windowId} 读完`, () => store.state.themes.ready);
    const scope = effectScope();
    scope.run(() => watch(() => [store.state.themes.base, store.state.themes.queue], () => store.actions.adoptConfirmed()));
    const catalog = new ThemeCatalog([], () => null, () => undefined);
    let next = 100;
    let model: ThemeEditorModel | null = null;
    return {
        store,
        storage,
        catalog,
        model: () => {
            model ??= scope.run(() => new ThemeEditorModel({store, catalog, baseColors: (_base, appearance) => BASES[appearance] ?? {}, newId: () => `00000000-0000-4000-8000-${String(++next).padStart(12, "0")}`, currentAppearance: () => "light"})) as ThemeEditorModel;
            return model;
        },
    };
}

async function persisted(storage: StorageService): Promise<ReadonlyArray<unknown>> {
    const opened = await storage.open(USER_THEMES_RECORD);
    if (!opened.ok) throw new Error(opened.code);
    const snapshot = await opened.handle.read();
    return snapshot.status === "ok" ? snapshot.value.themes : [];
}

async function seed(storage: StorageService, themes: ReadonlyArray<unknown>): Promise<void> {
    const opened = await storage.open(USER_THEMES_RECORD);
    if (!opened.ok) throw new Error(opened.code);
    const written = await opened.handle.save({themes: [...themes]}, {expect: null});
    if (!written.ok) throw new Error(written.code);
}

describe("保存失败", () => {
    it("超限的修改被撤回、原因留在 rejected，显示回到已确认的值，之后的修改照常保存（不被失败的队首堵住）", async () => {
        const w = await newWorld();
        const {store, storage, model} = await openWindow(w, "a");
        await seed(storage, [good(1)]);
        await waitUntil("读到种子", () => validUserThemes(store.state.themes.display.themes).length === 1);
        const editor = model();

        await editor.setTitle("zh-CN", "x".repeat(600 * 1024));
        expect(editor.rejected.value).toBe(`${SAVE_FAILED}too-large`);
        expect(validUserThemes(store.state.themes.display.themes)[0]?.declaration.title).toEqual({"zh-CN": "主题1", "en-US": "Theme 1"});

        await editor.setTitle("zh-CN", "改了");
        expect(editor.rejected.value).toBeNull();
        await waitUntil("写完", () => store.state.themes.queue === 0);
        expect((await persisted(storage)).map((entry) => (entry as UserTheme).declaration.title)).toEqual([{"zh-CN": "改了", "en-US": "Theme 1"}]);
    });

    it("导入几套是一个提交点：第二套超限时一套也不进", async () => {
        const w = await newWorld();
        const {store, storage, model} = await openWindow(w, "a");
        const editor = model();
        const ok = await editor.addMany([good(1).declaration, {...good(2).declaration, title: {"zh-CN": "y".repeat(600 * 1024), "en-US": "big"}}]);
        expect(ok).toBe(false);
        expect(editor.rejected.value).toBe(`${SAVE_FAILED}too-large`);
        expect(await persisted(storage)).toEqual([]);
        expect(validUserThemes(store.state.themes.display.themes)).toEqual([]);

        expect(await editor.addMany([good(1).declaration, good(2).declaration])).toBe(true);
        await waitUntil("写完", () => store.state.themes.queue === 0);
        expect(await persisted(storage)).toHaveLength(2);
    });
});

describe("坏条目隔离", () => {
    it("记录里一条结构不合格的条目：别的主题照常读出，编辑别的主题时坏条目原样留在记录里", async () => {
        const w = await newWorld();
        const {store, storage, model} = await openWindow(w, "a");
        const broken = {id: id(2), declaration: {title: "x", base: "INVALID", light: {}, dark: {}}};
        await seed(storage, [good(1), broken]);
        await waitUntil("读到种子", () => store.state.themes.display.themes.length === 2);
        const editor = model();
        expect(editor.mine.value.map((theme) => theme.id)).toEqual([id(1)]);

        await editor.setTitle("zh-CN", "改了");
        await waitUntil("写完", () => store.state.themes.queue === 0);
        const saved = await persisted(storage);
        expect(saved).toHaveLength(2);
        expect(saved[1]).toEqual(broken);
        expect((saved[0] as UserTheme).declaration.title).toEqual({"zh-CN": "改了", "en-US": "Theme 1"});
    });
});

describe("多窗口", () => {
    it("两个窗口同时改同一套（不同语言的标题）：写完后两边显示的与记录里确认的一致", async () => {
        const w = await newWorld();
        const a = await openWindow(w, "a");
        await seed(a.storage, [good(1)]);
        const b = await openWindow(w, "b");
        await waitUntil("A 读到", () => validUserThemes(a.store.state.themes.display.themes).length === 1);
        await waitUntil("B 读到", () => validUserThemes(b.store.state.themes.display.themes).length === 1);

        await Promise.all([a.model().setTitle("zh-CN", "甲"), b.model().setTitle("en-US", "B")]);
        await waitUntil("两边写完", () => a.store.state.themes.queue === 0 && b.store.state.themes.queue === 0);
        const confirmed = (await persisted(a.storage)).map((entry) => (entry as UserTheme).declaration.title);
        // 两个窗口各自的显示都等于记录里确认的值（后写的覆盖或同字段合并，但不能各看各的）。
        await waitUntil("两边采纳", () => JSON.stringify(validUserThemes(a.store.state.themes.display.themes).map((theme) => theme.declaration.title)) === JSON.stringify(confirmed)
            && JSON.stringify(validUserThemes(b.store.state.themes.display.themes).map((theme) => theme.declaration.title)) === JSON.stringify(confirmed));
    });
});

describe("动作发起时定下目标", () => {
    it("亮色下排队的修改，之后切到暗色：仍写进亮色、手改标记也是亮色的", async () => {
        const w = await newWorld();
        const {store, storage, model} = await openWindow(w, "a");
        const editor = model();
        const created = await editor.create() as string;
        expect(created).toMatch(/^user:/u);

        const first = editor.setColor("--bg-panel", "#123456");
        const second = editor.setColor("--text-muted", "#abcdef");
        editor.appearance.value = "dark";
        await Promise.all([first, second]);
        await waitUntil("写完", () => store.state.themes.queue === 0);
        const [saved] = (await persisted(storage)) as UserTheme[];
        expect(saved?.declaration.light.colors?.["--text-muted"]).toBe("#abcdef");
        expect(saved?.declaration.dark.colors?.["--text-muted"]).toBeUndefined();
        expect(saved?.editor?.touched.sort()).toEqual(["light:--bg-panel", "light:--text-muted"]);
    });
});

describe("复制", () => {
    it("复制我的主题保留两张场景图的素材名；标题是字符串时保留原名", async () => {
        const w = await newWorld();
        const {store, storage, model} = await openWindow(w, "a");
        await seed(storage, [good(1, {title: "Original title", light: {scene: HASH_A}, dark: {scene: HASH_B}})]);
        await waitUntil("读到种子", () => validUserThemes(store.state.themes.display.themes).length === 1);
        const editor = model();
        expect(await editor.duplicate()).not.toBeNull();
        await waitUntil("写完", () => store.state.themes.queue === 0);
        const copy = (await persisted(storage))[1] as UserTheme;
        expect(copy.declaration.light.scene).toBe(HASH_A);
        expect(copy.declaration.dark.scene).toBe(HASH_B);
        expect(copy.declaration.title).toEqual({"zh-CN": "Original title 副本", "en-US": "Original title copy"});
    });

    it("复制插件主题：给了复制好的素材名就用它，没给就不带图（插件里的是包内相对路径，不能直接用）", async () => {
        const w = await newWorld();
        const {store, storage, model} = await openWindow(w, "a");
        const editor = model();
        const plugin = {id: "acme.skin.x", plugin: "acme.skin", declaration: {title: "Dusk", base: "macos" as const, light: {scene: "assets/day.webp"}, dark: {scene: "assets/night.webp"}}};
        await editor.create(plugin, "Dusk");
        await editor.create(plugin, "Dusk", {light: HASH_A});
        await waitUntil("写完", () => store.state.themes.queue === 0);
        const [bare, withScene] = (await persisted(storage)) as UserTheme[];
        expect(bare?.declaration.light.scene).toBeUndefined();
        expect(bare?.declaration.dark.scene).toBeUndefined();
        expect(withScene?.declaration.light.scene).toBe(HASH_A);
        expect(withScene?.declaration.dark.scene).toBeUndefined();
    });
});
