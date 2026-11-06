/**
 * 依赖的摘要“只能多算不能漏”（docs/specs/plot/checks.md 输出 7）：按类别各写确定的用例，每条都是“改了这一样、重拼的结论变了、摘要也必须变”；另有“本章
 * 之后的世界变了、结论没变、摘要也不变”。随机序列作补充：摘要没变时，重拼的结论一定没变。
 */

import {describe, expect, test} from "bun:test";

import type {Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import type {SelfReport} from "../../shared/checks";
import {ENTRY_TYPES, MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {addRow, chapter, drafts, learns, PlotWorld, present, setSub} from "../../testing/world";
import {randomBook, seeded} from "../../testing/random-edits";
import {dependenciesOf, entriesRead} from "./dependencies";
import {planCheck} from "./plan";
import {digest, planOf, type Scene} from "../../testing/checks";

const CHAPTERS = Array.from({length: 22}, (_, index) => `ch${String(index + 1)}`);
const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};

/** 依赖摘要。`concerned` 是记录里存的那一份（跑检查时的计划算的），之后的世界变了也还用它。 */
const deps = (w: PlotWorld, chapterId: string, scene: Scene = {}, concerned = planOf(w, chapterId, scene)) => dependenciesOf({
    view: w.view(),
    chapter: chapterId,
    followUps: scene.followUps ?? [],
    points: concerned.points,
    concerns: concerned.concerns,
    pluginVersion: "test",
    digest,
    ...(scene.instruction === undefined ? {} : {instruction: {snapshot: scene.instruction, digest: digest(JSON.stringify(scene.instruction))}}),
    ...(scene.selfReport === undefined ? {} : {selfReport: digest(JSON.stringify(scene.selfReport))}),
});
/** 重拼的结论：调用集合与每个输入的摘要。 */
const signature = (w: PlotWorld, chapterId: string, scene: Scene = {}) => JSON.stringify(planOf(w, chapterId, scene).calls.map((call) => [call.id, call.digest]));

/** 第 8 章有卫兵与勇者的场面，第 20 章计划明说揭示（有试读）。 */
function book() {
    const w = new PlotWorld(CHAPTERS);
    const hero = w.person("勇者");
    const guard = w.person("卫兵");
    const k = w.point("勇者左手有星形的疤", hero, {保密: "secret", 读者问题: "勇者有什么特征"});
    const fs = w.foreshadow("星形的疤", {种类: "mystery", 答案: {ref: k}});
    w.change(chapter("ch3"), {told: [inText(w, "ch3", "旅人总戴着左手的手套", [node(fs, "plant")])]});
    w.texts.set("ch8", "勇者走进客栈，卫兵盘问。\n");
    w.change(chapter("ch8"), {cast: [present(guard)]});
    w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
    return {w, hero, guard, k, fs};
}

/** 这个改动让结论变了，摘要也必须变。 */
function mustChange(w: PlotWorld, change: () => void, scene: Scene = {}, chapterId = "ch8") {
    const stored = planOf(w, chapterId, scene);
    const [before, sign] = [deps(w, chapterId, scene, stored), signature(w, chapterId, scene)];
    change();
    expect(signature(w, chapterId, scene)).not.toBe(sign);
    expect(deps(w, chapterId, scene, stored)).not.toBe(before);
}

/** 这个改动不影响这一章：结论与摘要都不变。 */
function mustStay(w: PlotWorld, change: () => void, scene: Scene = {}, chapterId = "ch8") {
    const stored = planOf(w, chapterId, scene);
    const [before, sign] = [deps(w, chapterId, scene, stored), signature(w, chapterId, scene)];
    change();
    expect(signature(w, chapterId, scene)).toBe(sign);
    expect(deps(w, chapterId, scene, stored)).toBe(before);
}

describe("改了这一样，结论变了，摘要也变", () => {
    test("本章正文", () => {
        const {w} = book();
        mustChange(w, () => w.texts.set("ch8", "勇者走进客栈，卫兵放行。\n"));
    });

    test("上一章正文（试读的材料）", () => {
        const {w} = book();
        mustChange(w, () => w.texts.set("ch7", "勇者洗了手。\n"));
    });

    test("前面任意一章的正文：讲述失联，读者的程度与试读的材料都变了", () => {
        const {w} = book();
        mustChange(w, () => w.texts.set("ch3", "旅人走了。\n"));
    });

    test("前面的一条变更（改了在场的人的知情）", () => {
        const {w, guard, k} = book();
        mustChange(w, () => w.change(chapter("ch2"), {patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]}));
    });

    test("讲述先于安放：安放在第 12 章、讲述在第 5 章的明说揭示", () => {
        const {w, k} = book();
        // 正文先写好：摘要要因为这条变更而变，不是因为正文变了。
        w.texts.set("ch5", "勇者的手套滑落。\n");
        mustChange(w, () => w.change(chapter("ch12"), {told: [{source: "chapter", chapter: "ch5", quote: "勇者的手套滑落", marks: [reveal(k, "explicit")]}]}));
    });

    test("别的线上的揭示：第 5 章由支线讲，第 8 章讲主线，支线上的明说让读者知道了", () => {
        const {w, k} = book();
        w.texts.set("ch1", "开头。\n");
        const cut = w.change(chapter("ch1"));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch2")), nature: "fork", fork: {line: "tmp:r1", name: "支线", parent: "main", cut, type: "branch"}}}]);
        const r1 = ids["tmp:r1"]!;
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch5", [{line: r1, from: 1}]]])});
        w.texts.set("ch5", "勇者摊开左手。\n");
        mustChange(w, () => w.change({kind: "chapter", chapter: "ch5", key: 0, line: r1}, {told: [{source: "chapter", chapter: "ch5", quote: "勇者摊开左手", marks: [reveal(k, "explicit")]}]}));
    });

    test("被前面已写变更兑现的、安放在后面的计划：去掉它的节点，继承的节点没了，试读的材料少了一段", () => {
        const {w, fs} = book();
        const plan = w.change(chapter("ch18"), {kind: "plan", told: [{source: "outline", chapter: "ch18", anchor: "细纲", marks: [node(fs, "echo")]}]});
        w.change(chapter("ch5"), {told: [inText(w, "ch5", "手套又出现了")], links: [{kind: "fulfills", plan}]});
        mustChange(w, () => {
            const stored = w.world.data.changes.get(plan)!;
            w.publish([{ref: {kind: "change", id: plan}, after: {...stored, told: stored.told.map((telling) => ({...telling, marks: []}))}}]);
        });
    });

    test("撤销前面的一条变更", () => {
        const {w, guard, k} = book();
        const row = w.change(chapter("ch2"), {patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]});
        mustChange(w, () => w.publish([{ref: {kind: "change", id: row}, after: {...w.world.data.changes.get(row)!, status: "undone", undoneReason: "不要了"}}]));
    });

    test("章序调整：这一章之前的次序变了", () => {
        const {w} = book();
        const order = [...CHAPTERS];
        [order[6], order[8]] = [order[8]!, order[6]!];
        const before = deps(w, "ch8");
        w.world = w.world.withOptions({...w.world.options, order: new (w.world.options.order.constructor as new (ids: readonly string[]) => typeof w.world.options.order)(order)});
        expect(deps(w, "ch8")).not.toBe(before);
    });

    test("写作指示、自陈、补问清单", () => {
        const {w} = book();
        const instruction: InstructionSnapshot = {chapter: "ch8", version: "v1", ending: "他走了"};
        const selfReport: SelfReport = {chapter: "ch8", brief: "上下文", report: {names: [], unsure: [], deviations: []}};
        const base = deps(w, "ch8");
        expect(deps(w, "ch8", {instruction})).not.toBe(base);
        expect(deps(w, "ch8", {selfReport})).not.toBe(base);
        expect(deps(w, "ch8", {followUps: ["time:main#1"]})).not.toBe(base);
    });

    test("决策：挂在本章涉及的条目上、范围覆盖本章的新决策", () => {
        const {w, guard} = book();
        mustChange(w, () => w.decision("卫兵的来历", {about: [{kind: "entry", id: guard}]}));
        mustChange(w, () => w.decision("这一段的约束", {about: [], scope: {from: "ch5", to: "ch9"}}));
    });

    test("决策：涉及本章的待定决策改了文字", () => {
        const {w} = book();
        const id = w.decision("勇者的来历", {about: [{kind: "chapter", id: "ch8"}]});
        mustChange(w, () => w.publish([{ref: {kind: "decision", id}, after: {...w.world.data.decisions.get(id)!, text: "勇者的身世"}}]));
    });

    test("后面的揭示：撤掉第 20 章的揭示计划，试读就不做了", () => {
        const {w} = book();
        const plan = [...w.world.data.changes.values()].find((change) => change.kind === "plan")!;
        mustChange(w, () => w.publish([{ref: {kind: "change", id: plan.id}, after: {...plan, status: "undone", undoneReason: "不要了"}}]));
    });

    test("后面新加的明说揭示：原来不做试读，现在做", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret", 读者问题: "勇者有什么特征"});
        w.texts.set("ch8", "勇者走进客栈。\n");
        mustChange(w, () => w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]}));
    });

    test("没写出场的新条目：主体在这一章提到的新知识点", () => {
        const {w, hero} = book();
        mustChange(w, () => w.point("勇者会用剑", hero, {保密: "secret"}));
    });

    test("改知识点的初值（命题）", () => {
        const {w, k} = book();
        const stored = w.world.data.entries.get(k)!;
        mustChange(w, () => w.publish([{ref: {kind: "entry", id: k}, after: {...stored, init: {...stored.init, name: "勇者右手有星形的疤"}}}]));
    });

    test("讲支线的章：分叉定义在这一章之后时，边界到分叉所在章（线能不能建读切口）", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const k = w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.texts.set("ch8", "勇者走进客栈。\n");
        const cut = w.change(chapter("ch12"));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch13")), nature: "fork", fork: {line: "tmp:r1", name: "支线", parent: "main", cut, type: "branch"}}}]);
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line: ids["tmp:r1"]!, from: 1}]]])});
        const stored = planOf(w, "ch8");
        const before = deps(w, "ch8", {}, stored);
        // 切口之前的事在分叉所在章之前：算。分叉之后的不算。
        const secret = (value: string) => ({patches: [{op: "set" as const, at: {entry: k, path: "point.保密"}, value}]});
        w.change(chapter("ch11"), secret("topSecret"));
        expect(deps(w, "ch8", {}, stored)).not.toBe(before);
        const after = deps(w, "ch8", {}, stored);
        w.change(chapter("ch15"), secret("secret"));
        expect(deps(w, "ch8", {}, stored)).toBe(after);
    });
});

