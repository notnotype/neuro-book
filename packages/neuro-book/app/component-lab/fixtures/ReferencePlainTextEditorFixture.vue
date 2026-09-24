<script setup lang="ts">
import ReferencePlainTextEditor from "../../components/common/form/ReferencePlainTextEditor.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(ReferencePlainTextEditor, () => props.input);
</script>

<template>
    <ReferencePlainTextEditor
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    />
</template>
