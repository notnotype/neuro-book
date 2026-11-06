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
            {id: "看法", label: "看法", kind: "text", precision: "semantic"},
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
        const view = result.world.line().engine.entry("e1", {kind: "chapter", chapter: "ch1", edge: "end"}, "actual");
        expect(view !== null && view !== "chapter-not-found" && view.namespaces.know!.fields.知情!.value).toEqual([{id: k, 程度: "knows", label: "哥哥能回溯"}]);
    });

    test("不在引用位置上的 tmp: 文字原样存下：描述、摘要、语义档的文字、决策的要定的事等于临时 id 也不换", () => {
        const world = start();
        const summarized: Entry = {...point("tmp:k", "哥哥能回溯"), init: {...point("tmp:k", "哥哥能回溯").init, summary: "tmp:k"}};
        const result = ok(world.publish(request([
            {ref: {kind: "entry", id: "tmp:k"}, after: summarized},
            {ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [{op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: "tmp:k", 程度: "knows", 看法: "tmp:k"}}], {text: "tmp:k", involves: ["tmp:k"]})},
            {ref: {kind: "decision", id: "tmp:d"}, after: {id: "tmp:d", text: "tmp:k", status: "pending", about: [{kind: "entry", id: "tmp:k"}], hints: []}},
        ], 1), "t"));
        const k = result.ids["tmp:k"]!;
        const stored = result.world.data.changes.get(result.ids["tmp:c"]!)!;
        expect([stored.text, stored.involves, stored.patches[0]!.value]).toEqual(["tmp:k", [k], {id: k, 程度: "knows", 看法: "tmp:k"}]);
        expect(result.world.data.entries.get(k)!.init.summary).toBe("tmp:k");
        expect(result.world.data.decisions.get(result.ids["tmp:d"]!)).toMatchObject({text: "tmp:k", about: [{kind: "entry", id: k}]});
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
        const view = deleted.world.line().engine.entry("e1", {kind: "chapter", chapter: "ch1", edge: "end"}, "actual");
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

describe("canon.components 输出 20：列表元素的语义档", () => {
    const end = {kind: "chapter", chapter: "ch2", edge: "end"} as const;
    const knowing = (world: World) => {
        const view = world.line().engine.entry("e1", end, "actual");
        if (view === null || view === "chapter-not-found") throw new Error("no view");
        return view.namespaces.know!.fields.知情!;
    };
    const setup = () => {
        const created = ok(start().publish(request([{ref: {kind: "entry", id: "tmp:k"}, after: point("tmp:k", "哥哥能回溯")}], 1), "t"));
        const k = created.ids["tmp:k"]!;
        const row = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [{op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: k, 程度: "knows", 看法: "不信"}}])}], 2), "t"));
        return {world: row.world, k};
    };
    const note = (world: World, k: string, value: string, version: number, op: Patch["op"] = "note") =>
        ok(world.publish(request([{ref: {kind: "change", id: "tmp:n"}, after: change("tmp:n", [{op, at: {entry: "e1", path: `know.知情[${k}].看法`}, value}], {at: {kind: "chapter", chapter: "ch2", key: version}})}], version), "t")).world;

    test("元素子字段的事件按它自己的地址记：没有归纳时写成“起点；之后：……”并标未归纳；赋值是新的起点", () => {
        const {world, k} = setup();
        const noted = note(note(world, k, "开始怀疑", 3), k, "又不信了", 4);
        expect(knowing(noted)).toMatchObject({value: [{id: k, 看法: "不信；之后：开始怀疑；又不信了"}], notReduced: true});
        const restarted = note(noted, k, "信了", 5, "set");
        expect(knowing(restarted)).toEqual({value: [{id: k, 程度: "knows", 看法: "信了", label: "哥哥能回溯"}]});
    });

    test("去掉元素再加回来，旧的事件不再参与归纳", () => {
        const {world, k} = setup();
        const noted = note(world, k, "开始怀疑", 3);
        const removed = ok(noted.publish(request([{ref: {kind: "change", id: "tmp:r"}, after: change("tmp:r", [
            {op: "listRemove", at: {entry: "e1", path: "know.知情"}, value: k},
            {op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: k, 程度: "unaware", 看法: "没听说过"}},
        ], {at: {kind: "chapter", chapter: "ch2", key: 9}})}], 4), "t")).world;
        expect(knowing(removed)).toEqual({value: [{id: k, 程度: "unaware", 看法: "没听说过", label: "哥哥能回溯"}]});
    });
});

