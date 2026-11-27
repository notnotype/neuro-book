import {describe, expect, test} from "bun:test";

import type {Entry} from "@notnotype/nb-canon";

import {COMPONENT_IDS, MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {EXTRA} from "../../testing/brief-world";
import {addRow, chapter, drafts, PlotWorld, present} from "../../testing/world";
import * as fixed from "./fixed";
import {composeBrief, type BriefInput, type BriefResult} from "./index";

/**
 * 关卡（docs/specs/plot/brief.md 输出 16）的确定用例：t34 第三轮实现审查（I12）简报部分的各条，与 t35 两轮计划审查（P1、P2）
 * 的复现，各一条。随机的组合在 `secrecy.test.ts`。
 */

const CHAPTERS = Array.from({length: 20}, (_, index) => `ch${String(index + 1)}`);
const digest = (text: string) => `sha:${String(text.length)}:${text.slice(0, 8)}`;
const instruction = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});
function brief(w: PlotWorld, chapterId: string, extra: Partial<BriefInput> = {}): BriefResult {
    const result = composeBrief({view: w.view(), chapter: chapterId, outline: "细纲", targetWords: 2000, pluginVersion: "test", digest, ...extra});
    if (typeof result === "string") throw new Error(result);
    return result;
}
const section = (result: BriefResult, key: string, part = 0) => result.parts[part]!.sections.find((s) => s.key === key)!.items.map((item) => item.text).join("\n");
const common = (result: BriefResult, key: string) => result.common.find((s) => s.key === key)!.items.map((item) => item.text).join("\n");
const setState = (thing: string, value: string) => ({op: "set" as const, at: {entry: thing, path: "character.状态"}, value});
const reveal = (point: string, mode: "hint" | "explicit") => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const told = (chapterId: string, marks: unknown[]) => ({source: "outline" as const, chapter: chapterId, anchor: "细纲", marks: marks as never});

/** 新建一个带主文字的条目。 */
function withText(w: PlotWorld, draft: Entry, blocks: string[]): string {
    return w.publish([{ref: {kind: "entry", id: draft.id}, after: {...draft, init: {...draft.init, text: blocks.map((source, index) => ({id: `b${String(index + 1)}`, source}))}}}])[draft.id]!;
}
/** 带态度表的人物。 */
function attitudePerson(w: PlotWorld, name: string): string {
    const draft = drafts.person(`tmp:a${name}`, name);
    return w.publish([{ref: {kind: "entry", id: draft.id}, after: {...draft, init: {...draft.init, data: {...draft.init.data, att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: []}}}}}}])[draft.id]!;
}
function remove(w: PlotWorld, id: string): void {
    w.publish([{ref: {kind: "entry", id}, after: {...structuredClone(w.world.data.entries.get(id)!), deleted: true}}]);
}
/** 任何段、记录与提示里都没有这些名字。 */
function noLeak(result: BriefResult, ...names: string[]) {
    for (const name of names) {
        expect(result.text).not.toContain(name);
        expect(JSON.stringify(result.record)).not.toContain(name);
        expect(JSON.stringify(result.hints)).not.toContain(name);
    }
}

/** 王爷这一场用马甲灰袍客；“灰袍客就是王爷”绝密（`level` 可改）、本章不揭示；卫兵对王爷崇敬、称他殿下。 */
function lordInDisguise(level: "secret" | "topSecret" = "topSecret") {
    const w = new PlotWorld(CHAPTERS);
    const lord = w.person("王爷");
    const guard = attitudePerson(w, "卫兵");
    const mask = w.person("灰袍客", {sameAs: lord});
    const unmask = w.point("灰袍客就是王爷", lord, {保密: level, 揭穿: {ref: mask}});
    const guilt = w.point("王爷毒死了先帝", lord, {保密: "topSecret", 表现: "提到宫里就岔开"});
    w.change(chapter("ch2"), {patches: [addRow(lord, guilt, {程度: "knows"}), addRow(lord, unmask, {程度: "knows"}), {op: "listAdd", at: {entry: guard, path: "att.态度"}, value: {id: lord, 态度: "崇敬", 称呼: "殿下"}}]});
    return {w, lord, guard, mask, unmask, guilt};
}

