import {describe, expect, test} from "bun:test";

import type {DiagnosticCompute, Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import {FS_DIAGNOSTIC_IDS, MARK_IDS} from "../shared/declarations";
import {chapter, end, PlotWorld} from "../testing/world";
import {foreshadowDiagnostics, ForeshadowIndex, ledger, tellingPositionOf} from "./foreshadowing";

const CHAPTERS = Array.from({length: 20}, (_, index) => `ch${String(index + 1)}`);
const compute = foreshadowDiagnostics();
const run = (w: PlotWorld, id: string, at = end("ch20")) => (compute[id] as DiagnosticCompute)(w.view(), at, "actual");
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};
const stageAt = (w: PlotWorld, foreshadow: string, at = end("ch20")) => new ForeshadowIndex(w.view(), at).stage(foreshadow, tellingPositionOf(at)).stage;

describe("plot.foreshadowing 验收场景 1：钟", () => {
    test("埋下、呼应、计划回收；物件被动过提示；第 15 章写完没回收报待处理；补上以后已回收；删掉那句退回呼应中、待处理回来", () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const fs = w.foreshadow("那座钟慢了一刻", {物件: [{id: clock}]});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟慢了一刻", [node(fs, "plant")])]});
        w.change(chapter("ch7"), {told: [inText(w, "ch7", "钟又响了", [node(fs, "echo")])]});
        const plan = w.change(chapter("ch15"), {kind: "plan", told: [{source: "outline", chapter: "ch15", anchor: "细纲第 15 章", marks: [node(fs, "payoff")]}]});
        w.change(chapter("ch10"), {patches: [{op: "set", at: {entry: clock, path: "character.状态"}, value: "拨回正点"}]});
        expect(run(w, FS_DIAGNOSTIC_IDS.objectTouched).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: fs}, {kind: "entry", id: clock}, expect.objectContaining({kind: "change"})]]);
        expect(stageAt(w, fs)).toBe("echoing");

        w.change(chapter("ch15"), {told: [inText(w, "ch15", "天黑了")]});
        expect(run(w, FS_DIAGNOSTIC_IDS.plannedNodeMissing)).toMatchObject([{key: {objects: [{id: fs}, {id: plan}]}, params: {reason: "plan-unfulfilled"}}]);

        const written = w.change(chapter("ch15", 5), {told: [inText(w, "ch15", "钟停在三点", [node(fs, "payoff")])], links: [{kind: "fulfills", plan}]});
        expect(stageAt(w, fs)).toBe("paidOff");
        expect(run(w, FS_DIAGNOSTIC_IDS.plannedNodeMissing)).toEqual([]);
        expect(written).toBeDefined();

        w.texts.set("ch15", "天黑了。\n");
        expect(stageAt(w, fs)).toBe("echoing");
        expect(run(w, FS_DIAGNOSTIC_IDS.plannedNodeMissing)).toMatchObject([{params: {reason: "no-node-in-chapter"}}]);
    });
});

describe("plot.foreshadowing 验收场景 2：悬念与答案", () => {
    test("答案上的暗示让阶段到呼应中，明说让它已回收；同一知识点被两个悬念指向：两个都算，并提示", () => {
        const w = new PlotWorld(CHAPTERS);
        const k = w.point("管家是凶手", null);
        const [first, second] = [w.foreshadow("谁杀了男爵", {种类: "mystery", 答案: {ref: k}}), w.foreshadow("管家的秘密", {种类: "mystery", 答案: {ref: k}})];
        w.change(chapter("ch5"), {told: [inText(w, "ch5", "管家的手在抖", [reveal(k, "hint")])]});
        expect([stageAt(w, first, end("ch5")), stageAt(w, second, end("ch5"))]).toEqual(["echoing", "echoing"]);
        w.change(chapter("ch20"), {told: [inText(w, "ch20", "凶手就是管家", [reveal(k, "explicit")])]});
        expect([stageAt(w, first), stageAt(w, second)]).toEqual(["paidOff", "paidOff"]);
        expect(run(w, FS_DIAGNOSTIC_IDS.sharedAnswer).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: k}]]);
    });
});

