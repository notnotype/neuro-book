/**
 * 模型角色的草稿模型与序列化规则。
 *
 * 角色在这里是**数据**：梯度轴固定四档，专精轴可以增删。角色的定义只有三件事——
 * 绑哪个模型、这个角色是干什么的（描述会进模型看到的目录）、以及是否启用。
 *
 * **产品提供的角色不可编辑**：内置角色的名字与描述由产品给（跟随界面语言），用户只能
 * 启用 / 停用它们；只有用户自己加的角色才允许改名字、改描述、删除。
 *
 * 没有候选链，也没有回落：没配模型的角色就是配置错误，由宿主体面地报出来，
 * 而不是悄悄用别的角色的模型顶上。
 *
 * UI 先行：后端契约（role 的 schema、目录怎么送到模型）尚未存在，正式接入时
 * `RolesSettingsDraft` 与 `buildRolesSection()` 是唯一的改写入点。
 */

export type ModelRoleAxis = "gradient" | "specialist";

export type ModelRoleDraft = {
    /** 稳定标识：进配置、进模型看到的目录；建了就不再改 */
    id: string;
    /** 角色名：给人看；内置角色由产品给，不可改 */
    name: string;
    /** 角色描述：给模型看这个角色负责什么；内置角色不可改 */
    description: string;
    /** 绑定的模型 key；null = 未配置（配置错误，不用别的角色顶替） */
    modelKey: string | null;
    /** 建议模型：只在提示里出现，不参与解析 */
    suggestedModel: string | null;
    iconClass: string;
    /** 产品提供的角色：名字与描述只读，只能启用 / 停用 */
    builtIn: boolean;
    /** 停用后不参与目录、也不参与配置校验 */
    enabled: boolean;
};

export type RolesSettingsDraft = {
    gradient: ModelRoleDraft[];
    specialist: ModelRoleDraft[];
};

type RoleSeed = Omit<ModelRoleDraft, "modelKey" | "name" | "description" | "enabled"> & {
    /** 名字与描述走 i18n：种子角色即内置角色，跟随界面语言且不可编辑 */
    nameKey: string;
    descriptionKey: string;
};

const GRADIENT_SEEDS: RoleSeed[] = [
    {
        id: "tiny",
        nameKey: "settings.panels.roles.roleTiny",
        descriptionKey: "settings.panels.roles.purposeTiny",
        suggestedModel: "GPT-5.1 mini",
        iconClass: "i-lucide-feather",
        builtIn: true,
    },
    {
        id: "fast",
        nameKey: "settings.panels.roles.roleFast",
        descriptionKey: "settings.panels.roles.purposeFast",
        suggestedModel: "GPT-5.1",
        iconClass: "i-lucide-zap",
        builtIn: true,
    },
    {
        id: "main",
        nameKey: "settings.panels.roles.roleMain",
        descriptionKey: "settings.panels.roles.purposeMain",
        suggestedModel: "Claude Sonnet 4.5",
        iconClass: "i-lucide-star",
        builtIn: true,
    },
    {
        id: "deep",
        nameKey: "settings.panels.roles.roleDeep",
        descriptionKey: "settings.panels.roles.purposeDeep",
        suggestedModel: "Claude Opus 4.1",
        iconClass: "i-lucide-brain",
        builtIn: true,
    },
];

const SPECIALIST_SEEDS: RoleSeed[] = [
    {
        id: "summarize",
        nameKey: "settings.panels.roles.roleSummarize",
        descriptionKey: "settings.panels.roles.purposeSummarize",
        suggestedModel: "GPT-5.1 mini",
        iconClass: "i-lucide-scroll-text",
        builtIn: true,
    },
    {
        id: "writer",
        nameKey: "settings.panels.roles.roleWriter",
        descriptionKey: "settings.panels.roles.purposeWriter",
        suggestedModel: "Claude Sonnet 4.5",
        iconClass: "i-lucide-pen-line",
        builtIn: true,
    },
    {
        id: "narrative",
        nameKey: "settings.panels.roles.roleNarrative",
        descriptionKey: "settings.panels.roles.purposeNarrative",
        suggestedModel: "Claude Sonnet 4.5",
        iconClass: "i-lucide-book-open",
        builtIn: true,
    },
    {
        id: "plan",
        nameKey: "settings.panels.roles.rolePlan",
        descriptionKey: "settings.panels.roles.purposePlan",
        suggestedModel: "Claude Sonnet 4.5",
        iconClass: "i-lucide-map",
        builtIn: true,
    },
    {
        id: "vision",
        nameKey: "settings.panels.roles.roleVision",
        descriptionKey: "settings.panels.roles.purposeVision",
        // 视觉必须显式绑定：主模型多半不支持原生视觉，回落只会把图喂给读不了图的模型。
        suggestedModel: "GPT-5.1",
        iconClass: "i-lucide-eye",
        builtIn: true,
    },
];

/** 用户自己加的角色：没有更具体的语义可猜，给一个中性图标。 */
const CUSTOM_ROLE_ICON = "i-lucide-shapes";

