<script setup lang="ts">
import LowCodeComboboxField from "../../components/common/low-code-form/LowCodeComboboxField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(LowCodeComboboxField, () => props.input);
</script>

<template>
    <LowCodeComboboxField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
