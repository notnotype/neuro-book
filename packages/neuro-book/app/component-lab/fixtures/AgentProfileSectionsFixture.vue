<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {FormSelect, type FormSelectOption} from "@notnotype/nb-ui/components";
import type {ConfigAgentProfileSettingsDto} from "nbook/shared/dto/config.dto";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";
import type {AgentProfileDraft, AgentProfileModelDraft} from "../../components/novel-ide/settings/views/agent-profile/agent-profile-draft";
import {cloneModelDraft} from "../../components/novel-ide/settings/views/agent-profile/agent-profile-draft";
import type {ProfileRuntimeSettingsSources} from "../../components/novel-ide/settings/views/agent-profile/profile-runtime-settings";
import {createProfileRuntimeSettingsDraft} from "../../components/novel-ide/settings/views/agent-profile/profile-runtime-settings";
import AgentProfileIdentitySection from "../../components/novel-ide/settings/views/agent-profile/AgentProfileIdentitySection.vue";
import AgentProfileModelSection from "../../components/novel-ide/settings/views/agent-profile/AgentProfileModelSection.vue";
import AgentProfileCustomSettingsSection from "../../components/novel-ide/settings/views/agent-profile/AgentProfileCustomSettingsSection.vue";
import AgentProfileRuntimeSection from "../../components/novel-ide/settings/views/agent-profile/AgentProfileRuntimeSection.vue";
import AgentProfileDefaultProfileSection from "../../components/novel-ide/settings/views/agent-profile/AgentProfileDefaultProfileSection.vue";
import AgentProfileDefaultModelSection from "../../components/novel-ide/settings/views/agent-profile/AgentProfileDefaultModelSection.vue";
import AgentProfileDefaultRuntimeSection from "../../components/novel-ide/settings/views/agent-profile/AgentProfileDefaultRuntimeSection.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

type SectionKey = "identity" | "model" | "custom-settings" | "runtime" | "default-profile" | "default-model" | "default-runtime";

const props = defineProps<{scene: string; data?: unknown}>();
const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

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
const profile = ref<AgentProfileDraft>(makeProfile());
const modelDefaults = ref<AgentProfileModelDraft>(cloneModelDraft(modelBaseline));
const runtimeDefaults = ref(createProfileRuntimeSettingsDraft(undefined));
const defaultProfileKey = ref("__inherit__");
const selectedSection = computed<SectionKey>(() => {
    const value = readData(props.data).section;
    return value ?? (props.scene as SectionKey);
});
const defaultProfileOptions: FormSelectOption[] = [
    {value: "__inherit__", label: "跟随全局默认", description: "由上层设置决定"},
    {value: "story-writer", label: "故事写手", description: "章节初稿"},
    {value: "line-editor", label: "行文编辑", description: "段落润色"},
];

function makeProfile(): AgentProfileDraft {
    return {
        profileKey: "story-writer",
        name: "故事写手",
        canResetHome: true,
        model: cloneModelDraft(modelBaseline),
        loadStatus: "loaded",
        runtime: createProfileRuntimeSettingsDraft(undefined),
        runtimeEffective: runtimeBaseline,
        runtimeSources,
        runtimeErrors: {},
        issue: null,
        sourcePath: "profiles/story-writer.profile.ts",
        buildState: {running: false, queued: false, reason: "本组件预览使用固定内存数据。", updatedAt: null},
        settings: {
            form: lowCodeForm(),
            values: {tone: "warm", notes: "保持叙事节奏。"},
            inheritedValue: {tone: "warm"},
            issues: [],
            overridePaths: [],
            resourceMutations: [],
        },
    };
}

function lowCodeForm(): LowCodeFormDto {
    return {
        fields: [
            {path: "tone", component: "select" as const, required: false, label: "文风", defaultValue: "warm", options: [{value: "warm", label: "温暖"}, {value: "concise", label: "克制"}]},
            {path: "notes", component: "textarea" as const, required: false, label: "写作备注", defaultValue: "", rows: 3, options: []},
        ],
        defaults: {tone: "warm"},
    };
}

function readData(value: unknown): {section?: SectionKey} {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    const section = (value as Record<string, unknown>).section;
    return typeof section === "string" ? {section: section as SectionKey} : {};
}

