/**
 * 落点判定（docs/specs/ui/workbench-shell.md 外壳三输出 19–22、验收 19、20、22、24、25）：纯函数，几何按呈现手写成
 * client 像素。每个提交的意图再交给 `applyIntent` 核对它能合成补丁，判定与写入用的是同一份合同。
 */

import {describe, expect, it} from "bun:test";

import type {GridDropRect} from "@notnotype/nb-layout";

import type {ViewDeclaration, ViewLocation} from "../../shared/views";
import type {Customizations} from "../state/records";
import {isSameDropAction, layoutKeyOf, resolveDrop} from "./drop";
import type {DropInput, DropRects, DropSource, DropTarget} from "./drop";
import {applyIntent, applyPatch} from "./intents";
import type {ViewIntent} from "./intents";
import {computePlacement, customContainerId} from "./placement";
import type {ViewCatalog} from "./placement";
import {buildPresentation} from "./presentation";

const view = (name: string, location: ViewLocation, extra: Partial<ViewDeclaration> = {}): ViewDeclaration => ({title: {"zh-CN": name, "en-US": name}, icon: "i", location, layout: "scroll", ...extra});
const catalog: ViewCatalog = new Map([
    ["t.a", view("A", "sidebar")], ["t.b", view("B", "sidebar", {order: 1})], ["t.c", view("C", "sidebar", {order: 2})],
    ["t.d", view("D", "panel")], ["t.e", view("E", "panel", {order: 1})], ["t.x", view("X", "sidebar", {order: 3, movable: false})],
]);
const NEW = customContainerId("33333333-3333-4333-8333-333333333333");

function world(customizations: Customizations = {}) {
    const placement = computePlacement(catalog, customizations);
    const presentation = buildPresentation({catalog, placement, customizations});
    return {placement, presentation, customizations};
}

const rect = (left: number, top: number, right: number, bottom: number): GridDropRect => ({left, top, right, bottom});

/** 来源的拖动开始快照由 `input` 补上当时的布局代次。 */
type SourceShape = DropSource extends infer S ? (S extends DropSource ? Omit<S, "layoutKey"> : never) : never;

function input(customizations: Customizations, source: SourceShape, target: DropTarget, point: {x: number; y: number}, rects: DropRects): DropInput {
    const {presentation} = world(customizations);
    const layoutKey = layoutKeyOf(presentation);
    return {source: {...source, layoutKey}, target, point, rects, presentation, catalog, layoutKey, newContainerId: NEW};
}

/** 提交的意图要能合成补丁：判定与写入同一份合同。 */
function applies(customizations: Customizations, intent: ViewIntent): Customizations {
    const result = applyIntent({catalog, ...world(customizations)}, intent);
    if (result.kind !== "patch") throw new Error(`意图没有合成补丁：${JSON.stringify(result)}`);
    return applyPatch(customizations, result.patch, catalog).value;
}

/** 侧栏 ActivityBar 条目带（纵向）：四个条目各 40px 高。 */
const activityBand = {orientation: "vertical" as const, rect: rect(0, 0, 48, 400), entries: [
    {id: "view:t.a", rect: rect(4, 0, 44, 40)}, {id: "view:t.b", rect: rect(4, 44, 44, 84)}, {id: "view:t.c", rect: rect(4, 88, 44, 128)}, {id: "view:t.x", rect: rect(4, 132, 44, 172)},
]};

