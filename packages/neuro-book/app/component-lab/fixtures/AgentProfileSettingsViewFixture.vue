<script setup lang="ts">
import {computed, ref, watch} from "vue";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "../../components/novel-ide/settings/agent-profile/AgentProfileSettingsView.types";
import AgentProfileSettingsView from "../../components/novel-ide/settings/agent-profile/AgentProfileSettingsView.vue";
import type {AgentProfileDraft, AgentProfileModelDraft} from "../../components/novel-ide/settings/agent-profile/agent-profile-draft";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";
import {cloneModelDraft} from "../../components/novel-ide/settings/agent-profile/agent-profile-draft";
import {createProfileRuntimeSettingsDraft} from "../../components/novel-ide/settings/agent-profile/profile-runtime-settings";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

const statuses = [
    "loaded",
    "compiling",
    "compile_failed",
    "not_compiled",
    "compile_stale",
    "compiled_load_failed",
    "source_error",
] as const;

type SceneKey = "global" | "project" | "statuses" | "custom-settings" | "empty" | "loading" | "saving" | "load-error" | "save-error";

const SAVED_HINT = "已保存到本次预览；未写入真实配置。";

function emptyRuntimeDraft() {
    return createProfileRuntimeSettingsDraft(undefined);
}

function modelDraft(patch: Partial<AgentProfileModelDraft>): AgentProfileModelDraft {
    return {...cloneModelDraft(undefined), ...patch};
}

function baseProfile(profileKey: string, name: string, loadStatus: (typeof statuses)[number]): AgentProfileDraft {
    return {
        profileKey,
        name,
        canResetHome: true,
        model: cloneModelDraft(undefined),
        loadStatus,
        runtime: emptyRuntimeDraft(),
        runtimeEffective: harnessRuntime(),
        runtimeSources: {
            summarizerEnabled: "harness", summarizerProfileKey: "harness", summarizerIntervalKind: "harness", summarizerIntervalValue: "harness", summarizerMaxTokens: "harness",
            compactionEnabled: "harness", compactionTriggerKind: "harness", compactionTriggerValue: "harness", compactionReserveTokens: "harness",
            compactionKeepRecentKind: "harness", compactionKeepRecentValue: "harness", compactionPrompt: "harness", compactionSummaryPrefix: "harness", fileChangeDiffMaxChars: "harness",
        },
        runtimeErrors: {},
        issue: null,
        sourcePath: `profiles/${profileKey}.profile.ts`,
        buildState: {running: false, queued: false, reason: null, updatedAt: null},
        settings: null,
    };
}

function harnessRuntime() {
    return {
        summarizer: {
            enabled: true,
            profileKey: "summarizer.default",
            trigger: "afterInvocation" as const,
            interval: {kind: "sourceInvocation" as const, value: 20},
            maxDialogueContentTokens: 4096,
        },
        compaction: {
            enabled: true,
            trigger: {kind: "autoReserve" as const},
            reserveTokens: 16384,
            keepRecent: {kind: "percent" as const, value: 0.25},
            prompt: "请压缩以下对话内容，保留关键事实。",
            summaryPrefix: "[摘要]",
        },
        fileChangeNotice: {diffMaxChars: 2048},
    };
}

