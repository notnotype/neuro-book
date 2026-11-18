import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type Entry, type WriteRequest} from "../src/index";
import {editInPlace, previewEdit, recordDelta, recordNote, replaceOnce} from "../src/world/edits";
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
    const change = (tmp: string, chapter: string, key: number, patches: unknown[]) => ({ref: {kind: "change" as const, id: tmp}, after: {id: tmp, kind: "written", text: tmp.slice("tmp:".length), at: {kind: "chapter", chapter, key}, told: [], involves: ["e1"], lines: [], links: [], patches, status: "active", by: author}});
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
        const dye = [...result.world.data.changes.values()].find((change) => change.text === "dye")!;
        expect(dye.patches[0]!.value).toBe("深棕");
        expect(result.world.data.entries.get("e1")!.init.data.character!.fields.外观).toBe("银白");
        expect(result.world.line().engine.entry("e1", end("ch44"), "actual")).toMatchObject({namespaces: {character: {fields: {外观: {value: "银白"}}}}});
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
        expect(story.world.line().engine.entry("e1", end("ch50"), "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 41000}}}}});
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
        expect(result.world.line().engine.entry("e1", end("ch50"), "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 41500}}}}});
    });

    test("记一笔的差额超过 4 位小数被拒收，不悄悄舍入；列表元素里的数同样记成一次加减", () => {
        const tiny = recordDelta(world(), {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "panel.存款"}, delta: 0.00001, reason: "零头", read: {value: 41800, version: 2}}, "t");
        expect(tiny.ok === false && tiny.failure).toMatchObject({code: "validation-failed", problems: [{code: "number-out-of-range"}]});

        const bag = ok(world().publish({requestId: id(), by: author, what: "edit", title: "买药", baseVersion: 2, puts: [{ref: {kind: "change", id: "tmp:buy"}, after: {id: "tmp:buy", kind: "written", text: "买药", at: {kind: "chapter", chapter: "ch45", key: 30}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "listAdd", at: {entry: "e1", path: "panel.物品"}, value: {id: "药", label: "药", 数量: 3}}], status: "active", by: author}}]} as WriteRequest, "t") as WriteResult);
        const used = ok(recordDelta(bag.world, {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "panel.物品[药].数量"}, delta: -1, reason: "吃了一颗", read: {value: 3, version: 3}}, "t"));
        const patch = used.revision.ops.flatMap((op) => (op.kind === "create" ? (op.after as {patches: unknown[]}).patches : []))[0];
        expect(patch).toMatchObject({op: "add", at: {entry: "e1", path: "panel.物品[药].数量"}, value: -1});
    });

    test("文字替换：A 恰好出现一次才替换", () => {
        expect(replaceOnce("银白长发，银白眼", "银白长发", "淡金长发")).toBe("淡金长发，银白眼");
        expect(replaceOnce("银白长发，银白眼", "银白", "淡金")).toBe("replace-not-unique");
        expect(replaceOnce("银白长发", "黑", "白")).toBe("replace-not-found");
    });
});

