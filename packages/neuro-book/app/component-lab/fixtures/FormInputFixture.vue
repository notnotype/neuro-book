<script setup lang="ts">
import FormInput from "../../components/common/form/FormInput.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof FormInput>(() => props.input);
</script>

<template>
    <FormInput
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    >
        <template v-if="subject.slots.value.prefix" #prefix>
            <span class="shrink-0 font-mono text-[var(--text-muted)]">Aa</span>
        </template>
    </FormInput>
</template>
