<script setup lang="ts">
import ProjectPickerEmptyState from "nbook/app/components/novel-ide/project-picker/components/ProjectPickerEmptyState.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectPickerEmptyState>(() => props.input, ["create-book"]);
</script>

<template>
    <div class="flex h-full w-full items-center justify-center p-6">
        <ProjectPickerEmptyState
            data-lab-subject
            class="w-full"
            v-bind="subject.bindings.value"
        />
    </div>
</template>
