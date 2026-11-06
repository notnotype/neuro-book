import {describe, expect, test} from "bun:test";

import {COMPONENT_IDS, MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {addRow, chapter, drafts, PlotWorld, present} from "../../testing/world";
import {composeBrief, type BriefInput, type BriefResult} from "./index";
import * as fixed from "./fixed";

const CHAPTERS = Array.from({length: 20}, (_, index) => `ch${String(index + 1)}`);
const digest = (text: string) => `sha:${String(text.length)}:${text.slice(0, 8)}`;
const instruction = (chapterId: string, extra: Partial<InstructionSnapshot> = {}): InstructionSnapshot => ({chapter: chapterId, version: "v1", ...extra});
function brief(w: PlotWorld, chapterId: string, extra: Partial<BriefInput> = {}): BriefResult {
    const result = composeBrief({view: w.view(), chapter: chapterId, outline: "细纲：卫兵盘问", targetWords: 2000, pluginVersion: "test", digest, ...extra});
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
    test("给写手的集合按计划模式读：更早没兑现的计划把知识点升成保密，主体不在正文里，简报仍列它与挂在它上面的约束", () => {
        const w = new PlotWorld(CHAPTERS);
        const [hero, guard] = [w.person("勇者"), w.person("卫兵")];
        const k = w.point("勇者左手有星形的疤", hero, {保密: "common"});
        w.decision("疤的事", {about: [{kind: "entry", id: k}], conclusion: "这章不写明", constraints: ["不得写明疤在左手"]});
        w.change(chapter("ch3"), {kind: "plan", patches: [{op: "set", at: {entry: k, path: "point.保密"}, value: "secret"}]});
        w.change(chapter("ch8"), {kind: "plan", cast: [present(hero), present(guard)]});
        const result = brief(w, "ch8");
        expect(JSON.stringify(result.parts)).toContain("不得写明疤在左手");
    });

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

    test("上一章末尾取自正文快照：最后 600 个码点，不进“已省略”；第一章、上一章是空的或取不到时写“无”", () => {
        const w = new PlotWorld(CHAPTERS);
        w.texts.set("ch1", `  ${"前".repeat(50)}\n${"尾".repeat(600)}  \n`);
        const second = brief(w, "ch2");
        const tail = second.common.find((part) => part.key === "previous")!.items[0]!.text;
        expect(tail).toBe("尾".repeat(600));
        expect(second.record.omitted).toEqual([]);
        expect(second.record.previousDigest).toBe(digest(tail));
        for (const [chapterId, text] of [["ch1", "没有上一章也不读它"], ["ch2", "   \n"]] as const) {
            if (chapterId === "ch2") w.texts.set("ch1", text);
            const result = brief(w, chapterId);
            expect(result.common.find((part) => part.key === "previous")!.items).toEqual([]);
            expect(result.record.previousDigest).toBeNull();
        }
        w.texts.delete("ch1");
        expect(brief(w, "ch2").record.previousDigest).toBeNull();
    });

    test("计划上的场景条件照抄；写作指示有结尾时加一句；同样的输入再拼一次逐字相同；只改细纲、目标字数或上一章末尾，记录就不同", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        w.change(chapter("ch5"), {kind: "plan", text: "星瑾进门", cast: [{who: jin, role: "present"}], marks: [{kind: MARK_IDS.scene, version: 1, lines: ["黄昏，屋里没点灯", "桌上有半杯茶"]}]});
        w.texts.set("ch4", "她回头看了一眼。\n");
        const extra = {instruction: instruction("ch5", {ending: "她把门关上"})};
        const first = brief(w, "ch5", extra);
        expect(section(first, "scene")).toBe("黄昏，屋里没点灯\n桌上有半杯茶");
        expect(section(first, "allowed")).toContain(fixed.ending("她把门关上"));
        expect(brief(w, "ch5", extra).text).toBe(first.text);
        expect(brief(w, "ch5", {...extra, outline: "另一份细纲"}).record).not.toEqual(first.record);
        expect(brief(w, "ch5", {...extra, targetWords: 3000}).record).not.toEqual(first.record);
        expect(first.text).toContain("她回头看了一眼。");
        w.texts.set("ch4", "她没回头。");
        expect(brief(w, "ch5", extra).record).not.toEqual(first.record);
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

const setState = (thing: string, value: string) => ({op: "set" as const, at: {entry: thing, path: "character.状态"}, value});

describe("plot.brief 验收 5：回溯章", () => {
    test("第 8 章前 29 段讲主线、第 30 段起讲回溯线：两份简报各标“回溯前”“回溯后”，涉及条目的样子各读各的线；写作指示、细纲、通则、上一章末尾只写一次", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const thing = w.thing("怀表");
        w.change(chapter("ch6"), {patches: [setState(thing, "走得很慢")]});
        const cut = w.change(chapter("ch7", 10));
        w.change(chapter("ch7", 20), {patches: [setState(thing, "停了")]});
        w.change(chapter("ch8"), {kind: "plan", text: "星瑾看表", cast: [{who: jin, role: "present"}], patches: [setState(thing, "又被拨动了")]});
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch7", 90)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, type: "branch"}}}]);
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line: "main", from: 1}, {line: ids["tmp:r1"]!, from: 30}]]])});
        w.texts.set("ch7", "上一章的末尾。");
        const result = brief(w, "ch8", {instruction: instruction("ch8", {tone: "冷"})});
        expect(result.parts.map((part) => part.label)).toEqual(["回溯前", "回溯后"]);
        expect(section(result, "appearance", 0)).toContain("停了");
        expect(section(result, "appearance", 1)).toContain("走得很慢");
        expect(section(result, "appearance", 1)).not.toContain("停了");
        expect(result.text.split("上一章的末尾。").length - 1).toBe(1);
        expect(result.text.split(`## ${fixed.TITLES.instruction}`).length - 1).toBe(1);
        expect(result.text.split(fixed.RULES[0]).length - 1).toBe(1);
        expect(result.text).toContain("# 回溯前");
        expect(result.text).toContain("# 回溯后");
    });
});

