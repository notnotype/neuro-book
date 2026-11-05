import {describe, expect, test} from "bun:test";

import {COMPONENT_IDS, MARK_IDS} from "../shared/declarations";
import {addRow, chapter, end, learns, PlotWorld, present, setSub, start} from "../testing/world";
import {experienceOf, firstReveal, KnowingIndex, readerKnowing} from "./knowledge";
import {knowingIncomplete, relayBroken} from "./knowledge-checks";

const CHAPTERS = Array.from({length: 12}, (_, index) => `ch${String(index + 1)}`);
const degree = (index: KnowingIndex, person: string, point: string) => index.effective(person, point)?.程度 ?? null;

describe("plot.knowledge 验收场景 1：国王、贤者与卫兵（在场推出的知情）", () => {
    test("第 3 章国王与贤者在场谈 K：第 4 章开头两人对 K 知道（亲历），卫兵没有行；只显式给国王加的那条，卫兵在场也没有行", () => {
        const w = new PlotWorld(CHAPTERS);
        const [king, sage, guard] = [w.person("国王"), w.person("贤者"), w.person("卫兵")];
        const hero = w.person("勇者");
        const k = w.point("勇者左手有星形的疤", hero);
        w.change(chapter("ch3"), {cast: [present(king), present(sage)], marks: [learns(k)]});
        const index = new KnowingIndex(w.view(), "actual", start("ch4"));
        expect(index.effective(king, k)).toMatchObject({程度: "knows", 怎么知道: "witnessed", source: "present"});
        expect(degree(index, sage, k)).toBe("knows");
        expect(index.effective(guard, k)).toBeNull();

        w.change(chapter("ch5"), {cast: [present(king), present(guard)], patches: [addRow(king, k, {程度: "knows", 怎么知道: "told"})]});
        expect(new KnowingIndex(w.view(), "actual", end("ch5")).effective(guard, k)).toBeNull();
    });
});

describe("plot.knowledge 输出 3、验收场景 3：显式的行与推出的行谁更晚", () => {
    test("同一条变更里推出 knows、显式写 unaware：显式优先；之后在场再揭示变回 knows；显式写 forgot 以后是 forgot", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const k = w.point("哥哥能回溯", w.person("哥哥"));
        w.change(chapter("ch5"), {cast: [present(jin)], marks: [learns(k)], patches: [addRow(jin, k, {程度: "unaware"})]});
        expect(degree(new KnowingIndex(w.view(), "actual", end("ch5")), jin, k)).toBe("unaware");
        w.change(chapter("ch7"), {cast: [present(jin)], marks: [learns(k)]});
        expect(degree(new KnowingIndex(w.view(), "actual", end("ch7")), jin, k)).toBe("knows");
        w.change(chapter("ch9"), {patches: [setSub(jin, k, "程度", "forgot")]});
        expect(degree(new KnowingIndex(w.view(), "actual", end("ch9")), jin, k)).toBe("forgot");
    });

    test("中间给同一个人加别的知识点的行，不算 K 这一行的变化；整段替换写出相同的行也不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const jin = w.person("星瑾");
        const subject = w.person("哥哥");
        const [k, k2] = [w.point("哥哥能回溯", subject), w.point("哥哥晚归", subject)];
        w.change(chapter("ch1"), {patches: [addRow(jin, k, {程度: "unaware"})]});
        w.change(chapter("ch2"), {cast: [present(jin)], marks: [learns(k, "suspects")]});
        w.change(chapter("ch3"), {patches: [addRow(jin, k2, {程度: "knows"})]});
        const index = new KnowingIndex(w.view(), "actual", end("ch3"));
        expect(degree(index, jin, k)).toBe("suspects");
        expect(degree(index, jin, k2)).toBe("knows");

        const rows = (w.view().entry(jin, end("ch3"), "actual") as {namespaces: Record<string, {fields: Record<string, {value: unknown}>}>}).namespaces.know!.fields.知情!.value as Array<Record<string, unknown>>;
        const same = rows.map(({label: _label, ...row}) => row);
        w.change(chapter("ch4"), {patches: [{op: "set", at: {entry: jin, path: "know.知情"}, value: same}]});
        expect(degree(new KnowingIndex(w.view(), "actual", end("ch4")), jin, k)).toBe("suspects");
    });

    test("隐秘目标：持有者从目标出场起对它的隐秘知识点是知道（不存）；按计划模式算上计入的计划里的在场", () => {
        const w = new PlotWorld(CHAPTERS);
        const brother = w.person("哥哥");
        const secret = w.point("哥哥想把妹妹送走", brother);
        w.entry({type: "目标", parent: brother, folder: "", order: 0, appears: {kind: "chapter", chapter: "ch3", key: 0}, init: {name: "送走妹妹", aliases: [], summary: "", text: [], data: {goal: {type: COMPONENT_IDS.goal, version: 1, enabled: true, fields: {状态: "active", 轻重: "major", 层次: "want", 为什么: null, 基于: [], 冲突: [], 后继: null, 隐秘: {ref: secret}}}}}});
        expect(new KnowingIndex(w.view(), "actual", end("ch2")).effective(brother, secret)).toBeNull();
        expect(new KnowingIndex(w.view(), "actual", end("ch3")).effective(brother, secret)).toMatchObject({程度: "knows", 怎么知道: "other", source: "secretGoal"});

        const jin = w.person("星瑾");
        w.change(chapter("ch6"), {kind: "plan", cast: [present(jin)], marks: [learns(secret)]});
        expect(new KnowingIndex(w.view(), "actual", end("ch8")).effective(jin, secret)).toBeNull();
        expect(degree(new KnowingIndex(w.view(), "planned", end("ch8")), jin, secret)).toBe("knows");
    });
});