function buildSettingsMeta() {
    return {
        enabledModels: [
            {key: "openai/gpt-5.1", label: "GPT-5.1", providerId: "openai", modelId: "gpt-5.1", input: ["text" as const], contextWindowTokens: 400000},
            {key: "openai/gpt-5.1-mini", label: "GPT-5.1 Mini", providerId: "openai", modelId: "gpt-5.1-mini", input: ["text" as const], contextWindowTokens: 400000},
            {key: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", providerId: "anthropic", modelId: "claude-sonnet-4.6", input: ["text" as const], contextWindowTokens: 200000},
        ],
        validationIssues: [],
        profileModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off" as const, stream: true},
        harnessRuntimeDefaults: harnessRuntime(),
        profileRuntimeDefaults: harnessRuntime(),
        globalRuntimeDefaultsPatch: {},
        projectRuntimeDefaultsPatch: {},
        agentProfiles: [],
    };
}

function buildContext(scene: SceneKey): AgentProfileSettingsContext {
    const scope = scene === "project" || scene === "custom-settings" ? "project" as const : "global" as const;
    return {
        scope,
        targetLabel: scope === "project" ? "示例项目" : "",
        inheritedDefaultProfileKey: "story-writer",
        globalModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off" as const, stream: true},
        globalProfileModels: scope === "project" ? {"fact-reviewer": {temperature: 0.2}} : {},
        settings: buildSettingsMeta(),
        descriptions: {
            "story-writer": "负责章节初稿的连续写作。",
            "line-editor": "对成稿逐段润色语气与节奏。",
            "fact-reviewer": "校对事实、时间线与设定一致性。",
        },
    };
}

function lowCodeForm(): LowCodeFormDto {
    return {
        fields: [
            {path: "tone", component: "select" as const, required: false, label: "文风", defaultValue: "warm", options: [{value: "warm", label: "温暖"}, {value: "concise", label: "克制"}]},
            {path: "persona", component: "text" as const, required: false, label: "人称", defaultValue: "第三人称", options: []},
            {path: "notes", component: "textarea" as const, required: false, label: "写作备注", defaultValue: "", rows: 3, options: []},
            {path: "verbosity", component: "number" as const, required: false, label: "铺陈程度", defaultValue: 3, step: 1, options: []},
            {path: "autoPolish", component: "switch" as const, required: false, label: "自动润色", defaultValue: true, options: []},
            {path: "mood", component: "radio" as const, required: false, label: "情绪基调", defaultValue: "calm", options: [{value: "calm", label: "平静"}, {value: "tense", label: "紧张"}]},
            {path: "keywords", component: "checkbox" as const, required: false, label: "关注要素", defaultValue: ["foreshadow"], options: [{value: "foreshadow", label: "伏笔"}, {value: "dialogue", label: "对话"}]},
            {path: "stylePreset", component: "combobox" as const, required: false, label: "风格预设", defaultValue: "", options: [{value: "wuxia", label: "武侠"}, {value: "urban", label: "都市"}]},
            {path: "promptResource", component: "resource-preset" as const, required: false, label: "提示词资源", defaultValue: "global:main", options: [], resource: {
                contentType: "markdown" as const,
                options: [
                    {key: "global:main", label: "主提示词", origin: "global" as const, editable: false, deletable: false},
                    {key: "project:alt", label: "备选提示词", origin: "project" as const, editable: true, deletable: true},
                ],
                content: null,
                contents: [
                    {key: "global:main", content: "你是故事写手，负责推进主线。", contentType: "markdown" as const},
                    {key: "project:alt", content: "你是备选写手，语气更轻。", contentType: "markdown" as const},
                ],
                template: "新的提示词内容。",
                createKeyPrefix: "project:",
                createKeySuffix: "",
                capabilities: {create: true, update: true, rename: true, remove: true},
            }},
        ],
        defaults: {tone: "warm"},
    };
}

function profilesFor(scene: SceneKey): AgentProfileDraft[] {
    switch (scene) {
        case "global":
        case "saving":
        case "save-error": {
            const list = [
                baseProfile("story-writer", "故事写手", "loaded"),
                baseProfile("line-editor", "行文编辑", "loaded"),
                baseProfile("fact-reviewer", "事实审校", "loaded"),
            ];
            list[0]!.settings = {
                form: lowCodeForm(),
                values: {tone: "warm", persona: "第三人称"},
                inheritedValue: {},
                issues: [],
                overridePaths: [],
                resourceMutations: [],
            };
            return list;
        }
        case "project":
        case "custom-settings": {
            const list = [
                baseProfile("story-writer", "故事写手", "loaded"),
                baseProfile("line-editor", "行文编辑", "loaded"),
                baseProfile("fact-reviewer", "事实审校", "loaded"),
            ];
            list[1]!.model = modelDraft({temperature: "0.4", stream: false});
            list[2]!.settings = {
                form: lowCodeForm(),
                values: {tone: "concise"},
                inheritedValue: {tone: "warm", verbosity: 3},
                issues: [],
                overridePaths: ["tone"],
                resourceMutations: [],
            };
            return list;
        }
        case "statuses": {
            const names = ["故事写手", "行文编辑", "事实审校", "资料研究员", "大纲规划", "设定档案", "世界观守卫"];
            const keys = ["story-writer", "line-editor", "fact-reviewer", "deep-researcher", "plot-planner", "series-archivist", "canon-guardian"];
            return statuses.map((status, index) => {
                const profile = baseProfile(keys[index]!, names[index]!, status);
                if (status === "compile_failed") {
                    profile.issue = {code: "COMPILE_TYPE_ERROR", message: "编译失败：提示词脚本第 12 行类型不匹配。", profileKey: keys[index]!, sourcePath: profile.sourcePath};
                }
                if (status === "compiling") {
                    profile.buildState = {running: true, queued: false, reason: null, updatedAt: null};
                }
                if (status === "compile_stale") {
                    profile.buildState = {running: false, queued: true, reason: "源文件在上次编译后发生变更。", updatedAt: null};
                }
                return profile;
            });
        }
        case "empty":
        case "loading":
        case "load-error":
            return [];
    }
}

function pageDraftFor(scene: SceneKey): AgentProfileSettingsPageDraft {
    return {
        defaultProfileKey: "",
        modelDefaults: cloneModelDraft(undefined),
        runtimeDefaults: emptyRuntimeDraft(),
        profiles: profilesFor(scene),
    };
}

const modelValue = ref<AgentProfileSettingsPageDraft>(pageDraftFor("global"));
const baseline = ref<AgentProfileSettingsPageDraft>(pageDraftFor("global"));
const message = ref("");
const saving = ref(false);
const loadError = ref("");

function sceneState(scene: SceneKey) {
    return {draft: pageDraftFor(scene), baseline: pageDraftFor(scene)};
}

function isSceneKey(value: string): value is SceneKey {
    return ["global", "project", "statuses", "custom-settings", "empty", "loading", "saving", "load-error", "save-error"].includes(value);
}

function applyScene(): void {
    const scene: SceneKey = isSceneKey(props.scene) ? props.scene : "global";
    const state = sceneState(scene);
    modelValue.value = state.draft;
    baseline.value = state.baseline;
    saving.value = scene === "saving";
    loadError.value = scene === "load-error" ? "读取 Agent Profile 设定失败：配置文件不可读。" : "";
    message.value = "";
}

const context = computed(() => buildContext(isSceneKey(props.scene) ? props.scene as SceneKey : "global"));

function labData() {
    return {draft: modelValue.value, baseline: baseline.value, message: message.value};
}

// 只有 scene 变化才重建场景；数据面板回流（fixtureData → :data）不得触发重置，
// 否则用户刚做的修改会被 syncLabData 写回的旧值冲掉。
watch([() => props.scene], applyScene, {immediate: true});
watch(() => props.data, () => {
    // 数据面板编辑 JSON 时（值与当前 draft 不同）才接受外部输入，等值回流忽略。
    const incoming = props.data as {draft?: unknown; message?: unknown} | undefined;
    if (!incoming || typeof incoming !== "object") return;
    if (incoming.draft === undefined) return;
    const serialized = JSON.stringify(incoming.draft);
    if (serialized === JSON.stringify(modelValue.value)) return;
    try {
        modelValue.value = serialized ? JSON.parse(serialized) as AgentProfileSettingsPageDraft : modelValue.value;
    } catch {
        // 非法 JSON：保持当前草稿，不静默捏造数据
    }
});
watch(modelValue, () => syncLabData(JSON.parse(JSON.stringify(labData()))), {deep: true});

function onUpdate(value: AgentProfileSettingsPageDraft): void {
    modelValue.value = value;
    emitLabEvent("update:modelValue", value);
}

function onSave(value: AgentProfileSettingsPageDraft): void {
    emitLabEvent("save", value);
    if (isSceneKey(props.scene) && props.scene === "save-error") {
        message.value = "";
        emitLabEvent("save-error", "示例保存失败：后端返回 500。");
        return;
    }
    baseline.value = JSON.parse(JSON.stringify(value));
    message.value = SAVED_HINT;
}

function onReload(): void {
    emitLabEvent("reload", undefined);
    message.value = "已记录重新加载请求；预览不访问真实配置。";
}

function onResetHome(profileKey: string): void {
    emitLabEvent("reset-home", profileKey);
    message.value = "已记录重置请求；预览未删除数据。";
}
</script>

<template>
    <div class="flex h-[660px] max-h-full min-h-0 w-full flex-col gap-2">
        <p v-if="message" class="shrink-0 rounded-[var(--radius-control)] border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1.5 text-[11px] text-[var(--status-success)]">{{ message }}</p>
        <div class="min-h-0 flex-1">
            <AgentProfileSettingsView
                data-lab-subject
                class="h-full"
                :model-value="modelValue"
                :baseline="baseline"
                :context="context"
                :loading="props.scene === 'loading'"
                :saving="saving"
                :load-error="loadError"
                :save-error="props.scene === 'save-error' ? '示例保存失败：后端返回 500。' : ''"
                @update:model-value="onUpdate"
                @save="onSave"
                @reload="onReload"
                @reset-home="onResetHome"
            />
        </div>
    </div>
</template>
