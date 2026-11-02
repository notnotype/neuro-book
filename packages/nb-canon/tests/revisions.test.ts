import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type Entry, type Patch, type StoryChange, type WriteRequest} from "../src/index";
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

function change(id: string, chapter: string, patches: Patch[], extra: Partial<StoryChange> = {}): StoryChange {
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
        expect(result.world.engine.entry("e2", {kind: "chapter", chapter: "ch2", edge: "end"}, "actual")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 2000}}}}});
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
        expect(reopened.engine.entry("e1", {kind: "chapter", chapter: "ch3", edge: "end"}, "actual")).toEqual(published.engine.entry("e1", {kind: "chapter", chapter: "ch3", edge: "end"}, "actual"));
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

    test("只往没有 id 的数组里追加的修改互不依赖；补偿只移除本次加的元素", () => {
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
