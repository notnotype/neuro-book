/**
 * 外壳三的意图与补丁边界（docs/specs/ui/workbench-shell.md 外壳三输出 19–21、“副作用与数据”的自建容器与半区、“状态与
 * 转换”的保存冲突政策）：纯函数。意图先合成补丁，再经 `applyPatch` 写回记录值，下一步从新记录重新求落位，与 store
 * 的用法一致；“另一个窗口”的写法是把补丁作用在一份别处改过的最新值上（store 保存冲突重放就是这样做的）。
 */

import {describe, expect, it} from "bun:test";

import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {Customizations} from "../state/records";
import {applyIntent, applyPatch} from "./intents";
import type {CustomizationsPatch, IntentResult, ViewIntent} from "./intents";
import {computePlacement, customContainerId} from "./placement";
import type {ViewCatalog} from "./placement";
import {buildPresentation} from "./presentation";

const view = (name: string, location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon: `i-${name}`, location, layout: "scroll", ...extra});

const catalog: ViewCatalog = new Map([
    ["t.a", view("A", "sidebar")],
    ["t.b", view("B", "sidebar", {order: 1})],
    ["t.c", view("C", "sidebar", {order: 2})],
    ["t.d", view("D", "panel")],
    ["t.e", view("E", "panel", {order: 1})],
    ["t.f", view("F", "auxiliarybar")],
    ["t.x", view("X", "auxiliarybar", {order: 1, movable: false})],
]);

function model(customizations: Customizations, hidden?: ReadonlySet<string>) {
    const placement = computePlacement(catalog, customizations);
    return {catalog, placement, presentation: buildPresentation({catalog, placement, customizations, hidden}), customizations};
}

function patchOf(customizations: Customizations, intent: ViewIntent, hidden?: ReadonlySet<string>): CustomizationsPatch {
    const result = applyIntent(model(customizations, hidden), intent);
    if (result.kind !== "patch") throw new Error(`没有补丁：${JSON.stringify(result)}`);
    return result.patch;
}

function step(customizations: Customizations, intent: ViewIntent, hidden?: ReadonlySet<string>): Customizations {
    return applyPatch(customizations, patchOf(customizations, intent, hidden), catalog).value;
}

function result(customizations: Customizations, intent: ViewIntent): IntentResult {
    return applyIntent(model(customizations), intent);
}

const N1 = customContainerId("11111111-1111-4111-8111-111111111111");
const N2 = customContainerId("22222222-2222-4222-8222-222222222222");

describe("自建容器", () => {
    it("拖出：建一个只装这个视图的容器、插在锚点之前并选中；身份与标题回落到 origin；搬空时清掉记录项与选中项", () => {
        let c = step({}, {kind: "detach-view", viewId: "t.b", sourceContainerId: "view:t.b", containerId: N1, targetPart: "panel", beforeContainerId: "view:t.e"});
        let m = model(c);
        expect(m.placement.parts.panel).toEqual(["view:t.d", N1, "view:t.e"]);
        expect(m.placement.selected.panel).toBe(N1);
        expect(m.presentation.containers.get(N1)).toMatchObject({members: ["t.b"], mode: "single"});
        expect(c.containers?.[N1]).toMatchObject({location: "panel", origin: "t.b"});
        // 把 B 再拖出成第二个自建容器：N1 搬空，记录项与选中项同次清掉。
        c = step(c, {kind: "detach-view", viewId: "t.b", sourceContainerId: N1, containerId: N2, targetPart: "auxiliarybar"});
        m = model(c);
        expect(c.containers?.[N1]).toBeUndefined();
        expect(c.selected?.panel).toBeUndefined();
        expect(m.placement.parts.auxiliarybar).toEqual(["view:t.f", "view:t.x", N2]);
        // 重置 B：回到 view:t.b，N2 搬空清掉。
        c = step(c, {kind: "reset-view", viewId: "t.b"});
        expect(c.containers ?? {}).toEqual({});
        expect(model(c).placement.parts.sidebar).toEqual(["view:t.a", "view:t.b", "view:t.c"]);
    });

    it("拒绝：不可移动、来源已变、id 不是新的自建容器、锚点不在目标 Part", () => {
        expect(result({}, {kind: "detach-view", viewId: "t.x", sourceContainerId: "view:t.x", containerId: N1, targetPart: "panel"})).toMatchObject({kind: "rejected", code: "not-movable"});
        expect(result({}, {kind: "detach-view", viewId: "t.a", sourceContainerId: "view:t.b", containerId: N1, targetPart: "panel"})).toMatchObject({kind: "rejected", code: "stale-source"});
        expect(result({}, {kind: "detach-view", viewId: "t.a", sourceContainerId: "view:t.a", containerId: "view:t.a", targetPart: "panel"})).toMatchObject({kind: "rejected", code: "invalid"});
        expect(result({}, {kind: "detach-view", viewId: "t.a", sourceContainerId: "view:t.a", containerId: N1, targetPart: "panel", beforeContainerId: "view:t.f"})).toMatchObject({kind: "rejected", code: "invalid"});
    });

    it("记录里有成员却没有记录项的自建容器：成员回默认位置并诊断；没有成员的自建容器项只诊断不删", () => {
        const m = model({views: {"t.a": {container: N1, order: 0, fingerprint: "sidebar#0"}}, containers: {[N2]: {location: "panel", order: 0, origin: "t.d"}}});
        expect(m.placement.views.get("t.a")?.container).toBe("view:t.a");
        expect(m.placement.diagnostics.filter((line) => line.includes(N1) || line.includes(N2))).toHaveLength(2);
    });
});

