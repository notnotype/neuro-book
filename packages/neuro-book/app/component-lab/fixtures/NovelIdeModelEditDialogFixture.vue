<script setup lang="ts">
import {computed, reactive, ref, watch} from "vue";
import NovelIdeModelEditDialog from "../../components/novel-ide/settings/sections/providers/components/NovelIdeModelEditDialog.vue";
import {MODEL_API_OPTIONS, buildModelSettingsDraft} from "./model-settings-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "missing-fields" | "confirm-mode";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "missing-fields", "confirm-mode"];
    return known.find((key) => key === props.scene) ?? "default";
});

const draft = reactive(buildModelSettingsDraft());
const open = ref(true);

/** 缺字段场景把一个只有 id 的模型摆进来，用来核对「空值占位」与必填提示。 */
const editingModel = computed(() => {
    if (sceneKey.value === "missing-fields") {
        return {...draft.providers[0]!.models[1]!, api: "", contextWindowTokens: "", maxTokens: "", reasoning: "inherit" as const};
    }
    return draft.providers[0]!.models[0] ?? null;
});
const missingFields = computed(() => sceneKey.value === "missing-fields" ? ["api", "contextWindowTokens"] : []);

function toggleModelInput(_model: unknown, inputKind: string): void {
    emitLabEvent("toggle-model-input", {inputKind});
}

watch(sceneKey, () => {
    open.value = true;
    syncLabData({scene: sceneKey.value, model: editingModel.value?.id ?? ""});
}, {immediate: true});
</script>

<template>
    <div class="h-full min-h-0 w-full p-[var(--space-6)]">
        <NovelIdeModelEditDialog
            :model-value="open"
            :editing-model="editingModel"
            :active-provider="{id: draft.providers[0]!.id, name: draft.providers[0]!.name}"
            :library-model="null"
            :confirm-mode="sceneKey === 'confirm-mode'"
            :missing-fields="missingFields"
            :model-api-options="MODEL_API_OPTIONS"
            :teleport-target="false"
            @update:model-value="open = $event"
            @confirm="emitLabEvent('confirm')"
            @model-id-change="emitLabEvent('model-id-change')"
            @toggle-model-input="toggleModelInput"
            @reset-model-input="emitLabEvent('reset-model-input', {model: $event.id})"
            @reset-model-cost="emitLabEvent('reset-model-cost', {model: $event.id})"
            @enable-model-cost="emitLabEvent('enable-model-cost', {model: $event.id})"
            @reapply-library="emitLabEvent('reapply-library', {model: $event.id})"
        />
    </div>
</template>