describe("brief 输出 16：名字只经关卡（I12 的各条）", () => {
    test("I12 第 1 项：涉及条目的主文字用表达式读绝密知识点与隐秘目标的名字，那一块整块扣下；别的块照写", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "topSecret"});
        const goal = w.goal("毒死男爵", butler, {隐秘: {ref: k}});
        const thing = withText(w, drafts.thing("tmp:t", "怀表"), [`它和 <V entry="${k}" of="entry.name" /> 有关。`, `它是 <V entry="${goal}" of="entry.name" /> 的工具。`, "表盖有划痕。"]);
        w.change(chapter("ch4"), {kind: "plan", text: "拿起怀表", cast: [present(butler)], patches: [setState(thing, "停了")]});
        const result = brief(w, "ch4");
        const appearance = section(result, "appearance");
        expect(appearance).toContain("表盖有划痕。");
        expect(appearance.split(fixed.WITHHELD_BLOCK).length - 1).toBe(2);
        noLeak(result, "管家是凶手", "毒死男爵");
    });

    test("I12 第 2 项：本章、之后才出场的隐秘目标，本章计划改它、引它，都不写它的名字与状态变化", () => {
        for (const appears of ["ch4", "ch6"]) {
            const w = new PlotWorld(CHAPTERS);
            const [butler, hero] = [w.person("管家"), w.person("勇者")];
            const k = w.point("管家想继承爵位", butler, {保密: "topSecret"});
            const goal = w.goal("毒死男爵继承爵位", butler, {隐秘: {ref: k}}, {appears: chapter(appears, 5)});
            const guard = w.goal("保护男爵", hero);
            w.change(chapter("ch4", 10), {kind: "plan", text: "管家动手", cast: [present(butler), present(hero)], patches: [{op: "set", at: {entry: goal, path: "goal.状态"}, value: "blocked"}, {op: "listAdd", at: {entry: guard, path: "goal.冲突"}, value: {id: goal}}]});
            const result = brief(w, "ch4");
            noLeak(result, "毒死男爵继承爵位", "管家想继承爵位");
            expect(section(result, "plan")).not.toContain("blocked");
        }
    });

    test("I12 第 3 项：隐秘指向的知识点被删、目标被删：目标照样遮，删掉的条目写“已删除的条目”", () => {
        const w = new PlotWorld(CHAPTERS);
        const [butler, hero] = [w.person("管家"), w.person("勇者")];
        const k = w.point("管家想继承爵位", butler, {保密: "topSecret"});
        const goal = w.goal("毒死男爵继承爵位", butler, {隐秘: {ref: k}});
        const plain = w.goal("拿到遗嘱", butler);
        const guard = w.goal("保护男爵", hero, {冲突: [{id: plain}]});
        remove(w, k);
        remove(w, plain);
        w.change(chapter("ch4"), {kind: "plan", text: "管家动手", cast: [present(butler), present(hero)], patches: [{op: "set", at: {entry: goal, path: "goal.状态"}, value: "blocked"}, {op: "listRemove", at: {entry: guard, path: "goal.冲突"}, value: plain}]});
        const result = brief(w, "ch4");
        noLeak(result, "毒死男爵继承爵位", "管家想继承爵位", "拿到遗嘱");
        expect(section(result, "plan")).toContain(fixed.hiddenGoalOf("管家"));
        expect(section(result, "plan")).toContain(`去掉${fixed.DELETED_ENTRY}`);
    });

    test("I12 第 4 项：绝密的主体是隐秘目标或别的绝密知识点时，往上找到能写名字的那一个", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const kG = w.point("管家想继承爵位", butler, {保密: "topSecret"});
        const goal = w.goal("毒死男爵", butler, {隐秘: {ref: kG}});
        const poison = w.point("砒霜藏在酒窖", goal, {保密: "topSecret"});
        const key = w.point("酒窖钥匙在他身上", kG, {保密: "topSecret"});
        w.change(chapter("ch4"), {kind: "plan", text: "管家下楼", cast: [present(butler)], patches: [addRow(butler, poison, {程度: "knows"}), addRow(butler, key, {程度: "knows"})]});
        const result = brief(w, "ch4");
        expect(section(result, "secrets").split(fixed.topSecretOf("管家")).length - 1).toBeGreaterThanOrEqual(3);
        noLeak(result, "毒死男爵", "管家想继承爵位", "砒霜藏在酒窖", "酒窖钥匙在他身上");
    });

    test("I12 第 5 项：到期的待定决策挂在绝密知识点的地址上：只写“有一条涉及保密设定的待定决定到期了”", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家是凶手", butler, {保密: "topSecret"});
        w.decision("凶手这件事何时揭露", {about: [{kind: "address", at: {entry: k, path: "point.表现"}}], due: "ch4"});
        w.change(chapter("ch4"), {kind: "plan", text: "管家端茶", cast: [present(butler)]});
        const result = brief(w, "ch4");
        expect(section(result, "decisions")).toContain(fixed.DECISION_DUE_ABOUT_SECRET);
        noLeak(result, "凶手这件事何时揭露", "管家是凶手");
    });

    test("I12 第 6、7 项：回收主文字被扣下以后，涉及条目的样子不再给伏笔；主文字引答案字段，按答案扣下并给带原因的提示", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const secret = w.point("园丁是真凶", hero, {保密: "topSecret"});
        const draft = drafts.foreshadow("tmp:fs", "脚印", {答案: {ref: secret}});
        const fs = withText(w, draft, ["回收时写明 <V of=\"fs.答案\" /> 留下脚印。"]);
        w.change(chapter("ch15"), {kind: "plan", text: "揭晓", cast: [present(hero)], told: [told("ch15", [{kind: MARK_IDS.node, version: 1, foreshadow: fs, role: "payoff"}])], patches: [{op: "set", at: {entry: fs, path: "fs.重要程度"}, value: "minor"}]});
        const result = brief(w, "ch15");
        expect(section(result, "foreshadow")).toContain(fixed.PAYOFF_BY_OUTLINE);
        expect(result.hints).toContainEqual(expect.objectContaining({code: "nbook.plot.brief.payoffWithheld", reason: "answer"}));
        expect(section(result, "appearance")).not.toContain("脚印");
        noLeak(result, "园丁是真凶", "留下脚印");
    });

    test("I12 第 7、8 项：答案不是秘密时，引用字段写名字；图片标签写说明，不留标签与路径", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const fact = w.point("园丁留下的", hero, {保密: "common"});
        const fs = withText(w, drafts.foreshadow("tmp:fs", "脚印", {答案: {ref: fact}}), ['回收时写明脚印是<V of="fs.答案" />，<Image src="a.png" alt="脚印图" />。']);
        w.change(chapter("ch15"), {kind: "plan", text: "揭晓", cast: [present(hero)], told: [told("ch15", [{kind: MARK_IDS.node, version: 1, foreshadow: fs, role: "payoff"}])]});
        const text = section(brief(w, "ch15"), "foreshadow");
        expect(text).toContain("回收：回收时写明脚印是园丁留下的，脚印图。");
        for (const raw of ["<Image", "a.png", "{", '"ref"']) expect(text).not.toContain(raw);
    });

    test("I12 第 9 项、P1 第 3 条：身份绝密的马甲，各段只写马甲；不认得他的卫兵不列对王爷的态度，称谓左栏写马甲", () => {
        const {w, lord, guard, mask, guilt} = lordInDisguise();
        void guilt;
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        const result = brief(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        expect(section(result, "secrets")).toContain(fixed.topSecretOf("灰袍客"));
        expect(section(result, "secrets")).toContain(fixed.presenceOf("灰袍客", "提到宫里就岔开"));
        expect(section(result, "address")).toContain("灰袍客 = 灰袍客");
        expect(section(result, "people")).not.toContain("崇敬");
        noLeak(result, "王爷", "殿下");
    });

    test("I12 第 9 项：回溯章，前段没有他、后段他用马甲：称谓表与两份里都不写本名", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        w.change(chapter("ch7", 10), {kind: "plan", text: "卫兵巡夜", cast: [present(guard)]});
        const cut = w.change(chapter("ch7", 20));
        const trigger = w.change(chapter("ch7", 50));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch7", 90)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, trigger, type: "rollback", who: guard, carry: []}}}]);
        const branch = ids["tmp:r1"]!;
        w.change({...chapter("ch8", 5), line: branch}, {kind: "plan", text: "灰袍客现身", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        w.change(chapter("ch8", 5), {kind: "plan", text: "卫兵换岗", cast: [present(guard)]});
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line: "main", from: 1}, {line: branch, from: 30}]]])});
        const result = brief(w, "ch8", {instruction: instruction("ch8", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        expect(result.parts.length).toBe(2);
        expect(section(result, "address")).toContain("灰袍客 = 灰袍客");
        noLeak(result, "王爷");
    });
});

