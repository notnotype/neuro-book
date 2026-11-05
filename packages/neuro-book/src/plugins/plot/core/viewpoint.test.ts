import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry} from "@notnotype/nb-canon";

import {COMPONENT_IDS, PLOT_COMPONENTS} from "../shared/declarations";
import {PlotService} from "../testing/service";
import {addRow, chapter, drafts, learns, present, start} from "../testing/world";

let root = "";
let plots: PlotService[] = [];
beforeEach(async () => {
    root = await createTestTmpRoot("neuro-book-plot", "viewpoint");
});
afterEach(async () => {
    for (const plot of plots) await plot.stop();
    plots = [];
    await rm(root, {recursive: true, force: true});
});

const CHAPTERS = Array.from({length: 6}, (_, index) => `ch${String(index + 1)}`);
async function open(): Promise<PlotService> {
    const plot = await PlotService.open(root, CHAPTERS);
    plots.push(plot);
    return plot;
}

describe("plot.knowledge 验收场景 1：卫兵的视图", () => {
    test("卫兵读 K 得到占位、按名字找不到 K；他的经历里有在场的那条变更，但没有补丁与国王的知情行；戴兜帽的勇者只给马甲；审计里有占位", async () => {
        const plot = await open();
        const [king, guard, hero] = [await plot.person("国王"), await plot.person("卫兵"), await plot.person("勇者")];
        const traveler = await plot.person("旅人", {sameAs: hero});
        const k = await plot.point("勇者左手有星形的疤", hero);
        await plot.point("勇者就是旅人", hero, {揭穿: {ref: traveler}});
        const talk = await plot.change(chapter("ch3"), {text: "国王与贤者谈勇者的特征", cast: [present(king), present(guard)], patches: [addRow(king, k, {程度: "knows", 怎么知道: "witnessed"})]});
        const meet = await plot.change(chapter("ch4"), {text: "旅人路过城门", cast: [{who: traveler, role: "present"}, present(guard)]});
        const {viewpoint, token} = plot.viewpoint({viewer: guard, until: {kind: "chapter", chapter: "ch5", edge: "start"}});

        expect(viewpoint.entry(k)).toEqual({kind: "placeholder", id: k, text: "一件卫兵不知道的事"});
        expect(viewpoint.lookup(["勇者左手有星形的疤", "国王"])).toEqual({"勇者左手有星形的疤": [], "国王": [king]});
        const experience = viewpoint.experience();
        if (experience === "no-viewer") throw new Error("no viewer");
        expect(experience.items.map((item) => item.id)).toEqual([talk, meet]);
        expect(experience.items[0]).toEqual({id: talk, at: {kind: "chapter", chapter: "ch3", key: 0}, text: "国王与贤者谈勇者的特征", cast: [{who: king}], knowing: []});
        // 写入时 `who` 写成马甲的存成本体加 `as`：卫兵不知道揭穿它的知识点，只给马甲。
        expect(experience.items[1]!.cast).toEqual([{who: traveler}]);
        expect(viewpoint.knowing(king)).toEqual([]);

        const audit = plot.service.viewAudit({viewer: guard});
        expect(audit !== "cursor-stale" && audit.items.map((item) => [item.kind, item.method, item.blocked?.map((ref) => ref.id)])).toEqual([["placeholder", "viewpoint.entry", [k]], ["placeholder", "viewpoint.lookup", [k]]]);
        plot.service.closeView(token);
    });

    test("国王在场得知 K 以后：国王读得到 K；问别人的知情只给国王自己也知道的、常识或行内档的那几行", async () => {
        const plot = await open();
        const [king, sage] = [await plot.person("国王"), await plot.person("贤者")];
        const k = await plot.point("勇者左手有星形的疤", await plot.person("勇者"));
        const herb = await plot.point("这株草是月见草", null, {保密: "trade", 规则: "懂药的人认得"});
        await plot.change(chapter("ch3"), {cast: [present(king), present(sage)], marks: [learns(k), learns(herb)]});
        const {viewpoint} = plot.viewpoint({viewer: king, until: start("ch4")});
        expect(viewpoint.entry(k)).toMatchObject({kind: "entry", view: {id: k, name: "勇者左手有星形的疤"}});
        const points = (who: string) => {
            const rows = viewpoint.knowing(who);
            if (rows === "no-viewer") throw new Error(rows);
            return rows.map((row) => row.point).sort();
        };
        expect(points(king)).toEqual([k, herb].sort());
        expect(points(sage)).toEqual([herb]);
    });
});

