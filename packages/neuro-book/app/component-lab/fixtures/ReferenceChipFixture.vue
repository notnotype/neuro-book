<script setup lang="ts">
import ReferenceChip from "nbook/app/components/common/ReferenceChip.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(ReferenceChip, () => props.input);
</script>

<template>
    <ReferenceChip
        data-lab-subject
        class="max-w-full"
        v-bind="subject.bindings.value"
    />
</template>
