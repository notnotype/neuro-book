/**
 * 角色设定卡：基础信息、外貌、性格心理、能力资源。
 */
export type CharacterProfile = {
    gender?: string;
    age?: string;
    race?: string;
    faction?: string;
    occupation?: string;
    identity?: string;
    residence?: string;
    origin?: string;

    appearance?: string;
    bodyFeatures?: string[];
    clothingStyle?: string;
    voiceStyle?: string;
    mannerisms?: string[];

    personalityTraits?: string[];
    temperament?: string;
    likes?: string[];
    dislikes?: string[];
    fears?: string[];
    weaknesses?: string[];
    desires?: string;
    motivation?: string;
    values?: string;
    secrets?: string;

    abilities?: string[];
    skills?: string[];
    equipment?: string[];
    resources?: string[];
    limitations?: string;
};

/**
 * 角色叙事与成长数据。
 */
export type CharacterStory = {
    firstAppearance?: string;
    roleInStory?: string;
    characterArc?: string;
    currentState?: string;
    keyEvents?: string[];
    goalsShortTerm?: string;
    goalsLongTerm?: string;
    publicPersona?: string;
    trueSelf?: string;
};

/**
 * 角色元信息（收藏、绑定上下文等）。
 */
export type CharacterMeta = {
    /** 是否收藏。null/undefined 表示未收藏 */
    pinned?: boolean;
    /** 主绑定上下文路径。null/undefined 表示无绑定 */
    primaryContext?: string;
};

/**
 * type=character 的条目在 ext.character 下的完整结构。
 * 所有字段均为可选，渐进填充。
 */
export type CharacterExt = {
    /** 一句话角色定义 */
    logline?: string;
    profile?: CharacterProfile;
    story?: CharacterStory;
    meta?: CharacterMeta;
};

/**
 * 从 LorebookDetailDto.ext 中安全解析出强类型的 CharacterExt。
 * ext 为 null 或 ext.character 不存在时返回空对象 {}。
 */
export function parseCharacterExt(
    ext: Record<string, unknown> | null,
): CharacterExt {
    if (!ext || typeof ext.character !== "object" || ext.character === null) {
        return {};
    }
    return ext.character as CharacterExt;
}

/**
 * 将 CharacterExt 合并回 LorebookDetailDto.ext，保留其他 namespace 字段。
 * 返回可直接提交给 PATCH API 的 ext 值。
 */
export function buildCharacterExt(
    existingExt: Record<string, unknown> | null,
    characterExt: CharacterExt,
): Record<string, unknown> {
    return {
        ...(existingExt ?? {}),
        character: characterExt,
    };
}
