import {Type, type Static} from "typebox";
import {
    DEFAULT_WRITING_REFERENCE_PRESET,
    legacyReferenceKeyToHomeKey,
    loadWritingReferencePresets,
    normalizeReferenceHomeKey,
} from "nbook/server/agent/profiles/writer-writing-reference";
import {
    DEFAULT_WRITING_STYLE_PRESET,
    legacyStyleKeyToHomeKey,
    loadWritingStylePresets,
    normalizeStyleHomeKey,
} from "nbook/server/agent/profiles/writer-writing-style";
import {
    initializePersonaHome,
    profileFeatureFormFields,
    profileSettingsPresets,
    promptCustomizationDefaults,
    promptCustomizationFormFields,
    promptCustomizationSchemaFields,
    validatePersonaPreset,
} from "nbook/server/agent/profiles/prompt-customization";
import {defineProfileHome, type ProfileHomeDefinition, type ProfileHomeFacade} from "nbook/server/agent/profiles/profile-home";
import {defineLowCodeForm, profileHomeResource} from "nbook/server/low-code-form";

const DEFAULT_PARAGRAPH_RHYTHM = "段落节奏偏短段分行，接近网络小说排版：一句话、一个动作节拍或一个情绪转折可以单独成段；不要为了凑短段打碎完整语义，场景描写、复杂动作和连续心理变化可以保留为较短自然段。";
const DEFAULT_WORD_COUNT_CONTROL = "2000-2600 字";
const DEFAULT_POLISHING_WORKFLOW = "润色时使用 .nbook/agent/skills/stop-slop/SKILL.md 作为自查流程，并优先在原文基础上做最小必要修改。不要输出 <refine> JSON，不把润色分析混进正文。";

/** 普通 Writer 与 RP Writer 共用的长期设置合同。 */
export const WriterProfileSettingsSchema = Type.Object({
    ...promptCustomizationSchemaFields,
    writingStylePreset: Type.String(),
    writingReferencePreset: Type.String(),
    narrativePerson: Type.Union([
        Type.Literal("first"),
        Type.Literal("second"),
        Type.Literal("third"),
    ]),
    paragraphRhythm: Type.String(),
    wordCountControl: Type.String(),
    polishingWorkflow: Type.String(),
    adultStylePrompt: Type.String(),
    fileChangeAwareness: Type.Union([
        Type.Literal("off"),
        Type.Literal("minimal"),
        Type.Literal("full"),
    ]),
}, {additionalProperties: false});

export type WriterProfileSettings = Static<typeof WriterProfileSettingsSchema>;

/** 为每个 Writer 职责 Profile 创建独立表单实例，字段和校验保持同源。 */
export function writerProfileSettingsForm(defaultOverrides: Partial<WriterProfileSettings> = {}) {
    return defineLowCodeForm({
        schema: WriterProfileSettingsSchema,
        defaults: {
            ...promptCustomizationDefaults,
            writingStylePreset: DEFAULT_WRITING_STYLE_PRESET,
            writingReferencePreset: DEFAULT_WRITING_REFERENCE_PRESET,
            narrativePerson: "third",
            paragraphRhythm: DEFAULT_PARAGRAPH_RHYTHM,
            wordCountControl: DEFAULT_WORD_COUNT_CONTROL,
            polishingWorkflow: DEFAULT_POLISHING_WORKFLOW,
            adultStylePrompt: "",
            fileChangeAwareness: "minimal",
            ...defaultOverrides,
        },
        fields: [
            ...promptCustomizationFormFields(),
            ...profileFeatureFormFields([
                {
                    path: "writingStylePreset",
                    component: "resource-preset",
                    label: "文风要求",
                    description: "条文式的文风规则（用词、句式、禁用项），作为写作约束注入。",
                    placeholder: "选择默认文风要求",
                    resource: profileHomeResource({
                        directory: "styles",
                        extension: ".md",
                        template: "在这里写入文风要求。",
                    }),
                },
                {
                    path: "writingReferencePreset",
                    component: "resource-preset",
                    label: "文风参考",
                    description: "供模仿语感的正文样本，与文风要求互补：一个给规则，一个给示例。",
                    placeholder: "选择默认参考样本",
                    resource: profileHomeResource({
                        directory: "references",
                        extension: ".md",
                        template: "在这里写入文风参考样本。",
                    }),
                },
                {
                    path: "narrativePerson",
                    component: "radio",
                    label: "默认人称",
                    description: "正文默认叙事人称；本轮 Writer Brief 另有要求时以 Brief 为准。",
                    options: [
                        {value: "third", label: "第三人称"},
                        {value: "first", label: "第一人称"},
                        {value: "second", label: "第二人称"},
                    ],
                },
                {
                    path: "paragraphRhythm",
                    component: "textarea",
                    label: "段落节奏",
                    description: "默认段落与分行节奏偏好；本轮 Writer Brief 另有要求时以 Brief 为准。",
                    rows: 4,
                    placeholder: "描述你偏好的长段、短段或分行节奏。",
                },
                {
                    path: "wordCountControl",
                    component: "text",
                    label: "默认字数",
                    description: "单次正文的默认字数范围；材料不足时 Writer 不会硬凑字数。",
                    placeholder: "例如：2000-2600 字",
                },
                {
                    path: "polishingWorkflow",
                    component: "text",
                    label: "润色工作流",
                    description: "写完正文后的自查与润色流程。",
                    placeholder: "描述写完后如何复查和润色。",
                },
                {
                    path: "adultStylePrompt",
                    component: "text",
                    label: "成人风格增强",
                    description: "填写后作为成人场景写作约束注入；留空则完全不注入。",
                    placeholder: "例如：注重情绪推进与关系变化，避免机械描写。",
                },
                {
                    path: "fileChangeAwareness",
                    component: "radio",
                    label: "文件变更感知",
                    description: "每轮开始前提醒 Writer：上次看过之后，项目文件被其他人改过哪些。",
                    options: [
                        {value: "minimal", label: "精简", description: "只列变更文件路径和条数。"},
                        {value: "full", label: "完整", description: "含归因与操作类型，并提示写作前重读相关文件。"},
                        {value: "off", label: "关闭", description: "不注入文件变更提醒。"},
                    ],
                },
            ]),
        ],
        presets: profileSettingsPresets(),
        async validate(value, ctx) {
            const [styles, references] = await Promise.all([
                loadWritingStylePresets(),
                loadWritingReferencePresets(),
            ]);
            const issues: Array<{path: string; severity: "error"; message: string}> = [];
            const styleExists = ctx.home
                ? await ctx.home.exists(normalizeStyleHomeKey(value.writingStylePreset))
                : styles.some((style) => style.key === value.writingStylePreset || legacyStyleKeyToHomeKey(style.key) === value.writingStylePreset);
            const referenceExists = ctx.home
                ? await ctx.home.exists(normalizeReferenceHomeKey(value.writingReferencePreset))
                : references.some((reference) => reference.key === value.writingReferencePreset || legacyReferenceKeyToHomeKey(reference.key) === value.writingReferencePreset);
            if (!styleExists) issues.push({path: "writingStylePreset", severity: "error", message: "选择的文风要求不存在。"});
            if (!referenceExists) issues.push({path: "writingReferencePreset", severity: "error", message: "选择的文风参考不存在。"});
            const personaIssue = await validatePersonaPreset(value.personaPreset, ctx.home);
            if (personaIssue) issues.push(personaIssue);
            return issues;
        },
    });
}