describe("plot.knowledge 输出 5、验收场景 4：传话链", () => {
    test("听哥哥说、哥哥之前没有行：报一条；在更早的章给哥哥加行后消失；同一条变更里先在场得知再转告仍报", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const k = w.point("哥哥能回溯", brother);
        const told = w.change(chapter("ch6"), {patches: [addRow(jin, k, {程度: "knows", 怎么知道: "told", 谁告诉的: {ref: brother}})]});
        const findings = () => relayBroken(w.view(), end("ch12"), "actual");
        expect(findings()).toMatchObject([{key: {objects: [{id: jin}, {id: k}, {id: told}], line: "main"}, params: {teller: brother, degree: "none"}}]);
        w.change(chapter("ch2"), {patches: [addRow(brother, k, {程度: "knows"})]});
        expect(findings()).toEqual([]);

        const w2 = new PlotWorld(CHAPTERS);
        const [jin2, brother2] = [w2.person("星瑾"), w2.person("哥哥")];
        const k2 = w2.point("哥哥能回溯", brother2);
        w2.change(chapter("ch6"), {cast: [present(brother2)], marks: [learns(k2)], patches: [addRow(jin2, k2, {程度: "knows", 怎么知道: "told", 谁告诉的: {ref: brother2}})]});
        expect(relayBroken(w2.view(), end("ch12"), "actual")).toHaveLength(1);
    });

    test("传话人写成马甲：按本体算", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother] = [w.person("星瑾"), w.person("哥哥")];
        const mask = w.person("夜行人", {sameAs: brother});
        const k = w.point("哥哥能回溯", brother);
        w.change(chapter("ch2"), {patches: [addRow(brother, k, {程度: "knows"})]});
        w.change(chapter("ch6"), {patches: [addRow(jin, k, {程度: "knows", 怎么知道: "told", 谁告诉的: {ref: mask}})]});
        expect(relayBroken(w.view(), end("ch12"), "actual")).toEqual([]);
    });
});

