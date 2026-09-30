<script setup lang="ts">
import MarkdownView from "../MarkdownView.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";

const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof MarkdownView>(() => props.input);
</script>

<template>
    <div class="h-full overflow-auto p-4">
        <MarkdownView data-lab-subject v-bind="subject.bindings.value" />
    </div>
</template>