describe("canon.revisions 输出 8：就地改的路由表与失败码（值不完整、字段不可用、语义档、结果核对、后面改过的记录）", () => {
    /** 把星瑕的初值存款改到 500：第 44 章扣 1000 的那笔套不上，存款从第 44 章起不完整。版本 3。 */
    function broken(): World {
        const base = world();
        const next = structuredClone(base.data.entries.get("e1")!);
        next.init.data.panel!.fields.存款 = 500;
        return ok(base.publish({requestId: id(), by: author, what: "edit", title: "改初值", baseVersion: 2, puts: [{ref: {kind: "entry", id: "e1"}, after: next}]} as WriteRequest, "t") as WriteResult).world;
    }
    const deposit = {entry: "e1", path: "panel.存款"} as const;

    test("值不完整：创作修改拒收（incomplete-field）；剧情变化只接受赋值，记成这个位置上的一条赋值", () => {
        const base = broken();
        const view = base.line().engine.entry("e1", end("ch50"), "actual");
        expect(view !== null && view !== "chapter-not-found" && view.namespaces.panel!.fields.存款).toMatchObject({value: 3300, incomplete: {reason: "constraint-violated"}});
        const edit = {requestId: id(), by: author, position: end("ch50"), at: deposit, value: 700, read: {value: 3300, version: 3}} as const;
        const refused = editInPlace(base, edit, "t");
        expect(refused.ok === false && refused.failure).toEqual({code: "incomplete-field"});

        const story = ok(editInPlace(base, {...edit, requestId: id(), intent: "story"}, "t"));
        const created = story.revision.ops[0]!;
        expect(created.kind === "create" && (created.after as {patches: unknown[]}).patches).toMatchObject([{op: "set", at: deposit, value: 700}]);
        const after = story.world.line().engine.entry("e1", end("ch50"), "actual");
        expect(after !== null && after !== "chapter-not-found" && after.namespaces.panel!.fields.存款).toEqual({value: 700});
    });

    test("命名空间没启用、已去掉、版本对不上、类型不在：读到的字段不可用，两种意图都拒收（field-unavailable）", () => {
        const failureOf = (target: World): Array<string | false> => {
            const edit = {requestId: id(), by: author, position: end("ch50"), at: deposit, value: 1, read: {value: 39000, version: target.version}} as const;
            const creative = editInPlace(target, edit, "t");
            const story = editInPlace(target, {...edit, requestId: id(), intent: "story"}, "t");
            return [creative.ok === false && creative.failure.code, story.ok === false && story.failure.code];
        };
        const refused = ["field-unavailable", "field-unavailable"];
        const withPanel = (change: (data: NonNullable<Entry["init"]["data"][string]>) => void) => {
            const base = world();
            const next = structuredClone(base.data.entries.get("e1")!);
            change(next.init.data.panel!);
            return ok(base.publish({requestId: id(), by: author, what: "edit", title: "改", baseVersion: 2, puts: [{ref: {kind: "entry", id: "e1"}, after: next}]} as WriteRequest, "t") as WriteResult).world;
        };
        expect(failureOf(withPanel((panel) => (panel.enabled = false)))).toEqual(refused);
        expect(failureOf(withPanel((panel) => (panel.removed = true)))).toEqual(refused);
        expect(failureOf(world().withOptions({...options(), registry: buildRegistry([{...PANEL, version: 2}, PERSON])}))).toEqual(refused);
        expect(failureOf(world().withOptions({...options(), registry: buildRegistry([PERSON])}))).toEqual(refused);
    });

    test("语义档：没有事件时创作修改改起点（初值）；有事件时拒收（accumulated-value）；剧情变化记一条赋值成为新的起点", () => {
        const withAttitude = () => {
            const base = world();
            const next = structuredClone(base.data.entries.get("e1")!);
            next.init.data.character!.fields.态度 = "冷淡";
            return ok(base.publish({requestId: id(), by: author, what: "edit", title: "加态度", baseVersion: 2, puts: [{ref: {kind: "entry", id: "e1"}, after: next}]} as WriteRequest, "t") as WriteResult).world;
        };
        const attitude = {entry: "e1", path: "character.态度"} as const;
        const quiet = withAttitude();
        const edited = ok(editInPlace(quiet, {requestId: id(), by: author, position: end("ch50"), at: attitude, value: "缓和", read: {value: "冷淡", version: 3}}, "t"));
        expect(edited.world.data.entries.get("e1")!.init.data.character!.fields.态度).toBe("缓和");

        const noted = ok(quiet.publish({requestId: id(), by: author, what: "bookkeeping", title: "事件", baseVersion: 3, puts: [{ref: {kind: "change", id: "tmp:n"}, after: {id: "tmp:n", kind: "written", text: "n", at: {kind: "chapter", chapter: "ch45", key: 40}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "note", at: attitude, value: "第 45 章：软了一点"}], status: "active", by: author}}]} as WriteRequest, "t") as WriteResult).world;
        const read = {value: "冷淡；之后：第 45 章：软了一点", version: 4};
        const refused = editInPlace(noted, {requestId: id(), by: author, position: end("ch50"), at: attitude, value: "缓和", read}, "t");
        expect(refused.ok === false && refused.failure.code).toBe("accumulated-value");

        const restarted = ok(editInPlace(noted, {requestId: id(), by: author, position: end("ch50"), at: attitude, value: "缓和", read, intent: "story"}, "t"));
        const view = restarted.world.line().engine.entry("e1", end("ch50"), "actual");
        expect(view !== null && view !== "chapter-not-found" && view.namespaces.character!.fields.态度).toEqual({label: "现在的态度", value: "缓和"});
    });

    test("发布后读回的值与给的新值不同：整次拒收，说明读回的是什么（result-mismatch），世界不变", () => {
        const base = world();
        const next = structuredClone(base.data.entries.get("e1")!);
        next.init.data.character!.fields.态度 = "冷淡";
        const withAttitude = ok(base.publish({requestId: id(), by: author, what: "edit", title: "加态度", baseVersion: 2, puts: [{ref: {kind: "entry", id: "e1"}, after: next}]} as WriteRequest, "t") as WriteResult).world;
        // 语义档的值读出来总是文字：给一个数，读回 "7"，与给的 7 不同。
        const result = editInPlace(withAttitude, {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "character.态度"}, value: 7, read: {value: "冷淡", version: 3}, intent: "story"}, "t");
        expect(result.ok === false && result.failure).toEqual({code: "result-mismatch", got: "7"});
        expect(withAttitude.version).toBe(3);
    });

    test("结果另列后面改过同一地址的记录：赋值与加减都列，更早的、别的地址的不列", () => {
        const base = world();
        // 第 50 章再染一次发色、再加一笔存款；第 44 章那笔存款在读取位置之前。
        const later = ok(base.publish({requestId: id(), by: author, what: "bookkeeping", title: "后面的记录", baseVersion: 2, puts: [
            {ref: {kind: "change", id: "tmp:dye2"}, after: {id: "tmp:dye2", kind: "written", text: "dye2", at: {kind: "chapter", chapter: "ch50", key: 10}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "set", at: {entry: "e1", path: "character.外观"}, value: "红色"}], status: "active", by: author}},
            {ref: {kind: "change", id: "tmp:pay"}, after: {id: "tmp:pay", kind: "written", text: "pay", at: {kind: "chapter", chapter: "ch50", key: 20}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: 5}], status: "active", by: author}},
        ]} as WriteRequest, "t") as WriteResult).world;
        const idOf = (text: string) => [...later.data.changes.values()].find((change) => change.text === text)!.id;

        const dyed = ok(editInPlace(later, {requestId: id(), by: author, position: end("ch45"), at: {entry: "e1", path: "character.外观"}, value: "深棕", read: {value: "黑色", version: 3}}, "t"));
        expect(dyed.laterRecords).toEqual([idOf("dye2")]);

        // 在第 50 章末尾读到的是 dye2 给的值，后面没有别的记录。
        const newest = ok(editInPlace(later, {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "character.外观"}, value: "深棕", read: {value: "红色", version: 3}}, "t"));
        expect(newest.laterRecords).toEqual([]);

        // 记一笔：第 44 章之后的两笔加减（第 45 章 +2800、第 50 章 +5）都会跟着变。
        const delta = ok(recordDelta(later, {requestId: id(), by: author, position: end("ch44"), at: {entry: "e1", path: "panel.存款"}, delta: -300, reason: "买药", read: {value: 39000, version: 3}}, "t"));
        expect(delta.laterRecords).toEqual([idOf("b"), idOf("pay")]);
    });
});

