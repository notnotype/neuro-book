import type {FormSelectOption} from "@notnotype/nb-ui/components";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";
import type {AgentProfileDraft, AgentProfileModelDraft} from "../../components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import type {ProfileRuntimeSettingsDraft, ProfileRuntimeSettingsSources} from "../../components/novel-ide/settings/sections/agent-profile/profile-runtime-settings";
import type AgentProfileIdentitySection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileIdentitySection.vue";
import type AgentProfileModelSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileModelSection.vue";
import type AgentProfileCustomSettingsSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileCustomSettingsSection.vue";
import type AgentProfileRuntimeSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileRuntimeSection.vue";
import type AgentProfileDefaultProfileSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileDefaultProfileSection.vue";
import type AgentProfileDefaultModelSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileDefaultModelSection.vue";
import type AgentProfileDefaultRuntimeSection from "../../components/novel-ide/settings/sections/agent-profile/components/AgentProfileDefaultRuntimeSection.vue";
import type {LabFixtureDefinition} from "./index";

const enabledModels = [
    {key: "openai/gpt-5.1", label: "GPT-5.1", providerId: "openai", modelId: "gpt-5.1", input: ["text" as const], contextWindowTokens: 400000},
    {key: "openai/gpt-5.1-mini", label: "GPT-5.1 Mini", providerId: "openai", modelId: "gpt-5.1-mini", input: ["text" as const], contextWindowTokens: 400000},
];
const modelBaseline = {modelKey: "openai/gpt-5.1", temperature: 0.2, topK: 40, reasoningEffort: "medium" as const, stream: true};
const runtimeBaseline = {
    summarizer: {enabled: true, profileKey: "summarizer.default", trigger: "afterInvocation" as const, interval: {kind: "sourceInvocation" as const, value: 20}, maxDialogueContentTokens: 4096},
    compaction: {enabled: true, trigger: {kind: "autoReserve" as const}, reserveTokens: 16384, keepRecent: {kind: "percent" as const, value: 0.25}, prompt: "请压缩以下对话内容，保留关键事实。", summaryPrefix: "[摘要]"},
    fileChangeNotice: {diffMaxChars: 2048},
};
const runtimeSources: ProfileRuntimeSettingsSources = {
    summarizerEnabled: "harness", summarizerProfileKey: "harness", summarizerIntervalKind: "harness", summarizerIntervalValue: "harness", summarizerMaxTokens: "harness",
    compactionEnabled: "harness", compactionTriggerKind: "harness", compactionTriggerValue: "harness", compactionReserveTokens: "harness",
    compactionKeepRecentKind: "harness", compactionKeepRecentValue: "harness", compactionPrompt: "harness", compactionSummaryPrefix: "harness", fileChangeDiffMaxChars: "harness",
};
const defaultProfileOptions: FormSelectOption[] = [
    {value: "__inherit__", label: "跟随全局默认", description: "由上层设置决定"},
    {value: "story-writer", label: "故事写手", description: "章节初稿"},
    {value: "line-editor", label: "行文编辑", description: "段落润色"},
];
const lowCodeForm: LowCodeFormDto = {fields: [
    {path: "tone", component: "select", required: false, label: "文风", defaultValue: "warm", options: [{value: "warm", label: "温暖"}, {value: "concise", label: "克制"}]},
    {path: "notes", component: "textarea", required: false, label: "写作备注", defaultValue: "", rows: 3, options: []},
], defaults: {tone: "warm"}};
export const profileSceneProfile: AgentProfileDraft = {
    profileKey: "story-writer", name: "故事写手", canResetHome: true,
    model: {modelKey: "openai/gpt-5.1", temperature: "0.2", topK: "40", reasoningEffort: "medium", stream: true},
    loadStatus: "loaded",
    runtime: {summarizerEnabled: null, summarizerProfileKey: "", summarizerIntervalKind: "", summarizerIntervalValue: "", summarizerMaxTokens: "", compactionEnabled: null, compactionTriggerKind: "", compactionTriggerValue: "", compactionReserveTokens: "", compactionKeepRecentKind: "", compactionKeepRecentValue: "", compactionPrompt: "", compactionSummaryPrefix: "", fileChangeDiffMaxChars: ""},
    runtimeEffective: runtimeBaseline, runtimeSources, runtimeErrors: {}, issue: null,
    sourcePath: "profiles/story-writer.profile.ts", buildState: {running: false, queued: false, reason: "本组件预览使用固定内存数据。", updatedAt: null},
    settings: {form: lowCodeForm, values: {tone: "warm", notes: "保持叙事节奏。"}, inheritedValue: {tone: "warm"}, issues: [], overridePaths: [], resourceMutations: []},
};
const modelDefaults: AgentProfileModelDraft = {modelKey: "openai/gpt-5.1", temperature: "0.2", topK: "40", reasoningEffort: "medium", stream: true};
const runtimeDefaults: ProfileRuntimeSettingsDraft = {summarizerEnabled: null, summarizerProfileKey: "", summarizerIntervalKind: "", summarizerIntervalValue: "", summarizerMaxTokens: "", compactionEnabled: null, compactionTriggerKind: "", compactionTriggerValue: "", compactionReserveTokens: "", compactionKeepRecentKind: "", compactionKeepRecentValue: "", compactionPrompt: "", compactionSummaryPrefix: "", fileChangeDiffMaxChars: ""};
const common = {scope: "project" as const, disabled: false};
const modelCommon = {enabledModels, validationIssues: []};
export const agentProfileIdentitySectionScenes = [{id: "default", label: "身份与状态", input: {props: {profile: profileSceneProfile, descriptions: {"story-writer": "负责章节初稿的连续写作。"}, isDefaultProfile: true, buildHint: ""}}}] satisfies LabFixtureDefinition<typeof AgentProfileIdentitySection>["scenes"];
export const agentProfileModelSectionScenes = [{id: "default", label: "模型设置", input: {props: {inherited: modelBaseline, ...modelCommon}, model: {model: profileSceneProfile.model}}}] satisfies LabFixtureDefinition<typeof AgentProfileModelSection>["scenes"];
export const agentProfileCustomSettingsSectionScenes = [{id: "default", label: "专属设置", input: {props: {profile: profileSceneProfile, scope: "project"}}}] satisfies LabFixtureDefinition<typeof AgentProfileCustomSettingsSection>["scenes"];
export const agentProfileRuntimeSectionScenes = [{id: "default", label: "运行策略", input: {props: {profile: profileSceneProfile, runtimeBaseline: {settings: runtimeBaseline, sources: runtimeSources}}}}] satisfies LabFixtureDefinition<typeof AgentProfileRuntimeSection>["scenes"];
export const agentProfileDefaultProfileSectionScenes = [{id: "default", label: "默认 Profile", input: {props: {...common, defaultProfileOptions, effectiveDefaultProfileKey: "story-writer"}, model: {defaultProfileKey: "__inherit__"}}}] satisfies LabFixtureDefinition<typeof AgentProfileDefaultProfileSection>["scenes"];
export const agentProfileDefaultModelSectionScenes = [{id: "default", label: "默认模型", input: {props: {...common, globalModelDefaults: modelBaseline, ...modelCommon}, model: {modelDefaults}}}] satisfies LabFixtureDefinition<typeof AgentProfileDefaultModelSection>["scenes"];
export const agentProfileDefaultRuntimeSectionScenes = [{id: "default", label: "默认运行策略", input: {props: {...common, runtimeEffective: runtimeBaseline, runtimeSources, runtimeErrors: {}}, model: {runtimeDefaults}}}] satisfies LabFixtureDefinition<typeof AgentProfileDefaultRuntimeSection>["scenes"];
