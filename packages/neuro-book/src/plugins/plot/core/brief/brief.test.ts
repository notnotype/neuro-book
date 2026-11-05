import {describe, expect, test} from "bun:test";

import {MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {addRow, chapter, PlotWorld} from "../../testing/world";
import {composeBrief, type BriefInput, type BriefResult} from "./index";
import * as fixed from "./fixed";

const CHAPTERS = Array.from({length: 20}, (_, index) => `ch${String(index + 1)}`);
const digest = (text: string) => `sha:${String(text.length)}:${text.slice(0, 8)}`;
const instruction = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});
function brief(w: PlotWorld, chapterId: string, extra: Partial<BriefInput> = {}): BriefResult {
    const result = composeBrief({view: w.view(), chapter: chapterId, outline: "细纲：卫兵盘问", targetWords: 2000, previousTail: null, pluginVersion: "test", digest, ...extra});
    if (typeof result === "string") throw new Error(result);
    return result;
}
const section = (result: BriefResult, key: string, part = 0) => result.parts[part]!.sections.find((s) => s.key === key)!.items.map((item) => item.text).join("\n");
const reveal = (point: string, mode: "hint" | "explicit") => ({kind: MARK_IDS.reveal, version: 1, point, mode});

describe("plot.brief 验收 1：卫兵那一场", () => {
    test("视角人物是卫兵、在场的是卫兵与戴兜帽的勇者（马甲旅人）、勇者特征是保密档：这一场的秘密里有它，写手知道、不知道的卫兵；称谓表里勇者写成旅人；在场的人一段的段首是固定句；别的段只提名字", () => {
        const w = new PlotWorld(CHAPTERS);
        const [guard, hero] = [w.person("卫兵"), w.person("勇者")];
        const mask = w.person("旅人", {sameAs: hero});
        const trait = w.point("勇者特征", hero, {保密: "secret"});
        w.change(chapter("ch2"), {patches: [addRow(hero, trait, {程度: "knows"})]});
        w.change(chapter("ch4"), {kind: "plan", text: "卫兵盘问戴兜帽的人", cast: [{who: guard, role: "present"}, {who: hero, role: "present", as: mask}]});
        const result = brief(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        const secrets = section(result, "secrets");
        expect(secrets).toContain("勇者特征");
        expect(secrets).toContain("写手知道；知道的：勇者；不知道的：卫兵；误信的：无");
        expect(section(result, "address")).toContain("旅人 = 勇者");
        expect(section(result, "address")).toContain(fixed.ADDRESS_FOOTER);
        expect(result.parts[0]!.sections.find((s) => s.key === "people")!.items[0]!.text).toBe(fixed.PEOPLE_HEADER);
        expect(section(result, "people").split("\n")[1]).toBe("卫兵");
        // 秘密的内容只在这一场的秘密里：别的段不复述。
        for (const key of ["plan", "people", "foreshadow", "decisions", "reader"]) expect(section(result, key)).not.toContain("勇者特征");
        expect(result.text).toContain(`## ${fixed.TITLES.brief}`);
    });
});

describe("plot.brief 验收 2、3：绝密的持有者", () => {
    function manor() {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const killer = w.point("管家是凶手", butler, {保密: "topSecret", 表现: "镇定，回避书房的话题"});
        w.change(chapter("ch3"), {patches: [addRow(butler, killer, {程度: "knows"})]});
        const decision = w.decision("管家的反应", {about: [{kind: "entry", id: killer}], conclusion: "不让别人看出来", reason: "留悬念"});
        void decision;
        return {w, butler, killer};
    }

    test("管家在场、本章不暗示：这一场的秘密里只有“有一件涉及管家的绝密设定”与他在人前的表现；决策只写“有一条涉及保密设定的决定”；第 18 章计划暗示它：给真相，加“只能写到：暗示”", () => {
        const {w, butler, killer} = manor();
        w.change(chapter("ch16"), {kind: "plan", text: "管家端茶", cast: [{who: butler, role: "present"}]});
        const quiet = brief(w, "ch16");
        const secrets = section(quiet, "secrets");
        expect(secrets).toContain("有一件涉及管家的绝密设定");
        expect(secrets).toContain("管家在人前的表现：镇定，回避书房的话题");
        expect(secrets).not.toContain("管家是凶手");
        expect(section(quiet, "decisions")).toContain(fixed.DECISION_ABOUT_SECRET);
        expect(quiet.text).not.toContain("留悬念");
        w.change(chapter("ch18"), {kind: "plan", text: "管家失言", cast: [{who: butler, role: "present"}], told: [{source: "outline", chapter: "ch18", anchor: "管家失言", marks: [reveal(killer, "hint")]}]});
        const hinted = brief(w, "ch18");
        expect(section(hinted, "secrets")).toContain("管家是凶手");
        expect(section(hinted, "secrets")).toContain("只能写到：暗示");
        // 决策原话写在那一项里一次。
        expect(section(hinted, "secrets")).toContain("不让别人看出来");
        expect(section(hinted, "decisions")).not.toContain("不让别人看出来");
    });

    test("绝密的表现没写：写“（作者没写在人前的表现）”并给提示；视角人物是持有者时只给表现，加“叙述不写他想到这件事”", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const killer = w.point("管家是凶手", butler, {保密: "topSecret"});
        w.change(chapter("ch3"), {patches: [addRow(butler, killer, {程度: "knows"})]});
        w.change(chapter("ch16"), {kind: "plan", text: "管家端茶", cast: [{who: butler, role: "present"}]});
        const result = brief(w, "ch16", {instruction: instruction("ch16", {pov: {kind: "entry", id: butler}, povMode: "limited"})});
        expect(section(result, "secrets")).toContain(fixed.NO_PRESENTATION);
        expect(section(result, "secrets")).toContain(fixed.POV_NOT_THINK);
        expect(result.hints.map((hint) => hint.code)).toContain("nbook.plot.brief.noPresentation");
    });
});