describe("审查找到的漏算（各是一个真实的反例）", () => {
    test("核对点带明说揭示：读者知道了，试读没了", () => {
        const {w, k} = book();
        const thing = w.foreshadow("钟的伏笔");
        w.texts.set("ch5", "勇者的手套滑落。\n");
        mustChange(w, () => w.publish([{ref: {kind: "check", id: "tmp:check"}, after: {id: "tmp:check", at: {entry: thing, path: "fs.参考间隔"}, value: 3, told: {source: "chapter", chapter: "ch5", quote: "勇者的手套滑落", marks: [reveal(k, "explicit")]}, place: {kind: "chapter", chapter: "ch5", key: 20}}}]));
    });

    test("核对点的比较时点在本章：涉及本章的条目多了一个，它名下的秘密成了候选", () => {
        const {w} = book();
        const thing = w.foreshadow("钟的伏笔");
        w.point("钟里藏着信", thing, {保密: "secret"});
        mustChange(w, () => w.publish([{ref: {kind: "check", id: "tmp:check"}, after: {id: "tmp:check", at: {entry: thing, path: "fs.参考间隔"}, value: 3, told: {source: "note"}, place: {kind: "chapter", chapter: "ch8", key: 20}}}]));
    });

    test("出场更晚的伏笔：本章讲述上的节点读它的答案", () => {
        const w = new PlotWorld(CHAPTERS);
        const guard = w.person("卫兵");
        const k1 = w.point("疤", null, {保密: "secret"});
        const k2 = w.point("信", null, {保密: "secret"});
        const fs = w.publish([{ref: {kind: "entry", id: "tmp:lf"}, after: {...drafts.foreshadow("tmp:lf", "晚出场的悬念", {种类: "mystery", 答案: {ref: k1}}), appears: chapter("ch15")}}])["tmp:lf"]!;
        w.texts.set("ch8", "勇者走进客栈，卫兵盘问。\n");
        w.change(chapter("ch8"), {cast: [present(guard)], told: [{source: "chapter", chapter: "ch8", quote: "勇者走进客栈", marks: [node(fs, "plant")]}]});
        mustChange(w, () => {
            const stored = w.world.data.entries.get(fs)!;
            w.publish([{ref: {kind: "entry", id: fs}, after: {...stored, init: {...stored.init, data: {fs: {...stored.init.data.fs!, fields: {...stored.init.data.fs!.fields, 答案: {ref: k2}}}}}}}]);
        });
    });

    test("写作指示的视角人物写了更晚的出场：没出场不读他，改他的初值不影响计划", () => {
        const {w, k} = book();
        const late = w.publish([{ref: {kind: "entry", id: "tmp:lp"}, after: {...drafts.person("tmp:lp", "后来者"), appears: chapter("ch15")}}])["tmp:lp"]!;
        const instruction: InstructionSnapshot = {chapter: "ch8", version: "v1", pov: {kind: "entry", id: late}, povMode: "first"};
        mustStay(w, () => {
            const stored = w.world.data.entries.get(late)!;
            w.publish([{ref: {kind: "entry", id: late}, after: {...stored, init: {...stored.init, data: {...stored.init.data, know: {...stored.init.data.know!, fields: {...stored.init.data.know!.fields, 知情: [{id: k, 程度: "knows"}]}}}}}}]);
        }, {instruction});
    });

    test("splitFrom 的 by 在后面的章：撤销 by，前面的计划不再计入", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const k = w.point("暗号", null, {保密: "secret"});
        const goal = w.goal("查暗号", guard, {隐秘: {ref: k}});
        w.texts.set("ch8", "勇者走进客栈，卫兵盘问。\n");
        w.change(chapter("ch8"), {cast: [present(guard), present(hero)]});
        const origin = w.change(chapter("ch3"), {kind: "plan"});
        const by = w.change(chapter("ch18"), {links: [{kind: "fulfills", plan: origin}]});
        w.change(chapter("ch3", 1), {kind: "plan", links: [{kind: "splitFrom", plan: origin, by}], patches: [{at: {entry: goal, path: "goal.状态"}, op: "set", value: "achieved"}]});
        mustChange(w, () => w.publish([{ref: {kind: "change", id: by}, after: {...w.world.data.changes.get(by)!, status: "undone", undoneReason: "不要了"}}]));
    });

    test("出场更晚的条目的 retold 带明说揭示", () => {
        const {w, k} = book();
        const late = w.publish([{ref: {kind: "entry", id: "tmp:lr"}, after: {...drafts.thing("tmp:lr", "后来的钟"), appears: chapter("ch15")}}])["tmp:lr"]!;
        w.texts.set("ch5", "勇者的手套滑落。\n");
        mustChange(w, () => w.publish([{ref: {kind: "entry", id: late}, after: {...w.world.data.entries.get(late)!, retold: {"character.状态": [{source: "chapter", chapter: "ch5", quote: "勇者的手套滑落", marks: [reveal(k, "explicit")]}]}}}]));
    });
});

