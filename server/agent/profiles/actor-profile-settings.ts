import {Type, type Static} from "typebox";
import {defineLowCodeForm} from "nbook/server/low-code-form";
import {
    profileFeatureFormFields,
    profileSettingsPresets,
    promptCustomizationDefaults,
    promptCustomizationFormFields,
    promptCustomizationSchemaFields,
} from "nbook/server/agent/profiles/prompt-customization";
import {profileText} from "nbook/server/agent/profiles/profile-text";

/** RP Actor 与 Simulator Actor 共用的角色扮演策略合同。 */
export const ActorProfileSettingsSchema = Type.Object({
    ...promptCustomizationSchemaFields,
    characterFidelity: Type.Optional(Type.Union([Type.Literal("strict"), Type.Literal("balanced")])),
    memoryReliance: Type.Optional(Type.Union([Type.Literal("strict"), Type.Literal("balanced")])),
    innerThoughtDepth: Type.Optional(Type.Union([Type.Literal("brief"), Type.Literal("balanced"), Type.Literal("deep")])),
    autonomousAction: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("balanced"), Type.Literal("high")])),
    informationBoundary: Type.Optional(Type.Union([Type.Literal("strict"), Type.Literal("contextual")])),
}, {additionalProperties: false});

export type ActorProfileSettings = Static<typeof ActorProfileSettingsSchema>;

/** 为各 Actor Profile 创建同源设置表单，防止角色扮演策略再次漂移。 */
export function actorProfileSettingsForm() {
    return defineLowCodeForm({
        schema: ActorProfileSettingsSchema,
        defaults: {
            ...promptCustomizationDefaults,
            characterFidelity: "strict",
            memoryReliance: "strict",
            innerThoughtDepth: "balanced",
            autonomousAction: "balanced",
            informationBoundary: "strict",
        },
        fields: [
            ...promptCustomizationFormFields(),
            ...profileFeatureFormFields([
                {path: "characterFidelity", component: "radio", label: "角色还原度", options: [
                    {value: "strict", label: "严格还原", description: "优先服从角色档案、心境与既有行为逻辑。"},
                    {value: "balanced", label: "自然发挥", description: "不违背核心人设的前提下允许更灵活的现场反应。"},
                ]},
                {path: "memoryReliance", component: "radio", label: "记忆依赖", options: [
                    {value: "strict", label: "严格依赖", description: "关键判断必须有当前材料或已召回记忆依据。"},
                    {value: "balanced", label: "合理联想", description: "允许基于已知经历进行保守联想，但不得补造事实。"},
                ]},
                {path: "innerThoughtDepth", component: "radio", label: "内心活动", options: [
                    {value: "brief", label: "克制"}, {value: "balanced", label: "适中"}, {value: "deep", label: "深入"},
                ]},
                {path: "autonomousAction", component: "radio", label: "自主行动", options: [
                    {value: "low", label: "谨慎"}, {value: "balanced", label: "自然"}, {value: "high", label: "积极"},
                ]},
                {path: "informationBoundary", component: "radio", label: "信息边界", options: [
                    {value: "strict", label: "严格角色视角", description: "角色只使用亲历、被告知或可合理感知的信息。"},
                    {value: "contextual", label: "情境推断", description: "允许从可见线索做符合角色能力的推断，但不得使用上帝视角。"},
                ]},
            ]),
        ],
        presets: profileSettingsPresets(),
    });
}

/** 将共享角色扮演策略逐项映射为动态 System Prompt。 */
export function renderActorProfileSettings(settings: ActorProfileSettings): string {
    return profileText`
        <roleplay_strategy>
        - 角色还原：${settings.characterFidelity === "strict" ? "严格服从 soul.md、当前心境/状态、关系与既有行为逻辑；不要为了戏剧效果改写人格" : "保持核心人格稳定，并允许符合人设的现场变化"}。
        - 记忆依据：${settings.memoryReliance === "strict" ? "关键反应必须来自当前材料或已召回记忆；缺失信息就表现为不知道" : "可基于已知经历做保守联想，但不得补造经历"}。
        - 内心活动：${settings.innerThoughtDepth === "brief" ? "只保留推动反应所需的短促念头" : settings.innerThoughtDepth === "deep" ? "深入呈现欲望、矛盾、判断链与未说出口的情绪" : "呈现足以解释反应的内心变化，避免过度剖白"}。
        - 自主行动：${settings.autonomousAction === "low" ? "以回应现场为主，不主动制造新行动线" : settings.autonomousAction === "high" ? "在角色动机允许时主动采取具体行动，但不越过裁决边界" : "自然回应并在动机明确时采取小幅主动行动"}。
        - 信息边界：${settings.informationBoundary === "strict" ? "只使用角色亲历、被告知或当场可感知的信息" : "可根据现场线索做符合角色能力的推断"}；始终禁止上帝视角。
        </roleplay_strategy>
    `;
}
