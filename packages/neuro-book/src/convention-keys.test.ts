/**
 * 约定键（docs/specs/ui/i18n.md 的“约定键”，各贡献点 Spec 的“约定键”）：
 *
 * - 省略标题的命令与设置项，分别从内置代码、SDK 助手与手写清单进入真实运行实例，命令表与配置服务给出所属插件的约定键引用；
 * - 各贡献点补出的键与 Spec 的键表一致；
 * - 声明测试：全部内置插件的声明补出的键与显式写的键都在所属插件的源语言目录里，缺了由 `catalogKeyProblems` 报告。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {Type} from "typebox";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {developmentPlugins} from "nbook/development-manifest";
import {definitionAt, productPlugins, thirdPartyDefinitionAt} from "nbook/manifest";
import {manifestFormat} from "nbook/plugin-platform-profile";
import {pluginVersionSatisfies} from "nbook/plugin-platform/shared/versions";
import {commandServiceKey, COMMANDS_POINT, completeCommandDeclaration, completeMenuItemDeclaration} from "nbook/plugins/commands/shared/contracts";
import type {CommandService} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {completeEditorDeclaration, completeEditorPageDeclaration} from "nbook/plugins/editor/shared/contracts";
import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {completePageDeclaration, completeSectionDeclaration} from "nbook/plugins/settings/shared/sections";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {completeHomeDeclaration} from "nbook/plugins/workbench/shared/home";
import {activityBarItemsPoint, statusbarItemsPoint, titlebarItemsPoint} from "nbook/plugins/workbench/shared/items";
import {viewsPoint} from "nbook/plugins/workbench/shared/views";
import {projectPluginDefinitions} from "nbook/project/plugins";
import {command} from "nbook/sdk/command-helpers";
import {definePlugin} from "nbook/sdk/plugin";
import {setting} from "nbook/sdk/settings-helpers";
import {serverPluginDefinitions} from "nbook/server/plugins";
import {catalogKeyProblems} from "nbook/shared/convention-keys";
import type {PluginCatalogs} from "nbook/shared/convention-keys";
import {completeSettingDeclaration, defineSetting} from "nbook/shared/settings";
import type {SettingsService} from "nbook/shared/settings";
import {developmentBrowserPluginDefinitions} from "nbook/web/development-plugins";
import {browserPluginDefinitions, builtinPluginCatalogs} from "nbook/web/plugins";

import {counterBackendPlugin} from "../plugin-sdk/examples/plugins/counter/backend/plugin";
import counterZh from "../plugin-sdk/examples/plugins/counter/locales/zh-CN.json";
import {descriptor as counterDescriptor} from "../plugin-sdk/examples/plugins/counter/plugin";
import {focusBackendPlugin} from "../plugin-sdk/examples/plugins/focus/backend/plugin";
import focusZh from "../plugin-sdk/examples/plugins/focus/locales/zh-CN.json";
import {descriptor as focusDescriptor} from "../plugin-sdk/examples/plugins/focus/plugin";
import {focusBrowserPlugin} from "../plugin-sdk/examples/plugins/focus/web/plugin";
import snippetsZh from "../plugin-sdk/examples/plugins/snippets/locales/zh-CN.json";
import {descriptor as snippetsDescriptor} from "../plugin-sdk/examples/plugins/snippets/plugin";
import {snippetsBrowserPlugin} from "../plugin-sdk/examples/plugins/snippets/web/plugin";

const ref = (ns: string, key: string) => ({kind: "text", ns, key});

describe("约定键经真实运行实例进入消费表", () => {
    let tmp = "";

    beforeAll(async () => {
        tmp = await createTestTmpRoot("neuro-book-convention-keys", "约定键");
    });

    afterAll(async () => {
        if (tmp !== "") await rm(tmp, {recursive: true, force: true});
    });

    it("内置代码、SDK 助手与手写清单省略的标题：命令表与配置服务给出所属插件的约定键引用", async () => {
        const ARGS = Type.Object({}, {additionalProperties: false});
        const run = {run: () => ({ok: true as const, value: null})};

        // 内置代码的写法：直接写贡献与 defineSetting。
        const builtinSetting = defineSetting({plugin: "test.builtin", name: "quiet", schema: Type.Boolean(), default: false});
        const builtin: PluginDefinition = {
            id: "test.builtin",
            contributions: [builtinSetting.contribution],
            entries: [{
                id: "server",
                location: "server",
                activationEvents: ["onStartup"],
                contributions: [{capability: COMMANDS_POINT, id: "test.builtin.ping", declaration: {description: "ping", effect: "read", args: ARGS}}],
                activate: () => ({contributions: {[COMMANDS_POINT]: {"test.builtin.ping": run}}}),
            }],
        };

        // SDK 助手。
        const sdk = definePlugin({id: "acme.sdk", version: "1.0.0", locations: ["server"]});
        const say = command(sdk, {name: "say", description: "say", effect: "read"});
        const volume = setting(sdk, {name: "volume", schema: Type.Number(), default: 1});
        const sdkDefinition = definitionAt("server", sdk.descriptor([volume]), sdk.definition([sdk.entry({
            location: "server",
            activationEvents: ["onStartup"],
            contributions: {say},
            activate: () => ({contributions: {say: say.implement(() => ({ok: true, value: null}))}}),
        })]));

        // 手写清单：经 JSON 读进来，按清单登记；入口代码由装载器给出。
        const read = manifestFormat.read(JSON.parse(JSON.stringify({
            publisher: "example",
            name: "handwritten",
            version: "1.0.0",
            engines: {neurobook: ">=0.1.0"},
            entries: {server: {location: "server", main: "server.js", activationEvents: ["onStartup"], contributes: [{capability: COMMANDS_POINT, id: "example.handwritten.hello", declaration: {description: "hello", effect: "read", args: {type: "object", properties: {}, additionalProperties: false}}}]}},
            contributes: [{capability: "settings.properties", id: "example.handwritten/loud", declaration: {schema: {type: "boolean"}, default: false, layers: ["user"], applies: "now"}}],
        })));
        if (read.status !== "valid") throw new Error(JSON.stringify(read.problems));
        const handwritten = thirdPartyDefinitionAt("server", read.manifest, {load: async () => () => ({contributions: {[COMMANDS_POINT]: {"example.handwritten.hello": run}}})});

        // 观察者：拿到命令服务与配置服务。
        const seen: {commands: CommandService | null; settings: SettingsService | null} = {commands: null, settings: null};
        const probe: PluginDefinition = {
            id: "test.probe",
            entries: [{
                id: "server",
                location: "server",
                activationEvents: ["onStartup"],
                dependencies: [{key: commandServiceKey}, {key: settingsKey}],
                activate: (context) => {
                    seen.commands = context.services.require(commandServiceKey);
                    seen.settings = context.services.require(settingsKey);
                    return {};
                },
            }],
        };

        const identity = {location: "server" as const, instanceId: "convention-keys"};
        const silent = {error: () => undefined};
        const diagnostics = createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
        const settings = standaloneSettings("server", tmp);
        const application = createApplication(
            {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
            {capabilities: settings.capabilities, plugins: [diagnostics, statePlugin, ...settings.plugins, commandsPlugin, builtin, sdkDefinition, handwritten, probe], requiredPlugins: [commandsPlugin.id, "test.probe"], gates: [], satisfies: pluginVersionSatisfies},
        );
        try {
            expect((await application.startup).status).toBe("available");
            const titleOf = (id: string) => {
                const found = seen.commands!.get(id);
                return found.ok ? found.value.title : found.code;
            };
            expect([titleOf("test.builtin.ping"), titleOf("acme.sdk.say"), titleOf("example.handwritten.hello")]).toEqual([
                ref("test.builtin", "commands.ping.title"),
                ref("acme.sdk", "commands.say.title"),
                ref("example.handwritten", "commands.hello.title"),
            ]);
            const handwrittenSetting = defineSetting({plugin: "example.handwritten", name: "loud", schema: Type.Boolean(), default: false});
            expect([builtinSetting, volume, handwrittenSetting].map((item) => seen.settings!.declaration(item)?.title ?? null)).toEqual([
                ref("test.builtin", "settings.quiet.title"),
                ref("acme.sdk", "settings.volume.title"),
                ref("example.handwritten", "settings.loud.title"),
            ]);
            // 作者写下的定义保持原样：省略的标题只在接受的声明里。
            expect("title" in volume.declaration).toBe(false);
        } finally {
            await application.stop();
        }
    });
});

describe("各贡献点补出的键与 Spec 的键表一致", () => {
    const at = (plugin: string, id: string, declaration: unknown) => ({plugin, id, declaration});

    it("必填的文字字段补约定键；本地 id 去掉插件 id 前缀，设置项取 `/` 后的名；写了的文字只补命名空间", () => {
        const viewsComplete = viewsPoint.complete!;
        const cases: ReadonlyArray<readonly [string, unknown, unknown]> = [
            ["命令", completeCommandDeclaration(at("acme.x", "acme.x.say", {category: {kind: "text", key: "cat"}})), {title: ref("acme.x", "commands.say.title"), category: ref("acme.x", "cat")}],
            ["设置项与选项", completeSettingDeclaration(at("acme.x", "acme.x/mode", {choices: [{value: "a"}, {value: 2, title: "二"}]})), {title: ref("acme.x", "settings.mode.title"), choices: [{value: "a", title: ref("acme.x", "settings.mode.choices.a.title")}, {value: 2, title: "二"}]}],
            ["list 分区与小组", completeSectionDeclaration(at("acme.x", "acme.x.main", {groups: [{id: "basic"}]})), {title: ref("acme.x", "settingsSections.main.title"), groups: [{id: "basic", title: ref("acme.x", "settingsSections.main.groups.basic.title")}]}],
            ["page 分区", completePageDeclaration(at("acme.x", "acme.x.page", {})), {title: ref("acme.x", "settingsPages.page.title")}],
            ["视图与标题动作", viewsComplete({...at("acme.x", "acme.x.panel", {actions: [{command: "acme.x.refresh", icon: "i"}]}), entry: "browser", location: "browser", capability: viewsPoint.id}), {title: ref("acme.x", "views.panel.title"), actions: [{command: "acme.x.refresh", icon: "i", title: ref("acme.x", "views.panel.actions.acme.x.refresh.title")}]}],
            ["状态栏条目", statusbarItemsPoint.complete!({...at("acme.x", "acme.x.count", {}), entry: "browser", location: "browser", capability: statusbarItemsPoint.id}), {title: ref("acme.x", "statusItems.count.title")}],
            ["标题栏条目", titlebarItemsPoint.complete!({...at("acme.x", "acme.x.sync", {}), entry: "browser", location: "browser", capability: titlebarItemsPoint.id}), {title: ref("acme.x", "titlebarItems.sync.title")}],
            ["活动栏底部条目", activityBarItemsPoint.complete!({...at("acme.x", "acme.x.account", {}), entry: "browser", location: "browser", capability: activityBarItemsPoint.id}), {title: ref("acme.x", "activityItems.account.title")}],
            ["首页", completeHomeDeclaration(at("acme.x", "acme.x.home", {})), {title: ref("acme.x", "home.home.title")}],
            ["编辑区页面", completeEditorPageDeclaration(at("acme.x", "acme.x.welcome", {})), {title: ref("acme.x", "editorPages.welcome.title")}],
            ["编辑器", completeEditorDeclaration(at("acme.x", "acme.x.markdown", {})), {title: ref("acme.x", "editors.markdown.title")}],
            ["id 不以插件 id 开头时用完整 id", completeCommandDeclaration(at("acme.x", "other.say", {})), {title: ref("acme.x", "commands.other.say.title")}],
            ["菜单项只补命名空间", completeMenuItemDeclaration(at("acme.x", "acme.x.item", {command: "acme.x.say", title: {kind: "text", key: "menu.say"}})), {command: "acme.x.say", title: ref("acme.x", "menu.say")}],
        ];
        for (const [name, actual, expected] of cases) expect({name, actual}).toEqual({name, actual: expected});
    });

    it("显式写了别的命名空间的引用不改", () => {
        expect(completeCommandDeclaration(at("acme.x", "acme.x.say", {title: {kind: "text", ns: "nb-ui", key: "save"}}))).toEqual({title: ref("nb-ui", "save")});
    });
});

describe("声明测试", () => {
    /** 全部内置插件：产品与开发清单的各运行位置的定义表，加清单一级的声明式贡献（同 `command-args.test.ts`）。 */
    function builtinDefinitions(): PluginDefinition[] {
        const tables: ReadonlyArray<Readonly<Record<string, PluginDefinition>>> = [serverPluginDefinitions, projectPluginDefinitions, browserPluginDefinitions, developmentBrowserPluginDefinitions];
        const descriptors = [...productPlugins, ...developmentPlugins].map((descriptor): PluginDefinition => ({id: descriptor.id, entries: [], contributions: descriptor.contributions ?? []}));
        return [...tables.flatMap((table) => Object.values(table)), ...descriptors];
    }

    it("内置插件的声明补出的键与显式写的键都在所属插件的源语言目录里", () => {
        const definitions = builtinDefinitions();
        // 收集本身没有漏掉定义表：几个插件的贡献点都在。
        expect(definitions.flatMap((definition) => (definition.contributionPoints ?? []).map((point) => point.id))).toEqual(expect.arrayContaining([COMMANDS_POINT, "settings.properties", viewsPoint.id, statusbarItemsPoint.id]));
        expect(catalogKeyProblems(definitions, builtinPluginCatalogs)).toEqual([]);
    });

    it("带目录的示例插件：声明补出的键与显式写的键都在示例自己的源语言目录里", () => {
        // 示例按第三方插件写，目录随产物走、不在 builtinPluginCatalogs 里；贡献点的拥有者仍是内置插件。
        const catalog = (zhCN: unknown): PluginCatalogs => ({source: "zh-CN", catalogs: {"zh-CN": zhCN as PluginCatalogs["catalogs"][string]}});
        const examples: PluginDefinition[] = [counterBackendPlugin, focusBackendPlugin, focusBrowserPlugin, snippetsBrowserPlugin, ...[counterDescriptor, focusDescriptor, snippetsDescriptor].map((descriptor): PluginDefinition => ({id: descriptor.id, entries: [], contributions: descriptor.contributions ?? []}))];
        const catalogs = {...builtinPluginCatalogs, "example.counter": catalog(counterZh), "example.focus": catalog(focusZh), "example.snippets": catalog(snippetsZh)};
        expect(catalogKeyProblems([...builtinDefinitions(), ...examples], catalogs)).toEqual([]);
    });

    it("缺键、缺目录时逐条报告；复数键认 `_other`", () => {
        const owner = commandsPlugin;
        const plugin: PluginDefinition = {
            id: "test.texts",
            contributions: [defineSetting({plugin: "test.texts", name: "quiet", schema: Type.Boolean(), default: false}).contribution],
            entries: [{
                id: "server",
                location: "server",
                contributions: [
                    {capability: COMMANDS_POINT, id: "test.texts.ping", declaration: {description: "ping", effect: "read"}},
                    {capability: COMMANDS_POINT, id: "test.texts.count", declaration: {title: {kind: "text", key: "files"}, description: "count", effect: "read"}},
                ],
                activate: () => ({}),
            }],
        };
        const silent: PluginDefinition = {id: "test.silent", entries: [{id: "server", location: "server", contributions: [{capability: COMMANDS_POINT, id: "test.silent.go", declaration: {description: "go", effect: "read"}}], activate: () => ({})}]};
        const settingsOwner = Object.values(serverPluginDefinitions).find((definition) => (definition.contributionPoints ?? []).some((point) => point.id === "settings.properties"))!;
        const problems = catalogKeyProblems([owner, settingsOwner, plugin, silent], {"test.texts": {source: "zh-CN", catalogs: {"zh-CN": {commands: {ping: {title: "探测"}}, files_other: "{{count}} 个文件"}}}});
        expect(problems).toEqual([
            {capability: "settings.properties", contribution: "test.texts/quiet", ns: "test.texts", key: "settings.quiet.title", reason: "missing-key"},
            {capability: COMMANDS_POINT, contribution: "test.silent.go", ns: "test.silent", key: "commands.go.title", reason: "no-catalog"},
        ]);
    });
});
