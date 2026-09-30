<script setup lang="ts">
import ModelDiscoveryDialog from "../../components/novel-ide/settings/sections/providers/components/ModelDiscoveryDialog.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ModelDiscoveryDialog>(() => props.input, ["update-manual-field", "discover", "toggle-group", "toggle-model", "add-manual"]);

function updateManualField(field: string, value: string): void {
    subject.write("props", "manualDraft", {...subject.bindings.value.manualDraft, [field]: value});
}

function toggleGroup(group: string): void {
    subject.write("props", "expandedGroups", {...subject.bindings.value.expandedGroups, [group]: subject.bindings.value.expandedGroups[group] === false});
}
</script>

<template>
    <div class="h-full min-h-0 w-full p-[var(--space-6)]">
        <ModelDiscoveryDialog
            v-bind="subject.bindings.value"
            @update-manual-field="updateManualField"
            @toggle-group="toggleGroup"
        />
    </div>
</template>
