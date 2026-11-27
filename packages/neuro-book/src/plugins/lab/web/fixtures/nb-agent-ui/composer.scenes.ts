import type {AgentConversationComposer} from "@notnotype/nb-agent-ui/lab";
import type {AgentContextInspector, AgentMessageEditor, AgentModelPicker, AgentRoleModelPicker, AgentSessionTree} from "@notnotype/nb-agent-ui/lab";
import type {AgentQueuedMessages} from "@notnotype/nb-agent-ui/lab";
import type {AgentConversationContext, ComposerView} from "@notnotype/nb-agent-ui";
import {conversationContext} from "./data";
import type {LabFixtureDefinition} from "../define";

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

/** 留着的话：停止后留下的两条，加一条宿主（日程）排的、空闲时排的（docs/specs/agent/conversation.md 输出 48 的原因文案）。 */
const HELD: ComposerView["queued"] = [
    {id: "h1", text: "保留雨夜那段对话，别删。", delivery: "steer", held: {reason: "你停止了这一轮"}},
    {id: "h2", text: "改完第三章顺便检查第五章的错别字。", delivery: "followup", held: {reason: "你停止了这一轮"}},
    {id: "h3", text: "每天早上整理昨天的修改记录。", delivery: "followup", author: {label: "日程", icon: "i-lucide-calendar-clock"}, editable: false, held: {reason: "空闲时排的"}},
];

const NO_FILES = {interaction: {...conversationContext().interaction, canRegisterAttachments: false}};

