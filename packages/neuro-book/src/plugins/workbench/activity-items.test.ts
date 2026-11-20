/**
 * 活动栏底部条目（docs/specs/ui/workbench-shell.md 输出 40，验收 43）：真实内核的浏览器实例，装产品的公开状态、配置与命令系统；
 * 拥有者插件用产品的贡献点校验、`ActivityItemRegistry` 与外壳的 `createShellChrome`（交给活动栏的条目、点了执行命令）。
 * 贡献方用公开状态声明切换键与 `when` 的键，用命令系统登记它执行的命令，都与产品插件的写法相同。
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
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {createApplication} from "nbook/application";
import {COMMANDS_POINT, commandServiceKey, MenuItemRegistry} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration} from "nbook/plugins/commands/shared/contracts";
import {commandsPlugin} from "nbook/plugins/commands/shared/plugin";
import {standaloneSettings} from "nbook/plugins/settings/testing/standalone";
import {PUBLIC_STATE_POINT, publicStateKey} from "nbook/plugins/state/shared/contracts";
import {statePlugin} from "nbook/plugins/state/shared/plugin";
import {bindingsOf, definePublicState} from "nbook/shared/store/public";

import {activityBarItemsPoint, WORKBENCH_ACTIVITYBAR_ITEMS_POINT} from "./shared/items";
import type {ActivityBarItemDeclaration} from "./shared/items";
import type {ActivityBarItemImplementation} from "./web/contracts";
import {ActivityItemRegistry} from "./web/items/activity-items";
import {ItemRegistry} from "./web/items/registry";
import {createShellChrome} from "./web/titlebar/titlebar-source";
import type {ShellChrome} from "./web/titlebar/titlebar-source";
import {textIn} from "nbook/shared/testing/text";

const silent = {error: () => undefined};
let tmp = "";
const started: Application[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "activitybar-items");
});

afterEach(async () => {
    for (const application of started.splice(0)) await application.stop();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const title = (zh: string) => ({"zh-CN": zh, "en-US": zh});
const NONE: ActivityBarItemImplementation = Object.freeze({});

interface Owner {
    chrome: ShellChrome | null;
}

/** 拥有者：与工作台的浏览器入口一样建注册表与外壳的条目来源；状态栏与标题栏的注册表是空的。 */
function ownerPlugin(owner: Owner): PluginDefinition {
    return {
        id: "test.owner",
        contributionPoints: [activityBarItemsPoint],
        entries: [{
            id: "browser",
            location: "browser",
            activationEvents: ["onStartup"],
            dependencies: [{key: commandServiceKey}, {key: publicStateKey}],
            receives: [WORKBENCH_ACTIVITYBAR_ITEMS_POINT],
            activate: (context) => {
                const state = context.services.require(publicStateKey);
                const activityItems = new ActivityItemRegistry(context.declarations.list<ActivityBarItemDeclaration>(WORKBENCH_ACTIVITYBAR_ITEMS_POINT), state, context.signal);
                const empty = (): ItemRegistry => new ItemRegistry([], state, () => undefined, context.signal);
                owner.chrome = createShellChrome({commands: context.services.require(commandServiceKey), state, statusItems: empty(), titleItems: empty(), activityItems, titlebarMenu: new MenuItemRegistry([], context.signal), viewTitle: new MenuItemRegistry([], context.signal), platform: "other", signal: context.signal});
                return {receivers: {[WORKBENCH_ACTIVITYBAR_ITEMS_POINT]: activityItems.receiver()}};
            },
        }],
    };
}

interface Contributor {
    context: ActivationContext | null;
    /** 公开状态 `test.items/open` 与 `test.items/ready`。 */
    readonly open: Ref<boolean>;
    readonly ready: Ref<boolean>;
    readonly runs: unknown[];
}

const contributorState = definePublicState("test.items", {
    open: {type: "boolean", unready: false},
    ready: {type: "boolean", unready: false, reason: title("还没准备好")},
});

