/**
 * 世界服务上的一次改几处与按名字找条目（docs/specs/canon/revisions.md 输出 25、project.md 的 `findEntries`）：真实 `WorldService`、
 * 真实分段日志。读取戳在写队列里比：之间有新修订、或版本没变而活页夹改了章讲的线，都整批拒收、日志不动。
 */

import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {buildRegistry, type Entry, type EntryEdits, type WriteRequest} from "../src/index";
import {openTestService} from "./fixtures/service";
import {PANEL, PERSON} from "./fixtures/world";

const CHAPTERS = ["ch1", "ch2", "ch3"];
const registry = buildRegistry([PANEL, PERSON]);
const author = {kind: "author"} as const;
const agent = {kind: "agent", session: "s1"} as const;
let sequence = 0;
const id = () => `req-${String(++sequence)}`;
const end = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const});

function person(tmp: string, name: string, extra: Partial<Entry> = {}, aliases: string[] = []): Entry {
    return {id: tmp, type: "人物", parent: null, folder: "人物", order: 0, init: {name, aliases, summary: "", text: [], data: {character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: "银白", 状态: null, 态度: null}}}}, ...extra};
}

async function service(label: string) {
    const root = await createTestTmpRoot("nb-canon-entry-edits", label);
    return openTestService(root, {texts: new Map(CHAPTERS.map((chapter) => [chapter, ""])), chapters: CHAPTERS, registry});
}

async function publish(world: Awaited<ReturnType<typeof service>>, puts: WriteRequest["puts"]): Promise<Record<string, string>> {
    const result = await world.publish({requestId: id(), by: author, what: "edit", title: "写", baseVersion: world.status().version, puts});
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result.ids;
}

