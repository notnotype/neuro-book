import fs from "node:fs/promises";
import path from "node:path";
import {Type} from "typebox";
import {assetResolver} from "nbook/server/assets/asset-resolver";
import {parseFrontmatterDocument} from "nbook/server/utils/frontmatter-document";
import {z} from "zod";
import type {LowCodeFieldDefinition} from "nbook/server/low-code-form";
import {defineLowCodeForm, profileHomeResource} from "nbook/server/low-code-form";
import type {ProfileHomeFacade, ProfileHomeDefinition} from "nbook/server/agent/profiles/profile-home";
import {defineProfileHome} from "nbook/server/agent/profiles/profile-home";

/**
 * Agent 提示词自定义共享层。
 *
 * 每个内置 profile 通过本模块获得统一的提示词设置：
 * 1. promptEntries —— 可增删、启停和排序的开放提示词条目
 * 2. personaPreset —— 人设/策略段预设（profile home `prompts/` 目录下的
 *    Markdown 文件，`prompts/default.md` 为出厂默认，可编辑、可另存多套、可一键切回）
 * 3. profilePresets / activeProfilePresetId —— 整套 Profile 特色设置快照
 *
 * 合约段（输出 Schema、工具协议、结构化交接格式）始终留在 profile TSX 内，
 * 任何自定义途径都无法触碰——预设只能填充人设槽位，结构上保证改不坏合约。
 */

/** 出厂默认人设预设的 profile home key。 */
export const DEFAULT_PERSONA_PRESET = "prompts/default.md";

/** 人设预设所在的 profile home 目录。 */
export const PERSONA_PRESET_DIRECTORY = "prompts";

const PersonaFrontmatterSchema = z.object({
    title: z.string().min(1).optional(),
}).passthrough();

const PromptEntrySchema = Type.Object({
    id: Type.String({minLength: 1}),
    title: Type.String(),
    enabled: Type.Boolean(),
    content: Type.String(),
    position: Type.Optional(Type.Union([Type.Literal("before"), Type.Literal("after")])),
}, {additionalProperties: false});

const ProfilePresetSchema = Type.Object({
    id: Type.String({minLength: 1}),
    name: Type.String({minLength: 1}),
    settingsJson: Type.String(),
    updatedAt: Type.String(),
}, {additionalProperties: false});

/** 通用提示词与整套设置预设字段（TypeBox 片段，合并进各 profile 的 SettingsSchema）。 */
export const promptCustomizationSchemaFields = {
    promptEntries: Type.Optional(Type.Array(PromptEntrySchema)),
    personaPreset: Type.Optional(Type.String()),
    profilePresets: Type.Optional(Type.Array(ProfilePresetSchema)),
    activeProfilePresetId: Type.Optional(Type.String()),
} as const;

/** 通用提示词与预设默认值（合并进各 profile 的 defaults）。 */
export const promptCustomizationDefaults = {
    promptEntries: [] as Array<{id: string; title: string; enabled: boolean; content: string; position?: PromptEntryPosition}>,
    personaPreset: DEFAULT_PERSONA_PRESET,
    profilePresets: [] as Array<{id: string; name: string; settingsJson: string; updatedAt: string}>,
    activeProfilePresetId: "",
};

export type PromptCustomizationSettings = {
    readonly promptEntries?: ReadonlyArray<{
        readonly id: string;
        readonly title: string;
        readonly enabled: boolean;
        readonly content: string;
        /** 缺省按 before 处理，保证已有条目继续位于固定结构之前。 */
        readonly position?: PromptEntryPosition;
    }>;
    readonly personaPreset?: string;
    readonly profilePresets?: ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly settingsJson: string;
        readonly updatedAt: string;
    }>;
    readonly activeProfilePresetId?: string;
};

/** 自定义提示词相对 Profile 固定结构的位置。 */
export type PromptEntryPosition = "before" | "after";

