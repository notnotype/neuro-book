<script setup lang="ts">
import RolesSettingsView from "../../components/novel-ide/settings/sections/roles/RolesSettingsView.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof RolesSettingsView>(() => props.input);
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <RolesSettingsView v-bind="subject.bindings.value" />
    </div>
</template>
