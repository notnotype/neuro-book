import {createHash} from "node:crypto";

import {rm} from "node:fs/promises";

import {describe, expect, test} from "bun:test";
import {GREGORIAN, type Calendar} from "@notnotype/nb-time";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, ChapterOrder, type Entry, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {DEFAULT_TIME} from "../src/time/network";
import {openTestService} from "./fixtures/service";
import {PERSON} from "./fixtures/world";

const TEXT: Record<string, string> = {ch1: "那天下了雨。", ch2: "三天后她走了。"};
function options(extra: Partial<WorldOptions> = {}): WorldOptions {
    return {order: new ChapterOrder(["ch1", "ch2"]), registry: buildRegistry([PERSON]), reductions: () => undefined, chapterText: (chapter) => TEXT[chapter], digest: (text) => createHash("sha256").update(text).digest("hex"), ...extra};
}
let sequence = 0;
const request = (puts: WriteRequest["puts"], baseVersion: number): WriteRequest => ({requestId: `time-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "时间", baseVersion, puts});
function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}
const problems = (result: WriteResult) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => [problem.code, problem.path]) : [JSON.stringify(result.ok ? "ok" : result.failure)]);
const person = (id: string, name: string): Entry => ({id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {}}});
const change = (id: string, at: StoryChangeDraft["at"], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft => ({id, kind: "written", text: id, at, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, ...extra});
const author = {kind: "author"} as const;
const date = (year: number, month?: number, day?: number) => ({kind: "date" as const, year, ...(month === undefined ? {} : {month: `m${String(month)}`}), ...(day === undefined ? {} : {day}), basis: author});

/** 星瑕；第 1 章一件事 c1（定在 2012 年 6 月 3 日）。 */
function start(extra: Partial<WorldOptions> = {}) {
    const first = ok(World.empty(options(extra)).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}, {ref: {kind: "change", id: "tmp:c1"}, after: change("tmp:c1", {kind: "chapter", chapter: "ch1", key: 0}, {when: [date(2012, 6, 3)]})}], 0), "t"));
    return {world: first.world, xia: first.ids["tmp:xia"]!, c1: first.ids["tmp:c1"]!};
}

describe("canon.time 输出 9：写入时的校验", () => {
    test("of 不存在、of 是叙述、of 是自己、who 不存在、依据的讲述不在 told 里、叙述带说法、日期不连续、间隔倒着：都是 invalid-time", () => {
        const {world, c1} = start();
        const narration = ok(world.publish(request([{ref: {kind: "change", id: "tmp:n"}, after: change("tmp:n", {kind: "chapter", chapter: "ch1", key: 5}, {nature: "narration", told: [{source: "chapter", chapter: "ch1", quote: "那天下了雨"}]})}], 1), "t"));
        const n = narration.ids["tmp:n"]!;
        const write = (when: unknown[], extra: Partial<StoryChangeDraft> = {}) => narration.world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", {kind: "chapter", chapter: "ch2", key: 0}, {when: when as StoryChangeDraft["when"], ...extra})}], 2), "t");
        expect(problems(write([{kind: "after", of: "c404", basis: author}]))).toEqual([["invalid-time", "when[0].of"]]);
        expect(problems(write([{kind: "after", of: n, basis: author}]))).toEqual([["invalid-time", "when[0].of"]]);
        expect(problems(write([{kind: "age", who: "e404", years: {min: 1, max: 1}, basis: author}]))).toEqual([["invalid-time", "when[0].who"]]);
        expect(problems(write([{kind: "after", of: c1, basis: {kind: "telling", id: "t404"}}]))).toEqual([["invalid-time", "when[0].basis"]]);
        expect(problems(write([{kind: "date", year: 2012, day: 3, basis: author}]))).toEqual([["invalid-time", "when[0]"]]);
        expect(problems(write([{kind: "after", of: c1, gap: {min: 5, max: 2, unit: "day"}, basis: author}]))).toEqual([["invalid-time", "when[0]"]]);
        expect(problems(write([date(2012)], {nature: "narration", told: [{source: "chapter", chapter: "ch2", quote: "三天后她走了"}]}))).toEqual([["invalid-time", "when"]]);
        const self = world.data.changes.get(c1)!;
        expect(problems(world.publish(request([{ref: {kind: "change", id: c1}, after: {...structuredClone(self), when: [{kind: "after", of: c1, basis: author}]}}], 1), "t"))).toEqual([["invalid-time", "when[0]"]]);
    });

    test("原样留着的说法不再查：改成以天为最小单位的历法以后，带时刻的旧说法照样能随变更改别的字段", () => {
        const {world} = start();
        const timed = ok(world.publish(request([{ref: {kind: "change", id: "tmp:h"}, after: change("tmp:h", {kind: "chapter", chapter: "ch2", key: 0}, {when: [{kind: "date", year: 2012, month: "m6", day: 6, hour: 9, basis: author}]})}], 1), "t"));
        const id = timed.ids["tmp:h"]!;
        const coarse: Calendar = {...GREGORIAN, unit: "day"};
        const later = timed.world.withOptions({...timed.world.options, time: {...DEFAULT_TIME, calendar: coarse}});
        const renamed = {...structuredClone(later.data.changes.get(id)!), text: "改了描述"};
        expect(later.publish(request([{ref: {kind: "change", id}, after: renamed}], 2), "t").ok).toBe(true);
        const added = {...renamed, when: [...renamed.when!, {kind: "date" as const, year: 2012, month: "m6", day: 6, hour: 10, basis: author}]};
        expect(problems(later.publish(request([{ref: {kind: "change", id}, after: added}], 2), "t"))).toEqual([["invalid-time", "when[1]"]]);
    });

    test("依据按这次请求里 told 的下标写：存下时换成那条讲述的 id", () => {
        const {world, c1} = start();
        const written = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", {kind: "chapter", chapter: "ch2", key: 0}, {told: [{source: "chapter", chapter: "ch2", quote: "三天后她走了"}], when: [{kind: "after", of: c1, gap: {min: 3, max: 3, unit: "day"}, quote: "三天后", basis: {kind: "telling", told: 0} as never}]})}], 1), "t"));
        const stored = written.world.data.changes.get(written.ids["tmp:x"]!)!;
        expect(stored.when![0]!.basis).toEqual({kind: "telling", id: stored.told[0]!.id});
        // 删掉被原样留着的说法当依据的那条讲述：拒收（依据的讲述每次都查，不随历法变）。
        expect(problems(written.world.publish(request([{ref: {kind: "change", id: stored.id}, after: {...structuredClone(stored), told: []}}], 2), "t"))).toEqual([["invalid-time", "when[0].basis"]]);
    });

    test("一件事最多一条出生：新的一条插在旧的前面也拒收", () => {
        const {world, xia} = start();
        const other = ok(world.publish(request([{ref: {kind: "entry", id: "tmp:jin"}, after: person("tmp:jin", "星瑾")}, {ref: {kind: "change", id: "tmp:b"}, after: change("tmp:b", {kind: "prehistory", order: 0}, {when: [{kind: "birth", who: xia, basis: author}]})}], 1), "t"));
        const born = other.world.data.changes.get(other.ids["tmp:b"]!)!;
        const twin = {kind: "birth" as const, who: other.ids["tmp:jin"]!, basis: author};
        expect(problems(other.world.publish(request([{ref: {kind: "change", id: born.id}, after: {...structuredClone(born), when: [twin, ...born.when!]}}], 2), "t"))).toEqual([["invalid-time", "when[0]"]]);
        expect(problems(other.world.publish(request([{ref: {kind: "change", id: born.id}, after: {...structuredClone(born), when: [...born.when!, twin]}}], 2), "t"))).toEqual([["invalid-time", "when[1]"]]);
    });
});

describe("canon.time 输出 7：前史的先后", () => {
    const prehistory = (id: string, when: StoryChangeDraft["when"], order?: number): WriteRequest["puts"][number] => ({ref: {kind: "change", id}, after: change(id, {kind: "prehistory", ...(order === undefined ? {} : {order})} as StoryChangeDraft["at"], {when})});
    const orderOf = (world: World, id: string) => (world.data.changes.get(id)!.at as {order: number}).order;

    test("没给 order 的前史按最早时间插进已有前史；比可比的都早排到最前；没有绝对时间的放最后；给了的照留", () => {
        const {world} = start();
        const base = ok(world.publish(request([prehistory("tmp:a", [date(1990)], 10), prehistory("tmp:b", [date(2000)], 20)], 1), "t"));
        const [a, b] = [base.ids["tmp:a"]!, base.ids["tmp:b"]!];
        const middle = ok(base.world.publish(request([prehistory("tmp:m", [date(1995)])], 2), "t"));
        expect(orderOf(middle.world, middle.ids["tmp:m"]!)).toBe(15);
        const earliest = ok(middle.world.publish(request([prehistory("tmp:e", [date(1980)])], 3), "t"));
        expect(orderOf(earliest.world, earliest.ids["tmp:e"]!)).toBe(9);
        const timeless = ok(earliest.world.publish(request([prehistory("tmp:t", [])], 4), "t"));
        expect(orderOf(timeless.world, timeless.ids["tmp:t"]!)).toBe(21);
        expect([orderOf(timeless.world, a), orderOf(timeless.world, b)]).toEqual([10, 20]);
        // 存下来的修订里是算好的 order，重放得到同样的世界。
        expect(World.replay(timeless.world.revisions, options()).data.changes.get(middle.ids["tmp:m"]!)!.at).toEqual({kind: "prehistory", order: 15});
    });
});

describe("canon.revisions 输出 12 的时间部分：说法指的变更是引用", () => {
    test("后面的修订里有说法指向前一次新建的变更：还原前一次时它是依赖", () => {
        const {world, c1} = start();
        const created = ok(world.publish(request([{ref: {kind: "change", id: "tmp:y"}, after: change("tmp:y", {kind: "chapter", chapter: "ch1", key: 9})}], 1), "t"));
        const y = created.ids["tmp:y"]!;
        const later = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:z"}, after: change("tmp:z", {kind: "chapter", chapter: "ch2", key: 0}, {when: [{kind: "after", of: y, basis: author}]})}], 2), "t"));
        expect(later.world.dependents(created.revision.id)).toEqual([created.revision.id, later.revision.id]);
        expect(c1).toBeString();
    });
});

describe("canon.model 输出 16、canon.time 输出 2、3、5、14：时间的待处理", () => {
    const at = (chapter: string, key: number) => ({kind: "chapter" as const, chapter, key});
    /** 第 1 章：a 在 b 之后三天、b 在 a 之后（打架）；一条日期写了不存在的月（不成立）。第 2 章一件说在第 1 章那件之前一年（对不上）。 */
    test("打架、不成立、对不上各成一项，排在内核的几种之后；随读取位置截取：所涉的事都在读取位置之前的才列", () => {
        const {world, c1} = start();
        const day = {min: 3, max: 3, unit: "day" as const};
        const conflict = ok(world.publish(request([
            {ref: {kind: "change", id: "tmp:a"}, after: change("tmp:a", at("ch1", 10), {when: [{kind: "after", of: "tmp:b", gap: day, basis: author}]})},
            {ref: {kind: "change", id: "tmp:b"}, after: change("tmp:b", at("ch1", 20), {when: [{kind: "after", of: "tmp:a", basis: author}]})},
            {ref: {kind: "change", id: "tmp:bad"}, after: change("tmp:bad", at("ch1", 30), {when: [{kind: "date", year: 2012, month: "m13", basis: author}]})},
            {ref: {kind: "change", id: "tmp:late"}, after: change("tmp:late", at("ch2", 0), {when: [{kind: "before", of: c1, gap: {min: 1, max: 1, unit: "year"}, basis: author}]})},
        ], 1), "t"));
        const kinds = (position: Parameters<World["pending"]>[0]) => {
            const items = conflict.world.pending(position);
            return items === "chapter-not-found" ? [] : items.map((item) => item.kind);
        };
        expect(kinds({kind: "chapter", chapter: "ch2", edge: "end"}).sort()).toEqual(["time-conflict", "time-invalid", "time-placement-mismatch"]);
        // 第 1 章末尾：对不上牵涉第 2 章那件，还没到。
        expect(kinds({kind: "chapter", chapter: "ch1", edge: "end"}).sort()).toEqual(["time-conflict", "time-invalid"]);
        expect(conflict.revision.impact.pendingAdded.filter((key) => key.startsWith("time-")).map((key) => key.split(":")[0])).toEqual(["time-conflict", "time-invalid", "time-mismatch"]);
    });

    test("截取看所涉的全部事：环经过第 2 章的事、第二件出生事件在第 2 章时，第 1 章末尾不列；章序调整没碰到环时打架的键不变", () => {
        const {world, xia} = start();
        const exactly = (days: number) => ({min: days, max: days, unit: "day" as const});
        // 第 2 章的 x 没有说法；第 1 章的 a 在 x 之后三天、b 在 x 之后五天、b 在 a 之前：环经过 x。
        // 星瑕的出生事件一件在第 1 章、一件在第 2 章；第 1 章另一件事写她三岁：birth-ambiguous 牵涉第 2 章那件。
        const written = ok(world.publish(request([
            {ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", at("ch2", 5))},
            {ref: {kind: "change", id: "tmp:a"}, after: change("tmp:a", at("ch1", 10), {when: [{kind: "after", of: "tmp:x", gap: exactly(3), basis: author}]})},
            {ref: {kind: "change", id: "tmp:b"}, after: change("tmp:b", at("ch1", 20), {when: [{kind: "after", of: "tmp:x", gap: exactly(5), basis: author}, {kind: "before", of: "tmp:a", basis: author}]})},
            {ref: {kind: "change", id: "tmp:born"}, after: change("tmp:born", at("ch1", 30), {when: [{kind: "birth", who: xia, basis: author}]})},
            {ref: {kind: "change", id: "tmp:age"}, after: change("tmp:age", at("ch1", 40), {when: [{kind: "age", who: xia, years: {min: 3, max: 3}, basis: author}]})},
            {ref: {kind: "change", id: "tmp:again"}, after: change("tmp:again", at("ch2", 10), {when: [{kind: "birth", who: xia, basis: author}]})},
            // 说法分在两章的环：p 在 q 之后至少一天、q 在 p 之后正好五天。
            {ref: {kind: "change", id: "tmp:p"}, after: change("tmp:p", at("ch1", 50), {when: [{kind: "after", of: "tmp:q", gap: {min: 1, max: 9, unit: "day"}, basis: author}]})},
            {ref: {kind: "change", id: "tmp:q"}, after: change("tmp:q", at("ch2", 20), {when: [{kind: "after", of: "tmp:p", gap: exactly(5), basis: author}]})},
        ], 1), "t"));
        const listed = (world: World, chapter: string) => {
            const items = world.pending({kind: "chapter", chapter, edge: "end"});
            return items === "chapter-not-found" ? [] : items.map((item) => item.kind).sort();
        };
        expect(listed(written.world, "ch1")).toEqual([]);
        expect(listed(written.world, "ch2")).toEqual(["time-conflict", "time-conflict", "time-invalid"]);
        const swapped = written.world.reorder(new ChapterOrder(["ch2", "ch1"]), "t", "swap-keys");
        if (swapped === null || !swapped.ok) throw new Error("no reorder");
        expect([...swapped.revision.impact.pendingAdded, ...swapped.revision.impact.pendingResolved].filter((key) => key.startsWith("time-conflict"))).toEqual([]);
    });

    test("改历法：存下来的说法不改，范围与不成立按新的重算（输出 4）", () => {
        const {world} = start();
        const without = world.withOptions({...world.options, time: {...DEFAULT_TIME, calendar: {...GREGORIAN, months: GREGORIAN.months.filter((month) => month.id !== "m6"), leap: []}}});
        const items = without.pending({kind: "chapter", chapter: "ch2", edge: "end"});
        expect(items !== "chapter-not-found" && items.map((item) => [item.kind, "reason" in item ? item.reason : null])).toEqual([["time-invalid", "month-missing"]]);
        expect(world.pending({kind: "chapter", chapter: "ch2", edge: "end"})).toEqual([]);
    });

    test("章序调整让安放与时间对不上：记进那次修订的带来的变化", () => {
        const {world, c1} = start();
        const later = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", at("ch2", 0), {when: [{kind: "after", of: c1, gap: {min: 1, max: 1, unit: "day"}, basis: author}]})}], 1), "t"));
        const swapped = later.world.reorder(new ChapterOrder(["ch2", "ch1"]), "t", "swap");
        if (swapped === null || !swapped.ok) throw new Error("no reorder");
        expect(swapped.revision.impact.pendingAdded).toEqual([`time-mismatch:${c1}`]);
    });
});

describe("canon.time 输出 13、16：作品设置里的历法", () => {
    test("不合法时用内置公历并给诊断；合法以后用它；再不合法时用最近一次合法的；词表不合法的项作废；修好以后诊断消失；清空设置回到公历", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "settings");
        const service = await openTestService(root, {texts: new Map([["ch1", "那天下了雨。"]]), chapters: ["ch1"], registry: buildRegistry([PERSON])});
        try {
            const codes = () => service.status().diagnostics.flatMap((item) => (item.code === "calendar-invalid" ? [`calendar-invalid:${item.using}`] : item.code === "fuzzy-word-invalid" ? ["fuzzy-word-invalid"] : []));
            const royal: Calendar = {...GREGORIAN, version: 2, eras: [{id: "royal", name: "王历", start: 1}]};
            expect(await service.setTime({calendar: {...royal, months: []}})).toMatchObject({calendar: GREGORIAN, valid: false});
            expect(codes()).toEqual(["calendar-invalid:builtin"]);
            const before = service.snapshot().stamp.inputDigest;
            expect((await service.setTime({calendar: royal, fuzzy: {words: {片刻: {min: 9, max: 1, unit: "minute"}}}})).valid).toBe(true);
            expect(codes()).toEqual(["fuzzy-word-invalid"]);
            expect(service.snapshot().stamp.inputDigest).not.toBe(before);
            expect(await service.setTime({calendar: {...royal, version: 0}})).toMatchObject({calendar: royal, valid: false});
            expect(codes()).toEqual(["calendar-invalid:previous"]);
            await service.setTime({calendar: royal});
            expect(codes()).toEqual([]);
            // 清空设置：回到公历（不填时用公历），之后再写坏的用内置公历，不再用清空之前的那份；存下的旧历法也不再作数。
            expect(await service.setTime({calendar: undefined, previous: royal})).toEqual({calendar: GREGORIAN, valid: true});
            expect(await service.setTime({calendar: {...royal, months: []}})).toMatchObject({calendar: GREGORIAN, valid: false});
            expect(codes()).toEqual(["calendar-invalid:builtin"]);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.time 输出 8、15：服务的时间查询与视图", () => {
    test("一章给范围、定下两端的事与它们的依据和各级；不可确定给打架的说法；按纪逐级浏览并给这一级的事；带令牌的列表照样分页", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "answers");
        const service = await openTestService(root, {texts: new Map([["ch1", "那年。"], ["ch2", "后来。"]]), chapters: ["ch1", "ch2"], registry: buildRegistry([PERSON])});
        try {
            const at = (key: number) => ({kind: "chapter" as const, chapter: "ch1", key});
            const puts: WriteRequest["puts"] = Array.from({length: 30}, (_, index) => ({ref: {kind: "change" as const, id: `tmp:d${String(index)}`}, after: change(`tmp:d${String(index)}`, at(index), {when: [date(2012, 6, 1 + (index % 28))]})}));
            puts.push({ref: {kind: "change", id: "tmp:p"}, after: change("tmp:p", at(40), {when: [{kind: "after", of: "tmp:q", basis: author}]})});
            puts.push({ref: {kind: "change", id: "tmp:q"}, after: change("tmp:q", at(41), {when: [{kind: "after", of: "tmp:p", gap: {min: 1, max: 1, unit: "day"}, basis: author}]})});
            const written = await service.publish({requestId: "a1", by: author, what: "edit", title: "许多", baseVersion: 0, puts});
            if (!written.ok) throw new Error(JSON.stringify(written.failure));
            const answer = (read: ReturnType<typeof service.time>) => {
                if (read === "cursor-stale") throw new Error(read);
                return read.answer as Record<string, unknown>;
            };
            const chapter = answer(service.time({kind: "chapter", chapter: "ch1"}));
            expect(chapter).toMatchObject({text: "公元2012年6月", from: {year: 2012, month: {id: "m6"}}, anchored: 30, conflict: 2, earliest: {total: 1}, latest: {total: 1}});
            expect(typeof chapter.earliestBy).toBe("string");
            const conflicted = answer(service.time({kind: "event", change: written.ids["tmp:p"]!}));
            expect((conflicted.start as {state: string; statements: string[]}).statements).toHaveLength(2);
            expect(answer(service.time({kind: "browse"}))).toMatchObject({units: [{key: "ad", sure: 30}], total: 1});
            expect(answer(service.time({kind: "browse", era: "ad"}))).toMatchObject({units: [{key: 2012, sure: 30, from: {year: 2012}}]});
            const browsed = service.time({kind: "browse", year: 2012}, "actual", undefined, 10);
            expect(browsed !== "cursor-stale" && (browsed.answer as {items: unknown[]}).items).toHaveLength(10);
            const opened = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch2", edge: "start"}, purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const june = {kind: "during" as const, from: {year: 2012, month: "m6"}, to: {year: 2012, month: "m6"}};
            const first = service.viewed(opened.token).time(june, "actual", undefined, 20);
            if (typeof first === "string") throw new Error(first);
            expect((first.answer as {items: unknown[]}).items).toHaveLength(20);
            const rest = service.viewed(opened.token).time(june, "actual", first.cursor, 20);
            expect(typeof rest !== "string" && (rest.answer as {items: unknown[]}).items).toHaveLength(10);
            // 游标带着令牌的上限：拿去不带令牌接着翻是另一组参数。
            expect(service.time(june, "actual", first.cursor, 20)).toBe("cursor-stale");
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });

    test("事件的范围按历法写；带视图令牌时只用上限之前的事建网，上限之后的说法不收窄可见的事；点名上限之后的事被拒并记审计", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "query");
        const texts = new Map([["ch1", "那年。"], ["ch2", "第二天。"]]);
        const service = await openTestService(root, {texts, chapters: ["ch1", "ch2"], registry: buildRegistry([PERSON])});
        try {
            const first = await service.publish({requestId: "q1", by: author, what: "edit", title: "x", baseVersion: 0, puts: [{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", {kind: "chapter", chapter: "ch1", key: 0}, {when: [date(2012)]})}]});
            if (!first.ok) throw new Error(JSON.stringify(first.failure));
            const x = first.ids["tmp:x"]!;
            const second = await service.publish({requestId: "q2", by: author, what: "edit", title: "y", baseVersion: 1, puts: [{ref: {kind: "change", id: "tmp:y"}, after: change("tmp:y", {kind: "chapter", chapter: "ch2", key: 0}, {when: [date(2012, 6, 5), {kind: "after", of: x, gap: {min: 1, max: 1, unit: "day"}, basis: author}]})}]});
            if (!second.ok) throw new Error(JSON.stringify(second.failure));
            const y = second.ids["tmp:y"]!;
            const plain = service.time({kind: "event", change: x});
            // 不带视图：第 2 章那件说 X 早它一天，X 收窄到 6 月 4 日。
            expect(plain !== "cursor-stale" && (plain.answer as {start: {text: string}}).start.text).toBe("公元2012年6月4日");
            const opened = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch2", edge: "start"}, purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const viewed = service.viewed(opened.token);
            const bounded = viewed.time({kind: "event", change: x});
            // 带视图（上限第 2 章开头）：第 2 章那件不在网络里，X 仍是整个 2012 年。
            expect(typeof bounded !== "string" && (bounded.answer as {start: {text: string}}).start.text).toBe("公元2012年");
            expect(viewed.time({kind: "event", change: y})).toBe("view-denied");
            const audit = service.viewAudit();
            expect(audit !== "cursor-stale" && audit.items.map((item) => item.method)).toEqual(["time"]);
            expect(service.time({kind: "calendar"})).toMatchObject({answer: {kind: "calendar", unit: "minute"}});
            // 按计划模式带令牌：计划的进展按上限算。第 1 章的计划在第 2 章才兑现：不带视图时它已兑现、不在网络里，带视图时还未兑现、在。
            const planned = await service.publish({requestId: "q3", by: author, what: "edit", title: "计划", baseVersion: 2, puts: [
                {ref: {kind: "change", id: "tmp:p"}, after: change("tmp:p", {kind: "chapter", chapter: "ch1", key: 9}, {kind: "plan", when: [date(2012, 3)]})},
                {ref: {kind: "change", id: "tmp:f"}, after: change("tmp:f", {kind: "chapter", chapter: "ch2", key: 9}, {links: [{kind: "fulfills", plan: "tmp:p"}]})},
            ]});
            if (!planned.ok) throw new Error(JSON.stringify(planned.failure));
            const p = planned.ids["tmp:p"]!;
            const whole = service.time({kind: "event", change: p}, "planned");
            expect(whole !== "cursor-stale" && (whole.answer as {start: {state: string}}).start.state).toBe("unconstrained");
            const window = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch2", edge: "start"}, purpose: "writer"});
            if (typeof window === "string" || !("token" in window)) throw new Error(JSON.stringify(window));
            const early = service.viewed(window.token).time({kind: "event", change: p}, "planned");
            expect(typeof early !== "string" && (early.answer as {start: {text: string}}).start.text).toBe("公元2012年3月");
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.time 输出 1、14、15、17：事件集与键（计划审查 P4 的 omp 份）", () => {
    const at = (chapter: string, key: number) => ({kind: "chapter" as const, chapter, key});

    test("同一变更里两条完全相同的不成立说法各成一项（键带出现序号）", () => {
        const {world} = start();
        const twice = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", at("ch1", 5), {when: [date(2012, 13), date(2012, 13)].map((statement) => ({...statement, month: "m13"}))})}], 1), "t"));
        const keys = twice.revision.impact.pendingAdded.filter((key) => key.startsWith("time-invalid"));
        expect(keys).toHaveLength(2);
        expect(new Set(keys).size).toBe(2);
    });

    test("所在章删了的已写变更不算事件：指向它的说法跳过、不报", () => {
        const {world, c1} = start();
        const later = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", at("ch2", 0), {when: [{kind: "after", of: c1, gap: {min: 1, max: 1, unit: "day"}, basis: author}]})}], 1), "t"));
        const dropped = later.world.withOptions({...later.world.options, order: new ChapterOrder(["ch2"])});
        expect(dropped.time().built.network.component(c1)).toBeUndefined();
        expect(dropped.time().items).toEqual([]);
        expect(dropped.time().built.network.range(later.ids["tmp:x"]!)).toEqual({state: "unconstrained"});
    });

    test("按计划模式：登记换了、兑现变更不再套得上，计划回到未兑现、进事件集（缓存键带计划集合）", () => {
        const {world} = start();
        const hero: Entry = {...person("tmp:h", "勇者"), init: {name: "勇者", aliases: [], summary: "", text: [], data: {character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}}}}};
        const planned = ok(world.publish(request([
            {ref: {kind: "entry", id: "tmp:h"}, after: hero},
            {ref: {kind: "change", id: "tmp:p"}, after: change("tmp:p", at("ch2", 0), {kind: "plan", when: [date(2012, 7)]})},
            {ref: {kind: "change", id: "tmp:w"}, after: change("tmp:w", at("ch2", 5), {links: [{kind: "fulfills", plan: "tmp:p"}], patches: [{op: "set", at: {entry: "tmp:h", path: "character.状态"}, value: "走了"}]})},
        ], 1), "t"));
        const plan = planned.ids["tmp:p"]!;
        expect(planned.world.time("planned").built.network.component(plan)).toBeUndefined();
        // “状态”改成数字字段：兑现变更写的文字套不上了（数据没变，引擎随登记重建）。
        const broken = planned.world.withOptions({...planned.world.options, registry: buildRegistry([{...PERSON, fields: (PERSON.fields ?? []).map((field) => (field.id === "状态" ? {id: "状态", label: "状态", kind: "number" as const} : field))}])});
        expect(broken.time("planned").built.network.component(plan)).toBeDefined();
    });
});
