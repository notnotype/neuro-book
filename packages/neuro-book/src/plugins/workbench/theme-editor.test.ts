/**
 * 主题编辑器的模型（docs/specs/theme/editor.md 输出 2、4、6、7、14 与验收 1 到 5、12）：真实 Storage 场地与真实主题目录，
 * 判据是记录里的声明和预览。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {zipSync} from "fflate";
import {Hono} from "hono";
import {effectScope, nextTick} from "vue";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {HttpRouteEnv} from "nbook/plugins/http/shared/contracts";
import {addThemeAssetRoutes} from "nbook/plugins/files/backend/theme-asset-route";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {contrast, parseColor} from "nbook/ui/theme/color";
import type {Rgba} from "nbook/ui/theme/color";

import type {UserTheme} from "./shared/user-themes";
import {ThemeCatalog} from "./web/themes";
import type {ThemeEntry} from "./web/themes";
import {ThemeEditorModel, TITLE_EMPTY} from "./web/components/theme-editor/theme-editor-model";
import {ThemeEditorSession} from "./web/components/theme-editor/theme-editor-session";
import {copyPluginAssets, importArchive} from "./web/components/theme-editor/transfer";
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

async function session(): Promise<{model: ThemeEditorModel; catalog: ThemeCatalog; store: ReturnType<typeof userThemesStore.create>; mine: () => ReadonlyArray<UserTheme>; settled: () => Promise<void>; dispose: () => void}> {
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
        currentAppearance: () => "light",
    })) as ThemeEditorModel;
    // 主题目录读的是 store 的显示值：模拟入口里的那条 watch。
    const sync = () => catalog.setUserThemes(store.state.themes.display.themes, () => undefined);
    sync();
    return {
        model,
        catalog,
        store,
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

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const colorOf = (theme: UserTheme | undefined, appearance: "light" | "dark", name: string): Rgba => parseColor(theme?.declaration[appearance].colors?.[name] ?? "") as Rgba;

describe("新建与库", () => {
    it("新建一套：从主题包缺省起步，进列表并被选中，预览指向它；复制与删除", async () => {
        const {model, catalog, mine, dispose} = await session();
        expect(model.selectedId.value).toBeNull();
        expect(catalog.preview).toBeNull();

        const id = await model.create() as string;
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

    it("复制插件主题：没有先复制素材时声明复制成我的主题，包内素材路径一律不带；场景提供者保留", async () => {
        const {model, mine, dispose} = await session();
        const plugin: ThemeEntry = {id: "acme.skin.x", plugin: "acme.skin", declaration: {title: {"zh-CN": "暮色", "en-US": "Dusk"}, base: "macos", light: {colors: {"--bg-main": "#fff"}, scene: "assets/day.webp", workingScene: "assets/day-working.webp", icons: {files: "assets/icons/files.svg"}}, dark: {scene: "assets/night.webp"}, sceneProvider: "acme.sky.clock"}};
        await model.create(plugin);
        const theme = mine()[0];
        expect(theme?.declaration.base).toBe("macos");
        expect(theme?.declaration.light.scene).toBeUndefined();
        expect(theme?.declaration.dark.scene).toBeUndefined();
        // 包内的相对路径在用户层解析不了，素材要先由传输层复制成我的素材；场景提供者只是个 id，保留。
        expect(theme?.declaration.light.workingScene).toBeUndefined();
        expect(theme?.declaration.light.icons).toBeUndefined();
        expect(theme?.declaration.sceneProvider).toBe("acme.sky.clock");
        expect(theme?.declaration.title).toEqual({"zh-CN": "暮色 副本", "en-US": "Dusk copy"});
        dispose();
    });

    it("复制插件主题：素材已复制成我的素材的声明原样带进来，图标、工作态场景都在", async () => {
        const {model, mine, dispose} = await session();
        const plugin: ThemeEntry = {id: "acme.skin.x", plugin: "acme.skin", declaration: {title: {"zh-CN": "暮色", "en-US": "Dusk"}, base: "macos", light: {scene: "assets/day.webp"}, dark: {}}};
        const copied = {...plugin.declaration, light: {scene: `${HASH_A}.webp`, workingScene: `${HASH_B}.webp`, icons: {files: `${HASH_C}.svg`}}};
        await model.create(plugin, "Dusk", copied);
        expect(mine()[0]?.declaration.light).toEqual(copied.light);
        // 带着包内路径的混合声明：只留“我的素材”写法的，别的去掉，不让不合格的记录写进去。
        await model.create(plugin, "Dusk", {...plugin.declaration, light: {scene: `${HASH_A}.webp`, workingScene: "assets/w.webp", icons: {files: "assets/files.svg", folder: `${HASH_C}.svg`}}});
        expect(mine()[1]?.declaration.light).toEqual({scene: `${HASH_A}.webp`, icons: {folder: `${HASH_C}.svg`}});
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

describe("写不进去的修改被拒绝，不进乐观显示", () => {
    it("取值引外部资源：记录不变、预览不退回缺省，原因留在 rejected，下一次合格的修改清掉它", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        const before = JSON.stringify(mine()[0]);
        await model.setColor("--bg-main", "url(https://example.com/x.png)");
        expect(JSON.stringify(mine()[0])).toBe(before);
        expect(model.rejected.value).toMatch(/外部资源/u);
        await model.setColor("--bg-main", "#123456");
        expect(model.rejected.value).toBeNull();
        expect(mine()[0]?.declaration.light.colors?.["--bg-main"]).toBe("#123456");
        dispose();
    });

    it("标题两种语言都空：拒绝并给出专门的原因；只清一种语言可以", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        await model.setTitle("zh-CN", "");
        expect(model.rejected.value).toBeNull();
        expect(mine()[0]?.declaration.title).toEqual({"zh-CN": "", "en-US": "New theme"});
        await model.setTitle("en-US", "");
        expect(model.rejected.value).toBe(TITLE_EMPTY);
        expect(mine()[0]?.declaration.title).toEqual({"zh-CN": "", "en-US": "New theme"});
        dispose();
    });

    it("场景图落在发起时的主题与明暗，不是完成时选中的", async () => {
        const {model, mine, dispose} = await session();
        const first = await model.create() as string;
        const second = await model.create() as string;
        model.appearance.value = "dark";
        const hash = `${"c".repeat(64)}.webp`;
        await model.setScene(hash, {id: first, appearance: "light"});
        expect(mine().find((theme) => theme.id === first)?.declaration.light.scene).toBe(hash);
        expect(mine().find((theme) => theme.id === first)?.declaration.dark.scene).toBeUndefined();
        expect(mine().find((theme) => theme.id === second)?.declaration.light.scene).toBeUndefined();
        dispose();
    });
});

describe("工作态场景、场景提供者与图标", () => {
    it("工作态场景按明暗各写各的，位图素材名以外的拒绝；移除后字段消失", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        await model.setWorkingScene(`${HASH_A}.webp`);
        model.appearance.value = "dark";
        await model.setWorkingScene(`${HASH_B}.png`);
        expect(mine()[0]?.declaration.light.workingScene).toBe(`${HASH_A}.webp`);
        expect(mine()[0]?.declaration.dark.workingScene).toBe(`${HASH_B}.png`);
        await model.setWorkingScene(`${HASH_C}.svg`);
        expect(model.rejected.value).toMatch(/工作态场景/u);
        expect(mine()[0]?.declaration.dark.workingScene).toBe(`${HASH_B}.png`);
        await model.setWorkingScene(undefined);
        expect(mine()[0]?.declaration.dark).not.toHaveProperty("workingScene");
        dispose();
    });

    it("场景提供者写在声明顶层，两种明暗共用；空串与 undefined 去掉；不是点分贡献 id 的拒绝", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        await model.setSceneProvider("acme.sky.clock");
        expect(mine()[0]?.declaration.sceneProvider).toBe("acme.sky.clock");
        await model.setSceneProvider("Not An Id");
        expect(model.rejected.value).toMatch(/sceneProvider/u);
        expect(mine()[0]?.declaration.sceneProvider).toBe("acme.sky.clock");
        await model.setSceneProvider(undefined);
        expect(mine()[0]?.declaration).not.toHaveProperty("sceneProvider");
        dispose();
    });

    it("图标：加、对已有的名字替换、移除；最后一个移除后 icons 字段消失；非法名与位图素材被拒绝", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        await model.setIcon("folder-open", `${HASH_A}.svg`);
        await model.setIcon("files", `${HASH_B}.svg`);
        await model.setIcon("folder-open", `${HASH_C}.svg`);
        expect(mine()[0]?.declaration.light.icons).toEqual({"folder-open": `${HASH_C}.svg`, files: `${HASH_B}.svg`});
        expect(mine()[0]?.declaration.dark.icons).toBeUndefined();
        await model.setIcon("Folder", `${HASH_A}.svg`);
        expect(model.rejected.value).toMatch(/图标名/u);
        await model.setIcon("ok-name", `${HASH_A}.webp`);
        expect(model.rejected.value).toMatch(/图标/u);
        expect(Object.keys(mine()[0]?.declaration.light.icons ?? {})).toEqual(["folder-open", "files"]);
        await model.removeIcon("files");
        await model.removeIcon("folder-open");
        expect(mine()[0]?.declaration.light).not.toHaveProperty("icons");
        dispose();
    });

    it("图标落在发起时的主题、明暗与名字下，不是完成时选中的", async () => {
        const {model, mine, dispose} = await session();
        const first = await model.create() as string;
        const second = await model.create() as string;
        model.appearance.value = "dark";
        await model.setIcon("files", `${HASH_A}.svg`, {id: first, appearance: "light"});
        await model.setIcon("search", `${HASH_B}.svg`, {id: first, appearance: "light"});
        await model.removeIcon("search", {id: first, appearance: "light"});
        const edited = mine().find((theme) => theme.id === first);
        expect(edited?.declaration.light.icons).toEqual({files: `${HASH_A}.svg`});
        expect(edited?.declaration.dark.icons).toBeUndefined();
        expect(mine().find((theme) => theme.id === second)?.declaration.light.icons).toBeUndefined();
        dispose();
    });

    it("复制到另一套明暗：整份覆盖；当前明暗没有图标时清空另一套", async () => {
        const {model, mine, dispose} = await session();
        await model.create();
        await model.setIcon("files", `${HASH_A}.svg`);
        model.appearance.value = "dark";
        await model.setIcon("search", `${HASH_B}.svg`);
        model.appearance.value = "light";
        await model.copyIconsToOther();
        expect(mine()[0]?.declaration.dark.icons).toEqual({files: `${HASH_A}.svg`});
        await model.removeIcon("files");
        await model.copyIconsToOther();
        expect(mine()[0]?.declaration.dark).not.toHaveProperty("icons");
        dispose();
    });
});

describe("会话：页签切走再回来", () => {
    it("编辑状态（选中的主题、明暗、分区）保留；切走期间预览暂停、回来恢复；入口停止时全部丢掉", async () => {
        const {catalog, store, dispose} = await session();
        dispose();
        const sessionObject = new ThemeEditorSession({store, catalog, newId: () => `00000000-0000-4000-8000-${String(Math.random()).slice(2).padEnd(12, "0").slice(0, 12)}`, currentAppearance: () => "dark"});
        const first = sessionObject.acquire((env, state) => new ThemeEditorModel({...env, baseColors: (_base, appearance) => BASES[appearance] ?? {}}, state));
        expect(first.appearance.value).toBe("dark");
        await first.create();
        const second = await first.create() as string;
        first.section.value = "colors";
        first.appearance.value = "light";
        expect(catalog.preview?.id).toBe(second);

        sessionObject.release();
        expect(catalog.preview).toBeNull();

        const again = sessionObject.acquire((env, state) => new ThemeEditorModel({...env, baseColors: (_base, appearance) => BASES[appearance] ?? {}}, state));
        expect(again.selectedId.value).toBe(second);
        expect(again.appearance.value).toBe("light");
        expect(again.section.value).toBe("colors");
        expect(catalog.preview).toEqual({id: second, appearance: "light"});

        // 预览状态不进会话保留的状态：强制“工作中”，关掉再打开是跟随。
        again.previewWorking.value = true;
        await nextTick();
        expect(catalog.preview).toEqual({id: second, appearance: "light", working: true});
        sessionObject.release();
        expect(catalog.preview).toBeNull();
        const reopened = sessionObject.acquire((env, state) => new ThemeEditorModel({...env, baseColors: (_base, appearance) => BASES[appearance] ?? {}}, state));
        expect(reopened.previewWorking.value).toBeNull();
        expect(catalog.preview).toEqual({id: second, appearance: "light"});

        sessionObject.dispose();
        expect(catalog.preview).toBeNull();
        const fresh = sessionObject.acquire((env, state) => new ThemeEditorModel({...env, baseColors: (_base, appearance) => BASES[appearance] ?? {}}, state));
        expect(fresh.section.value).toBe("basic");
        sessionObject.dispose();
    });
});

/**
 * 素材传输（docs/specs/theme/editor.md 验收 12、20）：浏览器一侧的 `fetch` 接到真实的上传路由处理（真实的白名单检查、哈希定址、
 * 已存在判断），写盘落在 tmp 目录里（Files 真实的暂存、提交与记账由 `files/theme-asset-route.test.ts` 覆盖），另有一张表充当“插件
 * 文件端点”。判据是上传了什么、主题库里有什么。
 */
