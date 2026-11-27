<script setup lang="ts">
/**
 * 有建议值的文字输入的夹具：值是场景的双向绑定，由 Lab 管。
 */
import SuggestInput from "nbook/plugins/canon/web/components/editing/SuggestInput.vue";

import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();

const subject = useLabSubject<typeof SuggestInput>(() => props.input, []);
</script>

<template>
    <SuggestInput data-lab-subject class="w-64" v-bind="subject.bindings.value" />
</template>
