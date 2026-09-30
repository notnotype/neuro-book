<script setup lang="ts">
import ProjectCreateCoverPreview from "nbook/app/components/novel-ide/project-picker/components/ProjectCreateCoverPreview.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectCreateCoverPreview>(() => props.input);
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-8" data-lab-subject>
        <div class="rounded-xl border border-[var(--border-color)] bg-[var(--bg-panel)] p-6 shadow-sm">
            <ProjectCreateCoverPreview v-bind="subject.bindings.value" />
        </div>
    </div>
</template>