describe("canon.components 输出 18、19：引用已删除的条目、保存引用的条目照常可写、以引用为键的列表一条目一行", () => {
    const reasonsOf = (result: WriteResult) => problemsOf(result).filter(([code]) => code === "ref-invalid").map(([, reason]) => reason);
    const ch1End = {kind: "chapter", chapter: "ch1", edge: "end"} as const;
    const rowsOf = (world: World) => {
        const view = world.line().engine.entry("e1", ch1End, "actual");
        if (view === null || view === "chapter-not-found") throw new Error("no view");
        return view.namespaces.know!.fields.知情!.value;
    };

    /** 星瑾（e1）有一行指向知识点 k，且“基于”也指向它；然后知识点被删除。 */
    function withDeletedPoint() {
        const created = ok(start().publish(request([{ref: {kind: "entry", id: "tmp:k"}, after: point("tmp:k", "哥哥能回溯")}, {ref: {kind: "entry", id: "tmp:other"}, after: point("tmp:other", "钟会停")}], 1), "t"));
        const k = created.ids["tmp:k"]!;
        const other = created.ids["tmp:other"]!;
        const row = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [
            {op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: k, 程度: "knows"}},
            {op: "set", at: {entry: "e1", path: "know.基于"}, value: {ref: k}},
        ])}], 3), "t"));
        const entryOfK = row.world.data.entries.get(k)!;
        const deleted = ok(row.world.publish(request([{ref: {kind: "entry", id: k}, after: {...entryOfK, deleted: true}}], 4), "t"));
        return {world: deleted.world, k, other};
    }

    test("引用已删除的条目：新写的拒收（entry-deleted）", () => {
        const {world, k} = withDeletedPoint();
        expect(reasonsOf(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", [{op: "set", at: {entry: "e2", path: "know.基于"}, value: {ref: k}}])}], world.version), "t"))).toEqual(["entry-deleted"]);
        expect(reasonsOf(world.publish(request([{ref: {kind: "change", id: "tmp:x"}, after: change("tmp:x", [{op: "listAdd", at: {entry: "e2", path: "know.知情"}, value: {id: k, 程度: "knows"}}])}], world.version), "t"))).toEqual(["entry-deleted"]);
    });

    test("保存引用的条目照常可写：改这个引用字段、改以被删条目为键的那一行的子字段、去掉那一行；条目自己改名也不重查旧引用", () => {
        const {world, k, other} = withDeletedPoint();
        expect(rowsOf(world)).toEqual([{id: k, 程度: "knows", label: "已删除的条目"}]);

        const next = (patches: Patch[], version: number, source = world) => ok(source.publish(request([{ref: {kind: "change", id: "tmp:w"}, after: change("tmp:w", patches)}], version), "t")).world;
        // 改这个引用字段：换成活着的知识点。
        const rebased = next([{op: "set", at: {entry: "e1", path: "know.基于"}, value: {ref: other}}], world.version);
        expect(rebased.data.changes.size).toBe(world.data.changes.size + 1);
        // 改那一行的子字段。
        const edited = next([{op: "set", at: {entry: "e1", path: `know.知情[${k}].程度`}, value: "unaware"}], world.version);
        expect(rowsOf(edited)).toEqual([{id: k, 程度: "unaware", label: "已删除的条目"}]);
        // 去掉那一行。
        expect(rowsOf(next([{op: "listRemove", at: {entry: "e1", path: "know.知情"}, value: k}], world.version))).toEqual([]);
        // 条目自己改名：初值里没动的引用不重查。
        const renamed = structuredClone(world.data.entries.get("e1")!);
        renamed.init.name = "星瑾（改名）";
        expect(world.publish(request([{ref: {kind: "entry", id: "e1"}, after: renamed}], world.version), "t").ok).toBe(true);
    });

    test("同一条目在以引用为键的列表里最多一行：增一个已有的 id 被拒，世界不变", () => {
        const created = ok(start().publish(request([{ref: {kind: "entry", id: "tmp:k"}, after: point("tmp:k", "哥哥能回溯")}], 1), "t"));
        const k = created.ids["tmp:k"]!;
        const listAdd = (version: number, world: World) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", [{op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: k, 程度: "knows"}}])}], version), "t");
        const row = ok(listAdd(2, created.world));
        const again = listAdd(row.world.version, row.world);
        expect(again.ok).toBe(false);
        expect(row.world.version).toBe(3);
        expect(rowsOf(row.world)).toHaveLength(1);
    });
});