describe("plot.knowledge 验收场景 2、7：行内档与误信", () => {
    test("行内档没人有行时照常返回；误信的人读到他以为的那句，不给真相", async () => {
        const plot = await open();
        const [smith, jin] = [await plot.person("铁匠"), await plot.person("星瑾")];
        const herb = await plot.point("这株草是月见草", null, {保密: "trade", 规则: "懂药的人认得"});
        const murderer = await plot.point("凶手是管家", null);
        await plot.change(chapter("ch2"), {patches: [addRow(jin, murderer, {程度: "misbelieves", 他以为的: "凶手是园丁"})]});
        expect(plot.viewpoint({viewer: smith, until: start("ch3")}).viewpoint.entry(herb)).toMatchObject({kind: "entry"});
        expect(plot.viewpoint({viewer: jin, until: start("ch3")}).viewpoint.entry(murderer)).toEqual({kind: "belief", id: murderer, belief: "凶手是园丁"});
        expect(plot.viewpoint({viewer: null, until: start("ch3")}).viewpoint.entry(murderer)).toMatchObject({kind: "placeholder", text: "一件写手不知道的事"});
    });
});

describe("plot.knowledge 输出 9：读一个条目的过滤（含隐秘目标）", () => {
    test("别人的知情命名空间去掉、自己的留着；挂在下面读不到的知识点不列；字段里指向它的引用换占位；隐秘目标随它的知识点挡", async () => {
        const plot = await open();
        const [jin, brother] = [await plot.person("星瑾"), await plot.person("哥哥")];
        const secret = await plot.point("哥哥想把妹妹送走", brother);
        const common = await plot.point("哥哥是厨师", brother, {保密: "common"});
        const goal = await plot.entry({type: "目标", parent: brother, folder: "", order: 0, init: {name: "送走妹妹", aliases: [], summary: "", text: [], data: {goal: {type: COMPONENT_IDS.goal, version: 1, enabled: true, fields: {状态: "active", 轻重: "major", 层次: "want", 为什么: null, 基于: [{id: secret}], 冲突: [], 后继: null, 隐秘: {ref: secret}}}}}});
        await plot.change(chapter("ch1"), {patches: [addRow(brother, common, {程度: "knows"}), addRow(jin, secret, {程度: "unaware"})]});
        const {viewpoint} = plot.viewpoint({viewer: jin, until: start("ch3")});

        const read = viewpoint.entry(brother);
        if (typeof read === "string" || read.kind !== "entry") throw new Error(JSON.stringify(read));
        expect(Object.keys(read.view.namespaces)).toEqual([]);
        expect(read.children.map((child) => child.id)).toEqual([common]);
        const own = viewpoint.entry(jin);
        if (typeof own === "string" || own.kind !== "entry") throw new Error(JSON.stringify(own));
        expect(own.view.namespaces.know!.fields.知情!.value).toEqual([{id: null, label: "一件星瑾不知道的事", 程度: "unaware"}]);
        expect(viewpoint.entry(goal)).toMatchObject({kind: "placeholder"});
        expect(viewpoint.lookup(["送走妹妹"])).toEqual({"送走妹妹": []});

        // 哥哥自己的视图：隐秘目标他从出场起就知道（推出的行），读得到，基于里的那一行也照常显示。
        const holder = plot.viewpoint({viewer: brother, until: start("ch3")}).viewpoint;
        const goalRead = holder.entry(goal);
        expect(goalRead).toMatchObject({kind: "entry"});
        expect(typeof goalRead !== "string" && goalRead.kind === "entry" && goalRead.view.namespaces.goal!.fields.基于!.value).toEqual([{id: secret, label: "哥哥想把妹妹送走"}]);

        // 删掉这个目标：墓碑留着名字，照样随它的知识点挡（删除不等于对谁都解密）。
        const stored = plot.service.world.data.entries.get(goal)!;
        await plot.publish([{ref: {kind: "entry", id: goal}, after: {...structuredClone(stored), deleted: true}}]);
        expect(plot.viewpoint({viewer: jin, until: start("ch3")}).viewpoint.entry(goal)).toMatchObject({kind: "placeholder"});
    });
});

