<script setup lang="ts">
import EmbeddingSettingsView from "../../components/novel-ide/settings/sections/embedding/EmbeddingSettingsView.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof EmbeddingSettingsView>(() => props.input);
</script>

<template>
    <div class="h-full min-h-0 w-full overflow-y-auto p-[var(--space-6)]">
        <div class="max-w-3xl">
            <EmbeddingSettingsView v-bind="subject.bindings.value" />
        </div>
    </div>
</template>
