/**
 * 设置窗口的模型（docs/specs/settings/settings-window.md 输出 1–8、12–16）：左栏与配置项的落位、标签下的可用性、打开命令的
 * 参数、尺寸、通用列表的写入与 page 分区的加载。
 *
 * 两种场地：落位、命令与 page 用真实内核的浏览器实例装产品的 `nbook.settings`（不连远程，层不可达，只看声明），宿主能力
 * `window.plugins` 用产品的实现；写入与层的说明用多实例场地（`testing/world.ts`），层的拥有者读写真实文件。窗口模型由一个
 * 同属 `nbook.settings` 的探针入口取得数据来源与配置服务后创建（产品里是设置窗口的入口），通知与尺寸由测试记下。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {ref} from "@vue/reactivity";
import {defineComponent} from "vue";
import type {Component} from "vue";

import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {defineEntry, provideService} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Type} from "typebox";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import type {NotificationInput} from "nbook/plugins/workbench/shared/contracts";
import {appearanceSetting, themeSetting} from "nbook/plugins/workbench/shared/contracts";
import {descriptor as workbenchDescriptor} from "nbook/plugins/workbench/plugin";
import {clockKey, windowConnectionKey, windowPluginsKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {defineSetting} from "nbook/shared/settings";
import type {SettingDefinition, SettingsService} from "nbook/shared/settings";
import {createSettingsHost} from "nbook/plugins/lab/web/fixtures/settings-scene/settings-host";
import {createWindowPlugins} from "nbook/web/host/window-plugins";

import {RELOAD_DELAY_MS} from "./backend/layer-owner";
import {descriptor} from "./plugin";
import {SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT, settingsKey, settingsPageEvent} from "./shared/contracts";
import type {SettingsPageDeclaration, SettingsSectionDeclaration} from "./shared/contracts";
import {settingsWorld} from "./testing/world";
import type {SettingsWorld} from "./testing/world";
import type {SettingsPageImplementation} from "./web/contracts";
import {settingsBrowserCore} from "./web/plugin";
import {createSettingsWindow, DEFAULT_SETTINGS_WINDOW_SIZE, FILE_SECTION_ID, MIN_SETTINGS_WINDOW_SIZE, OTHER_SECTION_ID} from "./web/settings-window";
import type {SettingsLeaveTarget, SettingsWindow, SettingsWindowSize} from "./web/settings-window";
import {settingsWindowSourceKey} from "./web/window-source";
import type {SettingsWindowSource, WindowSetting} from "./web/window-source";
import {settingsTestText} from "./testing/text";

const silent = {error: () => undefined};
/** 工作台描述里的配置项（主题、明暗），不装它的浏览器入口：外观分区里的两项要有人声明。 */
const workbenchDeclarations: PluginDefinition = {id: workbenchDescriptor.id, entries: [], contributions: workbenchDescriptor.contributions ?? []};
const title = (zh: string) => ({"zh-CN": zh, "en-US": zh});

interface Recorder {
    readonly notices: NotificationInput[];
    readonly reports: string[];
    readonly size: {value: SettingsWindowSize | null};
}

interface Probe {
    source: SettingsWindowSource | null;
    settings: SettingsService | null;
}

/** 同属 `nbook.settings` 的探针入口：取窗口的数据来源与 nbook.settings 自己的配置服务（产品里是设置窗口的入口）。 */
function probeEntry(probe: Probe): PluginEntryDefinition {
    return defineEntry({
        id: "test-window",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsWindowSourceKey}, {key: settingsKey}],
        activate: (context) => {
            probe.source = context.services.require(settingsWindowSourceKey);
            probe.settings = context.services.require(settingsKey);
            return {};
        },
    });
}

function windowFor(probe: Probe, bound: boolean): {readonly window: SettingsWindow; readonly recorder: Recorder} {
    if (probe.source === null || probe.settings === null) throw new Error("探针入口没有拿到数据来源");
    const size = ref<SettingsWindowSize | null>(null);
    const recorder: Recorder = {notices: [], reports: [], size};
    const window = createSettingsWindow({
        text: settingsText.resolver,
        source: probe.source,
        settings: probe.settings,
        bound,
        projectTitle: bound ? "雾港" : null,
        locale: ref("zh-CN"),
        size: {remembered: size, remember: (next) => {
            size.value = next;
        }},
        notify: (input) => recorder.notices.push(input),
        report: (message) => recorder.reports.push(message),
    });
    disposers.push(() => window.dispose());
    return {window, recorder};
}

/** 窗口模型的文字来自 `nbook.settings` 的目录；断言经同一份目录取，不在测试里另写一遍。 */
const settingsText = settingsTestText("zh-CN");
const t = settingsText.t;

const disposers: Array<() => void> = [];
const started: Application[] = [];
const worlds: SettingsWorld[] = [];

/** 失败原因里带的详情是底层给的（系统错误文字等），不在断言里写死：取详情之前的部分比较。 */
const DETAIL = "\u0000detail";
const beforeDetail = (text: string): string => text.slice(0, text.indexOf(DETAIL));
let tmp = "";
let counter = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-settings", "settings-window");
});

afterEach(async () => {
    for (const dispose of disposers.splice(0)) dispose();
    for (const application of started.splice(0)) expect((await application.stop()).status).toBe("closed");
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    // 只读的设置文件也要能删掉。
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

// ── 落位、命令与 page：真实内核，不连远程 ──────────────────────────────────

interface Toggle {
    fail: boolean;
    context: ActivationContext | null;
    implementation: SettingsPageImplementation;
}

function toggle(overrides: Partial<Toggle> = {}): Toggle {
    return {fail: false, context: null, implementation: {load: async () => ({render: () => null})}, ...overrides};
}

type SectionSpec =
    | {readonly kind: "list"; readonly declaration: SettingsSectionDeclaration}
    | {readonly kind: "page"; readonly declaration: SettingsPageDeclaration};

/**
 * 贡献分区的测试插件，同产品的写法：配置项与 list 分区是插件顶层的声明，page 分区是浏览器入口的贡献。有分区就有入口，
 * list 分区不看这个入口的状态。
 */
function contributor(id: string, sections: Readonly<Record<string, SectionSpec>>, control: Toggle, settings: ReadonlyArray<SettingDefinition<unknown>> = [], extra: Partial<PluginEntryDefinition> = {}): PluginDefinition {
    const all = Object.entries(sections);
    const pages = all.filter(([, spec]) => spec.kind === "page");
    return {
        id,
        contributions: [
            ...settings.map((setting) => setting.contribution),
            ...all.filter(([, spec]) => spec.kind === "list").map(([section, spec]) => ({capability: SETTINGS_SECTIONS_POINT, id: section, declaration: spec.declaration})),
        ],
        entries: all.length === 0 ? [] : [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: pages.map(([section, spec]) => ({capability: SETTINGS_PAGES_POINT, id: section, declaration: spec.declaration})),
            activate: (context) => {
                if (control.fail) throw new Error("样例入口按开关激活失败");
                control.context = context;
                return {contributions: {[SETTINGS_PAGES_POINT]: Object.fromEntries(pages.map(([section]) => [section, control.implementation]))}};
            },
            ...extra,
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>, bound = false): Promise<{readonly application: Application; readonly probe: Probe; readonly diagnostics: DiagnosticsStore}> {
    const probe: Probe = {source: null, settings: null};
    const settings = definitionAt("browser", descriptor, {...settingsBrowserCore, entries: [...settingsBrowserCore.entries, probeEntry(probe)]});
    const identity = {location: "browser" as const, instanceId: "settings-window"};
    const store = createDiagnosticsStore({identity});
    let application: Application | null = null;
    const feed = createWindowPlugins(() => application?.plugins ?? null, (error) => {
        throw error;
    });
    application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [
                {id: "clock", key: clockKey, create: () => systemClock},
                {id: "window.connection", key: windowConnectionKey, create: () => ({state: () => "offline" as const, onChange: () => () => undefined})},
                {id: "window.project", key: windowProjectKey, create: () => ({project: bound ? {id: "P", name: "雾港", generation: 1} : null})},
                {id: "window.plugins", key: windowPluginsKey, create: () => feed.capability},
            ],
            plugins: [createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}), settings, workbenchDeclarations, ...plugins],
            gates: [],
            observers: {plugins: feed},
        },
    );
    started.push(application);
    await application.startup;
    return {application, probe, diagnostics: store};
}

