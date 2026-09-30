<script setup lang="ts">
import {computed} from "vue";
import DiffWorkbench from "nbook/app/components/common/diff/DiffWorkbench.vue";
import type {DiffWorkbenchDocument} from "nbook/app/components/common/diff/diff-workbench.types";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof DiffWorkbench>(() => props.input, ["update:mode", "update:resultContent", "save-request"]);
const document = computed(() => props.input?.props?.document as DiffWorkbenchDocument | undefined);
</script>

<template>
    <DiffWorkbench
        data-lab-subject
        class="h-full w-full min-w-0"
        style="height: min(70vh, 640px)"
        v-bind="subject.bindings.value"
        @update:result-content="subject.write('props', 'document', {...document, resultContent: $event})"
    />
</template>
