<script setup lang="ts">
import FormCheckbox from "../../components/common/form/FormCheckbox.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof FormCheckbox>(() => props.input);
</script>

<template>
    <FormCheckbox
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    />
</template>