const list = (overrides: Partial<SettingsSectionDeclaration> = {}): SectionSpec => ({kind: "list", declaration: {title: title("列表"), icon: "i-lucide-square", category: "plugins", ...overrides}});
const pageSection = (overrides: Partial<SettingsPageDeclaration> = {}): SectionSpec & {readonly kind: "page"} => ({kind: "page", declaration: {title: title("页面"), icon: "i-lucide-square", category: "plugins", ...overrides}});

const notes = {
    alpha: defineSetting({plugin: "x.notes", name: "alpha", schema: Type.Boolean(), default: false, title: title("甲"), section: "x.notes.main", group: "basics", order: 2}),
    beta: defineSetting({plugin: "x.notes", name: "beta", schema: Type.Boolean(), default: false, title: title("乙"), section: "x.notes.main", group: "basics", order: 1}),
    gamma: defineSetting({plugin: "x.notes", name: "gamma", schema: Type.Boolean(), default: false, title: title("丙"), section: "x.notes.main"}),
    delta: defineSetting({plugin: "x.notes", name: "delta", schema: Type.Boolean(), default: false, title: title("丁"), section: "x.notes.main", group: "missing"}),
    userOnly: defineSetting({plugin: "x.notes", name: "userOnly", schema: Type.Boolean(), default: false, title: title("戊"), section: "x.notes.main", group: "advanced", layers: ["user"]}),
    orphan: defineSetting({plugin: "x.notes", name: "orphan", schema: Type.Boolean(), default: false, title: title("己"), section: "x.notes.nowhere"}),
    loose: defineSetting({plugin: "x.notes", name: "loose", schema: Type.Boolean(), default: false, title: title("庚")}),
    paged: defineSetting({plugin: "x.notes", name: "paged", schema: Type.Boolean(), default: false, title: title("辛"), section: "x.notes.page"}),
    lonely: defineSetting({plugin: "x.notes", name: "lonely", schema: Type.Boolean(), default: false, title: title("壬"), section: "x.notes.user", layers: ["user"]}),
};
const misc = defineSetting({plugin: "x.misc", name: "flag", schema: Type.Boolean(), default: false, title: title("癸")});

const keysOf = (settings: ReadonlyArray<WindowSetting>): string[] => settings.map((setting) => setting.definition.key);

describe("左栏与配置项的落位（输出 1、2、8、12）", () => {
    async function catalog(bound = false) {
        const sections = {
            "x.notes.main": list({groups: [{id: "basics", title: title("基础")}, {id: "advanced", title: title("高级")}]}),
            "x.notes.page": pageSection({category: "ai", layers: ["user"]}),
            "x.notes.user": list(),
            "x.notes.first": list({category: "app", order: -5, title: title("最先")}),
        };
        const started = await start([contributor("x.notes", sections, toggle(), Object.values(notes)), contributor("x.misc", {}, toggle(), [misc])], bound);
        return {...started, ...windowFor(started.probe, bound)};
    }

    it("三组自上而下应用、AI、插件，组内按 order、同值按 id；“其它”与“设置文件”排在插件组最后", async () => {
        const {window} = await catalog();
        expect(window.nav.value.map((group) => [group.category, group.items.map((item) => item.id)])).toEqual([
            ["app", ["x.notes.first", "nbook.appearance"]],
            ["ai", ["x.notes.page"]],
            ["plugins", ["x.notes.main", "x.notes.user", OTHER_SECTION_ID, FILE_SECTION_ID]],
        ]);
        // 刷新后回到第一个分区。
        expect(window.section.value).toBe("x.notes.first");
        // 没有可列的项的 list 分区停用，以原因作提示。
        expect(window.nav.value.flatMap((group) => group.items).find((item) => item.id === "x.notes.first")?.unavailable).toBe(t("model.emptySection"));
    });

    it("分区里先列没写小组的项，再按声明的顺序列小组；组内按 order、同值按键；指向没有声明的小组按没写处理并记诊断", async () => {
        const {window, recorder} = await catalog();
        window.select("x.notes.main");
        const view = window.current.value;
        if (view?.kind !== "list") throw new Error("x.notes.main 应是 list 分区");
        expect(view.groups.map((group) => [group.id, group.title, keysOf(group.settings)])).toEqual([
            [null, null, ["x.notes/delta", "x.notes/gamma"]],
            ["basics", "基础", ["x.notes/beta", "x.notes/alpha"]],
            ["advanced", "高级", ["x.notes/userOnly"]],
        ]);
        expect(recorder.reports).toContain("Setting x.notes/delta points to group missing, which section x.notes.main does not declare; it goes first in the section");
    });

    it("没写分区与指向不存在的分区的项进“其它”，按声明者插件分小组（后者记诊断）；指向 page 分区的项不在任何列表里", async () => {
        const {window, recorder} = await catalog();
        window.select(OTHER_SECTION_ID);
        const view = window.current.value;
        if (view?.kind !== "list") throw new Error("“其它”应是 list 分区");
        expect(view.title).toBe(t("model.otherTitle"));
        expect(view.groups.map((group) => [group.title, keysOf(group.settings)])).toEqual([
            ["x.misc", ["x.misc/flag"]],
            ["x.notes", ["x.notes/loose", "x.notes/orphan"]],
        ]);
        expect(recorder.reports).toContain("Setting x.notes/orphan points to section x.notes.nowhere, which does not exist; it goes under \"Other\"");
        const listed = window.nav.value.flatMap((group) => group.items).flatMap((item) => {
            window.select(item.id);
            const current = window.current.value;
            return current?.kind === "list" ? current.groups.flatMap((group) => keysOf(group.settings)) : [];
        });
        expect(listed).not.toContain("x.notes/paged");
    });

    it("没有落到“其它”的项时不出现“其它”", async () => {
        const {probe} = await start([contributor("x.notes", {"x.notes.main": list()}, toggle(), [notes.gamma])]);
        const {window} = windowFor(probe, false);
        expect(window.nav.value.flatMap((group) => group.items).map((item) => item.id)).not.toContain(OTHER_SECTION_ID);
    });

    it("本作品标签：只允许用户层的项不列出、分区末尾列出它们；全是这样的 list 分区与 layers 不含本作品的 page 分区停用并给原因", async () => {
        const {window} = await catalog(true);
        window.setLayer("project");
        const items = new Map(window.nav.value.flatMap((group) => group.items).map((item) => [item.id, item.unavailable]));
        expect(items.get("x.notes.main")).toBeNull();
        expect(items.get("x.notes.user")).toBe(t("model.userOnlySection"));
        expect(items.get("x.notes.page")).toBe(t("model.userOnlySection"));
        window.select("x.notes.main");
        const view = window.current.value;
        if (view?.kind !== "list") throw new Error("x.notes.main 应是 list 分区");
        expect(view.groups.flatMap((group) => keysOf(group.settings))).not.toContain("x.notes/userOnly");
        expect(view.excluded).toEqual(["戊"]);
        // 当前分区在新标签下不可用：右边原位给原因（输出 8）。
        window.select("x.notes.user");
        expect(window.current.value?.unavailable).toBe(t("model.userOnlySection"));
        window.setLayer("user");
        expect(window.current.value?.unavailable).toBeNull();
    });
});