describe("canon.revisions 输出 22、23、24 与场景 8：预览、语义档的记一笔、请求 id 重发", () => {
    const deposit = {entry: "e1", path: "panel.存款"} as const;
    const attitude = {entry: "e1", path: "character.态度"} as const;
    /** 修订里与写入结果无关的字段（请求 id、时间）不比：Spec 只要求操作与带来的变化逐字相同。 */
    const outcome = (result: {revision: {ops: unknown; impact: unknown}; laterRecords: readonly string[]}) => ({ops: result.revision.ops, impact: result.revision.impact, laterRecords: result.laterRecords});

    test("只在初值设过的值：预览的路由是改初值，操作只有条目这一个字段；随后同样的输入写入，操作与带来的变化与预览相同", () => {
        const base = world();
        const edit = {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "entry.name"}, value: "夜王", read: {value: "星瑕", version: 2}} as const;
        const preview = ok(previewEdit(base, {kind: "edit", ...edit}, "t"));
        expect(preview.route).toEqual({kind: "init"});
        expect(preview.revision.ops).toEqual([{ref: {kind: "entry", id: "e1"}, kind: "modify", fields: [{path: "init.name", before: "星瑕", after: "夜王"}]}]);
        // 预览不发布：世界没变，同一个请求 id 随后照常写入。
        expect(base.requested(edit.requestId)).toBeUndefined();
        const written = ok(editInPlace(base, edit, "t"));
        expect(written.repeated).toBe(false);
        expect(outcome(written)).toEqual(outcome(preview));
    });

    test("改的是某条变更的赋值：路由指到那条变更里的那个补丁；几笔累出来的数：预览得到同样的 accumulated-value", () => {
        const base = world();
        const dye = [...base.data.changes.values()].find((change) => change.text === "dye")!;
        const preview = ok(previewEdit(base, {kind: "edit", requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "character.外观"}, value: "深棕", read: {value: "黑色", version: 2}}, "t"));
        expect(preview.route).toEqual({kind: "patch", change: dye.id, patch: 0});

        const refused = previewEdit(base, {kind: "edit", requestId: id(), by: author, position: end("ch50"), at: deposit, value: 41000, read: {value: 41800, version: 2}}, "t");
        expect(refused.ok === false && refused.failure.code).toBe("accumulated-value");
    });

    test("意图是剧情变化、记一笔：路由是在这一章最后新记一条变更；预览与写入相同", () => {
        const base = world();
        const story = {requestId: id(), by: author, position: end("ch50"), at: deposit, value: 41000, read: {value: 41800, version: 2}, intent: "story"} as const;
        const preview = ok(previewEdit(base, {kind: "edit", ...story}, "t"));
        expect(preview.route).toEqual({kind: "change", at: {kind: "chapter", chapter: "ch50", key: 0}});
        expect(outcome(ok(editInPlace(base, story, "t")))).toEqual(outcome(preview));

        const delta = {requestId: id(), by: author, position: end("ch45"), at: deposit, delta: -300, reason: "买药", read: {value: 41800, version: 2}} as const;
        const previewed = ok(previewEdit(base, {kind: "delta", ...delta}, "t"));
        // 第 45 章已有键 10、20 的两条：新的一条排在最后。
        expect(previewed.route).toEqual({kind: "change", at: {kind: "chapter", chapter: "ch45", key: 21}});
        expect(outcome(ok(recordDelta(base, delta, "t")))).toEqual(outcome(previewed));
    });

    test("请求 id 用过也不影响预览：预览的结果与没用过时一样", () => {
        const base = world();
        const used = id();
        const after = ok(recordDelta(base, {requestId: used, by: author, position: end("ch50"), at: deposit, delta: -300, reason: "买药", read: {value: 41800, version: 2}}, "t")).world;
        const edit = {by: author, position: end("ch50"), at: deposit, delta: 100, reason: "捡到钱", read: {value: 41500, version: 3}} as const;
        expect(outcome(ok(previewEdit(after, {kind: "delta", requestId: used, ...edit}, "t")))).toEqual(outcome(ok(previewEdit(after, {kind: "delta", requestId: id(), ...edit}, "t"))));
    });

    test("语义档的记一笔：在这个位置多一条变更，文字与事件是同一句；不是语义档、初值位置、读到的值过期各有各的失败", () => {
        const base = world();
        const next = structuredClone(base.data.entries.get("e1")!);
        next.init.data.character!.fields.态度 = "冷淡";
        const quiet = ok(base.publish({requestId: id(), by: author, what: "edit", title: "加态度", baseVersion: 2, puts: [{ref: {kind: "entry", id: "e1"}, after: next}]} as WriteRequest, "t") as WriteResult).world;
        const note = {requestId: id(), by: author, position: end("ch45"), at: attitude, text: "把卡推了回去", read: {value: "冷淡", version: 3}} as const;

        const preview = ok(previewEdit(quiet, {kind: "note", ...note}, "t"));
        expect(preview.route).toEqual({kind: "change", at: {kind: "chapter", chapter: "ch45", key: 21}});
        const noted = ok(recordNote(quiet, note, "t"));
        expect(outcome(noted)).toEqual(outcome(preview));
        const created = noted.revision.ops[0]!;
        expect(created.kind === "create" && created.after).toMatchObject({kind: "written", text: "把卡推了回去", at: {kind: "chapter", chapter: "ch45", key: 21}, patches: [{op: "note", at: attitude, value: "把卡推了回去"}]});
        // 字段多了一条事件：读到的是起点加事件（没有归纳），起点不变。
        const view = noted.world.line().engine.entry("e1", end("ch45"), "actual");
        expect(view !== null && view !== "chapter-not-found" && view.namespaces.character!.fields.态度).toMatchObject({unreduced: {anchor: "冷淡", events: 1}});
        expect(noted.world.line().engine.entry("e1", end("ch44"), "actual")).toMatchObject({namespaces: {character: {fields: {态度: {value: "冷淡"}}}}});

        const notSemantic = recordNote(quiet, {...note, requestId: id(), at: deposit, read: {value: 41800, version: 3}}, "t");
        expect(notSemantic.ok === false && notSemantic.failure).toMatchObject({code: "validation-failed", problems: [{code: "type-mismatch"}]});
        const initial = recordNote(quiet, {...note, requestId: id(), position: {kind: "initial"}}, "t");
        expect(initial.ok === false && initial.failure.code).toBe("intent-not-allowed");
        const stale = recordNote(quiet, {...note, requestId: id(), read: {value: "热情", version: 3}}, "t");
        expect(stale.ok === false && stale.failure).toEqual({code: "value-conflict", current: "冷淡"});
    });

    test("同一个请求 id 再提交同样的输入：返回第一次的修订，不多出修订，也不因为值已经变了报冲突；换了输入得到 request-id-reused", () => {
        const base = world();
        const edit = {requestId: id(), by: author, position: end("ch50"), at: {entry: "e1", path: "entry.name"}, value: "夜王", read: {value: "星瑕", version: 2}} as const;
        const first = ok(editInPlace(base, edit, "t"));
        const again = ok(editInPlace(first.world, edit, "t"));
        expect(again).toMatchObject({repeated: true, revision: {id: first.revision.id}});
        expect(again.world.version).toBe(first.world.version);
        const other = editInPlace(first.world, {...edit, value: "白王"}, "t");
        expect(other.ok === false && other.failure.code).toBe("request-id-reused");

        const delta = {requestId: id(), by: author, position: end("ch50"), at: deposit, delta: -300, reason: "买药", read: {value: 41800, version: 3}} as const;
        const recorded = ok(recordDelta(first.world, delta, "t"));
        expect(ok(recordDelta(recorded.world, delta, "t"))).toMatchObject({repeated: true, revision: {id: recorded.revision.id}});
        const changed = recordDelta(recorded.world, {...delta, delta: -500}, "t");
        expect(changed.ok === false && changed.failure.code).toBe("request-id-reused");
    });

    test("改几笔里的一笔是对那条变更的普通写入：读出它、换掉那一处的值、预览再发布；读出以后它被改过得到 version-conflict", () => {
        const base = world();
        const b = [...base.data.changes.values()].find((change) => change.text === "b")!;
        const request: WriteRequest = {requestId: id(), by: author, what: "edit", title: "把这一笔改成 +2000", baseVersion: 2, puts: [{ref: {kind: "change", id: b.id}, after: {...b, patches: [{...b.patches[0]!, value: 2000}]}}]};
        const preview = ok(base.preview(request, "t"));
        const published = ok(base.publish(request, "t"));
        expect(published.revision.ops).toEqual(preview.revision.ops);
        expect(published.world.line().engine.entry("e1", end("ch50"), "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 41000}}}}});
        // 基于旧版本再改同一条变更：它已经被上面那次改过。
        const stale = published.world.publish({...request, requestId: id(), puts: [{ref: {kind: "change", id: b.id}, after: {...b, patches: [{...b.patches[0]!, value: 1000}]}}]}, "t");
        expect(stale.ok === false && stale.failure.code).toBe("version-conflict");
    });
});
