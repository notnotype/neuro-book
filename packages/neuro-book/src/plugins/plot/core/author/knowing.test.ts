/**
 * 作者用的知情读取（docs/specs/plot/knowledge.md 输出 11 到 16）接在真实的 `World` 上：人群、程度（含忘了、显式不知道、没有行）、
 * 来处的四种、读者在读取位置上的程度、和一个知识点有关的。
 */

import {describe, expect, test} from "bun:test";

import {MARK_IDS} from "../../shared/declarations";
import {addRow, chapter, drafts, end, learns, PlotWorld, present, setSub, start} from "../../testing/world";
import {authorPeople, personKnowing, pointKnowing, readerAt} from "./knowing";

const CHAPTERS = ["ch1", "ch2", "ch3", "ch8", "ch9"];

describe("人群（输出 13）", () => {
    test("已出场、未删除的人物与组织，马甲归到本体；地点、还没出场的、删掉的不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const brother = w.person("哥哥", {sameAs: xia});
        const committee = w.person("对策委员会", {type: "组织"});
        w.person("学校", {type: "地点"});
        w.person("新同学", {appears: chapter("ch3")});
        const gone = w.person("走了的人");
        w.publish([{ref: {kind: "entry", id: gone}, after: {...drafts.person(gone, "走了的人"), deleted: true}}]);
        expect(authorPeople(w.view(), end("ch2"))).toEqual([xia, committee].sort());
        expect(brother).not.toBe(xia);
        expect(authorPeople(w.view(), end("ch3"))).toHaveLength(3);
    });
});

