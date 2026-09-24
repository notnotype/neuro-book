<script setup lang="ts">
import DiffWorkbenchDialog from "nbook/app/components/common/diff/DiffWorkbenchDialog.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(DiffWorkbenchDialog, () => props.input);
</script>

<template>
    <div class="flex h-full w-full items-center justify-center">
        <DiffWorkbenchDialog
            data-lab-subject
            v-bind="subject.bindings.value"
        />
    </div>
</template>
