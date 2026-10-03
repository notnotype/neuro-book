<script setup lang="ts">
import NovelIdeModelEditDialog from "../../components/novel-ide/settings/sections/providers/components/NovelIdeModelEditDialog.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof NovelIdeModelEditDialog>(() => props.input, ["confirm", "model-id-change", "toggle-model-input", "reset-model-input", "reset-model-cost", "enable-model-cost", "reapply-library"]);
</script>

<template>
    <div class="h-full min-h-0 w-full p-[var(--space-6)]">
        <NovelIdeModelEditDialog v-bind="subject.bindings.value" />
    </div>
</template>