/** 两条命令：`test.items.open` 总可用，`test.items.later` 在 `test.items/ready` 为真之前不可用。 */
const COMMAND: CommandDeclaration = {title: title("打开"), description: "open", args: Type.Object({section: Type.Optional(Type.String())}, {additionalProperties: false}), effect: "read"};

function contributor(items: Readonly<Record<string, ActivityBarItemDeclaration>>, control: Contributor, plugin = "test.items", location: "browser" | "server" = "browser"): PluginDefinition {
    return {
        id: plugin,
        entries: [{
            id: "main",
            location,
            activationEvents: ["onStartup"],
            contributions: [
                ...Object.entries(items).map(([id, declaration]) => ({capability: WORKBENCH_ACTIVITYBAR_ITEMS_POINT, id, declaration})),
                ...(plugin === "test.items" ? [
                    {capability: COMMANDS_POINT, id: "test.items.open", declaration: COMMAND},
                    {capability: COMMANDS_POINT, id: "test.items.later", declaration: {...COMMAND, when: {requires: ["test.items/ready"]}}},
                    ...contributorState.contributions,
                ] : []),
            ],
            activate: (context) => {
                control.context = context;
                return {contributions: {
                    [WORKBENCH_ACTIVITYBAR_ITEMS_POINT]: Object.fromEntries(Object.keys(items).map((id) => [id, NONE])),
                    ...(plugin === "test.items" ? {
                        [COMMANDS_POINT]: {"test.items.open": {run: (args: unknown) => {
                            control.runs.push(args);
                            return {ok: true, value: null};
                        }}, "test.items.later": {run: () => ({ok: true, value: null})}},
                        [PUBLIC_STATE_POINT]: Object.fromEntries(bindingsOf(contributorState, {open: control.open, ready: control.ready}).bindings),
                    } : {}),
                }};
            },
        }],
    };
}

const control = (): Contributor => ({context: null, open: ref(false), ready: ref(false), runs: []});

async function start(plugins: ReadonlyArray<PluginDefinition>): Promise<{application: Application; chrome: ShellChrome}> {
    const identity = {location: "browser" as const, instanceId: "activitybar-items"};
    const store = createDiagnosticsStore({identity});
    const diagnostics = createDiagnosticsPlugin({location: "browser", store, exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)});
    const settings = standaloneSettings("browser", tmp);
    const owner: Owner = {chrome: null};
    const application = createApplication(
        {identity, stopSignal: new AbortController().signal, emergency: () => undefined},
        {capabilities: settings.capabilities, plugins: [diagnostics, statePlugin, ...settings.plugins, commandsPlugin, ownerPlugin(owner), ...plugins], requiredPlugins: [diagnostics.id, commandsPlugin.id, "test.owner"], gates: []},
    );
    started.push(application);
    await application.startup;
    return {application, chrome: owner.chrome!};
}

const declaration = (name: string, extra: Partial<ActivityBarItemDeclaration> = {}): ActivityBarItemDeclaration => ({title: title(name), icon: "i-lucide-square", order: 0, ...extra});

