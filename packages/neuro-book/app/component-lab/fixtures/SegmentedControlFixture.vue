<script setup lang="ts">
import SegmentedControl from "../../components/common/form/SegmentedControl.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof SegmentedControl>(() => props.input);
</script>

<template>
    <SegmentedControl
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    />
</template>
