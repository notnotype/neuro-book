import {describe, expect, test} from "bun:test";

import {createHash} from "node:crypto";

import {assetPathProblem, buildRegistry, ChapterOrder, effectiveFields, generateFieldId, valueProblem, World, type ComponentDeclaration, type Entry, type FieldDeclaration, type Patch, type WriteRequest} from "../src/index";
import type {WriteResult} from "../src/world/world";
import {PANEL as PANEL_FIXTURE, PERSON} from "./fixtures/world";

const panel: ComponentDeclaration = {
    id: "canon.panel",
    label: "面板",
    namespace: "panel",
    version: 1,
    instanceFields: true,
    fields: [
        {id: "魔力上限", label: "魔力上限", kind: "number"},
        {id: "魔力", label: "魔力", kind: "number", min: 0, max: "魔力上限"},
    ],
};

describe("登记（canon.components 输出 1、2）", () => {
    test("合规的声明登记成可用的类型；只做查询的类型另列", () => {
        const registry = buildRegistry([panel, {id: "canon.plot", label: "情节"}]);
        expect(registry.byNamespace("panel")?.id).toBe("canon.panel");
        expect(registry.queryOnly.has("canon.plot")).toBe(true);
        expect(registry.diagnostics).toEqual([]);
    });

    test.each<[string, Partial<ComponentDeclaration>, string]>([
        ["保留名做命名空间", {namespace: "text"}, "namespace"],
        ["版本不是正整数", {version: 0}, "version"],
        ["没有显示名", {label: undefined}, "label"],
        ["字段不是数组", {fields: {} as never}, "fields"],
        ["多写了不认识的项", {colour: "red"} as never, ""],
        ["字段 id 叫启用", {fields: [{id: "启用", label: "启用", kind: "boolean"}]}, "fields[0].id"],
        ["字段 id 重复", {fields: [{id: "a", label: "a", kind: "text"}, {id: "a", label: "b", kind: "text"}]}, "fields[1].id"],
        ["枚举没有选项", {fields: [{id: "a", label: "a", kind: "enum"}]}, "fields[0].options"],
        ["max 指向的不是精确档数值字段", {fields: [{id: "a", label: "a", kind: "text"}, {id: "b", label: "b", kind: "number", max: "a"}]}, "fields[1].max"],
    ])("%s：整条不登记，诊断指出哪一项", (_name, change, path) => {
        const registry = buildRegistry([{...panel, ...change}]);
        expect(registry.byNamespace(change.namespace ?? "panel")).toBeUndefined();
        expect(registry.diagnostics).toEqual([expect.objectContaining({code: "component-declaration-invalid", type: "canon.panel", path})]);
    });

    test("两个类型声明同一个命名空间：两个都不可用，不按先后决定", () => {
        const other = {...panel, id: "other.panel"};
        for (const declarations of [[panel, other], [other, panel]]) {
            const registry = buildRegistry(declarations);
            expect(registry.byNamespace("panel")).toBeUndefined();
            expect(registry.conflicted.has("panel")).toBe(true);
            expect(registry.diagnostics).toEqual([{code: "component-namespace-conflict", namespace: "panel", types: ["canon.panel", "other.panel"]}]);
        }
    });

    test("登记集合的摘要与声明的先后无关，类型变了摘要就变", () => {
        const people: ComponentDeclaration = {id: "canon.person", label: "人物", namespace: "character", version: 1, fields: []};
        expect(buildRegistry([panel, people]).digest).toBe(buildRegistry([people, panel]).digest);
        expect(buildRegistry([panel, {...people, version: 2}]).digest).not.toBe(buildRegistry([panel, people]).digest);
    });
});

