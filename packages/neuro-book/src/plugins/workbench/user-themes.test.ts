/**
 * 我的主题（docs/specs/theme/editor.md 输出 2、3、4、17 与验收 1、11）：校验与插件主题是同一份，记录在真实 Storage 场地上，
 * 进同一个主题目录，预览覆盖设置里选的。
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

import {DEFAULT_THEME_ID, WORKBENCH_THEMES_POINT} from "./shared/themes";
import type {ThemeDeclaration} from "./shared/themes";
import {userThemeProblem, validUserThemes} from "./shared/user-themes";
import type {UserTheme} from "./shared/user-themes";
import {ThemeCatalog, userThemeSceneUrl} from "./web/themes";
import {userThemesStore} from "./web/user-themes-store";
import type {UserThemesStore} from "./web/user-themes-store";

const HASH = "a".repeat(64);
const PLAIN: ThemeDeclaration = {title: {"zh-CN": "NeuroBook", "en-US": "NeuroBook"}, base: "nbook", light: {}, dark: {}};
/** 插件主题的贡献描述；和 `themes.test.ts` 一样只填目录用到的字段。 */
const pluginTheme = (id: string) => ({capability: WORKBENCH_THEMES_POINT, id, plugin: "nbook.workbench", declaration: PLAIN}) as unknown as ConstructorParameters<typeof ThemeCatalog>[0][number];
const declaration = (extra: Partial<ThemeDeclaration> = {}): ThemeDeclaration => ({title: {"zh-CN": "夜读", "en-US": "Night"}, base: "nbook", light: {colors: {"--bg-main": "#fff"}}, dark: {scene: `${HASH}.webp`}, ...extra});
const theme = (suffix: string, extra: Partial<ThemeDeclaration> = {}): UserTheme => ({id: `user:00000000-0000-4000-8000-${suffix.padStart(12, "0")}`, declaration: declaration(extra)});

describe("我的主题的校验", () => {
    it("合格的条目通过", () => {
        expect(userThemeProblem(theme("1"))).toBeNull();
        expect(userThemeProblem({...theme("2"), editor: {touched: ["--bg-main"]}})).toBeNull();
    });

    it.each<[string, unknown]>([
        ["id 不是 user:<uuid>", {...theme("1"), id: "acme.skin.x"}],
        ["多余的字段", {...theme("1"), extra: 1}],
        ["场景图不是素材文件名", theme("1", {dark: {scene: "assets/day.webp"}})],
        ["场景图往上走", theme("1", {dark: {scene: "../x.webp"}})],
        ["工作态场景：我的主题只有一张场景图的素材", theme("1", {dark: {workingScene: `${HASH}.webp`}})],
        ["图标集：我的主题只有场景图素材", theme("1", {dark: {icons: {files: "files.svg"}}})],
        ["取值含 url()", theme("1", {light: {colors: {"--bg-main": "url(https://example.com/x.png)"}}})],
        ["字体里藏 url()", theme("1", {fonts: {display: "u\\72l(x)"}})],
        ["vars 不在白名单", theme("1", {light: {vars: {"--anything": "red"}}})],
        ["base 不认识", {...theme("1"), declaration: {...declaration(), base: "other"}}],
    ])("%s：不合格", (_name, value) => {
        expect(userThemeProblem(value)).not.toBeNull();
    });
});

describe("主题目录里的我的主题", () => {
    const entry = (catalog: ThemeCatalog, id: string) => catalog.list.find((item) => item.id === id);

    it("和插件主题同一个列表；不合格的那一条不进、原因报一次，别的照常", () => {
        const reported: Array<[string, string]> = [];
        const catalog = new ThemeCatalog([pluginTheme("nbook")], () => null, () => undefined);
        catalog.setUserThemes([theme("1"), {...theme("2"), id: "bad"}, theme("3", {dark: {scene: "x.webp"}})], (id, problem) => reported.push([id, problem]));
        expect(catalog.list.map((item) => item.id)).toEqual(["nbook", theme("1").id]);
        expect(reported.map(([id]) => id)).toEqual(["bad", theme("3").id]);
    });

    it("场景图经字节读取路由显示；预览覆盖设置里选的，清掉后回去", () => {
        const catalog = new ThemeCatalog([], (plugin, path) => (plugin === "user" ? userThemeSceneUrl(path) : null), () => undefined);
        catalog.setUserThemes([theme("1")], () => undefined);
        const resolved = catalog.resolve(theme("1").id, "dark");
        expect(resolved.scene).toBe(true);
        expect(resolved.vars["--skin-scene"]).toBe(`url("/api/nbook.files/raw/user/theme-assets/${HASH}.webp")`);
        expect(catalog.resolve(theme("1").id, "light").scene).toBe(false);
        catalog.setPreview({id: theme("1").id, appearance: "dark"});
        expect(catalog.preview).toEqual({id: theme("1").id, appearance: "dark"});
        catalog.setPreview(null);
        expect(catalog.preview).toBeNull();
    });

    it("删掉后设置里选着它的退回缺省（设置不改写）", () => {
        const catalog = new ThemeCatalog([pluginTheme(DEFAULT_THEME_ID)], () => null, () => undefined);
        catalog.setUserThemes([theme("1")], () => undefined);
        expect(catalog.effectiveId([theme("1").id])).toBe(theme("1").id);
        catalog.setUserThemes([], () => undefined);
        expect(entry(catalog, theme("1").id)).toBeUndefined();
        expect(catalog.effectiveId([theme("1").id])).toBe(DEFAULT_THEME_ID);
    });
});

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "user-themes");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function openStore(w: StorageWorld, id: string): Promise<UserThemesStore> {
    const hosted: {current: UserThemesStore | null} = {current: null};
    const plugin: PluginDefinition = {
        id: "nbook.workbench",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: diagnosticsKey}, {key: storageKey}],
            activate: (context) => {
                hosted.current = userThemesStore.create(context, {storage: context.services.require(storageKey), diagnostics: context.services.require(diagnosticsKey)});
                return {};
            },
        }],
    };
    await w.window(id, "c", [plugin], {bound: false});
    if (hosted.current === null) throw new Error("store 没有创建");
    const store = hosted.current;
    await waitUntil(`${id} 的我的主题读完`, () => store.state.themes.ready);
    return store;
}

describe("我的主题的记录", () => {
    it("新建、改名、删除都写进 Storage 用户记录；另一个窗口读到同一份", async () => {
        counter += 1;
        const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
        worlds.push(w);
        const store = await openStore(w, "a");
        expect(store.state.themes.display.themes).toEqual([]);

        await store.actions.create(theme("1"));
        await store.actions.create(theme("2"));
        await store.actions.create(theme("2"));
        expect(validUserThemes(store.state.themes.display.themes).map((item) => item.id)).toEqual([theme("1").id, theme("2").id]);

        await store.actions.update(theme("1").id, (item) => ({...item, declaration: {...item.declaration, title: {"zh-CN": "改了", "en-US": "Renamed"}}}));
        await store.actions.remove(theme("2").id);
        await waitUntil("写完", () => store.state.themes.queue === 0);

        const other = await openStore(w, "b");
        expect(other.state.themes.display.themes).toHaveLength(1);
        expect(validUserThemes(other.state.themes.display.themes)[0]?.declaration.title).toEqual({"zh-CN": "改了", "en-US": "Renamed"});
    });
});