describe("本章之后的世界变了，结论与摘要都不变", () => {
    test("后面的变更、后面的正文、出场更晚的条目、后面的知识点、只挂诊断的决策", () => {
        const {w, hero, guard} = book();
        mustStay(w, () => w.change(chapter("ch9"), {cast: [present(guard)]}));
        mustStay(w, () => w.texts.set("ch9", "第二天。\n"));
        mustStay(w, () => {
            const late = w.person("后来者", {appears: chapter("ch15")});
            w.change(chapter("ch15"), {cast: [present(late)]});
        });
        mustStay(w, () => w.publish([{ref: {kind: "entry", id: "tmp:k2"}, after: {...drafts.point("tmp:k2", "后来才有的秘密", hero, {保密: "secret"}), appears: chapter("ch15")}}]));
        mustStay(w, () => w.decision("这条发现有意为之", {about: [{kind: "diagnostic", id: "nbook.plot.check.stale", key: {range: {from: "ch9", to: "ch9"}}, version: 1}]}));
    });

    test("写一条不涉及这一章的决策、给不涉及这一章的知识点加后面的揭示：摘要不变", () => {
        const {w} = book();
        const other = w.person("别处的人");
        const unrelated = w.point("别处的秘密", other, {保密: "secret"});
        mustStay(w, () => w.decision("别处的决策", {about: [{kind: "entry", id: other}], conclusion: "定了"}));
        mustStay(w, () => w.decision("别章的决策", {about: [{kind: "chapter", id: "ch15"}]}));
        mustStay(w, () => w.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(unrelated, "explicit")]}]}));
    });

    test("改后面才出场的条目：摘要不变，因为计划读不到它", () => {
        const {w} = book();
        const late = w.person("后来者", {appears: chapter("ch15")});
        mustStay(w, () => w.publish([{ref: {kind: "entry", id: late}, after: {...w.world.data.entries.get(late)!, folder: "别处"}}]));
    });
});