describe("一次改几处：读取戳（revisions.md 输出 25）", () => {
    test("作者在 Agent 读过之后另记了一条剧情变更：Agent 带着读取戳的写入整批拒收，日志与版本不动；戳没变时写得进去", async () => {
        const world = await service("stale");
        try {
            const xia = (await publish(world, [{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!;
            const read = world.snapshot().stamp;
            const stamp = {version: read.version, input: read.inputDigest.slice(0, 12)};
            await publish(world, [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "染发", at: {kind: "chapter", chapter: "ch2", key: 10}, told: [], involves: [xia], lines: [], links: [], patches: [{op: "set", at: {entry: xia, path: "character.外观"}, value: "黑色"}], status: "active", by: author}}]);
            const before = world.status().version;
            const refused = await world.editEntries({requestId: id(), by: agent, what: "creative", baseVersion: read.version, readStamp: stamp, title: "改外观", intent: "story", position: end("ch3"), ops: [{op: "set", at: {entry: xia, path: "character.外观"}, value: "金色"}]});
            expect(refused.ok === false && refused.failure).toMatchObject({code: "stale-read", inputChanged: false, revisions: [{title: "写"}]});
            expect(world.status().version).toBe(before);
            const fresh = world.snapshot().stamp;
            const done = await world.editEntries({requestId: id(), by: agent, what: "creative", baseVersion: fresh.version, readStamp: {version: fresh.version, input: fresh.inputDigest.slice(0, 12)}, title: "改外观", intent: "story", position: end("ch3"), ops: [{op: "set", at: {entry: xia, path: "character.外观"}, value: "金色"}]});
            expect(done.ok && done.revision.by).toEqual(agent);
            expect(world.status().version).toBe(before + 1);
        } finally {
            await world.stop();
        }
    });

    test("版本没变而活页夹改了一章讲的线：读取的输入变了，同样拒收并写明", async () => {
        const world = await service("drift");
        try {
            const xia = (await publish(world, [{ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")}]))["tmp:xia"]!;
            const ids = await publish(world, [
                {ref: {kind: "change", id: "tmp:c1"}, after: {id: "tmp:c1", kind: "written", text: "起点", at: {kind: "chapter", chapter: "ch1", key: 10}, told: [], involves: [xia], lines: [], links: [], patches: [], status: "active", by: author}},
            ]);
            await publish(world, [{ref: {kind: "change", id: "tmp:f"}, after: {id: "tmp:f", kind: "written", text: "分叉", at: {kind: "chapter", chapter: "ch1", key: 20}, told: [], involves: [], lines: [], links: [], patches: [], status: "active", by: author, nature: "fork", fork: {line: "tmp:l", name: "支线", parent: "main", cut: ids["tmp:c1"]!, type: "branch"}} as never}]);
            const read = world.snapshot().stamp;
            const line = world.snapshot().view.lines()[0]!.id;
            await world.setChapters(CHAPTERS, new Map([["ch3", [{from: 1, line}]]]));
            expect(world.status().version).toBe(read.version);
            const refused = await world.editEntries({requestId: id(), by: agent, what: "creative", baseVersion: read.version, readStamp: {version: read.version, input: read.inputDigest.slice(0, 12)}, title: "改外观", position: end("ch3"), ops: [{op: "set", at: {entry: xia, path: "character.外观"}, value: "金色"}]});
            expect(refused.ok === false && refused.failure).toMatchObject({code: "stale-read", inputChanged: true});
        } finally {
            await world.stop();
        }
    });
});

describe("按名字找条目（project.md 的 findEntries）", () => {
    test("名字与别名按读取位置取；不列删除的；还没出场的列出、标出；全等、前缀、包含依次排；可按种类筛；翻页", async () => {
        const world = await service("find");
        try {
            const ids = await publish(world, [
                {ref: {kind: "entry", id: "tmp:a"}, after: person("tmp:a", "星瑕", {order: 2}, ["小瑕"])},
                {ref: {kind: "entry", id: "tmp:b"}, after: person("tmp:b", "星", {order: 1})},
                {ref: {kind: "entry", id: "tmp:c"}, after: person("tmp:c", "流星雨", {order: 0})},
                {ref: {kind: "entry", id: "tmp:d"}, after: person("tmp:d", "星辰议会", {type: "组织", order: 3})},
                {ref: {kind: "entry", id: "tmp:e"}, after: person("tmp:e", "星瑾", {order: 4, appears: {kind: "chapter", chapter: "ch3", key: 0}})},
                {ref: {kind: "entry", id: "tmp:gone"}, after: person("tmp:gone", "星屑", {order: 5, deleted: true})},
            ]);
            await publish(world, [{ref: {kind: "change", id: "tmp:n"}, after: {id: "tmp:n", kind: "written", text: "改名", at: {kind: "chapter", chapter: "ch2", key: 10}, told: [], involves: [ids["tmp:a"]!], lines: [], links: [], patches: [{op: "set", at: {entry: ids["tmp:a"]!, path: "entry.name"}, value: "夜王"}], status: "active", by: author}}]);

            const atEnd = world.findEntries({query: "星", position: end("ch3")});
            if (typeof atEnd === "string") throw new Error(atEnd);
            expect(atEnd.items.map((item) => item.name)).toEqual(["星", "星辰议会", "星瑾", "流星雨"]);
            expect(atEnd.items.find((item) => item.name === "星瑾")!.appeared).toBe(true);
            const early = world.findEntries({query: "星", position: end("ch1")});
            if (typeof early === "string") throw new Error(early);
            expect(early.items.map((item) => item.name)).toEqual(["星", "星瑕", "星辰议会", "星瑾", "流星雨"]);
            expect(early.items.find((item) => item.name === "星瑾")!.appeared).toBe(false);

            const alias = world.findEntries({query: "小瑕", position: end("ch3")});
            if (typeof alias === "string") throw new Error(alias);
            expect(alias.items).toEqual([{id: ids["tmp:a"]!, name: "夜王", kind: "人物", parent: null, appeared: true, matchedAlias: "小瑕"}]);

            const groups = world.findEntries({query: "", kinds: ["组织"], position: end("ch3")});
            if (typeof groups === "string") throw new Error(groups);
            expect(groups.items.map((item) => item.name)).toEqual(["星辰议会"]);

            const first = world.findEntries({query: "星", position: end("ch3")}, undefined, 2);
            if (typeof first === "string" || first.cursor === undefined) throw new Error("no cursor");
            const second = world.findEntries({query: "星", position: end("ch3")}, first.cursor, 2);
            if (typeof second === "string") throw new Error(second);
            expect([...first.items, ...second.items].map((item) => item.name)).toEqual(["星", "星辰议会", "星瑾", "流星雨"]);
            expect(world.findEntries({query: "瑾", position: end("ch3")}, first.cursor, 2)).toBe("cursor-stale");
        } finally {
            await world.stop();
        }
    });

    test("同档按树序：上级在前、它的子条目紧跟着，再到下一个上级；同层的 order 不跨上级比", async () => {
        const world = await service("find-tree");
        try {
            await publish(world, [
                {ref: {kind: "entry", id: "tmp:p"}, after: person("tmp:p", "门甲", {order: 0})},
                {ref: {kind: "entry", id: "tmp:q"}, after: person("tmp:q", "门丙", {order: 1})},
                {ref: {kind: "entry", id: "tmp:c2"}, after: person("tmp:c2", "门子丁", {parent: "tmp:p", order: 6})},
                {ref: {kind: "entry", id: "tmp:c1"}, after: person("tmp:c1", "门子乙", {parent: "tmp:p", order: 5})},
            ]);
            const found = world.findEntries({query: "门", position: end("ch3")});
            if (typeof found === "string") throw new Error(found);
            expect(found.items.map((item) => item.name)).toEqual(["门甲", "门子乙", "门子丁", "门丙"]);
        } finally {
            await world.stop();
        }
    });
});

describe("实例字段的操作经世界服务（components.md 输出 4）", () => {
    test("去掉的字段不在生效的声明里，另列在 removedFields；恢复以后回到声明里", async () => {
        const world = await service("instance-fields");
        try {
            const entry: Entry = {...person("tmp:xia", "星瑕"), init: {...person("tmp:xia", "星瑕").init, data: {panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 100, 魔力上限: null, 魔力: null, 物品: []}, declared: []}}}};
            const xia = (await publish(world, [{ref: {kind: "entry", id: "tmp:xia"}, after: entry}]))["tmp:xia"]!;
            const edit = async (ops: EntryEdits["ops"]) => {
                const result = await world.editEntries({requestId: id(), by: author, what: "edit", baseVersion: world.status().version, title: "改字段", position: end("ch3"), ops});
                if (!result.ok) throw new Error(JSON.stringify(result.failure));
            };
            /** 条目读取里与字段声明有关的两项。 */
            const reading = () => {
                const read = world.entry(xia, end("ch3"), "actual");
                if (typeof read === "string" || !("declarations" in read)) throw new Error("entry is not readable");
                return {labels: (read.declarations.panel ?? []).map((field) => field.label), removed: read.removedFields};
            };
            await edit([{op: "fieldAdd", entry: xia, namespace: "panel", field: {label: "幸运", kind: "number"}, value: 7}]);
            expect(reading().labels).toContain("幸运");
            expect(reading().removed).toBeUndefined();

            await edit([{op: "fieldRemove", at: {entry: xia, path: "panel.幸运"}}]);
            expect(reading().labels).not.toContain("幸运");
            expect(reading().removed).toEqual({panel: [{id: "幸运", label: "幸运"}]});

            await edit([{op: "fieldRestore", at: {entry: xia, path: "panel.幸运"}}]);
            expect(reading().labels).toContain("幸运");
            expect(reading().removed).toBeUndefined();

            // 去掉以后类型加了一个同 id 的固定字段：生效的是固定的那一条，去掉过的这一条不再列出来给“恢复”。
            await edit([{op: "fieldRemove", at: {entry: xia, path: "panel.幸运"}}]);
            expect(reading().removed).toEqual({panel: [{id: "幸运", label: "幸运"}]});
            await world.setRegistries({registry: buildRegistry([{...PANEL, fields: [...PANEL.fields!, {id: "幸运", label: "气运", kind: "number"}]}, PERSON])});
            expect(reading()).toMatchObject({removed: undefined});
            expect(reading().labels).toContain("气运");
        } finally {
            await world.stop();
        }
    });
});
