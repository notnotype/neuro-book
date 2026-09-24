<script setup lang="ts">
import FormField from "../../components/common/form/FormField.vue";
import FormInput from "../../components/common/form/FormInput.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(FormField, () => props.input);
</script>

<template>
    <FormField
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    >
        <template v-if="subject.slots.value.default" #default>
            <FormInput model-value="第一章 退潮" readonly aria-label="章节标题" />
        </template>
    </FormField>
</template>
