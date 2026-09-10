/**
 * 模型角色的目录与草稿。
 *
 * UI 先行：这一版只在前端表达「哪个角色绑哪个模型」，回落链按开发者给的梯度轴 / 专精轴写死；
 * 后端契约（role 的 schema、候选链写在哪一层、本地模型怎么绑定）尚未存在，正式接入时
 * `RolesSettingsDraft` 与 `buildRolesSection` 是唯一的改写入点。
 */

export type ModelRoleAxis = "gradient" | "specialist";

export type ModelRoleId =
    | "tiny" | "fast" | "main" | "deep"
    | "summarize" | "writer" | "narrative" | "plan" | "vision";

export type ModelRoleDefinition = {
    id: ModelRoleId;
    axis: ModelRoleAxis;
    /**
     * 未配置时按这个角色取；null 表示**不能回落**——这类角色必须有自己明确的模型
     * （视觉是典型：主模型多半不支持原生视觉）。
     */
    fallback: ModelRoleId | null;
    /** 建议的候选链，按优先级排列。本版只展示，可编辑的是「绑定」。 */
    suggestedChain: string[];
    /** 用途说明的 i18n key */
    purposeKey: string;
};

export const MODEL_ROLE_CATALOG: ModelRoleDefinition[] = [
    {
        id: "tiny",
        axis: "gradient",
        fallback: null,
        suggestedChain: ["本地 1B/4B", "本地 27B", "deepseek-flash"],
        purposeKey: "settings.panels.roles.purposeTiny",
    },
    {
        id: "fast",
        axis: "gradient",
        fallback: null,
        suggestedChain: ["deepseek-flash", "本地 27B", "gpt-5.6-terra"],
        purposeKey: "settings.panels.roles.purposeFast",
    },
    {
        id: "main",
        axis: "gradient",
        fallback: null,
        suggestedChain: ["用户当前手选的主力模型"],
        purposeKey: "settings.panels.roles.purposeMain",
    },
    {
        id: "deep",
        axis: "gradient",
        fallback: null,
        suggestedChain: ["gpt-6-astra", "claude-fable-5.1", "claude-opus-5"],
        purposeKey: "settings.panels.roles.purposeDeep",
    },
    {
        id: "summarize",
        axis: "specialist",
        fallback: "main",
        suggestedChain: ["claude-5-sonnet", "deepseek-flash"],
        purposeKey: "settings.panels.roles.purposeSummarize",
    },
    {
        id: "writer",
        axis: "specialist",
        fallback: "main",
        suggestedChain: ["kimi-k3", "gemini-3.8-flash", "claude-opus-5", "claude-fable-5.1"],
        purposeKey: "settings.panels.roles.purposeWriter",
    },
    {
        id: "narrative",
        axis: "specialist",
        fallback: "writer",
        suggestedChain: ["claude-opus-5", "claude-fable-5.1"],
        purposeKey: "settings.panels.roles.purposeNarrative",
    },
    {
        id: "plan",
        axis: "specialist",
        fallback: "deep",
        suggestedChain: ["进入计划模式后切换的模型"],
        purposeKey: "settings.panels.roles.purposePlan",
    },
    {
        id: "vision",
        axis: "specialist",
        fallback: null,
        suggestedChain: ["视觉模型"],
        purposeKey: "settings.panels.roles.purposeVision",
    },
];

/** 每个角色当前绑定的模型 key；null = 未配置，按 `fallback` 取。 */
export type ModelRoleBindings = Record<ModelRoleId, string | null>;

export type RolesSettingsDraft = {
    roles: ModelRoleBindings;
};

export function createRolesSettingsDraft(): RolesSettingsDraft {
    const roles = {} as ModelRoleBindings;
    for (const definition of MODEL_ROLE_CATALOG) {
        roles[definition.id] = null;
    }
    return {roles};
}

export function findModelRole(id: ModelRoleId): ModelRoleDefinition {
    const definition = MODEL_ROLE_CATALOG.find((item) => item.id === id);
    if (!definition) {
        throw new Error(`未知的模型角色：${id}`);
    }
    return definition;
}

/**
 * 未配置时实际生效的角色：沿 `fallback` 往上找第一个有绑定的角色。
 * 找到自己还没有绑定、且链上也没有任何绑定（比如 vision 这种不能回落的）时返回 null——
 * 那时只有宿主能决定怎么办，本模块不替它猜。
 */
export function resolveEffectiveRole(draft: RolesSettingsDraft, id: ModelRoleId): ModelRoleId | null {
    let current: ModelRoleId | null = id;
    const visited = new Set<ModelRoleId>();
    while (current !== null) {
        if (visited.has(current)) {
            return null;
        }
        visited.add(current);
        if (draft.roles[current]) {
            return current;
        }
        current = findModelRole(current).fallback;
    }
    return null;
}

/** 绑定的模型 key；自己没绑就取回落链上第一个有绑定的角色。 */
export function resolveRoleModelKey(draft: RolesSettingsDraft, id: ModelRoleId): string | null {
    const effective = resolveEffectiveRole(draft, id);
    return effective === null ? null : draft.roles[effective];
}

/**
 * 写回体：只保留有绑定的角色，按目录顺序排列。
 * 正式接入时这份形状要对齐后端契约——今天它只用于 Lab 与将来的宿主映射。
 */
export function buildRolesSection(draft: RolesSettingsDraft): {roles: Array<{role: ModelRoleId; modelKey: string}>} {
    const roles = MODEL_ROLE_CATALOG.flatMap((definition) => {
        const modelKey = draft.roles[definition.id];
        return modelKey ? [{role: definition.id, modelKey}] : [];
    });
    return {roles};
}
