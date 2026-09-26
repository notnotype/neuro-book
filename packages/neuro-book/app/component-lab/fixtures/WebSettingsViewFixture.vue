<script setup lang="ts">
import WebSettingsView from "../../components/novel-ide/settings/sections/web/WebSettingsView.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof WebSettingsView>(() => props.input);
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <WebSettingsView v-bind="subject.bindings.value" />
        </div>
    </div>
</template>
