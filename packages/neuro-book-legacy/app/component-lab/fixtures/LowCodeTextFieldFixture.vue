<script setup lang="ts">
import LowCodeTextField from "../../components/common/low-code-form/LowCodeTextField.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof LowCodeTextField>(() => props.input);
</script>

<template>
    <LowCodeTextField data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
