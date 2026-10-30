/**
 * 草稿编译（docs/specs/story/ingest.md 输出 5、8，验收 7）。
 *
 * 迁移对照：样例书就是 w00005 t34 用原编译程序编出来的；用同一批最终草稿与整理稿重新编译，结果应与样例书相同，只在
 * 编译程序有意改动的地方不同（称呼不跨章前移、回补的秘密与知情的成立位置），而且只往“更晚可见”的方向变。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {openTestBook, type TestBook} from "../../testing/api";
import {sampleDataset} from "../../testing/sample";
import type {Dataset, Position} from "../core/dataset";
import {comparePosition} from "../core/position";
import {compile, sourceChapter} from "./compile";
import {applyPatch, normalizeDraft, type RawDraft} from "./draft-tools";

const FINAL = join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest", "run-med-100-final.json.gz");

const atText = (at: Position) => `${at.chapter}.${at.paragraph}`;

describe("身份同一的说法（输出 5）", () => {
    test("连到任务类对象的 identity 说法是错误（记在这条说法上）；连到人的同一说法照常", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: {statements: {id: string; family: string; about: string[]}[]}[]; consolidations: unknown[]};
        const drafts = structuredClone(final.drafts);
        const statement = drafts.flatMap(draft => draft.statements).find(item => item.id === "s1-4")!;
        // e1-1 是人，e1-6 是任务（样例书里的 kind）。
        statement.family = "identity";
        statement.about = ["e1-1", "e1-6"];
        const wrong = compile(sample.book, sample.sources, drafts, final.consolidations).issues.filter(issue => issue.level === "error" && issue.code === "identity");
        expect(wrong.map(issue => issue.records)).toEqual([["s1-4"]]);

        statement.about = ["e1-1", "e1-2"];
        const fine = compile(sample.book, sample.sources, drafts, final.consolidations).issues.filter(issue => issue.level === "error" && issue.code === "identity");
        expect(fine).toEqual([]);
    });
});

describe("本人自己的身份（输出 5）", () => {
    test("旁白确认马甲就是某人后程序补“本人知道”；草稿为本人写了别的知情（转世、失忆这类）就不再补，也不覆盖", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: {knowledge?: unknown[]}[]; consolidations: unknown[]};
        const selfRecords = (drafts: typeof final.drafts) => compile(sample.book, sample.sources, drafts, final.consolidations).dataset.knowledge.filter(item => item.id.endsWith(":self"));
        const before = selfRecords(final.drafts);
        expect(before.find(item => item.who === "e4-1" && item.about === "x21-1")?.state).toBe("knows");

        const drafts = structuredClone(final.drafts);
        const chapter21 = drafts[20]!;
        (chapter21.knowledge ??= []).push({id: "k21-99", who: "e4-1", about: "x21-1", state: "unaware", basis: "inferred", how: "转世的身份，原文没有写他自己知道", at: ["21.1"]});
        const after = selfRecords(drafts);
        expect(after.find(item => item.who === "e4-1" && item.about === "x21-1")).toBeUndefined();
        expect(after.length).toBe(before.length - 1);
    });
});

describe("迁移对照：100 章最终草稿重新编译", () => {
    test("只在称呼位置、称呼出现、回补的秘密位置上不同，而且都只会更晚", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: unknown[]; consolidations: unknown[]};
        const {dataset, issues} = compile(sample.book, sample.sources, final.drafts, final.consolidations);

        // 样例书本来就带着这一处全图时间矛盾（审查记录），重新编译照样报出来，没有新增别的错误。
        expect(issues.filter(issue => issue.level === "error").map(issue => issue.code)).toEqual(["time"]);

        const unchanged: (keyof Dataset)[] = ["schema", "book", "through", "sources", "times", "beats", "statements", "episodes", "knowledge", "ledger", "questions", "arcs"];
        for (const key of unchanged) expect({key, value: dataset[key]}).toEqual({key, value: sample[key]});

        // 归纳：被后来合并掉的对象名下的旧归纳改记到合并后的对象上（t12），其余相同。样例书只有一条。
        const redirected = sample.summaries.filter((summary, index) => dataset.summaries[index]!.entity !== summary.entity);
        expect(redirected.map(summary => [summary.entity, dataset.entities.find(entity => entity.mergedFrom.includes(summary.entity))?.id])).toEqual([["e2-10", dataset.summaries[sample.summaries.indexOf(redirected[0]!)]!.entity]]);
        expect(dataset.summaries.map(({entity: _entity, ...rest}) => rest)).toEqual(sample.summaries.map(({entity: _entity, ...rest}) => rest));

        // 对象：除了称呼的位置都相同；称呼只会从前面的章挪回模型标注的那一章。
        const withoutNameAt = (data: Dataset) => data.entities.map(entity => ({...entity, names: entity.names.map(({at: _at, ...name}) => name)}));
        expect(withoutNameAt(dataset)).toEqual(withoutNameAt(sample));
        let moved = 0;
        for (const entity of sample.entities) {
            const now = dataset.entities.find(item => item.id === entity.id)!;
            for (const name of entity.names) {
                const after = now.names.find(item => item.text === name.text)!.at;
                if (comparePosition(after, name.at) === 0) continue;
                moved += 1;
                expect({name: name.text, later: comparePosition(after, name.at) > 0, crossChapter: after.chapter > name.at.chapter}).toEqual({name: name.text, later: true, crossChapter: true});
            }
        }
        expect(moved).toBeGreaterThan(0);

        // 称呼出现：少掉的都在那个称呼新的成立位置之前；多出来的是别的称呼，补上少掉的那些空出来的字（“魔法少女风信子”
        // 推后之后，同一处由“魔法少女”“风信子”匹配；“桃桃同学”推后之后，“夏桃桃同学”里的“夏桃桃”匹配上）。
        type Mention = Dataset["mentions"][number];
        const key = (mention: Mention) => `${mention.entity}|${mention.text}|${atText(mention.at)}|${mention.start}`;
        const before = new Set(sample.mentions.map(key));
        const now = new Set(dataset.mentions.map(key));
        const nameAt = new Map(dataset.entities.flatMap(entity => entity.names.map(name => [`${entity.id}|${name.text}`, name.at] as const)));
        const removed = sample.mentions.filter(item => !now.has(key(item)));
        for (const mention of removed) {
            const established = nameAt.get(`${mention.entity}|${mention.text}`);
            expect({mention: key(mention), beforeEstablished: established !== undefined && comparePosition(mention.at, established) < 0}).toEqual({mention: key(mention), beforeEstablished: true});
        }
        for (const mention of dataset.mentions.filter(item => !before.has(key(item)))) {
            const overlaps = removed.some(item => comparePosition(item.at, mention.at) === 0 && item.start < mention.end && mention.start < item.end);
            expect({mention: key(mention), fillsFreedText: overlaps}).toEqual({mention: key(mention), fillsFreedText: true});
        }

        // 秘密：只有成立位置可能变晚。
        expect(dataset.secrets.map(({at: _at, ...secret}) => secret)).toEqual(sample.secrets.map(({at: _at, ...secret}) => secret));
        for (const secret of sample.secrets) expect(comparePosition(dataset.secrets.find(item => item.id === secret.id)!.at, secret.at)).toBeGreaterThanOrEqual(0);
    }, 30_000);

    // 旧的整批整理稿（没有 `base`）在每个前缀上编出的书与 t12 开工前相同（含 stats）；只有归纳的 `entity` 按合并改记，
    // 摘要里去掉它，单独核对改记的都是被合并掉的对象（基线由 t12 的 scripts/compile-baseline.ts 用改前的代码生成）。
    test("旧的整批整理稿在各前缀上编出的书与 t12 之前相同", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: unknown[]; consolidations: {through: number}[]};
        const baseline = JSON.parse(await readFile(join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest", "compile-t11.json"), "utf8")) as {prefixes: Record<string, string>; summaryEntities: string[]};
        for (let through = 5; through <= 100; through += 5) {
            const {dataset} = compile(sample.book, sample.sources.filter(item => item.chapter <= through), final.drafts.slice(0, through), final.consolidations.filter(item => item.through <= through));
            const stripped = {...dataset, summaries: dataset.summaries.map(({entity: _entity, ...rest}) => rest)};
            expect({through, sha256: createHash("sha256").update(JSON.stringify(stripped)).digest("hex")}).toEqual({through, sha256: baseline.prefixes[String(through)]!});
            dataset.summaries.forEach((summary, index) => {
                const before = baseline.summaryEntities[index]!;
                if (summary.entity !== before) expect({before, mergedInto: dataset.entities.find(entity => entity.id === summary.entity)?.mergedFrom.includes(before)}).toEqual({before, mergedInto: true});
            });
        }
    }, 60_000);

    // 抽取每提交一章要把已抽的部分整本编译三四次。100 章原来一次二三十秒（每段对每个称呼都扫一遍），改后一秒以内；
    // 上限给机器负载留足余量，只挡住每段的工作又随称呼总数增长的写法（t09）。
    test("一次编译在 5 秒内", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: unknown[]; consolidations: unknown[]};
        const started = performance.now();
        compile(sample.book, sample.sources, final.drafts, final.consolidations);
        expect(performance.now() - started).toBeLessThan(5000);
    }, 30_000);
});

/** 三章的小书：第 1 章出现“北斗星”这个字串，第 2 章才交代它是林晚的代号；第 3 章建秘密，补记第 1 章就知情的人。 */
function miniBook(): Dataset {
    const sources = [
        sourceChapter(1, "第1章 夜路", ["第1章 夜路", "林晚独自赶路。", "北斗星在天边闪烁。"]),
        sourceChapter(2, "第2章 代号", ["第2章 代号", "林晚的秘密代号是北斗星。"]),
        sourceChapter(3, "第3章 往事", ["第3章 往事", "林晚想起了往事。", "她没有说出口。"]),
    ];
    const drafts = [
        {
            chapter: 1,
            beats: [{id: "b1-1", from: 1, to: 3, gist: "林晚赶路。", time: null}],
            entities: [{id: "e1-1", kind: "person", label: "赶路的女子", at: "1.2", names: [{text: "林晚", at: "1.2", primary: true}]}],
            statements: [{id: "s1-1", text: "林晚独自在夜里赶路", family: "event", about: ["e1-1"], src: {at: ["1.2"], ch: "narrator"}}],
        },
        {chapter: 2, beats: [{id: "b2-1", from: 1, to: 2, gist: "交代代号。", time: null}], names: [{entity: "e1-1", text: "北斗星", at: "2.2"}]},
        {
            chapter: 3,
            beats: [{id: "b3-1", from: 1, to: 3, gist: "林晚回想。", time: null}],
            secrets: [{id: "x3-1", title: "林晚夜里赶路的事", about: ["e1-1"], statements: ["s1-1"]}],
            knowledge: [
                {id: "k3-1", who: "e1-1", about: "x3-1", state: "knows", at: ["1.2"]},
                // 回补的知情说的是前面的一条说法（不是秘密）：说法本身第 1 章就可见，挡住它的只有知情自己的成立位置。
                {id: "k3-2", who: "e1-1", about: "s1-1", state: "knows", at: ["1.2"]},
            ],
        },
    ];
    const {dataset, issues} = compile({id: "mini", title: "小书"}, sources, drafts);
    expect(issues.filter(issue => issue.level === "error")).toEqual([]);
    return dataset;
}