describe("canon.components 输出 1：只做查询的类型也核对形状", () => {
    test("没有命名空间的声明：形状不对时不登记、写诊断，不抛错", () => {
        const registry = buildRegistry([{id: "canon.tag", label: 5} as never, {id: "canon.mood", label: "心情"}]);
        expect([...registry.queryOnly.keys()]).toEqual(["canon.mood"]);
        expect(registry.diagnostics).toEqual([expect.objectContaining({code: "component-declaration-invalid", type: "canon.tag", path: "label"})]);
    });
});

describe("canon.components 场景 3：撞名", () => {
    test("两个插件都声明 panel：两个都不可用、写入被拒、数据保留；停用一个（登记里去掉）后另一个可用，数据完整", () => {
        const other = {...panel, id: "other.panel"};
        const options = (types: ComponentDeclaration[]) => ({order: new ChapterOrder(["ch1"]), registry: buildRegistry(types), reductions: () => undefined, chapterText: () => "", digest: (text: string) => createHash("sha256").update(text).digest("hex")});
        const star: Entry = {id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0, init: {name: "星瑕", aliases: [], summary: "", text: [], data: {panel: {type: panel.id, version: 1, enabled: true, fields: {魔力上限: 12000, 魔力: 3200}}}}};
        const opened = World.empty(options([panel])).publish({requestId: "open", by: {kind: "author"}, what: "opening", title: "开局", baseVersion: 0, puts: [{ref: {kind: "entry", id: "tmp:xia"}, after: star}]}, "t");
        if (!opened.ok) throw new Error(JSON.stringify(opened.failure));
        const end = {kind: "chapter", chapter: "ch1", edge: "end"} as const;
        const before = opened.world.line().engine.entry("e1", end, "actual");

        const clashing = opened.world.withOptions(options([panel, other]));
        const clashView = clashing.line().engine.entry("e1", end, "actual");
        expect(clashView !== null && clashView !== "chapter-not-found" && clashView.namespaces.panel).toMatchObject({readOnly: "component-unknown", fields: {魔力上限: {value: 12000}, 魔力: {value: 3200}}});
        expect(clashing.options.registry.diagnostics).toEqual([{code: "component-namespace-conflict", namespace: "panel", types: ["canon.panel", "other.panel"]}]);
        const write = clashing.publish({requestId: "write", by: {kind: "author"}, what: "edit", title: "记一笔", baseVersion: 1, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "用了魔力", at: {kind: "chapter", chapter: "ch1", key: 0}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "add", at: {entry: "e1", path: "panel.魔力"}, value: -100}], status: "active", by: {kind: "author"}}}]}, "t");
        expect(write.ok).toBe(false);

        const resolved = clashing.withOptions(options([panel]));
        expect(resolved.line().engine.entry("e1", end, "actual")).toEqual(before);
        expect(resolved.publish({requestId: "write-2", by: {kind: "author"}, what: "edit", title: "记一笔", baseVersion: 1, puts: [{ref: {kind: "change", id: "tmp:c"}, after: {id: "tmp:c", kind: "written", text: "用了魔力", at: {kind: "chapter", chapter: "ch1", key: 0}, told: [], involves: ["e1"], lines: [], links: [], patches: [{op: "add", at: {entry: "e1", path: "panel.魔力"}, value: -100}], status: "active", by: {kind: "author"}}}]}, "t").ok).toBe(true);
    });
});

describe("实例字段（canon.components 输出 4）", () => {
    test("显示名合法且没被占用就用它，否则加序号；不合法的字符去掉", () => {
        expect(generateFieldId("存款", new Set())).toBe("存款");
        expect(generateFieldId("存款", new Set(["存款"]))).toBe("存款2");
        expect(generateFieldId("魔力 上限", new Set())).toBe("魔力上限2");
        expect(generateFieldId("3级", new Set())).toBe("f3级2");
        expect(generateFieldId("启用", new Set())).toBe("f启用2");
    });

    test("类型允许实例字段时，生效的字段是固定的加实例声明的", () => {
        const type = buildRegistry([panel]).byNamespace("panel")!;
        const declared: FieldDeclaration[] = [{id: "存款", label: "存款", kind: "number"}];
        expect(effectiveFields(type, declared).map((field) => field.id)).toEqual(["魔力上限", "魔力", "存款"]);
    });
});

