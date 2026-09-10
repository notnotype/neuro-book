<script setup lang="ts">
import {computed, ref, watch} from "vue";
import RolesSettingsView from "../../components/novel-ide/settings/sections/roles/RolesSettingsView.vue";
import {createRolesSettingsDraft} from "../../components/novel-ide/settings/sections/roles/roles-settings-draft";
import type {ModelRoleId, RolesSettingsDraft} from "../../components/novel-ide/settings/sections/roles/roles-settings-draft";
import {MODEL_DEFAULT_MODEL_OPTIONS} from "./model-settings-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "unconfigured" | "partially-configured" | "fully-configured" | "saving" | "save-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["unconfigured", "partially-configured", "fully-configured", "saving", "save-error"];
    return known.find((key) => key === props.scene) ?? "unconfigured";
});

function sceneDraft(scene: SceneKey): RolesSettingsDraft {
    const draft = createRolesSettingsDraft();
    if (scene === "partially-configured" || scene === "saving" || scene === "save-error") {
        draft.roles.main = "openai/gpt-5.1";
        draft.roles.summarize = "openai/o4-mini";
    }
    if (scene === "fully-configured") {
        const bound: Array<[ModelRoleId, string]> = [
            ["tiny", "openai/o4-mini"], ["fast", "openai/o4-mini"], ["main", "openai/gpt-5.1"], ["deep", "openai/gpt-5.1"],
            ["summarize", "openai/o4-mini"], ["writer", "openai/gpt-5.1"], ["narrative", "openai/gpt-5.1"],
            ["plan", "openai/gpt-5.1"], ["vision", "openai/o4-mini"],
        ];
        for (const [id, modelKey] of bound) {
            draft.roles[id] = modelKey;
        }
    }
    return draft;
}

const draft = ref<RolesSettingsDraft>(sceneDraft("unconfigured"));

const saving = computed(() => sceneKey.value === "saving");
const saveError = computed(() => sceneKey.value === "save-error" ? "示例后端返回 500" : "");

watch(sceneKey, (scene) => {
    draft.value = sceneDraft(scene);
}, {immediate: true});

watch([draft, sceneKey], () => {
    syncLabData({boundRoles: Object.values(draft.value.roles).filter(Boolean).length});
}, {immediate: true});

/** 就地保存：fixture 立刻接受新绑定并记录事件，不写 store、不发请求。 */
function updateDraft(value: RolesSettingsDraft): void {
    draft.value = value;
    emitLabEvent("update:modelValue", {boundRoles: Object.values(value.roles).filter(Boolean).length});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <RolesSettingsView
            :model-value="draft"
            :models="MODEL_DEFAULT_MODEL_OPTIONS"
            :saving="saving"
            :save-error="saveError"
            @update:model-value="updateDraft"
        />
    </div>
</template>