export type RoleTranslate = (key: string) => string;

/** 初始草稿：内置角色全部启用，名字与描述解析成当前界面语言。 */
export function createRolesSettingsDraft(translate: RoleTranslate): RolesSettingsDraft {
    const materialize = (seed: RoleSeed): ModelRoleDraft => ({
        id: seed.id,
        name: translate(seed.nameKey),
        description: translate(seed.descriptionKey),
        modelKey: null,
        suggestedModel: seed.suggestedModel,
        iconClass: seed.iconClass,
        builtIn: seed.builtIn,
        enabled: true,
    });
    return {
        gradient: GRADIENT_SEEDS.map(materialize),
        specialist: SPECIALIST_SEEDS.map(materialize),
    };
}

export function allRoles(draft: RolesSettingsDraft): ModelRoleDraft[] {
    return [...draft.gradient, ...draft.specialist];
}

export function findRole(draft: RolesSettingsDraft, id: string): ModelRoleDraft | null {
    return allRoles(draft).find((role) => role.id === id) ?? null;
}

/** 只有用户自己加的角色能改能删；内置角色由产品提供。 */
export function isEditableRole(role: ModelRoleDraft): boolean {
    return !role.builtIn;
}

/** 新角色用不冲突的稳定 id：名字可以被改，id 不会。 */
export function nextCustomRoleId(draft: RolesSettingsDraft): string {
    const used = new Set(allRoles(draft).map((role) => role.id));
    for (let index = 1; ; index += 1) {
        const candidate = `custom-${index}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
}

export function createSpecialistRole(draft: RolesSettingsDraft, translate: RoleTranslate): ModelRoleDraft {
    return {
        id: nextCustomRoleId(draft),
        name: translate("settings.panels.roles.newRole"),
        description: "",
        modelKey: null,
        suggestedModel: null,
        iconClass: CUSTOM_ROLE_ICON,
        builtIn: false,
        enabled: true,
    };
}

export function addSpecialistRole(draft: RolesSettingsDraft, translate: RoleTranslate): RolesSettingsDraft {
    return {...draft, specialist: [...draft.specialist, createSpecialistRole(draft, translate)]};
}

/** 只删用户自建的角色；内置角色返回原草稿（调用方据此判断是否真的删了）。 */
export function removeRole(draft: RolesSettingsDraft, id: string): RolesSettingsDraft {
    const target = findRole(draft, id);
    if (!target || target.builtIn) {
        return draft;
    }
    return {...draft, specialist: draft.specialist.filter((role) => role.id !== id)};
}

export type RoleConfigIssue = {
    /** 出问题的角色 */
    id: string;
    /** 人话的原因 */
    reason: "missing-model" | "missing-description";
};

/**
 * 配置错误：停用的角色不参与判断；启用的角色里，没绑模型或没写描述都要报出来
 * （没有回落可以顶替，描述缺失会让模型看到的目录没意义）。
 * 这是宿主该显示的校验结果，不是解析结果。
 */
export function roleConfigIssues(draft: RolesSettingsDraft): RoleConfigIssue[] {
    const issues: RoleConfigIssue[] = [];
    for (const role of allRoles(draft)) {
        if (!role.enabled) {
            continue;
        }
        if (!role.modelKey) {
            issues.push({id: role.id, reason: "missing-model"});
        }
        if (role.description.trim() === "") {
            issues.push({id: role.id, reason: "missing-description"});
        }
    }
    return issues;
}

/**
 * 模型看到的角色目录：只列**启用**的、配好模型且有描述的角色，键是角色 id。
 * 这份东西将来要送到提示词里，所以只带 id / 名字 / 描述 / 模型。
 */
export function buildModelRoleCatalog(draft: RolesSettingsDraft): Array<{id: string; name: string; description: string; modelKey: string}> {
    return allRoles(draft)
        .filter((role) => role.enabled && role.modelKey !== null && role.description.trim() !== "")
        .map((role) => ({
            id: role.id,
            name: role.name,
            description: role.description,
            modelKey: role.modelKey!,
        }));
}

export type RolesSectionPayload = {
    roles: Array<{
        id: string;
        axis: ModelRoleAxis;
        name: string;
        description: string;
        modelKey: string | null;
        enabled: boolean;
    }>;
};

/**
 * 写回体：全部角色连同轴与启用状态一起交出去（含未绑定的，宿主需要它来报配置错误）。
 * 正式接入时这份形状要对齐后端契约——今天它只用于 Lab 与将来的宿主映射。
 */
export function buildRolesSection(draft: RolesSettingsDraft): RolesSectionPayload {
    return {
        roles: allRoles(draft).map((role) => ({
            id: role.id,
            axis: draft.specialist.some((item) => item.id === role.id) ? "specialist" as const : "gradient" as const,
            name: role.name,
            description: role.description,
            modelKey: role.modelKey,
            enabled: role.enabled,
        })),
    };
}
