/**
 * 主题编辑器的模型（docs/specs/theme/editor.md 输出 2、4、6、7、14 与验收 1 到 5、12）：真实 Storage 场地与真实主题目录，
 * 判据是记录里的声明和预览。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";
import {effectScope} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {contrast, parseColor} from "nbook/ui/theme/color";
import type {Rgba} from "nbook/ui/theme/color";

import type {UserTheme} from "./shared/user-themes";
import {ThemeCatalog} from "./web/themes";
import type {ThemeEntry} from "./web/themes";
import {ThemeEditorModel} from "./web/theme-editor/theme-editor-model";
import {userThemesStore} from "./web/user-themes-store";

/** 两个明暗的缺省配色：故意写成一套不合格的（弱化文字对背景太淡），和主题包缺省的取值无关，测试不依赖 nb-ui。 */
const BASES: Record<string, Record<string, string>> = {
    light: {"--bg-main": "#f3ead8", "--bg-panel": "#fbf2e0", "--bg-sidebar": "#e9e0ce", "--bg-hover": "#e1d8c6", "--text-main": "#2e261c", "--text-secondary": "#595145", "--text-muted": "#d8cfba", "--accent-main": "#8a5a24"},
    dark: {"--bg-main": "#241c15", "--bg-panel": "#2d241d", "--bg-sidebar": "#1f1711", "--bg-hover": "#372e27", "--text-main": "#efe4d0", "--text-secondary": "#c2b8a7", "--text-muted": "#a69c8d", "--accent-main": "#e0ac62"},
};

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "theme-editor");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function session(): Promise<{model: ThemeEditorModel; catalog: ThemeCatalog; mine: () => ReadonlyArray<UserTheme>; settled: () => Promise<void>; dispose: () => void}> {
    counter += 1;
    const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(w);
    const hosted: {store: ReturnType<typeof userThemesStore.create> | null} = {store: null};
    const plugin: PluginDefinition = {
        id: "nbook.workbench",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                hosted.store = userThemesStore.create(context, {storage: context.services.require(storageKey), diagnostics: context.services.require(diagnosticsKey)});
                return {};
            },
        }],
    };
    await w.window("a", "c", [plugin], {bound: false});
    const store = hosted.store;
    if (store === null) throw new Error("store 没有创建");
    await waitUntil("我的主题读完", () => store.state.themes.ready);
    const catalog = new ThemeCatalog([], () => null, () => undefined);
    let counterId = 0;
    const scope = effectScope();
    const model = scope.run(() => new ThemeEditorModel({
        store,
        catalog,
        baseColors: (_base, appearance) => BASES[appearance] ?? {},
        newId: () => `00000000-0000-4000-8000-${String(++counterId).padStart(12, "0")}`,
    })) as ThemeEditorModel;
    // 主题目录读的是 store 的显示值：模拟入口里的那条 watch。
    const sync = () => catalog.setUserThemes(store.state.themes.display.themes, () => undefined);
    sync();
    return {
        model,
        catalog,
        mine: () => {
            sync();
            return store.state.themes.display.themes as ReadonlyArray<UserTheme>;
        },
        /** 乐观显示之外，记录里真的存下了：写完、没有失败，已确认的快照等于显示。 */
        settled: async () => {
            await waitUntil("写完", () => store.state.themes.queue === 0);
            expect(store.state.themes.save).toEqual({state: "idle"});
            expect(store.state.themes.base).toMatchObject({status: "ok", value: {themes: store.state.themes.display.themes}});
        },
        dispose: () => scope.stop(),
    };
}

const colorOf = (theme: UserTheme | undefined, appearance: "light" | "dark", name: string): Rgba => parseColor(theme?.declaration[appearance].colors?.[name] ?? "") as Rgba;

describe("新建与库", () => {
    it("新建一套：从主题包缺省起步，进列表并被选中，预览指向它；复制与删除", async () => {
        const {model, catalog, mine, dispose} = await session();
        expect(model.selectedId.value).toBeNull();
        expect(catalog.preview).toBeNull();

        const id = await model.create();
        expect(id).toBe("user:00000000-0000-4000-8000-000000000001");
        expect(model.selectedId.value).toBe(id);
        expect(mine()[0]?.declaration.light.colors?.["--bg-main"]).toBe("#f3ead8");
        expect(catalog.list.map((entry: ThemeEntry) => entry.id)).toEqual([id]);
        expect(catalog.preview).toEqual({id, appearance: "light"});

        model.appearance.value = "dark";
        await waitUntil("预览跟着明暗", () => catalog.preview?.appearance === "dark");

        const copy = await model.duplicate();
        expect(copy).toBe("user:00000000-0000-4000-8000-000000000002");
        expect(mine().map((theme) => theme.declaration.title)).toEqual([{"zh-CN": "新主题", "en-US": "New theme"}, {"zh-CN": "新主题 副本", "en-US": "New theme copy"}]);

        await model.remove();
        await waitUntil("选中的删掉后回到第一套", () => model.selectedId.value === id);
        expect(mine()).toHaveLength(1);
        dispose();
        expect(catalog.preview).toBeNull();
    });

    it("复制插件主题：声明复制成我的主题，场景图不带（素材复制在场景分区）", async () => {
        const {model, mine, dispose} = await session();
        const plugin: ThemeEntry = {id: "acme.skin.x", plugin: "acme.skin", declaration: {title: {"zh-CN": "暮色", "en-US": "Dusk"}, base: "macos", light: {colors: {"--bg-main": "#fff"}, scene: "assets/day.webp"}, dark: {scene: "assets/night.webp"}}};
        await model.create(plugin);
        const theme = mine()[0];
        expect(theme?.declaration.base).toBe("macos");
        expect(theme?.declaration.light.scene).toBeUndefined();
        expect(theme?.declaration.dark.scene).toBeUndefined();
        expect(theme?.declaration.title).toEqual({"zh-CN": "暮色 副本", "en-US": "Dusk copy"});
        dispose();
    });
});