describe("plot.brief 验收 6、7：一条决策挂两个秘密；绝密的隐秘目标", () => {
    test("决策挂在保密 K1 与绝密 K2（本章不暗示）上：只在决策段写“有一条涉及保密设定的决定”，K1 那一项里没有原话；只挂 K1：原话写在 K1 那一项里一次", () => {
        const w = new PlotWorld(CHAPTERS);
        const [butler] = [w.person("管家")];
        const k1 = w.point("管家欠了债", butler, {保密: "secret"});
        const k2 = w.point("管家是凶手", butler, {保密: "topSecret"});
        w.change(chapter("ch16"), {kind: "plan", text: "管家端茶", cast: [{who: butler, role: "present"}]});
        w.decision("管家的事别点破", {about: [{kind: "entry", id: k1}, {kind: "entry", id: k2}], conclusion: "只给暗示"});
        const both = brief(w, "ch16");
        expect(section(both, "decisions")).toBe(fixed.DECISION_ABOUT_SECRET);
        expect(section(both, "secrets")).not.toContain("只给暗示");
        const w2 = new PlotWorld(CHAPTERS);
        const butler2 = w2.person("管家");
        const only = w2.point("管家欠了债", butler2, {保密: "secret"});
        w2.change(chapter("ch16"), {kind: "plan", text: "管家端茶", cast: [{who: butler2, role: "present"}]});
        w2.decision("管家的事别点破", {about: [{kind: "entry", id: only}], conclusion: "只给暗示"});
        const single = brief(w2, "ch16");
        expect(section(single, "secrets").split("只给暗示").length - 1).toBe(1);
        expect(section(single, "decisions")).toContain("见这一场的秘密");
    });

    test("管家的隐秘目标指向绝密的 K_G、本章不暗示：这一场的秘密里只有“管家另有一个不能写出的目标”，本章计划、在场的人、涉及条目里只有“管家的一个隐秘目标”，没有目标的名字与状态变化", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const kg = w.point("管家想继承爵位", butler, {保密: "topSecret"});
        w.change(chapter("ch3"), {patches: [addRow(butler, kg, {程度: "knows"})]});
        const goal = w.goal("毒死男爵继承爵位", butler, {隐秘: {ref: kg}});
        w.change(chapter("ch16"), {kind: "plan", text: "管家端茶", cast: [{who: butler, role: "present"}], patches: [{op: "set", at: {entry: goal, path: "goal.状态"}, value: "blocked"}]});
        const result = brief(w, "ch16");
        expect(section(result, "secrets")).toContain(fixed.holderUnwritableGoal("管家"));
        for (const key of ["plan", "people", "appearance"]) {
            const text = section(result, key);
            expect(text).not.toContain("毒死男爵继承爵位");
            expect(text).not.toContain("blocked");
        }
        expect(section(result, "plan")).toContain(fixed.hiddenGoalOf("管家"));
        expect(section(result, "people")).toContain(fixed.hiddenGoalOf("管家"));
        expect(result.text).not.toContain("毒死男爵");
    });
});

