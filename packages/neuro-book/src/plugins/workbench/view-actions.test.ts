/**
 * 视图标题动作（docs/specs/workbench/views.md 输出 10、11）经外壳的 chrome 求值与执行：真实内核的浏览器实例装上命令系统与
 * 公开状态，拥有者插件定义 `workbench.view-title`。可用与否、不可用的原因跟着命令自己的 `when`，按下态跟着 `toggled`
 * 的公开键；执行时要实例的带上被点的视图实例，其余是 `{}` 或固定参数；视图实例还没建立时，要实例的动作不可用、点了不执行。
 * 视图自己的动作在前、别的插件贡献的在后，按钮至多 8 个、多出的收进“⋯”，动作按稳定的 key 执行。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {ref} from "@vue/reactivity";
import {Type} from "typebox";

import {createConsoleExporterFactory, createConsoleFallback} from "@notnotype/nb-host/web";
import type {Application} from "@notnotype/nb-runtime/application";
import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createApplication} from "nbook/application";
import {COMMANDS_POINT, commandServiceKey, menuImplementations, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";

import {validateViewTitleItem, WORKBENCH_VIEW_TITLE_POINT} from "./shared/menus";
import type {ViewTitleItemDeclaration} from "./shared/menus";
import type {ViewAction} from "./shared/views";
import {ActivityItemRegistry} from "./web/items/activity-items";
import {ItemRegistry} from "./web/items/registry";
import {createShellChrome} from "./web/titlebar/titlebar-source";
import type {ShellChrome} from "./web/titlebar/titlebar-source";
import {workbenchTestText} from "./testing/text";

const silent = {error: () => undefined};
let tmp = "";
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "view-actions");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const ACT: ViewAction = {command: "example.flags.act", icon: "i-act", title: {"zh-CN": "动作", "en-US": "Act"}, args: "instance"};
const TOGGLE: ViewAction = {command: "example.flags.toggle", icon: "i-toggle", title: {"zh-CN": "开关", "en-US": "Toggle"}, toggled: "example.flags/on"};

/** 声明两个公开键、贡献两条命令的测试插件；命令收到的参数记进 `calls`。 */
function example(enabled: ReturnType<typeof ref<boolean>>, on: ReturnType<typeof ref<boolean>>, calls: unknown[]): PluginDefinition {
    const record = {run: (args: unknown) => {
        calls.push(args);
        return {ok: true as const, value: null};
    }};
    const declaration = (when?: string) => ({
        title: {"zh-CN": "例子", "en-US": "Example"},
        description: "example",
        args: Type.Object({viewId: Type.Optional(Type.String()), generation: Type.Optional(Type.Integer())}, {additionalProperties: false}),
        effect: "read" as const,
        ...(when === undefined ? {} : {when: {requires: [when]}}),
    });
    return {
        id: "example.flags",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: [
                {capability: PUBLIC_STATE_POINT, id: "example.flags/enabled", declaration: {type: "boolean", unready: false, reason: {"zh-CN": "现在不能做", "en-US": "Not now"}}},
                {capability: PUBLIC_STATE_POINT, id: "example.flags/on", declaration: {type: "boolean", unready: false}},
                {capability: COMMANDS_POINT, id: ACT.command, declaration: declaration("example.flags/enabled")},
                {capability: COMMANDS_POINT, id: TOGGLE.command, declaration: declaration()},
            ],
            activate: () => ({contributions: {
                [PUBLIC_STATE_POINT]: {"example.flags/enabled": {kind: "bound", read: () => enabled.value}, "example.flags/on": {kind: "bound", read: () => on.value}},
                [COMMANDS_POINT]: {[ACT.command]: record, [TOGGLE.command]: record},
            }}),
        }],
    };
}

/** 别的插件（`example.more`）给 `example.view` 贡献的标题动作；命令仍由 `example.flags` 提供。 */
function more(items: ReadonlyArray<{readonly id: string; readonly declaration: ViewTitleItemDeclaration}>): PluginDefinition {
    return {
        id: "example.more",
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            contributions: items.map(({id, declaration}) => ({capability: WORKBENCH_VIEW_TITLE_POINT, id, declaration})),
            activate: () => ({contributions: {[WORKBENCH_VIEW_TITLE_POINT]: menuImplementations(items)}}),
        }],
    };
}

