/**
 * 贡献点 workbench.themes（docs/specs/theme/skins.md 验收 1）：真实内核按声明结构与校验接受或拒绝。
 */

import {describe, expect, it} from "bun:test";
import {statSync} from "node:fs";
import {join} from "node:path";

import {createApplication} from "nbook/application";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {BUILTIN_THEME_CONTRIBUTIONS, themesPoint, WORKBENCH_THEMES_POINT} from "./shared/themes";
import type {ThemeDeclaration} from "./shared/themes";
import {SWITCH_THEME_COMMAND, themeCommands} from "./web/commands/theme-commands";
import {ThemeCatalog, themeVars} from "./web/themes";

const plain = (extra: Partial<ThemeDeclaration> = {}): ThemeDeclaration => ({title: "x", base: "nbook", light: {}, dark: {}, ...extra});

async function accepted(plugins: ReadonlyArray<PluginDefinition>) {
    let list: ReadonlyArray<{readonly id: string; readonly plugin: string; readonly declaration: ThemeDeclaration}> = [];
    const owner: PluginDefinition = {
        id: "nbook.workbench",
        contributionPoints: [themesPoint],
        contributions: BUILTIN_THEME_CONTRIBUTIONS,
        entries: [defineEntry({id: "browser", location: "browser", activationEvents: ["onStartup"], receives: [WORKBENCH_THEMES_POINT], activate: (context) => {
            list = context.declarations.list<ThemeDeclaration>(WORKBENCH_THEMES_POINT);
            return {receivers: {[WORKBENCH_THEMES_POINT]: {}}};
        }})],
    };
    const application = createApplication(
        {identity: {location: "browser", instanceId: "themes"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {plugins: [owner, ...plugins], requiredPlugins: ["nbook.workbench"], gates: [], observers: {}},
    );
    await application.startup;
    const ids = list.map((item) => item.id);
    await application.stop();
    return {ids, list};
}

const provider = (id: string, themes: Readonly<Record<string, unknown>>): PluginDefinition => ({id, entries: [], contributions: Object.entries(themes).map(([theme, declaration]) => ({capability: WORKBENCH_THEMES_POINT, id: theme, declaration}))});

describe("workbench.themes", () => {
    it("内置的是裸 id；第三方的 id 要带插件前缀", async () => {
        const {ids} = await accepted([provider("acme.skin", {"acme.skin.study": plain(), "macos2": plain(), "other.study": plain()})]);
        expect(ids.sort()).toEqual(["acme.skin.study", "eye-green", "eye-sepia", "macos", "nbook"]);
    });

    it.each([
        ["vars 不在白名单", plain({light: {vars: {"--anything": "red"}}})],
        ["colors 不是配色变量", plain({light: {colors: {"--panel-surface": "red"}}})],
        ["取值含 url()", plain({light: {colors: {"--bg-main": "url(https://example.com/x.png)"}}})],
        ["字体里藏 url()", plain({fonts: {display: "url(x)"}})],
        ["CSS 转义的 url()", plain({light: {activityBar: {surface: "u\\72l(https://x)", foreground: "#111", active: "#222"}}})],
        ["vars 里的 url()", plain({light: {vars: {"--divider": "URL (https://x)"}}})],
        ["裁切里的 image-set()", plain({crop: {marginLeft: {size: "auto", position: "image-set(x)"}}})],
        ["contentX 太小，内容会被挤没", plain({crop: {empty: {contentX: 0.1}}})],
        ["contentX 往右偏，还不支持", plain({crop: {empty: {contentX: 0.6}}})],
        ["scene 是远程地址", plain({dark: {scene: "https://example.com/x.webp"}})],
        ["scene 从根开始", plain({dark: {scene: "/etc/x.webp"}})],
        ["scene 往上走", plain({dark: {scene: "assets/../../x.webp"}})],
        ["base 不认识", {...plain(), base: "other"}],
        ["多余的字段", {...plain(), extra: 1}],
    ])("%s：这一条不接受，别的照常", async (_name, declaration) => {
        const {ids} = await accepted([provider("acme.skin", {"acme.skin.bad": declaration, "acme.skin.good": plain()})]);
        expect(ids).toContain("acme.skin.good");
        expect(ids).not.toContain("acme.skin.bad");
    });
});

describe("主题的取值", () => {
    const study: ThemeDeclaration = plain({
        fonts: {display: "serif", prose: "serif"},
        crop: {empty: {position: "center 70%", contentX: 0.44}, marginLeft: {size: "auto 118%", position: "0% 100%"}},
        light: {colors: {"--bg-main": "#fff"}, vars: {"--divider": "#eee"}, activityBar: {surface: "#111", foreground: "#222", active: "#333", ornament: "#444"}, scene: "assets/day.webp"},
        dark: {colors: {"--bg-main": "#000"}},
    });
    const entry = {id: "acme.skin.study", plugin: "acme.skin", declaration: study};

    it("按明暗取，场景经素材解析成 URL，裁切只在有图时写", () => {
        const light = themeVars(entry, "light", (plugin, path) => `/files/${plugin}/${path}`);
        expect(light.scene).toBe(true);
        expect(light.vars).toMatchObject({"--bg-main": "#fff", "--divider": "#eee", "--font-prose": "serif", "--skin-scene": 'url("/files/acme.skin/assets/day.webp")', "--skin-activitybar-ornament": "#444", "--skin-empty-position": "center 70%", "--skin-margin-left-size": "auto 118%"});
        expect(light.vars["--skin-empty-shift"]).toBe(`${String((1 - 2 * 0.44) * 100)}%`);
        const dark = themeVars(entry, "dark", () => "/x");
        expect(dark.scene).toBe(false);
        expect(dark.vars["--bg-main"]).toBe("#000");
        expect(dark.vars["--skin-scene"]).toBeUndefined();
        expect(dark.vars["--skin-empty-position"]).toBeUndefined();
    });

    it("素材解析不出来时没有场景，配色照旧", () => {
        const {scene, vars} = themeVars(entry, "light", () => null);
        expect(scene).toBe(false);
        expect(vars["--bg-main"]).toBe("#fff");
    });

    it("目录里没有的 id 用缺省主题", () => {
        const catalog = new ThemeCatalog([], () => null, () => undefined);
        expect(catalog.resolve("gone", "light")).toEqual({base: "nbook", vars: {}, scene: false});
    });

    it("退回：项目层不认识取用户层，都不认识取缺省；没认出的 id 只报一次", () => {
        const reported: string[] = [];
        const declared = (id: string) => ({capability: WORKBENCH_THEMES_POINT, id, plugin: "acme.skin", location: null, declaration: plain()}) as unknown as Parameters<typeof catalogOf>[0][number];
        const catalogOf = (initial: ConstructorParameters<typeof ThemeCatalog>[0]) => new ThemeCatalog(initial, () => null, (id) => reported.push(id));
        const catalog = catalogOf([declared("acme.skin.study")]);
        expect(catalog.effectiveId(["gone", "acme.skin.study"])).toBe("acme.skin.study");
        expect(catalog.effectiveId(["gone", "also-gone"])).toBe("nbook");
        expect(catalog.effectiveId(["gone", undefined])).toBe("nbook");
        expect(reported).toEqual(["gone", "also-gone"]);
    });
});

describe("切换主题的命令", () => {
    const declared = (id: string) => ({capability: WORKBENCH_THEMES_POINT, id, plugin: "acme.skin", declaration: plain()}) as unknown as ConstructorParameters<typeof ThemeCatalog>[0][number];
    it("传目录里没有的 id：invalid-args，不写设置", async () => {
        const writes: unknown[] = [];
        const settings = {update: async (_setting: unknown, value: unknown) => {
            writes.push(value);
            return {ok: true as const};
        }} as unknown as Parameters<typeof themeCommands>[0];
        const text = {t: (value: unknown) => String(value)} as unknown as Parameters<typeof themeCommands>[2];
        const commands = themeCommands(settings, {} as Parameters<typeof themeCommands>[1], text, new ThemeCatalog([declared("acme.skin.study")], () => null, () => undefined));
        const run = (theme: string) => commands[SWITCH_THEME_COMMAND].run({theme});
        const failed = await run("gone");
        expect(failed).toMatchObject({ok: false, code: "invalid-args"});
        expect(writes).toEqual([]);
        expect(await run("acme.skin.study")).toEqual({ok: true, value: null});
        expect(writes).toEqual(["acme.skin.study"]);
    });
});

describe("书房的素材", () => {
    it.each(["study-day.webp", "study-night.webp"])("%s 不超过 300 KB", (name) => {
        expect(statSync(join(import.meta.dir, "../theme-study/assets", name)).size).toBeLessThanOrEqual(300 * 1024);
    });
});