describe("plot.brief 输出 7、8、10：称谓、伏笔、读者已知", () => {
    test("称谓的顺序：态度行的称呼最先；之后同时在场过且没用马甲的用名字；都没有用泛称；第三人称的视角不生成", () => {
        const w = new PlotWorld(CHAPTERS);
        const withAttitude = {init: {name: "星瑾", aliases: [], summary: "", text: [], data: {
            know: {type: COMPONENT_IDS.knowing, version: 1, enabled: true, fields: {知情: [], 听过的说法: null}},
            att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: []}},
        }}};
        const [jin, brother, stranger] = [w.person("星瑾", withAttitude), w.person("哥哥"), w.person("路人")];
        w.change(chapter("ch1"), {patches: [{op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: brother, 态度: "冷淡", 称呼: "阿哥"}}]});
        w.change(chapter("ch2"), {cast: [{who: jin, role: "present"}, {who: stranger, role: "present"}]});
        w.change(chapter("ch5"), {kind: "plan", text: "三人一起", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}, {who: stranger, role: "present"}, {label: "挑夫", role: "present"}]});
        const result = brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}, povMode: "first"})});
        const rows = section(result, "address");
        expect(rows).toContain("阿哥 = 哥哥");
        expect(rows).toContain("路人 = 路人");
        expect(rows).toContain("挑夫 = 挑夫");
        const omniscient = brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}, povMode: "omniscient"})});
        expect(section(omniscient, "address")).toBe("");
    });

    test("伏笔：回收节点的伏笔答案是保密以上而本章没有揭示：不给主文字，写“回收方式按细纲写”并给提示；有揭示就给", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const answer = w.point("管家是凶手", butler, {保密: "secret"});
        const fs = w.foreshadow("谁杀了男爵", {种类: "mystery", 答案: {ref: answer}});
        const node = (role: string) => ({kind: MARK_IDS.node, version: 1, foreshadow: fs, role});
        w.change(chapter("ch15"), {kind: "plan", text: "揭晓", cast: [{who: butler, role: "present"}], told: [{source: "outline", chapter: "ch15", anchor: "揭晓凶手", marks: [node("payoff")]}]});
        const withheld = brief(w, "ch15");
        expect(section(withheld, "foreshadow")).toContain(fixed.PAYOFF_BY_OUTLINE);
        expect(withheld.hints.map((hint) => hint.code)).toContain("nbook.plot.brief.payoffWithheld");
        const w2 = new PlotWorld(CHAPTERS);
        const butler2 = w2.person("管家");
        const answer2 = w2.point("管家是凶手", butler2, {保密: "secret"});
        const fsDraft = drafts.foreshadow("tmp:fs2", "谁杀了男爵", {种类: "mystery", 答案: {ref: answer2}});
        const fs2 = w2.publish([{ref: {kind: "entry", id: "tmp:fs2"}, after: {...fsDraft, init: {...fsDraft.init, summary: "一句话描述", text: [{id: "b1", source: "怀表停在案发那一刻"}]}}}])["tmp:fs2"]!;
        w2.change(chapter("ch15"), {kind: "plan", text: "揭晓", cast: [{who: butler2, role: "present"}], told: [{source: "outline", chapter: "ch15", anchor: "揭晓凶手", marks: [{kind: MARK_IDS.node, version: 1, foreshadow: fs2, role: "payoff"}, reveal(answer2, "explicit")]}]});
        const given = brief(w2, "ch15");
        expect(section(given, "foreshadow")).not.toContain(fixed.PAYOFF_BY_OUTLINE);
        // 给的是主文字（打算怎么回收），不是名字或一句话描述。
        expect(section(given, "foreshadow")).toContain("回收：怀表停在案发那一刻");
        expect(given.hints.map((hint) => hint.code)).not.toContain("nbook.plot.brief.payoffWithheld");
    });

    test("读者已知：本章涉及的知识点里读者在上一章末尾已经知道的；保密以上的只写这一场的秘密里那一项的名字", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const open = w.point("哥哥在查账", brother, {保密: "common"});
        const secret = w.point("哥哥能回溯", brother, {保密: "secret"});
        w.texts.set("ch3", "他在查账。哥哥其实能回溯。");
        w.change(chapter("ch3"), {told: [
            {source: "chapter", chapter: "ch3", quote: "他在查账", marks: [reveal(open, "explicit")]},
            {source: "chapter", chapter: "ch3", quote: "哥哥其实能回溯", marks: [reveal(secret, "explicit")]},
        ]});
        w.change(chapter("ch5"), {kind: "plan", text: "兄妹说话", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}], patches: [{op: "listAdd", at: {entry: jin, path: "know.知情"}, value: {id: open, 程度: "unaware"}}, {op: "listAdd", at: {entry: jin, path: "know.知情"}, value: {id: secret, 程度: "unaware"}}]});
        const result = brief(w, "ch5");
        const reader = section(result, "reader");
        expect(reader).toContain("读者已经知道：哥哥在查账");
        expect(reader).toContain("读者已经知道：（见这一场的秘密：哥哥能回溯）");
    });
});