describe("可见位置（输出 5、8，验收 7）", () => {
    let book: TestBook;
    afterAll(async () => {
        await book?.close();
    });

    test("称呼从模型标注的那一章起可见；回补的秘密与知情读完写下它的那一章才可见", async () => {
        book = await openTestBook("ingest-visibility", miniBook());
        const names = async (chapter: number) => (await book.ok("entity.card", {book: "fox", entity: "e1-1", at: {chapter}})).names.map(name => name.text);
        expect(await names(1)).toEqual(["林晚"]);
        expect(await names(2)).toEqual(["林晚", "北斗星"]);

        const chapterOne = await book.ok("source.read", {book: "fox", at: {chapter: 1}, from: {chapter: 1, paragraph: 1}, to: {chapter: 1, paragraph: 3}});
        expect(chapterOne.paragraphs.flatMap(paragraph => paragraph.names.map(name => name.text))).toEqual(["林晚"]);
        expect((await book.ok("search", {book: "fox", at: {chapter: 1}, query: "北斗星", kinds: ["entity"]})).total).toBe(0);

        const secretRows = async (at: Position | {chapter: number}) => (await book.ok("secrets.matrix", {book: "fox", at})).rows.map(row => row.id);
        const knowledgeIds = async (at: Position | {chapter: number}) => (await book.ok("entity.knowledge", {book: "fox", entity: "e1-1", at})).items.map(item => item.id);
        for (const at of [{chapter: 2}, {chapter: 3, paragraph: 2}]) {
            expect(await secretRows(at)).toEqual([]);
            expect(await knowledgeIds(at)).not.toContain("k3-1");
            expect(await knowledgeIds(at)).not.toContain("k3-2");
        }
        expect(await secretRows({chapter: 3})).toEqual(["x3-1"]);
        expect(await knowledgeIds({chapter: 3})).toEqual(expect.arrayContaining(["k3-1", "k3-2"]));
    });
});

