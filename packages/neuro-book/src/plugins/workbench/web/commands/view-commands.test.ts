/**
 * 移动、打开视图命令（docs/specs/ui/workbench-layout.md 输出 4、22、23、35，docs/specs/workbench/commands.md 第二批）：真实的
 * 一棵树的布局 store（Storage 场地），命令实现直接调用；选择服务由测试按请求作答（产品里是命令面板，经面板执行的路径由
 * `e2e/workbench-views.e2e.ts` 覆盖）。
 *
 * 移动的目标是面板 id 或 `{newPanelNextTo}`；新的合同没有“来源面板”可核对，两步选择之间只会因为视图或目标面板不在了而过期。
 * 目录里声明着的视图总在布局里（`reconcileViews` 会补回），所以“视图不在布局里”只在声明消失之后才可能出现，那时先被“没有这个
 * 视图”拦下。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {shallowRef} from "@vue/reactivity";

import type {ContextKeySource} from "nbook/plugins/commands/shared/context-keys";
import {createCommandRegistry} from "nbook/plugins/commands/shared/registry";
import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";

import type {QuickPick, QuickPickRequest, QuickPickResult} from "../../shared/contracts";
import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {workbenchStateBindings} from "../state/public-state";
import {openLayoutDoc} from "../testing/layout-doc";
import type {ViewCatalog} from "../views/placement";
import {MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND, VIEW_COMMAND_DECLARATIONS, viewCommands} from "./view-commands";
import {completedCommand} from "../../testing/declarations";
import {failureText, workbenchTestText} from "../../testing/text";

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "view-commands");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const view = (name: string, location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon: `i-${name}`, location, layout: "scroll", ...extra});

/** 侧栏三个视图（D 不可移动），面板一个；右栏和第一个编辑组 `g0` 是空的。 */
const CATALOG: ViewCatalog = new Map([["test.a", view("A", "sidebar")], ["test.b", view("B", "sidebar")], ["test.c", view("C", "panel")], ["test.d", view("D", "sidebar", {movable: false})]]);

async function layout(): Promise<LayoutDocStore> {
    counter += 1;
    const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(w);
    return (await openLayoutDoc(w, "w", "c", false, CATALOG)).store;
}

function picker(answer: (request: QuickPickRequest, index: number) => QuickPickResult | Promise<QuickPickResult>): QuickPick & {readonly requests: QuickPickRequest[]} {
    const requests: QuickPickRequest[] = [];
    return {requests, pick: async (request) => {
        requests.push(request);
        return answer(request, requests.length - 1);
    }};
}

const labels = (request: QuickPickRequest | undefined): string[] => (request?.items ?? []).map((item) => `${item.id}:${workbenchTestText("zh-CN").t(item.label)}${item.detail === undefined ? "" : `/${workbenchTestText("zh-CN").t(item.detail)}`}`);

const run = (store: LayoutDocStore, quickPick: QuickPick, args: Record<string, unknown>) => viewCommands(() => store, quickPick, workbenchTestText("zh-CN"))[MOVE_VIEW_COMMAND].run(args);

const tabsOf = (store: LayoutDocStore, panel: string): string[] => (store.state.doc.panels[panel]?.tabs ?? []).map((tab) => (tab.kind === "view" ? tab.viewId : tab.tabId));
const panelOf = (store: LayoutDocStore, viewId: string): string | undefined => Object.entries(store.state.doc.panels).find(([, record]) => record.tabs.some((tab) => tab.kind === "view" && tab.viewId === viewId))?.[0];
const unnamedToolPanels = (store: LayoutDocStore): string[] => Object.entries(store.state.doc.panels).filter(([, record]) => record.role === "tool" && record.name === undefined).map(([id]) => id);

