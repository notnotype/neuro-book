<script setup lang="ts">
import TagInput from "../../components/common/form/TagInput.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof TagInput>(() => props.input);
</script>

<template>
    <TagInput data-lab-subject class="w-full" v-bind="subject.bindings.value" />
</template>
