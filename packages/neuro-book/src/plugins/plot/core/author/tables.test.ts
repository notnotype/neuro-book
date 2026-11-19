/**
 * 作者用的目标表（docs/specs/plot/goals.md 输出 6）、伏笔账本（docs/specs/plot/foreshadowing.md 输出 9）与经历（docs/specs/plot/knowledge.md
 * 输出 17）接在真实的 `World` 上。
 */

import {describe, expect, test} from "bun:test";

import type {Mark, TellingDraft} from "@notnotype/nb-canon";

import {MARK_IDS} from "../../shared/declarations";
import {chapter, drafts, end, PlotWorld, present} from "../../testing/world";
import {authorExperience} from "./experience";
import {authorGoals, personGoals} from "./goals";
import {authorLedger} from "./ledger";

const CHAPTERS = Array.from({length: 40}, (_, index) => `ch${String(index + 1)}`);
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};
const setGoal = (goal: string, path: string, value: unknown) => ({op: "set" as const, at: {entry: goal, path}, value});

describe("作者用的目标表（goals.md 输出 6）", () => {
    test("主要角色一组一组；缺省只列进行与受挫的，打开以后另列达成与放弃的；冲突两边都列", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const jin = w.person("星瑾");
        const cake = w.goal("吃到蛋糕", xia, {状态: "achieved"});
        const hide = w.goal("不让妹妹发现", xia);
        const find = w.goal("查出哥哥在瞒什么", jin, {状态: "blocked", 冲突: [{id: hide}]});
        const groups = authorGoals(w.view(), "actual", end("ch2"));
        expect(Object.fromEntries(groups.map((group) => [group.holder, group.goals.map((goal) => goal.id)]))).toEqual({[xia]: [hide], [jin]: [find]});
        const xiaGoals = authorGoals(w.view(), "actual", end("ch2"), {holder: xia, finished: true})[0]!;
        expect(xiaGoals.goals.map((goal) => goal.id)).toEqual([hide, cake]);
        expect(xiaGoals.goals[0]!.conflicts).toEqual([{id: find, writtenOn: "other", holder: jin}]);
    });

    test("动过只算改到 goal 命名空间、套上了的变更；没动过的章数从最近一次（没有时从出场）算；停滞同一个算法（30 章与 31 章的边界）", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const goal = w.goal("修复和妹妹的关系", xia, {}, {appears: chapter("ch1")});
        // 只改名字不算动过。
        w.change(chapter("ch5"), {patches: [setGoal(goal, "entry.name", "和妹妹和好")]});
        const read = (at: string) => personGoals(w.view(), "actual", end(at), xia).goals[0]!;
        expect(read("ch10")).toMatchObject({last: null, quiet: 9, stalled: false});
        expect(read("ch31")).toMatchObject({quiet: 30, stalled: false});
        expect(read("ch32")).toMatchObject({quiet: 31, stalled: true});
        w.change(chapter("ch20"), {patches: [setGoal(goal, "goal.为什么", "她一直在生气")]});
        expect(read("ch32")).toMatchObject({last: {chapter: "ch20"}, quiet: 12, stalled: false});
    });

    test("按计划读：已兑现的计划不算动过（兑现它的已写变更没碰目标），停滞照报", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const goal = w.goal("修复和妹妹的关系", xia, {}, {appears: chapter("ch1")});
        const plan = w.change(chapter("ch10", 20), {kind: "plan", patches: [setGoal(goal, "goal.轻重", "minor")]});
        expect(personGoals(w.view(), "planned", end("ch35"), xia).goals[0]).toMatchObject({last: {chapter: "ch10"}, quiet: 25, stalled: false});
        w.change(chapter("ch10", 10), {text: "照计划写了，没碰目标", links: [{kind: "fulfills", plan}]});
        expect(personGoals(w.view(), "planned", end("ch35"), xia).goals[0]).toMatchObject({last: null, quiet: 34, stalled: true});
    });

    test("态度表：没归纳的只是记了事件的那一行，别的行照常", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const hui = w.person("彗");
        const jin = w.entry({...drafts.person("x", "星瑾"), init: {...drafts.person("x", "星瑾").init, data: {
            know: {type: "nbook.plot.knowing", version: 1, enabled: true, fields: {知情: [], 听过的说法: null}},
            att: {type: "nbook.plot.attitude", version: 1, enabled: true, fields: {态度: [{id: xia, 态度: "还在生气", 起因: null, 称呼: "哥哥"}, {id: hui, 态度: "信得过", 起因: null, 称呼: "彗姐"}]}},
        }}});
        w.change(chapter("ch2"), {patches: [{op: "note", at: {entry: jin, path: `att.态度[${xia}].态度`}, value: "软了一点"}]});
        const attitudes = personGoals(w.view(), "actual", end("ch3"), jin).attitudes;
        expect(attitudes.map((row) => [row.object, row.notReduced])).toEqual([[xia, true], [hui, false]]);
        expect(attitudes.find((row) => row.object === hui)?.态度).toBe("信得过");
    });

    test("人物页：没有目标、只有态度的人照样给态度", () => {
        const w = new PlotWorld(CHAPTERS, [{id: "nbook.plot.attitude-test", label: "测试", namespace: "unused", version: 1, fields: []}]);
        const xia = w.person("星瑕");
        const jin = w.entry({...drafts.person("x", "星瑾"), init: {...drafts.person("x", "星瑾").init, data: {
            know: {type: "nbook.plot.knowing", version: 1, enabled: true, fields: {知情: [], 听过的说法: null}},
            att: {type: "nbook.plot.attitude", version: 1, enabled: true, fields: {态度: [{id: xia, 态度: "还在生气", 起因: null, 称呼: "哥哥"}]}},
        }}});
        expect(personGoals(w.view(), "actual", end("ch2"), jin)).toEqual({goals: [], attitudes: [{object: xia, 态度: "还在生气", notReduced: false, 起因: null, 称呼: "哥哥"}]});
    });
});