describe("plot.brief 输出 10：第一章没有上一章", () => {
    test("第一章读者已知写“无”（没有上一章末尾可读）", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const open = w.point("哥哥在查账", brother, {保密: "common"});
        w.texts.set("ch1", "他在查账。");
        w.change(chapter("ch1"), {told: [{source: "chapter", chapter: "ch1", quote: "他在查账", marks: [reveal(open, "explicit")]}]});
        w.change(chapter("ch1", 50), {kind: "plan", text: "兄妹", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}], patches: [{op: "listAdd", at: {entry: jin, path: "know.知情"}, value: {id: open, 程度: "unaware"}}]});
        expect(brief(w, "ch1").text).toContain(`### ${fixed.BRIEF_PARTS.reader}\n${fixed.NONE}`);
    });
});

describe("plot.brief I5 审查之后：绝密不泄、知情变化、渲染同线、固定句", () => {
    /** 任何段、省略项与记录里都不能出现绝密知识点的名字。 */
    const noLeak = (result: BriefResult, secret: string) => {
        expect(result.text).not.toContain(secret);
        expect(JSON.stringify(result.record)).not.toContain(secret);
        expect(JSON.stringify(result.hints)).not.toContain(secret);
    };

    test("前文暗示过、本章不暗示的绝密：读者已知段、省略项、记录里都不出现名字；到期待定决策、没有主体的知识点、补丁改知识点本身、只被提到的持有者的隐秘目标也不泄", () => {
        const w = new PlotWorld(CHAPTERS);
        const [butler, maid] = [w.person("管家"), w.person("女仆")];
        const killer = w.point("管家是凶手", butler, {保密: "topSecret", 表现: "镇定"});
        const orphan = w.point("孤儿的秘密", null, {保密: "topSecret"});
        w.change(chapter("ch3"), {patches: [addRow(butler, killer, {程度: "knows"})]});
        w.texts.set("ch12", "他看了看杯子。");
        w.change(chapter("ch12"), {told: [{source: "chapter", chapter: "ch12", quote: "他看了看杯子", marks: [reveal(killer, "hint")]}]});
        const goal = w.goal("毒死男爵继承爵位", butler, {隐秘: {ref: killer}});
        w.decision("管家是凶手在哪章揭开", {about: [{kind: "entry", id: killer}], due: "ch15"});
        // 本章女仆在场，管家只被提到；计划改了绝密知识点自己的表现，也改了管家隐秘目标的状态。
        w.change(chapter("ch16"), {kind: "plan", text: "女仆收拾书房", cast: [{who: maid, role: "present"}, {who: butler, role: "mentioned"}], patches: [
            {op: "set", at: {entry: killer, path: "point.表现"}, value: "更镇定"},
            {op: "set", at: {entry: goal, path: "goal.状态"}, value: "blocked"},
            {op: "set", at: {entry: orphan, path: "point.表现"}, value: "x"},
        ]});
        const result = brief(w, "ch16", {limits: {reader: 1}});
        noLeak(result, "管家是凶手");
        noLeak(result, "毒死男爵");
        noLeak(result, "孤儿的秘密");
        expect(result.text).not.toContain("blocked");
        expect(section(result, "decisions")).toContain(fixed.DECISION_DUE_ABOUT_SECRET);
        // 不裁时读者已知段对这件绝密只写不含名字的固定句。
        const roomy = brief(w, "ch16");
        noLeak(roomy, "管家是凶手");
        expect(section(roomy, "reader")).toContain(fixed.READER_SEES_HIDDEN);
    });

    test("绝密的 `揭穿` 指向马甲、本章不暗示：称谓表与在场的人写马甲的名字，不写本名", () => {
        const w = new PlotWorld(CHAPTERS);
        const [guard, hero] = [w.person("卫兵"), w.person("勇者")];
        const mask = w.person("旅人", {sameAs: hero});
        w.point("旅人就是勇者", hero, {保密: "topSecret", 揭穿: {ref: mask}});
        w.change(chapter("ch4"), {kind: "plan", text: "卫兵盘问", cast: [{who: guard, role: "present"}, {who: hero, role: "present", as: mask}]});
        const result = brief(w, "ch4", {instruction: instruction("ch4", {pov: {kind: "entry", id: guard}, povMode: "limited"})});
        expect(section(result, "address")).toContain("旅人 = 旅人");
        expect(section(result, "people")).not.toContain("勇者");
    });

    test("计划里的知情变化写进本章计划（谁得知什么）；秘密段不给的知识点不写名字；同一地址改几次只写一行", () => {
        const w = new PlotWorld(CHAPTERS);
        const [guard, hero] = [w.person("卫兵"), w.person("勇者")];
        const trait = w.point("勇者有胎记", hero, {保密: "secret"});
        const gate = w.point("城门今晚关", null, {保密: "common"});
        const thing = w.thing("怀表");
        w.change(chapter("ch4"), {kind: "plan", text: "卫兵认出勇者", cast: [{who: guard, role: "present"}, {who: hero, role: "present"}], patches: [
            addRow(guard, trait, {程度: "knows", 怎么知道: "witnessed"}),
            addRow(hero, gate, {程度: "knows"}),
            {op: "set", at: {entry: thing, path: "character.状态"}, value: "走着"},
            {op: "set", at: {entry: thing, path: "character.状态"}, value: "停了"},
        ]});
        const lines = section(brief(w, "ch4"), "plan").split("\n");
        expect(lines).toContain(fixed.changeKnowing("卫兵", "勇者有胎记", "没有记录", "知道"));
        expect(lines).toContain(fixed.changeKnowing("勇者", "城门今晚关", "没有记录", "知道"));
        expect(lines.filter((line) => line.includes("怀表的"))).toEqual(["怀表的状态：原样 → 停了"]);
    });

    test("回溯后那份：条目的主文字与字段值出自同一条线", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const thing = w.thing("怀表");
        const stored = structuredClone(w.world.data.entries.get(thing)!);
        stored.init.text = [{id: "b1", source: "表的状态 {character.状态}"}];
        w.publish([{ref: {kind: "entry", id: thing}, after: stored}]);
        w.change(chapter("ch6"), {patches: [setState(thing, "走得很慢")]});
        const cut = w.change(chapter("ch7", 10));
        w.change(chapter("ch7", 20), {patches: [setState(thing, "停了")]});
        w.change(chapter("ch8"), {kind: "plan", text: "星瑾看表", cast: [{who: jin, role: "present"}], patches: [setState(thing, "又被拨动了")]});
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch7", 90)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, type: "branch"}}}]);
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line: "main", from: 1}, {line: ids["tmp:r1"]!, from: 30}]]])});
        const result = brief(w, "ch8");
        expect(section(result, "appearance", 1)).toContain("走得很慢");
        expect(section(result, "appearance", 1)).not.toContain("停了");
        expect(section(result, "appearance", 0)).toContain("停了");
    });

    test("固定句：其他人之间没有特别的态度、视角人物自己的秘密、不要点破、只能写到明说、另有一个目标见这一场的秘密、另有关于这件事的决定、只是怀疑", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother, sage] = [w.person("星瑾"), w.person("哥哥"), w.person("贤者")];
        const pointA = w.point("哥哥能回溯", brother, {保密: "secret"});
        const pointB = w.point("贤者欠了债", sage, {保密: "secret"});
        const hidden = w.point("星瑾想查哥哥", jin, {保密: "secret"});
        w.change(chapter("ch2"), {patches: [addRow(jin, pointA, {程度: "knows"}), addRow(brother, pointA, {程度: "knows"}), addRow(sage, pointA, {程度: "suspects"})]});
        w.goal("别让人知道她在查", jin, {隐秘: {ref: hidden}});
        const fs = w.foreshadow("信里的话");
        w.decision("两个秘密的决定", {about: [{kind: "entry", id: pointA}, {kind: "entry", id: pointB}], conclusion: "只暗示"});
        w.change(chapter("ch5"), {kind: "plan", text: "三人说话", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}, {who: sage, role: "present"}], told: [
            {source: "outline", chapter: "ch5", anchor: "点一下信", marks: [{kind: MARK_IDS.node, version: 1, foreshadow: fs, role: "echo"}]},
            {source: "outline", chapter: "ch5", anchor: "说破", marks: [reveal(pointA, "explicit"), reveal(pointB, "hint")]},
        ], patches: [addRow(jin, pointB, {程度: "unaware"})]});
        const result = brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}, povMode: "limited"})});
        const text = result.text;
        for (const line of [fixed.OTHERS_NO_ATTITUDE, fixed.POV_OWN_SECRET, fixed.DONT_BREAK, fixed.hiddenGoalSeeSecrets, fixed.otherDecisionSee("哥哥能回溯"), "只是怀疑"]) expect(text).toContain(line);
        expect(fixed.onlyWriteTo("explicit")).toBe("只能写到：明说");
    });

    test("秘密段与视角人物那一项不被裁（上限调到 1 也留着）；固定句整份只出现一次", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        w.point("哥哥能回溯", brother, {保密: "secret"});
        w.change(chapter("ch5"), {kind: "plan", text: "兄妹说话", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}]});
        const result = brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}}), limits: {secrets: 1, people: 1}});
        expect(section(result, "secrets")).toContain("哥哥能回溯");
        expect(section(result, "people").split("\n")).toContain("星瑾");
    });

    test("确定性：两份独立建出的世界（发布先后不同、内容相同）各拼一次逐字相同", () => {
        const build = (reverse: boolean) => {
            const w = new PlotWorld(CHAPTERS);
            const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
            const secret = w.point("哥哥能回溯", brother, {保密: "secret"});
            const steps = [
                () => w.change(chapter("ch3"), {patches: [addRow(brother, secret, {程度: "knows"})]}),
                () => w.change(chapter("ch5"), {kind: "plan", text: "兄妹说话", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}]}),
            ];
            for (const step of reverse ? [...steps].reverse() : steps) step();
            return brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}, povMode: "limited"})});
        };
        // 正式 id 按发布顺序发号，所以文字里出现 id 的地方（计划的标签）不同；比较去掉计划标签后的文字。
        const strip = (text: string) => text.replace(/\bc\d+\b/gu, "c");
        expect(strip(build(true).text)).toBe(strip(build(false).text));
    });
});

