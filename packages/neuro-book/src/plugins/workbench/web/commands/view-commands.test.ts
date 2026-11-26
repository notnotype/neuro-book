/**
 * 移动、打开视图命令（docs/specs/ui/workbench-layout.md 输出 4、22、23、35，docs/specs/workbench/commands.md 第二批）：真实的
 * 一棵树的布局 store（Storage 场地），命令实现直接调用；选择服务由测试按请求作答（产品里是命令面板，经面板执行的路径由
 * `e2e/workbench-views.e2e.ts` 覆盖）。
 *
 * 移动的目标是 `container`（容器 id）或 `newContainerIn`（区域名）；两步选择之间只会因为视图或目标容器不在了而过期。
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
import {regionContainers, regionSections, viewSection} from "../state/containers";
import type {LayoutDocStore} from "../state/layout-doc-store";
import {workbenchStateBindings} from "../state/public-state";
import {openLayoutDoc} from "../testing/layout-doc";
import type {ViewCatalog} from "../views/registry";
import {MOVE_VIEW_COMMAND, moveTargetsFor, OPEN_VIEW_COMMAND, VIEW_COMMAND_DECLARATIONS, viewCommands} from "./view-commands";
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

/** 侧栏三个视图（D 不可移动），面板一个，都没声明容器，各在自己的容器里；右栏和第一个编辑组 `g0` 是空的。 */
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

const run = (store: LayoutDocStore, quickPick: QuickPick, args: Record<string, unknown>) => viewCommands(() => store, quickPick)[MOVE_VIEW_COMMAND].run(args);

/** 区域里出现的容器与各自的视图，按入口顺序。 */
const containersIn = (store: LayoutDocStore, region: ViewLocation): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => regionContainers(store.actions.document(), region).map((container) => [container.id, container.views] as const);
/** 视图此刻在哪个区域的哪个容器、哪块分节里。 */
function placeOf(store: LayoutDocStore, viewId: string): {readonly region: ViewLocation; readonly container: string; readonly panel: string} {
    const section = viewSection(store.actions.document(), viewId);
    if (section === null) throw new Error(`${viewId} 不在区域里`);
    return {region: section.region, container: section.container, panel: section.panel};
}
const activeContainer = (store: LayoutDocStore, region: ViewLocation): string | null | undefined => store.state.doc.panels[region]?.activeContainer;

