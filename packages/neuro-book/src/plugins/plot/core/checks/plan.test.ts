import {describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";

import type {SelfReport} from "../../shared/checks";
import type {InstructionSnapshot} from "../../shared/instructions";
import {addRow, chapter, PlotWorld, present} from "../../testing/world";
import {planCheck, type CheckPlan, type PlanInput} from "./plan";

const CHAPTERS = Array.from({length: 12}, (_, index) => `ch${String(index + 1)}`);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const plan = (w: PlotWorld, chapterId: string, extra: Partial<PlanInput> = {}): CheckPlan => {
    const result = planCheck({view: w.view(), chapter: chapterId, followUps: [], digest, ...extra});
    if ("code" in result) throw new Error(result.code);
    return result;
};
const fixed = (found: CheckPlan) => found.calls.find((call) => call.layer === "fixed")!;
const instruction = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});
const selfReport = (chapterId: string, brief: string, names: string[] = []): SelfReport => ({chapter: chapterId, brief, report: {names, unsure: [], deviations: []}});

function guardScene() {
    const w = new PlotWorld(CHAPTERS);
    const hero = w.person("勇者");
    const guard = w.person("卫兵");
    const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
    w.texts.set("ch4", "卫兵盯着旅人的左手，说：你是勇者吧。\n");
    w.change(chapter("ch4"), {cast: [present(guard)]});
    return {w, hero, guard, k};
}

describe("planCheck", () => {
    test("题面写明事实，材料是这一段的正文；章不在章序里、线读不到给码", () => {
        const {w, guard, k} = guardScene();
        const found = plan(w, "ch4");
        const call = found.calls.find((item) => item.layer === "presence")!;
        expect(call).toMatchObject({id: `presence:main#1:${k}:${guard}`, role: "ledger", point: k, person: guard, segment: "main#1", personName: "卫兵"});
        expect(call.question).toContain("勇者左手有星形的疤");
        expect(call.question).toContain("卫兵");
        expect(call.request.user).toContain("卫兵盯着旅人的左手");
        expect(call.request.user.indexOf("卫兵盯着旅人的左手")).toBeLessThan(call.request.user.indexOf(call.question));
        expect(found.calls.map((item) => item.layer)).toEqual(["presence", "time", "fixed"]);
        expect(planCheck({view: w.view(), chapter: "没有", followUps: [], digest})).toEqual({code: "chapter-not-found"});
    });

    test("同样的输入拼出同样的摘要；正文、自陈、写作指示、补问清单变了摘要才变", () => {
        const {w, k, guard} = guardScene();
        const first = plan(w, "ch4");
        expect(plan(w, "ch4").calls.map((call) => call.digest)).toEqual(first.calls.map((call) => call.digest));
        const report = selfReport("ch4", "写手的上下文");
        const withReport = plan(w, "ch4", {selfReport: report});
        expect(fixed(withReport).digest).not.toBe(fixed(first).digest);
        expect(fixed(withReport).request.user).toContain("写手的上下文");
        expect(fixed(first).request.user).toContain("写手的上下文：\n没有");
        expect(withReport.calls.find((call) => call.layer === "presence")!.digest).toBe(first.calls.find((call) => call.layer === "presence")!.digest);
        const withInstruction = plan(w, "ch4", {instruction: instruction("ch4", {ending: "他走了"})});
        expect(fixed(withInstruction).digest).not.toBe(fixed(first).digest);
        w.texts.set("ch4", "卫兵例行盘问，放勇者进了城。\n");
        const edited = plan(w, "ch4");
        expect(edited.calls.find((call) => call.id === `presence:main#1:${k}:${guard}`)!.digest).not.toBe(first.calls.find((call) => call.id === `presence:main#1:${k}:${guard}`)!.digest);
    });

    test("本章之后的世界变了：调用集合与摘要不变（后面的变更、出场更晚的条目）；条件变了才变（前面给了他知情）", () => {
        const {w, hero, guard, k} = guardScene();
        const first = plan(w, "ch4");
        const signature = (found: CheckPlan) => found.calls.map((call) => [call.id, call.digest]);
        const later = w.person("后来者");
        w.change(chapter("ch9"), {cast: [present(later), present(guard)], patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]});
        const lateK = w.point("后来才有的秘密", hero, {保密: "secret"});
        w.publish([{ref: {kind: "entry", id: lateK}, after: {...w.world.data.entries.get(lateK)!, appears: chapter("ch9")}}]);
        expect(signature(plan(w, "ch4"))).toEqual(signature(first));
        w.change(chapter("ch2"), {patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]});
        expect(plan(w, "ch4").calls.map((call) => call.layer)).toEqual(["time", "fixed"]);
    });

    test("固定调用的规则项：每段视角、结尾、不写的、已定决策的每条约束、待定决策；决策按 id 去重", () => {
        const {w, hero, k} = guardScene();
        const decided = w.decision("卫兵的立场", {about: [{kind: "chapter", id: "ch4"}], conclusion: "不让他认出来", constraints: ["卫兵不认识勇者", "别提星形"]});
        const pending = w.decision("勇者的来历", {about: [{kind: "chapter", id: "ch4"}]});
        const unrelated = w.decision("别处的事", {about: [{kind: "chapter", id: "ch9"}]});
        const found = plan(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: hero}, povMode: "limited", ending: "他走了", avoid: ["写天气"]})});
        const items = found.rules.map((rule) => rule.item);
        expect(items).toContain("pov:main#1");
        expect(items).toContain("ending");
        expect(items.some((item) => item.startsWith("avoid:"))).toBe(true);
        expect(items).toContain(`constraint:${decided}:0`);
        expect(items).toContain(`constraint:${decided}:1`);
        expect(items).toContain(`pending:${pending}`);
        expect(items.some((item) => item.includes(unrelated))).toBe(false);
        expect(fixed(found).request.user).toContain("卫兵不认识勇者");
        expect(fixed(found).request.user).toContain("写天气");
        // 全知、没写视角的没有视角项。
        expect(plan(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: hero}, povMode: "omniscient"})}).rules.map((rule) => rule.item)).not.toContain("pov:main#1");
        expect(k).toBeDefined();
    });

    test("没记 cast 的已写变更记 uncast；新事实查世界用的名字表带别名、不带没出场的", () => {
        const w = new PlotWorld(CHAPTERS);
        const guard = w.person("卫兵", {init: {name: "卫兵", aliases: ["老王"], summary: "", text: [], data: {}}} as never);
        const late = w.person("后来者");
        w.publish([{ref: {kind: "entry", id: late}, after: {...w.world.data.entries.get(late)!, appears: chapter("ch9")}}]);
        w.texts.set("ch4", "天黑了。\n");
        w.change(chapter("ch4"), {});
        w.change(chapter("ch4", 1), {cast: []});
        const found = plan(w, "ch4");
        expect(found.uncast).toBe(1);
        const names = found.namesBySegment.get("main#1")!;
        expect(names.has("老王")).toBe(true);
        expect(names.has("后来者")).toBe(false);
        expect(guard).toBeDefined();
    });

    test("补问清单：超出预算的候选被点名就问，不是候选的忽略", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 22}, (_, index) => w.person(`人${String(index)}`));
        w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        const first = plan(w, "ch7");
        expect(first.unasked.length).toBe(3);
        const named = first.unasked[0]!.id;
        const second = plan(w, "ch7", {followUps: [named, "没有这个"]});
        expect(second.calls.some((call) => call.id === named)).toBe(true);
        expect(second.unasked.length).toBe(2);
    });
});
