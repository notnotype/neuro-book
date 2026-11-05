import {describe, expect, test} from "bun:test";

import {DECISION_DIAGNOSTIC_IDS, MARK_IDS} from "../shared/declarations";
import {chapter, drafts, end, PlotWorld, present} from "../testing/world";
import {readerTellings} from "./knowledge";
import {beforeWriting} from "./before-writing";
import {guardDiagnostics} from "./guards";

const CHAPTERS = Array.from({length: 24}, (_, index) => `ch${String(index + 1)}`);
const digest = (text: string) => `sha:${text.length}`;
const setState = (thing: string, value: string) => ({op: "set" as const, at: {entry: thing, path: "character.状态"}, value});
const address = (thing: string, extra: Record<string, unknown> = {}) => ({kind: MARK_IDS.guardAddress, version: 1, at: {entry: thing, path: "character.状态"}, notIn: ["暴露"], ...extra});
const addressFindings = (w: PlotWorld, at: ReturnType<typeof end>, mode: "actual" | "planned" = "actual") => guardDiagnostics(digest)[DECISION_DIAGNOSTIC_IDS.addressGuardViolated]!(w.view(), at, mode);

describe("plot.decisions 输出 2、验收 1：地址守卫", () => {
    test("第 18 章一条计划把它设成违反的值：按计划模式有一条、实际模式没有；记成已写变更以后实际模式也有；键里是决策与那条变更", () => {
        const w = new PlotWorld(CHAPTERS);
        const thing = w.thing("身份");
        const decision = w.decision("第 30 章之前身份不暴露", {about: [{kind: "entry", id: thing}], conclusion: "不暴露", marks: [address(thing, {to: "ch20"})]});
        const plan = w.change(chapter("ch18"), {kind: "plan", patches: [setState(thing, "暴露")]});
        expect(addressFindings(w, end("ch20"), "actual")).toEqual([]);
        const planned = addressFindings(w, end("ch20"), "planned");
        expect(planned.map((finding) => finding.key.objects)).toEqual([[{kind: "decision", id: decision}, {kind: "change", id: plan}]]);
        expect(planned[0]!.key).toMatchObject({line: "main", detail: expect.stringMatching(/^sha:/u)});
        const written = w.change(chapter("ch19"), {patches: [setState(thing, "暴露")]});
        expect(addressFindings(w, end("ch20"), "actual").map((finding) => finding.key.objects)).toEqual([[{kind: "decision", id: decision}, {kind: "change", id: written}]]);
    });

    test("范围的两端：范围之后的变更不算；范围开头（from 那章章首）的值就违反报一条且没有变更；连着改成别的违反值不重复报", () => {
        const w = new PlotWorld(CHAPTERS);
        const thing = w.thing("身份");
        w.decision("第 5 到 10 章不暴露", {about: [], conclusion: "x", marks: [address(thing, {from: "ch5", to: "ch10", notIn: ["暴露", "半暴露"]})]});
        // 范围之后（第 11 章）才暴露：不报。
        w.change(chapter("ch11"), {patches: [setState(thing, "暴露")]});
        expect(addressFindings(w, end("ch12"))).toEqual([]);
        // 第 3 章就暴露了：范围开头的值已经违反。
        const early = w.change(chapter("ch3"), {patches: [setState(thing, "暴露")]});
        const found = addressFindings(w, end("ch12"));
        expect(found.map((finding) => (finding.key.objects as unknown[]).length)).toEqual([1]);
        // 范围里又改成别的违反值：同一段违反不重复报；改回安全值再违反才报。
        w.change(chapter("ch6"), {patches: [setState(thing, "半暴露")]});
        expect(addressFindings(w, end("ch12"))).toHaveLength(1);
        w.change(chapter("ch7"), {patches: [setState(thing, "安全")]});
        const again = w.change(chapter("ch8"), {patches: [setState(thing, "暴露")]});
        expect(addressFindings(w, end("ch12")).map((finding) => (finding.key.objects as Array<{id: string}>).at(-1)!.id)).toContain(again);
        expect(early).toBeDefined();
    });

    test("守卫的 lines 不含这条线：这条线的视图里不报", () => {
        const w = new PlotWorld(CHAPTERS);
        const thing = w.thing("身份");
        const cut = w.change(chapter("ch1"));
        const forked = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch1", 50)), nature: "fork", fork: {line: "tmp:r1", name: "分支", parent: "main", cut, type: "branch"}}}]);
        const line = forked["tmp:r1"]!;
        w.decision("只管分支线", {about: [], conclusion: "x", marks: [address(thing, {lines: [line]})]});
        w.change(chapter("ch2"), {patches: [setState(thing, "暴露")]});
        // 主线的视图不在守卫的 lines 里：不报；换成含主线的守卫就报。
        expect(addressFindings(w, end("ch5"))).toEqual([]);
        w.decision("管主线", {about: [], conclusion: "y", marks: [address(thing, {lines: ["main"]})]});
        expect(addressFindings(w, end("ch5"))).toHaveLength(1);
    });
});

