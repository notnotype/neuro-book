<script setup lang="ts">
import LowCodeCheckboxField from "../../components/common/low-code-form/LowCodeCheckboxField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(LowCodeCheckboxField, () => props.input);
</script>

<template>
    <LowCodeCheckboxField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
