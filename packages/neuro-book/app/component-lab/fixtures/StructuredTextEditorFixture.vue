<script setup lang="ts">
import StructuredTextEditor from "nbook/app/components/common/form/StructuredTextEditor.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof StructuredTextEditor>(() => props.input);
</script>

<template>
    <StructuredTextEditor
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    />
</template>
