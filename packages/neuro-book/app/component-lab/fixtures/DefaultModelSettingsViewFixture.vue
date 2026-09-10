<script setup lang="ts">
import {computed, ref, watch} from "vue";
import DefaultModelSettingsView from "../../components/novel-ide/settings/sections/default-model/DefaultModelSettingsView.vue";
import {MODEL_DEFAULT_MODEL_OPTIONS} from "./model-settings-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "global" | "project-follow" | "project-override" | "no-models" | "saving" | "save-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["global", "project-follow", "project-override", "no-models", "saving", "save-error"];
    return known.find((key) => key === props.scene) ?? "global";
});

const modelKey = ref<string | null>("openai/gpt-5.1");

const models = computed(() => sceneKey.value === "no-models" ? [] : MODEL_DEFAULT_MODEL_OPTIONS);
const isProjectScope = computed(() => sceneKey.value.startsWith("project"));
const saving = computed(() => sceneKey.value === "saving");
const saveError = computed(() => sceneKey.value === "save-error" ? "示例后端返回 500" : "");

watch(sceneKey, (scene) => {
    if (scene === "project-follow" || scene === "no-models") {
        modelKey.value = null;
    } else if (scene === "project-override") {
        modelKey.value = "openai/o4-mini";
    } else {
        modelKey.value = "openai/gpt-5.1";
    }
}, {immediate: true});

watch([modelKey, sceneKey], () => {
    syncLabData({modelKey: modelKey.value, isProjectScope: isProjectScope.value});
}, {immediate: true});

/** 就地保存：fixture 立刻接受新值并记录事件，不写 store、不发请求。 */
function updateModelKey(value: string | null): void {
    modelKey.value = value;
    emitLabEvent("update:modelKey", {modelKey: value});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <DefaultModelSettingsView
            :model-key="modelKey"
            :models="models"
            :is-project-scope="isProjectScope"
            target-label="C:/novels/长夜行"
            :saving="saving"
            :save-error="saveError"
            @update:model-key="updateModelKey"
        />
    </div>
</template>
