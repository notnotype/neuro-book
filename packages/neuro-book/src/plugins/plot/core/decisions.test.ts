import {describe, expect, test} from "bun:test";

import {ChapterOrder} from "@notnotype/nb-canon";

import {DECISION_DIAGNOSTIC_IDS, MARK_IDS} from "../shared/declarations";
import {addRow, chapter, drafts, end, PlotWorld} from "../testing/world";
import {dangling, involvedDecisions, NO_REASON, overdue} from "./decisions";

const CHAPTERS = Array.from({length: 20}, (_, index) => `ch${String(index + 1)}`);
const plotLine = (w: PlotWorld, name: string) => w.entry({type: "剧情线", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {}}});

describe("plot.decisions 输出 7、9：涉及本章的决策", () => {
    test("挂的对象与本章涉及的条目相交（entry、address）、挂在本章（chapter、change）、范围包含本章：涉及；已定在前、待定在后；被放弃的不列；没给理由写“作者没说理由”", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const sage = w.person("贤者");
        const c5 = w.change(chapter("ch5"), {patches: [{op: "set", at: {entry: jin, path: "know.听过的说法"}, value: null}], cast: [{who: jin, role: "present"}]});
        const byEntry = w.decision("星瑾的秘密", {about: [{kind: "entry", id: jin}], conclusion: "只给暗示", reason: "留悬念"});
        const byAddress = w.decision("地址", {about: [{kind: "address", at: {entry: jin, path: "know.听过的说法"}}], conclusion: "不写"});
        const byChapter = w.decision("挂在第 5 章", {about: [{kind: "chapter", id: "ch5"}]});
        const byChange = w.decision("挂在那件事", {about: [{kind: "change", id: c5}], conclusion: "照写"});
        const byScope = w.decision("范围", {about: [], scope: {from: "ch4", to: "ch6"}, conclusion: "语气冷"});
        const other = w.decision("别处的", {about: [{kind: "entry", id: sage}], conclusion: "x"});
        const outside = w.decision("范围外", {about: [], scope: {from: "ch7"}, conclusion: "x"});
        const dropped = w.decision("放弃的", {about: [{kind: "entry", id: jin}]});
        w.drop(dropped);
        void brother;
        const involved = involvedDecisions(w.view(), "ch5", "actual");
        expect(involved.map((decision) => decision.id).sort()).toEqual([byEntry, byAddress, byChapter, byChange, byScope].sort());
        // 已定的在前、待定的（byChapter）在后。
        expect(involved.at(-1)?.id).toBe(byChapter);
        expect(involved.find((decision) => decision.id === byEntry)).toMatchObject({conclusion: "只给暗示", reason: "留悬念"});
        expect(involved.find((decision) => decision.id === byAddress)?.reason).toBe(NO_REASON);
        expect([other, outside]).not.toEqual(expect.arrayContaining(involved.map((decision) => decision.id)));
    });

    test("未写的章只有计划：实际模式没有涉及的条目，按计划模式有；挂在剧情线条目上的决策看这条线上本章有没有剧情变更（不是 involves）", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const arc = plotLine(w, "找哥哥");
        const plan = w.change(chapter("ch9"), {kind: "plan", patches: [{op: "set", at: {entry: jin, path: "know.听过的说法"}, value: null}]});
        const byEntry = w.decision("星瑾", {about: [{kind: "entry", id: jin}], conclusion: "x"});
        const byLine = w.decision("这条线上的", {about: [{kind: "entry", id: arc}], conclusion: "y"});
        expect(involvedDecisions(w.view(), "ch9", "actual").map((decision) => decision.id)).toEqual([]);
        expect(involvedDecisions(w.view(), "ch9", "planned").map((decision) => decision.id)).toEqual([byEntry]);
        // 剧情线上第 12 章有一条变更（`lines` 含它、`involves` 与补丁都不含）：第 12 章涉及这条决策，第 11 章不涉及。
        const id = "tmp:onLine";
        w.publish([{ref: {kind: "change", id}, after: {id, kind: "written", text: "线上的事", at: chapter("ch12"), told: [], involves: [], lines: [arc], links: [], patches: [], status: "active", by: {kind: "author"}}}]);
        expect(involvedDecisions(w.view(), "ch12", "actual").map((decision) => decision.id)).toEqual([byLine]);
        expect(involvedDecisions(w.view(), "ch11", "actual").map((decision) => decision.id)).toEqual([]);
        expect(plan).toBeDefined();
    });
});

