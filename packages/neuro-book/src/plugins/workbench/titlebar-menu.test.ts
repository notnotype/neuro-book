/**
 * 标题栏菜单的贡献（docs/specs/ui/workbench-shell.md 外壳四输出 29，docs/specs/workbench/menus.md 输出 1、4、5 与“时序与寿命”）：
 * 真实内核的浏览器实例，装产品的公开状态、配置与命令系统；拥有者插件用产品的贡献点校验、`MenuItemRegistry` 与外壳的
 * `createShellChrome`。贡献方写法与产品插件相同：菜单项写在入口下、交空实现。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {computed, ref} from "@vue/reactivity";
import type {Ref} from "@vue/reactivity";
import {Type} from "typebox";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {COMMANDS_POINT, commandServiceKey, menuImplementations, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";

import {titlebarMenuPoint, WORKBENCH_TITLEBAR_MENU_POINT} from "./shared/menus";
import type {TitlebarMenuItemDeclaration} from "./shared/menus";
import {ActivityItemRegistry} from "./web/items/activity-items";
import {ItemRegistry} from "./web/items/registry";
import {createShellChrome} from "./web/titlebar/titlebar-source";
import type {ShellChrome} from "./web/titlebar/titlebar-source";
import {workbenchTestText} from "./testing/text";

const silent = {error: () => undefined};
let tmp = "";
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "titlebar-menu");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const title = (zh: string) => ({"zh-CN": zh, "en-US": zh});

/** 拥有者：与工作台的浏览器入口一样定义贡献点、建注册表与外壳的菜单来源。 */
function ownerPlugin(owner: {chrome: ShellChrome | null}): PluginDefinition {
    return {
        id: "test.owner",
        contributionPoints: [titlebarMenuPoint],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: commandServiceKey}, {key: publicStateKey}],
            receives: [WORKBENCH_TITLEBAR_MENU_POINT],
            activate: (context) => {
                const state = context.services.require(publicStateKey);
                const titlebarMenu = new MenuItemRegistry(context.declarations.list<TitlebarMenuItemDeclaration>(WORKBENCH_TITLEBAR_MENU_POINT), context.signal);
                const empty = (): ItemRegistry => new ItemRegistry([], state, () => undefined, context.signal);
                owner.chrome = createShellChrome({commands: context.services.require(commandServiceKey), state, statusItems: empty(), titleItems: empty(), activityItems: new ActivityItemRegistry([], state, context.signal), titlebarMenu, viewTitle: new MenuItemRegistry([], context.signal), platform: "other", signal: context.signal});
                return {receivers: {[WORKBENCH_TITLEBAR_MENU_POINT]: titlebarMenu.receiver()}};
            },
        }],
    };
}

const testState = definePublicState("test.menu", {
    on: {type: "boolean", unready: false},
    ready: {type: "boolean", unready: false, reason: title("还没准备好")},
});

const COMMAND: CommandDeclaration = {title: title("命令"), description: "test", args: Type.Object({part: Type.Optional(Type.String())}, {additionalProperties: false}), effect: "read"};

interface Control {
    context: ActivationContext | null;
    readonly on: Ref<boolean>;
    readonly ready: Ref<boolean>;
}

const control = (): Control => ({context: null, on: ref(false), ready: ref(false)});

/** 提供命令的插件（`test.menu.*` 四条命令与两个公开键），可以顺带贡献菜单项。 */
function commandPlugin(items: ReadonlyArray<{readonly id: string; readonly declaration: TitlebarMenuItemDeclaration}>, state: Control): PluginDefinition {
    const ids = ["test.menu.open", "test.menu.save", "test.menu.toggle", "test.menu.later"];
    return {
        id: "test.menu",
        entries: [{
            id: "main",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [
                ...ids.map((id) => ({capability: COMMANDS_POINT, id, declaration: id === "test.menu.later" ? {...COMMAND, title: title(id), when: {requires: ["test.menu/ready"]}} : {...COMMAND, title: title(id)}})),
                ...testState.contributions,
                ...items.map(({id, declaration}) => ({capability: WORKBENCH_TITLEBAR_MENU_POINT, id, declaration})),
            ],
            activate: (context) => {
                state.context = context;
                return {contributions: {
                    [COMMANDS_POINT]: Object.fromEntries(ids.map((id) => [id, {run: () => ({ok: true, value: null})}])),
                    [PUBLIC_STATE_POINT]: Object.fromEntries(bindingsOf(testState, {on: state.on, ready: state.ready}).bindings),
                    [WORKBENCH_TITLEBAR_MENU_POINT]: menuImplementations(items),
                }};
            },
        }],
    };
}

