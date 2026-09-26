<script setup lang="ts">
import FormSelect from "nbook/app/components/common/form/FormSelect.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof FormSelect>(() => props.input);
</script>

<template>
    <FormSelect data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