describe("时间点的先后矛盾", () => {
    test("错误只列出环上的时间点，排在环后面的不算", () => {
        const sources = [sourceChapter(1, "第1章", ["第1章", "正午。"]), sourceChapter(2, "第2章", ["第2章", "早晨。", "晚上。"])];
        const drafts = [
            {chapter: 1, times: [{id: "t1-1", label: "第一天正午", day: 1, part: "noon", at: ["1.2"]}], beats: [{id: "b1-1", from: 1, to: 2, gist: "正午。", time: "t1-1"}]},
            {
                chapter: 2,
                times: [
                    // 写成第一天早晨，又说在 t1-1（第一天正午）之后：自相矛盾。
                    {id: "t2-1", label: "第一天早晨", day: 1, part: "morning", rel: [{type: "after", to: "t1-1"}], at: ["2.2"]},
                    {id: "t2-2", label: "那天晚上", rel: [{type: "after", to: "t2-1"}], at: ["2.3"]},
                ],
                beats: [{id: "b2-1", from: 1, to: 2, gist: "早晨。", time: "t2-1"}, {id: "b2-2", from: 3, to: 3, gist: "晚上。", time: "t2-2"}],
            },
        ];
        const {issues} = compile({id: "t", title: "t"}, sources, drafts);
        const cycle = issues.filter(issue => issue.level === "error" && issue.code === "time");
        expect(cycle.map(issue => [issue.chapter, issue.records])).toEqual([[null, ["t1-1", "t2-1"]]]);
    });
});

