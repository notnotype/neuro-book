/**
 * 选项提供者（docs/specs/settings/settings-window.md“选项提供者”与输出 9）：贡献点 `settings.choices` 的登记校验，提供者
 * 的交付与入口状态换成的选项源，出错时的边界与按需激活。真实内核的浏览器实例装产品的 `nbook.settings` 浏览器定义，
 * 宿主能力 `window.plugins` 用产品的实现；一个同属 `nbook.settings` 的探针入口取设置窗口的数据来源（产品里是窗口入口）。
 */

import {afterEach, describe, expect, it} from "bun:test";

import {computed, ref, toValue} from "@vue/reactivity";

import type {OptionSource} from "@notnotype/nb-form";
import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {systemClock} from "@notnotype/nb-runtime/lifecycle";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";
import {Type} from "typebox";

import {createApplication} from "nbook/application";
import {definitionAt} from "nbook/manifest";
import {clockKey, windowConnectionKey, windowPluginsKey} from "nbook/shared/host";
import {windowProjectKey} from "nbook/shared/projects";
import {defineSetting} from "nbook/shared/settings";
import {testTextPort} from "nbook/shared/testing/text-port";
import {createWindowPlugins} from "nbook/web/host/window-plugins";

import {descriptor} from "../plugin";
import {SETTINGS_CHOICES_POINT, settingsChoicesEvent} from "../shared/contracts";
import {validateChoiceContribution} from "../shared/sections";
import type {SettingsChoicesImplementation} from "./contracts";
import {settingsBrowserCore} from "./plugin";
import {settingsCatalogs} from "./text";
import {settingsWindowSourceKey} from "./window-source";
import type {SettingsWindowSource} from "./window-source";

const silent = {error: () => undefined};
const started: Application[] = [];

afterEach(async () => {
    for (const application of started.splice(0)) expect((await application.stop()).status).toBe("closed");
});

const title = {"zh-CN": "模型", "en-US": "Model"};

interface Control {
    fail: boolean;
    context: ActivationContext | null;
    /** 交给每个提供者的实现；空对象用来验“交出的实现没有 source()”。 */
    implementation: SettingsChoicesImplementation | Readonly<Record<string, never>>;
}

function control(overrides: Partial<Control> = {}): Control {
    return {fail: false, context: null, implementation: {source: () => ({status: "ready", items: [{value: "a", label: "甲"}]})}, ...overrides};
}

