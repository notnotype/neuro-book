import {describe, test, expect} from "vitest";
import {z} from "zod";
import {Ref, EmbeddingText} from "nbook/world-engine/schema";
import {buildWorldSchema, findAttrSchema, flattenAttrs, collectDefaultAttrs} from "nbook/server/world-engine/schema-loader";

/**
 * Phase 2.5 Zod-native loader 烟雾测试：验证 Zod -> 运行时 WorldSchema 的核心派生，
 * 重点覆盖 embedding 一等标记、ref、unique、嵌套对象、findAttrSchema、投影。
 */
describe("buildWorldSchema (Zod-native)", () => {
    const Character = z.object({
        hp: z.number().int().default(100).describe("生命值"),
        location: Ref("location").optional().describe("当前位置"),
        skills: z.array(z.string()).unique().default([]).describe("技能"),
        inventory: z.array(Ref("item")).default([]).describe("背包"),
        equipment: z.object({
            weapon: Ref("item").optional().describe("武器"),
        }).default({}).describe("装备"),
        memory: z.record(z.string(), EmbeddingText).default({}).describe("记忆"),
        events: z.array(EmbeddingText).default([]).describe("经历"),
    });
    const Location = z.object({region: z.string().default("未知")});
    const Item = z.object({durability: z.number().int().default(100)});
    const schema = buildWorldSchema({character: Character, location: Location, item: Item});

    test("基础 scalar 与 ref 提取", () => {
        expect(findAttrSchema(schema, "character", "/hp")).toMatchObject({kind: "scalar", type: "int", default: 100});
        expect(findAttrSchema(schema, "character", "/location")).toMatchObject({kind: "scalar", type: "ref(location)"});
    });

    test("unique 数组记为 collection，普通 ref 数组记为 list", () => {
        expect(findAttrSchema(schema, "character", "/skills")).toMatchObject({kind: "collection", itemType: "string"});
        expect(findAttrSchema(schema, "character", "/inventory")).toMatchObject({kind: "list", itemType: "ref(item)"});
    });

    test("嵌套对象字段可寻址", () => {
        expect(findAttrSchema(schema, "character", "/equipment/weapon")).toMatchObject({kind: "scalar", type: "ref(item)"});
    });

    test("EmbeddingText 容器被标记为一等 embedding", () => {
        const memory = findAttrSchema(schema, "character", "/memory");
        const events = findAttrSchema(schema, "character", "/events");
        expect(memory).toMatchObject({kind: "object", embedding: "record"});
        expect(events).toMatchObject({kind: "list", embedding: "array"});
    });

    test("普通 string record 可加载为动态 object", () => {
        const StringRecordCharacter = z.object({
            equipment: z.record(z.string(), z.string()).optional().describe("装备"),
        });
        const stringRecordSchema = buildWorldSchema({character: StringRecordCharacter});
        expect(findAttrSchema(stringRecordSchema, "character", "/equipment")).toMatchObject({
            kind: "object",
            itemType: "string",
            desc: "装备",
        });
    });

    test("Zod 4 单参数 string record 可加载为动态 object", () => {
        const StringRecordCharacter = z.object({
            equipment: z.record(z.string()).optional().describe("装备"),
        });
        const stringRecordSchema = buildWorldSchema({character: StringRecordCharacter});
        expect(findAttrSchema(stringRecordSchema, "character", "/equipment")).toMatchObject({
            kind: "object",
            itemType: "string",
            desc: "装备",
        });
    });

    test("默认值收集：含 default 的属性进 init slice", () => {
        const defaults = collectDefaultAttrs(schema, "character");
        const byAttr = Object.fromEntries(defaults.map((d) => [d.attr, d.value]));
        expect(byAttr.hp).toBe(100);
        expect(byAttr.skills).toEqual([]);
        expect(byAttr.events).toEqual([]);
    });

    test("投影不含 embedding 字段（对外形状不变）", () => {
        const memory = flattenAttrs(schema.subjectTypes.character.attrs).find((a) => a.name === "memory");
        expect(memory).toBeDefined();
        expect(memory).not.toHaveProperty("embedding");
    });
});