/**
 * 四章的小书，每章一个时间点、一段情节（p1-1 到 p4-1）。第 1 章的“林晚”（e1-1）在第 3 章又建了一个（e3-1），可以合并。
 * 整理稿由调用方给。
 */
function arcBook(consolidations: unknown[]): {dataset: Dataset; errors: string[]} {
    const sources = [1, 2, 3, 4].map(n => sourceChapter(n, `第${n}章`, [`第${n}章`, `林晚做第${n}件事。`]));
    const drafts = [1, 2, 3, 4].map(n => ({
        chapter: n,
        times: [{id: `t${n}-1`, label: `第${n}天早晨`, day: n, part: "morning", at: [`${n}.2`]}],
        beats: [{id: `b${n}-1`, from: 1, to: 2, gist: `第${n}件事。`, time: `t${n}-1`}],
        ...(n === 1 || n === 3 ? {entities: [{id: `e${n}-1`, kind: "person", label: "做事的人", at: `${n}.2`, names: [{text: "林晚", at: `${n}.2`, primary: true}]}]} : {}),
        statements: [{id: `s${n}-1`, text: `林晚做了第${n}件事`, family: "event", about: [n >= 3 ? "e3-1" : "e1-1"], src: {at: [`${n}.2`], ch: "narrator"}}],
        episodes: [{id: `p${n}-1`, title: `第${n}件事`, summary: `林晚做第${n}件事。`, at: [`${n}.2`], time: `t${n}-1`, who: [{e: n >= 3 ? "e3-1" : "e1-1"}]}],
    }));
    const {dataset, issues} = compile({id: "arcs", title: "小书"}, sources, drafts, consolidations);
    return {dataset, errors: issues.filter(issue => issue.level === "error").map(issue => issue.message)};
}

