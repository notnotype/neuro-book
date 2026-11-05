import {join} from "node:path";

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {createTestTmpRoot, removeMarkedTmpRoot, TMP_MARKER_FILE} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type Entry, type StoryChange, type StoryChangeDraft, type WriteRequest} from "../src/index";
import type {WorldService} from "../src/node/index";
import {openTestService} from "./fixtures/service";
import {PERSON} from "./fixtures/world";

let root = "";
let services: WorldService[] = [];
beforeEach(async () => {
    root = await createTestTmpRoot("nb-canon-cast");
});
afterEach(async () => {
    for (const service of services) await service.stop();
    services = [];
    await removeMarkedTmpRoot(root, join(root, TMP_MARKER_FILE));
});

const TEXTS = new Map([["ch1", "开头。"], ["ch2", "她梦见了钟。"], ["ch3", "卫兵拦住了她。"], ["ch4", "雨停了。"]]);

async function open(): Promise<WorldService> {
    const service = await openTestService(root, {texts: TEXTS, chapters: ["ch1", "ch2", "ch3", "ch4"], registry: buildRegistry([PERSON])});
    services.push(service);
    return service;
}

let sequence = 0;
async function write(service: WorldService, puts: WriteRequest["puts"]) {
    return service.publish({requestId: `cast-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "参与者", baseVersion: service.status().version, puts});
}
function idsOf(result: Awaited<ReturnType<typeof write>>): Readonly<Record<string, string>> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.ids;
}
const problems = (result: Awaited<ReturnType<typeof write>>) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => [problem.code, problem.path]) : []);

const person = (id: string, name: string, extra: Partial<Entry> = {}): Entry => ({id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {}}, ...extra});
const change = (chapter: string, extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft => ({id: "tmp:c", kind: "written", text: "一件事", at: {kind: "chapter", chapter, key: 0}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: {kind: "author"}, ...extra});
const putChange = (draft: StoryChangeDraft) => [{ref: {kind: "change" as const, id: draft.id}, after: draft}];

/** 星瑾（带马甲“夜行人”）、哥哥、第 3 章才出场的阿七。 */
async function people(service: WorldService) {
    const ids = idsOf(await write(service, [
        {ref: {kind: "entry", id: "tmp:jin"}, after: person("tmp:jin", "星瑾")},
        {ref: {kind: "entry", id: "tmp:mask"}, after: person("tmp:mask", "夜行人", {sameAs: "tmp:jin"})},
        {ref: {kind: "entry", id: "tmp:bro"}, after: person("tmp:bro", "哥哥")},
        {ref: {kind: "entry", id: "tmp:qi"}, after: person("tmp:qi", "阿七", {appears: {kind: "chapter", chapter: "ch3", key: 0}})},
    ]));
    return {jin: ids["tmp:jin"]!, mask: ids["tmp:mask"]!, bro: ids["tmp:bro"]!, qi: ids["tmp:qi"]!};
}

describe("canon.model 验收场景 8：在场", () => {
    test("问星瑾第 1 到 4 章在场的变更：第 3 章那条，另给没记参与者的 1 条；写成马甲的存成本体加 as；第 3 章涉及的条目有哥哥", async () => {
        const service = await open();
        const {jin, mask, bro} = await people(service);
        const guard = idsOf(await write(service, putChange(change("ch3", {text: "卫兵盘问星瑾", cast: [{who: jin, role: "present"}, {label: "守门的卫兵", role: "present"}, {who: bro, role: "mentioned"}]}))))["tmp:c"]!;
        await write(service, putChange(change("ch4", {text: "没记参与者"})));
        const night = idsOf(await write(service, putChange(change("ch4", {text: "夜行人翻墙", cast: [{who: mask, role: "present"}]}))))["tmp:c"]!;

        const read = service.presence(jin, {from: "ch1", to: "ch4"});
        if (typeof read === "string") throw new Error(read);
        expect(read.items.map((item) => item.change.id)).toEqual([guard, night]);
        expect(read.uncast).toBe(1);
        expect((service.object({kind: "change", id: night}).object as StoryChange).cast).toEqual([{who: jin, as: mask, role: "present"}]);
        expect(service.world.engine.chapterEntries("ch3")).toContain(bro);
        // 被提到不算在场。
        const brother = service.presence(bro, {from: "ch1", to: "ch4"});
        expect(typeof brother !== "string" && brother.items).toEqual([]);
    });
});

describe("canon.model 输出 29：参与者的校验与在场的取法", () => {
    test("who 与 label 二者之一、as 只跟 who 且是它的马甲、给了 as 的 who 不能是马甲；条目要存在、已出场", async () => {
        const service = await open();
        const {jin, mask, bro, qi} = await people(service);
        const cast = (members: StoryChange["cast"], chapter = "ch3") => write(service, putChange(change(chapter, {cast: members})));
        expect(problems(await cast([{who: jin, label: "又有名字", role: "present"}]))).toEqual([["invalid-cast", "cast[0]"]]);
        expect(problems(await cast([{role: "present"}]))).toEqual([["invalid-cast", "cast[0]"]]);
        expect(problems(await cast([{label: "路人", as: mask, role: "present"}]))).toEqual([["invalid-cast", "cast[0]"]]);
        expect(problems(await cast([{who: bro, as: mask, role: "present"}]))).toEqual([["invalid-cast", "cast[0]"]]);
        // who 是马甲、as 又不是 who 的马甲：两处都报。
        expect(problems(await cast([{who: mask, as: mask, role: "present"}]))).toEqual([["invalid-cast", "cast[0]"], ["invalid-cast", "cast[0]"]]);
        expect(problems(await cast([{who: "e99", role: "present"}]))).toEqual([["ref-invalid", "cast[0].who"]]);
        expect(problems(await cast([{who: qi, role: "present"}], "ch2"))).toEqual([["not-appeared", undefined]]);
    });

    test("实际模式不算待定的变更；按计划模式加上 to 的章末还没兑现的计划", async () => {
        const service = await open();
        const {jin} = await people(service);
        const present = [{who: jin, role: "present" as const}];
        await write(service, putChange(change("ch2", {cast: present, status: "held", held: {reason: "unsure", note: "没把握"}})));
        const plan = idsOf(await write(service, putChange(change("ch2", {kind: "plan", text: "计划：她去钟楼", cast: present}))))["tmp:c"]!;
        const actual = service.presence(jin);
        expect(typeof actual !== "string" && actual.items).toEqual([]);
        const planned = service.presence(jin, {to: "ch4", mode: "planned"});
        expect(typeof planned !== "string" && planned.items.map((item) => item.change.id)).toEqual([plan]);
        expect(service.presence(jin, {to: "ch9"})).toBe("chapter-not-found");
    });
});

describe("canon.model 输出 30：叙述", () => {
    test("叙述不能有补丁、至少有一处讲述；变更列表按性质筛", async () => {
        const service = await open();
        const {jin} = await people(service);
        const dream = {nature: "narration" as const, told: [{source: "chapter" as const, chapter: "ch2", quote: "她梦见了钟"}]};
        expect(problems(await write(service, putChange(change("ch2", {...dream, told: []}))))).toEqual([["narration-without-telling", "told"]]);
        expect(problems(await write(service, putChange(change("ch2", {...dream, patches: [{op: "set", at: {entry: jin, path: "entry.summary"}, value: "做梦的人"}]}))))).toEqual([["narration-with-patches", "patches"]]);
        const id = idsOf(await write(service, putChange(change("ch2", {...dream, cast: [{who: jin, role: "present"}]}))))["tmp:c"]!;
        await write(service, putChange(change("ch3")));
        const narrations = service.changes({nature: "narration"});
        expect(typeof narrations !== "string" && narrations.items.map((item) => item.change.id)).toEqual([id]);
        const events = service.changes({nature: "event"});
        expect(typeof events !== "string" && events.items.map((item) => item.change.nature ?? "event")).toEqual(["event"]);
    });

    test("计划按全书当前的进展筛", async () => {
        const service = await open();
        const plans = idsOf(await write(service, [
            ...putChange(change("ch2", {id: "tmp:p1", kind: "plan", text: "计划一"})),
            ...putChange(change("ch3", {id: "tmp:p2", kind: "plan", text: "计划二"})),
        ]));
        // 兑现它的变更没有补丁：没有补丁的变更算套上。
        idsOf(await write(service, putChange(change("ch3", {links: [{kind: "fulfills", plan: plans["tmp:p1"]!}]}))));
        const fulfilled = service.changes({progress: "fulfilled"});
        expect(typeof fulfilled !== "string" && fulfilled.items.map((item) => item.change.id)).toEqual([plans["tmp:p1"]!]);
        const unfulfilled = service.changes({progress: "unfulfilled"});
        expect(typeof unfulfilled !== "string" && unfulfilled.items.map((item) => item.change.id)).toEqual([plans["tmp:p2"]!]);
    });
});