describe("移动视图", () => {
    it("移动、打开视图经真实命令注册表登记：布局没打开时不可用，打开后可用；Agent 不能打开视图（not-exposed）", async () => {
        const store = await layout();
        const current = shallowRef<LayoutDocStore | null>(null);
        const bindings = workbenchStateBindings(current) as unknown as Readonly<Record<string, {readonly value: unknown}>>;
        const nameOf = (key: string): string => key.slice("nbook.workbench/".length);
        const contextKeys: ContextKeySource = {
            problem: (key) => (key.startsWith("nbook.workbench/") && nameOf(key) in bindings ? null : `${key} 不是工作台的公开键`),
            evaluate: (key) => (bindings[nameOf(key)]?.value === true ? {matches: true} : {matches: false, reason: key}),
        };
        const registry = createCommandRegistry({contextKeys, report: (error) => {
            throw error;
        }});
        const implementations = viewCommands(() => current.value, picker(() => ({kind: "cancelled"})), workbenchTestText("zh-CN"));
        for (const id of [MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND] as const) {
            expect(registry.register({id, source: "nbook.workbench", declaration: completedCommand(id, VIEW_COMMAND_DECLARATIONS[id]), run: implementations[id].run}).ok).toBe(true);
            expect(registry.isEnabled(id)).toMatchObject({ok: false, code: "unavailable"});
        }
        current.value = store;
        for (const id of [MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND] as const) expect(registry.isEnabled(id)).toEqual({ok: true, value: true});
        expect(store.state.doc.panels.sidebar?.active).not.toBe("view:test.b");
        expect(await registry.execute(OPEN_VIEW_COMMAND, {viewId: "test.b"}, {source: "agent", callerId: "test.agent"})).toMatchObject({ok: false, code: "not-exposed"});
        expect(store.state.doc.panels.sidebar?.active).not.toBe("view:test.b");
        expect(await registry.execute(OPEN_VIEW_COMMAND, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(store.state.doc.panels.sidebar?.active).toBe("view:test.b");
    });

    it("目标是面板 id：放到那块面板的标签末尾；目标是 {newPanelNextTo}：挨着那块面板开一块只装这个视图的新面板；放进隐藏的具名面板时把它显示出来", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        expect(tabsOf(store, "sidebar")).toEqual(["test.a", "test.b", "test.d"]);
        expect(await run(store, silent, {viewId: "test.b", target: "panel"})).toEqual({ok: true, value: null});
        expect(tabsOf(store, "sidebar")).toEqual(["test.a", "test.d"]);
        expect(tabsOf(store, "panel")).toEqual(["test.c", "test.b"]);

        expect(store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
        expect(await run(store, silent, {viewId: "test.a", target: "auxiliarybar"})).toEqual({ok: true, value: null});
        expect(tabsOf(store, "auxiliarybar")).toEqual(["test.a"]);
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBeFalsy();

        expect(unnamedToolPanels(store)).toEqual([]);
        expect(await run(store, silent, {viewId: "test.c", target: {newPanelNextTo: "panel"}})).toEqual({ok: true, value: null});
        const created = panelOf(store, "test.c")!;
        expect(unnamedToolPanels(store)).toEqual([created]);
        expect(tabsOf(store, created)).toEqual(["test.c"]);
        expect(tabsOf(store, "panel")).toEqual(["test.b"]);
        expect(store.state.doc.panels[created]).toMatchObject({role: "tool", active: "view:test.c"});
        expect(silent.requests).toEqual([]);
    });

    it("只给一部分为 invalid-args；视图或目标面板不存在为 stale-target 且不写", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        const partial = await run(store, silent, {viewId: "test.b"});
        expect(partial).toMatchObject({ok: false, code: "invalid-args"});
        expect(failureText(partial, "zh-CN")).toBe("要么都不给，要么同时给 viewId 和 target");
        expect(failureText(partial, "en-US")).toBe("Give nothing, or both viewId and target");
        expect(await run(store, silent, {target: "panel"})).toMatchObject({ok: false, code: "invalid-args"});

        const before = JSON.stringify(store.state.doc);
        const missingTarget = await run(store, silent, {viewId: "test.a", target: "nope"});
        expect(missingTarget).toMatchObject({ok: false, code: "stale-target"});
        expect(failureText(missingTarget, "zh-CN")).toBe("视图或目标面板已经不在了，没有移动");
        expect(failureText(missingTarget, "en-US")).toBe("The view or the target panel is gone; nothing moved");
        expect(await run(store, silent, {viewId: "test.nowhere", target: "panel"})).toMatchObject({ok: false, code: "stale-target"});
        expect(await run(store, silent, {viewId: "test.a", target: {newPanelNextTo: "nope"}})).toMatchObject({ok: false, code: "stale-target"});
        expect(JSON.stringify(store.state.doc)).toBe(before);
        expect(silent.requests).toEqual([]);
    });

    it("声明了 movable: false 的视图：菜单、拖动和选择都不让动，带全参数的命令同样不动它，为 invalid-args 且不写（docs/specs/workbench/views.md 的 `movable`）", async () => {
        const store = await layout();
        const before = JSON.stringify(store.state.doc);
        const refused = await run(store, picker(() => ({kind: "cancelled"})), {viewId: "test.d", target: "panel"});
        expect(refused).toMatchObject({ok: false, code: "invalid-args"});
        expect(JSON.stringify(store.state.doc)).toBe(before);
    });

    it("无参：先选视图（不可移动的不在候选里）、再选目标（别的工具面板、挨着每块面板的新面板、重置位置）；取消任一步成功且不写", async () => {
        const store = await layout();
        const cancelFirst = picker(() => ({kind: "cancelled"}));
        expect(await run(store, cancelFirst, {})).toEqual({ok: true, value: null});
        expect(labels(cancelFirst.requests[0])).toEqual(["test.a:A", "test.b:B", "test.c:C"]);

        const before = JSON.stringify(store.state.doc);
        const cancelSecond = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "cancelled"}));
        expect(await run(store, cancelSecond, {})).toEqual({ok: true, value: null});
        // A 在侧栏：别的工具面板是面板和（隐藏着的）右栏，具名面板写名字；新面板可以挨着每块显示着的面板，隐藏的不列；A 在第一次放的侧栏，没有“重置位置”。
        expect(labels(cancelSecond.requests[1])).toEqual(["panel:面板", "auxiliarybar:右栏", "new:sidebar:新面板（挨着侧栏）", "new:g0:新面板（挨着编辑区）", "new:panel:新面板（挨着面板）"]);
        expect(JSON.stringify(store.state.doc)).toBe(before);

        const move = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: "panel"}));
        expect(await run(store, move, {})).toEqual({ok: true, value: null});
        expect(panelOf(store, "test.a")).toBe("panel");

        // A 现在不在声明的侧栏：目标里多一项“重置位置”，选它回到侧栏标签末尾。
        const reset = picker((request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: request.items.at(-1)!.id}));
        expect(await run(store, reset, {})).toEqual({ok: true, value: null});
        expect(labels(reset.requests[1]).at(-1)).toBe("reset::重置位置");
        expect(tabsOf(store, "sidebar").at(-1)).toBe("test.a");

        // 多标签面板里的 B 挨着面板开新面板：拆出一块只装 B 的无名面板。
        const create = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.b"} : {kind: "item", id: "new:panel"}));
        expect(await run(store, create, {})).toEqual({ok: true, value: null});
        const created = panelOf(store, "test.b")!;
        expect(unnamedToolPanels(store)).toEqual([created]);
        expect(tabsOf(store, created)).toEqual(["test.b"]);

        // 只有一个标签的面板挨着别的面板，是同一块面板移动（输出 27）：面板 id 不变，不多出新面板。
        const alone = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.c"} : {kind: "item", id: "new:sidebar"}));
        expect(await run(store, alone, {})).toEqual({ok: true, value: null});
        expect(panelOf(store, "test.c")).toBe("panel");
        expect(unnamedToolPanels(store)).toEqual([created]);
    });

    it("两步选择之间目标面板没了（被搬空的无名面板随之移除）：按 stale-target 拒绝且不写", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        expect(await run(store, silent, {viewId: "test.b", target: {newPanelNextTo: "panel"}})).toEqual({ok: true, value: null});
        const created = panelOf(store, "test.b")!;
        const racing = picker((_request, index) => {
            if (index === 0) return {kind: "item", id: "test.a"};
            // 选目标的过程中，唯一的标签被搬回面板，空了的无名面板按输出 3 移除。
            expect(store.actions.moveView("test.b", "panel").ok).toBe(true);
            return {kind: "item", id: created};
        });
        const before = tabsOf(store, "sidebar");
        const stale = await run(store, racing, {});
        expect(stale).toMatchObject({ok: false, code: "stale-target"});
        expect(failureText(stale, "zh-CN")).toBe("视图或目标面板已经不在了，没有移动");
        expect(store.state.doc.panels[created]).toBeUndefined();
        expect(tabsOf(store, "sidebar")).toEqual(before);
    });

    it("选择服务不可用为 unavailable；外壳没打开为 unavailable", async () => {
        const store = await layout();
        expect(await run(store, picker(() => ({kind: "unavailable", reason: "没有命令面板"})), {})).toEqual({ok: false, code: "unavailable", reason: "没有命令面板"});
        expect(await viewCommands(() => null, picker(() => ({kind: "cancelled"})), workbenchTestText("zh-CN"))[MOVE_VIEW_COMMAND].run({})).toMatchObject({ok: false, code: "unavailable"});
    });
});