describe("brief 输出 16：两轮计划审查的复现", () => {
    test("P1 第 2 条：已定决策挂在隐秘目标上：只写“有一条涉及保密设定的决定”", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家想继承爵位", butler, {保密: "topSecret"});
        const goal = w.goal("毒死男爵", butler, {隐秘: {ref: k}});
        w.decision("下毒的时机", {about: [{kind: "entry", id: goal}], conclusion: "第二十章在茶里下毒", reason: "留到最后"});
        w.change(chapter("ch4"), {kind: "plan", text: "管家端茶", cast: [present(butler)], patches: [{op: "set", at: {entry: goal, path: "goal.状态"}, value: "blocked"}]});
        const result = brief(w, "ch4");
        expect(section(result, "decisions")).toContain(fixed.DECISION_ABOUT_SECRET);
        noLeak(result, "第二十章在茶里下毒", "下毒的时机");
    });

    test("P1 第 7 条：本章计划自己把知识点升成绝密、把目标设成隐秘：这一章就遮", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家想继承爵位", butler, {保密: "common"});
        const goal = w.goal("毒死男爵继承爵位", butler);
        w.change(chapter("ch4"), {kind: "plan", text: "管家端茶", cast: [present(butler)], patches: [{op: "set", at: {entry: k, path: "point.保密"}, value: "topSecret"}, {op: "set", at: {entry: goal, path: "goal.隐秘"}, value: {ref: k}}, {op: "set", at: {entry: goal, path: "goal.状态"}, value: "blocked"}]});
        const result = brief(w, "ch4");
        expect(section(result, "secrets")).toContain(fixed.topSecretOf("管家"));
        noLeak(result, "毒死男爵继承爵位", "管家想继承爵位");
    });

    test("P1 第 10 条：之后才出场的人：引他的那一块扣下，名字不出现；本章才出场的人照写", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const villain = w.person("幕后黑手魔王", {appears: chapter("ch18")});
        const newcomer = w.person("新来的书童", {appears: chapter("ch5", 5)});
        const thing = withText(w, drafts.thing("tmp:t", "怀表"), [`怀表是<Ref id="${villain}" />送的。`, `书童是<Ref id="${newcomer}" />。`]);
        w.change(chapter("ch5", 10), {kind: "plan", text: "书童递上怀表", cast: [present(hero), present(newcomer)], patches: [setState(thing, "停了")]});
        const result = brief(w, "ch5");
        expect(section(result, "appearance")).toContain(fixed.WITHHELD_BLOCK);
        expect(section(result, "appearance")).toContain("书童是新来的书童。");
        expect(section(result, "people")).toContain("新来的书童");
        noLeak(result, "幕后黑手魔王");
    });

    test("P2 第 2 条：作者文字按条目选出对用马甲的人那一行：那一块扣下", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        const note = withText(w, drafts.thing("tmp:n", "卫兵的日记"), [`卫兵见到<V entry="${guard}" of="att.态度[${lord}].称呼" />就下跪。`, "日记写到一半。"]);
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [setState(note, "翻开")]});
        const result = brief(w, "ch4");
        expect(section(result, "appearance")).toContain(fixed.WITHHELD_BLOCK);
        expect(section(result, "appearance")).toContain("日记写到一半。");
        noLeak(result, "殿下", "王爷");
    });

    test("P2 第 3 条：卫兵认得他（知道揭穿），但身份不给写手：也不列对王爷的态度", () => {
        const {w, lord, guard, mask, unmask} = lordInDisguise();
        w.change(chapter("ch3"), {patches: [addRow(guard, unmask, {程度: "knows"})]});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        const result = brief(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        expect(section(result, "people")).not.toContain("崇敬");
        noLeak(result, "王爷", "殿下");
    });

    test("P2 第 4 条：一个马甲有两条揭穿（保密与绝密）：整组按不给内容写，保密的那条也不给真相", () => {
        const {w, lord, guard, mask} = lordInDisguise("topSecret");
        w.point("灰袍客其实是贵人", lord, {保密: "secret", 揭穿: {ref: mask}});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        const result = brief(w, "ch4");
        noLeak(result, "灰袍客其实是贵人", "灰袍客就是王爷", "王爷");
    });

    test("待确认第 2 项：揭穿给了写手、视角人物认得他：称谓左栏按输出 7 写称呼，右栏写马甲，真相在那一项", () => {
        const {w, lord, guard, mask, unmask} = lordInDisguise("secret");
        w.change(chapter("ch3"), {patches: [addRow(guard, unmask, {程度: "knows"})]});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        const result = brief(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        expect(section(result, "address")).toContain("殿下 = 灰袍客");
        expect(section(result, "secrets")).toContain("真相：灰袍客就是王爷");
        expect(section(result, "people")).toContain("对灰袍客的态度：崇敬");
    });

    test("P2 第 7 条：计划里在场、出场却记在之后的人：按在场写（这里写马甲），不写成之后才出场", () => {
        const w = new PlotWorld(CHAPTERS);
        const guard = w.person("卫兵");
        const villain = w.person("魔王", {appears: chapter("ch18")});
        const mask = w.person("旅人", {sameAs: villain});
        w.point("旅人就是魔王", villain, {保密: "topSecret", 揭穿: {ref: mask}});
        w.change(chapter("ch5"), {kind: "plan", text: "旅人问路", cast: [present(guard), {who: villain, as: mask, role: "present"}]});
        const result = brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        expect(section(result, "people")).toContain("旅人");
        expect(result.text).not.toContain(fixed.LATER_ENTRY);
        noLeak(result, "魔王");
    });

    test("P2 第 6、8 条：补叙章的本章计划把知识点升成绝密：补叙的那份也遮；写作指示写第几章，不写章 id", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const k = w.point("管家想继承爵位", butler, {保密: "common"});
        w.change(chapter("ch8"), {kind: "plan", text: "回忆管家", cast: [present(butler)], patches: [{op: "set", at: {entry: k, path: "point.保密"}, value: "topSecret"}, addRow(butler, k, {程度: "knows"})]});
        const flashback = brief(w, "ch8", {instruction: instruction("ch8", {timeMode: {flashback: {kind: "chapter", chapter: "ch2", key: 0}}})});
        expect(common(flashback, "instruction")).toContain("补叙第 2 章的事");
        noLeak(flashback, "管家想继承爵位");
        const parallel = brief(w, "ch8", {instruction: instruction("ch8", {timeMode: {parallel: "ch3"}})});
        expect(common(parallel, "instruction")).toContain("与第 3 章同时");
        expect(common(parallel, "instruction")).not.toContain("ch3");
    });
});