describe("plot.brief I5 omp 份：地址挂在绝密知识点上的决策走保密路由；目标顺序与发布批次无关", () => {
    test("决策挂在知识点的地址上：绝密未揭示时只写“有一条涉及保密设定的决定”，不直出原话", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const killer = w.point("管家是凶手", butler, {保密: "topSecret"});
        w.change(chapter("ch16"), {kind: "plan", text: "管家端茶", cast: [{who: butler, role: "present"}]});
        w.decision("别点破", {about: [{kind: "address", at: {entry: killer, path: "point.表现"}}], conclusion: "不要明说", reason: "保留悬念"});
        const result = brief(w, "ch16");
        expect(result.text).not.toContain("不要明说");
        expect(result.text).not.toContain("保留悬念");
        expect(section(result, "decisions")).toContain(fixed.DECISION_ABOUT_SECRET);
    });

    test("两个目标在同一次发布里谁先谁后，在场的人里目标的顺序一样", () => {
        const build = (swap: boolean) => {
            const w = new PlotWorld(CHAPTERS);
            const jin = w.person("星瑾");
            const goals: Array<[string, string]> = [["查出哥哥在瞒什么", "a"], ["躲开哥哥", "b"]];
            for (const [name] of swap ? [...goals].reverse() : goals) w.goal(name, jin);
            w.change(chapter("ch5"), {kind: "plan", text: "兄妹说话", cast: [{who: jin, role: "present"}]});
            return section(brief(w, "ch5"), "people");
        };
        expect(build(true)).toBe(build(false));
    });
});