describe("Switcher 插入位", () => {
    it("视图落条目带：在插入位建新容器（detach-view），预览只有一条插入线", () => {
        const decision = resolveDrop(input({}, {kind: "view", viewId: "t.d", containerId: "view:t.d", part: "panel"}, {kind: "switcher", part: "sidebar"}, {x: 20, y: 46}, {switcher: activityBand}));
        expect(decision).toMatchObject({kind: "commit", intent: {kind: "detach-view", viewId: "t.d", containerId: NEW, targetPart: "sidebar", beforeContainerId: "view:t.b"}, preview: {areaRect: null}});
        expect(decision.kind === "commit" && decision.preview.indicator).not.toBeNull();
        const next = applies({}, (decision as {intent: ViewIntent}).intent);
        expect(world(next).placement.parts.sidebar).toEqual(["view:t.a", NEW, "view:t.b", "view:t.c", "view:t.x"]);
        // 悬停的 B 的成员不变。
        expect(world(next).placement.containers.get("view:t.b")?.members).toEqual(["t.b"]);
    });

    it("容器在同一条目带换序；落在自己前后的插入位为带线的无操作；迁到另一个 Part", () => {
        const source = {kind: "container" as const, containerId: "view:t.c", part: "sidebar" as const, viewIds: ["t.c"]};
        const reorder = resolveDrop(input({}, source, {kind: "switcher", part: "sidebar"}, {x: 20, y: 2}, {switcher: activityBand}));
        expect(reorder).toMatchObject({kind: "commit", intent: {kind: "move-container", containerId: "view:t.c", targetPart: "sidebar", beforeContainerId: "view:t.a"}});
        // 追加到末尾：插入线离末个条目后缘 4px。
        const append = resolveDrop(input({}, source, {kind: "switcher", part: "sidebar"}, {x: 20, y: 300}, {switcher: activityBand}));
        expect(append).toMatchObject({kind: "commit", intent: {kind: "move-container", targetPart: "sidebar"}, preview: {indicator: {top: 176}}});
        expect(append.kind === "commit" && "beforeContainerId" in append.intent).toBe(false);
        for (const y of [90, 130]) {
            const inPlace = resolveDrop(input({}, source, {kind: "switcher", part: "sidebar"}, {x: 20, y}, {switcher: activityBand}));
            expect(inPlace.kind).toBe("noop");
            expect(inPlace.kind === "noop" && inPlace.preview?.indicator).toBeTruthy();
        }
        const panelBand = {orientation: "horizontal" as const, rect: rect(100, 500, 600, 532), entries: [{id: "view:t.d", rect: rect(100, 500, 180, 532)}, {id: "view:t.e", rect: rect(184, 500, 264, 532)}]};
        const across = resolveDrop(input({}, source, {kind: "switcher", part: "panel"}, {x: 400, y: 510}, {switcher: panelBand}));
        expect(across).toMatchObject({kind: "commit", intent: {kind: "move-container", targetPart: "panel"}});
        expect(world(applies({}, (across as {intent: ViewIntent}).intent)).presentation.containers.get("view:t.c")?.axis).toBe("horizontal");
    });

    it("声明的锚点与几何不一致、或拖动期间布局变了：拒绝", () => {
        expect(resolveDrop(input({}, {kind: "view", viewId: "t.d", containerId: "view:t.d", part: "panel"}, {kind: "switcher", part: "sidebar", beforeContainerId: "view:t.c"}, {x: 20, y: 46}, {switcher: activityBand})).kind).toBe("rejected");
        const stale = {...input({}, {kind: "view", viewId: "t.d", containerId: "view:t.d", part: "panel"}, {kind: "switcher", part: "sidebar"}, {x: 20, y: 46}, {switcher: activityBand}), layoutKey: "别的布局"};
        expect(resolveDrop(stale).kind).toBe("rejected");
    });

    it("布局代次随选中项、可见成员变化（外壳三输出 23：活动内容与成员变化取消）", () => {
        const merged = applies({}, {kind: "move-view", viewId: "t.b", sourceContainerId: "view:t.b", targetContainerId: "view:t.a"});
        const key = layoutKeyOf(world(merged).presentation);
        const selected = applies(merged, {kind: "select-container", part: "sidebar", containerId: "view:t.c"});
        expect(layoutKeyOf(world(selected).presentation)).not.toBe(key);
        const placement = computePlacement(catalog, merged);
        const hidden = buildPresentation({catalog, placement, customizations: merged, hidden: new Set(["t.b"])});
        expect(layoutKeyOf(hidden)).not.toBe(key);
        expect(layoutKeyOf(world(merged).presentation)).toBe(key);
    });
});