describe("打开窗口（输出 15、16）", () => {
    async function plain(bound = false) {
        const started = await start([contributor("x.notes", {"x.notes.main": list()}, toggle(), [notes.gamma])], bound);
        return windowFor(started.probe, bound);
    }

    it("分区不在左栏里为 invalid-args，未绑定作品却要本作品标签为 unavailable：两种都不打开、不改变窗口", async () => {
        const {window} = await plain();
        expect(window.openWindow({section: "x.notes.nowhere"})).toEqual({ok: false, code: "invalid-args", reason: t("model.unknownSection", {section: "x.notes.nowhere"})});
        expect(window.openWindow({layer: "project"})).toMatchObject({ok: false, code: "unavailable"});
        expect(window.open.value).toBe(false);
        expect(window.section.value).toBe("nbook.appearance");
        // “其它”没有项时也不在左栏里。
        expect(window.openWindow({section: OTHER_SECTION_ID})).toMatchObject({ok: false, code: "invalid-args"});
    });

    it("打开跳到给的分区与标签；已开着时只聚焦；关掉再开回到上次的分区与标签", async () => {
        const {window} = await plain(true);
        expect(window.openWindow({section: "x.notes.main", layer: "project"})).toEqual({ok: true, value: null});
        expect([window.open.value, window.section.value, window.layer.value, window.focusRequest.value]).toEqual([true, "x.notes.main", "project", 0]);
        expect(window.openWindow({})).toEqual({ok: true, value: null});
        expect(window.focusRequest.value).toBe(1);
        window.close();
        expect(window.open.value).toBe(false);
        window.openWindow({});
        expect([window.open.value, window.section.value, window.layer.value]).toEqual([true, "x.notes.main", "project"]);
    });

    it("尺寸缺省 960×640；调整后记住（不小于下限），没变不重复记", async () => {
        const started = await start([]);
        const {window, recorder} = windowFor(started.probe, false);
        expect(window.size.value).toEqual(DEFAULT_SETTINGS_WINDOW_SIZE);
        window.resize({width: 1100.4});
        expect(recorder.size.value).toEqual({width: 1100, height: 640});
        window.resize({height: 10});
        expect(window.size.value).toEqual({width: 1100, height: MIN_SETTINGS_WINDOW_SIZE.height});
        const remembered = recorder.size.value;
        window.resize({width: 1100});
        expect(recorder.size.value).toBe(remembered);
    });
});