describe("移动视图", () => {
    it("位置限制（views.md 输出 22）：受限视图没有一个会被收下的目标，不进第一步；别的视图的目标表里没有它的容器，菜单读同一份", async () => {
        counter += 1;
        const w = await storageWorld(join(tmp, `case-${String(counter)}`), []);
        worlds.push(w);
        const confined: ViewCatalog = new Map([...CATALOG, ["test.rail", view("R", "auxiliarybar", {confinedTo: "auxiliarybar"})]]);
        const store = (await openLayoutDoc(w, "w", "c", false, confined)).store;
        const cancelFirst = picker(() => ({kind: "cancelled"}));
        expect(await run(store, cancelFirst, {})).toEqual({ok: true, value: null});
        expect(labels(cancelFirst.requests[0])).toEqual(["test.a:A", "test.b:B", "test.c:C"]);
        expect(moveTargetsFor(store, "test.rail")).toEqual([]);
        expect((moveTargetsFor(store, "test.a") ?? []).map((target) => (target.kind === "container" ? target.container : target.kind))).not.toContain("view:test.rail");
        expect(await run(store, picker(() => ({kind: "cancelled"})), {viewId: "test.a", container: "view:test.rail"})).toMatchObject({ok: false, code: "invalid-args"});
    });

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
        const implementations = viewCommands(() => current.value, picker(() => ({kind: "cancelled"})));
        for (const id of [MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND] as const) {
            expect(registry.register({id, source: "nbook.workbench", declaration: completedCommand(id, VIEW_COMMAND_DECLARATIONS[id]), run: implementations[id].run}).ok).toBe(true);
            expect(registry.isEnabled(id)).toMatchObject({ok: false, code: "unavailable"});
        }
        current.value = store;
        for (const id of [MOVE_VIEW_COMMAND, OPEN_VIEW_COMMAND] as const) expect(registry.isEnabled(id)).toEqual({ok: true, value: true});
        expect(activeContainer(store, "sidebar")).toBe("view:test.a");
        expect(await registry.execute(OPEN_VIEW_COMMAND, {viewId: "test.b"}, {source: "agent", callerId: "test.agent"})).toMatchObject({ok: false, code: "not-exposed"});
        expect(activeContainer(store, "sidebar")).toBe("view:test.a");
        expect(await registry.execute(OPEN_VIEW_COMMAND, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(activeContainer(store, "sidebar")).toBe("view:test.b");
    });

    it("container：成为那个容器最后一个分节，区域切到它；newContainerIn：在那个区域新建一个只含它的用户容器（输出 23）", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        expect(containersIn(store, "sidebar")).toEqual([["view:test.a", ["test.a"]], ["view:test.b", ["test.b"]], ["view:test.d", ["test.d"]]]);
        expect(await run(store, silent, {viewId: "test.b", container: "view:test.c"})).toEqual({ok: true, value: null});
        expect(containersIn(store, "sidebar")).toEqual([["view:test.a", ["test.a"]], ["view:test.d", ["test.d"]]]);
        expect(containersIn(store, "panel")).toEqual([["view:test.c", ["test.c", "test.b"]]]);
        expect(activeContainer(store, "panel")).toBe("view:test.c");

        // 右栏一个容器都没有：新容器排进去，区域显示并切到它（验收 31）。
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBe(true);
        expect(await run(store, silent, {viewId: "test.a", newContainerIn: "auxiliarybar"})).toEqual({ok: true, value: null});
        const created = placeOf(store, "test.a").container;
        expect(created).toMatch(/^custom:/u);
        expect(containersIn(store, "auxiliarybar")).toEqual([[created, ["test.a"]]]);
        expect(activeContainer(store, "auxiliarybar")).toBe(created);
        expect(store.state.doc.panels.auxiliarybar?.hidden).toBeFalsy();
        // 侧栏的当前容器空了：换到相邻的（输出 43）。
        expect(activeContainer(store, "sidebar")).toBe("view:test.d");

        expect(await run(store, silent, {viewId: "test.c", container: created})).toEqual({ok: true, value: null});
        expect(containersIn(store, "auxiliarybar")).toEqual([[created, ["test.a", "test.c"]]]);
        expect(containersIn(store, "panel")).toEqual([["view:test.c", ["test.b"]]]);
        expect(store.actions.document().panels[placeOf(store, "test.c").panel]).toEqual({role: "tool", tabs: [{kind: "view", viewId: "test.c"}], active: "view:test.c", container: created});
        expect(silent.requests).toEqual([]);
    });

    it("只给一部分、两个目标都给为 invalid-args；视图不存在、目标容器既没有成员也没有声明为 stale-target 且不写", async () => {
        const store = await layout();
        const silent = picker(() => ({kind: "cancelled"}));
        const partial = await run(store, silent, {viewId: "test.b"});
        expect(partial).toMatchObject({ok: false, code: "invalid-args"});
        expect(failureText(partial, "zh-CN")).toBe("要么都不给，要么给 viewId 和 container、newContainerIn 中的一个");
        expect(failureText(partial, "en-US")).toBe("Give nothing, or viewId and one of container and newContainerIn");
        expect(await run(store, silent, {container: "view:test.c"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {newContainerIn: "panel"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, silent, {viewId: "test.a", container: "view:test.c", newContainerIn: "panel"})).toMatchObject({ok: false, code: "invalid-args"});

        const before = JSON.stringify(store.state.doc);
        const missingTarget = await run(store, silent, {viewId: "test.a", container: "custom:nope"});
        expect(missingTarget).toMatchObject({ok: false, code: "stale-target"});
        expect(failureText(missingTarget, "zh-CN")).toBe("视图或目标容器已经不在了，没有移动");
        expect(failureText(missingTarget, "en-US")).toBe("The view or the target container is gone; nothing moved");
        expect(await run(store, silent, {viewId: "test.nowhere", container: "view:test.c"})).toMatchObject({ok: false, code: "stale-target"});
        expect(await run(store, silent, {viewId: "test.nowhere", newContainerIn: "panel"})).toMatchObject({ok: false, code: "stale-target"});
        expect(JSON.stringify(store.state.doc)).toBe(before);
        expect(silent.requests).toEqual([]);
    });

    it("声明了 movable: false 的视图：菜单、拖动和选择都不让动，带全参数的命令同样不动它，为 invalid-args 且不写（docs/specs/workbench/views.md 的 `movable`）", async () => {
        const store = await layout();
        const before = JSON.stringify(store.state.doc);
        const refused = await run(store, picker(() => ({kind: "cancelled"})), {viewId: "test.d", container: "view:test.c"});
        expect(refused).toMatchObject({ok: false, code: "invalid-args"});
        expect(await run(store, picker(() => ({kind: "cancelled"})), {viewId: "test.d", newContainerIn: "panel"})).toMatchObject({ok: false, code: "invalid-args"});
        expect(JSON.stringify(store.state.doc)).toBe(before);
    });

    it("无参：先选视图（不可移动的不在候选里）、再选目标（别的容器写标题、三个区域的新容器、重置位置）；取消任一步成功且不写", async () => {
        const store = await layout();
        const cancelFirst = picker(() => ({kind: "cancelled"}));
        expect(await run(store, cancelFirst, {})).toEqual({ok: true, value: null});
        expect(labels(cancelFirst.requests[0])).toEqual(["test.a:A", "test.b:B", "test.c:C"]);

        const before = JSON.stringify(store.state.doc);
        const cancelSecond = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "cancelled"}));
        expect(await run(store, cancelSecond, {})).toEqual({ok: true, value: null});
        // A 在自己的容器里：别的容器按区域、入口顺序列出（不列它自己的），没有“重置位置”。
        const fresh = ["new:sidebar:新容器（侧栏）", "new:auxiliarybar:新容器（右栏）", "new:panel:新容器（底部面板）"];
        expect(labels(cancelSecond.requests[1])).toEqual(["container:view:test.b:B", "container:view:test.d:D", "container:view:test.c:C", ...fresh]);
        expect(JSON.stringify(store.state.doc)).toBe(before);

        const move = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: "container:view:test.c"}));
        expect(await run(store, move, {})).toEqual({ok: true, value: null});
        expect(placeOf(store, "test.a")).toMatchObject({region: "panel", container: "view:test.c"});

        // A 现在不在它自己的容器里：目标里多一项“重置位置”，选它回到那个容器，侧栏切到它。
        const reset = picker((request, index) => (index === 0 ? {kind: "item", id: "test.a"} : {kind: "item", id: request.items.at(-1)!.id}));
        expect(await run(store, reset, {})).toEqual({ok: true, value: null});
        expect(labels(reset.requests[1]).at(-1)).toBe("reset:view:test.a:重置位置");
        expect(placeOf(store, "test.a")).toMatchObject({region: "sidebar", container: "view:test.a"});
        expect(activeContainer(store, "sidebar")).toBe("view:test.a");

        // B 进底部面板的新容器：入口排在最后，底部面板切到它。
        const create = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.b"} : {kind: "item", id: "new:panel"}));
        expect(await run(store, create, {})).toEqual({ok: true, value: null});
        const created = placeOf(store, "test.b");
        expect(containersIn(store, "panel")).toEqual([["view:test.c", ["test.c"]], [created.container, ["test.b"]]]);
        expect(activeContainer(store, "panel")).toBe(created.container);

        // 只有一个标签的分节换容器，是同一块面板移动（输出 27）：面板 id 不变。
        const alone = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.b"} : {kind: "item", id: "container:view:test.a"}));
        expect(await run(store, alone, {})).toEqual({ok: true, value: null});
        expect(placeOf(store, "test.b")).toEqual({region: "sidebar", container: "view:test.a", panel: created.panel});
        expect(regionSections(store.actions.document(), "sidebar").map((section) => section.panel)).toContain(created.panel);
        // 区域的最后一个分节搬走：区域隐藏，锚留在骨架上；空了的用户容器从入口顺序里删掉。
        const last = picker((_request, index) => (index === 0 ? {kind: "item", id: "test.c"} : {kind: "item", id: "container:view:test.a"}));
        expect(await run(store, last, {})).toEqual({ok: true, value: null});
        expect(placeOf(store, "test.c")).toMatchObject({region: "sidebar", container: "view:test.a"});
        expect(containersIn(store, "panel")).toEqual([]);
        expect(store.state.doc.panels.panel).toMatchObject({hidden: true, activeContainer: null});
        expect(store.state.doc.panels.panel?.entries).not.toContain(created.container);
    });

    it("两步选择之间目标容器没了（用户容器的成员都搬走了）：按 stale-target 拒绝且不写", async () => {
        const store = await layout();
        expect(await run(store, picker(() => ({kind: "cancelled"})), {viewId: "test.b", newContainerIn: "auxiliarybar"})).toEqual({ok: true, value: null});
        const created = placeOf(store, "test.b").container;
        let raced = "";
        const racing = picker((request, index) => {
            if (index === 0) return {kind: "item", id: "test.a"};
            expect(request.items.map((item) => item.id)).toContain(`container:${created}`);
            // 选目标的过程中，用户容器唯一的视图回了它自己的容器，用户容器不再存在（输出 41）。
            expect(store.actions.moveView("test.b", {container: "view:test.b"}).ok).toBe(true);
            raced = JSON.stringify(store.state.doc);
            return {kind: "item", id: `container:${created}`};
        });
        const stale = await run(store, racing, {});
        expect(stale).toMatchObject({ok: false, code: "stale-target"});
        expect(failureText(stale, "zh-CN")).toBe("视图或目标容器已经不在了，没有移动");
        expect(placeOf(store, "test.a")).toMatchObject({region: "sidebar", container: "view:test.a"});
        expect(JSON.stringify(store.state.doc)).toBe(raced);
        expect(containersIn(store, "auxiliarybar")).toEqual([]);
    });

    it("选择服务不可用为 unavailable；外壳没打开为 unavailable", async () => {
        const store = await layout();
        expect(await run(store, picker(() => ({kind: "unavailable", reason: "没有命令面板"})), {})).toEqual({ok: false, code: "unavailable", reason: "没有命令面板"});
        expect(await viewCommands(() => null, picker(() => ({kind: "cancelled"})))[MOVE_VIEW_COMMAND].run({})).toMatchObject({ok: false, code: "unavailable"});
    });
});