describe("打开视图（docs/specs/ui/workbench-layout.md 输出 35，docs/specs/workbench/views.md 输出 14）", () => {
    const open = (store: LayoutDocStore | null, quickPick: QuickPick, args: Record<string, unknown>) => viewCommands(() => store, quickPick, workbenchTestText("zh-CN"))[OPEN_VIEW_COMMAND].run(args);
    const silent = picker(() => ({kind: "cancelled"}));

    it("具名面板里的视图：激活它，所在面板被隐藏、拖到零或收起时一并显示", async () => {
        const store = await layout();
        store.actions.setPartHidden("sidebar", true);
        expect(await open(store, silent, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(store.state.doc.panels.sidebar?.active).toBe("view:test.b");
        expect(store.state.doc.panels.sidebar?.hidden).toBeFalsy();

        store.actions.setCollapsed("panel", true);
        store.actions.setPartHidden("panel", true);
        expect(store.state.doc.panels.panel).toMatchObject({hidden: true, collapsed: true});
        expect(await open(store, silent, {viewId: "test.c"})).toEqual({ok: true, value: null});
        expect(store.state.doc.panels.panel?.hidden).toBeFalsy();
        expect(store.state.doc.panels.panel?.collapsed).toBeFalsy();
        expect(store.actions.partVisible("panel")).toBe(true);
    });

    it("无名面板里收起的视图：展开它；盖着它的最大化退出，它就在最大化的面板里时保持", async () => {
        const store = await layout();
        expect(await run(store, silent, {viewId: "test.b", target: {newPanelNextTo: "panel"}})).toEqual({ok: true, value: null});
        const created = panelOf(store, "test.b")!;
        expect(unnamedToolPanels(store)).toEqual([created]);
        store.actions.setCollapsed(created, true);
        expect(store.state.doc.panels[created]?.collapsed).toBe(true);
        expect(await open(store, silent, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(store.state.doc.panels[created]?.collapsed).toBeFalsy();

        store.actions.toggleMaximized("sidebar");
        expect(await open(store, silent, {viewId: "test.a"})).toEqual({ok: true, value: null});
        expect(store.state.maximized).toBe("sidebar");
        expect(await open(store, silent, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(store.state.maximized).toBeNull();
    });

    it("没有这个视图为 invalid-args 且不写；外壳没打开为 unavailable", async () => {
        const store = await layout();
        const before = JSON.stringify(store.state.doc);
        const unknown = await open(store, silent, {viewId: "test.nowhere"});
        expect(unknown).toMatchObject({ok: false, code: "invalid-args"});
        expect(failureText(unknown, "zh-CN")).toBe("没有这个视图（没有已接受的声明）：test.nowhere");
        expect(failureText(unknown, "en-US")).toBe("No such view (no accepted declaration): test.nowhere");
        expect(JSON.stringify(store.state.doc)).toBe(before);
        const detached = await open(null, silent, {viewId: "test.b"});
        expect(detached).toMatchObject({ok: false, code: "unavailable"});
        expect(failureText(detached, "zh-CN")).toBe("工作台布局没有打开（这个窗口没有显示外壳）");
        expect(failureText(detached, "en-US")).toBe("The workbench layout is not open (this window does not show the shell)");
    });

    it("不给 viewId：经选择挑一个已落位的视图；取消时成功且不写", async () => {
        const store = await layout();
        store.actions.setPartHidden("panel", true);
        const chooser = picker((request) => ({kind: "item", id: request.items.find((item) => item.id === "test.c")!.id}));
        expect(await open(store, chooser, {})).toEqual({ok: true, value: null});
        expect(labels(chooser.requests[0])).toEqual(["test.a:A", "test.b:B", "test.c:C", "test.d:D"]);
        expect(store.state.doc.panels.panel?.hidden).toBeFalsy();

        const before = JSON.stringify(store.state.doc);
        expect(await open(store, silent, {})).toEqual({ok: true, value: null});
        expect(JSON.stringify(store.state.doc)).toBe(before);
    });
});