describe("plot.knowledge 输出 9：经历里的同场者与知情的变化", () => {
    test("只被提到的人不算同场；去掉一行也是一次变化（改后为空）；推出了已有的同一程度不算变化", async () => {
        const plot = await open();
        const [guard, king, spy] = [await plot.person("卫兵"), await plot.person("国王"), await plot.person("密探")];
        const k = await plot.point("城门今夜不锁", null);
        const told = await plot.change(chapter("ch2"), {cast: [present(guard)], patches: [addRow(guard, k, {程度: "knows", 怎么知道: "witnessed"})]});
        const again = await plot.change(chapter("ch3"), {cast: [present(guard)], marks: [learns(k)]});
        const removed = await plot.change(chapter("ch4"), {cast: [present(guard), present(king), {who: spy, role: "mentioned"}], patches: [{op: "listRemove", at: {entry: guard, path: "know.知情"}, value: k}]});
        const {viewpoint} = plot.viewpoint({viewer: guard, until: start("ch6")});
        const experience = viewpoint.experience();
        if (experience === "no-viewer") throw new Error("no viewer");
        const byId = new Map(experience.items.map((item) => [item.id, item]));
        expect(byId.get(told)!.knowing).toMatchObject([{point: k, before: null, after: {程度: "knows"}}]);
        expect(byId.get(again)!.knowing).toEqual([]);
        expect(byId.get(removed)!.cast).toEqual([{who: king}]);
        expect(byId.get(removed)!.knowing).toMatchObject([{point: k, before: {程度: "knows"}, after: null}]);
    });
});

describe("plot.knowledge 输出 9：类型不在登记里的命名空间", () => {
    test("登记着时引用换占位；类型撤掉以后过滤不了，整个命名空间不给（不原样漏出引用）", async () => {
        const plot = await open();
        const guard = await plot.person("卫兵");
        const answer = await plot.point("管家是凶手", null);
        const ids = await plot.publish([{ref: {kind: "entry", id: "tmp:f"}, after: drafts.foreshadow("tmp:f", "谁杀了男爵", {种类: "mystery", 答案: {ref: answer}})}]);
        const mystery = ids["tmp:f"]!;
        const read = () => {
            const entry = plot.viewpoint({viewer: guard, until: start("ch3")}).viewpoint.entry(mystery);
            if (typeof entry === "string" || entry.kind !== "entry") throw new Error(JSON.stringify(entry));
            return entry.view.namespaces;
        };
        expect(read().fs!.fields.答案!.value).toEqual({ref: null, label: "一件卫兵不知道的事"});
        await plot.service.setRegistries({registry: buildRegistry([...PLOT_COMPONENTS.filter((component) => component.id !== COMPONENT_IDS.foreshadow), {id: "test.person", label: "人物", namespace: "character", version: 1, fields: [{id: "状态", label: "状态", kind: "text"}]}])});
        expect(Object.keys(read())).not.toContain("fs");
    });
});
