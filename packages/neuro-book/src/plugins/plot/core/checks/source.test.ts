/**
 * 诊断读到的结论（`source.ts`：先比依赖摘要，相同就沿用；不同才重拼，仍有效就回写）与全量重拼相同（docs/specs/plot/checks.md 输出 7）。记录跨步留存：真正要守的是“任何序列上，
 * 走摘要的结论等于重拼的结论”，每步重算记录测不到回写以后的路径。
 */

import {describe, expect, test} from "bun:test";

import type {Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import type {CheckRecord} from "../../shared/checks";
import type {InstructionSnapshot} from "../../shared/instructions";
import {MARK_IDS} from "../../shared/declarations";
import {digest, planOf, runOk, scripted} from "../../testing/checks";
import {randomBook, seeded} from "../../testing/random-edits";
import {addRow, chapter, PlotWorld, present} from "../../testing/world";
import {createCheckSource} from "./source";
import {isValid} from "./validity";

const CHAPTERS = Array.from({length: 22}, (_, index) => `ch${String(index + 1)}`);
const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};

/** 记录表与来源：回写就像产品里那样换进表（当前记录还是 `original` 才换）。 */
function harness(instructions: ReadonlyMap<string, InstructionSnapshot> = new Map()) {
    const records = new Map<string, CheckRecord>();
    const empty = {get: () => undefined, digestOf: () => undefined};
    const source = createCheckSource({
        records: {all: () => [...records.values()]},
        instructions: {get: (id) => instructions.get(id), digestOf: (id) => (instructions.has(id) ? digest(JSON.stringify(instructions.get(id))) : undefined)},
        selfReports: empty,
        pluginVersion: "test",
        digest,
        writeBack: (original, updated) => {
            if (records.get(original.chapter) === original) records.set(original.chapter, updated);
        },
    });
    const check = async (w: PlotWorld, chapterId: string) => {
        const instruction = instructions.get(chapterId);
        const scene = instruction === undefined ? {} : {instruction};
        const record = await runOk(w, chapterId, scripted().models, scene);
        const plan = planOf(w, chapterId, scene);
        records.set(chapterId, {...record, dependencies: source.dependencies(w.view(), chapterId, [], plan) ?? ""});
    };
    return {records, source, check};
}

describe("回写以后", () => {
    test("新知识点进了本章（结论没变，回写）；之后给它加后面的明说揭示：过期", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        w.texts.set("ch8", "勇者走进客栈。\n");
        const {records, source, check} = harness();
        await check(w, "ch8");
        const k = w.point("勇者是王子", hero, {保密: "secret", 读者问题: "勇者是什么来头"});
        expect(source.valid(w.view(), records.get("ch8")!)).toBe(true);
        expect(records.get("ch8")!.points).toContain(k);
        w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
        expect(isValid({view: w.view(), record: records.get("ch8")!, digest})).toBe(false);
        expect(source.valid(w.view(), records.get("ch8")!)).toBe(false);
    });

    test("本章多了一个只被提到的人（结论没变，回写）；之后写挂在他身上的待定决策：过期", async () => {
        const w = new PlotWorld(CHAPTERS);
        const other = w.person("别处的人");
        w.texts.set("ch8", "天黑了。\n");
        const {records, source, check} = harness();
        await check(w, "ch8");
        w.change(chapter("ch8"), {cast: [{who: other, role: "mentioned"}]});
        expect(source.valid(w.view(), records.get("ch8")!)).toBe(true);
        expect(records.get("ch8")!.concerns).toContain(other);
        w.decision("他的来历", {about: [{kind: "entry", id: other}]});
        expect(isValid({view: w.view(), record: records.get("ch8")!, digest})).toBe(false);
        expect(source.valid(w.view(), records.get("ch8")!)).toBe(false);
    });

    test("回写之后重启（新的来源）：摘要对得上，不用重拼", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        w.texts.set("ch8", "勇者走进客栈。\n");
        const {records, source, check} = harness();
        await check(w, "ch8");
        w.point("勇者是王子", hero, {保密: "secret"});
        expect(source.valid(w.view(), records.get("ch8")!)).toBe(true);
        const restarted = harness();
        const dependencies = restarted.source.dependencies(w.view(), "ch8", [], records.get("ch8")!);
        expect(dependencies).toBe(records.get("ch8")!.dependencies);
    });
});

describe("备忘要认记录", () => {
    test("这一章换了新记录：旧记录重拼的结论不算新记录的", async () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.texts.set("ch4", "勇者走进客栈，卫兵盘问。\n");
        w.change(chapter("ch4"), {cast: [present(guard)]});
        const {records, source, check} = harness();
        await check(w, "ch4");
        const first = records.get("ch4")!;
        // 世界变了：卫兵知情，第二条记录在这张世界上跑（候选少了他）。
        const row = w.change(chapter("ch2"), {patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]});
        const second = {...await runOk(w, "ch4", scripted().models)};
        const plan = planOf(w, "ch4");
        const secondRecord = {...second, dependencies: source.dependencies(w.view(), "ch4", [], plan) ?? ""};
        // 撤销那条变更：世界回到第一条记录的样子。读一次，第一条记录仍有效，备忘里是它的结论。
        w.publish([{ref: {kind: "change", id: row}, after: {...w.world.data.changes.get(row)!, status: "undone", undoneReason: "不要了"}}]);
        expect(source.valid(w.view(), first)).toBe(isValid({view: w.view(), record: first, digest}));
        // 第二条记录存下：它少问了回来的候选，要判过期，不能沿用第一条的结论。
        records.set("ch4", secondRecord);
        expect(isValid({view: w.view(), record: secondRecord, digest})).toBe(false);
        expect(source.valid(w.view(), secondRecord)).toBe(false);
    });
});

describe("随机序列", () => {
    test("任何序列上，走摘要的结论等于全量重拼的结论，记录跨步留存", async () => {
        const book = randomBook(seeded(Number(process.env.PLOT_RANDOM_SEED ?? 20261107)));
        const {w, instructions} = book;
        const {records, source, check} = harness(instructions);
        // 普通章、讲支线的章、视角人物的章、分段的章、补叙的章。
        const watched = ["ch4", "ch6", "ch8", "ch9", "ch10", "ch12"];
        for (const id of watched) await check(w, id);
        let stale = 0;
        let kept = 0;
        for (let step = 0; step < Number(process.env.PLOT_RANDOM_STEPS ?? 100); step += 1) {
            const done = book.step(step);
            for (const id of watched) {
                const record = records.get(id)!;
                const instruction = instructions.get(id);
                const expected = isValid({view: w.view(), record, digest, ...(instruction === undefined ? {} : {instruction})});
                if (source.valid(w.view(), record) !== expected) throw new Error(`第 ${String(step)} 步（${done.op}）：${id} 走摘要的结论与重拼不同（重拼：${String(expected)}）`);
                if (expected) kept += 1;
                else {
                    stale += 1;
                    // 一半重跑，一半留着过期的：过期以后再改回去，结论要跟着回来。
                    if (step % 2 === 0) await check(w, id);
                }
            }
        }
        // 两种结论都走到了，这条断言不是空转。
        expect(stale).toBeGreaterThan(5);
        expect(kept).toBeGreaterThan(20);
    }, 120_000);
});
