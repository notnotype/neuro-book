<script setup lang="ts">
import {computed, ref, watch} from "vue";
import SecuritySettingsView from "../../components/novel-ide/settings/sections/SecuritySettingsView.vue";
import {useLabDataSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const syncLabData = useLabDataSink();

type SceneKey = "enabled" | "disabled" | "unknown";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["enabled", "disabled", "unknown"];
    return known.find((key) => key === props.scene) ?? "enabled";
});

function sceneAuthEnabled(scene: SceneKey): boolean | null {
    if (scene === "disabled") {
        return false;
    }
    if (scene === "unknown") {
        return null;
    }
    return true;
}

const authEnabled = ref<boolean | null>(sceneAuthEnabled("enabled"));

watch(sceneKey, (scene) => {
    authEnabled.value = sceneAuthEnabled(scene);
}, {immediate: true});

watch(authEnabled, () => {
    syncLabData({authEnabled: authEnabled.value});
}, {immediate: true});
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <SecuritySettingsView :auth-enabled="authEnabled" />
        </div>
    </div>
</template>