describe("按需激活（输出 4）：窗口显示 page 分区时触发 onSettingsPage", () => {
    const Page = defineComponent({name: "OnDemandPage", render: () => null});
    const onPage = (id: string) => ({activationEvents: [settingsPageEvent(id)]});
    const stateOf = (application: Application, plugin: string) => application.plugins.entryState({plugin, entry: "browser"})?.status;

    it("入口声明了这个分区的事件：启动后不激活，打开窗口到这个分区时才激活、交付并加载；离开再回来不重复激活", async () => {
        const control = toggle({implementation: {load: async () => Page}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control, [], onPage("x.notes.page"))]);
        const {window} = windowFor(started.probe, false);
        expect(stateOf(started.application, "x.notes")).toBe("registered");
        window.openWindow({section: "nbook.appearance"});
        expect(stateOf(started.application, "x.notes")).toBe("registered");
        window.select("x.notes.page");
        await waitUntil("激活并加载完", () => window.page("x.notes.page").status === "ready");
        expect(started.application.plugins.entryState({plugin: "x.notes", entry: "browser"})?.generation).toBe(1);
        window.select("nbook.appearance");
        window.select("x.notes.page");
        expect(started.application.plugins.entryState({plugin: "x.notes", entry: "browser"})?.generation).toBe(1);
    });

    it("所属入口没声明这个事件、只有别的入口声明了：不触发，原位写“没有声明打开分区时激活”，别的入口也不被激活", async () => {
        const other: PluginDefinition = {id: "x.other", entries: [{id: "browser", location: "browser", activationEvents: [settingsPageEvent("x.notes.page")], activate: () => ({})}]};
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, toggle(), [], {activationEvents: []}), other]);
        const {window, recorder} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        expect(window.page("x.notes.page").delivery).toEqual({kind: "entry-not-activatable", reason: "Entry x.notes/browser does not declare onSettingsPage:x.notes.page"});
        expect(stateOf(started.application, "x.other")).toBe("registered");
        expect(started.diagnostics.query({}).records.some((record) => record.event === "settings.sections" && record.message.includes("cannot be activated on demand"))).toBe(true);
        // 之后入口经别的途径激活了：按它的状态呈现。
        await started.application.plugins.activate({plugin: "x.notes", entry: "browser"});
        expect(window.page("x.notes.page").delivery).toEqual({kind: "available"});
        expect(recorder.notices).toEqual([]);
    });

    it("同一事件的另一个监听者一直不结束：这个分区的入口激活后照常交付并加载", async () => {
        // 一直挂着，直到入口停止（测试收尾时）才结束。
        const hang = (context: ActivationContext) => new Promise<never>((_resolve, reject) => context.signal.addEventListener("abort", () => reject(new Error("已停止")), {once: true}));
        const other: PluginDefinition = {id: "x.slow", entries: [{id: "browser", location: "browser", activationEvents: [settingsPageEvent("x.notes.page")], activate: hang}]};
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, toggle({implementation: {load: async () => Page}}), [], onPage("x.notes.page")), other]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("加载完", () => window.page("x.notes.page").status === "ready");
        expect(stateOf(started.application, "x.slow")).toBe("activating");
    });

    it("停在这个分区时所属入口从受阻恢复：不用切换分区就激活并加载", async () => {
        const dependency = defineServiceKey<object>("x.dep/service");
        let broken = true;
        const provider: PluginDefinition = {id: "x.dep", entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], provides: [dependency], activate: () => {
            if (broken) throw new Error("依赖启动失败");
            return {services: [provideService(dependency, {})]};
        }}]};
        const page = contributor("x.notes", {"x.notes.page": pageSection()}, toggle({implementation: {load: async () => Page}}), [], {...onPage("x.notes.page"), dependencies: [{key: dependency}]});
        const started = await start([provider, page]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        expect(stateOf(started.application, "x.notes")).toBe("blocked");
        broken = false;
        expect((await started.application.plugins.recover({plugin: "x.dep", entry: "browser"})).status).toBe("reset");
        expect((await started.application.plugins.activate({plugin: "x.dep", entry: "browser"})).status).toBe("activated");
        await waitUntil("恢复后激活并加载完", () => window.page("x.notes.page").status === "ready");
    });

    it("等待中关窗口不取消：激活照常完成，再打开时直接是可用", async () => {
        let release: () => void = () => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const control = toggle({implementation: {load: async () => Page}});
        const slow = contributor("x.notes", {"x.notes.page": pageSection()}, control, [], onPage("x.notes.page"));
        const entry = slow.entries[0]!;
        const gated: PluginDefinition = {...slow, entries: [{...entry, activate: async (context) => {
            await gate;
            return entry.activate(context);
        }}]};
        const started = await start([gated]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        expect(window.page("x.notes.page").delivery).toEqual({kind: "declared"});
        window.close();
        release();
        await waitUntil("激活完成", () => stateOf(started.application, "x.notes") === "available");
        window.openWindow({});
        expect(window.page("x.notes.page").delivery).toEqual({kind: "available"});
    });
});

describe("搜索（输出 21）", () => {
    const tones = defineSetting({
        plugin: "x.notes",
        name: "tone",
        schema: Type.Union([Type.Literal("calm"), Type.Literal("tense")]),
        default: "calm",
        title: {"zh-CN": "语气", "en-US": "Tone"},
        description: {"zh-CN": "续写时的整体口吻", "en-US": "Overall voice when continuing"},
        section: "x.notes.main",
        choices: [{value: "calm", title: {"zh-CN": "平静", "en-US": "Calm"}}, {value: "tense", title: {"zh-CN": "紧张", "en-US": "Tense"}}],
    });
    const keyed = defineSetting({plugin: "x.notes", name: "fontFamily", schema: Type.String(), default: "", title: {"zh-CN": "字体", "en-US": "Font"}, section: "x.notes.main", layers: ["user"]});
    const sized = defineSetting({plugin: "x.notes", name: "fontSize", schema: Type.Integer(), default: 14, title: {"zh-CN": "字号", "en-US": "Font Size"}, section: "x.notes.main", group: "editor"});
    const onPage = defineSetting({plugin: "x.notes", name: "endpoint", schema: Type.String(), default: "", title: {"zh-CN": "接口地址", "en-US": "Endpoint"}, section: "x.notes.page"});

    async function searching(bound = false) {
        const sections = {
            "x.notes.main": list({title: title("笔记"), groups: [{id: "editor", title: title("编辑器")}]}),
            "x.notes.page": pageSection({title: {"zh-CN": "模型服务", "en-US": "Model Providers"}, keywords: [{"zh-CN": "密钥", "en-US": "API key"}]}),
            "x.notes.user": pageSection({title: title("只给用户"), layers: ["user"], keywords: [title("密钥")]}),
        };
        const started = await start([contributor("x.notes", sections, toggle(), [tones, keyed, sized, onPage])], bound);
        const opened = windowFor(started.probe, bound);
        opened.window.openWindow({section: "x.notes.main"});
        return opened.window;
    }

    const results = (window: SettingsWindow) => {
        const view = window.current.value;
        if (view?.kind !== "search") throw new Error("应是搜索结果");
        return {groups: view.list.groups.map((group) => [group.id, group.title, keysOf(group.settings)]), pages: view.pages.map((page) => page.id)};
    };

    it("比对标题、说明、键与固定选项名，两种语言都比、不分大小写；每个词都要命中；按分区分组", async () => {
        const window = await searching();
        for (const query of ["语气", "TONE", "口吻", "x.notes/tone", "紧张", "Tense", "voice continuing"]) {
            window.search(query);
            expect(results(window).groups, query).toEqual([["x.notes.main#", "笔记", ["x.notes/tone"]]]);
        }
        window.search("语气 字体");
        expect(results(window)).toEqual({groups: [], pages: []});
        window.search("fontfamily");
        expect(results(window).groups).toEqual([["x.notes.main#", "笔记", ["x.notes/fontFamily"]]]);
    });

    it("结果按分区与小组各成一组：有小组时组标题是小组名、所属分区名另给，没有小组时组标题就是分区名；词拆开交给呈现", async () => {
        const window = await searching();
        window.search("x.notes/font");
        const view = window.current.value;
        if (view?.kind !== "search") throw new Error("应是搜索结果");
        expect(view.words).toEqual(["x.notes/font"]);
        expect(view.list.groups.map((group) => [group.id, group.title, group.parent ?? null, keysOf(group.settings)])).toEqual([
            ["x.notes.main#", "笔记", null, ["x.notes/fontFamily"]],
            ["x.notes.main#editor", "编辑器", "笔记", ["x.notes/fontSize"]],
        ]);
        window.search("  Voice   CONTINUING ");
        const split = window.current.value;
        expect(split?.kind === "search" ? split.words : null).toEqual(["voice", "continuing"]);
    });

    it("page 分区按标题、说明、keywords 与指向它的配置项命中，只给“打开”；只列当前标签下可用的", async () => {
        const window = await searching(true);
        window.search("api KEY");
        expect(results(window).pages).toEqual(["x.notes.page"]);
        window.search("密钥");
        expect(results(window).pages).toEqual(["x.notes.page", "x.notes.user"]);
        window.search("接口地址");
        expect(results(window).pages).toEqual(["x.notes.page"]);
        window.setLayer("project");
        window.search("密钥");
        expect(results(window).pages).toEqual(["x.notes.page"]);
        // 只允许用户层的项在本作品标签下不列出。
        window.search("fontfamily");
        expect(results(window).groups).toEqual([]);
    });

    it("搜索时当前分区不变；清空回到原分区；选一个分区或打开命中的页面时清空搜索；关窗口清空", async () => {
        const window = await searching();
        window.search("语气");
        expect(window.section.value).toBe("x.notes.main");
        expect(window.current.value?.kind).toBe("search");
        window.search("");
        expect(window.current.value?.id).toBe("x.notes.main");
        window.search("密钥");
        window.select("x.notes.page");
        expect([window.query.value, window.current.value?.id]).toEqual(["", "x.notes.page"]);
        window.search("语气");
        window.close();
        window.openWindow({});
        expect([window.query.value, window.current.value?.id]).toEqual(["", "x.notes.page"]);
    });
});

