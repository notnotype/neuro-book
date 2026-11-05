import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type Entry, type Patch, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {lineTable} from "../src/lines/table";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {PANEL, PERSON} from "./fixtures/world";

const CHAPTERS = ["ch1", "ch2", "ch3", "ch4"];
function options(): WorldOptions {
    return {order: new ChapterOrder(CHAPTERS), registry: buildRegistry([PANEL, PERSON]), reductions: () => undefined, chapterText: () => "", digest: (text) => createHash("sha256").update(text).digest("hex")};
}
let sequence = 0;
const request = (puts: WriteRequest["puts"], baseVersion: number): WriteRequest => ({requestId: `wl-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "世界线", baseVersion, puts});
function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}
const problems = (result: WriteResult) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => [problem.code, problem.path, problem.reason ?? null]) : [JSON.stringify(result.ok ? "ok" : result.failure)]);
const person = (id: string, name: string): Entry => ({id, type: "人物", parent: null, folder: "人物", order: 0, init: {name, aliases: [], summary: "", text: [], data: {panel: {type: "canon.panel", version: 1, enabled: true, fields: {存款: 20000, 魔力上限: null, 魔力: null, 物品: []}}}}});
const at = (chapter: string, key: number, line?: string) => ({kind: "chapter" as const, chapter, key, ...(line === undefined ? {} : {line})});
const written = (id: string, placement: StoryChangeDraft["at"], patches: Patch[] = [], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft => ({id, kind: "written", text: id, at: placement, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra});
const spend = (entry: string, value: number): Patch => ({op: "add", at: {entry, path: "panel.存款"}, value});

/** 主线：星瑕存款两万；第 2 章 c1、c2（同键、写得更晚的 c2b）、c3；第 3 章计划 p1（分叉之前写下）。 */
function base() {
    const opened = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}], 0), "t"));
    const xia = opened.ids["tmp:xia"]!;
    const story = ok(opened.world.publish(request([
        {ref: {kind: "change", id: "tmp:c1"}, after: written("tmp:c1", at("ch2", 10))},
        {ref: {kind: "change", id: "tmp:c2"}, after: written("tmp:c2", at("ch2", 20), [spend(xia, -5000)])},
        {ref: {kind: "change", id: "tmp:c3"}, after: written("tmp:c3", at("ch2", 30))},
        {ref: {kind: "change", id: "tmp:p1"}, after: {...written("tmp:p1", at("ch3", 5)), kind: "plan"}},
    ], 1), "t"));
    const later = ok(story.world.publish(request([{ref: {kind: "change", id: "tmp:c2b"}, after: written("tmp:c2b", at("ch2", 20))}], 2), "t"));
    return {world: later.world, xia, c1: story.ids["tmp:c1"]!, c2: story.ids["tmp:c2"]!, c3: story.ids["tmp:c3"]!, p1: story.ids["tmp:p1"]!, c2b: later.ids["tmp:c2b"]!};
}

/** 在 `world` 上从主线 c2 分出一条分支，同一请求里在新线上记一条第 3 章的变更。 */
function forked(world: World, cut: string, extra: {kind?: "written" | "plan"; patches?: Patch[]} = {}) {
    const fork: StoryChangeDraft = {...written("tmp:f", at("ch2", 25), [], {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut, type: "branch"}}), kind: extra.kind ?? "written"};
    return ok(world.publish(request([
        {ref: {kind: "change", id: "tmp:f"}, after: fork},
        {ref: {kind: "change", id: "tmp:own"}, after: {...written("tmp:own", at("ch3", 1, "tmp:l"), extra.patches ?? []), kind: extra.kind ?? "written"}},
    ], world.version), "t"));
}

describe("canon.worldlines 输出 1、2、3：线表与线视图的成员", () => {
    test("分叉与新线上的记录同一请求里写下：线 id 由程序发（l 前缀），记录的 at.line 跟着换；线在两种模式下都存在", () => {
        const {world, c2, xia} = base();
        const result = forked(world, c2, {patches: [spend(xia, -1000)]});
        const line = result.ids["tmp:l"]!;
        expect(line).toMatch(/^l\d+$/u);
        // 子线上的花钱不进主线：主线第 4 章末尾仍是两万减五千。
        const read = result.world.line().engine.entry(xia, {kind: "chapter", chapter: "ch4", edge: "end"}, "actual");
        expect(read !== null && read !== "chapter-not-found" && read.namespaces.panel!.fields.存款!.value).toBe(15000);
        expect(result.world.data.changes.get(result.ids["tmp:own"]!)!.at).toEqual(at("ch3", 1, line));
        expect(result.world.data.changes.get(result.ids["tmp:f"]!)!.fork!.line).toBe(line);
        const table = lineTable(result.world.data, result.world.options.order);
        expect(table.exists(line, "actual")).toBe(true);
        expect(table.lines.get(line)).toMatchObject({parent: "main", planned: false, unbuildable: null});
    });

    test("继承按安放的全序：不晚于切口的进子线，与切口同键、写得更晚的不进；分叉之前写下的计划进；子线自己的记录要键严格大于切口", () => {
        const {world, c1, c2, c3, p1, c2b} = base();
        const result = forked(world, c2);
        const line = result.ids["tmp:l"]!;
        const table = lineTable(result.world.data, result.world.options.order);
        expect([c1, c2, c2b, c3, p1, result.ids["tmp:own"]!].map((id) => table.visible(line, id))).toEqual([true, true, false, false, true, true]);
        // 主线看不到子线上的记录。
        expect(table.visible("main", result.ids["tmp:own"]!)).toBe(false);
        // 分叉之后在主线写下的计划不进子线。
        const after = ok(result.world.publish(request([{ref: {kind: "change", id: "tmp:p2"}, after: {...written("tmp:p2", at("ch3", 6)), kind: "plan"}}], result.world.version), "t"));
        expect(lineTable(after.world.data, after.world.options.order).visible(line, after.ids["tmp:p2"]!)).toBe(false);
    });

    test("计划分叉定义的线只在按计划模式下存在；分叉撤销以后线在两种模式下都不存在", () => {
        const {world, c2} = base();
        const planned = forked(world, c2, {kind: "plan"});
        const line = planned.ids["tmp:l"]!;
        const table = lineTable(planned.world.data, planned.world.options.order);
        expect([table.exists(line, "actual"), table.exists(line, "planned")]).toEqual([false, true]);
        const fork = planned.world.data.changes.get(planned.ids["tmp:f"]!)!;
        const undone = ok(planned.world.publish(request([{ref: {kind: "change", id: fork.id}, after: {...structuredClone(fork), status: "undone"}}], planned.world.version), "t"));
        const gone = lineTable(undone.world.data, undone.world.options.order);
        expect([gone.exists(line, "actual"), gone.exists(line, "planned")]).toEqual([false, false]);
    });

    test("切口所在章不在章序里：线存在但不可建，原因 cut-unplaced；子线什么都看不到（输出 18）", () => {
        const {world, c2} = base();
        const result = forked(world, c2);
        const line = result.ids["tmp:l"]!;
        const without = lineTable(result.world.data, new ChapterOrder(["ch1", "ch3", "ch4"]));
        expect(without.lines.get(line)?.unbuildable).toBe("cut-unplaced");
        expect(without.visible(line, result.ids["tmp:own"]!)).toBe(false);
    });
});

describe("canon.worldlines 失败与恢复、边界与兼容：写入时的线", () => {
    test("安放在不存在的线上：ref-invalid，原因 line-not-found；条目的出场带线：type-mismatch", () => {
        const {world, xia} = base();
        expect(problems(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 1, "l404"))}], world.version), "t"))).toEqual([["ref-invalid", "at.line", "line-not-found"]]);
        const entry = world.data.entries.get(xia)!;
        expect(problems(world.publish(request([{ref: {kind: "entry", id: xia}, after: {...structuredClone(entry), appears: at("ch2", 1, "l1")}}], world.version), "t"))).toEqual([["type-mismatch", "appears.line", null]]);
    });

    test("写明主线的 line 与不写存下的完全相同（只有主线的作品日志逐字节不变）", () => {
        const {world} = base();
        const plain = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 1))}], world.version), "t"));
        const named = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: written("tmp:x", at("ch3", 1, "main"))}], world.version), "t"));
        expect(JSON.stringify(named.revision.ops)).toBe(JSON.stringify(plain.revision.ops));
    });

    test("重放以后线 id 不复用：之后再分叉发的是新号", () => {
        const {world, c2, c3} = base();
        const first = forked(world, c2);
        const replayed = World.replay(first.world.revisions, first.world.options);
        const second = forked(replayed, c3);
        expect(second.ids["tmp:l"]).not.toBe(first.ids["tmp:l"]);
    });
});
