<script setup lang="ts">
import {computed, ref, watch} from "vue";
import ModelLibraryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelLibraryDialog.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ModelLibraryDialog>(() => props.input, ["toggle-group", "toggle-model"]);
const enabledModelIds = ref(new Set(["gpt-5.1"]));
watch(() => props.scene, () => { enabledModelIds.value = new Set(["gpt-5.1"]); });
const viewBindings = computed(() => ({...subject.bindings.value, enabledModelIds: enabledModelIds.value}));
function toggleGroup(group: string): void {
    const current = subject.bindings.value.expandedGroups;
    subject.write("props", "expandedGroups", {...current, [group]: current[group] === false});
}
function toggleModel(id: string): void {
    const next = new Set(enabledModelIds.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    enabledModelIds.value = next;
}
</script>

<template>
    <div class="h-full min-h-0 w-full p-[var(--space-6)]">
        <ModelLibraryDialog
            v-bind="viewBindings"
            @toggle-group="toggleGroup($event)"
            @toggle-model="toggleModel($event.id)"
        />
    </div>
</template>