describe("未保存保护（输出 22）", () => {
    const Page = defineComponent({name: "DirtyPage", render: () => null});

    async function dirtyPage() {
        const control = toggle({implementation: {load: async () => Page}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection(), "x.notes.other": pageSection()}, control)], true);
        const {window} = windowFor(started.probe, true);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("页面加载完", () => window.page("x.notes.page").status === "ready");
        const context = window.page("x.notes.page").context;
        context.dirty(true);
        expect(window.unsaved.value).toBe(true);
        return {window, context};
    }

    it("切分区、切标签、关窗口、命令打开别的分区、开始搜索：先等确认，原处不变；取消留在原处", async () => {
        const {window} = await dirtyPage();
        const attempts: Array<[string, () => void, SettingsLeaveTarget]> = [
            ["切分区", () => window.select("x.notes.other"), {kind: "section", id: "x.notes.other"}],
            ["切标签", () => window.setLayer("project"), {kind: "layer", layer: "project"}],
            ["关窗口", () => window.close(), {kind: "close"}],
            ["命令", () => void window.openWindow({section: "nbook.appearance"}), {kind: "open", section: "nbook.appearance"}],
            ["搜索", () => window.search("语气"), {kind: "search", query: "语气"}],
        ];
        for (const [name, act, target] of attempts) {
            act();
            expect(window.leaving.value, name).toEqual(target);
            expect([window.open.value, window.section.value, window.layer.value, window.query.value], name).toEqual([true, "x.notes.page", "user", ""]);
            window.cancelLeave();
            expect(window.leaving.value).toBeNull();
            expect(window.unsaved.value).toBe(true);
        }
        // 先敲空白再敲字：只有空白时页面还挂着、不用确认，变成真的在搜索那一下要确认（审查发现：原来绕过了保护）。
        window.search(" ");
        expect([window.leaving.value, window.current.value?.id]).toEqual([null, "x.notes.page"]);
        window.search(" 语气");
        expect(window.leaving.value).toEqual({kind: "search", query: " 语气"});
        expect(window.unsaved.value).toBe(true);
        window.cancelLeave();
        window.search("");
        // 留在原处的动作不用确认：再选当前分区、命令只聚焦。
        window.select("x.notes.page");
        window.openWindow({section: "x.notes.page"});
        expect(window.leaving.value).toBeNull();
    });

    it("确认框开着时又来一个离开，等着的换成后来的；放弃后执行它，未保存的标记清掉", async () => {
        const {window} = await dirtyPage();
        window.select("x.notes.other");
        window.close();
        expect(window.leaving.value).toEqual({kind: "close"});
        window.confirmLeave();
        expect([window.open.value, window.section.value, window.unsaved.value, window.leaving.value]).toEqual([false, "x.notes.page", false, null]);
    });

    it("放弃后切标签：页面换一个代际重建（草稿丢掉）、拿到新的上下文；旧上下文晚到的 dirty 不算数", async () => {
        const {window, context} = await dirtyPage();
        const before = window.page("x.notes.page").generation;
        window.setLayer("project");
        window.confirmLeave();
        expect(window.layer.value).toBe("project");
        const after = window.page("x.notes.page");
        expect(after.generation).toBe(before + 1);
        expect(after.context).not.toBe(context);
        expect(after.context.layer.value).toBe("project");
        context.dirty(true);
        expect(window.unsaved.value).toBe(false);
        after.context.dirty(true);
        expect(window.unsaved.value).toBe(true);
        after.context.dirty(false);
        expect(window.unsaved.value).toBe(false);
    });

    it("加载中就关了窗口：那次显示的上下文作废，重开加载完拿到新的上下文（审查发现：原来复用了旧的）", async () => {
        let release: (component: Component) => void = () => undefined;
        const control = toggle({implementation: {load: () => new Promise<Component>((resolve) => {
            release = resolve;
        })}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)], true);
        const {window} = windowFor(started.probe, true);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("开始加载", () => window.page("x.notes.page").status === "loading");
        const early = window.page("x.notes.page").context;
        window.close();
        window.openWindow({});
        await waitUntil("又开始加载", () => window.page("x.notes.page").status === "loading");
        release(Page);
        await waitUntil("加载完", () => window.page("x.notes.page").status === "ready");
        const context = window.page("x.notes.page").context;
        expect(context).not.toBe(early);
        early.dirty(true);
        expect(window.unsaved.value).toBe(false);
    });

    it("页面不挂了（离开分区、交付撤回）上下文随之作废；没报未保存时离开不用确认", async () => {
        const {window, context} = await dirtyPage();
        context.dirty(false);
        window.select("x.notes.other");
        expect(window.leaving.value).toBeNull();
        expect(window.section.value).toBe("x.notes.other");
        context.dirty(true);
        expect(window.unsaved.value).toBe(false);
        window.select("x.notes.page");
        expect(window.page("x.notes.page").context).not.toBe(context);
    });
});