describe("brief 输出 16：变异检查补的用例", () => {
    test("以引用为键的列表行：名字经关卡写（身份给了写手的马甲写马甲，不用读取时内核补的本名）；身份绝密时以他为键的行整行不写", () => {
        for (const level of ["secret", "topSecret"] as const) {
            const w = new PlotWorld(CHAPTERS, [EXTRA]);
            const [lord, guard] = [w.person("王爷"), w.person("卫兵")];
            const mask = w.person("灰袍客", {sameAs: lord});
            w.point("灰袍客就是王爷", lord, {保密: level, 揭穿: {ref: mask}});
            const draft = drafts.thing("tmp:t", "令牌");
            const ext = {type: EXTRA.id, version: 1, enabled: true, fields: {指向: null, 清单: [], 图: null, 关系: [{id: lord, 说法: "见过"}]}};
            const thing = w.publish([{ref: {kind: "entry", id: "tmp:t"}, after: {...draft, init: {...draft.init, data: {...draft.init.data, ext}}}}])["tmp:t"]!;
            w.change(chapter("ch4"), {kind: "plan", text: "亮出令牌", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [setState(thing, "亮出")]});
            const result = brief(w, "ch4");
            expect(section(result, "appearance")).not.toContain("王爷");
            if (level === "secret") expect(section(result, "appearance")).toContain("关系：灰袍客（说法：见过）");
            else {
                expect(section(result, "appearance")).not.toContain("见过");
                noLeak(result, "王爷");
            }
        }
    });

    test("本章才出场、藏着保密知识点的目标：知识点的主体不在场，也进这一场的秘密，写目标的名字与为什么", () => {
        const w = new PlotWorld(CHAPTERS);
        const [butler, baron] = [w.person("管家"), w.person("男爵")];
        const debt = w.point("男爵欠了赌债", baron, {保密: "secret"});
        w.goal("拿到借据", butler, {隐秘: {ref: debt}, 为什么: "要挟男爵"}, {appears: chapter("ch4", 5)});
        w.change(chapter("ch4", 10), {kind: "plan", text: "翻书房", cast: [present(butler)]});
        const secrets = section(brief(w, "ch4"), "secrets");
        expect(secrets).toContain("真相：男爵欠了赌债");
        expect(secrets).toContain("管家的隐秘目标：拿到借据；为什么：要挟男爵");
    });

    test("用马甲的人（身份保密、给了写手）的列表增减：本章计划里主人写马甲；身份绝密时这项变化不写", () => {
        for (const level of ["secret", "topSecret"] as const) {
            const w = new PlotWorld(CHAPTERS);
            const lord = attitudePerson(w, "王爷");
            const guard = w.person("卫兵");
            const mask = w.person("灰袍客", {sameAs: lord});
            w.point("灰袍客就是王爷", lord, {保密: level, 揭穿: {ref: mask}});
            w.change(chapter("ch4"), {kind: "plan", text: "盯着卫兵", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [{op: "listAdd", at: {entry: lord, path: "att.态度"}, value: {id: guard, 态度: "提防"}}]});
            const plan = section(brief(w, "ch4"), "plan");
            expect(plan).not.toContain("王爷");
            if (level === "secret") expect(plan).toContain("灰袍客的");
            else expect(plan).not.toContain("提防");
        }
    });

    test("回溯章：前段他露面、后段他用马甲（身份绝密）：称谓表取用马甲的那一份，左右两栏都写马甲", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        const cut = w.change(chapter("ch7", 20));
        const trigger = w.change(chapter("ch7", 50));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch7", 90)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, trigger, type: "rollback", who: guard, carry: []}}}]);
        const branch = ids["tmp:r1"]!;
        w.change(chapter("ch8", 5), {kind: "plan", text: "王爷巡城", cast: [present(guard), present(lord)]});
        w.change({...chapter("ch8", 5), line: branch}, {kind: "plan", text: "灰袍客现身", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line: "main", from: 1}, {line: branch, from: 30}]]])});
        const result = brief(w, "ch8", {instruction: instruction("ch8", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        expect(section(result, "address")).toContain("灰袍客 = 灰袍客");
    });

    test("涉及条目的样子跳过用马甲（身份绝密）的本体：他本体字段里写的身份不出去", () => {
        const w = new PlotWorld(CHAPTERS);
        const guard = w.person("卫兵");
        const draft = drafts.person("tmp:lord", "王爷");
        const lord = w.publish([{ref: {kind: "entry", id: "tmp:lord"}, after: {...draft, init: {...draft.init, data: {...draft.init.data, character: {type: "test.person", version: 1, enabled: true, fields: {状态: "镇南王府的主人"}}}}}}])["tmp:lord"]!;
        const mask = w.person("灰袍客", {sameAs: lord});
        w.point("灰袍客就是王爷", lord, {保密: "topSecret", 揭穿: {ref: mask}});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        const result = brief(w, "ch4");
        expect(section(result, "appearance")).toContain("灰袍客");
        noLeak(result, "镇南王府", "王爷");
    });
});

