/**
 * 实例字段的声明（docs/specs/canon/components.md 输出 4、22、23）与原样留着的补丁（docs/specs/canon/revisions.md 输出 3）：
 * 去掉是打标记、生效的字段、声明上的规则只查新写或改过的、还原留下的组合不锁死整组、旧补丁不因不适用拒收。
 * 世界是真的 `World`，经 `publish` 与 `revert` 走；字段声明的四个写入操作另见 `entry-edits.test.ts`。
 */

import {createHash} from "node:crypto";

import {describe, expect, test} from "bun:test";

import {buildRegistry, ChapterOrder, type ComponentDeclaration, type Entry, type InstanceFieldDeclaration, type Patch, type StoryChange, type WriteRequest} from "../src/index";
import {World, type WriteResult} from "../src/world/world";
import {PANEL, PERSON} from "./fixtures/world";

const options = (declarations: ComponentDeclaration[] = [PANEL, PERSON]) => ({
    order: new ChapterOrder(["ch44", "ch45", "ch50"]),
    registry: buildRegistry(declarations),
    reductions: () => undefined,
    chapterText: () => "",
    digest: (text: string) => createHash("sha256").update(text).digest("hex"),
});

let sequence = 0;
const id = () => `req-${String(++sequence)}`;
const author = {kind: "author"} as const;
const end = {kind: "chapter" as const, chapter: "ch50", edge: "end" as const};

function ok(result: WriteResult): Extract<WriteResult, {ok: true}> {
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return result;
}
/** 拒收的原因写成“码:路径”。 */
const refused = (result: WriteResult): string[] => (result.ok ? ["ok"] : result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => `${problem.code}:${problem.path ?? ""}`) : [result.failure.code]);

/** 星瑕（e1）有面板（允许实例字段，存款 100）与人物（不允许）；青云门（e2）是一个组织。版本 1。 */
function world(declarations?: ComponentDeclaration[]): World {
    const xia: Entry = {
        id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0,
        init: {name: "星瑕", aliases: [], summary: "", text: [], data: {
            panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 100, 魔力上限: null, 魔力: null, 物品: []}, declared: []},
            character: {type: PERSON.id, version: 1, enabled: true, fields: {外观: "银白", 状态: null, 态度: null}},
        }},
    };
    const sect: Entry = {id: "tmp:sect", type: "组织", parent: null, folder: "", order: 1, init: {name: "青云门", aliases: [], summary: "", text: [], data: {}}};
    return ok(World.empty(options(declarations)).publish({requestId: id(), by: author, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:xia"}, after: xia}, {ref: {kind: "entry", id: "tmp:sect"}, after: sect}]} as WriteRequest, "t")).world;
}

/** 整份写回条目 `entry`（直接写初值，不经一次改几处）。 */
function put(base: World, mutate: (entry: Entry) => void, entry = "e1"): WriteResult {
    const copy = structuredClone(base.data.entries.get(entry)!) as Entry;
    mutate(copy);
    return base.publish({requestId: id(), by: author, what: "edit", title: "改条目", baseVersion: base.version, puts: [{ref: {kind: "entry", id: entry}, after: copy}]} as WriteRequest, "t");
}
const declared = (entry: Entry, namespace = "panel"): InstanceFieldDeclaration[] => (entry.init.data[namespace]!.declared ??= []);
const declare = (base: World, ...fields: InstanceFieldDeclaration[]) => put(base, (entry) => void declared(entry).push(...fields));
const mark = (base: World, field: string, removed: boolean) => put(base, (entry) => {
    const found = declared(entry).find((candidate) => candidate.id === field)!;
    if (removed) found.removed = true;
    else delete found.removed;
});

/** 在第 `chapter` 章记一条已写的剧情变更；返回新世界与它的 id。 */
function record(base: World, chapter: string, patches: Patch[], extra: Partial<StoryChange> = {}): {world: World; change: string} {
    const done = ok(base.publish({requestId: id(), by: author, what: "bookkeeping", title: "记账", baseVersion: base.version, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "发生了一件事", at: {kind: "chapter", chapter, key: 10}, told: [], involves: ["e1"], lines: [], links: [], patches, status: "active", by: author, ...extra}}]} as WriteRequest, "t"));
    return {world: done.world, change: done.ids["tmp:c"]!};
}
function rewrite(base: World, change: string, mutate: (change: StoryChange) => void): WriteResult {
    const copy = structuredClone(base.data.changes.get(change)!) as StoryChange;
    mutate(copy);
    return base.publish({requestId: id(), by: author, what: "edit", title: "改变更", baseVersion: base.version, puts: [{ref: {kind: "change", id: change}, after: copy}]} as WriteRequest, "t");
}
const retitle = (base: World, change: string) => rewrite(base, change, (copy) => void (copy.text = "换了一句话"));

