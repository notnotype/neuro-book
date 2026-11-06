import {describe, expect, test} from "bun:test";

import type {InstructionSnapshot} from "../../shared/instructions";
import {addRow, chapter, drafts, learns, PlotWorld, present} from "../../testing/world";
import {MARK_IDS} from "../../shared/declarations";
import {budgeted, candidatesOf, type Candidate} from "./candidates";
import {pointsAfterWriting} from "./points";
import {segmentsOf, writtenIn} from "./segments";

const CHAPTERS = Array.from({length: 12}, (_, index) => `ch${String(index + 1)}`);

/** 第 N 章各段的候选。 */
function candidates(w: PlotWorld, chapterId: string, instruction?: InstructionSnapshot): Candidate[] {
    const view = w.view();
    const segments = segmentsOf(view, chapterId, instruction);
    if (typeof segments === "string") throw new Error(segments);
    return segments.flatMap((segment) => {
        const written = writtenIn(segment, chapterId);
        const points = pointsAfterWriting(segment, chapterId, written, view.chapterText(chapterId) ?? "");
        return candidatesOf({segment, chapter: chapterId, points, written, instruction});
    });
}
const ids = (found: readonly Candidate[], layer: Candidate["layer"]) => found.filter((candidate) => candidate.layer === layer).map((candidate) => candidate.id);
const instruction = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});

describe("在场层", () => {
    test("保密以上的 K × 在场、不知道的人：知道的不问；只有 label 的也算；行内档不问；误信的多问一条；保密的知识点只因正文提到主体也进集合", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const sage = w.person("贤者");
        const liar = w.person("骗子");
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        const trade = w.point("勇者是左撇子", hero, {保密: "trade"});
        w.change(chapter("ch1"), {cast: [present(sage)], patches: [addRow(sage, k, {程度: "knows", 怎么知道: "witnessed"}), addRow(liar, k, {程度: "misbelieves", 他以为的: "疤在右手", 怎么知道: "told", 谁告诉的: {ref: sage}})]});
        w.texts.set("ch4", "卫兵盯着旅人的左手。\n这人就是勇者吧？\n");
        w.change(chapter("ch4"), {cast: [present(guard), present(sage), present(liar), {label: "路人", role: "present"}]});
        const found = candidates(w, "ch4");
        const seg = "main#1";
        expect(ids(found, "presence").sort()).toEqual([
            `presence:${seg}:${k}:${guard}`,
            `presence:${seg}:${k}:${liar}`,
            `presence:${seg}:${k}:label:路人`,
            `presence-misbelief:${seg}:${k}:${liar}`,
        ].sort());
        expect(found.some((candidate) => candidate.id.includes(trade))).toBe(false);
        expect(found.find((candidate) => candidate.id === `presence:${seg}:${k}:label:路人`)).toMatchObject({personName: "路人", row: null});
    });

    test("知情按段的位置（章末）读：本章得知的人不算候选；以后才得知、隐秘目标后改，都不影响第 N 章", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const [learner, later] = [w.person("学徒"), w.person("后来者")];
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.texts.set("ch4", "勇者走进客栈。\n");
        w.change(chapter("ch4"), {cast: [present(learner), present(later)], marks: [learns(k)]});
        expect(ids(candidates(w, "ch4"), "presence")).toEqual([]);

        const w2 = new PlotWorld(CHAPTERS);
        const hero2 = w2.person("勇者");
        const butler = w2.person("管家");
        const k2 = w2.point("勇者左手有星形的疤", hero2, {保密: "secret"});
        const goal = w2.goal("隐瞒", butler);
        w2.texts.set("ch4", "勇者走进客栈。\n");
        w2.change(chapter("ch4"), {cast: [present(butler)]});
        const before = ids(candidates(w2, "ch4"), "presence");
        expect(before).toEqual([`presence:main#1:${k2}:${butler}`]);
        // 第 10 章才把目标的隐秘设成 K：第 4 章末尾他还不知道，第 4 章的候选不变。
        w2.change(chapter("ch10"), {patches: [{op: "set", at: {entry: goal, path: "goal.隐秘"}, value: {ref: k2}}]});
        expect(ids(candidates(w2, "ch4"), "presence")).toEqual(before);
    });

    test("没记 cast 的变更不提供候选；撤销的、不是本章的不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.texts.set("ch4", "勇者走进客栈。\n");
        w.change(chapter("ch4"), {});
        w.change(chapter("ch5"), {cast: [present(guard)]});
        expect(ids(candidates(w, "ch4"), "presence")).toEqual([]);
    });

    test("出场晚于这一章的知识点不进集合；出场在这一章的进", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const late = w.point("后来才有的秘密", hero, {保密: "secret"});
        const now = w.point("这一章才有的秘密", hero, {保密: "secret"});
        const place = (id: string, at: string) => w.publish([{ref: {kind: "entry", id}, after: {...w.world.data.entries.get(id)!, appears: chapter(at)}}]);
        place(late, "ch9");
        place(now, "ch4");
        w.texts.set("ch4", "勇者走进客栈。\n");
        w.change(chapter("ch4"), {cast: [present(guard)]});
        expect(ids(candidates(w, "ch4"), "presence")).toEqual([`presence:main#1:${now}:${guard}`]);
    });
});