const arc = (id: string, title: string, episodes: string[], status: "ongoing" | "closed" = "ongoing") => ({id, title, summary: `${title}的概括。`, episodes, status});

describe("增量整理稿合成一批主线（输出 5，queries 输出 1、13）", () => {
    let book: TestBook;
    afterAll(async () => {
        await book?.close();
    });

    test("沿用编号的是更新，没写到的照带，新编号是新主线；较早的位置看到旧版本", async () => {
        const {dataset, errors} = arcBook([
            {through: 2, base: 0, arcs: [arc("a2-1", "主线甲", ["p1-1"]), arc("a2-2", "主线乙", ["p2-1"]), arc("a2-3", "主线丁", ["p2-1"])]},
            // a2-1 追加 p3-1 并结束；a2-2 不加情节、只改概括与状态；a2-3 没写到，照带；a4-1 是新主线。
            {through: 4, base: 2, arcs: [arc("a2-1", "主线甲（续）", ["p3-1", "p1-1"], "closed"), {...arc("a2-2", "主线乙", [], "closed"), summary: "乙结束了。"}, arc("a4-1", "主线丙", ["p4-1"])]},
        ]);
        expect(errors).toEqual([]);
        expect(dataset.stats.written.arcs).toBe(6);
        book = await openTestBook("ingest-arcs", dataset);
        const arcsAt = async (chapter: number) => {
            const result = await book.ok("arcs.list", {book: "fox", at: {chapter}});
            return {through: result.through, arcs: result.arcs.map(item => [item.id, item.title, item.summary, item.status, item.episodes.join(",")])};
        };
        const early = {through: 2, arcs: [["a2-1", "主线甲", "主线甲的概括。", "ongoing", "p1-1"], ["a2-2", "主线乙", "主线乙的概括。", "ongoing", "p2-1"], ["a2-3", "主线丁", "主线丁的概括。", "ongoing", "p2-1"]]};
        expect(await arcsAt(2)).toEqual(early);
        expect(await arcsAt(3)).toEqual(early);
        expect(await arcsAt(4)).toEqual({
            through: 4,
            arcs: [
                ["a2-1", "主线甲（续）", "主线甲（续）的概括。", "closed", "p1-1,p3-1"],
                ["a2-2", "主线乙", "乙结束了。", "closed", "p2-1"],
                ["a2-3", "主线丁", "主线丁的概括。", "ongoing", "p2-1"],
                ["a4-1", "主线丙", "主线丙的概括。", "ongoing", "p4-1"],
            ],
        });
        const episodeArcs = async (chapter: number) => (await book.ok("episodes.list", {book: "fox", at: {chapter}})).items.map(item => [item.id, item.arcs.join(",")]);
        expect(await episodeArcs(3)).toEqual([["p1-1", "a2-1"], ["p2-1", "a2-2,a2-3"], ["p3-1", ""]]);
        expect(await episodeArcs(4)).toEqual([["p1-1", "a2-1"], ["p2-1", "a2-2,a2-3"], ["p3-1", "a2-1"], ["p4-1", "a4-1"]]);
        const arcLabel = async (chapter: number) => (await book.ok("graph.book", {book: "fox", at: {chapter}})).nodes.find(node => node.id === "a2-1")?.label;
        expect(await arcLabel(3)).toBe("主线甲");
        expect(await arcLabel(4)).toBe("主线甲（续）");
    });

    test("接错了批、引用不存在的编号、同一次写两次、新主线没有情节，都报错", () => {
        const first = {through: 2, base: 0, arcs: [arc("a2-1", "主线甲", ["p1-1"])]};
        expect(arcBook([first, {through: 4, base: 0, arcs: []}]).errors).toEqual(["整理稿接着第 0 章的主线，但最近一批主线是第 2 章的"]);
        expect(arcBook([first, {through: 4, base: 2, arcs: [arc("a3-7", "主线戊", ["p3-1"])]}]).errors).toEqual(["故事线 a3-7：编号里的章号应为 4"]);
        expect(arcBook([first, {through: 4, base: 2, arcs: [arc("a2-1", "主线甲", ["p3-1"]), arc("a2-1", "主线甲", ["p4-1"])]}]).errors).toEqual(["故事线 a2-1：同一次整理里写了两次"]);
        expect(arcBook([first, {through: 4, base: 2, arcs: [arc("a4-1", "主线戊", [])]}]).errors).toEqual(["故事线 a4-1：新主线没有情节"]);
    });

    test("旧的整批稿、0 条主线的旧批之后，增量接着最近一批有主线的", () => {
        const {dataset, errors} = arcBook([{through: 2, arcs: [arc("a2-1", "主线甲", ["p1-1"])]}, {through: 3, arcs: []}, {through: 4, base: 2, arcs: [arc("a2-1", "主线甲", ["p3-1"])]}]);
        expect(errors).toEqual([]);
        expect(dataset.arcs.filter(item => item.through === 4).map(item => [item.id, item.episodes])).toEqual([["a2-1", ["p1-1", "p3-1"]]]);
        expect(arcBook([{through: 2, arcs: [arc("a2-1", "主线甲", ["p1-1"])]}, {through: 3, arcs: []}, {through: 4, base: 3, arcs: []}]).errors).toEqual(["整理稿接着第 3 章的主线，但最近一批主线是第 2 章的"]);
    });

    test("先写的归纳在对象被后来合并后仍在合并后的对象上", async () => {
        const {dataset, errors} = arcBook([
            {through: 2, base: 0, summaries: [{entity: "e1-1", facet: "overview", items: [{text: "林晚是个做事的人。", deps: ["s1-1"]}]}]},
            {through: 4, base: 0, merges: [{keep: "e3-1", drop: "e1-1", reason: "第 3 章重复建了林晚"}]},
        ]);
        expect(errors).toEqual([]);
        const merged = await openTestBook("ingest-merged-summary", dataset);
        try {
            const card = await merged.ok("entity.card", {book: "fox", entity: "e3-1", at: {chapter: 4}});
            expect(card.facets.map(facet => [facet.facet, facet.items])).toEqual([["overview", ["林晚是个做事的人。"]]]);
        } finally {
            await merged.close();
        }
    });
});