describe("补叙章", () => {
    test("安放晚于这一章时，依赖的边界到安放那一章", () => {
        const {w, guard, k} = book();
        const instruction: InstructionSnapshot = {chapter: "ch8", version: "v1", timeMode: {flashback: {kind: "chapter", chapter: "ch12", key: 0}}};
        w.change(chapter("ch8", 1), {cast: [present(guard)], told: []});
        mustChange(w, () => w.change(chapter("ch10"), {patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]}), {instruction});
    });
});

describe("跨条目的间接影响、身份与讲述", () => {
    const undo = (w: PlotWorld, id: string) => w.publish([{ref: {kind: "change", id}, after: {...w.world.data.changes.get(id)!, status: "undone", undoneReason: "不要了"}}]);
    /** 路人有一行；`touch` 改这一行，带上它的变更整条才套得上；`breaker` 在第 3 章把这一行去掉，这样的变更就整条不套。 */
    function rig(w: PlotWorld) {
        const bystander = w.person("路人");
        const trifle = w.point("无关的事", null, {保密: "common"});
        w.change(chapter("ch1"), {patches: [addRow(bystander, trifle, {程度: "knows"})]});
        return {touch: setSub(bystander, trifle, "程度", "suspects"), breaker: () => w.change(chapter("ch3"), {patches: [{op: "listRemove", at: {entry: bystander, path: "know.知情"}, value: trifle}]})};
    }
    const addText = (w: PlotWorld, id: string, text: string) => w.texts.set(id, `${w.texts.get(id) ?? ""}${text}。\n`);
    function keyBook() {
        const w = new PlotWorld(CHAPTERS);
        const key = w.thing("铜钥匙");
        const k = w.point("钥匙是假的", null, {保密: "secret"});
        const fs = w.foreshadow("钥匙之谜", {种类: "mystery", 答案: {ref: k}, 物件: [{id: key}]});
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "他拾起一把钥匙", [node(fs, "plant")])]});
        addText(w, "ch8", "铜钥匙在桌上");
        return {w, key, k, fs};
    }

    test("悬念答案上的揭示改成暗示：阶段从已回收回到呼应，物件层候选出现", () => {
        const {w, k} = keyBook();
        const id = w.change(chapter("ch5"), {told: [inText(w, "ch5", "原来那把是假的", [reveal(k, "explicit")])]});
        mustChange(w, () => w.publish([{ref: {kind: "change", id}, after: {...w.world.data.changes.get(id)!, told: w.world.data.changes.get(id)!.told.map((telling) => ({...telling, marks: [reveal(k, "hint")]}))}}]));
    });

    test("删掉早先一章被引的句子：答案上的揭示失联、节点失联", () => {
        const first = keyBook();
        first.w.change(chapter("ch5"), {told: [inText(first.w, "ch5", "原来那把是假的", [reveal(first.k, "explicit")])]});
        mustChange(first.w, () => first.w.texts.set("ch5", "别的话。\n"));
        const second = keyBook();
        mustChange(second.w, () => second.w.texts.set("ch2", "别的话。\n"));
    });

    test("新写一条兑现带回收节点的计划的变更：它不提到伏笔，继承节点，阶段变成已回收", () => {
        const {w, fs} = keyBook();
        const plan = w.change(chapter("ch5"), {kind: "plan", told: [{source: "outline", chapter: "ch5", anchor: "细纲", marks: [node(fs, "payoff")]}]});
        mustChange(w, () => w.change(chapter("ch5", 1), {links: [{kind: "fulfills", plan}], told: [inText(w, "ch5", "钥匙的事说开了")]}));
    });

    test("撤销 D，给伏笔加物件的 C 才套上：D 只提到路人，物件层候选出现", () => {
        const w = new PlotWorld(CHAPTERS);
        const {touch, breaker} = rig(w);
        const key = w.thing("铜钥匙");
        const fs = w.foreshadow("钥匙伏笔", {物件: []});
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "他拾起一把钥匙", [node(fs, "plant")])]});
        w.change(chapter("ch4"), {patches: [{op: "listAdd", at: {entry: fs, path: "fs.物件"}, value: {id: key}}, touch]});
        const d = breaker();
        addText(w, "ch8", "铜钥匙在桌上");
        mustChange(w, () => undo(w, d));
    });

    test("撤销 D，改名的补丁才套上：父条目改名，知识点进本章；物件改名，物件层候选出现", () => {
        const w = new PlotWorld(CHAPTERS);
        const {touch, breaker} = rig(w);
        const holder = w.person("老周");
        const watcher = w.person("卫兵");
        w.point("老周的秘密", holder, {保密: "secret"});
        w.change(chapter("ch4"), {patches: [{op: "set", at: {entry: holder, path: "entry.name"}, value: "周掌柜"}, touch]});
        const d = breaker();
        addText(w, "ch8", "周掌柜在柜台后面");
        w.change(chapter("ch8"), {cast: [present(watcher)]});
        mustChange(w, () => undo(w, d));

        const other = new PlotWorld(CHAPTERS);
        const rigged = rig(other);
        const key = other.thing("旧物");
        const fs = other.foreshadow("钥匙伏笔", {物件: [{id: key}]});
        other.change(chapter("ch2"), {told: [inText(other, "ch2", "他拾起一把钥匙", [node(fs, "plant")])]});
        other.change(chapter("ch4"), {patches: [{op: "set", at: {entry: key, path: "entry.name"}, value: "铜钥匙"}, rigged.touch]});
        const breaking = rigged.breaker();
        addText(other, "ch8", "铜钥匙在桌上");
        mustChange(other, () => undo(other, breaking));
    });

    test("撤销 D，C 才套上：C 的在场得知生效，人的知情变了", () => {
        const w = new PlotWorld(CHAPTERS);
        const {touch, breaker} = rig(w);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        w.point("勇者的秘密", hero, {保密: "secret"});
        const k = w.point("别的秘密", hero, {保密: "secret"});
        w.change(chapter("ch4"), {cast: [present(guard)], marks: [learns(k)], patches: [touch]});
        const d = breaker();
        addText(w, "ch8", "勇者走进客栈");
        w.change(chapter("ch8"), {cast: [present(guard)]});
        mustChange(w, () => undo(w, d));
    });

    test("计划在按计划模式下才套上：改两个条目的计划，保密档变了、目标的隐秘变了", () => {
        const w = new PlotWorld(CHAPTERS);
        const {touch, breaker} = rig(w);
        const hero = w.person("勇者");
        const k = w.point("勇者的小事", hero, {保密: "common"});
        w.change(chapter("ch4"), {kind: "plan", patches: [{op: "set", at: {entry: k, path: "point.保密"}, value: "secret"}, touch]});
        const d = breaker();
        addText(w, "ch8", "这里没有写到主角的名字");
        w.change(chapter("ch8"), {cast: [present(hero)]});
        mustChange(w, () => undo(w, d), {instruction: {chapter: "ch8", version: "v1", pov: {kind: "entry", id: hero}, povMode: "limited"}});

        const other = new PlotWorld(CHAPTERS);
        const rigged = rig(other);
        const person = other.person("勇者");
        const secret = other.point("暗藏的事", null, {保密: "secret"});
        const goal = other.goal("藏起来", person, {状态: "active", 隐秘: null});
        other.change(chapter("ch4"), {kind: "plan", patches: [{op: "set", at: {entry: goal, path: "goal.隐秘"}, value: {ref: secret}}, rigged.touch]});
        const breaking = rigged.breaker();
        addText(other, "ch8", "这里没有写到主角的名字");
        other.change(chapter("ch8"), {cast: [present(person)]});
        mustChange(other, () => undo(other, breaking));
    });

    test("讲述在本章、安放在别处的变更：在场的人有了隐秘目标、改了名", () => {
        const scene = () => {
            const w = new PlotWorld(CHAPTERS);
            const hero = w.person("勇者");
            const witness = w.person("目击者");
            const k = w.point("勇者的秘密", hero, {保密: "secret"});
            w.change(chapter("ch3"), {cast: [present(witness)], told: [inText(w, "ch8", "目击者想起那一夜")]});
            w.change(chapter("ch8"), {cast: [present(hero)], told: [inText(w, "ch8", "勇者走进客栈")]});
            return {w, witness, k};
        };
        const first = scene();
        mustChange(first.w, () => first.w.goal("守住秘密", first.witness, {隐秘: {ref: first.k}}));
        const second = scene();
        const stored = second.w.world.data.entries.get(second.witness)!;
        mustChange(second.w, () => second.w.publish([{ref: {kind: "entry", id: second.witness}, after: {...stored, init: {...stored.init, name: "老更夫"}}}]));
    });

    test("`揭穿`、`物件` 由补丁写：改马甲、物件的初值名字，正文里有新名字", () => {
        const w = new PlotWorld(CHAPTERS);
        const mask = w.person("黑衣人");
        const watcher = w.person("卫兵");
        const k = w.point("黑衣人是谁", null, {保密: "secret"});
        w.change(chapter("ch3"), {patches: [{op: "set", at: {entry: k, path: "point.揭穿"}, value: {ref: mask}}]});
        addText(w, "ch8", "灰袍客走过");
        w.change(chapter("ch8"), {cast: [present(watcher)]});
        const stored = w.world.data.entries.get(mask)!;
        mustChange(w, () => w.publish([{ref: {kind: "entry", id: mask}, after: {...stored, init: {...stored.init, name: "灰袍客"}}}]));

        const other = new PlotWorld(CHAPTERS);
        const key = other.thing("旧名");
        const fs = other.foreshadow("钥匙伏笔", {物件: []});
        other.change(chapter("ch2"), {patches: [{op: "listAdd", at: {entry: fs, path: "fs.物件"}, value: {id: key}}], told: [inText(other, "ch2", "他拾起一把钥匙", [node(fs, "plant")])]});
        addText(other, "ch8", "铜钥匙在桌上");
        const thing = other.world.data.entries.get(key)!;
        mustChange(other, () => other.publish([{ref: {kind: "entry", id: key}, after: {...thing, init: {...thing.init, name: "铜钥匙"}}}]));
    });

    test("改了告诉他的人的名字：误信的题面写了这个人", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const teller = w.person("老周");
        const k = w.point("勇者的秘密", hero, {保密: "secret"});
        w.change(chapter("ch2"), {patches: [addRow(guard, k, {程度: "misbelieves", 他以为的: "疤在右手", 怎么知道: "told", 谁告诉的: {ref: teller}})]});
        addText(w, "ch8", "勇者走进客栈，卫兵盘问");
        w.change(chapter("ch8"), {cast: [present(guard)]});
        const stored = w.world.data.entries.get(teller)!;
        mustChange(w, () => w.publish([{ref: {kind: "entry", id: teller}, after: {...stored, init: {...stored.init, name: "周掌柜"}}}]));
    });

    test("改传话人的出场：题面里“告诉他的人”的名字读不到了", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const teller = w.person("老周");
        const k = w.point("勇者的秘密", hero, {保密: "secret"});
        w.change(chapter("ch2"), {patches: [addRow(guard, k, {程度: "misbelieves", 他以为的: "疤在右手", 怎么知道: "told", 谁告诉的: {ref: teller}})]});
        addText(w, "ch8", "勇者走进客栈，卫兵盘问");
        w.change(chapter("ch8"), {cast: [present(guard)]});
        const stored = w.world.data.entries.get(teller)!;
        mustChange(w, () => w.publish([{ref: {kind: "entry", id: teller}, after: {...stored, appears: chapter("ch15")}}]));
    });

    test("目标改父条目：它原来不在本章读的条目里，改到本章涉及的人名下，隐秘的知识点进本章", () => {
        const w = new PlotWorld(CHAPTERS);
        const [hero, zhou, guard] = [w.person("勇者"), w.person("老周"), w.person("卫兵")];
        const k = w.point("暗藏的事", null, {保密: "secret"});
        const goal = w.goal("藏起来", zhou, {状态: "active", 隐秘: {ref: k}});
        addText(w, "ch8", "这里没有写到人名");
        w.change(chapter("ch8"), {cast: [present(hero), present(guard)]});
        const stored = w.world.data.entries.get(goal)!;
        mustChange(w, () => w.publish([{ref: {kind: "entry", id: goal}, after: {...stored, parent: hero}}]));
    });

    test("只有 `label` 的在场的人：变更不提到任何条目，候选多了一个", () => {
        const {w, k} = book();
        expect(k).toBeDefined();
        mustChange(w, () => w.change(chapter("ch8", 1), {cast: [{label: "路过的货郎", role: "present"}]}));
    });

    test("改 `揭穿` 的补丁：知识点不在本章，马甲的名字在正文里，它进本章", () => {
        const w = new PlotWorld(CHAPTERS);
        const mask = w.person("黑衣人");
        const watcher = w.person("卫兵");
        const k = w.point("黑衣人是谁", null, {保密: "secret"});
        addText(w, "ch8", "黑衣人走过");
        w.change(chapter("ch8"), {cast: [present(watcher)]});
        mustChange(w, () => w.change(chapter("ch3"), {patches: [{op: "set", at: {entry: k, path: "point.揭穿"}, value: {ref: mask}}]}));
    });

    test("改分叉的切口：分叉不提到任何条目，子线上看得到的前面的事变了", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const guard = w.person("卫兵");
        const k = w.point("勇者的秘密", hero, {保密: "secret"});
        const early = w.change(chapter("ch2"), {told: [inText(w, "ch2", "天刚亮")]});
        w.change(chapter("ch4"), {patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]});
        const late = w.change(chapter("ch5"), {told: [inText(w, "ch5", "到了晌午")]});
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch6")), nature: "fork", fork: {line: "tmp:r", name: "支线", parent: "main", cut: late, type: "branch"}}}]);
        const line = ids["tmp:r"]!;
        const fork = ids["tmp:f"]!;
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line, from: 1}]]])});
        addText(w, "ch8", "勇者走进客栈，卫兵盘问");
        w.change({kind: "chapter", chapter: "ch8", key: 0, line}, {cast: [present(guard)]});
        const stored = w.world.data.changes.get(fork)!;
        mustChange(w, () => w.publish([{ref: {kind: "change", id: fork}, after: {...stored, fork: {...stored.fork!, cut: early}}}]));
    });

    test("改伏笔的初值：物件还被别的伏笔提到（身份那一项没变），这个伏笔不再依赖它，物件层候选消失", () => {
        const w = new PlotWorld(CHAPTERS);
        const key = w.thing("铜钥匙");
        const fs = w.foreshadow("钥匙伏笔", {物件: [{id: key}]});
        w.foreshadow("没埋的伏笔", {物件: [{id: key}]});
        w.change(chapter("ch2"), {told: [inText(w, "ch2", "他拾起一把钥匙", [node(fs, "plant")])]});
        addText(w, "ch8", "铜钥匙在桌上");
        const stored = w.world.data.entries.get(fs)!;
        const data = stored.init.data;
        mustChange(w, () => w.publish([{ref: {kind: "entry", id: fs}, after: {...stored, init: {...stored.init, data: {...data, fs: {...data.fs!, fields: {...data.fs!.fields, 物件: []}}}}}}]));
    });

    test("改试读材料用到的那一段的别的字：引文还找得到、段落号没变，题面变了", () => {
        const {w} = book();
        mustChange(w, () => w.texts.set("ch3", "旅人总戴着左手的手套，谁也没见他摘下来。\n"));
    });

    test("链接很长、写入的先后反着：整组跟最早的一条（拆分的 `by` 也跟）", () => {
        const w = new PlotWorld(CHAPTERS);
        const hero = w.person("勇者");
        const k = w.point("勇者的秘密", hero, {保密: "secret"});
        addText(w, "ch8", "勇者走进客栈");
        const planAt = (at: string) => w.change(chapter(at), {kind: "plan", patches: [{op: "set", at: {entry: k, path: "point.保密"}, value: "secret"}]});
        const fulfill = (plan: string, at: string) => w.change(chapter(at, 1), {links: [{kind: "fulfills", plan}], told: [inText(w, at, `第 ${at} 章兑现`)]});
        // 后面的计划先建：全部变更按写入的先后排，第 20 章的那条排在最前，传得过去要跑不止两遍。
        const [p4, p3, p2, p1] = [planAt("ch20"), planAt("ch16"), planAt("ch12"), planAt("ch5")];
        const [c3, c2, c1] = [fulfill(p3, "ch18"), fulfill(p2, "ch14"), fulfill(p1, "ch10")];
        const split = (plan: string, from: string, by: string) => w.publish([{ref: {kind: "change", id: plan}, after: {...w.world.data.changes.get(plan)!, links: [{kind: "splitFrom", plan: from, by}]}}]);
        split(p4, p3, c3);
        split(p3, p2, c2);
        split(p2, p1, c1);
        const stored = planOf(w, "ch8");
        const before = deps(w, "ch8", {}, stored);
        const last = w.world.data.changes.get(p4)!;
        w.publish([{ref: {kind: "change", id: p4}, after: {...last, text: "改过"}}]);
        expect(deps(w, "ch8", {}, stored)).not.toBe(before);
    });

    test("把 `揭穿` 改指向另一个马甲：两个马甲都已在身份那一项里，只有这条补丁变了", () => {
        const w = new PlotWorld(CHAPTERS);
        const [first, second] = [w.person("黑衣人"), w.person("灰袍客")];
        const watcher = w.person("卫兵");
        const k = w.point("这个人是谁", null, {保密: "secret", 揭穿: {ref: first}});
        w.point("那个人是谁", null, {保密: "common", 揭穿: {ref: second}});
        addText(w, "ch8", "灰袍客走过");
        w.change(chapter("ch8"), {cast: [present(watcher)]});
        mustChange(w, () => w.change(chapter("ch3"), {patches: [{op: "set", at: {entry: k, path: "point.揭穿"}, value: {ref: second}}]}));
    });

    test("核对点挂在早先的变更上：放在第 10 章，比较时点在第 3 章，第 3 章涉及的条目多了一个", () => {
        const w = new PlotWorld(CHAPTERS);
        const ledger = w.thing("账房");
        const hero = w.person("勇者");
        w.point("账房的秘密", ledger, {保密: "secret"});
        const anchor = w.change(chapter("ch3"), {cast: [present(hero)], told: [inText(w, "ch3", "勇者数钱")]});
        addText(w, "ch10", "账上一文");
        mustChange(w, () => w.publish([{ref: {kind: "check", id: "tmp:k"}, after: {id: "tmp:k", at: {entry: ledger, path: "character.状态"}, value: 1, told: {source: "chapter", chapter: "ch10", quote: "账上一文"}, place: chapter("ch10"), anchor: {change: anchor, side: "after"}}}]), {}, "ch3");
    });
});

