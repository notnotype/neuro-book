<script setup lang="ts">
import SharedDiffEditor from "nbook/app/components/common/diff/SharedDiffEditor.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(SharedDiffEditor, () => props.input);
</script>

<template>
    <SharedDiffEditor
        data-lab-subject
        class="h-full w-full min-w-0"
        style="height: min(70vh, 560px)"
        v-bind="subject.bindings.value"
    />
</template>
