import {describe, expect, test} from "bun:test";

import {INSTRUCTION_DIAGNOSTIC_IDS} from "../shared/declarations";
import type {InstructionSnapshot} from "../shared/instructions";
import {chapter, drafts, end, PlotWorld, present} from "../testing/world";
import {instructionDiagnostics} from "./instruction-checks";

const CHAPTERS = Array.from({length: 12}, (_, index) => `ch${String(index + 1)}`);
const snap = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});
function setup(snapshots: InstructionSnapshot[]) {
    const diagnostics = instructionDiagnostics({all: () => snapshots});
    return (w: PlotWorld, id: keyof typeof INSTRUCTION_DIAGNOSTIC_IDS, at = end("ch12")) => diagnostics[INSTRUCTION_DIAGNOSTIC_IDS[id]]!(w.view(), at, "actual");
}

describe("plot.decisions 输出 8、验收 4：写作指示的检查", () => {
    test("视角人物不在场：第 6 章指示的视角人物是星瑾，本章的变更里她都不在场：提示；有一条里在场、或有没记参与者的变更、或本章没有变更：不报", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const run = setup([snap("ch6", {pov: {kind: "entry", id: jin}})]);
        // 本章没有任何变更：不知道，不报。
        expect(run(w, "povAbsent")).toEqual([]);
        w.change(chapter("ch6"), {cast: [present(brother)]});
        const found = run(w, "povAbsent");
        expect(found.map((finding) => finding.key)).toEqual([{objects: [{kind: "entry", id: jin}], range: {from: "ch6", to: "ch6"}}]);
        // 有一条没记参与者的变更：不知道她在不在，不报。
        const uncast = w.change(chapter("ch6", 5));
        expect(run(w, "povAbsent")).toEqual([]);
        expect(uncast).toBeDefined();
        // 另一章：她在场了就不报。
        const w2 = new PlotWorld(CHAPTERS);
        const [jin2, brother2] = [w2.person("星瑾"), w2.person("哥哥")];
        const run2 = setup([snap("ch6", {pov: {kind: "entry", id: jin2}})]);
        w2.change(chapter("ch6"), {cast: [present(brother2)]});
        w2.change(chapter("ch6", 5), {cast: [present(jin2)]});
        expect(run2(w2, "povAbsent")).toEqual([]);
        // 读取位置在第 6 章之前：这一章还没发生，不报。
        const w3 = new PlotWorld(CHAPTERS);
        const [jin3, brother3] = [w3.person("星瑾"), w3.person("哥哥")];
        const run3 = setup([snap("ch6", {pov: {kind: "entry", id: jin3}})]);
        w3.change(chapter("ch6"), {cast: [present(brother3)]});
        expect(run3(w3, "povAbsent", end("ch5"))).toEqual([]);
    });

    test("补叙的安放对不上：补叙某一章，本章的变更（安放在本章或在本章讲述）都不在那一章：提示；有一条在那一章（在本章讲述）：对得上；补叙前史时看前史里它的前后各一条", () => {
        const w = new PlotWorld(CHAPTERS);
        const run = setup([snap("ch6", {timeMode: {flashback: {kind: "chapter", chapter: "ch2", key: 0}}})]);
        w.change(chapter("ch6"));
        expect(run(w, "flashbackMismatch").map((finding) => finding.key)).toEqual([{range: {from: "ch6", to: "ch6"}}]);
        // 补叙的事安放在第 2 章、在第 6 章讲述：对得上。
        w.texts.set("ch6", "那年在老屋里。");
        w.change(chapter("ch2", 3), {told: [{source: "chapter", chapter: "ch6", quote: "那年在老屋里"}]});
        expect(run(w, "flashbackMismatch")).toEqual([]);
        // 本章没有变更：不报。
        const w3 = new PlotWorld(CHAPTERS);
        expect(setup([snap("ch6", {timeMode: {flashback: {kind: "prehistory", order: 5}}})])(w3, "flashbackMismatch")).toEqual([]);
        // 补叙前史第 5 处：前史里它前后各一条（第 3、第 7 处）算附近，更远的第 1 处不算。
        const w4 = new PlotWorld(CHAPTERS);
        const run4 = setup([snap("ch6", {timeMode: {flashback: {kind: "prehistory", order: 5}}})]);
        w4.texts.set("ch6", "老事一。老事二。");
        for (const order of [1, 3, 7]) w4.change({kind: "prehistory", order});
        w4.change({kind: "prehistory", order: 1}, {told: [{source: "chapter", chapter: "ch6", quote: "老事一"}]});
        expect(run4(w4, "flashbackMismatch")).toHaveLength(1);
        w4.change({kind: "prehistory", order: 7}, {told: [{source: "chapter", chapter: "ch6", quote: "老事二"}]});
        expect(run4(w4, "flashbackMismatch")).toEqual([]);
    });

    test("写作指示反复出现：同一句“不写的”连续出现在 3 章以上相邻的快照里：一条，范围是第一章到最后一章；中间隔着没有快照的章就断开", () => {
        const w = new PlotWorld(CHAPTERS);
        const run = setup([
            snap("ch2", {avoid: ["别写天气"]}),
            snap("ch3", {avoid: ["别写天气", "别写梦"]}),
            snap("ch4", {avoid: ["别写天气"]}),
            snap("ch6", {avoid: ["别写天气"]}),
            snap("ch7", {avoid: ["别写天气"]}),
            snap("ch8", {other: "语气冷一点"}),
            snap("ch9", {other: "语气冷一点"}),
            snap("ch10", {other: "语气冷一点"}),
        ]);
        expect(run(w, "repeated").map((finding) => finding.key)).toEqual([{range: {from: "ch2", to: "ch4"}}, {range: {from: "ch8", to: "ch10"}}]);
        // 读取位置在第 9 章：第 10 章的快照还没到，只有两章，不报“其他”。
        expect(run(w, "repeated", end("ch9")).map((finding) => finding.key)).toEqual([{range: {from: "ch2", to: "ch4"}}]);
    });

    test("相关的已定决策（挂在本章或视角人物上）追加进发现的对象里", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const decision = w.decision("第 6 章从星瑾的视角写", {about: [{kind: "chapter", id: "ch6"}], conclusion: "x"});
        const run = setup([snap("ch6", {pov: {kind: "entry", id: jin}})]);
        w.change(chapter("ch6"), {cast: [present(brother)]});
        expect(run(w, "povAbsent")[0]!.objects).toContainEqual({kind: "decision", id: decision});
    });
});

describe("plot.decisions 输出 8：分段讲两条线的章，视角人物的在场按各段的线合起来判", () => {
    test("视角人物只在回溯段那条线上在场：不报；各段里都不在场才报", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const cut = w.change(chapter("ch7", 10));
        const ids = w.publish([
            {ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch7", 90)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, type: "branch"}}},
            {ref: {kind: "change", id: "tmp:own"}, after: drafts.change("tmp:own", {...chapter("ch9", 40), line: "tmp:r1"}, {cast: [present(jin)]})},
        ]);
        w.change(chapter("ch9", 1), {cast: [present(brother)]});
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch9", [{line: "main", from: 1}, {line: ids["tmp:r1"]!, from: 30}]]])});
        const run = setup([snap("ch9", {pov: {kind: "entry", id: jin}})]);
        expect(run(w, "povAbsent")).toEqual([]);
        const w2 = new PlotWorld(CHAPTERS);
        const [jin2, brother2] = [w2.person("星瑾"), w2.person("哥哥")];
        w2.change(chapter("ch9", 1), {cast: [present(brother2)]});
        expect(setup([snap("ch9", {pov: {kind: "entry", id: jin2}})])(w2, "povAbsent")).toHaveLength(1);
    });
});
