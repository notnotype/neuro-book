/**
 * 设置分区贡献点与分区注册表（docs/specs/settings/settings-window.md 输出 1–5），以及配置项界面字段的登记校验
 * （docs/specs/settings/configuration.md 输出 21）：真实内核的浏览器实例装产品的 `nbook.settings` 浏览器定义，
 * 宿主能力 `window.plugins` 用产品的实现接在插件观察者上。设置窗口在产品里是 `nbook.settings` 的另一个入口，这里
 * 用一个同样属于 `nbook.settings` 的探针入口取设置窗口的数据来源。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {computed} from "@vue/reactivity";
import {defineComponent} from "vue";
import type {Component} from "vue";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import {Type} from "typebox";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {clockKey, windowConnectionKey, windowPluginsKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {defineSetting, SETTINGS_POINT} from "nbook/shared/settings";
import {createWindowPlugins} from "nbook/web/host/window-plugins";

import {descriptor} from "../plugin";
import {SETTINGS_PAGES_POINT, SETTINGS_SECTIONS_POINT} from "../shared/contracts";
import type {SettingsPageDeclaration, SettingsSectionDeclaration} from "../shared/contracts";
import {validatePageContribution} from "../shared/sections";
import {settingsText} from "../shared/text";
import type {SettingsPageImplementation} from "./contracts";
import {settingsBrowserCore} from "./plugin";
import {settingsWindowSourceKey} from "./window-source";
import type {SettingsWindowSource} from "./window-source";

const silent = {error: () => undefined};
const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) expect((await application.stop()).status).toBe("closed");
});

const title = {"zh-CN": "分区", "en-US": "Section"};

/** 一个分区与它投向的贡献点；声明可以故意写错。 */
interface SectionSpec {
    readonly kind: "list" | "page";
    readonly declaration: unknown;
}

function page(overrides: Partial<SettingsPageDeclaration> | Record<string, unknown> = {}): SectionSpec {
    return {kind: "page", declaration: {title, icon: "i-lucide-square", category: "plugins", ...overrides}};
}

function list(overrides: Partial<SettingsSectionDeclaration> | Record<string, unknown> = {}): SectionSpec {
    return {kind: "list", declaration: {title, icon: "i-lucide-square", category: "plugins", ...overrides}};
}

interface Control {
    fail: boolean;
    context: ActivationContext | null;
    /** 空对象用来验“交出的实现没有 load()”。 */
    implementation: SettingsPageImplementation | Readonly<Record<string, never>>;
}

const Sample = defineComponent({name: "SamplePage", render: () => null});

function control(overrides: Partial<Control> = {}): Control {
    return {fail: false, context: null, implementation: {load: async () => Sample}, ...overrides};
}

/**
 * 贡献分区的测试插件，同产品的写法：list 分区是插件顶层的声明，page 分区是浏览器入口的贡献；入口按开关失败，激活时把
 * 同一份实现交给它的每个 page 分区。
 */
function contributor(id: string, sections: Readonly<Record<string, SectionSpec>>, toggle: Control, extra: Partial<PluginEntryDefinition> = {}, top: Partial<PluginDefinition> = {}): PluginDefinition {
    const all = Object.entries(sections);
    const pages = all.filter(([, spec]) => spec.kind === "page");
    return {
        id,
        ...top,
        contributions: [
            ...all.filter(([, spec]) => spec.kind === "list").map(([section, spec]) => ({capability: SETTINGS_SECTIONS_POINT, id: section, declaration: spec.declaration})),
            ...(top.contributions ?? []),
        ],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: pages.map(([section, spec]) => ({capability: SETTINGS_PAGES_POINT, id: section, declaration: spec.declaration})),
            activate: (context) => {
                if (toggle.fail) throw new Error("样例入口按开关激活失败");
                toggle.context = context;
                return {contributions: {[SETTINGS_PAGES_POINT]: Object.fromEntries(pages.map(([section]) => [section, toggle.implementation]))}};
            },
            ...extra,
        }],
    };
}

interface Started {
    readonly application: Application;
    readonly source: SettingsWindowSource;
    readonly diagnostics: DiagnosticsStore;
}