describe("重要程度（输出 19）", () => {
    test("数字串转成数字，不合法的值只去掉这个字段、记录照常编进书；核对修复重写时漏写的沿用原记录的", async () => {
        const sample = await sampleDataset();
        const final = JSON.parse(gunzipSync(await readFile(FINAL)).toString("utf8")) as {drafts: RawDraft[]; consolidations: unknown[]};
        const raw = structuredClone(final.drafts[0]!) as {statements: Record<string, unknown>[]; episodes: Record<string, unknown>[]};
        const tiers: Record<string, unknown> = {"s1-1": "2", "s1-2": 0, "s1-3": 1, "s1-4": 1.5, "p1-1": "高", "p1-2": 3};
        for (const record of [...raw.statements, ...raw.episodes]) if ((record.id as string) in tiers) record.tier = tiers[record.id as string];
        const first = normalizeDraft(raw, 1);
        const compiled = compile(sample.book, sample.sources.slice(0, 1), [first], []);
        expect(compiled.issues.filter(issue => issue.level === "error")).toEqual([]);
        const byId = new Map<string, {tier?: number}>([...compiled.dataset.statements, ...compiled.dataset.episodes].map(record => [record.id, record]));
        expect(Object.keys(tiers).map(id => [id, byId.has(id), byId.get(id)?.tier])).toEqual([
            ["s1-1", true, 2],
            ["s1-2", true, undefined],
            ["s1-3", true, 1],
            ["s1-4", true, undefined],
            ["p1-1", true, undefined],
            ["p1-2", true, 3],
        ]);

        const rewritten = first.statements!.find(item => item.id === "s1-3")!;
        const {tier: _dropped, ...withoutTier} = rewritten;
        const patched = applyPatch(first, {replace: {statements: [{...withoutTier, text: "改写后的说法。"}, {...first.statements!.find(item => item.id === "s1-1")!, tier: 3}]}}, 1);
        expect(patched.statements!.find(item => item.id === "s1-3")).toMatchObject({text: "改写后的说法。", tier: 1});
        expect(patched.statements!.find(item => item.id === "s1-1")!.tier).toBe(3);
    });
});