describe("内容区", () => {
    // 侧栏 view:t.a 里 A、B 上下排，各 200px 高。
    const merged = applies({}, {kind: "move-view", viewId: "t.b", sourceContainerId: "view:t.b", targetContainerId: "view:t.a"});
    const content = {containerId: "view:t.a", rect: rect(60, 0, 400, 400), members: [{id: "t.a", rect: rect(60, 0, 400, 199)}, {id: "t.b", rect: rect(60, 200, 400, 400)}]};

    it("视图落另一个容器的边缘：半区并入（中点归后半），预览是命中叶对应的那一半", () => {
        const front = resolveDrop(input(merged, {kind: "view", viewId: "t.c", containerId: "view:t.c", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 50}, {content}));
        expect(front).toMatchObject({kind: "commit", intent: {kind: "move-view", targetContainerId: "view:t.a", split: {hitViewId: "t.a", side: "before"}}, preview: {areaRect: {top: 0}}});
        const middle = resolveDrop(input(merged, {kind: "view", viewId: "t.c", containerId: "view:t.c", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 99.5}, {content}));
        expect(middle).toMatchObject({kind: "commit", intent: {split: {hitViewId: "t.a", side: "after"}}});
        const next = applies(merged, (front as {intent: ViewIntent}).intent);
        expect(world(next).placement.containers.get("view:t.a")?.members).toEqual(["t.c", "t.a", "t.b"]);
    });

    it("同一容器内：命中自己是无操作；已紧贴目标侧是带预览的无操作；其它是只改顺序", () => {
        const self = resolveDrop(input(merged, {kind: "view", viewId: "t.a", containerId: "view:t.a", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 50}, {content}));
        expect(self).toEqual({kind: "noop"});
        const already = resolveDrop(input(merged, {kind: "view", viewId: "t.a", containerId: "view:t.a", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 250}, {content}));
        expect(already.kind).toBe("noop");
        const after = resolveDrop(input(merged, {kind: "view", viewId: "t.a", containerId: "view:t.a", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 350}, {content}));
        expect(after.kind).toBe("commit");
        const next = applies(merged, (after as {intent: ViewIntent}).intent);
        expect(world(next).placement.containers.get("view:t.a")?.members).toEqual(["t.b", "t.a"]);
        expect(next.views?.["t.a"]?.height).toBeUndefined();
    });

    it("整容器落边缘：整组并入，来源比例取来源的实测几何，量不出来时取尺寸意图", () => {
        const panel = applies({}, {kind: "move-view", viewId: "t.e", sourceContainerId: "view:t.e", targetContainerId: "view:t.d"});
        const both = applies(panel, {kind: "move-view", viewId: "t.b", sourceContainerId: "view:t.b", targetContainerId: "view:t.a"});
        const source = {kind: "container" as const, containerId: "view:t.d", part: "panel" as const, viewIds: ["t.d", "t.e"]};
        const sourceContent = {containerId: "view:t.d", rect: rect(100, 600, 700, 800), members: [{id: "t.d", rect: rect(100, 600, 550, 800)}, {id: "t.e", rect: rect(551, 600, 700, 800)}]};
        const measured = resolveDrop(input(both, source, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 350}, {content, sourceContent}));
        expect(measured).toMatchObject({kind: "commit", intent: {kind: "merge-container", sourceViewIds: ["t.d", "t.e"], split: {hitViewId: "t.b", side: "after", sourceSizes: {"t.d": 450, "t.e": 149}}}, preview: {count: 2}});
        const fromIntents = resolveDrop(input(both, source, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 350}, {content}));
        expect(fromIntents).toMatchObject({kind: "commit", intent: {split: {sourceSizes: {"t.d": 240, "t.e": 240}}}});
        const next = applies(both, (measured as {intent: ViewIntent}).intent);
        expect(world(next).placement.containers.get("view:t.a")?.members).toEqual(["t.a", "t.b", "t.d", "t.e"]);
        expect(world(next).placement.containers.has("view:t.d")).toBe(false);
    });

    it("容器源的成员与冻结快照不一致（隐藏成员没进快照）：整组拒绝；不可移动的视图不能起拖", () => {
        const decision = resolveDrop(input(merged, {kind: "container", containerId: "view:t.a", part: "sidebar", viewIds: ["t.a"]}, {kind: "content", containerId: "view:t.c", part: "sidebar"}, {x: 100, y: 50}, {content: {containerId: "view:t.c", rect: rect(60, 0, 400, 400), members: [{id: "t.c", rect: rect(60, 0, 400, 400)}]}}));
        expect(decision.kind).toBe("rejected");
        const fixed = resolveDrop(input({}, {kind: "view", viewId: "t.x", containerId: "view:t.x", part: "sidebar"}, {kind: "content", containerId: "view:t.c", part: "sidebar"}, {x: 100, y: 50}, {content: {containerId: "view:t.c", rect: rect(60, 0, 400, 400), members: [{id: "t.c", rect: rect(60, 0, 400, 400)}]}}));
        expect(fixed.kind).toBe("rejected");
        const extra = resolveDrop(input(merged, {kind: "container", containerId: "view:t.a", part: "sidebar", viewIds: ["t.a", "t.b", "t.c"]}, {kind: "content", containerId: "view:t.c", part: "sidebar"}, {x: 100, y: 50}, {content: {containerId: "view:t.c", rect: rect(60, 0, 400, 400), members: [{id: "t.c", rect: rect(60, 0, 400, 400)}]}}));
        expect(extra.kind).toBe("rejected");
    });

    it("容器源含不可移动的成员：不显示可接收的半区（与意图合成的整组拒绝一致）", () => {
        const withFixed = applies({}, {kind: "move-view", viewId: "t.a", sourceContainerId: "view:t.a", targetContainerId: "view:t.x"});
        const target = {containerId: "view:t.c", rect: rect(60, 0, 400, 400), members: [{id: "t.c", rect: rect(60, 0, 400, 400)}]};
        const viewIds = world(withFixed).placement.containers.get("view:t.x")!.members;
        expect(viewIds).toEqual(["t.x", "t.a"]);
        const decision = resolveDrop(input(withFixed, {kind: "container", containerId: "view:t.x", part: "sidebar", viewIds}, {kind: "content", containerId: "view:t.c", part: "sidebar"}, {x: 100, y: 300}, {content: target}));
        expect(decision).toEqual({kind: "rejected", reason: expect.stringContaining("t.x")});
    });

    it("容器源里收起的成员不参与来源比例：半区只分给展开的成员", () => {
        let source = applies({}, {kind: "move-view", viewId: "t.e", sourceContainerId: "view:t.e", targetContainerId: "view:t.d"});
        source = applies(source, {kind: "set-view-collapsed", viewId: "t.e", collapsed: true});
        const sourceContent = {containerId: "view:t.d", rect: rect(100, 600, 700, 800), members: [{id: "t.d", rect: rect(100, 600, 668, 800)}, {id: "t.e", rect: rect(668, 600, 700, 800)}]};
        const target = {containerId: "view:t.c", rect: rect(60, 0, 400, 400), members: [{id: "t.c", rect: rect(60, 0, 400, 400)}]};
        const decision = resolveDrop(input(source, {kind: "container", containerId: "view:t.d", part: "panel", viewIds: ["t.d", "t.e"]}, {kind: "content", containerId: "view:t.c", part: "sidebar"}, {x: 100, y: 300}, {content: target, sourceContent}));
        expect(decision).toMatchObject({kind: "commit", intent: {split: {sourceSizes: {"t.d": 568}}}});
        expect(Object.keys((decision as {intent: {split: {sourceSizes: Record<string, number>}}}).intent.split.sourceSizes)).toEqual(["t.d"]);
    });

    describe("收起的分栏当落点（t83 第二轮 R2-3）", () => {
        const view = (viewId: string) => ({kind: "view" as const, viewId, containerId: `view:${viewId}`, part: "sidebar" as const});
        const target = {kind: "content" as const, containerId: "view:t.a", part: "sidebar" as const};
        // 甲、乙都收成 32px 标题行，下面是剩余区。
        const bothCollapsed = applies(applies(merged, {kind: "set-view-collapsed", viewId: "t.a", collapsed: true}), {kind: "set-view-collapsed", viewId: "t.b", collapsed: true});
        const strips = {containerId: "view:t.a", rect: rect(60, 0, 400, 400), members: [{id: "t.a", rect: rect(60, 0, 400, 32)}, {id: "t.b", rect: rect(60, 33, 400, 65)}]};

        it("全部收起：标题之间与最后都是插入位，剩余区等于插在最后；预览是插入线；拖入的视图在插入位展开，原有的保持收起", () => {
            const between = resolveDrop(input(bothCollapsed, view("t.c"), target, {x: 100, y: 40}, {content: strips}));
            expect(between).toMatchObject({kind: "commit", intent: {kind: "move-view", beforeViewId: "t.b", expand: true}, preview: {areaRect: null, insertion: {viewId: "t.b", side: "before"}}});
            expect(between.kind === "commit" && between.preview.indicator).toBeTruthy();
            expect(between.kind === "commit" && "split" in between.intent).toBe(false);
            const next = applies(bothCollapsed, (between as {intent: ViewIntent}).intent);
            expect(world(next).placement.containers.get("view:t.a")?.members).toEqual(["t.a", "t.c", "t.b"]);
            expect([next.views?.["t.a"]?.collapsed, next.views?.["t.b"]?.collapsed, next.views?.["t.c"]?.collapsed]).toEqual([true, true, undefined]);

            const remainder = resolveDrop(input(bothCollapsed, view("t.c"), target, {x: 100, y: 300}, {content: strips}));
            expect(remainder).toMatchObject({kind: "commit", intent: {kind: "move-view", expand: true}, preview: {insertion: {viewId: "t.b", side: "after"}}});
            expect(remainder.kind === "commit" && "beforeViewId" in remainder.intent).toBe(false);
            expect(world(applies(bothCollapsed, (remainder as {intent: ViewIntent}).intent)).placement.containers.get("view:t.a")?.members).toEqual(["t.a", "t.b", "t.c"]);
            // 细条占满内容盒、没有剩余区时同样按插入位，不拆细条。
            const full = resolveDrop(input(bothCollapsed, view("t.c"), target, {x: 100, y: 60}, {content: {...strips, rect: rect(60, 0, 400, 65)}}));
            expect(full).toMatchObject({kind: "commit", intent: {kind: "move-view", expand: true}, preview: {insertion: {viewId: "t.b", side: "after"}}});
        });

        it("命中收起的细条：按前后插入、不拆半区；挨着展开的分栏时与它平分，挨着的都收起时只插入", () => {
            const tailCollapsed = applies(merged, {kind: "set-view-collapsed", viewId: "t.b", collapsed: true});
            const layout = {containerId: "view:t.a", rect: rect(60, 0, 400, 400), members: [{id: "t.a", rect: rect(60, 0, 400, 367)}, {id: "t.b", rect: rect(60, 368, 400, 400)}]};
            const front = resolveDrop(input(tailCollapsed, view("t.c"), target, {x: 100, y: 375}, {content: layout}));
            expect(front).toMatchObject({kind: "commit", intent: {kind: "move-view", split: {hitViewId: "t.a", side: "after"}, expand: true}, preview: {areaRect: null, insertion: {viewId: "t.b", side: "before"}}});
            const split = applies(tailCollapsed, (front as {intent: ViewIntent}).intent);
            expect(world(split).placement.containers.get("view:t.a")?.members).toEqual(["t.a", "t.c", "t.b"]);
            expect([split.views?.["t.a"]?.height, split.views?.["t.c"]?.height, split.views?.["t.b"]?.collapsed]).toEqual([120, 120, true]);

            const back = resolveDrop(input(tailCollapsed, view("t.c"), target, {x: 100, y: 395}, {content: layout}));
            expect(back).toMatchObject({kind: "commit", intent: {kind: "move-view", expand: true}, preview: {insertion: {viewId: "t.b", side: "after"}}});
            expect(back.kind === "commit" && ("split" in back.intent || "beforeViewId" in back.intent)).toBe(false);
            const appended = applies(tailCollapsed, (back as {intent: ViewIntent}).intent);
            expect(world(appended).placement.containers.get("view:t.a")?.members).toEqual(["t.a", "t.b", "t.c"]);
            expect(appended.views?.["t.a"]?.height).toBeUndefined();
            // 展开的叶照旧拆半区。
            expect(resolveDrop(input(tailCollapsed, view("t.c"), target, {x: 100, y: 100}, {content: layout}))).toMatchObject({kind: "commit", intent: {split: {hitViewId: "t.a", side: "before"}}});
        });

        it("同一容器里挪收起的视图：插入位就在它自己前后是带线的无操作，其它位置改顺序并展开它", () => {
            const own = {...view("t.a"), containerId: "view:t.a"};
            for (const y of [10, 40]) {
                const inPlace = resolveDrop(input(bothCollapsed, own, target, {x: 100, y}, {content: strips}));
                expect(inPlace.kind).toBe("noop");
                expect(inPlace.kind === "noop" && inPlace.preview?.indicator).toBeTruthy();
            }
            const last = resolveDrop(input(bothCollapsed, own, target, {x: 100, y: 300}, {content: strips}));
            expect(last).toMatchObject({kind: "commit", intent: {kind: "move-view", expand: true}});
            const next = applies(bothCollapsed, (last as {intent: ViewIntent}).intent);
            expect(world(next).placement.containers.get("view:t.a")?.members).toEqual(["t.b", "t.a"]);
            expect([next.views?.["t.a"]?.collapsed, next.views?.["t.b"]?.collapsed]).toEqual([undefined, true]);
        });

        it("整容器插到收起栏旁、挨着展开的分栏：拖入的可见成员都展开，连同原来收起的一起与它平分", () => {
            // 来源：面板里丁展开、戊收起；目标：侧栏甲展开、乙收起
            let both = applies(applies(merged, {kind: "set-view-collapsed", viewId: "t.b", collapsed: true}), {kind: "move-view", viewId: "t.e", sourceContainerId: "view:t.e", targetContainerId: "view:t.d"});
            both = applies(both, {kind: "set-view-collapsed", viewId: "t.e", collapsed: true});
            const layout = {containerId: "view:t.a", rect: rect(60, 0, 400, 400), members: [{id: "t.a", rect: rect(60, 0, 400, 367)}, {id: "t.b", rect: rect(60, 368, 400, 400)}]};
            // 来源量得到：丁 400px 宽，戊是 32px 竖条（不是它的份额，按尺寸意图 240 算）
            const sourceContent = {containerId: "view:t.d", rect: rect(100, 600, 533, 800), members: [{id: "t.d", rect: rect(100, 600, 500, 800)}, {id: "t.e", rect: rect(501, 600, 533, 800)}]};
            const decision = resolveDrop(input(both, {kind: "container", containerId: "view:t.d", part: "panel", viewIds: ["t.d", "t.e"]}, target, {x: 100, y: 375}, {content: layout, sourceContent}));
            expect(decision).toMatchObject({kind: "commit", intent: {kind: "merge-container", expand: true, split: {hitViewId: "t.a", side: "after", sourceSizes: {"t.d": 400, "t.e": 240}}}});
            const next = applies(both, (decision as {intent: ViewIntent}).intent);
            expect(world(next).placement.containers.get("view:t.a")?.members).toEqual(["t.a", "t.d", "t.e", "t.b"]);
            expect([next.views?.["t.a"]?.height, next.views?.["t.d"]?.height, next.views?.["t.e"]?.height]).toEqual([120, 75, 45]);
            expect([next.views?.["t.d"]?.collapsed, next.views?.["t.e"]?.collapsed, next.views?.["t.b"]?.collapsed]).toEqual([undefined, undefined, true]);
        });

        it("整容器落在收起的分栏之间：整组并入插入位并展开", () => {
            const decision = resolveDrop(input(bothCollapsed, {kind: "container", containerId: "view:t.d", part: "panel", viewIds: ["t.d"]}, target, {x: 100, y: 40}, {content: strips}));
            expect(decision).toMatchObject({kind: "commit", intent: {kind: "merge-container", beforeViewId: "t.b", expand: true}, preview: {count: 1, insertion: {viewId: "t.b", side: "before"}}});
            const next = applies(bothCollapsed, (decision as {intent: ViewIntent}).intent);
            expect(world(next).placement.containers.get("view:t.a")?.members).toEqual(["t.a", "t.d", "t.b"]);
            expect(next.views?.["t.d"]?.collapsed).toBeUndefined();
        });
    });

    it("几何过期（来自别的容器或含非成员）：拒绝；内容盒量不出来：无操作", () => {
        expect(resolveDrop(input(merged, {kind: "view", viewId: "t.c", containerId: "view:t.c", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 50}, {content: {...content, containerId: "view:t.c"}})).kind).toBe("rejected");
        expect(resolveDrop(input(merged, {kind: "view", viewId: "t.c", containerId: "view:t.c", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 50}, {content: {...content, members: [...content.members, {id: "t.c", rect: rect(60, 400, 400, 401)}]}})).kind).toBe("rejected");
        expect(resolveDrop(input(merged, {kind: "view", viewId: "t.c", containerId: "view:t.c", part: "sidebar"}, {kind: "content", containerId: "view:t.a", part: "sidebar"}, {x: 100, y: 50}, {content: {...content, rect: rect(0, 0, 0, 0)}}))).toEqual({kind: "noop"});
    });
});