describe("plot.brief 输出 2、4：本章计划与隐秘目标的写法", () => {
    test("态度表：改一行写成“某某对某某的态度”，增一行写成一件事，不把整张表写成 JSON", () => {
        const w = new PlotWorld(CHAPTERS);
        const brother = w.person("哥哥");
        const stranger = w.person("路人");
        const draft = drafts.person("tmp:j", "星瑾");
        const jin = w.publish([{ref: {kind: "entry", id: "tmp:j"}, after: {...draft, init: {...draft.init, data: {...draft.init.data, att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: []}}}}}}])["tmp:j"]!;
        w.change(chapter("ch3"), {patches: [{op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: brother, 态度: "冷淡"}}]});
        w.change(chapter("ch4"), {kind: "plan", text: "松动", cast: [{who: jin, role: "present"}], patches: [{op: "note", at: {entry: jin, path: `att.态度[${brother}].态度`}, value: "略松动"}]});
        w.change(chapter("ch4", 20), {kind: "plan", text: "认识路人", cast: [{who: jin, role: "present"}], patches: [{op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: stranger, 态度: "戒备"}}]});
        const plan = section(brief(w, "ch4"), "plan");
        expect(plan).toContain("星瑾对哥哥的态度：冷淡 → ");
        expect(plan).toContain("星瑾的态度：加上路人（态度：戒备）");
        expect(plan).not.toContain('"id"');
    });

    test("表现形式之外的隐秘目标：名字、为什么与冲突都写在它指向的知识点那一项里", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const hero = w.person("勇者");
        const k = w.point("管家想继承爵位", butler, {保密: "secret"});
        w.change(chapter("ch3"), {patches: [addRow(butler, k, {程度: "knows"})]});
        const goal = w.goal("继承爵位", butler, {隐秘: {ref: k}, 为什么: "他等了二十年"});
        w.goal("保住男爵", hero, {冲突: [{id: goal}]});
        w.change(chapter("ch4"), {kind: "plan", text: "管家端茶", cast: [{who: butler, role: "present"}]});
        const secrets = section(brief(w, "ch4"), "secrets");
        expect(secrets).toContain("管家的隐秘目标：继承爵位；为什么：他等了二十年；冲突：保住男爵");
    });
});