describe("plot.brief 输出 1、6、11、12、15：组成、场景条件、固定句、裁剪与记录", () => {
    test("没有内容的段写“无”；上一章不存在时那一段写“无”；场景条件都没有时给固定句和提示；通则、允许新增、自陈是固定句", () => {
        const w = new PlotWorld(CHAPTERS);
        w.person("星瑾");
        const result = brief(w, "ch1");
        expect(result.text).toContain(`## ${fixed.TITLES.previous}\n${fixed.NONE}`);
        expect(result.text).toContain(`### ${fixed.BRIEF_PARTS.secrets}\n${fixed.NONE}`);
        expect(section(result, "scene")).toBe(fixed.SCENE_MISSING);
        expect(result.hints).toContainEqual({code: "nbook.plot.brief.noSceneConditions", range: {from: "ch1", to: "ch1"}});
        for (const line of [...fixed.RULES, ...fixed.ALLOWED, fixed.SELF_REPORT]) expect(result.text).toContain(line);
        expect(result.text.split(fixed.RULES[0]).length - 1).toBe(1);
    });

    test("计划上的场景条件照抄；写作指示有结尾时加一句；同样的输入再拼一次逐字相同；只改细纲、目标字数或上一章末尾，记录就不同", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        w.change(chapter("ch5"), {kind: "plan", text: "星瑾进门", cast: [{who: jin, role: "present"}], marks: [{kind: MARK_IDS.scene, version: 1, lines: ["黄昏，屋里没点灯", "桌上有半杯茶"]}]});
        const extra = {instruction: instruction("ch5", {ending: "她把门关上"}), previousTail: "她回头看了一眼。"};
        const first = brief(w, "ch5", extra);
        expect(section(first, "scene")).toBe("黄昏，屋里没点灯\n桌上有半杯茶");
        expect(section(first, "allowed")).toContain(fixed.ending("她把门关上"));
        expect(brief(w, "ch5", extra).text).toBe(first.text);
        expect(brief(w, "ch5", {...extra, outline: "另一份细纲"}).record).not.toEqual(first.record);
        expect(brief(w, "ch5", {...extra, targetWords: 3000}).record).not.toEqual(first.record);
        expect(brief(w, "ch5", {...extra, previousTail: "她没回头。"}).record).not.toEqual(first.record);
        expect(first.record).toMatchObject({instructionVersion: "v1", targetWords: 2000, pluginVersion: "test"});
    });

    test("涉及条目的样子的上限调到 100：裁掉的条目列在“已省略”里，这一场的秘密与视角人物那一项不受影响", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const things = ["一块走得很慢很慢很慢的旧怀表", "一封没有拆开也没有署名的旧信", "一把锈得拧不动锁孔的黄铜钥匙"].map((name) => w.thing(name.repeat(2)));
        w.change(chapter("ch5"), {kind: "plan", text: "整理东西", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}], patches: things.map((thing) => ({op: "set" as const, at: {entry: thing, path: "character.状态"}, value: "一件很长很长很长很长很长很长的东西".repeat(8)}))});
        const full = brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}})});
        const small = brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}}), limits: {appearance: 100}});
        expect(small.record.omitted.length).toBeGreaterThan(0);
        expect(small.text).toContain(fixed.omitted(small.record.omitted));
        expect(full.record.omitted).toEqual([]);
        expect(section(small, "people").split("\n")).toContain("星瑾");
        expect(brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}}), limits: {appearance: 100}}).text).toBe(small.text);
    });
});