describe("brief 输出 16：实现审查（第一轮）的复现", () => {
    test("第 1、9 条：身份绝密的本体，本章计划改他的名字、别名、简介与字段，在场的人里他的目标，都不写", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        w.goal("夺回先帝传下的王位", lord, {为什么: "他是先帝之弟"});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [{op: "set", at: {entry: lord, path: "entry.name"}, value: "摄政王"}, {op: "set", at: {entry: lord, path: "entry.aliases"}, value: ["镇北王"]}, {op: "set", at: {entry: lord, path: "entry.summary"}, value: "先帝之弟"}]});
        const result = brief(w, "ch4");
        expect(section(result, "people")).toContain("灰袍客");
        noLeak(result, "王爷", "摄政王", "镇北王", "先帝之弟", "夺回先帝传下的王位");
    });

    test("第 2 条：本章计划改主文字的一块：只写“改了一块”，不写源文、id 与路径", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const k = w.point("勇者是王子", hero, {保密: "topSecret"});
        const thing = withText(w, drafts.thing("tmp:t", "怀表"), ["表盖有划痕。"]);
        w.change(chapter("ch4"), {kind: "plan", text: "改怀表", cast: [present(hero)], patches: [{op: "set", at: {entry: thing, path: "text[b1]"}, value: `它和 <V entry="${k}" of="entry.name" /> 有关，<Ref id="${k}" />。`}]});
        const result = brief(w, "ch4");
        expect(section(result, "plan")).toContain(fixed.textChanged("怀表"));
        for (const raw of ["text[", "<Ref", "<V ", k]) expect(section(result, "plan")).not.toContain(raw);
        noLeak(result, "勇者是王子");
    });

    test("第 3 条：身份不给写手的马甲条目，别的条目用表达式读它的简介：那一块扣下；它自己的正文也不给", () => {
        const w = new PlotWorld(CHAPTERS);
        const [lord, guard] = [w.person("王爷"), w.person("卫兵")];
        const maskDraft = drafts.person("tmp:m", "灰袍客", {sameAs: lord});
        const mask = w.publish([{ref: {kind: "entry", id: "tmp:m"}, after: {...maskDraft, init: {...maskDraft.init, summary: "其实是王爷的化身", text: [{id: "b1", source: "化身的底细。"}]}}}])["tmp:m"]!;
        w.point("灰袍客就是王爷", lord, {保密: "topSecret", 揭穿: {ref: mask}});
        const thing = withText(w, drafts.thing("tmp:t", "怀表"), [`主人：<V entry="${mask}" of="entry.summary" />`]);
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客拿起怀表", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [setState(thing, "停了")]});
        const result = brief(w, "ch4");
        expect(section(result, "appearance")).toContain(fixed.WITHHELD_BLOCK);
        noLeak(result, "其实是王爷的化身", "化身的底细");
    });

    test("第 4、5 条：揭穿组里另一条保密档与这一场无关：并进这一场，作者的暗示照常生效；组里还有不揭示的绝密时，以组里的揭穿为答案的回收不给主文字", () => {
        const {w, lord, guard, mask, unmask} = lordInDisguise();
        const stranger = w.person("路人");
        w.point("灰袍客其实是贵人", stranger, {保密: "secret", 揭穿: {ref: mask}});
        const hinted = told("ch4", [reveal(unmask, "hint")]);
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客露了一手", cast: [present(guard), {who: lord, as: mask, role: "present"}], told: [hinted]});
        const secrets = section(brief(w, "ch4"), "secrets");
        expect(secrets).toContain("真相：灰袍客就是王爷");
        expect(secrets).toContain(fixed.onlyWriteTo("hint"));
        // 再加一条不揭示的绝密揭穿：整组不给，以组里那条为答案的伏笔也不给主文字。
        w.point("灰袍客是先帝之弟", lord, {保密: "topSecret", 揭穿: {ref: mask}});
        const fs = withText(w, drafts.foreshadow("tmp:fs", "兜帽", {答案: {ref: unmask}}), ["灰袍客当众摘下兜帽。"]);
        w.change(chapter("ch6"), {kind: "plan", text: "摘兜帽", cast: [present(guard), {who: lord, as: mask, role: "present"}], told: [told("ch6", [reveal(unmask, "hint"), {kind: MARK_IDS.node, version: 1, foreshadow: fs, role: "payoff"}])]});
        const result = brief(w, "ch6");
        expect(section(result, "foreshadow")).toContain(fixed.PAYOFF_BY_OUTLINE);
        expect(result.hints).toContainEqual(expect.objectContaining({code: "nbook.plot.brief.payoffWithheld", reason: "answer"}));
        noLeak(result, "摘下兜帽", "王爷");
    });

    test("第 7 条：本章计划改卫兵对王爷那一行（王爷这一场用马甲、卫兵不认得他）：不写这一行", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        w.change(chapter("ch4"), {kind: "plan", text: "卫兵改口", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [{op: "set", at: {entry: guard, path: `att.态度[${lord}].称呼`}, value: "主公"}]});
        const result = brief(w, "ch4");
        noLeak(result, "殿下", "主公", "王爷");
    });

    test("第 8 条：视角人物以前只见过他戴马甲、揭穿是绝密，这一场他不戴：称谓左栏用泛称，不写旧马甲", () => {
        const w = new PlotWorld(CHAPTERS);
        const [lord, guard] = [w.person("王爷"), w.person("卫兵")];
        const mask = w.person("黑衣人", {sameAs: lord});
        w.point("黑衣人就是王爷", lord, {保密: "topSecret", 揭穿: {ref: mask}});
        w.change(chapter("ch2"), {cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        w.change(chapter("ch4"), {kind: "plan", text: "王爷巡城", cast: [present(guard), present(lord)]});
        const address = section(brief(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: guard}, povMode: "limited"})}), "address");
        expect(address).toContain(`${fixed.A_STRANGER} = 王爷`);
        expect(address).not.toContain("黑衣人");
    });

    test("第 15 条：不在本章的人的隐秘目标：本章计划写“某某的一个隐秘目标”，不加指向秘密段的话", () => {
        const w = new PlotWorld(CHAPTERS);
        const [butler, hero, baron] = [w.person("管家"), w.person("勇者"), w.person("男爵")];
        const debt = w.point("男爵欠了赌债", baron, {保密: "secret"});
        const goal = w.goal("拿到借据", butler, {隐秘: {ref: debt}});
        w.change(chapter("ch4"), {kind: "plan", text: "勇者查账", cast: [present(hero)], patches: [addRow(hero, debt, {程度: "knows"}), {op: "set", at: {entry: goal, path: "goal.状态"}, value: "blocked"}]});
        const plan = section(brief(w, "ch4"), "plan");
        expect(plan).toContain(fixed.hiddenGoalOf("管家"));
        expect(plan).not.toContain("见这一场的秘密");
    });

    test("第 16 条：之后才出场的知识点被本章计划引到：名字写占位，也不给真相", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const later = w.publish([{ref: {kind: "entry", id: "tmp:k"}, after: {...drafts.point("tmp:k", "密室在钟楼下", hero, {保密: "secret"}), appears: chapter("ch9")}}])["tmp:k"]!;
        w.change(chapter("ch4"), {kind: "plan", text: "勇者起疑", cast: [present(hero)], patches: [addRow(hero, later, {程度: "suspects"})]});
        noLeak(brief(w, "ch4"), "密室在钟楼下");
    });
});

