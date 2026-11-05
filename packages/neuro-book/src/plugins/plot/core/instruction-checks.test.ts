import {describe, expect, test} from "bun:test";

import {InstructionTable} from "../backend/instructions";
import {INSTRUCTION_DIAGNOSTIC_IDS} from "../shared/declarations";
import type {InstructionSnapshot} from "../shared/instructions";
import {chapter, end, PlotWorld, present} from "../testing/world";
import {instructionDiagnostics} from "./instruction-checks";

const CHAPTERS = Array.from({length: 12}, (_, index) => `ch${String(index + 1)}`);
const snap = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});
function setup(snapshots: InstructionSnapshot[]) {
    const table = new InstructionTable();
    for (const snapshot of snapshots) table.put(snapshot.chapter, snapshot);
    const diagnostics = instructionDiagnostics(table);
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

    test("补叙的安放对不上：补叙某一章，本章的变更不在那一章：提示；补叙前史时本章变更在前史里它的前后：不报", () => {
        const w = new PlotWorld(CHAPTERS);
        const run = setup([snap("ch6", {timeMode: {flashback: {kind: "chapter", chapter: "ch2", key: 0}}})]);
        w.change(chapter("ch6"));
        expect(run(w, "flashbackMismatch").map((finding) => finding.key)).toEqual([{range: {from: "ch6", to: "ch6"}}]);
        // 本章的变更落在补叙的那一章：对得上。
        const w2 = new PlotWorld(CHAPTERS);
        const run2 = setup([snap("ch6", {timeMode: {flashback: {kind: "chapter", chapter: "ch2", key: 0}}})]);
        w2.change({kind: "chapter", chapter: "ch6", key: 0});
        w2.change({kind: "chapter", chapter: "ch2", key: 3});
        expect(run2(w2, "flashbackMismatch")).toHaveLength(1);
        // 本章没有变更：不报。
        const w3 = new PlotWorld(CHAPTERS);
        expect(setup([snap("ch6", {timeMode: {flashback: {kind: "prehistory", order: 5}}})])(w3, "flashbackMismatch")).toEqual([]);
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