/** Profile 设置页中提示词系统的固定展示分区。 */
export const PROMPT_SETTINGS_SECTION = {
    key: "prompt-system",
    label: "提示词系统",
    description: "管理人设预设、自定义提示词位置与整套 Profile 预设。",
} as const;

/** Profile 职责相关参数的固定展示分区。 */
export const PROFILE_FEATURE_SETTINGS_SECTION = {
    key: "profile-features",
    label: "特色设置",
    description: "这些参数由当前 Profile 的真实 prepare 逻辑消费，并从下一次调用开始生效。",
} as const;

/**
 * 通用提示词低代码表单字段。放在各 profile 表单 fields 的最前面，
 * 让「提示词自定义」在每个 agent 设置页保持一致的位置与措辞。
 */
export function promptCustomizationFormFields(): LowCodeFieldDefinition[] {
    return [
        {
            path: "personaPreset",
            component: "resource-preset",
            label: "提示词人设预设",
            section: PROMPT_SETTINGS_SECTION,
            description: "该 agent 系统提示词的人设/策略段正文。可直接编辑、另存多套预设并切换；切回 default 即恢复出厂提示词。合约段（输出格式、工具协议）不在此处，无法被改坏。",
            placeholder: "选择人设预设",
            resource: profileHomeResource({
                directory: PERSONA_PRESET_DIRECTORY,
                extension: ".md",
                template: "在这里写入该 agent 的人设/策略提示词。",
            }),
        },
        {
            path: "promptEntries",
            component: "prompt-list",
            label: "提示词条目",
            section: PROMPT_SETTINGS_SECTION,
            description: "按列表顺序注入开放的 System Prompt 槽位；可新增、删除、启停和调整顺序。",
        },
    ];
}

/** 为 Profile 自有字段统一标记“特色设置”分区，避免与提示词系统混在一起。 */
export function profileFeatureFormFields(fields: readonly LowCodeFieldDefinition[]): LowCodeFieldDefinition[] {
    return fields.map((field) => ({...field, section: PROFILE_FEATURE_SETTINGS_SECTION}));
}

/**
 * 读取 profile 出厂默认人设文本（系统资产,user 覆盖优先）。
 *
 * 约定路径：agent/profiles/builtin/<profileKey>.home/prompts/default.md
 */
export async function loadDefaultPersona(profileKey: string): Promise<string | null> {
    const relative = path.join("agent", "profiles", "builtin", `${profileKey}.home`, "prompts", "default.md");
    const candidates = [
        path.join(assetResolver.userRoot, relative),
        path.join(assetResolver.systemRoot, relative),
    ];
    for (const candidate of candidates) {
        try {
            const raw = await fs.readFile(candidate, "utf-8");
            return stripPersonaFrontmatter(raw);
        } catch (error) {
            if (isMissingPathError(error)) {
                continue;
            }
            throw error;
        }
    }
    return null;
}

/**
 * 初始化/升级 profile home 的人设预设目录：写入出厂 default.md（已存在则保留用户版本）。
 */
export async function initializePersonaHome(home: ProfileHomeFacade, profileKey: string, options: {fallback?: string} = {}): Promise<void> {
    const persona = await loadDefaultPersona(profileKey) ?? options.fallback;
    if (persona === undefined) {
        return;
    }
    await home.writeText(DEFAULT_PERSONA_PRESET, renderPersonaResource("默认（出厂）", persona), {mode: "create"});
}

/**
 * 解析当前生效的人设文本。
 *
 * 回退链：settings 选中的预设 → home 中的 default.md → 系统资产出厂文本 → fallback。
 * 任一环读取失败都继续向后回退，保证 agent 永远拿得到人设段。
 */
