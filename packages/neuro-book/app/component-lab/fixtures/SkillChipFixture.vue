<script setup lang="ts">
import SkillChip from "nbook/app/components/common/SkillChip.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject(SkillChip, () => props.input);
</script>

<template>
    <SkillChip
        data-lab-subject
        class="max-w-full"
        v-bind="subject.bindings.value"
    />
</template>
