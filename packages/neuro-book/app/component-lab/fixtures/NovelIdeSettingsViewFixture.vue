<script setup lang="ts">
import {computed, ref, watch} from "vue";
import {DialogWindow} from "@notnotype/nb-ui/components";
import AgentProfileSettingsView from "../../components/novel-ide/settings/agent-profile/AgentProfileSettingsView.vue";
import type {AgentProfileSettingsContext, AgentProfileSettingsPageDraft} from "../../components/novel-ide/settings/agent-profile/AgentProfileSettingsView.types";
import type {AgentProfileDraft} from "../../components/novel-ide/settings/agent-profile/agent-profile-draft";
import {cloneModelDraft} from "../../components/novel-ide/settings/agent-profile/agent-profile-draft";
import {createProfileRuntimeSettingsDraft} from "../../components/novel-ide/settings/agent-profile/profile-runtime-settings";
import NovelIdeSettingsView from "../../components/novel-ide/settings/NovelIdeSettingsView.vue";
import CostSettingsView from "../../components/novel-ide/settings/cost/CostSettingsView.vue";
import EmbeddingSettingsView from "../../components/novel-ide/settings/embedding/EmbeddingSettingsView.vue";
import {createEmbeddingSettingsDraft} from "../../components/novel-ide/settings/embedding/embedding-settings-draft";
import ObservabilitySettingsView from "../../components/novel-ide/settings/observability/ObservabilitySettingsView.vue";
import type {
    SettingsScopeId,
    SettingsScopeOption,
    SettingsSectionOption,
} from "../../components/novel-ide/settings/NovelIdeSettingsView.types";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "global" | "project" | "dialog-window" | "loading" | "load-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["global", "project", "dialog-window", "loading", "load-error"];
    return known.find((key) => key === props.scene) ?? "global";
});

/**
 * 外壳的作用域与区段都由宿主给：本批次只有 agent-profile-models 有可渲染的区段体，
 * 另外两档作用域先在 Lab 里标为不可进入，而不是摆一个点不动的空列表。
 */
const scopeOptions: SettingsScopeOption[] = [
    {value: "boot", label: "启动", description: "启动期安全配置，只读说明", disabledReason: "本批次未迁移该作用域的区段"},
    {value: "global", label: "全局", description: "写入全局配置文件"},
    {value: "project", label: "项目", description: "写入当前项目配置"},
    {value: "browser", label: "本机", description: "写入本机浏览器状态", disabledReason: "本批次未迁移该作用域的区段"},
];

const sectionOptions: SettingsSectionOption[] = [
    {
        value: "agent-profile-models",
        label: "Agent Profile 模型",
        description: "Profile 的模型、运行策略与专属设置",
        iconClass: "i-lucide-bot-message-square",
        scopes: ["global", "project"],
    },
    {
        value: "embedding",
        label: "向量嵌入",
        description: "向量服务与项目覆盖",
        iconClass: "i-lucide-binary",
        scopes: ["global"],
    },
    {
        value: "cost",
        label: "费用显示",
        description: "展示币种与 USD/CNY 汇率",
        iconClass: "i-lucide-circle-dollar-sign",
        scopes: ["global"],
    },
    {
        value: "observability",
        label: "可观测",
        description: "Pi 请求 trace 记录开关与保留策略",
        iconClass: "i-lucide-activity",
        scopes: ["global"],
    },
];

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