/** 拥有者：与工作台的浏览器入口一样定义 `workbench.view-title`、建注册表与外壳的 chrome。 */
async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<ShellChrome> {
    const identity = {location: "browser", instanceId: "view-actions"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const settings = standaloneSettings("browser", tmp);
    const owner: {chrome: ShellChrome | null} = {chrome: null};
    const consumer: PluginDefinition = {
        id: "example.owner",
        contributionPoints: [{id: WORKBENCH_VIEW_TITLE_POINT, implementation: "required", validate: validateViewTitleItem}],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: commandServiceKey}, {key: publicStateKey}],
            receives: [WORKBENCH_VIEW_TITLE_POINT],
            activate: (context) => {
                const commands = context.services.require(commandServiceKey);
                const state = context.services.require(publicStateKey);
                const signal = context.signal;
                const items = () => new ItemRegistry([], state, () => undefined, signal);
                const viewTitle = new MenuItemRegistry(context.declarations.list<ViewTitleItemDeclaration>(WORKBENCH_VIEW_TITLE_POINT), signal);
                owner.chrome = createShellChrome({commands, state, statusItems: items(), titleItems: items(), activityItems: new ActivityItemRegistry([], state, signal), titlebarMenu: new MenuItemRegistry([], signal), viewTitle, platform: "other", signal});
                return {receivers: {[WORKBENCH_VIEW_TITLE_POINT]: viewTitle.receiver()}};
            },
        }],
    };
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: settings.capabilities, plugins: [diagnostics, statePlugin, ...settings.plugins, commandsPlugin, ...plugins, consumer], requiredPlugins: [diagnostics.id, commandsPlugin.id], gates: []},
    );
    started.push(application);
    expect((await application.startup).status).toBe("available");
    if (owner.chrome === null) throw new Error("没有拿到外壳的 chrome");
    return owner.chrome;
}

const VIEW = "example.view";
const keys = (entries: ReadonlyArray<{readonly key: string}>) => entries.map((entry) => entry.key);

describe("视图标题动作（views.md 输出 10）", () => {
    it("可用与否跟着命令的 when、不可用时带原因；按下态跟着 toggled 的公开键；执行时 instance 动作带上视图实例，其余是 {}", async () => {
        const enabled = ref(false);
        const on = ref(false);
        const calls: unknown[] = [];
        const chrome = await start([example(enabled, on, calls)]);

        const instance = {viewId: VIEW, generation: 3};
        const buttons = (locale: "zh-CN" | "en-US", at: typeof instance | null) => chrome.viewActions(VIEW, [ACT, TOGGLE], workbenchTestText(locale), at).buttons;
        expect(buttons("zh-CN", instance).map((entry) => [entry.title, entry.disabledReason, entry.pressed])).toEqual([["动作", "现在不能做", undefined], ["开关", null, false]]);
        enabled.value = true;
        on.value = true;
        expect(buttons("en-US", instance).map((entry) => [entry.title, entry.disabledReason, entry.pressed])).toEqual([["Act", null, undefined], ["Toggle", null, true]]);

        chrome.runViewAction(VIEW, [ACT, TOGGLE], "own:0", instance);
        chrome.runViewAction(VIEW, [ACT, TOGGLE], "own:1", instance);
        await Promise.resolve();
        expect(calls).toEqual([{viewId: VIEW, generation: 3}, {}]);

        // 视图还在加载、实例没建立：要实例的动作不可用并说明，点了不执行；不要实例的照常。
        expect(buttons("zh-CN", null).map((entry) => [entry.title, entry.disabledReason])).toEqual([["动作", "视图还没加载好"], ["开关", null]]);
        chrome.runViewAction(VIEW, [ACT, TOGGLE], "own:0", null);
        chrome.runViewAction(VIEW, [ACT, TOGGLE], "own:1", null);
        await Promise.resolve();
        expect(calls).toEqual([{viewId: VIEW, generation: 3}, {}, {}]);
    });

    it("placement 为 menu 的动作进“⋯”，不占按钮；按 key 执行不受按钮与菜单分流的影响", async () => {
        const calls: unknown[] = [];
        const chrome = await start([example(ref(true), ref(false), calls)]);
        const actions: ViewAction[] = [{...TOGGLE, placement: "menu"}, ACT];
        const model = chrome.viewActions(VIEW, actions, workbenchTestText("zh-CN"), {viewId: VIEW, generation: 1});
        expect(keys(model.buttons)).toEqual(["own:1"]);
        expect(model.menu.map(keys)).toEqual([["own:0"]]);
        chrome.runViewAction(VIEW, actions, "own:0", {viewId: VIEW, generation: 1});
        await Promise.resolve();
        expect(calls).toEqual([{}]);
    });
});

