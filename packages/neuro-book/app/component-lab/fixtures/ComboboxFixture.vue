<script setup lang="ts">
import Combobox from "nbook/app/components/common/form/Combobox.vue";
import type {LabFixtureProps} from "../lab-subject";
import {useLabSubject} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof Combobox>(() => props.input);
</script>

<template>
    <Combobox
        data-lab-subject
        class="w-full"
        v-bind="subject.bindings.value"
    />
</template>