describe("plot.decisions 输出 2：地址守卫按线各自报", () => {
    test("回溯线上才违反：子线的视图里有、主线的视图里没有；守卫没写 lines 时每条线各按自己的视图", () => {
        const w = new PlotWorld(CHAPTERS);
        const thing = w.thing("身份");
        const cut = w.change(chapter("ch2"));
        const ids = w.publish([
            {ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch2", 50)), nature: "fork", fork: {line: "tmp:r1", name: "分支", parent: "main", cut, type: "branch"}}},
            {ref: {kind: "change", id: "tmp:own"}, after: drafts.change("tmp:own", {...chapter("ch5", 1), line: "tmp:r1"}, {patches: [setState(thing, "暴露")]})},
        ]);
        const decision = w.decision("不暴露", {about: [], conclusion: "x", marks: [address(thing)]});
        const main = w.view();
        const child = main.onLine(ids["tmp:r1"]!);
        if ("code" in child) throw new Error(child.code);
        const compute = guardDiagnostics(digest)[DECISION_DIAGNOSTIC_IDS.addressGuardViolated]!;
        expect(compute(main, end("ch8"), "actual")).toEqual([]);
        const found = compute(child, end("ch8"), "actual");
        expect(found.map((finding) => finding.key)).toMatchObject([{objects: [{kind: "decision", id: decision}, {kind: "change", id: ids["tmp:own"]!}], line: ids["tmp:r1"]!}]);
    });
});

describe("plot.decisions 输出 3、验收 2：读者守卫", () => {
    test("`until` 之前读者对知识点超过 atMost 就违反，键指向第一处超过的讲述；改成暗示（atMost 是 suspects）后消失；until 当章不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const point = w.point("管家是凶手", w.person("管家"));
        w.texts.set("ch12", "第一段。\n原来管家就是凶手。");
        const reveal = (mode: "hint" | "explicit") => ({kind: MARK_IDS.reveal, version: 1, point, mode});
        const guard = {kind: MARK_IDS.guardReader, version: 1, point, atMost: "suspects", until: "ch20"};
        const decision = w.decision("20 章之前不明说", {about: [{kind: "entry", id: point}], conclusion: "x", marks: [guard]});
        const run = () => guardDiagnostics(digest)[DECISION_DIAGNOSTIC_IDS.readerGuardViolated]!(w.view(), end("ch22"), "actual");
        w.change(chapter("ch12"), {told: [{source: "chapter", chapter: "ch12", quote: "原来管家就是凶手", marks: [reveal("hint")]}]});
        expect(run()).toEqual([]);
        const knows = w.change(chapter("ch13"), {told: [{source: "chapter", chapter: "ch12", quote: "原来管家就是凶手", marks: [reveal("explicit")]}]});
        const first = readerTellings(w.view(), {effective: true, mark: MARK_IDS.reveal}).find((item) => item.telling.marks?.some((mark) => mark.mode === "explicit"));
        const found = run();
        expect(found).toHaveLength(1);
        expect(found[0]!.key).toMatchObject({objects: [{kind: "decision", id: decision}], telling: first!.telling.id});
        expect(knows).toBeDefined();
        // until 当章（第 12 章若 until 是 ch12）之前不含：用 until=ch12 的守卫不报。
        const w2 = new PlotWorld(CHAPTERS);
        const p2 = w2.point("管家是凶手", w2.person("管家"));
        w2.texts.set("ch12", "原来管家就是凶手。");
        w2.change(chapter("ch12"), {told: [{source: "chapter", chapter: "ch12", quote: "原来管家就是凶手", marks: [{kind: MARK_IDS.reveal, version: 1, point: p2, mode: "explicit"}]}]});
        w2.decision("12 章之前", {about: [], conclusion: "x", marks: [{kind: MARK_IDS.guardReader, version: 1, point: p2, atMost: "unaware", until: "ch12"}]});
        expect(guardDiagnostics(digest)[DECISION_DIAGNOSTIC_IDS.readerGuardViolated]!(w2.view(), end("ch22"), "actual")).toEqual([]);
    });
});