describe("brief 输出 16：实现审查（第二轮）的复现", () => {
    test("第 1 条：本章计划整张换掉卫兵的态度表：以身份不给写手的王爷为键的那一行不写", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        w.change(chapter("ch4"), {kind: "plan", text: "卫兵改口", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [{op: "set", at: {entry: guard, path: "att.态度"}, value: [{id: lord, 态度: "敬畏", 称呼: "主公"}]}]});
        noLeak(brief(w, "ch4"), "殿下", "主公", "敬畏", "王爷");
    });

    test("第 2、3 条：身份不给写手的王爷，他的隐秘目标、目标的变化与挂在他身上的决策原话都不写", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        const plot = w.point("有人在查先帝的死因", lord, {保密: "secret"});
        const hidden = w.goal("夺回先帝传下的王位", lord, {隐秘: {ref: plot}, 为什么: "他是先帝之弟"});
        w.decision("王爷何时回宫", {about: [{kind: "entry", id: lord}], conclusion: "王爷第十章回宫", reason: "留悬念"});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [addRow(lord, plot, {程度: "knows"}), {op: "set", at: {entry: hidden, path: "goal.为什么"}, value: "要为先帝报仇"}]});
        const result = brief(w, "ch4");
        expect(section(result, "decisions")).toContain(fixed.DECISION_ABOUT_SECRET);
        noLeak(result, "夺回先帝传下的王位", "他是先帝之弟", "要为先帝报仇", "王爷第十章回宫", "王爷");
    });

    test("第 5 条：同一段里他先后戴两个马甲：第二个马甲的简介（写着他是谁）也不给", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        const second = w.publish([{ref: {kind: "entry", id: "tmp:m2"}, after: {...drafts.person("tmp:m2", "黑衣人", {sameAs: lord}), init: {...drafts.person("tmp:m2", "黑衣人").init, summary: "黑衣人其实是王爷"}}}])["tmp:m2"]!;
        w.point("黑衣人就是王爷", lord, {保密: "topSecret", 揭穿: {ref: second}});
        w.change(chapter("ch4", 1), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}]});
        w.change(chapter("ch4", 2), {kind: "plan", text: "黑衣人出了酒馆", cast: [present(guard), {who: lord, as: second, role: "present"}]});
        noLeak(brief(w, "ch4"), "其实是王爷", "王爷");
    });

    test("第 6 条：这一场没戴的马甲被本章计划涉及：它的简介、正文（写着他是谁）也不给，本章计划改简介那一行也不写", () => {
        const w = new PlotWorld(CHAPTERS);
        const [lord, guard] = [w.person("王爷"), w.person("卫兵")];
        const draft = drafts.person("tmp:m", "灰袍客", {sameAs: lord});
        const mask = w.publish([{ref: {kind: "entry", id: "tmp:m"}, after: {...draft, init: {...draft.init, summary: "灰袍客其实是王爷", text: [{id: "b1", source: "他是先帝之弟。"}]}}}])["tmp:m"]!;
        w.point("灰袍客就是王爷", lord, {保密: "topSecret", 揭穿: {ref: mask}});
        w.change(chapter("ch4"), {kind: "plan", text: "张贴通缉", cast: [present(guard)], patches: [{op: "set", at: {entry: mask, path: "entry.summary"}, value: "灰袍客其实是王爷，已经金盆洗手"}]});
        const result = brief(w, "ch4");
        expect(section(result, "appearance")).toContain("灰袍客");
        noLeak(result, "其实是王爷", "先帝之弟", "王爷");
    });

    test("种子网 136 号：身份绝密的王爷名下另一个马甲（揭穿它只是普通档）的简介写着他是谁：这一场也不给", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        const draft = drafts.person("tmp:m2", "黑衣人", {sameAs: lord});
        const spare = w.publish([{ref: {kind: "entry", id: "tmp:m2"}, after: {...draft, init: {...draft.init, summary: "黑衣人其实是王爷"}}}])["tmp:m2"]!;
        w.point("黑衣人是个化名", lord, {保密: "common", 揭穿: {ref: spare}});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [{op: "set", at: {entry: spare, path: "entry.aliases"}, value: ["夜行人"]}]});
        noLeak(brief(w, "ch4"), "其实是王爷", "王爷");
    });
});