function fields(base: World, namespace = "panel"): Record<string, unknown> {
    const view = base.line().engine.entry("e1", end, "actual");
    if (view === null || view === "chapter-not-found") return {};
    return Object.fromEntries(Object.entries(view.namespaces[namespace]?.fields ?? {}).map(([key, state]) => [key, state.value]));
}
const add = (path: string, value: number): Patch => ({op: "add", at: {entry: "e1", path}, value, basis: {kind: "author"}});

const LUCK: InstanceFieldDeclaration = {id: "幸运", label: "幸运", kind: "number"};
const CAP: InstanceFieldDeclaration = {id: "幸运上限", label: "幸运上限", kind: "number"};

describe("canon.components 输出 4、22：去掉是打标记，生效的字段", () => {
    test("去掉的字段读不到，值与对它的补丁留着；恢复以后连同补丁一起回来", () => {
        const start = ok(put(world(), (entry) => {
            declared(entry).push(LUCK);
            entry.init.data.panel!.fields.幸运 = 7;
        })).world;
        const told = record(start, "ch44", [add("panel.幸运", 2), add("panel.存款", 5)]);
        expect(fields(told.world)).toMatchObject({幸运: 9, 存款: 105});

        const removed = ok(mark(told.world, "幸运", true)).world;
        expect("幸运" in fields(removed)).toBe(false);
        // 同一条变更里别的补丁照套，只有对去掉的字段的那一处不适用。
        expect(fields(removed).存款).toBe(105);
        expect(removed.data.entries.get("e1")!.init.data.panel!.fields.幸运).toBe(7);

        const restored = ok(mark(removed, "幸运", false)).world;
        expect(fields(restored)).toMatchObject({幸运: 9, 存款: 105});
    });

    test("类型后来加了一个与实例字段同 id 的固定字段：固定的生效，这一组别的修改、去掉这一项、去掉这一组都照收", () => {
        const start = ok(put(world(), (entry) => {
            declared(entry).push({id: "种族", label: "种族", kind: "text"});
            entry.init.data.panel!.fields.种族 = "精灵";
        })).world;
        const upgraded = start.withOptions(options([{...PANEL, fields: [...PANEL.fields!, {id: "种族", label: "血统", kind: "text"}]}, PERSON]));
        expect(upgraded.line().engine.entry("e1", end, "actual")).toMatchObject({namespaces: {panel: {fields: {种族: {value: "精灵"}}}}});
        expect(refused(put(upgraded, (entry) => void (entry.init.data.panel!.fields.存款 = 200)))).toEqual(["ok"]);
        expect(refused(mark(upgraded, "种族", true))).toEqual(["ok"]);
        expect(refused(put(upgraded, (entry) => void (entry.init.data.panel!.removed = true)))).toEqual(["ok"]);
        // 固定的生效：它的值按固定字段的声明核。
        expect(refused(put(upgraded, (entry) => void (entry.init.data.panel!.fields.种族 = 3)))).toEqual(["type-mismatch:init.data.panel.fields.种族"]);
    });

    test("去掉的字段里的引用照旧算：指着的条目在这期间被删了，恢复照收", () => {
        const start = ok(put(world(), (entry) => {
            declared(entry).push({id: "师门", label: "师门", kind: "ref"});
            entry.init.data.panel!.fields.师门 = {ref: "e2"};
        })).world;
        const removed = ok(mark(start, "师门", true)).world;
        const deleted = ok(put(removed, (entry) => void (entry.deleted = true), "e2")).world;
        const restored = ok(mark(deleted, "师门", false)).world;
        expect(fields(restored).师门).toMatchObject({ref: "e2"});
        // 新写一个指向已删条目的引用照旧拒收。
        expect(refused(put(restored, (entry) => {
            declared(entry).push({id: "故乡", label: "故乡", kind: "ref"});
            entry.init.data.panel!.fields.故乡 = {ref: "e2"};
        }))).toEqual(["ref-invalid:init.data.panel.fields.故乡.ref"]);
    });
});