export async function buildPersonaPrompt(input: {
    profileKey: string;
    preset?: string;
    home?: ProfileHomeFacade;
    fallback?: string;
}): Promise<string> {
    const preset = normalizePersonaPresetKey(input.preset);
    if (input.home) {
        const keys = preset === DEFAULT_PERSONA_PRESET ? [preset] : [preset, DEFAULT_PERSONA_PRESET];
        for (const key of keys) {
            try {
                return stripPersonaFrontmatter(await input.home.readText(key));
            } catch {
                continue;
            }
        }
    }
    const factory = await loadDefaultPersona(input.profileKey).catch(() => null);
    if (factory !== null) {
        return factory;
    }
    if (input.fallback !== undefined) {
        return input.fallback;
    }
    throw new Error(`profile ${input.profileKey} 缺少人设预设：${preset}，且没有出厂默认可回退。`);
}

/** 校验 settings 中选中的人设预设是否存在（供各 profile 表单 validate 复用）。 */
export async function validatePersonaPreset(
    preset: string | undefined,
    home: ProfileHomeFacade | undefined,
): Promise<{path: string; severity: "error"; message: string} | null> {
    const key = normalizePersonaPresetKey(preset);
    if (home && !await home.exists(key)) {
        return {path: "personaPreset", severity: "error", message: "选择的人设预设不存在。"};
    }
    return null;
}

/**
 * 只需要三件套的 profile 直接使用的标准设置表单。
 * 已有其他设置项的 profile 改为 spread schema/defaults/fields 片段自行合并。
 */
export function promptCustomizationSettingsForm() {
    return defineLowCodeForm({
        schema: Type.Object({...promptCustomizationSchemaFields}, {additionalProperties: false}),
        defaults: {...promptCustomizationDefaults},
        fields: promptCustomizationFormFields(),
        presets: profileSettingsPresets(),
        async validate(value, ctx) {
            const issue = await validatePersonaPreset(value.personaPreset, ctx.home);
            return issue ? [issue] : [];
        },
    });
}

/** 整套 Profile 设置预设的通用低代码元数据。 */
export function profileSettingsPresets() {
    return {
        storagePath: "profilePresets",
        activePath: "activeProfilePresetId",
        excludedPaths: [] as string[],
    };
}

/** 只需要人设预设的 profile 直接使用的标准 home 生命周期定义。 */
export function personaHomeDefinition(profileKey: string): ProfileHomeDefinition {
    return defineProfileHome({
        async init(ctx) {
            await initializePersonaHome(ctx.home, profileKey);
        },
        async upgrade(ctx) {
            await initializePersonaHome(ctx.home, profileKey);
        },
        async reset(ctx) {
            await ctx.home.clear();
            await initializePersonaHome(ctx.home, profileKey);
        },
    });
}

/** 按指定开放槽位和当前设置顺序渲染启用且非空的提示词条目。 */
export function renderPromptEntries(
    settings: {promptEntries?: PromptCustomizationSettings["promptEntries"]},
    position: PromptEntryPosition = "before",
): string {
    return (settings.promptEntries ?? [])
        .filter((entry) => (entry.position ?? "before") === position && entry.enabled && entry.content.trim())
        .map((entry, index) => {
            const title = entry.title.trim().replaceAll('"', "&quot;") || `提示词 ${index + 1}`;
            return `<custom_prompt_item title="${title}" position="${position}">\n${entry.content.trim()}\n</custom_prompt_item>`;
        })
        .join("\n\n");
}

/** 序列化人设预设文件（带 title frontmatter,供预设列表展示名称）。 */
export function renderPersonaResource(title: string, content: string): string {
    return [
        "---",
        `title: "${title.replaceAll("\"", "\\\"")}"`,
        "---",
        "",
        content.trim(),
        "",
    ].join("\n");
}

function normalizePersonaPresetKey(preset: string | undefined): string {
    const trimmed = (preset ?? "").trim();
    if (!trimmed) {
        return DEFAULT_PERSONA_PRESET;
    }
    return trimmed.includes("/") ? trimmed : `${PERSONA_PRESET_DIRECTORY}/${trimmed}`;
}

function stripPersonaFrontmatter(raw: string): string {
    const parsed = parseFrontmatterDocument(raw, PersonaFrontmatterSchema);
    return parsed.body.trim();
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && error.code === "ENOENT";
}