export const agentConversationComposerScenes: Scene[] = [
    {id: "idle", label: "空闲", input: {props: {ctx: composerCtx()}}},
    {id: "draft", label: "带草稿", input: {props: {ctx: composerCtx({draft: {text: DRAFT, version: 1}})}}},
    {id: "running", label: "运行中（停止按钮）", input: {props: {ctx: composerCtx({}, {run: {status: "running", phase: "正在思考"}})}}},
    {id: "queued", label: "运行中，有排队消息", input: {props: {ctx: composerCtx({queued: QUEUED, draft: {text: "再补一句：钟声要写十二下。", version: 1}}, {run: {status: "running", phase: "正在思考"}})}}},
    {id: "held", label: "空闲，有留着的话（发送键是继续）", input: {props: {ctx: composerCtx({queued: HELD})}}},
    {id: "held-resume", label: "中断且有留着的话", input: {props: {ctx: composerCtx({queued: HELD.slice(0, 2), resume: true})}}},
    {
        id: "stop-menu",
        label: "运行中，停止旁有“停止并清空排队”",
        input: {props: {ctx: composerCtx({queued: QUEUED}, {run: {status: "running", phase: "正在思考"}, interaction: {...conversationContext().interaction, canStop: true, stopClearing: {count: 2}}})}},
    },
    {
        id: "stopping",
        label: "停止中（继续与下拉不可用）",
        input: {props: {ctx: composerCtx({queued: HELD}, {run: {status: "stopping", phase: ""}, interaction: {...conversationContext().interaction, canStop: true, stopClearing: {count: 3}}})}},
    },
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

const icon = (key: string, fallback: string) => ({kind: "key" as const, set: "provider" as const, key, fallback});
const roleIcon = (name: string) => ({kind: "class" as const, name});
const PICKER_ROLES = [
    {key: "role:tiny", name: "极轻量", axis: "gradient" as const, modelLabel: "DeepSeek Flash", icon: roleIcon("i-lucide-feather"), modelIcon: icon("deepseek", "DeepSeek")},
    {key: "role:fast", name: "快速", axis: "gradient" as const, modelLabel: "DeepSeek Flash", icon: roleIcon("i-lucide-zap"), modelIcon: icon("deepseek", "DeepSeek"), effort: "low"},
    {key: "role:main", name: "主力", axis: "gradient" as const, modelLabel: "DeepSeek V4", icon: roleIcon("i-lucide-star"), modelIcon: icon("deepseek", "DeepSeek"), effort: "high"},
    {key: "role:deep", name: "深度", axis: "gradient" as const, modelLabel: null, unavailable: "这个角色还没有绑定模型", icon: roleIcon("i-lucide-telescope")},
    {key: "role:compaction", name: "压缩", axis: "specialist" as const, modelLabel: "DeepSeek Flash", icon: roleIcon("i-lucide-fold-vertical"), modelIcon: icon("deepseek", "DeepSeek")},
    {key: "role:lore", name: "设定考据", axis: "specialist" as const, modelLabel: "GPT 6.1", icon: roleIcon("i-lucide-library"), modelIcon: icon("openai", "OpenAI"), effort: "medium"},
];
const PICKER_GROUPS = [
    {id: "deepseek", name: "DeepSeek", icon: icon("deepseek", "DeepSeek")},
    {id: "openai", name: "OpenAI", icon: icon("openai", "OpenAI")},
    {id: "openrouter", name: "OpenRouter", icon: icon("openrouter", "OpenRouter")},
    {id: "custom", name: "我的本地服务", icon: icon("", "我的本地服务")},
];
const PICKER_MODELS = [
    {key: "", label: "跟随默认", supportsImages: false},
    {key: "deepseek/v4", label: "DeepSeek V4", supportsImages: false, group: "DeepSeek", groupId: "deepseek", contextWindow: 1_000_000, reasoning: true, price: {input: 0.3, output: 1.2}},
    {key: "deepseek/flash", label: "DeepSeek Flash", supportsImages: false, group: "DeepSeek", groupId: "deepseek", contextWindow: 256_000, reasoning: false, price: {input: 0.05, output: 0.2}},
    {key: "openai/gpt", label: "GPT 6.1", supportsImages: true, group: "OpenAI", groupId: "openai", contextWindow: 400_000, reasoning: true, price: null},
    {key: "openai/broken", label: "没有密钥的模型", supportsImages: true, group: "OpenAI", groupId: "openai", unavailable: "这家服务商没有设密钥"},
    {key: "custom/qwen", label: "qwen3:8b", supportsImages: false, group: "我的本地服务", groupId: "custom", contextWindow: 32_768, reasoning: true},
];
/** OpenRouter 这样的大组：几百个模型，当前模型在中间。 */
const BIG_MODELS = Array.from({length: 587}, (_, index) => ({key: `openrouter/m-${String(index)}`, label: `vendor/model-${String(index)}`, supportsImages: index % 3 === 0, group: "OpenRouter", groupId: "openrouter", contextWindow: 128_000, reasoning: index % 2 === 0}));

const effort = (patch: Partial<NonNullable<ComposerView["effort"]>> = {}): NonNullable<ComposerView["effort"]> => ({kind: "levels", levels: ["low", "medium", "high", "xhigh"], canOff: true, verified: true, value: "high", source: "role", follow: {source: "role", name: "主力"}, ...patch});
const ENGLISH_ROLE_NAMES: Record<string, string> = {"role:tiny": "Tiny", "role:fast": "Fast", "role:main": "Main", "role:deep": "Deep", "role:compaction": "Compaction", "role:lore": "Lore research"};
const base = {roles: PICKER_ROLES, models: PICKER_MODELS, groups: PICKER_GROUPS, modelKey: "role:main", effectiveModel: "DeepSeek V4", thinkingLevels: [] as string[], thinking: null, canManage: true};

export const agentRoleModelPickerScenes: RolePickerScene[] = [
    {id: "role", label: "选了角色，思考档跟随主力的默认（只画细框）", input: {props: {...base, effort: effort()}}},
    {id: "role-session", label: "会话里明确选了档：有“用主力的默认”", input: {props: {...base, effort: effort({value: "medium", source: "session"}), thinking: "medium"}}},
    {id: "lowest", label: "只能降到最低档的模型：没有“关闭”这一项", input: {props: {...base, effort: effort({canOff: false, levels: ["low", "high", "max"], value: "low", source: "session"})}}},
    {id: "model-default", label: "选了模型，用模型自己的默认（协议默认就不思考）", input: {props: {...base, modelKey: "custom/qwen", effectiveModel: "qwen3:8b", effort: effort({value: "off", source: "model", follow: {source: "model"}})}}},
    {id: "seven", label: "七档：窄面板里分段用缩写", input: {props: {...base, effort: effort({levels: ["minimal", "low", "medium", "high", "xhigh", "max"], value: "xhigh", source: "session"})}}},
    {id: "unverified", label: "没写支持哪几档：通用档位，右边有问号", input: {props: {...base, effort: effort({verified: false, value: null, source: null, follow: null})}}},
    {id: "fixed", label: "会思考但不能调档：没有分段，写原因", input: {props: {...base, effort: {kind: "fixed", levels: [], canOff: false, verified: true, value: null, source: null, follow: null}}}},
    {id: "none", label: "选了模型，模型不支持思考", input: {props: {...base, modelKey: "deepseek/flash", effectiveModel: "DeepSeek Flash", effort: {kind: "none", levels: [], canOff: false, verified: true, value: null, source: null, follow: null}}}},
    {id: "unbound", label: "选的角色没绑定", input: {props: {...base, modelKey: "role:deep", effectiveModel: null, effort: {kind: "none", levels: [], canOff: false, verified: true, value: null, source: null, follow: null}}}},
    {id: "big-group", label: "OpenRouter 587 个模型，当前模型在中间（模型库页：只展开前后各 10 行）", input: {props: {...({labOpen: "models"} as object), ...base, models: [...PICKER_MODELS, ...BIG_MODELS], modelKey: "openrouter/m-300", effectiveModel: "vendor/model-300", effort: effort({value: null, source: null, follow: null})}}},
    {id: "narrow", label: "窄面板（340px）：五档写缩写，没有横向溢出", input: {props: {...({labWidth: 340} as object), ...base, effort: effort({levels: ["minimal", "low", "medium", "high"], value: "medium", source: "session"})}}},
    {id: "narrow-long-names", label: "窄面板（340px），角色名与模型名都很长：触发器省略前两段，档位留着", input: {props: {...({labWidth: 340} as object), ...base, roles: PICKER_ROLES.map((role) => (role.key === "role:main" ? {...role, name: "主力（写长篇正文时专用的那一个）", modelLabel: "vendor/an-extremely-long-model-name-q4_k_m"} : role)), effectiveModel: "vendor/an-extremely-long-model-name-q4_k_m", effort: effort({value: "high", source: "session"})}}},
    {id: "wide", label: "宽面板（520px）：角色页两列，五档写全名", input: {props: {...({labWidth: 520, labOpen: "roles"} as object), ...base, effort: effort({levels: ["low", "medium", "high", "xhigh"], value: "medium", source: "session"})}}},
    {id: "english", label: "英文界面（420px）：缩写与说明不截断", input: {props: {...({labWidth: 420, labLocale: "en-US", labOpen: "roles"} as object), ...base, roles: PICKER_ROLES.map((role) => ({...role, name: ENGLISH_ROLE_NAMES[role.key] ?? role.name})), effort: effort({value: "high", source: "session", follow: {source: "role", name: "Main"}})}}},
    {id: "english-narrow-seven", label: "英文界面、七档、340px", input: {props: {...({labWidth: 340, labLocale: "en-US"} as object), ...base, roles: PICKER_ROLES.map((role) => ({...role, name: ENGLISH_ROLE_NAMES[role.key] ?? role.name})), effort: effort({levels: ["minimal", "low", "medium", "high", "xhigh", "max"], value: "xhigh", source: "session", follow: {source: "role", name: "Main"}})}}},
    {id: "legacy", label: "旧宿主：只给档位列表（兼容）", input: {props: {roles: PICKER_ROLES, models: PICKER_MODELS, modelKey: "role:main", effectiveModel: "DeepSeek V4", thinkingLevels: ["off", "low", "medium", "high"], thinking: "high", canManage: true}}},
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
    {id: "no-cache", label: "服务商不报缓存", input: {props: {usage: {...INSPECTOR_USAGE, cacheRead: 0, cacheWrite: 0, cacheHitRate: null, lastCacheHitRate: null}, systemPrompt: null, inspection: {state: "ready", estimated: 3_000, window: 32_000, threshold: 16_000, areas: [{key: "system", tokens: 500}, {key: "tools", tokens: 2_300}, {key: "opening", tokens: 0}, {key: "history", tokens: 200}, {key: "turn", tokens: 0}], slots: [], diagnostics: []}}}},
    {id: "unavailable", label: "算不出", input: {props: {usage: INSPECTOR_USAGE, systemPrompt: null, inspection: {state: "unavailable", reason: "现在算不出下一次请求：这个会话的模型用不了。"}}}},
];

export const agentMessageEditorScenes: LabFixtureDefinition<typeof AgentMessageEditor>["scenes"] = [
    {id: "default", label: "编辑", input: {props: {text: "把第三章的结尾改得更克制一点", loading: false}}},
    {id: "loading", label: "原文加载中", input: {props: {text: "", loading: true}}},
];

const TREE_NODES = [
    {id: "01KQ00CREATED", parent: null, type: "sessionCreated"},
    {id: "01KQ00RUN", parent: "01KQ00CREATED", type: "runStarted"},
    {id: "01KQ01USER", parent: "01KQ00RUN", type: "input", label: "把第三章的结尾改得更克制一点"},
    {id: "01KQ01MODEL", parent: "01KQ01USER", type: "modelStarted"},
    {id: "01KQ02ASSIST", parent: "01KQ01MODEL", type: "assistant", label: "好，我先读第三章。"},
    {id: "01KQ03TOOL", parent: "01KQ02ASSIST", type: "toolStarted", label: "read 正文/第三章.md"},
    {id: "01KQ03RESULT", parent: "01KQ03TOOL", type: "toolResult"},
    {id: "01KQ04ASSIST", parent: "01KQ03RESULT", type: "assistant", label: "结尾这段可以这样收：他没有回头，巷口的灯灭了。"},
    {id: "01KQ05USER", parent: "01KQ04ASSIST", type: "input", label: "再冷一点，去掉灯"},
    {id: "01KQ06ASSIST", parent: "01KQ05USER", type: "assistant", label: "他没有回头。雨还在下。"},
    {id: "01KQ07USER", parent: "01KQ04ASSIST", type: "input", label: "换成他回头看了一眼"},
    {id: "01KQ08ASSIST", parent: "01KQ07USER", type: "assistant", label: "他在巷口停了一下，回头看了一眼。"},
    {id: "01KQ09USER", parent: "01KQ08ASSIST", type: "input", label: "再往后写一段"},
    {id: "01KQ10ASSIST", parent: "01KQ09USER", type: "assistant", label: "巷子深处有人在咳嗽。"},
    {id: "01KQ11ASSIST", parent: "01KQ04ASSIST", type: "assistant", label: "雨越下越大。他走进巷子。"},
];
/** 每一层都分叉：主干一路往下，每层多一条支线。 */
const DEEP_TREE = Array.from({length: 12}, (_, depth) => [
    {id: `t${String(depth)}`, parent: depth === 0 ? null : `t${String(depth - 1)}`, type: "input", label: `第 ${String(depth + 1)} 层的主干`},
    ...(depth === 0 ? [] : [{id: `b${String(depth)}`, parent: `t${String(depth - 1)}`, type: "assistant", label: `第 ${String(depth + 1)} 层的支线`}]),
]).flat();
const TREE_PATH = ["01KQ00CREATED", "01KQ00RUN", "01KQ01USER", "01KQ01MODEL", "01KQ02ASSIST", "01KQ03TOOL", "01KQ03RESULT", "01KQ04ASSIST", "01KQ05USER", "01KQ06ASSIST"];

export const agentSessionTreeScenes: LabFixtureDefinition<typeof AgentSessionTree>["scenes"] = [
    {id: "ready", label: "有分叉", input: {props: {canActivate: true, tree: {state: "ready", nodes: TREE_NODES, activePath: TREE_PATH}}}},
    {id: "deep", label: "分叉很多层", input: {props: {canActivate: true, tree: {state: "ready", nodes: DEEP_TREE, activePath: DEEP_TREE.filter((node) => node.id.startsWith("t")).map((node) => node.id)}}}},
    {id: "loading", label: "读取中", input: {props: {canActivate: true, tree: {state: "loading", loaded: 2000}}}},
    {id: "unavailable", label: "读不到", input: {props: {canActivate: true, tree: {state: "unavailable", reason: "这步没做成（session-closed）。对话没动。"}}}},
    {id: "running", label: "运行中不能切换", input: {props: {canActivate: false, tree: {state: "ready", nodes: TREE_NODES, activePath: TREE_PATH}}}},
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
    {id: "held", label: "留着的话（原因不止一种）", input: {props: {queued: [...HELD, ...QUEUED]}}},
    {id: "held-disabled", label: "留着的话，继续不可用", input: {props: {queued: HELD.slice(0, 2), continueDisabled: "正在停止"}}},
];