describe("别的插件贡献的标题动作（views.md 输出 11）", () => {
    it("排在视图自己的动作之后：按钮在后，“⋯”里在视图自己的 menu 动作之后另起一节；只给声明的那个视图；context instance 收到实例、args 收到固定参数", async () => {
        const calls: unknown[] = [];
        const chrome = await start([example(ref(true), ref(false), calls), more([
            {id: "example.more.button", declaration: {view: VIEW, section: "1", command: TOGGLE.command, icon: "i-more", label: {"zh-CN": "贡献的按钮", "en-US": "Contributed"}}},
            {id: "example.more.menu", declaration: {view: VIEW, section: "1", command: ACT.command, placement: "menu", context: "instance"}},
            {id: "example.more.other-view", declaration: {view: "example.elsewhere", section: "1", command: ACT.command, icon: "i-x"}},
        ])]);
        const actions: ViewAction[] = [ACT, {...TOGGLE, placement: "menu"}];
        const model = chrome.viewActions(VIEW, actions, workbenchTestText("zh-CN"), {viewId: VIEW, generation: 2});
        expect(keys(model.buttons)).toEqual(["own:0", "example.more.button"]);
        expect(model.buttons[1]).toMatchObject({title: "贡献的按钮", icon: "i-more", command: TOGGLE.command});
        expect(model.menu.map(keys)).toEqual([["own:1"], ["example.more.menu"]]);
        expect(model.menu[1]![0]!.title).toBe("例子");
        chrome.runViewAction(VIEW, actions, "example.more.menu", {viewId: VIEW, generation: 2});
        chrome.runViewAction(VIEW, actions, "example.more.button", {viewId: VIEW, generation: 2});
        // 贡献给别的视图的项不在这个视图上执行。
        chrome.runViewAction(VIEW, actions, "example.more.other-view", {viewId: VIEW, generation: 2});
        await Promise.resolve();
        expect(calls).toEqual([{viewId: VIEW, generation: 2}, {}]);
        // 实例还没建立：要实例的贡献项禁用，点了不执行。
        expect(chrome.viewActions(VIEW, actions, workbenchTestText("zh-CN"), null).menu[1]![0]!.disabledReason).toBe("视图还没加载好");
    });

    it("按钮（自己的加贡献来的）至多 8 个，放不下的贡献按钮回到它所在的节、收进“⋯”", async () => {
        const chrome = await start([example(ref(true), ref(false), []), more(Array.from({length: 4}, (_, index) => ({id: `example.more.b${String(index)}`, declaration: {view: VIEW, section: "1", order: index, command: TOGGLE.command, icon: "i-more"}})))]);
        const own: ViewAction[] = Array.from({length: 6}, () => ACT);
        const model = chrome.viewActions(VIEW, own, workbenchTestText("zh-CN"), {viewId: VIEW, generation: 1});
        expect(keys(model.buttons)).toEqual(["own:0", "own:1", "own:2", "own:3", "own:4", "own:5", "example.more.b0", "example.more.b1"]);
        expect(model.menu.map(keys)).toEqual([["example.more.b2", "example.more.b3"]]);
    });
});