describe("canon.components 输出 23：声明上的规则只查新写或改过的", () => {
    test("新写的声明：id 不能与固定的、实例的、去掉过的相同", () => {
        const start = ok(mark(ok(declare(world(), LUCK)).world, "幸运", true)).world;
        expect(refused(declare(start, {id: "存款", label: "另一个存款", kind: "number"}))).toEqual(["id-taken:init.data.panel.declared[存款].id"]);
        expect(refused(declare(start, {id: "幸运", label: "新的幸运", kind: "text"}))).toEqual(["id-taken:init.data.panel.declared[幸运].id"]);
        // 把已有的一条原样再写一份也是新写了一条，不算原样留着的。
        expect(refused(declare(start, {...LUCK, removed: true}))).toEqual(["id-taken:init.data.panel.declared[幸运].id"]);
        expect(refused(declare(ok(declare(world(), LUCK)).world, LUCK))).toEqual(["id-taken:init.data.panel.declared[幸运].id"]);
        expect(refused(declare(start, {id: "不合法 的名字", label: "名字", kind: "text"}))).toEqual(["type-mismatch:init.data.panel.declared[不合法 的名字].id"]);
    });

    test("显示名在生效的字段里唯一；去掉过的不算，所以同名的可以再加一个，这时恢复旧的被拒", () => {
        const start = ok(declare(world(), LUCK)).world;
        expect(refused(declare(start, {id: "幸运2", label: "幸运", kind: "text"}))).toEqual(["label-taken:init.data.panel.declared[幸运2].label"]);
        expect(refused(declare(start, {id: "钱", label: "存款", kind: "number"}))).toEqual(["label-taken:init.data.panel.declared[钱].label"]);
        const again = ok(declare(ok(mark(start, "幸运", true)).world, {id: "幸运2", label: "幸运", kind: "text"})).world;
        expect(refused(mark(again, "幸运", false))).toEqual(["label-taken:init.data.panel.declared[幸运].label"]);
        expect(refused(put(again, (entry) => void (declared(entry)[1]!.label = "存款")))).toEqual(["label-taken:init.data.panel.declared[幸运2].label"]);
    });

    test("上限要指向一个生效的精确档数值字段；去掉一个还被当作上限的字段被拒，路径写到拿它当上限的那条声明", () => {
        const start = ok(declare(world(), CAP)).world;
        expect(refused(declare(start, {...LUCK, max: "没有这个字段"}))).toEqual(["field-referenced:init.data.panel.declared[幸运].max"]);
        const capped = ok(declare(start, {...LUCK, max: "幸运上限"})).world;
        expect(refused(mark(capped, "幸运上限", true))).toEqual(["field-referenced:init.data.panel.declared[幸运].max"]);
        const hidden = ok(mark(start, "幸运上限", true)).world;
        expect(refused(declare(hidden, {...LUCK, max: "幸运上限"}))).toEqual(["field-referenced:init.data.panel.declared[幸运].max"]);
    });

    test("类型不允许实例字段时新写声明被拒；固定字段与列表的子字段里不能写已去掉的标记", () => {
        expect(refused(put(world(), (entry) => void (entry.init.data.character!.declared = [{id: "种族", label: "种族", kind: "text"}])))).toEqual(["fields-not-declarable:init.data.character.declared"]);
        expect(buildRegistry([{...PERSON, fields: [{id: "性格", label: "性格", kind: "text", removed: true} as never]}]).diagnostics).toMatchObject([{code: "component-declaration-invalid", path: "fields[0].removed"}]);
        expect(refused(declare(world(), {id: "行囊", label: "行囊", kind: "list", item: [{id: "数量", label: "数量", kind: "number", removed: true} as never]}))).toEqual(["type-mismatch:init.data.panel.declared[行囊].item[0].removed"]);
    });

    test("还原“加上限”留下落空的上限：这一组别的字段照样能改，落空的上限不查", () => {
        const withCap = ok(declare(world(), CAP));
        // 上限的值在另一次修订里填：还原“加上限”以后声明没了，值 5 还留在数据里。
        const filled = ok(put(withCap.world, (entry) => void (entry.init.data.panel!.fields.幸运上限 = 5))).world;
        const capped = ok(put(filled, (entry) => {
            declared(entry).push({...LUCK, max: "幸运上限"});
            entry.init.data.panel!.fields.幸运 = 1;
        })).world;
        const reverted = capped.revert(withCap.revision.id, false, {requestId: id(), by: author}, "t");
        if (!("ok" in reverted) || !reverted.ok) throw new Error(JSON.stringify(reverted));
        expect(reverted.world.data.entries.get("e1")!.init.data.panel).toMatchObject({declared: [{...LUCK, max: "幸运上限"}], fields: {幸运上限: 5}});
        expect(refused(put(reverted.world, (entry) => void (entry.init.data.panel!.fields.存款 = 300)))).toEqual(["ok"]);
        expect(fields(record(reverted.world, "ch44", [add("panel.幸运", 100)]).world).幸运).toBe(101);
    });

    test("还原改名留下两项同名：这一组别的字段照样能改", () => {
        const start = ok(declare(world(), LUCK)).world;
        const renamed = ok(put(start, (entry) => void (declared(entry)[0]!.label = "运气")));
        const second = ok(declare(renamed.world, {id: "幸运2", label: "幸运", kind: "text"})).world;
        const reverted = second.revert(renamed.revision.id, false, {requestId: id(), by: author}, "t");
        if (!("ok" in reverted) || !reverted.ok) throw new Error(JSON.stringify(reverted));
        expect(reverted.world.data.entries.get("e1")!.init.data.panel!.declared!.map((field) => field.label)).toEqual(["幸运", "幸运"]);
        expect(refused(put(reverted.world, (entry) => void (entry.init.data.panel!.fields.存款 = 300)))).toEqual(["ok"]);
    });

    test("类型后来不再允许实例字段：原样留着的声明不挡别的修改，再写新的才拒收", () => {
        const allowing = world([PANEL, {...PERSON, instanceFields: true}]);
        const start = ok(put(allowing, (entry) => void (entry.init.data.character!.declared = [{id: "种族", label: "种族", kind: "text"}]))).world.withOptions(options());
        expect(refused(put(start, (entry) => void (entry.init.data.character!.fields.状态 = "受伤")))).toEqual(["ok"]);
        expect(refused(put(start, (entry) => void declared(entry, "character").push({id: "生日", label: "生日", kind: "text"})))).toEqual(["fields-not-declarable:init.data.character.declared"]);
    });

    test("原样留着的值不合现在的声明时不挡别的修改；改到它的那一次才核", () => {
        const start = world().withOptions(options([PANEL, {...PERSON, fields: PERSON.fields!.map((field) => (field.id === "外观" ? {...field, kind: "number" as const} : field))}]));
        expect(refused(put(start, (entry) => void (entry.init.data.character!.fields.状态 = "受伤")))).toEqual(["ok"]);
        expect(refused(put(start, (entry) => void (entry.init.data.character!.fields.外观 = "黑色")))).toEqual(["type-mismatch:init.data.character.fields.外观"]);
    });
});

