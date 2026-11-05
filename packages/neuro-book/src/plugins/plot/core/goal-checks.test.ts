import {describe, expect, test} from "bun:test";

import {addRow, chapter, end, PlotWorld, present} from "../testing/world";
import {GOAL_DIAGNOSTIC_IDS} from "../shared/declarations";
import {goalDiagnostics, STALLED_AFTER_CHAPTERS} from "./goal-checks";

const CHAPTERS = Array.from({length: 45}, (_, index) => `ch${String(index + 1)}`);
const setStatus = (goal: string, value: string) => ({op: "set" as const, at: {entry: goal, path: "goal.状态"}, value});
const run = (w: PlotWorld, id: string, at: ReturnType<typeof end>, mode: "actual" | "planned" = "actual") => goalDiagnostics()[id]!(w.view(), at, mode);

describe("plot.goals 输出 3、验收 1：前提变了", () => {
    test("目标基于的知识点上，持有者的知情变了、目标还没跟着改：报；之后改了目标（同一条变更也算）消失", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const late = w.point("哥哥最近总是晚归", brother);
        const secret = w.point("哥哥能回溯", brother);
        const find = w.goal("查出哥哥在瞒什么", jin, {基于: [{id: late}, {id: secret}]});
        const truth = w.change(chapter("ch12"), {patches: [addRow(jin, secret, {程度: "knows", 怎么知道: "witnessed"})]});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch11"))).toEqual([]);
        const found = run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch12"));
        expect(found.map((finding) => finding.key)).toEqual([{objects: [{kind: "entry", id: find}, {kind: "entry", id: secret}, {kind: "change", id: truth}], line: "main"}]);
        // 第 13 章改了目标（还是进行）：目标已跟着改，诊断消失。
        w.change(chapter("ch13"), {patches: [{op: "set", at: {entry: find, path: "goal.为什么"}, value: "她知道哥哥能回溯了"}]});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch13"))).toEqual([]);
        // 第 14 章改成达成：也不报（达成的目标本来也不再查）。
        w.change(chapter("ch14"), {patches: [setStatus(find, "achieved")]});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch14"))).toEqual([]);
    });

    test("同一条变更里既让持有者知情变了、又改了目标：已跟着改，不报；知情行的无关子字段变化不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const secret = w.point("哥哥能回溯", brother);
        const find = w.goal("查出哥哥在瞒什么", jin, {基于: [{id: secret}]});
        w.change(chapter("ch5"), {patches: [addRow(jin, secret, {程度: "knows"}), {op: "set", at: {entry: find, path: "goal.为什么"}, value: "已经知道了"}]});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch6"))).toEqual([]);
        // 只改备注：知情没变，不报。
        w.change(chapter("ch7"), {patches: [{op: "set", at: {entry: jin, path: "know.知情[" + secret + "].备注"}, value: "补充"}]});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch8"))).toEqual([]);
    });

    test("持有者的知情后来又变了：只报最后一次；隐秘目标推出的知情变化没有变更，不报", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const secret = w.point("哥哥能回溯", brother);
        const find = w.goal("查出哥哥在瞒什么", jin, {基于: [{id: secret}]});
        w.change(chapter("ch3"), {patches: [addRow(jin, secret, {程度: "suspects"})]});
        w.change(chapter("ch4"), {patches: [setSub(jin, secret, "程度", "knows")]});
        const [only] = run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch5"));
        expect(only?.key.objects).toContainEqual({kind: "change", id: expect.any(String)});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch5"))).toHaveLength(1);
        // 目标的 `隐秘` 指向的知识点：持有者从目标出场起 knows，不是哪条变更造成的。
        const hidden = w.point("星瑾想查哥哥", jin);
        w.goal("别让人知道她在查", jin, {隐秘: {ref: hidden}, 基于: [{id: hidden}]}, {appears: chapter("ch2")});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.premiseChanged, end("ch5")).map((finding) => finding.key.objects)).not.toContainEqual(expect.arrayContaining([{kind: "entry", id: hidden}]));
        expect(find).toBeDefined();
    });
});

function setSub(person: string, point: string, sub: string, value: unknown) {
    return {op: "set" as const, at: {entry: person, path: `know.知情[${point}].${sub}`}, value};
}

describe("plot.goals 输出 4：停滞", () => {
    test("进行的目标从最后一次被改起超过 30 章才报（30 章不报，31 章报）；受挫的不报；改一次从头算", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const find = w.goal("查出哥哥在瞒什么", jin);
        w.goal("躲开哥哥", jin, {状态: "blocked"});
        expect(STALLED_AFTER_CHAPTERS).toBe(30);
        // 目标一开始就在（前史），到第 31 章末尾下标 30：差 30 不报；第 32 章末尾差 31 报。
        expect(run(w, GOAL_DIAGNOSTIC_IDS.stalled, end("ch31"))).toEqual([]);
        expect(run(w, GOAL_DIAGNOSTIC_IDS.stalled, end("ch32")).map((finding) => finding.key.objects)).toEqual([[{kind: "entry", id: find}]]);
        w.change(chapter("ch10"), {patches: [{op: "set", at: {entry: find, path: "goal.为什么"}, value: "新线索"}]});
        expect(run(w, GOAL_DIAGNOSTIC_IDS.stalled, end("ch32"))).toEqual([]);
        expect(run(w, GOAL_DIAGNOSTIC_IDS.stalled, end("ch45"))).toHaveLength(1);
    });
});

describe("plot.goals 输出 4：缺一步", () => {
    test("目标从进行直接变成达成、中间没有别的涉及它的变更：报；中间有一条涉及它的变更不报；同一条变更先后改两次不报", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin] = [w.person("星瑾")];
        const direct = w.goal("直接达成", jin);
        const stepped = w.goal("有过程", jin);
        const together = w.goal("一条变更里改两次", jin);
        w.change(chapter("ch2"), {patches: [setStatus(direct, "achieved"), setStatus(together, "blocked"), setStatus(together, "achieved")]});
        w.change(chapter("ch2", 5), {patches: [{op: "set", at: {entry: stepped, path: "goal.为什么"}, value: "查到了线索"}], cast: [present(jin)]});
        w.change(chapter("ch3"), {patches: [setStatus(stepped, "achieved")]});
        const found = run(w, GOAL_DIAGNOSTIC_IDS.skippedStep, end("ch4")).map((finding) => finding.key.objects);
        expect(found).toContainEqual([{kind: "entry", id: direct}]);
        expect(found).not.toContainEqual([{kind: "entry", id: stepped}]);
        expect(found).not.toContainEqual([{kind: "entry", id: together}]);
    });
});