describe("人物的知情与来处（输出 11、16）", () => {
    test("保密以上的都列（没有行写 none），别的只列有行的；忘了、信错了原样给；来处是初值、事件（带章与段）或隐秘目标的出场", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾", {init: {...drafts.person("x", "星瑾").init, data: {know: {type: "nbook.plot.knowing", version: 1, enabled: true, fields: {知情: [], 听过的说法: null}}}}});
        const xia = w.person("星瑕");
        const secret = w.point("哥哥就是星瑕", xia);
        const prisoned = w.point("那几年是被软禁", xia);
        const forgotten = w.point("小时候的约定", xia);
        const common = w.point("城里有家蛋糕店", null, {保密: "common"});
        w.point("天气预报", null, {保密: "common"});
        w.texts.set("ch2", "第一段。\n她把卡推了回去。");
        const told = w.change(chapter("ch2"), {patches: [addRow(jin, prisoned, {程度: "misbelieves", 他以为的: "哥哥不想回家", 怎么知道: "inferred"})], told: [{source: "chapter", chapter: "ch2", quote: "她把卡推了回去"}]});
        w.change(chapter("ch2", 5), {patches: [addRow(jin, forgotten, {程度: "knows"})]});
        const forgot = w.change(chapter("ch3"), {patches: [setSub(jin, forgotten, "程度", "forgot")]});
        w.change(chapter("ch1"), {patches: [addRow(jin, common, {程度: "knows", 怎么知道: "witnessed"})]});

        const read = personKnowing(w.view(), "actual", end("ch3"), jin);
        const bySecret = Object.fromEntries(read.secrets.map((row) => [row.point, row]));
        expect(bySecret[secret]).toMatchObject({degree: "none", origin: null});
        expect(bySecret[prisoned]).toMatchObject({degree: "misbelieves", belief: "哥哥不想回家", how: "inferred", origin: {kind: "event", change: told, chapter: "ch2", paragraph: 2}});
        expect(bySecret[forgotten]).toMatchObject({degree: "forgot", origin: {kind: "event", change: forgot, chapter: "ch3", paragraph: null}});
        expect(read.others.map((row) => row.point)).toEqual([common]);
    });

    test("在场推出的来处是那条变更；隐秘目标推出的来处是目标的出场；去掉以后同值再加，来处是再加的那一条", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const jin = w.person("星瑾");
        const k = w.point("K", xia);
        const hidden = w.point("要瞒的事", xia);
        const witnessed = w.change(chapter("ch1"), {cast: [present(jin)], marks: [learns(k)]});
        const goal = w.goal("不让妹妹发现", xia, {隐秘: {ref: hidden}}, {appears: chapter("ch2")});
        const view = w.view();
        expect(personKnowing(view, "actual", end("ch2"), jin).secrets.find((row) => row.point === k)?.origin).toEqual({kind: "event", change: witnessed, chapter: "ch1", paragraph: null});
        expect(personKnowing(view, "actual", end("ch2"), xia).secrets.find((row) => row.point === hidden)?.origin).toEqual({kind: "goal", goal, chapter: "ch2"});

        const w2 = new PlotWorld(CHAPTERS);
        const a = w2.person("甲");
        const p = w2.point("P", null);
        w2.change(chapter("ch1"), {patches: [addRow(a, p, {程度: "knows"})]});
        w2.change(chapter("ch2"), {patches: [{op: "listRemove", at: {entry: a, path: "know.知情"}, value: p}]});
        const again = w2.change(chapter("ch3"), {patches: [addRow(a, p, {程度: "knows"})]});
        expect(personKnowing(w2.view(), "actual", end("ch3"), a).secrets[0]).toMatchObject({degree: "knows", origin: {kind: "event", change: again, chapter: "ch3"}});
        expect(personKnowing(w2.view(), "actual", end("ch2"), a).secrets[0]).toMatchObject({degree: "none", origin: null});
    });

    test("知识点删了，指向它的有效知情行照样列（引用保留）；还没出场的知识点有行也列", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const gone = w.point("删掉的秘密", xia);
        const later = w.entry({...drafts.point("tmp:later", "第 3 章才出场的", xia), appears: chapter("ch3")});
        w.change(chapter("ch1"), {patches: [addRow(xia, gone, {程度: "forgot"}), addRow(xia, later, {程度: "knows"})]});
        const stored = structuredClone(w.world.data.entries.get(gone)!);
        w.publish([{ref: {kind: "entry", id: gone}, after: {...stored, deleted: true}}]);
        const rows = personKnowing(w.view(), "actual", end("ch2"), xia).secrets.map((row) => [row.point, row.degree]);
        expect(rows).toEqual(expect.arrayContaining([[gone, "forgot"], [later, "knows"]]));
    });

    test("回溯带过去的：来处是分叉（带它所在的章与父线），另给父线上的原证据（段号按父线的讲述，子线看不到切口之后的父线讲述）", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const k = w.point("K", xia);
        const cut = w.change(chapter("ch3"));
        w.texts.set("ch8", "第一段。\n她终于看见了。");
        const learned = w.change(chapter("ch8", 10), {cast: [present(xia)], marks: [learns(k)], told: [{source: "chapter", chapter: "ch8", quote: "她终于看见了"}]});
        const trigger = w.change(chapter("ch8", 50));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch8", 60)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, trigger, type: "rollback", who: xia}}}]);
        const onLine = w.view().onLine(ids["tmp:r1"]!);
        if ("code" in onLine) throw new Error(onLine.code);
        const row = personKnowing(onLine, "actual", end("ch9"), xia).secrets.find((item) => item.point === k)!;
        expect(row.degree).toBe("knows");
        expect(row.origin).toEqual({kind: "carried", fork: ids["tmp:f"], chapter: "ch8", line: "main", evidence: {change: learned, chapter: "ch8", paragraph: 2}});
    });
});

