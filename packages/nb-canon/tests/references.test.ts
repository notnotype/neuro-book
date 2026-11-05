import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type ComponentDeclaration, type Entry, type Patch, type StoryChangeDraft, type WriteRequest} from "../src/index";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {PERSON} from "./fixtures/world";

/** 一个以引用为键的列表（一人一点一行）与一个 ref 字段，形状仿照剧情插件的知情。 */
const KNOWING: ComponentDeclaration = {
    id: "test.knowing",
    label: "知情",
    namespace: "know",
    version: 1,
    fields: [
        {id: "知情", label: "知情", kind: "list", keyedBy: "ref", targets: ["知识点"], item: [
            {id: "程度", label: "程度", kind: "enum", options: ["knows", "unaware"]},
            {id: "谁告诉的", label: "谁告诉的", kind: "ref", targets: ["人物"]},
        ]},
        {id: "基于", label: "基于", kind: "ref", targets: ["知识点"]},
    ],
};

function options(declarations: readonly ComponentDeclaration[] = [KNOWING, PERSON]): WorldOptions {
    return {
        order: new ChapterOrder(["ch1", "ch2"]),
        registry: buildRegistry(declarations),
        reductions: () => undefined,
        chapterText: () => "",
        digest: (text) => createHash("sha256").update(text).digest("hex"),
    };
}

let sequence = 0;
function request(puts: WriteRequest["puts"], baseVersion: number): WriteRequest {
    return {requestId: `ref-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "引用", baseVersion, puts};
}

function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}

function person(id: string, name: string): Entry {
    return {id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data: {know: {type: KNOWING.id, version: 1, enabled: true, fields: {知情: [], 基于: null}}}}};
}

function point(id: string, name: string): Entry {
    return {id, type: "知识点", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: name, text: [], data: {}}};
}

function change(id: string, patches: Patch[], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft {
    return {id, kind: "written", text: "知道了", at: {kind: "chapter", chapter: "ch1", key: 1}, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra};
}

/** 星瑾（e1）与星瑕（e2），版本 1。 */
function start(declarations?: readonly ComponentDeclaration[]): World {
    return ok(World.empty(options(declarations)).publish(request([
        {ref: {kind: "entry", id: "tmp:jin"}, after: person("tmp:jin", "星瑾")},
        {ref: {kind: "entry", id: "tmp:xia"}, after: person("tmp:xia", "星瑕")},
    ], 0), "t")).world;
}

const problemsOf = (result: WriteResult) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => [problem.code, problem.reason]) : []);

describe("canon.components 输出 18、19、场景 5：引用与以引用为键的列表", () => {
    test("同一请求新建知识点并给星瑾加一行、再给这一行的子字段赋值：临时 id 在元素 id、地址路径里都换成正式 id；修订记下新写的引用", () => {
        const world = start();
        const result = ok(world.publish(request([
            {ref: {kind: "entry", id: "tmp:k"}, after: point("tmp:k", "哥哥能回溯")},
            {ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [
                {op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: "tmp:k", 程度: "unaware"}},
                {op: "set", at: {entry: "e1", path: "know.知情[tmp:k].程度"}, value: "knows"},
            ])},
        ], 1), "t"));
        const k = result.ids["tmp:k"]!;
        const stored = result.world.data.changes.get(result.ids["tmp:c"]!)!;
        expect(stored.patches.map((patch) => [patch.at.path, (patch.value as {id?: string}).id ?? patch.value])).toEqual([["know.知情", k], [`know.知情[${k}].程度`, "knows"]]);
        expect(result.revision.refs?.filter((reference) => reference.target.id === k).map((reference) => reference.path)).toEqual(["patches[0].value"]);
        const view = result.world.engine.entry("e1", {kind: "chapter", chapter: "ch1", edge: "end"}, "actual");
        expect(view !== null && view !== "chapter-not-found" && view.namespaces.know!.fields.知情!.value).toEqual([{id: k, 程度: "knows", label: "哥哥能回溯"}]);
    });

    test("引用的目标不对：指向人物的知情行、指向不存在的条目的 ref 字段、涉及里不存在的条目，都是 ref-invalid", () => {
        const world = start();
        expect(problemsOf(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [{op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: "e2", 程度: "knows"}}])}], 1), "t")))
            .toEqual([["ref-invalid", "ref-type-mismatch"]]);
        expect(problemsOf(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [{op: "set", at: {entry: "e1", path: "know.基于"}, value: {ref: "e99"}}])}], 1), "t")))
            .toEqual([["ref-invalid", "entry-missing"]]);
        expect(problemsOf(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [], {involves: ["e99"]})}], 1), "t")))
            .toEqual([["ref-invalid", "entry-missing"]]);
    });

    test("删掉知识点：那一行照常在，显示“已删除的条目”；还原新建它的修订得到 has-dependents，列出加这一行的修订", () => {
        const created = ok(start().publish(request([{ref: {kind: "entry", id: "tmp:k"}, after: point("tmp:k", "哥哥能回溯")}], 1), "t"));
        const k = created.ids["tmp:k"]!;
        const row = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [{op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: k, 程度: "knows"}}])}], 2), "t"));
        const deleted = ok(row.world.publish(request([{ref: {kind: "entry", id: k}, after: {...row.world.data.entries.get(k)!, deleted: true}}], 3), "t"));
        const view = deleted.world.engine.entry("e1", {kind: "chapter", chapter: "ch1", edge: "end"}, "actual");
        expect(view !== null && view !== "chapter-not-found" && view.namespaces.know!.fields.知情!.value).toEqual([{id: k, 程度: "knows", label: "已删除的条目"}]);
        expect(row.world.dependents(created.revision.id)).toEqual([created.revision.id, row.revision.id]);
    });

    test("插件停用以后（登记里没有这个类型），依赖照旧：按发布时存下的引用算", () => {
        const created = ok(start().publish(request([{ref: {kind: "entry", id: "tmp:k"}, after: point("tmp:k", "哥哥能回溯")}], 1), "t"));
        const k = created.ids["tmp:k"]!;
        const row = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [{op: "listAdd", at: {entry: "e2", path: "know.知情"}, value: {id: k, 程度: "knows"}}])}], 2), "t"));
        const disabled = World.replay(row.world.revisions, options([PERSON]));
        expect(disabled.dependents(created.revision.id)).toEqual([created.revision.id, row.revision.id]);
    });

    test("字段声明：keyedBy 只用于列表，targets 只用于 ref 与以引用为键的列表", () => {
        const bad = (field: Record<string, unknown>) => buildRegistry([{id: "test.bad", label: "坏", namespace: "bad", version: 1, fields: [field as never]}]).diagnostics.map((diagnostic) => diagnostic.code);
        expect(bad({id: "甲", label: "甲", kind: "text", keyedBy: "ref"})).toEqual(["component-declaration-invalid"]);
        expect(bad({id: "乙", label: "乙", kind: "text", targets: ["知识点"]})).toEqual(["component-declaration-invalid"]);
        expect(bad({id: "丙", label: "丙", kind: "list", keyedBy: "ref", targets: ["知识点"]})).toEqual([]);
    });
});
