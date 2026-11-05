import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildMarkRegistry, buildRegistry, ChapterOrder, type Entry, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {createWorldReadView} from "../src/node/index";
import {World, type WriteResult} from "../src/world/world";
import {PANEL} from "./fixtures/world";

const FLAG = {id: "test.mark.flag", version: 1, label: "旗", attachTo: ["telling" as const], schema: {type: "object", properties: {who: {type: "string"}}}, refs: [{path: "who"}]};

let sequence = 0;
const request = (puts: WriteRequest["puts"], baseVersion: number): WriteRequest => ({requestId: `rv-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "读取视图", baseVersion, puts});
function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}
const change = (id: string, kind: "written" | "plan", chapter: string, patches: StoryChangeDraft["patches"], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft => ({id, kind, text: id, at: {kind: "chapter", chapter, key: 0}, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra});

/** 星瑕第 2 章出场；第 2 章一条已写、一条计划；第 4 章一条计划，第 5 章一条已写兑现它。 */
function build() {
    const world = World.empty({order: new ChapterOrder(["ch1", "ch2", "ch3", "ch4", "ch5", "ch6"]), registry: buildRegistry([PANEL]), marks: buildMarkRegistry([{plugin: "test.mark", declaration: FLAG}]), reductions: () => undefined, chapterText: () => "", digest: (text) => createHash("sha256").update(text).digest("hex")});
    const xia: Entry = {id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0, appears: {kind: "chapter", chapter: "ch2", key: 0}, init: {name: "星瑕", aliases: [], summary: "", text: [], data: {panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 100, 魔力上限: null, 魔力: null, 物品: []}}}}};
    const first = ok(world.publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: xia}], 0), "t"));
    const id = first.ids["tmp:xia"]!;
    const spend = (value: number) => [{op: "add" as const, at: {entry: id, path: "panel.存款"}, value}];
    const second = ok(first.world.publish(request([
        {ref: {kind: "change", id: "tmp:w2"}, after: change("tmp:w2", "written", "ch2", spend(-10))},
        {ref: {kind: "change", id: "tmp:p2"}, after: change("tmp:p2", "plan", "ch2", spend(-1))},
        {ref: {kind: "change", id: "tmp:p4"}, after: change("tmp:p4", "plan", "ch4", spend(-1))},
    ], 1), "t"));
    const third = ok(second.world.publish(request([{ref: {kind: "change", id: "tmp:w5"}, after: change("tmp:w5", "written", "ch5", [], {links: [{kind: "fulfills", plan: second.ids["tmp:p4"]!}]})}], 2), "t"));
    return {view: createWorldReadView(third.world, new Map()), xia: id, w2: second.ids["tmp:w2"]!, p2: second.ids["tmp:p2"]!, p4: second.ids["tmp:p4"]!};
}

describe("CanonReadView：插件比较先后、找引用位置要用的几项", () => {
    test("已写章上的计划按计划模式排在这一章的已写之后（与计算用的先后相同）；出场排在同一安放的变更之前", () => {
        const {view, w2, p2} = build();
        const written = view.eventKey(w2, "planned")!;
        const plan = view.eventKey(p2, "planned")!;
        expect(view.compareKeys(written, plan)).toBeLessThan(0);
        expect(view.eventKey(p2, "actual")).toBeNull();
        const appears = view.placementKey({kind: "chapter", chapter: "ch2", key: 0})!;
        expect(view.compareKeys(appears, written)).toBeLessThan(0);
        expect(view.placementKey({kind: "unscheduled"})).toBeNull();
    });

    test("套用结果、计划进展、字段声明、标注种类与来历照引擎给出", () => {
        const {view, xia, w2, p4} = build();
        expect(view.outcome(w2)).toEqual({applied: true});
        expect(view.progress(p4, {kind: "chapter", chapter: "ch5", edge: "end"})).toBe("fulfilled");
        expect(view.fields(xia, "panel")?.map((field) => field.id)).toEqual(PANEL.fields!.map((field) => field.id));
        expect(view.markType(FLAG.id)?.refs).toEqual([{path: "who", kind: "entry"}]);
        const steps = view.origins({entry: xia, path: "panel.存款"}, {kind: "chapter", chapter: "ch6", edge: "end"}, "actual");
        expect(steps !== "chapter-not-found" && steps.map((step) => (step.kind === "patch" ? step.change : step.kind))).toEqual(["init", w2]);
        expect(view.line).toBe("main");
    });
});
