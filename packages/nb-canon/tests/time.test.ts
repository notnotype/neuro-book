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
            return typeof items === "string" ? [] : items.map((item) => item.kind);
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
            return typeof items === "string" ? [] : items.map((item) => item.kind).sort();
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
        expect(typeof items !== "string" && items.map((item) => [item.kind, "reason" in item ? item.reason : null])).toEqual([["time-invalid", "month-missing"]]);
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
                if (typeof read === "string") throw new Error(read);
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
            expect(typeof browsed !== "string" && (browsed.answer as {items: unknown[]}).items).toHaveLength(10);
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
            expect(typeof plain !== "string" && (plain.answer as {start: {text: string}}).start.text).toBe("公元2012年6月4日");
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
            expect(typeof whole !== "string" && (whole.answer as {start: {state: string}}).start.state).toBe("unconstrained");
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

describe("canon.time 输出 6、14、15、17：回溯与线", () => {
    const CH = ["ch1", "ch2", "ch3", "ch4"];
    const after = (of: string, days: number) => ({kind: "after" as const, of, gap: {min: days, max: days, unit: "day" as const}, basis: author});
    const lineOptions = () => options({order: new ChapterOrder(CH)});
    /** 主线第 2 章 c1、c2（c1 后一天）、c3（c2 后两天）；回溯线 r 从 c1 切、由 c3 触发，往回 12 小时；r 上第 3 章一件事 own（c1 后一天）。 */
    function rollback(back = {min: 12, max: 12, unit: "hour" as const}) {
        const first = ok(World.empty(lineOptions()).publish(request([
            {ref: {kind: "change", id: "tmp:c1"}, after: change("tmp:c1", {kind: "chapter", chapter: "ch2", key: 10})},
        ], 0), "t"));
        const c1 = first.ids["tmp:c1"]!;
        const second = ok(first.world.publish(request([{ref: {kind: "change", id: "tmp:c2"}, after: change("tmp:c2", {kind: "chapter", chapter: "ch2", key: 20}, {when: [after(c1, 1)]})}], 1), "t"));
        const c2 = second.ids["tmp:c2"]!;
        const third = ok(second.world.publish(request([{ref: {kind: "change", id: "tmp:c3"}, after: change("tmp:c3", {kind: "chapter", chapter: "ch2", key: 30}, {when: [after(c2, 2)]})}], 2), "t"));
        const c3 = third.ids["tmp:c3"]!;
        const forked = ok(third.world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: change("tmp:f", {kind: "chapter", chapter: "ch2", key: 35}, {nature: "fork", fork: {line: "tmp:r", name: "回溯", parent: "main", cut: c1, trigger: c3, back, type: "rollback"}} as never)},
            {ref: {kind: "change", id: "tmp:own"}, after: change("tmp:own", {kind: "chapter", chapter: "ch3", key: 1, line: "tmp:r"}, {when: [after(c1, 1)]})},
        ], 3), "t"));
        return {world: forked.world, c1, c2, c3, line: forked.ids["tmp:r"]!, fork: forked.ids["tmp:f"]!, own: forked.ids["tmp:own"]!};
    }

    test("改分叉的 back：子线视图的记录没变，时间照样按新的往回多久重算", () => {
        const {world, fork, line} = rollback();
        const mismatches = (target: World) => target.time("actual", line).items.filter((item) => item.kind === "fork-time-mismatch");
        expect(mismatches(world)).toEqual([]);
        // c3 比切口 c1 晚三天：往回一百小时就回到了切口之前。
        const stored = structuredClone(world.data.changes.get(fork)!);
        (stored as {fork: {back: unknown}}).fork.back = {min: 100, max: 100, unit: "hour"};
        const moved = ok(world.publish(request([{ref: {kind: "change", id: fork}, after: stored}], world.version), "t"));
        expect(mismatches(moved.world)).toMatchObject([{kind: "fork-time-mismatch", reason: "cut-after-back"}]);
    });

    test("写在子线上引起的打架进那次修订的“带来的变化”", () => {
        const {world, c1, line} = rollback();
        const clash = ok(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", {kind: "chapter", chapter: "ch3", key: 5, line}, {when: [after(c1, 1), {kind: "before", of: c1, gap: {min: 1, max: 1, unit: "day"}, basis: author}]})}], world.version), "t"));
        expect(clash.revision.impact.pendingAdded.filter((key) => key.startsWith("time-conflict"))).toHaveLength(1);
    });

    test("`of` 指向存在、但不在这条线视图里的变更：不报；真不存在才报 target-missing", () => {
        const first = ok(World.empty(lineOptions()).publish(request([
            {ref: {kind: "change", id: "tmp:c1"}, after: change("tmp:c1", {kind: "chapter", chapter: "ch2", key: 10})},
            {ref: {kind: "change", id: "tmp:c2"}, after: change("tmp:c2", {kind: "chapter", chapter: "ch2", key: 20})},
            {ref: {kind: "change", id: "tmp:c3"}, after: change("tmp:c3", {kind: "chapter", chapter: "ch2", key: 30})},
        ], 0), "t"));
        const [c1, c2, c3] = [first.ids["tmp:c1"]!, first.ids["tmp:c2"]!, first.ids["tmp:c3"]!];
        const forked = ok(first.world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: change("tmp:f", {kind: "chapter", chapter: "ch2", key: 40}, {nature: "fork", fork: {line: "tmp:l", name: "分支", parent: "main", cut: c3, type: "branch"}} as never)},
            {ref: {kind: "change", id: "tmp:own"}, after: change("tmp:own", {kind: "chapter", chapter: "ch3", key: 1, line: "tmp:l"}, {when: [after(c2, 1)]})},
        ], 1), "t"));
        const line = forked.ids["tmp:l"]!;
        const fork = structuredClone(forked.world.data.changes.get(forked.ids["tmp:f"]!)!);
        (fork as {fork: {cut: string}}).fork.cut = c1;
        const moved = ok(forked.world.publish(request([{ref: {kind: "change", id: fork.id}, after: fork}], 2), "t"));
        expect(moved.world.time("actual", line).items.filter((item) => item.kind === "time-invalid")).toEqual([]);
    });

    test("带令牌的查询：回溯到的那一刻照样进网络，与不带令牌答得一样", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "bounded-rollback");
        const service = await openTestService(root, {texts: new Map(CH.map((chapter) => [chapter, ""])), chapters: CH, registry: buildRegistry([PERSON])});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const c1 = (await publish([{ref: {kind: "change", id: "tmp:c1"}, after: change("tmp:c1", {kind: "chapter", chapter: "ch2", key: 10})}]))["tmp:c1"]!;
            const c2 = (await publish([{ref: {kind: "change", id: "tmp:c2"}, after: change("tmp:c2", {kind: "chapter", chapter: "ch2", key: 20}, {when: [after(c1, 1)]})}]))["tmp:c2"]!;
            const c3 = (await publish([{ref: {kind: "change", id: "tmp:c3"}, after: change("tmp:c3", {kind: "chapter", chapter: "ch2", key: 30}, {when: [after(c2, 2)]})}]))["tmp:c3"]!;
            const ids = await publish([
                {ref: {kind: "change", id: "tmp:f"}, after: change("tmp:f", {kind: "chapter", chapter: "ch2", key: 35}, {nature: "fork", fork: {line: "tmp:r", name: "回溯", parent: "main", cut: c1, trigger: c3, back: {min: 12, max: 12, unit: "hour"}, type: "rollback"}} as never)},
                {ref: {kind: "change", id: "tmp:own"}, after: change("tmp:own", {kind: "chapter", chapter: "ch3", key: 1, line: "tmp:r"}, {when: [after(c1, 1)]})},
            ]);
            const line = ids["tmp:r"]!;
            const own = ids["tmp:own"]!;
            const plain = service.time({kind: "event", change: own}, "actual", undefined, 50, line);
            const opened = service.openView({viewer: null, line, until: {kind: "chapter", chapter: "ch4", edge: "end"}, purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const bounded = service.viewed(opened.token).time({kind: "event", change: own});
            expect(JSON.stringify(bounded)).toBe(JSON.stringify(plain));
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.time 输出 8、12（补）：服务的两件事相差多久与某人几岁", () => {
    test("between 与 age：马甲归本体；几条年龄说法打架答 15 到 16 岁并带 time-age-disagree；没有年龄说法时由出生推；网络里没有的事、没有的人得 not-found", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "between-age");
        const service = await openTestService(root, {texts: new Map([["ch1", "那年。"], ["ch2", "后来。"]]), chapters: ["ch1", "ch2"], registry: buildRegistry([PERSON])});
        try {
            const opened = await service.publish({requestId: "ba1", by: author, what: "edit", title: "人", baseVersion: 0, puts: [
                {ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")},
                {ref: {kind: "entry", id: "tmp:small"}, after: {...person("tmp:small", "小星"), sameAs: "tmp:xia"}},
                {ref: {kind: "entry", id: "tmp:jin"}, after: person("tmp:jin", "星瑾")},
                {ref: {kind: "entry", id: "tmp:junior"}, after: {...person("tmp:junior", "小瑾"), sameAs: "tmp:jin"}},
            ]});
            if (!opened.ok) throw new Error(JSON.stringify(opened.failure));
            const [xia, small, jin, junior] = [opened.ids["tmp:xia"]!, opened.ids["tmp:small"]!, opened.ids["tmp:jin"]!, opened.ids["tmp:junior"]!];
            const at = (chapter: string, key: number) => ({kind: "chapter" as const, chapter, key});
            const story = await service.publish({requestId: "ba2", by: author, what: "edit", title: "事", baseVersion: 1, puts: [
                {ref: {kind: "change", id: "tmp:born"}, after: change("tmp:born", {kind: "prehistory", order: 1}, {when: [{kind: "birth", who: jin, basis: author}, date(1997, 3, 1)]})},
                // 星瑕没有出生事件：关于她的年龄说法不进网络，只按说法答；一条写在马甲上，另一条写在本体上，按本体算在一起。
                {ref: {kind: "change", id: "tmp:disagree"}, after: change("tmp:disagree", at("ch1", 10), {when: [date(2012, 6, 3), {kind: "age", who: small, years: {min: 15, max: 15}, basis: author}, {kind: "age", who: xia, years: {min: 16, max: 16}, basis: author}]})},
                {ref: {kind: "change", id: "tmp:plain"}, after: change("tmp:plain", at("ch1", 20), {when: [date(2012, 6, 10)]})},
                {ref: {kind: "change", id: "tmp:later"}, after: change("tmp:later", at("ch2", 0), {when: [{kind: "after", of: "tmp:plain", gap: {min: 3, max: 3, unit: "day"}, basis: author}]})},
            ]});
            if (!story.ok) throw new Error(JSON.stringify(story.failure));
            const [disagree, plain, later] = [story.ids["tmp:disagree"]!, story.ids["tmp:plain"]!, story.ids["tmp:later"]!];
            const answer = (query: Parameters<typeof service.time>[0]) => {
                const read = service.time(query);
                if (typeof read === "string") throw new Error(read);
                return read.answer as Record<string, unknown>;
            };
            expect(answer({kind: "age", who: small, at: disagree})).toMatchObject({kind: "age", text: "15 到 16 岁", age: {kind: "years", min: 15, max: 16}, hint: "time-age-disagree"});
            expect(answer({kind: "age", who: xia, at: plain})).toMatchObject({kind: "age", text: "不知道"});
            // 有出生事件、事上没有年龄说法：由出生推；问马甲与问本体答得一样，不带提示。
            const derived = answer({kind: "age", who: jin, at: plain});
            expect(derived).toMatchObject({kind: "age", text: "15 岁"});
            expect(derived).not.toHaveProperty("hint");
            expect(answer({kind: "age", who: junior, at: plain})).toEqual(derived);
            // 同一分量里的两件事相差的范围：恰好三天。
            expect(answer({kind: "between", a: plain, b: later})).toMatchObject({kind: "between", state: "ok", lo: 3 * 1440, hi: 3 * 1440});
            expect(answer({kind: "between", a: later, b: plain})).toMatchObject({kind: "between", state: "ok", lo: -3 * 1440, hi: -3 * 1440});
            expect(typeof answer({kind: "between", a: plain, b: later}).text).toBe("string");
            // 不存在的事、不存在的人：not-found。
            expect(answer({kind: "between", a: disagree, b: "c404"})).toEqual({code: "not-found"});
            expect(answer({kind: "age", who: "e404", at: plain})).toEqual({code: "not-found"});
            expect(answer({kind: "age", who: xia, at: "c404"})).toEqual({code: "not-found"});
            expect(answer({kind: "event", change: "c404"})).toEqual({code: "not-found"});
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.time 输出 15（补）：带令牌时点名上限之后的事", () => {
    test("between、age、chapter 点名上限之后的事或章：view-denied 并各记一条审计；只点名上限之前的照常答", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "denied");
        const service = await openTestService(root, {texts: new Map([["ch1", "那年。"], ["ch2", "后来。"]]), chapters: ["ch1", "ch2"], registry: buildRegistry([PERSON])});
        try {
            const written = await service.publish({requestId: "vd1", by: author, what: "edit", title: "事", baseVersion: 0, puts: [
                {ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")},
                {ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", {kind: "chapter", chapter: "ch1", key: 0}, {when: [date(2012)]})},
                {ref: {kind: "change", id: "tmp:y"}, after: change("tmp:y", {kind: "chapter", chapter: "ch2", key: 0}, {when: [date(2012, 6, 5)]})},
            ]});
            if (!written.ok) throw new Error(JSON.stringify(written.failure));
            const [xia, x, y] = [written.ids["tmp:xia"]!, written.ids["tmp:x"]!, written.ids["tmp:y"]!];
            const opened = service.openView({viewer: null, line: "main", until: {kind: "chapter", chapter: "ch1", edge: "end"}, purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const view = service.viewed(opened.token);
            expect(view.time({kind: "between", a: x, b: y})).toBe("view-denied");
            expect(view.time({kind: "age", who: xia, at: y})).toBe("view-denied");
            expect(view.time({kind: "chapter", chapter: "ch2"})).toBe("view-denied");
            const audit = service.viewAudit();
            expect(audit !== "cursor-stale" && audit.items.map((item) => item.method)).toEqual(["time", "time", "time"]);
            expect(typeof view.time({kind: "chapter", chapter: "ch1"})).toBe("object");
            expect(typeof view.time({kind: "between", a: x, b: x})).toBe("object");
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.time 输出 4、16（补）：只改词表、新打开时设置已不合法", () => {
    test("只改模糊词表：用词表里的词写的间隔按新的重算，读取输入的摘要随之变，历法不变", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "fuzzy");
        const service = await openTestService(root, {texts: new Map([["ch1", "那年。"]]), chapters: ["ch1"], registry: buildRegistry([PERSON])});
        try {
            const written = await service.publish({requestId: "fz1", by: author, what: "edit", title: "事", baseVersion: 0, puts: [
                {ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", {kind: "chapter", chapter: "ch1", key: 0}, {when: [date(2012, 6, 3)]})},
                {ref: {kind: "change", id: "tmp:y"}, after: change("tmp:y", {kind: "chapter", chapter: "ch1", key: 10}, {when: [{kind: "after", of: "tmp:x", gap: {word: "不久"}, basis: author}]})},
            ]});
            if (!written.ok) throw new Error(JSON.stringify(written.failure));
            const y = written.ids["tmp:y"]!;
            const startOf = () => {
                const read = service.time({kind: "event", change: y});
                if (typeof read === "string") throw new Error(read);
                return (read.answer as {start: {lo: number; hi: number}}).start;
            };
            const before = startOf();
            const digest = service.snapshot().stamp.inputDigest;
            // “不久”缺省是 0 到 7 天；改成 0 到 2 天，只有上界收窄。
            await service.setTime({fuzzy: {words: {不久: {min: 0, max: 2, unit: "day"}}}});
            const after = startOf();
            expect(after.lo).toBe(before.lo);
            expect(after.hi).toBeLessThan(before.hi);
            expect(service.snapshot().stamp.inputDigest).not.toBe(digest);
            // 改回缺省的值：范围与摘要回到最初。
            await service.setTime({});
            expect(startOf()).toEqual(before);
            expect(service.snapshot().stamp.inputDigest).toBe(digest);
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });

    test("新打开的服务设置里的历法已不合法：用宿主交来的上一份合法的（previous），诊断写明 previous；上一份也不合法时用内置公历", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "reopen");
        const service = await openTestService(root, {texts: new Map([["ch1", "那年。"]]), chapters: ["ch1"], registry: buildRegistry([PERSON])});
        try {
            const royal: Calendar = {...GREGORIAN, version: 2, eras: [{id: "royal", name: "王历", start: 1}]};
            const using = () => service.status().diagnostics.flatMap((item) => (item.code === "calendar-invalid" ? [item.using] : []));
            expect(await service.setTime({calendar: {...royal, months: []}, previous: royal})).toMatchObject({calendar: royal, valid: false});
            expect(using()).toEqual(["previous"]);
            const reopened = await openTestService(await createTestTmpRoot("nb-canon-time", "reopen-2"), {texts: new Map([["ch1", "那年。"]]), chapters: ["ch1"], registry: buildRegistry([PERSON])});
            try {
                expect(await reopened.setTime({calendar: {...royal, months: []}, previous: {...royal, months: []}})).toMatchObject({calendar: GREGORIAN, valid: false});
                expect(reopened.status().diagnostics.flatMap((item) => (item.code === "calendar-invalid" ? [item.using] : []))).toEqual(["builtin"]);
            } finally {
                await reopened.stop();
            }
        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});

describe("canon.time 输出 14、15（审查补）", () => {
    const CH = ["ch1", "ch2", "ch3", "ch4"];
    const after = (of: string, days: number) => ({kind: "after" as const, of, gap: {min: days, max: days, unit: "day" as const}, basis: author});
    const lineOptions = () => options({order: new ChapterOrder(CH)});

    test("写在子线上：子线上已有的打架不算新增，只有这次新出现的进“带来的变化”", () => {
        const first = ok(World.empty(lineOptions()).publish(request([{ref: {kind: "change", id: "tmp:c1"}, after: change("tmp:c1", {kind: "chapter", chapter: "ch2", key: 10})}], 0), "t"));
        const c1 = first.ids["tmp:c1"]!;
        const forked = ok(first.world.publish(request([
            {ref: {kind: "change", id: "tmp:f"}, after: change("tmp:f", {kind: "chapter", chapter: "ch2", key: 20}, {nature: "fork", fork: {line: "tmp:l", name: "支线", parent: "main", cut: c1, type: "branch"}} as never)},
        ], 1), "t"));
        const line = forked.ids["tmp:l"]!;
        const clash = (id: string, key: number) => ({ref: {kind: "change" as const, id}, after: change(id, {kind: "chapter", chapter: "ch3", key, line}, {when: [after(c1, 1), {kind: "before", of: c1, gap: {min: 1, max: 1, unit: "day"}, basis: author}]})});
        const once = ok(forked.world.publish(request([clash("tmp:x", 5)], 2), "t"));
        expect(once.revision.impact.pendingAdded.filter((key) => key.startsWith("time-conflict"))).toHaveLength(1);
        const unrelated = ok(once.world.publish(request([{ref: {kind: "change", id: "tmp:y"}, after: change("tmp:y", {kind: "chapter", chapter: "ch3", key: 9, line}, {when: [after(c1, 3)]})}], 3), "t"));
        expect(unrelated.revision.impact.pendingAdded).toEqual([]);
    });

    test("带令牌：父线上上限之后的说法不收窄回溯的范围；不带令牌的读取会收窄", async () => {
        const root = await createTestTmpRoot("nb-canon-time", "bounded-parent");
        const service = await openTestService(root, {texts: new Map(CH.map((chapter) => [chapter, ""])), chapters: CH, registry: buildRegistry([PERSON])});
        try {
            const publish = async (puts: WriteRequest["puts"]) => {
                const result = await service.publish(request(puts, service.status().version));
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
                return result.ids;
            };
            const c1 = (await publish([{ref: {kind: "change", id: "tmp:c1"}, after: change("tmp:c1", {kind: "chapter", chapter: "ch1", key: 10})}]))["tmp:c1"]!;
            // 触发处与切口的差只有一个下界；第 4 章（上限之后）的说法把它夹死。
            const c2 = (await publish([{ref: {kind: "change", id: "tmp:c2"}, after: change("tmp:c2", {kind: "chapter", chapter: "ch1", key: 20}, {when: [{kind: "after", of: c1, gap: {min: 1, max: 30, unit: "day"}, basis: author}]})}]))["tmp:c2"]!;
            const ids = await publish([
                {ref: {kind: "change", id: "tmp:f"}, after: change("tmp:f", {kind: "chapter", chapter: "ch1", key: 30}, {nature: "fork", fork: {line: "tmp:r", name: "回溯", parent: "main", cut: c1, trigger: c2, back: {min: 1, max: 1, unit: "day"}, type: "rollback"}} as never)},
                // 子线上这件事没有自己的说法：它的范围只由“不早于回溯到的那一刻”定，那一刻又取决于父线上切口到触发处的差。
                {ref: {kind: "change", id: "tmp:own"}, after: change("tmp:own", {kind: "chapter", chapter: "ch2", key: 1, line: "tmp:r"})},
            ]);
            const line = ids["tmp:r"]!;
            const own = ids["tmp:own"]!;
            const opened = service.openView({viewer: null, line, until: {kind: "chapter", chapter: "ch2", edge: "end"}, purpose: "writer"});
            if (typeof opened === "string" || !("token" in opened)) throw new Error(JSON.stringify(opened));
            const answerOf = (token: string, change: string) => JSON.stringify((service.viewed(token).time({kind: "event", change}) as {answer: unknown}).answer);
            const before = answerOf(opened.token, own);
            await publish([{ref: {kind: "change", id: "tmp:late"}, after: change("tmp:late", {kind: "chapter", chapter: "ch4", key: 1}, {when: [{kind: "after", of: c1, gap: {min: 2, max: 2, unit: "day"}, basis: author}, {kind: "before", of: c2, gap: {min: 0, max: 0, unit: "day"}, basis: author}]})}]);
            expect(answerOf(opened.token, own)).toBe(before);
            const unbounded = JSON.stringify((service.time({kind: "event", change: own}, "actual", undefined, 50, line) as {answer: unknown}).answer);
            expect(unbounded).not.toBe(before);

        } finally {
            await service.stop();
            await rm(root, {recursive: true, force: true});
        }
    });
});
