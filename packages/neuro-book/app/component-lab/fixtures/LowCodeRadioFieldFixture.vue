<script setup lang="ts">
import LowCodeRadioField from "../../components/common/low-code-form/LowCodeRadioField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(LowCodeRadioField, () => props.input);
</script>

<template>
    <LowCodeRadioField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
