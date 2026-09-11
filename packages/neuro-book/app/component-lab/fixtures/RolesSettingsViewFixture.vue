<script setup lang="ts">
import {computed, ref, watch} from "vue";
import RolesSettingsView from "../../components/novel-ide/settings/sections/roles/RolesSettingsView.vue";
import {createRolesSettingsDraft} from "../../components/novel-ide/settings/sections/roles/roles-settings-draft";
import type {ModelRoleAxis, RolesSettingsDraft} from "../../components/novel-ide/settings/sections/roles/roles-settings-draft";
import {MODEL_DEFAULT_MODEL_OPTIONS} from "./model-settings-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const {t} = useI18n();
const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "unconfigured" | "partially-configured" | "fully-configured" | "saving" | "save-error";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["unconfigured", "partially-configured", "fully-configured", "saving", "save-error"];
    return known.find((key) => key === props.scene) ?? "unconfigured";
});

function bind(draft: RolesSettingsDraft, id: string, modelKey: string): void {
    for (const axis of ["gradient", "specialist"] as ModelRoleAxis[]) {
        const role = draft[axis].find((item) => item.id === id);
        if (role) {
            role.modelKey = modelKey;
            return;
        }
    }
}

function boundCount(draft: RolesSettingsDraft): number {
    return [...draft.gradient, ...draft.specialist].filter((role) => role.modelKey).length;
}

function sceneDraft(scene: SceneKey): RolesSettingsDraft {
    const draft = createRolesSettingsDraft(t);
    if (scene === "partially-configured" || scene === "saving" || scene === "save-error") {
        bind(draft, "main", "openai/gpt-5.1");
        bind(draft, "summarize", "openai/o4-mini");
    }
    if (scene === "fully-configured") {
        for (const id of ["tiny", "fast", "main", "deep"]) {
            bind(draft, id, id === "main" || id === "deep" ? "openai/gpt-5.1" : "openai/o4-mini");
        }
        for (const id of ["summarize", "writer", "narrative", "plan", "vision"]) {
            bind(draft, id, id === "summarize" || id === "vision" ? "openai/o4-mini" : "openai/gpt-5.1");
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
    syncLabData({boundRoles: boundCount(draft.value)});
}, {immediate: true});

/** 就地保存：fixture 立刻接受新绑定并记录事件，不写 store、不发请求。 */
function updateDraft(value: RolesSettingsDraft): void {
    draft.value = value;
    emitLabEvent("update:modelValue", {boundRoles: boundCount(value)});
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