/** 浏览器实例：产品的 `nbook.settings` 浏览器定义，另加一个同属 `nbook.settings` 的探针入口（产品里是设置窗口的入口）。 */
async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<Started> {
    let source: SettingsWindowSource | null = null;
    const probe = defineEntry({
        id: "test-window",
        location: "browser",
        activationEvents: ["onStartup"],
        dependencies: [{key: settingsWindowSourceKey}],
        activate: (context) => {
            source = context.services.require(settingsWindowSourceKey);
            return {};
        },
    });
    const settings = definitionAt("browser", descriptor, {...settingsBrowserCore, entries: [...settingsBrowserCore.entries, probe]});
    const identity = {location: "browser" as const, instanceId: "settings-sections"};
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
                {id: "window.project", key: windowProjectKey, create: () => ({project: null})},
                {id: "window.plugins", key: windowPluginsKey, create: () => feed.capability},
            ],
            plugins: [createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}), settings, ...plugins],
            gates: [],
            observers: {plugins: feed},
        },
    );
    started.push(application);
    await application.startup;
    if (source === null) throw new Error("探针入口没有拿到设置窗口的数据来源");
    return {application, source, diagnostics: store};
}

function validation(application: Application, capability: string, id: string): unknown {
    return application.plugins.contribution(capability, id)[0]?.validation;
}

/** 入口关闭自己这一代的激活作用域：内核里入口正常停止的真实路径，交付项以 `scope-closed` 撤回。 */
async function stopEntry(toggle: Control): Promise<void> {
    expect((await toggle.context?.scope.parent?.close())?.status).toBe("closed");
}

