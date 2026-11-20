/**
 * 一次改几处（docs/specs/canon/revisions.md 输出 25）：一批操作发布成一次修订；两种意图；只写初值的增删与 `element-from-change`；
 * 这一批新建的东西不能再改；同一处不改两次；临时 id 的引用；顺序用尽；预览与写入相同；章首写剧情变化能读回；显式主线；请求 id。
 * 世界是真的 `World`，夹具同 `edits.test.ts`。
 */

import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type Entry, type WriteRequest} from "../src/index";
import {editEntries, previewEntries, type EntryEdits, type EntryOp} from "../src/world/entry-edits";
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

/**
 * 星瑕（e1）：初值银白发、存款 40000，物品里初值有“魔杖”（i1）；第 44 章“买了药水”加了物品 i2，第 45 章“染成黑色”。星瑾（e2）是她的
 * 兄弟条目，顺序 1。版本 2。
 */
function world(): World {
    const xia: Entry = {
        id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0,
        init: {name: "星瑕", aliases: ["小瑕"], summary: "", text: [{id: "b1", source: "她是学生。"}], data: {
            panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 40000, 魔力上限: null, 魔力: null, 物品: [{id: "i1", label: "魔杖", 数量: 1}]}, declared: []},
            character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: "银白", 状态: null, 态度: null}},
        }},
    };
    const jin: Entry = {id: "tmp:jin", type: "人物", parent: null, folder: "", order: 1, init: {name: "星瑾", aliases: [], summary: "", text: [], data: {}}};
    const first = ok(World.empty(options()).publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:xia"}, after: xia}, {ref: {kind: "entry", id: "tmp:jin"}, after: jin}]} as WriteRequest, "t") as WriteResult);
    const change = (tmp: string, chapter: string, key: number, patches: unknown[]) => ({ref: {kind: "change" as const, id: tmp}, after: {id: tmp, kind: "written", text: tmp.slice("tmp:".length), at: {kind: "chapter", chapter, key}, told: [], involves: ["e1"], lines: [], links: [], patches, status: "active", by: author}});
    return ok(first.world.publish({requestId: id(), by: author, what: "bookkeeping", title: "记账", baseVersion: 1, puts: [
        change("tmp:potion", "ch44", 10, [{op: "listAdd", at: {entry: "e1", path: "panel.物品"}, value: {id: "i2", label: "药水", 数量: 3}}]),
        change("tmp:dye", "ch45", 10, [{op: "set", at: {entry: "e1", path: "character.外观"}, value: "黑色"}]),
    ]} as WriteRequest, "t") as WriteResult).world;
}

const end = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const});
const start = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "start" as const});

function batch(ops: EntryOp[], extra: Partial<EntryEdits> = {}): EntryEdits {
    return {requestId: id(), by: author, what: "edit", baseVersion: 2, title: "改几处", position: end("ch50"), ops, ...extra};
}

function read(base: World, path: string, position = end("ch50"), entry = "e1"): unknown {
    const view = base.line().engine.entry(entry, position, "actual");
    if (view === null || view === "chapter-not-found") return undefined;
    const [namespace, field] = path.split(".") as [string, string];
    return view.namespaces[namespace]?.fields[field]?.value;
}

function problemCode(result: {ok: boolean; failure?: unknown}): string | undefined {
    const failure = (result as {failure?: {code: string; problems?: Array<{code: string}>}}).failure;
    return failure?.code === "validation-failed" ? failure.problems?.[0]?.code : failure?.code;
}