describe("空 Part", () => {
    // 先把面板里的两个视图都移进侧栏，面板空。
    const emptyPanel = applies(applies({}, {kind: "move-view", viewId: "t.d", sourceContainerId: "view:t.d", targetContainerId: "view:t.a"}), {kind: "move-view", viewId: "t.e", sourceContainerId: "view:t.e", targetContainerId: "view:t.a"});
    const area = rect(100, 600, 700, 800);

    it("单视图建一个容器并填满；整容器搬进去不额外嵌套；Part 有容器时空落点失效", () => {
        const single = resolveDrop(input(emptyPanel, {kind: "view", viewId: "t.b", containerId: "view:t.b", part: "sidebar"}, {kind: "empty", part: "panel"}, {x: 300, y: 700}, {empty: area}));
        expect(single).toMatchObject({kind: "commit", intent: {kind: "detach-view", targetPart: "panel", containerId: NEW}, preview: {areaRect: area}});
        const after = applies(emptyPanel, (single as {intent: ViewIntent}).intent);
        expect(world(after).placement.parts.panel).toEqual([NEW]);
        const whole = resolveDrop(input(emptyPanel, {kind: "container", containerId: "view:t.b", part: "sidebar", viewIds: ["t.b"]}, {kind: "empty", part: "panel"}, {x: 300, y: 700}, {empty: area}));
        expect(whole).toMatchObject({kind: "commit", intent: {kind: "move-container", containerId: "view:t.b", targetPart: "panel"}});
        expect(resolveDrop(input({}, {kind: "view", viewId: "t.b", containerId: "view:t.b", part: "sidebar"}, {kind: "empty", part: "panel"}, {x: 300, y: 700}, {empty: area})).kind).toBe("rejected");
    });
});