describe("与这一章无关的改动：结论没变，摘要也不变，不用重拼", () => {
    test("条目在树里怎么摆：`folder`、`order`，普通条目与伏笔都一样", () => {
        const {w, hero, fs} = book();
        for (const id of [hero, fs]) {
            const stored = w.world.data.entries.get(id)!;
            mustStay(w, () => w.publish([{ref: {kind: "entry", id}, after: {...stored, folder: "改过的", order: 7}}]));
        }
    });

    test("早先的章加一条不提到本章条目的变更", () => {
        const {w} = book();
        const other = w.person("路人甲");
        mustStay(w, () => w.change(chapter("ch5"), {text: "中间补一句"}));
        mustStay(w, () => w.change(chapter("ch5", 1), {cast: [present(other)]}));
    });

    test("改早先一章的正文：段落、引文与试读材料用到的那一段都没动", () => {
        const {w} = book();
        w.texts.set("ch5", "第五章的话。\n");
        mustStay(w, () => w.texts.set("ch5", "第五章改过的话。\n"));
        // 试读材料用到的是第 3 章第 1 段，改第 2 段不影响。
        w.texts.set("ch3", `${w.texts.get("ch3")!}第二段。\n`);
        mustStay(w, () => w.texts.set("ch3", w.texts.get("ch3")!.replace("第二段", "改过的第二段")));
    });

    test("加一个没人提到的人；改一个本章不读的人的初值", () => {
        const {w} = book();
        const other = w.person("路人乙");
        mustStay(w, () => w.person("路人丙"));
        const stored = w.world.data.entries.get(other)!;
        mustStay(w, () => w.publish([{ref: {kind: "entry", id: other}, after: {...stored, init: {...stored.init, summary: "改过"}}}]));
    });
});

