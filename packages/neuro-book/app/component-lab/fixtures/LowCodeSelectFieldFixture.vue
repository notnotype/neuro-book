<script setup lang="ts">
import LowCodeSelectField from "../../components/common/low-code-form/LowCodeSelectField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof LowCodeSelectField>(() => props.input);
</script>

<template>
    <LowCodeSelectField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
