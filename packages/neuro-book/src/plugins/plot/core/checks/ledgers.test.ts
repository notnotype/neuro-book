import {describe, expect, test} from "bun:test";

import type {Mark} from "@notnotype/nb-canon/schema";

import {MARK_IDS} from "../../shared/declarations";
import {addRow, chapter, end, PlotWorld} from "../../testing/world";
import {readerKnown, revealDependencies, secretLedger} from "./ledgers";

const CHAPTERS = Array.from({length: 12}, (_, index) => `ch${String(index + 1)}`);
const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});

function scene() {
    const w = new PlotWorld(CHAPTERS);
    const butler = w.person("管家");
    const maid = w.person("侍女");
    const k = w.point("管家是凶手", butler, {保密: "secret"});
    const trade = w.point("管家懂药", butler, {保密: "trade"});
    w.change(chapter("ch2"), {patches: [addRow(butler, k, {程度: "knows", 怎么知道: "witnessed"}), addRow(maid, k, {程度: "misbelieves", 他以为的: "园丁是凶手"})]});
    w.texts.set("ch3", "管家神色慌张。\n");
    w.change(chapter("ch3"), {told: [{source: "chapter", chapter: "ch3", quote: "管家神色慌张", marks: [reveal(k, "hint")]}]});
    return {w, butler, maid, k, trade};
}

describe("账本视图", () => {
    test("保密账本：保密以上的知识点，谁知道、谁误信、谁怀疑；读者从哪一段起；行内档不列；按位置读", () => {
        const {w, butler, maid, k, trade} = scene();
        const rows = secretLedger(w.view(), end("ch12"), "actual");
        expect(rows.map((row) => row.point)).toEqual([k]);
        expect(rows[0]).toMatchObject({name: "管家是凶手", secrecy: "secret", knows: [butler], misbelieves: [{person: maid, thinks: "园丁是凶手"}], suspects: [], reader: {suspects: {chapter: "ch3", paragraph: 1}}});
        expect(rows.some((row) => row.point === trade)).toBe(false);
        expect(secretLedger(w.view(), end("ch1"), "actual")[0]).toMatchObject({knows: [], misbelieves: []});
    });

    test("读者现在知道什么：最新一章末尾不是 unaware 的", () => {
        const {w, k} = scene();
        expect(readerKnown(w.view())).toEqual([{point: k, name: "管家是凶手", degree: "suspects"}]);
        w.texts.set("ch5", "管家认了罪。\n");
        w.change(chapter("ch5"), {told: [{source: "chapter", chapter: "ch5", quote: "管家认了罪", marks: [reveal(k, "explicit")]}]});
        expect(readerKnown(w.view())).toEqual([{point: k, name: "管家是凶手", degree: "knows"}]);
    });

    test("改揭晓章的依赖：计划、悬念连节点、决策、写作指示文字里出现名字的章", () => {
        const {w, k} = scene();
        const plan = w.change(chapter("ch10"), {kind: "plan", told: [{source: "outline", chapter: "ch10", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
        const fs = w.foreshadow("真凶之谜", {种类: "mystery", 答案: {ref: k}});
        w.texts.set("ch4", "手套上有血。\n");
        w.change(chapter("ch4"), {told: [{source: "chapter", chapter: "ch4", quote: "手套上有血", marks: [node(fs, "plant")]}]});
        const decision = w.decision("瞒到第 10 章", {about: [{kind: "entry", id: k}], conclusion: "瞒"});
        const onAddress = w.decision("名字先不露", {about: [{kind: "address", at: {entry: k, path: "entry.name"}}], conclusion: "瞒"});
        const deps = revealDependencies(w.view(), k, [{chapter: "ch9", version: "v1", avoid: ["写明管家是凶手"]}, {chapter: "ch8", version: "v1", tone: "冷"}]);
        expect(deps.plans).toEqual([{plan, chapter: "ch10", mode: "explicit"}]);
        expect(deps.foreshadows).toMatchObject([{foreshadow: fs, name: "真凶之谜"}]);
        expect(deps.foreshadows[0]!.nodes).toContainEqual({role: "plant", chapter: "ch4", paragraph: 1});
        expect(deps.decisions).toEqual([decision, onAddress]);
        expect(deps.instructions).toEqual(["ch9"]);
    });
});
