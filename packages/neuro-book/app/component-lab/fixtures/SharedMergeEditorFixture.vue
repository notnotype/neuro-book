<script setup lang="ts">
import SharedMergeEditor from "nbook/app/components/common/diff/SharedMergeEditor.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof SharedMergeEditor>(() => props.input);
</script>

<template>
    <SharedMergeEditor
        data-lab-subject
        class="h-full w-full min-w-0"
        style="height: min(80vh, 720px)"
        v-bind="subject.bindings.value"
    />
</template>
