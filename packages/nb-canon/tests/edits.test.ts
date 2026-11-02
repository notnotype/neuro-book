import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type Entry, type WriteRequest} from "../src/index";
import {editInPlace, recordDelta, replaceOnce} from "../src/world/edits";
import {World, type WriteResult} from "../src/world/world";
import {PANEL, PERSON} from "./fixtures/world";

const options = () => ({
    order: new ChapterOrder(["ch44", "ch45", "ch50"]),
    registry: buildRegistry([PANEL, PERSON]),
    reductions: () => undefined,
    chapterText: () => "",
    digest: (text: string) => createHash("sha256").update(text).digest("hex"),
});

let sequence = 0;
const id = () => `req-${String(++sequence)}`;
const author = {kind: "author"} as const;

function ok<T extends {ok: boolean}>(result: T): Extract<T, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify((result as {failure?: unknown}).failure));
    return result as Extract<T, {ok: true}>;
}

/** 星瑕：初值银白发、存款 40000；第 45 章“染成黑色”；第 44、45 章各有一笔加减。版本 2。 */
function world(): World {
    const xia: Entry = {
        id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0,
        init: {name: "星瑕", aliases: [], summary: "", text: [], data: {
            panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 40000, 魔力上限: null, 魔力: null, 物品: []}},
            character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: "银白", 状态: null, 态度: null}},
        }},
    };
    const first = ok(World.empty(options()).publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:xia"}, after: xia}]} as WriteRequest, "t") as WriteResult);
    const change = (tmp: string, chapter: string, key: number, patches: unknown[]) => ({ref: {kind: "change" as const, id: tmp}, after: {id: tmp, kind: "written", text: tmp, at: {kind: "chapter", chapter, key}, told: [], involves: ["e1"], lines: [], links: [], patches, status: "active", by: author}});
    return ok(first.world.publish({requestId: id(), by: author, what: "bookkeeping", title: "记账", baseVersion: 1, puts: [
        change("tmp:a", "ch44", 10, [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: -1000}]),
        change("tmp:dye", "ch45", 10, [{op: "set", at: {entry: "e1", path: "character.外观"}, value: "黑色"}]),
        change("tmp:b", "ch45", 20, [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: 2800}]),
    ]} as WriteRequest, "t") as WriteResult).world;
}

const end = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const});

describe("canon.revisions 输出 8、9、10 与场景 2：就地改", () => {
    test("改的是给出这个值的那条变更；更早的位置不变", () => {
        const base = world();
        const result = ok(editInPlace(base, {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "character.外观"}, value: "深棕", read: {value: "黑色", version: 2}}, "t"));
        const dye = [...result.world.data.changes.values()].find((change) => change.text === "tmp:dye")!;
        expect(dye.patches[0]!.value).toBe("深棕");
        expect(result.world.data.entries.get("e1")!.init.data.character!.fields.外观).toBe("银白");
        expect(result.world.engine.entry("e1", end("ch44"), "actual")).toMatchObject({namespaces: {character: {fields: {外观: {value: "银白"}}}}});
    });

    test("几笔累出来的数不直接改，给出来历；勾剧情变化后在这个位置记一条差额", () => {
        const base = world();
        const edit = {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "panel.存款"}, value: 41000, read: {value: 41800, version: 2}} as const;
        const refused = editInPlace(base, edit, "t");
        expect(refused.ok).toBe(false);
        if (!refused.ok) expect(refused.failure.code).toBe("accumulated-value");
        const story = ok(editInPlace(base, {...edit, requestId: id(), intent: "story"}, "t"));
        const added = story.revision.ops[0]!;
        expect(added.kind === "create" && (added.after as {patches: Array<{value: unknown}>}).patches[0]!.value).toBe(-800);
        expect(story.world.engine.entry("e1", end("ch50"), "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 41000}}}}});
    });

    test("只有初值的改初值；读到的值过期报 value-conflict；初值位置不能记剧情变化", () => {
        const base = world();
        const edited = ok(editInPlace(base, {requestId: id(), by: author, position: end("ch44"), at: {entry: "e1", path: "entry.name"}, value: "夜王", read: {value: "星瑕", version: 2}}, "t"));
        expect(edited.world.data.entries.get("e1")!.init.name).toBe("夜王");
        const stale = editInPlace(base, {requestId: id(), by: author, position: end("ch44"), at: {entry: "e1", path: "entry.name"}, value: "x", read: {value: "旧名", version: 2}}, "t");
        expect(stale.ok === false && stale.failure).toEqual({code: "value-conflict", current: "星瑕"});
        const initial = editInPlace(base, {requestId: id(), by: author, position: {kind: "initial"}, at: {entry: "e1", path: "panel.存款"}, value: 1, read: {value: 40000, version: 2}, intent: "story"}, "t");
        expect(initial.ok === false && initial.failure.code).toBe("intent-not-allowed");
    });

    test("记一笔是剧情变化的一次加减", () => {
        const result = ok(recordDelta(world(), {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "panel.存款"}, delta: -300, reason: "买药", read: {value: 41800, version: 2}}, "t"));
        expect(result.world.engine.entry("e1", end("ch50"), "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 41500}}}}});
    });

    test("文字替换：A 恰好出现一次才替换", () => {
        expect(replaceOnce("银白长发，银白眼", "银白长发", "淡金长发")).toBe("淡金长发，银白眼");
        expect(replaceOnce("银白长发，银白眼", "银白", "淡金")).toBe("replace-not-unique");
        expect(replaceOnce("银白长发", "黑", "白")).toBe("replace-not-found");
    });
});
