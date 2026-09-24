<script setup lang="ts">
import {ref, computed, watch} from "vue";
import AgentSessionModelControls from "../../components/novel-ide/agent/panels/header/AgentSessionModelControls.vue";
import type {AgentSessionModelDraft} from "../../components/novel-ide/agent/agent-session-model-controls";
import type {ModelPickerRoleItem} from "../../components/novel-ide/model-picker/model-picker.types";
import {useLabEventSink} from "../lab-event-sink";
import LabFixtureControls from "../LabFixtureControls.vue";
import {Switch} from "@notnotype/nb-ui/components";

import {MODEL_DEFAULT_MODEL_OPTIONS} from "./model-settings-fixture-data";

const props = defineProps<{
    scene: string;
    data?: unknown;
}>();

const emitLabEvent = useLabEventSink();

const popoverOpen = ref(props.scene === "open" || props.scene === "with-specialist");
const modelSelection = ref<string | null>("openai/gpt-5.1");
const showSpecialistInPicker = ref(props.scene !== "gradient-only");

const draft = ref<AgentSessionModelDraft>({
    modelKey: "openai/gpt-5.1",
    reasoningEffort: "medium",
});

const roles = ref<ModelPickerRoleItem[]>([
    {
        id: "tiny",
        axis: "gradient",
        name: "极轻量",
        description: "会话标题、简单打标、轻量检索",
        modelKey: "openai/o4-mini",
        modelLabel: "o4-mini",
        iconClass: "i-lucide-feather",
        enabled: true,
    },
    {
        id: "fast",
        axis: "gradient",
        name: "快速",
        description: "日常问答、快速搜索、简单改写",
        modelKey: "openai/o4-mini",
        modelLabel: "o4-mini",
        iconClass: "i-lucide-zap",
        enabled: true,
    },
    {
        id: "main",
        axis: "gradient",
        name: "主力",
        description: "主会话、综合分析、长篇写作",
        modelKey: "openai/gpt-5.1",
        modelLabel: "GPT-5.1",
        iconClass: "i-lucide-star",
        enabled: true,
    },
    {
        id: "deep",
        axis: "gradient",
        name: "深度",
        description: "复杂规划、难点分析、深度推理",
        modelKey: "openai/gpt-5.1",
        modelLabel: "GPT-5.1",
        iconClass: "i-lucide-brain",
        enabled: true,
    },
    {
        id: "writer",
        axis: "specialist",
        name: "写作",
        description: "小说正文与段落润色",
        modelKey: "openai/gpt-5.1",
        modelLabel: "GPT-5.1",
        iconClass: "i-lucide-pen-line",
        enabled: true,
    },
    {
        id: "narrative",
        axis: "specialist",
        name: "叙事",
        description: "剧情设计与伏笔规划",
        modelKey: "openai/gpt-5.1",
        modelLabel: "GPT-5.1",
        iconClass: "i-lucide-book-open",
        enabled: true,
    },
    {
        id: "plan",
        axis: "specialist",
        name: "计划",
        description: "进入计划模式后切换的模型",
        modelKey: "openai/gpt-5.1",
        modelLabel: "GPT-5.1",
        iconClass: "i-lucide-map",
        enabled: true,
    },
]);

const selectableModels = MODEL_DEFAULT_MODEL_OPTIONS;

const readonly = computed(() => props.scene === "readonly");
const saving = computed(() => props.scene === "saving");

watch(() => props.scene, (scene) => {
    if (scene === "open" || scene === "with-specialist") {
        popoverOpen.value = true;
    } else if (scene === "closed") {
        popoverOpen.value = false;
    }
    if (scene === "gradient-only") {
        showSpecialistInPicker.value = false;
        popoverOpen.value = true;
    }
});
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-4">
        <AgentSessionModelControls
            data-lab-subject
            v-model:session-model-popover-open="popoverOpen"
            v-model:session-model-draft="draft"
            :session-model-selection-value="modelSelection"
            session-thinking-resolved-label="中 (medium)"
            :selectable-models="selectableModels"
            :roles="roles"
            :show-specialist-in-picker="showSpecialistInPicker"
            :session-model-saving="saving"
            :readonly="readonly"
            dropdown-direction="down"
            popover-class="w-[560px]"
            @update-session-model-selection="modelSelection = $event; emitLabEvent('update-selection', $event)"
            @toggle-session-model-popover="popoverOpen = !popoverOpen"
            @apply-session-model-settings="emitLabEvent('apply-settings')"
            @reset-session-model-settings="emitLabEvent('reset-settings')"
        />
    </div>

    <LabFixtureControls>
        <div class="flex items-center gap-3 py-1 text-xs select-none">
            <span class="font-medium text-[var(--text-secondary)]">专精角色:</span>
            <div class="flex items-center gap-2 rounded-[var(--radius-control)] border border-[var(--border-color)] bg-[var(--panel-surface)] px-2.5 py-1 shadow-xs">
                <span class="text-[11px] text-[var(--text-main)]">{{ showSpecialistInPicker ? "显示" : "隐藏" }}</span>
                <Switch
                    :model-value="showSpecialistInPicker"
                    size="sm"
                    aria-label="切换专精角色显示"
                    @update:model-value="showSpecialistInPicker = $event"
                />
            </div>
        </div>
    </LabFixtureControls>
</template>
