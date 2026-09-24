<script setup lang="ts">
import LucideIconPickerDialog from "nbook/app/components/common/LucideIconPickerDialog.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(LucideIconPickerDialog, () => props.input);
</script>

<template>
    <div class="h-full min-h-0 w-full bg-[var(--panel-surface)]">
        <LucideIconPickerDialog data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
