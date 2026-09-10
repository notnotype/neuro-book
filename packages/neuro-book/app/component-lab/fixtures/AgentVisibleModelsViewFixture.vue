<script setup lang="ts">
import {computed, ref, watch} from "vue";
import AgentVisibleModelsView from "../../components/novel-ide/settings/sections/agent-visible-models/AgentVisibleModelsView.vue";
import type {AgentVisibleModelDraft} from "../../components/novel-ide/settings/sections/providers/model-settings-draft";
import {MODEL_DEFAULT_MODEL_OPTIONS} from "./model-settings-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "with-invalid" | "over-limit" | "empty" | "project" | "saving" | "save-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "with-invalid", "over-limit", "empty", "project", "saving", "save-error"];
    return known.find((key) => key === props.scene) ?? "default";
});

const entries = ref<AgentVisibleModelDraft[]>([]);

function sceneEntries(scene: SceneKey): AgentVisibleModelDraft[] {
    if (scene === "empty" || scene === "project") {
        return [];
    }
    if (scene === "over-limit") {
        return Array.from({length: 6}, (_, index) => ({modelKey: "openai/gpt-5.1", note: `用途说明 ${String(index + 1)}`}));
    }
    if (scene === "with-invalid") {
        return [
            {modelKey: "openai/gpt-5.1", note: "主力写作模型"},
            {modelKey: "openai/retired-model", note: "已经下线的模型"},
        ];
    }
    return [{modelKey: "openai/gpt-5.1", note: "主力写作模型"}];
}

const isProjectScope = computed(() => sceneKey.value === "project");
const saving = computed(() => sceneKey.value === "saving");
const saveError = computed(() => sceneKey.value === "save-error" ? "示例后端返回 500" : "");

watch(sceneKey, (scene) => {
    entries.value = sceneEntries(scene);
}, {immediate: true});

watch([entries, sceneKey], () => {
    syncLabData({entries: entries.value.length, isProjectScope: isProjectScope.value});
}, {immediate: true});

/** 就地保存：fixture 立刻接受新清单并记录事件，不写 store、不发请求。 */
function updateEntries(value: AgentVisibleModelDraft[]): void {
    entries.value = value;
    emitLabEvent("update:modelValue", {entries: value.length});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <AgentVisibleModelsView
            :model-value="entries"
            :models="MODEL_DEFAULT_MODEL_OPTIONS"
            default-model-key="openai/gpt-5.1"
            :is-project-scope="isProjectScope"
            :saving="saving"
            :save-error="saveError"
            @update:model-value="updateEntries"
        />
    </div>
</template>
