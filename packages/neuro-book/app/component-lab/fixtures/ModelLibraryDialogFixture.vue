<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ModelLibraryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelLibraryDialog.vue";
import {MODEL_LIBRARY_GROUPS} from "./model-settings-fixture-data";
import {useLabDataSink, useLabEventSink} from "../lab-event-sink";

const props = defineProps<{scene: string; data?: unknown}>();

const emitLabEvent = useLabEventSink();
const syncLabData = useLabDataSink();

type SceneKey = "default" | "empty" | "searching";

const sceneKey = computed<SceneKey>(() => {
    const known: SceneKey[] = ["default", "empty", "searching"];
    return known.find((key) => key === props.scene) ?? "default";
});

const open = ref(true);
const searchQuery = ref("");
const expandedGroups = ref<Record<string, boolean>>({});
const groups = computed(() => sceneKey.value === "empty" ? [] : MODEL_LIBRARY_GROUPS);
const enabledModelIds = new Set(["gpt-5.1"]);

watch(sceneKey, (scene) => {
    open.value = true;
    searchQuery.value = scene === "searching" ? "gpt" : "";
    expandedGroups.value = {};
}, {immediate: true});

watch([open, searchQuery, sceneKey], () => {
    syncLabData({scene: sceneKey.value, searchQuery: searchQuery.value, groups: groups.value.length});
}, {immediate: true});
</script>

<template>
    <div class="h-full min-h-0 w-full p-[var(--space-6)]">
        <ModelLibraryDialog
            :model-value="open"
            :groups="groups"
            :search-query="searchQuery"
            :expanded-groups="expandedGroups"
            :enabled-model-ids="enabledModelIds"
            @update:model-value="open = $event"
            @update:search-query="searchQuery = $event"
            @toggle-group="expandedGroups = {...expandedGroups, [$event]: expandedGroups[$event] === false}"
            @toggle-model="emitLabEvent('toggle-model', {id: $event.id})"
        />
    </div>
</template>
