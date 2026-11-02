import {describe, expect, test} from "bun:test";

import {assetPathProblem, buildRegistry, effectiveFields, generateFieldId, valueProblem, type ComponentDeclaration, type FieldDeclaration} from "../src/index";

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