describe("字段值（canon.components 值表、输出 14、15）", () => {
    test.each<[FieldDeclaration, unknown, string | null]>([
        [{id: "a", label: "a", kind: "number"}, 41800, null],
        [{id: "a", label: "a", kind: "number"}, null, null],
        [{id: "a", label: "a", kind: "number"}, "41800", "type-mismatch"],
        [{id: "a", label: "a", kind: "number"}, 1e11, "number-out-of-range"],
        [{id: "a", label: "a", kind: "number", precision: "semantic"}, "大约两万", null],
        [{id: "a", label: "a", kind: "enum", options: ["原身", "马甲"]}, "马甲", null],
        [{id: "a", label: "a", kind: "enum", options: ["原身"]}, "别的", "type-mismatch"],
        [{id: "a", label: "a", kind: "boolean"}, null, null],
        [{id: "a", label: "a", kind: "image"}, {"图片": "assets/星瑕.png", "说明": "原身"}, null],
        [{id: "a", label: "a", kind: "image"}, {"图片": "../外面.png"}, "invalid-asset-path"],
        [{id: "a", label: "a", kind: "list", item: [{id: "数量", label: "数量", kind: "number"}]}, [{id: "i1", label: "药", 数量: 2}], null],
        [{id: "a", label: "a", kind: "list"}, [{id: "i1", label: "药"}, {id: "i1", label: "药"}], "type-mismatch"],
    ])("%o 的值 %o → %s", (field, value, expected) => {
        expect(valueProblem(field, value)).toBe(expected as never);
    });

    test.each([
        ["assets/星瑕/原身.png", null],
        ["https://example.com/a.png", "invalid-asset-path"],
        ["/etc/passwd", "invalid-asset-path"],
        ["assets/../.nbook/x", "invalid-asset-path"],
        [".nbook/world/log/000001.jsonl", "invalid-asset-path"],
        ["assets\\a.png", "invalid-asset-path"],
    ])("图片路径 %s → %s", (path, expected) => {
        expect(assetPathProblem(path)).toBe(expected as never);
    });
});