/** 只贡献菜单项、不提供命令的插件：引用别的插件的命令。 */
function menuOnlyPlugin(id: string, items: ReadonlyArray<{readonly id: string; readonly declaration: TitlebarMenuItemDeclaration}>, state: Control, location: "browser" | "server" = "browser"): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location,
            activationEvents: ["onStartup"],
            contributions: items.map((item) => ({capability: WORKBENCH_TITLEBAR_MENU_POINT, id: item.id, declaration: item.declaration})),
            activate: (context) => {
                state.context = context;
                return {contributions: {[WORKBENCH_TITLEBAR_MENU_POINT]: menuImplementations(items)}};
            },
        }],
    };
}

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{application: Application; chrome: ShellChrome}> {
    const identity = {location: "browser" as const, instanceId: "titlebar-menu"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const settings = standaloneSettings("browser", tmp);
    const owner: {chrome: ShellChrome | null} = {chrome: null};
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: settings.capabilities, plugins: [diagnostics, statePlugin, ...settings.plugins, commandsPlugin, ownerPlugin(owner), ...plugins], requiredPlugins: [diagnostics.id, commandsPlugin.id, "test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    return {application, chrome: owner.chrome!};
}

const shape = (chrome: ShellChrome) => chrome.menus(workbenchTestText("zh-CN")).map((group) => [group.label, group.sections.map((section) => section.map((entry) => entry.id))]);

describe("标题栏菜单的贡献", () => {
    it("组按工作台定的顺序、空组不画；各插件的项按节名合进同一节；勾选与可用、固定参数照菜单项的共同规则", async () => {
        const state = control();
        const {chrome} = await start([
            commandPlugin([
                {id: "test.menu.item.save", declaration: {group: "file", section: "2_save", command: "test.menu.save"}},
                {id: "test.menu.item.toggle", declaration: {group: "view", section: "2_layout", order: 2, command: "test.menu.toggle", args: {part: "sidebar"}, toggled: "test.menu/on", label: title("侧栏")}},
                {id: "test.menu.item.later", declaration: {group: "view", section: "2_layout", order: 1, command: "test.menu.later"}},
            ], state),
            menuOnlyPlugin("test.extra", [
                {id: "test.extra.open", declaration: {group: "file", section: "1_open", command: "test.menu.open"}},
                {id: "test.extra.save-too", declaration: {group: "file", section: "2_save", order: 5, command: "test.menu.open"}},
            ], control()),
        ]);
        const menus = computed(() => chrome.menus(workbenchTestText("zh-CN")));
        expect(shape(chrome)).toEqual([
            ["文件", [["test.extra.open"], ["test.menu.item.save", "test.extra.save-too"]]],
            ["视图", [["test.menu.item.later", "test.menu.item.toggle"]]],
        ]);
        const view = () => menus.value.find((group) => group.id === "view")!.sections[0]!;
        expect(view().map((entry) => [entry.label, entry.enabled, entry.reason, entry.checked])).toEqual([["test.menu.later", false, "还没准备好", null], ["侧栏", true, null, false]]);
        expect(view()[1]!.args).toEqual({part: "sidebar"});
        state.ready.value = true;
        state.on.value = true;
        expect(view().map((entry) => [entry.enabled, entry.checked])).toEqual([[true, null], [true, true]]);
    });

    it("贡献撤回后它的菜单项不显示（经 computed 读也重算）；提供命令的入口停止，引用这条命令的别的插件的项也不显示", async () => {
        const commands = control();
        const extra = control();
        const {chrome} = await start([
            commandPlugin([{id: "test.menu.item.save", declaration: {group: "file", section: "2_save", command: "test.menu.save"}}], commands),
            menuOnlyPlugin("test.extra", [{id: "test.extra.open", declaration: {group: "file", section: "1_open", command: "test.menu.open"}}], extra),
            // 一直在线的贡献方：它的项引用 `test.menu` 的命令。
            menuOnlyPlugin("test.stay", [{id: "test.stay.open", declaration: {group: "help", section: "1", command: "test.menu.open"}}], control()),
        ]);
        // 界面经 computed 读：撤回送达时它重算（menus.md 的“时序与寿命”）。
        const shown = computed(() => shape(chrome));
        expect(shown.value).toEqual([["文件", [["test.extra.open"], ["test.menu.item.save"]]], ["帮助", [["test.stay.open"]]]]);
        // 入口开始停止时句柄先失去 published（不是响应式的）：重新求值已经看不到它，撤回稍后才到。
        const closingExtra = extra.context!.scope.parent!.close();
        expect(shape(chrome)).toEqual([["文件", [["test.menu.item.save"]]], ["帮助", [["test.stay.open"]]]]);
        expect((await closingExtra).status).toBe("closed");
        expect(shown.value).toEqual([["文件", [["test.menu.item.save"]]], ["帮助", [["test.stay.open"]]]]);
        // 提供命令的入口停止：它贡献的项不显示，还在线的 `test.stay` 引用它的命令的项也不显示。
        const closingCommands = commands.context!.scope.parent!.close();
        expect((await closingCommands).status).toBe("closed");
        expect(shown.value).toEqual([]);
    });

    it("只接受浏览器入口的贡献；id 在自己的命名空间里；组不认识、位置没有的字段都被拒", async () => {
        const {application, chrome} = await start([
            commandPlugin([], control()),
            menuOnlyPlugin("test.bad", [
                {id: "other.item", declaration: {group: "file", section: "1", command: "test.menu.open"}},
                {id: "test.bad.group", declaration: {group: "tools", section: "1", command: "test.menu.open"} as unknown as TitlebarMenuItemDeclaration},
                {id: "test.bad.extensions", declaration: {group: "file", section: "1", command: "test.menu.open", extensions: [".md"]}},
            ], control()),
            menuOnlyPlugin("test.server", [{id: "test.server.item", declaration: {group: "file", section: "1", command: "test.menu.open"}}], control(), "server"),
        ]);
        expect(chrome.menus(workbenchTestText("zh-CN"))).toEqual([]);
        const validation = (id: string) => application.plugins.contribution(WORKBENCH_TITLEBAR_MENU_POINT, id).map((entry) => entry.validation);
        expect(validation("other.item")[0]).toMatchObject({status: "rejected", detail: "贡献 id 要以插件 id test.bad 加“.”开头：other.item"});
        expect(validation("test.bad.group")[0]).toMatchObject({status: "rejected"});
        expect(validation("test.bad.extensions")[0]).toMatchObject({status: "rejected"});
        expect(validation("test.server.item")[0]).toMatchObject({status: "rejected", detail: `${WORKBENCH_TITLEBAR_MENU_POINT} 只接受浏览器入口的贡献`});
    });
});