describe("page 分区的加载（输出 4–6）", () => {
    const Page = defineComponent({name: "PageV1", render: () => null});

    it("窗口开着、分区是当前分区才加载一次；切换标签时上下文是同一个对象，层跟着变，页面不重建", async () => {
        let loads = 0;
        const control = toggle({implementation: {load: async () => {
            loads += 1;
            return Page;
        }}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)], true);
        const {window} = windowFor(started.probe, true);
        expect(window.page("x.notes.page").status).toBe("waiting");
        window.select("x.notes.page");
        expect(loads).toBe(0);
        window.openWindow({});
        await waitUntil("页面加载完", () => window.page("x.notes.page").status === "ready");
        const first = window.page("x.notes.page");
        expect([loads, first.component]).toEqual([1, Page]);
        window.setLayer("project");
        const after = window.page("x.notes.page");
        expect(after.context).toBe(first.context);
        expect(after.context.layer.value).toBe("project");
        expect(after.generation).toBe(first.generation);
        // 页面拿到的选项源就是窗口的那一份（通用列表也用它）。
        expect(after.context.options).toBe(window.options());
        // 离开再回来：组件定义不重新加载（句柄没变）。
        window.select("nbook.appearance");
        window.select("x.notes.page");
        expect(loads).toBe(1);
    });

    it("加载结果回来时窗口已关闭：丢弃结果，不挂组件、不记为加载失败；重开时重新加载", async () => {
        const loads: Array<{readonly resolve: (component: Component) => void; readonly reject: (error: Error) => void}> = [];
        const control = toggle({implementation: {load: () => new Promise<Component>((resolve, reject) => {
            loads.push({resolve, reject});
        })}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)]);
        const {window} = windowFor(started.probe, false);
        // 结果经注册表与窗口两层 await 才回到实例：让出一轮事件循环，等它们都结算。
        const settled = () => new Promise((resolve) => setImmediate(resolve));

        window.openWindow({section: "x.notes.page"});
        await waitUntil("开始加载", () => loads.length === 1);
        window.close();
        loads[0]?.resolve(Page);
        await settled();
        expect(window.page("x.notes.page")).toMatchObject({status: "waiting", component: null, error: null});

        window.openWindow({});
        await waitUntil("重开后再次加载", () => loads.length === 2);
        window.close();
        loads[1]?.reject(new Error("页面模块下载失败"));
        await settled();
        expect(window.page("x.notes.page")).toMatchObject({status: "waiting", component: null, error: null});

        window.openWindow({});
        await waitUntil("再次重开后又加载", () => loads.length === 3);
        loads[2]?.resolve(Page);
        await waitUntil("加载完", () => window.page("x.notes.page").status === "ready");
        expect(window.page("x.notes.page").component).toBe(Page);
    });

    it("入口激活失败：原位给原因，“重试”恢复并激活后交付并加载；“重试”进行中时 busy", async () => {
        const control = toggle({fail: true, implementation: {load: async () => Page}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control, [], {activationEvents: []})]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        expect((await started.application.plugins.activate({plugin: "x.notes", entry: "browser"})).status).toBe("failed");
        expect(window.page("x.notes.page").delivery).toEqual({kind: "entry-failed", reason: "样例入口按开关激活失败"});
        control.fail = false;
        const retry = window.retryPageEntry("x.notes.page");
        expect(window.page("x.notes.page").busy).toBe(true);
        await retry;
        await waitUntil("重试后加载完", () => window.page("x.notes.page").status === "ready");
        expect(window.page("x.notes.page").busy).toBe(false);
    });

    it("load() 失败给“重新加载”，进行中再点不发起第二次，再加载成功；渲染出错给“重试”，新代际重建；过期代际的报告丢弃", async () => {
        let broken = true;
        let loads = 0;
        const control = toggle({implementation: {load: async () => {
            loads += 1;
            if (broken) throw new Error("页面模块下载失败");
            return Page;
        }}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("加载失败", () => window.page("x.notes.page").status === "load-failed");
        expect(window.page("x.notes.page").error).toBe("页面模块下载失败");
        broken = false;
        window.reloadPage("x.notes.page");
        window.reloadPage("x.notes.page");
        await waitUntil("重新加载完", () => window.page("x.notes.page").status === "ready");
        expect(loads).toBe(2);
        const generation = window.page("x.notes.page").generation;
        window.pageRenderFailed("x.notes.page", generation - 1, "旧实例的错误");
        expect(window.page("x.notes.page").status).toBe("ready");
        window.pageRenderFailed("x.notes.page", generation, "页面出错");
        expect(window.page("x.notes.page")).toMatchObject({status: "render-failed", error: "页面出错"});
        window.retryPageRender("x.notes.page");
        expect(window.page("x.notes.page")).toMatchObject({status: "ready", error: null, generation: generation + 1});
    });

    it("入口停止：卸掉组件、显示停止原因", async () => {
        const control = toggle({implementation: {load: async () => Page}});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, control)]);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("加载完", () => window.page("x.notes.page").status === "ready");
        expect((await control.context?.scope.parent?.close())?.status).toBe("closed");
        expect(window.page("x.notes.page")).toMatchObject({delivery: {kind: "entry-stopped", reason: "scope-closed"}, status: "waiting", component: null});
    });

    /**
     * 停止的入口再次交付要等热插拔（内核现在不能重新激活已关闭的入口），这里用设置场景的局部宿主按句柄撤回、发布：撤回与
     * 再次发布挨在同一轮里，窗口也要丢掉旧的组件定义、用新句柄重新加载。
     */
    it("撤回后同一分区再次交付：新句柄，重新加载；撤回与发布挨在一起也不沿用旧组件", async () => {
        const Second = defineComponent({name: "PageV2", render: () => null});
        const host = createSettingsHost({settings: [], sections: [{id: "x.notes.page", plugin: "x.notes", ...pageSection()}], notify: () => undefined, report: () => undefined});
        disposers.push(() => host.dispose());
        host.publish("x.notes.page", async () => Page);
        host.window.openWindow({section: "x.notes.page"});
        await waitUntil("加载完", () => host.window.page("x.notes.page").status === "ready");
        host.revoke("x.notes.page", "scope-closed");
        expect(host.window.page("x.notes.page")).toMatchObject({delivery: {kind: "entry-stopped", reason: "scope-closed"}, component: null});
        host.publish("x.notes.page", async () => Second);
        await waitUntil("再次交付后加载完", () => host.window.page("x.notes.page").component === Second);
        // 发布时先撤回旧句柄（同一轮）：结果仍是新组件。
        const Third = defineComponent({name: "PageV3", render: () => null});
        host.publish("x.notes.page", async () => Third);
        await waitUntil("换代后加载完", () => host.window.page("x.notes.page").component === Third);
    });
});

// ── 写入与层的说明：多实例场地，真实文件 ─────────────────────────────────

async function world(files: {readonly user?: string; readonly project?: string} = {}): Promise<{readonly world: SettingsWorld; readonly window: SettingsWindow; readonly recorder: Recorder; readonly root: string}> {
    counter += 1;
    const root = join(tmp, `world-${String(counter)}`);
    for (const [path, text] of [[join(root, "state", "settings.json"), files.user], [join(root, "Book", ".nbook", "settings.json"), files.project]] as const) {
        if (text === undefined) continue;
        await mkdir(join(path, ".."), {recursive: true});
        await writeFile(path, text);
    }
    await mkdir(join(root, "Book"), {recursive: true});
    const created = await settingsWorld(root, [definitionAt("server", workbenchDescriptor, undefined)]);
    worlds.push(created);
    await created.project(1, [definitionAt("project", workbenchDescriptor, undefined)]);
    const probe: Probe = {source: null, settings: null};
    await created.window("w-settings", [workbenchDeclarations], {bound: true, settingsEntries: [probeEntry(probe)]});
    return {world: created, root, ...windowFor(probe, true)};
}