/** 贡献选项提供者的测试插件：浏览器入口按开关失败，激活时把同一份实现交给它的每个提供者。 */
function provider(id: string, providers: ReadonlyArray<string>, toggle: Control, extra: Partial<PluginEntryDefinition> = {}, top: Partial<PluginDefinition> = {}): PluginDefinition {
    return {
        id,
        ...top,
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: providers.map((providerId) => ({capability: SETTINGS_CHOICES_POINT, id: providerId, declaration: {}})),
            activate: (context) => {
                if (toggle.fail) throw new Error("提供者入口按开关激活失败");
                toggle.context = context;
                return {contributions: {[SETTINGS_CHOICES_POINT]: Object.fromEntries(providers.map((providerId) => [providerId, toggle.implementation]))}};
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
    const identity = {location: "browser" as const, instanceId: "settings-choices"};
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

/** 读一个选项源当前的值：映射里是 computed，表单同样这样读。 */
function read(source: SettingsWindowSource, id: string): OptionSource | undefined {
    const entry = source.options()[id];
    return entry === undefined ? undefined : toValue(entry);
}

/** 窗口里的翻译端口（宿主引擎、严格模式）登记本插件目录：原因写目录里的键，按两种语言翻出来看用户读到的文字。 */
const ports = {"zh-CN": testTextPort("zh-CN", {[descriptor.id]: settingsCatalogs}), "en-US": testTextPort("en-US", {[descriptor.id]: settingsCatalogs})};

const reasonOf = (option: OptionSource | undefined): unknown => (option?.status === "unavailable" ? {"zh-CN": ports["zh-CN"].t(option.reason), "en-US": ports["en-US"].t(option.reason)} : null);
const messages = (diagnostics: DiagnosticsStore): string[] => diagnostics.query({}).records.filter((record) => record.event === "settings.choices").map((record) => record.message);

async function stopEntry(toggle: Control): Promise<void> {
    expect((await toggle.context?.scope.parent?.close())?.status).toBe("closed");
}

describe("选项提供者的登记校验", () => {
    it("id 规则同分区：nbook.* 写 nbook.<名>，其它插件以自己的插件 id 加点开头；声明没有字段；不合格的只拒这一条", async () => {
        const {application} = await start([
            provider("x.models", ["x.models.list", "other.list", "x.models.Upper"], control()),
            {...provider("x.extra", [], control()), entries: [{id: "browser", location: "browser", activationEvents: ["onStartup"], contributions: [{capability: SETTINGS_CHOICES_POINT, id: "x.extra.list", declaration: {label: "多余"}}], activate: () => ({contributions: {[SETTINGS_CHOICES_POINT]: {"x.extra.list": control().implementation}}})}]},
        ]);
        const validation = (id: string) => application.plugins.contribution(SETTINGS_CHOICES_POINT, id)[0]?.validation;
        expect(validation("x.models.list")).toEqual({status: "accepted"});
        expect(validation("other.list")).toMatchObject({status: "rejected", reason: "invalid-declaration", detail: "贡献 id 要以插件 id x.models 加“.”开头：other.list"});
        expect(validation("x.models.Upper")).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        expect(validation("x.extra.list")).toMatchObject({status: "rejected", reason: "invalid-declaration"});
        // 浏览器实例里装不进服务端入口，直接用拥有者的校验函数验。
        expect(validateChoiceContribution({capability: SETTINGS_CHOICES_POINT, id: "x.models.list", plugin: "x.models", entry: "server", location: "server", declaration: {}})).toBe(`${SETTINGS_CHOICES_POINT} only accepts contributions from browser entries`);
    });

    it("写在插件顶层（没有实现）为 implementation-required", async () => {
        const {application} = await start([{id: "x.top", contributions: [{capability: SETTINGS_CHOICES_POINT, id: "x.top.list", declaration: {}}], entries: []}]);
        expect(application.plugins.contribution(SETTINGS_CHOICES_POINT, "x.top.list")[0]?.validation).toMatchObject({status: "rejected", reason: "implementation-required"});
    });
});

describe("选项源", () => {
    it("提供者交付后给出它的选项，响应式地跟着变；配置项引用了没人提供的 id 时不可用", async () => {
        const models = ref<OptionSource<string>>({status: "loading"});
        const orphan = defineSetting({plugin: "x.use", name: "model", schema: Type.String(), default: "", title, choices: {from: "x.nobody.list"}});
        const {source} = await start([provider("x.models", ["x.models.list"], control({implementation: {source: () => models}})), {id: "x.use", contributions: [orphan.contribution], entries: []}]);
        expect(Object.keys(source.options()).sort()).toEqual(["x.models.list", "x.nobody.list"]);
        const option = computed(() => read(source, "x.models.list"));
        expect(option.value).toEqual({status: "loading"});
        models.value = {status: "ready", items: [{value: "deepseek/chat", label: "DeepSeek / chat"}]};
        expect(option.value).toEqual({status: "ready", items: [{value: "deepseek/chat", label: "DeepSeek / chat"}]});
        expect(reasonOf(read(source, "x.nobody.list"))).toEqual({"zh-CN": "无法加载选项：没有选项提供者 x.nobody.list", "en-US": "Can't load options: there is no option provider x.nobody.list"});
    });

    it("同一次交付只调一次 source()；映射对象在注册表的一生中不变", async () => {
        let calls = 0;
        const {source} = await start([provider("x.models", ["x.models.list"], control({implementation: {source: () => {
            calls += 1;
            return {status: "ready", items: []};
        }}}))]);
        const first = source.options();
        read(source, "x.models.list");
        read(source, "x.models.list");
        expect(calls).toBe(1);
        expect(source.options()).toBe(first);
    });

    it("入口受阻、激活失败时不可用并写原因；入口停止后不可用；重试后以新代次交付、重新取 source()", async () => {
        const missing = defineServiceKey<unknown>("x.models/missing");
        const failing = control({fail: true});
        let calls = 0;
        failing.implementation = {source: () => {
            calls += 1;
            return {status: "ready", items: [{value: String(calls), label: String(calls)}]};
        }};
        const {application, source} = await start([
            provider("x.blocked", ["x.blocked.list"], control(), {dependencies: [{key: missing}]}),
            provider("x.models", ["x.models.list"], failing),
        ]);
        expect(reasonOf(read(source, "x.blocked.list"))).toEqual({"zh-CN": "无法加载选项：missing-service: x.models/missing", "en-US": "Can't load options: missing-service: x.models/missing"});
        expect(reasonOf(read(source, "x.models.list"))).toEqual({"zh-CN": "无法加载选项：提供者入口按开关激活失败", "en-US": "Can't load options: 提供者入口按开关激活失败"});
        failing.fail = false;
        expect((await application.plugins.recover({plugin: "x.models", entry: "browser"})).status).toBe("reset");
        expect((await application.plugins.activate({plugin: "x.models", entry: "browser"})).status).toBe("activated");
        expect(read(source, "x.models.list")).toEqual({status: "ready", items: [{value: "1", label: "1"}]});
        await stopEntry(failing);
        expect(reasonOf(read(source, "x.models.list"))).toEqual({"zh-CN": "无法加载选项：插件 x.models 已停止", "en-US": "Can't load options: plugin x.models has stopped"});
    });

    it("source() 抛错、交出的实现没有 source()、给出的值后来抛错或形状不对：只让这个源不可用，同一个问题只记一次诊断", async () => {
        const broken = ref(false);
        const shape = ref<unknown>({status: "ready", items: [{value: "a", label: "甲"}]});
        const {source, diagnostics} = await start([
            provider("x.throws", ["x.throws.list"], control({implementation: {source: () => {
                throw new Error("连不上服务商");
            }}})),
            provider("x.empty", ["x.empty.list"], control({implementation: {}})),
            provider("x.later", ["x.later.list"], control({implementation: {source: () => () => {
                if (broken.value) throw new Error("模型列表坏了");
                return {status: "ready", items: []};
            }}})),
            provider("x.shape", ["x.shape.list"], control({implementation: {source: () => shape as never}})),
        ]);
        expect(reasonOf(read(source, "x.throws.list"))).toEqual({"zh-CN": "无法加载选项：连不上服务商", "en-US": "Can't load options: 连不上服务商"});
        expect(read(source, "x.empty.list")?.status).toBe("unavailable");
        const later = computed(() => read(source, "x.later.list"));
        expect(later.value).toEqual({status: "ready", items: []});
        broken.value = true;
        expect(reasonOf(later.value)).toEqual({"zh-CN": "无法加载选项：模型列表坏了", "en-US": "Can't load options: 模型列表坏了"});
        const shaped = computed(() => read(source, "x.shape.list"));
        expect(shaped.value?.status).toBe("ready");
        for (const bad of [{status: "done"}, {status: "ready", items: [{value: 1, label: "一"}]}, {status: "ready", items: [{value: "a"}]}, {status: "unavailable"}, null]) {
            shape.value = bad;
            expect(shaped.value?.status, JSON.stringify(bad)).toBe("unavailable");
        }
        read(source, "x.throws.list");
        expect(messages(diagnostics).filter((message) => message.startsWith("Choice provider x.throws.list"))).toEqual(["Choice provider x.throws.list failed: 连不上服务商"]);
        expect(messages(diagnostics)).toContain("Choice provider x.empty.list failed: the implementation has no source()");
        expect(messages(diagnostics)).toContain("Choice provider x.shape.list failed: item 1 value is not a string");
    });
});

describe("按需激活：要一个提供者的选项时触发 onSettingsChoices", () => {
    it("入口声明了这个提供者的事件：启动后不激活，第一次读它的选项时才激活并给出选项", async () => {
        const toggle = control();
        const {application, source} = await start([provider("x.models", ["x.models.list"], toggle, {activationEvents: [settingsChoicesEvent("x.models.list")]})]);
        expect(application.plugins.entryState({plugin: "x.models", entry: "browser"})?.status).toBe("registered");
        const option = computed(() => read(source, "x.models.list"));
        expect(option.value).toEqual({status: "loading"});
        await waitUntil("激活并交付", () => option.value?.status === "ready");
        expect(option.value).toEqual({status: "ready", items: [{value: "a", label: "甲"}]});
        expect(application.plugins.entryState({plugin: "x.models", entry: "browser"})?.generation).toBe(1);
    });

    it("入口没声明这个事件：不触发、不激活，不可用并写原因，记一条诊断", async () => {
        const {application, source, diagnostics} = await start([provider("x.models", ["x.models.list"], control(), {activationEvents: []})]);
        const option = computed(() => read(source, "x.models.list"));
        expect(option.value).toEqual({status: "loading"});
        await waitUntil("判定不能按需激活", () => option.value?.status === "unavailable");
        expect(reasonOf(option.value)).toEqual({"zh-CN": "无法加载选项：插件没有声明打开设置时提供选项：Entry x.models/browser does not declare onSettingsChoices:x.models.list", "en-US": "Can't load options: the plugin does not provide options when settings open: Entry x.models/browser does not declare onSettingsChoices:x.models.list"});
        expect(application.plugins.entryState({plugin: "x.models", entry: "browser"})?.status).toBe("registered");
        expect(messages(diagnostics)).toEqual(["Choice provider x.models.list cannot be activated on demand: Entry x.models/browser does not declare onSettingsChoices:x.models.list"]);
        // 之后入口经别的途径激活了：按交付给出选项。
        await application.plugins.activate({plugin: "x.models", entry: "browser"});
        expect(option.value?.status).toBe("ready");
    });
});
