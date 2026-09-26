<script setup lang="ts">
import LowCodeTextareaField from "../../components/common/low-code-form/LowCodeTextareaField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof LowCodeTextareaField>(() => props.input);
</script>

<template>
    <LowCodeTextareaField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