describe("plot.decisions 输出 6：开写前的视图", () => {
    test("到期的待定决策、涉及本章的前提变了、本章计划触发的地址守卫违反；别的章的计划不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const thing = w.thing("身份");
        w.decision("哥哥的秘密在哪一章揭开", {due: "ch15"});
        w.decision("不暴露", {about: [], conclusion: "x", marks: [address(thing, {to: "ch20"})]});
        const plan18 = w.change(chapter("ch18"), {kind: "plan", patches: [setState(thing, "暴露")], cast: [present(jin)]});
        w.change(chapter("ch22"), {kind: "plan", patches: [setState(thing, "暴露")]});
        void brother;
        const result = beforeWriting(w.view(), "ch18", digest);
        if (typeof result === "string") throw new Error(result);
        expect(result.lines).toHaveLength(1);
        expect(result.lines[0]!.overdue).toHaveLength(1);
        expect(result.lines[0]!.guards.map((finding) => (finding.key.objects as Array<{id: string}>).at(-1)!.id)).toEqual([plan18]);
        expect(beforeWriting(w.view(), "ch99", digest)).toBe("chapter-not-found");
        // 第 14 章：决策还没到期；本章没有计划，也没有违反。
        const early = beforeWriting(w.view(), "ch14", digest);
        if (typeof early === "string") throw new Error(early);
        expect(early.lines[0]).toMatchObject({overdue: [], guards: []});
    });
});

describe("plot.decisions 输出 2、3：守卫只看到读取位置为止", () => {
    test("读较早的位置不报还没写到的违反：地址守卫（第 18 章的违反，读第 10 章末尾不报）、读者守卫（第 12 章的揭示，读第 5 章末尾不报）", () => {
        const w = new PlotWorld(CHAPTERS);
        const thing = w.thing("身份");
        w.decision("不暴露", {about: [], conclusion: "x", marks: [address(thing, {to: "ch20"})]});
        w.change(chapter("ch18"), {patches: [setState(thing, "暴露")]});
        expect(addressFindings(w, end("ch10"))).toEqual([]);
        expect(addressFindings(w, end("ch18"))).toHaveLength(1);
        const point = w.point("管家是凶手", w.person("管家"));
        w.texts.set("ch12", "原来管家就是凶手。");
        w.change(chapter("ch12"), {told: [{source: "chapter", chapter: "ch12", quote: "原来管家就是凶手", marks: [{kind: MARK_IDS.reveal, version: 1, point, mode: "explicit"}]}]});
        w.decision("别明说", {about: [], conclusion: "y", marks: [{kind: MARK_IDS.guardReader, version: 1, point, atMost: "unaware", until: "ch20"}]});
        const reader = guardDiagnostics(digest)[DECISION_DIAGNOSTIC_IDS.readerGuardViolated]!;
        expect(reader(w.view(), end("ch5"), "actual")).toEqual([]);
        expect(reader(w.view(), end("ch12"), "actual")).toHaveLength(1);
    });
});
