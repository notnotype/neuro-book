<script setup lang="ts">
import LowCodeForm from "../../components/common/low-code-form/LowCodeForm.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof LowCodeForm>(() => props.input);
</script>

<template>
    <LowCodeForm data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