describe("作者用的伏笔账本（foreshadowing.md 输出 9）", () => {
    test("分段与条数：还没收、很久没提（同诊断的阈值）、没打算怎么收、已放弃；下一步计划与节点带的节点", () => {
        const w = new PlotWorld(CHAPTERS);
        const doll = w.foreshadow("彗的魔偶", {重要程度: "minor"});
        const egg = w.foreshadow("星瑾不吃煎蛋");
        const paid = w.foreshadow("那张卡");
        const gone = w.foreshadow("放弃的线", {意图: "dropped"});
        w.change(chapter("ch1"), {told: [inText(w, "ch1", "那只魔偶你还留着吗", [node(doll, "plant")]), inText(w, "ch1", "她不吃煎蛋", [node(egg, "plant")]), inText(w, "ch1", "他办了一张卡", [node(paid, "plant")])]});
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "卡推了回去", [node(paid, "payoff")])]});
        const plan = w.change(chapter("ch30"), {kind: "plan", told: [{source: "outline", chapter: "ch30", anchor: "回收煎蛋", marks: [node(egg, "payoff")]}]});
        const table = authorLedger(w.view(), "actual", end("ch12"), "all");
        expect(table.counts).toEqual({unpaid: 2, silent: 1, unplanned: 1, dropped: 1, all: 4});
        const byId = Object.fromEntries(table.rows.map((row) => [row.id, row]));
        // minor 的参考间隔是 10 章：第 1 章提过，到第 12 章是 11 章。
        expect(byId[doll]).toMatchObject({stage: "planted", lastMentioned: "ch1", silence: {chapters: 11, long: true}, next: null, unplanned: true});
        expect(byId[egg]).toMatchObject({silence: {chapters: 11, long: false}, next: {role: "payoff", chapter: "ch30", plan}, unplanned: false, nodes: [{role: "plant", chapter: "ch1", written: true}, {role: "payoff", chapter: "ch30", written: false}]});
        expect(byId[paid]).toMatchObject({stage: "paidOff", silence: null});
        expect(byId[gone]).toMatchObject({dropped: true});
        expect(authorLedger(w.view(), "actual", end("ch12")).rows.map((row) => row.id)).toEqual([doll, egg]);
    });

    test("失效拆出的计划不是打算：拆出它的那条兑现撤销以后，不算下一步、不画进节点带、算没打算怎么收", () => {
        const w = new PlotWorld(CHAPTERS);
        const egg = w.foreshadow("星瑾不吃煎蛋");
        w.change(chapter("ch1"), {told: [inText(w, "ch1", "她不吃煎蛋", [node(egg, "plant")])]});
        const original = w.change(chapter("ch3", 20), {kind: "plan", text: "原来的计划"});
        const fulfilled = w.change(chapter("ch3", 10), {text: "兑现了一半", links: [{kind: "fulfills", plan: original}]});
        w.change(chapter("ch8"), {kind: "plan", text: "拆出来的后一半", links: [{kind: "splitFrom", plan: original, by: fulfilled}], told: [{source: "outline", chapter: "ch8", anchor: "回收煎蛋", marks: [node(egg, "payoff")]}]});
        const row = () => authorLedger(w.view(), "actual", end("ch4"), "all").rows[0]!;
        expect(row()).toMatchObject({next: {role: "payoff", chapter: "ch8"}, unplanned: false});
        expect(row().nodes).toHaveLength(2);

        const stored = structuredClone(w.world.data.changes.get(fulfilled)!);
        w.publish([{ref: {kind: "change", id: fulfilled}, after: {...stored, status: "undone" as const}}]);
        expect(row()).toMatchObject({next: null, unplanned: true, nodes: [{role: "plant", chapter: "ch1", written: true}]});
    });
});

describe("作者用的经历（knowledge.md 输出 17）", () => {
    test("从新到旧；同时在场的人只算在场的、不含自己、用了马甲写马甲；没记参与者的条数", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const jin = w.person("星瑾");
        const hui = w.person("彗");
        const brother = w.person("哥哥", {sameAs: xia});
        // 星瑾这一场在场，彗只是被提到；星瑕以哥哥的样子在场（从星瑾的经历看）。
        const breakfast = w.change(chapter("ch2"), {text: "又一顿早餐", cast: [{who: xia, role: "present", as: brother}, present(jin), {who: hui, role: "mentioned"}]});
        expect(authorExperience(w.view(), "actual", end("ch2"), jin).items.map((item) => [item.change, item.cast])).toEqual([[breakfast, [{who: brother}]]]);
        const first = w.change(chapter("ch1"), {text: "早餐", cast: [present(xia), present(jin)]});
        const second = w.change(chapter("ch3"), {text: "阳台打电话", cast: [present(xia), {label: "电话那头的人", role: "present"}]});
        w.change(chapter("ch4"), {text: "没记谁在场"});
        const read = authorExperience(w.view(), "actual", end("ch4"), xia);
        expect(read.items.map((item) => [item.change, item.chapter, item.text, item.cast])).toEqual([
            [second, "ch3", "阳台打电话", [{label: "电话那头的人"}]],
            [breakfast, "ch2", "又一顿早餐", [{who: jin}]],
            [first, "ch1", "早餐", [{who: jin}]],
        ]);
        expect(read.uncast).toBe(1);
    });
});