/** Writer Profile Home 同时初始化人设、文风要求和文风参考资源。 */
export function writerProfileHomeDefinition(profileKey: string): ProfileHomeDefinition {
    return defineProfileHome({
        async init(ctx) {
            await initializeWriterProfileHome(ctx.home, profileKey);
        },
        async upgrade(ctx) {
            await initializeWriterProfileHome(ctx.home, profileKey);
        },
        async reset(ctx) {
            await ctx.home.clear();
            await initializeWriterProfileHome(ctx.home, profileKey);
        },
    });
}

/** 把设置中的叙事人称枚举映射为提示词文本。 */
export function writerNarrativePersonText(value: WriterProfileSettings["narrativePerson"]): string {
    switch (value) {
        case "first": return "第一人称";
        case "second": return "第二人称";
        case "third": return "第三人称";
    }
}

async function initializeWriterProfileHome(home: ProfileHomeFacade, profileKey: string): Promise<void> {
    const [styles, references] = await Promise.all([
        loadWritingStylePresets(),
        loadWritingReferencePresets(),
    ]);
    for (const style of styles) {
        await home.writeText(legacyStyleKeyToHomeKey(style.key), renderStyleResource(style), {mode: "create"});
    }
    for (const reference of references) {
        await home.writeText(legacyReferenceKeyToHomeKey(reference.key), renderReferenceResource(reference), {mode: "create"});
    }
    await initializePersonaHome(home, profileKey);
}

function renderStyleResource(style: Awaited<ReturnType<typeof loadWritingStylePresets>>[number]): string {
    return [
        "---",
        `key: "${style.key}"`,
        `title: "${style.label.replaceAll("\"", "\\\"")}"`,
        `label: "${style.label.replaceAll("\"", "\\\"")}"`,
        `sourcePreset: "${style.sourcePreset.replaceAll("\"", "\\\"")}"`,
        `identifier: "${style.identifier.replaceAll("\"", "\\\"")}"`,
        `name: "${style.name.replaceAll("\"", "\\\"")}"`,
        `enabled: ${style.enabled === null ? "null" : style.enabled}`,
        `role: ${style.role === null ? "null" : `"${style.role.replaceAll("\"", "\\\"")}"`}`,
        "---",
        "",
        style.content,
    ].join("\n");
}

function renderReferenceResource(reference: Awaited<ReturnType<typeof loadWritingReferencePresets>>[number]): string {
    return [
        "---",
        `key: "${reference.key}"`,
        `title: "${reference.label.replaceAll("\"", "\\\"")}"`,
        `label: "${reference.label.replaceAll("\"", "\\\"")}"`,
        `sourceTitle: "${reference.sourceTitle.replaceAll("\"", "\\\"")}"`,
        `sourceChapters: "${reference.sourceChapters.replaceAll("\"", "\\\"")}"`,
        `generatedFrom: "${reference.generatedFrom.replaceAll("\"", "\\\"")}"`,
        "---",
        "",
        reference.content,
    ].join("\n");
}
