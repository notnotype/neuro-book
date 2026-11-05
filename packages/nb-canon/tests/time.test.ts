import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";
import {GREGORIAN, type Calendar} from "@notnotype/nb-time";

import {buildRegistry, ChapterOrder, type Entry, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {DEFAULT_TIME} from "../src/time/network";
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
