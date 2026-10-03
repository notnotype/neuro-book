<script setup lang="ts">
import LowCodeResourcePresetField from "../../components/common/low-code-form/LowCodeResourcePresetField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof LowCodeResourcePresetField>(() => props.input);
</script>

<template>
    <LowCodeResourcePresetField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