describe("补丁边界：保存冲突重放（另一个窗口改过的最新值）", () => {
    it("同一 UUID 的补丁重放两次：不新增容器、不改它的身份", () => {
        const patch = patchOf({}, {kind: "detach-view", viewId: "t.a", sourceContainerId: "view:t.a", containerId: N1, targetPart: "panel"});
        const once = applyPatch({}, patch, catalog).value;
        const twice = applyPatch(once, patch, catalog).value;
        expect(twice).toEqual(once);
        expect(Object.keys(twice.containers ?? {})).toEqual([N1]);
    });

    it("目标自建容器已被另一个窗口搬空清掉：普通移动按补丁带的身份重建它", () => {
        const base = step({}, {kind: "detach-view", viewId: "t.a", sourceContainerId: "view:t.a", containerId: N1, targetPart: "panel"});
        const patch = patchOf(base, {kind: "move-view", viewId: "t.b", sourceContainerId: "view:t.b", targetContainerId: N1});
        // 别处：把 A 重置回去，N1 搬空被清掉。
        const elsewhere = step(base, {kind: "reset-view", viewId: "t.a"});
        expect(elsewhere.containers?.[N1]).toBeUndefined();
        const replayed = applyPatch(elsewhere, patch, catalog).value;
        expect(model(replayed).placement.containers.get(N1)).toMatchObject({part: "panel", members: ["t.b"]});
    });

    it("来源自建容器在最新值里还有别的成员：不删它", () => {
        let base = step({}, {kind: "detach-view", viewId: "t.a", sourceContainerId: "view:t.a", containerId: N1, targetPart: "panel"});
        const patch = patchOf(base, {kind: "move-view", viewId: "t.a", sourceContainerId: N1, targetContainerId: "view:t.d"});
        // 别处：把 C 移进 N1。
        base = step(base, {kind: "move-view", viewId: "t.c", sourceContainerId: "view:t.c", targetContainerId: N1});
        const replayed = applyPatch(base, patch, catalog).value;
        expect(model(replayed).placement.containers.get(N1)?.members).toEqual(["t.c"]);
        expect(replayed.containers?.[N1]).toBeDefined();
    });

    it("最新值里视图已被另一个窗口拖进自建容器：本次移动（后保存胜出）把它带走后，搬空的自建容器同次清掉", () => {
        const patch = patchOf({}, {kind: "move-view", viewId: "t.a", sourceContainerId: "view:t.a", targetContainerId: "view:t.d"});
        const elsewhere = step({}, {kind: "detach-view", viewId: "t.a", sourceContainerId: "view:t.a", containerId: N1, targetPart: "auxiliarybar"});
        const replayed = applyPatch(elsewhere, patch, catalog).value;
        expect(model(replayed).placement.views.get("t.a")?.container).toBe("view:t.d");
        expect(replayed.containers?.[N1]).toBeUndefined();
        expect(replayed.selected?.auxiliarybar).toBeUndefined();
    });

    it("带半区的并入：目标在最新值里换了 Part（轴变了）或命中视图被移走，整条不写", () => {
        const base = step({}, {kind: "move-view", viewId: "t.e", sourceContainerId: "view:t.e", targetContainerId: "view:t.d"});
        const patch = patchOf(base, {kind: "move-view", viewId: "t.a", sourceContainerId: "view:t.a", targetContainerId: "view:t.d", split: {hitViewId: "t.e", side: "after", sourceSizes: {"t.a": 1}}});
        const moved = step(base, {kind: "move-container", containerId: "view:t.d", sourcePart: "panel", targetPart: "sidebar"});
        const outcome = applyPatch(moved, patch, catalog);
        expect(outcome.problem).not.toBeNull();
        expect(outcome.value).toEqual(moved);
        const hitGone = step(base, {kind: "reset-view", viewId: "t.e"});
        expect(applyPatch(hitGone, patch, catalog).problem).not.toBeNull();
        expect(applyPatch(base, patch, catalog).problem).toBeNull();
    });

    it("容器换序只写容器的位置字段；另一个窗口改的视图归属与选中项保留", () => {
        const patch = patchOf({}, {kind: "move-container", containerId: "view:t.c", sourcePart: "sidebar", targetPart: "sidebar", beforeContainerId: "view:t.a"});
        const elsewhere: Customizations = {views: {"t.b": {container: "view:t.a", order: 1, fingerprint: "sidebar#1"}}, selected: {panel: "view:t.e"}};
        const replayed = applyPatch(elsewhere, patch, catalog).value;
        expect(replayed.views).toEqual(elsewhere.views);
        expect(replayed.selected).toEqual(elsewhere.selected);
        expect(model(replayed).placement.parts.sidebar).toEqual(["view:t.c", "view:t.a"]);
    });
});