describe("plot.decisions 输出 5、验收 3：到期没定与悬空", () => {
    test("待定的决策到期章不晚于读取位置所在章：报；读到到期章之前不报；定下来以后不报", () => {
        const w = new PlotWorld(CHAPTERS);
        const pending = w.decision("哥哥的秘密在哪一章揭开", {due: "ch15"});
        const run = (at: ReturnType<typeof end>) => overdue(w.view(), at, "actual").map((finding) => finding.key);
        expect(run(end("ch14"))).toEqual([]);
        expect(run(end("ch15"))).toEqual([{objects: [{kind: "decision", id: pending}]}]);
        expect(run(end("ch20"))).toHaveLength(1);
        w.decision("别的", {due: "ch30"});
        expect(run(end("ch20"))).toHaveLength(1);
    });

    test("已定决策挂的对象全死了才悬空：已删条目、已撤销变更、被放弃的决策、章不在章序里；空 about 与还有活对象的不算；diagnostic 挂点不算死", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const change = w.change(chapter("ch2"));
        const delEntry = (id: string) => {
            const stored = structuredClone(w.world.data.entries.get(id)!);
            w.publish([{ref: {kind: "entry", id}, after: {...stored, deleted: true}}]);
        };
        const undo = (id: string) => {
            const stored = structuredClone(w.world.data.changes.get(id)!);
            w.publish([{ref: {kind: "change", id}, after: {...stored, status: "undone" as const}}]);
        };
        const deadEntry = w.decision("挂已删条目", {about: [{kind: "entry", id: brother}], conclusion: "a"});
        const deadChange = w.decision("挂已撤销变更", {about: [{kind: "change", id: change}], conclusion: "b"});
        const mixed = w.decision("一半活", {about: [{kind: "entry", id: brother}, {kind: "entry", id: jin}], conclusion: "c"});
        const empty = w.decision("不挂对象", {about: [], conclusion: "d"});
        const onlyDiagnostic = w.decision("挂诊断", {about: [{kind: "diagnostic", id: "nbook.plot.relayBroken", key: {line: "main", objects: [{kind: "entry", id: jin}]}, version: 1}], conclusion: "e"});
        const deadChapter = w.decision("挂后来被删掉的章", {about: [{kind: "chapter", id: "ch19"}], conclusion: "f"});
        delEntry(brother);
        undo(change);
        const reordered = w.world.reorder(new ChapterOrder(CHAPTERS.filter((id) => id !== "ch19")), "t", "drop-ch19");
        if (reordered === null || !reordered.ok) throw new Error("reorder failed");
        w.world = reordered.world;
        const found = dangling(w.view(), end("ch3"), "actual").map((finding) => (finding.key.objects as Array<{id: string}>)[0]!.id).sort();
        expect(found).toEqual([deadEntry, deadChange, deadChapter].sort());
        expect([mixed, empty, onlyDiagnostic].some((id) => found.includes(id))).toBe(false);
        expect(DECISION_DIAGNOSTIC_IDS.dangling).toBe("nbook.plot.decision.dangling");
    });
});

describe("plot.decisions 输出 2：地址守卫没法检查时在决策视图里标 unchecked", () => {
    test("守卫写明的线在这个模式下读不到（只由计划分叉定义的线，读实际模式）：标 line-unavailable；能检查的不标", () => {
        const w = new PlotWorld(CHAPTERS);
        const thing = w.thing("身份");
        const cut = w.change(chapter("ch2"));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:if"}, after: {...drafts.change("tmp:if", chapter("ch2", 50), {kind: "plan"}), nature: "fork", fork: {line: "tmp:if1", name: "如果", parent: "main", cut, type: "if"}}}]);
        const mark = (extra: Record<string, unknown>) => ({kind: MARK_IDS.guardAddress, version: 1, at: {entry: thing, path: "character.状态"}, notIn: ["暴露"], ...extra});
        const fine = w.decision("可检查", {about: [{kind: "entry", id: thing}], conclusion: "x", marks: [mark({})]});
        const gone = w.decision("线不可用", {about: [{kind: "entry", id: thing}], conclusion: "y", marks: [mark({lines: [ids["tmp:if1"]!]})]});
        w.change(chapter("ch5"), {text: "动身份", patches: [{op: "set", at: {entry: thing, path: "character.状态"}, value: "x"}]});
        const actual = involvedDecisions(w.view(), "ch5", "actual");
        expect(actual.find((decision) => decision.id === fine)?.guards.map((guard) => guard.unchecked)).toEqual([undefined]);
        expect(actual.find((decision) => decision.id === gone)?.guards.map((guard) => guard.unchecked)).toEqual(["line-unavailable"]);
        // 按计划模式这条线存在：能检查。
        const planned = involvedDecisions(w.view(), "ch5", "planned");
        expect(planned.find((decision) => decision.id === gone)?.guards.map((guard) => guard.unchecked)).toEqual([undefined]);
    });
});

describe("plot.decisions 输出 2：地址的值不完整时不判，标 unchecked", () => {
    test("地址被一条后来套不上的变更标成不完整：决策视图里标 incomplete", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const k = w.point("哥哥能回溯", w.person("哥哥"));
        const mark = {kind: MARK_IDS.guardAddress, version: 1, at: {entry: jin, path: "know.知情"}, notIn: ["x"]};
        const guarded = w.decision("知情不能是 x", {about: [{kind: "chapter", id: "ch5"}], conclusion: "x", marks: [mark]});
        const unchecked = () => involvedDecisions(w.view(), "ch5", "actual").find((decision) => decision.id === guarded)?.guards.map((guard) => guard.unchecked);
        w.change(chapter("ch2"), {patches: [addRow(jin, k, {程度: "knows"})]});
        w.change(chapter("ch4"), {patches: [{op: "listRemove", at: {entry: jin, path: "know.知情"}, value: k}]});
        expect(unchecked()).toEqual([undefined]);

        // 第 4 章的变更在写入时套得上；后来写进第 3 章的另一条已经去掉了这一行，第 4 章那条就套不上，地址从这里起不完整。
        w.change(chapter("ch3"), {patches: [{op: "listRemove", at: {entry: jin, path: "know.知情"}, value: k}]});
        expect(unchecked()).toEqual(["incomplete"]);
    });
});
