/**
 * 就地改、记一笔与语义档的记一笔改成一项操作的批量编辑之后（docs/specs/canon/revisions.md 输出 25 的“单项入口”），同样的输入经
 * t37 之前的实现（`fixtures/legacy-edits.ts`）与现在的实现：成没成、失败、修订（操作、带来的变化、`what`、章、标题、请求摘要）、
 * 路由与后面改过的记录逐字相同。有意不同的三处另写断言：章首的剧情变化（以前读回必然对不上）、显式写主线（`worldlines.test.ts`）、
 * 列表元素的改设定（以前看来历最后一步，元素来自初值也会被别的元素的增元素挡住）。
 */

import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type Entry, type WriteRequest} from "../src/index";
import * as current from "../src/world/edits";
import {World, type WriteResult} from "../src/world/world";
import * as legacy from "./fixtures/legacy-edits";
import {PANEL, PERSON} from "./fixtures/world";

const options = () => ({
    order: new ChapterOrder(["ch44", "ch45", "ch50"]),
    registry: buildRegistry([PANEL, PERSON]),
    reductions: () => undefined,
    chapterText: () => "",
    digest: (text: string) => createHash("sha256").update(text).digest("hex"),
});
const author = {kind: "author"} as const;

function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}

/** 同 `edits.test.ts`：星瑕初值银白发、存款 40000、物品 i1；第 44 章加物品 i2 并花 1000；第 45 章染黑、得 2800。版本 2。 */
function world(): World {
    const xia: Entry = {
        id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0,
        init: {name: "星瑕", aliases: [], summary: "", text: [{id: "b1", source: "她是学生。"}], data: {
            panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 40000, 魔力上限: null, 魔力: null, 物品: [{id: "i1", label: "魔杖", 数量: 1}]}, declared: []},
            character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: "银白", 状态: null, 态度: "平静"}},
        }},
    };
    const first = ok(World.empty(options()).publish({requestId: "open", by: author, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:xia"}, after: xia}]} as WriteRequest, "t"));
    const change = (tmp: string, chapter: string, key: number, patches: unknown[]) => ({ref: {kind: "change" as const, id: tmp}, after: {id: tmp, kind: "written", text: tmp.slice("tmp:".length), at: {kind: "chapter", chapter, key}, told: [], involves: ["e1"], lines: [], links: [], patches, status: "active", by: author}});
    return ok(first.world.publish({requestId: "book", by: author, what: "bookkeeping", title: "记账", baseVersion: 1, puts: [
        change("tmp:a", "ch44", 10, [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: -1000}, {op: "listAdd", at: {entry: "e1", path: "panel.物品"}, value: {id: "i2", label: "药水", 数量: 3}}]),
        change("tmp:dye", "ch45", 10, [{op: "set", at: {entry: "e1", path: "character.外观"}, value: "黑色"}]),
        change("tmp:b", "ch45", 20, [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: 2800}]),
    ]} as WriteRequest, "t")).world;
}

const end = (chapter: string) => ({kind: "chapter" as const, chapter, edge: "end" as const});
const at = (path: string) => ({entry: "e1", path});
const read = (value: unknown) => ({value, version: 2});

/** 结果里能比的部分：世界对象不比，比它的版本。 */
function comparable(result: {ok: boolean} & Record<string, unknown>): unknown {
    const {world: next, ...rest} = result as {world?: World} & Record<string, unknown>;
    return {...rest, ...(next === undefined ? {} : {version: next.version})};
}

const EDITS: readonly [string, current.InPlaceEdit][] = [
    ["改设定：改给出这个值的变更", {requestId: "e1", by: author, position: end("ch50"), at: at("character.外观"), value: "深棕", read: read("黑色")}],
    ["改设定：只有初值的改初值", {requestId: "e2", by: author, position: end("ch44"), at: at("character.外观"), value: "金色", read: read("银白")}],
    ["改设定：名字", {requestId: "e3", by: author, position: end("ch44"), at: at("entry.name"), value: "夜王", read: read("星瑕")}],
    ["改设定：主文字的块", {requestId: "e4", by: author, position: end("ch50"), at: at("text[b1]"), value: "她是二年级学生。", read: read("她是学生。")}],
    ["改设定：几笔累出来的数", {requestId: "e5", by: author, position: end("ch50"), at: at("panel.存款"), value: 41000, read: read(41800)}],
    ["剧情变化：数记成差额", {requestId: "e6", by: author, position: end("ch50"), at: at("panel.存款"), value: 41000, read: read(41800), intent: "story"}],
    ["剧情变化：文字记成赋值，带标题", {requestId: "e7", by: author, position: end("ch45"), at: at("character.状态"), value: "受伤", read: read(null), intent: "story", title: "摔了一跤"}],
    ["剧情变化：初值上不行", {requestId: "e8", by: author, position: {kind: "initial"}, at: at("panel.存款"), value: 1, read: read(40000), intent: "story"}],
    ["读到的值过期", {requestId: "e9", by: author, position: end("ch44"), at: at("entry.name"), value: "x", read: read("旧名")}],
    ["字段不存在", {requestId: "e10", by: author, position: end("ch50"), at: at("character.不存在"), value: "x", read: read(null)}],
    ["章不存在", {requestId: "e11", by: author, position: end("ch99"), at: at("panel.存款"), value: 1, read: read(1)}],
    ["语义档：改起点", {requestId: "e12", by: author, position: end("ch50"), at: at("character.态度"), value: "紧张", read: read("平静")}],
    ["剧情变化：列表元素的数记成差额", {requestId: "e13", by: author, position: end("ch50"), at: at("panel.物品[i2].数量"), value: 1, read: read(3), intent: "story"}],
];

