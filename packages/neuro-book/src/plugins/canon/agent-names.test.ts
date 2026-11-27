/**
 * Agent 工具的名字与地址解析（docs/specs/canon/agent-tools.md 输出 7）：写 id 的总是认得；写名字时只有唯一命中才换成地址，
 * 重名时回话列出候选的 id、不替它选。产品里登记的类型没有重名、也没有带名字的普通列表，这几种情形在这里用构造的读取测。
 */

import {describe, expect, it} from "bun:test";

import type {ComponentType, EntryView, FieldDeclaration} from "@notnotype/nb-canon/schema";

import {componentNamed, resolveField} from "./backend/agent-names";

const type = (id: string, label: string, namespace: string, fields: FieldDeclaration[]): ComponentType => ({id, label, namespace, version: 1, fields, instanceFields: false});
const items: FieldDeclaration = {id: "物品", label: "物品", kind: "list", item: [{id: "数量", label: "数量", kind: "number"}, {id: "备注", label: "数量", kind: "text"}, {id: "甲", label: "重", kind: "text"}, {id: "乙", label: "重", kind: "text"}]} as FieldDeclaration;
const store = type("test.store", "库存", "store", [items, {id: "a", label: "b", kind: "text"} as FieldDeclaration, {id: "b", label: "c", kind: "text"} as FieldDeclaration]);
const other = type("test.other", "库存", "other", [{id: "x", label: "x", kind: "text"} as FieldDeclaration]);
const view = {namespaces: {store: {fields: {物品: {value: [{id: "i1", label: "Twin", 数量: 1}, {id: "i2", label: "Twin", 数量: 2}, {id: "i3", label: "Solo", 数量: 3}]}}}, other: {fields: {}}}} as unknown as EntryView;
const declarations = {store: store.fields, other: other.fields};
const resolve = (given: string) => resolveField(given, view, declarations, [store, other]);

describe("Agent 工具的名字与地址", () => {
    it("列表元素：写 id 认得；名字唯一时换成 id；两项同名时列出两个 id，不写到第一项", () => {
        expect(resolve("store.物品[i2].数量")).toMatchObject({path: "store.物品[i2].数量"});
        expect(resolve("store.物品[Solo].数量")).toMatchObject({path: "store.物品[i3].数量"});
        const twin = resolve("store.物品[Twin].数量");
        expect(twin).toEqual({problem: expect.stringContaining("i1、i2")});
    });

    it("字段与子字段：id 全等的优先于别的字段的显示名；子字段的显示名重名时列出", () => {
        expect(resolve("store.b")).toMatchObject({path: "store.b"});
        expect(resolve("store.c")).toMatchObject({path: "store.b"});
        // 写的是子字段 id“数量”：id 全等的优先，不因“备注”的显示名也叫“数量”而报重名。
        expect(resolve("store.物品[i1].数量")).toMatchObject({path: "store.物品[i1].数量"});
        expect(resolve("store.物品[i1].重")).toEqual({problem: expect.stringContaining("甲、乙")});
    });

    it("模块：条目上两个模块同名时列出命名空间；写命名空间认得", () => {
        expect(resolve("库存.a")).toEqual({problem: expect.stringContaining("store、other")});
        expect(resolve("other.x")).toMatchObject({path: "other.x"});
    });

    it("新建时的模块：写类型 id、命名空间认得；两个类型同名时列出两个，不取登记顺序里的第一个", () => {
        expect(componentNamed([store, other], "test.other")).toBe(other);
        expect(componentNamed([store, other], "store")).toBe(store);
        const named = componentNamed([store, other], "库存");
        expect(named).toEqual({problem: expect.stringContaining("test.store（store）、test.other（other）")});
        expect(componentNamed([store], "库存")).toBe(store);
        expect(componentNamed([store], "仓库")).toEqual({problem: expect.stringContaining("没有模块“仓库”")});
    });
});
