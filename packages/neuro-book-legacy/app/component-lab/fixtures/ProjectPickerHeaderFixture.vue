<script setup lang="ts">
import ProjectPickerHeader from "nbook/app/components/novel-ide/project-picker/components/ProjectPickerHeader.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof ProjectPickerHeader>(() => props.input, ["open-user-assets", "create-book"]);
</script>

<template>
    <div class="w-full p-6">
        <ProjectPickerHeader
            data-lab-subject
            class="w-full"
            v-bind="subject.bindings.value"
        />
    </div>
</template>
