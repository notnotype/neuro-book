<script setup lang="ts">
import AgentComposerImageBar from "../../components/novel-ide/agent/composer/AgentComposerImageBar.vue";
import {useLabSubject, type LabFixtureProps} from "../lab-subject";
const props = defineProps<LabFixtureProps>();
const subject = useLabSubject<typeof AgentComposerImageBar>(() => props.input, ["remove-image","retry-metadata"]);
const getImageUrl = (target: string): string | null => target ? "https://via.placeholder.com/120x80" : null;
function removeImage(index: number): void {
    subject.write("props", "images", subject.bindings.value.images.filter((_, i) => i !== index));
}
</script>
<template>
    <div class="w-full p-4"><AgentComposerImageBar data-lab-subject class="w-full" v-bind="subject.bindings.value" :get-image-url="getImageUrl" @remove-image="removeImage" /></div>
</template>
