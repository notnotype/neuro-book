<script setup lang="ts">
import FormTextarea from "../../components/common/form/FormTextarea.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(FormTextarea, () => props.input);
</script>

<template>
    <FormTextarea
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    />
</template>