describe("复制插件主题与导入主题包的素材传输", () => {
    const SVG = (tag: string): Uint8Array => new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h${tag}"/></svg>`);
    const WEBP_A = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
    const WEBP_B = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 2]);
    const hashOf = (bytes: Uint8Array): string => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const original = globalThis.fetch;
    const puts: string[] = [];
    let stored: string[] = [];

    /** 真实路由接在 tmp 目录上；`files` 是插件文件端点上的文件（地址 → 字节）。 */
    async function wire(files: Record<string, Uint8Array> = {}): Promise<void> {
        counter += 1;
        const userRoot = join(tmp, `transfer-${String(counter)}`);
        await mkdir(userRoot, {recursive: true});
        stored = [];
        puts.length = 0;
        const app = new Hono<{Bindings: HttpRouteEnv}>();
        addThemeAssetRoutes(app, {userRoot, write: async (address, bytes) => {
            const path = join(userRoot, address.slice("user://".length));
            await mkdir(join(path, ".."), {recursive: true});
            await writeFile(path, bytes);
            stored.push(address.slice("user://theme-assets/".length));
            return {ok: true, value: {baseline: undefined}} as never;
        }});
        globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
            const url = String(input);
            if (url.startsWith("/api/nbook.files/theme-")) {
                puts.push(url);
                return app.request(url.slice("/api/nbook.files".length), init);
            }
            const bytes = files[url];
            return bytes === undefined ? new Response("missing", {status: 404}) : new Response(bytes.slice());
        }) as typeof fetch;
    }
    afterEach(() => {
        globalThis.fetch = original;
    });

    const pluginTheme = (declaration: ThemeEntry["declaration"]): ThemeEntry => ({id: "acme.skin.x", plugin: "acme.skin", declaration});

    it("复制插件主题：场景图、工作态场景、图标都传成我的素材，两套明暗共用的图标只传一次；声明里换成素材文件名", async () => {
        await wire({"/f/day.webp": WEBP_A, "/f/work.webp": WEBP_B, "/f/files.svg": SVG("1"), "/f/search.svg": SVG("2")});
        const entry = pluginTheme({title: "Dusk", base: "nbook", sceneProvider: "acme.sky.clock", light: {scene: "day.webp", workingScene: "work.webp", icons: {files: "files.svg", search: "search.svg"}}, dark: {icons: {files: "files.svg"}}});
        const result = await copyPluginAssets(entry, (path) => `/f/${path}`);
        if (!result.ok) throw new Error(result.reason);
        expect(result.declaration.light).toEqual({scene: `${hashOf(WEBP_A)}.webp`, workingScene: `${hashOf(WEBP_B)}.webp`, icons: {files: `${hashOf(SVG("1"))}.svg`, search: `${hashOf(SVG("2"))}.svg`}});
        expect(result.declaration.dark).toEqual({icons: {files: `${hashOf(SVG("1"))}.svg`}});
        expect(result.declaration.sceneProvider).toBe("acme.sky.clock");
        expect(puts).toHaveLength(4);
        expect(stored.sort()).toHaveLength(4);
    });

    it("复制中一个素材读不到或不合格：整个失败并说出是哪个，之后不再开始新的上传，不遗留在飞的请求", async () => {
        const files: Record<string, Uint8Array> = {"/f/bad.svg": new TextEncoder().encode('<svg viewBox="0 0 1 1"><script/></svg>')};
        const icons: Record<string, string> = {bad: "bad.svg"};
        for (let index = 0; index < 30; index += 1) {
            files[`/f/ok-${String(index)}.svg`] = SVG(String(index));
            icons[`ok-${String(index)}`] = `ok-${String(index)}.svg`;
        }
        await wire(files);
        const result = await copyPluginAssets(pluginTheme({title: "Dusk", base: "nbook", light: {icons}, dark: {}}), (path) => `/f/${path}`);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toMatch(/bad\.svg：.*script/u);
        // 并发上限 6：第一个失败时最多还有 5 个在途，其余的不再开始。
        expect(puts.length).toBeLessThanOrEqual(6);
        await wire({});
        const missing = await copyPluginAssets(pluginTheme({title: "Dusk", base: "nbook", light: {scene: "gone.webp"}, dark: {}}), (path) => `/f/${path}`);
        expect(missing).toEqual({ok: false, reason: "gone.webp"});
    });

    it("复制中读取慢：第一个失败之后，已经取到字节但还没发出的素材也不再上传", async () => {
        await wire({"/f/bad.svg": new TextEncoder().encode('<svg viewBox="0 0 1 1"><script/></svg>')});
        const gate = Promise.withResolvers<void>();
        const icons: Record<string, string> = {bad: "bad.svg"};
        const slow: Record<string, Uint8Array> = {};
        for (let index = 0; index < 5; index += 1) {
            slow[`/f/slow-${String(index)}.svg`] = SVG(String(index));
            icons[`slow-${String(index)}`] = `slow-${String(index)}.svg`;
        }
        const inner = globalThis.fetch;
        // 慢的素材读取被挂起，等第一个（bad）的上传已经失败后才放开。
        globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
            const url = String(input);
            if (url in slow) {
                await gate.promise;
                return new Response(slow[url]?.slice());
            }
            return inner(input as string, init);
        }) as typeof fetch;
        const copying = copyPluginAssets(pluginTheme({title: "Dusk", base: "nbook", light: {icons}, dark: {}}), (path) => `/f/${path}`);
        await waitUntil("坏图标的上传已经被路由拒绝", () => puts.length === 1);
        // 让出一轮事件循环：路由的响应走完、失败记下之后再放开慢的读取（内存里没有 I/O，一轮就够）。
        await new Promise((resolve) => setImmediate(resolve));
        gate.resolve();
        const result = await copying;
        expect(result.ok).toBe(false);
        expect(puts).toHaveLength(1);
    });

    it("导入：按种类上传，两个主题共用的文件只传一次，全部拿到文件名后才写主题；声明里是素材文件名", async () => {
        await wire();
        const {model, mine, dispose} = await session();
        const shared = {capability: "workbench.themes", declaration: {title: "A", base: "nbook", light: {scene: "assets/day.webp", workingScene: "assets/work.webp", icons: {files: "assets/files.svg"}}, dark: {icons: {files: "assets/files.svg"}}}};
        const manifest = {name: "x", publisher: "local", version: "0.1.0", engines: {neurobook: ">=0.1.0"}, contributes: [{...shared, id: "local.x.a"}, {...shared, id: "local.x.b", declaration: {...shared.declaration, title: "B"}}]};
        const archive = zipSync({"package.json": new TextEncoder().encode(JSON.stringify(manifest)), "assets/day.webp": WEBP_A, "assets/work.webp": WEBP_B, "assets/files.svg": SVG("1")});
        const result = await importArchive(model, archive);
        expect(result).toMatchObject({ok: true, message: {key: "imported", params: {count: 2}}});
        expect(puts).toEqual(["/api/nbook.files/theme-assets", "/api/nbook.files/theme-assets", "/api/nbook.files/theme-icons"]);
        expect(mine()).toHaveLength(2);
        expect(mine()[1]?.declaration.light).toEqual({scene: `${hashOf(WEBP_A)}.webp`, workingScene: `${hashOf(WEBP_B)}.webp`, icons: {files: `${hashOf(SVG("1"))}.svg`}});
        dispose();
    });

    it("导入中一个图标被路由拒绝：不写任何主题，原因里有路径与检查的说明；已经传上的素材留在目录里", async () => {
        await wire();
        const {model, mine, dispose} = await session();
        const manifest = {name: "x", publisher: "local", version: "0.1.0", engines: {neurobook: ">=0.1.0"}, contributes: [{capability: "workbench.themes", id: "local.x.a", declaration: {title: "A", base: "nbook", light: {scene: "assets/day.webp", icons: {files: "assets/files.svg"}}, dark: {}}}]};
        const archive = zipSync({"package.json": new TextEncoder().encode(JSON.stringify(manifest)), "assets/day.webp": WEBP_A, "assets/files.svg": new TextEncoder().encode('<svg viewBox="0 0 1 1" onload="x()"></svg>')});
        const result = await importArchive(model, archive);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.message.params.reason).toMatch(/files\.svg：.*onload/u);
        expect(mine()).toHaveLength(0);
        // 素材不回滚：位图已经传上，成为孤儿（文件名是内容摘要，重试不会重复）。
        expect(stored).toEqual([`${hashOf(WEBP_A)}.webp`]);
        dispose();
    });
});