describe("plot.brief 晋升前补的用例：读哪个位置、在场的人、称谓、伏笔、决策、涉及条目", () => {
    const attitudePerson = (w: PlotWorld, name: string) => {
        const draft = drafts.person(`tmp:att-${name}`, name);
        return w.publish([{ref: {kind: "entry", id: draft.id}, after: {...draft, init: {...draft.init, data: {...draft.init.data, att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: []}}}}}}])[draft.id]!;
    };

    test("输出 2、14：写作指示的时间方式是补叙某处安放时，涉及条目的样子读那一章章首，不读本章", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const thing = w.thing("怀表");
        w.change(chapter("ch3"), {patches: [setState(thing, "走得很慢")]});
        w.change(chapter("ch6"), {patches: [setState(thing, "停了")]});
        w.change(chapter("ch10"), {kind: "plan", text: "星瑾看表", cast: [{who: jin, role: "present"}], patches: [setState(thing, "又被拨动了")]});
        const now = brief(w, "ch10");
        expect(section(now, "appearance")).toContain("停了");
        const back = brief(w, "ch10", {instruction: instruction("ch10", {timeMode: {flashback: {kind: "chapter", chapter: "ch5", key: 0}}})});
        expect(section(back, "appearance")).toContain("走得很慢");
        expect(section(back, "appearance")).not.toContain("停了");
    });

    test("验收 5：回溯后那份里，没有带过去的值是切口处的，带过去的值是父线在触发处的；回溯前那份读父线", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, xia] = [w.person("星瑾"), w.person("星瑕")];
        const savings = w.thing("存款");
        const counter = w.thing("回溯次数");
        w.change(chapter("ch6"), {patches: [setState(savings, "20000"), setState(counter, "剩 1 次")]});
        const cut = w.change(chapter("ch7", 10));
        w.change(chapter("ch7", 20), {patches: [setState(savings, "15000"), setState(counter, "剩 0 次")]});
        const trigger = w.change(chapter("ch7", 50));
        w.change(chapter("ch8"), {kind: "plan", text: "星瑾看账", cast: [{who: jin, role: "present"}], patches: [setState(savings, "13000"), setState(counter, "剩 0 次，又被用掉")]});
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch7", 90)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, trigger, type: "rollback", who: xia, carry: [{entry: counter, path: "character.状态"}]}}}]);
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line: "main", from: 1}, {line: ids["tmp:r1"]!, from: 30}]]])});
        const result = brief(w, "ch8");
        const [before, after] = [section(result, "appearance", 0), section(result, "appearance", 1)];
        expect(before).toContain("character.状态：15000");
        expect(before).toContain("character.状态：剩 0 次");
        expect(after).toContain("character.状态：20000");
        expect(after).not.toContain("15000");
        // 回溯次数带过去：子线上是父线在触发处的值，不是切口处的“剩 1 次”。
        expect(after).toContain("character.状态：剩 0 次");
        expect(after).not.toContain("剩 1 次");
    });

    test("输出 5：在场的人每人一项，写进行或受挫的普通目标（带为什么）；态度只列两人都在本章计划的参与者或涉及条目里的对子，别的不列", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = attitudePerson(w, "星瑾");
        const [brother, passerby] = [w.person("哥哥"), w.person("路人")];
        const watch = w.thing("怀表");
        w.goal("查出哥哥在瞒什么", jin, {为什么: "怕他出事"});
        w.goal("躲开哥哥", jin, {状态: "blocked"});
        w.goal("已经办成的事", jin, {状态: "achieved"});
        w.change(chapter("ch1"), {patches: [
            {op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: brother, 态度: "冷淡"}},
            {op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: watch, 态度: "舍不得"}},
            {op: "listAdd", at: {entry: jin, path: "att.态度"}, value: {id: passerby, 态度: "戒备"}},
        ]});
        w.change(chapter("ch5"), {kind: "plan", text: "兄妹看表", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}], patches: [setState(watch, "停了")]});
        const people = section(brief(w, "ch5"), "people");
        expect(people).toContain("目标：查出哥哥在瞒什么（怕他出事）");
        expect(people).toContain("目标：躲开哥哥，受挫");
        expect(people).not.toContain("已经办成的事");
        expect(people).toContain("对哥哥的态度：冷淡");
        expect(people).toContain("对怀表的态度：舍不得");
        expect(people).not.toContain("路人");
        expect(people).not.toContain("戒备");
    });

    test("输出 7：之前只和用着马甲的人同时在场过，用最近一次他用的马甲的名字", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, hero] = [w.person("星瑾"), w.person("勇者")];
        const [first, second] = [w.person("旅人", {sameAs: hero}), w.person("黑衣人", {sameAs: hero})];
        w.change(chapter("ch2"), {cast: [{who: jin, role: "present"}, {who: hero, role: "present", as: first}]});
        w.change(chapter("ch3"), {cast: [{who: jin, role: "present"}, {who: hero, role: "present", as: second}]});
        w.change(chapter("ch5"), {kind: "plan", text: "再见", cast: [{who: jin, role: "present"}, {who: hero, role: "present"}]});
        const rows = section(brief(w, "ch5", {instruction: instruction("ch5", {pov: {kind: "entry", id: jin}, povMode: "first"})}), "address");
        expect(rows).toContain("黑衣人 = 勇者");
        expect(rows).not.toContain("旅人 = ");
        expect(rows).not.toContain("一个陌生人");
    });

    test("输出 8：依赖的物件出现在本章计划里的伏笔也列出（没有节点时只给名字）；物件不在本章计划里的不列", () => {
        const w = new PlotWorld(CHAPTERS);
        const [clock, lamp] = [w.thing("那座钟"), w.thing("那盏灯")];
        w.foreshadow("钟慢了一刻", {物件: [{id: clock}]});
        w.foreshadow("灯会灭", {物件: [{id: lamp}]});
        w.change(chapter("ch5"), {kind: "plan", text: "有人拨钟", patches: [setState(clock, "拨回正点")]});
        const items = brief(w, "ch5").parts[0]!.sections.find((s) => s.key === "foreshadow")!.items;
        expect(items.map((item) => item.text)).toEqual(["钟慢了一刻"]);
    });

    test("输出 9：不挂保密知识点、到期的待定决策写“待定（到期）：原话”；没到期的、已定的不在这一条里", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        w.change(chapter("ch5"), {kind: "plan", text: "星瑾出场", cast: [{who: jin, role: "present"}]});
        w.decision("星瑾要不要原谅哥哥", {about: [{kind: "entry", id: jin}], due: "ch5"});
        w.decision("哥哥何时回来", {about: [{kind: "entry", id: jin}], due: "ch9"});
        const decisions = section(brief(w, "ch5"), "decisions");
        expect(decisions).toContain("待定（到期）：星瑾要不要原谅哥哥");
        expect(decisions).not.toContain("哥哥何时回来");
    });

    test("输出 13：涉及条目的样子去掉 know 命名空间，挂在它们下面的知识点也不在这里；别的命名空间照常渲染", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const thing = w.thing("怀表");
        const k = w.point("哥哥能回溯", brother, {保密: "common"});
        w.change(chapter("ch5"), {kind: "plan", text: "兄妹说话", cast: [{who: jin, role: "present"}, {who: brother, role: "present"}], patches: [addRow(jin, k, {程度: "knows"}), setState(thing, "停了")]});
        const appearance = section(brief(w, "ch5"), "appearance");
        // 简报读本章开头，计划还没发生：物件是原样。人物的条目在，但没有知情的那一段。
        expect(appearance.split("\n").sort()).toEqual(["星瑾", "哥哥", "怀表", "character.状态：原样"].sort());
        expect(appearance).not.toContain("know.");
        expect(appearance).not.toContain("知情");
        expect(appearance).not.toContain("哥哥能回溯");
    });
});

