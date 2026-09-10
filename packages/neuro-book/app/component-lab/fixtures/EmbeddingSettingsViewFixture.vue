<script setup lang="ts">
import {computed, ref, watch} from "vue";
import EmbeddingSettingsView from "../../components/novel-ide/settings/sections/embedding/EmbeddingSettingsView.vue";
import {
    createEmbeddingSettingsDraft,
    type EmbeddingSettingsDraft,
} from "../../components/novel-ide/settings/sections/embedding/embedding-settings-draft";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "global-disabled" | "global-enabled" | "global-api-key" | "project-inherit" | "project-override" | "saving" | "save-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["global-disabled", "global-enabled", "global-api-key", "project-inherit", "project-override", "saving", "save-error"];
    return known.find((key) => key === props.scene) ?? "global-disabled";
});

const draft = ref<EmbeddingSettingsDraft>(createEmbeddingSettingsDraft());
const saveError = ref("");

const scope = computed(() => sceneKey.value.startsWith("project") ? "project" as const : "global" as const);
const saving = computed(() => sceneKey.value === "saving" || sceneKey.value === "save-error");

watch(sceneKey, (scene) => {
    const base = createEmbeddingSettingsDraft();
    if (scene === "global-enabled" || scene === "saving" || scene === "save-error") {
        base.global = {
            ...base.global,
            enabled: true,
            model: "text-embedding-3-small",
            dimensions: "1536",
            baseURL: "https://api.openai.com/v1",
            timeoutMs: "30000",
            requestOptions: "{\n  \"encoding_format\": \"float\"\n}",
        };
    }
    if (scene === "global-api-key") {
        base.global = {
            ...base.global,
            enabled: true,
            apiKeyConfigured: true,
            apiKeyMaskedValue: "sk-…7f3a",
        };
    }
    if (scene === "project-override") {
        base.project = {model: "text-embedding-3-large", dimensions: "3072"};
    }
    draft.value = base;
    saveError.value = scene === "save-error" ? "示例后端返回 500" : "";
}, {immediate: true});

watch([draft, saving, saveError], () => {
    syncLabData({
        scope: scope.value,
        global: {...draft.value.global},
        project: {...draft.value.project},
        saving: saving.value,
        saveError: saveError.value,
    });
}, {immediate: true, deep: true});

/** 就地保存：fixture 立刻接受草稿并记录事件，不写任何持久层。 */
function updateDraft(value: EmbeddingSettingsDraft): void {
    draft.value = value;
    emitLabEvent("update:modelValue", {global: value.global, project: value.project});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <EmbeddingSettingsView
                :model-value="draft"
                :scope="scope"
                :target-label="scope === 'project' ? 'C:/novels/长夜行' : ''"
                :saving="saving"
                :save-error="saveError"
                @update:model-value="updateDraft"
            />
        </div>
    </div>
</template>