describe("canon.revisions 输出 3：原样留着的补丁不因为不适用拒收", () => {
    /** 幸运初值 7，第 44 章加 2；之后把它去掉。 */
    function stale(): {world: World; change: string} {
        const start = ok(put(world(), (entry) => {
            declared(entry).push(LUCK);
            entry.init.data.panel!.fields.幸运 = 7;
        })).world;
        const told = record(start, "ch44", [add("panel.幸运", 2), add("panel.存款", 5)]);
        return {world: ok(mark(told.world, "幸运", true)).world, change: told.change};
    }

    test("字段去掉以后，旧变更还能改别的地方", () => {
        const {world: base, change} = stale();
        const done = ok(retitle(base, change)).world;
        expect(done.data.changes.get(change)!.text).toBe("换了一句话");
        expect(fields(done).存款).toBe(105);
    });

    test("设定组去掉以后，旧变更还能改别的地方", () => {
        const told = record(world(), "ch44", [add("panel.存款", 5)]);
        const removed = ok(put(told.world, (entry) => void (entry.init.data.panel!.removed = true))).world;
        expect(refused(retitle(removed, told.change))).toEqual(["ok"]);
    });

    test("新写的、多出来一份相同的、挪了安放的照旧拒收", () => {
        const {world: base, change} = stale();
        expect(refused(rewrite(base, change, (copy) => void copy.patches.push(add("panel.幸运", 3))))).toEqual(["unknown-field:patches[2]"]);
        expect(refused(rewrite(base, change, (copy) => void copy.patches.push(add("panel.幸运", 2))))).toEqual(["unknown-field:patches[2]"]);
        expect(refused(rewrite(base, change, (copy) => void (copy.at = {kind: "chapter", chapter: "ch45", key: 10})))).toEqual(["unknown-field:patches[0]"]);
    });

    test("待定转生效按新写的查：待定时写下的不适用补丁在转生效时拒收", () => {
        const start = ok(mark(ok(declare(world(), LUCK)).world, "幸运", true)).world;
        const held = record(start, "ch44", [add("panel.幸运", 2)], {status: "held", held: {note: "等作者定", reason: "unsure"}});
        expect(refused(rewrite(held.world, held.change, (copy) => {
            copy.status = "active";
            delete copy.held;
        }))).toEqual(["unknown-field:patches[0]"]);
    });

    test("带“由核对点推出”依据的数：字段去掉以后旧变更照样能改文字", () => {
        const start = ok(put(world(), (entry) => {
            declared(entry).push({id: "金币", label: "金币", kind: "number"});
            entry.init.data.panel!.fields.金币 = 100;
        })).world;
        const told = ok(start.publish({requestId: id(), by: author, what: "bookkeeping", title: "记账", baseVersion: start.version, puts: [
            {ref: {kind: "check", id: "tmp:k"}, after: {id: "tmp:k", at: {entry: "e1", path: "panel.金币"}, value: 70, told: {source: "note"}, place: {kind: "chapter", chapter: "ch45", key: 20}, by: author}},
            {ref: {kind: "change", id: "tmp:a"}, after: {id: "tmp:a", kind: "written", text: "花了十个", at: {kind: "chapter", chapter: "ch44", key: 10}, told: [], involves: ["e1"], lines: [], links: [], status: "active", by: author, patches: [add("panel.金币", -10)]}},
            {ref: {kind: "change", id: "tmp:b"}, after: {id: "tmp:b", kind: "written", text: "又花了二十", at: {kind: "chapter", chapter: "ch45", key: 10}, told: [], involves: ["e1"], lines: [], links: [], status: "active", by: author, patches: [{op: "add", at: {entry: "e1", path: "panel.金币"}, value: -20, basis: {kind: "derived", check: "tmp:k"}}]}},
        ]} as WriteRequest, "t"));
        const later = told.ids["tmp:b"]!;
        expect(refused(retitle(told.world, later))).toEqual(["ok"]);
        const removed = ok(mark(told.world, "金币", true)).world;
        expect(refused(retitle(removed, later))).toEqual(["ok"]);
    });
});