/**
 * 记录视图：计划读了哪些条目、读了哪些字段。每次计划一个新的包装，绕开按视图的共用索引，这样每一章的读取都记得全。产品路径不这样走：重拼一章要慢几倍。
 */
function readsOfPlan(w: PlotWorld, chapterId: string, scene: Scene) {
    const fields = new Map<string, Set<string>>();
    const note = (id: string, field: string) => fields.set(id, (fields.get(id) ?? new Set()).add(field));
    const watch = (id: string, read: unknown): unknown => {
        if (typeof read !== "object" || read === null) return read;
        // 读取视图交出的是冻结的：包它的拷贝，代理才能交出别的值。
        return new Proxy({...read}, {get: (target, key, receiver) => {
            const value = Reflect.get(target, key, receiver) as unknown;
            if (key !== "namespaces") {
                if (typeof key === "string") note(id, key);
                return value;
            }
            return new Proxy({...(value as object)}, {get: (spaces, space) => {
                const data = Reflect.get(spaces, space) as {fields?: object} | undefined;
                if (data === undefined || typeof space !== "string") return data;
                return {...data, fields: new Proxy({...data.fields}, {get: (all, field) => {
                    if (typeof field === "string") note(id, `${space}.${field}`);
                    return Reflect.get(all, field) as unknown;
                }})};
            }});
        }});
    };
    const wrapped = new Map<object, object>();
    const wrap = (view: ReturnType<PlotWorld["view"]>): ReturnType<PlotWorld["view"]> => {
        const known = wrapped.get(view);
        if (known !== undefined) return known as typeof view;
        const copy: Record<string, unknown> = {...view};
        wrapped.set(view, copy);
        copy.entry = (id: string, position: never, mode: never) => watch(id, view.entry(id, position, mode));
        copy.onLine = (line: string, mode: never) => {
            const on = view.onLine(line, mode);
            return "code" in on ? on : wrap(on);
        };
        copy.origins = (at: {entry: string}, position: never, mode: never) => {
            note(at.entry, "origins");
            return view.origins(at as never, position, mode);
        };
        copy.changes = (filter?: {entry?: string}) => {
            if (filter?.entry !== undefined) note(filter.entry, "changes");
            return view.changes(filter as never);
        };
        return copy as unknown as typeof view;
    };
    const plan = planCheck({view: wrap(w.view()), chapter: chapterId, followUps: [], digest, ...(scene.instruction === undefined ? {} : {instruction: scene.instruction})});
    if ("code" in plan) throw new Error(plan.code);
    return {fields, plan};
}