describe("分区的登记校验", () => {
    it("id 规则同视图（内核按 idPrefix 核对）：nbook.* 写 nbook.<名>，其它插件以自己的插件 id 加点开头；两个贡献点相同；不合格的只拒这一条", async () => {
        const {application, source} = await start([
            contributor("x.notes", {"x.notes.main": page(), "other.page": page(), "x.notes": page(), "x.notes.Upper": page(), [`x.notes.${"a".repeat(121)}`]: page(), "x.notes.list": list(), "other.list": list()}, control()),
            contributor("nbook.extra", {"nbook.extra-page": page(), "x.notes.stolen": page()}, control()),
        ]);
        expect(validation(application, SETTINGS_PAGES_POINT, "x.notes.main")).toEqual({status: "accepted"});
        expect(validation(application, SETTINGS_PAGES_POINT, "nbook.extra-page")).toEqual({status: "accepted"});
        expect(validation(application, SETTINGS_SECTIONS_POINT, "x.notes.list")).toEqual({status: "accepted"});
        expect(validation(application, SETTINGS_PAGES_POINT, "other.page")).toMatchObject({status: "rejected", reason: "invalid-declaration", detail: "贡献 id 要以插件 id x.notes 加“.”开头：other.page"});
        expect(validation(application, SETTINGS_SECTIONS_POINT, "other.list")).toMatchObject({status: "rejected", reason: "invalid-declaration", detail: "贡献 id 要以插件 id x.notes 加“.”开头：other.list"});
        expect(validation(application, SETTINGS_PAGES_POINT, "x.notes.stolen")).toMatchObject({status: "rejected", detail: "贡献 id 要以 nbook. 开头：x.notes.stolen"});
        for (const id of ["x.notes", "x.notes.Upper", `x.notes.${"a".repeat(121)}`]) expect(validation(application, SETTINGS_PAGES_POINT, id), id).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        // 被拒的分区不进目录；入口照常激活，接受的分区照常交付。
        expect(source.sections().map((section) => section.id)).toEqual(["nbook.appearance", "nbook.extra-page", "x.notes.list", "x.notes.main"]);
        expect(source.delivery("x.notes.main")).toEqual({kind: "available"});
    });

    it("字段：groups 只给 list，layout、layers 与 keywords 只给 page；keywords 至多 20 个、每个都是合法文字（语言标签合法）；小组 id 合规且不重复，layers 非空不重复；已删除的 kind 是未知字段", async () => {
        const groups = [{id: "ui", title}, {id: "more-ui", title}];
        const cases: Readonly<Record<string, SectionSpec>> = {
            "x.combo.list-ok": list({groups}),
            "x.combo.page-ok": page({layout: "fill", layers: ["user"]}),
            "x.combo.list-layout": list({layout: "column"}),
            "x.combo.list-layers": list({layers: ["user"]}),
            "x.combo.page-groups": page({groups}),
            "x.combo.bad-group": list({groups: [{id: "UI", title}]}),
            "x.combo.dup-group": list({groups: [{id: "ui", title}, {id: "ui", title}]}),
            "x.combo.empty-layers": page({layers: []}),
            "x.combo.dup-layers": page({layers: ["user", "user"]}),
            "x.combo.list-kind": list({kind: "list"}),
            "x.combo.page-kind": page({kind: "page"}),
            "x.combo.bad-category": page({category: "editor"}),
            "x.combo.no-icon": page({icon: " "}),
            "x.combo.order": list({order: 2_000_000}),
            "x.combo.extra": page({minimumWidth: 600}),
            "x.combo.title": list({title: {"not a tag": "标题"}}),
            "x.combo.title-single": list({title: {"zh-CN": "只有中文"}}),
            "x.combo.keywords-ok": page({keywords: Array.from({length: 20}, () => title)}),
            "x.combo.keywords-many": page({keywords: Array.from({length: 21}, () => title)}),
            "x.combo.keywords-lang": page({keywords: [{"not a tag": "密钥"}]}),
            "x.combo.list-keywords": list({keywords: [title]}),
        };
        const {application} = await start([contributor("x.combo", cases, control())]);
        const pointOf = (id: string) => (cases[id]!.kind === "list" ? SETTINGS_SECTIONS_POINT : SETTINGS_PAGES_POINT);
        expect(validation(application, SETTINGS_SECTIONS_POINT, "x.combo.list-ok")).toEqual({status: "accepted"});
        expect(validation(application, SETTINGS_PAGES_POINT, "x.combo.page-ok")).toEqual({status: "accepted"});
        expect(validation(application, SETTINGS_PAGES_POINT, "x.combo.keywords-ok")).toEqual({status: "accepted"});
        // 改为接受：单语言与纯字符串标题合法（ui/i18n.md 输出 1）。
        expect(validation(application, SETTINGS_SECTIONS_POINT, "x.combo.title-single")).toEqual({status: "accepted"});
        for (const id of Object.keys(cases).filter((id) => !id.endsWith("-ok") && !id.endsWith("-single"))) {
            expect(validation(application, pointOf(id), id), id).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        }
        expect(application.plugins.entryState({plugin: "x.combo", entry: "browser"})?.status).toBe("available");
    });

    it("写错位置：list 写在入口下为 implementation-not-accepted，page 写在顶层为 implementation-required，page 不在浏览器入口被拒", async () => {
        const {application, source} = await start([{
            id: "x.top",
            contributions: [{capability: SETTINGS_PAGES_POINT, id: "x.top.page", declaration: page().declaration}],
            entries: [{id: "browser", location: "browser", contributions: [{capability: SETTINGS_SECTIONS_POINT, id: "x.top.list", declaration: list().declaration}], activate: () => ({})}],
        }]);
        expect(validation(application, SETTINGS_SECTIONS_POINT, "x.top.list")).toMatchObject({status: "rejected", reason: "implementation-not-accepted"});
        expect(validation(application, SETTINGS_PAGES_POINT, "x.top.page")).toMatchObject({status: "rejected", reason: "implementation-required"});
        expect(source.sections().map((section) => section.id)).toEqual(["nbook.appearance"]);
        // 浏览器实例里装不进服务端入口，直接用拥有者的校验函数验。
        expect(validatePageContribution({capability: SETTINGS_PAGES_POINT, id: "x.top.page", plugin: "x.top", entry: "server", location: "server", declaration: page().declaration})).toBe(`${SETTINGS_PAGES_POINT} only accepts contributions from browser entries`);
    });

    it("同一 id 出现在两个贡献点上：两者都不进目录，记一条诊断，指向它的配置项归入“其它”", async () => {
        const pointed = defineSetting({plugin: "x.twin", name: "flag", schema: Type.Boolean(), default: false, title, section: "x.twin.main"});
        const twin: PluginDefinition = {
            ...contributor("x.twin", {"x.twin.main": page()}, control()),
            contributions: [pointed.contribution, {capability: SETTINGS_SECTIONS_POINT, id: "x.twin.main", declaration: list().declaration}],
        };
        const {application, source, diagnostics} = await start([twin]);
        expect(validation(application, SETTINGS_SECTIONS_POINT, "x.twin.main")).toEqual({status: "accepted"});
        expect(validation(application, SETTINGS_PAGES_POINT, "x.twin.main")).toEqual({status: "accepted"});
        expect(source.sections().map((section) => section.id)).toEqual(["nbook.appearance"]);
        expect(diagnostics.query({}).records.filter((record) => record.event === "settings.sections").map((record) => record.message)).toEqual(["Section id x.twin.main appears on both the list and page contribution points; neither is shown"]);
        expect(await source.load("x.twin.main")).toEqual({status: "stale"});
    });
});

