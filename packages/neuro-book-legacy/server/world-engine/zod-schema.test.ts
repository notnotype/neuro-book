import { describe, test, expect } from "vitest";
import { z } from "zod";
import {
    extractRefs,
    extractUniqueArrays,
    collectZodDefaults,
} from "nbook/server/world-engine/types";

// 测试用的 schema 定义
function Ref(targetType: string) {
    return z.string()
        .regex(/^subject:\/\/[\w-]+$/)
        .describe(`ref:${targetType}`);
}

// 扩展 ZodArray（与 world-engine/schema/index.ts 一致）
declare module "zod" {
    interface ZodArray<T extends z.ZodTypeAny, Cardinality extends z.ArrayCardinality = "many"> {
        unique(): this;
    }
}

z.ZodArray.prototype.unique = function() {
    (this as any)._def.unique = true;
    return this;
};

describe("Phase 1: Zod Schema Layer", () => {
    describe("extractRefs", () => {
        test("提取顶层 ref", () => {
            const schema = z.object({
                location: Ref("location").optional(),
                mentor: Ref("character").optional(),
            });

            const refs = extractRefs(schema);

            expect(refs).toEqual({
                location: "location",
                mentor: "character",
            });
        });

        test("提取嵌套对象中的 ref", () => {
            const schema = z.object({
                equipment: z.object({
                    weapon: Ref("item").optional(),
                    armor: z.object({
                        head: Ref("item").optional(),
                        chest: Ref("item").optional(),
                    }).default({}),
                }).default({}),
            });

            const refs = extractRefs(schema);

            expect(refs).toEqual({
                "equipment.weapon": "item",
                "equipment.armor.head": "item",
                "equipment.armor.chest": "item",
            });
        });

        test("提取数组中的 ref", () => {
            const schema = z.object({
                inventory: z.array(Ref("item")).default([]),
                npcs: z.array(Ref("character")).default([]),
            });

            const refs = extractRefs(schema);

            expect(refs).toEqual({
                inventory: "item[]",
                npcs: "character[]",
            });
        });

        test("提取 Record 中的 ref", () => {
            const schema = z.object({
                relations: z.record(z.string(), Ref("character")).default({}),
            });

            const refs = extractRefs(schema);

            expect(refs).toEqual({
                relations: "character{}",
            });
        });

        test("循环引用（character.mentor: Ref('character')）", () => {
            const schema = z.object({
                name: z.string(),
                mentor: Ref("character").optional(),
            });

            // 不应该抛出错误
            const refs = extractRefs(schema);

            expect(refs).toEqual({
                mentor: "character",
            });
        });

        test("非 ref 字段不出现在结果中", () => {
            const schema = z.object({
                hp: z.number().int().default(100),
                name: z.string(),
                location: Ref("location").optional(),
            });

            const refs = extractRefs(schema);

            expect(refs).toEqual({
                location: "location",
            });
        });
    });

    describe("extractUniqueArrays", () => {
        test("提取 unique 数组", () => {
            const schema = z.object({
                skills: z.array(z.string()).unique().default([]),
                inventory: z.array(z.string()).default([]), // 非 unique
                tags: z.array(z.string()).unique().default([]),
            });

            const uniqueArrays = extractUniqueArrays(schema);

            expect(uniqueArrays).toEqual(new Set(["skills", "tags"]));
        });

        test("嵌套对象中的 unique 数组", () => {
            const schema = z.object({
                profile: z.object({
                    skills: z.array(z.string()).unique().default([]),
                    hobbies: z.array(z.string()).default([]), // 非 unique
                }).default({}),
            });

            const uniqueArrays = extractUniqueArrays(schema);

            expect(uniqueArrays).toEqual(new Set(["profile.skills"]));
        });

        test("无 unique 数组时返回空集合", () => {
            const schema = z.object({
                inventory: z.array(z.string()).default([]),
                events: z.array(z.string()).default([]),
            });

            const uniqueArrays = extractUniqueArrays(schema);

            expect(uniqueArrays.size).toBe(0);
        });
    });

    describe("collectZodDefaults", () => {
        test("收集所有属性（包括 undefined）", () => {
            const schema = z.object({
                hp: z.number().int().default(100),
                level: z.number().int().default(1),
                location: Ref("location").optional(), // 无 default
                name: z.string().optional(), // 无 default
            });

            const defaults = collectZodDefaults(schema);

            expect(defaults).toEqual({
                hp: 100,
                level: 1,
                location: undefined,
                name: undefined,
            });
        });

        test("收集复合类型的默认值", () => {
            const schema = z.object({
                skills: z.array(z.string()).default([]),
                equipment: z.object({
                    weapon: Ref("item").optional(),
                }).default({}),
                attributes: z.record(z.string(), z.number()).default({}),
            });

            const defaults = collectZodDefaults(schema);

            expect(defaults).toEqual({
                skills: [],
                equipment: {},
                attributes: {},
            });
        });

        test("空 schema 返回空对象", () => {
            const schema = z.object({});

            const defaults = collectZodDefaults(schema);

            expect(defaults).toEqual({});
        });
    });

    describe("集成测试：完整 Character schema", () => {
        test("Character schema 元数据提取", () => {
            const EmbeddingText = z.object({
                text: z.string(),
                vector: z.array(z.number()).optional(),
                model: z.string().optional(),
            });

            const Character = z.object({
                hp: z.number().int().default(100),
                maxHp: z.number().int().default(100),
                level: z.number().int().default(1),
                location: Ref("location").optional(),
                mentor: Ref("character").optional(),
                skills: z.array(z.string()).unique().default([]),
                inventory: z.array(Ref("item")).default([]),
                equipment: z.object({
                    weapon: Ref("item").optional(),
                    armor: z.object({
                        head: Ref("item").optional(),
                        chest: Ref("item").optional(),
                    }).default({}),
                }).default({}),
                memory: z.record(z.string(), EmbeddingText).default({}),
            });

            // 提取 refs
            const refs = extractRefs(Character);
            expect(refs).toEqual({
                location: "location",
                mentor: "character",
                inventory: "item[]",
                "equipment.weapon": "item",
                "equipment.armor.head": "item",
                "equipment.armor.chest": "item",
            });

            // 提取 unique 数组
            const uniqueArrays = extractUniqueArrays(Character);
            expect(uniqueArrays).toEqual(new Set(["skills"]));

            // 收集默认值
            const defaults = collectZodDefaults(Character);
            expect(defaults.hp).toBe(100);
            expect(defaults.maxHp).toBe(100);
            expect(defaults.level).toBe(1);
            expect(defaults.location).toBeUndefined();
            expect(defaults.mentor).toBeUndefined();
            expect(defaults.skills).toEqual([]);
            expect(defaults.inventory).toEqual([]);
            expect(defaults.equipment).toEqual({});
            expect(defaults.memory).toEqual({});
        });
    });

    describe("Ref 辅助函数", () => {
        test("Ref 生成正确的 schema", () => {
            const locationRef = Ref("location");

            // 测试 description（使用 getter）
            expect(locationRef.description).toBe("ref:location");

            // 测试正则验证
            const validResult = locationRef.safeParse("subject://erina");
            expect(validResult.success).toBe(true);

            const invalidResult = locationRef.safeParse("invalid-ref");
            expect(invalidResult.success).toBe(false);
        });
    });

    describe(".unique() 扩展", () => {
        test(".unique() 标记数组为 unique", () => {
            const schema = z.array(z.string()).unique();

            expect((schema as any)._def.unique).toBe(true);
        });

        test("非 unique 数组没有标记", () => {
            const schema = z.array(z.string());

            expect((schema as any)._def.unique).toBeUndefined();
        });
    });
});
