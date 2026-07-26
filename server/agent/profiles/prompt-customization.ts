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
 * 每个内置 profile 通过本模块获得统一的三件套：
 * 1. customTopSystemPrompt    —— 置顶注入（最高优先级自定义规则）
 * 2. customBottomSystemPrompt —— 末尾追加（补充规则 / 风格微调）
 * 3. personaPreset            —— 人设/策略段预设（profile home `prompts/` 目录下的
 *    Markdown 文件，`prompts/default.md` 为出厂默认，可编辑、可另存多套、可一键切回）
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

/** 三件套 Settings 字段（TypeBox 片段，合并进各 profile 的 SettingsSchema）。 */
export const promptCustomizationSchemaFields = {
    customTopSystemPrompt: Type.String(),
    customBottomSystemPrompt: Type.String(),
    personaPreset: Type.String(),
} as const;

/** 三件套 Settings 默认值（合并进各 profile 的 defaults）。 */
export const promptCustomizationDefaults = {
    customTopSystemPrompt: "",
    customBottomSystemPrompt: "",
    personaPreset: DEFAULT_PERSONA_PRESET,
} as const;

export type PromptCustomizationSettings = {
    readonly customTopSystemPrompt: string;
    readonly customBottomSystemPrompt: string;
    readonly personaPreset: string;
};

/**
 * 三件套低代码表单字段。放在各 profile 表单 fields 的最前面，
 * 让「提示词自定义」在每个 agent 设置页保持一致的位置与措辞。
 */
export function promptCustomizationFormFields(): LowCodeFieldDefinition[] {
    return [
        {
            path: "personaPreset",
            component: "resource-preset",
            label: "提示词人设预设",
            description: "该 agent 系统提示词的人设/策略段正文。可直接编辑、另存多套预设并切换；切回 default 即恢复出厂提示词。合约段（输出格式、工具协议）不在此处，无法被改坏。",
            placeholder: "选择人设预设",
            resource: profileHomeResource({
                directory: PERSONA_PRESET_DIRECTORY,
                extension: ".md",
                template: "在这里写入该 agent 的人设/策略提示词。",
            }),
        },
        {
            path: "customTopSystemPrompt",
            component: "textarea",
            label: "最高优先级置顶提示词",
            description: "插入在系统提示词最前面，优先级最高；人设预设与其他设置都排在它后面。",
            placeholder: "写入需要长期置顶的指令，例如整体尺度、长期禁写内容。",
            rows: 6,
        },
        {
            path: "customBottomSystemPrompt",
            component: "textarea",
            label: "末尾追加提示词",
            description: "追加在系统提示词末尾的补充规则，适合风格微调与临时性约束。",
            placeholder: "写入补充规则或风格微调要求。",
            rows: 4,
        },
    ];
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
    preset: string,
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
        async validate(value, ctx) {
            const issue = await validatePersonaPreset(value.personaPreset, ctx.home);
            return issue ? [issue] : [];
        },
    });
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

/** 置顶注入段。为空返回空串（不注入任何标签）。 */
export function renderCustomTopPrompt(settings: {customTopSystemPrompt?: string}): string {
    const text = (settings.customTopSystemPrompt ?? "").trim();
    if (!text) {
        return "";
    }
    return `<custom_top_system_prompt>\n${text}\n</custom_top_system_prompt>`;
}

/** 末尾追加段。为空返回空串（不注入任何标签）。 */
export function renderCustomBottomPrompt(settings: {customBottomSystemPrompt?: string}): string {
    const text = (settings.customBottomSystemPrompt ?? "").trim();
    if (!text) {
        return "";
    }
    return `<custom_bottom_system_prompt>\n${text}\n</custom_bottom_system_prompt>`;
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
