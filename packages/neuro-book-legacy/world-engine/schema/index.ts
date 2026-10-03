import { z } from "zod";

// ============================================================================
// Zod 扩展：.unique() 标记无序集合
// ============================================================================

declare module "zod" {
    interface ZodArray<T extends z.ZodTypeAny, Cardinality extends z.ArrayCardinality = "many"> {
        /**
         * 标记数组为无序集合（set 语义）。
         * 写入时自动去重，顺序不保证。
         */
        unique(): this;
    }
}

// 扩展 ZodArray 原型
z.ZodArray.prototype.unique = function() {
    // 使用 Zod 的元数据系统存储 unique 标记
    (this as any)._def.unique = true;
    return this;
};

// ============================================================================
// 辅助类型：Ref 和 EmbeddingText
// ============================================================================

/**
 * 引用类型：指向另一个 subject。
 *
 * 使用 `.describe("ref:targetType")` 标记引用目标类型。
 * 运行时值格式：`subject://id`
 *
 * @example
 * ```ts
 * const Character = z.object({
 *     location: Ref("location").optional(),
 *     mentor: Ref("character").optional(),
 * });
 * ```
 */
export function Ref(targetType: string) {
    return z.string()
        .regex(/^subject:\/\/[\w-]+$/, "引用格式必须为 subject://id")
        .describe(`ref:${targetType}`);
}

/**
 * 富文本类型：文本 + 可选向量。
 *
 * 用于支持 RAG 语义搜索的字段（如角色记忆、事件描述）。
 *
 * @example
 * ```ts
 * const Character = z.object({
 *     memory: z.record(z.string(), EmbeddingText).default({}),
 *     events: z.array(EmbeddingText).default([]),
 * });
 * ```
 */
export const EmbeddingText = z.object({
    text: z.string().describe("文本内容"),
    vector: z.array(z.number()).optional().describe("向量，为空表示未向量化"),
    model: z.string().optional().describe("向量化模型"),
});

export type EmbeddingText = z.infer<typeof EmbeddingText>;

// ============================================================================
// 示例 Schema。Project 配置入口需保持单文件；不要用本地文件、绝对路径或 URL import 拆分 helper。
// ============================================================================

/**
 * 角色 Schema。
 */
export const Character = z.object({
    hp: z.number().int().default(100).describe("生命值"),
    maxHp: z.number().int().default(100).describe("最大生命值"),
    level: z.number().int().default(1).describe("等级"),
    location: Ref("location").optional().describe("当前位置"),
    mentor: Ref("character").optional().describe("师傅（循环引用示例）"),
    skills: z.array(z.string()).unique().default([]).describe("技能列表（无序集合）"),
    inventory: z.array(Ref("item")).default([]).describe("背包物品（有序列表）"),
    equipment: z.object({
        weapon: Ref("item").optional().describe("武器"),
        armor: z.object({
            head: Ref("item").optional().describe("头盔"),
            chest: Ref("item").optional().describe("胸甲"),
            legs: Ref("item").optional().describe("腿甲"),
        }).default({}).describe("护甲槽位"),
    }).default({}).describe("装备槽位"),
    memory: z.record(z.string(), EmbeddingText).default({}).describe("记忆（key-value 映射，支持向量搜索）"),
    events: z.array(EmbeddingText).default([]).describe("经历（支持向量搜索）"),
});

/**
 * 地点 Schema。
 */
export const Location = z.object({
    region: z.string().default("未知区域").describe("所属区域"),
    description: z.string().default("").describe("地点描述"),
    connectedTo: z.array(Ref("location")).default([]).describe("连接的地点"),
    npcs: z.array(Ref("character")).default([]).describe("当前在场的 NPC"),
});

/**
 * 物品 Schema。
 */
export const Item = z.object({
    durability: z.number().int().default(100).describe("耐久度"),
    maxDurability: z.number().int().default(100).describe("最大耐久度"),
    rarity: z.enum(["common", "rare", "epic", "legendary"]).default("common").describe("稀有度"),
    owner: Ref("character").optional().describe("持有者"),
    attributes: z.record(z.string(), z.number()).default({}).describe("属性加成（动态键映射）"),
});

// ============================================================================
// Schema 注册表
// ============================================================================

/**
 * 世界 Schema 注册表。
 *
 * 导出所有 subject type 的 schema 定义。
 * schema-loader 会读取这个对象来加载 schema。
 */
export const WorldSchema = {
    character: Character,
    location: Location,
    item: Item,
} as const;

// 类型推断导出
export type CharacterState = z.infer<typeof Character>;
export type LocationState = z.infer<typeof Location>;
export type ItemState = z.infer<typeof Item>;
