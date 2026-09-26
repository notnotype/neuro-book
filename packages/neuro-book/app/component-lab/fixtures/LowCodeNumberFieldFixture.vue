<script setup lang="ts">
import LowCodeNumberField from "../../components/common/low-code-form/LowCodeNumberField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof LowCodeNumberField>(() => props.input);
</script>

<template>
    <LowCodeNumberField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