describe("预备区（外壳三输出 20）", () => {
    const zone = rect(1000, 72, 1400, 860);

    it("视图落预备区：建新容器，提交带上要显示的 Part；预览是整块预备区", () => {
        const decision = resolveDrop(input({}, {kind: "view", viewId: "t.b", containerId: "view:t.b", part: "sidebar"}, {kind: "reveal", part: "auxiliarybar"}, {x: 1200, y: 400}, {reveal: zone}));
        expect(decision).toMatchObject({kind: "commit", intent: {kind: "detach-view", viewId: "t.b", targetPart: "auxiliarybar", containerId: NEW}, preview: {areaRect: zone, indicator: null}, reveal: "auxiliarybar"});
        expect(world(applies({}, (decision as {intent: ViewIntent}).intent)).placement.parts.auxiliarybar).toEqual([NEW]);
    });

    it("容器落别的 Part 的预备区整个迁过去；本来就在这个 Part（侧栏拖到零时活动栏的条目）只选中它；都带上要显示的 Part", () => {
        const across = resolveDrop(input({}, {kind: "container", containerId: "view:t.d", part: "panel", viewIds: ["t.d"]}, {kind: "reveal", part: "sidebar"}, {x: 100, y: 300}, {reveal: rect(48, 40, 388, 860)}));
        expect(across).toMatchObject({kind: "commit", intent: {kind: "move-container", containerId: "view:t.d", sourcePart: "panel", targetPart: "sidebar"}, reveal: "sidebar"});
        const home = resolveDrop(input({}, {kind: "container", containerId: "view:t.b", part: "sidebar", viewIds: ["t.b"]}, {kind: "reveal", part: "sidebar"}, {x: 100, y: 300}, {reveal: rect(48, 40, 388, 860)}));
        expect(home).toMatchObject({kind: "commit", intent: {kind: "select-container", part: "sidebar", containerId: "view:t.b"}, reveal: "sidebar"});
    });

    it("同一个意图落在预备区与别处不算同一个动作；预备区矩形量不出来是无操作", () => {
        const viaZone = resolveDrop(input({}, {kind: "view", viewId: "t.b", containerId: "view:t.b", part: "sidebar"}, {kind: "reveal", part: "auxiliarybar"}, {x: 1200, y: 400}, {reveal: zone}));
        expect(viaZone.kind === "commit" && isSameDropAction(viaZone, {...viaZone, reveal: undefined})).toBe(false);
        expect(resolveDrop(input({}, {kind: "view", viewId: "t.b", containerId: "view:t.b", part: "sidebar"}, {kind: "reveal", part: "auxiliarybar"}, {x: 1200, y: 400}, {reveal: null}))).toEqual({kind: "noop"});
    });
});

describe("动作一致性", () => {
    it("松手只提交已经显示过的那一次：意图逐字段相同才算", () => {
        const a = {kind: "commit" as const, intent: {kind: "select-container" as const, part: "sidebar" as const, containerId: "view:t.a"}, preview: {indicator: null, areaRect: null, orientation: "vertical" as const, count: 1}};
        expect(isSameDropAction(a, {...a})).toBe(true);
        expect(isSameDropAction(a, {...a, intent: {...a.intent, containerId: "view:t.b"}})).toBe(false);
        expect(isSameDropAction(null, a)).toBe(false);
    });
});