describe("plot.knowledge 输出 2、验收场景 7：知情行不完整", () => {
    test("误信没写他以为的、写了谁告诉的而不是听说、揭穿指的不是主体的马甲：各报一条；补全后消失", () => {
        const w = new PlotWorld(CHAPTERS);
        const [jin, brother, gardener] = [w.person("星瑾"), w.person("哥哥"), w.person("园丁")];
        const k = w.point("凶手是管家", brother);
        w.change(chapter("ch2"), {patches: [addRow(jin, k, {程度: "misbelieves"})]});
        expect(knowingIncomplete(w.view(), end("ch12"), "actual").map((finding) => finding.params.reason)).toEqual(["misbelief-without-belief"]);
        w.change(chapter("ch3"), {patches: [setSub(jin, k, "他以为的", "凶手是园丁"), setSub(jin, k, "谁告诉的", {ref: gardener})]});
        expect(knowingIncomplete(w.view(), end("ch12"), "actual").map((finding) => finding.params.reason)).toEqual(["teller-without-told"]);
        w.change(chapter("ch4"), {patches: [setSub(jin, k, "怎么知道", "told")]});
        expect(knowingIncomplete(w.view(), end("ch12"), "actual")).toEqual([]);

        const mask = w.person("夜行人", {sameAs: gardener});
        w.point("哥哥就是夜行人", brother, {揭穿: {ref: mask}});
        expect(knowingIncomplete(w.view(), end("ch12"), "actual").map((finding) => finding.params.reason)).toEqual(["unmasks-not-an-alias-of-subject"]);
    });
});

describe("plot.knowledge 输出 6、7、验收场景 5：读者的知情", () => {
    test("第 4 章暗示、第 12 章第 3 段明说：第 4 章末尾怀疑，第 12 章第 3 段起知道；删掉第 12 章那句回到怀疑", () => {
        const w = new PlotWorld(CHAPTERS);
        const k = w.point("哥哥能回溯", w.person("哥哥"));
        w.texts.set("ch4", "他看了一眼表。");
        w.texts.set("ch12", "第一段。\n第二段。\n原来哥哥能回溯。");
        const reveal = (mode: "hint" | "explicit") => ({kind: MARK_IDS.reveal, version: 1, point: k, mode});
        w.change(chapter("ch4"), {told: [{source: "chapter", chapter: "ch4", quote: "他看了一眼表", marks: [reveal("hint")]}]});
        const explicit = w.change(chapter("ch12"), {told: [{source: "chapter", chapter: "ch12", quote: "原来哥哥能回溯", marks: [reveal("explicit")]}]});
        const view = w.view();
        expect(readerKnowing(view, k, {chapter: "ch4", edge: "end"})).toBe("suspects");
        expect(readerKnowing(view, k, {chapter: "ch12", paragraph: 2})).toBe("suspects");
        expect(readerKnowing(view, k, {chapter: "ch12", paragraph: 3})).toBe("knows");
        expect(firstReveal(view, k)).toMatchObject({suspects: {chapter: "ch4", paragraph: 1}, knows: {chapter: "ch12", paragraph: 3}});
        expect(explicit).toBeDefined();
        w.texts.set("ch12", "第一段。\n第二段。\n他什么也没说。");
        expect(readerKnowing(w.view(), k, {chapter: "ch12", edge: "end"})).toBe("suspects");
    });
});

describe("plot.knowledge 输出 8：经历（作者看的全量）", () => {
    test("到这个位置为止他在场的变更按故事先后排（不按写入先后），没记参与者的另计数，加他的有效知情；之后的与不在场的不算", () => {
        const w = new PlotWorld(CHAPTERS);
        const [king, guard] = [w.person("国王"), w.person("卫兵")];
        const k = w.point("勇者左手有星形的疤", w.person("勇者"));
        const later = w.change(chapter("ch4"), {cast: [present(king)]});
        const earlier = w.change(chapter("ch2"), {cast: [present(king), present(guard)], marks: [learns(k)]});
        w.change(chapter("ch3"), {cast: [present(guard)]});
        w.change(chapter("ch3"));
        w.change(chapter("ch6"), {cast: [present(king)]});
        const experience = experienceOf(new KnowingIndex(w.view(), "actual", end("ch5")), king);
        expect(experience.changes.map((change) => change.id)).toEqual([earlier, later]);
        expect(experience.uncast).toBe(1);
        expect(experience.knowing).toMatchObject([{point: k, 程度: "knows", source: "present", change: earlier}]);

        // 按计划模式：这个位置计入的计划也算，排在故事先后里（不是排在已写的变更后面）。
        const plan = w.change(chapter("ch3"), {kind: "plan", cast: [present(king)]});
        const planned = experienceOf(new KnowingIndex(w.view(), "planned", end("ch5")), king);
        expect(planned.changes.map((change) => change.id)).toEqual([earlier, plan, later]);
    });
});