describe("叙述层", () => {
    test("第一人称或有限视角：保密以上、视角人物不知道或误信的 K；全知不问；知道、怀疑的不问", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("星瑾");
        const k = w.point("星瑾是公主", hero, {保密: "topSecret"});
        const known = w.point("星瑾会用剑", hero, {保密: "secret"});
        const hunch = w.point("星瑾被跟踪", hero, {保密: "secret"});
        w.change(chapter("ch1"), {patches: [addRow(hero, known, {程度: "knows", 怎么知道: "witnessed"}), addRow(hero, hunch, {程度: "suspects", 怎么知道: "inferred"})]});
        w.texts.set("ch4", "星瑾推开门。\n");
        w.change(chapter("ch4"), {cast: [present(hero)]});
        const pov = {kind: "entry" as const, id: hero};
        expect(ids(candidates(w, "ch4", instruction("ch4", {pov, povMode: "limited"})), "narration")).toEqual([`narration:main#1:${k}`]);
        expect(ids(candidates(w, "ch4", instruction("ch4", {pov, povMode: "omniscient"})), "narration")).toEqual([]);
        expect(ids(candidates(w, "ch4"), "narration")).toEqual([]);
    });
});

describe("伏笔物件层与时间层", () => {
    const telling = (w: PlotWorld, chapterId: string, quote: string, marks = [] as {kind: string; version: number; [key: string]: unknown}[]) => {
        w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
        return {source: "chapter" as const, chapter: chapterId, quote, marks};
    };

    test("已埋未回收的伏笔的物件：正文出现或变更涉及时一问，题面带阶段与读者见没见过；没埋的、回收了的不问；时间层每段一问", () => {
        const w = new PlotWorld(CHAPTERS);
        const clock = w.thing("那座钟");
        const fs = w.foreshadow("那座钟慢了一刻", {物件: [{id: clock}]});
        const quiet = w.thing("那把伞");
        w.foreshadow("没埋的", {物件: [{id: quiet}]});
        w.change(chapter("ch3"), {told: [telling(w, "ch3", "钟慢了一刻", [{kind: MARK_IDS.node, version: 1, foreshadow: fs, role: "plant"}])]});
        w.texts.set("ch5", "那座钟又响了。\n那把伞还在。\n");
        const found = candidates(w, "ch5");
        expect(found.filter((candidate) => candidate.layer === "object")).toMatchObject([{id: `object:main#1:${clock}`, objectName: "那座钟", stages: [{foreshadow: fs, stage: "planted"}]}]);
        expect(ids(found, "time")).toEqual(["time:main#1"]);
        // 第 2 章还没埋：不问。
        w.texts.set("ch2", "那座钟走得很好。\n");
        expect(ids(candidates(w, "ch2"), "object")).toEqual([]);
        // 正文没提、变更也不涉及：不问。
        w.texts.set("ch6", "天黑了。\n");
        expect(ids(candidates(w, "ch6"), "object")).toEqual([]);
        // 变更涉及：问，读者之前见过（第 5 章的变更改了它）。
        w.change(chapter("ch5"), {patches: [{op: "set", at: {entry: clock, path: "character.状态"}, value: "拨回正点"}]});
        w.texts.set("ch7", "天亮了。\n");
        w.change(chapter("ch7"), {patches: [{op: "set", at: {entry: clock, path: "character.状态"}, value: "停了"}]});
        expect(candidates(w, "ch7").find((candidate) => candidate.layer === "object")).toMatchObject({object: clock, seenBefore: true});
        // 回收了以后不问。
        w.change(chapter("ch8"), {told: [telling(w, "ch8", "钟的事说破了", [{kind: MARK_IDS.node, version: 1, foreshadow: fs, role: "payoff"}])]});
        w.texts.set("ch9", "那座钟又响了。\n");
        expect(ids(candidates(w, "ch9"), "object")).toEqual([]);
    });
});

