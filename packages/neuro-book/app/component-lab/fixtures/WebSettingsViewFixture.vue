<script setup lang="ts">
import {computed, ref, watch} from "vue";
import WebSettingsView from "../../components/novel-ide/settings/sections/web/WebSettingsView.vue";
import {createWebSettingsDraft, type WebSettingsDraft} from "../../components/novel-ide/settings/sections/web/web-settings-draft";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "configured" | "brave-first" | "local-fetch-off" | "saving" | "save-error" | "disabled";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "configured", "brave-first", "local-fetch-off", "saving", "save-error", "disabled"];
    return known.find((key) => key === props.scene) ?? "default";
});

const draft = ref<WebSettingsDraft>(createWebSettingsDraft());
const saveError = ref("");

const saving = computed(() => sceneKey.value === "saving" || sceneKey.value === "save-error");
const disabled = computed(() => sceneKey.value === "disabled");

watch(sceneKey, (scene) => {
    const base = createWebSettingsDraft();
    if (scene === "configured" || scene === "saving" || scene === "save-error") {
        base.tavily = {...base.tavily, enabled: true, apiKeyConfigured: true, apiKeyMaskedValue: "tvly-…9c21"};
        base.brave = {...base.brave, enabled: true, apiKeyConfigured: true, apiKeyMaskedValue: "BSA…4d7f"};
    }
    if (scene === "brave-first") {
        base.order = ["brave", "tavily"];
    }
    if (scene === "local-fetch-off") {
        base.localFetch = {...base.localFetch, enabled: false};
        base.tavilyFallback = {enabled: true, timeoutMs: "20000"};
    }
    draft.value = base;
    saveError.value = scene === "save-error" ? "示例后端返回 500" : "";
}, {immediate: true});

watch([draft, saving, disabled, saveError], () => {
    syncLabData({
        order: [...draft.value.order],
        tavilyEnabled: draft.value.tavily.enabled,
        braveEnabled: draft.value.brave.enabled,
        localFetchEnabled: draft.value.localFetch.enabled,
        tavilyFallbackEnabled: draft.value.tavilyFallback.enabled,
        saving: saving.value,
        disabled: disabled.value,
        saveError: saveError.value,
    });
}, {immediate: true, deep: true});

/** 就地保存：fixture 立刻接受草稿并记录事件，不写任何持久层。 */
function updateDraft(value: WebSettingsDraft): void {
    draft.value = value;
    emitLabEvent("update:modelValue", {order: value.order, tavilyEnabled: value.tavily.enabled, braveEnabled: value.brave.enabled});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <WebSettingsView
                :model-value="draft"
                :disabled="disabled"
                :saving="saving"
                :save-error="saveError"
                @update:model-value="updateDraft"
            />
        </div>
    </div>
</template>
