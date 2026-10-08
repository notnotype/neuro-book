/**
 * 面板命令与工作台公开状态（docs/specs/ui/workbench-shell.md 外壳一输出 13，docs/specs/workbench/commands.md 第二批）：
 * 真实的布局 store（Storage 场地），命令实现直接调用；选择服务由测试按请求作答（产品里是命令面板，经面板执行的路径
 * 由 `e2e/workbench-shell.e2e.ts` 覆盖）。声明的合规由命令系统登记时用的同一份校验检查。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {shallowRef} from "@vue/reactivity";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {ContextKeySource} from "nbook/plugins/commands/shared/context-keys";
import {commandDeclarationProblems, createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";
import {textOf} from "nbook/shared/localized-text";

import type {QuickPick, QuickPickRequest, QuickPickResult} from "../../shared/contracts";
import type {ShellLayoutFacts} from "../shell/sizes";
import type {LayoutStore} from "../state/layout-store";
import {workbenchState, workbenchStateBindings} from "../state/public-state";
import {openLayout} from "../testing/layout";
import {
    PANEL_COMMAND_DECLARATIONS,
    panelCommands,
    SET_PANEL_ALIGNMENT_COMMAND,
    SET_PANEL_COLLAPSED_COMMAND,
    SET_PANEL_HIDDEN_COMMAND,
    SET_PANEL_POSITION_COMMAND,
    TOGGLE_PANEL_MAXIMIZED_COMMAND,
} from "./panel-commands";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "panel-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function layout(): Promise<LayoutStore> {
    counter += 1;
    const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(w);
    return (await openLayout(w, "w", "c")).store;
}

function picker(answer: (request: QuickPickRequest) => QuickPickResult): QuickPick & {readonly requests: QuickPickRequest[]} {
    const requests: QuickPickRequest[] = [];
    return {requests, pick: async (request) => {
        requests.push(request);
        return answer(request);
    }};
}

const SPLIT: ShellLayoutFacts = {extent: {width: 1440, height: 900}, mode: "split", effectivePanel: {position: "bottom", alignment: "center", collapsed: false, maximized: false}, issues: []};
const COMPACT: ShellLayoutFacts = {extent: {width: 390, height: 844}, mode: "compact", effectivePanel: {position: "bottom", alignment: "justify", collapsed: false, maximized: false}, issues: []};

describe("声明", () => {
    it("五条命令的声明通过命令系统的校验；when 只引用工作台声明的公开键", () => {
        const declared = new Set((Object.keys(workbenchState.declarations) as (keyof typeof workbenchState.declarations)[]).map((name) => workbenchState.key(name)));
        for (const [id, declaration] of Object.entries(PANEL_COMMAND_DECLARATIONS)) {
            expect(commandDeclarationProblems(id, "nbook.workbench", declaration), id).toEqual([]);
            for (const key of declaration.when.requires) expect(declared.has(key), key).toBe(true);
        }
    });
});

describe("公开状态", () => {
    it("store 未创建时都是未就绪值；就绪后随呈现事实、面板位置与显隐变化", async () => {
        const current = shallowRef<LayoutStore | null>(null);
        const keys = workbenchStateBindings(current);
        const snapshot = () => Object.fromEntries(Object.entries(keys).map(([name, binding]) => [name, binding.value]));
        expect(snapshot()).toEqual({layoutReady: false, nonCompact: false, panelHorizontal: false, panelMaximizable: false, panelVisible: false, panelMaximized: false, panelPosition: "bottom", panelAlignment: "center"});

        const store = await layout();
        current.value = store;
        // 记录读完、呈现事实还没到：几何相关的仍为 false。
        expect(snapshot()).toMatchObject({layoutReady: true, nonCompact: false, panelHorizontal: false, panelMaximizable: false, panelVisible: true});
        store.actions.acceptLayoutFacts(SPLIT);
        expect(snapshot()).toMatchObject({nonCompact: true, panelHorizontal: true, panelMaximizable: true});

        store.actions.setPanelAlignment("justify");
        expect(snapshot()).toMatchObject({panelMaximizable: false, panelAlignment: "justify"});
        store.actions.setPanelPosition("left");
        expect(snapshot()).toMatchObject({panelHorizontal: false, panelMaximizable: true, panelPosition: "left"});
        store.actions.togglePanelMaximized();
        expect(keys.panelMaximized.value).toBe(true);
        store.actions.setPanelHidden(true);
        expect(snapshot()).toMatchObject({panelVisible: false, panelMaximizable: false, panelMaximized: false});
        store.actions.setPanelHidden(false);
        store.actions.acceptLayoutFacts(COMPACT);
        expect(snapshot()).toMatchObject({nonCompact: false, panelMaximizable: false});
    });
});

describe("命令", () => {
    it("位置与对齐：带参数直接改；省略时经选择列出并标出当前，选中即改，取消不改；选择服务不可用时 unavailable", async () => {
        const store = await layout();
        store.actions.acceptLayoutFacts(SPLIT);
        const choose = picker((request) => (request.items.some((item) => item.id === "right") && textOf(request.title, "zh-CN") === "面板位置" ? {kind: "item", id: "right"} : {kind: "item", id: "justify"}));
        const commands = panelCommands(() => store, choose);

        expect(await commands[SET_PANEL_POSITION_COMMAND].run({position: "top"})).toEqual({ok: true, value: null});
        expect(store.state.panel.position).toBe("top");
        expect(await commands[SET_PANEL_POSITION_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(choose.requests[0]!.items.map((item) => [item.id, item.detail === undefined ? null : textOf(item.detail, "zh-CN")])).toEqual([["bottom", null], ["top", "当前"], ["left", null], ["right", null]]);
        expect(store.state.panel.position).toBe("right");

        store.actions.setPanelPosition("bottom");
        expect(await commands[SET_PANEL_ALIGNMENT_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(store.state.panel.alignment).toBe("justify");

        const cancelled = panelCommands(() => store, picker(() => ({kind: "cancelled"})));
        expect(await cancelled[SET_PANEL_POSITION_COMMAND].run({})).toEqual({ok: true, value: null});
        expect(store.state.panel.position).toBe("bottom");
        const missing = panelCommands(() => store, picker(() => ({kind: "unavailable", reason: "没有面板"})));
        expect(await missing[SET_PANEL_ALIGNMENT_COMMAND].run({})).toEqual({ok: false, code: "unavailable", reason: "没有面板"});
    });

    it("隐藏、收起省略参数时切换，带参数时设成给定值；最大化切换；外壳没挂载时 unavailable", async () => {
        const store = await layout();
        store.actions.acceptLayoutFacts(SPLIT);
        const commands = panelCommands(() => store, picker(() => ({kind: "cancelled"})));
        await commands[SET_PANEL_COLLAPSED_COMMAND].run({});
        expect(store.state.panel.collapsed).toBe(true);
        await commands[SET_PANEL_COLLAPSED_COMMAND].run({collapsed: true});
        expect(store.state.panel.collapsed).toBe(true);
        await commands[SET_PANEL_HIDDEN_COMMAND].run({});
        expect(store.state.panel.hidden).toBe(true);
        await commands[SET_PANEL_HIDDEN_COMMAND].run({});
        expect(store.state.panel).toMatchObject({hidden: false, collapsed: false});
        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({});
        expect(store.state.panel.maximized).toBe(true);
        await commands[TOGGLE_PANEL_MAXIMIZED_COMMAND].run({});
        expect(store.state.panel.maximized).toBe(false);

        const detached = panelCommands(() => null, picker(() => ({kind: "cancelled"})));
        expect(await detached[SET_PANEL_HIDDEN_COMMAND].run({hidden: true})).toMatchObject({ok: false, code: "unavailable"});
    });
});

describe("经命令注册表", () => {
    /** 真实的命令注册表：上下文键读工作台公开状态的绑定（产品里由 `nbook.state` 转交，读法相同）。 */
    function registryFor(store: LayoutStore) {
        const bindings = workbenchStateBindings(shallowRef<LayoutStore | null>(store)) as unknown as Readonly<Record<string, {readonly value: unknown}>>;
        const declarations = workbenchState.declarations as Readonly<Record<string, {readonly reason?: {readonly "zh-CN": string}}>>;
        const nameOf = (key: string): string | null => (key.startsWith("nbook.workbench/") ? key.slice("nbook.workbench/".length) : null);
        const contextKeys: ContextKeySource = {
            problem: (key) => (nameOf(key) !== null && nameOf(key)! in declarations ? null : `${key} 不是工作台的公开键`),
            evaluate: (key) => (bindings[nameOf(key)!]?.value === true ? {matches: true} : {matches: false, reason: declarations[nameOf(key)!]?.reason?.["zh-CN"] ?? key}),
        };
        const registry = createCommandRegistry({contextKeys, report: (error) => {
            throw error;
        }});
        const implementations = panelCommands(() => store, picker(() => ({kind: "cancelled"})));
        for (const [id, declaration] of Object.entries(PANEL_COMMAND_DECLARATIONS)) {
            const registered = registry.register({id, source: "nbook.workbench", declaration, run: implementations[id as keyof typeof implementations].run});
            expect(registered.ok, id).toBe(true);
        }
        const enabled = () => Object.fromEntries(Object.keys(PANEL_COMMAND_DECLARATIONS).map((id) => [id.slice("nbook.view.".length), registry.isEnabled(id).ok]));
        return {registry, enabled};
    }

    it("可用性随布局变化：未就绪、底部居中、两端对齐、左右位置、隐藏、紧凑", async () => {
        const store = await layout();
        const {registry, enabled} = registryFor(store);
        // 呈现事实未到：只有不依赖几何的“隐藏/显示”可用。
        expect(enabled()).toEqual({"set-panel-position": false, "set-panel-alignment": false, "set-panel-hidden": true, "set-panel-collapsed": false, "toggle-panel-maximized": false});
        store.actions.acceptLayoutFacts(SPLIT);
        expect(enabled()).toEqual({"set-panel-position": true, "set-panel-alignment": true, "set-panel-hidden": true, "set-panel-collapsed": true, "toggle-panel-maximized": true});
        store.actions.setPanelAlignment("justify");
        expect(enabled()["toggle-panel-maximized"]).toBe(false);
        store.actions.setPanelPosition("left");
        expect(enabled()).toMatchObject({"set-panel-alignment": false, "set-panel-collapsed": false, "toggle-panel-maximized": true});
        expect(registry.isEnabled(SET_PANEL_COLLAPSED_COMMAND)).toEqual({ok: false, code: "unavailable", reason: "面板不在底部或顶部"});
        store.actions.setPanelHidden(true);
        expect(enabled()["toggle-panel-maximized"]).toBe(false);
        store.actions.setPanelHidden(false);
        store.actions.acceptLayoutFacts(COMPACT);
        expect(enabled()).toMatchObject({"set-panel-position": false, "set-panel-alignment": false, "toggle-panel-maximized": false, "set-panel-hidden": true});
    });

    it("参数严格：多余字段与非法取值为 invalid-args 且不改布局；带参数执行改变布局", async () => {
        const store = await layout();
        store.actions.acceptLayoutFacts(SPLIT);
        const {registry} = registryFor(store);
        expect(await registry.execute(SET_PANEL_POSITION_COMMAND, {position: "middle"}, {source: "user"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await registry.execute(SET_PANEL_HIDDEN_COMMAND, {hidden: true, extra: 1}, {source: "user"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await registry.execute(TOGGLE_PANEL_MAXIMIZED_COMMAND, {force: true}, {source: "user"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(store.state.panel).toMatchObject({position: "bottom", hidden: false, maximized: false});
        expect(await registry.execute(SET_PANEL_POSITION_COMMAND, {position: "top"}, {source: "user"})).toEqual({ok: true, value: null});
        expect(store.state.panel.position).toBe("top");
    });
});
