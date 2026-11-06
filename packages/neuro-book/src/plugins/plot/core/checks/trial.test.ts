import {describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";

import type {Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import {MARK_IDS} from "../../shared/declarations";
import {chapter, drafts, PlotWorld} from "../../testing/world";
import {judgeRequest} from "./trial";
import {planCheck, type CheckPlan, type PlannedCall} from "./plan";

const CHAPTERS = Array.from({length: 22}, (_, index) => `ch${String(index + 1)}`);
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};
const plan = (w: PlotWorld, chapterId: string, followUps: readonly string[] = []): CheckPlan => {
    const result = planCheck({view: w.view(), chapter: chapterId, followUps, digest});
    if ("code" in result) throw new Error(result.code);
    return result;
};
const trials = (found: CheckPlan): PlannedCall[] => found.calls.filter((call) => call.layer === "reader");
/** 计划明说揭示：第 N 章有一条计划，细纲讲述上带明说的揭示。 */
const revealPlan = (w: PlotWorld, at: string, point: string) => w.change(chapter(at), {kind: "plan", told: [{source: "outline", chapter: at, anchor: "细纲", marks: [reveal(point, "explicit")]}]});

/** 验收 2 的世界：悬念“谁杀了男爵”，答案“管家是凶手”，揭示计划在第 20 章。 */
function baron() {
    const w = new PlotWorld(CHAPTERS);
    const butler = w.person("管家");
    const k = w.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
    const fs = w.foreshadow("真凶之谜", {种类: "mystery", 答案: {ref: k}});
    w.change(chapter("ch3"), {told: [inText(w, "ch3", "男爵死在书房", [node(fs, "plant")])]});
    w.change(chapter("ch6"), {told: [inText(w, "ch6", "园丁的鞋上有泥", [node(fs, "mislead")])]});
    w.texts.set("ch3", `${w.texts.get("ch3")!}无关的一句。\n`);
    w.texts.set("ch11", "管家端着茶。\n");
    w.change(chapter("ch12"), {told: [inText(w, "ch12", "管家擦拭沾血的手套")]});
    revealPlan(w, "ch20", k);
    return {w, k, fs, butler};
}

describe("试读（验收 2）", () => {
    test("材料是悬念的全部节点所在的段（含误导）加上一章与本章全文，按章序；题面是读者问题；请求里没有命题、id、伏笔名", () => {
        const {w, k, fs} = baron();
        const found = plan(w, "ch12");
        const [call] = trials(found);
        expect(call).toBeDefined();
        expect(call!.role).toBe("reader");
        expect(call!.question).toBe("谁杀了男爵");
        expect(found.trials).toMatchObject([{point: k, materialKind: "suspense", material: [{chapter: "ch3", paragraph: 1}, {chapter: "ch6", paragraph: 1}, {chapter: "ch11"}, {chapter: "ch12"}]}]);
        const whole = `${call!.request.system}\n${call!.request.user}`;
        for (const text of ["男爵死在书房", "园丁的鞋上有泥", "管家端着茶", "管家擦拭沾血的手套", "谁杀了男爵"]) expect(whole).toContain(text);
        expect(whole).not.toContain("无关的一句");
        for (const leak of ["管家是凶手", k, fs, "真凶之谜", "ch3", "ch12", "main"]) expect(whole).not.toContain(leak);
        expect(call!.paragraphs).toContain("管家擦拭沾血的手套。");
    });

    test("判一致只拿试读的答案与命题，不带材料", () => {
        const request = judgeRequest("管家是凶手", {guess: "管家", confidence: "strong", quotes: ["管家擦拭沾血的手套。"]});
        expect(request.answer).toBe("judge");
        expect(request.user).toContain("管家是凶手");
        expect(request.user).toContain("管家");
        expect(request.user).not.toContain("沾血的手套");
    });

    test("读者已经知道的、之后没有明说揭示的、没到保密档的，不做试读", () => {
        const a = baron();
        a.w.change(chapter("ch9"), {told: [inText(a.w, "ch9", "管家认了罪", [reveal(a.k, "explicit")])]});
        expect(trials(plan(a.w, "ch12"))).toEqual([]);
        // 只读到暗示：还要做。
        const b = baron();
        b.w.change(chapter("ch9"), {told: [inText(b.w, "ch9", "管家神色慌张", [reveal(b.k, "hint")])]});
        expect(trials(plan(b.w, "ch12")).length).toBe(1);
        // 本章就是揭示所在章：之后没有明说揭示，不做。
        const c = new PlotWorld(CHAPTERS);
        const hero = c.person("管家");
        const k = c.point("管家是凶手", hero, {保密: "secret", 读者问题: "谁杀了男爵"});
        c.texts.set("ch12", "管家端着茶。\n");
        revealPlan(c, "ch12", k);
        expect(trials(plan(c, "ch12"))).toEqual([]);
        // 行内档不做。
        const d = new PlotWorld(CHAPTERS);
        const hero2 = d.person("管家");
        const trade = d.point("管家懂药", hero2, {保密: "trade", 读者问题: "谁懂药"});
        d.texts.set("ch12", "管家端着茶。\n");
        revealPlan(d, "ch20", trade);
        expect(trials(plan(d, "ch12"))).toEqual([]);
    });

    test("已写的明说揭示在本章之后也算前提；撤销的计划不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
        w.texts.set("ch12", "管家端着茶。\n");
        const later = revealPlan(w, "ch20", k);
        expect(trials(plan(w, "ch12")).length).toBe(1);
        const stored = w.world.data.changes.get(later)!;
        w.publish([{ref: {kind: "change", id: later}, after: {...stored, status: "undone", undoneReason: "不要了"}}]);
        expect(trials(plan(w, "ch12"))).toEqual([]);
        w.change(chapter("ch18"), {told: [inText(w, "ch18", "管家认了罪", [reveal(k, "explicit")])]});
        expect(trials(plan(w, "ch12")).length).toBe(1);
    });

    test("没有读者问题、读者问题含命题或名字：不做，提示 noReaderQuestion", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const none = w.point("管家是凶手", butler, {保密: "secret"});
        const leaky = w.point("园丁是共犯", butler, {保密: "secret", 读者问题: "园丁是共犯吗"});
        w.texts.set("ch12", "管家端着茶。\n");
        revealPlan(w, "ch20", none);
        revealPlan(w, "ch20", leaky);
        const found = plan(w, "ch12");
        expect(trials(found)).toEqual([]);
        expect(found.noReaderQuestion).toEqual([none, leaky].sort());
    });

    test("没有悬念连着：只给上一章与本章全文，标 twoChapters，提示 noSuspense", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
        w.texts.set("ch11", "上一章的茶。\n");
        w.texts.set("ch12", "管家端着茶。\n");
        revealPlan(w, "ch20", k);
        const found = plan(w, "ch12");
        expect(found.noSuspense).toEqual([k]);
        expect(found.trials).toMatchObject([{materialKind: "twoChapters", material: [{chapter: "ch11"}, {chapter: "ch12"}]}]);
    });

    test("每章最多 3 次：绝密在前，其余记没问", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const points = Array.from({length: 4}, (_, index) => w.point(`秘密${String(index)}`, butler, {保密: index === 3 ? "topSecret" : "secret", 读者问题: `问题${String(index)}`}));
        w.texts.set("ch12", "管家端着茶。\n");
        for (const point of points) revealPlan(w, "ch20", point);
        const found = plan(w, "ch12");
        expect(found.trials.length).toBe(3);
        expect(found.trials[0]!.point).toBe(points[3]!);
        expect(found.unasked.filter((item) => item.layer === "reader").length).toBe(1);
    });

    test("分段讲的书：别的线上的节点、明说揭示也算，线名不进请求", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
        const fs = w.foreshadow("真凶之谜", {种类: "mystery", 答案: {ref: k}});
        w.texts.set("ch1", "开头。\n");
        const cut = w.change(chapter("ch1"));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch2")), nature: "fork", fork: {line: "tmp:r1", name: "管家线", parent: "main", cut, type: "branch"}}}]);
        const r1 = ids["tmp:r1"]!;
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch3", [{line: r1, from: 1}]]])});
        w.change({kind: "chapter", chapter: "ch3", key: 0, line: r1}, {told: [inText(w, "ch3", "手套上有血", [node(fs, "plant")])]});
        w.texts.set("ch8", "管家端着茶。\n");
        revealPlan(w, "ch20", k);
        const found = plan(w, "ch8");
        expect(found.trials).toMatchObject([{material: [{chapter: "ch3", paragraph: 1}, {chapter: "ch7"}, {chapter: "ch8"}]}]);
        const [call] = trials(found);
        expect(call!.request.user).toContain("手套上有血");
        expect(call!.request.user).not.toContain("管家线");
    });
});