describe("canon.components 输出 5、7、11、12、13、16：实例的去掉与加回、版本与类型不可用时的写入、只做查询的类型、重新声明", () => {
    const PLOT: ComponentDeclaration = {id: "canon.plot", label: "情节"};
    const options = (declarations: readonly ComponentDeclaration[] = [PANEL_FIXTURE, PERSON]) => ({
        order: new ChapterOrder(["ch1", "ch2", "ch3"]),
        registry: buildRegistry(declarations),
        reductions: () => undefined,
        chapterText: () => "",
        digest: (text: string) => createHash("sha256").update(text).digest("hex"),
    });
    let sequence = 0;
    const request = (puts: WriteRequest["puts"], baseVersion: number): WriteRequest => ({requestId: `c-${String(++sequence)}`, by: {kind: "author"}, what: "edit", title: "测试", baseVersion, puts});
    const ok = (result: WriteResult): Extract<WriteResult, {ok: true}> => {
        if (!result.ok) throw new Error(JSON.stringify(result.failure));
        return result;
    };
    const problemCodes = (result: WriteResult) => (!result.ok && result.failure.code === "validation-failed" ? result.failure.problems.map((problem) => problem.code) : result.ok ? ["发布成功"] : [result.failure.code]);
    const xia = (panel: Partial<NonNullable<Entry["init"]["data"][string]>> & {fields?: Record<string, unknown>} = {}, extra: Partial<Entry["init"]> = {}): Entry => ({
        id: "tmp:xia", type: "人物", parent: null, folder: "", order: 0,
        init: {name: "星瑕", aliases: [], summary: "", text: [], data: {panel: {type: PANEL_FIXTURE.id, version: 1, enabled: true, ...panel, fields: {存款: 100, 魔力上限: null, 魔力: null, 物品: [], ...panel.fields}}}, ...extra},
    });
    const change = (id: string, chapter: string, patches: Patch[]) => ({id, kind: "written" as const, text: id, at: {kind: "chapter" as const, chapter, key: 0}, told: [], involves: [], lines: [], links: [], patches, status: "active" as const, by: {kind: "author" as const}});
    const deposit = (value: number): Patch => ({op: "add", at: {entry: "e1", path: "panel.存款"}, value});
    const end = (chapter: string) => ({kind: "chapter", chapter, edge: "end"}) as const;
    const modified = (world: World, edit: (next: Entry) => void) => {
        const next = structuredClone(world.data.entries.get("e1")!);
        edit(next);
        return next;
    };
    const put = (world: World, next: Entry) => world.publish(request([{ref: {kind: "entry", id: "e1"}, after: next}], world.version), "t");
    const viewOf = (world: World, chapter: string) => world.line().engine.entry("e1", end(chapter), "actual");

    /** 面板从第 2 章起启用（第 2 章那条变更先启用再加 5）。版本 2。 */
    function fromChapter2(): World {
        const opened = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: xia({enabled: false})}], 0), "t"));
        return ok(opened.world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch2", [{op: "set", at: {entry: "e1", path: "panel.启用"}, value: true}, deposit(5)])}], 1), "t")).world;
    }

    test("场景 1 的后半、输出 7：去掉实例后读不到、对它的补丁不适用、写入被拒；加回以后各章的值与启用情况与去掉之前相同", () => {
        const world = fromChapter2();
        const before = ["ch1", "ch2", "ch3"].map((chapter) => viewOf(world, chapter));
        expect(before.map((view) => view !== null && view !== "chapter-not-found" && view.namespaces.panel?.fields.存款?.value)).toEqual([undefined, 105, 105]);

        const removed = ok(put(world, modified(world, (next) => (next.init.data.panel!.removed = true)))).world;
        // 去掉和没启用分开记：初值里的启用标记没动，数据还在。
        expect(removed.data.entries.get("e1")!.init.data.panel).toMatchObject({enabled: false, removed: true, fields: {存款: 100}});
        for (const chapter of ["ch1", "ch2", "ch3"]) expect(viewOf(removed, chapter)).toMatchObject({namespaces: {}, upcoming: []});
        // 已存的那条变更对它不适用：整条仍算套上，只是不改数据。
        expect(removed.line().engine.outcome("c1")).toEqual({applied: true});
        expect(problemCodes(removed.publish(request([{ref: {kind: "change", id: "tmp:d"}, after: change("tmp:d", "ch3", [deposit(1)])}], removed.version), "t"))).toEqual(["component-disabled"]);

        const restored = ok(put(removed, modified(removed, (next) => delete next.init.data.panel!.removed))).world;
        expect(["ch1", "ch2", "ch3"].map((chapter) => viewOf(restored, chapter))).toEqual(before);
    });

    test("已启用的实例被去掉同样读不到、写入被拒；加回后数据原样（不重新从未知开始）", () => {
        const opened = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: xia()}], 0), "t")).world;
        const removed = ok(put(opened, modified(opened, (next) => (next.init.data.panel!.removed = true)))).world;
        expect(viewOf(removed, "ch3")).toMatchObject({namespaces: {}});
        expect(problemCodes(removed.publish(request([{ref: {kind: "change", id: "tmp:d"}, after: change("tmp:d", "ch2", [deposit(1)])}], removed.version), "t"))).toEqual(["component-disabled"]);
        const restored = ok(put(removed, modified(removed, (next) => delete next.init.data.panel!.removed))).world;
        expect(viewOf(restored, "ch3")).toMatchObject({namespaces: {panel: {fields: {存款: {value: 100}}}}});
    });

    test("场景 2、输出 11、12：版本对不上或类型不在时，对它的补丁与对初值的修改都被拒收，码与读取时的诊断同一个；换回版本 1 可以写，数据没变", () => {
        const world = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: xia()}], 0), "t")).world;
        const write = (target: World) => target.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch1", [deposit(5)])}], 1), "t");
        const edit = (target: World) => put(target, modified(target, (next) => (next.init.data.panel!.fields.存款 = 7)));

        const newer = world.withOptions(options([{...PANEL_FIXTURE, version: 2}, PERSON]));
        expect(viewOf(newer, "ch1")).toMatchObject({namespaces: {panel: {readOnly: "component-version-unsupported", fields: {存款: {value: 100}}}}});
        expect(problemCodes(write(newer))).toEqual(["component-version-unsupported"]);
        expect(problemCodes(edit(newer))).toEqual(["component-version-unsupported"]);

        const missing = world.withOptions(options([PERSON]));
        expect(viewOf(missing, "ch1")).toMatchObject({namespaces: {panel: {readOnly: "component-unknown", fields: {存款: {value: 100}}}}});
        expect(problemCodes(write(missing))).toEqual(["component-unknown"]);
        expect(problemCodes(edit(missing))).toEqual(["component-unknown"]);

        const back = newer.withOptions(options());
        expect(back.data.entries.get("e1")).toEqual(world.data.entries.get("e1")!);
        expect(write(back).ok).toBe(true);
    });

    test("输出 13：只做查询的类型，读取结果里列出“有这个 Component”；它没有命名空间，补丁写不了，也不会占用命名空间", () => {
        const registry = options([PANEL_FIXTURE, PERSON, PLOT]);
        const tagged = xia({}, {components: ["canon.plot"]});
        const world = ok(World.empty(registry).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: tagged}], 0), "t")).world;
        expect(viewOf(world, "ch1")).toMatchObject({components: ["canon.plot"], namespaces: {panel: {fields: {存款: {value: 100}}}}});
        // 没有命名空间可写：按类型 id 或类型名当命名空间的补丁都被拒。
        for (const path of ["canon.plot.值", "plot.值", "canon.plot"]) {
            const attempt = world.publish(request([{ref: {kind: "change", id: "tmp:c"}, after: change("tmp:c", "ch1", [{op: "set", at: {entry: "e1", path}, value: 1}])}], 1), "t");
            expect(!attempt.ok && attempt.failure.code).toBe("validation-failed");
        }
    });

    test("输出 16：删掉声明的实例字段再重新声明同一个 id，种类或档对不上旧值时拒收；相同的种类和档可以恢复，显示名可以不同", () => {
        const declared = (id: string, kind: "number" | "text", label = id): FieldDeclaration => ({id, label, kind});
        const withDeclared = (fields: FieldDeclaration[], value: unknown) => xia({declared: fields, fields: {额外: value}});
        const opened = ok(World.empty(options()).publish(request([{ref: {kind: "entry", id: "tmp:xia"}, after: withDeclared([declared("额外", "number")], 5)}], 0), "t")).world;

        const dropped = ok(put(opened, modified(opened, (next) => delete next.init.data.panel!.declared))).world;
        // 声明删了，值还在：读取时看不到，再声明同一个 id 时旧值必须仍然合格。
        expect(dropped.data.entries.get("e1")!.init.data.panel!.fields.额外).toBe(5);
        const redeclare = (field: FieldDeclaration) => put(dropped, modified(dropped, (next) => (next.init.data.panel!.declared = [field])));
        expect(problemCodes(redeclare(declared("额外", "text")))).toEqual(["field-redeclare-mismatch"]);
        const same = redeclare(declared("额外", "number", "额外的数"));
        expect(same.ok).toBe(true);
        expect(viewOf(ok(same).world, "ch1")).toMatchObject({namespaces: {panel: {fields: {额外: {value: 5}}}}});
    });
});