const themeOf = (window: SettingsWindow): WindowSetting => {
    const appearance = window.current.value;
    if (appearance?.kind !== "list") throw new Error("当前分区应是外观");
    const found = appearance.groups.flatMap((group) => group.settings).find((entry) => entry.definition.key === themeSetting.key);
    if (found === undefined) throw new Error("外观分区里没有主题");
    return found;
};

describe("通用列表的写入（输出 10、12、14）", () => {
    it("改值经用户编辑写当前标签那一层：结算前显示这次的值，返回时本窗口已是新值；恢复默认删掉键、其余内容不变", async () => {
        const {world: created, window, recorder} = await world({user: "{\n    // 我的主题\n    \"nbook.workbench/appearance\": \"dark\"\n}\n"});
        window.openWindow({section: "nbook.appearance"});
        const theme = themeOf(window);
        const writing = window.write(theme, "macos");
        expect(window.pending(themeSetting.key)).toEqual({value: "macos"});
        await writing;
        expect(window.pending(themeSetting.key)).toBeUndefined();
        expect(window.editing.get(themeSetting)).toBe("macos");
        expect(await readFile(created.userFile, "utf8")).toContain("\"nbook.workbench/theme\": \"macos\"");
        expect(recorder.notices).toEqual([]);

        expect(await window.editing.update(appearanceSetting, undefined, {layer: "user"})).toEqual({ok: true});
        const text = await readFile(created.userFile, "utf8");
        expect(text).toContain("// 我的主题");
        expect(text).not.toContain("nbook.workbench/appearance");
        expect(window.editing.inspect(appearanceSetting).user).toEqual({status: "ok"});
    });

    it("本作品标签写项目层，用户层不变", async () => {
        const {world: created, window} = await world();
        window.openWindow({section: "nbook.appearance", layer: "project"});
        await window.write(themeOf(window), "macos");
        expect(JSON.parse(await readFile(created.projectFile, "utf8"))).toEqual({"nbook.workbench/theme": "macos"});
        expect(window.editing.inspect(themeSetting).user).toEqual({status: "ok"});
    });

    it("写入失败：发通知（哪一项、为什么），控件回到层里的实际值；值不合 schema 同样", async () => {
        const {world: created, window, recorder} = await world({user: "{\"nbook.workbench/theme\": \"nbook\"}"});
        window.openWindow({section: "nbook.appearance"});
        await chmod(created.userFile, 0o444);
        try {
            await window.write(themeOf(window), "macos");
        } finally {
            await chmod(created.userFile, 0o644);
        }
        expect(window.pending(themeSetting.key)).toBeUndefined();
        expect(window.editing.get(themeSetting)).toBe("nbook");
        expect(recorder.notices).toHaveLength(1);
        // 通知交的是文字引用，视口显示时才翻：这里按中文翻出来比对，再按英文翻同一条，框架换成英文，代入的标题与原因是发通知时翻好的片段。
        const shown = (notice: NotificationInput | undefined, resolver = settingsText.resolver) => ({tone: notice?.tone, title: resolver.t(notice?.title ?? ""), message: resolver.t(notice?.message ?? "")});
        expect(shown(recorder.notices[0])).toMatchObject({tone: "warning", title: t("model.notSavedTitle")});
        expect(shown(recorder.notices[0]).message).toStartWith(beforeDetail(t("model.notSaved", {title: "主题", reason: t("writeFailure.writeFailed", {detail: DETAIL})})));
        const english = shown(recorder.notices[0], settingsTestText("en-US").resolver);
        expect(english.title).toBe("Setting not saved");
        expect(english.message).toStartWith(beforeDetail(`主题: ${t("writeFailure.writeFailed", {detail: DETAIL})}`));

        await window.write(themeOf(window), "solarized");
        expect(shown(recorder.notices[1]).message).toStartWith(beforeDetail(t("model.notSaved", {title: "主题", reason: t("writeFailure.invalidValue", {detail: DETAIL})})));
    });

    it("page 分区报告自己的写入失败：通知与通用列表同一套文案；结果未知时换成“可能没有保存”的标题；离开页面后晚到的照样通知", async () => {
        const Page = defineComponent({name: "WritingPage", render: () => null});
        const started = await start([contributor("x.notes", {"x.notes.page": pageSection()}, toggle({implementation: {load: async () => Page}}))], true);
        const {window, recorder} = windowFor(started.probe, true);
        window.openWindow({section: "x.notes.page"});
        await waitUntil("页面加载完", () => window.page("x.notes.page").status === "ready");
        const context = window.page("x.notes.page").context;
        const shown = (notice: NotificationInput | undefined) => ({tone: notice?.tone, title: settingsText.resolver.t(notice?.title ?? ""), message: settingsText.resolver.t(notice?.message ?? "")});

        context.reportWriteFailure("DeepSeek 的密钥", {reason: "钥匙串不可用"});
        expect(shown(recorder.notices[0])).toEqual({tone: "warning", title: t("model.notSavedTitle"), message: t("model.notSaved", {title: "DeepSeek 的密钥", reason: "钥匙串不可用"})});
        context.reportWriteFailure("DeepSeek 的密钥", {reason: "连接断了", uncertain: true});
        expect(shown(recorder.notices[1]).title).toBe(t("model.unknownTitle"));

        window.close();
        context.reportWriteFailure("DeepSeek", {reason: "写入失败"});
        expect(recorder.notices).toHaveLength(3);
    });
});

describe("层的说明（输出 13）", () => {
    it("用户层文件无效：说明不带路径（状态根不发给浏览器）；修好后自动消失", async () => {
        const {world: created, window} = await world({user: "{\"nbook.workbench/theme\": "});
        window.openWindow({section: "nbook.appearance"});
        expect(window.layerNotice.value).toMatchObject({kind: "invalid", path: null});
        await writeFile(created.userFile, "{}");
        await waitUntil("文件修好后说明消失", () => {
            created.clock.advance(RELOAD_DELAY_MS);
            return window.layerNotice.value === null;
        });
    });

    it("项目层文件无效：本作品标签的说明带项目层文件的路径；用户标签不受影响", async () => {
        const {world: created, window} = await world({project: "{\"nbook.workbench/theme\": "});
        window.openWindow({section: "nbook.appearance", layer: "project"});
        expect(window.layerNotice.value).toEqual({kind: "invalid", path: created.projectFile, detail: "第 1 行：这里缺一个值", reason: "这里缺一个值", position: {line: 1, column: 27}});
        window.setLayer("user");
        expect(window.layerNotice.value).toBeNull();
    });
});

