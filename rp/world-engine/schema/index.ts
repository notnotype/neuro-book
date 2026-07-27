import { z } from "zod";

// ============================================================================
// 辅助类型：Ref 和 EmbeddingText
// ============================================================================

export function Ref(targetType: string) {
    return z.string()
        .regex(/^subject:\/\/[\w-]+$/, "引用格式必须为 subject://id")
        .describe(`ref:${targetType}`);
}

export const EmbeddingText = z.object({
    text: z.string().describe("文本内容"),
    vector: z.array(z.number()).optional().describe("向量，为空表示未向量化"),
    model: z.string().optional().describe("向量化模型"),
});

export type EmbeddingText = z.infer<typeof EmbeddingText>;

// ============================================================================
// Subject Schema 定义
// ============================================================================

/**
 * 世界 Schema。
 */
export const World = z.object({
    name: z.string().default("").describe("世界名称"),
    description: z.string().default("").describe("世界描述"),
    era: z.string().default("公元").describe("纪元名称"),
    year: z.number().int().default(1).describe("当前年份"),
    events: z.array(EmbeddingText).default([]).describe("世界级事件"),
});

/**
 * 角色 Schema。
 */
export const Character = z.object({
    name: z.string().default("").describe("角色名称"),
    description: z.string().default("").describe("角色描述"),
    state: z.string().default("").describe("当前状态"),
    title: z.string().default("").describe("头衔/称号"),
    visibleFeature: z.string().default("").describe("可见特征"),
    location: Ref("location").optional().describe("所在位置"),
    hp: z.number().int().default(100).describe("生命值"),
    maxHp: z.number().int().default(100).describe("最大生命值"),
    events: z.array(EmbeddingText).default([]).describe("经历"),
    secret: z.record(z.string(), z.any()).default({}).describe("隐藏动机/未揭示真相"),
    关系: z.array(z.object({
        对象: z.string().describe("目标角色 ref"),
        类型: z.string().describe("关系类型"),
        好感: z.number().optional().describe("好感度"),
    })).default([]).describe("关系列表"),
});

/**
 * 地点 Schema。
 */
export const Location = z.object({
    name: z.string().default("").describe("地点名称"),
    description: z.string().default("").describe("地点描述"),
    state: z.string().default("").describe("当前状态"),
    location: z.string().default("").describe("地理位置描述"),
    events: z.array(EmbeddingText).default([]).describe("事件记录"),
    连接: z.array(z.object({
        目标: z.string().describe("目标地点 ref"),
        距离: z.string().optional().describe("距离描述"),
        方向: z.string().optional().describe("方向描述"),
    })).default([]).describe("连接地点列表"),
});

/**
 * 阵营 Schema。
 */
export const Faction = z.object({
    name: z.string().default("").describe("势力名称"),
    description: z.string().default("").describe("势力描述"),
    members: z.array(Ref("character")).default([]).describe("成员"),
});

/**
 * 物品 Schema。
 */
export const Item = z.object({
    name: z.string().default("").describe("物品名称"),
    description: z.string().default("").describe("物品描述"),
    durability: z.number().int().default(100).describe("耐久度"),
    owner: Ref("character").optional().describe("持有者"),
    rarity: z.enum(["common", "rare", "epic", "legendary"]).default("common").describe("稀有度"),
});

// ============================================================================
// Schema 注册表
// ============================================================================

export const WorldSchema = {
    world: World,
    character: Character,
    location: Location,
    faction: Faction,
    item: Item,
} as const;

export type CharacterState = z.infer<typeof Character>;
export type LocationState = z.infer<typeof Location>;
export type ItemState = z.infer<typeof Item>;