describe("读者在读取位置上的程度（输出 12）", () => {
    test("初值什么都没读；章首读完上一章；章末读完这一章；与线和模式无关", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const k = w.point("K", xia);
        w.texts.set("ch1", "第一段。\n那只魔偶你还留着吗？");
        w.texts.set("ch3", "原来哥哥就是星瑕。");
        const reveal = (mode: "hint" | "explicit") => ({kind: MARK_IDS.reveal, version: 1, point: k, mode});
        w.change(chapter("ch1"), {told: [{source: "chapter", chapter: "ch1", quote: "那只魔偶你还留着吗", marks: [reveal("hint")]}]});
        w.change(chapter("ch3"), {told: [{source: "chapter", chapter: "ch3", quote: "原来哥哥就是星瑕", marks: [reveal("explicit")]}]});
        const view = w.view();
        expect(readerAt(view, k, {kind: "initial"})).toBe("unaware");
        expect(readerAt(view, k, start("ch1"))).toBe("unaware");
        expect(readerAt(view, k, end("ch1"))).toBe("suspects");
        expect(readerAt(view, k, start("ch3"))).toBe("suspects");
        expect(readerAt(view, k, end("ch3"))).toBe("knows");
        const detail = pointKnowing(view, "actual", end("ch1"), k);
        expect(detail.reader).toEqual({degree: "suspects", suspects: {chapter: "ch1", paragraph: 2, excerpt: "那只魔偶你还留着吗？"}, knows: {chapter: "ch3", paragraph: 1, excerpt: "原来哥哥就是星瑕。"}});
    });
});

describe("一个知识点谁知道（输出 15）", () => {
    test("有行的人与其余的人数：保密以上其余写不知道，常识只算没有记录", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const jin = w.person("星瑾");
        w.person("彗");
        const secret = w.point("S", xia);
        const common = w.point("C", null, {保密: "common"});
        w.change(chapter("ch1"), {patches: [addRow(xia, secret, {程度: "knows"}), addRow(jin, common, {程度: "knows"})]});
        const view = w.view();
        const s = pointKnowing(view, "actual", end("ch2"), secret);
        expect(s.people.map((row) => [row.person, row.degree])).toEqual([[xia, "knows"]]);
        expect(s.rest).toEqual({count: 2, unaware: true});
        expect(pointKnowing(view, "actual", end("ch2"), common).rest).toEqual({count: 2, unaware: false});
    });

    test("有行但还没填程度的人照样列（程度写 unset），不算进没有行的人数", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const jin = w.person("星瑾");
        const secret = w.point("S", xia);
        w.change(chapter("ch1"), {patches: [addRow(jin, secret, {他以为的: "哥哥在外地"})]});
        const s = pointKnowing(w.view(), "actual", end("ch2"), secret);
        expect(s.people.map((row) => [row.person, row.degree, row.belief])).toEqual([[jin, "unset", "哥哥在外地"]]);
        expect(s.rest).toEqual({count: 1, unaware: true});
    });

    test("和它有关的：直接挂的决策（已定写结论、待定不写旧结论、放弃的不列）、只经读者守卫的另列、以它为答案的伏笔、起因是它的态度、隐秘是它的目标", () => {
        const w = new PlotWorld(CHAPTERS);
        const xia = w.person("星瑕");
        const k = w.point("K", xia);
        const decided = w.decision("第 1 卷之内不说", {about: [{kind: "entry", id: k}], conclusion: "不说"});
        const pending = w.decision("哪一章说", {about: [{kind: "address", at: {entry: k, path: "point.保密"}}], due: "ch3"});
        const dropped = w.decision("算了", {about: [{kind: "entry", id: k}]});
        w.drop(dropped);
        const guard = w.decision("读者第 9 章前不知道", {about: [], conclusion: "守住", marks: [{kind: MARK_IDS.guardReader, version: 1, point: k, atMost: "suspects", until: "ch9"}]});
        const mystery = w.foreshadow("谁是星瑕", {种类: "mystery", 答案: {ref: k}});
        const goal = w.goal("瞒着", xia, {隐秘: {ref: k}});
        const related = pointKnowing(w.view(), "actual", end("ch2"), k).related;
        expect(related.decisions.map((item) => [item.id, item.status, item.conclusion])).toEqual([[decided, "decided", "不说"], [pending, "pending", null]]);
        expect(related.guards.map((item) => item.id)).toEqual([guard]);
        expect(related.foreshadows.map((item) => item.id)).toEqual([mystery]);
        expect(related.goals).toEqual([goal]);
    });
});