describe("plot.brief 输出 2、4：本章计划里引到的条目不漏", () => {
    test("公开目标的冲突列表加上一个绝密的隐秘目标：只写“某某的一个隐秘目标”，不写它的名字", () => {
        const w = new PlotWorld(CHAPTERS);
        const butler = w.person("管家");
        const hero = w.person("勇者");
        const k = w.point("管家想继承爵位", butler, {保密: "topSecret"});
        w.change(chapter("ch3"), {patches: [addRow(butler, k, {程度: "knows"})]});
        const hidden = w.goal("毒死男爵继承爵位", butler, {隐秘: {ref: k}});
        const open = w.goal("保护男爵", hero);
        w.change(chapter("ch4"), {kind: "plan", text: "勇者起疑", cast: [{who: butler, role: "present"}, {who: hero, role: "present"}], patches: [{op: "listAdd", at: {entry: open, path: "goal.冲突"}, value: {id: hidden}}]});
        const result = brief(w, "ch4");
        expect(result.text).not.toContain("毒死男爵");
        expect(section(result, "plan")).toContain(fixed.hiddenGoalOf("管家"));
    });

    test("整段写一个引用列表：写名字，不写条目 id；绝密知识点只写“一件不便写出的事”这类占位", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const secret = w.point("勇者是王子", hero, {保密: "topSecret"});
        const open = w.point("城门今晚关", null);
        const goal = w.goal("公开目标", hero);
        w.change(chapter("ch2"), {kind: "plan", text: "计划", cast: [{who: hero, role: "present"}], patches: [{op: "set", at: {entry: goal, path: "goal.基于"}, value: [{id: secret}, {id: open}]}]});
        const plan = section(brief(w, "ch2"), "plan");
        expect(plan).toContain("城门今晚关");
        expect(plan).not.toContain(secret);
        expect(plan).not.toContain("勇者是王子");
    });
});
