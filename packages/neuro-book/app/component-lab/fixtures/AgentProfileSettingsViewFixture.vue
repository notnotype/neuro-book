<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.types";
import AgentProfileSettingsView from "../../components/novel-ide/settings/sections/agent-profile/AgentProfileSettingsView.vue";
import type {AgentProfileDraft, AgentProfileModelDraft} from "../../components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import type {LowCodeFormDto} from "nbook/shared/dto/low-code-form.dto";
import {cloneModelDraft} from "../../components/novel-ide/settings/sections/agent-profile/agent-profile-draft";
import {createProfileRuntimeSettingsDraft} from "../../components/novel-ide/settings/sections/agent-profile/profile-runtime-settings";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";
const props = defineProps<{scene: string; data?: unknown}>();

const {t} = useI18n();
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

type SceneKey = "global" | "project" | "dialog-window" | "statuses" | "custom-settings" | "empty" | "loading" | "load-error";

const SAVED_HINT = "改动已就地保存到本次预览；未写入真实配置。";
const dialogOpen = ref(false);
const dialogWidth = ref(1100);
const dialogHeight = ref<string | number>("calc(100dvh - 120px)");

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
        case "dialog-window": {
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
// saved：fixture 模拟的宿主持久化状态。视图是就地保存的，没有单独的保存动作。
const saved = ref<AgentProfileSettingsPageDraft>(pageDraftFor("global"));
const message = ref("");
const loadError = ref("");

function sceneState(scene: SceneKey) {
    const draft = pageDraftFor(scene);
    const savedSnapshot = pageDraftFor(scene);
    return {draft, saved: savedSnapshot};
}

function isSceneKey(value: string): value is SceneKey {
    return ["global", "project", "dialog-window", "statuses", "custom-settings", "empty", "loading", "load-error"].includes(value);
}

const sceneKey = computed<SceneKey>(() => isSceneKey(props.scene) ? props.scene : "global");
const isDialogScene = computed(() => sceneKey.value === "dialog-window");
const isLoadingScene = computed(() => sceneKey.value === "loading");

function applyScene(): void {
    const state = sceneState(sceneKey.value);
    modelValue.value = state.draft;
    saved.value = state.saved;
    dialogOpen.value = isDialogScene.value;
    loadError.value = sceneKey.value === "load-error" ? "读取 Agent Profile 设定失败：配置文件不可读。" : "";
    message.value = "";
}

const context = computed(() => buildContext(sceneKey.value));

// 作用域是宿主 chrome 的职责：Lab 里把它拼进窗口标题，产品里由设置对话框自己表达。
const scopeLabel = computed(() => context.value.scope === "project"
    ? t("settings.panels.profileModels.settingsView.scopeProject", {target: "示例项目"})
    : t("settings.panels.profileModels.settingsView.scopeGlobal"));

function labData() {
    return {draft: modelValue.value, saved: saved.value, message: message.value};
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
watch([modelValue, saved, message], () => syncLabData(JSON.parse(JSON.stringify(labData()))), {deep: true, immediate: true});

/**
 * 就地保存：视图每次修改都直接交给宿主，这里模拟宿主立即持久化。
 */
function onUpdate(value: AgentProfileSettingsPageDraft): void {
    modelValue.value = value;
    emitLabEvent("update:modelValue", value);
    saved.value = JSON.parse(JSON.stringify(value));
    message.value = SAVED_HINT;
    emitLabEvent("saved", value);
}

function onReload(): void {
    emitLabEvent("reload", undefined);
    message.value = "已记录重新加载请求；预览不访问真实配置。";
}

function onDialogClose(reason: "close-button" | "esc"): void {
    dialogOpen.value = false;
    emitLabEvent("dialog-window:request-close", reason);
}

function reopenDialog(): void {
    dialogOpen.value = true;
    emitLabEvent("dialog-window:open");
}
</script>

<template>
    <div class="flex h-full max-h-full min-h-0 w-full flex-col gap-2">
        <p v-if="message" class="shrink-0 rounded-[var(--radius-control)] border border-[var(--status-success-border)] bg-[var(--status-success-bg)] px-3 py-1.5 text-[11px] text-[var(--status-success)]">{{ message }}</p>
        <div v-if="isDialogScene && !dialogOpen" class="flex min-h-0 flex-1 items-center justify-center">
            <button type="button" class="rounded-[var(--radius-control)] bg-[var(--accent-bg)] px-3 py-2 text-sm text-[var(--accent-text)]" @click="reopenDialog">
                打开 Agent Profile 设置窗口
            </button>
        </div>
        <div v-else-if="isDialogScene" class="min-h-0 flex-1">
            <DialogWindow
                :model-value="dialogOpen"
                :width="dialogWidth"
                :height="dialogHeight"
                :min-width="720"
                :min-height="520"
                :resizable="true"
                :body-class="'min-h-0 flex-1 overflow-hidden p-0'"
                @update:model-value="dialogOpen = $event"
                @request-close="onDialogClose"
                @update:width="dialogWidth = $event"
                @update:height="dialogHeight = $event"
            >
                <template #header>
                    <span>Agent Profile 设置</span>
                    <span class="ml-2 text-[var(--text-muted)]">·</span>
                    <span class="ml-1.5 text-[var(--text-muted)]">{{ scopeLabel }}</span>
                </template>
                <AgentProfileSettingsView
                    :key="sceneKey"
                    class="h-full"
                    data-lab-subject
                    :model-value="modelValue"
                    :context="context"
                    :show-nav-heading="false"
                    :loading="isLoadingScene"
                    :load-error="loadError"
                    @update:model-value="onUpdate"
                    @reload="onReload"
                />
            </DialogWindow>
        </div>
        <div v-else class="min-h-0 flex-1">
            <AgentProfileSettingsView
                :key="sceneKey"
                class="h-full"
                data-lab-subject
                :model-value="modelValue"
                :context="context"
                :loading="isLoadingScene"
                :load-error="loadError"
                @update:model-value="onUpdate"
                @reload="onReload"
            />
        </div>
    </div>
</template>