describe("分区目录与交付状态", () => {
    it("外观分区由 nbook.settings 贡献：list，app 组，小组“界面”与“语言”；list 分区只靠声明，入口没激活也可用", async () => {
        const lazy = contributor("x.lazy", {"x.lazy.list": list(), "x.lazy.page": page()}, control(), {activationEvents: []});
        const {source} = await start([lazy]);
        expect(source.sections().find((section) => section.id === "nbook.appearance")).toEqual({
            id: "nbook.appearance",
            plugin: "nbook.settings",
            kind: "list",
            declaration: {
                // 标题没写，登记时补成约定键；描述是可选字段，写了的就是它自己。
                title: settingsText("settingsSections.nbook.appearance.title"),
                description: settingsText("settingsSections.nbook.appearance.description"),
                icon: "i-lucide-palette",
                category: "app",
                order: 10,
                groups: [
                    {id: "ui", title: settingsText("settingsSections.nbook.appearance.groups.ui.title")},
                    {id: "language", title: settingsText("settingsSections.nbook.appearance.groups.language.title")},
                ],
            },
        });
        expect(source.delivery("nbook.appearance")).toEqual({kind: "available"});
        expect(source.delivery("x.lazy.list")).toEqual({kind: "available"});
        // page 分区没有交付实现：声明在目录里，呈现为 declared，加载作废。
        expect(source.delivery("x.lazy.page")).toEqual({kind: "declared"});
        expect(await source.load("x.lazy.page")).toEqual({status: "stale"});
    });

    it("page 交付后可用，每次加载经句柄取实现；入口停止后撤回，之后的加载作废", async () => {
        let loads = 0;
        const toggle = control({implementation: {load: async () => {
            loads += 1;
            return Sample;
        }}});
        const {source} = await start([contributor("x.page", {"x.page.main": page()}, toggle)]);
        const delivery = computed(() => source.delivery("x.page.main"));
        expect(delivery.value).toEqual({kind: "available"});
        expect(await source.load("x.page.main")).toEqual({status: "loaded", component: Sample});
        expect(await source.load("x.page.main")).toEqual({status: "loaded", component: Sample});
        expect(loads).toBe(2);
        await stopEntry(toggle);
        expect(delivery.value).toEqual({kind: "entry-stopped", reason: "scope-closed"});
        expect(await source.load("x.page.main")).toEqual({status: "stale"});
    });

    it("加载进行中入口停止：结果回来时句柄已撤回，结果作废而不是加载失败", async () => {
        let release: (component: Component) => void = () => undefined;
        let loading = false;
        const toggle = control({implementation: {load: () => new Promise<Component>((resolve) => {
            loading = true;
            release = resolve;
        })}});
        const {source} = await start([contributor("x.page", {"x.page.main": page()}, toggle)]);
        const pending = source.load("x.page.main");
        expect(loading).toBe(true);
        await stopEntry(toggle);
        release(Sample);
        expect(await pending).toEqual({status: "stale"});
    });

    it("page 交出的实现没有 load()：仍算交付，记一条诊断，加载按失败处理；load() 抛错同样是失败", async () => {
        const {source, diagnostics} = await start([
            contributor("x.empty", {"x.empty.page": page()}, control({implementation: {}})),
            contributor("x.broken", {"x.broken.page": page()}, control({implementation: {load: async () => {
                throw new Error("组件模块加载失败");
            }}})),
        ]);
        expect(source.delivery("x.empty.page")).toEqual({kind: "available"});
        const empty = await source.load("x.empty.page");
        expect(empty.status === "failed" && (empty.error as Error).message).toBe("Page section x.empty.page has an implementation without load()");
        expect(diagnostics.query({}).records.filter((record) => record.event === "settings.sections").map((record) => record.message)).toEqual(["Page section x.empty.page has an implementation without load(); opening it shows a load failure"]);
        const broken = await source.load("x.broken.page");
        expect(broken.status === "failed" && (broken.error as Error).message).toBe("组件模块加载失败");
    });

    it("入口激活失败：原位给出原因；消除原因后重试，以新代次交付", async () => {
        const toggle = control({fail: true});
        const {application, source} = await start([contributor("x.page", {"x.page.main": page()}, toggle, {activationEvents: []})]);
        const delivery = computed(() => source.delivery("x.page.main"));
        expect(delivery.value).toEqual({kind: "declared"});
        expect((await application.plugins.activate({plugin: "x.page", entry: "browser"})).status).toBe("failed");
        expect(delivery.value).toEqual({kind: "entry-failed", reason: "样例入口按开关激活失败"});
        toggle.fail = false;
        expect(await source.retry("x.page.main")).toEqual({status: "activated"});
        expect(delivery.value).toEqual({kind: "available"});
        expect(application.plugins.entryState({plugin: "x.page", entry: "browser"})?.generation).toBe(2);
        expect(await source.retry("nope.section")).toEqual({status: "failed", reason: "Section nope.section is not registered"});
    });

    it("入口受阻：原位给出原因，没有重试", async () => {
        const missing = defineServiceKey<unknown>("x.page/missing");
        const {source} = await start([contributor("x.page", {"x.page.main": page()}, control(), {dependencies: [{key: missing}]})]);
        expect(source.delivery("x.page.main").kind).toBe("entry-blocked");
        expect(await source.retry("x.page.main")).toEqual({status: "not-failed"});
    });
});