describe("打开视图（docs/specs/ui/workbench-layout.md 输出 35，docs/specs/workbench/views.md 输出 14）", () => {
    const open = (store: LayoutDocStore | null, quickPick: QuickPick, args: Record<string, unknown>) => viewCommands(() => store, quickPick)[OPEN_VIEW_COMMAND].run(args);
    const silent = picker(() => ({kind: "cancelled"}));

    it("区域里的视图：切到它的容器，所在区域被隐藏或拖到零时一并显示", async () => {
        const store = await layout();
        store.actions.setPartHidden("sidebar", true);
        expect(await open(store, silent, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(activeContainer(store, "sidebar")).toBe("view:test.b");
        expect(store.state.doc.panels.sidebar?.hidden).toBeFalsy();

        store.actions.setCollapsed("panel", true);
        store.actions.setPartHidden("panel", true);
        expect(store.state.doc.panels.panel).toMatchObject({hidden: true, collapsed: true});
        expect(await open(store, silent, {viewId: "test.c"})).toEqual({ok: true, value: null});
        expect(store.state.doc.panels.panel?.hidden).toBeFalsy();
        expect(store.state.doc.panels.panel?.collapsed).toBeFalsy();
        expect(store.actions.partVisible("panel")).toBe(true);
    });

    it("分节收成标题行的视图：展开它；盖着它的最大化退出，它就在最大化的分节里时保持", async () => {
        const store = await layout();
        const first = placeOf(store, "test.a").panel;
        expect(await run(store, silent, {viewId: "test.b", container: "view:test.a"})).toEqual({ok: true, value: null});
        const created = placeOf(store, "test.b").panel;
        store.actions.setCollapsed(created, true);
        expect(store.state.doc.panels[created]?.collapsed).toBe(true);
        expect(await open(store, silent, {viewId: "test.b"})).toEqual({ok: true, value: null});
        expect(store.state.doc.panels[created]?.collapsed).toBeFalsy();

        store.actions.toggleMaximized(first);
        expect(await open(store, silent, {viewId: "test.a"})).toEqual({ok: true, value: null});
        expect(store.state.maximized).toBe(first);
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
