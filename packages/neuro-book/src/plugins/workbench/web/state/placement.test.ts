/**
 * 视图的位置限制（docs/specs/workbench/views.md 输出 22）：对真实 store（真实内核、`nbook.storage` 与 SQLite）走每一条改归属的提交路径，
 * 违反的整次拒绝、零写入；合法的照常收下；旧记录读入时只把受限视图分离出来。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import {moveTabToEdge, moveTabToStrip} from "@notnotype/nb-workbench-layout";
import type {LayoutDoc, PanelName} from "@notnotype/nb-workbench-layout";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {storageWorld} from "nbook/plugins/storage/testing/world";
import type {StorageWorld} from "nbook/plugins/storage/testing/world";

import type {ViewDeclaration} from "../../shared/views";
import {BUSY_LAYOUT_CATALOG, openLayoutDoc} from "../testing/layout-doc";
import type {ViewCatalog} from "../views/registry";
import {regionContainers, sectionLanding, viewSection} from "./containers";
import {INITIAL_EDITOR_PANEL} from "./default-tree";
import {createLayoutPolicy} from "./layout-constraints";
import type {LayoutDocStore} from "./layout-doc-store";
import {guardPlacement, placementViolations} from "./placement";

const POLICY = createLayoutPolicy();
const RAIL = "test.rail";
const RAIL_KEY = `view:${RAIL}`;
const RAIL_CONTAINER = `view:${RAIL}`;
const declaration = (confined: boolean): ViewDeclaration => ({title: {"zh-CN": "消息", "en-US": "Messages"}, icon: "i-rail", location: "auxiliarybar", layout: "scroll", order: 1, ...(confined ? {confinedTo: "auxiliarybar" as const} : {})});
/** 侧栏、右栏、底部面板各一个普通视图，右栏另有受限视图 `test.rail`（排在 `test.aux` 后面）。 */
const CONFINED: ViewCatalog = new Map([...BUSY_LAYOUT_CATALOG, [RAIL, declaration(true)]]);
/** 同一个视图没有限制：造违反的旧记录用。 */
const UNCONFINED: ViewCatalog = new Map([...BUSY_LAYOUT_CATALOG, [RAIL, declaration(false)]]);

let tmp = "";
let counter = 0;
const worlds: StorageWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-workbench", "placement");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function world(): Promise<StorageWorld> {
    counter += 1;
    const created = await storageWorld(join(tmp, `case-${String(counter)}`), []);
    worlds.push(created);
    return created;
}

const containersIn = (doc: LayoutDoc, region: PanelName): ReadonlyArray<readonly [string, ReadonlyArray<string>]> => regionContainers(doc, region).map((container) => [container.id, container.views] as const);

function sectionOf(store: LayoutDocStore, viewId: string): string {
    const section = viewSection(store.actions.document(), viewId);
    if (section === null) throw new Error(`${viewId} 不在区域里`);
    return section.panel;
}

/** 拒绝、零写入：文档还是同一个对象，没有排队的保存。 */
const saved = (store: LayoutDocStore) => waitUntil("保存完成", () => store.state.field.queue === 0);

function expectUntouched(store: LayoutDocStore, before: LayoutDoc): void {
    expect(store.actions.document()).toBe(before);
    expect(store.state.field.queue).toBe(0);
}

async function opened(catalog: ViewCatalog = CONFINED) {
    const w = await world();
    const {store} = await openLayoutDoc(w, "a", "c", false, catalog);
    return {w, store};
}

describe("默认布局", () => {
    it("受限视图在右栏、自己的隐式容器里一节；默认布局本身合法", async () => {
        const {store} = await opened();
        const doc = store.actions.document();
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]], [RAIL_CONTAINER, [RAIL]]]);
        expect(placementViolations(doc, CONFINED)).toEqual([]);
    });
});

