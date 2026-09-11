<script setup lang="ts">
import {computed, ref, watch} from "vue";
import WebSettingsView from "../../components/novel-ide/settings/sections/web/WebSettingsView.vue";
import {createWebSettingsDraft, type WebSettingsDraft} from "../../components/novel-ide/settings/sections/web/web-settings-draft";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "configured" | "brave-first" | "local-fetch-off" | "disabled";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "configured", "brave-first", "local-fetch-off", "disabled"];
    return known.find((key) => key === props.scene) ?? "default";
});

const draft = ref<WebSettingsDraft>(createWebSettingsDraft());

const disabled = computed(() => sceneKey.value === "disabled");

watch(sceneKey, (scene) => {
    const base = createWebSettingsDraft();
    if (scene === "configured") {
        base.providers.tavily = {...base.providers.tavily, enabled: true, apiKeyConfigured: true, apiKeyMaskedValue: "tvly-…9c21"};
        base.providers.brave = {...base.providers.brave, enabled: true, apiKeyConfigured: true, apiKeyMaskedValue: "BSA…4d7f"};
    }
    if (scene === "brave-first") {
        base.order = ["brave", "tavily"];
    }
    if (scene === "local-fetch-off") {
        base.localFetch = {...base.localFetch, enabled: false};
        base.tavilyFallback = {enabled: true, timeoutMs: "20000"};
    }
    draft.value = base;
}, {immediate: true});

watch([draft, disabled], () => {
    syncLabData({
        order: [...draft.value.order],
        tavilyEnabled: draft.value.providers.tavily.enabled,
        braveEnabled: draft.value.providers.brave.enabled,
        localFetchEnabled: draft.value.localFetch.enabled,
        tavilyFallbackEnabled: draft.value.tavilyFallback.enabled,
        disabled: disabled.value,
    });
}, {immediate: true, deep: true});

/** 就地保存：fixture 立刻接受草稿并记录事件，不写任何持久层。 */
function updateDraft(value: WebSettingsDraft): void {
    draft.value = value;
    emitLabEvent("update:modelValue", {order: value.order, tavilyEnabled: value.providers.tavily.enabled, braveEnabled: value.providers.brave.enabled});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <WebSettingsView
                :model-value="draft"
                :disabled="disabled"
                @update:model-value="updateDraft"
            />
        </div>
    </div>
</template>
