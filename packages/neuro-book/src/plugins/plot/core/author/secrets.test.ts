/**
 * 作者用的保密表（docs/specs/plot/knowledge.md 输出 14）与主要角色（docs/specs/plot/goals.md 输出 6）接在真实的 `World` 上：行的
 * 顺序、点名的人与“别的人”、分段与全表条数、揭示计划、候选的人。
 */

import {describe, expect, test} from "bun:test";

import {compareIds} from "@notnotype/nb-canon";

import {MARK_IDS} from "../../shared/declarations";
import {addRow, chapter, end, PlotWorld, setSub} from "../../testing/world";
import {mainCharacters, secretsTable} from "./secrets";

const CHAPTERS = ["ch1", "ch2", "ch3"];

function world() {
    const w = new PlotWorld(CHAPTERS);
    const xia = w.person("星瑕", {order: 1});
    const parents = w.person("父母", {order: 2});
    const jin = w.person("星瑾", {order: 3});
    const hui = w.person("彗", {order: 4});
    const committee = w.person("对策委员会", {type: "组织", order: 5});
    // 主体在树里星瑕在前、父母在后；同一主体下按名字。
    const prisoned = w.point("那几年是被软禁", xia);
    const brother = w.point("哥哥就是星瑕", xia);
    const alive = w.point("父母没有死", parents, {保密: "topSecret"});
    w.point("城里有家蛋糕店", null, {保密: "common"});
    const loose = w.point("没主体的秘密", null);
    w.change(chapter("ch1"), {patches: [
        addRow(xia, brother, {程度: "knows"}), addRow(hui, brother, {程度: "knows"}),
        addRow(jin, prisoned, {程度: "misbelieves", 他以为的: "哥哥不想回家"}), addRow(committee, prisoned, {程度: "knows"}),
        addRow(committee, alive, {程度: "suspects"}), addRow(hui, loose, {程度: "knows"}),
    ]});
    w.change(chapter("ch2"), {patches: [setSub(hui, loose, "程度", "forgot")]});
    return {w, xia, parents, jin, hui, committee, prisoned, brother, alive, loose};
}

describe("保密表（输出 14）", () => {
    test("行按主体在条目树里的顺序、再按名字；点名的人各自的程度；没点名的知道、信错、怀疑、忘了的进别的人", () => {
        const {w, xia, jin, hui, committee, prisoned, brother, alive, loose} = world();
        const table = secretsTable(w.view(), "actual", end("ch2"), [xia, jin]);
        expect(table.rows.map((row) => row.point)).toEqual([loose, brother, prisoned, alive]);
        const byPoint = Object.fromEntries(table.rows.map((row) => [row.point, row]));
        expect(byPoint[prisoned]!.people).toEqual({[xia]: {degree: "none", belief: null}, [jin]: {degree: "misbelieves", belief: "哥哥不想回家"}});
        expect(byPoint[brother]!.others).toEqual([{person: hui, degree: "knows"}]);
        expect(byPoint[loose]!.others).toEqual([{person: hui, degree: "forgot"}]);
        expect(byPoint[alive]!).toMatchObject({secrecy: "topSecret", others: [{person: committee, degree: "suspects"}], othersTotal: 1});
        expect(table.candidates).toEqual([xia, jin, hui, committee].sort());
    });

    test("分段只筛行，条数按全表：只有读者知道、读者还不知道、没打算怎么揭", () => {
        const {w, xia, brother, loose, prisoned, alive} = world();
        w.texts.set("ch1", "第一段。\n哥哥的手机里有个女孩。");
        w.texts.set("ch2", "原来那个女孩就是哥哥。");
        const reveal = (point: string, mode: "hint" | "explicit") => ({kind: MARK_IDS.reveal, version: 1, point, mode});
        // 读者第 1 章就怀疑“没主体的秘密”，第 2 章知道“哥哥就是星瑕”；揭示软禁的计划在第 3 章。
        w.change(chapter("ch1", 9), {told: [{source: "chapter", chapter: "ch1", quote: "哥哥的手机里有个女孩", marks: [reveal(loose, "hint")]}]});
        w.change(chapter("ch2", 9), {told: [{source: "chapter", chapter: "ch2", quote: "原来那个女孩就是哥哥", marks: [reveal(brother, "explicit")]}]});
        const plan = w.change(chapter("ch3"), {kind: "plan", told: [{source: "outline", chapter: "ch3", anchor: "细纲", marks: [reveal(prisoned, "explicit")]}]});
        const view = w.view();
        const all = secretsTable(view, "actual", end("ch2"), [xia]);
        expect(all.counts).toEqual({all: 4, readerOnly: 1, readerUnaware: 2, noPlan: 2});
        expect(secretsTable(view, "actual", end("ch2"), [xia], "readerOnly").rows.map((row) => row.point)).toEqual([loose]);
        expect(secretsTable(view, "actual", end("ch2"), [xia], "noPlan").rows.map((row) => row.point)).toEqual([loose, alive]);
        expect(all.rows.find((row) => row.point === prisoned)!.reveals).toEqual([{plan, chapter: "ch3", mode: "explicit", done: false}]);
        expect(all.rows.find((row) => row.point === brother)!.reader).toEqual({degree: "knows", suspects: {chapter: "ch2", paragraph: 1}, knows: {chapter: "ch2", paragraph: 1}});
    });

    test("失效拆出的揭示计划不列：拆出它的那条兑现撤销以后，这一行没有打算", () => {
        const w = new PlotWorld(["ch1", "ch2", "ch3", "ch4", "ch5"]);
        const xia = w.person("星瑕");
        const point = w.point("那几年是被软禁", xia);
        const reveal = {kind: MARK_IDS.reveal, version: 1, point, mode: "explicit"};
        const original = w.change(chapter("ch2", 20), {kind: "plan", text: "原来的计划"});
        const fulfilled = w.change(chapter("ch2", 10), {text: "兑现了一半", links: [{kind: "fulfills", plan: original}]});
        const split = w.change(chapter("ch4"), {kind: "plan", text: "拆出来的后一半", links: [{kind: "splitFrom", plan: original, by: fulfilled}], told: [{source: "outline", chapter: "ch4", anchor: "揭开", marks: [reveal]}]});
        const reveals = () => secretsTable(w.view(), "actual", end("ch3"), []).rows[0]!.reveals;
        expect(reveals()).toEqual([{plan: split, chapter: "ch4", mode: "explicit", done: false}]);

        const stored = structuredClone(w.world.data.changes.get(fulfilled)!);
        w.publish([{ref: {kind: "change", id: fulfilled}, after: {...stored, status: "undone" as const}}]);
        expect(reveals()).toEqual([]);
    });

    test("挂在它上面的决策：已定的带结论，放弃的不列；有决策的不算没打算怎么揭", () => {
        const {w, alive} = world();
        const decided = w.decision("第 2 卷揭晓", {about: [{kind: "entry", id: alive}], conclusion: "第 2 卷"});
        const dropped = w.decision("不揭了", {about: [{kind: "entry", id: alive}]});
        w.drop(dropped);
        const table = secretsTable(w.view(), "actual", end("ch2"), []);
        expect(table.rows.find((row) => row.point === alive)!.decisions).toEqual([{id: decided, text: "第 2 卷揭晓", status: "decided", conclusion: "第 2 卷", due: null}]);
        expect(table.counts.noPlan).toBe(3);
    });
});