describe("brief 输出 16：实现审查（第三轮）的复现", () => {
    test("第 1、5 条：挂在他的目标上、挂在他的马甲条目上的决策：都只写占位", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        const plot = w.point("有人在查遗诏", lord, {保密: "secret"});
        const hidden = w.goal("找到先帝遗诏", lord, {隐秘: {ref: plot}});
        const plain = w.goal("铲除奸相", lord);
        w.decision("遗诏的下落", {about: [{kind: "entry", id: hidden}], conclusion: "王爷在第九章找到遗诏", reason: "留悬念"});
        w.decision("除奸的打算", {about: [{kind: "entry", id: plain}], conclusion: "王爷先拉拢卫兵", reason: "留悬念"});
        w.decision("马甲的用法", {about: [{kind: "entry", id: mask}], conclusion: "王爷扮的灰袍客只试探卫兵", reason: "留悬念"});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [addRow(lord, plot, {程度: "knows"})]});
        const result = brief(w, "ch4");
        noLeak(result, "王爷在第九章找到遗诏", "王爷先拉拢卫兵", "王爷扮的灰袍客只试探卫兵", "找到先帝遗诏", "铲除奸相", "王爷");
    });

    test("第 2 条：别人的隐秘目标与他的目标冲突、物件的引用字段指向他的目标：都不写他的目标名，也不加落空的指向", () => {
        const w = new PlotWorld(CHAPTERS, [EXTRA]);
        const [lord, guard, minister] = [w.person("王爷"), w.person("卫兵"), w.person("奸相")];
        const mask = w.person("灰袍客", {sameAs: lord});
        w.point("灰袍客就是王爷", lord, {保密: "topSecret", 揭穿: {ref: mask}});
        const target = w.goal("铲除奸相", lord);
        const scheme = w.point("奸相想篡位", minister, {保密: "secret"});
        w.goal("篡位", minister, {隐秘: {ref: scheme}, 冲突: [{id: target}]});
        const draft = drafts.thing("tmp:t", "密信");
        const ext = {type: EXTRA.id, version: 1, enabled: true, fields: {指向: {ref: target}, 清单: [], 图: null, 关系: []}};
        const thing = w.publish([{ref: {kind: "entry", id: "tmp:t"}, after: {...draft, init: {...draft.init, data: {...draft.init.data, ext}}}}])["tmp:t"]!;
        w.change(chapter("ch4"), {kind: "plan", text: "密信落地", cast: [present(guard), present(minister), {who: lord, as: mask, role: "present"}], patches: [addRow(minister, scheme, {程度: "knows"}), setState(thing, "落地")]});
        const result = brief(w, "ch4");
        expect(section(result, "appearance")).toContain(`指向：${fixed.hiddenGoalOf("灰袍客")}`);
        expect(result.text).not.toContain(`${fixed.hiddenGoalOf("灰袍客")}，见这一场的秘密`);
        noLeak(result, "铲除奸相", "王爷");
    });

    test("第 3 条：身份给了写手、卫兵不认得他：本章计划整张换掉卫兵的态度表，对王爷那一行不写", () => {
        const {w, lord, guard, mask} = lordInDisguise("secret");
        w.change(chapter("ch4"), {kind: "plan", text: "卫兵改口", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [{op: "set", at: {entry: guard, path: "att.态度"}, value: [{id: lord, 态度: "敬畏", 称呼: "主公"}]}]});
        const plan = section(brief(w, "ch4"), "plan");
        for (const word of ["殿下", "主公", "敬畏"]) expect(plan).not.toContain(word);
    });

    test("第 4 条：别的条目的正文写到身份不给写手的他（<Ref> 或以他为键的行）：那一块整块扣下", () => {
        const w = new PlotWorld(CHAPTERS, [EXTRA]);
        const [lord, guard] = [w.person("王爷"), w.person("卫兵")];
        const mask = w.person("灰袍客", {sameAs: lord});
        w.point("灰袍客就是王爷", lord, {保密: "topSecret", 揭穿: {ref: mask}});
        const draft = drafts.thing("tmp:t", "玉佩");
        const ext = {type: EXTRA.id, version: 1, enabled: true, fields: {指向: null, 清单: [], 图: null, 关系: [{id: lord, 说法: "夫君"}]}};
        const thing = w.publish([{ref: {kind: "entry", id: "tmp:t"}, after: {...draft, init: {...draft.init, text: [{id: "b1", source: `<Ref id="${lord}" />的贴身之物，先帝亲赐给弟弟。`}, {id: "b2", source: "主人：<V of=\"ext.关系\" />。"}, {id: "b3", source: "玉色温润。"}], data: {...draft.init.data, ext}}}}])["tmp:t"]!;
        w.change(chapter("ch4"), {kind: "plan", text: "玉佩落地", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [setState(thing, "落地")]});
        const result = brief(w, "ch4");
        const appearance = section(result, "appearance");
        expect(appearance.split(fixed.WITHHELD_BLOCK).length - 1).toBe(2);
        expect(appearance).toContain("玉色温润。");
        noLeak(result, "先帝亲赐给弟弟", "夫君", "王爷");
    });

    test("第 8 条：他名下另一个马甲、揭穿它的只是普通档：那条揭穿的名字也不写", () => {
        const {w, lord, guard, mask} = lordInDisguise();
        const spare = w.person("黑衣人", {sameAs: lord});
        const plain = w.point("黑衣人就是王爷", lord, {保密: "common", 揭穿: {ref: spare}});
        w.change(chapter("ch4"), {kind: "plan", text: "灰袍客进了酒馆", cast: [present(guard), {who: lord, as: mask, role: "present"}], patches: [addRow(guard, plain, {程度: "suspects"})]});
        noLeak(brief(w, "ch4"), "黑衣人就是王爷", "王爷");
    });
});
