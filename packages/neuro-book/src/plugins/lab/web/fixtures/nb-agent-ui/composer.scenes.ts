import type {AgentConversationComposer} from "@notnotype/nb-agent-ui/lab";
import type {AgentContextInspector, AgentModelPicker, AgentRoleModelPicker} from "@notnotype/nb-agent-ui/lab";
import type {AgentQueuedMessages} from "@notnotype/nb-agent-ui/lab";
import type {AgentConversationContext, ComposerView} from "@notnotype/nb-agent-ui";
import {conversationContext} from "./data";
import type {LabFixtureDefinition} from "../index";

type Scene = LabFixtureDefinition<typeof AgentConversationComposer>["scenes"][number];

/** 输入框只读 composer、interaction、availability、run；消息清空，数据 tab 里短一些。 */
function composerCtx(composer: Partial<ComposerView> = {}, patch: Partial<AgentConversationContext> = {}): AgentConversationContext {
    const base = conversationContext({messages: [], ...patch});
    return {...base, composer: {...base.composer, ...composer}};
}

const DRAFT_INLINE = "先读 [第三章 雨夜](chapter://c3)，再用 $reviewer 检查人物关系。";

const DRAFT = "先读 [第三章 雨夜](chapter://c3)，再用 $reviewer 对照 ![image #1](session://attachments/人物关系草图.png) 检查人物关系。";

const QUEUED: ComposerView["queued"] = [
    {id: "q1", text: "保留雨夜那段对话，别删。", delivery: "steer"},
    {id: "q2", text: "改完第三章顺便检查第五章的错别字。\n第二段有个“的地得”。", delivery: "followup"},
];

const NO_FILES = {interaction: {...conversationContext().interaction, canRegisterAttachments: false}};

export const agentConversationComposerScenes: Scene[] = [
    {id: "idle", label: "空闲", input: {props: {ctx: composerCtx()}}},
    {id: "draft", label: "带草稿", input: {props: {ctx: composerCtx({draft: {text: DRAFT, version: 1}})}}},
    {id: "running", label: "运行中（停止按钮）", input: {props: {ctx: composerCtx({}, {run: {status: "running", phase: "正在思考"}})}}},
    {id: "queued", label: "运行中，有排队消息", input: {props: {ctx: composerCtx({queued: QUEUED, draft: {text: "再补一句：钟声要写十二下。", version: 1}}, {run: {status: "running", phase: "正在思考"}})}}},
    {id: "plan-mode", label: "规划模式", input: {props: {ctx: composerCtx({mode: "plan"})}}},
    {id: "no-images", label: "模型不支持图片", input: {props: {ctx: composerCtx({modelKey: "deepseek-chat"})}}},
    {id: "plain", label: "缺省实现（没有注入编辑器）", input: {props: {ctx: composerCtx({draft: {text: "/rename 雨夜", version: 1}})}}},
    // 单行版式没有附件条的位置：nb-story 这样不收附件的宿主才用它（收附件时退回两层）。
    {id: "inline", label: "单行版式", input: {props: {ctx: composerCtx({}, {...NO_FILES, usage: {...conversationContext().usage, contextTokens: 41_820, contextLimit: 200_000}}), layout: "inline"}}},
    {id: "inline-draft", label: "单行版式，正文多行", input: {props: {ctx: composerCtx({draft: {text: `${DRAFT_INLINE}\n第二行：再对照一下第五章。\n第三行。`, version: 1}}, {...NO_FILES, usage: {...conversationContext().usage, contextTokens: 150_000, contextLimit: 200_000}}), layout: "inline"}}},
    {id: "inline-full", label: "单行版式，上下文快满", input: {props: {ctx: composerCtx({draft: {text: "还剩多少？", version: 1}}, {...NO_FILES, usage: {...conversationContext().usage, contextTokens: 212_000, contextLimit: 200_000}}), layout: "inline"}}},
    {
        id: "readonly",
        label: "只读（不能发送）",
        input: {props: {ctx: composerCtx({draft: {text: DRAFT, version: 1}}, {interaction: {...conversationContext().interaction, canSend: false, canChangeRuntime: false}})}},
    },
];

type PickerScene = LabFixtureDefinition<typeof AgentModelPicker>["scenes"][number];

const MODELS = [
    {key: "deepseek-chat", label: "DeepSeek Chat", supportsImages: false},
    {key: "claude-sonnet", label: "Claude Sonnet", supportsImages: true},
    {key: "very-long", label: "一个名字特别长的自定义本地模型 Q4_K_M", supportsImages: false},
];

type RolePickerScene = LabFixtureDefinition<typeof AgentRoleModelPicker>["scenes"][number];

const PICKER_ROLES = [
    {key: "role:tiny", name: "极轻量", axis: "gradient" as const, modelLabel: "DeepSeek Flash"},
    {key: "role:fast", name: "快速", axis: "gradient" as const, modelLabel: "DeepSeek Flash"},
    {key: "role:main", name: "主力", axis: "gradient" as const, modelLabel: "DeepSeek V4"},
    {key: "role:deep", name: "深度", axis: "gradient" as const, modelLabel: null, unavailable: "这个角色还没有绑定模型"},
    {key: "role:compaction", name: "压缩", axis: "specialist" as const, modelLabel: "DeepSeek Flash"},
];
const PICKER_MODELS = [
    {key: "", label: "跟随默认", supportsImages: false},
    {key: "deepseek/v4", label: "DeepSeek V4", supportsImages: false, group: "DeepSeek", contextWindow: 1_000_000, reasoning: true, price: {input: 0.3, output: 1.2}},
    {key: "deepseek/flash", label: "DeepSeek Flash", supportsImages: false, group: "DeepSeek", contextWindow: 256_000, reasoning: false, price: {input: 0.05, output: 0.2}},
    {key: "openai/gpt", label: "GPT 6.1", supportsImages: true, group: "OpenAI", contextWindow: 400_000, reasoning: true, price: null},
    {key: "openai/broken", label: "没有密钥的模型", supportsImages: true, group: "OpenAI", unavailable: "这家服务商没有设密钥"},
];

