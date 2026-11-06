/**
 * 依赖的摘要“只能多算不能漏”（docs/specs/plot/checks.md 输出 7）：按类别各写确定的用例，每条都是“改了这一样、重拼的结论变了、摘要也必须变”；另有“本章
 * 之后的世界变了、结论没变、摘要也不变”。随机序列作补充：摘要没变时，重拼的结论一定没变。
 */

import {describe, expect, test} from "bun:test";

import type {Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import type {SelfReport} from "../../shared/checks";
import {MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {addRow, chapter, drafts, PlotWorld, present} from "../../testing/world";
import {dependenciesOf} from "./dependencies";
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
        w.point("勇者左手有星形的疤", hero, {保密: "secret"});
        w.texts.set("ch8", "勇者走进客栈。\n");
        const cut = w.change(chapter("ch12"));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:f"}, after: {...drafts.change("tmp:f", chapter("ch13")), nature: "fork", fork: {line: "tmp:r1", name: "支线", parent: "main", cut, type: "branch"}}}]);
        w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch8", [{line: ids["tmp:r1"]!, from: 1}]]])});
        const stored = planOf(w, "ch8");
        const before = deps(w, "ch8", {}, stored);
        // 切口之前的事在分叉所在章之前：算。分叉之后的不算。
        w.change(chapter("ch11"), {});
        expect(deps(w, "ch8", {}, stored)).not.toBe(before);
        const after = deps(w, "ch8", {}, stored);
        w.change(chapter("ch15"), {});
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

describe("随机序列", () => {
    test("摘要没变时，重拼的结论一定没变", () => {
        // 固定种子：失败时能复现。
        let seed = 20261106;
        const random = (limit: number) => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % limit;
        };
        const {w, hero, guard, k, fs} = book();
        const others = Array.from({length: 4}, (_, index) => w.person(`人${String(index)}`));
        const target = () => `ch${String(1 + random(22))}`;
        let quiet = 0;
        for (let step = 0; step < 300; step += 1) {
            const before = new Map(["ch8", "ch12"].map((id) => {
                const stored = planOf(w, id);
                return [id, {stored, deps: deps(w, id, {}, stored), sign: signature(w, id)}];
            }));
            const place = target();
            switch (random(7)) {
                case 0:
                    w.change(chapter(place), {cast: [present(others[random(4)]!)]});
                    break;
                case 1:
                    w.texts.set(place, `${w.texts.get(place) ?? ""}第 ${String(step)} 句话。\n`);
                    break;
                case 2:
                    w.change(chapter(place), {told: [inText(w, target(), `第 ${String(step)} 处线索`, [node(fs, "echo")])]});
                    break;
                case 3:
                    w.change(chapter(place), {told: [inText(w, target(), `第 ${String(step)} 处暗示`, [reveal(k, "hint")])]});
                    break;
                case 4:
                    w.point(`第 ${String(step)} 个秘密`, random(2) === 0 ? hero : guard, {保密: "secret"});
                    break;
                case 5:
                    w.change(chapter(place), {kind: "plan", told: [{source: "outline", chapter: place, anchor: "细纲", marks: [reveal(k, "explicit")]}]});
                    break;
                case 6:
                    w.decision(`第 ${String(step)} 个决策`, {about: [{kind: "chapter", id: place}]});
                    break;
            }
            for (const [id, old] of before) {
                if (deps(w, id, {}, old.stored) !== old.deps) continue;
                quiet += 1;
                expect(signature(w, id)).toBe(old.sign);
            }
        }
        // 确实走到了“摘要没变”的情形，这条断言不是空转。
        expect(quiet).toBeGreaterThan(50);
    }, 30_000);
});