function baseProfile(profileKey: string, name: string): AgentProfileDraft {
    return {
        profileKey,
        name,
        canResetHome: true,
        model: cloneModelDraft(undefined),
        loadStatus: "loaded",
        runtime: createProfileRuntimeSettingsDraft(undefined),
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

function buildContext(scope: SettingsScopeId): AgentProfileSettingsContext {
    return {
        scope: scope === "project" ? "project" : "global",
        inheritedDefaultProfileKey: "story-writer",
        globalModelDefaults: {modelKey: null, temperature: null, topK: null, reasoningEffort: "off" as const, stream: true},
        globalProfileModels: {},
        settings: buildSettingsMeta(),
        descriptions: {
            "story-writer": "负责章节初稿的连续写作。",
            "line-editor": "对成稿逐段润色语气与节奏。",
        },
    };
}

function buildDraft(): AgentProfileSettingsPageDraft {
    return {
        defaultProfileKey: "",
        modelDefaults: cloneModelDraft(undefined),
        runtimeDefaults: createProfileRuntimeSettingsDraft(undefined),
        profiles: [baseProfile("story-writer", "故事写手"), baseProfile("line-editor", "行文编辑")],
    };
}

const scope = ref<SettingsScopeId>("global");
const activeSection = ref("agent-profile-models");
/** 配置目标只在项目作用域下有值：跟着作用域走，而不是跟着场景。 */
const targetLabel = computed(() => scope.value === "project" ? "C:/novels/长夜行" : "");
const settingsDraft = ref<AgentProfileSettingsPageDraft>(buildDraft());
const traceEnabled = ref(true);
const traceMaxRecords = ref(100);
const costCurrency = ref<"USD" | "CNY">("USD");
const embeddingDraft = ref(createEmbeddingSettingsDraft());
const exchangeRate = ref<number | null>(7.2413);
const dialogOpen = ref(false);
const dialogWidth = ref(1100);
const dialogHeight = ref<string | number>("calc(100dvh - 120px)");

const loading = computed(() => sceneKey.value === "loading");
const loadError = computed(() => sceneKey.value === "load-error" ? "读取设置失败：示例后端返回 500。" : "");
const isDialogScene = computed(() => sceneKey.value === "dialog-window");

watch(sceneKey, (scene) => {
    scope.value = scene === "project" ? "project" : "global";
    activeSection.value = "agent-profile-models";
    settingsDraft.value = buildDraft();
    dialogOpen.value = scene === "dialog-window";
}, {immediate: true});

watch([scope, activeSection, loading, loadError], () => {
    syncLabData({
        scope: scope.value,
        activeSection: activeSection.value,
        traceEnabled: traceEnabled.value,
        traceMaxRecords: traceMaxRecords.value,
        costCurrency: costCurrency.value,
        embeddingGlobal: {...embeddingDraft.value.global},
        loading: loading.value,
        loadError: loadError.value,
    });
}, {immediate: true});

function emitScopeChange(value: SettingsScopeId): void {
    emitLabEvent("update:scope", {scope: value});
}

function emitSectionChange(value: string): void {
    emitLabEvent("update:modelValue", {section: value});
}

function openDialog(): void {
    dialogOpen.value = true;
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col">
        <div v-if="!isDialogScene" class="min-h-0 flex-1">
            <NovelIdeSettingsView
                :scope="scope"
                :scopes="scopeOptions"
                :sections="sectionOptions"
                :model-value="activeSection"
                :target-label="targetLabel"
                version-label="v0.0.0 · Lab"
                :loading="loading"
                :load-error="loadError"
                @update:scope="scope = $event; emitScopeChange($event)"
                @update:model-value="activeSection = $event; emitSectionChange($event)"
            >
                <AgentProfileSettingsView
                    v-if="activeSection === 'agent-profile-models'"
                    v-model="settingsDraft"
                    :context="buildContext(scope)"
                    :show-nav-heading="false"
                />
                <ObservabilitySettingsView
                    v-else-if="activeSection === 'observability'"
                    :enabled="traceEnabled"
                    :max-records="traceMaxRecords"
                    @update:enabled="traceEnabled = $event"
                    @update:max-records="traceMaxRecords = $event"
                />

                <CostSettingsView
                    v-else-if="activeSection === 'cost'"
                    :currency="costCurrency"
                    :exchange-rate="exchangeRate"
                    @update:currency="costCurrency = $event"
                    @refresh-rate="exchangeRate = 7.2455"
                />

                <EmbeddingSettingsView
                    v-else-if="activeSection === 'embedding'"
                    v-model="embeddingDraft"
                    scope="global"
                />
            </NovelIdeSettingsView>
        </div>

        <div v-else class="flex h-full min-h-0 flex-col items-start gap-3">
            <button
                v-if="!dialogOpen"
                type="button"
                class="inline-flex h-8 items-center rounded-[var(--radius-control)] border border-[var(--divider)] px-3 text-xs text-[var(--text-main)] hover:bg-[var(--bg-hover)]"
                @click="openDialog"
            >
                打开设置窗口
            </button>
            <DialogWindow
                v-model="dialogOpen"
                title-align="center"
                :width="dialogWidth"
                :height="dialogHeight"
                resizable
                :min-width="720"
                :min-height="420"
                @update:width="dialogWidth = $event"
                @update:height="dialogHeight = $event"
            >
                <template #header>
                    <span class="text-sm font-semibold text-[var(--text-main)]">设置 · 全局</span>
                </template>
                <NovelIdeSettingsView
                    :scope="scope"
                    :scopes="scopeOptions"
                    :sections="sectionOptions"
                    :model-value="activeSection"
                    :target-label="targetLabel"
                    version-label="v0.0.0 · Lab"
                    :loading="loading"
                    :load-error="loadError"
                    @update:scope="scope = $event; emitScopeChange($event)"
                    @update:model-value="activeSection = $event; emitSectionChange($event)"
                >
                    <AgentProfileSettingsView
                        v-if="activeSection === 'agent-profile-models'"
                        v-model="settingsDraft"
                        :context="buildContext(scope)"
                        :show-nav-heading="false"
                    />
                    <ObservabilitySettingsView
                        v-else-if="activeSection === 'observability'"
                        :enabled="traceEnabled"
                        :max-records="traceMaxRecords"
                        @update:enabled="traceEnabled = $event"
                        @update:max-records="traceMaxRecords = $event"
                    />

                    <CostSettingsView
                        v-else-if="activeSection === 'cost'"
                        :currency="costCurrency"
                        :exchange-rate="exchangeRate"
                        @update:currency="costCurrency = $event"
                        @refresh-rate="exchangeRate = 7.2455"
                    />

                    <EmbeddingSettingsView
                        v-else-if="activeSection === 'embedding'"
                        v-model="embeddingDraft"
                        scope="global"
                    />
                </NovelIdeSettingsView>
            </DialogWindow>
        </div>
    </div>
</template>