describe("设置窗口的数据来源只给 nbook.settings 自己", () => {
    it("别的插件解析它以初始化失败结束；nbook.settings 的入口照常拿到", async () => {
        const seen: {outcome: string | null} = {outcome: null};
        const foreign: PluginDefinition = {
            id: "x.spy",
            entries: [{
                id: "browser",
                location: "browser",
                activationEvents: ["onStartup"],
                dependencies: [{key: settingsWindowSourceKey, required: false}],
                activate: async (context) => {
                    seen.outcome = (await context.services.resolve(settingsWindowSourceKey)).status;
                    return {};
                },
            }],
        };
        const {source} = await start([foreign]);
        expect(seen.outcome).toBe("unavailable");
        expect(source.sections().length).toBeGreaterThan(0);
    });
});

describe("配置项界面字段的登记校验（configuration.md 输出 21）", () => {
    it("不合格的 section、group、order、choices、applies 与已删除的 restart 各只拒这一条，同插件的其它配置项与分区照常", async () => {
        const theme = Type.Union([Type.Literal("a"), Type.Literal("b")]);
        const good = defineSetting({plugin: "x.ui", name: "good", schema: theme, default: "a", title, section: "x.ui.main", group: "look", order: 1, choices: [{value: "a", title}, {value: "b", title}], applies: "next-session"});
        const raw = (name: string, overrides: Record<string, unknown>) => ({capability: SETTINGS_POINT, id: `x.ui/${name}`, declaration: {...good.declaration, ...overrides}});
        const bad = [
            raw("badSection", {section: "Main"}),
            raw("badGroup", {group: "Look"}),
            raw("orphanGroup", {section: undefined}),
            raw("badOrder", {order: Number.POSITIVE_INFINITY}),
            raw("missingChoice", {choices: [{value: "a", title}]}),
            raw("extraChoice", {choices: [{value: "a", title}, {value: "b", title}, {value: "c", title}]}),
            raw("wrongChoice", {choices: [{value: "a", title}, {value: "B", title}]}),
            raw("notLiteral", {schema: Type.String(), choices: [{value: "a", title}]}),
            raw("badApplies", {applies: "later"}),
            raw("restart", {restart: true}),
        ];
        const {application} = await start([contributor("x.ui", {"x.ui.main": list({groups: [{id: "look", title}]})}, control(), {}, {contributions: [good.contribution, ...bad]})]);
        expect(validation(application, SETTINGS_POINT, good.key)).toEqual({status: "accepted"});
        expect(validation(application, SETTINGS_SECTIONS_POINT, "x.ui.main")).toEqual({status: "accepted"});
        for (const contribution of bad) {
            expect(validation(application, SETTINGS_POINT, contribution.id), contribution.id).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        }
        expect(validation(application, SETTINGS_POINT, "x.ui/restart")).toMatchObject({detail: "配置项 x.ui/restart 的声明有未知字段：restart"});
        expect(application.plugins.entryState({plugin: "x.ui", entry: "browser"})?.status).toBe("available");
    });

    it("指向不存在的分区或小组不在登记时核对：配置项照常被接受", async () => {
        const orphan = defineSetting({plugin: "x.ui", name: "orphan", schema: Type.Boolean(), default: false, title, section: "x.ui.nowhere", group: "nothing"});
        const {application} = await start([{id: "x.ui", contributions: [orphan.contribution], entries: [{id: "browser", location: "browser", activate: () => ({})}]}]);
        expect(validation(application, SETTINGS_POINT, orphan.key)).toEqual({status: "accepted"});
    });
});