describe("canon.revisions 输出 25：一次改几处", () => {
    test("几项一起发布成一次修订；有一项不过时整批拒收、世界不变", () => {
        const base = world();
        const done = ok(editEntries(base, batch([
            {op: "set", at: {entry: "e1", path: "panel.存款"}, value: 50000},
            {op: "set", at: {entry: "e1", path: "character.外观"}, value: "深棕"},
            {op: "aliases", entry: "e1", add: ["瑕"]},
        ]), "t"));
        expect(done.world.version).toBe(3);
        expect(done.routes.map((route) => route.kind)).toEqual(["init", "patch", "init"]);
        expect(read(done.world, "panel.存款")).toBe(50000);
        expect(read(done.world, "character.外观")).toBe("深棕");
        expect(read(done.world, "character.外观", end("ch44"))).toBe("银白");

        const refused = editEntries(base, batch([
            {op: "set", at: {entry: "e1", path: "panel.存款"}, value: 50000},
            {op: "set", at: {entry: "e1", path: "character.不存在"}, value: "x"},
        ]), "t");
        expect(refused.ok === false && refused.failure).toEqual({code: "field-unavailable", op: 1});
        expect(base.version).toBe(2);
    });

    test("剧情变化：这一批的字段操作合成一条变更，落在读取位置；章首写下的值在它之后读得回", () => {
        const base = world();
        const done = ok(editEntries(base, batch([
            {op: "set", at: {entry: "e1", path: "character.状态"}, value: "受伤"},
            {op: "listAdd", at: {entry: "e1", path: "panel.物品"}, element: {label: "绷带", 数量: 2}},
            {op: "add", at: {entry: "e1", path: "panel.存款"}, delta: -500},
        ], {intent: "story", position: start("ch50")}), "t"));
        const created = done.revision.ops.filter((op) => op.kind === "create");
        expect(created).toHaveLength(1);
        const change = created[0]!.after as {patches: Array<{op: string}>; at: {chapter: string}};
        expect(change.at.chapter).toBe("ch50");
        expect(change.patches.map((patch) => patch.op)).toEqual(["set", "listAdd", "add"]);
        expect(read(done.world, "character.状态")).toBe("受伤");
        expect(read(done.world, "panel.存款")).toBe(39500);
        // 元素 id 按 i 加序号生成，避开初值（i1）与变更（i2）里用过的。
        expect((read(done.world, "panel.物品") as Array<{id: string}>).map((item) => item.id)).toEqual(["i1", "i2", "i3"]);
        expect(read(done.world, "panel.存款", end("ch45"))).toBe(40000);
    });

    test("改设定的列表元素：只有完全来自初值、没被变更碰过的才按初值改或去掉", () => {
        const base = world();
        // i1 只在初值里（第 44 章加的是 i2）：改它的数量写回初值。
        const own = ok(editEntries(base, batch([{op: "set", at: {entry: "e1", path: "panel.物品[i1].数量"}, value: 2}]), "t"));
        expect(own.routes).toEqual([{kind: "init"}]);
        expect(own.world.data.entries.get("e1")!.init.data.panel!.fields.物品).toEqual([{id: "i1", label: "魔杖", 数量: 2}]);
        // i2 是第 44 章的变更加的：改设定拒收，指向剧情变化。
        expect(problemCode(editEntries(base, batch([{op: "set", at: {entry: "e1", path: "panel.物品[i2].数量"}, value: 5}]), "t"))).toBe("element-from-change");
        expect(problemCode(editEntries(base, batch([{op: "listRemove", at: {entry: "e1", path: "panel.物品[i2]"}}]), "t"))).toBe("element-from-change");
        // 剧情变化可以去掉它。
        const removed = ok(editEntries(base, batch([{op: "listRemove", at: {entry: "e1", path: "panel.物品[i2]"}}], {intent: "story"}), "t"));
        expect((read(removed.world, "panel.物品") as Array<{id: string}>).map((item) => item.id)).toEqual(["i1"]);
        // 初值里的 i1 可以按改设定去掉。
        const gone = ok(editEntries(base, batch([{op: "listRemove", at: {entry: "e1", path: "panel.物品[i1]"}}]), "t"));
        expect((read(gone.world, "panel.物品") as Array<{id: string}>).map((item) => item.id)).toEqual(["i2"]);
    });

    test("同一个 id 被变更去掉又加回、整个列表被赋值过：都算碰过", () => {
        const base = world();
        const touched = ok(editEntries(base, batch([{op: "listRemove", at: {entry: "e1", path: "panel.物品[i1]"}}, {op: "listAdd", at: {entry: "e1", path: "panel.物品"}, element: {id: "i9", label: "铃", 数量: 1}}], {intent: "story", position: end("ch45")}), "t")).world;
        const readded = ok(editEntries(touched, batch([{op: "listAdd", at: {entry: "e1", path: "panel.物品"}, element: {id: "i1", label: "魔杖", 数量: 4}}], {intent: "story", baseVersion: 3}), "t")).world;
        expect(problemCode(editEntries(readded, batch([{op: "set", at: {entry: "e1", path: "panel.物品[i1].数量"}, value: 9}], {baseVersion: 4}), "t"))).toBe("element-from-change");
        const assigned = ok(editEntries(base, batch([{op: "set", at: {entry: "e1", path: "panel.物品"}, value: [{id: "i1", label: "魔杖", 数量: 1}]}], {intent: "story"}), "t")).world;
        expect(problemCode(editEntries(assigned, batch([{op: "listRemove", at: {entry: "e1", path: "panel.物品[i1]"}}], {baseVersion: 3}), "t"))).toBe("element-from-change");
    });

    test("改设定的别名与主文字的块：增加写进初值，去掉只去初值里没被碰过的", () => {
        const base = world();
        const done = ok(editEntries(base, batch([
            {op: "aliases", entry: "e1", add: ["夜王"], remove: ["小瑕"]},
            {op: "addBlock", entry: "e1", source: "她住在学院宿舍。"},
        ]), "t"));
        const stored = done.world.data.entries.get("e1")!;
        expect(stored.init.aliases).toEqual(["夜王"]);
        expect(stored.init.text.map((block) => block.source)).toEqual(["她是学生。", "她住在学院宿舍。"]);
        const block = stored.init.text[1]!.id;
        const story = ok(editEntries(done.world, batch([{op: "aliases", entry: "e1", add: ["黑发的"]}], {intent: "story", baseVersion: 3}), "t")).world;
        expect(problemCode(editEntries(story, batch([{op: "aliases", entry: "e1", remove: ["黑发的"]}], {baseVersion: 4}), "t"))).toBe("element-from-change");
        const removed = ok(editEntries(story, batch([{op: "removeBlock", at: {entry: "e1", path: `text[${block}]`}}], {baseVersion: 4}), "t"));
        expect(removed.world.data.entries.get("e1")!.init.text.map((item) => item.id)).toEqual(["b1"]);
    });

    test("这一批新建的东西只在建它的那一项里给初值；可以引用它的临时 id", () => {
        const base = world();
        expect(problemCode(editEntries(base, batch([
            {op: "create", id: "tmp:a", entry: {name: "雾崎", kind: "人物"}},
            {op: "set", at: {entry: "tmp:a", path: "entry.summary"}, value: "x"},
        ]), "t"))).toBe("created-in-batch");
        expect(problemCode(editEntries(base, batch([
            {op: "component", entry: "e2", type: PERSON.id, action: "add"},
            {op: "set", at: {entry: "e2", path: "character.外观"}, value: "黑发"},
        ]), "t"))).toBe("created-in-batch");
        const done = ok(editEntries(base, batch([
            {op: "create", id: "tmp:group", entry: {name: "学院", kind: "组织", components: [{type: PERSON.id, fields: {外观: "古旧的塔"}}]}},
            {op: "place", entry: "e2", parent: "tmp:group"},
        ]), "t"));
        const group = done.ids["tmp:group"]!;
        expect(done.world.data.entries.get("e2")!.parent).toBe(group);
        expect(done.world.data.entries.get(group)!.init.data.character!.fields.外观).toBe("古旧的塔");
        expect(done.world.data.entries.get(group)!.order).toBe(2);
    });

    test("同一批里改同一处，或一个是另一个下面的地址：拒收", () => {
        const base = world();
        expect(problemCode(editEntries(base, batch([
            {op: "set", at: {entry: "e1", path: "panel.存款"}, value: 1},
            {op: "set", at: {entry: "e1", path: "panel.存款"}, value: 2},
        ]), "t"))).toBe("duplicate-address");
        expect(problemCode(editEntries(base, batch([
            {op: "listRemove", at: {entry: "e1", path: "panel.物品[i1]"}},
            {op: "set", at: {entry: "e1", path: "panel.物品[i1].数量"}, value: 2},
        ]), "t"))).toBe("duplicate-address");
        // 同一个临时 id 建两次、新建时同一类型列两次：不让后一份盖掉前一份，整批拒收。
        expect(problemCode(editEntries(base, batch([
            {op: "create", id: "tmp:dup", entry: {name: "甲", kind: "人物"}},
            {op: "create", id: "tmp:dup", entry: {name: "乙", kind: "人物"}},
        ]), "t"))).toBe("id-taken");
        expect(problemCode(editEntries(base, batch([
            {op: "create", id: "tmp:twice", entry: {name: "丙", kind: "人物", components: [{type: PERSON.id, fields: {外观: "金发"}}, {type: PERSON.id}]}},
        ]), "t"))).toBe("duplicate-address");
        // 同一个列表加两项不算同一处。
        ok(editEntries(base, batch([
            {op: "listAdd", at: {entry: "e1", path: "panel.物品"}, element: {label: "铃", 数量: 1}},
            {op: "listAdd", at: {entry: "e1", path: "panel.物品"}, element: {label: "镜", 数量: 1}},
        ]), "t"));
    });

    test("设定组：加上的字段都是未知；去掉保留数据，再加回来去掉标记；条目读取列出去掉过的", () => {
        const base = world();
        const added = ok(editEntries(base, batch([{op: "component", entry: "e2", type: PERSON.id, action: "add"}]), "t")).world;
        expect(added.data.entries.get("e2")!.init.data.character).toEqual({type: PERSON.id, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: null}});
        const removed = ok(editEntries(base, batch([{op: "component", entry: "e1", type: PERSON.id, action: "remove"}]), "t")).world;
        const view = removed.line().engine.entry("e1", end("ch50"), "actual");
        expect(view !== null && view !== "chapter-not-found" && view.removedComponents).toEqual([{namespace: "character", type: PERSON.id}]);
        const back = ok(editEntries(removed, batch([{op: "component", entry: "e1", type: PERSON.id, action: "add"}], {baseVersion: 3}), "t")).world;
        expect(back.data.entries.get("e1")!.init.data.character!.removed).toBeUndefined();
        expect(back.data.entries.get("e1")!.init.data.character!.fields.外观).toBe("银白");
    });

    test("移动：放在某项之后取中数，数用尽时拒收；删除与恢复", () => {
        const base = world();
        const moved = ok(editEntries(base, batch([{op: "place", entry: "e2", after: null}]), "t")).world;
        expect(moved.data.entries.get("e2")!.order).toBeLessThan(moved.data.entries.get("e1")!.order);
        const tight = ok(editEntries(base, batch([{op: "create", id: "tmp:x", entry: {name: "甲", kind: "物品"}}]), "t")).world;
        // 把两个兄弟的顺序挤到相邻的两个浮点数：中数落不进两者之间。
        const squeezed = ok(tight.publish({requestId: id(), by: author, what: "edit", title: "挤", baseVersion: 3, puts: [{ref: {kind: "entry", id: "e1"}, after: {...tight.data.entries.get("e1")!, order: 1}}, {ref: {kind: "entry", id: "e2"}, after: {...tight.data.entries.get("e2")!, order: 1 + Number.EPSILON}}]}, "t") as WriteResult).world;
        expect(problemCode(editEntries(squeezed, batch([{op: "place", entry: [...squeezed.data.entries.keys()].at(-1)!, after: "e1"}], {baseVersion: 4}), "t"))).toBe("order-exhausted");
        const deleted = ok(editEntries(base, batch([{op: "delete", entry: "e2"}]), "t")).world;
        expect(deleted.data.entries.get("e2")!.deleted).toBe(true);
        const restored = ok(editEntries(deleted, batch([{op: "restore", entry: "e2"}], {baseVersion: 3}), "t")).world;
        expect(restored.data.entries.get("e2")!.deleted).toBeUndefined();
    });

    test("预览与写入走同一份方案：修订的操作与带来的变化相同", () => {
        const base = world();
        const input = batch([{op: "set", at: {entry: "e1", path: "character.外观"}, value: "深棕"}, {op: "listAdd", at: {entry: "e1", path: "panel.物品"}, element: {label: "铃", 数量: 1}}]);
        const preview = ok(previewEntries(base, input, "t"));
        const written = ok(editEntries(base, input, "t"));
        expect(preview.revision.ops).toEqual(written.revision.ops);
        expect(preview.revision.impact).toEqual(written.revision.impact);
        expect(preview.routes).toEqual(written.routes);
        expect(base.version).toBe(2);
    });

    test("同一个请求 id 重发同样的输入得到第一次的结果；输入不同拒收", () => {
        const base = world();
        const input = batch([{op: "set", at: {entry: "e1", path: "panel.存款"}, value: 50000}]);
        const first = ok(editEntries(base, input, "t"));
        const again = ok(editEntries(first.world, input, "t"));
        expect(again.repeated).toBe(true);
        expect(again.revision.id).toBe(first.revision.id);
        expect(problemCode(editEntries(first.world, {...input, ops: [{op: "set", at: {entry: "e1", path: "panel.存款"}, value: 1}]}, "t"))).toBe("request-id-reused");
    });

    test("读取戳：之间有新修订，或版本没变而读取的输入变了，都拒收 stale-read", () => {
        const base = world();
        const stamp = {version: 2, input: "aaaa"};
        const now = (version: number, inputDigest: string) => ({stamp: () => ({now: {version, inputDigest}, revisions: [{id: "r3", version: 3, title: "作者改了", by: author}]})});
        const input = batch([{op: "set", at: {entry: "e1", path: "panel.存款"}, value: 1}], {readStamp: stamp});
        const newer = editEntries(base, input, "t", now(3, "aaaa1111"));
        expect(newer.ok === false && newer.failure).toMatchObject({code: "stale-read", inputChanged: false, revisions: [{id: "r3", title: "作者改了"}]});
        const drifted = editEntries(base, input, "t", now(2, "bbbb1111"));
        expect(drifted.ok === false && drifted.failure).toMatchObject({code: "stale-read", inputChanged: true});
        ok(editEntries(base, input, "t", now(2, "aaaa1111")));
    });
});