describe("活动栏底部条目", () => {
    it("交付后按 order 从上往下、同值按 id；when 不满足时不显示；toggled 为真时按下，没声明 toggled 的不是切换按钮", async () => {
        const items = control();
        const {chrome} = await start([contributor({
            "test.items.gear": declaration("齿轮", {order: 1000, command: {id: "test.items.open"}, toggled: "test.items/open"}),
            "test.items.b": declaration("乙", {order: 900}),
            "test.items.a": declaration("甲", {order: 900}),
            "test.items.hidden": declaration("藏", {order: 10, when: {requires: ["test.items/ready"]}}),
        }, items)]);
        const entries = computed(() => chrome.activityEntries(textIn("zh-CN")));
        expect(entries.value.map((entry) => entry.id)).toEqual(["test.items.a", "test.items.b", "test.items.gear"]);
        expect(entries.value.map((entry) => entry.pressed)).toEqual([null, null, false]);
        items.open.value = true;
        expect(entries.value.find((entry) => entry.id === "test.items.gear")?.pressed).toBe(true);
        items.ready.value = true;
        expect(entries.value.map((entry) => entry.id)).toEqual(["test.items.hidden", "test.items.a", "test.items.b", "test.items.gear"]);
    });

    it("没有命令的是占位；命令不可用时给出原因，可用后原因消失；点了执行声明的命令与参数", async () => {
        const items = control();
        const {chrome} = await start([contributor({
            "test.items.avatar": declaration("个人资料尚未开放", {order: 1}),
            "test.items.later": declaration("稍后", {order: 2, command: {id: "test.items.later"}}),
            "test.items.open": declaration("打开", {order: 3, command: {id: "test.items.open", args: {section: "x"}}}),
        }, items)]);
        const entries = computed(() => chrome.activityEntries(textIn("zh-CN")));
        expect(entries.value.map((entry) => [entry.id, entry.command?.id ?? null, entry.disabledReason])).toEqual([
            ["test.items.avatar", null, null],
            ["test.items.later", "test.items.later", "还没准备好"],
            ["test.items.open", "test.items.open", null],
        ]);
        items.ready.value = true;
        expect(entries.value[1]?.disabledReason).toBeNull();
        chrome.runItem("test.items.open");
        await waitUntil("命令执行", () => items.runs.length === 1);
        expect(items.runs).toEqual([{section: "x"}]);
        // 占位没有命令：点了什么都不做。
        chrome.runItem("test.items.avatar");
        expect(items.runs).toHaveLength(1);
    });

    it("id 要在自己的命名空间里（占用别人的 id 不算重复、挤不掉对方）；只接受浏览器入口的贡献；声明不认识的字段被拒", async () => {
        const {application, chrome} = await start([
            contributor({"test.items.same": declaration("一")}, control()),
            contributor({"test.items.same": declaration("二"), "other.item": declaration("三")}, control(), "test.two"),
            contributor({"test.three.extra": {...declaration("四"), extra: true} as ActivityBarItemDeclaration}, control(), "test.three"),
            contributor({"test.four.server": declaration("五")}, control(), "test.four", "server"),
        ]);
        // 别的插件用了不在自己命名空间里的同一个 id：那一条只因前缀被拒，不算重复者，挤不掉合法的这一条（runtime/plugins.md 输出 15）。
        expect(chrome.activityEntries(textIn("zh-CN")).map((entry) => entry.id)).toEqual(["test.items.same"]);
        const validation = (id: string) => application.plugins.contribution(WORKBENCH_ACTIVITYBAR_ITEMS_POINT, id).map((entry) => entry.validation);
        expect(validation("test.items.same")).toEqual([{status: "accepted"}, expect.objectContaining({status: "rejected", detail: "贡献 id 要以插件 id test.two 加“.”开头：test.items.same"})]);
        expect(validation("other.item")[0]).toMatchObject({status: "rejected", detail: "贡献 id 要以插件 id test.two 加“.”开头：other.item"});
        expect(validation("test.three.extra")[0]).toMatchObject({status: "rejected"});
        expect(validation("test.four.server")[0]).toMatchObject({status: "rejected", detail: `${WORKBENCH_ACTIVITYBAR_ITEMS_POINT} 只接受浏览器入口的贡献`});
    });

    it("贡献方入口开始停止，条目立即不再显示", async () => {
        const items = control();
        const {chrome} = await start([contributor({"test.items.gear": declaration("齿轮", {command: {id: "test.items.open"}})}, items)]);
        // 直接求值：入口开始停止时句柄先失去 published（不是响应式的），撤回稍后才到。
        const ids = () => chrome.activityEntries(textIn("zh-CN")).map((entry) => entry.id);
        expect(ids()).toEqual(["test.items.gear"]);
        const closing = items.context!.scope.parent!.close();
        expect(ids()).toEqual([]);
        expect((await closing).status).toBe("closed");
    });
});