function labData(): Record<string, unknown> {
    return {section: selectedSection.value, profile: profile.value, modelDefaults: modelDefaults.value, runtimeDefaults: runtimeDefaults.value, defaultProfileKey: defaultProfileKey.value};
}

function reset(): void {
    profile.value = makeProfile();
    modelDefaults.value = cloneModelDraft(modelBaseline);
    runtimeDefaults.value = createProfileRuntimeSettingsDraft(undefined);
    defaultProfileKey.value = "__inherit__";
}

function updateProfile(patch: Partial<AgentProfileDraft>): void {
    if (patch.model !== undefined) profile.value.model = patch.model;
    if (patch.runtime !== undefined) profile.value.runtime = patch.runtime;
    if (patch.settings !== undefined) (profile.value as AgentProfileDraft).settings = patch.settings;
    emitLabEvent("update:section", selectedSection.value);
}

watch(() => props.scene, reset, {immediate: true});
watch([profile, modelDefaults, runtimeDefaults, defaultProfileKey], () => syncLabData(JSON.parse(JSON.stringify(labData()))), {deep: true, immediate: true});

const updateModel = (value: AgentProfileModelDraft): void => updateProfile({model: value});
const updateRuntime = (value: AgentProfileDraft["runtime"]): void => updateProfile({runtime: value});
const updateSettings = (patch: Partial<NonNullable<AgentProfileDraft["settings"]>>): void => updateProfile({settings: {...profile.value.settings!, ...patch}});
</script>

<template>
    <div class="min-h-[520px] w-full min-w-0 overflow-y-auto p-4" data-lab-subject>
        <div class="mb-3 flex items-center justify-between gap-2 border-b border-[var(--divider)] pb-3">
            <div>
                <p class="text-xs font-semibold text-[var(--text-main)]">{{ selectedSection }}</p>
                <p class="text-[11px] text-[var(--text-muted)]">独立区段预览；数据只保留在本次 Lab 场景。</p>
            </div>
            <button type="button" class="text-xs text-[var(--text-secondary)] underline" @click="reset">恢复示例</button>
        </div>

        <AgentProfileIdentitySection v-if="selectedSection === 'identity'" :profile="profile" :descriptions="{'story-writer': '负责章节初稿的连续写作。'}" :is-default-profile="true" build-hint="" />
        <AgentProfileModelSection v-else-if="selectedSection === 'model'" :model="profile.model" :inherited="modelBaseline" :enabled-models="enabledModels" :validation-issues="[]" @update:model="updateModel" />
        <AgentProfileCustomSettingsSection v-else-if="selectedSection === 'custom-settings'" :profile="profile" scope="project" @update:settings-values="updateSettings({values: $event})" @update:settings-override-paths="updateSettings({overridePaths: $event})" @update:settings-resource-mutations="updateSettings({resourceMutations: $event})" />
        <AgentProfileRuntimeSection v-else-if="selectedSection === 'runtime'" :profile="profile" :runtime-baseline="{settings: runtimeBaseline, sources: runtimeSources}" @update:runtime="updateRuntime" />
        <AgentProfileDefaultProfileSection v-else-if="selectedSection === 'default-profile'" scope="project" :default-profile-key="defaultProfileKey" :default-profile-options="defaultProfileOptions" effective-default-profile-key="story-writer" :disabled="false" @update:default-profile-key="defaultProfileKey = $event" />
        <AgentProfileDefaultModelSection v-else-if="selectedSection === 'default-model'" scope="project" :model-defaults="modelDefaults" :global-model-defaults="modelBaseline" :enabled-models="enabledModels" :validation-issues="[]" :disabled="false" @update:model-defaults="modelDefaults = $event" @reset="modelDefaults = cloneModelDraft(modelBaseline)" />
        <AgentProfileDefaultRuntimeSection v-else scope="project" :runtime-defaults="runtimeDefaults" :runtime-effective="runtimeBaseline" :runtime-sources="runtimeSources" :runtime-errors="{}" :disabled="false" @update:runtime-defaults="runtimeDefaults = $event" />
    </div>
</template>