/** 只读这些字段的条目，身份那一项就覆盖了（全部知识点的 `揭穿`、名字，被引条目的名字）。 */
const IDENTITY_FIELDS = new Set(["name", "aliases", "deleted", "appeared", "point.揭穿", "id"]);

/** 计划读到的条目都有归属：不靠人列举，机械地核对“计划读了什么”那张表。 */
function expectReadsCovered(w: PlotWorld, chapterId: string, scene: Scene) {
    const {fields, plan} = readsOfPlan(w, chapterId, scene);
    const read = entriesRead({view: w.view(), chapter: chapterId, followUps: [], points: plan.points, concerns: plan.concerns, pluginVersion: "test", digest, ...(scene.instruction === undefined ? {} : {instruction: {snapshot: scene.instruction, digest: "-"}})});
    for (const [id, names] of fields) {
        if (read.has(id)) continue;
        const stored = w.world.data.entries.get(id);
        // 全表扫描：全部伏笔的字段（`foreshadow` 项），全部隐秘目标（只影响它的持有者，持有者在 `R` 里时目标也在）。
        if (stored?.type === ENTRY_TYPES.foreshadow) continue;
        if (stored?.type === ENTRY_TYPES.goal && [...names].every((name) => IDENTITY_FIELDS.has(name) || name === "goal.隐秘")) continue;
        // 还没出场的知识点：写之前的集合先读它的保密档，最后按出场筛掉（`pointsAfterWriting` 末尾），出场在身份那一项里。
        const atEnd = w.view().entry(id, {kind: "chapter", chapter: chapterId, edge: "end"}, "actual");
        if (stored?.type === ENTRY_TYPES.point && atEnd !== null && atEnd !== "chapter-not-found" && !atEnd.appeared) continue;
        const beyond = [...names].filter((name) => !IDENTITY_FIELDS.has(name));
        if (beyond.length > 0) throw new Error(`${chapterId} 的计划读了 ${id}（${stored?.type ?? "?"}）的 ${beyond.join("、")}，它不在摘要覆盖的条目里`);
    }
}