describe("提交路径：违反的拒绝、零写入", () => {
    it("普通拖放：别的视图放进受限视图那一节的中央、受限视图拆到侧栏或编辑组旁边，都被拒绝", async () => {
        const {store} = await opened();
        const before = store.actions.document();
        const rail = sectionOf(store, RAIL);
        store.actions.commitDrop({kind: "tab", tab: "view:test.side"}, {kind: "center", panel: rail}, undefined, false);
        expectUntouched(store, before);
        store.actions.commitDrop({kind: "tab", tab: RAIL_KEY}, {kind: "edge", target: {kind: "split", panel: sectionOf(store, "test.side"), edge: "bottom"}}, undefined, false);
        expectUntouched(store, before);
        store.actions.commitDrop({kind: "tab", tab: RAIL_KEY}, {kind: "edge", target: {kind: "split", panel: INITIAL_EDITOR_PANEL, edge: "right"}}, undefined, false);
        expectUntouched(store, before);
        // 同一个落点换成普通视图就收下：拒绝来自位置限制，不是落点本身不合法。
        store.actions.commitDrop({kind: "tab", tab: "view:test.aux"}, {kind: "edge", target: {kind: "split", panel: sectionOf(store, "test.side"), edge: "bottom"}}, undefined, false);
        expect(store.actions.document()).not.toBe(before);
    });

    it("入口上的相邻并入：受限视图并进右栏相邻的容器、别的视图并进受限视图的容器，都被拒绝", async () => {
        const {store} = await opened();
        const before = store.actions.document();
        store.actions.commitDrop({kind: "tab", tab: RAIL_KEY}, {kind: "join-container", region: "auxiliarybar", container: "view:test.aux"}, undefined, false);
        expectUntouched(store, before);
        store.actions.commitDrop({kind: "tab", tab: "view:test.aux"}, {kind: "join-container", region: "auxiliarybar", container: RAIL_CONTAINER}, undefined, false);
        expectUntouched(store, before);
        store.actions.commitDrop({kind: "tab", tab: "view:test.side"}, {kind: "join-container", region: "auxiliarybar", container: RAIL_CONTAINER}, undefined, false);
        expectUntouched(store, before);
        // 受限视图拖到入口之间新建用户容器：不在自己的隐式容器里了。
        store.actions.commitDrop({kind: "tab", tab: RAIL_KEY}, {kind: "new-container", region: "auxiliarybar", container: "custom:fresh", before: null}, undefined, false);
        expectUntouched(store, before);
    });

    it("入口跨区搬移：受限视图的容器整个搬到侧栏、底部面板被拒绝；在右栏里换入口的位置照常", async () => {
        const {store} = await opened();
        const before = store.actions.document();
        for (const region of ["sidebar", "panel"] as const) {
            store.actions.commitDrop({kind: "container", container: RAIL_CONTAINER}, {kind: "move-container", region, container: RAIL_CONTAINER, before: null}, undefined, false);
            expectUntouched(store, before);
        }
        store.actions.commitDrop({kind: "container", container: RAIL_CONTAINER}, {kind: "move-entry", region: "auxiliarybar", container: RAIL_CONTAINER, before: "view:test.aux"}, undefined, false);
        expect(store.actions.document().panels.auxiliarybar?.entries).toEqual([RAIL_CONTAINER, "view:test.aux"]);
    });

    it("“移动到”两种目标：受限视图移进别的容器、新建容器，别的视图移进受限视图的容器，都被拒绝；试算与提交一致", async () => {
        const {store} = await opened();
        const before = store.actions.document();
        const refused = [
            [RAIL, {container: "view:test.aux"}],
            [RAIL, {container: "view:test.side"}],
            [RAIL, {newContainerIn: "auxiliarybar"}],
            [RAIL, {newContainerIn: "sidebar"}],
            ["test.side", {container: RAIL_CONTAINER}],
        ] as const;
        for (const [viewId, target] of refused) {
            expect(store.actions.permitsMoveView(viewId, target)).toBe(false);
            expect(store.actions.moveView(viewId, target)).toMatchObject({ok: false, code: "rejected"});
            expectUntouched(store, before);
        }
        expect(store.actions.permitsMoveView("test.side", {container: "view:test.aux"})).toBe(true);
        expect(store.actions.moveView("test.side", {container: "view:test.aux"}).ok).toBe(true);
    });

    it("整容器移动：受限视图的容器移到别的区域被拒绝，试算也是；别的容器照常", async () => {
        const {store} = await opened();
        const before = store.actions.document();
        for (const region of ["sidebar", "panel"] as const) {
            expect(store.actions.permitsMoveContainer(RAIL_CONTAINER, region)).toBe(false);
            expect(store.actions.moveContainer(RAIL_CONTAINER, region)).toMatchObject({ok: false, code: "rejected"});
            expect(store.actions.resetContainer(RAIL_CONTAINER, region)).toMatchObject({ok: false, code: "rejected"});
            expectUntouched(store, before);
        }
        expect(store.actions.permitsMoveContainer("view:test.aux", "panel")).toBe(true);
        expect(store.actions.moveContainer("view:test.aux", "panel").ok).toBe(true);
    });

    it("单标签浮出可以；别的标签放进它的窗被拒绝；它的窗回到停靠、重置位置都回到右栏自己的容器", async () => {
        const {store} = await opened();
        expect((await store.actions.floatTab(RAIL_KEY)).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.document().panels[float]?.tabs).toEqual([{kind: "view", viewId: RAIL}]);
        await saved(store);
        const before = store.actions.document();
        expect(store.actions.apply((doc) => moveTabToStrip(doc, {tab: "view:test.side", panel: float, index: 1}, POLICY))).toMatchObject({ok: false, code: "rejected"});
        store.actions.commitDrop({kind: "tab", tab: "view:test.aux"}, {kind: "center", panel: float}, undefined, false);
        expectUntouched(store, before);
        // 整个窗停进侧栏：窗里唯一的标签是受限视图，同样被拒绝。
        store.actions.commitDrop({kind: "panel", panel: float}, {kind: "edge", target: {kind: "split", panel: sectionOf(store, "test.side"), edge: "bottom"}}, undefined, false);
        expectUntouched(store, before);

        expect((await store.actions.dockFloat(float)).ok).toBe(true);
        expect(containersIn(store.actions.document(), "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]], [RAIL_CONTAINER, [RAIL]]]);
        expect((await store.actions.floatTab(RAIL_KEY)).ok).toBe(true);
        expect(store.actions.moveView(RAIL, {container: RAIL_CONTAINER}).ok).toBe(true);
        expect(containersIn(store.actions.document(), "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]], [RAIL_CONTAINER, [RAIL]]]);
    });

    it("多视图浮窗逐项归位：别的视图在受限视图的窗之外照常浮动、合窗与停靠，受限视图不受牵连", async () => {
        const {store} = await opened();
        expect((await store.actions.floatTab("view:test.side")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.apply((doc) => moveTabToStrip(doc, {tab: "view:test.aux", panel: float, index: 1}, POLICY)).ok).toBe(true);
        expect(placementViolations(store.actions.document(), CONFINED)).toEqual([]);
        // 受限视图放进这个多视图窗被拒绝。
        await saved(store);
        const before = store.actions.document();
        expect(store.actions.apply((doc) => moveTabToStrip(doc, {tab: RAIL_KEY, panel: float, index: 0}, POLICY))).toMatchObject({ok: false, code: "rejected"});
        expectUntouched(store, before);
        expect((await store.actions.dockFloat(float)).ok).toBe(true);
        const doc = store.actions.document();
        expect(containersIn(doc, "sidebar")).toEqual([["view:test.side", ["test.side"]]]);
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]], [RAIL_CONTAINER, [RAIL]]]);
    });
});

describe("关卡只放过原样留着的违反", () => {
    it("受限视图已经违反着（归整没修好）：不相干的写入照收；再把别的视图移进它的隐式容器是新的违反，拒", async () => {
        const {store} = await opened(UNCONFINED);
        expect((await store.actions.floatTab("view:test.side")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.apply((doc) => moveTabToStrip(doc, {tab: RAIL_KEY, panel: float, index: 1}, POLICY)).ok).toBe(true);
        const base = store.actions.document();
        expect(placementViolations(base, CONFINED)).toEqual([RAIL]);
        const unrelated = moveTabToEdge(base, {tab: "view:test.panel", target: {kind: "split", panel: sectionOf(store, "test.aux"), edge: "bottom"}, container: "view:test.aux"}, POLICY);
        expect(unrelated.ok).toBe(true);
        expect(guardPlacement(base, unrelated, CONFINED).ok).toBe(true);
        const target = sectionLanding(base, "auxiliarybar", RAIL_CONTAINER);
        if (target === null) throw new Error("右栏没有落点");
        const joined = moveTabToEdge(base, {tab: "view:test.panel", target, container: RAIL_CONTAINER}, POLICY);
        expect(joined.ok).toBe(true);
        expect(guardPlacement(base, joined, CONFINED)).toMatchObject({ok: false, code: "rejected"});
    });
});

describe("读入归整", () => {
    /** 用没有限制的目录造一份违反的记录：受限视图进了 `test.aux` 的容器，`test.panel` 进了受限视图的容器。存盘后在新窗口按受限的目录读。 */
    async function violatingRecord() {
        const {w, store} = await opened(UNCONFINED);
        expect(store.actions.moveView("test.panel", {container: RAIL_CONTAINER}).ok).toBe(true);
        expect(store.actions.moveView(RAIL, {container: "view:test.aux"}).ok).toBe(true);
        await store.actions.save();
        await saved(store);
        const stored = store.actions.document();
        expect(containersIn(stored, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux", RAIL]], [RAIL_CONTAINER, ["test.panel"]]]);
        return {w, stored};
    }

    it("违反的只把受限视图分离到右栏自己的容器，占了它容器的视图搬进一个新容器，其余原样；不写盘", async () => {
        const {w, stored} = await violatingRecord();
        const again = await openLayoutDoc(w, "b", "c", false, CONFINED);
        const doc = again.store.actions.document();
        expect(placementViolations(doc, CONFINED)).toEqual([]);
        expect(containersIn(doc, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]], [RAIL_CONTAINER, [RAIL]], [`custom:split-${RAIL}`, ["test.panel"]]]);
        expect(containersIn(doc, "sidebar")).toEqual(containersIn(stored, "sidebar"));
        expect(again.store.state.field.queue).toBe(0);
    });

    it("受限视图和别的视图在一个浮动窗里：搬回右栏自己的容器，窗里留下别的视图；每次重算得到同一份文档（新分节的 id 不随机）", async () => {
        const {w, store} = await opened(UNCONFINED);
        expect((await store.actions.floatTab("view:test.side")).ok).toBe(true);
        const float = store.actions.document().floats[0]?.panel ?? "";
        expect(store.actions.apply((doc) => moveTabToStrip(doc, {tab: RAIL_KEY, panel: float, index: 1}, POLICY)).ok).toBe(true);
        await store.actions.save();
        await saved(store);
        const again = await openLayoutDoc(w, "b", "c", false, CONFINED);
        const first = again.store.actions.document();
        expect(placementViolations(first, CONFINED)).toEqual([]);
        expect(containersIn(first, "auxiliarybar")).toEqual([["view:test.aux", ["test.aux"]], [RAIL_CONTAINER, [RAIL]]]);
        expect(first.panels[float]?.tabs).toEqual([{kind: "view", viewId: "test.side"}]);
        // 再交一次内容相同的目录：文档重算，搬回来的那一节还是同一个 id。
        again.store.actions.acceptViewCatalog(new Map(CONFINED));
        const second = again.store.actions.document();
        expect(second).not.toBe(first);
        expect(sectionOf(again.store, RAIL)).toBe(viewSection(first, RAIL)?.panel ?? "");
        expect(again.store.state.field.queue).toBe(0);
    });

    it("目录里还没有这个视图的声明：不知道它受限，按记录原样显示", async () => {
        const {w, stored} = await violatingRecord();
        const again = await openLayoutDoc(w, "b", "c", false, BUSY_LAYOUT_CATALOG);
        expect(containersIn(again.store.actions.document(), "auxiliarybar")).toEqual(containersIn(stored, "auxiliarybar"));
    });
});
