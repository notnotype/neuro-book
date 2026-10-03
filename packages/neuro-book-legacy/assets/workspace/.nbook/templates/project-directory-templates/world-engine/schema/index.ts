/**
 * World Engine Schema - 通用小说世界模板
 *
 * 此 schema 定义了小说世界的主体类型（subject types）和属性结构。
 * 适用于大多数叙事类小说项目，可根据具体世界观扩展。
 *
 * 设计原则：
 * 1. 提供最基础、最通用的主体类型（世界、角色、地点、阵营、物品）
 * 2. 技能作为角色的 array 属性，不独立建模
 * 3. 物品选择性建模：只有需要追踪独立状态的才建 subject
 * 4. 保持简洁，避免过度设计
 * 5. 使用 EmbeddingText 支持向量搜索（memory、events 字段）
 *
 * 注意：这是单文件配置入口。本地文件、绝对路径和 URL/protocol import/export 会被 loader 拒绝；
 * 需要 helper 时请直接写在本文件，或使用包级 helper 与 node: 内置模块。
 */

import {z} from "zod";

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
 */
function Ref(targetType: string) {
    return z.string()
        .regex(/^subject:\/\/[\w-]+$/, "引用格式必须为 subject://id")
        .describe(`ref:${targetType}`);
}

/**
 * 富文本类型：文本 + 可选向量。
 *
 * 用于支持 RAG 语义搜索的字段（如角色记忆、事件描述）。
 */
const EmbeddingText = () => z.object({
    text: z.string().describe("文本内容"),
    vector: z.array(z.number()).optional().describe("向量，为空表示未向量化"),
    model: z.string().optional().describe("向量化模型"),
});

/**
 * 世界本身：承载世界级状态和大事记
 */
const World = z.object({
    era: z.string().default("新纪元").describe("当前纪元名称，例如：魔法复兴时代、蒸汽朋克时代"),
    year: z.number().int().default(1).describe("当前年份"),
    events: z.array(EmbeddingText()).default([]).describe("世界大事记，按时间顺序记录世界级事件"),
});

/**
 * 角色主体：主角、配角、重要 NPC
 */
const Character = z.object({
    // ========== 基本信息 ==========
    name: z.string().optional().describe("角色名称"),
    race: z.string().optional().describe("种族，例如：人类、精灵、兽人、机械人等"),
    age: z.number().int().optional().describe("年龄"),

    // ========== 生命值 ==========
    hp: z.number().int().default(100).describe("当前生命值"),
    maxHp: z.number().int().default(100).describe("最大生命值"),

    // ========== 关系 ==========
    location: Ref("location").optional().describe("当前位置"),
    faction: Ref("faction").optional().describe("所属阵营/组织"),

    // ========== 持有物 ==========
    inventory: z.array(z.string()).default([]).describe("持有物清单；普通物品直接存名称字符串，重要物品用 subject://id 引用 item subject"),

    // ========== 技能 ==========
    skills: z.array(z.string()).default([]).describe("已学技能列表；格式：技能名称，例如：剑术、火球术、谈判"),

    // ========== 认知与记忆 ==========
    memory: z.record(z.string(), EmbeddingText()).optional().describe("角色主观记忆；key=主题/人物，value=角色的认知（可能包含误解和主观偏见）"),

    // ========== 经历流 ==========
    events: z.array(EmbeddingText()).default([]).describe("角色经历流，按时间顺序记录重大事件"),
});

/**
 * 地点：城市、建筑、地下城、荒野等可停留空间
 */
const Location = z.object({
    name: z.string().optional().describe("地点名称"),
    locationType: z.string().optional().describe("地点类型，例如：城市、村庄、地下城、森林、山脉"),
    control: Ref("faction").optional().describe("控制方阵营"),
    events: z.array(EmbeddingText()).default([]).describe("地点历史事件"),
});

/**
 * 阵营：国家、组织、政治实体
 */
const Faction = z.object({
    name: z.string().optional().describe("阵营名称"),
    factionType: z.string().optional().describe("阵营类型，例如：王国、帝国、商会、宗教组织、犯罪集团"),
    leader: Ref("character").optional().describe("当前领袖"),
    capital: Ref("location").optional().describe("首都/总部"),
    treasury: z.number().int().default(0).describe("财富"),
    events: z.array(EmbeddingText()).default([]).describe("阵营历史大事记"),
});

/**
 * 物品：需要独立追踪状态的物品（神器、魔法装备、重要道具）
 *
 * 注意：普通物品不建 subject，直接存在 character.inventory 中。
 */
const Item = z.object({
    name: z.string().optional().describe("物品名称"),
    itemType: z.string().optional().describe("物品类型，例如：武器、防具、饰品、钥匙、文书"),
    owner: Ref("character").optional().describe("当前持有者"),
    durability: z.number().int().default(100).describe("耐久度（0-100）"),
    events: z.array(EmbeddingText()).default([]).describe("物品历史（铸造、转手、使用等）"),
});

/**
 * 导出 World Schema Registry
 *
 * 这是 World Engine 运行时加载的入口。
 * 添加新的主体类型时，在此对象中注册。
 */
export const WorldSchema = {
    world: World,
    character: Character,
    location: Location,
    faction: Faction,
    item: Item,
} as const;