const DELTAS: readonly [string, current.DeltaRecord][] = [
    ["记一笔", {requestId: "d1", by: author, position: end("ch50"), at: at("panel.存款"), delta: -300, reason: "买药", read: read(41800)}],
    ["记一笔：差额超出精度", {requestId: "d2", by: author, position: end("ch50"), at: at("panel.存款"), delta: 0.00001, reason: "零头", read: read(41800)}],
    ["记一笔：读到的不是数", {requestId: "d3", by: author, position: end("ch50"), at: at("character.外观"), delta: 1, reason: "x", read: read("黑色")}],
    ["记一笔：读到的值过期", {requestId: "d4", by: author, position: end("ch50"), at: at("panel.存款"), delta: 1, reason: "x", read: read(1)}],
];

const NOTES: readonly [string, current.NoteRecord][] = [
    ["语义档的记一笔", {requestId: "n1", by: author, position: end("ch50"), at: at("character.态度"), text: "听说哥哥回来了", read: read("平静")}],
    ["语义档的记一笔：不是语义档", {requestId: "n2", by: author, position: end("ch50"), at: at("character.外观"), text: "x", read: read("黑色")}],
    ["语义档的记一笔：读到的值过期", {requestId: "n3", by: author, position: end("ch50"), at: at("character.态度"), text: "x", read: read("别的")}],
];

describe("单项入口：新旧实现逐字相同（revisions.md 输出 25）", () => {
    for (const [label, edit] of EDITS) {
        test(`就地改 · ${label}`, () => {
            expect(comparable(current.editInPlace(world(), edit, "t"))).toEqual(comparable(legacy.editInPlace(world(), edit, "t")));
            expect(comparable(current.previewEdit(world(), {kind: "edit", ...edit}, "t"))).toEqual(comparable(legacy.previewEdit(world(), {kind: "edit", ...edit}, "t")));
        });
    }
    for (const [label, input] of DELTAS) {
        test(`记一笔 · ${label}`, () => {
            expect(comparable(current.recordDelta(world(), input, "t"))).toEqual(comparable(legacy.recordDelta(world(), input, "t")));
            expect(comparable(current.previewEdit(world(), {kind: "delta", ...input}, "t"))).toEqual(comparable(legacy.previewEdit(world(), {kind: "delta", ...input}, "t")));
        });
    }
    for (const [label, input] of NOTES) {
        test(`语义档的记一笔 · ${label}`, () => {
            expect(comparable(current.recordNote(world(), input, "t"))).toEqual(comparable(legacy.recordNote(world(), input, "t")));
            expect(comparable(current.previewEdit(world(), {kind: "note", ...input}, "t"))).toEqual(comparable(legacy.previewEdit(world(), {kind: "note", ...input}, "t")));
        });
    }

    test("已发布的请求重发：同样的输入得到第一次的结果，输入不同拒收；两种实现发布的请求互认", () => {
        const [, edit] = EDITS[0]!;
        const first = ok(legacy.editInPlace(world(), edit, "t") as WriteResult);
        const again = current.editInPlace(first.world, edit, "t");
        expect(again.ok && again.repeated).toBe(true);
        expect(again.ok && again.revision.id).toBe(first.revision.id);
        const changed = current.editInPlace(first.world, {...edit, value: "别的"}, "t");
        expect(changed.ok === false && changed.failure).toEqual({code: "request-id-reused"});
    });
});

describe("有意不同的地方（revisions.md 输出 25）", () => {
    test("章首记剧情变化：以前在章首读回必然对不上（result-mismatch），现在在新变更之后读，写得进去", () => {
        const edit: current.InPlaceEdit = {requestId: "s1", by: author, position: {kind: "chapter", chapter: "ch45", edge: "start"}, at: at("character.状态"), value: "受伤", read: read(null), intent: "story"};
        const before = legacy.editInPlace(world(), edit, "t");
        expect(before.ok === false && before.failure.code).toBe("result-mismatch");
        const now = current.editInPlace(world(), edit, "t");
        expect(now.ok).toBe(true);
        const view = now.ok ? now.world.line().engine.entry("e1", end("ch45"), "actual") : null;
        expect(view !== null && view !== "chapter-not-found" && view.namespaces.character!.fields.状态!.value).toBe("受伤");
    });

    test("改设定里列表元素的子字段：初值里的元素不再被别的元素的增元素挡住；变更加的元素改报 element-from-change", () => {
        const own: current.InPlaceEdit = {requestId: "l1", by: author, position: end("ch50"), at: at("panel.物品[i1].数量"), value: 2, read: read(1)};
        const before = legacy.editInPlace(world(), own, "t");
        expect(before.ok === false && before.failure.code).toBe("accumulated-value");
        const now = current.editInPlace(world(), own, "t");
        expect(now.ok && now.world.data.entries.get("e1")!.init.data.panel!.fields.物品).toEqual([{id: "i1", label: "魔杖", 数量: 2}]);
        const added = current.editInPlace(world(), {...own, requestId: "l2", at: at("panel.物品[i2].数量"), value: 5, read: read(3)}, "t");
        expect(added.ok === false && added.failure).toMatchObject({code: "validation-failed", problems: [{code: "element-from-change"}]});
    });
});