export const agentRoleModelPickerScenes: RolePickerScene[] = [
    {id: "role", label: "选了角色", input: {props: {roles: PICKER_ROLES, models: PICKER_MODELS, modelKey: "role:main", effectiveModel: "DeepSeek V4", thinkingLevels: ["off", "low", "medium", "high"], thinking: "high", canManage: true}}},
    {id: "model", label: "选了模型，没有思考档", input: {props: {roles: PICKER_ROLES, models: PICKER_MODELS, modelKey: "deepseek/flash", effectiveModel: "DeepSeek Flash", thinkingLevels: [], thinking: null}}},
    {id: "unbound", label: "选的角色没绑定", input: {props: {roles: PICKER_ROLES, models: PICKER_MODELS, modelKey: "role:deep", effectiveModel: null, thinkingLevels: [], thinking: null, canManage: true}}},
];

type InspectorScene = LabFixtureDefinition<typeof AgentContextInspector>["scenes"][number];

const INSPECTOR_USAGE = {contextTokens: 16_300, contextLimit: 128_000, totalTokens: 516_400, input: 96_000, output: 12_000, cacheRead: 412_000, cacheWrite: 8_400, cacheHitRate: 0.81, lastCacheHitRate: 0.94, cost: 0.42, currency: "USD" as const};

export const agentContextInspectorScenes: InspectorScene[] = [
    {id: "ready", label: "有数据", input: {props: {usage: INSPECTOR_USAGE, systemPrompt: null, inspection: {
        state: "ready", estimated: 54_000, window: 128_000, threshold: 108_000,
        areas: [{key: "system", tokens: 4_200}, {key: "tools", tokens: 3_100}, {key: "opening", tokens: 2_600}, {key: "history", tokens: 41_800}, {key: "turn", tokens: 2_300}],
        slots: [{name: "rules", extension: "nbook.agent", tokens: 2_100, placed: true}, {name: "memory", extension: "lab.memory", tokens: 0, placed: false}],
        diagnostics: [{id: "d", level: "warning", message: "the slot of lab.memory failed"}],
    }}}},
    {id: "loading", label: "正在计算", input: {props: {usage: INSPECTOR_USAGE, systemPrompt: null, inspection: {state: "loading"}}}},
    {id: "unavailable", label: "算不出", input: {props: {usage: INSPECTOR_USAGE, systemPrompt: null, inspection: {state: "unavailable", reason: "现在算不出下一次请求：这个会话的模型用不了。"}}}},
];

export const agentModelPickerScenes: PickerScene[] = [
    {id: "default", label: "模型与思考档位", input: {props: {models: MODELS, modelKey: "claude-sonnet", thinkingLevels: ["off", "low", "medium", "high"], thinking: "low"}}},
    {id: "no-thinking", label: "没有思考档位", input: {props: {models: MODELS, modelKey: "deepseek-chat", thinkingLevels: [], thinking: null}}},
    {id: "long-name", label: "模型名过长", input: {props: {models: MODELS, modelKey: "very-long", thinkingLevels: ["off", "high", "turbo"], thinking: "turbo"}}},
    {id: "none", label: "未选择模型", input: {props: {models: [], modelKey: null, thinkingLevels: [], thinking: null}}},
    {id: "disabled", label: "禁用", input: {props: {models: MODELS, modelKey: "claude-sonnet", thinkingLevels: ["low"], thinking: "low", disabled: true}}},
    {
        id: "groups",
        label: "分组、用不了的模型与“管理模型…”",
        input: {
            props: {
                models: [
                    {key: "openrouter/anthropic/claude-sonnet-5", label: "Claude Sonnet 5", supportsImages: true, group: "OpenRouter"},
                    {key: "anthropic/claude-sonnet-5", label: "Claude Sonnet 5", supportsImages: true, group: "Anthropic", unavailable: "ANTHROPIC_API_KEY 没有值"},
                    {key: "deepseek/deepseek-flash", label: "DeepSeek Flash", supportsImages: false, group: "DeepSeek"},
                ],
                modelKey: "openrouter/anthropic/claude-sonnet-5", thinkingLevels: ["low", "medium", "high"], thinking: "medium", showImageSupport: false, canManage: true,
            },
        },
    },
];

type QueuedScene = LabFixtureDefinition<typeof AgentQueuedMessages>["scenes"][number];

export const agentQueuedMessagesScenes: QueuedScene[] = [
    {id: "two", label: "补充说明与排队", input: {props: {queued: QUEUED}}},
    {
        id: "many",
        label: "超过 3 条",
        input: {props: {queued: [...QUEUED, {id: "q3", text: "第三条。", delivery: "followup"}, {id: "q4", text: "第四条。", delivery: "followup"}, {id: "q5", text: "第五条。", delivery: "steer"}]}},
    },
];