describe("分段章与补叙", () => {
    test("分段讲两条线：每段各圈各的，段的身份按线第几次出现，变更按讲述的发生点归段", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const [guard, maid] = [w.person("卫兵"), w.person("侍女")];
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.texts.set("ch1", "开头。\n");
        const cut = w.change(chapter("ch1"));
        const ids2 = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch2")), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, type: "branch"}}}]);
        const r1 = ids2["tmp:r1"]!;
        w.texts.set("ch3", "勇者走进客栈，卫兵盘问。\n勇者回头。\n侍女端来茶，勇者接过。\n");
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch3", [{line: "main", from: 1}, {line: r1, from: 3}]]])});
        w.change(chapter("ch3"), {cast: [present(guard)], told: [{source: "chapter", chapter: "ch3", quote: "卫兵盘问"}]});
        w.change({kind: "chapter", chapter: "ch3", key: 0, line: r1}, {cast: [present(maid)], told: [{source: "chapter", chapter: "ch3", quote: "侍女端来茶"}]});
        const found = candidates(w, "ch3");
        expect(ids(found, "presence")).toEqual([`presence:main#1:${k}:${guard}`, `presence:${r1}#1:${k}:${maid}`]);
        expect(ids(found, "time")).toEqual(["time:main#1", `time:${r1}#1`]);
    });

    test("补叙章：候选读声明的安放，不读本章章末；讲述落在本章、安放在别处的变更也算本章", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        // 卫兵第 8 章才得知；第 10 章补叙第 5 章的事：那时他还不知道。
        w.change(chapter("ch8"), {cast: [present(guard)], marks: [learns(k)]});
        w.texts.set("ch10", "那一年，卫兵盯着旅人的左手，勇者低头。\n");
        const flashback = instruction("ch10", {timeMode: {flashback: {kind: "chapter", chapter: "ch5", key: 0}}});
        w.change(chapter("ch5"), {cast: [present(guard)], told: [{source: "chapter", chapter: "ch10", quote: "卫兵盯着旅人的左手"}]});
        expect(ids(candidates(w, "ch10", flashback), "presence")).toEqual([`presence:main#1:${k}:${guard}`]);
        // 不按补叙读的话，第 10 章末尾他已经知道，问不到。
        expect(ids(candidates(w, "ch10"), "presence")).toEqual([]);
    });
});

describe("预算（验收 3）", () => {
    test("25 个候选问 20 个，按价值排，其余记没问；补问清单里仍是候选的不占预算，不是候选的忽略", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 13}, (_, index) => w.person(`人${String(index)}`));
        const top = w.point("绝密的事", hero, {保密: "topSecret"});
        const secret = w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        const found = candidates(w, "ch7");
        expect(found.length).toBe(27);
        const {asked, unasked} = budgeted(found, []);
        expect(asked.length).toBe(20);
        expect(unasked.length).toBe(7);
        expect(asked.slice(0, 13).every((candidate) => candidate.id.includes(`:${top}:`))).toBe(true);
        expect(asked[13]!.id).toContain(`:${secret}:`);
        expect(unasked.map((candidate) => candidate.layer).at(-1)).toBe("time");
        const follow = unasked[2]!.id;
        const again = budgeted(found, [follow, "presence:main#1:没有这个:谁"]);
        expect(again.asked.length).toBe(21);
        expect(again.asked.at(-1)!.id).toBe(follow);
        expect(again.unasked.length).toBe(6);
    });

    test("同样的输入排出同样的次序（与候选的先后无关）", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const people = Array.from({length: 5}, (_, index) => w.person(`人${String(index)}`));
        w.point("保密的事", hero, {保密: "secret"});
        w.texts.set("ch7", "勇者走进客栈。\n");
        w.change(chapter("ch7"), {cast: people.map(present)});
        const found = candidates(w, "ch7");
        expect(budgeted([...found].reverse(), []).asked.map((candidate) => candidate.id)).toEqual(budgeted(found, []).asked.map((candidate) => candidate.id));
    });
});