/** 随机序列的步数与种子：离线要多跑一轮时用环境变量给，不改用例。 */
const STEPS = Number(process.env.PLOT_RANDOM_STEPS ?? 240);
const SEED = Number(process.env.PLOT_RANDOM_SEED ?? 20261106);

describe("随机序列", () => {
    test("摘要没变时，重拼的结论一定没变；每步比全部章，每种操作都真的走到", () => {
        const book = randomBook(seeded(SEED));
        const {w, chapters, instructions} = book;
        const sceneOf = (id: string): Scene => (instructions.has(id) ? {instruction: instructions.get(id)!} : {});
        const snapshot = () => new Map(chapters.map((id) => {
            const stored = planOf(w, id, sceneOf(id));
            return [id, {stored, deps: deps(w, id, sceneOf(id), stored), sign: JSON.stringify(stored.calls.map((call) => [call.id, call.digest]))}] as const;
        }));
        let before = snapshot();
        let quiet = 0;
        let moved = 0;
        const applied = new Set<string>();
        for (let step = 0; step < STEPS; step += 1) {
            const done = book.step(step);
            if (done.applied) applied.add(done.op);
            const after = snapshot();
            for (const id of chapters) {
                const old = before.get(id)!;
                const same = deps(w, id, sceneOf(id), old.stored) === old.deps;
                if (same) quiet += 1;
                // 这是要守的不变量：摘要没变，结论就没变。失败时说出是哪一步的哪种操作。
                if (same && after.get(id)!.sign !== old.sign) throw new Error(`第 ${String(step)} 步（${done.op}）：${id} 的摘要没变，结论变了`);
                if (after.get(id)!.sign !== old.sign) moved += 1;
            }
            before = after;
            if (step % 40 === 0) for (const id of chapters) expectReadsCovered(w, id, sceneOf(id));
        }
        for (const id of chapters) expectReadsCovered(w, id, sceneOf(id));
        expect(quiet).toBeGreaterThan(50);
        expect(moved).toBeGreaterThan(50);
        expect(book.ops.filter((op) => !applied.has(op))).toEqual([]);
    }, Math.max(120_000, STEPS * 1_000));
});
