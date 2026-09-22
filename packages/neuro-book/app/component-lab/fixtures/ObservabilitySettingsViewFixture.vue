<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ObservabilitySettingsView from "../../components/novel-ide/settings/sections/observability/ObservabilitySettingsView.vue";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "disabled" | "boundary";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "disabled", "boundary"];
    return known.find((key) => key === props.scene) ?? "default";
});

const enabled = ref(true);
const maxRecords = ref(100);

const disabled = computed(() => sceneKey.value === "disabled");

watch(sceneKey, (scene) => {
    enabled.value = scene !== "disabled";
    maxRecords.value = scene === "boundary" ? 0 : 100;
}, {immediate: true});

watch([enabled, maxRecords], () => {
    syncLabData({enabled: enabled.value, maxRecords: maxRecords.value});
}, {immediate: true});

/** 就地保存：fixture 立刻接受修改并记录事件，不保存到任何持久层。 */
function updateEnabled(value: boolean): void {
    enabled.value = value;
    emitLabEvent("update:enabled", {enabled: value});
}

function updateMaxRecords(value: number): void {
    maxRecords.value = value;
    emitLabEvent("update:maxRecords", {maxRecords: value});
}
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <ObservabilitySettingsView
                :enabled="enabled"
                :max-records="maxRecords"
                :disabled="disabled"
                @update:enabled="updateEnabled"
                @update:max-records="updateMaxRecords"
            />
        </div>
    </div>
</template>
