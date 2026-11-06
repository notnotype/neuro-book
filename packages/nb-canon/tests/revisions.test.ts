import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type Entry, type Patch, type StoryChange, type StoryChangeDraft, type TellingDraft, type WriteRequest} from "../src/index";
import {World, type WorldOptions, type WriteResult} from "../src/world/world";
import {PANEL, PERSON} from "./fixtures/world";

const TEXT: Record<string, string> = {
    ch1: "星瑕把卡插进机器，余额显示四万。",
    ch2: "她花了两千买药。又花了三千五。",
    ch3: "风信子来了。卡里还有38000。",
};

function options(chapters = ["ch1", "ch2", "ch3"]): WorldOptions {
    return {
        order: new ChapterOrder(chapters),
        registry: buildRegistry([PANEL, PERSON]),
        reductions: () => undefined,
        chapterText: (chapter) => TEXT[chapter],
        digest: (text) => createHash("sha256").update(text).digest("hex"),
    };
}

let sequence = 0;
function request(puts: WriteRequest["puts"], extra: Partial<WriteRequest> = {}): WriteRequest {
    return {requestId: `req-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "测试", baseVersion: 0, puts, ...extra};
}

function entry(id: string, name: string, panel: Record<string, unknown> = {}, extra: Partial<Entry> = {}): Entry {
    return {
        id, type: "人物", parent: null, folder: "人物", order: 0,
        init: {name, aliases: [], summary: "", text: [], data: {panel: {type: "canon.panel", version: 1, enabled: true, fields: {存款: 0, 魔力上限: null, 魔力: null, 物品: [], ...panel}}}},
        ...extra,
    };
}

function change(id: string, chapter: string, patches: Patch[], extra: Partial<StoryChangeDraft> = {}): StoryChangeDraft {
    return {id, kind: "written", text: id, at: {kind: "chapter", chapter, key: 10}, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}, ...extra};
}

const add = (entryId: string, value: number, extra: Partial<Patch> = {}): Patch => ({op: "add", at: {entry: entryId, path: "panel.存款"}, value, ...extra});

function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}

/** 两个人、四万存款的起点，版本 1。 */
function start(): World {
    return ok(World.empty(options()).publish(request([
        {ref: {kind: "entry", id: "tmp:xia"}, after: entry("tmp:xia", "星瑕", {存款: 40000})},
        {ref: {kind: "entry", id: "tmp:jin"}, after: entry("tmp:jin", "星瑾", {存款: 0})},
    ], {what: "opening"}), "t1")).world;
}

describe("canon.revisions 输出 1、2、16：发布、只存变了的叶子、临时 id、请求 id", () => {
    test("临时 id 换成正式 id，新建存整份；转账两边在一次修订里", () => {
        const world = start();
        expect([...world.data.entries.keys()]).toEqual(["e1", "e2"]);
        expect(world.revisions[0]!.idMap).toEqual({"tmp:xia": "e1", "tmp:jin": "e2"});
        const result = ok(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -2000), add("e2", 2000)])}], {baseVersion: 1}), "t2"));
        expect(result.revision.ops).toHaveLength(1);
        expect(result.world.line().engine.entry("e2", {kind: "chapter", chapter: "ch2", edge: "end"}, "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 2000}}}}});
    });

    test("修改只存变了的叶子", () => {
        const world = start();
        const next = structuredClone(world.data.entries.get("e1")!);
        next.init.data.panel!.fields.存款 = 41000;
        const result = ok(world.publish(request([{ref: {kind: "entry", id: "e1"}, after: next}], {baseVersion: 1}), "t2"));
        expect(result.revision.ops).toEqual([{ref: {kind: "entry", id: "e1"}, kind: "modify", fields: [{path: "init.data.panel.fields.存款", before: 40000, after: 41000}]}]);
    });

    test("同一个请求 id 再提交返回第一次的结果，不多出修订；内容不同得到 request-id-reused；重放后照样", () => {
        const world = start();
        const first = request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -2000)])}], {baseVersion: 1, requestId: "same"});
        const published = ok(world.publish(first, "t2"));
        const again = ok(published.world.publish({...first, baseVersion: 2}, "t3"));
        expect(again.repeated).toBe(true);
        expect(again.revision.id).toBe(published.revision.id);
        expect(again.ids).toEqual(published.ids);
        expect(again.world.version).toBe(2);
        expect(published.world.publish({...first, title: "别的"}, "t3")).toEqual({ok: false, failure: {code: "request-id-reused"}});
        const reopened = World.replay(published.world.revisions, options());
        expect(ok(reopened.publish(first, "t4")).repeated).toBe(true);

        // 还原同样按内容判：用了别的请求的 id 拒收；同一个还原重发（重开项目后也一样）返回第一次的结果。
        expect(published.world.revert(published.revision.id, false, {requestId: "same", by: {kind: "author"}}, "t5")).toEqual({ok: false, failure: {code: "request-id-reused"}});
        const undo = {requestId: "undo-same", by: {kind: "author"}} as const;
        const undone = ok(published.world.revert(published.revision.id, false, undo, "t5") as WriteResult);
        expect((undone.world.revert(published.revision.id, false, undo, "t6") as WriteResult & {repeated?: boolean}).repeated).toBe(true);
        expect(undone.world.revert(published.revision.id, true, undo, "t6")).toEqual({ok: false, failure: {code: "request-id-reused"}});
        expect((World.replay(undone.world.revisions, options()).revert(published.revision.id, false, undo, "t7") as WriteResult & {repeated?: boolean}).repeated).toBe(true);
    });

    test("失败的请求不改世界、不占版本号", () => {
        const world = start();
        const result = world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -50000)])}], {baseVersion: 1}), "t2");
        expect(result.ok).toBe(false);
        expect(world.version).toBe(1);
        expect(ok(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -1)])}], {baseVersion: 1}), "t3")).revision.version).toBe(2);
    });

    test("重放日志得到与发布出来相同的世界", () => {
        const published = ok(start().publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -2000)])}], {baseVersion: 1}), "t2")).world;
        const reopened = World.replay(published.revisions, options());
        expect([...reopened.data.changes.entries()]).toEqual([...published.data.changes.entries()]);
        expect([...reopened.data.entries.entries()]).toEqual([...published.data.entries.entries()]);
        expect(reopened.line().engine.entry("e1", {kind: "chapter", chapter: "ch3", edge: "end"}, "actual")).toEqual(published.line().engine.entry("e1", {kind: "chapter", chapter: "ch3", edge: "end"}, "actual"));
    });
});

describe("canon.revisions 输出 3、17：写入时校验", () => {
    const fails = (result: WriteResult, code: string) => {
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.failure.code).toBe("validation-failed");
        if (result.failure.code === "validation-failed") expect(result.failure.problems.map((problem) => problem.code)).toContain(code);
    };

    test.each<[string, (world: World) => WriteResult]>([
        ["entry-missing", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e9", 1)])}], {baseVersion: 1}), "t")],
        ["constraint-violated", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -50000)])}], {baseVersion: 1}), "t")],
        ["unknown-field", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [{op: "set", at: {entry: "e1", path: "panel.不存在"}, value: 1}])}], {baseVersion: 1}), "t")],
        ["invalid-line", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [], {lines: ["e2"]})}], {baseVersion: 1}), "t")],
        ["invalid-link", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [], {links: [{kind: "fulfills", plan: "e1"}]})}], {baseVersion: 1}), "t")],
        ["quote-not-found", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [], {told: [{source: "chapter", chapter: "ch2", quote: "根本没有这句"}]})}], {baseVersion: 1}), "t")],
        // 形状不对的列表（项是 null、列表是字符串）：报 type-mismatch，不在补缺省值或换临时 id 时抛错。
        ...(["when", "cast", "links", "told", "patches"] as const).flatMap((field): [string, (world: World) => WriteResult][] => [
            ["type-mismatch", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: {...change("tmp:c", "ch2", []), [field]: [null]}}], {baseVersion: 1}), "t")],
            ["type-mismatch", (world) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: {...change("tmp:c", "ch2", []), [field]: "x"}}], {baseVersion: 1}), "t")],
        ]),
        ["type-mismatch", (world) => world.publish(request([{ref: {kind: "entry", id: "tmp:e"}, after: {...entry("tmp:e", "新人"), retold: "x"}}], {baseVersion: 1}), "t")],
        ["invalid-tree", (world) => {
            const next = structuredClone(world.data.entries.get("e1")!);
            next.parent = "e1";
            return world.publish(request([{ref: {kind: "entry", id: "e1"}, after: next}], {baseVersion: 1}), "t");
        }],
        ["component-unknown", (world) => {
            const next = structuredClone(world.data.entries.get("e1")!);
            next.init.data.magic = {type: "other.magic", version: 1, enabled: true, fields: {}};
            return world.publish(request([{ref: {kind: "entry", id: "e1"}, after: next}], {baseVersion: 1}), "t");
        }],
    ])("%s", (code, write) => fails(write(start()), code));

    test("Agent 写的数要有依据：原文里读得出这个数（中文也认）、核对点推出的差额复算相等，或标估计", () => {
        const world = start();
        const agent = {kind: "agent", session: "记账"} as const;
        const write = (patch: Patch) => world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [patch], {told: [{source: "chapter", chapter: "ch2", quote: "她花了两千买药"}]})}], {baseVersion: 1, by: agent}), "t");
        expect(write(add("e1", -2000, {basis: {kind: "quote", quote: "她花了两千买药"}})).ok).toBe(true);
        expect(write(add("e1", -3500, {basis: {kind: "quote", quote: "又花了三千五"}})).ok).toBe(true);
        fails(write(add("e1", -2000)), "number-without-basis");
        fails(write(add("e1", -1500, {basis: {kind: "quote", quote: "她花了两千买药"}})), "basis-mismatch");
        expect(write(add("e1", -7, {basis: {kind: "estimate", note: "估"}})).ok).toBe(true);
    });

    test("初值的依据写成“由核对点推出”：核对点要在、在同一个地址上；原样留着的旧依据不再查", () => {
        const world = start();
        const withBasis = (check: string) => {
            const next = structuredClone(world.data.entries.get("e1")!);
            next.initBasis = {"panel.存款": {kind: "derived", check}};
            return next;
        };
        const check = {id: "tmp:k", at: {entry: "e1", path: "panel.存款"}, value: 40000, told: {source: "chapter" as const, chapter: "ch1", quote: "余额显示四万"}, place: {kind: "chapter" as const, chapter: "ch1", key: 20}};
        fails(world.publish(request([{ref: {kind: "entry", id: "e1"}, after: withBasis("k404")}], {baseVersion: 1}), "t"), "basis-mismatch");
        fails(world.publish(request([{ref: {kind: "check", id: "tmp:k"}, after: {...check, at: {entry: "e2", path: "panel.存款"}}}, {ref: {kind: "entry", id: "e1"}, after: withBasis("tmp:k")}], {baseVersion: 1}), "t"), "basis-mismatch");
        const based = ok(world.publish(request([{ref: {kind: "check", id: "tmp:k"}, after: check}, {ref: {kind: "entry", id: "e1"}, after: withBasis("tmp:k")}], {baseVersion: 1}), "t"));
        // 核对点删了以后，只改这个条目的名字照常通过。
        const removed = ok(based.world.publish(request([{ref: {kind: "check", id: based.ids["tmp:k"]!}, after: null}], {baseVersion: 2}), "t")).world;
        const renamed = structuredClone(removed.data.entries.get("e1")!);
        renamed.init.name = "星瑕（改名）";
        expect(removed.publish(request([{ref: {kind: "entry", id: "e1"}, after: renamed}], {baseVersion: 3}), "t").ok).toBe(true);
    });

    test("马甲（sameAs）指向已删除的条目被拒；本体之后被删，已有的马甲照常能改别的字段", () => {
        const world = start();
        const deleted = ok(world.publish(request([{ref: {kind: "entry", id: "e2"}, after: {...structuredClone(world.data.entries.get("e2")!), deleted: true}}], {baseVersion: 1}), "t")).world;
        fails(deleted.publish(request([{ref: {kind: "entry", id: "tmp:mask"}, after: entry("tmp:mask", "夜行人", {}, {sameAs: "e2"})}], {baseVersion: 2}), "t"), "invalid-tree");

        const masked = ok(world.publish(request([{ref: {kind: "entry", id: "tmp:mask"}, after: entry("tmp:mask", "夜行人", {}, {sameAs: "e2"})}], {baseVersion: 1}), "t"));
        const mask = masked.ids["tmp:mask"]!;
        const gone = ok(masked.world.publish(request([{ref: {kind: "entry", id: "e2"}, after: {...structuredClone(masked.world.data.entries.get("e2")!), deleted: true}}], {baseVersion: 2}), "t")).world;
        const renamed = structuredClone(gone.data.entries.get(mask)!);
        renamed.init.name = "夜行人（改名）";
        expect(gone.publish(request([{ref: {kind: "entry", id: mask}, after: renamed}], {baseVersion: 3}), "t").ok).toBe(true);
    });

    test("命名空间在安放上没启用时，剧情变更对它的数据字段打补丁被拒（component-disabled）", () => {
        const world = start();
        const next = structuredClone(world.data.entries.get("e1")!);
        next.init.data.panel!.enabled = false;
        const disabled = ok(world.publish(request([{ref: {kind: "entry", id: "e1"}, after: next}], {baseVersion: 1}), "t")).world;
        fails(disabled.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", 1)])}], {baseVersion: 2}), "t"), "component-disabled");
    });

    test("出场之前的安放上记它的变化被拒（not-appeared）", () => {
        const world = start();
        const next = {...structuredClone(world.data.entries.get("e2")!), appears: {kind: "chapter" as const, chapter: "ch3", key: 0}};
        const later = ok(world.publish(request([{ref: {kind: "entry", id: "e2"}, after: next}], {baseVersion: 1}), "t")).world;
        fails(later.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e2", 1)])}], {baseVersion: 2}), "t"), "not-appeared");
    });

    test("待定的变更转为生效时按新写的生效变更完整校验（输出 17）", () => {
        const written = ok(start().publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -50000)], {status: "held", held: {reason: "unsure", note: "不确定"}})}], {baseVersion: 1}), "t"));
        const id = written.ids["tmp:c"]!;
        const held = written.world.data.changes.get(id)!;
        fails(written.world.publish(request([{ref: {kind: "change", id}, after: {...held, status: "active"}}], {baseVersion: 2}), "t"), "constraint-violated");
    });
});

describe("canon.revisions 输出 4、5、6：带来的变化与预览", () => {
    test("改初值让后面的变更套不上：不拒收，记在带来的变化里，待处理按这次修订合并（model.md 输出 22）", () => {
        const transfer = ok(start().publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -2000), add("e2", 2000)])}], {baseVersion: 1}), "t"));
        const id = transfer.ids["tmp:c"]!;
        let world = transfer.world;
        const next = structuredClone(world.data.entries.get("e1")!);
        next.init.data.panel!.fields.存款 = 1000;
        const result = ok(world.publish(request([{ref: {kind: "entry", id: "e1"}, after: next}], {baseVersion: 2, chapter: "ch2"}), "t"));
        expect(result.revision.impact).toMatchObject({where: {kind: "chapter", chapter: "ch2", edge: "end"}, broken: [id], pendingAdded: [`cannot:${id}`]});
        expect(result.revision.impact.values).toContainEqual({at: {entry: "e1", path: "panel.存款"}, before: 38000, after: 1000});
        world = result.world;
        expect(world.pending({kind: "chapter", chapter: "ch3", edge: "end"})).toEqual([{kind: "cannot-apply", root: result.revision.id, changes: [id]}]);
    });

    test("语义档还没归纳时，带来的变化只存起点与事件条数，不存拼起来的全文", () => {
        const withAttitude = structuredClone(start().data.entries.get("e2")!);
        withAttitude.init.data.character = {type: PERSON.id, version: 1, enabled: true, fields: {外观: null, 状态: null, 态度: "冷淡"}};
        let world = ok(start().publish(request([{ref: {kind: "entry", id: "e2"}, after: withAttitude}], {baseVersion: 1}), "t")).world;
        const note = (text: string): Patch => ({op: "note", at: {entry: "e2", path: "character.态度"}, value: text});
        world = ok(world.publish(request([{ref: {kind: "change", id: "tmp:a"}, after: change("tmp:a", "ch1", [note("软了一点".repeat(50))])}], {baseVersion: 2}), "t")).world;
        const second = ok(world.publish(request([{ref: {kind: "change", id: "tmp:b"}, after: change("tmp:b", "ch2", [note("叫了一声哥")])}], {baseVersion: 3}), "t"));
        expect(second.revision.impact.values).toContainEqual({at: {entry: "e2", path: "character.态度"}, before: {notReduced: true, anchor: "冷淡", events: 1}, after: {notReduced: true, anchor: "冷淡", events: 2}});
    });

    test("预览与随后发布存下的带来的变化逐字相同（场景 4）", () => {
        const world = start();
        const write = request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -2000)])}], {baseVersion: 1, chapter: "ch2"});
        const preview = ok(world.preview(write, "t"));
        const published = ok(world.publish(write, "t"));
        expect(preview.revision.impact).toEqual(published.revision.impact);
        expect(world.version).toBe(1);
    });
});

describe("canon.revisions 输出 7、18、20 与场景 1", () => {
    test("两人同时改：改过的对象报冲突并给出当前值，没改过的对象不冲突", () => {
        const world = start();
        const agentEdit = structuredClone(world.data.entries.get("e1")!);
        agentEdit.init.summary = "Agent 改的";
        const v2 = ok(world.publish(request([{ref: {kind: "entry", id: "e1"}, after: agentEdit}], {baseVersion: 1}), "t")).world;
        const authorEdit = structuredClone(world.data.entries.get("e1")!);
        authorEdit.init.data.panel!.fields.存款 = 1;
        const conflict = v2.publish(request([{ref: {kind: "entry", id: "e1"}, after: authorEdit}], {baseVersion: 1}), "t");
        expect(conflict.ok).toBe(false);
        if (!conflict.ok && conflict.failure.code === "version-conflict") expect(conflict.failure.objects[0]).toMatchObject({ref: {kind: "entry", id: "e1"}, changed: true, current: {init: {summary: "Agent 改的"}}});
        const other = structuredClone(world.data.entries.get("e2")!);
        other.init.summary = "作者改的";
        expect(ok(v2.publish(request([{ref: {kind: "entry", id: "e2"}, after: other}], {baseVersion: 1}), "t")).revision.version).toBe(3);
    });

    test("没给排序键时按讲述的原句在本章第一次出现的位置算", () => {
        const world = start();
        const draft = change("tmp:c", "ch2", [], {told: [{source: "chapter", chapter: "ch2", quote: "又花了三千五"}]});
        delete (draft.at as {key?: number}).key;
        const result = ok(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: draft}], {baseVersion: 1}), "t"));
        expect(result.world.data.changes.get(result.ids["tmp:c"]!)!.at).toEqual({kind: "chapter", chapter: "ch2", key: TEXT.ch2!.indexOf("又花了三千五")});
    });

    test("条目与剧情变更不能删除（not-deletable）", () => {
        expect(start().publish(request([{ref: {kind: "entry", id: "e1"}, after: null}], {baseVersion: 1}), "t")).toEqual({ok: false, failure: {code: "not-deletable", ref: {kind: "entry", id: "e1"}}});
    });
});

describe("canon.revisions 输出 13：章序调整", () => {
    test("章序与记下的不同时发布一次 reorder，之后相同不再发", () => {
        const world = start();
        const result = world.reorder(new ChapterOrder(["ch2", "ch1", "ch3"]), "t", "reorder-1");
        expect(result?.ok).toBe(true);
        if (result === null || !result.ok) return;
        expect(result.revision.ops).toEqual([{kind: "chapters", before: [], after: ["ch2", "ch1", "ch3"]}]);
        expect(result.world.reorder(new ChapterOrder(["ch2", "ch1", "ch3"]), "t", "reorder-2")).toBeNull();
        const after = ok(result.world.publish(request([{ref: {kind: "entry", id: "tmp:new"}, after: entry("tmp:new", "新人", {})}], {baseVersion: result.world.version}), "t"));
        expect(after.revision.id).not.toBe(result.revision.id);
        expect(World.replay(result.world.revisions, {...options(), order: new ChapterOrder(["ch2", "ch1", "ch3"])}).recordedChapters).toEqual(["ch2", "ch1", "ch3"]);
    });
});

describe("canon.revisions 输出 11、12：还原与依赖（场景 3）", () => {
    test("还原新建条目的修订：后面引用了它的修订是依赖，不单独还原；连同依赖一起还原后都消失，再还原补偿又回来", () => {
        const base = start();
        const a = ok(base.publish(request([{ref: {kind: "entry", id: "tmp:star"}, after: entry("tmp:star", "守护之星", {物品: []})}], {baseVersion: 1, what: "bookkeeping", chapter: "ch2"}), "t"));
        const star = a.ids["tmp:star"]!;
        const b = ok(a.world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch3", [{op: "listAdd", at: {entry: star, path: "panel.物品"}, value: {id: "i1", label: "碎片"}}])}], {baseVersion: 2, what: "bookkeeping", chapter: "ch3"}), "t"));
        const world = b.world;
        expect(world.revert(a.revision.id, false, {requestId: "undo-1", by: {kind: "author"}}, "t")).toEqual({ok: false, failure: {code: "has-dependents", dependents: [b.revision.id]}});
        const undone = ok(world.revert(a.revision.id, true, {requestId: "undo-2", by: {kind: "author"}}, "t") as WriteResult);
        expect(undone.revision.reverts).toEqual([a.revision.id, b.revision.id]);
        expect(undone.world.data.entries.has(star)).toBe(false);
        expect(undone.world.data.changes.has(b.ids["tmp:c"]!)).toBe(false);
        const redone = ok(undone.world.revert(undone.revision.id, false, {requestId: "redo", by: {kind: "author"}}, "t") as WriteResult);
        expect(redone.world.data.entries.has(star)).toBe(true);
        expect(redone.world.data.changes.has(b.ids["tmp:c"]!)).toBe(true);
    });

    test("只往列表末尾追加的修改互不依赖（讲述是有 id 的列表，各加各的）；补偿只移除本次加的元素", () => {
        const base = ok(start().publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -2000)])}], {baseVersion: 1}), "t"));
        const id = base.ids["tmp:c"]!;
        const tell = (world: World, quote: string, version: number) => {
            const current = world.data.changes.get(id)!;
            return ok(world.publish(request([{ref: {kind: "change", id}, after: {...current, told: [...current.told, {source: "chapter", chapter: "ch2", quote}]}}], {baseVersion: version}), "t"));
        };
        const first = tell(base.world, "她花了两千买药", 2);
        const second = tell(first.world, "又花了三千五", 3);
        expect(second.world.dependents(first.revision.id)).toEqual([first.revision.id]);
        const undone = ok(second.world.revert(first.revision.id, false, {requestId: "undo-tell", by: {kind: "author"}}, "t") as WriteResult);
        expect(undone.world.data.changes.get(id)!.told.map((telling) => telling.quote)).toEqual(["又花了三千五"]);
    });

    test("还原改初值：恢复改前的值；之后又改了同一个字段的修订是依赖", () => {
        const world = start();
        const edit = (from: World, value: number, version: number) => {
            const next = structuredClone(from.data.entries.get("e1")!);
            next.init.data.panel!.fields.存款 = value;
            return ok(from.publish(request([{ref: {kind: "entry", id: "e1"}, after: next}], {baseVersion: version}), "t"));
        };
        const first = edit(world, 50000, 1);
        const undone = ok(first.world.revert(first.revision.id, false, {requestId: "u", by: {kind: "author"}}, "t") as WriteResult);
        expect(undone.world.data.entries.get("e1")!.init.data.panel!.fields.存款).toBe(40000);
        const second = edit(first.world, 60000, 2);
        expect(second.world.dependents(first.revision.id)).toEqual([first.revision.id, second.revision.id]);
    });

    test("章序调整不能还原", () => {
        const result = start().reorder(new ChapterOrder(["ch3", "ch1", "ch2"]), "t", "r");
        if (result === null || !result.ok) throw new Error("no reorder");
        expect(result.world.revert(result.revision.id, true, {requestId: "x", by: {kind: "author"}}, "t")).toEqual({ok: false, failure: {code: "not-revertable"}});
    });
});

describe("canon.revisions 输出 6、12 与 canon.components 输出 10：带来的变化、依赖与类型版本的边界", () => {
    test("改主文字的块：带来的变化记那一块改前改后的源文（输出 6）", () => {
        const base = start();
        const withText = structuredClone(base.data.entries.get("e1")!);
        withText.init.text = [{id: "b1", source: "旧文"}];
        const added = ok(base.publish(request([{ref: {kind: "entry", id: "e1"}, after: withText}], {baseVersion: 1}), "t"));
        const changed = structuredClone(added.world.data.entries.get("e1")!);
        changed.init.text = [{id: "b1", source: "新文"}];
        const result = ok(added.world.publish(request([{ref: {kind: "entry", id: "e1"}, after: changed}], {baseVersion: 2}), "t"));
        expect(result.revision.impact.values).toContainEqual({at: {entry: "e1", path: "text[b1]"}, before: "旧文", after: "新文"});
    });

    test("后面的修订只在自由文字里写到新建对象的 id：不算依赖，可以单独还原（输出 12）", () => {
        const created = ok(start().publish(request([{ref: {kind: "entry", id: "tmp:new"}, after: entry("tmp:new", "新人")}], {baseVersion: 1}), "t"));
        const newId = created.ids["tmp:new"]!;
        const later = ok(created.world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch1", [], {text: newId})}], {baseVersion: 2}), "t"));
        expect(later.world.dependents(created.revision.id)).toEqual([created.revision.id]);
    });

    test("改已有的变更给列表加了一个元素：之后改这个元素子字段的修订依赖它（输出 12“改过它新建的列表元素”）", () => {
        const base = ok(start().publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [])}], {baseVersion: 1}), "t"));
        const id = base.ids["tmp:c"]!;
        const current = base.world.data.changes.get(id)!;
        const added = ok(base.world.publish(request([{ref: {kind: "change", id}, after: {...current, patches: [{op: "listAdd", at: {entry: "e1", path: "panel.物品"}, value: {id: "药", label: "药", 数量: 1}}]}}], {baseVersion: 2}), "t"));
        const later = ok(added.world.publish(request([{ref: {kind: "change", id: "tmp:d"}, after: change("tmp:d", "ch3", [{op: "set", at: {entry: "e1", path: "panel.物品[药].数量"}, value: 2}])}], {baseVersion: 3}), "t"));
        expect(later.world.dependents(added.revision.id)).toEqual([added.revision.id, later.revision.id]);
        // 之后把这个元素去掉，同样是依赖。
        const removed = ok(added.world.publish(request([{ref: {kind: "change", id: "tmp:r"}, after: change("tmp:r", "ch3", [{op: "listRemove", at: {entry: "e1", path: "panel.物品"}, value: "药"}])}], {baseVersion: 3}), "t"));
        expect(removed.world.dependents(added.revision.id)).toEqual([added.revision.id, removed.revision.id]);
    });

    test("兑现组：之后改了组里另一条记录的修订依赖它；被兑现的计划不在组里（model.md 输出 13）", () => {
        const plan = ok(start().publish(request([{ref: {kind: "change", id: "tmp:p"}, after: change("tmp:p", "ch3", [], {kind: "plan", text: "去买药"})}], {baseVersion: 1}), "t"));
        const p = plan.ids["tmp:p"]!;
        const written = ok(plan.world.publish(request([{ref: {kind: "change", id: "tmp:w"}, after: change("tmp:w", "ch3", [], {links: [{kind: "fulfills", plan: p}]})}], {baseVersion: 2}), "t"));
        const w = written.ids["tmp:w"]!;
        const split = ok(written.world.publish(request([{ref: {kind: "change", id: "tmp:s"}, after: change("tmp:s", "ch3", [], {kind: "plan", text: "药没买全，下次再去", links: [{kind: "splitFrom", plan: p, by: w}]})}], {baseVersion: 3}), "t"));
        const editW = ok(split.world.publish(request([{ref: {kind: "change", id: w}, after: {...split.world.data.changes.get(w)!, text: "只买到一半"}}], {baseVersion: 4}), "t"));
        const editP = ok(editW.world.publish(request([{ref: {kind: "change", id: p}, after: {...editW.world.data.changes.get(p)!, text: "去买两种药"}}], {baseVersion: 5}), "t"));
        expect(editP.world.dependents(split.revision.id)).toEqual([split.revision.id, editW.revision.id]);
        // 还原兑现变更：拆出的计划（引用了它）与改它的修订一起还原；改被兑现的计划不受影响，不算依赖。
        expect(editP.world.dependents(written.revision.id)).toEqual([written.revision.id, split.revision.id, editW.revision.id]);
    });

    test("对命名空间的补丁记上写入时登记的类型版本（components.md 输出 10）", () => {
        const result = ok(start().publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [add("e1", -100)])}], {baseVersion: 1}), "t"));
        const created = result.revision.ops.find((op) => op.kind === "create");
        expect(created !== undefined && created.kind === "create" && (created.after as StoryChange).patches[0]).toMatchObject({op: "add", version: 1});
    });
});

describe("canon.model 输出 25 与 canon.revisions 输出 3、20：讲述的 id、讲述的形状、决策不删除", () => {
    const told = (telling: Record<string, unknown>) => change("tmp:c", "ch2", [], {told: [telling as TellingDraft]});

    test("新的讲述不带 id，由程序发 t 开头的号；改别的字段时 id 不变；写入者自带的新 id 被拒收", () => {
        const world = start();
        const first = ok(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: told({source: "chapter", chapter: "ch2", quote: "她花了两千买药"})}], {baseVersion: 1}), "t"));
        const id = first.ids["tmp:c"]!;
        const stored = first.world.data.changes.get(id)!;
        expect(stored.told.map((telling) => telling.id)).toEqual(["t1"]);
        const edited = ok(first.world.publish(request([{ref: {kind: "change", id}, after: {...stored, text: "改了描述"}}], {baseVersion: 2}), "t"));
        expect(edited.world.data.changes.get(id)!.told.map((telling) => telling.id)).toEqual(["t1"]);
        const invented = first.world.publish(request([{ref: {kind: "change", id}, after: {...stored, told: [...stored.told, {id: "t99", source: "chapter", chapter: "ch2", quote: "又花了三千五"}]}}], {baseVersion: 2}), "t");
        expect(!invented.ok && invented.failure.code === "validation-failed" && invented.failure.problems.map((problem) => problem.code)).toEqual(["invalid-telling"]);
    });

    test("删掉最后一条讲述、重放以后再写，讲述的号不重发", () => {
        const world = start();
        const first = ok(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: told({source: "chapter", chapter: "ch2", quote: "她花了两千买药"})}], {baseVersion: 1}), "t"));
        const id = first.ids["tmp:c"]!;
        const emptied = ok(first.world.publish(request([{ref: {kind: "change", id}, after: {...first.world.data.changes.get(id)!, told: []}}], {baseVersion: 2}), "t"));
        const reopened = World.replay(emptied.world.revisions, options());
        const again = ok(reopened.publish(request([{ref: {kind: "change", id}, after: {...reopened.data.changes.get(id)!, told: [{source: "chapter", chapter: "ch2", quote: "又花了三千五"}]}}], {baseVersion: 3}), "t"));
        expect(again.world.data.changes.get(id)!.told.map((telling) => telling.id)).toEqual(["t2"]);
    });

    test.each<[string, Record<string, unknown>]>([
        ["细纲没有锚点", {source: "outline", chapter: "ch2"}],
        ["作者消息没有锚点", {source: "message", quote: "定在第 20 章"}],
        ["正文的原句跨行", {source: "chapter", chapter: "ch2", quote: "她花了两千买药。\n又花了"}],
        ["nth 超出出现的次数", {source: "chapter", chapter: "ch2", quote: "花了", nth: 3}],
        ["nth 只用于正文", {source: "outline", chapter: "ch2", anchor: "b1", nth: 1}],
    ])("讲述的形状不对：%s → invalid-telling", (_name, telling) => {
        const result = start().publish(request([{ref: {kind: "change", id: "tmp:c"}, after: told(telling)}], {baseVersion: 1}), "t");
        expect(!result.ok && result.failure.code === "validation-failed" && result.failure.problems.map((problem) => problem.code)).toEqual(["invalid-telling"]);
    });

    test("原句在章里出现两次时 nth 为 2 可以写；改稿后失联的讲述原样留着，改这条变更的别的字段照常发布", () => {
        const texts: Record<string, string> = {...TEXT};
        const world = ok(World.empty({...options(), chapterText: (chapter) => texts[chapter]}).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: entry("tmp:xia", "星瑕")}], {what: "opening"}), "t")).world;
        const written = ok(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: told({source: "chapter", chapter: "ch2", quote: "花了", nth: 2})}], {baseVersion: 1}), "t"));
        const id = written.ids["tmp:c"]!;
        texts.ch2 = "她什么也没买。";
        const later = World.replay(written.world.revisions, {...options(), chapterText: (chapter) => texts[chapter]});
        expect(later.publish(request([{ref: {kind: "change", id}, after: {...later.data.changes.get(id)!, text: "改描述"}}], {baseVersion: 2}), "t").ok).toBe(true);
    });

    test("决策不能删，给 after 为空得到 not-deletable", () => {
        const world = start();
        const decided = ok(world.publish(request([{ref: {kind: "decision", id: "tmp:d"}, after: {id: "tmp:d", text: "哥哥的秘密在哪一章揭开", status: "pending", about: [], hints: []}}], {baseVersion: 1}), "t"));
        const result = decided.world.publish(request([{ref: {kind: "decision", id: decided.ids["tmp:d"]!}, after: null}], {baseVersion: 2}), "t");
        expect(!result.ok && result.failure.code).toBe("not-deletable");
        expect(decided.ids["tmp:d"]).toBe("d1");
    });
});

describe("canon.components 输出 14、15：补丁的值按字段核对", () => {
    const failure = (result: WriteResult) => (result.ok ? "ok" : result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => problem.code).join() : result.failure.code);

    test("场景 4：直接发布 0.1 加 0.2 读到 0.3；加 0.00001 拒收，不悄悄舍掉", () => {
        const world = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:x"}, after: entry("tmp:x", "星瑕", {存款: 0.1})}], {what: "opening"}), "t")).world;
        const summed = ok(world.publish(request([{ref: {kind: "change", id: "tmp:a"}, after: change("tmp:a", "ch1", [add("e1", 0.2)])}], {baseVersion: 1}), "t"));
        expect(summed.world.line().engine.entry("e1", {kind: "chapter", chapter: "ch1", edge: "end"}, "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 0.3}}}}});
        expect(failure(world.publish(request([{ref: {kind: "change", id: "tmp:b"}, after: change("tmp:b", "ch1", [add("e1", 0.00001)])}], {baseVersion: 1}), "t"))).toBe("number-out-of-range");
    });

    test("补丁写坏图片路径：invalid-asset-path，与写在初值里同一个码", () => {
        const IMAGE = {id: "test.image", label: "图", namespace: "pic", version: 1, fields: [{id: "图", label: "图", kind: "image"}, {id: "相册", label: "相册", kind: "list", item: [{id: "图", label: "图", kind: "image"}]}]};
        const base = {...options(), registry: buildRegistry([IMAGE as never])};
        const made: Entry = {id: "tmp:x", type: "物", parent: null, folder: "", order: 0, init: {name: "画", aliases: [], summary: "", text: [], data: {pic: {type: IMAGE.id, version: 1, enabled: true, fields: {图: null, 相册: [{id: "a", label: "a", 图: null}]}}}}};
        const world = ok(World.empty(base).publish(request([{ref: {kind: "entry", id: "tmp:x"}, after: made}], {what: "opening"}), "t")).world;
        const write = (patch: Patch) => failure(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch1", [patch])}], {baseVersion: 1}), "t"));
        const bad = {"图片": "https://x/y.png"};
        expect(write({op: "set", at: {entry: "e1", path: "pic.图"}, value: bad})).toBe("invalid-asset-path");
        expect(write({op: "set", at: {entry: "e1", path: "pic.相册[a].图"}, value: bad})).toBe("invalid-asset-path");
        expect(write({op: "listAdd", at: {entry: "e1", path: "pic.相册"}, value: {id: "b", label: "b", 图: bad}})).toBe("invalid-asset-path");
        expect(write({op: "set", at: {entry: "e1", path: "pic.图"}, value: {"图片": "assets/y.png"}})).toBe("ok");
        const inInit = {...made, init: {...made.init, data: {pic: {...made.init.data.pic!, fields: {图: bad, 相册: []}}}}};
        expect(failure(World.empty(base).publish(request([{ref: {kind: "entry", id: "tmp:x"}, after: inInit}]), "t"))).toBe("invalid-asset-path");
    });
});

describe("canon.components 失败码 unknown-field：地址指到没声明的字段、子键或图片的一部分", () => {
    const IMAGE = {id: "test.image", label: "图", namespace: "pic", version: 1, fields: [{id: "图", label: "图", kind: "image"}]};
    const failure = (result: WriteResult) => (result.ok ? ["ok"] : result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => problem.code) : [result.failure.code]);

    test("单写图片的路径或说明（图片值是整体）被拒；整体写入可以", () => {
        const base = {...options(), registry: buildRegistry([IMAGE as never])};
        const made: Entry = {id: "tmp:x", type: "物", parent: null, folder: "", order: 0, init: {name: "画", aliases: [], summary: "", text: [], data: {pic: {type: IMAGE.id, version: 1, enabled: true, fields: {图: null}}}}};
        const world = ok(World.empty(base).publish(request([{ref: {kind: "entry", id: "tmp:x"}, after: made}], {what: "opening"}), "t")).world;
        const write = (path: string, value: unknown) => failure(world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch1", [{op: "set", at: {entry: "e1", path}, value: value as never}])}], {baseVersion: 1}), "t"));
        expect(write("pic.图.图片", "assets/y.png")).toContain("unknown-field");
        expect(write("pic.图.说明", "原身")).toContain("unknown-field");
        expect(write("pic.图", {"图片": "assets/y.png", "说明": "原身"})).toEqual(["ok"]);
    });
});

describe("canon.revisions 输出 3、18：id 与排序键", () => {
    const keyOf = (world: World, id: string) => (world.data.changes.get(id)!.at as {key: number}).key;
    const draft = (id: string, chapter: string, extra: Partial<StoryChangeDraft> = {}) => {
        const {at: _at, ...rest} = change(id, chapter, []);
        return {...rest, at: {kind: "chapter", chapter}, ...extra} as unknown as StoryChangeDraft;
    };

    test("同一请求里两个 put 写同一个对象：id-taken，不让后一个悄悄盖掉前一个", () => {
        const result = start().publish(request([
            {ref: {kind: "change", id: "tmp:a"}, after: change("tmp:a", "ch1", [])},
            {ref: {kind: "change", id: "tmp:a"}, after: change("tmp:a", "ch2", [])},
        ], {baseVersion: 1}), "t");
        expect(result.ok === false && result.failure.code === "validation-failed" && result.failure.problems.map((problem) => problem.code)).toEqual(["id-taken"]);
    });

    test("没给键、没有正文讲述：排在本章最后；空章从 0 起；同一请求里按写的先后", () => {
        const world = start();
        const first = ok(world.publish(request([{ref: {kind: "change", id: "tmp:a"}, after: draft("tmp:a", "ch1")}], {baseVersion: 1}), "t"));
        expect(keyOf(first.world, first.ids["tmp:a"]!)).toBe(0);
        const keyed = ok(first.world.publish(request([{ref: {kind: "change", id: "tmp:b"}, after: change("tmp:b", "ch1", [])}], {baseVersion: 2}), "t"));
        expect(keyOf(keyed.world, keyed.ids["tmp:b"]!)).toBe(10);
        const next = ok(keyed.world.publish(request([
            {ref: {kind: "change", id: "tmp:c"}, after: draft("tmp:c", "ch1")},
            {ref: {kind: "change", id: "tmp:d"}, after: draft("tmp:d", "ch1")},
            {ref: {kind: "change", id: "tmp:e"}, after: change("tmp:e", "ch1", [], {at: {kind: "chapter", chapter: "ch1", key: 50}})},
        ], {baseVersion: 3}), "t"));
        expect([keyOf(next.world, next.ids["tmp:c"]!), keyOf(next.world, next.ids["tmp:d"]!)]).toEqual([51, 52]);
    });

    test("没给键、有正文讲述：按原句在本章第一次出现的位置", () => {
        const written = ok(start().publish(request([{ref: {kind: "change", id: "tmp:a"}, after: draft("tmp:a", "ch2", {told: [{source: "chapter", chapter: "ch2", quote: "又花了三千五"}]})}], {baseVersion: 1}), "t"));
        expect(keyOf(written.world, written.ids["tmp:a"]!)).toBe(TEXT.ch2!.indexOf("又花了三千五"));
    });

    test("给已有记录补上第一条正文讲述：键改成这处讲述的位置，写进带来的变化；已有正文讲述的或写的人改了键的不动", () => {
        const written = ok(start().publish(request([{ref: {kind: "change", id: "tmp:a"}, after: change("tmp:a", "ch2", [])}], {baseVersion: 1}), "t"));
        const id = written.ids["tmp:a"]!;
        const stored = written.world.data.changes.get(id)!;
        const told = ok(written.world.publish(request([{ref: {kind: "change", id}, after: {...structuredClone(stored), told: [{source: "chapter", chapter: "ch2", quote: "又花了三千五"}]}}], {baseVersion: 2}), "t"));
        const position = TEXT.ch2!.indexOf("又花了三千五");
        expect(keyOf(told.world, id)).toBe(position);
        expect(told.revision.impact.rekeyed).toEqual([{change: id, from: 10, to: position}]);

        const again = told.world.data.changes.get(id)!;
        const second = ok(told.world.publish(request([{ref: {kind: "change", id}, after: {...structuredClone(again), told: [...structuredClone(again.told), {source: "chapter", chapter: "ch2", quote: "她花了两千买药"}]}}], {baseVersion: 3}), "t"));
        expect(keyOf(second.world, id)).toBe(position);
        expect(second.revision.impact.rekeyed).toBeUndefined();

        const manual = ok(written.world.publish(request([{ref: {kind: "change", id}, after: {...structuredClone(stored), at: {kind: "chapter", chapter: "ch2", key: 99}, told: [{source: "chapter", chapter: "ch2", quote: "又花了三千五"}]}}], {baseVersion: 2}), "t"));
        expect(keyOf(manual.world, id)).toBe(99);
    });

    test("前史里的先后也比：出场在前史 5 的条目，不能被安放在前史 2 的变更引用", () => {
        const world = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:x"}, after: entry("tmp:x", "星瑕", {}, {appears: {kind: "prehistory", order: 5}})}], {what: "opening"}), "t")).world;
        const write = (order: number) => world.publish(request([{ref: {kind: "change", id: "tmp:a"}, after: {...change("tmp:a", "ch1", [add("e1", 1)]), at: {kind: "prehistory", order}}}], {baseVersion: 1}), "t");
        const early = write(2);
        expect(early.ok === false && early.failure.code === "validation-failed" && early.failure.problems.map((problem) => problem.code)).toContain("not-appeared");
        expect(write(7).ok).toBe(true);
    });
});

describe("canon.model 输出 23：条目树与身份同一的约束", () => {
    const problemCodes = (result: WriteResult) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => `${problem.code}@${problem.path}`) : result.ok ? ["发布成功"] : [result.failure.code]);
    const modified = (world: World, id: string, change: (next: Entry) => void) => {
        const next = structuredClone(world.data.entries.get(id)!);
        change(next);
        return next;
    };
    const put = (world: World, entryValue: Entry, extra: Partial<WriteRequest> = {}) => world.publish(request([{ref: {kind: "entry", id: entryValue.id}, after: entryValue}], {baseVersion: world.version, ...extra}), "t");

    test("马甲不嵌套：指向的条目自己已经是马甲，被拒；指向本体可以", () => {
        const masked = ok(put(start(), entry("tmp:mask", "夜行人", {}, {sameAs: "e2"})));
        const mask = masked.ids["tmp:mask"]!;
        expect(problemCodes(put(masked.world, entry("tmp:mask2", "夜行人二号", {}, {sameAs: mask})))).toEqual(["invalid-tree@sameAs"]);
        expect(put(masked.world, entry("tmp:mask3", "夜行人三号", {}, {sameAs: "e2"})).ok).toBe(true);
    });

    test("sameAs 指向自己被拒", () => {
        const world = start();
        expect(problemCodes(put(world, modified(world, "e1", (next) => (next.sameAs = "e1"))))).toEqual(["invalid-tree@sameAs"]);
    });

    test("parent 指向已删除的条目被拒；删除父条目本身可以，子条目照常存在", () => {
        const world = start();
        const gone = ok(put(world, modified(world, "e2", (next) => (next.deleted = true)))).world;
        expect(problemCodes(put(gone, entry("tmp:child", "新人", {}, {parent: "e2"})))).toEqual(["invalid-tree@parent"]);

        const parented = ok(put(world, entry("tmp:child", "孩子", {}, {parent: "e2"})));
        const child = parented.ids["tmp:child"]!;
        const orphaned = ok(put(parented.world, modified(parented.world, "e2", (next) => (next.deleted = true)))).world;
        expect(orphaned.data.entries.get(child)).toMatchObject({parent: "e2", init: {name: "孩子"}});
        expect(orphaned.line().engine.entry(child, {kind: "chapter", chapter: "ch1", edge: "end"}, "actual")).toMatchObject({name: "孩子", deleted: false});
    });

    test("非自指的环被拒：甲的父是乙之后，乙的父不能是甲；同一请求里互为父子同样被拒", () => {
        const world = start();
        const first = ok(put(world, modified(world, "e1", (next) => (next.parent = "e2")))).world;
        expect(problemCodes(put(first, modified(first, "e2", (next) => (next.parent = "e1"))))).toEqual(["invalid-tree@parent"]);

        const both = world.publish(request([
            {ref: {kind: "entry", id: "e1"}, after: modified(world, "e1", (next) => (next.parent = "e2"))},
            {ref: {kind: "entry", id: "e2"}, after: modified(world, "e2", (next) => (next.parent = "e1"))},
        ], {baseVersion: 1}), "t");
        expect(problemCodes(both)).toContain("invalid-tree@parent");
        expect(both.ok).toBe(false);
    });
});

describe("canon.model 输出 23：父条目删除后", () => {
    test("子条目照常存在、照常能改；新写的 parent 指向已删除的条目才拒收", () => {
        const base = start();
        const moved = ok(base.publish(request([{ref: {kind: "entry", id: "e2"}, after: {...structuredClone(base.data.entries.get("e2")!), parent: "e1"}}], {baseVersion: 1}), "t"));
        const parent = moved.world.data.entries.get("e1")!;
        const gone = ok(moved.world.publish(request([{ref: {kind: "entry", id: "e1"}, after: {...structuredClone(parent), deleted: true}}], {baseVersion: 2}), "t"));
        const child = gone.world.data.entries.get("e2")!;
        expect(gone.world.publish(request([{ref: {kind: "entry", id: "e2"}, after: {...structuredClone(child), folder: "别处"}}], {baseVersion: 3}), "t").ok).toBe(true);
        const orphan = ok(gone.world.publish(request([{ref: {kind: "entry", id: "tmp:x"}, after: entry("tmp:x", "新人")}], {baseVersion: 3}), "t"));
        const newId = orphan.ids["tmp:x"]!;
        const moveUnder = orphan.world.publish(request([{ref: {kind: "entry", id: newId}, after: {...structuredClone(orphan.world.data.entries.get(newId)!), parent: "e1"}}], {baseVersion: 4}), "t");
        expect(moveUnder.ok === false && moveUnder.failure.code === "validation-failed" && moveUnder.failure.problems.map((problem) => problem.code)).toEqual(["invalid-tree"]);
    });
});

describe("canon.project 失败码 not-found（补）：对象、修订不存在", () => {
    test("还原不存在的修订、改一个不存在又不是 tmp: 的对象：各得 not-found", () => {
        const world = start();
        expect(world.revert("r404", false, {requestId: "undo-404", by: {kind: "author"}}, "t")).toEqual({ok: false, failure: {code: "not-found"}});
        const missing = world.publish(request([{ref: {kind: "entry", id: "e404"}, after: entry("e404", "没有的人")}], {baseVersion: world.version}), "t");
        expect(missing.ok === false && missing.failure.code === "validation-failed" && missing.failure.problems.map((problem) => [problem.code, problem.ref])).toEqual([["not-found", {kind: "entry", id: "e404"}]]);
    });
});