describe("plot.foreshadowing 验收场景 3、输出 4：继承", () => {
    test("计划带呼应节点，兑现它的已写变更自己没标：节点继承到它第一处正文讲述上；它没有正文讲述时提示没有位置", () => {
        const w = new PlotWorld(CHAPTERS);
        const letter = w.foreshadow("信");
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "桌上有封信", [node(letter, "plant")])]});
        const plan = w.change(chapter("ch9"), {kind: "plan", told: [{source: "outline", chapter: "ch9", anchor: "提一次那封信", marks: [node(letter, "echo")]}]});
        w.change(chapter("ch9"), {told: [inText(w, "ch9", "她又想起那封信")], links: [{kind: "fulfills", plan}]});
        const index = new ForeshadowIndex(w.view(), end("ch20"));
        expect(index.nodes.filter((item) => item.foreshadow === letter).map((item) => [item.role, item.source, item.occurrence.chapter])).toEqual([["plant", "node", "ch2"], ["echo", "inherited", "ch9"]]);

        const other = w.change(chapter("ch12"), {kind: "plan", told: [{source: "outline", chapter: "ch12", anchor: "再提", marks: [node(letter, "echo")]}]});
        const silent = w.change(chapter("ch12"), {links: [{kind: "fulfills", plan: other}]});
        expect(run(w, FS_DIAGNOSTIC_IDS.nodeWithoutTelling).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: letter}, {kind: "change", id: silent}]]);
    });
});

describe("plot.foreshadowing 验收场景 4、输出 6、7：其余检查", () => {
    test("第一个节点是回收：没埋就回收；回收以后又埋；放弃了还留着；没有悬念认领的暗示；太久没提；没排回收；悬念回收那章没明说答案", () => {
        const w = new PlotWorld(CHAPTERS);
        const early = w.foreshadow("早收");
        const payoff = w.change(chapter("ch2"), {told: [inText(w, "ch2", "原来如此", [node(early, "payoff")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.payoffBeforePlant)).toHaveLength(1);
        w.change(chapter("ch4"), {told: [inText(w, "ch4", "又埋了一次", [node(early, "plant")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.replantAfterPayoff)).toHaveLength(1);
        expect(payoff).toBeDefined();

        const dropped = w.foreshadow("不要了", {意图: "dropped", 重要程度: "minor"});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "一只猫", [node(dropped, "plant")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.droppedButPlanted).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: dropped}]]);
        // 次要的伏笔缺省间隔 10 章：第 3 章埋下，到第 20 章 17 章没提。
        expect(run(w, FS_DIAGNOSTIC_IDS.longSilence).map((finding) => (finding.key.objects as unknown[])[0])).toContainEqual({kind: "entry", id: dropped});
        expect(run(w, FS_DIAGNOSTIC_IDS.noPayoffPlanned).map((finding) => (finding.key.objects as {id: string}[])[0]!.id)).toContain(dropped);

        const lonely = w.point("雨会停", null);
        w.change(chapter("ch6"), {told: [inText(w, "ch6", "天色发亮", [reveal(lonely, "hint")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.orphanHint).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: lonely}]]);

        const answer = w.point("钥匙在井里", null);
        const mystery = w.foreshadow("钥匙去哪了", {种类: "mystery", 答案: {ref: answer}});
        w.change(chapter("ch8"), {told: [inText(w, "ch8", "钥匙不见了", [node(mystery, "plant")])]});
        w.change(chapter("ch18"), {told: [inText(w, "ch18", "终于找到了", [node(mystery, "payoff")])]});
        expect(run(w, FS_DIAGNOSTIC_IDS.payoffWithoutReveal).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: mystery}]]);
    });

    test("账本：阶段、节点、计划的节点、最后一次被提到的章、物件最近一次被改的变更；按阶段筛", () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const fs = w.foreshadow("那座钟慢了一刻", {物件: [{id: clock}]});
        w.change(chapter("ch3"), {told: [inText(w, "ch3", "钟慢了一刻", [node(fs, "plant")])]});
        w.change(chapter("ch15"), {kind: "plan", told: [{source: "outline", chapter: "ch15", anchor: "回收", marks: [node(fs, "payoff")]}]});
        const touched = w.change(chapter("ch10"), {patches: [{op: "set", at: {entry: clock, path: "character.状态"}, value: "拨回正点"}]});
        expect(ledger(w.view(), end("ch20"), "actual")).toEqual([{
            id: fs, name: "那座钟慢了一刻", kind: "setupPayoff", importance: "main", intent: "active", stage: "planted", dropped: false,
            nodes: [{role: "plant", chapter: "ch3", paragraph: 1, telling: expect.any(String), source: "node"}],
            planned: [{role: "payoff", chapter: "ch15", plan: expect.any(String)}],
            lastMentioned: "ch3",
            objects: [{id: clock, lastChange: touched}],
        }]);
        expect(ledger(w.view(), end("ch20"), "actual", {stage: "paidOff"})).toEqual([]);
    });
});
