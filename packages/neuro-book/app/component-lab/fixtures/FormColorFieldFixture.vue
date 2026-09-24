<script setup lang="ts">
import FormColorField from "nbook/app/components/common/form/FormColorField.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(FormColorField, () => props.input);
</script>

<template>
    <FormColorField
        data-lab-subject
        class="mx-auto w-full max-w-md"
        v-bind="subject.bindings.value"
    />
</template>