describe("主要角色（goals.md 输出 6）", () => {
    test("读取位置上持有进行或受挫目标的人或组织；只有达成的不算；马甲的目标算到本体", () => {
        const {w, xia, jin, committee} = world();
        const mask = w.person("哥哥", {sameAs: xia});
        w.goal("不让妹妹发现", mask);
        w.goal("找到隐退的魔法少女", committee, {状态: "blocked"});
        w.goal("吃到蛋糕", jin, {状态: "achieved"});
        expect(mainCharacters(w.view(), end("ch2"), "actual")).toEqual([xia, committee].sort());
        const table = secretsTable(w.view(), "actual", end("ch2"), []);
        expect(table.main).toEqual([xia, committee].sort());
    });

    test("持有者要在作者用的人群里：还没出场、删了的人持有的目标不让他成为主要角色", () => {
        const {w, xia} = world();
        const late = w.person("第 3 章才出场的", {appears: chapter("ch3")});
        const gone = w.person("删了的人");
        w.goal("不让妹妹发现", xia);
        w.goal("先有的目标", late);
        w.goal("留下的目标", gone);
        const stored = structuredClone(w.world.data.entries.get(gone)!);
        w.publish([{ref: {kind: "entry", id: gone}, after: {...stored, deleted: true}}]);
        expect(mainCharacters(w.view(), end("ch2"), "actual")).toEqual([xia]);
        expect(mainCharacters(w.view(), end("ch3"), "actual")).toEqual([xia, late].sort());
    });
});

describe("条目树的顺序", () => {
    test("同顺序的按 canon 的 id 比（e9 在 e10 前），同 canon 的条目树", () => {
        const w = new PlotWorld(["ch1"]);
        const subjects = Array.from({length: 12}, (_, index) => w.person(`主体 ${String(index + 1)}`));
        for (const subject of subjects) w.point("秘密", subject);
        const order = secretsTable(w.view(), "actual", end("ch1"), []).rows.map((row) => row.subject);
        const canonOrder = (ids: readonly (string | null)[]) => [...ids].sort((a, b) => compareIds(a!, b!));
        expect(subjects.some((id) => /^e\d{2,}$/u.test(id))).toBe(true);
        expect(order).toEqual(canonOrder(subjects));
    });
});