describe("设置文件视图（输出 23）：经远程合同整份读写，真实设置文件", () => {
    it("“设置文件”是左栏固定的一项，编辑当前标签那一层；项目层带文件路径，用户层不带", async () => {
        const {world: created, window} = await world();
        window.openWindow({section: FILE_SECTION_ID});
        expect(window.current.value).toMatchObject({kind: "file", id: FILE_SECTION_ID, title: t("model.fileTitle"), layer: "user", path: null});
        window.setLayer("project");
        expect(window.current.value).toMatchObject({kind: "file", layer: "project", path: created.projectFile});
    });

    it("读出全文，整份写入原样落盘（注释与未声明的键保留），本窗口随即是新值", async () => {
        const original = "// 我的设置\n{\n    \"nbook.workbench/theme\": \"nbook\",\n    \"other.plugin/kept\": 1\n}\n";
        const {world: created, window} = await world({user: original});
        const file = window.file("user")!;
        const read = await file.read();
        expect(read).toMatchObject({ok: true, text: original, exists: true});
        if (!read.ok) return;
        const next = original.replace("\"nbook\"", "\"macos\"").replace("// 我的设置", "// 改过了");
        expect(await file.write(next, read.revision)).toMatchObject({ok: true, snapshot: {status: "ok"}});
        expect(await readFile(created.userFile, "utf8")).toBe(next);
        expect(window.editing.get(themeSetting)).toBe("macos");
    });

    it("别处改过为 conflict、文件不变；文本不合格为 invalid-text 带行列；只改注释也通知修订号", async () => {
        const {world: created, window} = await world({user: "{\"nbook.workbench/theme\": \"nbook\"}"});
        const file = window.file("user")!;
        const read = await file.read();
        if (!read.ok) throw new Error("应能读出");
        const revisions: string[] = [];
        const stop = file.watch((revision) => revisions.push(revision));
        await waitUntil("订阅先推当前修订号", () => revisions.length > 0);
        expect(revisions[0]).toBe(read.revision);
        await writeFile(created.userFile, "// 别处加了注释\n{\"nbook.workbench/theme\": \"nbook\"}");
        await waitUntil("只改注释也通知", () => {
            created.clock.advance(RELOAD_DELAY_MS);
            return revisions.length > 1;
        });
        stop();
        expect(await file.write("{}", read.revision)).toMatchObject({ok: false, code: "conflict"});
        const fresh = await file.read();
        if (!fresh.ok) throw new Error("应能读出");
        expect(await file.write("{\n  \"a\": 1\n  \"b\": 2\n}", fresh.revision)).toEqual({ok: false, code: "invalid-text", detail: "缺逗号", position: {line: 3, column: 3}});
        expect(await readFile(created.userFile, "utf8")).toBe("// 别处加了注释\n{\"nbook.workbench/theme\": \"nbook\"}");
    });

    it("层文件无效时经它修好：说明消失、控件恢复；项目层同样", async () => {
        const {window} = await world({user: "{\"nbook.workbench/theme\": ", project: "[]"});
        window.openWindow({section: "nbook.appearance"});
        expect(window.layerNotice.value?.kind).toBe("invalid");
        for (const layer of ["user", "project"] as const) {
            const file = window.file(layer)!;
            const read = await file.read();
            if (!read.ok) throw new Error("应能读出");
            expect(await file.write("{\"nbook.workbench/theme\": \"macos\"}", read.revision)).toMatchObject({ok: true, snapshot: {status: "ok"}});
        }
        expect(window.layerNotice.value).toBeNull();
        window.setLayer("project");
        expect(window.layerNotice.value).toBeNull();
        expect(window.editing.get(themeSetting)).toBe("macos");
    });

    it("设置文件视图报了未保存：离开它先确认，同 page 页面", async () => {
        const {window} = await world();
        window.openWindow({section: FILE_SECTION_ID});
        window.fileDirty(true);
        window.select("nbook.appearance");
        expect(window.leaving.value).toEqual({kind: "section", id: "nbook.appearance"});
        window.confirmLeave();
        expect([window.section.value, window.unsaved.value]).toEqual(["nbook.appearance", false]);
    });
});

describe("打开设置文件并定位（输出 22、23）", () => {
    const position = {line: 3, column: 3};

    it("没有未保存的改动：切到设置文件视图、标签随层，位置挂在模型上；视图取走一次后没有，再取是 null", async () => {
        const {window} = await world();
        window.openWindow({section: "nbook.appearance"});
        window.openFile("project", position);
        expect([window.section.value, window.layer.value, window.leaving.value]).toEqual([FILE_SECTION_ID, "project", null]);
        expect(window.fileLocation.value).toEqual({layer: "project", position});
        // 别的层的视图取不走：位置属于打开它的那一层。
        expect(window.takeFileLocation("user")).toBeNull();
        expect(window.takeFileLocation("project")).toEqual(position);
        expect(window.fileLocation.value).toBeNull();
        expect(window.takeFileLocation("project")).toBeNull();
    });

    it("没有位置：只打开设置文件，不挂位置", async () => {
        const {window} = await world();
        window.openWindow({section: "nbook.appearance"});
        window.openFile("user");
        expect([window.section.value, window.fileLocation.value]).toEqual([FILE_SECTION_ID, null]);
    });

    it("位置没被取走就去了别处：位置作废，之后回到设置文件视图取不到", async () => {
        const {window} = await world();
        window.openWindow({section: "nbook.appearance"});
        window.openFile("user", position);
        window.select("nbook.appearance");
        expect(window.fileLocation.value).toBeNull();
        window.select(FILE_SECTION_ID);
        expect(window.takeFileLocation("user")).toBeNull();
    });

    it("有未保存的改动：同切分区先等确认，取消留在原处、不切不挂位置；放弃后切过去并挂位置", async () => {
        const {window} = await world();
        window.openWindow({section: FILE_SECTION_ID});
        window.fileDirty(true);
        window.openFile("project", position);
        expect(window.leaving.value).toEqual({kind: "file", layer: "project", position});
        expect([window.section.value, window.layer.value, window.fileLocation.value]).toEqual([FILE_SECTION_ID, "user", null]);
        window.cancelLeave();
        expect([window.section.value, window.layer.value, window.fileLocation.value, window.unsaved.value]).toEqual([FILE_SECTION_ID, "user", null, true]);
        window.openFile("project", position);
        window.confirmLeave();
        expect([window.section.value, window.layer.value, window.unsaved.value]).toEqual([FILE_SECTION_ID, "project", false]);
        expect(window.fileLocation.value).toEqual({layer: "project", position});
    });

    it("未绑定作品时打开本作品层的设置文件：不切也不挂位置", async () => {
        const started = await start([contributor("x.notes", {"x.notes.main": list()}, toggle())], false);
        const {window} = windowFor(started.probe, false);
        window.openWindow({section: "nbook.appearance"});
        window.openFile("project", position);
        expect([window.section.value, window.layer.value, window.fileLocation.value]).toEqual(["nbook.appearance", "user", null]);
    });
});