describe("移动与并入", () => {
    it("整容器迁到另一个 Part 并选中；原位为无变化；来源 Part 已变为 stale-source", () => {
        const c = step({}, {kind: "move-container", containerId: "view:t.a", sourcePart: "sidebar", targetPart: "panel", beforeContainerId: "view:t.e"});
        const m = model(c);
        expect(m.placement.parts.panel).toEqual(["view:t.d", "view:t.a", "view:t.e"]);
        expect(m.placement.selected.panel).toBe("view:t.a");
        expect(m.presentation.containers.get("view:t.a")?.axis).toBe("horizontal");
        expect(result({}, {kind: "move-container", containerId: "view:t.b", sourcePart: "sidebar", targetPart: "sidebar", beforeContainerId: "view:t.c"})).toEqual({kind: "unchanged"});
        expect(result({}, {kind: "move-container", containerId: "view:t.b", sourcePart: "sidebar", targetPart: "sidebar"})).toMatchObject({kind: "patch"});
        expect(result({}, {kind: "move-container", containerId: "view:t.a", sourcePart: "panel", targetPart: "sidebar"})).toMatchObject({kind: "rejected", code: "stale-source"});
    });

    it("同一容器内的插入只改顺序，不写尺寸；带半区时也只改顺序", () => {
        const merged = step(step({}, {kind: "move-view", viewId: "t.b", sourceContainerId: "view:t.b", targetContainerId: "view:t.a"}), {kind: "move-view", viewId: "t.c", sourceContainerId: "view:t.c", targetContainerId: "view:t.a"});
        const reordered = step(merged, {kind: "move-view", viewId: "t.c", sourceContainerId: "view:t.a", targetContainerId: "view:t.a", split: {hitViewId: "t.a", side: "before", sourceSizes: {"t.c": 1}}});
        expect(model(reordered).placement.containers.get("view:t.a")?.members).toEqual(["t.c", "t.a", "t.b"]);
        for (const id of ["t.a", "t.b", "t.c"]) {
            expect(reordered.views?.[id]?.height).toBeUndefined();
            expect(reordered.views?.[id]?.width).toBeUndefined();
        }
        // 已经紧贴目标侧：原位，不提交。
        expect(result(reordered, {kind: "move-view", viewId: "t.c", sourceContainerId: "view:t.a", targetContainerId: "view:t.a", split: {hitViewId: "t.a", side: "before", sourceSizes: {"t.c": 1}}})).toEqual({kind: "unchanged"});
    });

    it("半区（Spec 输出 21 的例子）：A、B、C、D 各 25%，等比 E、F 并到 D 后缘 → D 12.5%、E/F 各 6.25%；E:F 为 3:1 → 9.375% 与 3.125%；其它成员与另一轴不变", () => {
        // 面板里 A、B、C、D 四个同意图的视图；E、F 在另一个容器（右栏）。
        const panelCatalog: ViewCatalog = new Map([
            ["p.a", view("A", "panel")], ["p.b", view("B", "panel", {order: 1})], ["p.c", view("C", "panel", {order: 2})], ["p.d", view("D", "panel", {order: 3})],
            ["p.e", view("E", "auxiliarybar")], ["p.f", view("F", "auxiliarybar", {order: 1})],
        ]);
        const build = (c: Customizations) => {
            const placement = computePlacement(panelCatalog, c);
            return {catalog: panelCatalog, placement, presentation: buildPresentation({catalog: panelCatalog, placement, customizations: c}), customizations: c};
        };
        const go = (c: Customizations, intent: ViewIntent): Customizations => {
            const r = applyIntent(build(c), intent);
            if (r.kind !== "patch") throw new Error(JSON.stringify(r));
            return applyPatch(c, r.patch, panelCatalog).value;
        };
        let base: Customizations = {views: {"p.a": {width: 100}, "p.b": {width: 100}, "p.c": {width: 100}, "p.d": {width: 100, height: 77}}};
        for (const id of ["p.b", "p.c", "p.d"]) base = go(base, {kind: "move-view", viewId: id, sourceContainerId: `view:${id}`, targetContainerId: "view:p.a"});
        base = go(base, {kind: "move-view", viewId: "p.f", sourceContainerId: "view:p.f", targetContainerId: "view:p.e"});
        const share = (c: Customizations, ids: ReadonlyArray<string>) => {
            const widths = ids.map((id) => c.views?.[id]?.width ?? 240);
            const total = widths.reduce((sum, w) => sum + w, 0);
            return widths.map((w) => w / total);
        };
        const order = ["p.a", "p.b", "p.c", "p.d", "p.e", "p.f"];
        const even = go(base, {kind: "merge-container", sourceContainerId: "view:p.e", targetContainerId: "view:p.a", sourceViewIds: ["p.e", "p.f"], split: {hitViewId: "p.d", side: "after", sourceSizes: {"p.e": 50, "p.f": 50}}});
        expect(build(even).placement.containers.get("view:p.a")?.members).toEqual(order);
        expect(share(even, order)).toEqual([0.25, 0.25, 0.25, 0.125, 0.0625, 0.0625]);
        expect(even.views?.["p.d"]?.height).toBe(77);
        expect(even.views?.["p.a"]).toMatchObject({width: 100});
        const skewed = go(base, {kind: "merge-container", sourceContainerId: "view:p.e", targetContainerId: "view:p.a", sourceViewIds: ["p.e", "p.f"], split: {hitViewId: "p.d", side: "after", sourceSizes: {"p.e": 300, "p.f": 100}}});
        expect(share(skewed, order)).toEqual([0.25, 0.25, 0.25, 0.125, 0.09375, 0.03125]);
    });

    it("整组并入：成员快照对不上（例如隐藏成员没进快照）整组拒绝；不可移动成员整组拒绝；隐藏成员跟着归属走但不分尺寸", () => {
        const base = step({}, {kind: "move-view", viewId: "t.b", sourceContainerId: "view:t.b", targetContainerId: "view:t.a"});
        expect(result(base, {kind: "merge-container", sourceContainerId: "view:t.a", targetContainerId: "view:t.d", sourceViewIds: ["t.a"]})).toMatchObject({kind: "rejected", code: "stale-source"});
        const withFixed = step({}, {kind: "move-view", viewId: "t.f", sourceContainerId: "view:t.f", targetContainerId: "view:t.x"});
        expect(result(withFixed, {kind: "merge-container", sourceContainerId: "view:t.x", targetContainerId: "view:t.d", sourceViewIds: ["t.x", "t.f"]})).toMatchObject({kind: "rejected", code: "not-movable"});
        const hidden = new Set(["t.b"]);
        const patch = patchOf(base, {kind: "merge-container", sourceContainerId: "view:t.a", targetContainerId: "view:t.d", sourceViewIds: ["t.a", "t.b"], split: {hitViewId: "t.d", side: "after", sourceSizes: {"t.a": 1}}}, hidden);
        const merged = applyPatch(base, patch, catalog).value;
        expect(model(merged).placement.containers.get("view:t.d")?.members).toEqual(["t.d", "t.a", "t.b"]);
        expect(merged.views?.["t.b"]?.width).toBeUndefined();
        // 命中的 D 没记录过尺寸（240）：保留 120，唯一可见的拖入成员 A 拿另一半 120。
        expect(merged.views?.["t.d"]?.width).toBe(120);
        expect(merged.views?.["t.a"]?.width).toBe(120);
        expect(model(merged).placement.selected.panel).toBe("view:t.d");
    });

    it("落在全收起容器的剩余区：拖入成员同次展开，原有细条保持收起", () => {
        let base = step({}, {kind: "move-view", viewId: "t.e", sourceContainerId: "view:t.e", targetContainerId: "view:t.d"});
        base = step(base, {kind: "set-view-collapsed", viewId: "t.d", collapsed: true});
        base = step(base, {kind: "set-view-collapsed", viewId: "t.e", collapsed: true});
        // 甲在侧栏 B 的容器里收起过：拖进剩余区时清掉它的收起。
        base = step(base, {kind: "move-view", viewId: "t.b", sourceContainerId: "view:t.b", targetContainerId: "view:t.a"});
        base = step(base, {kind: "set-view-collapsed", viewId: "t.a", collapsed: true});
        const landed = step(base, {kind: "move-view", viewId: "t.a", sourceContainerId: "view:t.a", targetContainerId: "view:t.d", expand: true});
        expect(landed.views?.["t.a"]?.collapsed).toBeUndefined();
        expect(landed.views?.["t.d"]?.collapsed).toBe(true);
        expect(landed.views?.["t.e"]?.collapsed).toBe(true);
    });
});
