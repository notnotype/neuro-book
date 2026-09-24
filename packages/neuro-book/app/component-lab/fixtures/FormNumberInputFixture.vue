<script setup lang="ts">
import FormNumberInput from "../../components/common/form/FormNumberInput.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(FormNumberInput, () => props.input);
</script>

<template>
    <FormNumberInput
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    />
</template>
