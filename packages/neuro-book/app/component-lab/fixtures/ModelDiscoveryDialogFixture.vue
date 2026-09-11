<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ModelDiscoveryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelDiscoveryDialog.vue";
import {DISCOVERY_DIAGNOSTICS, DISCOVERY_MODEL_GROUPS, MANUAL_MODEL_DRAFT, MODEL_API_OPTIONS} from "./model-settings-fixture-data";
import type {ManualModelDraft} from "../../components/novel-ide/settings/sections/providers/provider-view-types";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "partial" | "empty" | "discovering";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "partial", "empty", "discovering"];
    return known.find((key) => key === props.scene) ?? "default";
});

const open = ref(true);
const searchQuery = ref("");
const expandedGroups = ref<Record<string, boolean>>({});
const manualDraft = ref<ManualModelDraft>({...MANUAL_MODEL_DRAFT});

const groups = computed(() => sceneKey.value === "empty" ? [] : DISCOVERY_MODEL_GROUPS);
const diagnostics = computed(() => sceneKey.value === "partial" ? DISCOVERY_DIAGNOSTICS : null);
const discovering = computed(() => sceneKey.value === "discovering");

function updateManualField(field: keyof ManualModelDraft, value: string): void {
    manualDraft.value = {...manualDraft.value, [field]: value};
    emitLabEvent("update-manual-field", {field, value});
}

watch(sceneKey, () => {
    open.value = true;
    searchQuery.value = "";
    expandedGroups.value = {};
    manualDraft.value = {...MANUAL_MODEL_DRAFT};
}, {immediate: true});

watch([open, searchQuery, sceneKey], () => {
    syncLabData({scene: sceneKey.value, searchQuery: searchQuery.value, models: groups.value.reduce((total, group) => total + group.models.length, 0)});
}, {immediate: true});
</script>

<template>
    <div class="h-full min-h-0 w-full p-[var(--space-6)]">
        <ModelDiscoveryDialog
            :model-value="open"
            provider-name="OpenAI"
            :groups="groups"
            :search-query="searchQuery"
            :discovering="discovering"
            :expanded-groups="expandedGroups"
            :diagnostics="diagnostics"
            :manual-draft="manualDraft"
            :model-api-options="MODEL_API_OPTIONS"
            @update:model-value="open = $event"
            @update:search-query="searchQuery = $event"
            @update-manual-field="updateManualField"
            @discover="emitLabEvent('discover')"
            @toggle-group="expandedGroups = {...expandedGroups, [$event]: expandedGroups[$event] === false}"
            @toggle-model="emitLabEvent('toggle-model', {id: $event.id})"
            @add-manual="emitLabEvent('add-manual')"
        />
    </div>
</template>
