import type {LabFixtureDefinition} from "./index";
import type ModelPickerContent from "../../components/novel-ide/model-picker/ModelPickerContent.vue";
import type ModelPickerPopover from "../../components/novel-ide/model-picker/ModelPickerPopover.vue";
import type {ModelPickerModelItem, ModelPickerRoleItem} from "../../components/novel-ide/model-picker/model-picker.types";

export const MODEL_PICKER_ROLES: ModelPickerRoleItem[] = [
    {id: "tiny", axis: "gradient", name: "极轻量", description: "会话标题、简单打标、轻量检索", modelKey: "deepseek/deepseek-chat", modelLabel: "DeepSeek V3", iconClass: "i-lucide-feather", enabled: true},
    {id: "fast", axis: "gradient", name: "快速", description: "日常问答、快速搜索、简单改写", modelKey: "openai/gpt-4o-mini", modelLabel: "GPT-4o mini", iconClass: "i-lucide-zap", enabled: true},
    {id: "main", axis: "gradient", name: "主力", description: "主会话、综合分析、长篇写作", modelKey: "anthropic/claude-3-7-sonnet", modelLabel: "Claude 3.7 Sonnet (Hybrid)", iconClass: "i-lucide-star", enabled: true},
    {id: "deep", axis: "gradient", name: "深度", description: "复杂规划、难点分析、深度推理", modelKey: "deepseek/deepseek-reasoner", modelLabel: "DeepSeek R1 (Reasoning)", iconClass: "i-lucide-brain", enabled: true},
    {id: "writer", axis: "specialist", name: "写作", description: "小说正文与段落润色", modelKey: "anthropic/claude-3-7-sonnet", modelLabel: "Claude 3.7 Sonnet", iconClass: "i-lucide-pen-line", enabled: true},
    {id: "narrative", axis: "specialist", name: "叙事", description: "剧情设计与伏笔规划", modelKey: "anthropic/claude-3-7-sonnet", modelLabel: "Claude 3.7 Sonnet", iconClass: "i-lucide-book-open", enabled: true},
    {id: "plan", axis: "specialist", name: "计划", description: "进入计划模式后自动切换", modelKey: "openai/gpt-4o", modelLabel: "GPT-4o Omnimodal", iconClass: "i-lucide-map", enabled: true},
    {id: "vision", axis: "specialist", name: "视觉", description: "图像与多模态插画理解", modelKey: "openai/gpt-4o", modelLabel: "GPT-4o Omnimodal", iconClass: "i-lucide-eye", enabled: true},
];

export const MODEL_PICKER_MODELS: ModelPickerModelItem[] = [
    {key: "anthropic/claude-3-7-sonnet", label: "Claude 3.7 Sonnet (Hybrid)", providerId: "anthropic", providerName: "Anthropic", modelId: "claude-3-7-sonnet", input: ["text", "image"], contextWindowTokens: 200000, pricing: "$3.00 / $15.00", reasoning: true},
    {key: "anthropic/claude-3-5-haiku", label: "Claude 3.5 Haiku", providerId: "anthropic", providerName: "Anthropic", modelId: "claude-3-5-haiku", input: ["text"], contextWindowTokens: 200000, pricing: "$0.80 / $4.00"},
    {key: "openai/gpt-4o", label: "GPT-4o Omnimodal", providerId: "openai", providerName: "OpenAI", modelId: "gpt-4o", input: ["text", "image"], contextWindowTokens: 128000, pricing: "$2.50 / $10.00"},
    {key: "openai/gpt-4o-mini", label: "GPT-4o mini", providerId: "openai", modelId: "gpt-4o-mini", input: ["text", "image"], contextWindowTokens: 128000, pricing: "$0.15 / $0.60"},
    {key: "deepseek/deepseek-chat", label: "DeepSeek V3", providerId: "deepseek", providerName: "DeepSeek", modelId: "deepseek-chat", input: ["text"], contextWindowTokens: 64000, pricing: "$0.14 / $0.28"},
    {key: "deepseek/deepseek-reasoner", label: "DeepSeek R1 (Reasoning)", providerId: "deepseek", modelId: "deepseek-reasoner", input: ["text"], contextWindowTokens: 64000, pricing: "$0.55 / $2.19", reasoning: true},
];


const contentProps = {roles: MODEL_PICKER_ROLES, models: MODEL_PICKER_MODELS, showSpecialistInPicker: true, standalone: true, widthClass: "w-full"};
const popoverProps = {roles: MODEL_PICKER_ROLES, models: MODEL_PICKER_MODELS, showSpecialistInPicker: true, direction: "down" as const, align: "center" as const, triggerClass: "w-[280px]", pickerWidthClass: "w-[620px] max-w-[calc(100vw-32px)]"};

export const modelPickerContentScenes = [
    {id: "content-only", label: "直接嵌入面板", input: {props: contentProps, model: {modelValue: "role:main", thinkingLevel: "medium"}}},
    {id: "specialist-enabled", label: "全部角色与模型", input: {props: contentProps, model: {modelValue: "role:writer", thinkingLevel: "high"}}},
    {id: "gradient-only", label: "仅梯度角色", input: {props: {...contentProps, showSpecialistInPicker: false}, model: {modelValue: "role:fast", thinkingLevel: "off"}}},
] satisfies LabFixtureDefinition<typeof ModelPickerContent>["scenes"];

export const modelPickerPopoverScenes = [
    {id: "default", label: "默认弹出态", input: {props: popoverProps, model: {open: true, modelValue: "role:main", thinkingLevel: null}}},
    {id: "specialist-enabled", label: "含专精轴角色", input: {props: popoverProps, model: {open: true, modelValue: "role:plan", thinkingLevel: "high"}}},
    {id: "gradient-only", label: "仅梯度角色", input: {props: {...popoverProps, showSpecialistInPicker: false}, model: {open: true, modelValue: "role:tiny", thinkingLevel: "minimal"}}},
] satisfies LabFixtureDefinition<typeof ModelPickerPopover>["scenes"];