describe("基本信息与配色", () => {
    it("改标题与主题包写进记录", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        await model.setTitle("zh-CN", "夜读");
        await model.setTitle("en-US", "Night reading");
        await model.setBase("macos");
        expect(mine()[0]?.declaration).toMatchObject({title: {"zh-CN": "夜读", "en-US": "Night reading"}, base: "macos"});
        dispose();
    });

    it("推导整套：33 项有值、文字不低于 4.5；手改过的项再推导时不变；一项可还原成推导值", async () => {
        const {model, mine, settled, dispose} = await session();
        await model.create();
        await model.setSeed("background", "#f3ead8");
        await model.setSeed("text", "#2e261c");
        await model.setSeed("accent", "#8a5a24");
        expect(await model.derive()).toBe(true);
        let theme = mine()[0];
        expect(Object.keys(theme?.declaration.light.colors ?? {}).length).toBeGreaterThanOrEqual(33);
        expect(contrast(colorOf(theme, "light", "--text-muted"), colorOf(theme, "light", "--bg-panel"))).toBeGreaterThanOrEqual(4.5);

        await model.setColor("--text-secondary", "#123456");
        expect(model.isTouched("--text-secondary")).toBe(true);
        await model.setSeed("accent", "#2563eb");
        await model.derive();
        theme = mine()[0];
        expect(theme?.declaration.light.colors?.["--text-secondary"]).toBe("#123456");
        expect(theme?.declaration.light.colors?.["--accent-main"]).toBe("#2563eb");

        expect(await model.resetColor("--text-secondary")).toBe(true);
        theme = mine()[0];
        expect(theme?.declaration.light.colors?.["--text-secondary"]).not.toBe("#123456");
        expect(model.isTouched("--text-secondary")).toBe(false);
        await settled();
        dispose();
    });

    it("主色读不懂时推导什么都不做", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        await model.setSeed("accent", "teal");
        const before = JSON.stringify(mine()[0]);
        expect(await model.derive()).toBe(false);
        expect(JSON.stringify(mine()[0])).toBe(before);
        dispose();
    });

    it("从亮色派生暗色：暗色的背景变暗，文字不低于 4.5；亮色那一套不变", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        const lightBefore = JSON.stringify(mine()[0]?.declaration.light);
        model.appearance.value = "dark";
        expect(await model.deriveFromOther()).toBe(true);
        const theme = mine()[0];
        const bg = colorOf(theme, "dark", "--bg-main");
        expect(bg.r + bg.g + bg.b).toBeLessThan(200);
        expect(contrast(colorOf(theme, "dark", "--text-main"), colorOf(theme, "dark", "--bg-panel"))).toBeGreaterThanOrEqual(4.5);
        expect(JSON.stringify(theme?.declaration.light)).toBe(lightBefore);
        dispose();
    });

    it("对比度：不合格的项被标出，两套明暗的汇总分开", async () => {
        const {model, dispose} = await session();
        await model.create();
        // 缺省配色里亮色的弱化文字故意太淡。
        const failing = model.contrast.value.filter((check) => check.ok === false).map((check) => check.key);
        expect(failing).toContain("--text-muted");
        expect(model.failures.value.some((item) => item.appearance === "light" && item.check.key === "--text-muted")).toBe(true);
        expect(model.failures.value.some((item) => item.appearance === "dark" && item.check.key === "--text-muted")).toBe(false);
        dispose();
    });
});

describe("字体、活动栏与画框", () => {
    it("字体填了写进、清空删掉；活动栏补全必填项、可去掉装饰与整个活动栏；画框线色", async () => {
        const {model, mine, settled, dispose} = await session();
        await model.create();
        await model.setFont("display", "serif");
        expect(mine()[0]?.declaration.fonts).toEqual({display: "serif"});
        await model.setFont("display", "");
        expect(mine()[0]?.declaration.fonts).toBeUndefined();

        await model.setActivityBar("ornament", "#d9b878");
        expect(mine()[0]?.declaration.light.activityBar).toEqual({surface: "#e9e0ce", foreground: "#2e261c", active: "#8a5a24", ornament: "#d9b878"});
        await model.setActivityBar("ornament", undefined);
        expect(mine()[0]?.declaration.light.activityBar?.ornament).toBeUndefined();
        await model.removeActivityBar();
        expect(mine()[0]?.declaration.light.activityBar).toBeUndefined();

        await model.setFrameLine("#8a5a24");
        expect(mine()[0]?.declaration.light.frame).toEqual({line: "#8a5a24"});
        await model.setFrameLine(undefined);
        expect(mine()[0]?.declaration.light.frame).toBeUndefined();
        await settled();
        dispose();
    });
});
