<script setup lang="ts">
import LowCodeSwitchField from "../../components/common/low-code-form/LowCodeSwitchField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof LowCodeSwitchField>(() => props.input);
</script>

<template>
    <LowCodeSwitchField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
