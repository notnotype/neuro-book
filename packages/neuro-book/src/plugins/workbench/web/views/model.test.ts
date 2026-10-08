/**
 * 落位、呈现与意图合成（docs/specs/ui/workbench-shell.md 外壳二，外壳设计稿第 3 节典型情况表）：纯函数，逐行走
 * 设计稿的表。意图先合成补丁，再经 `applyPatch` 写回记录值，下一步从新记录重新求落位，与 store 的用法一致。
 */

import {describe, expect, it} from "bun:test";

import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {Customizations} from "../state/records";
import {applyIntent, applyPatch} from "./intents";
import type {IntentResult, ViewIntent} from "./intents";
import {computePlacement, defaultFingerprint} from "./placement";
import type {ViewCatalog} from "./placement";
import {buildPresentation, moveTargetsOf} from "./presentation";

function view(location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration {
    return {title: {"zh-CN": "视图", "en-US": "View"}, icon: "i-lucide-square", location, layout: "scroll", ...extra};
}

function titled(name: string, location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration {
    return view(location, {title: {"zh-CN": name, "en-US": name}, icon: `i-${name}`, ...extra});
}

function catalogOf(entries: Record<string, ViewDeclaration>): ViewCatalog {
    return new Map(Object.entries(entries));
}

function model(catalog: ViewCatalog, customizations: Customizations, hidden?: ReadonlySet<string>) {
    const placement = computePlacement(catalog, customizations);
    const presentation = buildPresentation({catalog, placement, customizations, hidden});
    return {catalog, placement, presentation, customizations};
}

/** 合成一次意图并写回；被拒或无变化时原值不动。 */
function act(catalog: ViewCatalog, customizations: Customizations, intent: ViewIntent): {readonly result: IntentResult; readonly next: Customizations} {
    const result = applyIntent(model(catalog, customizations), intent);
    return {result, next: result.kind === "patch" ? applyPatch(customizations, result.patch) : customizations};
}

function patched(catalog: ViewCatalog, customizations: Customizations, intent: ViewIntent): Customizations {
    const {result, next} = act(catalog, customizations, intent);
    expect(result.kind).toBe("patch");
    return next;
}

const A = "test.a";
const B = "test.b";
const C = "test.c";

describe("设计稿第 3 节典型情况", () => {
    const catalog = catalogOf({[A]: titled("A", "sidebar"), [B]: titled("B", "sidebar", {order: 1}), [C]: titled("C", "panel")});

    it("初始：每个视图在自己的隐式容器，各占一个入口", () => {
        const {placement, presentation} = model(catalog, {});
        expect(placement.parts.sidebar).toEqual(["view:test.a", "view:test.b"]);
        expect(placement.parts.panel).toEqual(["view:test.c"]);
        expect(placement.selected).toEqual({sidebar: "view:test.a", auxiliarybar: null, panel: "view:test.c"});
        expect(presentation.parts.sidebar.switcher.map((item) => item.title["zh-CN"])).toEqual(["A", "B"]);
        // 容器标题行只在 Sidebar 的 single 出现；Panel 与右栏用标签带。
        expect(presentation.containers.get("view:test.a")).toMatchObject({mode: "single", showContainerTitle: true});
        expect(presentation.containers.get("view:test.c")).toMatchObject({mode: "single", showContainerTitle: false});
        expect(placement.diagnostics).toEqual([]);
    });

    it("B 进 view:A → A 移走 → 刷新 → 重置 A → 重置 B", () => {
        const step1 = patched(catalog, {}, {kind: "move-view", viewId: B, sourceContainerId: "view:test.b", targetContainerId: "view:test.a"});
        let {placement, presentation} = model(catalog, step1);
        // view:B 没有实际成员，从 Switcher 消失；view:A 两个成员，模式 multiple。
        expect(placement.parts.sidebar).toEqual(["view:test.a"]);
        expect(presentation.containers.get("view:test.a")).toMatchObject({mode: "multiple", members: [A, B], showContainerTitle: false});

        const step2 = patched(catalog, step1, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
        ({placement, presentation} = model(catalog, step2));
        // view:A 仍含 B，入口保留、id 不变，标题回落到 B。
        expect(placement.parts.sidebar).toEqual(["view:test.a"]);
        expect(presentation.containers.get("view:test.a")).toMatchObject({mode: "single", members: [B], title: {"zh-CN": "B", "en-US": "B"}, icon: "i-B", showContainerTitle: true});
        expect(presentation.containers.get("view:test.c")?.members).toEqual([C, A]);
        expect(placement.selected.panel).toBe("view:test.c");

        // 刷新：同一份记录求出同样的结果。
        expect(model(catalog, structuredClone(step2)).placement).toEqual(placement);

        const step3 = patched(catalog, step2, {kind: "reset-view", viewId: A});
        ({placement, presentation} = model(catalog, step3));
        expect(presentation.containers.get("view:test.a")?.members).toEqual([A, B]);
        expect(placement.parts.panel).toEqual(["view:test.c"]);
        expect(placement.selected.sidebar).toBe("view:test.a");

        const step4 = patched(catalog, step3, {kind: "reset-view", viewId: B});
        ({placement} = model(catalog, step4));
        expect(placement.parts.sidebar).toEqual(["view:test.a", "view:test.b"]);
        expect(step4.views).toBeUndefined();
    });

    it("A 离开后操作 view:A 的目标：B 不随 A 移动", () => {
        const step1 = patched(catalog, {}, {kind: "move-view", viewId: B, sourceContainerId: "view:test.b", targetContainerId: "view:test.a"});
        const step2 = patched(catalog, step1, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
        const step3 = patched(catalog, step2, {kind: "move-view", viewId: A, sourceContainerId: "view:test.c", targetContainerId: "view:test.a"});
        const {placement} = model(catalog, step3);
        expect(placement.containers.get("view:test.a")?.members).toEqual([A, B]);
        // 回到自己的隐式容器就是默认位置：覆盖被删除而不是写一条等于默认的覆盖。
        expect(step3.views?.[A]).toBeUndefined();
        expect(placement.views.get(B)).toMatchObject({container: "view:test.a", source: "record"});
    });

    it("A 的声明消失：view:A 若仍有 B 则保留，标题回落到 B；B 默认在别的 Part 且没有容器覆盖时回落到 B 的默认位置", () => {
        const wide = catalogOf({[A]: titled("A", "sidebar"), [B]: titled("B", "panel"), [C]: titled("C", "panel")});
        const moved = patched(wide, {}, {kind: "move-view", viewId: B, sourceContainerId: "view:test.b", targetContainerId: "view:test.a"});
        expect(model(wide, moved).placement.containers.get("view:test.a")?.part).toBe("sidebar");

        const withoutA = catalogOf({[B]: titled("B", "panel"), [C]: titled("C", "panel")});
        const {placement, presentation} = model(withoutA, moved);
        expect(placement.containers.get("view:test.a")).toMatchObject({part: "panel", source: "member", members: [B]});
        expect(presentation.containers.get("view:test.a")?.title["zh-CN"]).toBe("B");
        expect(placement.diagnostics.filter((line) => line.includes("view:test.a"))).toHaveLength(1);
        // 刷新后身份、归属与区域一致。
        expect(model(withoutA, structuredClone(moved)).placement).toEqual(placement);
    });

    it("A 的声明消失但容器有位置覆盖：照用覆盖", () => {
        const withoutA = catalogOf({[B]: titled("B", "panel")});
        const customizations: Customizations = {
            views: {[B]: {container: "view:test.a", order: 1, fingerprint: defaultFingerprint(titled("B", "panel"))}},
            containers: {"view:test.a": {location: "auxiliarybar", order: 3, fingerprint: "sidebar#0"}},
        };
        expect(model(withoutA, customizations).placement.containers.get("view:test.a")).toMatchObject({part: "auxiliarybar", source: "record"});
    });

    it("A 改了默认位置：基于旧默认的视图与容器覆盖失效，回到新默认并诊断，原件不删", () => {
        const step1 = patched(catalog, {}, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
        const withContainer: Customizations = {...step1, containers: {"view:test.a": {location: "auxiliarybar", order: 0, fingerprint: defaultFingerprint(titled("A", "sidebar"))}}};
        const upgraded = catalogOf({[A]: titled("A", "auxiliarybar", {order: 5}), [B]: titled("B", "sidebar"), [C]: titled("C", "panel")});
        const {placement} = model(upgraded, withContainer);
        expect(placement.views.get(A)).toMatchObject({container: "view:test.a", source: "default"});
        expect(placement.containers.get("view:test.a")).toMatchObject({part: "auxiliarybar", order: 5, source: "default"});
        // 视图覆盖与容器覆盖各诊断一次。
        expect(placement.diagnostics).toHaveLength(2);
        expect(withContainer.views?.[A]?.container).toBe("view:test.c");
    });
});

describe("呈现模型", () => {
    it("模式：隐藏不计数、收起计数；single 不应用收起也不改保存值；Sidebar 只在 single 画容器标题行", () => {
        const catalog = catalogOf({[A]: titled("A", "sidebar"), [B]: titled("B", "sidebar")});
        const merged = patched(catalog, {}, {kind: "move-view", viewId: B, sourceContainerId: "view:test.b", targetContainerId: "view:test.a"});
        const collapsedA = patched(catalog, merged, {kind: "set-view-collapsed", viewId: A, collapsed: true});
        expect(model(catalog, collapsedA).presentation.containers.get("view:test.a")?.views.map((slot) => slot.collapsed)).toEqual([true, false]);

        // 移出 B（view:test.b 此时没有成员，不是移动目标，B 经“重置位置”回去）：A 在 single 时展开，记录里的收起不变。
        expect(act(catalog, collapsedA, {kind: "move-view", viewId: B, sourceContainerId: "view:test.a", targetContainerId: "view:test.b"}).result).toMatchObject({kind: "rejected", code: "unknown-container"});
        const back = patched(catalog, collapsedA, {kind: "reset-view", viewId: B});
        const singleView = model(catalog, back).presentation.containers.get("view:test.a")!;
        expect(singleView).toMatchObject({mode: "single", showContainerTitle: true});
        expect(singleView.views[0]?.collapsed).toBe(false);
        expect(back.views?.[A]?.collapsed).toBe(true);
        expect(act(catalog, back, {kind: "set-view-collapsed", viewId: A, collapsed: false}).result.kind).toBe("rejected");

        // B 回来后 A 重新收起。
        const again = patched(catalog, back, {kind: "move-view", viewId: B, sourceContainerId: "view:test.b", targetContainerId: "view:test.a"});
        expect(model(catalog, again).presentation.containers.get("view:test.a")?.views.map((slot) => slot.collapsed)).toEqual([true, false]);

        // 隐藏不计数：两个成员隐藏一个是 single；全部隐藏时容器仍在（empty），标题取首个实际成员。
        expect(model(catalog, again, new Set([B])).presentation.containers.get("view:test.a")?.mode).toBe("single");
        const empty = model(catalog, again, new Set([A, B])).presentation.containers.get("view:test.a")!;
        expect(empty).toMatchObject({mode: "empty", members: [A, B], views: []});
        expect(empty.title["zh-CN"]).toBe("A");
        // 标题取首个可见成员。
        expect(model(catalog, again, new Set([A])).presentation.containers.get("view:test.a")?.title["zh-CN"]).toBe("B");
    });

    it("轴与尺寸：侧栏纵向取高度、Panel 横向取宽度；最小值按声明与下限求", () => {
        const catalog = catalogOf({[A]: titled("A", "sidebar", {minimumSize: {height: 10}}), [C]: titled("C", "panel", {minimumSize: {width: 100}, maximumSize: {width: 400}})});
        const customizations: Customizations = {views: {[A]: {height: 120, width: 999}, [C]: {width: 250}}};
        const {presentation} = model(catalog, customizations);
        expect(presentation.containers.get("view:test.a")).toMatchObject({axis: "vertical", views: [{size: 120, minSize: 33}]});
        expect(presentation.containers.get("view:test.c")).toMatchObject({axis: "horizontal", views: [{size: 250, minSize: 100, maxSize: 400}]});
        expect(presentation.parts.panel.axis).toBe("horizontal");
    });

    it("未知引用只在呈现中忽略并诊断，原件不删；别的意图写回时原件仍在", () => {
        const catalog = catalogOf({[A]: titled("A", "sidebar"), [B]: titled("B", "sidebar")});
        const customizations: Customizations = {
            views: {
                "gone.view": {container: "view:gone.view", order: 0, fingerprint: "sidebar#0", height: 100},
                [B]: {container: "custom:123", order: 1, fingerprint: defaultFingerprint(titled("B", "sidebar"))},
            },
            containers: {"view:gone.other": {location: "panel", order: 0, fingerprint: "panel#0"}},
            selected: {sidebar: "view:missing"},
        };
        const {placement} = model(catalog, customizations);
        expect(placement.parts.sidebar).toEqual(["view:test.a", "view:test.b"]);
        expect(placement.selected.sidebar).toBe("view:test.a");
        // 三条未知引用各诊断一次（只看点到的是哪一项，不看措辞）。
        expect(placement.diagnostics.map((line) => ["custom:123", "gone.view", "view:gone.other"].find((id) => line.includes(id)))).toEqual(["custom:123", "gone.view", "view:gone.other"]);
        const next = patched(catalog, customizations, {kind: "select-container", part: "sidebar", containerId: "view:test.b"});
        expect(next.views?.["gone.view"]).toEqual(customizations.views?.["gone.view"]);
        expect(next.containers).toEqual(customizations.containers);
    });

    it("移动目标：除来源外的全部容器，含同一 Part 的，按 Part 分组；不在默认位置时可重置；不可移动没有目标表", () => {
        const catalog = catalogOf({[A]: titled("A", "sidebar"), [B]: titled("B", "sidebar"), [C]: titled("C", "panel"), "test.d": titled("D", "sidebar", {movable: false})});
        let state = model(catalog, {});
        expect(moveTargetsOf(state.presentation, state.placement, catalog, A)).toEqual({
            viewId: A,
            sourceContainerId: "view:test.a",
            groups: [
                {part: "sidebar", targets: [{containerId: "view:test.b", title: {"zh-CN": "B", "en-US": "B"}, icon: "i-B"}, {containerId: "view:test.d", title: {"zh-CN": "D", "en-US": "D"}, icon: "i-D"}]},
                {part: "panel", targets: [{containerId: "view:test.c", title: {"zh-CN": "C", "en-US": "C"}, icon: "i-C"}]},
            ],
            canReset: false,
        });
        expect(moveTargetsOf(state.presentation, state.placement, catalog, "test.d")).toBeNull();
        state = model(catalog, patched(catalog, {}, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.b"}));
        expect(moveTargetsOf(state.presentation, state.placement, catalog, A)?.canReset).toBe(true);
    });
});

describe("意图合成", () => {
    const catalog = catalogOf({[A]: titled("A", "sidebar"), [B]: titled("B", "sidebar"), [C]: titled("C", "panel"), "test.d": titled("D", "sidebar", {movable: false})});

    it("移动：来源已变为 stale-source、目标不存在、不可移动都整批拒绝；目标即当前为无变化", () => {
        expect(act(catalog, {}, {kind: "move-view", viewId: A, sourceContainerId: "view:test.b", targetContainerId: "view:test.c"}).result).toMatchObject({kind: "rejected", code: "stale-source"});
        expect(act(catalog, {}, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:nope"}).result).toMatchObject({kind: "rejected", code: "unknown-container"});
        expect(act(catalog, {}, {kind: "move-view", viewId: "test.d", sourceContainerId: "view:test.d", targetContainerId: "view:test.a"}).result).toMatchObject({kind: "rejected", code: "not-movable"});
        expect(act(catalog, {}, {kind: "move-view", viewId: "nope.x", sourceContainerId: "view:nope.x", targetContainerId: "view:test.a"}).result).toMatchObject({kind: "rejected", code: "unknown-view"});
        expect(act(catalog, {}, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.a"}).result).toEqual({kind: "unchanged"});
    });

    it("移动的补丁只含被移动的视图与目标 Part 的选中项；重放到另一窗口改过的最新值上，对方的字段保留", () => {
        const {result} = act(catalog, {}, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
        expect(result).toEqual({kind: "patch", patch: {
            views: {[A]: {placement: {container: "view:test.c", order: 1, fingerprint: "sidebar#0"}}},
            selected: {panel: "view:test.c"},
        }});
        const other: Customizations = {panel: {position: "left"}, views: {[B]: {height: 300}}, futureField: 1} as Customizations;
        const replayed = applyPatch(other, (result as Extract<IntentResult, {kind: "patch"}>).patch);
        expect(replayed).toEqual({
            panel: {position: "left"},
            views: {[B]: {height: 300}, [A]: {container: "view:test.c", order: 1, fingerprint: "sidebar#0"}},
            selected: {panel: "view:test.c"},
            futureField: 1,
        } as Customizations);
        // 同字段后保存胜出：另一窗口先把 A 移去了 view:test.b，本窗口的补丁重放后 A 在 view:test.c。
        const conflicting: Customizations = {views: {[A]: {container: "view:test.b", order: 1, fingerprint: "sidebar#0", height: 90}}};
        expect(applyPatch(conflicting, (result as Extract<IntentResult, {kind: "patch"}>).patch).views?.[A]).toEqual({container: "view:test.c", order: 1, fingerprint: "sidebar#0", height: 90});
    });

    it("顺序越界时只重排目标容器的成员", () => {
        const crowded: Customizations = {views: {[B]: {container: "view:test.c", order: 1_000_000, fingerprint: "sidebar#0"}}};
        const next = patched(catalog, crowded, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
        expect(model(catalog, next).placement.containers.get("view:test.c")?.members).toEqual([C, B, A]);
        expect(next.views?.[A]?.order).toBe(3);
        expect(next.views?.["test.d"]).toBeUndefined();

        // 重放到另一个窗口改过的最新值：乙已被那边移进 view:test.a，重排只改顺序，不把乙搬回来。
        const {result} = act(catalog, crowded, {kind: "move-view", viewId: A, sourceContainerId: "view:test.a", targetContainerId: "view:test.c"});
        const elsewhere: Customizations = {views: {[B]: {container: "view:test.a", order: 1, fingerprint: "sidebar#0", height: 88}}};
        const replayed = applyPatch(elsewhere, (result as Extract<IntentResult, {kind: "patch"}>).patch);
        expect(replayed.views?.[B]).toEqual({container: "view:test.a", order: 1, fingerprint: "sidebar#0", height: 88});
        expect(replayed.views?.[A]?.container).toBe("view:test.c");
    });

    it("视图尺寸：只写主动叶的当前轴；换轴的迟到提交被拒；任一非法值整批拒绝；同值无变化；越界夹取", () => {
        const merged = patched(catalog, {}, {kind: "move-view", viewId: B, sourceContainerId: "view:test.b", targetContainerId: "view:test.a"});
        const sized = patched(catalog, merged, {kind: "set-view-sizes", containerId: "view:test.a", axis: "vertical", sizes: {[A]: 180}});
        expect(sized.views?.[A]).toEqual({height: 180});
        expect(act(catalog, sized, {kind: "set-view-sizes", containerId: "view:test.a", axis: "vertical", sizes: {[A]: 180}}).result).toEqual({kind: "unchanged"});
        expect(act(catalog, sized, {kind: "set-view-sizes", containerId: "view:test.a", axis: "horizontal", sizes: {[A]: 50}}).result).toMatchObject({kind: "rejected", code: "axis-changed"});
        expect(act(catalog, sized, {kind: "set-view-sizes", containerId: "view:test.a", axis: "vertical", sizes: {[A]: 200, [B]: 0}}).result).toMatchObject({kind: "rejected", code: "invalid"});
        expect(act(catalog, sized, {kind: "set-view-sizes", containerId: "view:test.a", axis: "vertical", sizes: {[C]: 200}}).result).toMatchObject({kind: "rejected", code: "invalid"});
        expect(patched(catalog, sized, {kind: "set-view-sizes", containerId: "view:test.a", axis: "vertical", sizes: {[B]: 5}}).views?.[B]?.height).toBe(64);
    });

    it("选中容器：只能选该 Part 里的容器；已选中为无变化", () => {
        expect(act(catalog, {}, {kind: "select-container", part: "sidebar", containerId: "view:test.c"}).result).toMatchObject({kind: "rejected", code: "unknown-container"});
        const next = patched(catalog, {}, {kind: "select-container", part: "sidebar", containerId: "view:test.b"});
        expect(next).toEqual({selected: {sidebar: "view:test.b"}});
        expect(act(catalog, next, {kind: "select-container", part: "sidebar", containerId: "view:test.b"}).result).toEqual({kind: "unchanged"});
    });

    it("重置：视图回到隐式容器并选中它所在的 Part；容器覆盖可单独清除", () => {
        const withContainer: Customizations = {
            views: {[A]: {container: "view:test.c", order: 1, fingerprint: "sidebar#0", height: 120}},
            containers: {"view:test.a": {location: "auxiliarybar", order: 0, fingerprint: "sidebar#0"}},
        };
        const reset = patched(catalog, withContainer, {kind: "reset-view", viewId: A});
        expect(reset.views?.[A]).toEqual({height: 120});
        expect(reset.selected).toEqual({auxiliarybar: "view:test.a"});
        expect(act(catalog, reset, {kind: "reset-view", viewId: A}).result).toEqual({kind: "unchanged"});
        expect(patched(catalog, reset, {kind: "reset-container", containerId: "view:test.a"}).containers).toBeUndefined();
    });
});
